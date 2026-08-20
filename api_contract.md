# Orbital Risk Advisor — API Contract & Backend Pipeline Guide

This document defines the complete interface contract between the **Python Physics/AI Backend** and the **React/Cesium Frontend**, as well as instructions for running the backend pipeline.

---

## 1. Backend & Frontend Environment Setup

| Component | Technology | Default URL / Port |
|-----------|------------|-------------------|
| **Backend API** | FastAPI + Uvicorn (Python 3.14) | `http://localhost:8000` |
| **Frontend UI** | React + Vite + CesiumJS | `http://localhost:5173` |

### CORS Configuration in `backend/api/main.py`

FastAPI includes `CORSMiddleware` to allow cross-origin requests from the React dev server:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Orbital Risk Advisor API",
    description="Physics pipeline & AI decision-support endpoints",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite default port
        "http://localhost:3000",  # React default port
        "http://127.0.0.1:5173",
        "*",                      # Open access for hackathon demo
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 2. Standard Data Conventions

- **Timestamps**: ISO 8601 UTC string format: `YYYY-MM-DDTHH:MM:SSZ` (e.g., `2004-10-22T05:10:37Z`).
- **Positions**:
  - **ECEF coordinates**: `[x_km, y_km, z_km]` array (used by Cesium 3D Globe for rendering).
  - **Geodetic coordinates**: `latitude_deg` [-90, +90], `longitude_deg` [-180, +180], `altitude_km`.
- **Units**:
  - Distances: Kilometers (`km`) or Meters (`m`) as explicitly labeled in field names.
  - Velocities: `km/s` or `cm/s` (for maneuvers).
  - Probabilities: Float in `[0.0, 1.0]`.

---

## 3. Endpoints Specification

### 3.1 Live Satellite Trajectories
- **`GET /api/satellites/live`**
- **Query Params**: `group` (optional, default `active`, options: `active`, `sso_debris`, `brightest`)
- **Response `200 OK`**:
```json
{
  "timestamp_utc": "2026-08-20T12:00:00Z",
  "count": 2,
  "satellites": [
    {
      "norad_id": 27386,
      "name": "ENVISAT",
      "latitude_deg": 42.15,
      "longitude_deg": -71.06,
      "altitude_km": 782.4,
      "position_ecef_km": [4210.12, 3105.45, -1350.88],
      "velocity_ecef_km_s": [-2.14, 4.31, 5.82]
    },
    {
      "norad_id": 22437,
      "name": "SL-16 DEB (ZENITH-2)",
      "latitude_deg": 41.98,
      "longitude_deg": -70.92,
      "altitude_km": 780.1,
      "position_ecef_km": [4208.75, 3108.12, -1348.20],
      "velocity_ecef_km_s": [-5.42, -1.82, 4.91]
    }
  ]
}
```

---

### 3.2 Conjunction Risk Screening
- **`GET /api/conjunctions/screen`**
- **Query Params**: `norad_id` (default `27386`), `threshold_km` (default `5.0`), `window_hours` (default `72`)
- **Response `200 OK`**:
```json
{
  "primary_norad_id": 27386,
  "primary_name": "ENVISAT",
  "conjunctions_count": 1,
  "candidates": [
    {
      "event_id": "conj-27386-22437",
      "secondary_norad_id": 22437,
      "secondary_name": "SL-16 DEB (ZENITH-2)",
      "tca_utc": "2004-10-22T05:10:37Z",
      "miss_distance_m": 233.9,
      "relative_velocity_km_s": 14.78,
      "collision_probability": 0.00111,
      "risk_level": "CRITICAL",
      "primary_eci_km": [4210.12, 3105.45, -1350.88],
      "secondary_eci_km": [4210.25, 3105.32, -1350.75]
    }
  ]
}
```

---

### 3.3 Maneuver Simulation (Collision Avoidance)
- **`POST /api/maneuver/simulate`**
- **Request Body**:
```json
{
  "event_id": "conj-27386-22437",
  "burn_direction": "RETROGRADE",
  "delta_v_cm_s": 4.0,
  "lead_time_minutes": 50
}
```
- **Response `200 OK`**:
```json
{
  "event_id": "conj-27386-22437",
  "pre_burn_pc": 0.00111,
  "post_burn_pc": 0.00002,
  "risk_reduction_pct": 98.2,
  "fuel_consumed_kg": 0.16,
  "post_burn_miss_distance_m": 2450.0,
  "maneuver_recommended": true
}
```

---

### 3.4 Historical Envisat 2004 Replay (Demo Mode)
- **`GET /api/replay/envisat`**
- **Response `200 OK`**:
```json
{
  "event": "Envisat vs Zenith-2 Fragment (October 2004)",
  "tca_utc": "2004-10-22T05:10:37Z",
  "timeline": [
    { "day_label": "Oct 19 (T-3d)", "prediction_date": "2004-10-19", "miss_distance_m": 328.2, "collision_probability": 0.000274, "action": "FLAGGED" },
    { "day_label": "Oct 20 (T-2d)", "prediction_date": "2004-10-20", "miss_distance_m": 233.9, "collision_probability": 0.001110, "action": "WARNING" },
    { "day_label": "Oct 21 (T-1d)", "prediction_date": "2004-10-21", "miss_distance_m": 151.5, "collision_probability": 0.001930, "action": "MANEUVER PLANNED" },
    { "day_label": "Oct 22 (T-0d)", "prediction_date": "2004-10-22", "miss_distance_m": 268.0, "collision_probability": 0.000659, "action": "EXECUTED (-4.0 cm/s)" }
  ]
}
```

---

### 3.5 AI Plain-English Narration
- **`POST /api/ai/narrate`**
- **Request Body**:
```json
{
  "event_id": "conj-27386-22437",
  "include_maneuver": true,
  "delta_v_cm_s": 4.0
}
```
- **Response `200 OK`**:
```json
{
  "event_id": "conj-27386-22437",
  "summary": "High-risk close approach detected between ENVISAT and space debris.",
  "explanation": "On October 22 at 05:10 UTC, ENVISAT will pass within 234 meters of a Zenith-2 debris fragment at a relative speed of 14.8 km/s. The calculated collision probability is 1 in 900, crossing the critical threshold.",
  "tradeoff_analysis": "Executing a small 4.0 cm/s braking burn 50 minutes before close approach reduces collision risk by 98% while consuming only 0.16 kg of propellant.",
  "recommendation": "Execute retrograde burn at 04:20 UTC. Apply a restituting burn of +3.9 cm/s post-conjunction to preserve ground-track orbit.",
  "ai_status": "ONLINE"
}
```

---

## 4. Error & Fallback Handling Contract

If the AI call fails (network timeout, invalid API key), the API responds with `200 OK` containing a structured physics fallback so the UI never crashes:

```json
{
  "event_id": "conj-27386-22437",
  "summary": "Collision risk: 1 in 900 (Miss distance: 233.9 m).",
  "explanation": "Physics pipeline calculation complete. AI explanation unavailable (fallback mode active).",
  "tradeoff_analysis": "4.0 cm/s burn reduces risk to 1 in 50,000.",
  "recommendation": "Execute retrograde burn per standard operating procedure.",
  "ai_status": "FALLBACK_PHYSICS_ONLY"
}
```

---

## 5. How to Run the Backend Pipeline

### Step 1: Environment Variables
Create a `.env` file in the root folder with real credentials:
```ini
ANTHROPIC_API_KEY=sk-ant-your-key-here
SPACETRACK_USERNAME=your-email@example.com
SPACETRACK_PASSWORD=your-password-here
CESIUM_ION_TOKEN=your-cesium-token-here
```

### Step 2: Launch Backend API Server
From the project root:
```powershell
backend\.venv\Scripts\uvicorn backend.api.main:app --reload --port 8000
```
- Server starts at `http://localhost:8000`
- Interactive Swagger UI docs: **`http://localhost:8000/docs`**

### Step 3: Run Automated Test Pipeline
To verify all 34 physics and integration tests:
```powershell
backend\.venv\Scripts\pytest tests/ -v
```
