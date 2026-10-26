# backend/ai/

Gemini explanation/recommendation layer (provider decision: CLAUDE.md §2).

Only consumes physics output as structured JSON (Pc, miss distance, covariance
summary, maneuver options). Never computes, estimates, or alters a physics number.

Modules:
- schema.py   — pydantic input/output contracts for the AI layer
- prompts.py  — versioned prompt templates (explanation / tradeoff / recommendation)
- advisor.py  — Gemini integration (`GEMINI_API_KEY`; models tried in order: `gemini-3.5-flash`, then `gemini-flash-lite-latest`, then `gemini-3.5-flash-lite`,
                or the comma-separated `GEMINI_MODEL`) plus the deterministic rule-based fallback used when the
                key is missing or the call fails. The response says which one answered (`is_fallback`).
