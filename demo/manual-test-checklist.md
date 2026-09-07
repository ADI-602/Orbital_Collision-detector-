# Manual sanity test — everything built 2026-08-31 / 09-01

Work top to bottom. **Sections 1–3 are ordered by how likely I think a bug is**,
not by feature. Sections 4+ are things I did verify automatically and you're
re-confirming by eye.

Where I verified something in headless Chrome I say so. Where I didn't, I say
that too — those are the ones worth your time.

## Setup

```bash
# Terminal 1 — backend. Restart it fresh; a stale process serves old physics.
cd orbital-risk-advisor
backend\.venv\Scripts\uvicorn backend.api.main:app --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

Wait for the first screening pass (~45 s at 695 objects). Check it finished:

```bash
curl localhost:8000/api/monitoring/status
```

Expect `"state": "ready"`, ~695 objects, `"truncated": true`.

---

# 1. Highest risk — verified, then invalidated by a later change

I confirmed these worked, **then changed the globe from point markers to
billboard sprites and did not re-test them.** If anything is broken, it is most
likely here.

- [ ] **Click a satellite on the globe.** The right rail "Selected object"
      should fill with a name, NORAD id, lat/lon/altitude.
      *Why it might fail:* picking a billboard returns a different object shape
      than picking a point. If clicks do nothing, or select the wrong object,
      that's the bug.
- [ ] **Click empty space.** Selection should clear back to "No object
      selected".
- [ ] **A selected object should grow and turn teal**, and show its name label.
      *Why it might fail:* the marker sprite is only rebuilt when its cache key
      changes. If the marker never changes appearance on click, the key
      comparison is wrong.
- [ ] **Labels appear only on selection.** With nothing selected there should
      be **no name labels at all** on the globe. Select one → exactly one
      label. *Why it might fail:* label gating is new; if you see 695 labels,
      it isn't working.
- [ ] **Go to Envisat replay and confirm it still renders.** Both objects
      visible, the dashed line between them still drawn.
      *Why it might fail:* the replay uses the same globe component, so the
      billboard change affects it too. I verified the line **before** that
      change, not after.

# 2. Never tested at all

No automated coverage exists for these. I built them and moved on.

- [ ] **Zoom right in on the debris shell** (scroll wheel). Can you actually
      tell a diamond (debris) from a circle (payload) from a square (rocket
      body)? Most objects in the current set are `COSMOS 2251 DEB` /
      `IRIDIUM 33 DEB`, so look for `COSMOS 2251` and `IRIDIUM 33` themselves —
      those two are payloads and should be round.
      *Honest doubt:* I shrank the markers to stop the shell looking like a
      wall of squares. They may now be too small for the shape to read at all.
      If so, tell me and I'll rebalance.
- [ ] **The T-minus countdown on a LIVE event.** I could never test this — the
      only live conjunctions in the current set are between debris fragments,
      and none produced a RED event. If you ever select a live (non-injected)
      event in the Conjunction events tab, the detail panel should show a
      countdown against **real UTC**, not the 2004 clock.
- [x] **CelesTrak unreachable → fast, named failure.** ✅ Fixed 2026-09-06 and
      verified: the Feed panel now shows "Backend tracked set unavailable" with
      the real reason (`cosmos-2251-debris: <urlopen error timed out>; ...`)
      about 4 s after load, instead of a meaningless "timed out after 30000ms"
      at 30 s. **If CelesTrak stays unreachable on the demo machine the console
      runs on the 4-object bundled snapshot and the event list holds only the
      injected Envisat row** — check network before the demo, not during it.
- [ ] **Offline set (NEW).** With CelesTrak unreachable the Feed panel should
      read source **"Server (offline set)"**, groups matching the file, and a
      footnote giving the capture age and saying *"this IS the set being
      screened"*. There should be **no red error panel** — the console is fully
      functional, just on older elements. Verified 2026-09-06.
- [ ] **After running `python scripts/refresh_tracked_set.py`** on a working
      network, restart the backend and confirm the source flips to **"Server
      (live feed)"** and the object count matches the file. *Never tested* — I
      have no network here.
- [ ] **Kill the backend while the console is open** (Ctrl-C in terminal 1),
      then hit Retry in the Feed panel. Expect: globe keeps animating, an
      explicit "Backend tracked set unavailable" error, and the source line
      changing to *"Local replay — backend down"*.
      *Why it might fail:* the localStorage replay path is new and I never
      exercised it.
- [ ] **Then clear site data and reload with the backend still down.** Source
      should read *"Bundled snapshot"* with a warning that these are **not**
      the objects the server screens. This is the state where the globe and the
      event list genuinely disagree, and the UI is supposed to admit it.
- [ ] **Rejected element sets.** With real CelesTrak data, 0 of 695 were
      rejected, so the "N element sets rejected" panel has never rendered. No
      easy way to force it — just note if you ever see it look wrong.

# 3. Known-incomplete — confirm it *says* so rather than misleads

These are half-built on purpose. The test is that the UI is honest about it.

- [ ] Maneuver planning and AI panels still read as explicitly pending.

# 3b. Conjunction events, now reading the scheduled pass (NEW — 2026-09-06)

The panel no longer runs screening; it reads the server's last completed pass.
Verified against a **4-object** seeded set because CelesTrak was unreachable
here — so the interesting case, a large truncated pass, is exactly what I
could not test.

- [ ] **The list populates on its own**, with no button press. There should be
      no "Run screening" button anywhere — screening is scheduled server-side.
- [ ] **The meta line** reads like `N conjunctions · N high risk · N not
      assessed · N objects · N min ago`. Cross-check the counts against
      `curl localhost:8000/api/monitoring/events`.
- [ ] **The coverage note** above the list. With the full 695-object set the
      pass is very likely **truncated**, so it should read *"Partial pass: 300
      of N gated pairs were refined…"* in amber — **not** the neutral "all
      gated pairs refined". *Why it might fail:* I only ever saw the complete
      (untruncated) case. If a capped pass renders as complete, the console is
      overclaiming coverage and that's the most serious bug on this page.
- [ ] **The empty state must match the coverage.** With a truncated pass and no
      detections it must say "No close approaches among the candidates
      resolved", never "in the tracked set" — the second is a claim about the
      whole set that a capped pass has not earned.
- [ ] **REFRESH** re-reads instantly (no spinner beyond a blink).
- [ ] **SCREEN NOW** returns immediately, shows `PASS RUNNING…`, disables
      itself, and the list updates when the pass finishes. *Never tested end to
      end* — at 695 objects the pass takes minutes, so this is the one to watch.
- [ ] **Rows name both objects** (`A ↔ B`). Selecting a row fills the right
      rail. Click two different rows that share one object — each must select
      the pair you clicked. *This was a real bug:* rows sharing a secondary
      collided into one React key and selecting one picked the other. Fixed,
      but worth confirming on real data with many debris pairs.
- [ ] **Browser console clean** (F12). The above bug showed up there first.

# 3c. Orbit tracks on the globe (NEW — 2026-09-07)

Selecting an event now draws one revolution of each object's orbit. Verified
against the Envisat replay and a 4-object seeded set; the interesting case —
two *different* debris orbits crossing on the live console — is what I could
not test, because CelesTrak is still blocking this IP and the offline set is
four co-located station modules whose rings coincide.

- [ ] **Replay view: two rings.** Envisat solid, Zenith-2 dashed, both in the
      event's risk colour, and the two planes visibly cross (they are 27.2°
      apart in inclination). This is the picture the whole feature exists for.
- [ ] **Each marker sits ON its own ring**, and stays on it as the clock runs.
      A marker drifting off its ring means the sampling and the marker have
      stopped sharing an instant — tell me, that is the failure this rests on.
- [ ] **The rings do not flicker or vanish** after a second or two. If they
      appear once and disappear, the CallbackProperty wiring has regressed.
- [ ] **Live console, a real conjunction:** select a row where the two objects
      are different orbits and confirm the rings cross near the marker pair.
      *Never seen* — the offline set cannot produce it.
- [ ] **An unassessable / co-orbital pair draws NEUTRAL GREY rings**, never a
      risk colour. Its Pc is not a risk statement, and the globe must not imply
      one.
- [ ] **Deselecting removes both rings and the chord**, leaving plain markers.
- [ ] **Clicking a single marker** draws one teal ring — accent colour, i.e.
      selection chrome, not a risk level.
- [ ] **Clicking a ring or the chord does nothing** (it must not clear or
      change the selected object). This was a real bug: any picked entity with
      a string id counted as an object, and Cesium auto-generates string ids
      for entities added without one.
- [ ] **Watch the frame rate with rings on.** Each ring is 129 SGP4
      propagations every 250 ms; three at once is ~1,500/s, which should be
      nothing — but nothing here has been measured on real hardware with a GPU.

# 3d. Maneuver planning (NEW — 2026-09-08)

The burn is simulated on the replay view (left rail, under "What ESA did") and
on the live console (end of the bottom strip). The replay is the one I could
verify properly; the live-console path needs a real conjunction, which the
offline tracked set cannot produce.

- [ ] **Nothing runs until you press a ΔV.** The panel should say so. A console
      that plans a burn for every row you click is both wasteful and misleading.
- [ ] **−4.0 cm/s on the replay reproduces the historical manoeuvre:**
      `269 m → 570 m`, Pc `6.59e-4 → 5.69e-5`, **91.4%** reduction, **0.152 kg**
      of propellant. This is the burn ESA actually flew on 22 October 2004.
- [ ] **−8.0 cm/s gives a bigger miss and a smaller Pc** (`938 m`, `1.60e-6`,
      99.8%, 0.304 kg). If a larger burn ever made things worse, stop and tell me.
- [ ] **The diagram is to scale.** Hold something against the screen: the teal
      "after burn" line must be about 2.1× the red "no burn" line, matching
      570/269. The scale bar under it says what 100 m looks like. *This is the
      one claim on the panel a judge can check by eye — it must survive that.*
- [ ] **The numbers beside the diagram are the pipeline's, not measurements off
      the picture.** The panel says so; confirm the wording is still there.
- [ ] **On the globe, the burn arc is drawn in teal along the red orbit ring.**
      The two arcs coincide at that scale — that is the physics, not a bug: 389 m
      across a 29,425 km arc. The panel is where the difference is visible.
- [ ] **Live console: select a co-orbital or unassessable pair.** The panel must
      refuse with a reason rather than offering a burn. *Never tested with a
      real assessable live conjunction* — the offline set has none.
- [ ] **Live console: the injected 2004 event draws no burn arcs on the globe**
      (its trajectories are from 2004; the globe is on today's clock). The
      replay view is where those are drawn.
- [ ] **Browser console clean** (F12).

# 4. Envisat replay — I verified these, re-confirm by eye

- [ ] Tab switches, four prediction rows populate: **329 / 234 / 152 / 269 m**
      and Pc **2.74e-4 / 1.11e-3 / 1.93e-3 / 6.59e-4**, all Critical.
- [ ] Headline: Pc **6.59e-4**, miss **269 m**, TCA computed **05:10:37Z** vs
      published **05:10:35Z**.
- [ ] Countdown starts near **T-01:00:00** and runs down at ×60.
- [ ] **Pause** freezes the countdown *and* the globe together.
- [ ] **Restart** returns to T-01:00:00.
- [ ] Reaches **T-00:00:00** about 60 s after opening the tab, then runs into
      T+ rather than freezing.
- [ ] Both reference bands shown (published 81–316 m, asserted 100–1000 m) with
      the note explaining why they differ.

# 5. Live console basics — I verified these

- [ ] Tracking status shows **695 objects**, ring full.
- [ ] Feed: source **"Server (live feed)"**, groups
      `cosmos-2251-debris, iridium-33-debris`, propagator SGP4.
- [ ] "Tracked objects" tab badge reads 695; the strip lists real names.
- [ ] Browser console has **no errors** (F12). I saw none.

# 6. Backend, if you want to poke it

- [ ] `curl localhost:8000/api/tracking/objects` → 695 objects, `rejected: []`.
- [ ] `curl localhost:8000/api/monitoring/events` → real events with
      `primary_id` / `secondary_id` set, sorted most-urgent-first.
- [ ] `curl -X POST localhost:8000/api/monitoring/refresh` returns
      **immediately** (does not hang for the length of a screening pass).
- [ ] `cd orbital-risk-advisor && backend\.venv\Scripts\python -m pytest tests/ -q`
      → 78 passed.

---

## Things I know are wrong / unmeasured

Not bugs to hunt — I already know about these.

- **Frame rate is unmeasured on real hardware.** I got 9 fps at 695 objects in
  headless Chrome, but the 2-object replay view got 12 fps in the same browser
  — headless runs without a GPU, so software rasterisation dominates and the
  number says nothing. **Watch for stutter on the actual demo machine** and
  tell me; that's the only measurement that counts.
- **Pc renders as e.g. `2.16e-181`** for distant misses. Honest, looks broken.
  Needs a display floor.
- **No RED events from live data** — confirmed by measurement, 0 RED / 1 YELLOW
  / 32 GREEN across 695 objects. High-risk rows come from injected historical
  cases by design.
- **The alert path has never fired**, because nothing has produced a RED event
  yet.
- **A co-located pair is pathological for the refinement stage.** Every sample
  sits at zero separation, so all 1441 of them are "local minima" and each gets
  re-scanned. Three docked ISS modules took roughly a minute of a 4-object
  pass. Harmless at demo scale, but it explains a slow first pass and is worth
  knowing before blaming the network.
