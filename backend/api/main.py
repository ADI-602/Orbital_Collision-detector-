"""
main.py — FastAPI REST API server for Orbital Risk Advisor.

Exposes RESTful endpoints for satellite orbit propagation, conjunction screening,
Time of Closest Approach (TCA) refinement, collision avoidance burn simulation,
historical Envisat 2004 replay event data, and AI decision support recommendations.
"""

from datetime import datetime, timedelta, timezone
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from skyfield.api import load

from backend.ai.advisor import get_ai_advice
from backend.ai.schema import AIAdvisorRequest, AIAdvisorResponse, ConjunctionContext, ManeuverOption
from backend.api.assessment import assess_conjunction, threat_level
from backend.api.monitoring import ScreeningMonitor
from backend.api.tracked_set import TrackedSet
from backend.physics.collision_probability import _tle_covariance_rtn, compute_pc, covariance_rtn_to_eci
from backend.physics.maneuver import simulate_maneuver
from backend.physics.propagation import propagate
from backend.physics.screening import _orbital_elements_from_tle, screen_candidates
from backend.physics.tca import compute_tca_from_tles
from backend.physics.tle_ingest import parse_tle_pair
from tests.fixtures.envisat_tles import ENVISAT_TLES, ZENITH2_TLES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("orbital_risk_api")

# ---------------------------------------------------------------------------
# Tracked set and continuous monitoring
# ---------------------------------------------------------------------------
#
# The catalogue the console tracks lives here, on the server, so that (a)
# screening runs without a browser open and (b) the event list and the globe
# describe the same objects. See tracked_set.py for the full reasoning.
#
# Groups are debris-rich by design: `stations` is ~20 mostly co-located
# objects, which is why screening it finds nothing. These are real catalogue
# populations with real close approaches — the list is populated by widening
# the INPUT, never by seeding output (CLAUDE.md §5.2).
TRACKED_GROUPS = [
    g.strip()
    for g in os.environ.get(
        "TRACKED_GROUPS", "cosmos-2251-debris,iridium-33-debris",
    ).split(",")
    if g.strip()
]

# Seconds between passes. A pass over a few hundred objects takes minutes, so
# this is a floor, not a promise.
MONITOR_INTERVAL_S = float(os.environ.get("MONITOR_INTERVAL_S", "900"))

# Cap on refinements per pass. Without it a full pass is ~1.6 h; with it the
# closest-bound pairs are refined and the response says it was truncated.
MONITOR_MAX_REFINE = int(os.environ.get("MONITOR_MAX_REFINE", "300"))

tracked_set = TrackedSet(TRACKED_GROUPS)
monitor = ScreeningMonitor(
    tracked_set,
    interval_s=MONITOR_INTERVAL_S,
    max_refine_pairs=MONITOR_MAX_REFINE,
)

app = FastAPI(
    title="Orbital Risk Advisor API",
    description="Space Domain Awareness & Conjunction Risk Assessment API",
    version="1.0.0",
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request/Response Models for Physics Endpoints ---

class TLEInput(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "ENVISAT"})
    line1: str = Field(..., json_schema_extra={"example": "1 27386U 02009A   04293.45678901 ..."})
    line2: str = Field(..., json_schema_extra={"example": "2 27386  98.5432 ..."})


class TCAPhysicsRequest(BaseModel):
    primary: TLEInput
    secondary: TLEInput
    start_utc_iso: str = Field(..., json_schema_extra={"example": "2004-10-21T00:00:00Z"})
    search_duration_hours: float = Field(default=48.0, json_schema_extra={"example": 48.0})


class ScreeningPhysicsRequest(BaseModel):
    primary: TLEInput
    candidates: List[TLEInput]
    start_utc_iso: str = Field(..., json_schema_extra={"example": "2004-10-21T00:00:00Z"})
    search_duration_hours: float = Field(default=48.0, json_schema_extra={"example": 48.0})
    coarse_threshold_km: float = Field(default=50.0, json_schema_extra={"example": 50.0})


class ManeuverPhysicsRequest(BaseModel):
    primary: TLEInput
    secondary: TLEInput
    tca_utc_iso: str = Field(..., json_schema_extra={"example": "2004-10-22T08:12:34Z"})
    delta_v_cm_s: float = Field(default=-4.0, json_schema_extra={"example": -4.0})
    lead_time_minutes: float = Field(default=50.0, json_schema_extra={"example": 50.0})
    sat_mass_kg: float = Field(default=8200.0, json_schema_extra={"example": 8200.0})


# --- API Routes ---

@app.get("/health", tags=["Health"])
def health_check() -> Dict[str, str]:
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "Orbital Risk Advisor API",
        "version": "1.0.0",
    }


@app.get("/api/conjunctions/envisat", tags=["Replay Scenarios"])
def get_envisat_replay_data() -> Dict[str, Any]:
    """
    Get ground-truth dataset for the historical October 2004 Envisat vs Zenith-2 debris conjunction.
    Includes prediction days Oct 19, Oct 20, Oct 21, and Oct 22 with TLEs, miss distances, and pre-burn Pc.
    """
    days_map = {
        "oct_19": "2004-10-19",
        "oct_20": "2004-10-20",
        "oct_21": "2004-10-21",
        "oct_22": "2004-10-22",
    }
    days_data = []

    for day_key, date_str in days_map.items():
        env_l1, env_l2 = ENVISAT_TLES[day_key]
        zen_l1, zen_l2 = ZENITH2_TLES[day_key]

        days_data.append({
            "day": day_key,
            "prediction_date": date_str,
            "tca_target_iso": "2004-10-22T05:10:35Z",
            "envisat_tle": {
                "name": "ENVISAT",
                "line1": env_l1,
                "line2": env_l2,
            },
            "secondary_tle": {
                "name": "ZENITH-2 DEBRIS",
                "line1": zen_l1,
                "line2": zen_l2,
            },
        })

    return {
        "event_name": "Envisat vs Zenith-2 Debris (October 2004)",
        "primary_satellite": "ENVISAT",
        "secondary_object": "ZENITH-2 DEBRIS",
        "primary_norad_id": 27386,
        "secondary_norad_id": 22437,
        "tca_utc": "2004-10-22T05:10:35Z",
        "prediction_days": days_data,
    }


@app.post("/api/physics/tca", tags=["Physics Pipeline"])
def compute_tca_endpoint(req: TCAPhysicsRequest) -> Dict[str, Any]:
    """
    Compute precise Time of Closest Approach (TCA) and miss distance between primary and secondary objects.
    """
    try:
        ts = load.timescale()
        sat1 = parse_tle_pair(req.primary.line1, req.primary.line2, req.primary.name)
        sat2 = parse_tle_pair(req.secondary.line1, req.secondary.line2, req.secondary.name)

        dt_start = datetime.fromisoformat(req.start_utc_iso.replace("Z", "+00:00"))
        start_time = ts.from_datetime(dt_start)
        end_time = ts.from_datetime(dt_start + timedelta(hours=req.search_duration_hours))

        tca_res = compute_tca_from_tles(sat1, sat2, start_time, end_time, threshold_km=500.0)

        if not tca_res:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No close approach found within search duration window.",
            )

        return {
            "tca_utc_iso": tca_res.tca_time.utc_strftime("%Y-%m-%dT%H:%M:%SZ"),
            "miss_distance_m": tca_res.miss_distance_km * 1000.0,
            "miss_distance_km": tca_res.miss_distance_km,
            "relative_speed_km_s": tca_res.rel_velocity_km_s,
            "primary_pos_eci_km": tca_res.state1_eci.pos_eci_km.tolist(),
            "secondary_pos_eci_km": tca_res.state2_eci.pos_eci_km.tolist(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("compute_tca_endpoint failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"TCA calculation failed: {str(e)}",
        )


@app.post("/api/physics/screening", tags=["Physics Pipeline"])
def screening_endpoint(req: ScreeningPhysicsRequest) -> Dict[str, Any]:
    """
    Screen candidate objects against a primary satellite for conjunction threats.

    One unusable candidate does not fail the batch. Pairs the physics declines
    to assess come back inside `events` marked `unassessable` with the reason,
    so the caller can send one request for many candidates instead of one
    request each. Only a failure that invalidates the whole request — an
    unparseable primary, a malformed window — is an error response.
    """
    try:
        primary_sat = parse_tle_pair(req.primary.line1, req.primary.line2, req.primary.name)

        ts = load.timescale()
        dt_start = datetime.fromisoformat(req.start_utc_iso.replace("Z", "+00:00"))
        start_time = ts.from_datetime(dt_start)
        end_time = ts.from_datetime(dt_start + timedelta(hours=req.search_duration_hours))
    except Exception as e:
        logger.error("screening_endpoint: bad request: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Screening request could not be prepared: {str(e)}",
        )

    # A candidate whose element set will not parse is that candidate's problem,
    # not the batch's.
    candidate_sats = []
    rejected: List[Dict[str, str]] = []
    for c in req.candidates:
        try:
            candidate_sats.append(parse_tle_pair(c.line1, c.line2, c.name))
        except Exception as exc:
            logger.warning("screening_endpoint: unparseable candidate %s: %s", c.name, exc)
            rejected.append({"name": c.name, "reason": str(exc)})

    try:
        flagged_candidates = screen_candidates(
            primary=primary_sat,
            candidates=candidate_sats,
            start_time=start_time,
            end_time=end_time,
            threshold_km=req.coarse_threshold_km,
            skip_coarse_filter=True,
        )
    except Exception as e:
        logger.error("screening_endpoint: screening stage failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Screening failed: {str(e)}",
        )

    events_out = []
    for c in flagged_candidates:
        record = assess_conjunction(c, ts)
        if record is not None:
            events_out.append(record)

    return {
        "primary_name": primary_sat.name,
        "candidates_screened": len(candidate_sats),
        "events": events_out,
        # Named, not silent: a candidate that never reached the pipeline must
        # be visible as such rather than looking like one with no conjunction.
        "rejected_candidates": rejected,
    }


@app.post("/api/physics/maneuver", tags=["Physics Pipeline"])
def maneuver_endpoint(req: ManeuverPhysicsRequest) -> Dict[str, Any]:
    """
    Simulate impulsive collision-avoidance maneuver (ΔV) and evaluate pre/post burn miss distance and Pc.
    """
    try:
        ts = load.timescale()
        sat1 = parse_tle_pair(req.primary.line1, req.primary.line2, req.primary.name)
        sat2 = parse_tle_pair(req.secondary.line1, req.secondary.line2, req.secondary.name)

        dt_tca = datetime.fromisoformat(req.tca_utc_iso.replace("Z", "+00:00"))
        start_time = ts.from_datetime(dt_tca - timedelta(hours=2.0))
        end_time = ts.from_datetime(dt_tca + timedelta(hours=2.0))

        tca_res = compute_tca_from_tles(sat1, sat2, start_time, end_time, threshold_km=500.0)

        if not tca_res:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Could not compute TCA for maneuver simulation.",
            )

        man_res = simulate_maneuver(
            primary=sat1,
            secondary=sat2,
            tca_result=tca_res,
            delta_v_cm_s=req.delta_v_cm_s,
            lead_time_minutes=req.lead_time_minutes,
            sat_mass_kg=req.sat_mass_kg,
        )

        return {
            "primary_name": man_res.primary_name,
            "secondary_name": man_res.secondary_name,
            "delta_v_cm_s": man_res.delta_v_cm_s,
            "lead_time_minutes": man_res.lead_time_minutes,
            "pre_burn_miss_distance_m": man_res.pre_burn_miss_distance_m,
            "post_burn_miss_distance_m": man_res.post_burn_miss_distance_m,
            "pre_burn_pc": man_res.pre_burn_pc,
            "post_burn_pc": man_res.post_burn_pc,
            "risk_reduction_pct": man_res.risk_reduction_pct,
            "fuel_consumed_kg": man_res.fuel_consumed_kg,
            "maneuver_recommended": man_res.maneuver_recommended,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("maneuver_endpoint failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Maneuver simulation failed: {str(e)}",
        )


@app.post("/api/ai/advise", tags=["AI Decision Support"], response_model=AIAdvisorResponse)
def ai_advise_endpoint(req: AIAdvisorRequest) -> AIAdvisorResponse:
    """
    Generate AI decision support analysis for a conjunction event.
    Automatically degrades to pure-Python rule-based advisor if ANTHROPIC_API_KEY is missing or API fails.
    """
    return get_ai_advice(req)


# ---------------------------------------------------------------------------
# Tracking + continuous monitoring
# ---------------------------------------------------------------------------

@app.on_event("startup")
def _start_monitor() -> None:
    """Load the tracked set and begin scheduled screening."""
    monitor.start()


@app.on_event("shutdown")
def _stop_monitor() -> None:
    monitor.stop()


@app.get("/api/tracking/objects", tags=["Tracking"])
def tracking_objects() -> Dict[str, Any]:
    """
    The catalogue the console tracks, as raw element sets.

    The frontend renders these and propagates them in-browser for smooth
    animation. It does not choose them — that is what keeps the globe and the
    event list describing the same objects.

    `source` says where the data came from and MUST be surfaced: showing cached
    or stale element sets as live is the same class of dishonesty as inventing
    a number.
    """
    # Never a live fetch on the request thread: refreshing the set is the
    # monitor's job, and blocking here once outlasted the browser's own timeout.
    snap = tracked_set.load_for_request()
    return {
        "objects": [o.as_wire() for o in snap.objects],
        "count": snap.count,
        "groups": snap.groups,
        "source": snap.source,
        "fetched_at_unix": snap.fetched_at,
        # Element sets that would not parse never reached the pipeline, so they
        # cannot show up as "no conjunction found". They are named instead.
        "rejected": snap.rejected,
        "error": snap.error,
    }


@app.get("/api/monitoring/status", tags=["Tracking"])
def monitoring_status() -> Dict[str, Any]:
    """
    State of the scheduled screening, without the events themselves.

    Cheap enough to poll. Note this reports the PHYSICS pipeline's schedule —
    no AI is involved in producing or triggering these runs.
    """
    run = monitor.current
    return {
        "state": run.state,
        "started_at_unix": run.started_at,
        "finished_at_unix": run.finished_at,
        "duration_s": run.duration_s,
        "window_start_utc_iso": run.window_start_utc_iso,
        "window_hours": run.window_hours,
        "objects_tracked": run.objects_tracked,
        "event_count": len(run.events),
        "high_risk_count": run.high_risk_count,
        "stats": run.stats,
        "interval_s": MONITOR_INTERVAL_S,
        "error": run.error,
    }


@app.get("/api/monitoring/events", tags=["Tracking"])
def monitoring_events() -> Dict[str, Any]:
    """
    Conjunctions from the last completed screening pass.

    Served from cache, so this returns instantly whatever the pipeline is doing
    now. `stats.truncated` says whether refinement was capped — a partial
    screening is a different claim from a complete one, and the UI must be able
    to tell the difference.
    """
    run = monitor.current
    return {
        "state": run.state,
        "events": run.events,
        "event_count": len(run.events),
        "high_risk_count": run.high_risk_count,
        "window_start_utc_iso": run.window_start_utc_iso,
        "window_hours": run.window_hours,
        "finished_at_unix": run.finished_at,
        "stats": run.stats,
        "error": run.error,
    }


@app.get("/api/monitoring/alerts", tags=["Tracking"])
def monitoring_alerts() -> Dict[str, Any]:
    """
    High-risk conjunctions first seen since this was last called.

    Drains on read, so each alert is delivered once rather than re-firing on
    every pass that still sees the same event.
    """
    pending = monitor.take_new_high_risk()
    return {"alerts": pending, "count": len(pending)}


@app.post("/api/monitoring/refresh", tags=["Tracking"])
def monitoring_refresh() -> Dict[str, Any]:
    """
    Ask for a screening pass now.

    Returns immediately. The pass runs on the monitor's own thread; poll
    /api/monitoring/status to see it finish. This never blocks a request, which
    matters on stage — a click that hangs the UI for minutes is worse than no
    button at all.
    """
    monitor.trigger()
    return {"triggered": True, "state": monitor.current.state}
