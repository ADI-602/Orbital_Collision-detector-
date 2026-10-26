import { describe, it, expect } from 'vitest'

import { CACHE_TTL_MS, readCachedTle, writeCachedTle } from './tleCache.js'
import { TLE_SNAPSHOT_TEXT, SNAPSHOT_CAPTURED_UTC } from './tleSnapshot.js'
import { parseTleText } from './tle.js'

/** Minimal in-memory Storage stand-in. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

/** Storage that throws on every access, as in private mode / blocked data. */
function hostileStorage() {
  return {
    getItem() {
      throw new Error('access denied')
    },
    setItem() {
      throw new Error('quota exceeded')
    },
  }
}

const NOW = 1_800_000_000_000

describe('tle cache round-trip', () => {
  it('returns what was written', () => {
    const s = memoryStorage()
    writeCachedTle('TLE TEXT', s, NOW)
    const got = readCachedTle(s, NOW)
    expect(got?.text).toBe('TLE TEXT')
    expect(got?.fetchedAt).toBe(NOW)
  })

  it('serves an entry that is still inside the TTL', () => {
    const s = memoryStorage()
    writeCachedTle('TLE TEXT', s, NOW)
    expect(readCachedTle(s, NOW + CACHE_TTL_MS - 1000)?.text).toBe('TLE TEXT')
  })

  it('treats an entry past the TTL as a miss', () => {
    const s = memoryStorage()
    writeCachedTle('TLE TEXT', s, NOW)
    expect(readCachedTle(s, NOW + CACHE_TTL_MS + 1)).toBeNull()
  })
})

describe('tle cache resilience', () => {
  it('misses cleanly on empty storage', () => {
    expect(readCachedTle(memoryStorage(), NOW)).toBeNull()
  })

  it('misses cleanly when no storage is available at all', () => {
    expect(readCachedTle(null, NOW)).toBeNull()
    expect(() => writeCachedTle('x', null, NOW)).not.toThrow()
  })

  it('misses cleanly on corrupt JSON rather than throwing', () => {
    const s = memoryStorage({ 'ora.tle.stations.v1': '{not json' })
    expect(readCachedTle(s, NOW)).toBeNull()
  })

  it('misses cleanly when the entry has the wrong shape', () => {
    const s = memoryStorage({ 'ora.tle.stations.v1': JSON.stringify({ text: 42 }) })
    expect(readCachedTle(s, NOW)).toBeNull()
  })

  it('never lets a throwing storage break the page', () => {
    // Private mode and blocked site data both throw on access; caching is an
    // optimisation and must never be load-bearing.
    expect(readCachedTle(hostileStorage(), NOW)).toBeNull()
    expect(() => writeCachedTle('x', hostileStorage(), NOW)).not.toThrow()
  })
})

describe('bundled offline snapshot', () => {
  const records = parseTleText(TLE_SNAPSHOT_TEXT)

  it('parses with the same parser used for the live feed', () => {
    expect(records.length).toBeGreaterThan(0)
  })

  it('carries real names and NORAD ids', () => {
    const iss = records.find((r) => r.name === 'ISS (ZARYA)')
    expect(iss).toBeDefined()
    expect(iss.noradId).toBe('25544')
  })

  it('declares the epoch it was captured at, so the UI can disclose it', () => {
    expect(SNAPSHOT_CAPTURED_UTC).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
