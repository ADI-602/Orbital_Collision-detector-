/**
 * monitoring.js — deriving display state from a scheduled screening pass.
 *
 * The server screens the whole tracked set on a timer
 * (`backend/api/monitoring.py`) and serves the last completed pass from cache.
 * This module turns that payload into the things the panel needs to say. It is
 * separate from the component because vitest runs `environment: 'node'` with no
 * jsdom — a component cannot be rendered in a test here, but a pure function
 * can.
 *
 * IT COMPUTES NO PHYSICS. Every number it touches was produced by the
 * pipeline; this file counts, ages and phrases them. The one thing it must get
 * right is *how much* the pass actually covered, because a capped pass and a
 * complete pass look identical in a list of events and are very different
 * claims.
 *
 * NAMING: this is the physics pipeline on a timer. The AI layer is handed
 * finished results and explains them; it never runs a screening and must never
 * be named as doing so (CLAUDE.md §5.2).
 */

/** Pass lifecycle, mirroring `ScreeningRun.state` (backend/api/monitoring.py). */
export const PASS_STATE = {
  NEVER_RUN: 'never_run',
  RUNNING: 'running',
  READY: 'ready',
  FAILED: 'failed',
}

/**
 * How old the last completed pass is, in words.
 *
 * A conjunction screening is a snapshot of a moving sky, so its age is part of
 * the result — an hour-old pass with no red events is a weaker statement than a
 * one-minute-old one. Returns an em dash when there is no completed pass,
 * rather than "just now", which would date a pass that never happened.
 *
 * @param {number|null|undefined} finishedAtUnix seconds since epoch (server clock)
 * @param {number} [nowMs] milliseconds since epoch
 * @returns {string}
 */
export function formatPassAge(finishedAtUnix, nowMs = Date.now()) {
  if (typeof finishedAtUnix !== 'number' || !Number.isFinite(finishedAtUnix)) {
    return '—'
  }

  const seconds = Math.round(nowMs / 1000 - finishedAtUnix)

  // Clock skew between browser and server can put a fresh pass slightly in the
  // future. "just now" is true and "in -3 s" is not.
  if (seconds < 10) return 'just now'
  if (seconds < 90) return `${seconds} s ago`

  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} h ago`

  return `${Math.round(hours / 24)} d ago`
}

/**
 * Whether the pass screened everything it gated, and how to say so.
 *
 * `max_refine_pairs` caps how many gated pairs get the expensive refinement
 * (`screen_all_pairs`). When that cap bites, the pass has NOT screened the set
 * — it screened the closest N candidates by a coarse bound. Any "no close
 * approaches found" phrasing built on a capped pass would be a false claim of
 * coverage, so the caller must be able to distinguish the two.
 *
 * @param {object|null|undefined} stats `stats` from /api/monitoring/events
 * @returns {{ complete: boolean, text: string|null }}
 */
export function describeCoverage(stats) {
  if (!stats || typeof stats !== 'object') {
    return { complete: false, text: null }
  }

  // `truncated` must be present and explicitly false to claim completeness.
  // Testing `!stats.truncated` would read an ABSENT field as full coverage,
  // which is the one direction this function must never fail in: it would
  // assert the whole set was screened on the strength of a missing
  // measurement.
  if (typeof stats.truncated !== 'boolean') {
    return { complete: false, text: null }
  }

  const gated = Number(stats.pairs_gated) || 0
  const refined = Number(stats.pairs_refined) || 0

  if (stats.truncated === false) {
    return {
      complete: true,
      text: `${formatCount(stats.pairs_evaluated)} pairs evaluated, all ${formatCount(gated)} gated pairs refined`,
    }
  }

  return {
    complete: false,
    text:
      `Partial pass: ${formatCount(refined)} of ${formatCount(gated)} gated pairs were refined. ` +
      'The rest were ranked by a coarse lower bound and not resolved, so this is ' +
      'the closest candidates screened, not the whole set.',
  }
}

/**
 * Count what a merged event list actually contains.
 *
 * Detections and refusals are counted separately and deliberately. Folding them
 * together would report "2 conjunctions" when the true answer is "none found,
 * 2 could not be assessed" — the same distinction `assess_conjunction` is
 * careful to preserve on the wire.
 *
 * @param {object[]} events
 * @returns {{ total: number, detected: number, notAssessed: number, highRisk: number }}
 */
export function summariseEvents(events) {
  const list = Array.isArray(events) ? events : []
  let detected = 0
  let notAssessed = 0
  let highRisk = 0

  for (const event of list) {
    if (event?.unassessable) {
      notAssessed += 1
      continue
    }
    detected += 1
    if (event?.threat_level === 'RED') highRisk += 1
  }

  return { total: list.length, detected, notAssessed, highRisk }
}

/**
 * Thousands separators, so "241165 pairs evaluated" is readable on a projector.
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function formatCount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US')
}

/**
 * The schedule fields of GET /api/monitoring/status, in milliseconds.
 *
 * @param {object|null|undefined} status
 * @returns {{state: string, startedAtMs: number|null, finishedAtMs: number|null,
 *            durationMs: number|null, intervalMs: number|null}|null}
 */
export function scheduleFromStatus(status) {
  if (!status || typeof status.state !== 'string') return null
  const ms = (seconds) =>
    typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : null
  return {
    state: status.state,
    startedAtMs: ms(status.started_at_unix),
    finishedAtMs: ms(status.finished_at_unix),
    durationMs: ms(status.duration_s),
    intervalMs: ms(status.interval_s),
  }
}

/** "0:42", "12:05", "1:02:09" — a clock-style duration. */
export function formatClockDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * What the screening schedule is doing, in words, from facts the server
 * reports — never an estimated percentage. A pass that is running says how
 * long it has run and how long the last one took; an idle monitor says when
 * the next scheduled pass is due (the last finish plus the interval, which is
 * exactly how the server waits). Null when there is nothing honest to say.
 *
 * @param {ReturnType<typeof scheduleFromStatus>} schedule
 * @param {number} [nowMs]
 * @returns {{text: string, running: boolean}|null}
 */
export function describeSchedule(schedule, nowMs = Date.now()) {
  if (!schedule) return null
  if (schedule.state === PASS_STATE.RUNNING) {
    const parts = []
    if (schedule.startedAtMs !== null) {
      parts.push(`Pass running ${formatClockDuration(nowMs - schedule.startedAtMs)}`)
    } else {
      parts.push('Pass running')
    }
    if (schedule.durationMs !== null) {
      parts.push(`last took ${formatClockDuration(schedule.durationMs)}`)
    }
    return { text: parts.join(' · '), running: true }
  }
  if (schedule.state === PASS_STATE.NEVER_RUN) {
    return { text: 'First pass starting', running: false }
  }
  if (schedule.finishedAtMs === null || schedule.intervalMs === null) return null
  const dueMs = schedule.finishedAtMs + schedule.intervalMs
  return {
    text: dueMs > nowMs ? `Next pass in ${formatClockDuration(dueMs - nowMs)}` : 'Next pass due now',
    running: false,
  }
}

/**
 * One line describing the window the pass covered.
 * @param {object|null|undefined} pass
 * @returns {string|null}
 */
export function formatWindow(pass) {
  if (!pass?.window_start_utc_iso || !pass?.window_hours) return null
  return `${pass.window_start_utc_iso} + ${pass.window_hours} h`
}
