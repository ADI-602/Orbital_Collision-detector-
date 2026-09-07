import { useCallback, useRef, useState } from 'react'

import { API_BASE_URL } from '../api/client.js'
import ErrorState from '../components/common/ErrorState.jsx'
import GlassPanel from '../components/common/GlassPanel.jsx'
import LoadingState from '../components/common/LoadingState.jsx'
import PendingRegion from '../components/common/PendingRegion.jsx'
import RiskBadge from '../components/common/RiskBadge.jsx'
import TMinus from '../components/common/TMinus.jsx'
import CesiumGlobe from '../components/globe/CesiumGlobe.jsx'
import PredictionTable from '../components/panels/PredictionTable.jsx'
import StatusHeader from '../components/panels/StatusHeader.jsx'
import { useEnvisatReplay } from '../hooks/useEnvisatReplay.js'
import { useHealth } from '../hooks/useHealth.js'
import {
  formatMissDistance,
  formatPc,
  formatRelativeSpeed,
  riskColorHex,
  splitTcaIso,
} from '../lib/conjunctions.js'
import {
  HISTORICAL_MANEUVER,
  PC_ACCEPTED_LEVEL,
  PUBLISHED_SOURCE,
  PUBLISHED_TCA_UTC_ISO,
  REPLAY_LEAD_MINUTES,
  REPLAY_SCREEN_WINDOW_HOURS,
  REPLAY_SPEED_MULTIPLIER,
  REPLAY_TRAIL_MINUTES,
  replaySimTime,
} from '../lib/replay.js'
import { formatSimClock } from '../lib/simClock.js'
import './Replay.css'

/**
 * The Envisat replay — this project's correctness proof, on screen.
 *
 * The live console answers "does this detect conjunctions?". This view answers
 * the harder question a technical judge will actually ask: "how do you know
 * your numbers are right?" It takes a real conjunction from October 2004 whose
 * outcome ESA published, runs the archived element sets through the same
 * endpoint the live console uses, and puts the computed values next to the
 * published ones.
 *
 * WHAT IS COMPUTED AND WHAT IS DRAWN. Every figure on this page came back from
 * POST /api/physics/screening. The two moving markers are propagated in the
 * browser by satellite.js purely so the encounter is visible; the separation
 * you see between them is a picture, and the miss distance is the number. They
 * are never presented as the same thing.
 *
 * THE CLOCK IS NOT TODAY'S. The globe here runs on a window around the 2004
 * TCA, not on the current date, which is why it supplies its own `simTimeFor`
 * rather than using the live console's now-plus-elapsed clock.
 */
function Replay({ view, onChangeView }) {
  const health = useHealth()
  const replay = useEnvisatReplay()
  const { tcaMs, tcaIso, tcaIsComputed, headline, days, pair, status } = replay

  const [telemetry, setTelemetry] = useState({ simTime: null, satellites: [] })
  const [paused, setPaused] = useState(false)

  // The replay clock accumulates only while playing, so pause freezes the
  // globe and the countdown together instead of letting one run on.
  const pausedRef = useRef(false)
  pausedRef.current = paused
  const playedMsRef = useRef(0)
  const lastElapsedRef = useRef(0)

  const simTimeFor = useCallback(
    (elapsedRealMs) => {
      // clockKey changes reset the globe's elapsed counter to zero; clamping
      // at zero stops that showing up as a jump backwards through the window.
      const delta = Math.max(0, elapsedRealMs - lastElapsedRef.current)
      lastElapsedRef.current = elapsedRealMs
      if (!pausedRef.current) playedMsRef.current += delta
      return replaySimTime(tcaMs, playedMsRef.current)
    },
    [tcaMs],
  )

  const restart = useCallback(() => {
    playedMsRef.current = 0
  }, [])

  const handleTelemetry = useCallback((next) => setTelemetry(next), [])

  const simMs = telemetry.simTime ? telemetry.simTime.getTime() : NaN
  const tca = splitTcaIso(tcaIso)
  const published = splitTcaIso(PUBLISHED_TCA_UTC_ISO)
  const loading = status === 'loading'

  // Both objects are always drawn together here — unlike the live console,
  // where a pair only lights up when its event is selected.
  const highlightPair = {
    primaryId: replay.primaryId,
    secondaryId: replay.secondaryId,
    colorHex: riskColorHex(headline),
  }

  return (
    <div className="replay">
      <div className="replay__header">
        <StatusHeader health={health} view={view} onChangeView={onChangeView} />
      </div>

      {health.status === 'offline' && (
        <div className="replay__banner">
          <ErrorState
            title="Backend unreachable"
            detail={health.error?.detail ?? health.error?.message ?? 'unknown error'}
            hint={
              <>
                This view is entirely pipeline output, so it has nothing to show
                until the API responds at <code>{API_BASE_URL}</code>. The globe
                below still animates the archived orbits — those are propagated
                in-browser and do not need the backend.
              </>
            }
            onRetry={health.refresh}
          />
        </div>
      )}

      {/* --- Left rail: what this is ---------------------------------------- */}
      <div className="replay__rail-left">
        <GlassPanel title="Validation case" className="replay__card">
          <div className="replay__case">
            <span className="replay__case-name">
              {replay.eventName ?? 'Envisat vs. Zenith-2 Debris (October 2004)'}
            </span>
            <p className="replay__case-body">
              On 22 October 2004 ESA predicted a close approach between Envisat
              and a fragment of a Russian Zenith-2 upper stage (92-093EE), and
              flew an avoidance maneuver. The prediction was published, so its
              numbers can be checked against ours.
            </p>
            <p className="replay__case-body">
              The archived element sets below go to the same{' '}
              <code>/api/physics/screening</code> endpoint the live console
              calls. Nothing about this case is special-cased in the pipeline.
            </p>
            <dl className="replay__meta">
              <div className="replay__meta-row">
                <dt className="replay__meta-key">Source</dt>
                <dd className="replay__meta-val">{PUBLISHED_SOURCE}</dd>
              </div>
              <div className="replay__meta-row">
                <dt className="replay__meta-key">Search window</dt>
                <dd className="replay__meta-val ui-readout">
                  {REPLAY_SCREEN_WINDOW_HOURS} h from 2004-10-22 00:00Z
                </dd>
              </div>
              <div className="replay__meta-row">
                <dt className="replay__meta-key">Propagator</dt>
                <dd className="replay__meta-val ui-readout">SGP4</dd>
              </div>
            </dl>
          </div>
        </GlassPanel>

        <GlassPanel title="What ESA did" className="replay__card">
          <div className="replay__history">
            <p className="replay__case-body">
              All four predictions exceeded ESA&rsquo;s accepted collision
              probability of {PC_ACCEPTED_LEVEL.toExponential(0)}, so the
              maneuver was flown: a{' '}
              <span className="ui-readout">{HISTORICAL_MANEUVER.deltaVCmS} cm/s</span>{' '}
              in-track braking burn{' '}
              {HISTORICAL_MANEUVER.leadTimeMinutes} minutes before closest
              approach.
            </p>
            <p className="replay__case-note">
              This is history, quoted from the paper — not something this app
              computed. Reproducing the burn through{' '}
              <code>/api/physics/maneuver</code> is the next build step.
            </p>
            <PendingRegion
              region="Maneuver simulation"
              awaiting="Re-flying this burn through the pipeline, and comparing pre- and post-burn probability, arrives with the maneuver step."
            />
          </div>
        </GlassPanel>
      </div>

      {/* --- Centre: the encounter ------------------------------------------ */}
      <div className="replay__stage">
        <GlassPanel className="replay__card replay__card--stage glass-panel--bleed">
          <CesiumGlobe
            propagateAll={replay.propagateAll}
            satelliteCount={replay.objectCount}
            onTelemetry={handleTelemetry}
            highlightPair={highlightPair}
            orbitTrackFor={replay.orbitTrackFor}
            simTimeFor={simTimeFor}
            clockKey={tcaMs}
            telemetryIntervalMs={100}
          />

          <div className="replay__countdown">
            <TMinus
              targetMs={tcaMs}
              mode="sim"
              nowMs={simMs}
              label="Closest approach"
              note={
                tcaIsComputed
                  ? 'Counting down to the TCA this pipeline refined.'
                  : 'Counting down to the published TCA — screening has not returned one yet.'
              }
            />
          </div>

          <div className="replay__hud">
            <span className="replay__hud-label ui-label">Replay time</span>
            <span className="replay__hud-clock ui-readout">
              {telemetry.simTime ? formatSimClock(telemetry.simTime) : '—'}
            </span>
            <span className="replay__hud-speed">×{REPLAY_SPEED_MULTIPLIER}</span>
          </div>

          <div className="replay__controls">
            <button
              type="button"
              className="replay__control"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
            >
              {paused ? 'Play' : 'Pause'}
            </button>
            <button type="button" className="replay__control" onClick={restart}>
              Restart
            </button>
            <span className="replay__controls-note">
              {REPLAY_LEAD_MINUTES} min before to {REPLAY_TRAIL_MINUTES} min
              after, looping
            </span>
          </div>
        </GlassPanel>
      </div>

      {/* --- Right rail: the numbers ---------------------------------------- */}
      <div className="replay__rail-right">
        <GlassPanel title="Closest approach — 22 Oct prediction" className="replay__card">
          {loading && <LoadingState label="SCREENING FOUR PREDICTION DAYS" />}

          {!loading && replay.error && (
            <ErrorState
              title="Could not load the archived element sets"
              detail={replay.error.detail ?? replay.error.message}
              hint="Without the archived TLEs there is nothing to screen. The globe is showing no objects for the same reason."
              onRetry={replay.reload}
            />
          )}

          {!loading && !replay.error && !headline && (
            <ErrorState
              title="No conjunction returned for 22 Oct"
              detail="The screening endpoint accepted the request but reported no event."
              hint="This event is the pipeline's regression case — an empty result here means the physics needs investigating, not the view. Compare against tests/test_envisat_replay.py."
              onRetry={replay.reload}
            />
          )}

          {!loading && headline && (
            <div className="replay__headline">
              <div className="replay__pair">
                <span className="replay__pair-primary">
                  {headline.primary_name ?? pair?.primaryName ?? 'ENVISAT'}
                </span>
                <span className="replay__pair-arrow" aria-hidden="true">↔</span>
                <span className="replay__pair-secondary">
                  {headline.secondary_name ?? pair?.secondaryName ?? 'ZENITH-2 DEBRIS'}
                </span>
              </div>
              <RiskBadge level={headline.threat_level} />

              {/* Pc as a readout, not a gauge: a linear gauge would draw a
                  real 6.6e-4 as visually empty. The badge carries severity. */}
              <div className="replay__pc">
                <span className="ui-label">Collision probability</span>
                <span className="replay__pc-value ui-readout">{formatPc(headline.pc)}</span>
                <span className="replay__pc-note">
                  ESA&rsquo;s acceptance level at the time was{' '}
                  {PC_ACCEPTED_LEVEL.toExponential(0)}.
                </span>
              </div>

              <dl className="replay__rows">
                <div className="replay__row">
                  <dt className="replay__key">Miss distance</dt>
                  <dd className="replay__val ui-readout">
                    {formatMissDistance(headline.miss_distance_m)}
                  </dd>
                </div>
                <div className="replay__row">
                  <dt className="replay__key">Relative speed</dt>
                  <dd className="replay__val ui-readout">
                    {formatRelativeSpeed(headline.relative_speed_km_s)}
                  </dd>
                </div>
                <div className="replay__row">
                  <dt className="replay__key">TCA — computed</dt>
                  <dd className="replay__val ui-readout" title={tca.raw}>
                    {tca.date} {tca.time}
                  </dd>
                </div>
                <div className="replay__row">
                  <dt className="replay__key">TCA — published</dt>
                  <dd className="replay__val ui-readout" title={published.raw}>
                    {published.date} {published.time}
                  </dd>
                </div>
              </dl>

              <p className="replay__source">
                SGP4 propagation, refined TCA, 2D encounter-plane Pc — computed
                by the physics pipeline. No AI is involved in any number on this
                page.
              </p>
            </div>
          )}
        </GlassPanel>

        <GlassPanel title="AI explanation" className="replay__card">
          <PendingRegion
            region="AI advisor"
            awaiting="Plain-language explanation of these figures arrives with the AI step. It will narrate the numbers above and compute none of them."
          />
        </GlassPanel>
      </div>

      {/* --- Bottom: the four predictions ------------------------------------ */}
      <div className="replay__strip">
        <GlassPanel
          title="Four consecutive predictions, re-run through this pipeline"
          className="replay__card"
        >
          <PredictionTable days={days} loading={loading} />
        </GlassPanel>
      </div>
    </div>
  )
}

export default Replay
