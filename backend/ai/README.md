# backend/ai/

Claude API explanation/recommendation layer.

Only consumes physics output as structured JSON (Pc, miss distance, covariance
summary, maneuver options). Never computes, estimates, or alters a physics number.

Modules:
- schema.py   — pydantic input/output contracts for the AI layer
- prompts.py  — versioned prompt templates (explanation / tradeoff / recommendation)
- advisor.py  — Claude API integration
