import * as satellite from 'satellite.js'

/**
 * geodetic.js — SGP4 propagation to lat/lon/altitude, in one place.
 *
 * ============================ BOUNDARY NOTE ============================
 * This is the AMBIENT VISUALISATION layer. It exists so the globe can show
 * real objects in real orbits, and nothing more. No number produced here
 * feeds screening, TCA, Pc, maneuver planning, or an AI prompt — those come
 * exclusively from the Python pipeline behind /api/physics/*, which is what
 * the Alfano benchmark and the Envisat replay actually validate.
 * =======================================================================
 *
 * Propagation is delegated entirely to satellite.js, the standard JS port of
 * the SGP4 family. Nothing here implements orbital mechanics, per
 * CLAUDE.md 1.1.
 *
 * Extracted from useLiveSatellites so the Envisat replay can propagate its
 * own two objects without a second copy of position code — two subtly
 * divergent copies of this would be exactly the kind of bug that is
 * invisible until a judge notices the globe disagreeing with itself.
 */

/**
 * @typedef {object} GeodeticPosition
 * @property {number} latitude_deg
 * @property {number} longitude_deg
 * @property {number} altitude_km  above the WGS-84 ellipsoid
 */

/**
 * Propagate one satrec to an instant and convert to geodetic coordinates.
 *
 * Returns null when SGP4 reports a decayed or otherwise unpropagatable
 * object, or when the result is not finite — a skipped marker is correct, an
 * invented position is not.
 *
 * @param {object} satrec  from satellite.twoline2satrec
 * @param {Date} when
 * @returns {GeodeticPosition|null}
 */
export function propagateToGeodetic(satrec, when) {
  const pv = satellite.propagate(satrec, when)
  if (!pv?.position) return null

  const gmst = satellite.gstime(when)
  const geo = satellite.eciToGeodetic(pv.position, gmst)

  const latitude_deg = satellite.degreesLat(geo.latitude)
  const longitude_deg = satellite.degreesLong(geo.longitude)
  const altitude_km = geo.height

  if (
    !Number.isFinite(latitude_deg) ||
    !Number.isFinite(longitude_deg) ||
    !Number.isFinite(altitude_km)
  ) {
    return null
  }

  return { latitude_deg, longitude_deg, altitude_km }
}

/**
 * Build a satrec from a TLE line pair, or null if the elements are unusable.
 *
 * THREE gates, because satellite.js only catches some of the bad cases:
 *
 *   1. a throw (rare, but not impossible)
 *   2. a nonzero `error` field — how satellite.js reports a rejected element
 *      set, since it does not throw for one
 *   3. non-finite orbital elements
 *
 * The third gate is not redundant. `twoline2satrec('not', 'a tle')` returns a
 * satrec with `error === 0` and every element NaN, so gates 1 and 2 both pass
 * it. Such a satrec propagates to nothing and its marker never draws — but it
 * still counts as a tracked object, and a count that includes objects the
 * globe cannot show is a number that disagrees with the screen. Mean motion
 * and inclination are checked as the two elements nothing can propagate
 * without.
 *
 * A rejection is logged rather than swallowed: a propagator refusing every
 * element set looks identical to "no satellites in view".
 *
 * @param {string} line1
 * @param {string} line2
 * @param {string} [name] for the log line only
 * @returns {object|null}
 */
export function buildSatrec(line1, line2, name = 'unnamed') {
  try {
    const satrec = satellite.twoline2satrec(line1, line2)

    if (!satrec || satrec.error) {
      console.warn(`[tracking] rejected TLE for ${name}: error=${satrec?.error}`)
      return null
    }

    // `no` is mean motion (rad/min), `inclo` inclination (rad).
    if (!Number.isFinite(satrec.no) || !Number.isFinite(satrec.inclo)) {
      console.warn(`[tracking] rejected TLE for ${name}: non-finite orbital elements`)
      return null
    }

    return satrec
  } catch (err) {
    console.error(`[tracking] failed to build satrec for ${name}:`, err)
    return null
  }
}
