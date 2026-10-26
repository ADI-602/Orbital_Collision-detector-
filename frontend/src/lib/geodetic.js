/**
 * geodetic.js — turn a TLE into a lat/lon/altitude for the globe.
 *
 * ============================ BOUNDARY NOTE ============================
 * VISUALISATION ONLY. Every number this module produces exists to place a
 * marker on a Cesium globe and nothing else. None of it is an input to
 * conjunction screening, TCA refinement, Pc, or maneuver planning — those are
 * computed exclusively by the validated Python pipeline behind
 * /api/physics/*, which is what the Alfano benchmark and the Envisat replay
 * check.
 *
 * A position from here means "this object is up there". It never means "the
 * pipeline assessed this". Do not route any value from this module into a
 * risk display, an AI prompt, or a comparison against pipeline output.
 * =======================================================================
 *
 * Propagation is delegated entirely to satellite.js (the standard JS port of
 * the SGP4 family the backend's Python `sgp4` package belongs to). No orbital
 * mechanics are hand-written here, per CLAUDE.md §1.1.
 *
 * Shared by the live console (useLiveSatellites.js) and the historical replay
 * (useEnvisatReplay.js) so both draw their markers through exactly the same
 * code path — an archived 2004 element set and a CelesTrak element set are the
 * same kind of input, and should not have two propagators between them.
 */

import * as satellite from 'satellite.js'

/**
 * @typedef {object} Geodetic
 * @property {number} latitude_deg
 * @property {number} longitude_deg
 * @property {number} altitude_km
 */

/**
 * Propagate one satrec to an instant and convert to geodetic coordinates.
 *
 * Returns null when SGP4 reports a decayed or otherwise unpropagatable object,
 * or when the result is not finite. A skipped marker is correct; an invented
 * position is not.
 *
 * @param {object} satrec  from satellite.twoline2satrec
 * @param {Date} when
 * @returns {Geodetic|null}
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
 * Build a satrec from a TLE pair, or null if the element set is rejected.
 *
 * satellite.js signals a rejected element set through a nonzero `error` field
 * rather than by throwing, so both paths are checked. The caller decides what
 * a rejection means — never silently substitute a different object.
 *
 * @param {string} line1
 * @param {string} line2
 * @param {string} [label] used only in the warning, to make a rejection traceable
 * @returns {object|null}
 */
export function buildSatrec(line1, line2, label = 'unnamed') {
  try {
    const satrec = satellite.twoline2satrec(line1, line2)
    if (!satrec || satrec.error) {
      console.warn(`[tracking] rejected TLE for ${label}: error=${satrec?.error}`)
      return null
    }
    return satrec
  } catch (err) {
    // Never swallow this: a propagator rejecting every element set looks
    // identical to "no satellites in view".
    console.error(`[tracking] failed to build satrec for ${label}:`, err)
    return null
  }
}
