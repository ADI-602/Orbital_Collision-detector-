import { describe, it, expect } from 'vitest'

import {
  comparePublished,
  isWithinPublished,
  predictionDay,
  PREDICTION_DAYS,
  PUBLISHED_MISS_DISTANCE_M,
  PUBLISHED_PC,
  PUBLISHED_TCA_ISO,
  PC_ACCEPTED_THRESHOLD,
} from './envisatGroundTruth.js'

/**
 * These assert the transcription itself, not just the helpers. If someone
 * edits a published constant, this suite fails and points them back at
 * docs/validation-notes.md §4 rather than letting the demo quietly compare
 * against a number the paper never printed.
 */
describe('published constants', () => {
  it('matches the paper as transcribed in validation-notes §4.2', () => {
    expect(PUBLISHED_TCA_ISO).toBe('2004-10-22T05:10:35Z')
    expect(PUBLISHED_MISS_DISTANCE_M).toEqual({ min: 81, max: 316 })
    expect(PUBLISHED_PC).toEqual({ min: 1.4e-4, max: 5.5e-4 })
    expect(PC_ACCEPTED_THRESHOLD).toBe(1e-4)
  })

  it('carries the four prediction days in chronological order', () => {
    expect(PREDICTION_DAYS.map((d) => d.day)).toEqual([
      'oct_19',
      'oct_20',
      'oct_21',
      'oct_22',
    ])
    expect(PREDICTION_DAYS.map((d) => d.lead)).toEqual(['T-3d', 'T-2d', 'T-1d', 'T-0d'])
  })
})

describe('isWithinPublished', () => {
  it('accepts values inside the band, inclusive of both bounds', () => {
    expect(isWithinPublished(200, PUBLISHED_MISS_DISTANCE_M)).toBe(true)
    expect(isWithinPublished(81, PUBLISHED_MISS_DISTANCE_M)).toBe(true)
    expect(isWithinPublished(316, PUBLISHED_MISS_DISTANCE_M)).toBe(true)
  })

  it('rejects values outside it', () => {
    expect(isWithinPublished(80.9, PUBLISHED_MISS_DISTANCE_M)).toBe(false)
    expect(isWithinPublished(329.1, PUBLISHED_MISS_DISTANCE_M)).toBe(false)
  })

  it('returns null rather than false when there is no value to judge', () => {
    // A missing number rendering as "outside published range" would claim a
    // disagreement that does not exist.
    expect(isWithinPublished(null, PUBLISHED_PC)).toBeNull()
    expect(isWithinPublished(undefined, PUBLISHED_PC)).toBeNull()
    expect(isWithinPublished(Number.NaN, PUBLISHED_PC)).toBeNull()
    expect(isWithinPublished('200', PUBLISHED_PC)).toBeNull()
  })
})

describe('comparePublished', () => {
  /**
   * The real pipeline outputs, probed from a live backend on 2026-09-12 and
   * matching docs/validation-notes.md §4.4 to within a metre. Two of the four
   * days sit ABOVE the published Pc band — that is a genuine, documented
   * consequence of applying TLE covariance to both objects, and the UI has to
   * report it as "outside", never round it into agreement.
   */
  const computed = {
    oct_19: { miss_m: 329.1, pc: 2.74e-4 },
    oct_20: { miss_m: 234.1, pc: 1.115e-3 },
    oct_21: { miss_m: 151.8, pc: 1.93e-3 },
    oct_22: { miss_m: 268.9, pc: 6.591e-4 },
  }

  it('places three of four computed miss distances inside the published band', () => {
    expect(comparePublished(computed.oct_19.miss_m, PUBLISHED_MISS_DISTANCE_M)).toBe('outside')
    expect(comparePublished(computed.oct_20.miss_m, PUBLISHED_MISS_DISTANCE_M)).toBe('within')
    expect(comparePublished(computed.oct_21.miss_m, PUBLISHED_MISS_DISTANCE_M)).toBe('within')
    expect(comparePublished(computed.oct_22.miss_m, PUBLISHED_MISS_DISTANCE_M)).toBe('within')
  })

  it('reports the two Pc values that exceed the published band as outside', () => {
    expect(comparePublished(computed.oct_19.pc, PUBLISHED_PC)).toBe('within')
    expect(comparePublished(computed.oct_20.pc, PUBLISHED_PC)).toBe('outside')
    expect(comparePublished(computed.oct_21.pc, PUBLISHED_PC)).toBe('outside')
    expect(comparePublished(computed.oct_22.pc, PUBLISHED_PC)).toBe('outside')
  })

  it('every computed Pc still exceeds the operational threshold that forced the burn', () => {
    for (const { pc } of Object.values(computed)) {
      expect(pc).toBeGreaterThan(PC_ACCEPTED_THRESHOLD)
    }
  })

  it('says "unknown" when there is no value', () => {
    expect(comparePublished(null, PUBLISHED_PC)).toBe('unknown')
  })
})

describe('predictionDay', () => {
  it('resolves an API day key to its label and lead time', () => {
    expect(predictionDay('oct_21')).toEqual({ day: 'oct_21', label: 'Oct 21', lead: 'T-1d' })
  })

  it('returns null for an unknown key rather than guessing', () => {
    expect(predictionDay('oct_23')).toBeNull()
  })
})
