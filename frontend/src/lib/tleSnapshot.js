/**
 * tleSnapshot.js — a small, committed set of real TLEs used ONLY when the
 * live CelesTrak feed cannot be reached.
 *
 * WHY THIS EXISTS
 * The globe depended on a live third-party fetch with no fallback, so an
 * unreachable CelesTrak (rate limit, conference wifi, outage) emptied the
 * hero view entirely. That is a demo-killer for a dependency we do not
 * control. CLAUDE.md's data-source note already asks for exactly this:
 * "fetch live or cache locally".
 *
 * HONESTY REQUIREMENTS — these are not optional:
 *   - These are REAL, unmodified TLEs captured from CelesTrak's `stations`
 *     group at the epoch below. Nothing here is synthetic or hand-tuned.
 *   - Whenever this snapshot is in use, the UI must say so and show the
 *     epoch. It must never be presented as a live feed.
 *   - Positions propagated from these elements drift from reality as the
 *     epoch ages. That is acceptable for an ambient visualisation and
 *     unacceptable for anything else — this data must never reach the
 *     physics pipeline or an AI prompt (see useLiveSatellites.js).
 *
 * Captured: 2026-08-30 (TLE epoch 26242, i.e. day 242 of 2026).
 * Source: https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle
 *
 * To refresh: run `npm run refresh:tle` (frontend/scripts/refresh-tle.mjs),
 * which rewrites this file from a live fetch. Do not hand-edit the lines —
 * SGP4 parses them by column and a stray character silently changes an orbit.
 */

/** ISO date this snapshot was captured, shown in the UI when it is in use. */
export const SNAPSHOT_CAPTURED_UTC = '2026-08-30'

/**
 * Raw CelesTrak 3-line-format text, parsed by the same parseTleText() used
 * for the live feed so both paths go through identical code.
 */
export const TLE_SNAPSHOT_TEXT = `ISS (ZARYA)
1 25544U 98067A   26242.49847866  .00005671  00000+0  11126-3 0  9990
2 25544  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909583274
POISK
1 36086U 09060A   26242.49847866  .00005671  00000+0  11126-3 0  9998
2 36086  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909583963
CSS (TIANHE)
1 48274U 21035A   26242.40883656  .00019520  00000+0  24340-3 0  9994
2 48274  41.4676 231.4402 0001913 255.2624 104.8002 15.59424488304755
ISS (NAUKA)
1 49044U 21066A   26242.49847866  .00005671  00000+0  11126-3 0  9996
2 49044  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909584007
`
