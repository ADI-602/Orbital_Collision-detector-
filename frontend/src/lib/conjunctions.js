/**
 * conjunctions.js — derivation over screening events.
 *
 * Pure functions only: no network, no React, no orbital mechanics. Every
 * number here arrives already computed by the Python pipeline behind
 * /api/physics/screening; this module ranks, classifies for display, and
 * formats. It computes no physics of its own, and it must never adjust a
 * value it was handed.
 *
 * The logic lives outside the components because the vitest setup runs
 * `environment: 'node'` with no jsdom and no testing library — a component
 * cannot be rendered in a test, but this can.
 *
 * ---------------------------------------------------------------------------
 * WHY RANKING IS DONE CLIENT-SIDE
 *
 * The backend's order is NOT risk order. screen_candidates sorts by
 * ConjunctionCandidate.min_separation_km (backend/physics/screening.py:499) —
 * the COARSE separation, found before the per-event TCA refinement that runs
 * afterwards at backend/api/main.py:202-234. So the emitted miss_distance_m
 * values are not even monotonic with the sort key, and the order says nothing
 * about Pc, threat level, or which event happens first. Presenting events in
 * wire order would put a GREEN event above a RED one.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE TWO CO-ORBITAL PATHS
 *
 * Objects flying together reach us in two different ways, and both have to be
 * handled or the live console breaks:
 *
 *  1. EXACTLY zero relative velocity — two catalogue entries for what is
 *     physically one stack (ISS with POISK and NAUKA, say). compute_pc refuses
 *     outright at rel_speed < 1e-9 km/s
 *     (backend/physics/collision_probability.py:234): a B-plane cannot be
 *     defined for a stationary pair. The endpoint turns that into a 500 for
 *     the WHOLE request, so one such pair takes down every other candidate in
 *     the batch — which is why useScreening.js screens candidates one at a
 *     time. Recognise it with isCoOrbitalRefusal() and render the pair as
 *     unassessable, carrying the backend's own words.
 *  2. NEAR zero relative velocity — docked or formation-flying, but with
 *     slightly different element sets. The backend's guard does not fire, so a
 *     Pc comes back; it is just not a meaningful one. That is what
 *     classifyEncounter() below is for.
 * ---------------------------------------------------------------------------
 */

/** Where an event in the list came from. */
export const EVENT_ORIGIN = {
  /** Screened from the live tracked set, right now. */
  LIVE: 'live',
  /** A known historical conjunction injected to demonstrate detection. */
  VALIDATION: 'validation',
}

/**
 * Below this relative speed, a "conjunction" is really two objects flying
 * together — docked, or in formation.
 *
 * This is a DISPLAY classification made in the frontend, not a pipeline
 * output. It is labelled as such wherever it is rendered.
 *
 * Why it is needed, and why the cutoff sits here: the tracked set is
 * CelesTrak's `stations` group, which is co-orbital by construction (ISS with
 * docked Progress/Soyuz, CSS with Shenzhou), and screen_candidates only skips
 * SELF-pairs by satnum (backend/physics/screening.py:473). A docked cargo
 * vehicle therefore screens as a sub-kilometre approach and lands in RED.
 *
 * The cutoff is not cosmetic. A genuine LEO conjunction has a relative speed
 * of order 1-15 km/s (the Envisat/Zenith-2 encounter is ~14.8 km/s); a docked
 * pair is ~0. The 2D encounter-plane Pc method assumes a rectilinear
 * high-speed flyby, so that the relative motion crosses the encounter plane
 * essentially instantaneously. At near-zero relative velocity that assumption
 * does not hold, and the returned Pc is outside the method's domain of
 * validity — it is not a smaller risk or a larger one, it is not a number the
 * method is entitled to produce. Labelling the pair is therefore more correct
 * than showing its Pc, and far more correct than showing it as RED.
 *
 * 0.1 km/s sits an order of magnitude above station-keeping drift and an order
 * of magnitude below the slowest genuine conjunction geometry.
 */
export const CO_ORBITAL_MAX_REL_SPEED_KM_S = 0.1

/** Severity order for display. Higher sorts first. */
const THREAT_RANK = { RED: 3, YELLOW: 2, GREEN: 1 }

/**
 * Recognise the backend refusing to define a B-plane for a stationary pair
 * (backend/physics/collision_probability.py:234-237, surfaced through the
 * screening route's 500 handler).
 *
 * Matched on the message because the endpoint reports every failure as a bare
 * 500 with a detail string — there is no error code to key on. The match is
 * deliberately narrow: any other 500 is a real failure and must keep looking
 * like one, not be quietly relabelled "co-orbital".
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isCoOrbitalRefusal(err) {
  const detail = err?.detail ?? err?.message
  if (typeof detail !== 'string') return false
  return /relative velocity at tca is effectively zero/i.test(detail)
}

/**
 * Build the row shown for a pair the pipeline declined to assess.
 *
 * It carries NO Pc, NO miss distance and NO TCA, because the request failed
 * before producing any — inventing a placeholder for a number the pipeline
 * refused to compute is precisely the thing this project does not do.
 *
 * @param {string} secondaryName
 * @param {string|null} primaryName
 * @param {string} reason backend detail, verbatim
 * @param {string} origin
 * @param {{primaryId?: string, secondaryId?: string}} [ids] tracked-object
 *   record ids, when both objects are on the live globe — see hasGlobePresence()
 */
export function unassessableEvent(secondaryName, primaryName, reason, origin = EVENT_ORIGIN.LIVE, ids = {}) {
  return {
    secondary_name: secondaryName,
    primary_name: primaryName,
    origin,
    unassessable: true,
    reason,
    primary_id: ids.primaryId,
    secondary_id: ids.secondaryId,
  }
}

/**
 * True when both objects in this event are entities already rendered on the
 * live globe, so a connecting line can be drawn between real points instead
 * of asserted against nothing.
 *
 * Only LIVE events carry object ids (useScreening.js attaches them from the
 * tracked-object records that were actually screened). An injected event —
 * the October 2004 Envisat/Zenith-2 replay — never qualifies: those objects
 * are not part of the live tracked set, so there is nothing on today's globe
 * to draw a line to. That is not a bug to fix here; see the module docblock
 * in useScreening.js for why a 2004 event and a live "now" globe cannot share
 * one clock.
 *
 * @param {object} event
 * @returns {boolean}
 */
export function hasGlobePresence(event) {
  return (
    event?.origin === EVENT_ORIGIN.LIVE &&
    typeof event?.primary_id === 'string' &&
    typeof event?.secondary_id === 'string'
  )
}

/**
 * The Pc boundaries the backend assigns threat levels by, mirrored for
 * DISPLAY ONLY (legend, badge tooltip). The level on every event is still the
 * backend's own `threat_level`; nothing here re-derives one. Keep in step with
 * PC_RED / PC_YELLOW in backend/api/assessment.py.
 */
export const THREAT_THRESHOLDS = { RED: 1e-4, YELLOW: 1e-5 }

/**
 * Colour for the globe highlight and connecting line — mirrors RiskBadge's
 * palette (styles/tokens.css --risk-*) so the globe and the list agree.
 * Duplicated as literal hex because Cesium's canvas rendering has no access
 * to CSS custom properties.
 */
const RISK_LINE_HEX = { RED: '#f43f5e', YELLOW: '#fbbf24', GREEN: '#4ade80' }
const UNKNOWN_LINE_HEX = '#71717a'

/**
 * Orbit colours by role in the pair, mirroring styles/tokens.css --orbit-*.
 * They say which object an orbit belongs to, never how risky the event is —
 * the hues are kept off the risk scale for exactly that reason.
 */
export const ORBIT_IDENTITY_HEX = { primary: '#60a5fa', secondary: '#c084fc' }

/**
 * Pick the colour a globe highlight for this event should use. A co-orbital
 * or unassessable pair always renders in the neutral "unknown" colour — never
 * a risk colour — for the same reason RiskBadge never colours them: their Pc
 * is not a risk statement.
 *
 * @param {object} event
 * @returns {string} CSS hex colour
 */
export function riskColorHex(event) {
  if (isNotARisk(event)) return UNKNOWN_LINE_HEX
  return RISK_LINE_HEX[event?.threat_level] ?? UNKNOWN_LINE_HEX
}

/**
 * True when the pipeline declined to assess this pair.
 * @param {object} event
 */
export function isUnassessable(event) {
  return event?.unassessable === true
}

/**
 * True when the row must not be presented as a collision risk — either
 * because the pipeline refused it, or because its relative speed puts it
 * outside the Pc method's domain.
 * @param {object} event
 */
export function isNotARisk(event) {
  return isUnassessable(event) || isCoOrbital(event)
}

/**
 * Decide whether a screening event describes an encounter or two objects
 * flying together.
 *
 * An event with a missing or non-finite relative speed is treated as a
 * conjunction: the honest default is to keep the pipeline's own verdict rather
 * than to silently downgrade something to "not a threat".
 *
 * @param {import('../api/physics.js').ScreeningEvent} event
 * @returns {{ kind: 'conjunction' | 'co-orbital', reason: string | null }}
 */
export function classifyEncounter(event) {
  const relSpeed = event?.relative_speed_km_s

  if (typeof relSpeed !== 'number' || !Number.isFinite(relSpeed)) {
    return { kind: 'conjunction', reason: null }
  }

  if (Math.abs(relSpeed) < CO_ORBITAL_MAX_REL_SPEED_KM_S) {
    return {
      kind: 'co-orbital',
      reason:
        `Relative speed ${relSpeed.toFixed(3)} km/s is below ` +
        `${CO_ORBITAL_MAX_REL_SPEED_KM_S} km/s — these objects are flying together ` +
        '(docked or in formation), not approaching each other. The 2D ' +
        'encounter-plane method assumes a high-speed flyby, so a collision ' +
        'probability is not meaningful for this pair.',
    }
  }

  return { kind: 'conjunction', reason: null }
}

/**
 * True when the event should not be presented as a collision risk.
 * @param {import('../api/physics.js').ScreeningEvent} event
 */
export function isCoOrbital(event) {
  if (event?.unassessable) return false
  return classifyEncounter(event).kind === 'co-orbital'
}

/**
 * Stable identity for an event across re-screens.
 *
 * Built from origin + BOTH object identities + TCA rather than the array
 * index, because events.length can be smaller than candidates_screened —
 * candidates whose refined TCA comes back empty are dropped silently
 * (backend/api/main.py:207-208), so index is not a stable identity.
 *
 * BOTH objects, not just the secondary. The key used to omit the primary,
 * which was safe only while one fixed primary was screened against many
 * candidates. All-pairs screening (backend/api/monitoring.py) removed that
 * guarantee: `ISS (ZARYA) x ISS (NAUKA)` and `POISK x ISS (NAUKA)` share a
 * secondary, and neither has a TCA to tell them apart when the pipeline
 * refuses a co-located pair. They collided into one key — React dropped a row,
 * and because selection is keyed on this, clicking one selected the other.
 *
 * Ids are preferred over names when present: they are the tracked-set
 * identity, and two catalogued objects can share a display name.
 *
 * @param {import('../api/physics.js').ScreeningEvent & {origin?: string}} event
 * @returns {string}
 */
export function eventKey(event) {
  const origin = event?.origin ?? EVENT_ORIGIN.LIVE
  const primary = event?.primary_id ?? event?.primary_name ?? '?'
  const secondary = event?.secondary_id ?? event?.secondary_name ?? '?'
  return `${origin}:${primary}:${secondary}:${event?.tca_utc_iso ?? '?'}`
}

/**
 * Which event the console should open on.
 *
 * The most serious LIVE detection (RED, then YELLOW, then by Pc) — it is real
 * and happening now. Failing that, the injected Envisat case, which is always
 * present and always tagged as a 2004 replay. A GREEN, co-orbital or refused
 * pair is never auto-selected: opening on one would present a non-event as
 * the headline.
 *
 * Selection only — it changes what is shown first, never a number.
 *
 * @param {object[]} events
 * @returns {object|null}
 */
export function pickInitialEvent(events) {
  const ranked = rankEvents(events)
  const elevated = (e) => e?.threat_level === 'RED' || e?.threat_level === 'YELLOW'
  const live = ranked.find(
    (e) => (e.origin ?? EVENT_ORIGIN.LIVE) === EVENT_ORIGIN.LIVE && !isNotARisk(e) && elevated(e),
  )
  if (live) return live
  return ranked.find((e) => e.origin === EVENT_ORIGIN.VALIDATION && !isNotARisk(e)) ?? null
}

/**
 * Order events for display: most serious first.
 *
 * Co-orbital and unassessable pairs sort last whatever their Pc, since that Pc
 * is not a risk statement (see CO_ORBITAL_MAX_REL_SPEED_KM_S). Within a group:
 * threat level, then Pc descending, then earliest TCA, then name — the last
 * two keys make
 * the order total, so the same input always renders the same way.
 *
 * Returns a new array; the input is not mutated.
 *
 * @template {import('../api/physics.js').ScreeningEvent} T
 * @param {T[]} events
 * @returns {T[]}
 */
export function rankEvents(events) {
  if (!Array.isArray(events)) return []

  return [...events].sort((a, b) => {
    const aCo = isNotARisk(a)
    const bCo = isNotARisk(b)
    if (aCo !== bCo) return aCo ? 1 : -1

    const threat = (THREAT_RANK[b?.threat_level] ?? 0) - (THREAT_RANK[a?.threat_level] ?? 0)
    if (threat !== 0) return threat

    const pcA = Number.isFinite(a?.pc) ? a.pc : -1
    const pcB = Number.isFinite(b?.pc) ? b.pc : -1
    if (pcA !== pcB) return pcB - pcA

    const tcaA = a?.tca_utc_iso ?? ''
    const tcaB = b?.tca_utc_iso ?? ''
    if (tcaA !== tcaB) return tcaA < tcaB ? -1 : 1

    return String(a?.secondary_name ?? '').localeCompare(String(b?.secondary_name ?? ''))
  })
}

/**
 * Render a collision probability.
 *
 * Always exponential notation. Real Pc values live around 1e-4, so fixed-point
 * formatting renders every one of them as "0.00" — a RED event would read as
 * no risk at all.
 *
 * @param {number} pc
 * @returns {string} e.g. "6.59e-4", or "—" when there is no number
 */
export function formatPc(pc) {
  if (typeof pc !== 'number' || !Number.isFinite(pc)) return '—'
  if (pc === 0) return '0'
  return pc.toExponential(2)
}

/**
 * Render a miss distance. Metres below 10 km (where conjunctions are decided),
 * kilometres above it.
 *
 * @param {number} metres
 * @returns {string}
 */
export function formatMissDistance(metres) {
  if (typeof metres !== 'number' || !Number.isFinite(metres)) return '—'
  if (Math.abs(metres) < 10000) return `${metres.toFixed(0)} m`
  return `${(metres / 1000).toFixed(1)} km`
}

/**
 * Render a relative speed.
 * @param {number} kmS
 * @returns {string}
 */
export function formatRelativeSpeed(kmS) {
  if (typeof kmS !== 'number' || !Number.isFinite(kmS)) return '—'
  return `${kmS.toFixed(2)} km/s`
}

/**
 * Split a backend TCA string into date and time for two-line display.
 *
 * The wire format is "YYYY-MM-DDTHH:MM:SSZ" — UTC, Z-suffixed, rounded to the
 * nearest second by skyfield's utc_strftime. Parsed by slicing rather than via
 * Date, so a value that is not in that exact shape shows as-is instead of
 * being silently reinterpreted in the viewer's local timezone.
 *
 * @param {string} iso
 * @returns {{ date: string, time: string, raw: string }}
 */
export function splitTcaIso(iso) {
  if (typeof iso !== 'string' || iso.length < 20 || iso[10] !== 'T') {
    return { date: '—', time: '—', raw: typeof iso === 'string' ? iso : '' }
  }
  return { date: iso.slice(0, 10), time: `${iso.slice(11, 19)}Z`, raw: iso }
}
