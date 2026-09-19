import { useCallback, useMemo, useState } from 'react'

import { API_BASE_URL } from '../api/client.js'
import {
  maneuverResultToManeuverOption,
  screeningEventToConjunctionContext,
} from '../api/adapters.js'
import Countdown from '../components/common/Countdown.jsx'
import ErrorState from '../components/common/ErrorState.jsx'
import GaugeCard from '../components/common/GaugeCard.jsx'
import GlassPanel from '../components/common/GlassPanel.jsx'
import PillStat from '../components/common/PillStat.jsx'
import RiskBadge from '../components/common/RiskBadge.jsx'
import CesiumGlobe from '../components/globe/CesiumGlobe.jsx'
import AiAdvisorPanel from '../components/panels/AiAdvisorPanel.jsx'
import AssetStrip from '../components/panels/AssetStrip.jsx'
import ManeuverPlanner from '../components/panels/ManeuverPlanner.jsx'
import EventList from '../components/panels/EventList.jsx'
import SelectedObjectPanel from '../components/panels/SelectedObjectPanel.jsx'
import StatusHeader from '../components/panels/StatusHeader.jsx'
import { useAiAdvice } from '../hooks/useAiAdvice.js'
import { useHealth } from '../hooks/useHealth.js'
import { useLiveSatellites } from '../hooks/useLiveSatellites.js'
import { useLiveScreening } from '../hooks/useLiveScreening.js'
import { useManeuverSim } from '../hooks/useManeuverSim.js'
import { formatMetres, formatPc } from '../lib/format.js'
import {
  INJECTED_DEBRIS,
  INJECTED_DESCRIPTION,
  INJECTED_LABEL,
  INJECTED_PRIMARY,
  INJECTED_SEARCH_HOURS,
  INJECTED_WINDOW_START_ISO,
} from '../lib/injectedScenario.js'
import { DEFAULT_SPEED_MULTIPLIER, formatSimClock } from '../lib/simClock.js'
import './Console.css'

/** Hours of the primary's element-set epoch to screen in live mode. */
const LIVE_SEARCH_HOURS = 24

/**
 * The burn to simulate for a detected event. -4 cm/s at 50 min of lead is the
 * manoeuvre ESA actually flew for the Envisat conjunction, used here as a
 * representative retrograde burn rather than an optimised one — the slider
 * that makes it adjustable is still to build.
 */
const DEFAULT_BURN = { delta_v_cm_s: -4.0, lead_time_minutes: 50.0 }

/** Threat level -> visual tone. The pipeline's call, never the UI's. */
const TONE_BY_THREAT = { RED: 'critical', YELLOW: 'watch', GREEN: 'nominal' }

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
    records,
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
  const [mode, setMode] = useState('live')
  const [selectedEventName, setSelectedEventName] = useState(null)

  const handleTelemetry = useCallback((next) => setTelemetry(next), [])
  const handleSelect = useCallback((id) => setSelectedId(id), [])

  const selected = useMemo(
    () => telemetry.satellites.find((s) => s.id === selectedId) ?? null,
    [telemetry.satellites, selectedId],
  )

  const tracked = telemetry.satellites.length

  // --- Detection ----------------------------------------------------------
  // Two sources, never blended. Live screening runs the real tracked set and
  // reports whatever it finds, usually nothing. The injected scenario is a
  // constructed encounter, labelled as such everywhere it appears, that exists
  // so the detect -> assess -> advise chain can be shown end to end.
  const screeningInput = useMemo(() => {
    if (mode === 'injected') {
      return {
        primary: INJECTED_PRIMARY,
        candidates: INJECTED_DEBRIS,
        searchHours: INJECTED_SEARCH_HOURS,
        startUtcIso: INJECTED_WINDOW_START_ISO,
      }
    }

    // The globe selection doubles as the screening primary; failing that, the
    // first tracked object. Screening needs raw TLE lines, which the tracking
    // hook keeps alongside each satrec.
    if (records.length < 2) return null
    const primary = records.find((r) => r.id === selectedId) ?? records[0]
    const candidates = records.filter((r) => r.id !== primary.id)
    if (!candidates.length) return null

    const asTle = (r) => ({ name: r.name, line1: r.line1, line2: r.line2 })
    return {
      primary: asTle(primary),
      candidates: candidates.map(asTle),
      searchHours: LIVE_SEARCH_HOURS,
    }
  }, [mode, records, selectedId])

  const screening = useLiveScreening(screeningInput)

  const activeEvent = useMemo(() => {
    if (!screening.events.length) return null
    return (
      screening.events.find((e) => e.secondary_name === selectedEventName) ??
      screening.events[0]
    )
  }, [screening.events, selectedEventName])

  const eventTone = activeEvent
    ? (TONE_BY_THREAT[activeEvent.threat_level] ?? 'accent')
    : 'accent'

  // The secondary's element set, matched by name — the screening response
  // carries a name, not the lines it was screened from.
  const activeSecondary = useMemo(() => {
    if (!activeEvent || !screeningInput) return null
    return screeningInput.candidates.find((c) => c.name === activeEvent.secondary_name) ?? null
  }, [activeEvent, screeningInput])

  // Just the pair and the encounter; ManeuverPlanner owns the burn itself.
  const maneuverTarget = useMemo(() => {
    if (!activeEvent || !activeSecondary || !screeningInput) return null
    return {
      primary: screeningInput.primary,
      secondary: activeSecondary,
      tca_utc_iso: activeEvent.tca_utc_iso,
    }
  }, [activeEvent, activeSecondary, screeningInput])

  // The advisor is asked about the conjunction itself. It is deliberately not
  // re-queried as the sliders move: an LLM round trip per drag would be slow,
  // costly, and would leave narrative and numbers describing different burns.
  const advisorBurn = useManeuverSim(
    maneuverTarget ? { ...maneuverTarget, ...DEFAULT_BURN, sat_mass_kg: 8200.0 } : null,
  )
  const maneuverSettled = ['done', 'empty', 'error'].includes(advisorBurn.status)

  const aiRequest = useMemo(() => {
    if (!activeEvent || !screeningInput || !maneuverSettled) return null
    return {
      conjunction: screeningEventToConjunctionContext(activeEvent, screeningInput.primary.name),
      maneuvers: advisorBurn.result ? [maneuverResultToManeuverOption(advisorBurn.result)] : [],
      query_type: 'recommendation',
    }
  }, [activeEvent, screeningInput, maneuverSettled, advisorBurn.result])

  const ai = useAiAdvice(aiRequest)

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
        <GlassPanel
          title="Conjunction screening"
          className="console__card"
          actions={
            <div className="console__modes">
              <button
                type="button"
                className={`console__mode ${mode === 'live' ? 'is-active' : ''}`}
                onClick={() => { setMode('live'); setSelectedEventName(null) }}
                aria-pressed={mode === 'live'}
              >
                Live
              </button>
              <button
                type="button"
                className={`console__mode ${mode === 'injected' ? 'is-active' : ''}`}
                onClick={() => { setMode('injected'); setSelectedEventName(null) }}
                aria-pressed={mode === 'injected'}
                title={INJECTED_DESCRIPTION}
              >
                {INJECTED_LABEL}
              </button>
            </div>
          }
        >
          {/*
            The injected banner is not decoration. These objects do not exist,
            and anything on screen that came from them has to carry that fact
            with it — a camera cannot tell a constructed encounter from a
            catalogued one.
          */}
          {mode === 'injected' && (
            <p className="console__injected-note">
              <strong>{INJECTED_LABEL}</strong> — {INJECTED_DESCRIPTION}
            </p>
          )}

          <div className="console__screen-primary">
            <span className="console__feed-key">Primary</span>
            <span className="console__feed-val ui-readout">
              {screeningInput?.primary.name ?? '—'}
            </span>
          </div>

          <EventList
            status={screening.status}
            events={screening.events}
            unassessable={screening.unassessable}
            windowStart={screening.windowStart}
            windowHours={screening.windowHours}
            screenedCount={screening.screenedCount}
            selectedName={activeEvent?.secondary_name ?? null}
            onSelect={(e) => setSelectedEventName(e.secondary_name)}
            error={screening.error}
            onRetry={screening.refresh}
          />
        </GlassPanel>

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
        <GlassPanel title="Conjunction risk" className="console__card">
          {/*
            Pc is shown on a log gauge because probability spans decades: on a
            linear scale every value the pipeline produces would pin to zero.
            The arc is the exponent's position between 1e-8 and 1e-2; the
            readout is always the real number.
          */}
          <GaugeCard
            label={activeEvent?.secondary_name ?? ''}
            value={activeEvent ? Math.max(0, Math.log10(activeEvent.pc) + 8) : null}
            max={6}
            display={activeEvent ? formatPc(activeEvent.pc) : undefined}
            tone={eventTone}
            unit="Pc"
            footnote={
              activeEvent
                ? `Miss distance ${formatMetres(activeEvent.miss_distance_m)} at ${activeEvent.relative_speed_km_s.toFixed(2)} km/s`
                : 'No conjunction found. Nothing crossed the screening threshold in the searched window.'
            }
          />

          {activeEvent && (
            <div className="console__threat">
              <RiskBadge level={activeEvent.threat_level} />
            </div>
          )}

          {/*
            Counts against real UTC, not the globe's x120 simulated clock: a
            TCA is a real instant. The caption under the clock says which basis
            is in force, and with a stale element set the TCA can legitimately
            be in the past, which reads as T+ rather than being hidden.
          */}
          <Countdown
            targetUtc={activeEvent?.tca_utc_iso ?? null}
            tone={eventTone}
            emptyHint="No conjunction found in the searched window, so there is no time of closest approach to count to."
          />
        </GlassPanel>

        <GlassPanel title="Maneuver" className="console__card">
          <ManeuverPlanner
            target={maneuverTarget}
            idleHint="Select a detected conjunction to simulate a burn against it."
          />
        </GlassPanel>

        <GlassPanel title="Selected object" className="console__card">
          <SelectedObjectPanel satellite={selected} />
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

            <div className="console__strip-ai">
              <AiAdvisorPanel
                status={ai.status}
                advice={ai.advice}
                isLive={ai.isLive}
                error={ai.error}
                onRetry={ai.refresh}
                awaiting="Waiting for a detected conjunction to explain."
              />
            </div>
          </div>
        </GlassPanel>
      </div>
    </div>
  )
}

export default Console
