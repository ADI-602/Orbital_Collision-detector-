import { useCallback, useEffect, useRef, useState } from 'react'

import { CanceledError } from '../api/client.js'
import { getEnvisatReplay } from '../api/conjunctions.js'
import { screenCandidates } from '../api/physics.js'
import {
  getMonitoringEvents,
  getMonitoringStatus,
  refreshMonitoring,
} from '../api/tracking.js'
import { EVENT_ORIGIN, rankEvents } from '../lib/conjunctions.js'
import { PASS_STATE } from '../lib/monitoring.js'

/**
 * useScreening — read the physics pipeline's conjunction results.
 *
 * Every number this hook exposes was computed by the validated Python
 * pipeline. The hook chooses what to fetch and how to merge it; it never
 * computes, adjusts or interpolates a physics value.
 *
 * WHY THIS NO LONGER RUNS THE SCREENING
 *
 * It used to. The browser held the tracked set, picked a primary, and posted
 * one /api/physics/screening request per candidate. That worked against a
 * ~20-object station set and does not survive the real one: a full all-pairs
 * pass over ~700 objects is roughly 1.6 hours of SGP4 and numpy, and no tuning
 * makes it a click — the cost is inherent to resolving a 5 km encounter at
 * 15 km/s on a sampled grid.
 *
 * So screening moved to a scheduled server-side job
 * (`backend/api/monitoring.py`) and this hook reads its last completed pass
 * from cache, which returns instantly. That is also how conjunction assessment
 * actually works: scheduled screenings against a catalogue, published results,
 * not an operator waiting on a button.
 *
 * The button therefore no longer means "compute this now". `refresh()` re-reads
 * the latest completed pass; `screenNow()` asks the server to start a fresh
 * pass and watches for it to finish. Neither blocks.
 *
 * TWO SOURCES, ALWAYS DISTINGUISHABLE
 *
 *   LIVE       the scheduled all-pairs pass over the server's tracked set.
 *              Real detections, legitimately often free of high-risk events.
 *   VALIDATION the October 2004 Envisat/Zenith-2 conjunction, injected so the
 *              console always carries an event whose published numbers are
 *              known (268 m, Pc 6.59e-4). It runs through the same physics
 *              endpoints as everything else and is tagged so it can never be
 *              read as something happening in orbit today.
 *
 * THE AI RUNS NONE OF THIS. Monitoring is the physics pipeline on a timer. The
 * AI layer is handed completed results afterwards and explains them (CLAUDE.md
 * §5.2) — never label any of this "AI monitoring" in the UI.
 */

/**
 * The injected case is anchored to the real event: TCA was 2004-10-22
 * 05:10:37 UTC, so a 12 h window from midnight contains it with room to spare.
 */
const VALIDATION_DAY = 'oct_22'
const VALIDATION_START_UTC_ISO = '2004-10-22T00:00:00Z'
const VALIDATION_WINDOW_HOURS = 12

/**
 * How often to re-check a pass that is running.
 *
 * /api/monitoring/status is a cheap cached read with no physics behind it, so
 * this is only about how quickly the panel notices the pass finished.
 */
const STATUS_POLL_MS = 4000

/**
 * Stop watching a running pass after this long.
 *
 * A full pass over the tracked set can take a long time; polling forever from a
 * page nobody is watching is worse than saying "still running, check back".
 */
const STATUS_POLL_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Read the last completed scheduled pass.
 *
 * The server ranks events already (assessed before refused, then threat band,
 * then Pc) and attaches `primary_id`/`secondary_id` from the tracked set, so a
 * selected event can be traced back to its two globe markers. Tagging with
 * `origin` is the only change made here.
 *
 * @returns {Promise<{events: object[], pass: object}>}
 */
async function readMonitoringPass(signal) {
  const payload = await getMonitoringEvents({ signal })

  return {
    events: (payload.events ?? []).map((e) => ({ ...e, origin: EVENT_ORIGIN.LIVE })),
    pass: {
      state: payload.state ?? PASS_STATE.NEVER_RUN,
      event_count: payload.event_count ?? 0,
      high_risk_count: payload.high_risk_count ?? 0,
      window_start_utc_iso: payload.window_start_utc_iso ?? null,
      window_hours: payload.window_hours ?? null,
      finished_at_unix: payload.finished_at_unix ?? null,
      stats: payload.stats ?? null,
      error: payload.error ?? null,
    },
  }
}

/**
 * Screen the historical Envisat/Zenith-2 pair. Two calls: fetch the archived
 * TLEs, then push them through the same screening endpoint the pipeline uses.
 * @returns {Promise<object[]>}
 */
async function runValidationScreening(signal) {
  const replay = await getEnvisatReplay({ signal })
  const day = (replay.prediction_days ?? []).find((d) => d.day === VALIDATION_DAY)
  if (!day) {
    throw new Error(`Replay response carried no "${VALIDATION_DAY}" prediction day`)
  }

  const result = await screenCandidates(
    {
      primary: day.envisat_tle,
      candidates: [day.secondary_tle],
      start_utc_iso: VALIDATION_START_UTC_ISO,
      search_duration_hours: VALIDATION_WINDOW_HOURS,
    },
    { signal },
  )

  return (result.events ?? []).map((e) => ({
    ...e,
    origin: EVENT_ORIGIN.VALIDATION,
    primary_name: result.primary_name,
    /** Shown beside the computed values so the reproduction is checkable. */
    provenance: {
      label: 'Envisat vs. Zenith-2 debris — 22 Oct 2004',
      source: 'ESA SDC4-paper49 (Klinkrad et al. 2005)',
      published: '268.0 m, Pc 6.59e-4',
    },
  }))
}

/**
 * @returns {{
 *   status: 'loading' | 'ready',
 *   events: object[],
 *   pass: object|null,
 *   liveError: Error | null,
 *   validationError: Error | null,
 *   triggering: boolean,
 *   watchingPass: boolean,
 *   loadedAt: Date | null,
 *   refresh: () => void,
 *   screenNow: () => void
 * }}
 */
export function useScreening() {
  const [status, setStatus] = useState('loading')
  const [events, setEvents] = useState([])
  const [pass, setPass] = useState(null)
  const [liveError, setLiveError] = useState(null)
  const [validationError, setValidationError] = useState(null)
  const [triggering, setTriggering] = useState(false)
  const [watchingPass, setWatchingPass] = useState(false)
  const [loadedAt, setLoadedAt] = useState(null)

  const abortRef = useRef(null)
  const pollRef = useRef(null)
  const mountedRef = useRef(true)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      stopPolling()
    }
  }, [stopPolling])

  const refresh = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('loading')
    setLiveError(null)
    setValidationError(null)

    // Settled, not all: the two sources are independent evidence. The
    // monitoring feed going down must not take the validation case off screen,
    // and vice versa — if either half succeeds, the panel still shows real
    // pipeline output.
    const [live, validation] = await Promise.allSettled([
      readMonitoringPass(controller.signal),
      runValidationScreening(controller.signal),
    ])

    if (controller.signal.aborted || !mountedRef.current) return

    const collected = []

    if (live.status === 'fulfilled') {
      collected.push(...live.value.events)
      setPass(live.value.pass)
    } else if (!(live.reason instanceof CanceledError)) {
      setLiveError(live.reason)
      setPass(null)
    }

    if (validation.status === 'fulfilled') {
      collected.push(...validation.value)
    } else if (!(validation.reason instanceof CanceledError)) {
      setValidationError(validation.reason)
    }

    // Re-ranked after merging: the server ranked its own events, but the
    // injected case arrives from a different request and has to be placed
    // among them by the same rule.
    setEvents(rankEvents(collected))
    setLoadedAt(new Date())
    setStatus('ready')
  }, [])

  // The results already exist on the server, so there is nothing to make the
  // user press a button for. This is a cached read, not a screening run.
  useEffect(() => {
    refresh()
  }, [refresh])

  /**
   * Watch a running pass and re-read once it lands.
   *
   * Polls /api/monitoring/status rather than /events — status carries no event
   * payload, so watching a long pass costs almost nothing.
   */
  const watchPass = useCallback(
    (startedAtMs) => {
      stopPolling()
      setWatchingPass(true)

      const tick = async () => {
        if (!mountedRef.current) return

        if (Date.now() - startedAtMs > STATUS_POLL_TIMEOUT_MS) {
          setWatchingPass(false)
          return
        }

        try {
          const status_ = await getMonitoringStatus()
          if (!mountedRef.current) return

          if (status_.state === PASS_STATE.RUNNING) {
            pollRef.current = setTimeout(tick, STATUS_POLL_MS)
            return
          }

          setWatchingPass(false)
          refresh()
        } catch (err) {
          if (!mountedRef.current || err instanceof CanceledError) return
          // A status poll failing is not a screening failure. Stop watching and
          // leave the last good pass on screen rather than blanking it.
          setWatchingPass(false)
        }
      }

      pollRef.current = setTimeout(tick, STATUS_POLL_MS)
    },
    [refresh, stopPolling],
  )

  /**
   * Ask the server to start a pass now.
   *
   * Returns as soon as the request is accepted — the pass runs on the server's
   * own thread and can take minutes. Nothing here waits on the physics.
   */
  const screenNow = useCallback(async () => {
    setTriggering(true)
    try {
      await refreshMonitoring()
      if (!mountedRef.current) return
      setPass((prev) => (prev ? { ...prev, state: PASS_STATE.RUNNING } : prev))
      watchPass(Date.now())
    } catch (err) {
      if (!mountedRef.current || err instanceof CanceledError) return
      setLiveError(err)
    } finally {
      if (mountedRef.current) setTriggering(false)
    }
  }, [watchPass])

  return {
    status,
    events,
    pass,
    liveError,
    validationError,
    triggering,
    watchingPass,
    loadedAt,
    refresh,
    screenNow,
  }
}
