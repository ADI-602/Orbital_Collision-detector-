import { describe, it, expect } from 'vitest'

import { buildSatrec, propagateToGeodetic } from './geodetic.js'
import { parseTleText } from './tle.js'
import { SNAPSHOT_CAPTURED_UTC, TLE_SNAPSHOT_TEXT } from './tleSnapshot.js'

/**
 * Covers the propagation helpers that used to live inside useLiveSatellites
 * and are now shared with the Envisat replay. The extraction was mechanical,
 * but "mechanical" is exactly how a globe ends up quietly showing the wrong
 * positions, so the behaviour is pinned here.
 *
 * Assertions are orbital invariants, not magic numbers: the snapshot's epoch
 * ages, so a fixed lat/lon would rot. What cannot change is that the ISS
 * stays in low Earth orbit and within its inclination.
 */

const records = parseTleText(TLE_SNAPSHOT_TEXT)
/** Near the snapshot epoch, so propagation is not extrapolating years out. */
const WHEN = new Date(`${SNAPSHOT_CAPTURED_UTC}T12:00:00Z`)

describe('buildSatrec', () => {
  it('builds a propagatable satrec from every TLE in the committed snapshot', () => {
    expect(records.length).toBeGreaterThan(0)
    for (const r of records) {
      expect(buildSatrec(r.line1, r.line2, r.name)).not.toBeNull()
    }
  })

  it('returns null for a malformed element set instead of throwing', () => {
    // A rejected TLE must skip its marker, never take down the render loop.
    // satellite.js does NOT flag this one: it returns a satrec with error === 0
    // and every element NaN, which is why buildSatrec checks the elements too.
    expect(buildSatrec('not', 'a tle', 'junk')).toBeNull()
    expect(buildSatrec('', '', 'empty')).toBeNull()
  })

  it('rejects a TLE whose elements parse to NaN, so counts match the globe', () => {
    // Right shape, unparseable numbers — the case that slipped through the
    // error-field check and became an object that could never be drawn.
    const line1 = '1 99999U 00000A   XXXXXXXXXXX  .00000000  00000-0  00000-0 0  9999'
    const line2 = '2 99999 XX.XXXX XXX.XXXX XXXXXXX XXX.XXXX XXX.XXXX XX.XXXXXXXX00000'
    expect(buildSatrec(line1, line2, 'nan-elements')).toBeNull()
  })
})

describe('propagateToGeodetic', () => {
  const iss = records.find((r) => r.noradId === '25544')

  it('has the ISS in the snapshot to propagate', () => {
    expect(iss).toBeDefined()
  })

  it('places the ISS in low Earth orbit', () => {
    const geo = propagateToGeodetic(buildSatrec(iss.line1, iss.line2, iss.name), WHEN)
    expect(geo).not.toBeNull()
    // ISS operating band, generously bounded.
    expect(geo.altitude_km).toBeGreaterThan(300)
    expect(geo.altitude_km).toBeLessThan(500)
  })

  it('keeps the ISS within its orbital inclination', () => {
    const satrec = buildSatrec(iss.line1, iss.line2, iss.name)
    // Sample a full orbit; latitude must never exceed the 51.6° inclination.
    for (let minutes = 0; minutes < 95; minutes += 5) {
      const geo = propagateToGeodetic(satrec, new Date(WHEN.getTime() + minutes * 60_000))
      expect(geo).not.toBeNull()
      expect(Math.abs(geo.latitude_deg)).toBeLessThanOrEqual(51.7)
      expect(Math.abs(geo.longitude_deg)).toBeLessThanOrEqual(180)
    }
  })

  it('returns finite coordinates for every object in the snapshot', () => {
    for (const r of records) {
      const geo = propagateToGeodetic(buildSatrec(r.line1, r.line2, r.name), WHEN)
      // A decayed object legitimately yields null; anything else must be finite.
      if (geo === null) continue
      expect(Number.isFinite(geo.latitude_deg)).toBe(true)
      expect(Number.isFinite(geo.longitude_deg)).toBe(true)
      expect(Number.isFinite(geo.altitude_km)).toBe(true)
    }
  })
})
