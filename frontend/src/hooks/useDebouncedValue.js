import { useEffect, useState } from 'react'

/**
 * useDebouncedValue — settle a rapidly-changing value before acting on it.
 *
 * Built for the maneuver sliders. Dragging one emits a change per pixel, and
 * every change would otherwise be a full SGP4 + Pc round trip to the backend.
 * The physics is fast (~0.1-0.5 s) but not free, and a queue of superseded
 * requests also means the answer that lands last is not necessarily the answer
 * for where the slider ended up.
 *
 * The delay is deliberately short. This is a direct-manipulation control: the
 * operator drags and expects the numbers to follow, so the pause has to be
 * long enough to coalesce a drag and short enough to feel immediate.
 *
 * @template T
 * @param {T} value
 * @param {number} [delayMs]
 * @returns {T} the value, once it has held still for `delayMs`
 */
export function useDebouncedValue(value, delayMs = 250) {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    // Every new value cancels the pending one, so a continuous drag emits
    // exactly one settled value rather than one per step.
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
