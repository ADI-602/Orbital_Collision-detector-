import { describe, expect, it } from 'vitest'

import { adviceCacheKey, createAdviceCache } from './adviceCache.js'

const LIVE = { executive_summary: 'live', is_fallback: false }
const OFFLINE = { executive_summary: 'templated', is_fallback: true }

describe('adviceCacheKey', () => {
  it('differs when any figure differs', () => {
    const a = adviceCacheKey({ conjunction: { pc: 6.59e-4 }, maneuvers: [] })
    const b = adviceCacheKey({ conjunction: { pc: 6.6e-4 }, maneuvers: [] })
    expect(a).not.toBe(b)
  })

  it('differs once a burn is attached', () => {
    const base = { conjunction: { pc: 6.59e-4 }, maneuvers: [] }
    const withBurn = { conjunction: { pc: 6.59e-4 }, maneuvers: [{ delta_v_cm_s: -4 }] }
    expect(adviceCacheKey(base)).not.toBe(adviceCacheKey(withBurn))
  })
})

describe('createAdviceCache', () => {
  it('returns a stored live answer with the time it was made', () => {
    const cache = createAdviceCache()
    expect(cache.set('k', LIVE, 1000)).toBe(true)
    expect(cache.get('k')).toEqual({ payload: LIVE, atMs: 1000 })
  })

  it('never stores the offline fallback, or anything not marked live', () => {
    const cache = createAdviceCache()
    expect(cache.set('k', OFFLINE)).toBe(false)
    expect(cache.set('k2', { executive_summary: 'no flag' })).toBe(false)
    expect(cache.get('k')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('drops the oldest entry beyond its limit', () => {
    const cache = createAdviceCache(2)
    cache.set('a', LIVE)
    cache.set('b', LIVE)
    cache.set('c', LIVE)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
  })
})
