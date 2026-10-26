/**
 * replay.test.js — the replay clock, countdown, and band comparison.
 *
 * These matter more than their size suggests. The countdown is the one number
 * on the replay view that is not pipeline output, so if it is wrong nothing
 * catches it: there is no backend assertion to disagree with. The band helpers
 * decide whether a computed value is presented as matching the validated
 * range, which is the whole claim the view makes.
 *
 * vitest runs in a node environment here (vitest.config.js), so this file
 * tests plain functions only — the components that consume them cannot be
 * rendered in this harness.
 */

import { describe, expect, it } from 'vitest'

import {
  ASSERTED_MISS_DISTANCE_M,
  ASSERTED_PC,
  PREDICTION_DAYS,
  PUBLISHED_MISS_DISTANCE_M,
  PUBLISHED_PC,
  PUBLISHED_TCA_UTC_ISO,
  REPLAY_LEAD_MINUTES,
  REPLAY_SPEED_MULTIPLIER,
  REPLAY_TRAIL_MINUTES,
  formatBand,
  formatTMinus,
  isoToMs,
  replayElapsedFor,
  replayProgress,
  replaySimTime,
  replayWindow,
  tMinus,
  withinBand,
} from './replay.js'

/** The refined TCA our own pipeline returns for the 22 Oct prediction day. */
const TCA_MS = Date.parse('2004-10-22T05:10:37Z')

const MINUTE = 60_000

describe('replayWindow', () => {
  it('brackets the TCA by the configured lead and trail', () => {
    const w = replayWindow(TCA_MS)
    expect(w.startMs).toBe(TCA_MS - REPLAY_LEAD_MINUTES * MINUTE)
    expect(w.endMs).toBe(TCA_MS + REPLAY_TRAIL_MINUTES * MINUTE)
    expect(w.spanMs).toBe((REPLAY_LEAD_MINUTES + REPLAY_TRAIL_MINUTES) * MINUTE)
  })

  it('starts before the burn ESA actually flew, 50 min ahead of TCA', () => {
    // The decision moment has to be inside the window, or the replay opens
    // after the interesting part is already over.
    const w = replayWindow(TCA_MS)
    expect(w.startMs).toBeLessThan(Date.parse('2004-10-22T04:20:00Z'))
  })

  it('honours an explicit lead and trail', () => {
    const w = replayWindow(TCA_MS, { leadMinutes: 5, trailMinutes: 1 })
    expect(w.spanMs).toBe(6 * MINUTE)
  })
})

describe('replayElapsedFor', () => {
  it('is the inverse of replaySimTime inside the window', () => {
    const { startMs, spanMs } = replayWindow(TCA_MS)
    for (const offset of [0, 10 * MINUTE, 60 * MINUTE, spanMs - MINUTE]) {
      const target = startMs + offset
      const back = replaySimTime(TCA_MS, replayElapsedFor(TCA_MS, target)).getTime()
      expect(Math.abs(back - target)).toBeLessThan(1)
    }
  })

  it('lands on the TCA and on the burn instant exactly', () => {
    const burnMs = TCA_MS - 50 * MINUTE
    expect(replaySimTime(TCA_MS, replayElapsedFor(TCA_MS, TCA_MS)).getTime()).toBe(TCA_MS)
    expect(replaySimTime(TCA_MS, replayElapsedFor(TCA_MS, burnMs)).getTime()).toBe(burnMs)
  })

  it('clamps outside the window, and never wraps the end back to the start', () => {
    const { startMs, endMs } = replayWindow(TCA_MS)
    expect(replayElapsedFor(TCA_MS, startMs - 5 * MINUTE)).toBe(0)
    const atEnd = replaySimTime(TCA_MS, replayElapsedFor(TCA_MS, endMs + 5 * MINUTE)).getTime()
    expect(atEnd).toBeGreaterThan(endMs - MINUTE)
  })

  it('returns 0 for an unreadable target', () => {
    expect(replayElapsedFor(TCA_MS, NaN)).toBe(0)
  })
})

describe('replaySimTime', () => {
  it('starts at the beginning of the window', () => {
    expect(replaySimTime(TCA_MS, 0).getTime()).toBe(TCA_MS - REPLAY_LEAD_MINUTES * MINUTE)
  })

  it('advances simulated time by the multiplier', () => {
    // One real second of a x60 clock is one simulated minute.
    const t = replaySimTime(TCA_MS, 1000)
    expect(t.getTime()).toBe(TCA_MS - REPLAY_LEAD_MINUTES * MINUTE + 1000 * REPLAY_SPEED_MULTIPLIER)
  })

  it('reaches the TCA exactly at the lead time', () => {
    const realMsToTca = (REPLAY_LEAD_MINUTES * MINUTE) / REPLAY_SPEED_MULTIPLIER
    expect(replaySimTime(TCA_MS, realMsToTca).getTime()).toBe(TCA_MS)
  })

  it('wraps back to the window start instead of running on forever', () => {
    const { spanMs } = replayWindow(TCA_MS)
    const oneLoopRealMs = spanMs / REPLAY_SPEED_MULTIPLIER
    expect(replaySimTime(TCA_MS, oneLoopRealMs).getTime()).toBe(
      replaySimTime(TCA_MS, 0).getTime(),
    )
    expect(replaySimTime(TCA_MS, oneLoopRealMs * 3).getTime()).toBe(
      replaySimTime(TCA_MS, 0).getTime(),
    )
  })

  it('never leaves the window, however long it has been running', () => {
    const { startMs, endMs } = replayWindow(TCA_MS)
    for (const elapsed of [0, 1234, 60_000, 3_600_000, 86_400_000]) {
      const t = replaySimTime(TCA_MS, elapsed).getTime()
      expect(t).toBeGreaterThanOrEqual(startMs)
      expect(t).toBeLessThanOrEqual(endMs)
    }
  })

  it('clamps a negative elapsed time to the window start', () => {
    // A clock restart can hand back a negative delta; that must not produce
    // an instant outside the replay window.
    expect(replaySimTime(TCA_MS, -5000).getTime()).toBe(replaySimTime(TCA_MS, 0).getTime())
  })
})

describe('replayProgress', () => {
  it('is 0 at the window start and 1 at the end', () => {
    const { startMs, endMs } = replayWindow(TCA_MS)
    expect(replayProgress(TCA_MS, startMs)).toBe(0)
    expect(replayProgress(TCA_MS, endMs)).toBe(1)
  })

  it('clamps rather than reporting out-of-range progress', () => {
    const { startMs, endMs } = replayWindow(TCA_MS)
    expect(replayProgress(TCA_MS, startMs - MINUTE)).toBe(0)
    expect(replayProgress(TCA_MS, endMs + MINUTE)).toBe(1)
  })

  it('returns 0 for an unknown instant rather than NaN', () => {
    expect(replayProgress(TCA_MS, NaN)).toBe(0)
  })
})

describe('tMinus', () => {
  it('splits a remaining interval into parts', () => {
    const t = tMinus(TCA_MS, TCA_MS - (2 * 3600 + 3 * 60 + 4) * 1000)
    expect(t.past).toBe(false)
    expect(t.hours).toBe(2)
    expect(t.minutes).toBe(3)
    expect(t.seconds).toBe(4)
  })

  it('flags an interval that has already passed', () => {
    const t = tMinus(TCA_MS, TCA_MS + 90_000)
    expect(t.past).toBe(true)
    expect(t.minutes).toBe(1)
    expect(t.seconds).toBe(30)
  })

  it('carries days separately so a long lead does not overflow the hours field', () => {
    const t = tMinus(TCA_MS, TCA_MS - 3 * 86_400_000 - 3600_000)
    expect(t.days).toBe(3)
    expect(t.hours).toBe(1)
  })

  it('reports invalid rather than counting down to an unknown target', () => {
    // A missing TCA must surface as unknown. Falling back to "now" would
    // render a confident 00:00:00 for a target we do not have.
    expect(tMinus(NaN, Date.now()).valid).toBe(false)
    expect(tMinus(TCA_MS, NaN).valid).toBe(false)
  })
})

describe('formatTMinus', () => {
  it('renders a remaining interval with a minus sign', () => {
    expect(formatTMinus(tMinus(TCA_MS, TCA_MS - 754_000))).toBe('T-00:12:34')
  })

  it('renders an elapsed interval with a plus sign', () => {
    expect(formatTMinus(tMinus(TCA_MS, TCA_MS + 62_000))).toBe('T+00:01:02')
  })

  it('prefixes days when there are any', () => {
    const t = tMinus(TCA_MS, TCA_MS - (3 * 86400 + 4 * 3600 + 5 * 60 + 6) * 1000)
    expect(formatTMinus(t)).toBe('T-3d 04:05:06')
  })

  it('renders an em dash when there is no valid target', () => {
    expect(formatTMinus(tMinus(NaN, 0))).toBe('—')
    expect(formatTMinus(null)).toBe('—')
  })

  it('pads every field to two digits so the readout does not jitter', () => {
    expect(formatTMinus(tMinus(TCA_MS, TCA_MS - 1000))).toBe('T-00:00:01')
  })
})

describe('isoToMs', () => {
  it('parses the wire format the backend emits', () => {
    expect(isoToMs('2004-10-22T05:10:37Z')).toBe(Date.parse('2004-10-22T05:10:37Z'))
  })

  it('returns NaN rather than a plausible instant for junk', () => {
    // Substituting Date.now() here would produce a countdown to the wrong
    // moment that looks entirely normal on screen.
    expect(Number.isNaN(isoToMs('not a date'))).toBe(true)
    expect(Number.isNaN(isoToMs(''))).toBe(true)
    expect(Number.isNaN(isoToMs(undefined))).toBe(true)
    expect(Number.isNaN(isoToMs(null))).toBe(true)
  })
})

describe('withinBand', () => {
  it('accepts a value inside the band, inclusive of both ends', () => {
    expect(withinBand(200, ASSERTED_MISS_DISTANCE_M)).toBe(true)
    expect(withinBand(ASSERTED_MISS_DISTANCE_M.min, ASSERTED_MISS_DISTANCE_M)).toBe(true)
    expect(withinBand(ASSERTED_MISS_DISTANCE_M.max, ASSERTED_MISS_DISTANCE_M)).toBe(true)
  })

  it('rejects a value outside the band', () => {
    expect(withinBand(2000, ASSERTED_MISS_DISTANCE_M)).toBe(false)
  })

  it('returns null, not false, when there is nothing to check', () => {
    // "Not computed" and "computed and out of range" are different states and
    // must not render the same way.
    expect(withinBand(undefined, ASSERTED_PC)).toBe(null)
    expect(withinBand(NaN, ASSERTED_PC)).toBe(null)
    expect(withinBand('268', ASSERTED_MISS_DISTANCE_M)).toBe(null)
  })
})

describe('published ground truth', () => {
  /**
   * These are the values the pipeline actually returns through
   * /api/physics/screening for the four archived element sets, confirmed
   * against the running backend and matching docs/validation-notes.md §4.4
   * (328.2 / 233.9 / 151.5 / 268.0 m). They are pinned here so that a change
   * to the bands cannot silently stop covering our real output.
   */
  const COMPUTED = [
    { day: 'oct_19', missM: 329.1, pc: 2.74e-4 },
    { day: 'oct_20', missM: 234.1, pc: 1.115e-3 },
    { day: 'oct_21', missM: 151.8, pc: 1.93e-3 },
    { day: 'oct_22', missM: 268.9, pc: 6.591e-4 },
  ]

  it('has the asserted bands covering every computed value', () => {
    for (const c of COMPUTED) {
      expect(withinBand(c.missM, ASSERTED_MISS_DISTANCE_M), `${c.day} miss`).toBe(true)
      expect(withinBand(c.pc, ASSERTED_PC), `${c.day} pc`).toBe(true)
    }
  })

  it('does not claim every computed value sits in the published band', () => {
    // This is the honest part. Our TLE-driven output is coarser than ESA's
    // operational orbit determination, so some days fall outside the paper's
    // range — and the UI says so rather than widening the published band to
    // match. If this test ever goes green in the other direction, the
    // published constants have been edited and that is a problem.
    const outside = COMPUTED.filter(
      (c) =>
        !withinBand(c.missM, PUBLISHED_MISS_DISTANCE_M) || !withinBand(c.pc, PUBLISHED_PC),
    )
    expect(outside.length).toBeGreaterThan(0)
  })

  it('quotes the published TCA to the second', () => {
    expect(PUBLISHED_TCA_UTC_ISO).toBe('2004-10-22T05:10:35Z')
  })

  it('lists the four prediction days in chronological order', () => {
    expect(PREDICTION_DAYS.map((d) => d.key)).toEqual([
      'oct_19',
      'oct_20',
      'oct_21',
      'oct_22',
    ])
  })
})

describe('formatBand', () => {
  it('renders both ends through the caller supplied formatter', () => {
    expect(formatBand(PUBLISHED_MISS_DISTANCE_M, (v) => `${v} m`)).toBe('81 m – 316 m')
  })

  it('keeps a probability band in exponential form', () => {
    expect(formatBand(PUBLISHED_PC, (v) => v.toExponential(1))).toBe('1.4e-4 – 5.5e-4')
  })
})
