/**
 * validation.js — GET /api/validation/status (backend/api/validation.py).
 *
 * The known-answer checks, run by the physics pipeline on the server: the
 * Alfano synthetic Pc case and the four Envisat/Zenith-2 prediction days,
 * judged by the regression tests' own fixtures and bounds. The console shows
 * this report; it never decides a pass or fail itself.
 */

import { get } from './client.js'

/** The first request runs the checks (about half a second); allow headroom. */
const VALIDATION_TIMEOUT_MS = 60000

/**
 * @param {import('./types.js').ApiRequestOptions} [opts]
 * @returns {Promise<{passed: boolean, checks: object[], ran_at_unix: number, duration_s: number, notes: string}>}
 */
export function getValidationStatus(opts = {}) {
  return get('/api/validation/status', { timeoutMs: VALIDATION_TIMEOUT_MS, ...opts })
}
