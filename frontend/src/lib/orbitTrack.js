/**
 * orbitTrack.js — sample one revolution of an object's orbit for the globe.
 *
 * ============================ BOUNDARY NOTE ============================
 * VISUALISATION ONLY, and specifically: this is the MARKER'S OWN PATH.
 *
 * A ring drawn from here is the same element set, propagated by the same
 * satellite.js call, as the billboard already on the globe (lib/geodetic.js).
 * It derives nothing the marker did not already derive — it draws where the
 * dot goes. No value from this module is an input to conjunction screening,
 * TCA refinement, Pc, or maneuver planning; those are computed exclusively by
 * the validated Python pipeline.
 *
 * IT IS NOT THE POST-BURN TRAJECTORY. CLAUDE.md §5.2 requires the post-burn
 * orbit to come back from /api/physics/maneuver as a sampled ephemeris,
 * because producing it means applying a delta-V to a state vector and
 * re-propagating — new orbital mechanics, which §1.1 and §1.3 keep in Python.
 * Do not reach for this module as a shortcut for that: drawing an object's
 * CURRENT catalogued orbit and inventing a MANEUVERED one are different acts.
 * =======================================================================
 *
 * WHY THE RING IS ROTATED BY A SINGLE INSTANT'S GMST
 *
 * An orbit is fixed in inertial space; the Earth turns underneath it. Sampling
 * a full period and converting each sample with ITS OWN instant's GMST would
 * draw a ground track — a swath that shifts ~22.5 deg west per revolution and
 * never closes. Rotating every sample by ONE instant's GMST instead draws the
 * orbit as it stands at that instant, which closes into a ring and, crucially,
 * puts the marker exactly on it: the marker's position is
 * eciToEcf(r_teme(t), gstime(t)), and the ring's sample at t is that same
 * expression. Re-rotating as the clock advances makes the ring appear to turn
 * slowly westward while the marker slides along it, which is what an orbit
 * actually does.
 *
 * The ring does not close perfectly — measured at 25 km (0.2 deg of arc) for
 * the ISS over one period, which is real J2 drift plus the fact that the
 * period below comes from the mean motion rather than from a repeat-orbit
 * solve. That gap is left alone. Repeating the first point to close it would
 * be faking a physical result at a scale nobody can see, which is not a trade
 * this project makes.
 *
 * Frame conversion is satellite.js's own eciToEcf. CLAUDE.md §1.1 forbids
 * hand-rolling TEME/ECI/ECEF rotations, so no matrix is written here.
 *
 * Pure functions, no React and no Cesium, because vitest.config.js runs
 * `environment: 'node'`: logic inside a component cannot be tested at all.
 */

import * as satellite from 'satellite.js'

/**
 * Samples per revolution.
 *
 * The visible error of a polyline chord against the true arc is
 * R * (1 - cos(pi / N)). At 128 intervals that was about 2 km at LEO: invisible
 * from orbit scale, but zoomed in on an encounter the ring visibly cut corners
 * and pulled ~2 km away from the burn arc drawn beside it, which read as two
 * different orbits. At 512 intervals it is ~130 m. The cost is 513
 * propagations per ring four times a second, a few milliseconds.
 *
 * ODD ON PURPOSE. 512 intervals means 513 points, so the centre sample falls
 * exactly on `centreDate` and the marker is a point of the ring rather than up
 * to half a step (~40 km at LEO) away from the nearest one. An even count
 * still looks right, but it stops being true that the marker is on its ring,
 * and that property is what the whole rendering rests on.
 */
export const TRACK_SAMPLES = 513

/** Plausible geocentric radius band, used only to reject nonsense. */
const MIN_RADIUS_KM = 6000
const MAX_RADIUS_KM = 500000

/**
 * Orbital period in minutes, from the element set's mean motion.
 *
 * `satrec.no` is the mean motion in radians per minute (verified against
 * satellite.js 6.0.2, where `no_kozai` / `no_unkozai` do not exist), so the
 * period is 2*pi/no. This is a DISPLAY value: it decides how much orbit to
 * draw and nothing else. No number shown to a user is derived from it.
 *
 * Returns null rather than a NaN or infinite period, so a bad element set
 * produces no ring instead of a garbage one.
 *
 * @param {object} satrec from satellite.twoline2satrec
 * @returns {number|null} minutes
 */
export function orbitPeriodMinutes(satrec) {
  const no = satrec?.no
  if (typeof no !== 'number' || !Number.isFinite(no) || no <= 0) return null
  const minutes = (2 * Math.PI) / no
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null
}

/**
 * Sample one full revolution in TEME, centred on `centreDate`.
 *
 * Centred rather than starting at the instant, for two reasons: the marker
 * lands in the middle of the array, and the small closure gap falls on the far
 * side of the orbit instead of at the marker.
 *
 * Returns null if the period is unreadable or ANY sample fails to propagate.
 * A decayed object gets no ring at all — a partial arc would read as an orbit
 * that stops in mid-air, and CLAUDE.md §1.5 prefers an honest absence to a
 * plausible-looking fallback.
 *
 * @param {object} satrec
 * @param {Date} centreDate
 * @param {number} [samples]
 * @returns {Array<{x: number, y: number, z: number}>|null} km, TEME
 */
export function sampleOrbitTeme(satrec, centreDate, samples = TRACK_SAMPLES) {
  const periodMin = orbitPeriodMinutes(satrec)
  if (!periodMin) return null
  if (!(centreDate instanceof Date) || Number.isNaN(centreDate.getTime())) return null
  if (!Number.isInteger(samples) || samples < 2) return null

  const periodMs = periodMin * 60_000
  const startMs = centreDate.getTime() - periodMs / 2
  const stepMs = periodMs / (samples - 1)

  const points = []
  for (let i = 0; i < samples; i += 1) {
    const when = new Date(startMs + i * stepMs)
    const pv = satellite.propagate(satrec, when)
    const p = pv?.position
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      return null
    }
    const radiusKm = Math.hypot(p.x, p.y, p.z)
    if (radiusKm < MIN_RADIUS_KM || radiusKm > MAX_RADIUS_KM) return null
    points.push({ x: p.x, y: p.y, z: p.z })
  }
  return points
}

/**
 * Rotate a TEME track into the Earth-fixed frame for one instant.
 *
 * GMST is computed once and applied to every point — that is what makes the
 * result a closed orbit rather than a ground track (see the module docblock).
 * satellite.js does the rotation; nothing here touches a matrix.
 *
 * @param {Array<{x: number, y: number, z: number}>|null} points km, TEME
 * @param {Date} when
 * @returns {Array<{x: number, y: number, z: number}>|null} km, ECEF
 */
export function temeTrackToEcef(points, when) {
  if (!Array.isArray(points) || points.length === 0) return null
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) return null

  const gmst = satellite.gstime(when)
  const out = []
  for (const p of points) {
    const ecf = satellite.eciToEcf(p, gmst)
    if (!Number.isFinite(ecf?.x) || !Number.isFinite(ecf?.y) || !Number.isFinite(ecf?.z)) {
      return null
    }
    out.push(ecf)
  }
  return out
}

/**
 * The whole job in one call: one revolution, in the Earth-fixed frame, for the
 * instant the globe is drawing.
 *
 * @param {object} satrec
 * @param {Date} when
 * @param {number} [samples]
 * @returns {Array<{x: number, y: number, z: number}>|null} km, ECEF
 */
export function orbitTrackEcef(satrec, when, samples = TRACK_SAMPLES) {
  return temeTrackToEcef(sampleOrbitTeme(satrec, when, samples), when)
}

/**
 * Where an object will be at `at`, drawn in the same frame as its ring for
 * `frameWhen` — that is, TEME(at) rotated by GMST(frameWhen).
 *
 * This is what puts a future closest-approach marker ON the two rings instead
 * of floating off them. The ring is the orbit as it stands at the drawn
 * instant; the object's true ground position hours later is somewhere else
 * entirely, because the Earth has turned underneath (~15 deg an hour). In this
 * frame the marker is the point on the drawn orbit where the encounter
 * happens, and it turns with the rings as the clock advances.
 *
 * Off the ring only by real orbital drift (J2 nodal regression) between
 * `frameWhen` and `at` — a few degrees a day for LEO, left alone for the same
 * reason the ring's closure gap is.
 *
 * Returns null for an unreadable instant or a sample that fails to propagate.
 *
 * @param {object} satrec
 * @param {Date} at          the instant whose position is wanted (e.g. a TCA)
 * @param {Date} frameWhen   the instant the rings are being drawn for
 * @returns {{x: number, y: number, z: number}|null} km, ECEF of `frameWhen`
 */
export function orbitPointEcef(satrec, at, frameWhen) {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return null
  const p = satellite.propagate(satrec, at)?.position
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
    return null
  }
  const radiusKm = Math.hypot(p.x, p.y, p.z)
  if (radiusKm < MIN_RADIUS_KM || radiusKm > MAX_RADIUS_KM) return null
  return temeTrackToEcef([p], frameWhen)?.[0] ?? null
}
