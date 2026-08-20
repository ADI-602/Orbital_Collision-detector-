"""
test_ai_layer.py — Test script for AI Decision Support Advisor scenarios.

Demonstrates calling the AI advisor for 3 distinct operational scenarios:
  1. Critical Red Alert (Pc > 1e-4) — Recommended Burn
  2. Low Risk Monitor Only (Pc < 1e-4) — Stand Down
  3. Tradeoff Evaluation — Comparing Multiple Burn Options
"""

import json
import os
import sys

# Force UTF-8 output formatting for Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.ai.advisor import get_ai_advice
from backend.ai.schema import AIAdvisorRequest, ConjunctionContext, ManeuverOption


def run_scenario_1_high_risk():
    print("\n" + "=" * 80)
    print("SCENARIO 1: CRITICAL RED ALERT CONJUNCTION (Pc > 1e-4)")
    print("=" * 80)

    req = AIAdvisorRequest(
        conjunction=ConjunctionContext(
            primary_name="ENVISAT",
            secondary_name="ZENITH-2 DEBRIS",
            tca_iso="2004-10-22T05:10:35Z",
            miss_distance_m=112.4,
            pre_burn_pc=1.40e-4,
            relative_speed_km_s=9.81,
            primary_alt_km=790.0,
            hard_body_radius_m=14.5,
        ),
        maneuvers=[
            ManeuverOption(
                delta_v_cm_s=-4.0,
                lead_time_minutes=50.0,
                post_burn_miss_distance_m=1240.5,
                post_burn_pc=3.20e-7,
                risk_reduction_pct=99.8,
                fuel_consumed_kg=0.076,
                recommended=True,
            )
        ],
        query_type="recommendation",
    )

    res = get_ai_advice(req)
    print(f"Fallback Mode (Offline Rule-Based): {res.is_fallback}")
    print(f"EXECUTIVE SUMMARY:\n  {res.executive_summary}\n")
    print(f"RISK ASSESSMENT:\n  {res.risk_assessment}\n")
    print(f"RECOMMENDED ACTION:\n  {res.recommended_action}\n")
    print(f"TRADEOFF ANALYSIS:\n  {res.tradeoff_analysis}\n")


def run_scenario_2_low_risk():
    print("\n" + "=" * 80)
    print("SCENARIO 2: LOW RISK CONJUNCTION (Pc < 1e-4 — MONITOR ONLY)")
    print("=" * 80)

    req = AIAdvisorRequest(
        conjunction=ConjunctionContext(
            primary_name="ENVISAT",
            secondary_name="FENGYUN 1C DEBRIS",
            tca_iso="2026-08-25T14:30:00Z",
            miss_distance_m=4250.0,
            pre_burn_pc=1.20e-6,
            relative_speed_km_s=11.2,
            primary_alt_km=790.0,
            hard_body_radius_m=14.5,
        ),
        maneuvers=[
            ManeuverOption(
                delta_v_cm_s=-2.0,
                lead_time_minutes=40.0,
                post_burn_miss_distance_m=5800.0,
                post_burn_pc=1.0e-8,
                risk_reduction_pct=99.2,
                fuel_consumed_kg=0.038,
                recommended=False,
            )
        ],
        query_type="recommendation",
    )

    res = get_ai_advice(req)
    print(f"Fallback Mode (Offline Rule-Based): {res.is_fallback}")
    print(f"EXECUTIVE SUMMARY:\n  {res.executive_summary}\n")
    print(f"RECOMMENDED ACTION:\n  {res.recommended_action}\n")


def run_scenario_3_tradeoff():
    print("\n" + "=" * 80)
    print("SCENARIO 3: TRADEOFF EVALUATION (MULTIPLE BURN OPTIONS)")
    print("=" * 80)

    req = AIAdvisorRequest(
        conjunction=ConjunctionContext(
            primary_name="ENVISAT",
            secondary_name="COSMOS 2221 DEBRIS",
            tca_iso="2026-09-01T08:00:00Z",
            miss_distance_m=85.0,
            pre_burn_pc=4.50e-4,
            relative_speed_km_s=10.5,
            primary_alt_km=790.0,
            hard_body_radius_m=14.5,
        ),
        maneuvers=[
            ManeuverOption(
                delta_v_cm_s=-1.0,
                lead_time_minutes=30.0,
                post_burn_miss_distance_m=320.0,
                post_burn_pc=2.1e-5,
                risk_reduction_pct=95.3,
                fuel_consumed_kg=0.019,
                recommended=True,
            ),
            ManeuverOption(
                delta_v_cm_s=-4.0,
                lead_time_minutes=50.0,
                post_burn_miss_distance_m=1240.5,
                post_burn_pc=3.2e-7,
                risk_reduction_pct=99.9,
                fuel_consumed_kg=0.076,
                recommended=True,
            ),
            ManeuverOption(
                delta_v_cm_s=-8.0,
                lead_time_minutes=60.0,
                post_burn_miss_distance_m=2450.0,
                post_burn_pc=1.1e-8,
                risk_reduction_pct=99.99,
                fuel_consumed_kg=0.152,
                recommended=True,
            ),
        ],
        query_type="tradeoff",
    )

    res = get_ai_advice(req)
    print(f"Fallback Mode (Offline Rule-Based): {res.is_fallback}")
    print(f"RECOMMENDED ACTION:\n  {res.recommended_action}\n")
    print(f"TRADEOFF ANALYSIS:\n  {res.tradeoff_analysis}\n")


if __name__ == "__main__":
    run_scenario_1_high_risk()
    run_scenario_2_low_risk()
    run_scenario_3_tradeoff()
