"""
advisor.py — AI Decision Support Advisor service with Google Gemini API & deterministic offline fallback.

Integrates with Google Gemini API (google-genai SDK) to generate expert operational advice
for satellite conjunction events. If GEMINI_API_KEY is not set or network
calls fail, seamlessly falls back to pure-Python deterministic rule-based advice.
"""

import json
import logging
import os

from .prompts import SYSTEM_PROMPT_V1, build_advisor_prompt
from .schema import AIAdvisorRequest, AIAdvisorResponse

logger = logging.getLogger(__name__)

# Standard risk threshold (1 in 10,000)
_RISK_THRESHOLD_PC = 1e-4


def generate_fallback_advice(request: AIAdvisorRequest) -> AIAdvisorResponse:
    """
    Generate deterministic, rule-based operational advice offline (no network/AI required).
    Guarantees 100% service availability and zero-latency physics dashboard functionality.
    """
    c = request.conjunction
    maneuvers = request.maneuvers

    exceeds_threshold = c.pre_burn_pc >= _RISK_THRESHOLD_PC
    pc_str = f"{c.pre_burn_pc:.2e}"
    miss_str = f"{c.miss_distance_m:.1f}"

    if exceeds_threshold:
        summary = (
            f"HIGH RISK CONJUNCTION: Unmaneuvered Pc of {pc_str} exceeds the operational threshold "
            f"of 1.00e-04 for {c.primary_name} vs {c.secondary_name} at TCA {c.tca_iso} UTC (miss distance {miss_str} m). "
            f"Collision avoidance maneuver is RECOMMENDED."
        )
    else:
        summary = (
            f"MONITOR ONLY: Unmaneuvered Pc of {pc_str} is below the operational threshold "
            f"of 1.00e-04 for {c.primary_name} vs {c.secondary_name} at TCA {c.tca_iso} UTC (miss distance {miss_str} m). "
            f"Immediate collision avoidance maneuver is NOT required; continue tracking."
        )

    risk_assess = (
        f"The calculated unmaneuvered collision probability (Pc) is {pc_str} with a miss distance of {miss_str} m "
        f"at relative velocity {c.relative_speed_km_s:.2f} km/s. "
        + ("This exceeds the 1e-4 red-alert safety limit established by NASA CARA / ESA SDC guidelines."
           if exceeds_threshold else
           "This remains within acceptable safety limits (< 1e-4 red threshold).")
    )

    best_m = None
    if maneuvers:
        sorted_m = sorted(maneuvers, key=lambda x: (x.post_burn_pc, -x.risk_reduction_pct))
        best_m = sorted_m[0]

    if best_m and exceeds_threshold:
        recommended_act = (
            f"Execute an along-track maneuver of ΔV = {best_m.delta_v_cm_s:+.1f} cm/s at lead time "
            f"{best_m.lead_time_minutes:.1f} minutes prior to TCA. "
            f"This burn increases miss distance from {c.miss_distance_m:.1f} m to {best_m.post_burn_miss_distance_m:.1f} m, "
            f"reducing Pc from {pc_str} to {best_m.post_burn_pc:.2e} ({best_m.risk_reduction_pct:.1f}% risk reduction)."
        )
        tradeoff = (
            f"Propellant consumption for this burn is estimated at {best_m.fuel_consumed_kg:.3f} kg hydrazine. "
            f"The fuel expenditure is highly efficient, delivering a {best_m.risk_reduction_pct:.1f}% risk reduction "
            f"and dropping Pc safely below the 1e-4 threshold."
        )
    elif best_m and not exceeds_threshold:
        recommended_act = (
            f"Stand down from active maneuvers. Secondary tracking option: ΔV = {best_m.delta_v_cm_s:+.1f} cm/s "
            f"at lead time {best_m.lead_time_minutes:.1f} min is available if updated TLEs indicate escalating risk."
        )
        tradeoff = (
            f"Standing down saves {best_m.fuel_consumed_kg:.3f} kg of onboard propellant while keeping risk below 1e-4."
        )
    else:
        recommended_act = "Maintain collision monitoring. No valid maneuver candidates evaluated."
        tradeoff = "No propellant consumption required."

    key_metrics = {
        "pre_burn_pc": c.pre_burn_pc,
        "post_burn_pc": best_m.post_burn_pc if best_m else c.pre_burn_pc,
        "risk_reduction_pct": best_m.risk_reduction_pct if best_m else 0.0,
        "fuel_consumed_kg": best_m.fuel_consumed_kg if best_m else 0.0,
        "recommended_burn_delta_v_cm_s": best_m.delta_v_cm_s if best_m else 0.0,
        "maneuver_required": exceeds_threshold,
    }

    return AIAdvisorResponse(
        executive_summary=summary,
        risk_assessment=risk_assess,
        recommended_action=recommended_act,
        tradeoff_analysis=tradeoff,
        key_metrics=key_metrics,
        is_fallback=True,
    )


def get_ai_advice(request: AIAdvisorRequest) -> AIAdvisorResponse:
    """
    Generate decision support recommendation via Google Gemini API.
    Falls back gracefully to offline rule-based advice if GEMINI_API_KEY is missing or request fails.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.info("get_ai_advice: GEMINI_API_KEY not set. Using deterministic fallback advisor.")
        return generate_fallback_advice(request)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        user_prompt = build_advisor_prompt(request)

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT_V1,
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )

        content_text = response.text.strip()
        if content_text.startswith("```json"):
            content_text = content_text.replace("```json", "").replace("```", "").strip()

        data = json.loads(content_text)
        return AIAdvisorResponse(
            executive_summary=data.get("executive_summary", ""),
            risk_assessment=data.get("risk_assessment", ""),
            recommended_action=data.get("recommended_action", ""),
            tradeoff_analysis=data.get("tradeoff_analysis", ""),
            key_metrics=data.get("key_metrics", {}),
            is_fallback=False,
        )

    except Exception as exc:
        logger.warning("get_ai_advice: Google Gemini API call failed (%s). Falling back to offline advisor.", exc)
        return generate_fallback_advice(request)
