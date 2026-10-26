import { describe, it, expect } from 'vitest'

import { parseTleText } from './tle.js'

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
