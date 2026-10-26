"""
test_maneuver_tracks.py — the sampled trajectories behind the drawn burn.

CLAUDE.md §5.2 requires the post-burn trajectory to come from the backend as a
sampled ephemeris rather than being reconstructed in the browser. That makes
these tracks pipeline output, and pipeline output has to be pinned.

The load-bearing test is `test_track_reproduces_the_reported_post_burn_miss`.
The console will draw a line and print a number beside it, and a viewer will
read them as the same claim. They are only the same claim if the track's
position at TCA is the position the reported miss distance was computed from —
so that identity is asserted directly, not assumed from shared code.

The fixture is the real October 2004 Envisat manoeuvre: −4.0 cm/s along-track,
50 minutes before TCA (Klinkrad et al. 2005). Numbers quoted in comments below
came from running this pipeline, not from the paper, except where said.
"""

import os
import sys

import numpy as np
import pytest
from skyfield.api import EarthSatellite, load

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.physics.maneuver import (  # noqa: E402
    _MU_EARTH_KM3_S2,
    _TRACK_SAMPLES,
    _cw_relative_state_rtn,
    simulate_maneuver,
)
from backend.physics.screening import screen_pair  # noqa: E402
from backend.physics.tca import refine_tca  # noqa: E402
from tests.fixtures.envisat_tles import (  # noqa: E402
    ENVISAT_TLES,
    EXPECTED_TCA_UTC,
    HARD_BODY_RADIUS_KM,
    ZENITH2_TLES,
)

LEAD_TIME_MINUTES = 50.0
DELTA_V_CM_S = -4.0


@pytest.fixture(scope="module")
def ts():
    return load.timescale()


@pytest.fixture(scope="module")
def encounter(ts):
    """The Oct 22 prediction day, screened and refined the usual way."""
    env_l1, env_l2 = ENVISAT_TLES["oct_22"]
    zen_l1, zen_l2 = ZENITH2_TLES["oct_22"]

    envisat = EarthSatellite(env_l1, env_l2, "ENVISAT", ts)
    zenith2 = EarthSatellite(zen_l1, zen_l2, "ZENITH-2 DEBRIS", ts)

    tca_tt = float(ts.utc(*EXPECTED_TCA_UTC).tt)
    candidate = screen_pair(
        envisat, zenith2,
        ts.tt_jd(tca_tt - 0.02), ts.tt_jd(tca_tt + 0.02),
        timestep_s=10.0, threshold_km=100.0,
    )
    assert candidate is not None
    return envisat, zenith2, refine_tca(candidate)


@pytest.fixture(scope="module")
def result(encounter):
    envisat, zenith2, tca_result = encounter
    return simulate_maneuver(
        primary=envisat,
        secondary=zenith2,
        tca_result=tca_result,
        delta_v_cm_s=DELTA_V_CM_S,
        lead_time_minutes=LEAD_TIME_MINUTES,
        hard_body_radius_km=HARD_BODY_RADIUS_KM,
    )


def _as_array(rows):
    return np.asarray(rows, dtype=float)


# --- the tracks and the numbers must be the same claim -----------------------

def test_the_encounter_geometry_reproduces_the_reported_miss_distances(result):
    """
    The drawn encounter and the printed numbers must be the same claim.

    tca_*_pos_ecef_km are the refined TCA states rotated into ECEF. A rotation
    preserves distance, so the separations between them must equal the reported
    miss distances exactly -- not approximately. If they ever drift apart, the
    console would be drawing one encounter and reporting another, which is the
    single worst thing this panel could do.
    """
    tracks = result.tracks
    pre = np.asarray(tracks.tca_pre_burn_pos_ecef_km, dtype=float)
    post = np.asarray(tracks.tca_post_burn_pos_ecef_km, dtype=float)
    secondary = np.asarray(tracks.tca_secondary_pos_ecef_km, dtype=float)

    drawn_pre_m = float(np.linalg.norm(secondary - pre)) * 1000.0
    drawn_post_m = float(np.linalg.norm(secondary - post)) * 1000.0

    assert drawn_pre_m == pytest.approx(result.pre_burn_miss_distance_m, rel=1e-9)
    assert drawn_post_m == pytest.approx(result.post_burn_miss_distance_m, rel=1e-9)
    # And the burn must be the thing that improved it: 268 m -> 556 m here.
    assert drawn_post_m > drawn_pre_m


def test_the_sampled_arcs_cannot_resolve_the_miss_distance(result):
    """
    Pins the limitation rather than pretending it away.

    The arcs span an hour at a ~16 s step, and the objects close at ~15 km/s, so
    the nearest sampled approach is kilometres from the true 268 m and depends
    on where the grid happens to fall. This test asserts that gap EXISTS, so
    that nobody later "fixes" a display grid into looking like a measurement,
    and so the reason the encounter is carried separately stays documented in
    an executable place.
    """
    tracks = result.tracks
    post = _as_array(tracks.post_burn_pos_ecef_km)
    secondary = _as_array(tracks.secondary_pos_ecef_km)

    sampled_min_m = float(np.linalg.norm(secondary - post, axis=1).min()) * 1000.0

    assert sampled_min_m > 10.0 * result.post_burn_miss_distance_m, (
        "the sampled arcs came suspiciously close to the true miss distance; if "
        "the grid is now fine enough to resolve the encounter, say so and stop "
        "carrying tca_* separately"
    )
    # An upper bound too: one sample step of relative motion. Beyond that the
    # window or the grid is wrong, not merely coarse.
    relative_speed_km_s = 15.0
    assert sampled_min_m < relative_speed_km_s * tracks.sample_step_s * 1000.0


def test_the_two_tracks_are_identical_before_the_burn(result):
    """
    Nothing has happened yet, so the lines must coincide exactly.

    This is not cosmetic. A displacement appearing before the impulse would mean
    the model is being evaluated at negative time — running the manoeuvre
    backwards — and the drawn divergence point would be wrong.
    """
    tracks = result.tracks
    pre = _as_array(tracks.pre_burn_pos_ecef_km)
    post = _as_array(tracks.post_burn_pos_ecef_km)
    burn = tracks.burn_sample_index

    assert burn > 0, "the window must show some coasting flight before the burn"
    np.testing.assert_allclose(post[: burn + 1], pre[: burn + 1], atol=1e-9)


def test_the_tracks_separate_after_the_burn(result):
    """And having burned, they must not still coincide."""
    tracks = result.tracks
    pre = _as_array(tracks.pre_burn_pos_ecef_km)
    post = _as_array(tracks.post_burn_pos_ecef_km)

    separation_m = np.linalg.norm(post - pre, axis=1) * 1000.0
    assert separation_m[-1] > 1.0
    # Monotonic growth is not asserted: the radial term oscillates. What must
    # hold is that separation never goes back to zero once burned.
    assert separation_m[tracks.burn_sample_index + 5:].min() > 0.0


def test_separation_at_tca_is_the_analytic_displacement(encounter, result):
    """
    Reported from the closed form, not from the nearest sample.

    Reading it off the grid would make a physical quantity depend on how finely
    the line happens to be drawn. The mean motion is re-derived here from the
    TCA state by vis-viva rather than imported, so that a change to how
    maneuver.py fits `n` shows up as a failure instead of quiet agreement.
    """
    _, _, tca_result = encounter
    state = tca_result.state1_eci
    r_km = float(np.linalg.norm(state.pos_eci_km))
    v_km_s = float(np.linalg.norm(state.vel_eci_km_s))
    a_km = 1.0 / ((2.0 / r_km) - (v_km_s**2 / _MU_EARTH_KM3_S2))
    n_rad_s = float(np.sqrt(_MU_EARTH_KM3_S2 / a_km**3))

    dr_km, _ = _cw_relative_state_rtn(
        (DELTA_V_CM_S / 100.0) / 1000.0, n_rad_s, LEAD_TIME_MINUTES * 60.0,
    )
    expected_m = float(np.linalg.norm(dr_km)) * 1000.0

    assert result.tracks.separation_at_tca_m == pytest.approx(expected_m, rel=1e-9)
    # ~389 m for this burn: a few hundred metres is what a 4 cm/s impulse buys,
    # and it is why the manoeuvre works at all on a 268 m miss.
    assert 100.0 < result.tracks.separation_at_tca_m < 2000.0


# --- shape, frame and units --------------------------------------------------

def test_tracks_are_labelled_with_their_frame_and_units(result):
    """Unlabelled coordinates are how frame-mismatch bugs get built."""
    tracks = result.tracks
    assert tracks.frame == "ecef"
    assert tracks.units == "km"


def test_every_track_is_the_same_length_and_finite(result):
    tracks = result.tracks
    assert len(tracks.sample_utc_iso) == _TRACK_SAMPLES

    for rows in (
        tracks.pre_burn_pos_ecef_km,
        tracks.post_burn_pos_ecef_km,
        tracks.secondary_pos_ecef_km,
    ):
        arr = _as_array(rows)
        assert arr.shape == (_TRACK_SAMPLES, 3)
        assert np.isfinite(arr).all()
        # Both objects are in LEO; a metres/km slip would land far outside.
        radius_km = np.linalg.norm(arr, axis=1)
        assert (radius_km > 6500).all() and (radius_km < 9000).all()


def test_the_window_brackets_both_the_burn_and_the_tca(result):
    tracks = result.tracks
    assert tracks.sample_utc_iso[0] < tracks.burn_utc_iso < tracks.tca_utc_iso
    assert tracks.tca_utc_iso < tracks.sample_utc_iso[-1]


def test_an_unflown_burn_leaves_the_tracks_coincident(encounter):
    """A 0 cm/s burn is a real request, and it must draw one line, not two."""
    envisat, zenith2, tca_result = encounter
    zero = simulate_maneuver(
        primary=envisat, secondary=zenith2, tca_result=tca_result,
        delta_v_cm_s=0.0, lead_time_minutes=LEAD_TIME_MINUTES,
        hard_body_radius_km=HARD_BODY_RADIUS_KM,
    )

    pre = _as_array(zero.tracks.pre_burn_pos_ecef_km)
    post = _as_array(zero.tracks.post_burn_pos_ecef_km)
    np.testing.assert_allclose(post, pre, atol=1e-9)
    assert zero.tracks.separation_at_tca_m == pytest.approx(0.0, abs=1e-6)


# --- the model's own limits --------------------------------------------------

def test_a_lead_time_beyond_the_cw_horizon_is_clipped_and_said_so(encounter):
    """
    The linearisation holds for about an orbit. Past that the along-track term
    grows without bound, so the sampler must stop and declare it rather than
    draw a trajectory the model cannot assert.
    """
    envisat, zenith2, tca_result = encounter
    long_lead = simulate_maneuver(
        primary=envisat, secondary=zenith2, tca_result=tca_result,
        delta_v_cm_s=DELTA_V_CM_S, lead_time_minutes=400.0,
        hard_body_radius_km=HARD_BODY_RADIUS_KM,
    )

    assert long_lead.tracks.truncated is True
    assert long_lead.tracks.note, "a clipped window must carry its reason"
    assert "Clohessy-Wiltshire" in long_lead.tracks.note


def test_a_normal_lead_time_is_not_clipped(result):
    """50 minutes is well inside the horizon; nothing should be flagged."""
    assert result.tracks.truncated is False
    assert result.tracks.note is None


def test_tracks_can_be_suppressed(encounter):
    """The physics must not require the display sampling to run."""
    envisat, zenith2, tca_result = encounter
    bare = simulate_maneuver(
        primary=envisat, secondary=zenith2, tca_result=tca_result,
        delta_v_cm_s=DELTA_V_CM_S, lead_time_minutes=LEAD_TIME_MINUTES,
        hard_body_radius_km=HARD_BODY_RADIUS_KM, sample_tracks=False,
    )
    assert bare.tracks is None
    assert bare.post_burn_miss_distance_m > 0
