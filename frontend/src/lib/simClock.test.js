import { describe, it, expect } from 'vitest'

import { DEFAULT_SPEED_MULTIPLIER, computeSimTime, formatSimClock } from './simClock.js'

const BASE = new Date('2026-08-31T09:00:00.000Z')

describe('computeSimTime', () => {
  it('returns the base instant when no real time has elapsed', () => {
    expect(computeSimTime(BASE, 0).toISOString()).toBe('2026-08-31T09:00:00.000Z')
  })

  it('advances by elapsed real time multiplied by the speed factor', () => {
    // 1 real second at x120 => 2 simulated minutes
    expect(computeSimTime(BASE, 1000, 120).toISOString()).toBe('2026-08-31T09:02:00.000Z')
  })

  it('runs at wall-clock speed when the multiplier is 1', () => {
    expect(computeSimTime(BASE, 5000, 1).toISOString()).toBe('2026-08-31T09:00:05.000Z')
  })

  it('accepts a numeric epoch as the base', () => {
    expect(computeSimTime(BASE.getTime(), 1000, 60).toISOString()).toBe('2026-08-31T09:01:00.000Z')
  })

  it('defaults to the exported multiplier', () => {
    const withDefault = computeSimTime(BASE, 1000)
    const explicit = computeSimTime(BASE, 1000, DEFAULT_SPEED_MULTIPLIER)
    expect(withDefault.getTime()).toBe(explicit.getTime())
  })

  it('is monotonic — later elapsed time never yields an earlier instant', () => {
    const a = computeSimTime(BASE, 1000)
    const b = computeSimTime(BASE, 2000)
    expect(b.getTime()).toBeGreaterThan(a.getTime())
  })
})

describe('formatSimClock', () => {
  it('renders a readable UTC clock string', () => {
    expect(formatSimClock(new Date('2026-08-31T09:14:02.000Z'))).toBe('2026-08-31 09:14:02Z')
  })

  it('drops sub-second precision', () => {
    expect(formatSimClock(new Date('2026-08-31T09:14:02.987Z'))).toBe('2026-08-31 09:14:02Z')
  })
})
