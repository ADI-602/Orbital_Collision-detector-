import { describe, it, expect } from 'vitest'

import { buildSatrec } from './geodetic.js'
import {
  INJECTED_DEBRIS,
  INJECTED_PRIMARY,
  INJECTED_SEARCH_HOURS,
} from './injectedScenario.js'
import { tleEpochUtc } from './tle.js'
import { TLE_SNAPSHOT_TEXT } from './tleSnapshot.js'

/**
 * The injected objects are synthetic by design, so the usual "is this real
 * data" checks do not apply. What must hold is that they are well-formed
 * enough for the propagator to treat them exactly like catalogued objects —
 * a scenario that silently failed to propagate would show an empty event list
 * and look identical to "nothing detected".
 */

/** TLE checksum: digits summed, each '-' counting 1, modulo 10. */
function checksum(line) {
  let total = 0
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') total += Number(ch)
    else if (ch === '-') total += 1
  }
  return total % 10
}

const everyObject = [INJECTED_PRIMARY, ...INJECTED_DEBRIS]

describe('injected scenario element sets', () => {
  it('carries a primary and at least two debris objects', () => {
    expect(INJECTED_DEBRIS.length).toBeGreaterThanOrEqual(2)
    expect(INJECTED_PRIMARY.name).toBe('ISS (ZARYA)')
  })

  it('has a valid checksum on every line', () => {
    // Hand-built TLEs are exactly where a checksum slips, and SGP4 parses by
    // column: a bad character changes an orbit instead of failing loudly.
    for (const o of everyObject) {
      for (const line of [o.line1, o.line2]) {
        expect(Number(line[68]), `${o.name}: ${line}`).toBe(checksum(line))
      }
    }
  })

  it('is accepted by the propagator', () => {
    for (const o of everyObject) {
      expect(buildSatrec(o.line1, o.line2, o.name), o.name).not.toBeNull()
    }
  })

  it('shares one epoch across the scenario', () => {
    // The geometry was solved at a single instant; objects drifting to
    // different epochs would quietly change the encounter.
    const epochs = everyObject.map((o) => tleEpochUtc(o.line1).toISOString())
    expect(new Set(epochs).size).toBe(1)
  })

  it('uses the analyst catalog range for the synthetic objects only', () => {
    // 90000+ is not a real catalog assignment, which keeps a synthetic object
    // from ever being mistaken for a catalogued one by its number.
    for (const d of INJECTED_DEBRIS) {
      expect(Number(d.line1.slice(2, 7))).toBeGreaterThanOrEqual(90000)
      expect(d.name).toMatch(/INJECTED/)
    }
    expect(Number(INJECTED_PRIMARY.line1.slice(2, 7))).toBe(25544)
  })

  it('pairs with the real ISS element set it was solved against', () => {
    // If the snapshot's ISS lines change, the solved geometry no longer
    // matches and this scenario needs re-deriving, not silent reuse.
    expect(TLE_SNAPSHOT_TEXT).toContain(INJECTED_PRIMARY.line1)
    expect(TLE_SNAPSHOT_TEXT).toContain(INJECTED_PRIMARY.line2)
  })

  it('names every debris object distinctly from the primary', () => {
    const names = everyObject.map((o) => o.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('declares a search window long enough to contain the encounter', () => {
    expect(INJECTED_SEARCH_HOURS).toBeGreaterThan(0)
    expect(INJECTED_SEARCH_HOURS).toBeLessThanOrEqual(24)
  })
})
