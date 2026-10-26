# Orbital Risk Advisor — Backend

Python orbital mechanics pipeline + FastAPI + Gemini AI layer (with an offline rule-based fallback).

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
uvicorn backend.api.main:app --port 8000
```

Secrets are read from `.env` at the repo root (see `.env.example`): `GEMINI_API_KEY` for the AI layer,
`SPACETRACK_USERNAME` / `SPACETRACK_PASSWORD` for the live tracked set. Neither is needed for the
physics endpoints. Starting the server begins scheduled screening of the tracked set; restart it once,
not repeatedly, because each start logs in to Space-Track (its rate limits are hard).

## Running tests

```bash
# With venv active, from repo root
python -m pytest tests/ -q
```

Use `python -m pytest`, not the `pytest` shim: the shim does not put the repo root on `sys.path`,
so `import backend` fails. The suite never reaches Space-Track or any LLM.

## Smoke test (Phase 1 gate)

Fetches a live ISS TLE from CelesTrak and propagates it — confirms the toolchain
works end-to-end:

```bash
python scripts/smoke_test.py
```

## Structure

- `backend/physics/` — deterministic orbital-mechanics pipeline (no LLM calls)
- `backend/ai/`      — Gemini explanation/recommendation layer (narrates the pipeline's figures; computes none)
- `backend/api/`     — FastAPI routes tying physics + AI together

See `docs/project-doc.md` for the full technical spec, `CLAUDE.md` for the project's coding
guardrails, and `docs/api_contract.md` for every endpoint.
