/**
 * physics.js — the deterministic pipeline endpoints
 * (backend/api/main.py:136-300). No LLM is involved in any of these; every
 * number they return comes from SGP4 propagation, TCA refinement and the
 * 2D encounter-plane Pc method.
 *
 * Timeouts are generous by necessity. /api/physics/screening passes
 * skip_coarse_filter=True (main.py:198), so every candidate gets a full
 * SGP4 fine scan over the whole window, then a second TCA refinement, then
 * a scipy B-plane integration. Cost is linear in candidate count and in
 * search_duration_hours.
 */

import { post, NotFoundError } from './client.js'

/**
 * @typedef {object} TcaResult
 * @property {string} tca_utc_iso           second resolution, "Z"-suffixed
 * @property {number} miss_distance_m
 * @property {number} miss_distance_km
 * @property {number} relative_speed_km_s
 * @property {number[]} primary_pos_eci_km   length 3
 * @property {number[]} secondary_pos_eci_km length 3
 */

/**
 * @typedef {object} ScreeningEvent
 * @property {string} secondary_name
 * @property {string} tca_utc_iso
 * @property {number} miss_distance_m
 * @property {number} pc collision probability, [0, 1]
 * @property {number} relative_speed_km_s
 * @property {import('./types.js').ThreatLevel} threat_level
 */

/**
 * @typedef {object} ScreeningResult
 * @property {string} primary_name
 * @property {number} candidates_screened
 * @property {ScreeningEvent[]} events
 */

/**
 * @typedef {object} ManeuverResult
 * @property {string} primary_name
 * @property {string} secondary_name
 * @property {number} delta_v_cm_s
 * @property {number} lead_time_minutes
 * @property {number} pre_burn_miss_distance_m
 * @property {number} post_burn_miss_distance_m
 * @property {number} pre_burn_pc
 * @property {number} post_burn_pc
 * @property {number} risk_reduction_pct
 * @property {number} fuel_consumed_kg
 * @property {boolean} maneuver_recommended    the burn REDUCES Pc. It does not
 *   assert the residual risk is acceptable — see post_burn_below_threshold.
 * @property {boolean} post_burn_below_threshold  post_burn_pc is under
 *   risk_threshold_pc, i.e. the burn resolves the conjunction rather than
 *   merely improving it.
 * @property {number} risk_threshold_pc        the threshold that was applied
 *
 * NOTE on post_burn_miss_distance_m: it is the separation at the ORIGINAL TCA
 * under the Clohessy-Wiltshire displacement (backend/physics/maneuver.py), not
 * a re-solved closest approach. Displacement along the relative-velocity
 * direction inflates it without reducing risk, which is why it can grow while
 * post_burn_pc also grows. Pc is the decision quantity; render the distance as
 * supporting detail, never as the headline.
 */

const TCA_TIMEOUT_MS = 60000
const SCREENING_TIMEOUT_MS = 180000
const MANEUVER_TIMEOUT_MS = 60000

/**
 * FastAPI's generic 404 for an unrouted path. Identical in status to the
 * legitimate "no close approach" 404, so the detail string is the only way
 * to tell them apart.
 */
const GENERIC_NOT_FOUND_DETAIL = 'Not Found'

/**
 * True when a 404 means "the physics found no close approach in the search
 * window" — a normal, displayable result — rather than a routing bug.
 *
 * Without this guard a typo'd path would render as a legitimate empty state,
 * disguising a broken request as a physics conclusion.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isNoConjunctionFound(err) {
  return err instanceof NotFoundError && err.detail !== GENERIC_NOT_FOUND_DETAIL
}

/**
 * POST /api/physics/tca — refine time of closest approach and miss distance
 * for one pair (main.py:136-173).
 *
 * Throws NotFoundError when no close approach is found; check it with
 * isNoConjunctionFound() and render an empty state rather than an error.
 *
 * @param {object} body
 * @param {import('./types.js').TleInput} body.primary
 * @param {import('./types.js').TleInput} body.secondary
 * @param {string} body.start_utc_iso           e.g. "2004-10-22T00:00:00Z"
 * @param {number} [body.search_duration_hours] defaults to 48.0 server-side
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<TcaResult>}
 */
export function computeTca(body, opts = {}) {
  return post('/api/physics/tca', body, { timeoutMs: TCA_TIMEOUT_MS, ...opts })
}

/**
 * POST /api/physics/screening — screen candidates against a primary
 * (main.py:176-246). Never returns 404: no threats means `events: []`.
 *
 * `events.length` may be less than `candidates_screened` — candidates that
 * do not flag, or whose refined TCA comes back empty, are silently skipped
 * (main.py:207-208). Match results on `secondary_name`, never on index.
 *
 * Note the server default for coarse_threshold_km is 50.0, but the only
 * value exercised by the backend test suite is 500.0
 * (tests/test_api_endpoints.py:61-77) — pass it explicitly for the Envisat
 * scenario.
 *
 * @param {object} body
 * @param {import('./types.js').TleInput} body.primary
 * @param {import('./types.js').TleInput[]} body.candidates required, may be []
 * @param {string} body.start_utc_iso
 * @param {number} [body.search_duration_hours]
 * @param {number} [body.coarse_threshold_km]
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<ScreeningResult>}
 */
export function screenCandidates(body, opts = {}) {
  return post('/api/physics/screening', body, { timeoutMs: SCREENING_TIMEOUT_MS, ...opts })
}

/**
 * POST /api/physics/maneuver — simulate an impulsive collision-avoidance
 * burn (main.py:249-300).
 *
 * The endpoint re-solves TCA within +/- 2 h of the `tca_utc_iso` you supply
 * rather than trusting it exactly, and throws NotFoundError if it cannot.
 *
 * @param {object} body
 * @param {import('./types.js').TleInput} body.primary
 * @param {import('./types.js').TleInput} body.secondary
 * @param {string} body.tca_utc_iso
 * @param {number} [body.delta_v_cm_s]      defaults to -4.0 (negative = braking)
 * @param {number} [body.lead_time_minutes] defaults to 50.0
 * @param {number} [body.sat_mass_kg]       defaults to 8200.0
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<ManeuverResult>}
 */
export function simulateManeuver(body, opts = {}) {
  return post('/api/physics/maneuver', body, { timeoutMs: MANEUVER_TIMEOUT_MS, ...opts })
}
