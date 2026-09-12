/**
 * envisatGroundTruth.js — the PUBLISHED numbers for the October 2004
 * Envisat / Zenith-2 conjunction.
 *
 * ========================= WHAT THIS FILE IS =========================
 * Reference material transcribed from a paper. NOT pipeline output, and
 * never to be displayed as though it were. The replay view shows two
 * columns side by side — what the literature says, and what our pipeline
 * computed — and this module supplies only the first. Every computed value
 * on that screen arrives over the wire from /api/physics/*.
 *
 * Keeping the published figures in one cited module is what keeps that
 * separation checkable. A constant inlined in a component would, within a
 * week, be indistinguishable from a number we produced.
 * =====================================================================
 *
 * Source: Klinkrad et al. 2005, "Operational collision avoidance with
 * regard to catalog objects" (SDC4-paper49), Section 6 — transcribed via
 * docs/validation-notes.md §4, which holds the full quotation and the
 * covariance methodology.
 */

/** Published TCA. The paper gives both :35 and :36; §4.1 prefers :35. */
export const PUBLISHED_TCA_ISO = '2004-10-22T05:10:35Z'

/**
 * Published miss-distance band across the four predictions, in METRES:
 * "81 m <= rho_tca <= 316 m".
 */
export const PUBLISHED_MISS_DISTANCE_M = { min: 81, max: 316 }

/**
 * Published collision-probability band: "1.4e-4 <= Pc <= 5.5e-4".
 */
export const PUBLISHED_PC = { min: 1.4e-4, max: 5.5e-4 }

/**
 * ESA's accepted risk threshold at the time of the event (Pc_acc <= 1e-4).
 * All four published predictions exceeded it, which is why a maneuver was
 * flown. Raised to 2e-4 by the end of 2004.
 */
export const PC_ACCEPTED_THRESHOLD = 1e-4

/**
 * The maneuver ESA actually executed: a -4.0 cm/s braking burn about 50
 * minutes before TCA, at 2004-10-22 04:20 UTC. Published post-maneuver Pc
 * fell from ~5.5e-4 to ~2.0e-4.
 *
 * `published_post_burn_pc` is the PAPER's outcome. Our own simulated burn
 * returns its own post-burn Pc from /api/physics/maneuver; the two are
 * reported separately and must never be conflated.
 */
export const EXECUTED_MANEUVER = {
  delta_v_cm_s: -4.0,
  lead_time_minutes: 50,
  burn_time_iso: '2004-10-22T04:20:00Z',
  published_pre_burn_pc: 5.5e-4,
  published_post_burn_pc: 2.0e-4,
}

/**
 * NASA's independent cross-check on day T-1d, from more accurate SSN
 * osculating state vectors: 150 m <= rho_tca <= 300 m.
 */
export const NASA_CROSSCHECK_MISS_DISTANCE_M = { min: 150, max: 300 }

/**
 * Why our computed Pc can sit above the published band while the miss
 * distances land inside it.
 *
 * ESA used Envisat's operational orbit determination for the primary
 * (position uncertainty ~3 m) and the Table 1 TLE look-up only for the
 * fragment (~556 m). We apply the Table 1 uncertainties to BOTH objects,
 * because we only have TLEs for both. That overstates the primary's
 * uncertainty, which inflates the combined covariance and biases Pc upward
 * — the conservative direction for a collision-avoidance tool, but a real
 * difference, and one the UI states rather than smooths over.
 *
 * See docs/validation-notes.md §4.3.
 */
export const PC_METHODOLOGY_NOTE =
  'ESA used Envisat’s operational orbit determination for the primary (σ ≈ 3 m) ' +
  'and TLE-derived covariance only for the fragment. We have TLEs for both objects, so we ' +
  'apply TLE-derived covariance to both. That overstates the primary’s uncertainty and ' +
  'biases Pc upward — conservative for collision avoidance, but it is why our Pc can sit ' +
  'above the published band while the miss distances land inside it.'

/**
 * The four prediction days, with the lead time the paper frames them by.
 * `day` matches the key the API returns (backend/api/main.py:97-102).
 */
export const PREDICTION_DAYS = [
  { day: 'oct_19', label: 'Oct 19', lead: 'T-3d' },
  { day: 'oct_20', label: 'Oct 20', lead: 'T-2d' },
  { day: 'oct_21', label: 'Oct 21', lead: 'T-1d' },
  { day: 'oct_22', label: 'Oct 22', lead: 'T-0d' },
]

/**
 * Is a computed value inside a published band?
 *
 * Returns null — not false — when there is no value to judge, so a missing
 * number can never render as "outside range", which would read as a
 * pipeline disagreement where there is simply no data.
 *
 * @param {number|null|undefined} value
 * @param {{min: number, max: number}} band
 * @returns {boolean|null}
 */
export function isWithinPublished(value, band) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value >= band.min && value <= band.max
}

/**
 * Short verdict string for a computed value against a published band.
 *
 * @param {number|null|undefined} value
 * @param {{min: number, max: number}} band
 * @returns {'within'|'outside'|'unknown'}
 */
export function comparePublished(value, band) {
  const within = isWithinPublished(value, band)
  if (within === null) return 'unknown'
  return within ? 'within' : 'outside'
}

/**
 * Look up the prediction-day descriptor for an API `day` key.
 *
 * @param {string} dayKey
 * @returns {{day: string, label: string, lead: string}|null}
 */
export function predictionDay(dayKey) {
  return PREDICTION_DAYS.find((d) => d.day === dayKey) ?? null
}
