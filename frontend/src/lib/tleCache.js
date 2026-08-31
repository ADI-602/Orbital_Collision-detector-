/**
 * tleCache.js — persist a successful CelesTrak fetch across page reloads.
 *
 * Two reasons this exists, both learned the hard way:
 *
 * 1. CLAUDE.md asks that CelesTrak be fetched once and cached rather than
 *    hammered. A module-level variable only survives until reload, so a dev
 *    loop or a demo rehearsal re-fetches on every refresh. Repeated fetches
 *    got this machine temporarily blocked by CelesTrak.
 * 2. TLEs change on the order of hours. Re-fetching on every page load buys
 *    nothing and risks the feed being unavailable exactly when it is needed.
 *
 * Pure functions over an injectable storage object so they are testable
 * without a browser. All access is wrapped: localStorage throws in private
 * mode and when site data is blocked, and a cache miss must never break the
 * page.
 */

const STORAGE_KEY = 'ora.tle.stations.v1'

/** TLEs age slowly; a few hours of reuse is well within visual accuracy. */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000

/**
 * @typedef {object} CachedTle
 * @property {string} text      raw CelesTrak response body
 * @property {number} fetchedAt epoch ms
 */

/**
 * Read a cached payload, or null when absent, unreadable, or stale.
 *
 * @param {Storage} [storage]
 * @param {number} [now]
 * @returns {CachedTle | null}
 */
export function readCachedTle(storage, now = Date.now()) {
  if (!storage) return null
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (typeof parsed?.text !== 'string' || typeof parsed?.fetchedAt !== 'number') {
      return null
    }
    if (now - parsed.fetchedAt > CACHE_TTL_MS) return null
    return parsed
  } catch {
    // Unreadable or corrupt cache is simply a miss.
    return null
  }
}

/**
 * Store a freshly fetched payload. Failures are ignored: caching is an
 * optimisation, never a correctness requirement.
 *
 * @param {string} text
 * @param {Storage} [storage]
 * @param {number} [now]
 */
export function writeCachedTle(text, storage, now = Date.now()) {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ text, fetchedAt: now }))
  } catch {
    // Quota exceeded or storage blocked — not worth surfacing.
  }
}

/** Safe accessor: touching localStorage itself can throw in some contexts. */
export function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}
