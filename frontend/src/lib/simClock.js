/**
 * simClock.js — simulated-time arithmetic, kept pure so it is testable
 * without Cesium or a render loop.
 *
 * The console shows satellites moving visibly, which real time cannot do: a
 * LEO orbit takes ~90 minutes, so at 1:1 speed nothing appears to happen
 * during a demo. So the simulated clock runs faster than the wall clock.
 *
 * The positions themselves are never faked — they are propagated by SGP4 for
 * whatever instant the simulated clock reads. The multiplier only decides
 * WHICH instants get sampled, and it is always displayed on screen so the
 * view is never presented as literal real-time.
 */

/** Visible motion without being dizzying: one orbit in roughly 45 seconds. */
export const DEFAULT_SPEED_MULTIPLIER = 120

/**
 * Simulated instant for a given amount of elapsed real time.
 *
 * @param {Date|number} baseUtc   real time at which the sim started
 * @param {number} elapsedMs      real milliseconds since then
 * @param {number} speedMultiplier
 * @returns {Date}
 */
export function computeSimTime(baseUtc, elapsedMs, speedMultiplier = DEFAULT_SPEED_MULTIPLIER) {
  const baseMs = baseUtc instanceof Date ? baseUtc.getTime() : Number(baseUtc)
  return new Date(baseMs + elapsedMs * speedMultiplier)
}

/**
 * Format an instant for the HUD readout: "2026-08-31 09:14:02Z".
 *
 * Space-separated rather than the ISO "T" — it reads as a clock rather than
 * as a serialised value, and this string is shown to a person, not parsed.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatSimClock(date) {
  const iso = date.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`
}
