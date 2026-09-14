import { describe, it, expect } from 'vitest'

import { buildSatrec } from './geodetic.js'
import { parseTleText } from './tle.js'
import { SNAPSHOT_CAPTURED_UTC, TLE_SNAPSHOT_TEXT } from './tleSnapshot.js'

/**
 * Data-integrity guard for the committed offline snapshot.
 *
 * This exists because the snapshot once contained two entries — labelled
 * POISK and ISS (NAUKA) — that were the ISS (ZARYA) element set with only the
 * catalog number changed, in a file whose own docstring promises nothing is
 * synthetic or hand-tuned. The globe drew two phantom objects inside the ISS,
 * and screening the set failed outright because identical elements give zero
 * relative velocity, for which no B-plane exists.
 *
 * The invariant below would have caught it the day it was committed.
 */

const records = parseTleText(TLE_SNAPSHOT_TEXT)

/** The nine fields SGP4 actually reads, by column, per the TLE format. */
function orbitalElements(line1, line2) {
  return [
    line1.slice(18, 32), // epoch
    line1.slice(33, 43), // first derivative of mean motion
    line1.slice(53, 61), // B* drag term
    line2.slice(8, 16), // inclination
    line2.slice(17, 25), // RAAN
    line2.slice(26, 33), // eccentricity
    line2.slice(34, 42), // argument of perigee
    line2.slice(43, 51), // mean anomaly
    line2.slice(52, 63), // mean motion
  ].join('|')
}

describe('the duplicate-element check itself', () => {
  it('fires on the exact data that got past it before', () => {
    // The historical entries, verbatim. If this ever stops matching, the
    // guard above has been weakened and the regression can return.
    const zarya2 = '2 25544  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909583274'
    const zarya1 = '1 25544U 98067A   26242.49847866  .00005671  00000+0  11126-3 0  9990'
    const poisk2 = '2 36086  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909583963'
    const poisk1 = '1 36086U 09060A   26242.49847866  .00005671  00000+0  11126-3 0  9998'

    // Different catalog numbers, so an id check would have passed them...
    expect(zarya1.slice(2, 7)).not.toBe(poisk1.slice(2, 7))
    // ...but the elements and epoch are identical, which is the giveaway.
    expect(orbitalElements(zarya1, zarya2)).toBe(orbitalElements(poisk1, poisk2))
  })

  it('does not fire on two genuinely independent objects', () => {
    const zarya1 = '1 25544U 98067A   26242.49847866  .00005671  00000+0  11126-3 0  9990'
    const zarya2 = '2 25544  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909583274'
    const css1 = '1 48274U 21035A   26242.40883656  .00019520  00000+0  24340-3 0  9994'
    const css2 = '2 48274  41.4676 231.4402 0001913 255.2624 104.8002 15.59424488304755'

    expect(orbitalElements(zarya1, zarya2)).not.toBe(orbitalElements(css1, css2))
  })
})

describe('bundled TLE snapshot', () => {
  it('contains at least one usable object', () => {
    expect(records.length).toBeGreaterThan(0)
  })

  it('every entry has a distinct catalog number', () => {
    const ids = records.map((r) => r.noradId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no two objects share an identical element set', () => {
    // The actual guard. Two distinct catalog objects having the same epoch and
    // the same nine elements to the last digit means one was copied from the
    // other — real element sets are generated independently and always differ,
    // even for co-orbital hardware.
    const seen = new Map()
    for (const r of records) {
      const key = orbitalElements(r.line1, r.line2)
      const clash = seen.get(key)
      expect(
        clash,
        `${r.name} (${r.noradId}) has the same elements and epoch as ${clash} — ` +
          'one is a copy of the other, not an independent observation',
      ).toBeUndefined()
      seen.set(key, `${r.name} (${r.noradId})`)
    }
  })

  it('every entry is accepted by the propagator', () => {
    for (const r of records) {
      expect(buildSatrec(r.line1, r.line2, r.name)).not.toBeNull()
    }
  })

  it('declares the capture date the UI shows when the snapshot is in use', () => {
    expect(SNAPSHOT_CAPTURED_UTC).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
