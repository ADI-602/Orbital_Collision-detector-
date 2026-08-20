"""
test_api_endpoints.py — End-to-end integration tests for FastAPI REST API endpoints.
"""

from fastapi.testclient import TestClient
import pytest

from backend.api.main import app
from tests.fixtures.envisat_tles import ENVISAT_TLES, ZENITH2_TLES

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "Orbital Risk Advisor API" in data["service"]


def test_get_envisat_replay_data():
    response = client.get("/api/conjunctions/envisat")
    assert response.status_code == 200
    data = response.json()
    assert data["primary_satellite"] == "ENVISAT"
    assert len(data["prediction_days"]) == 4
    for day in data["prediction_days"]:
        assert "envisat_tle" in day
        assert "secondary_tle" in day


def test_compute_tca_endpoint():
    env_l1, env_l2 = ENVISAT_TLES["oct_22"]
    zen_l1, zen_l2 = ZENITH2_TLES["oct_22"]
    payload = {
        "primary": {
            "name": "ENVISAT",
            "line1": env_l1,
            "line2": env_l2,
        },
        "secondary": {
            "name": "ZENITH-2 DEBRIS",
            "line1": zen_l1,
            "line2": zen_l2,
        },
        "start_utc_iso": "2004-10-22T00:00:00Z",
        "search_duration_hours": 12.0,
    }
    response = client.post("/api/physics/tca", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "tca_utc_iso" in data
    assert data["miss_distance_m"] > 0.0
    assert data["relative_speed_km_s"] > 0.0


def test_screening_endpoint():
    env_l1, env_l2 = ENVISAT_TLES["oct_22"]
    zen_l1, zen_l2 = ZENITH2_TLES["oct_22"]
    payload = {
        "primary": {
            "name": "ENVISAT",
            "line1": env_l1,
            "line2": env_l2,
        },
        "candidates": [
            {
                "name": "ZENITH-2 DEBRIS",
                "line1": zen_l1,
                "line2": zen_l2,
            }
        ],
        "start_utc_iso": "2004-10-22T00:00:00Z",
        "search_duration_hours": 12.0,
        "coarse_threshold_km": 500.0,
    }
    response = client.post("/api/physics/screening", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["primary_name"] == "ENVISAT"
    assert data["candidates_screened"] == 1
    assert len(data["events"]) == 1
    assert data["events"][0]["secondary_name"] == "ZENITH-2 DEBRIS"


def test_maneuver_endpoint():
    env_l1, env_l2 = ENVISAT_TLES["oct_22"]
    zen_l1, zen_l2 = ZENITH2_TLES["oct_22"]
    payload = {
        "primary": {
            "name": "ENVISAT",
            "line1": env_l1,
            "line2": env_l2,
        },
        "secondary": {
            "name": "ZENITH-2 DEBRIS",
            "line1": zen_l1,
            "line2": zen_l2,
        },
        "tca_utc_iso": "2004-10-22T05:10:35Z",
        "delta_v_cm_s": -4.0,
        "lead_time_minutes": 50.0,
        "sat_mass_kg": 8200.0,
    }
    response = client.post("/api/physics/maneuver", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["primary_name"] == "ENVISAT"
    assert data["delta_v_cm_s"] == -4.0
    assert data["post_burn_miss_distance_m"] > data["pre_burn_miss_distance_m"]
    assert data["post_burn_pc"] < data["pre_burn_pc"]
    assert data["fuel_consumed_kg"] > 0.0


def test_ai_advise_endpoint_degrades_gracefully(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    payload = {
        "conjunction": {
            "primary_name": "ENVISAT",
            "secondary_name": "ZENITH-2 DEBRIS",
            "tca_iso": "2004-10-22T05:10:35Z",
            "miss_distance_m": 112.4,
            "pre_burn_pc": 0.00014,
            "relative_speed_km_s": 9.81,
            "primary_alt_km": 790.0,
            "hard_body_radius_m": 14.5,
        },
        "maneuvers": [
            {
                "delta_v_cm_s": -4.0,
                "lead_time_minutes": 50.0,
                "post_burn_miss_distance_m": 1240.5,
                "post_burn_pc": 3.2e-7,
                "risk_reduction_pct": 99.8,
                "fuel_consumed_kg": 0.076,
                "recommended": True,
            }
        ],
        "query_type": "recommendation",
    }
    response = client.post("/api/ai/advise", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["is_fallback"] is True
    assert "HIGH RISK CONJUNCTION" in data["executive_summary"]
