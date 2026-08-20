"""
run_pipeline.py — Command-line runner for the complete end-to-end Orbital Risk Advisor pipeline.

Executes Stages 1 through 7 in sequence and prints formatted operational telemetry.
"""

import json
import os
import sys

# Force UTF-8 encoding on Windows stdout
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.pipeline import run_orbital_risk_pipeline


def main():
    print("=" * 80)
    print("      ORBITAL RISK ADVISOR — COMPLETE BACKEND PIPELINE RUNNER")
    print("=" * 80)

    result = run_orbital_risk_pipeline(
        start_utc_iso="2004-10-22T05:00:00Z",
        search_duration_hours=0.5,
        delta_v_cm_s=-4.0,
        lead_time_minutes=50.0,
    )

    print(f"\n[SUMMARY] Primary Satellite: {result['primary_satellite']}")
    print(f"[SUMMARY] Candidates Screened: {result['candidates_screened']}")
    print(f"[SUMMARY] Conjunction Events Flagged: {result['conjunctions_found']}")

    for idx, evt in enumerate(result["events"], 1):
        pb = evt["pre_burn"]
        man = evt["post_burn_maneuver"]
        ai = evt["ai_advice"]

        print(f"\n{'─' * 80}")
        print(f"EVENT #{idx}: {result['primary_satellite']} vs {evt['secondary_name']}")
        print(f"{'─' * 80}")
        print(f"  • Time of Closest Approach (TCA): {evt['tca_utc_iso']} UTC")
        print(f"  • Relative Speed:                {pb['relative_speed_km_s']:.2f} km/s")
        print(f"  • Threat Level:                  [{pb['threat_level']}]")
        print(f"\n  --- PRE-BURN TELEMETRY ---")
        print(f"  • Unmaneuvered Miss Distance:    {pb['miss_distance_m']:.1f} meters")
        print(f"  • Unmaneuvered Pc:               {pb['pc']:.2e}")
        print(f"\n  --- POST-BURN MANEUVER SIMULATION (ΔV = {man['delta_v_cm_s']:+.1f} cm/s, Lead = {man['lead_time_minutes']:.1f} min) ---")
        print(f"  • Post-burn Miss Distance:       {man['miss_distance_m']:.1f} meters")
        print(f"  • Post-burn Pc:                  {man['pc']:.2e}")
        print(f"  • Risk Reduction:                {man['risk_reduction_pct']:.1f}%")
        print(f"  • Hydrazine Fuel Consumed:       {man['fuel_consumed_kg']:.3f} kg")
        print(f"\n  --- AI DECISION SUPPORT ADVISOR (Fallback = {ai['is_fallback']}) ---")
        print(f"  Executive Summary: {ai['executive_summary']}")
        print(f"  Recommended Action: {ai['recommended_action']}")

    print("\n" + "=" * 80)
    print("PIPELINE EXECUTION COMPLETE.")
    print("=" * 80)


if __name__ == "__main__":
    main()
