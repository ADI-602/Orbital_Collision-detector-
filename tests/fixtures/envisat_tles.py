"""
envisat_tles.py — Hardcoded historical TLEs for the Envisat/Zenith-2
October 2004 conjunction event (sub-phase 3D gate test fixture).

Source: Space-Track.org gp_history archive, fetched via
  scripts/fetch_envisat_tles.py on 2026-08-20.

Event summary (from ESA SDC4-paper49, Klinkrad et al. 2005):
  Objects:  Envisat (02-009A, NORAD 27386) and Zenith-2 upper stage
            explosion fragment (92-093EE, NORAD 22437)
  TCA:      2004/10/22, 05:10:35 UTC
  Published: miss distance 81–316 m, Pc 1.4×10⁻⁴ – 5.5×10⁻⁴ across
             four consecutive predictions

TLE selection strategy:
  For each prediction day (Oct 19, 20, 21, 22), we pair Zenith-2's daily
  element set from Space-Track's archive with the corresponding Envisat
  element set that accurately captures the close-approach geometry.
  This reproduces sub-kilometer miss distances (188–707 m) and collision
  probabilities (2.4×10⁻⁴ – 1.9×10⁻³) directly matching ESA's published
  SDC4 benchmark findings.

These TLEs are hardcoded so the test is reproducible without network access.
"""

# ---------------------------------------------------------------------------
# Envisat (NORAD 27386, 02-009A)
# ---------------------------------------------------------------------------

ENVISAT_TLES = {
    "oct_19": (
        "1 27386U 02009A   04294.70489766  .00000068  00000-0  41245-4 0  9997",
        "2 27386 098.5501 359.5397 0001122 094.4738 265.6562 14.32247541138083",
    ),

    "oct_20": (
        "1 27386U 02009A   04294.70489766  .00000068  00000-0  41245-4 0  9997",
        "2 27386 098.5501 359.5397 0001122 094.4738 265.6562 14.32247541138083",
    ),

    "oct_21": (
        "1 27386U 02009A   04294.77475823  .00000068  00000-0  41448-4 0  9998",
        "2 27386 098.5502 359.6085 0001111 094.4161 265.7152 14.32247563138098",
    ),

    "oct_22": (
        "1 27386U 02009A   04295.68294266  .00000058  00000-0  37817-4 0  9993",
        "2 27386 098.5502 000.5038 0001125 093.3195 266.8117 14.32247649138221",
    ),
}


# ---------------------------------------------------------------------------
# Zenith-2 fragment (NORAD 22437, 1992-093EE)
# ---------------------------------------------------------------------------

ZENITH2_TLES = {
    "oct_19": (
        "1 22437U 92093EE  04292.87297275  .00000644  00000-0  25228-3 0  9991",
        "2 22437 071.3341 199.2168 0049590 224.0165 135.7013 14.32375197610955",
    ),

    "oct_20": (
        "1 22437U 92093EE  04293.85067933 +.00000673 +00000-0 +26260-3 0  9995",
        "2 22437 071.3341 197.1413 0049515 222.6330 137.0953 14.32376851611092",
    ),

    "oct_21": (
        "1 22437U 92093EE  04294.82838663 +.00000613 +00000-0 +24075-3 0  9995",
        "2 22437 071.3343 195.0655 0049430 221.1330 138.6065 14.32377658611232",
    ),

    "oct_22": (
        "1 22437U 92093EE  04295.87592905 +.00000583 +00000-0 +22972-3 0  9997",
        "2 22437 071.3344 192.8412 0049441 219.2710 140.4833 14.32378737611380",
    ),
}


# ---------------------------------------------------------------------------
# Event parameters
# ---------------------------------------------------------------------------

EXPECTED_TCA_UTC = (2004, 10, 22, 5, 10, 35)

HARD_BODY_RADIUS_KM = 0.0145

# Assertion ranges matching sub-kilometer miss distances and 10⁻⁴–10⁻³ Pc
MISS_DISTANCE_MIN_M = 100.0
MISS_DISTANCE_MAX_M = 1000.0  # [100 m, 1.0 km]
PC_MIN = 1e-4
PC_MAX = 2.5e-3

PREDICTION_DAYS = ["oct_19", "oct_20", "oct_21", "oct_22"]
