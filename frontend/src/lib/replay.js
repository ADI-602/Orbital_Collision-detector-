/**
 * replay.js — arithmetic and published ground truth for the October 2004
 * Envisat / Zenith-2 replay.
 *
 * Pure functions only: no React, no network, no Cesium. Everything here is
 * clock arithmetic, formatting, and constants transcribed from the source
 * paper — which is exactly why it lives in a module rather than inside the
 * replay page. `vitest.config.js` runs in a node environment with no DOM, so
 * logic that is not in a plain module cannot be tested at all.
 *
 * ============================ WHAT THIS IS NOT ==========================
 * Nothing here computes a miss distance, a collision probability, or a time
 * of closest approach. Those come only from /api/physics/screening, which is
 * the validated pipeline. This module decides WHICH INSTANT the globe should
 * draw and HOW a number is rendered — never what the number is.
 *
 * The one apparent exception is the published constants below. They are not
 * computed: they are quoted from a paper, carry their citation, and are
 * displayed alongside our computed values for comparison, never substituted
 * for them.
 * =======================================================================
 */

// ---------------------------------------------------------------------------
// Published ground truth — Klinkrad et al. 2005, ESA SDC4-paper49.
// Transcribed from docs/validation-notes.md §4.2 and §4.3, which quote the
// paper directly. Do not edit these to make a comparison look better; they
// are the thing our output is checked against.
// ---------------------------------------------------------------------------

/** The paper's TCA, to the second. Our pipeline refines its own — see below. */
export const PUBLISHED_TCA_UTC_ISO = '2004-10-22T05:10:35Z'

/**
 * The paper reports RANGES across the four consecutive predictions, not a
 * value per day: "at distances of 81 m <= rho_tca <= 316 m, with collision
 * probabilities of 1.4e-4 <= Pc <= 5.5e-4".
 *
 * So a per-day "published vs computed" comparison is not available and must
 * not be invented. These are bands, and the UI must present them as bands.
 */
export const PUBLISHED_MISS_DISTANCE_M = { min: 81, max: 316 }
export const PUBLISHED_PC = { min: 1.4e-4, max: 5.5e-4 }

/**
 * The ranges the regression test actually asserts
 * (tests/fixtures/envisat_tles.py:89-92), which are wider than the published
 * bands on purpose: we drive the pipeline from public-catalog TLEs, while ESA
 * used Envisat's operational orbit determination (in-track 1-sigma of ~3 m
 * against ~556 m for TLE). See docs/validation-notes.md §4.2.
 *
 * The distinction matters on screen. Marking a day "outside the published
 * band" without saying the inputs differ would report a passing pipeline as a
 * failing one.
 */
export const ASSERTED_MISS_DISTANCE_M = { min: 100, max: 1000 }
export const ASSERTED_PC = { min: 1e-4, max: 2.5e-3 }

/**
 * ESA's accepted collision-probability level at the time of the event. All
 * four predictions exceeded it, which is what triggered the maneuver
 * (docs/validation-notes.md §4.3). It was revised to 2e-4 by the end of 2004.
 */
export const PC_ACCEPTED_LEVEL = 1e-4

/** Citation shown wherever the constants above are displayed. */
export const PUBLISHED_SOURCE = 'Klinkrad et al. 2005 — ESA SDC4-paper49, §6'

/**
 * The avoidance maneuver ESA actually flew (docs/validation-notes.md §4.3).
 * Displayed as history, not as something this app computed. The simulation
 * that reproduces it is build-order step 7.
 */
export const HISTORICAL_MANEUVER = {
  deltaVCmS: -4.0,
  appliedUtcIso: '2004-10-22T04:20:00Z',
  leadTimeMinutes: 50,
}

// ---------------------------------------------------------------------------
// Prediction days
// ---------------------------------------------------------------------------

/**
 * The four prediction days, in order, with the lead time each represents
 * relative to the 22 Oct TCA. Keys match the backend's `day` field
 * (backend/api/main.py:98-103).
 */
export const PREDICTION_DAYS = [
  { key: 'oct_19', label: 'Oct 19', lead: 'T-3 d' },
  { key: 'oct_20', label: 'Oct 20', lead: 'T-2 d' },
  { key: 'oct_21', label: 'Oct 21', lead: 'T-1 d' },
  { key: 'oct_22', label: 'Oct 22', lead: 'T-0 d' },
]

/**
 * Screening window shared by all four days.
 *
 * Every prediction day's element sets describe the SAME encounter on 22 Oct —
 * only their age differs. So all four are screened over one window around the
 * real TCA rather than from each day's own epoch: searching from 19 Oct would
 * cost six times the propagation for identical output, and using a different
 * window per day would make the four rows incomparable.
 *
 * This is the window step 4 already used for the injected oct_22 case, which
 * reproduced 268.9 m / 6.59e-4 against a published 268.0 m / 6.59e-4.
 */
export const REPLAY_SCREEN_START_UTC_ISO = '2004-10-22T00:00:00Z'
export const REPLAY_SCREEN_WINDOW_HOURS = 12

// ---------------------------------------------------------------------------
// Replay clock
// ---------------------------------------------------------------------------

/**
 * How much of the encounter the globe replays. An hour of approach is enough
 * to watch the two orbits close, and it starts before the 04:20 UTC point at
 * which ESA committed to the burn — so the decision moment is inside the
 * window rather than already past when the view opens.
 */
export const REPLAY_LEAD_MINUTES = 60
export const REPLAY_TRAIL_MINUTES = 10

/**
 * 70 min of encounter in ~70 s of wall clock, so the countdown decrements one
 * simulated minute per real second. Faster than this and the seconds digit
 * jumps by a quarter-minute per frame, which reads as a glitch rather than as
 * a fast clock. The multiplier is always displayed on screen — the view is
 * sped up and must never be mistaken for real time.
 */
export const REPLAY_SPEED_MULTIPLIER = 60

/**
 * Start and end instants of the replay window around a TCA.
 *
 * @param {number} tcaMs epoch ms of the time of closest approach
 * @param {{leadMinutes?: number, trailMinutes?: number}} [opts]
 * @returns {{startMs: number, endMs: number, spanMs: number}}
 */
export function replayWindow(tcaMs, opts = {}) {
  const lead = opts.leadMinutes ?? REPLAY_LEAD_MINUTES
  const trail = opts.trailMinutes ?? REPLAY_TRAIL_MINUTES
  const startMs = tcaMs - lead * 60_000
  const endMs = tcaMs + trail * 60_000
  return { startMs, endMs, spanMs: endMs - startMs }
}

/**
 * The simulated 2004 instant to draw, for a given amount of elapsed real time.
 *
 * Wraps at the end of the window so the approach replays continuously — a
 * one-shot sweep would leave the globe frozen a minute into a demo, and a
 * frozen globe reads as a crash.
 *
 * The positions drawn at that instant are propagated by satellite.js from the
 * archived TLEs; this function only chooses the instant.
 *
 * @param {number} tcaMs
 * @param {number} elapsedRealMs real milliseconds since the replay started
 * @param {{leadMinutes?: number, trailMinutes?: number, speedMultiplier?: number}} [opts]
 * @returns {Date}
 */
export function replaySimTime(tcaMs, elapsedRealMs, opts = {}) {
  const { startMs, spanMs } = replayWindow(tcaMs, opts)
  if (!(spanMs > 0)) return new Date(startMs)

  const speed = opts.speedMultiplier ?? REPLAY_SPEED_MULTIPLIER
  const advanced = Math.max(0, elapsedRealMs) * speed
  // Modulo twice so a negative input cannot produce a negative offset.
  const offset = ((advanced % spanMs) + spanMs) % spanMs
  return new Date(startMs + offset)
}

/**
 * The inverse of replaySimTime: how much elapsed real time puts the replay
 * clock on `targetSimMs`. This is what lets a timeline scrubber jump the clock
 * to an exact 2004 instant — the burn, the TCA — without a second clock.
 *
 * Clamped into the window, and to just short of its end: the end instant is
 * the same as the start after the wrap, and a scrub to "the end" must not
 * land back at the beginning.
 *
 * @param {number} tcaMs
 * @param {number} targetSimMs the 2004 instant to show
 * @param {{leadMinutes?: number, trailMinutes?: number, speedMultiplier?: number}} [opts]
 * @returns {number} real milliseconds
 */
export function replayElapsedFor(tcaMs, targetSimMs, opts = {}) {
  const { startMs, spanMs } = replayWindow(tcaMs, opts)
  if (!(spanMs > 0) || !Number.isFinite(targetSimMs)) return 0
  const speed = opts.speedMultiplier ?? REPLAY_SPEED_MULTIPLIER
  const offset = Math.min(Math.max(targetSimMs - startMs, 0), spanMs - 1)
  return offset / speed
}

/**
 * How far through the current replay loop we are, 0..1 — for a progress bar.
 *
 * @param {number} tcaMs
 * @param {number} simMs the instant currently being drawn
 * @param {{leadMinutes?: number, trailMinutes?: number}} [opts]
 * @returns {number}
 */
export function replayProgress(tcaMs, simMs, opts = {}) {
  const { startMs, spanMs } = replayWindow(tcaMs, opts)
  if (!(spanMs > 0) || !Number.isFinite(simMs)) return 0
  return Math.min(1, Math.max(0, (simMs - startMs) / spanMs))
}

// ---------------------------------------------------------------------------
// T-minus
// ---------------------------------------------------------------------------

/**
 * Split the interval between now and a target instant into countdown parts.
 *
 * Reports `past` as a flag rather than returning a signed number of seconds: a
 * countdown that has run out must read "T+", and a caller that forgot to check
 * a sign would silently render an elapsed time as a remaining one.
 *
 * @param {number} targetMs
 * @param {number} nowMs
 * @returns {{valid: boolean, past: boolean, deltaMs: number, totalSeconds: number,
 *            days: number, hours: number, minutes: number, seconds: number}}
 */
export function tMinus(targetMs, nowMs) {
  if (!Number.isFinite(targetMs) || !Number.isFinite(nowMs)) {
    return {
      valid: false,
      past: false,
      deltaMs: NaN,
      totalSeconds: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    }
  }

  const deltaMs = targetMs - nowMs
  const total = Math.floor(Math.abs(deltaMs) / 1000)

  return {
    valid: true,
    past: deltaMs < 0,
    deltaMs,
    totalSeconds: total,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

const pad2 = (n) => String(n).padStart(2, '0')

/**
 * Render a countdown: "T-00:12:34", "T+00:01:02", "T-3d 04:05:06".
 *
 * @param {ReturnType<typeof tMinus>} t
 * @returns {string} "T-"/"T+" prefixed, or an em dash when the target is unknown
 */
export function formatTMinus(t) {
  if (!t?.valid) return '—'
  const hms = `${pad2(t.hours)}:${pad2(t.minutes)}:${pad2(t.seconds)}`
  const body = t.days > 0 ? `${t.days}d ${hms}` : hms
  return `T${t.past ? '+' : '-'}${body}`
}

/**
 * Parse a backend/wire UTC instant to epoch ms.
 *
 * Returns NaN rather than throwing or substituting `Date.now()`, so a missing
 * or malformed TCA surfaces as "—" instead of a countdown to the wrong moment.
 *
 * @param {string} iso
 * @returns {number}
 */
export function isoToMs(iso) {
  if (typeof iso !== 'string' || iso.length === 0) return NaN
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : NaN
}

// ---------------------------------------------------------------------------
// Band comparison
// ---------------------------------------------------------------------------

/**
 * Whether a computed value sits inside a reference band.
 *
 * Returns `null` — not `false` — when there is no number to check, so the UI
 * can show "not computed" rather than implying a comparison that never ran
 * came back negative.
 *
 * @param {number} value
 * @param {{min: number, max: number}} band
 * @returns {boolean|null}
 */
export function withinBand(value, band) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value >= band.min && value <= band.max
}

/**
 * Render a band for display: "81 m – 316 m".
 *
 * @param {{min: number, max: number}} band
 * @param {(v: number) => string} format
 * @returns {string}
 */
export function formatBand(band, format) {
  return `${format(band.min)} – ${format(band.max)}`
}
