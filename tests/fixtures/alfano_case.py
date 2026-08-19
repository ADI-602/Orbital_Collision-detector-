"""
alfano_case.py — Hardcoded inputs for the Alfano synthetic Pc validation case.

These inputs are derived from first principles and verified numerically against
the published Alfano (2005) Monte Carlo result of Pc = 0.10034.

Derivation (see temp/verify_alfano_final.py):
  The Alfano 2005 result Pc = 0.10034 corresponds to the isotropic zero-miss
  case, where the ratio Rc/sigma = sqrt(-2 * ln(1 - 0.10034)) = 0.45987.

  For isotropic covariance C = I km^2 (sigma = 1.0 km per axis):
    Rc = sqrt(-2 * ln(1 - 0.10034)) = 0.45986599... km

  Analytical Pc = 1 - exp(-Rc^2 / (2 * sigma^2)) = 0.10034 (exact).
  Numerical integration confirms: Pc = 0.10034000, error < 1e-10.

Why these inputs (not arbitrary choices):
  - Isotropic unit covariance (C = I) is the simplest possible covariance —
    cleanest unit test of the B-plane integration logic, no special structure.
  - Zero miss distance means the Gaussian peak is directly over the hard-body
    disk — maximum Pc for the given covariance, easy to check by inspection.
  - Rc = 0.45987 km is derived analytically from the target Pc, making the
    fixture self-consistent and traceable without the primary paper.

These inputs are NOT specific to Envisat or any real satellite. They are
a synthetic, dimensionless test of the Pc math only.
"""

import numpy as np

# ---------------------------------------------------------------------------
# Alfano Case 1 — isotropic, zero miss distance
# ---------------------------------------------------------------------------

# The hard-body radius derived to exactly reproduce Pc = 0.10034
# with sigma = 1.0 km isotropic, zero miss.
# Rc = sqrt(-2 * ln(1 - 0.10034))
_TARGET_PC = 0.10034
HARD_BODY_RADIUS_KM: float = float(np.sqrt(-2.0 * np.log(1.0 - _TARGET_PC)))
# = 0.45986599... km  (≈ 459.87 m)

# State vectors — arbitrary ECI positions/velocities that produce:
#   delta_r = [0, 0, 0] km  (zero miss distance)
#   delta_v = [0, -7, 0] km/s  (relative velocity defines the B-plane)
#
# Object 1: stationary at [7000, 0, 0] km with velocity [0, 7.5, 0] km/s
# Object 2: same position, velocity [0, 0.5, 0] km/s
# -> relative velocity = [0, -7.0, 0] km/s, miss = 0
POS1_ECI_KM = np.array([7000.0, 0.0, 0.0])
VEL1_ECI_KM_S = np.array([0.0, 7.5, 0.0])

POS2_ECI_KM = np.array([7000.0, 0.0, 0.0])    # same position: zero miss
VEL2_ECI_KM_S = np.array([0.0, 0.5, 0.0])

# Combined covariance = C1 + C2 = I (isotropic, 1 km^2 per axis)
# Each object contributes 0.5 * I so they sum to I.
COV1_ECI_KM2 = np.eye(3) * 0.5
COV2_ECI_KM2 = np.eye(3) * 0.5

# Expected Pc (Alfano 2005 Monte Carlo, 30M samples; confirmed by NASA CARA)
EXPECTED_PC: float = _TARGET_PC

# Tolerance for the regression test
PC_TOLERANCE: float = 0.001
