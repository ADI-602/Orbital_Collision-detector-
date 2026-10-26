import { describe, expect, it } from 'vitest'

import { searchObjects } from './objectSearch.js'

const OBJECTS = [
  { name: 'ISS (ZARYA)', noradId: '25544' },
  { name: 'ISS (NAUKA)', noradId: '49044' },
  { name: 'COSMOS 2251 DEB', noradId: '33760' },
  { name: 'COSMOS 2251 DEB', noradId: '33932' },
  { name: 'IRIDIUM 33 DEB', noradId: '33772' },
  { name: 'CSS (TIANHE)', noradId: '48274' },
]

const names = (r) => r.results.map((o) => `${o.name} ${o.noradId}`)

describe('searchObjects', () => {
  it('returns nothing for an empty or blank query', () => {
    expect(searchObjects(OBJECTS, '')).toEqual({ results: [], total: 0 })
    expect(searchObjects(OBJECTS, '   ')).toEqual({ results: [], total: 0 })
  })

  it('matches names case-insensitively, prefix before substring', () => {
    // "iss" is a prefix of both ISS entries; nothing else contains it.
    expect(names(searchObjects(OBJECTS, 'iss'))).toEqual(['ISS (NAUKA) 49044', 'ISS (ZARYA) 25544'])
    // "deb" is a substring only, so all debris match, ordered by name then id.
    expect(names(searchObjects(OBJECTS, 'DEB'))).toEqual([
      'COSMOS 2251 DEB 33760',
      'COSMOS 2251 DEB 33932',
      'IRIDIUM 33 DEB 33772',
    ])
  })

  it('puts an exact NORAD id first', () => {
    // "33772" is IRIDIUM's id exactly; no other id starts with it.
    expect(names(searchObjects(OBJECTS, '33772'))).toEqual(['IRIDIUM 33 DEB 33772'])
    // "3377" is an id prefix of IRIDIUM only.
    expect(names(searchObjects(OBJECTS, '3377'))).toEqual(['IRIDIUM 33 DEB 33772'])
  })

  it('caps the list but reports the full count', () => {
    const r = searchObjects(OBJECTS, 's', 2)
    expect(r.results).toHaveLength(2)
    expect(r.total).toBe(OBJECTS.filter((o) => o.name.toLowerCase().includes('s')).length)
  })
})
