import { useCallback, useEffect, useRef, useState } from 'react'

import { getTrackedObjects } from '../api/tracking.js'
import { CanceledError } from '../api/client.js'
import { buildSatrec, propagateToGeodetic } from '../lib/geodetic.js'
import { classifyObject } from '../lib/objectType.js'
import { orbitPointEcef, orbitTrackEcef } from '../lib/orbitTrack.js'
import { parseTleText } from '../lib/tle.js'
import { readCachedTle, safeLocalStorage, writeCachedTle } from '../lib/tleCache.js'
import { SNAPSHOT_CAPTURED_UTC, TLE_SNAPSHOT_TEXT } from '../lib/tleSnapshot.js'

/**
 * useLiveSatellites — obtain the tracked set and propagate it in the browser.
 *
 * ============================ BOUNDARY NOTE ============================
 * This is an AMBIENT VISUALISATION LAYER, not part of the validated physics
 * pipeline. Positions come from element sets propagated by satellite.js in the
 * browser, purely so the globe shows real objects in real orbits.
 *
 * No NUMBER computed here feeds conjunction screening, TCA refinement, Pc, or
 * maneuver planning. Those are computed exclusively by the Python pipeline,
 * which is the only thing validated against the Alfano benchmark and the
 * Envisat replay. A satellite marker on this globe means "this object is up
 * there", never "the pipeline assessed this".
 *
 * That covers `orbitTrackFor` too: an orbit ring is the marker's own path over
 * one revolution, from the same element set and the same propagator. It is NOT
 * the post-burn trajectory of CLAUDE.md §5.2, which must come back from
 * /api/physics/maneuver as a sampled ephemeris. See lib/orbitTrack.js.
 *
 * Do not route any number from this hook into an AI prompt or a risk display.
 * =======================================================================
 *
 * THE SERVER OWNS THE SET. This hook used to fetch CelesTrak directly. It now
 * reads /api/tracking/objects, because the background monitor screens the
 * server's set: if the browser drew a different fetch, an event could name
 * objects that are not on this globe and selecting it would highlight nothing.
 * The console's premise is that the event list and the globe describe the same
 * objects, and that only holds with one source.
 *
 * SOURCE HONESTY. The set can reach the screen four ways, and the caller MUST
 * show which — rendering stale data as live is the same class of dishonesty as
 * fabricating a number:
 *
 *   'live'     the server fetched it just now (CelesTrak or Space-Track)
 *   'cached'   the server replayed its own earlier fetch
 *   'bundled'  the server fell back to its COMMITTED offline set. Still the
 *              set it screens, so events match the globe — it is simply old,
 *              and the epoch must be shown.
 *   'replay'   the BACKEND is unreachable; replaying the last set this browser
 *              successfully received, from localStorage
 *   'snapshot' backend unreachable and nothing cached locally — the committed
 *              offline fallback, which is a small stations set and NOT what
 *              the server screens
 *
 * The last one matters most: on 'snapshot' the globe and the event list are
 * genuinely describing different object sets, and the UI has to say so rather
 * than quietly showing markers that no event can ever point at.
 *
 * Propagation lives in lib/geodetic.js, shared with the historical Envisat
 * replay so both views place markers through the same code path. It delegates
 * entirely to satellite.js — no orbital mechanics are hand-written anywhere in
 * the frontend, per CLAUDE.md §1.1.
 */

/**
 * @typedef {object} LiveSatellite
 * @property {string} id
 * @property {string} name
 * @property {string} noradId
 * @property {string} kind      'payload' | 'debris' | 'rocket-body' | 'unknown'
 * @property {number} latitude_deg
 * @property {number} longitude_deg
 * @property {number} altitude_km
 */

/** Turn one wire object into a propagatable record, or null if rejected. */
function toRecord(obj) {
  const satrec = buildSatrec(obj.line1, obj.line2, obj.name)
  if (!satrec) return null
  return {
    id: obj.id,
    name: obj.name,
    noradId: obj.norad_id ?? obj.id,
    // line1/line2 are retained because the physics endpoints take raw TLE
    // strings. Forwarding SOURCE data is not a breach of the boundary note
    // above — a TLE is catalogue data, not a number this hook computed.
    line1: obj.line1,
    line2: obj.line2,
    kind: classifyObject(obj.name),
    satrec,
  }
}

/** Build records from the server payload. */
function recordsFromServer(objects) {
  const built = []
  for (const obj of objects ?? []) {
    const rec = toRecord(obj)
    if (rec) built.push(rec)
  }
  return built
}

/** Build records from raw 3-line TLE text (the offline fallbacks). */
function recordsFromText(text) {
  const built = []
  for (const r of parseTleText(text)) {
    const rec = toRecord({
      id: r.noradId,
      name: r.name,
      norad_id: r.noradId,
      line1: r.line1,
      line2: r.line2,
    })
    if (rec) built.push(rec)
  }
  return built
}

/**
 * Load the tracked set and expose a propagator for it.
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
 *   source: 'live' | 'cached' | 'bundled' | 'replay' | 'snapshot' | null,
 *   serverGroups: string[],
 *   providers: string[],
 *   rejected: Array<{name: string, reason: string}>,
 *   snapshotEpoch: string,
 *   cachedAt: number | null,
 *   refresh: () => void,
 *   propagateAll: (when: Date) => LiveSatellite[],
 *   orbitTrackFor: (id: string, when: Date) => Array<{x: number, y: number, z: number}> | null,
 *   tleFor: (id: string) => {name: string, line1: string, line2: string} | null
 * }}
 */
export function useLiveSatellites() {
  const [records, setRecords] = useState(() => [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [source, setSource] = useState(null)
  const [serverGroups, setServerGroups] = useState([])
  // Which feed the server used: celestrak, space-track, offline:<provider>.
  const [providers, setProviders] = useState([])
  const [rejected, setRejected] = useState([])
  const [cachedAt, setCachedAt] = useState(null)
  const [nonce, setNonce] = useState(0)

  const recordsRef = useRef(records)
  recordsRef.current = records

  // id -> record, rebuilt only when the records array itself changes. The
  // render loop looks objects up a few times a second against a set that can
  // run to several hundred, so a linear scan per lookup is avoidable work.
  const byIdRef = useRef({ source: null, map: new Map() })

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()

    const load = async () => {
      setLoading(true)
      try {
        const payload = await getTrackedObjects({ signal: controller.signal })
        if (disposed) return

        const built = recordsFromServer(payload.objects)
        if (built.length === 0) {
          throw new Error(
            payload.error ?? 'the tracked set came back with no usable objects',
          )
        }

        // Cache the raw payload so a later backend outage replays the SAME
        // objects the server was screening, not a different set.
        try {
          const storage = safeLocalStorage()
          writeCachedTle(
            payload.objects.map((o) => `${o.name}\n${o.line1}\n${o.line2}`).join('\n'),
            storage,
          )
        } catch {
          // A full or disabled localStorage is not a reason to fail the load.
        }

        setRecords(built)
        // The server's own provenance passes straight through: 'live' means it
        // fetched from CelesTrak or Space-Track just now, 'cached' means it replayed its own
        // earlier fetch, 'bundled' means it fell back to its committed offline
        // set. All three are the set the server SCREENS, so events and globe
        // markers still correspond — that is what separates them from the
        // browser-side 'replay'/'snapshot' states below.
        setSource(
          payload.source === 'live' || payload.source === 'bundled'
            ? payload.source
            : 'cached',
        )
        setServerGroups(payload.groups ?? [])
        setProviders(payload.providers ?? [])
        setRejected(payload.rejected ?? [])
        setCachedAt(payload.fetched_at_unix ? payload.fetched_at_unix * 1000 : null)
        setError(payload.error ? new Error(payload.error) : null)
        setLoading(false)
        return
      } catch (err) {
        if (disposed || err instanceof CanceledError) return

        const reason = err instanceof Error ? err : new Error(String(err))
        console.warn('[tracking] backend tracked set unavailable:', reason.message)

        // 1. The last set this browser received from the server.
        const storage = safeLocalStorage()
        const cached = readCachedTle(storage)
        if (cached) {
          const built = recordsFromText(cached.text)
          if (built.length > 0) {
            setRecords(built)
            setSource('replay')
            setCachedAt(cached.fetchedAt)
            setError(reason)
            setLoading(false)
            return
          }
        }

        // 2. The committed offline fallback. Deliberately last: it is a small
        //    stations set, NOT the set the server screens, so events and globe
        //    markers will not correspond. The UI must say so.
        setRecords(recordsFromText(TLE_SNAPSHOT_TEXT))
        setSource('snapshot')
        setCachedAt(null)
        setError(reason)
        setLoading(false)
      }
    }

    load()

    return () => {
      disposed = true
      controller.abort()
    }
  }, [nonce])

  /** @type {(when: Date) => LiveSatellite[]} */
  const propagateAll = (when) => {
    const out = []
    for (const rec of recordsRef.current) {
      const geo = propagateToGeodetic(rec.satrec, when)
      if (!geo) continue
      out.push({
        id: rec.id,
        name: rec.name,
        noradId: rec.noradId,
        kind: rec.kind,
        ...geo,
      })
    }
    return out
  }

  /** Look up a tracked record by id, rebuilding the index only when it moves. */
  const recordById = (id) => {
    const current = recordsRef.current
    if (byIdRef.current.source !== current) {
      byIdRef.current = { source: current, map: new Map(current.map((r) => [r.id, r])) }
    }
    return byIdRef.current.map.get(id) ?? null
  }

  /**
   * One revolution of an object's orbit, in the Earth-fixed frame, for the
   * instant the globe is drawing.
   *
   * Returns null when the id is not tracked or the element set will not
   * propagate — the caller draws no ring, which is the honest outcome. A
   * partial or invented track would read as an orbit that stops in mid-air.
   *
   * @param {string} id
   * @param {Date} when
   * @returns {Array<{x: number, y: number, z: number}>|null} km, ECEF
   */
  const orbitTrackFor = (id, when) => {
    const rec = recordById(id)
    return rec ? orbitTrackEcef(rec.satrec, when) : null
  }

  /**
   * The raw element set for a tracked object, in the shape the physics
   * endpoints take.
   *
   * Forwarding SOURCE data is not a breach of the boundary note above: a TLE
   * is catalogue input, not a number this hook computed. What must never
   * happen is a POSITION from here reaching the pipeline.
   *
   * @param {string} id
   * @returns {{name: string, line1: string, line2: string}|null}
   */
  /**
   * An object's position at `at`, in the frame of the rings drawn for
   * `frameWhen` — see lib/orbitTrack.js orbitPointEcef. Used to put a
   * closest-approach marker where the drawn orbits cross. Visualisation only.
   *
   * @param {string} id
   * @param {Date} at
   * @param {Date} frameWhen
   * @returns {{x: number, y: number, z: number}|null} km, ECEF
   */
  const orbitPointFor = (id, at, frameWhen) => {
    const rec = recordById(id)
    return rec ? orbitPointEcef(rec.satrec, at, frameWhen) : null
  }

  const tleFor = (id) => {
    const rec = recordById(id)
    if (!rec?.line1 || !rec?.line2) return null
    return { name: rec.name, line1: rec.line1, line2: rec.line2 }
  }

  return {
    records,
    count: records.length,
    loading,
    error,
    source,
    serverGroups,
    providers,
    rejected,
    snapshotEpoch: SNAPSHOT_CAPTURED_UTC,
    cachedAt,
    refresh,
    propagateAll,
    orbitTrackFor,
    orbitPointFor,
    tleFor,
  }
}
