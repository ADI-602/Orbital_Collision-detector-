import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { API_BASE_URL } from '../api/client.js'
import ErrorState from '../components/common/ErrorState.jsx'
import FloatingPanel from '../components/common/FloatingPanel.jsx'
import Term from '../components/common/Term.jsx'
import CesiumGlobe from '../components/globe/CesiumGlobe.jsx'
import AssetStrip from '../components/panels/AssetStrip.jsx'
import AdvisorPanel from '../components/panels/AdvisorPanel.jsx'
import ConjunctionAlerts from '../components/panels/ConjunctionAlerts.jsx'
import EventDetail from '../components/panels/EventDetail.jsx'
import ManeuverPanel from '../components/panels/ManeuverPanel.jsx'
import SelectedObjectPanel from '../components/panels/SelectedObjectPanel.jsx'
import StatusHeader from '../components/panels/StatusHeader.jsx'
import { useHealth } from '../hooks/useHealth.js'
import { useLiveSatellites } from '../hooks/useLiveSatellites.js'
import { useAiAdvice } from '../hooks/useAiAdvice.js'
import { useConjunctionAlerts } from '../hooks/useConjunctionAlerts.js'
import { useManeuver } from '../hooks/useManeuver.js'
import { useScreening } from '../hooks/useScreening.js'
import { eventKey, hasGlobePresence, pickInitialEvent, riskColorHex } from '../lib/conjunctions.js'
import { DEFAULT_SPEED_MULTIPLIER, formatSimClock } from '../lib/simClock.js'
import '../styles/globePage.css'
import './Console.css'

const UVICORN_COMMAND = 'backend\\.venv\\Scripts\\uvicorn backend.api.main:app --reload --port 8000'

/**
 * How each data source is named in the UI. Nothing but a genuine live fetch is
 * allowed to read as live — see the source-honesty contract in
 * useLiveSatellites.js.
 */
const SOURCE_LABEL = {
  live: 'Server (live feed)',
  cached: 'Server (cached feed)',
  bundled: 'Server (offline set)',
  replay: 'Local replay — backend down',
  snapshot: 'Bundled snapshot',
}

/** Which feed the server's element sets came from (backend tracked_set.py). */
const PROVIDER_LABEL = {
  celestrak: 'CelesTrak',
  'space-track': 'Space-Track',
}

/** "Space-Track", "offline (Space-Track)", "CelesTrak + Space-Track", or "—". */
function describeProviders(providers) {
  if (!providers?.length) return '—'
  return providers
    .map((p) => {
      if (p.startsWith('offline')) {
        const from = p.split(':')[1]
        return from ? `offline (${PROVIDER_LABEL[from] ?? from})` : 'offline'
      }
      return PROVIDER_LABEL[p] ?? p
    })
    .join(' + ')
}

/** Relative age of a cached fetch, e.g. "cached 12 min ago". */
function describeAge(ms) {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (minutes < 1) return 'moments ago'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return `${hours} h ago`
}

/**
 * The gauge footnote states where the numbers came from. It must never assert
 * "live" for data that is cached or bundled.
 *
 * The snapshot case carries an extra warning, because it is the one state
 * where the globe and the event list describe DIFFERENT object sets: the
 * server screens its tracked groups, while the bundled fallback is a small
 * stations set. Markers would then exist that no event can ever point at, and
 * that has to be said rather than left to be discovered on stage.
 */
function sourceFootnote({ loading, source, snapshotEpoch, cachedAt }) {
  if (loading) return 'Loading the tracked set from the server…'
  if (source === 'live') return 'Live catalogue from the server, propagated on-device'
  if (source === 'cached') {
    return `Server's cached catalogue (fetched ${describeAge(cachedAt)}), propagated on-device`
  }
  if (source === 'bundled') {
    // Old, but still the set the server screens — so unlike the browser-side
    // snapshot below, events and markers DO correspond. Say which of the two
    // this is, because the consequences differ.
    return `Server's committed offline set (captured ${describeAge(cachedAt)}) — live feed unreachable, but this IS the set being screened`
  }
  if (source === 'replay') {
    return `Backend unreachable — replaying the last set this browser received (${describeAge(cachedAt)})`
  }
  if (source === 'snapshot') {
    return `Bundled snapshot from ${snapshotEpoch} — NOT the set the server screens, so events will not match these markers`
  }
  return 'No tracking data'
}

/**
 * The main console screen.
 *
 * Health is polled once here and passed down, so the header chip and the
 * offline banner can never disagree about the backend's state.
 *
 * The globe drives its own animation loop and reports back on a throttle via
 * `onTelemetry` — that is why satellite positions live in React state here
 * but are updated a few times a second rather than every frame.
 *
 * @param {object} props
 * @param {'console'|'replay'} props.view      which tab is active, for the header
 * @param {(view: string) => void} props.onChangeView
 */
function Console({ view, onChangeView }) {
  const health = useHealth()
  const {
    count,
    loading,
    error: tleError,
    source,
    serverGroups,
    providers,
    rejected,
    snapshotEpoch,
    cachedAt,
    refresh: refreshTle,
    propagateAll,
    orbitTrackFor,
    tleFor,
  } = useLiveSatellites()

  const [telemetry, setTelemetry] = useState({ simTime: null, satellites: [] })

  // Real time by default: every marker sits where SGP4 puts it at this actual
  // second. ×120 is offered for visible motion and is always labelled as such.
  // Switching restarts the clock from now (clockKey), so time never jumps.
  const [realTime, setRealTime] = useState(true)
  const wallClock = useCallback(() => new Date(), [])
  const [selectedId, setSelectedId] = useState(null)
  const [selectedEventKey, setSelectedEventKey] = useState(null)

  // Reads the server's scheduled screening pass. The browser sends no TLEs and
  // runs no screening of its own — one set, screened in one place
  // (backend/api/monitoring.py).
  const screening = useScreening()

  const handleTelemetry = useCallback((next) => setTelemetry(next), [])
  const handleSelect = useCallback((id) => setSelectedId(id), [])
  const handleSelectEvent = useCallback((key) => setSelectedEventKey(key), [])

  // New elevated-risk detections from the scheduled screening, each with the
  // AI's explanation attached afterwards. The physics raised the alert.
  const conjunctionAlerts = useConjunctionAlerts(screening.events, screening.status === 'ready')
  const handleViewAlert = useCallback((event) => setSelectedEventKey(eventKey(event)), [])

  // Open on something worth looking at, once per page load: the most serious
  // live detection, else the injected Envisat case (lib/conjunctions.js
  // pickInitialEvent). A selection the operator has already made is never
  // overridden, and a later pass never yanks the view to a new event.
  const autoSelectedRef = useRef(false)
  useEffect(() => {
    if (autoSelectedRef.current || screening.status !== 'ready') return
    autoSelectedRef.current = true
    if (selectedEventKey) return
    const initial = pickInitialEvent(screening.events)
    if (initial) setSelectedEventKey(eventKey(initial))
  }, [screening.status, screening.events, selectedEventKey])

  const selected = useMemo(
    () => telemetry.satellites.find((s) => s.id === selectedId) ?? null,
    [telemetry.satellites, selectedId],
  )

  const selectedEvent = useMemo(
    () => screening.events.find((e) => eventKey(e) === selectedEventKey) ?? null,
    [screening.events, selectedEventKey],
  )

  // The avoidance burn for whatever is selected. Runs only when asked; see
  // useManeuver for why a console must not quietly plan one per click.
  const maneuver = useManeuver(selectedEvent, tleFor)
  const ai = useAiAdvice(selectedEvent, selectedEvent?.primary_name ?? 'Primary', maneuver.result)

  // Only a live event has two real markers on this globe to connect — the
  // injected 2004 Envisat replay does not (see hasGlobePresence()).
  const highlightPair = useMemo(() => {
    if (!hasGlobePresence(selectedEvent)) return null
    return {
      primaryId: selectedEvent.primary_id,
      secondaryId: selectedEvent.secondary_id,
      colorHex: riskColorHex(selectedEvent),
    }
  }, [selectedEvent])

  /**
   * Burn arcs on the globe, for a LIVE event only.
   *
   * The injected 2004 case is excluded for the same reason its objects are not
   * highlighted: those trajectories belong to October 2004, and this globe is
   * running today's clock. Drawing them here would put a 2004 arc among
   * today's objects. The Envisat replay view has a 2004 clock and draws them
   * there instead.
   */
  const maneuverOverlay = useMemo(() => {
    if (!hasGlobePresence(selectedEvent)) return null
    const tracks = maneuver.result?.tracks
    return tracks ? { tracks, colorHex: riskColorHex(selectedEvent) } : null
  }, [selectedEvent, maneuver.result])

  return (
    <div className="globe-page console">
      {/* The globe is the page. Everything else floats over it. */}
      <div className="globe-page__globe">
        <CesiumGlobe
          propagateAll={propagateAll}
          satelliteCount={count}
          onTelemetry={handleTelemetry}
          onSelect={handleSelect}
          selectedId={selectedId}
          highlightPair={highlightPair}
          orbitTrackFor={orbitTrackFor}
          maneuverOverlay={maneuverOverlay}
          simTimeFor={realTime ? wallClock : null}
          clockKey={realTime ? 'realtime' : 'fast'}
        />
      </div>

      <div className="globe-page__overlay">
        <div className="globe-page__header">
          <StatusHeader health={health} view={view} onChangeView={onChangeView} />
        </div>

        {health.status === 'offline' && (
          <div className="globe-page__banner">
            <ErrorState
              title="Backend unreachable"
              detail={health.error?.detail ?? health.error?.message ?? 'unknown error'}
              hint={
                <>
                  Physics endpoints are unavailable until the API responds at{' '}
                  <code>{API_BASE_URL}</code>. Start it from the repo root:{' '}
                  <code>{UVICORN_COMMAND}</code>
                  {' '}— the globe below is independent and keeps running.
                </>
              }
              onRetry={health.refresh}
            />
          </div>
        )}

        <div className="globe-page__field">
          {/* --- Centre: simulated clock over the globe ----------------- */}
          <div className="globe-page__center">
            <div className="globe-page__hud console__hud">
              <span className="console__hud-label ui-label">
                {realTime ? 'Real time' : 'Sim time'}
              </span>
              <span className="console__hud-clock ui-readout">
                {telemetry.simTime ? formatSimClock(telemetry.simTime) : '—'}
              </span>
              {/* The rate is always on screen, so sped-up motion is never
                  mistaken for real time — and real time is said outright. */}
              <span className={`console__hud-speed${realTime ? ' is-live' : ''}`}>
                {realTime ? 'LIVE ×1' : `×${DEFAULT_SPEED_MULTIPLIER}`}
              </span>
              <button
                type="button"
                className="console__hud-toggle"
                onClick={() => setRealTime((r) => !r)}
                title={
                  realTime
                    ? `Speed the clock up ×${DEFAULT_SPEED_MULTIPLIER} so orbital motion is visible`
                    : 'Return to real time: positions at this actual second'
                }
              >
                {realTime ? `×${DEFAULT_SPEED_MULTIPLIER}` : 'Real time'}
              </button>
            </div>
          </div>

          <ConjunctionAlerts
            alerts={conjunctionAlerts.alerts}
            overflow={conjunctionAlerts.overflow}
            onDismiss={conjunctionAlerts.dismiss}
            onDismissAll={conjunctionAlerts.dismissAll}
            onView={handleViewAlert}
          />

          {/* --- Left rail: what is tracked, and the burn planner -------- */}
          <div className="globe-page__rail globe-page__rail--left">
            {/* One card for what is tracked and where it came from. The ring
                gauge this replaces was 280 px of chrome for one number. The
                count still reads propagatable against offered, so a shortfall
                is visible rather than buried in a rejected-list. */}
            <FloatingPanel
              id="console.tracking"
              title="Tracking"
              resize={['e', 's']}
              className="globe-page__float"
            >
              <div className="console__count">
                <span className="console__count-value ui-readout">{loading ? '—' : count}</span>
                <span className="console__count-unit">
                  {rejected.length ? `of ${count + rejected.length} objects` : 'objects tracked'}
                </span>
              </div>
              <p
                className={`console__count-note${
                  source === 'snapshot' || source === 'replay' ? ' is-degraded' : ''
                }`}
              >
                {sourceFootnote({ loading, source, snapshotEpoch, cachedAt })}
              </p>

              <div className="console__feed">
                <div className="console__feed-row">
                  <span className="console__feed-key">Source</span>
                  <span className="console__feed-val ui-readout">{SOURCE_LABEL[source] ?? '—'}</span>
                </div>
                <div className="console__feed-row">
                  <span className="console__feed-key">Provider</span>
                  <span className="console__feed-val ui-readout">{describeProviders(providers)}</span>
                </div>
                <div className="console__feed-row">
                  <span className="console__feed-key">Groups</span>
                  <span className="console__feed-val ui-readout" title={serverGroups.join(', ')}>
                    {serverGroups.length ? serverGroups.join(', ') : '—'}
                  </span>
                </div>
                <div className="console__feed-row">
                  <span className="console__feed-key">Elements fetched</span>
                  <span className="console__feed-val ui-readout">
                    {cachedAt ? describeAge(cachedAt) : '—'}
                  </span>
                </div>
                <div className="console__feed-row">
                  <span className="console__feed-key">Propagator</span>
                  <span className="console__feed-val ui-readout">
                    <Term id="sgp4">SGP4</Term>
                  </span>
                </div>
              </div>

              {/* The live feed being down is a normal, survivable state — but it
                  must be stated, never hidden behind still-moving satellites. */}
              {(source === 'snapshot' || source === 'replay') && (
                <div className="console__feed-degraded">
                  <ErrorState
                    title="Backend tracked set unavailable"
                    detail={tleError?.message ?? 'the server did not answer'}
                    hint={
                      source === 'replay'
                        ? 'Replaying the last set this browser received from the server. The objects are the ones the server was screening, but positions drift as the element sets age.'
                        : `Showing a bundled snapshot of real TLEs captured ${snapshotEpoch}. This is NOT the set the server screens — conjunction events will refer to objects that are not on this globe.`
                    }
                    onRetry={refreshTle}
                  />
                </div>
              )}

              {/* Element sets that would not parse never reached the pipeline, so
                  they cannot appear as "no conjunction found". Name them. */}
              {rejected.length > 0 && (
                <div className="console__feed-degraded">
                  <ErrorState
                    title={`${rejected.length} element set${rejected.length === 1 ? '' : 's'} rejected`}
                    detail={rejected
                      .slice(0, 3)
                      .map((r) => `${r.name}: ${r.reason}`)
                      .join('\n')}
                    hint="These objects are not tracked and are not screened. They are listed here rather than silently dropped, so the object count is not mistaken for full coverage."
                  />
                </div>
              )}
            </FloatingPanel>

            <FloatingPanel
              id="console.maneuver"
              title="Maneuver planning"
              resize={['e', 's']}
              className="globe-page__float globe-page__float--fill"
            >
              <ManeuverPanel event={selectedEvent} maneuver={maneuver} />
            </FloatingPanel>
          </div>

          {/* --- Right rail: the selection, its risk, and the advisor ---- */}
          <div className="globe-page__rail globe-page__rail--right">
            <FloatingPanel
              id="console.object"
              title="Selected object"
              resize={['w', 's']}
              className="globe-page__float"
            >
              <SelectedObjectPanel satellite={selected} />
            </FloatingPanel>

            <FloatingPanel
              id="console.risk"
              title="Conjunction risk"
              resize={['w', 's']}
              className="globe-page__float"
            >
              <EventDetail
                event={selectedEvent}
                onOpenReplay={onChangeView ? () => onChangeView('replay') : undefined}
              />
            </FloatingPanel>

            <FloatingPanel
              id="console.ai"
              title="AI advisor"
              resize={['w', 's']}
              className="globe-page__float globe-page__float--fill"
            >
              <AdvisorPanel event={selectedEvent} ai={ai} />
            </FloatingPanel>
          </div>

          {/* --- Bottom: tracked objects and conjunction events ---------- */}
          <div className="globe-page__strip">
            <FloatingPanel
              id="console.events"
              title="Objects and conjunction events"
              resize={['n']}
              minHeight={90}
              className="globe-page__float globe-page__float--strip"
            >
              <AssetStrip
                satellites={telemetry.satellites}
                selectedId={selectedId}
                onSelect={handleSelect}
                screening={screening}
                selectedEventKey={selectedEventKey}
                onSelectEvent={handleSelectEvent}
              />

            </FloatingPanel>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Console
