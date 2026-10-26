# Envisat replay — demo runbook

Section runbook for the **Envisat replay** tab: what to check before going on,
what to say, what to point at, and what to answer. Roughly 70 seconds of stage
time.

This covers one section of the demo. The whole-demo pre-flight and stage
order are in [`demo_checklist.md`](demo_checklist.md).

Written 2026-08-31, against build-order step 5. Re-check the numbers in
[§6](#6-the-numbers-as-verified) after any change to `backend/physics/`.

---

## 1. ⚠️ Read this first: the pitch script's narrative is wrong here

`docs/pitch-script.md` Part 3 says the demo shows *"the risk number climb —
exactly like it did in real life — until it crosses the danger threshold, just
like it really did."*

**Do not say that.** It was written before the numbers existed, and it does not
survive contact with them. Four mismatches:

| Script says | Reality |
|---|---|
| Risk climbs across the four days | Pc goes 2.74e-4 → 1.11e-3 → 1.93e-3 → **6.59e-4**. Up, up, then down. Miss distance likewise: 329 → 234 → 152 → **269 m**. |
| Risk crosses the danger threshold | It is already **2.7× over** ESA's 1e-4 acceptance level on day one. The paper says so directly: *"all of them exceeding the accepted level of Pc_acc ≤ 10⁻⁴."* |
| A countdown over four days | The built view counts **60 minutes** to TCA. The four days are a table, not a countdown. |
| AI explanation + recommendation appears | Built since (2026-10-05) and checked in a browser 2026-10-26: the advisor panel answers with **AI: LIVE**, and is asked automatically after a burn is simulated. It explains the pipeline's figures; it does not change them. |

`docs/pitch-script.md` is a source document and has deliberately not been
edited. Treat this section of the runbook as superseding its Part 3 for the
Envisat segment.

### Say this instead

> It was already dangerous three days out, and it stayed dangerous across four
> independent predictions. What improved between them was not the verdict — it
> was the precision.

That is a sharper operational point than the scripted one: an operator cannot
wait for the risk to *become* real, because it was real from the first look.

---

## 2. Pre-flight

Work top to bottom. Item 1 is the one that will actually ruin the demo.

- [ ] **Restart the backend fresh.** A stale process on `:8000` serves pre-fix
      physics and renders Envisat as **GREEN with `pc: 0`** — see
      `docs/frontend-implementation-plan.md` §11. A stale server answers
      `/health` perfectly well, so a health check does not catch this.

      ```
      backend\.venv\Scripts\uvicorn backend.api.main:app --port 8000
      ```

- [ ] `curl localhost:8000/health` → `{"status":"ok",...}`
- [ ] Start the frontend (`npm run dev` in `frontend/`) and load the console.
- [ ] **Open the Envisat replay tab once and confirm all four rows populate**
      with the values in [§6](#6-the-numbers-as-verified). If the headline is
      not `6.59e-4 / Critical`, you have a stale server — go back to item 1.
      Do not go on stage on an unverified screen.
- [ ] Switch back to **Live console**. That is the tab you present from.
- [ ] Confirm the globe is animating and the backend chip reads **Online**.

Note: switching tabs unmounts the inactive view, so returning to the replay
re-runs the four screening calls (~2.5 s). That pause is real computation and
is worth naming out loud rather than hiding.

---

## 3. The 70-second script

The view gives you a built-in timer: the countdown starts at **T-01:00:00** and
reaches zero **60 seconds** after the tab mounts. Use it to pace the section.

### Beat 1 — click the tab (~10 s)

While the four calls run:

> "This tab is 2004. Everything here is one real conjunction that ESA
> published — and the pause you just saw was four SGP4 scans and four
> collision-probability computations running now, not a lookup."

### Beat 2 — the right rail (~15 s)

> "Collision probability 6.59 × 10⁻⁴. Miss distance 269 metres. And this is the
> line to point a judge at: our pipeline computed closest approach at
> **05:10:37 UTC**. ESA published **05:10:35**. Two seconds apart, from public
> catalogue data."

### Beat 3 — the four-day table (~20 s)

> "Four consecutive predictions — element sets three days old down to same-day
> — each re-run through the same endpoint the live console uses. Every one is
> Critical. Not because risk climbed: it was already nearly three times over
> ESA's threshold three days out. What changed between predictions was
> precision, not the verdict."

### Beat 4 — volunteer the limitation (~10 s)

> "Our range is wider than the paper's, and we say so on screen rather than
> waiting to be asked. ESA had operational orbit determination on Envisat —
> about three metres of in-track uncertainty. We have a public TLE: five
> hundred and fifty-six. Same physics, coarser input."

Volunteering this before a judge finds it is the highest-value credibility move
in the whole section.

### Beat 5 — let the countdown land (~15 s)

> "That clock is running at sixty times real speed."

*(hits `T-00:00:00`; the two markers merge)*

> "At this scale you cannot see 269 metres — which is exactly why you need the
> number and not the picture."

**Running total:** 10 + 15 + 20 + 10 = 55 s, so Beat 5 begins at ~55 s and TCA
lands at 60 s.

---

## 4. Stage controls and hazards

| Situation | What to do |
|---|---|
| Running long | Hit **Pause**. The countdown and the globe freeze together. |
| Running short | Hit **Restart** — returns to `T-01:00:00` and buys another 60 s. |
| Backend goes down mid-section | The panel shows an explicit error and the globe keeps animating (it propagates in-browser). Say so plainly. **Never improvise a number.** |
| Judge asks to see it again | Restart, or switch tabs and back (re-runs the calls live, which is itself a good look). |

**Do not promise a visual near-miss.** At the default camera altitude
(24,000 km) 269 m is far below one pixel. The dots converge and merge, and that
is all. Beat 5 turns that into the point rather than a disappointment.

**Do not say "AI" anywhere in this section.** Nothing on the page is
AI-generated, the page states this, and that is the strength.

---

## 5. Judge Q&A

**"Did you tune anything to hit these numbers?"**
> No. Same endpoint as the live console, no special-casing anywhere in the
> pipeline, and the search window is stated on screen. The regression test's
> assertion range was fixed before these values were known.

**"Why is your Pc above the published range on two of the days?"**
> Covariance. We apply the SDC4 Table 1 TLE-class uncertainty to *both*
> objects, including Envisat — where ESA used its operational orbit
> determination. That is conservative: it biases Pc upward, which is the safe
> direction. `docs/validation-notes.md` §4.3.

**"Why doesn't the risk converge as you get closer to the event?"**
> TLE accuracy is not monotonic in element-set age, and the paper does not
> claim convergence either — it reports a range across all four predictions.
> That is exactly why we show four rows and not a trend line.

**"Is the AI computing any of this?"**
> Point at the sentence on screen: *"No AI is involved in any number on this
> page."*

**"What hard-body radius did you use?"**
> 14.5 m combined (`backend/api/main.py:224`).

**"What isn't built yet?"**
> The AI explanation panel and the maneuver simulation. Both are labelled
> pending regions rather than fake placeholders. Say it before a judge finds
> it.

**"What did ESA actually do?"**
> A −4.0 cm/s in-track braking burn at 04:20 UTC, 50 minutes before closest
> approach, which took Pc from ~5.5e-4 to ~2.0e-4; then a +3.9 cm/s restituting
> burn at 06:00 UTC to restore the ground-track repeat. That is quoted history,
> not something this app computed — reproducing it is build-order step 7.

---

## 6. The numbers, as verified

Computed through `POST /api/physics/screening`, window `2004-10-22T00:00:00Z`
+ 12 h, verified in headless Chrome against a live backend on 2026-08-31.

| Prediction | Lead | Miss distance | Pc | Threat |
|---|---|---|---|---|
| Oct 19 | T-3 d | 329 m | 2.74e-4 | Critical |
| Oct 20 | T-2 d | 234 m | 1.11e-3 | Critical |
| Oct 21 | T-1 d | 152 m | 1.93e-3 | Critical |
| Oct 22 | T-0 d | 269 m | 6.59e-4 | Critical |

Agrees with `docs/validation-notes.md` §4.4 (328.2 / 233.9 / 151.5 / 268.0 m)
to under a metre; the small difference is the search window, not the physics.

- **TCA computed:** `2004-10-22T05:10:37Z` — **published:** `05:10:35Z`
- **Relative speed:** 14.78 km/s
- **Published bands** (Klinkrad et al. 2005, ESA SDC4-paper49 §6):
  81–316 m, Pc 1.4e-4 – 5.5e-4
- **Bands the regression test asserts** (`tests/fixtures/envisat_tles.py:89-92`):
  100–1000 m, Pc 1e-4 – 2.5e-3 — wider because we run on public-catalog TLEs
- **Threat thresholds** (`backend/api/main.py:233`): RED ≥ 1e-4,
  YELLOW ≥ 1e-5, else GREEN. All four days are RED because all four clear 1e-4.

---

## 7. Replay clock reference

Defined in `frontend/src/lib/replay.js`.

| Property | Value |
|---|---|
| Window | TCA − 60 min → TCA + 10 min, looping |
| Speed | ×60 (one simulated minute per real second) |
| Loop length | 70 s wall clock |
| TCA reached at | 60 s after the tab mounts |
| Countdown target | the TCA **this pipeline** refined, not the published one |

The window deliberately opens before 04:20 UTC — the point at which ESA
committed to the burn — so the decision moment sits inside the replay rather
than already past when the view opens.
