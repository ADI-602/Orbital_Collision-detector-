"""
schema.py — Pydantic models for AI Decision Support Advisor.

Defines structured input context payloads and output response schemas for
the Space Domain Awareness (SDA) Flight Dynamics Officer (FDO) advisor.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ConjunctionContext(BaseModel):
    """Context parameters of an identified orbital conjunction event."""
    primary_name: str = Field(..., description="Name of primary satellite (e.g. ENVISAT)")
    secondary_name: str = Field(..., description="Name of secondary object (e.g. COSMOS 2221 DEBRIS)")
    tca_iso: str = Field(..., description="Time of Closest Approach (TCA) in ISO 8601 UTC format")
    miss_distance_m: float = Field(..., description="Unmaneuvered miss distance at TCA [meters]")
    pre_burn_pc: float = Field(..., description="Unmaneuvered 2D collision probability (Pc)")
    relative_speed_km_s: float = Field(default=9.8, description="Relative velocity at encounter [km/s]")
    primary_alt_km: float = Field(default=790.0, description="Primary satellite altitude [km]")
    hard_body_radius_m: float = Field(default=14.5, description="Combined hard-body radius [meters]")


class ManeuverOption(BaseModel):
    """Pre-calculated burn option parameters derived from Hill-CW equations."""
    delta_v_cm_s: float = Field(..., description="Along-track delta-V magnitude [cm/s] (negative = braking)")
    lead_time_minutes: float = Field(..., description="Burn lead time before TCA [minutes]")
    post_burn_miss_distance_m: float = Field(..., description="Miss distance after burn [meters]")
    post_burn_pc: float = Field(..., description="Collision probability after burn")
    risk_reduction_pct: float = Field(..., description="Percentage reduction in collision probability")
    fuel_consumed_kg: float = Field(..., description="Propellant mass consumed [kg]")
    recommended: bool = Field(..., description="Whether this maneuver satisfies risk reduction criteria")


class AIAdvisorRequest(BaseModel):
    """Input payload submitted to the AI Decision Support Advisor."""
    conjunction: ConjunctionContext
    maneuvers: List[ManeuverOption] = Field(default_factory=list)
    query_type: str = Field(
        default="recommendation",
        description="Type of analysis requested: 'explanation', 'tradeoff', or 'recommendation'"
    )


class AIAdvisorResponse(BaseModel):
    """Structured response output from the AI Decision Support Advisor."""
    executive_summary: str = Field(..., description="Concise 2-3 sentence overview of conjunction risk and recommended action")
    risk_assessment: str = Field(..., description="Detailed assessment comparing pre-burn Pc against standard 1e-4 threshold")
    recommended_action: str = Field(..., description="Clear recommendation on whether to maneuver, which option to select, or stand down")
    tradeoff_analysis: str = Field(..., description="Analysis of risk reduction versus propellant consumption and operational constraints")
    key_metrics: Dict[str, Any] = Field(default_factory=dict, description="Key numerical metrics formatted for UI display cards")
    is_fallback: bool = Field(default=False, description="True if response was generated via deterministic offline fallback")
