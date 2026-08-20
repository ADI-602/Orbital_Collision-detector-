"""
backend/ai package initialization.
"""

from .advisor import get_ai_advice, generate_fallback_advice
from .prompts import SYSTEM_PROMPT_V1, build_advisor_prompt
from .schema import AIAdvisorRequest, AIAdvisorResponse, ConjunctionContext, ManeuverOption

__all__ = [
    "get_ai_advice",
    "generate_fallback_advice",
    "SYSTEM_PROMPT_V1",
    "build_advisor_prompt",
    "ConjunctionContext",
    "ManeuverOption",
    "AIAdvisorRequest",
    "AIAdvisorResponse",
]
