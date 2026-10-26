/**
 * maneuver.js — lay out the encounter so a few hundred metres can be seen.
 *
 * Pure functions: no React, no Cesium, no network, and no orbital mechanics.
 * Every position handed in here was computed by the Python pipeline and
 * arrives through /api/physics/maneuver; this module rotates three points into
 * a drawing plane and picks a scale bar. It computes no physics and adjusts no
 * value it was given.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE VIEW EXISTS AT ALL
 *
 * Measured on the real October 2004 burn: the manoeuvre separates the flown and
 * unflown trajectories by 389 m at TCA, across an arc 29,425 km long. That is
 * about 1:55,000. Drawn on the globe, the two tracks are the same line by a
 * wide margin — so "the post-burn orbit in a different colour" (CLAUDE.md
 * §5.1.4) shows a viewer precisely nothing at orbit scale. The burn's effect
 * lives at the encounter, so the encounter is what has to be drawn.
 *
 * The globe still carries the two arcs, for context: where the burn happens,
 * where the encounter happens, and how far apart in the orbit those are.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PROJECTION IS NOT A DISTORTION
 *
 * Three points define a plane, and this projects them into their own plane.
 * That is an isometry on those points: every distance in the resulting 2D
 * layout is the true 3D distance, exactly, with no foreshortening and no
 * scaling to make anything look better. A unit test asserts it.
 *
 * The distances are still LABELLED from the pipeline's own scalars rather than
 * measured off the drawing, because the drawing is a picture and the miss
 * distance is a number — and the two must never be presented as the same kind
 * of thing.
 */

import * as satellite from 'satellite.js'

/**
 * Redraw an Earth-fixed track as it stood at one instant.
 *
 * WHY THIS IS NEEDED. The globe draws orbits inertially: a ring is sampled in
 * TEME and rotated by a SINGLE instant's GMST, so it closes and the Earth turns
 * beneath it (lib/orbitTrack.js). The backend's maneuver arcs are Earth-fixed
 * at each sample's OWN instant, which is a ground-track swath — a different
 * picture. Drawn together without this, the burn arc would visibly wander off
 * the orbit ring it is a piece of.
 *
 * This undoes each sample's own rotation and reapplies one shared instant's,
 * putting the arc in the same convention as the rings. Both steps are
 * satellite.js library calls; the net effect is a rotation about the pole by
 * the Earth's turn between the sample and `when`, and nothing else. No matrix
 * is written here (CLAUDE.md §1.1).
 *
 * @param {Array<number[]>} pointsEcefKm  [x, y, z] km, Earth-fixed per sample
 * @param {string[]} sampleUtcIso         each point's own instant
 * @param {Date} when                     the instant to express them all at
 * @returns {Array<{x: number, y: number, z: number}>|null} km
 */
export function alignTrackToInstant(pointsEcefKm, sampleUtcIso, when) {
  if (!Array.isArray(pointsEcefKm) || pointsEcefKm.length === 0) return null
  if (!Array.isArray(sampleUtcIso) || sampleUtcIso.length !== pointsEcefKm.length) return null
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) return null

  const gmstTarget = satellite.gstime(when)
  const out = []

  for (let i = 0; i < pointsEcefKm.length; i += 1) {
    const p = pointsEcefKm[i]
    if (!isVec3(p)) return null

    const sampledAt = new Date(sampleUtcIso[i])
    if (Number.isNaN(sampledAt.getTime())) return null

    const inertial = satellite.ecfToEci({ x: p[0], y: p[1], z: p[2] }, satellite.gstime(sampledAt))
    const fixed = satellite.eciToEcf(inertial, gmstTarget)
    if (!Number.isFinite(fixed?.x) || !Number.isFinite(fixed?.y) || !Number.isFinite(fixed?.z)) {
      return null
    }
    out.push(fixed)
  }
  return out
}

/**
 * The three positions at TCA, projected into their own plane.
 *
 * @typedef {object} EncounterLayout
 * @property {{x: number, y: number}} preBurn      metres, at the origin
 * @property {{x: number, y: number}} postBurn     metres
 * @property {{x: number, y: number}} secondary    metres
 * @property {number} preBurnMissM    |secondary - preBurn|, from the geometry
 * @property {number} postBurnMissM   |secondary - postBurn|, from the geometry
 * @property {number} burnShiftM      |postBurn - preBurn|, from the geometry
 * @property {number} spanM           widest extent of the three points
 * @property {boolean} degenerate     true when the burn moved nothing, so the
 *   three points are collinear and the second basis vector is arbitrary
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a) => Math.hypot(a[0], a[1], a[2])
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]

/** A unit vector perpendicular to `v`, chosen from whichever axis is least aligned. */
function anyPerpendicular(v) {
  const axis = Math.abs(v[0]) < Math.abs(v[1])
    ? (Math.abs(v[0]) < Math.abs(v[2]) ? [1, 0, 0] : [0, 0, 1])
    : (Math.abs(v[1]) < Math.abs(v[2]) ? [0, 1, 0] : [0, 0, 1])
  const projected = sub(axis, scale(v, dot(axis, v)))
  const length = norm(projected)
  return length > 0 ? scale(projected, 1 / length) : [0, 1, 0]
}

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))
}

/**
 * Project the encounter into the plane of its own three points.
 *
 * Inputs are ECEF kilometres, exactly as `tracks.tca_*_pos_ecef_km` delivers
 * them. Output is metres, with the coasting primary at the origin and the
 * pre-burn miss vector along +x — an orientation chosen so the drawing is
 * stable between renders rather than rotating with the orbit.
 *
 * @param {number[]} preBurnKm    primary at TCA, coasting
 * @param {number[]} postBurnKm   primary at TCA, having burned
 * @param {number[]} secondaryKm  the other object at TCA
 * @returns {EncounterLayout|null} null if any input is unusable
 */
export function projectEncounter(preBurnKm, postBurnKm, secondaryKm) {
  if (!isVec3(preBurnKm) || !isVec3(postBurnKm) || !isVec3(secondaryKm)) return null

  const toSecondary = sub(secondaryKm, preBurnKm)
  const toPost = sub(postBurnKm, preBurnKm)

  const missLength = norm(toSecondary)
  if (!(missLength > 0)) return null

  // +x runs from the coasting primary towards the other object: the drawing's
  // horizontal IS the pre-burn miss distance.
  const e1 = scale(toSecondary, 1 / missLength)

  // +y completes the plane. Gram-Schmidt against e1; if the burn displacement
  // has no component off e1 the three points are collinear and any
  // perpendicular will do — that is the zero-burn case, where post sits on top
  // of pre and the choice cannot matter.
  const rejection = sub(toPost, scale(e1, dot(toPost, e1)))
  const rejectionLength = norm(rejection)
  const degenerate = rejectionLength < 1e-12
  const e2 = degenerate ? anyPerpendicular(e1) : scale(rejection, 1 / rejectionLength)

  const KM_TO_M = 1000
  const project = (pointKm) => {
    const d = sub(pointKm, preBurnKm)
    return { x: dot(d, e1) * KM_TO_M, y: dot(d, e2) * KM_TO_M }
  }

  const preBurn = { x: 0, y: 0 }
  const postBurn = project(postBurnKm)
  const secondary = project(secondaryKm)

  const between = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const xs = [preBurn.x, postBurn.x, secondary.x]
  const ys = [preBurn.y, postBurn.y, secondary.y]

  return {
    preBurn,
    postBurn,
    secondary,
    preBurnMissM: between(secondary, preBurn),
    postBurnMissM: between(secondary, postBurn),
    burnShiftM: between(postBurn, preBurn),
    spanM: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
    degenerate,
  }
}

/**
 * A round number for the scale bar: 1, 2 or 5 times a power of ten.
 *
 * A scale bar with an arbitrary length ("173 m") is unreadable at a glance,
 * and a diagram of a few hundred metres is only honest if the viewer can tell
 * what a few hundred metres looks like on it.
 *
 * @param {number} spanM  the extent the drawing covers
 * @param {number} [fraction] roughly how much of the span the bar should take
 * @returns {number} metres, always > 0
 */
export function niceScaleBarM(spanM, fraction = 0.35) {
  const target = Number(spanM) * fraction
  if (!Number.isFinite(target) || target <= 0) return 1

  const magnitude = 10 ** Math.floor(Math.log10(target))
  const steps = [1, 2, 5, 10]
  let best = magnitude
  for (const step of steps) {
    if (step * magnitude <= target) best = step * magnitude
  }
  return best
}

/**
 * Render a distance in metres, switching to km only where metres stop being
 * readable. Encounter distances live in the hundreds of metres, which is
 * exactly where this must not round to "0.3 km".
 *
 * @param {number} metres
 * @returns {string}
 */
export function formatEncounterDistance(metres) {
  if (typeof metres !== 'number' || !Number.isFinite(metres)) return '—'
  const abs = Math.abs(metres)
  if (abs < 10) return `${metres.toFixed(1)} m`
  if (abs < 10000) return `${metres.toFixed(0)} m`
  return `${(metres / 1000).toFixed(1)} km`
}

/**
 * Render a burn as an operator would read it: signed, because the sign is the
 * whole instruction. Negative brakes, positive boosts.
 *
 * @param {number} cmPerS
 * @returns {string}
 */
export function formatDeltaV(cmPerS) {
  if (typeof cmPerS !== 'number' || !Number.isFinite(cmPerS)) return '—'
  return `${cmPerS > 0 ? '+' : ''}${cmPerS.toFixed(1)} cm/s`
}

/**
 * True when the response carries a drawable encounter.
 *
 * Checked explicitly rather than assumed, because a maneuver response with
 * scalars but no tracks is a valid thing for the API to return, and the panel
 * must then show the numbers without a diagram rather than an empty box.
 *
 * @param {object} tracks
 */
export function hasEncounterGeometry(tracks) {
  return (
    isVec3(tracks?.tca_pre_burn_pos_ecef_km) &&
    isVec3(tracks?.tca_post_burn_pos_ecef_km) &&
    isVec3(tracks?.tca_secondary_pos_ecef_km)
  )
}
