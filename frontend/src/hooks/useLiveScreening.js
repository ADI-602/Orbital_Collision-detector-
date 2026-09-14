import { useCallback, useEffect, useRef, useState } from 'react'

import { CanceledError } from '../api/client.js'
import { screenCandidates } from '../api/physics.js'
import { tleEpochUtc } from '../lib/tle.js'

/**
 * useLiveScreening — run conjunction screening for one primary against a
 * candidate set, through the real physics pipeline.
 *
 * This is the console's detection half. Nothing here computes anything: the
 * hook assembles a request, /api/physics/screening does SGP4 propagation, TCA
 * refinement and the 2D encounter-plane Pc, and the results come back as they
 * are. No number is post-processed on the way out.
 *
 * SEARCH WINDOW. Anchored to the PRIMARY'S ELEMENT-SET EPOCH, not to the wall
 * clock. An element set is most accurate at its own epoch; screening "the next
 * 24 hours from now" against a two-week-old TLE propagates it two weeks before
 * the window even opens, which turns a conjunction search into fiction. With a
 * fresh live feed the epoch is roughly now, so nothing is given up — and when
 * the feed is stale, the UI can say which window was actually searched.
 *
 * AN EMPTY RESULT IS A RESULT. Real conjunctions inside a few kilometres are
 * rare per object per day, so a scoped candidate set will usually return
 * nothing. "No close approach above threshold in this window" is a true and
 * useful statement, and the caller must render it as such rather than as a
 * failure or an unfinished state.
 *
 * `unassessable` carries pairs the pipeline could not evaluate, with the
 * reason — two objects sharing an element set have zero relative velocity at
 * TCA and no encounter plane exists. Those are reported separately and never
 * folded in with the events, because "not assessed" and "assessed and safe"
 * are different claims.
 *
 * @param {null | {
 *   primary: {name: string, line1: string, line2: string},
 *   candidates: Array<{name: string, line1: string, line2: string}>,
 *   searchHours: number,
 *   startUtcIso?: string,
 *   coarseThresholdKm?: number
 * }} request  null disables the hook. `startUtcIso` overrides the epoch
 *   anchoring for a self-contained scenario that was solved for a specific
 *   window; live screening omits it.
 * @returns {{
 *   status: 'idle'|'running'|'done'|'error',
 *   events: Array<import('../api/physics.js').ScreeningEvent>,
 *   unassessable: Array<{secondary_name: string, reason: string}>,
 *   windowStart: Date|null,
 *   windowHours: number|null,
 *   screenedCount: number,
 *   error: Error|null,
 *   refresh: () => void
 * }}
 */
export function useLiveScreening(request) {
  const [status, setStatus] = useState('idle')
  const [events, setEvents] = useState([])
  const [unassessable, setUnassessable] = useState([])
  const [windowStart, setWindowStart] = useState(null)
  const [windowHours, setWindowHours] = useState(null)
  const [screenedCount, setScreenedCount] = useState(0)
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  // Keyed on the actual request content so re-renders handing over an
  // equivalent object literal do not re-screen (each run is seconds of SGP4).
  const key = request
    ? JSON.stringify({
        p: request.primary?.line1,
        p2: request.primary?.line2,
        c: request.candidates?.map((x) => x.line1),
        h: request.searchHours,
        s: request.startUtcIso,
        t: request.coarseThresholdKm,
      })
    : null

  const requestRef = useRef(request)
  requestRef.current = request

  useEffect(() => {
    if (!key) {
      setStatus('idle')
      setEvents([])
      setUnassessable([])
      setScreenedCount(0)
      return undefined
    }

    const req = requestRef.current
    if (!req?.primary || !req.candidates?.length) {
      setStatus('idle')
      setEvents([])
      setUnassessable([])
      setScreenedCount(0)
      return undefined
    }

    // An explicit start wins; otherwise anchor to the element-set epoch.
    const explicitStart = req.startUtcIso ? new Date(req.startUtcIso) : null
    const epoch = explicitStart ?? tleEpochUtc(req.primary.line1)
    if (!epoch || Number.isNaN(epoch.getTime())) {
      setStatus('error')
      setError(new Error(`Could not determine a search window for ${req.primary.name}`))
      return undefined
    }

    let disposed = false
    const controller = new AbortController()

    const run = async () => {
      setStatus('running')
      setError(null)
      setWindowStart(epoch)
      setWindowHours(req.searchHours)

      try {
        const result = await screenCandidates(
          {
            primary: req.primary,
            candidates: req.candidates,
            start_utc_iso: epoch.toISOString().replace(/\.\d{3}Z$/, 'Z'),
            search_duration_hours: req.searchHours,
            coarse_threshold_km: req.coarseThresholdKm ?? 500.0,
          },
          { signal: controller.signal },
        )
        if (disposed) return

        // Ranked by collision probability, which is the quantity operators
        // act on — not by miss distance, which can rank a fast distant pass
        // above a slow close one.
        setEvents([...result.events].sort((a, b) => b.pc - a.pc))
        setUnassessable(result.unassessable ?? [])
        setScreenedCount(result.candidates_screened ?? req.candidates.length)
        setStatus('done')
      } catch (err) {
        if (err instanceof CanceledError || disposed) return
        setEvents([])
        setUnassessable([])
        setStatus('error')
        setError(err)
      }
    }

    run()

    return () => {
      disposed = true
      controller.abort()
    }
  }, [key, nonce])

  return {
    status,
    events,
    unassessable,
    windowStart,
    windowHours,
    screenedCount,
    error,
    refresh,
  }
}
