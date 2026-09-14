/**
 * injectedScenario.js — a SYNTHETIC close-approach case, for demonstrating
 * detection.
 *
 * ======================== READ THIS BEFORE USING ========================
 * The two debris objects below DO NOT EXIST. They are not in any catalog,
 * they were never observed, and their element sets were constructed. Every
 * surface that renders them must say so: the UI labels this scenario
 * INJECTED, and these objects must never be mixed into the live tracked set,
 * counted as tracked objects, or presented as something the feed returned.
 *
 * What is NOT synthetic is everything downstream. The element sets are fed to
 * the same /api/physics/screening the live console uses, and the miss
 * distance, TCA, relative speed and Pc that come back are computed by the
 * real pipeline with no special-casing — the endpoint cannot tell these
 * objects from catalogued ones. That is the point: the scenario supplies an
 * encounter for the pipeline to find, and the pipeline does the finding.
 * ========================================================================
 *
 * WHY IT EXISTS. Real conjunctions closer than a few kilometres are rare per
 * object per day, so honest live screening of a scoped candidate set reports
 * nothing almost every day. That is a true and defensible result, but it
 * leaves the detection half of the system with nothing to show. The project
 * checklist anticipates this: "manually injected cases serve the same role
 * for detection [as the Envisat replay does for correctness]".
 *
 * HOW THEY WERE BUILT. Both are the ISS (ZARYA) element set below with the
 * orbit plane rotated and the along-track phase shifted:
 *   - inclination  +25.0000 deg   (a crossing orbit, not a co-orbital one)
 *   - RAAN          +2.6200 deg
 *   - mean motion   15.49460000   (tuned so the two orbit tracks actually
 *                                  intersect rather than passing radially
 *                                  offset by the eccentricity difference)
 *   - mean anomaly  phased per object to set how close each one passes
 * Eccentricity, argument of perigee, drag and epoch are the ISS's, unchanged.
 * Checksums are recomputed; catalog numbers use the 90000 analyst range, which
 * is not a real catalog assignment.
 *
 * THE SCENARIO IS SELF-CONTAINED, including its primary. The geometry was
 * solved against this specific ISS element set at this specific epoch, so
 * pairing the debris with a fresher live ISS element set would not reproduce
 * the encounter — it would produce some other, meaningless geometry. Screening
 * therefore runs against the primary bundled here, not against the live feed.
 *
 * WHAT THE PIPELINE REPORTS (validated 2026-09-14 against a live backend):
 *   DEBRIS A   405.7 m   Pc 4.66e-05   YELLOW   rel. speed 3.32 km/s
 *   DEBRIS B  6075.4 m   Pc 7.29e-22   GREEN    rel. speed 3.32 km/s
 *
 * Note what was NOT done: the geometry was not tuned until it produced a RED.
 * The A object sits where a plausible crossing orbit put it, and YELLOW is the
 * level the physics assigned. Adjusting a synthetic encounter until it returns
 * an alarming number would be manufacturing a crisis, which is the same
 * dishonesty as fabricating the number outright.
 */

/**
 * The real ISS element set the geometry was solved against — the same lines
 * that appear in the offline snapshot, repeated here so the scenario does not
 * silently change meaning when the snapshot is refreshed.
 */
export const INJECTED_PRIMARY = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26242.49847866  .00005671  00000+0  11126-3 0  9990',
  line2: '2 25544  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909583274',
}

/** The synthetic objects. Catalog numbers are analyst-range, not real. */
export const INJECTED_DEBRIS = [
  {
    name: 'INJECTED DEBRIS A',
    line1: '1 90001U 26900A   26242.49847866  .00005671  00000+0  11126-3 0  9997',
    line2: '2 90001  76.6316 294.9106 0005027  90.0365 267.3075 15.49460000 58326',
  },
  {
    name: 'INJECTED DEBRIS B',
    line1: '1 90002U 26900A   26242.49847866  .00005671  00000+0  11126-3 0  9998',
    line2: '2 90002  76.6316 294.9106 0005027  90.0365 267.3600 15.49460000 58321',
  },
]

/**
 * The scenario declares its own search window rather than inheriting the
 * console's epoch anchoring, because the geometry was solved for this window.
 *
 * It opens about 12 hours BEFORE the element-set epoch, which is ordinary
 * practice — a TLE is used for days either side of its epoch, and propagating
 * half a day backwards costs nothing in accuracy. Anchoring to the epoch
 * instead would open the window after the encounter and find a different,
 * meaningless 160 km pass.
 *
 * Live screening still anchors to the epoch; only this self-contained
 * scenario overrides it, and it does so explicitly.
 */
export const INJECTED_WINDOW_START_ISO = '2026-08-30T00:00:00Z'

/** Hours to screen from that start. The encounter falls about 20 minutes in. */
export const INJECTED_SEARCH_HOURS = 6

/** Shown wherever the scenario appears, so the label is never improvised. */
export const INJECTED_LABEL = 'INJECTED'

export const INJECTED_DESCRIPTION =
  'A constructed close approach against a real ISS element set. The debris objects ' +
  'are synthetic and exist only here; the miss distance, TCA and collision ' +
  'probability are computed by the same pipeline the live console uses.'
