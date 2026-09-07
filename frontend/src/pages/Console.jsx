import { useCallback, useMemo, useState } from 'react'

import { API_BASE_URL } from '../api/client.js'
import ErrorState from '../components/common/ErrorState.jsx'
import GaugeCard from '../components/common/GaugeCard.jsx'
import GlassPanel from '../components/common/GlassPanel.jsx'
import PendingRegion from '../components/common/PendingRegion.jsx'
import PillStat from '../components/common/PillStat.jsx'
import CesiumGlobe from '../components/globe/CesiumGlobe.jsx'
import AssetStrip from '../components/panels/AssetStrip.jsx'
import EventDetail from '../components/panels/EventDetail.jsx'
import SelectedObjectPanel from '../components/panels/SelectedObjectPanel.jsx'
import StatusHeader from '../components/panels/StatusHeader.jsx'
import { useHealth } from '../hooks/useHealth.js'
import { useLiveSatellites } from '../hooks/useLiveSatellites.js'
import { useScreening } from '../hooks/useScreening.js'
import { eventKey, hasGlobePresence, riskColorHex } from '../lib/conjunctions.js'
import { DEFAULT_SPEED_MULTIPLIER, formatSimClock } from '../lib/simClock.js'
import './Console.css'

const UVICORN_COMMAND = 'backend\\.venv\\Scripts\\uvicorn backend.api.main:app --reload --port 8000'

/**
 * The tracking ring shows COVERAGE, not a count against a ceiling.
 *
 * It used to scale the object count against a fixed max of 12, which was
 * readable for a ~20-object station set and meaningless once the tracked set
 * became several hundred debris fragments: the ring simply pinned full and
 * said nothing. It now reads propagatable objects against objects offered, so
 * a full ring means every element set the server supplied was usable and any
 * shortfall is visible rather than buried in a rejected-list.
 */

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

function SignalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 11.5h2.5v3H2zM6.5 7.5H9v7H6.5zM11 3.5h2.5v11H11z" strokeLinejoin="round" />
    </svg>
  )
}

function OrbitIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="3.2" />
      <ellipse cx="8" cy="8" rx="6.6" ry="3" transform="rotate(-28 8 8)" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.6V8l2.3 1.6" strokeLinecap="round" />
    </svg>
  )
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
    rejected,
    snapshotEpoch,
    cachedAt,
    refresh: refreshTle,
    propagateAll,
    orbitTrackFor,
  } = useLiveSatellites()

  const [telemetry, setTelemetry] = useState({ simTime: null, satellites: [] })
  const [selectedId, setSelectedId] = useState(null)
  const [selectedEventKey, setSelectedEventKey] = useState(null)

  // Reads the server's scheduled screening pass. The browser sends no TLEs and
  // runs no screening of its own — one set, screened in one place
  // (backend/api/monitoring.py).
  const screening = useScreening()

  const handleTelemetry = useCallback((next) => setTelemetry(next), [])
  const handleSelect = useCallback((id) => setSelectedId(id), [])
  const handleSelectEvent = useCallback((key) => setSelectedEventKey(key), [])

  const selected = useMemo(
    () => telemetry.satellites.find((s) => s.id === selectedId) ?? null,
    [telemetry.satellites, selectedId],
  )

  const selectedEvent = useMemo(
    () => screening.events.find((e) => eventKey(e) === selectedEventKey) ?? null,
    [screening.events, selectedEventKey],
  )

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

  const tracked = telemetry.satellites.length

  return (
    <div className="console">
      <div className="console__header">
        <StatusHeader health={health} view={view} onChangeView={onChangeView} />
      </div>

      {health.status === 'offline' && (
        <div className="console__banner">
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

      {/* --- Left rail ---------------------------------------------------- */}
      <div className="console__rail-left">
        <GlassPanel className="console__card">
          <GaugeCard
            label="Tracking status"
            value={count}
            max={count + rejected.length}
            display={String(count)}
            unit={rejected.length ? `of ${count + rejected.length} objects` : 'objects'}
            tone={source === 'snapshot' || source === 'replay' ? 'watch' : 'accent'}
            footnote={sourceFootnote({ loading, source, snapshotEpoch, cachedAt })}
          />
        </GlassPanel>

        <GlassPanel title="Feed" className="console__card">
          <div className="console__feed">
            <div className="console__feed-row">
              <span className="console__feed-key">Source</span>
              <span className="console__feed-val ui-readout">{SOURCE_LABEL[source] ?? '—'}</span>
            </div>
            <div className="console__feed-row">
              <span className="console__feed-key">Groups</span>
              <span className="console__feed-val ui-readout" title={serverGroups.join(', ')}>
                {serverGroups.length ? serverGroups.join(', ') : '—'}
              </span>
            </div>
            <div className="console__feed-row">
              <span className="console__feed-key">Propagator</span>
              <span className="console__feed-val ui-readout">SGP4</span>
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
        </GlassPanel>
      </div>

      {/* --- Centre: the globe -------------------------------------------- */}
      <div className="console__stage">
        <GlassPanel className="console__card console__card--stage glass-panel--bleed">
          <CesiumGlobe
            propagateAll={propagateAll}
            satelliteCount={count}
            onTelemetry={handleTelemetry}
            onSelect={handleSelect}
            selectedId={selectedId}
            highlightPair={highlightPair}
            orbitTrackFor={orbitTrackFor}
          />
          <div className="console__stage-hud">
            <span className="console__hud-label ui-label">Sim time</span>
            <span className="console__hud-clock ui-readout">
              {telemetry.simTime ? formatSimClock(telemetry.simTime) : '—'}
            </span>
            {/* The multiplier is always on screen: motion is sped up, and the
                view must never be mistaken for literal real-time. */}
            <span className="console__hud-speed">×{DEFAULT_SPEED_MULTIPLIER}</span>
          </div>
        </GlassPanel>
      </div>

      {/* --- Right rail ---------------------------------------------------- */}
      <div className="console__rail-right">
        <GlassPanel title="Selected object" className="console__card">
          <SelectedObjectPanel satellite={selected} />
        </GlassPanel>

        <GlassPanel title="Conjunction risk" className="console__card">
          <EventDetail
            event={selectedEvent}
            onOpenReplay={onChangeView ? () => onChangeView('replay') : undefined}
          />
        </GlassPanel>
      </div>

      {/* --- Bottom strip --------------------------------------------------- */}
      <div className="console__strip">
        <GlassPanel className="console__card">
          <div className="console__strip-inner">
            <AssetStrip
              satellites={telemetry.satellites}
              selectedId={selectedId}
              onSelect={handleSelect}
              screening={screening}
              selectedEventKey={selectedEventKey}
              onSelectEvent={handleSelectEvent}
            />

            <div className="console__pills">
              <PillStat
                icon={<SignalIcon />}
                label="Backend"
                value={health.status === 'online' ? 'Online' : health.status === 'offline' ? 'Offline' : 'Connecting'}
                tone={health.status === 'online' ? 'nominal' : health.status === 'offline' ? 'critical' : 'dim'}
              />
              <PillStat icon={<OrbitIcon />} label="Objects tracked" value={String(tracked)} />
              <PillStat
                icon={<ClockIcon />}
                label="Sim speed"
                value={`×${DEFAULT_SPEED_MULTIPLIER}`}
                title="Simulated clock rate relative to real time"
              />
            </div>

            <div className="console__strip-pending">
              <PendingRegion
                region="Maneuver planning"
                awaiting="Delta-V simulation and AI recommendation arrive with detection."
              />
            </div>
          </div>
        </GlassPanel>
      </div>
    </div>
  )
}

export default Console
