/**
 * adviceCache.js — remember the advisor's answers for this browser session.
 *
 * Keyed by the exact request the advisor is sent, so a cached answer is only
 * ever reused for the very same figures (event, Pc, miss distance, TCA, and
 * the same simulated burn if there is one). Any change to any figure is a
 * different key and a fresh request.
 *
 * Only LIVE answers are stored. Caching the offline rule-based fallback would
 * keep serving it after the model came back.
 */

/** Enough for a demo session; the oldest entry goes first beyond this. */
export const ADVICE_CACHE_LIMIT = 50

/**
 * @param {object} request the POST /api/ai/advise body (lib/advice.js)
 * @returns {string}
 */
export function adviceCacheKey(request) {
  return JSON.stringify(request)
}

/**
 * A small insertion-ordered cache.
 *
 * @param {number} [limit]
 */
export function createAdviceCache(limit = ADVICE_CACHE_LIMIT) {
  const entries = new Map()
  return {
    /** @returns {{payload: object, atMs: number} | undefined} */
    get: (key) => entries.get(key),
    /** Stores live answers only; returns whether it stored. */
    set(key, payload, atMs = Date.now()) {
      if (payload?.is_fallback !== false) return false
      entries.delete(key)
      entries.set(key, { payload, atMs })
      while (entries.size > limit) entries.delete(entries.keys().next().value)
      return true
    },
    get size() {
      return entries.size
    },
  }
}

/** The one cache the console and the replay share for the session. */
export const sessionAdviceCache = createAdviceCache()
