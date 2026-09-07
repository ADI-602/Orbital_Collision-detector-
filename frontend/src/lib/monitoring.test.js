import { describe, expect, it } from 'vitest'

import {
  PASS_STATE,
  describeCoverage,
  formatCount,
  formatPassAge,
  formatWindow,
  summariseEvents,
} from './monitoring.js'

/**
 * Tests for the scheduled-screening display logic.
 *
 * The load-bearing case is `describeCoverage`. A pass whose refinement was
 * capped screened the closest candidates, not the set — and the panel builds
 * its "no close approaches found" phrasing on that distinction. If this test
 * goes green while the coverage claim is wrong, the console will state a
 * coverage guarantee the pipeline did not make.
 *
 * Fixtures mirror the wire shapes in `backend/api/monitoring.py` (`ScreeningRun`)
 * and `backend/physics/screening.py` (`screen_all_pairs` stats).
 */

/** Stats from a real 695-object pass — the measured numbers in CLAUDE.md §5. */
const COMPLETE_STATS = {
  objects_in: 695,
  objects_propagated: 695,
  pairs_evaluated: 241165,
  pairs_gated: 12300,
  pairs_refined: 12300,
  truncated: false,
}

const TRUNCATED_STATS = { ...COMPLETE_STATS, pairs_refined: 300, truncated: true }

describe('formatPassAge', () => {
  const NOW = 1_756_000_000_000 // ms

  it('reports a fresh pass as "just now"', () => {
    expect(formatPassAge(NOW / 1000 - 3, NOW)).toBe('just now')
  })

  it('counts seconds, then minutes, then hours, then days', () => {
    expect(formatPassAge(NOW / 1000 - 45, NOW)).toBe('45 s ago')
    expect(formatPassAge(NOW / 1000 - 600, NOW)).toBe('10 min ago')
    expect(formatPassAge(NOW / 1000 - 7200, NOW)).toBe('2 h ago')
    expect(formatPassAge(NOW / 1000 - 3 * 86400, NOW)).toBe('3 d ago')
  })

  it('says "just now" rather than a negative age when the server clock leads', () => {
    // Browser and server clocks disagree by a few seconds routinely. "in -4 s"
    // would look like a bug in the pipeline rather than in the clocks.
    expect(formatPassAge(NOW / 1000 + 4, NOW)).toBe('just now')
  })

  it('returns an em dash when no pass has completed', () => {
    // Never "just now" — that would date a pass that never happened.
    expect(formatPassAge(null, NOW)).toBe('—')
    expect(formatPassAge(undefined, NOW)).toBe('—')
    expect(formatPassAge(Number.NaN, NOW)).toBe('—')
  })
})

describe('describeCoverage', () => {
  it('calls an untruncated pass complete', () => {
    const { complete, text } = describeCoverage(COMPLETE_STATS)
    expect(complete).toBe(true)
    expect(text).toContain('241,165')
  })

  it('refuses to call a truncated pass complete', () => {
    const { complete } = describeCoverage(TRUNCATED_STATS)
    expect(complete).toBe(false)
  })

  it('names both the refined and the gated count on a truncated pass', () => {
    // The gap between the two IS the claim being weakened, so both numbers
    // have to be on screen — "partial" alone does not say how partial.
    const { text } = describeCoverage(TRUNCATED_STATS)
    expect(text).toContain('300')
    expect(text).toContain('12,300')
    expect(text).toMatch(/not the whole set/i)
  })

  it('does not claim completeness when there are no stats at all', () => {
    // Missing stats must never default to "complete" — an absent measurement
    // is not evidence of full coverage.
    expect(describeCoverage(null).complete).toBe(false)
    expect(describeCoverage(undefined).complete).toBe(false)
    expect(describeCoverage({}).complete).toBe(false)
    expect(describeCoverage(null).text).toBeNull()
  })
})

describe('summariseEvents', () => {
  const detection = (threat) => ({ threat_level: threat, pc: 1e-4 })
  const refused = { unassessable: true, reason: 'relative velocity is zero' }

  it('counts detections and refusals separately', () => {
    const s = summariseEvents([detection('GREEN'), refused, detection('RED')])
    expect(s.total).toBe(3)
    expect(s.detected).toBe(2)
    expect(s.notAssessed).toBe(1)
  })

  it('does not count a refused pair as high risk', () => {
    // A refusal carries no threat_level, and inventing one would turn a
    // docked pair into a red alert on stage.
    const s = summariseEvents([refused, refused])
    expect(s.detected).toBe(0)
    expect(s.highRisk).toBe(0)
  })

  it('counts only RED as high risk', () => {
    const s = summariseEvents([detection('RED'), detection('YELLOW'), detection('GREEN')])
    expect(s.highRisk).toBe(1)
  })

  it('survives a missing or malformed list', () => {
    expect(summariseEvents(undefined)).toEqual({
      total: 0, detected: 0, notAssessed: 0, highRisk: 0,
    })
    expect(summariseEvents(null).total).toBe(0)
  })
})

describe('formatCount', () => {
  it('groups thousands so a six-figure pair count is readable', () => {
    expect(formatCount(241165)).toBe('241,165')
    expect(formatCount(0)).toBe('0')
  })

  it('returns an em dash for a missing count rather than "0"', () => {
    expect(formatCount(null)).toBe('—')
    expect(formatCount(undefined)).toBe('—')
  })
})

describe('formatWindow', () => {
  it('states the window the pass covered', () => {
    expect(formatWindow({ window_start_utc_iso: '2026-09-06T10:00:00Z', window_hours: 24 }))
      .toBe('2026-09-06T10:00:00Z + 24 h')
  })

  it('returns null when the pass has no window', () => {
    expect(formatWindow({ state: PASS_STATE.NEVER_RUN })).toBeNull()
    expect(formatWindow(null)).toBeNull()
  })
})
