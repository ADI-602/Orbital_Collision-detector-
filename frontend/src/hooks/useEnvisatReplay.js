import { useCallback, useEffect, useRef, useState } from 'react'

import { CanceledError } from '../api/client.js'
import { getEnvisatReplay } from '../api/conjunctions.js'
import { screenCandidates } from '../api/physics.js'
import { EVENT_ORIGIN } from '../lib/conjunctions.js'
import { buildSatrec, propagateToGeodetic } from '../lib/geodetic.js'
import { orbitPointEcef, orbitTrackEcef } from '../lib/orbitTrack.js'
import {
  PREDICTION_DAYS,
  PUBLISHED_TCA_UTC_ISO,
  REPLAY_SCREEN_START_UTC_ISO,
  REPLAY_SCREEN_WINDOW_HOURS,
  isoToMs,
} from '../lib/replay.js'

/**
 * useEnvisatReplay — load the October 2004 Envisat / Zenith-2 conjunction and
 * run every prediction day through the validated physics pipeline.
 *
 * WHAT IS REAL HERE, AND WHAT IS DRAWN
 *
 *   Numbers  Every miss distance, Pc, threat level and TCA comes from
 *            POST /api/physics/screening. This hook chooses the window and
 *            collects the responses; it computes nothing.
 *   Markers  The two globe positions are propagated in-browser by
 *            satellite.js from the same archived TLEs the pipeline was given
 *            (lib/geodetic.js). They are a visualisation of where the objects
 *            were, never a measurement — the separation you see on screen is
 *            not the miss distance, which is reported as a number.
 *   Tracks   Each orbit ring is that same marker's path over one revolution
 *            (lib/orbitTrack.js). Drawing the two planes crossing is what
 *            makes the encounter legible; it measures nothing.
 *
 * FOUR DAYS, ONE WINDOW. The archived TLEs are four element sets of differing
 * age describing one encounter, so all four are screened over the same window
 * around the real TCA (lib/replay.js documents why). That makes the four rows
 * directly comparable, which is the entire point of showing them together.
 *
 * The four requests run concurrently and settle independently: one day failing
 * costs that row, not the panel. Screening is ~2 s per day against a 180 s
 * client timeout, so the set completes in about the time one day would.
 */

/** A stable id per object so the globe can key its two entities. */
const PRIMARY_ID = 'replay-envisat'
const SECONDARY_ID = 'replay-zenith2'

/**
 * Screen one prediction day.
 *
 * Returns the day's outcome rather than throwing, so `Promise.all` over the
 * four cannot lose three good results to one bad one.
 *
 * @returns {Promise<{key: string, event: object|null, error: Error|null, predictionDate: string}>}
 */
async function screenDay(day, signal) {
  try {
    const result = await screenCandidates(
      {
        primary: day.envisat_tle,
        candidates: [day.secondary_tle],
        start_utc_iso: REPLAY_SCREEN_START_UTC_ISO,
        search_duration_hours: REPLAY_SCREEN_WINDOW_HOURS,
      },
      { signal },
    )

    const event = (result.events ?? [])[0] ?? null
    return {
      key: day.day,
      predictionDate: day.prediction_date,
      // An empty events array is a real answer, not an error — but for this
      // event it would mean the pipeline stopped detecting a conjunction it
      // is known to detect, so it is surfaced as its own state rather than
      // rendered as a blank row.
      event: event
        ? {
          ...event,
          primary_name: result.primary_name,
          origin: EVENT_ORIGIN.VALIDATION,
          /**
           * The archived element sets this day was screened from, carried so
           * the avoidance burn can be re-flown against the same inputs. These
           * objects are not in today's tracked set, so the event has to bring
           * its own TLEs (see useManeuver.elementSetsFor).
           */
          tle_pair: { primary: day.envisat_tle, secondary: day.secondary_tle },
        }
        : null,
      error: null,
    }
  } catch (err) {
    if (err instanceof CanceledError) throw err
    return { key: day.day, predictionDate: day.prediction_date, event: null, error: err }
  }
}

/**
 * Load the replay: archived TLEs, four screening runs, and a propagator for
 * the two objects.
 *
 * @returns {{
 *   status: 'loading' | 'ready' | 'error',
 *   error: Error | null,
 *   eventName: string | null,
 *   days: Array<{key: string, label: string, lead: string, predictionDate: string|null,
 *                event: object|null, error: Error|null}>,
 *   headline: object | null,
 *   tcaIso: string,
 *   tcaMs: number,
 *   tcaIsComputed: boolean,
 *   pair: {primaryName: string, secondaryName: string} | null,
 *   objectCount: number,
 *   propagateAll: (when: Date) => Array<object>,
 *   orbitTrackFor: (id: string, when: Date) => Array<{x: number, y: number, z: number}> | null,
 *   reload: () => void
 * }}
 */
export function useEnvisatReplay() {
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [eventName, setEventName] = useState(null)
  const [days, setDays] = useState(() =>
    PREDICTION_DAYS.map((d) => ({ ...d, predictionDate: null, event: null, error: null })),
  )
  const [pair, setPair] = useState(null)
  const [objectCount, setObjectCount] = useState(0)
  const [nonce, setNonce] = useState(0)

  // satrecs live in a ref, not state: the render loop calls propagateAll ~60
  // times a second and must not depend on a React render having happened.
  // `objectCount` mirrors the length as state, because reading a ref during
  // render would give the globe a count React never re-rendered for.
  const satrecsRef = useRef([])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()

    const load = async () => {
      setStatus('loading')
      setError(null)

      try {
        const replay = await getEnvisatReplay({ signal: controller.signal })
        if (disposed) return

        const byKey = new Map((replay.prediction_days ?? []).map((d) => [d.day, d]))

        // The globe draws the last prediction before the maneuver decision —
        // the same element sets whose numbers the headline quotes. Stated on
        // screen so it is never ambiguous which of the four is being shown.
        const globeDay = byKey.get('oct_22') ?? (replay.prediction_days ?? [])[0]
        if (globeDay) {
          const primary = buildSatrec(
            globeDay.envisat_tle.line1,
            globeDay.envisat_tle.line2,
            globeDay.envisat_tle.name,
          )
          const secondary = buildSatrec(
            globeDay.secondary_tle.line1,
            globeDay.secondary_tle.line2,
            globeDay.secondary_tle.name,
          )

          // A rejected element set drops that marker rather than substituting
          // anything; the numbers still come from the pipeline either way.
          satrecsRef.current = [
            primary && { id: PRIMARY_ID, name: globeDay.envisat_tle.name, satrec: primary },
            secondary && { id: SECONDARY_ID, name: globeDay.secondary_tle.name, satrec: secondary },
          ].filter(Boolean)

          setObjectCount(satrecsRef.current.length)
          setPair({
            primaryName: globeDay.envisat_tle.name,
            secondaryName: globeDay.secondary_tle.name,
          })
        }

        setEventName(replay.event_name ?? null)

        const ordered = PREDICTION_DAYS.map((d) => byKey.get(d.key)).filter(Boolean)
        const outcomes = await Promise.all(
          ordered.map((d) => screenDay(d, controller.signal)),
        )
        if (disposed) return

        const outcomeByKey = new Map(outcomes.map((o) => [o.key, o]))
        setDays(
          PREDICTION_DAYS.map((d) => ({
            ...d,
            predictionDate: outcomeByKey.get(d.key)?.predictionDate ?? null,
            event: outcomeByKey.get(d.key)?.event ?? null,
            error: outcomeByKey.get(d.key)?.error ?? null,
          })),
        )
        setStatus('ready')
      } catch (err) {
        if (disposed || err instanceof CanceledError) return
        // Only the archived-TLE fetch reaches here; per-day failures are
        // captured per row above and never blank the view.
        setError(err)
        setStatus('error')
      }
    }

    load()

    return () => {
      disposed = true
      controller.abort()
    }
  }, [nonce])

  /**
   * Positions for one instant. Shaped exactly like useLiveSatellites'
   * propagateAll so CesiumGlobe needs no knowledge of which view it is in.
   */
  const propagateAll = useCallback((when) => {
    const out = []
    for (const rec of satrecsRef.current) {
      const geo = propagateToGeodetic(rec.satrec, when)
      if (!geo) continue
      out.push({ id: rec.id, name: rec.name, noradId: rec.id, ...geo })
    }
    return out
  }, [])

  /**
   * One revolution of one object's orbit, Earth-fixed, for the instant being
   * drawn. Null when the id is unknown or the element set will not propagate —
   * no ring rather than a partial one.
   */
  const orbitTrackFor = useCallback((id, when) => {
    const rec = satrecsRef.current.find((r) => r.id === id)
    return rec ? orbitTrackEcef(rec.satrec, when) : null
  }, [])

  /**
   * One object's position at `at`, in the frame of the rings drawn for
   * `frameWhen` — where the closest-approach marker goes. Visualisation only.
   */
  const orbitPointFor = useCallback((id, at, frameWhen) => {
    const rec = satrecsRef.current.find((r) => r.id === id)
    return rec ? orbitPointEcef(rec.satrec, at, frameWhen) : null
  }, [])

  // The countdown targets the TCA our own pipeline refined, not the published
  // one — the app should count down to the number it computed. The published
  // instant is displayed beside it for comparison, and is the fallback only
  // when screening produced nothing to count down to.
  const headline = days.find((d) => d.key === 'oct_22')?.event ?? null
  const computedTcaIso = headline?.tca_utc_iso ?? null
  const tcaIso = computedTcaIso ?? PUBLISHED_TCA_UTC_ISO

  return {
    status,
    error,
    eventName,
    days,
    headline,
    tcaIso,
    tcaMs: isoToMs(tcaIso),
    tcaIsComputed: Boolean(computedTcaIso),
    pair,
    objectCount,
    primaryId: PRIMARY_ID,
    secondaryId: SECONDARY_ID,
    propagateAll,
    orbitTrackFor,
    orbitPointFor,
    reload,
  }
}
