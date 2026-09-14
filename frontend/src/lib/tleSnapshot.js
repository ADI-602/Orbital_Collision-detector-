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
 * Objects: 2
 *
 * To refresh: run `npm run refresh:tle` (frontend/scripts/refresh-tle.mjs),
 * which rewrites this file from a live fetch. Do not hand-edit the lines —
 * SGP4 parses them by column and a stray character silently changes an orbit.
 *
 * ---------------------------------------------------------------------------
 * CORRECTION, 2026-09-14. This file previously listed four objects. Two of
 * them — "POISK" and "ISS (NAUKA)" — were the ISS (ZARYA) element set with
 * only the catalog number and trailing digits changed: all nine orbital
 * elements AND the epoch matched ZARYA digit for digit. Independently
 * generated element sets never do that, not even for modules docked to the
 * same station. The file had also not been produced by refresh-tle.mjs (its
 * header lacks that script's "GENERATED FILE" marker), so the entries were
 * hand-written despite the instruction above.
 *
 * They are removed rather than corrected, because there is no honest way to
 * reconstruct element sets we never had. That leaves two genuine objects, so
 * the offline globe is sparse until someone with network access runs
 * `npm run refresh:tle`. A sparse honest globe beats a populated one showing
 * two phantom objects flying inside the ISS.
 *
 * The consequence was not only cosmetic: identical elements mean zero
 * separation and zero relative velocity, which made conjunction screening
 * across this set fail outright (a B-plane is undefined for a stationary
 * encounter). tleSnapshot.test.js now guards the invariant.
 * ---------------------------------------------------------------------------
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
CSS (TIANHE)
1 48274U 21035A   26242.40883656  .00019520  00000+0  24340-3 0  9994
2 48274  41.4676 231.4402 0001913 255.2624 104.8002 15.59424488304755
`
