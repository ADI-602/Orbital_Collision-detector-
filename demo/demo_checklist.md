# Demo checklist — whole demo, start to finish

The pre-flight and stage order for the full demo on a 16" laptop, presented
full screen. The Envisat section has its own detailed script and Q&A in
[`envisat-runbook.md`](envisat-runbook.md); this file is everything around it.

Written 2026-10-26 against the build at that date. Every number in §6 was
measured that day; re-measure after any change to `backend/physics/`.

---

## 1. The day before

- [ ] **Tests, all green.** From the repo root:

      ```
      backend\.venv\Scripts\python -m pytest -q
      cd frontend && npm test && npm run build
      ```

      On 2026-10-26: 139 backend and 267 frontend tests passed. A failing physics test is a stop-everything bug (CLAUDE.md §1.2), not
      something to demo around.
- [ ] **Display:** Windows display at 1920×1200, scaling 125%, Chrome. The
      layout was measured at 1536×960 CSS px — that screen, full screen (F11).
      With the browser toolbar showing (1536×830) it still works, but the burn
      diagram and the last prediction row need a short scroll inside their
      panels.
- [ ] **AI key:** `GEMINI_API_KEY` set in `.env` at the repo root. One
      "Explain this event" should come back with the **AI: LIVE** chip.
- [ ] **Record the fallback video** (needs you — it cannot be recorded from
      here). Windows Game Bar (Win+Alt+R) or OBS, full screen, following §3.
      Save it as `demo/fallback/recorded_fallback.mp4`; `*.mp4` there is
      gitignored, so keep the copy you will use on a USB stick or Drive.
      Re-record if any physics change moves a number in §6.

## 2. Fifteen minutes before

- [ ] **Start the backend fresh** — a stale process serves old physics and
      still answers `/health` (see `envisat-runbook.md` §2):

      ```
      backend\.venv\Scripts\uvicorn backend.api.main:app --port 8000
      ```

      Restart it once, not repeatedly: each start costs one Space-Track login
      and three queries, and Space-Track's limits are hard (CLAUDE.md §2).
- [ ] **Watch the feed land.** CelesTrak often times out from this network;
      the server then falls back to Space-Track, which took about a minute on
      2026-10-26. The log line to wait for:
      `tracked_set: 698 objects ... via space-track` (or `via celestrak`).
- [ ] **Start the frontend:** `npm run dev` in `frontend/`, open
      <http://localhost:5173>, press **F11**, click **Reset layout** in the
      header.
- [ ] **Reload once the feed has landed.** The page reads the tracked set when
      it loads; if it loaded during the fallback it shows the offline set.
      Tracking should read **Server (live feed)** and ~700 objects.
- [ ] **Header badge reads "Validated · Alfano · Envisat"** (green). If it says
      **Validation failed**, stop: the physics has regressed. Click it to see
      which check, then run `pytest`.
- [ ] **The event list shows a schedule line.** "Pass running m:ss" until the
      first pass completes (79–83 s on 2026-10-26), then "Next pass in mm:ss".
      "Restored after restart" means it is showing the pass saved before this
      start, with its own age, until the fresh one lands — that is expected.
- [ ] **Warm the AI once on each tab** with "Explain this event". Repeat asks
      about the same figures are then instant ("Cached · HH:MM UTC"). The cache
      is per page load: **do not reload after warming.**
- [ ] **Replay tab:** all four prediction rows computed, all RED; press **B**
      and **T** once to confirm the clock jumps.

## 3. Stage order

| # | Tab | Do | Point at |
|---|---|---|---|
| 1 | Console | Nothing — it opens on the most serious live event | The globe, the selected pair's two orbit rings, the RED badge and Pc |
| 2 | Console | Click the **Validated** badge, then Escape | "Real physics, checked against published answers every time it starts" |
| 3 | Console | Filter chips: switch off GREEN and co-orbital | The schedule line: screening runs on a timer, no AI involved |
| 4 | Console | **Show on globe** | The "Closest approach (TCA)" marker where the two rings cross |
| 5 | Console | **Explain this event** | The AI: LIVE chip; it narrates the figures, computes none |
| 6 | Replay | Press **B** (burn), then **Compare all three** | The three-burn table; the AI is asked automatically and weighs all three |
| 7 | Replay | Press **T** (TCA) | The to-scale encounter diagram, TCA computed vs published |
| 8 | Replay | The bottom table | Four predictions, all above ESA's 1e-4, inside the tested range |

For what to say in 6–8, and what not to say, follow `envisat-runbook.md` §1
and §3. In particular: the risk does **not** climb day by day.

Keys on the replay tab: **Space** pause · **R** restart · **← →** one minute ·
**B** burn · **T** TCA.

## 4. If something goes wrong

| Symptom | Meaning | Do |
|---|---|---|
| Red "Backend unreachable" banner | API process down | Restart the backend (§2). The globe keeps running meanwhile. |
| AI chip says **OFFLINE ADVISOR** | Gemini did not answer; the rule-based advisor did | Carry on — same figures, templated wording. Say so. |
| Console opens on the Envisat case | No live RED/YELLOW in the current pass | Expected. It is tagged INJECTED · 2004 REPLAY. |
| Tracking says "offline set" | Live feed had not landed when the page loaded | Reload the page. |
| Badge says **Validation failed** | A known-answer check failed | Do not demo the numbers. Switch to the recorded video. |
| Anything else | — | Switch to the recorded video. |

## 5. Known limits — say them before a judge does

- Screening covers ~700 tracked objects, not the full ~40,000 catalogue, and
  each pass refines the closest 300 candidate pairs (the list says when a pass
  was capped).
- Every Pc uses one hard-body radius, 14.5 m — Envisat's validation case — for
  every pair (shown in each event's details), not a size per object.
- Burns are instantaneous along-track ΔV (Clohessy-Wiltshire), not thruster
  physics. Propellant assumes Envisat's 8,200 kg mass for every event.
- Our Envisat Pc runs higher than ESA's published range because we use public
  TLEs (~556 m along-track uncertainty) where ESA had Envisat's own orbit
  determination (~3 m). Same order of magnitude, same decision.

## 6. Numbers as measured, 2026-10-26

| Envisat prediction | Miss | Pc |
|---|---|---|
| Oct 19 | 329 m | 2.74e-4 |
| Oct 20 | 234 m | 1.11e-3 |
| Oct 21 | 152 m | 1.93e-3 |
| Oct 22 | 269 m | 6.59e-4 |

TCA computed 05:10:37Z vs published 05:10:35Z. Alfano: Pc 0.10034.

| Burn (50 min before TCA) | Miss after | Pc after | Risk ↓ | Propellant |
|---|---|---|---|---|
| −2.0 cm/s | 401 m | 2.23e-4 | 66.2% | 0.076 kg |
| −4.0 cm/s (ESA's) | 570 m | 5.69e-5 | 91.4% | 0.152 kg |
| −8.0 cm/s | 938 m | 1.60e-6 | 99.8% | 0.304 kg |

AI answer time: 6–20 s live, ~0.1 s cached.
