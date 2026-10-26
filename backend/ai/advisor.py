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

# Models tried in order until one answers. Capacity is per model and it moves:
# on 2026-10-27 gemini-3.1-flash-lite returned 503 "high demand" on every call,
# and gemini-3.5-flash answered in ~2 s and then returned 503 minutes later,
# while gemini-flash-lite-latest and gemini-3.5-flash-lite answered. One pinned
# model makes the live demo depend on one model's load. gemini-2.5-* is retired
# for new keys. GEMINI_MODEL (comma-separated) replaces this list.
_DEFAULT_MODELS = ("gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite")

# Per-attempt limit, so three attempts stay inside the frontend's 60 s budget
# (frontend/src/api/ai.js ADVISE_TIMEOUT_MS). An overloaded model usually
# answers 503 in about a second; this bounds the one that hangs instead.
_ATTEMPT_TIMEOUT_MS = 15_000


def _model_chain() -> list:
    """The models to try, in order: GEMINI_MODEL if set, else the defaults."""
    raw = os.environ.get("GEMINI_MODEL", "")
    models = [m.strip() for m in raw.split(",") if m.strip()]
    return models or list(_DEFAULT_MODELS)


def _parse_advice(text: str) -> AIAdvisorResponse:
    """The model's JSON as a response; raises if it is not JSON."""
    content_text = text.strip()
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

    Tries each model in _model_chain() in turn; the first valid answer wins. Falls
    back to the offline rule-based advice if GEMINI_API_KEY is missing or every
    model fails — never to a guess.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.info("get_ai_advice: GEMINI_API_KEY not set. Using deterministic fallback advisor.")
        return generate_fallback_advice(request)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=_ATTEMPT_TIMEOUT_MS),
        )
        user_prompt = build_advisor_prompt(request)
        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT_V1,
            response_mime_type="application/json",
            temperature=0.2,
        )
    except Exception as exc:
        logger.warning("get_ai_advice: Gemini client could not start (%s). Falling back to offline advisor.", exc)
        return generate_fallback_advice(request)

    for model in _model_chain():
        try:
            response = client.models.generate_content(
                model=model,
                contents=user_prompt,
                config=config,
            )
            advice = _parse_advice(response.text)
            logger.info("get_ai_advice: answered by %s", model)
            return advice
        except Exception as exc:
            logger.warning("get_ai_advice: %s failed (%s); trying the next model.", model, exc)

    logger.warning("get_ai_advice: every Gemini model failed. Falling back to offline advisor.")
    return generate_fallback_advice(request)
