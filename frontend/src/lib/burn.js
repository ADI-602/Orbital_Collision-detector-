/**
 * burn.js — rules about maneuver results that must not live inside a render.
 */

/**
 * Does a maneuver result describe the burn currently set on the controls?
 *
 * The failure this prevents is quiet and complete: the slider reads -6.0 cm/s,
 * the panel still shows the -4.0 cm/s answer, and nothing says so. Someone
 * reads a risk reduction off a burn nobody selected.
 *
 * The comparison uses the parameters the ENDPOINT echoed back, not values this
 * app remembers sending, so a request that was reshaped, coerced or clamped on
 * the way through still compares honestly against what the controls show.
 *
 * A missing result is not stale — there is nothing on screen to mislabel.
 *
 * @param {{delta_v_cm_s: number, lead_time_minutes: number}|null|undefined} result
 * @param {number} deltaVCmS        current control position
 * @param {number} leadTimeMinutes  current control position
 * @returns {boolean}
 */
export function isResultStale(result, deltaVCmS, leadTimeMinutes) {
  if (!result) return false
  return (
    result.delta_v_cm_s !== deltaVCmS ||
    result.lead_time_minutes !== leadTimeMinutes
  )
}
