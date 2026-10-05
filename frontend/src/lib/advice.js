import {
  maneuverResultToManeuverOption,
  screeningEventToConjunctionContext,
} from '../api/adapters.js'
import { isoToMs } from './replay.js'

/**
 * advice.js — pure helpers for the AI advisor panel.
 *
 * Nothing here computes a physics quantity. It only reshapes numbers the
 * pipeline already returned into the AI layer's input contract, and decides
 * how the answer may be labelled.
 */

/**
 * Build the POST /api/ai/advise body for a screening event.
 *
 * The maneuver option is included only when a burn has actually been
 * simulated for THIS event; the advisor is never handed a burn the pipeline
 * did not compute.
 *
 * @param {object} event screening event (needs pc, miss_distance_m, tca_utc_iso)
 * @param {string} primaryName
 * @param {object|null} maneuverResult result of /api/physics/maneuver, if any
 * @returns {object}
 */
export function buildAdviceRequest(event, primaryName, maneuverResult = null) {
  return {
    conjunction: screeningEventToConjunctionContext(event, primaryName),
    maneuvers: maneuverResult ? [maneuverResultToManeuverOption(maneuverResult)] : [],
    query_type: 'recommendation',
  }
}

/**
 * Why the advisor cannot be asked about this event, or null if it can.
 * A missing Pc or TCA must surface as missing, never be defaulted into a
 * prompt (CLAUDE.md §1.3).
 *
 * @param {object|null} event
 * @returns {string|null}
 */
export function adviceRefusal(event) {
  if (!event) return null
  if (event.unassessable || event.status === 'unassessable') {
    return 'The pipeline declined to assess this pair, so there are no figures for the advisor to explain.'
  }
  if (typeof event.pc !== 'number' || Number.isNaN(event.pc)) {
    return 'No collision probability was computed for this event, so there is nothing to explain.'
  }
  if (typeof event.miss_distance_m !== 'number' || Number.isNaN(event.miss_distance_m)) {
    return 'No miss distance was computed for this event, so there is nothing to explain.'
  }
  if (!Number.isFinite(isoToMs(event.tca_utc_iso))) {
    return 'No time of closest approach was computed for this event.'
  }
  return null
}

/**
 * How to label a response. "Live" only when is_fallback is exactly false;
 * anything ambiguous is reported as the offline advisor (see api/ai.js).
 *
 * @param {{is_fallback?: unknown}|null|undefined} response
 * @returns {{live: boolean, label: string, note: string}}
 */
export function adviceProvenance(response) {
  if (response?.is_fallback === false) {
    return {
      live: true,
      label: 'AI: LIVE',
      note: 'Written by a language model from the figures above. It computes none of them.',
    }
  }
  return {
    live: false,
    label: 'AI: OFFLINE ADVISOR',
    note:
      'The language model did not answer, so this is the deterministic rule-based advisor. ' +
      'Same figures, templated wording.',
  }
}
