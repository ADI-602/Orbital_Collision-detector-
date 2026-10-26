# Presentation guide — every feature, what it means, and the order to show it

One document to prepare the pitch from. It covers (A) the idea in 30 seconds,
(B) every feature on both tabs, (C) the flow to present, (D) the lines to say
and not say, (E) judge Q&A, (F) limits to volunteer, (G) what to do when
something breaks, (H) the measured numbers, (I) a rehearsal checklist.

Companion files: [`demo_checklist.md`](demo_checklist.md) (pre-flight, failure
table, measured numbers) and [`envisat-runbook.md`](envisat-runbook.md) (the
original Envisat script; its §1 correction still stands, but its "AI not built
yet" lines are out of date — the AI panel is built and is on the replay tab).

Written 2026-10-26. Presenting setup: 16" laptop, 1536×960 CSS px, full screen
(F11). Re-check every number in §H after any change to `backend/physics/`.

---

## A. The idea in 30 seconds

> Real physics computes the risk. AI makes the risk understandable and
> actionable.

Two halves, strictly separated:

| Half | What it is | What it does | What it never does |
|---|---|---|---|
| **Physics pipeline** (Python) | TLE ingest → SGP4 propagation → conjunction screening → TCA refinement → collision probability (Pc) → burn modelling | Produces every number on screen: miss distance, TCA, Pc, threat level, burn results | Call an AI model. It runs with no API key and no network call to any LLM |
| **AI advisor** (Gemini 2.5 Flash) | Receives the finished figures as structured JSON | Explains them in plain language, compares the burn options, recommends | Compute, estimate, change or "sanity-check" a number. If it is down, a rule-based offline advisor answers with the same figures |

If a judge remembers one sentence, it should be that one. Never call the
screening "AI screening" or "AI monitoring".

---

## B. Every feature, tab by tab

### B1. Header (both tabs)

| Element | What it does | What to say |
|---|---|---|
| **ORBITAL RISK ADVISOR** + tab switch | **Live console** (real, current data) and **Envisat replay** (2004 proof) | "Left tab is today; right tab is the proof that the method is right." |
| **Validated · Alfano · Envisat** badge (green) | On startup the backend re-runs two known-answer checks — the Alfano synthetic case (Pc 0.10034) and the four Envisat prediction days — against their tested bounds. Click it for the figures per check; Escape closes | "Real physics, checked against published answers every time it starts." Red "Validation failed" = stop, switch to the video |
| **Backend status chip** | Online / unreachable. A red "Backend unreachable" banner appears if the API is down; the globe keeps running because it propagates in the browser | Only mention if it breaks |
| **Reset layout** | Puts every panel back to default size and re-expands minimised ones (panel sizes are remembered per browser) | Press it once before you start |

### B2. Live console — the globe

The globe is CesiumJS with ~700 tracked objects propagated in the browser with
SGP4 (satellite.js) for display only. **The numbers never come from the
browser** — they come from the backend.

| Feature | What it shows | Notes |
|---|---|---|
| **Object markers** | Payloads, debris and rocket bodies as different **shapes** with a muted neutral tint | Colour is reserved for risk. Type is guessed from the catalogue name (`DEB`, `R/B`) — a display heuristic; say so if asked |
| **Selected pair's orbit rings** | One full revolution of each object's orbit: primary **solid blue**, secondary **dashed violet** (swatches beside the names in the risk panel are the legend). Risk colour stays on the badge, the TCA marker and the line joining the pair | The rings are the objects' own paths from their own element sets |
| **Show on globe** (pill by the badge) | Flies the camera to 12,000 km and drops a **"Closest approach (TCA) · 104 m miss"** marker where the two rings cross, labelled with the pipeline's miss distance | The marker is placed on the drawn rings, not at its true ground position 12 h out (that would sit over 1,000 km off both rings). A test pins this |
| **Burn path** | The post-burn path in teal from a labelled "Burn −4.0 cm/s" marker; the no-burn path is the blue orbit ring itself | Sampled by the backend; the post-burn orbit is never derived in JavaScript. Drawn on the replay tab, and on the console only for a live event |
| **Labels** | Secondary object labelled on the left, 13 px | Readability on a projector |

### B3. Live console — left rail

| Panel | What it does | Say |
|---|---|---|
| **Tracking** | Feed source (**Server (live feed)**), object count (~700), groups, and the **Object search** | "The server owns the tracked set. The globe and the event list describe the same objects." |
| **Object search** | Type a name or NORAD ID; picks the object and flies to it | Quick way to show any object a judge names |
| **Maneuver planning** | Burn options for the selected event: ΔV in cm/s, resulting miss, new Pc, risk reduction, propellant. **Compare all three** simulates −2 / −4 / −8 cm/s and tables them. Each burn can be drawn as an encounter diagram | Figures first, diagram second. The diagram is to scale with a labelled scale bar; the labelled numbers are the pipeline's scalars, never measured off the picture |
| **Selected object** | Live latitude / longitude / altitude of the picked object | Footnote on screen: "Live TLE position — not a conjunction assessment." |

### B4. Live console — right rail

| Panel | What it does | Say |
|---|---|---|
| **Conjunction risk** (event detail) | Pair, **RED / YELLOW / GREEN** badge, Pc, miss distance, TCA, relative speed, threat thresholds line. **More details** toggle: hard-body radius (14.5 m) and method notes | "RED is Pc ≥ 1e-4, YELLOW ≥ 1e-5." Underlined terms (Pc, TCA, miss distance, relative speed, threat level, hard-body radius, SGP4, co-orbital) have **hover definitions** |
| **AI advisor** | **Explain this event** asks Gemini to narrate the already-computed figures. Chip shows **AI: LIVE** or **OFFLINE ADVISOR**; an elapsed counter runs while it thinks (6–20 s); repeat asks return instantly as **Cached · HH:MM UTC**; **Ask again** forces a fresh answer | "It reads the numbers; it does not compute them." Warm it before going on stage |

### B5. Live console — bottom strip

| Feature | What it does | Say |
|---|---|---|
| **Events tab** (Objects and conjunction events) | The last completed screening pass: real detections, ranked by threat, with the most serious auto-selected on load | "These are real conjunctions found in current public data." |
| **Filter chips** (RED / YELLOW / GREEN / co-orbital) | Hide categories; a line always says "N hidden by filter · Show all" | Nothing is silently dropped |
| **Schedule line** | "Pass running m:ss · last took 1:23" or "Next pass in mm:ss"; a "Restored after restart" label when it is showing the pass saved before a backend restart | "Screening runs on a timer, in a worker process, with no AI. Real conjunction assessment works the same way: scheduled screenings, published results." |
| **SCREEN NOW / REFRESH** | SCREEN NOW asks for a fresh pass (returns at once; the pass runs in the background, ~80 s); REFRESH re-reads the last one | Don't press SCREEN NOW on stage unless you want to wait |
| **Coverage honesty** | A pass whose refinement was capped is never described as a complete screening | The list says when it was capped |
| **INJECTED · 2004 REPLAY row** | The historical Envisat case merged into the list when no live RED/YELLOW exists | Tagged; it never alerts and is never drawn as a live event |
| **Conjunction alerts** | A non-blocking toast for each NEW live RED or YELLOW: the figures first, then the AI's explanation (LIVE / OFFLINE ADVISOR) | "New" is per browser, matched by pair + TCA within 10 min, so each pass doesn't re-alert |

### B6. Envisat replay tab (the correctness proof)

The 2004 near-miss between Envisat and a Zenith-2 rocket fragment, re-run through
the same endpoints the live console uses, from archived element sets.

| Panel / feature | What it does | Say |
|---|---|---|
| **Closest approach countdown** | Counts to the TCA **this pipeline** refined (05:10:37Z) | Published TCA was 05:10:35Z — two seconds apart |
| **Globe on the encounter** | Camera opens on the encounter; the clock runs ×60 | At globe scale 269 m is invisible — "which is why you need the number, not the picture" |
| **Validation case** | Compact summary of the case | |
| **Replay scrubber** | Timeline with **Burn** (TCA − 50 min) and **TCA** marks; keys **Space** pause · **R** restart · **← →** ±1 min · **B** jump to burn · **T** jump to TCA | Use B and T so you never wait on the clock |
| **Closest approach — 22 Oct prediction** | Pc, miss distance, TCA computed vs published, relative speed, hard-body radius row (14.5 m) | Pc 6.59e-4, miss 269 m |
| **What ESA did** | Simulates the −4 cm/s burn 50 min before TCA; **Compare all three** burns; to-scale encounter diagram | Real history: ESA flew −4.0 cm/s at 04:20 UTC |
| **AI explanation** | Asked automatically after a burn is simulated; with the three-burn comparison it weighs all three | AI: LIVE chip; narrates, computes nothing |
| **Four consecutive predictions** | Table of Oct 19–22: miss, Pc, threat, lead. Published reference bands above the rows; values inside are underlined | The table, not a trend line |

---

## C. The flow to present (about 5–6 minutes)

Do the pre-flight in [`demo_checklist.md`](demo_checklist.md) §2 first. Start on
the **Live console**, full screen, layout reset, AI warmed.

| # | Time | Tab | You do | You say | Point at |
|---|---|---|---|---|---|
| 0 | 0:00 | Console | Nothing | The 30-second idea (§A). "Two halves, kept apart on purpose." | The whole screen |
| 1 | 0:30 | Console | Nothing (it opens on the top live event) | "This is live data: about 700 tracked objects, screened against each other. The pass found real conjunctions; this is the most serious." | The two orbit rings, the badge, Pc, miss, TCA |
| 2 | 1:00 | Console | Click the **Validated** badge, then Esc | "Every start, the backend re-runs two known-answer checks — Alfano's synthetic case and ESA's Envisat. Green means the physics still reproduces published answers." | The per-check figures |
| 3 | 1:25 | Console | Toggle filter chips off and on | "Nothing is hidden silently, and screening runs on a timer — no AI is in the loop." | The "N hidden" line, the schedule line |
| 4 | 1:50 | Console | **Show on globe** | "Here is where the two orbits cross — closest approach." | The TCA marker |
| 5 | 2:10 | Console | **Explain this event** | "Now the AI. It is handed these figures and puts them in plain language. It computes nothing." | The AI: LIVE chip; the quoted numbers match the panel |
| 6 | 2:50 | Replay | Click the tab | "Now the proof: the 2004 Envisat near-miss, re-run through the same code from archived public data." | The four rows filling in (~2.5 s of real computation) |
| 7 | 3:15 | Replay | Nothing | "We computed closest approach at 05:10:37; ESA published 05:10:35." | TCA computed vs published |
| 8 | 3:40 | Replay | Look at the bottom table | "Four predictions, all above ESA's 1e-4 threshold. The risk did not climb; it was already dangerous three days out. What improved was precision." | Four RED rows, reference bands |
| 9 | 4:10 | Replay | Press **B**, then **Compare all three** | "ESA burned −4 cm/s, 50 minutes before. We re-fly that burn and two others." | The −2 / −4 / −8 table |
| 10 | 4:50 | Replay | Wait for the AI answer; press **T** | "The AI weighs all three, using our figures verbatim. At TCA the encounter diagram is drawn to scale." | AI chip, scale bar |
| 11 | 5:20 | Replay | Nothing | **Volunteer the limits** (§F): public TLE vs ESA's orbit determination; one hard-body radius; screening scope. | |
| 12 | 5:45 | — | — | Close on the claim: "Real physics computes the risk. AI makes it understandable and actionable." | |

Time-boxing: if short on time, drop steps 3 and 4. If long, drop 2. Never drop
5, 7, 9 or 11.

---

## D. What to say, and what not to say

**Say**
- "Real physics computes the risk. AI makes the risk understandable and actionable."
- "It was already dangerous three days out, and stayed dangerous across four independent predictions. What improved was precision, not the verdict."
- "Screening is a scheduled physics pass; the AI is handed the results afterwards."
- "Our Pc runs higher than ESA's range because we use public TLEs; they had operational orbit determination."

**Do not say**
- "The risk climbs day by day" — it goes up, up, then down (2.74e-4 → 1.11e-3 → 1.93e-3 → 6.59e-4). The pitch script's Part 3 says otherwise; ignore it.
- "AI screening" / "AI monitoring" / "the AI found" — the AI never runs or finds anything.
- "You'll see them nearly collide" — 269 m is below one pixel at globe scale.
- Anything implying a figure, or the post-burn trajectory, was estimated by the AI.
- That a burn can avoid a debris-vs-debris event — debris cannot manoeuvre (see §F).

---

## E. Judge Q&A

| Question | Answer |
|---|---|
| Did you tune anything to hit the Envisat numbers? | No. Same endpoint as the live console, no special-casing, and the regression bounds were fixed before the values were known. |
| Why is your Pc above ESA's range? | Covariance. We apply a TLE-class uncertainty to both objects, including Envisat, where ESA had ~3 m orbit determination against our ~556 m. That biases Pc upward — the conservative direction. (`docs/validation-notes.md` §4.3) |
| Why doesn't risk converge as TCA nears? | TLE accuracy is not monotonic in age; the paper reports a range, not a trend. That is why there are four rows, not a line. |
| Is the AI computing any of this? | No. It receives finished JSON and is told to use the numbers verbatim. The physics runs with no key and no network call to an LLM; if the AI is down, an offline advisor answers with the same figures. |
| How do you know the physics is right? | The Validated badge: Alfano's case reproduces Pc 0.10034; Envisat reproduces TCA within two seconds of the published one. Backed by 139 backend tests. |
| What did ESA actually do? | A −4.0 cm/s in-track braking burn at 04:20 UTC, 50 minutes before closest approach, then a +3.9 cm/s restituting burn at 06:00 UTC. Quoted history; we re-fly the first one through our own model. |
| What hard-body radius? | 14.5 m combined, one value for every pair (shown in each event's details). |
| Is this the full catalogue? | No: ~700 tracked objects, refining the closest 300 candidate pairs per pass — a stated scope reduction. |
| How is the burn modelled? | Instantaneous along-track ΔV with Clohessy-Wiltshire relative motion — not thruster physics. |
| Where does the data come from? | CelesTrak primary, Space-Track as the live fallback, a committed offline set as the floor. The offline set only seeds inputs; it never produces conjunctions. |
| What if the AI is wrong? | It can only restate the figures it was given; every figure on screen comes from the pipeline and sits next to the AI's words, so a mismatch is visible. |

---

## F. Limits to volunteer before a judge finds them

1. **Scope:** ~700 tracked objects, not the ~40,000 catalogue; each pass refines the closest 300 pairs.
2. **One hard-body radius (14.5 m)** for every pair — Envisat's validation value, not a size per object.
3. **Propellant assumes Envisat's 8,200 kg mass** for every event.
4. **Burns are instantaneous along-track ΔV**, not thruster physics.
5. **Debris-only events still offer a burn.** Debris cannot manoeuvre, and the live top event may be debris vs debris. Say so, or pick a payload-involving event.
6. **TLE-class uncertainty** for both objects is why Envisat's Pc is above ESA's band.
7. **Object type is a name heuristic** (`DEB`, `R/B`), not catalogue metadata.
8. **Live feed:** CelesTrak often times out from this network; the Space-Track fallback takes about a minute. Reload once the feed has landed.

---

## G. If something breaks on stage

| Symptom | Do |
|---|---|
| "Backend unreachable" | Restart the backend (once). The globe keeps running; say so. Never improvise a number. |
| AI chip says **OFFLINE ADVISOR** | Carry on — same figures, templated wording. Say so. |
| Badge says **Validation failed** | Do not demo the numbers. Switch to the recorded video. |
| Console opens on the Envisat case | Expected when no live RED/YELLOW exists in the current pass. It is tagged INJECTED · 2004 REPLAY. |
| Tracking says "offline set" | Reload the page (before warming the AI). |
| AI is slow | Live answers take 6–20 s. Keep talking through the figures; repeats are instant. |
| Anything else | Switch to the recorded video (`demo/fallback/recorded_fallback.mp4`, still to be recorded). |

---

## H. Numbers, as measured 2026-10-26

| Envisat prediction | Miss | Pc |
|---|---|---|
| Oct 19 | 329 m | 2.74e-4 |
| Oct 20 | 234 m | 1.11e-3 |
| Oct 21 | 152 m | 1.93e-3 |
| Oct 22 | 269 m | 6.59e-4 |

TCA computed 05:10:37Z vs published 05:10:35Z. Relative speed 14.78 km/s.
Alfano: Pc 0.10034. Published bands (Klinkrad et al. 2005): miss 81–316 m,
Pc 1.4e-4 – 5.5e-4. Threat: RED ≥ 1e-4, YELLOW ≥ 1e-5, else GREEN.

| Burn (50 min before TCA) | Miss after | Pc after | Risk ↓ | Propellant |
|---|---|---|---|---|
| −2.0 cm/s | 401 m | 2.23e-4 | 66.2% | 0.076 kg |
| −4.0 cm/s (ESA's) | 570 m | 5.69e-5 | 91.4% | 0.152 kg |
| −8.0 cm/s | 938 m | 1.60e-6 | 99.8% | 0.304 kg |

Timings: a screening pass ~80 s; live AI 6–20 s; cached AI ~0.1 s; validation
badge ~0.6 s; replay load ~2.5 s.

---

## I. Rehearsal checklist

- [ ] Run all of §C twice against a stopwatch, once with someone interrupting with §E questions.
- [ ] Say the §F limits out loud until they sound like strengths.
- [ ] Practise B and T on the replay so you never wait for the clock.
- [ ] Decide who answers physics questions and who answers AI questions.
- [ ] The Cosmos 2221 scenario from the pitch script is **not built**; do not promise it.
- [ ] Record the fallback video (Win+Alt+R) following §C, and keep a copy off the laptop.
