import { useCallback, useEffect, useRef, useState } from 'react'
import { buildSatrec, propagateToGeodetic } from '../lib/geodetic.js'
import { parseTleText } from '../lib/tle.js'
import { readCachedTle, safeLocalStorage, writeCachedTle } from '../lib/tleCache.js'
import { SNAPSHOT_CAPTURED_UTC, TLE_SNAPSHOT_TEXT } from '../lib/tleSnapshot.js'

/**
 * useLiveSatellites — obtain real TLEs and propagate them in the browser.
 *
 * ============================ BOUNDARY NOTE ============================
 * This is an AMBIENT VISUALISATION LAYER, not part of the validated physics
 * pipeline. Positions come from CelesTrak TLEs propagated by satellite.js in
 * the browser, purely so the globe shows real objects in real orbits.
 *
 * Nothing here feeds conjunction screening, TCA refinement, Pc, or maneuver
 * planning. Those are computed exclusively by the Python pipeline behind
 * /api/physics/*, which is the only thing validated against the Alfano
 * benchmark and the Envisat replay. A satellite marker on this globe means
 * "this object is up there", never "the pipeline assessed this".
 *
 * Do not route any number from this hook into an AI prompt or a risk display.
 * =======================================================================
 *
 * SOURCE HONESTY. The feed can come from three places, and the caller MUST
 * show which one is in use — `source` is returned for exactly that purpose:
 *
 *   'live'     fetched from CelesTrak just now
 *   'cached'   a previous live fetch, replayed from localStorage
 *   'snapshot' the committed offline fallback (CelesTrak unreachable)
 *
 * Rendering 'snapshot' or 'cached' data as though it were live is the same
 * class of dishonesty as fabricating a number. An earlier version of this
 * hook silently swallowed fetch failures and left the UI showing "Live from
 * CelesTrak" above zero objects; that is the bug this contract prevents.
 *
 * Propagation is delegated entirely to satellite.js (the standard JS port of
 * the SGP4 family the backend's Python `sgp4` package belongs to). No orbital
 * mechanics are hand-written here, per CLAUDE.md 1.1.
 */

const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle'

/**
 * Deliberately short. CelesTrak either answers quickly or is unreachable; a
 * long timeout only means more seconds of an empty globe before the UI
 * admits something is wrong.
 */
const FETCH_TIMEOUT_MS = 8000

/**
 * @typedef {object} LiveSatellite
 * @property {string} id
 * @property {string} name
 * @property {string} noradId
 * @property {number} latitude_deg
 * @property {number} longitude_deg
 * @property {number} altitude_km
 */

/** Turn raw CelesTrak text into propagatable satrecs. */
function buildSatrecs(text) {
  const built = []
  for (const r of parseTleText(text)) {
    const satrec = buildSatrec(r.line1, r.line2, r.name)
    if (!satrec) continue
    built.push({ id: r.noradId, name: r.name, noradId: r.noradId, satrec })
  }
  return built
}

/**
 * Load the tracked-object set and expose a propagator for it.
 *
 * Returns records plus a `propagateAll(when)` function rather than ticking
 * internally: the Cesium render loop owns the clock, so this hook would
 * otherwise re-render React on every animation frame.
 *
 * @returns {{
 *   records: Array<object>,
 *   count: number,
 *   loading: boolean,
 *   error: Error | null,
 *   source: 'live' | 'cached' | 'snapshot' | null,
 *   snapshotEpoch: string,
 *   cachedAt: number | null,
 *   refresh: () => void,
 *   propagateAll: (when: Date) => LiveSatellite[]
 * }}
 */
export function useLiveSatellites() {
  const [records, setRecords] = useState(() => [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [source, setSource] = useState(null)
  const [cachedAt, setCachedAt] = useState(null)
  const [nonce, setNonce] = useState(0)

  const recordsRef = useRef(records)
  recordsRef.current = records

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    /** Apply a resolved payload, unless this effect run was torn down. */
    const apply = (text, nextSource, fetchedAt = null) => {
      if (disposed) return
      setRecords(buildSatrecs(text))
      setSource(nextSource)
      setCachedAt(fetchedAt)
      setLoading(false)
    }

    const load = async () => {
      // 1. A recent successful fetch, replayed. Avoids re-hitting CelesTrak
      //    on every reload — repeated fetches are what got this machine
      //    temporarily blocked, and CLAUDE.md asks us not to hammer it.
      const storage = safeLocalStorage()
      const cached = readCachedTle(storage)
      if (cached) {
        apply(cached.text, 'cached', cached.fetchedAt)
        return
      }

      // 2. Live fetch.
      try {
        const res = await fetch(CELESTRAK_URL, { signal: controller.signal })
        if (!res.ok) throw new Error(`CelesTrak returned HTTP ${res.status}`)

        const text = await res.text()
        if (parseTleText(text).length === 0) {
          throw new Error('CelesTrak returned no usable TLEs')
        }

        writeCachedTle(text, storage)
        if (!disposed) setError(null)
        apply(text, 'live')
      } catch (err) {
        // A torn-down StrictMode run must not fall through to the snapshot
        // path: the run that replaced it is still in flight, and clobbering
        // its result is how the old silent-empty state happened.
        if (disposed) return

        // 3. Offline fallback. The globe stays populated with real objects,
        //    and `source: 'snapshot'` obliges the UI to say so. The error is
        //    retained so the reason stays visible rather than papered over.
        const reason =
          err?.name === 'AbortError'
            ? new Error(`CelesTrak did not respond within ${FETCH_TIMEOUT_MS / 1000}s`)
            : err instanceof Error
              ? err
              : new Error(String(err))

        console.warn(
          '[tracking] live feed unavailable, using bundled snapshot:',
          reason.message,
        )
        setError(reason)
        apply(TLE_SNAPSHOT_TEXT, 'snapshot')
      } finally {
        clearTimeout(timer)
      }
    }

    load()

    return () => {
      disposed = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [nonce])

  /** @type {(when: Date) => LiveSatellite[]} */
  const propagateAll = (when) => {
    const out = []
    for (const rec of recordsRef.current) {
      const geo = propagateToGeodetic(rec.satrec, when)
      if (!geo) continue
      out.push({ id: rec.id, name: rec.name, noradId: rec.noradId, ...geo })
    }
    return out
  }

  return {
    records,
    count: records.length,
    loading,
    error,
    source,
    snapshotEpoch: SNAPSHOT_CAPTURED_UTC,
    cachedAt,
    refresh,
    propagateAll,
  }
}
