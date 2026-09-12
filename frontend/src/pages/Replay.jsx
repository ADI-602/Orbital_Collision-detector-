import { useCallback, useMemo, useState } from 'react'

import { API_BASE_URL } from '../api/client.js'
import {
  maneuverResultToManeuverOption,
  screeningEventToConjunctionContext,
} from '../api/adapters.js'
import Countdown from '../components/common/Countdown.jsx'
import ErrorState from '../components/common/ErrorState.jsx'
import GlassPanel from '../components/common/GlassPanel.jsx'
import LoadingState from '../components/common/LoadingState.jsx'
import RiskBadge from '../components/common/RiskBadge.jsx'
import CesiumGlobe from '../components/globe/CesiumGlobe.jsx'
import AiAdvisorPanel from '../components/panels/AiAdvisorPanel.jsx'
import PcTrend from '../components/panels/PcTrend.jsx'
import StatusHeader from '../components/panels/StatusHeader.jsx'
import { useAiAdvice } from '../hooks/useAiAdvice.js'
import { useEnvisatReplay } from '../hooks/useEnvisatReplay.js'
import { useHealth } from '../hooks/useHealth.js'
import { useManeuverSim } from '../hooks/useManeuverSim.js'
import { useReplayClock } from '../hooks/useReplayClock.js'
import { useReplayPropagator } from '../hooks/useReplayPropagator.js'
import {
  comparePublished,
  EXECUTED_MANEUVER,
  NASA_CROSSCHECK_MISS_DISTANCE_M,
  PC_METHODOLOGY_NOTE,
  PUBLISHED_MISS_DISTANCE_M,
  PUBLISHED_PC,
  PUBLISHED_TCA_ISO,
} from '../lib/envisatGroundTruth.js'
import {
  formatDeltaV,
  formatKg,
  formatKmPerSecond,
  formatMetres,
  formatPc,
  formatPercent,
} from '../lib/format.js'
import { formatSimClock } from '../lib/simClock.js'
import './Replay.css'

/**
 * How far before TCA the replay clock starts, in minutes. At the speed below
 * that is a 90-second run-in to the encounter.
 */
const LEAD_MINUTES = 90

/** Simulated seconds per real second. */
const REPLAY_SPEED = 60

/** Envisat's launch mass, the value the endpoint defaults to. */
const ENVISAT_MASS_KG = 8200.0

/** Threat level -> visual tone. Always the pipeline's call, never ours. */
const TONE_BY_THREAT = { RED: 'critical', YELLOW: 'watch', GREEN: 'nominal' }

/** Verdict chip for a computed value against a published band. */
function Verdict({ value, band, unit }) {
  const verdict = comparePublished(value, band)
  const text = {
    within: 'within published range',
    outside: 'outside published range',
    unknown: 'not computed',
  }[verdict]

  return (
    <span className={`replay__verdict replay__verdict--${verdict}`}>
      <span className="replay__verdict-mark" aria-hidden="true">
        {verdict === 'within' ? '✓' : verdict === 'outside' ? '≠' : '—'}
      </span>
      {text}
      {verdict !== 'unknown' && (
        <span className="replay__verdict-band">
          ({unit === 'pc'
            ? `${formatPc(band.min)}–${formatPc(band.max)}`
            : `${band.min}–${band.max} m`})
        </span>
      )}
    </span>
  )
}

/** One row of the physics readout. */
function Readout({ label, value, note }) {
  return (
    <div className="replay__readout">
      <span className="replay__readout-key ui-label">{label}</span>
      <span className="replay__readout-val ui-readout">{value}</span>
      {note && <span className="replay__readout-note">{note}</span>}
    </div>
  )
}

/**
 * Replay — the October 2004 Envisat / Zenith-2 conjunction, recomputed.
 *
 * This view exists to be checked, not admired. Four days of real 2004 element
 * sets go through the same /api/physics/screening endpoint the live console
 * uses; the numbers that come back are shown beside the numbers Klinkrad et
 * al. published, agreeing where they agree and disagreeing visibly where they
 * do not. Nothing here is precomputed and no value is adjusted to match.
 *
 * The globe is the one thing on screen that is NOT pipeline output: it
 * propagates the same TLEs in the browser so the encounter is watchable. It
 * is labelled as such, and no number is read off it.
 */
function Replay({ onViewChange }) {
  const health = useHealth()
  const replay = useEnvisatReplay()
  const [selectedDay, setSelectedDay] = useState(null)
  const [paused, setPaused] = useState(false)
  const [runId, setRunId] = useState(0)

  // Default to the last prediction day — T-0d, the morning the decision was
  // actually made — until the operator picks another.
  const active = useMemo(() => {
    if (!replay.days.length) return null
    return replay.days.find((d) => d.day === selectedDay) ?? replay.days[replay.days.length - 1]
  }, [replay.days, selectedDay])

  const propagator = useReplayPropagator(active)

  const restart = useCallback(() => {
    setRunId((n) => n + 1)
    setPaused(false)
  }, [])

  /**
   * The globe's clock is anchored to the SCENARIO's stated TCA, which is
   * metadata the replay endpoint returns — not a computed result. Anchoring
   * it to the computed TCA instead would restart the animation every time
   * screening finished or the day changed. The countdown below targets the
   * computed value; this only decides where the camera clock starts.
   */
  const epochBaseMs = useMemo(() => {
    const anchor = replay.scenario?.tca_utc
    if (!anchor) return null
    const ms = Date.parse(anchor)
    return Number.isNaN(ms) ? null : ms - LEAD_MINUTES * 60_000
  }, [replay.scenario])

  /**
   * The replay's clock, owned here rather than by the globe so the countdown
   * keeps working even if Cesium never initialises.
   */
  const { simTime, getSimTime } = useReplayClock({
    epochBaseMs,
    speed: REPLAY_SPEED,
    paused,
    runId,
  })

  const event = active?.event ?? null
  const tone = event ? (TONE_BY_THREAT[event.threat_level] ?? 'accent') : 'accent'

  // The burn ESA actually flew, re-simulated against this day's element sets.
  const maneuverRequest = useMemo(() => {
    if (!active || !event) return null
    return {
      primary: active.primary_tle,
      secondary: active.secondary_tle,
      tca_utc_iso: event.tca_utc_iso,
      delta_v_cm_s: EXECUTED_MANEUVER.delta_v_cm_s,
      lead_time_minutes: EXECUTED_MANEUVER.lead_time_minutes,
      sat_mass_kg: ENVISAT_MASS_KG,
    }
  }, [active, event])

  const maneuver = useManeuverSim(maneuverRequest)
  const maneuverSettled = ['done', 'empty', 'error'].includes(maneuver.status)

  /**
   * The advisor is asked only once there is a real screened event AND the burn
   * simulation has settled, so it never narrates a partially-populated case.
   * Both inputs go through api/adapters.js — the single named crossing of the
   * physics/AI boundary.
   */
  const aiRequest = useMemo(() => {
    if (!active || !event || !maneuverSettled) return null
    return {
      conjunction: screeningEventToConjunctionContext(event, replay.scenario?.primary_satellite ?? 'ENVISAT'),
      maneuvers: maneuver.result ? [maneuverResultToManeuverOption(maneuver.result)] : [],
      query_type: 'recommendation',
    }
  }, [active, event, maneuverSettled, maneuver.result, replay.scenario])

  const ai = useAiAdvice(aiRequest)

  const linkIds =
    propagator.primaryId && propagator.secondaryId
      ? [propagator.primaryId, propagator.secondaryId]
      : null

  return (
    <div className="replay">
      <div className="replay__header">
        <StatusHeader health={health} view="replay" onViewChange={onViewChange} />
      </div>

      {/* --- Scenario framing ---------------------------------------------- */}
      <div className="replay__intro">
        <GlassPanel className="replay__card">
          <div className="replay__intro-inner">
            <div className="replay__intro-text">
              <span className="ui-label">Correctness proof</span>
              <h2 className="replay__title">
                {replay.scenario?.event_name ?? 'Envisat vs Zenith-2 Debris (October 2004)'}
              </h2>
              <p className="replay__blurb">
                A real conjunction with published results. Four days of 2004 element sets
                are screened by the same pipeline the live console uses — each day from its
                own 00:00 UTC through the end of October 22, with no hint as to where the
                encounter lies. The numbers below are what came back.
              </p>
            </div>

            <dl className="replay__facts">
              <div>
                <dt>Published TCA</dt>
                <dd className="ui-readout">{PUBLISHED_TCA_ISO}</dd>
              </div>
              <div>
                <dt>Published miss</dt>
                <dd className="ui-readout">
                  {PUBLISHED_MISS_DISTANCE_M.min}–{PUBLISHED_MISS_DISTANCE_M.max} m
                </dd>
              </div>
              <div>
                <dt>Published Pc</dt>
                <dd className="ui-readout">
                  {formatPc(PUBLISHED_PC.min)}–{formatPc(PUBLISHED_PC.max)}
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>Klinkrad et al. 2005, SDC4-paper49 §6</dd>
              </div>
            </dl>
          </div>
        </GlassPanel>
      </div>

      {replay.status === 'error' && (
        <div className="replay__banner">
          <ErrorState
            title="Replay data unavailable"
            detail={replay.error?.detail ?? replay.error?.message}
            hint={`The scenario endpoint at ${API_BASE_URL} did not answer, so no day could be screened.`}
            onRetry={replay.refresh}
          />
        </div>
      )}

      {/* --- Left: the four prediction days -------------------------------- */}
      <div className="replay__rail-left">
        <GlassPanel title="Prediction days" className="replay__card">
          <ul className="replay__days">
            {replay.days.map((d) => {
              const isActive = active?.day === d.day
              return (
                <li key={d.day}>
                  <button
                    type="button"
                    className={`replay__day ${isActive ? 'is-active' : ''}`}
                    onClick={() => setSelectedDay(d.day)}
                    aria-pressed={isActive}
                  >
                    <span className="replay__day-head">
                      <span className="replay__day-label">{d.label}</span>
                      <span className="replay__day-lead">{d.lead}</span>
                    </span>

                    {d.status === 'screening' && (
                      <span className="replay__day-state">screening {d.search_hours} h…</span>
                    )}
                    {d.status === 'pending' && (
                      <span className="replay__day-state">queued</span>
                    )}
                    {d.status === 'empty' && (
                      <span className="replay__day-state">no close approach found</span>
                    )}
                    {d.status === 'error' && (
                      <span className="replay__day-state replay__day-state--error">
                        screening failed
                      </span>
                    )}
                    {d.status === 'done' && d.event && (
                      <span className="replay__day-nums">
                        <span className="ui-readout">{formatMetres(d.event.miss_distance_m)}</span>
                        <span className="ui-readout">{formatPc(d.event.pc)}</span>
                        <RiskBadge level={d.event.threat_level} />
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          {replay.status === 'loading' && <LoadingState label="Loading scenario" />}
        </GlassPanel>
      </div>

      {/* --- Centre: globe + countdown ------------------------------------- */}
      <div className="replay__stage">
        <GlassPanel className="replay__card replay__card--stage glass-panel--bleed">
          {epochBaseMs === null ? (
            <LoadingState label="Awaiting scenario epoch" />
          ) : (
            <CesiumGlobe
              propagateAll={propagator.propagateAll}
              satelliteCount={propagator.count}
              getSimTime={getSimTime}
              linkIds={linkIds}
              linkTone={tone}
            />
          )}

          <div className="replay__hud">
            <div className="replay__hud-clock">
              <span className="ui-label">Replay time</span>
              <span className="ui-readout">{simTime ? formatSimClock(simTime) : '—'}</span>
              <span className="replay__hud-speed">×{REPLAY_SPEED}</span>
            </div>

            <div className="replay__controls">
              <button
                type="button"
                className="replay__control"
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? 'Play' : 'Pause'}
              </button>
              <button type="button" className="replay__control" onClick={restart}>
                Restart
              </button>
            </div>
          </div>

          <p className="replay__globe-note">
            Globe positions are the same 2004 element sets propagated in the browser, for
            visualisation. Every number in the panels comes from the backend pipeline.
          </p>
        </GlassPanel>
      </div>

      {/* --- Right: the selected day's physics ------------------------------ */}
      <div className="replay__rail-right">
        <GlassPanel title={`${active?.label ?? 'Day'} — conjunction`} className="replay__card">
          {event ? (
            <div className="replay__detail">
              <Readout
                label="Miss distance"
                value={formatMetres(event.miss_distance_m)}
                note={<Verdict value={event.miss_distance_m} band={PUBLISHED_MISS_DISTANCE_M} unit="m" />}
              />
              <Readout
                label="Collision probability"
                value={formatPc(event.pc)}
                note={<Verdict value={event.pc} band={PUBLISHED_PC} unit="pc" />}
              />
              <Readout label="Relative speed" value={formatKmPerSecond(event.relative_speed_km_s)} />
              <Readout
                label="Computed TCA"
                value={event.tca_utc_iso}
                note={`published ${PUBLISHED_TCA_ISO}`}
              />
              <div className="replay__detail-threat">
                <RiskBadge level={event.threat_level} />
              </div>
            </div>
          ) : (
            <p className="replay__empty">
              {active?.status === 'error'
                ? 'Screening failed for this day — see the error on the left.'
                : active?.status === 'empty'
                  ? 'The pipeline found no close approach in this day’s search window.'
                  : 'Screening this day…'}
            </p>
          )}
        </GlassPanel>

        <GlassPanel title="Time to closest approach" className="replay__card">
          <Countdown
            targetUtc={event?.tca_utc_iso ?? null}
            nowUtc={simTime}
            tone={tone}
            label=""
            basisLabel={`replay clock ×${REPLAY_SPEED}`}
            emptyHint="No TCA computed for this day, so there is nothing to count to."
          />
        </GlassPanel>
      </div>

      {/* --- Bottom: trend, maneuver, AI ------------------------------------ */}
      <div className="replay__strip">
        <GlassPanel title="Pc across prediction days" className="replay__card">
          <PcTrend days={replay.days} />
          <p className="replay__note">{PC_METHODOLOGY_NOTE}</p>
        </GlassPanel>

        <GlassPanel title="Maneuver — the burn ESA flew" className="replay__card">
          {maneuver.status === 'running' && <LoadingState label="Simulating burn" />}
          {maneuver.status === 'idle' && (
            <p className="replay__empty">Waiting for a screened conjunction.</p>
          )}
          {maneuver.status === 'empty' && (
            <p className="replay__empty">
              The maneuver endpoint found no close approach to act on for this day.
            </p>
          )}
          {maneuver.status === 'error' && (
            <ErrorState
              title="Maneuver simulation failed"
              detail={maneuver.error?.detail ?? maneuver.error?.message}
              onRetry={maneuver.refresh}
            />
          )}
          {maneuver.status === 'done' && maneuver.result && (
            <div className="replay__detail">
              <Readout
                label="Burn"
                value={formatDeltaV(maneuver.result.delta_v_cm_s)}
                note={`${maneuver.result.lead_time_minutes} min before TCA — the burn flown at ${EXECUTED_MANEUVER.burn_time_iso}`}
              />
              <Readout
                label="Miss distance"
                value={`${formatMetres(maneuver.result.pre_burn_miss_distance_m)} → ${formatMetres(maneuver.result.post_burn_miss_distance_m)}`}
              />
              <Readout
                label="Pc"
                value={`${formatPc(maneuver.result.pre_burn_pc)} → ${formatPc(maneuver.result.post_burn_pc)}`}
                note={`paper reports ${formatPc(EXECUTED_MANEUVER.published_pre_burn_pc)} → ${formatPc(EXECUTED_MANEUVER.published_post_burn_pc)} for the flown burn — our simulation is independent of it`}
              />
              <Readout
                label="Risk reduction"
                value={formatPercent(maneuver.result.risk_reduction_pct)}
              />
              <Readout label="Propellant" value={formatKg(maneuver.result.fuel_consumed_kg)} />
            </div>
          )}
        </GlassPanel>

        <GlassPanel title="AI decision support" className="replay__card">
          <AiAdvisorPanel
            status={ai.status}
            advice={ai.advice}
            isLive={ai.isLive}
            error={ai.error}
            onRetry={ai.refresh}
            awaiting="Waiting for this day's screening and burn simulation to finish."
          />
        </GlassPanel>
      </div>

      <div className="replay__footnote">
        <p>
          Independent cross-check: NASA verified this conjunction on T-1d from Space
          Surveillance Network state vectors and obtained{' '}
          {NASA_CROSSCHECK_MISS_DISTANCE_M.min}–{NASA_CROSSCHECK_MISS_DISTANCE_M.max} m.
        </p>
      </div>
    </div>
  )
}

export default Replay
