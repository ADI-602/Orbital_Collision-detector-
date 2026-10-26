"""
test_ai_advisor.py — Unit tests for Google Gemini AI Decision Support Advisor and fallback module.
"""

from unittest.mock import MagicMock, patch
import pytest

from backend.ai.advisor import generate_fallback_advice, get_ai_advice
from backend.ai.prompts import build_advisor_prompt
from backend.ai.schema import AIAdvisorRequest, AIAdvisorResponse, ConjunctionContext, ManeuverOption


@pytest.fixture
def sample_request() -> AIAdvisorRequest:
    return AIAdvisorRequest(
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


def test_build_advisor_prompt(sample_request):
    prompt = build_advisor_prompt(sample_request)
    assert "ENVISAT" in prompt
    assert "ZENITH-2 DEBRIS" in prompt
    assert "1.40e-04" in prompt
    assert "-4.0 cm/s" in prompt


def test_generate_fallback_advice_high_risk(sample_request):
    advice = generate_fallback_advice(sample_request)
    assert isinstance(advice, AIAdvisorResponse)
    assert advice.is_fallback is True
    assert "HIGH RISK CONJUNCTION" in advice.executive_summary
    assert "1.40e-04" in advice.executive_summary
    assert advice.key_metrics["pre_burn_pc"] == 1.40e-4
    assert advice.key_metrics["maneuver_required"] is True


def test_generate_fallback_advice_low_risk(sample_request):
    sample_request.conjunction.pre_burn_pc = 1.0e-6
    advice = generate_fallback_advice(sample_request)
    assert advice.is_fallback is True
    assert "MONITOR ONLY" in advice.executive_summary
    assert advice.key_metrics["maneuver_required"] is False


def test_get_ai_advice_without_gemini_api_key(sample_request, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    advice = get_ai_advice(sample_request)
    assert advice.is_fallback is True
    assert "HIGH RISK CONJUNCTION" in advice.executive_summary


def test_get_ai_advice_with_mock_gemini_api(sample_request, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-gemini-key")

    mock_json = """{
        "executive_summary": "High risk detected. Recommend retrograde maneuver.",
        "risk_assessment": "Pc of 1.40e-4 exceeds threshold.",
        "recommended_action": "Execute -4.0 cm/s burn.",
        "tradeoff_analysis": "Uses 0.076 kg hydrazine.",
        "key_metrics": {"pre_burn_pc": 1.40e-4}
    }"""

    mock_response = MagicMock()
    mock_response.text = mock_json

    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = mock_response

    with patch("google.genai.Client", return_value=mock_client):
        advice = get_ai_advice(sample_request)
        assert advice.is_fallback is False
        assert advice.executive_summary == "High risk detected. Recommend retrograde maneuver."
        assert advice.recommended_action == "Execute -4.0 cm/s burn."


def test_get_ai_advice_tries_the_next_model_when_one_is_overloaded(sample_request, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-gemini-key")
    monkeypatch.setenv("GEMINI_MODEL", "model-a, model-b")

    good = MagicMock()
    good.text = '{"executive_summary": "From model b.", "key_metrics": {}}'
    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = [RuntimeError("503 UNAVAILABLE"), good]

    with patch("google.genai.Client", return_value=mock_client):
        advice = get_ai_advice(sample_request)

    assert advice.is_fallback is False
    assert advice.executive_summary == "From model b."
    tried = [c.kwargs["model"] for c in mock_client.models.generate_content.call_args_list]
    assert tried == ["model-a", "model-b"]


def test_get_ai_advice_falls_back_when_every_model_fails(sample_request, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-gemini-key")
    monkeypatch.setenv("GEMINI_MODEL", "model-a,model-b")

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = RuntimeError("503 UNAVAILABLE")

    with patch("google.genai.Client", return_value=mock_client):
        advice = get_ai_advice(sample_request)

    assert advice.is_fallback is True
    assert mock_client.models.generate_content.call_count == 2
