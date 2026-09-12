import { useCallback, useMemo, useState } from 'react'

import { API_BASE_URL } from '../api/client.js'
import Countdown from '../components/common/Countdown.jsx'
import ErrorState from '../components/common/ErrorState.jsx'
import GaugeCard from '../components/common/GaugeCard.jsx'
import GlassPanel from '../components/common/GlassPanel.jsx'
import PendingRegion from '../components/common/PendingRegion.jsx'
import PillStat from '../components/common/PillStat.jsx'
import CesiumGlobe from '../components/globe/CesiumGlobe.jsx'
import AssetStrip from '../components/panels/AssetStrip.jsx'
import SelectedObjectPanel from '../components/panels/SelectedObjectPanel.jsx'
import StatusHeader from '../components/panels/StatusHeader.jsx'
import { useHealth } from '../hooks/useHealth.js'
import { useLiveSatellites } from '../hooks/useLiveSatellites.js'
import { DEFAULT_SPEED_MULTIPLIER, formatSimClock } from '../lib/simClock.js'
import './Console.css'

const UVICORN_COMMAND = 'backend\\.venv\\Scripts\\uvicorn backend.api.main:app --reload --port 8000'

/** Gauge scale for the tracked-object count — a display ceiling, not a limit. */
const TRACKING_GAUGE_MAX = 12

/**
 * How each data source is named in the UI. Nothing but a genuine live fetch
 * is allowed to read as "CelesTrak (live)" — see the source-honesty contract
 * in useLiveSatellites.js.
 */
const SOURCE_LABEL = {
  live: 'CelesTrak (live)',
  cached: 'CelesTrak (cached)',
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
 * The gauge footnote states where the numbers came from. It must never
 * assert "live" for data that is cached or bundled.
 */
function sourceFootnote({ loading, source, snapshotEpoch, cachedAt }) {
  if (loading) return 'Contacting CelesTrak…'
  if (source === 'live') return 'Live from CelesTrak, propagated on-device'
  if (source === 'cached') {
    return `Cached CelesTrak data (fetched ${describeAge(cachedAt)}), propagated on-device`
  }
  if (source === 'snapshot') {
    return `Bundled snapshot from ${snapshotEpoch} — live feed unreachable`
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
 */
function Console({ onViewChange }) {
  const health = useHealth()
  const {
    count,
    loading,
    error: tleError,
    source,
    snapshotEpoch,
    cachedAt,
    refresh: refreshTle,
    propagateAll,
  } = useLiveSatellites()

  const [telemetry, setTelemetry] = useState({ simTime: null, satellites: [] })
  const [selectedId, setSelectedId] = useState(null)

  const handleTelemetry = useCallback((next) => setTelemetry(next), [])
  const handleSelect = useCallback((id) => setSelectedId(id), [])

  const selected = useMemo(
    () => telemetry.satellites.find((s) => s.id === selectedId) ?? null,
    [telemetry.satellites, selectedId],
  )

  const tracked = telemetry.satellites.length

  return (
    <div className="console">
      <div className="console__header">
        <StatusHeader health={health} view="console" onViewChange={onViewChange} />
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
            value={tracked}
            max={TRACKING_GAUGE_MAX}
            display={String(tracked)}
            unit="objects"
            tone={source === 'snapshot' ? 'watch' : 'accent'}
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
              <span className="console__feed-key">Group</span>
              <span className="console__feed-val ui-readout">stations</span>
            </div>
            <div className="console__feed-row">
              <span className="console__feed-key">Propagator</span>
              <span className="console__feed-val ui-readout">SGP4</span>
            </div>
          </div>

          {/* The live feed being down is a normal, survivable state — but it
              must be stated, never hidden behind still-moving satellites. */}
          {source === 'snapshot' && (
            <div className="console__feed-degraded">
              <ErrorState
                title="Live feed unavailable"
                detail={tleError?.message ?? 'CelesTrak unreachable'}
                hint={`Showing a bundled snapshot of real TLEs captured ${snapshotEpoch}. Positions drift as that epoch ages, so treat them as approximate.`}
                onRetry={refreshTle}
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
          <GaugeCard
            label=""
            value={null}
            tone="critical"
            unit="Pc"
            footnote="No conjunction assessed. Screening between tracked objects is not wired up yet."
          />

          {/*
            Deliberately passed a null target. Screening is not wired yet, so
            there is no TCA to count to, and the countdown says exactly that.
            When step 4 lands, this takes the selected event's `tca_utc_iso`
            and its `threat_level` as `tone` — no other change is needed.

            It free-runs against real UTC rather than the globe's x120
            simulated clock: a TCA is a real instant, and the caption under
            the clock states which basis is in force. The Envisat replay will
            pass `nowUtc` instead, since counting from today to a 2004
            encounter would be meaningless.
          */}
          <Countdown
            targetUtc={null}
            emptyHint="No conjunction assessed yet, so there is no time of closest approach to count to. Screening between tracked objects is not wired up."
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
