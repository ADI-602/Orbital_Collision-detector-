import { describe, it, expect } from 'vitest'

import { parseTleText, tleEpochUtc } from './tle.js'

// Verbatim from CelesTrak's stations group, trailing name padding included.
const SAMPLE = `ISS (ZARYA)
1 25544U 98067A   26242.49847866  .00005671  00000+0  11126-3 0  9990
2 25544  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909583274
CSS (TIANHE)
1 48274U 21035A   26242.40883656  .00019520  00000+0  24340-3 0  9994
2 48274  41.4676 231.4402 0001913 255.2624 104.8002 15.59424488304755
`

describe('parseTleText', () => {
  const records = parseTleText(SAMPLE)

  it('parses every complete block', () => {
    expect(records).toHaveLength(2)
  })

  it('trims the padded name line', () => {
    expect(records[0].name).toBe('ISS (ZARYA)')
    expect(records[1].name).toBe('CSS (TIANHE)')
  })

  it('extracts the NORAD catalog number from line 1', () => {
    expect(records[0].noradId).toBe('25544')
    expect(records[1].noradId).toBe('48274')
  })

  it('preserves both element lines verbatim for the propagator', () => {
    // satellite.js parses these by column, so any reformatting would corrupt them.
    expect(records[0].line1).toBe(
      '1 25544U 98067A   26242.49847866  .00005671  00000+0  11126-3 0  9990',
    )
    expect(records[0].line2).toBe(
      '2 25544  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909583274',
    )
  })

  it('returns an empty array for empty or non-string input', () => {
    expect(parseTleText('')).toEqual([])
    expect(parseTleText(null)).toEqual([])
    expect(parseTleText(undefined)).toEqual([])
  })

  it('keeps intact blocks when the response is truncated mid-block', () => {
    // A partial globe beats an empty one, so a torn final block is dropped
    // rather than throwing away everything that did arrive.
    const truncated = SAMPLE.trimEnd().split('\n').slice(0, 4).join('\n')
    const parsed = parseTleText(truncated)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('ISS (ZARYA)')
  })

  it('ignores blocks whose element lines are not numbered 1 and 2', () => {
    const malformed = `JUNK HEADER
not an element line
also not an element line
`
    expect(parseTleText(malformed)).toEqual([])
  })
})

describe('tleEpochUtc', () => {
  it('parses the epoch field into a UTC instant', () => {
    // 26242.49847866 -> 2026, day 242, just before midday.
    const iss = '1 25544U 98067A   26242.49847866  .00005671  00000+0  11126-3 0  9990'
    const epoch = tleEpochUtc(iss)
    expect(epoch.toISOString().slice(0, 10)).toBe('2026-08-30')
    expect(epoch.getUTCHours()).toBe(11)
  })

  it('applies the TLE two-digit year convention', () => {
    // 57-99 is the 1900s, 00-56 the 2000s.
    const y1998 = '1 25544U 98067A   98324.50000000  .00000000  00000+0  00000-0 0  9990'
    const y2004 = '1 27386U 02009A   04296.50000000  .00000000  00000+0  00000-0 0  9990'
    expect(tleEpochUtc(y1998).getUTCFullYear()).toBe(1998)
    expect(tleEpochUtc(y2004).getUTCFullYear()).toBe(2004)
  })

  it('treats day 1.0 as the very start of January 1st', () => {
    const jan1 = '1 00001U 00001A   26001.00000000  .00000000  00000+0  00000-0 0  9990'
    expect(tleEpochUtc(jan1).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('returns null rather than a guess for an unparseable field', () => {
    expect(tleEpochUtc('')).toBeNull()
    expect(tleEpochUtc('not a tle line at all, far too short')).toBeNull()
    expect(tleEpochUtc('1 25544U 98067A   XXXXX.XXXXXXXX  .00005671  00000+0  11126-3 0  9990')).toBeNull()
    expect(tleEpochUtc(null)).toBeNull()
  })
})
