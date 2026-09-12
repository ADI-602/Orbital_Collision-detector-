import { describe, it, expect } from 'vitest'

import {
  computeCountdown,
  describeCountdown,
  formatCountdown,
  toEpochMs,
} from './countdown.js'

/** The real Envisat/Zenith-2 TCA, in the exact shape the API returns it. */
const ENVISAT_TCA = '2004-10-22T05:10:35Z'

describe('toEpochMs', () => {
  it('treats a "Z"-suffixed API timestamp as UTC, not local time', () => {
    // The assertion that matters most in this module: parse the backend's own
    // format and land on the UTC instant, whatever timezone the browser is in.
    expect(toEpochMs(ENVISAT_TCA)).toBe(Date.UTC(2004, 9, 22, 5, 10, 35))
  })

  it('honours an explicit numeric offset', () => {
    expect(toEpochMs('2004-10-22T07:10:35+02:00')).toBe(toEpochMs(ENVISAT_TCA))
    expect(toEpochMs('2004-10-22T07:10:35+0200')).toBe(toEpochMs(ENVISAT_TCA))
  })

  it('rejects a zoneless timestamp instead of localising it silently', () => {
    // ECMA-262 would parse this as local time and shift the countdown by the
    // viewer's UTC offset with no error. Loud failure is the whole point.
    expect(() => toEpochMs('2004-10-22T05:10:35')).toThrow(TypeError)
    expect(() => toEpochMs('2004-10-22T05:10:35')).toThrow(/zoneless/)
  })

  it('accepts Date and epoch-millisecond inputs', () => {
    expect(toEpochMs(new Date(ENVISAT_TCA))).toBe(Date.UTC(2004, 9, 22, 5, 10, 35))
    expect(toEpochMs(0)).toBe(0)
    expect(toEpochMs(-86400000)).toBe(-86400000)
  })

  it('returns null for a TCA that has not been computed', () => {
    expect(toEpochMs(null)).toBeNull()
    expect(toEpochMs(undefined)).toBeNull()
  })

  it('throws rather than returning a fallback for unusable input', () => {
    expect(() => toEpochMs(new Date('nonsense'))).toThrow(RangeError)
    expect(() => toEpochMs(Number.NaN)).toThrow(RangeError)
    expect(() => toEpochMs(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => toEpochMs('2004-10-22T99:99:99Z')).toThrow(RangeError)
    expect(() => toEpochMs({})).toThrow(TypeError)
    expect(() => toEpochMs(true)).toThrow(TypeError)
  })
})

describe('computeCountdown', () => {
  const now = '2004-10-22T05:00:00Z'

  it('counts down while the TCA is ahead', () => {
    const parts = computeCountdown(ENVISAT_TCA, now)
    expect(parts.phase).toBe('before')
    expect(parts.deltaMs).toBe(635_000)
    expect(parts).toMatchObject({ days: 0, hours: 0, minutes: 10, seconds: 35 })
  })

  it('counts up once the TCA has passed', () => {
    const parts = computeCountdown('2004-10-22T04:00:00Z', now)
    expect(parts.phase).toBe('after')
    expect(parts).toMatchObject({ days: 0, hours: 1, minutes: 0, seconds: 0 })
  })

  it('reads T-00:00:00 at the TCA instant itself', () => {
    const parts = computeCountdown(now, now)
    expect(parts.phase).toBe('before')
    expect(parts.totalSeconds).toBe(0)
    expect(formatCountdown(parts)).toBe('T-00:00:00')
  })

  it('rounds time remaining up, so the clock never reaches zero early', () => {
    // 500 ms left must still read one second, not zero.
    const parts = computeCountdown(Date.UTC(2004, 9, 22, 5, 0, 0, 500), now)
    expect(parts.totalSeconds).toBe(1)
  })

  it('rounds elapsed time down, so 1.9 s past reads as 1 second', () => {
    const parts = computeCountdown(Date.UTC(2004, 9, 22, 4, 59, 58, 100), now)
    expect(parts.phase).toBe('after')
    expect(parts.totalSeconds).toBe(1)
  })

  it('breaks a multi-day interval into day/hour/minute/second fields', () => {
    const parts = computeCountdown('2004-10-25T08:30:45Z', now)
    expect(parts).toMatchObject({ days: 3, hours: 3, minutes: 30, seconds: 45 })
    // Fields must reconstitute the whole interval exactly.
    expect(
      parts.days * 86400 + parts.hours * 3600 + parts.minutes * 60 + parts.seconds,
    ).toBe(parts.totalSeconds)
  })

  it('returns null when no TCA has been computed', () => {
    expect(computeCountdown(null, now)).toBeNull()
    expect(computeCountdown(undefined, now)).toBeNull()
  })

  it('refuses to run without a reference instant', () => {
    expect(() => computeCountdown(ENVISAT_TCA, null)).toThrow(TypeError)
  })

  it('is monotonic — a later "now" always leaves less time remaining', () => {
    const a = computeCountdown(ENVISAT_TCA, '2004-10-22T05:00:00Z')
    const b = computeCountdown(ENVISAT_TCA, '2004-10-22T05:05:00Z')
    expect(b.deltaMs).toBeLessThan(a.deltaMs)
  })

  it('reports the resolved instants it used', () => {
    const parts = computeCountdown(ENVISAT_TCA, now)
    expect(parts.targetMs).toBe(Date.UTC(2004, 9, 22, 5, 10, 35))
    expect(parts.nowMs).toBe(Date.UTC(2004, 9, 22, 5, 0, 0))
  })
})

describe('formatCountdown', () => {
  const now = '2004-10-22T05:00:00Z'

  it('zero-pads every clock field', () => {
    expect(formatCountdown(computeCountdown('2004-10-22T06:02:03Z', now))).toBe('T-01:02:03')
  })

  it('prefixes a day count only once the interval passes a day', () => {
    expect(formatCountdown(computeCountdown('2004-10-23T05:00:01Z', now))).toBe('T-1d 00:00:01')
    expect(formatCountdown(computeCountdown('2004-10-22T23:00:00Z', now))).toBe('T-18:00:00')
  })

  it('switches the sign after the TCA', () => {
    expect(formatCountdown(computeCountdown('2004-10-22T04:45:00Z', now))).toBe('T+00:15:00')
  })

  it('uses ASCII +/- so digits keep their column when the sign flips', () => {
    const text = formatCountdown(computeCountdown(ENVISAT_TCA, now))
    expect(text).toMatch(/^T-/)
    expect(text).not.toContain('−')
  })

  it('renders an em dash when there is no countdown', () => {
    expect(formatCountdown(null)).toBe('—')
  })
})

describe('describeCountdown', () => {
  const now = '2004-10-22T05:00:00Z'

  it('spells out the interval for screen readers', () => {
    expect(describeCountdown(computeCountdown(ENVISAT_TCA, now))).toBe(
      'T minus 10 minutes 35 seconds until closest approach',
    )
  })

  it('singularises a one-unit field', () => {
    expect(describeCountdown(computeCountdown('2004-10-22T05:00:01Z', now))).toBe(
      'T minus 1 second until closest approach',
    )
  })

  it('omits zero fields but never renders an empty duration', () => {
    expect(describeCountdown(computeCountdown(now, now))).toBe(
      'T minus 0 seconds until closest approach',
    )
  })

  it('says "since" once the TCA has passed', () => {
    expect(describeCountdown(computeCountdown('2004-10-22T04:00:00Z', now))).toBe(
      'T plus 1 hour since closest approach',
    )
  })

  it('states plainly when no TCA exists', () => {
    expect(describeCountdown(null)).toBe('No time of closest approach computed')
  })
})
