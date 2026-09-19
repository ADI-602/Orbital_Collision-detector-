import { describe, it, expect } from 'vitest'

import { isResultStale } from './burn.js'

const result = { delta_v_cm_s: -4, lead_time_minutes: 50 }

describe('isResultStale', () => {
  it('is fresh when the result matches both controls', () => {
    expect(isResultStale(result, -4, 50)).toBe(false)
  })

  it('is stale when the delta-V has moved', () => {
    expect(isResultStale(result, -6, 50)).toBe(true)
  })

  it('is stale when the lead time has moved', () => {
    expect(isResultStale(result, -4, 75)).toBe(true)
  })

  it('catches a half-step change, not just a large one', () => {
    // The slider steps in 0.5 cm/s; a change that small still means the
    // numbers belong to a different burn.
    expect(isResultStale(result, -4.5, 50)).toBe(true)
  })

  it('treats a sign flip as stale', () => {
    // Retrograde and prograde are opposite manoeuvres — mislabelling across
    // this boundary would invert what the panel claims is being done.
    expect(isResultStale(result, 4, 50)).toBe(true)
  })

  it('is not stale when there is no result to mislabel', () => {
    expect(isResultStale(null, -4, 50)).toBe(false)
    expect(isResultStale(undefined, -4, 50)).toBe(false)
  })
})
