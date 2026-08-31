/**
 * conjunctions.js — GET /api/conjunctions/envisat
 * (backend/api/main.py:91-133).
 *
 * IMPORTANT: this endpoint returns TLE STRINGS ONLY. It has no miss
 * distance and no Pc, despite the FastAPI docstring at main.py:95 claiming
 * it "includes ... miss distances, and pre-burn Pc". To get per-day physics
 * numbers you must POST each day's TLE pair to /api/physics/tca (miss
 * distance) or /api/physics/screening (miss distance AND Pc).
 *
 * Also note: the Oct 19 and Oct 20 Envisat TLEs are byte-identical
 * (tests/fixtures/envisat_tles.py:32-39) — those two days differ only in the
 * Zenith-2 TLE. Do not dedupe prediction days on the primary TLE.
 */

import { get } from './client.js'

/**
 * @typedef {object} PredictionDay
 * @property {string} day             "oct_19" | "oct_20" | "oct_21" | "oct_22"
 * @property {string} prediction_date "2004-10-19" ... "2004-10-22"
 * @property {string} tca_target_iso  the same constant on every day
 * @property {import('./types.js').TleInput} envisat_tle
 * @property {import('./types.js').TleInput} secondary_tle
 */

/**
 * @typedef {object} EnvisatReplayResponse
 * @property {string} event_name
 * @property {string} primary_satellite
 * @property {string} secondary_object
 * @property {number} primary_norad_id
 * @property {number} secondary_norad_id
 * @property {string} tca_utc
 * @property {PredictionDay[]} prediction_days exactly 4, in date order
 */

const REPLAY_TIMEOUT_MS = 15000

/**
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<EnvisatReplayResponse>}
 */
export function getEnvisatReplay(opts = {}) {
  return get('/api/conjunctions/envisat', { timeoutMs: REPLAY_TIMEOUT_MS, ...opts })
}
