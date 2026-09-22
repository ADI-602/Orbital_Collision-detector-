# Pre-demo checklist

Work top to bottom. Every step is either a command with an expected output or a
screen with an expected number — if something does not match, the fix is here
rather than improvised in front of judges.

**The one rule:** if a number on screen disagrees with this file, say so out
loud and keep going. The project's whole claim is that we did not fake the
science; visibly noticing a discrepancy is worth more than a clean run.

---

## T-1 day

- [ ] **Refresh the offline TLE snapshot** from a networked machine:
      `cd frontend && npm run refresh:tle`
      The committed snapshot is the console's last-resort fallback, and
      propagated positions drift as its epoch ages. **It is currently down to 2
      objects** (ISS ZARYA, CSS TIANHE) because two fabricated entries were
      removed — a refresh restores a realistic set. Be sparing: CelesTrak is
      free and unauthenticated, so do not loop this.
- [ ] **Full test suite, both halves.** From the repo root:
      `pytest` → **63 passed**
      `cd frontend && npm test` → **157 passed**
      A failing physics test is a stop-everything bug, not something to demo
      around.
- [ ] `cd frontend && npm run lint && npm run build` → clean, build succeeds.
- [ ] **Record the fallback video** (`demo/recorded_fallback.mp4`) against the
      current pipeline. Re-record if anything changed the demo numbers since
      the last take. It is gitignored — store it externally and make sure it is
      **on the presenting laptop's local disk**, not in a cloud folder that
      needs wifi to open.
- [ ] Decide who drives and who narrates, and confirm both have the repo
      running on their own machine.

## T-30 minutes

- [ ] **Backend up, from the REPO ROOT** (it imports `tests.fixtures`, so a
      different working directory breaks it):
      ```
      source backend/.venv/bin/activate      # Windows: backend\.venv\Scripts\activate
      python -m uvicorn backend.api.main:app --reload --port 8000
      ```
- [ ] **Probe it:** `cd frontend && npm run check:api`
      Expect: `All 2 checks passed.` with
      `/health` → `service="Orbital Risk Advisor API" version=1.0.0` and
      `/api/conjunctions/envisat` → `prediction_days=4 primary="ENVISAT"`.
- [ ] **Frontend up:** `cd frontend && npm run dev` → http://localhost:5173
- [ ] **Decide the AI story now, not on stage.** With `GEMINI_API_KEY` exported
      *into the uvicorn process*, the advisor badge reads **AI · LIVE MODEL**.
      Without it, it reads **AI · RULE-BASED FALLBACK** and everything still
      works. Either is fine — but know which one the judges will see, because
      the badge is on screen and someone will read it. Exporting the key after
      uvicorn started does nothing; restart it.
- [ ] **Projector check.** The console is built for 1920×1080. Mirror the
      display and confirm the right rail shows the Conjunction-risk panel *and*
      the maneuver sliders without scrolling. Below ~1280px wide the layout
      reflows to a single column — usable, but not what you rehearsed.
- [ ] Browser at 100% zoom, dark room if possible. The UI is dark-only by
      design; there is no light theme to fall into.
- [ ] Close every other tab. Cesium is the heaviest thing on the machine.

## T-5 minutes

- [ ] Reload both views once and let them settle. First load fetches TLEs and
      screens four prediction days (~2.2 s for the replay).
- [ ] Confirm the **data-source line** in the left rail says what you expect:
      `CelesTrak (live)` / `CelesTrak (cached)` / `Bundled snapshot`. If it says
      snapshot and you wanted live, wifi is down — that is a fine thing to point
      at, and the UI says so honestly, but do not be surprised by it.
- [ ] Have `demo/recorded_fallback.mp4` open in a **background window**, paused
      at frame 0. Switching to it should be one alt-tab, not a file hunt.

---

## Run order, with the numbers to check against

### 1. Envisat replay — the correctness proof

Open the **Envisat replay** tab. It fetches the scenario, screens all four
prediction days, simulates the burn ESA flew and requests advice with no manual
step.

Expected, left rail:

| Day | Miss distance | Pc |
|---|---|---|
| Oct 19 | 329.1 m | 2.74×10⁻⁴ |
| Oct 20 | 234.1 m | 1.11×10⁻³ |
| Oct 21 | 151.8 m | 1.93×10⁻³ |
| Oct 22 | 268.9 m | 6.59×10⁻⁴ |

Right rail, Oct 22: relative speed **14.78 km/s**, computed TCA
**2004-10-22T05:10:37Z** against a published 05:10:35Z.

**Say the quiet part.** Miss distance is labelled *within published range*;
Pc is labelled *outside*. Three of four Pc values fall outside the published
1.4–5.5×10⁻⁴ band, and the panel says so. The reason is documented: we apply
TLE-derived covariance to both objects where ESA used Envisat's operational
orbit determination for the primary — conservative, biases Pc up. A technical
judge will respect that far more than four green ticks.

Also worth a sentence: **each day is screened from its own 00:00 UTC through
the end of October 22**, not from a window centred on the known TCA. Verified
to give identical results at 1 h, 12 h, 84 h and 96 h windows. That is what
makes it a proof rather than a demo.

### 2. Live console — detection in live time

Switch to **Live console**. Expect the globe with tracked objects and, most
likely, **"No close approach found"** with the window and candidate count
stated.

**That is the correct result and should be presented as one.** Two objects in
unrelated orbits do not conjunct. The panel is styled as a result, not a
failure, and the screening window is anchored to the primary's **element-set
epoch** rather than the wall clock — an element set is most accurate at its own
epoch, and screening "the next 24 h from now" against a two-week-old TLE
propagates it two weeks before the window even opens.

### 3. INJECTED — the full chain end to end

Hit the **INJECTED** toggle. A violet, hatched banner appears and stays on
screen; that colour is reserved for data provenance and is never used for risk,
so it cannot be confused with the amber WATCH chip beside it.

Expected:

| | |
|---|---|
| INJECTED DEBRIS A | 405.7 m, Pc 4.66×10⁻⁵, **Watch** |
| INJECTED DEBRIS B | 6075.4 m, Pc 7.29×10⁻²², **Nominal** |
| Burn −4.0 cm/s @ 50 min | closest approach 405.7 m → **680.2 m**, Pc → 3.47×10⁻⁶, 92.5% reduction, 0.152 kg |
| Advisor | **MONITOR ONLY** — Pc is below the 10⁻⁴ threshold |

**Be straight about what these objects are.** They are synthetic, derived from
a real ISS element set, and they were *not* tuned until they looked dangerous —
YELLOW is where the physics landed. If asked why the demo case is not RED: it
is not RED. Manufacturing a crisis would be the same dishonesty as fabricating
a number.

### 4. Maneuver planner — the interactive part

Drag **ΔV** and **lead time**. The panel re-queries the real endpoint on a
250 ms debounce; while a new burn is in flight the previous result stays
visible, dimmed, labelled with the parameters it belongs to.

**Do the two-verdict demo in the REPLAY planner, not this one.** The injected
case starts at Pc 4.66×10⁻⁵, already below the 10⁻⁴ threshold, so every burn
clears both verdicts and the interesting divergence never appears. The Envisat
replay starts at 6.59×10⁻⁴ and shows it properly (verified against the running
backend, Oct 22):

| ΔV @ 50 min | Pc | Verdict 1 | Verdict 2 |
|---|---|---|---|
| −0.5 cm/s | 6.59×10⁻⁴ → 5.16×10⁻⁴ | ✓ Reduces risk | **! Still above the 1×10⁻⁴ threshold** |
| −4.0 cm/s | 6.59×10⁻⁴ → 5.69×10⁻⁵ | ✓ Reduces risk | ✓ Below the threshold |
| −8.0 cm/s | 6.59×10⁻⁴ → 1.60×10⁻⁶ | ✓ Reduces risk | ✓ Below the threshold |
| +4.0 cm/s | 6.59×10⁻⁴ → 2.49×10⁻³ | ✕ Does not reduce risk | ! Still above the threshold |

**−0.5 cm/s is the one to land on.** It helps and it does not finish the job,
and the panel says both. One boolean would have to either condemn the burn ESA
actually flew or bless a token nudge that leaves the conjunction standing.

Second moment worth setting up: **dragging lead time can raise the separation
while Pc rises too.** Not a bug — shifting along the relative-velocity direction
increases distance without reducing risk, and the panel says Pc is the quantity
to decide on. Moving further away is not always safer.

If asked why the two distance readings differ: the burn is a Clohessy-Wiltshire
displacement evaluated at the **pre-burn** TCA, and an along-track burn moves
the satellite mostly along its own velocity, so the separation at that instant
overstates what the burn achieves. The headline is the true closest approach;
the pre-burn-TCA figure is shown beneath it. Pc is unaffected either way.

---

## When something breaks

| Symptom | What it means | Do this |
|---|---|---|
| Red "Backend unreachable" banner | uvicorn is down or on the wrong port | Restart it **from the repo root**. The globe is independent and keeps running — keep talking over it. |
| `ModuleNotFoundError: tests` | uvicorn started from the wrong directory | `cd` to the repo root and restart. |
| Left rail says "Bundled snapshot" | CelesTrak unreachable | Nothing to fix. Say so — the UI already does, and honest degradation is a selling point. |
| Globe blank / black | No WebGL, or GPU blocked | Software rendering works: relaunch Chrome with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. Slower, same scene. Every panel works with the globe dead. |
| Badge says RULE-BASED FALLBACK unexpectedly | key missing from the uvicorn process | Export `GEMINI_API_KEY` and **restart uvicorn**. Or just present the fallback — it is a real feature, not an apology. |
| A screening call errors | one bad pair (e.g. zero relative velocity) | It is isolated per candidate and reported in an `unassessable` list; the rest of the batch still returns. |
| Numbers disagree with this file | genuinely unknown | **Say so.** Then switch to the recorded fallback if it derails the flow. |
| Everything is on fire | — | Alt-tab to `recorded_fallback.mp4`. It is already open and paused. |

---

## After the demo

- [ ] Note any number that disagreed with this file, and open an issue rather
      than editing the file to match — the discrepancy is the finding.
- [ ] If the pipeline changed, re-record the fallback video before the next run.
