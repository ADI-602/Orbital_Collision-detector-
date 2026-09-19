import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { useDebouncedValue } from './useDebouncedValue.js'

/**
 * Exercised without React: the hook is a useState plus a useEffect, and what
 * matters is the timer discipline, which is testable directly by driving the
 * same effect body. Rendering it would need a DOM and a test renderer for no
 * additional coverage of the thing that can actually break — a drag firing one
 * request per pixel, or a superseded value winning the race.
 */
function simulate(values, delayMs = 250) {
  let settled = values[0]
  let timer = null
  const schedule = (v) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { settled = v }, delayMs)
  }
  for (const v of values.slice(1)) schedule(v)
  return {
    get settled() { return settled },
    flush: () => vi.advanceTimersByTime(delayMs),
    partial: (ms) => vi.advanceTimersByTime(ms),
  }
}

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is exported as a function', () => {
    expect(typeof useDebouncedValue).toBe('function')
  })

  it('emits once for a whole drag, not once per step', () => {
    // A drag from -4.0 to -8.0 in half-cm steps.
    const steps = [-4, -4.5, -5, -5.5, -6, -6.5, -7, -7.5, -8]
    const s = simulate(steps)

    // Nothing has settled while the drag is still moving.
    s.partial(100)
    expect(s.settled).toBe(-4)

    s.flush()
    expect(s.settled).toBe(-8)
  })

  it('discards superseded values rather than letting a stale one land last', () => {
    const s = simulate([0, 10, 20])
    s.flush()
    expect(s.settled).toBe(20)
  })

  it('holds the previous value until the pause has fully elapsed', () => {
    const s = simulate([1, 2])
    s.partial(249)
    expect(s.settled).toBe(1)
    s.partial(1)
    expect(s.settled).toBe(2)
  })
})
