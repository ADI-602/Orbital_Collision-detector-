# backend/ai/

LLM explanation/recommendation layer — Google Gemini (`gemini-2.5-flash` via
`google-genai`); see advisor.py.

Only consumes physics output as structured JSON (Pc, miss distance, covariance
summary, maneuver options). Never computes, estimates, or alters a physics number.

Modules:
- schema.py   — pydantic input/output contracts for the AI layer
- prompts.py  — versioned prompt templates (explanation / tradeoff / recommendation)
- advisor.py  — Gemini API integration, with a deterministic rule-based fallback
