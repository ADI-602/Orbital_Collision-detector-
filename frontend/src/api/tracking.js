/**
 * tracking.js — the tracked set and the continuous-monitoring endpoints
 * (backend/api/main.py, documented in docs/api_contract.md §8).
 *
 * WHY THE SERVER OWNS THE TRACKED SET. The browser used to fetch TLEs from
 * CelesTrak itself. That stopped working once screening moved server-side: the
 * monitor screens whatever set the server holds, so if the browser drew a
 * different fetch, an event could name objects that are not on the globe and
 * selecting it would highlight nothing. One set, one source.
 *
 * The browser still propagates those element sets locally with satellite.js
 * for smooth animation — it just no longer decides which objects exist.
 *
 * SCREENING IS NOT A REQUEST. A full all-pairs pass takes minutes to hours, so
 * `getMonitoringEvents` returns the last COMPLETED pass from cache and returns
 * immediately. `refreshMonitoring` asks for a new pass and also returns
 * immediately; poll `getMonitoringStatus` to watch it finish. Nothing here
 * blocks on the physics.
 *
 * NOTE ON NAMING: this is the physics pipeline on a timer. The AI layer is
 * handed completed results afterwards and explains them. Never label any of
 * this "AI monitoring" in the UI — it inverts the project's central claim.
 */

import { get, post } from './client.js'

/**
 * @typedef {object} TrackedObject
 * @property {string} id       tracked-set id, used as the globe entity id
 * @property {string} name
 * @property {string} norad_id
 * @property {string} line1    raw TLE, re-propagated in-browser for rendering
 * @property {string} line2
 */

/**
 * @typedef {object} TrackedObjectsResponse
 * @property {TrackedObject[]} objects
 * @property {number} count
 * @property {string[]} groups          CelesTrak groups forming the set
 * @property {'live'|'cached'|'none'} source  where the SERVER got them
 * @property {number} fetched_at_unix
 * @property {Array<{name: string, reason: string}>} rejected
 *   element sets that would not parse. They never reached the pipeline, so
 *   they cannot appear as "no conjunction found" — surface them as rejected.
 * @property {string|null} error
 */

/**
 * @typedef {object} ScreeningStats
 * @property {number} objects_in
 * @property {number} objects_propagated
 * @property {number} pairs_evaluated
 * @property {number} pairs_gated
 * @property {number} pairs_refined
 * @property {boolean} truncated  refinement was capped — the pass is NOT a
 *   complete screening of the set, and the UI must be able to say so
 */

/** The set can be large, and it is one big JSON payload of raw TLEs. */
const OBJECTS_TIMEOUT_MS = 30000

/** Status and alerts are polled, so they must fail fast. */
const POLL_TIMEOUT_MS = 8000

/** Events is the same cached payload every time — no physics runs on this call. */
const EVENTS_TIMEOUT_MS = 15000

/**
 * The catalogue the console tracks.
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<TrackedObjectsResponse>}
 */
export function getTrackedObjects(opts = {}) {
  return get('/api/tracking/objects', { timeoutMs: OBJECTS_TIMEOUT_MS, ...opts })
}

/**
 * State of the scheduled screening, without the events. Cheap to poll.
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<object>}
 */
export function getMonitoringStatus(opts = {}) {
  return get('/api/monitoring/status', { timeoutMs: POLL_TIMEOUT_MS, ...opts })
}

/**
 * Conjunctions from the last completed pass, served from cache.
 *
 * Events are already ranked most-urgent-first by the server (assessed before
 * refused, then threat band, then Pc). Check `stats.truncated` before
 * describing the result as a complete screening.
 *
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<object>}
 */
export function getMonitoringEvents(opts = {}) {
  return get('/api/monitoring/events', { timeoutMs: EVENTS_TIMEOUT_MS, ...opts })
}

/**
 * High-risk events first seen since the last call.
 *
 * DRAINS ON READ. Each alert is delivered once; calling this twice in a row
 * returns nothing the second time. Do not call it speculatively — a dropped
 * response loses those alerts.
 *
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<{alerts: object[], count: number}>}
 */
export function getMonitoringAlerts(opts = {}) {
  return get('/api/monitoring/alerts', { timeoutMs: POLL_TIMEOUT_MS, ...opts })
}

/**
 * Ask for a screening pass now. Returns as soon as the request is accepted —
 * the pass itself runs on the server's own thread.
 *
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<{triggered: boolean, state: string}>}
 */
export function refreshMonitoring(opts = {}) {
  return post('/api/monitoring/refresh', {}, { timeoutMs: POLL_TIMEOUT_MS, ...opts })
}
