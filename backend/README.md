# Orbital Risk Advisor — Backend

Python orbital mechanics pipeline + FastAPI + Claude AI layer.

## Setup

```bash
# From repo root
python -m venv backend/.venv

# Activate (Windows)
backend\.venv\Scripts\activate

# Activate (macOS/Linux)
source backend/.venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt
```

## Running the API server

```bash
# With venv active, from repo root
uvicorn backend.api.main:app --reload
```

## Running tests

```bash
# With venv active, from repo root
pytest tests/
```

## Smoke test (Phase 1 gate)

Fetches a live ISS TLE from CelesTrak and propagates it — confirms the toolchain
works end-to-end:

```bash
python scripts/smoke_test.py
```

## Structure

- `backend/physics/` — deterministic orbital-mechanics pipeline (no LLM calls)
- `backend/ai/`      — LLM explanation/recommendation layer (Google Gemini)
- `backend/api/`     — FastAPI routes tying physics + AI together

See `docs/project-doc.md` for the full technical spec and `bob.md` for project
coding guardrails.
