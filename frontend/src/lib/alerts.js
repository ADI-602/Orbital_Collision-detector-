import { EVENT_ORIGIN, isNotARisk } from './conjunctions.js'
import { isoToMs } from './replay.js'

/**
 * alerts.js — which screening results deserve an alert, and which are new.
 *
 * Pure, so the rules are unit-tested rather than discovered on stage.
 *
 * WHAT RAISES AN ALERT. A LIVE event the pipeline rated RED or YELLOW. Never
 * the injected 2004 validation case (it is not happening in orbit today), and
 * never a pair the pipeline declined to assess or a co-orbital stack — those
 * have no encounter to warn about.
 *
 * WHAT COUNTS AS NEW. Each scheduled pass re-screens the catalogue and
 * re-refines every encounter, so the same conjunction comes back with a TCA
 * that differs slightly pass to pass. Matching on the exact TCA string would
 * re-alert every 15 minutes for one event. So an event is "already seen" when
 * the same pair has been alerted with a TCA within TCA_MATCH_TOLERANCE_MS.
 *
 * Nothing here computes or adjusts a physics value; it only compares the
 * pipeline's own outputs.
 */

/** Threat levels that raise an alert, most severe first. */
export const ALERT_LEVELS = ['RED', 'YELLOW']

/** Two detections of one pair this close in TCA are the same encounter. */
export const TCA_MATCH_TOLERANCE_MS = 10 * 60 * 1000

/** Forget a seen encounter this long after its TCA has passed. */
export const SEEN_RETENTION_MS = 2 * 24 * 3600 * 1000

/** Most alerts raised from one pass; the rest are summarised as a count. */
export const MAX_ALERTS_PER_PASS = 3

/**
 * @param {object} event
 * @returns {boolean}
 */
export function isAlertable(event) {
  if (!event || event.origin === EVENT_ORIGIN.VALIDATION) return false
  if (!ALERT_LEVELS.includes(event.threat_level)) return false
  if (isNotARisk(event)) return false
  return Number.isFinite(isoToMs(event.tca_utc_iso))
}

/**
 * Order-independent identity of the two objects: A×B and B×A are one pair.
 * @param {object} event
 */
export function pairKey(event) {
  const a = String(event.primary_id ?? event.primary_name ?? '?')
  const b = String(event.secondary_id ?? event.secondary_name ?? '?')
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * @typedef {{pair: string, tcaMs: number}} SeenEncounter
 */

/**
 * @param {object} event
 * @param {SeenEncounter[]} seen
 */
export function wasSeen(event, seen) {
  const pair = pairKey(event)
  const tcaMs = isoToMs(event.tca_utc_iso)
  return seen.some(
    (s) => s.pair === pair && Math.abs(s.tcaMs - tcaMs) <= TCA_MATCH_TOLERANCE_MS,
  )
}

/**
 * Alertable events in `events` not yet in `seen`, most severe first (the
 * caller passes events already ranked by the pipeline's own rule).
 *
 * @param {object[]} events
 * @param {SeenEncounter[]} seen
 * @returns {object[]}
 */
export function findNewAlerts(events, seen) {
  return (events ?? []).filter((e) => isAlertable(e) && !wasSeen(e, seen))
}

/**
 * Record `events` as seen, and drop encounters whose TCA is long past so the
 * list stays small.
 *
 * @param {SeenEncounter[]} seen
 * @param {object[]} events
 * @param {number} [nowMs]
 * @returns {SeenEncounter[]}
 */
export function markSeen(seen, events, nowMs = Date.now()) {
  const next = (seen ?? []).filter((s) => nowMs - s.tcaMs < SEEN_RETENTION_MS)
  for (const e of events) {
    if (!wasSeen(e, next)) next.push({ pair: pairKey(e), tcaMs: isoToMs(e.tca_utc_iso) })
  }
  return next
}

/**
 * Parse a stored seen-list defensively: storage is per-browser and can hold
 * anything, so only well-formed entries survive.
 *
 * @param {string|null} raw
 * @returns {SeenEncounter[]}
 */
export function parseSeen(raw) {
  try {
    const parsed = JSON.parse(raw ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((s) => typeof s?.pair === 'string' && Number.isFinite(s?.tcaMs))
      : []
  } catch {
    return []
  }
}
