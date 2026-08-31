/**
 * health.js — GET /health (backend/api/main.py:81-88).
 *
 * The response is three hardcoded literals, so this is a pure reachability
 * probe: it tells you uvicorn is up and serving, nothing about whether the
 * physics pipeline works.
 */

import { get } from './client.js'

/**
 * @typedef {object} HealthResponse
 * @property {string} status  always the literal "ok"
 * @property {string} service always "Orbital Risk Advisor API"
 * @property {string} version app version, e.g. "1.0.0"
 */

const HEALTH_TIMEOUT_MS = 5000

/**
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<HealthResponse>}
 */
export function getHealth(opts = {}) {
  return get('/health', { timeoutMs: HEALTH_TIMEOUT_MS, ...opts })
}
