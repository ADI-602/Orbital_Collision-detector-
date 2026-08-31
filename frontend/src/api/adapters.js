/**
 * adapters.js — the physics -> AI boundary crossing, in one reviewable place.
 *
 * The physics endpoints and the AI schema disagree on three things, and each
 * disagreement is a way a correct number could silently become a wrong one:
 *
 *   1. `tca_utc_iso` (physics) vs `tca_iso` (AI schema)
 *   2. `maneuver_recommended` (physics) vs `recommended` (AI schema)
 *   3. hard-body radius is KILOMETRES in the physics layer (hardcoded
 *      0.0145 km at main.py:224) and METRES in ConjunctionContext
 *
 * Scattering these renames through components would make the boundary
 * invisible. Keeping them here makes it a named, testable step — which is
 * the point of CLAUDE.md 1.3, since this boundary is the project's core
 * credibility claim.
 *
 * These functions only RENAME and convert UNITS. They never compute,
 * estimate, round, or default a physics value. Anything missing upstream
 * stays missing.
 */

/**
 * Combined hard-body radius used by the screening endpoint
 * (backend/api/main.py:224, matching tests/fixtures/envisat_tles.py).
 */
export const HARD_BODY_RADIUS_KM = 0.0145

/** The same radius in metres, as ConjunctionContext expects. */
export const HARD_BODY_RADIUS_M = HARD_BODY_RADIUS_KM * 1000

/**
 * Build the AI layer's ConjunctionContext from a screening event.
 *
 * A screening event is the only physics result that carries BOTH a miss
 * distance and a Pc, so it is the natural source. `/api/physics/tca` alone
 * cannot populate this — it returns no Pc.
 *
 * @param {import('./physics.js').ScreeningEvent} event
 * @param {string} primaryName
 * @param {{ primary_alt_km?: number, hard_body_radius_m?: number }} [overrides]
 * @returns {import('./ai.js').ConjunctionContext}
 */
export function screeningEventToConjunctionContext(event, primaryName, overrides = {}) {
  return {
    primary_name: primaryName,
    secondary_name: event.secondary_name,
    // rename 1: physics says tca_utc_iso, the AI schema says tca_iso
    tca_iso: event.tca_utc_iso,
    miss_distance_m: event.miss_distance_m,
    pre_burn_pc: event.pc,
    relative_speed_km_s: event.relative_speed_km_s,
    // unit conversion 3: km in the physics layer, metres in the AI schema
    hard_body_radius_m: HARD_BODY_RADIUS_M,
    ...overrides,
  }
}

/**
 * Build a ConjunctionContext from a raw TCA result plus a separately
 * obtained Pc.
 *
 * `pc` is a required argument rather than an optional one precisely because
 * /api/physics/tca does not return it: forcing the caller to pass a real Pc
 * prevents a plausible-looking default from leaking into an AI prompt.
 *
 * @param {import('./physics.js').TcaResult} tca
 * @param {object} meta
 * @param {string} meta.primary_name
 * @param {string} meta.secondary_name
 * @param {number} meta.pc computed Pc for this encounter
 * @param {{ primary_alt_km?: number, hard_body_radius_m?: number }} [overrides]
 * @returns {import('./ai.js').ConjunctionContext}
 */
export function tcaResultToConjunctionContext(tca, meta, overrides = {}) {
  if (typeof meta?.pc !== 'number' || Number.isNaN(meta.pc)) {
    throw new TypeError(
      'tcaResultToConjunctionContext requires a real numeric pc — ' +
        '/api/physics/tca does not return one, so it must be supplied by the caller.',
    )
  }

  return {
    primary_name: meta.primary_name,
    secondary_name: meta.secondary_name,
    tca_iso: tca.tca_utc_iso,
    miss_distance_m: tca.miss_distance_m,
    pre_burn_pc: meta.pc,
    relative_speed_km_s: tca.relative_speed_km_s,
    hard_body_radius_m: HARD_BODY_RADIUS_M,
    ...overrides,
  }
}

/**
 * Reduce a maneuver simulation result to the AI schema's ManeuverOption.
 *
 * Drops `primary_name`, `secondary_name` and the `pre_burn_*` values — those
 * belong to the ConjunctionContext, not to an individual burn option — and
 * renames `maneuver_recommended` to `recommended`.
 *
 * @param {import('./physics.js').ManeuverResult} result
 * @returns {import('./ai.js').ManeuverOption}
 */
export function maneuverResultToManeuverOption(result) {
  return {
    delta_v_cm_s: result.delta_v_cm_s,
    lead_time_minutes: result.lead_time_minutes,
    post_burn_miss_distance_m: result.post_burn_miss_distance_m,
    post_burn_pc: result.post_burn_pc,
    risk_reduction_pct: result.risk_reduction_pct,
    fuel_consumed_kg: result.fuel_consumed_kg,
    // rename 2: physics says maneuver_recommended, the AI schema says recommended
    recommended: result.maneuver_recommended,
  }
}
