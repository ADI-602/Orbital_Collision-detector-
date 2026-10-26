import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { API_BASE_URL } from '../api/client.js'
import ErrorState from '../components/common/ErrorState.jsx'
import FloatingPanel from '../components/common/FloatingPanel.jsx'
import LoadingState from '../components/common/LoadingState.jsx'
import MoreDetails from '../components/common/MoreDetails.jsx'
import RiskBadge from '../components/common/RiskBadge.jsx'
import Term from '../components/common/Term.jsx'
import TMinus from '../components/common/TMinus.jsx'
import CesiumGlobe from '../components/globe/CesiumGlobe.jsx'
import AdvisorPanel from '../components/panels/AdvisorPanel.jsx'
import ManeuverPanel from '../components/panels/ManeuverPanel.jsx'
import PredictionTable from '../components/panels/PredictionTable.jsx'
import ReplayScrubber from '../components/panels/ReplayScrubber.jsx'
import StatusHeader from '../components/panels/StatusHeader.jsx'
import { useEnvisatReplay } from '../hooks/useEnvisatReplay.js'
import { useAiAdvice } from '../hooks/useAiAdvice.js'
import { useHealth } from '../hooks/useHealth.js'
import { useManeuver } from '../hooks/useManeuver.js'
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
  replayElapsedFor,
  replaySimTime,
} from '../lib/replay.js'
import { formatSimClock } from '../lib/simClock.js'
import '../styles/globePage.css'
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

  // The avoidance burn ESA actually flew, re-run through the pipeline. This
  // view is the right home for it: the globe here runs a 2004 clock, so the
  // returned trajectories can be drawn against the objects they belong to.
  const maneuver = useManeuver(headline, null)

  // The advisor explains the headline figures, plus the burn once it has been
  // simulated. It is asked on demand and computes nothing.
  const ai = useAiAdvice(
    headline,
    headline?.primary_name ?? pair?.primaryName ?? 'ENVISAT',
    maneuver.burnsForAdvice,
  )

  // Once a burn has been simulated, ask the advisor about it straight away.
  // Still the operator's action — it follows their click on a ΔV — but the
  // ~20 s model latency now runs while the presenter is talking through the
  // burn instead of after a second click. Once per distinct burn result.
  const { ask: askAdvisor } = ai
  const askedForBurnRef = useRef(null)
  useEffect(() => {
    const result = maneuver.result
    if (!result || askedForBurnRef.current === result) return
    askedForBurnRef.current = result
    askAdvisor()
  }, [maneuver.result, askAdvisor])

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

  // Put the replay clock on an exact 2004 instant (scrubber, B/T/arrow keys).
  // Moves the clock only; every figure on the page is unaffected.
  const seek = useCallback(
    (targetSimMs) => {
      if (!Number.isFinite(tcaMs)) return
      playedMsRef.current = replayElapsedFor(tcaMs, targetSimMs)
    },
    [tcaMs],
  )
  const seekBy = useCallback(
    (deltaMs) => {
      if (!Number.isFinite(tcaMs)) return
      seek(replaySimTime(tcaMs, playedMsRef.current).getTime() + deltaMs)
    },
    [tcaMs, seek],
  )

  // Presenter shortcuts. Ignored while typing in a field, with a modifier
  // held, or on a focused button (where Space and Enter already mean "press").
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      if (tag === 'BUTTON' && (event.key === ' ' || event.key === 'Enter')) return
      const burnMs = tcaMs - HISTORICAL_MANEUVER.leadTimeMinutes * 60_000
      switch (event.key) {
        case ' ':
          setPaused((p) => !p)
          break
        case 'r':
        case 'R':
          restart()
          break
        case 'ArrowLeft':
          seekBy(-60_000)
          break
        case 'ArrowRight':
          seekBy(60_000)
          break
        case 'b':
        case 'B':
          seek(burnMs)
          break
        case 't':
        case 'T':
          seek(tcaMs)
          break
        default:
          return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tcaMs, restart, seek, seekBy])

  const handleTelemetry = useCallback((next) => setTelemetry(next), [])
  const {
    propagateAll: propagateReplay,
    primaryId: replayPrimaryId,
    objectCount: replayObjectCount,
  } = replay

  // Point the camera at where the two objects meet. Taken from the same
  // in-browser propagation that places the markers, at the TCA instant — a
  // camera position, never a figure.
  const encounterView = useMemo(() => {
    // propagateAll is stable and returns nothing until the element sets load,
    // so the object count is what re-runs this once they have.
    if (!Number.isFinite(tcaMs) || !replayObjectCount) return null
    const at = propagateReplay(new Date(tcaMs))
    const primary = at.find((s) => s.id === replayPrimaryId)
    if (!primary) return null
    return { longitude_deg: primary.longitude_deg, latitude_deg: primary.latitude_deg }
  }, [tcaMs, propagateReplay, replayPrimaryId, replayObjectCount])

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

  // Context only. At orbit scale the flown and unflown arcs are the same line —
  // a few hundred metres across tens of thousands of kilometres — which is why
  // the panel draws the encounter to scale instead.
  const maneuverOverlay = maneuver.result?.tracks
    ? { tracks: maneuver.result.tracks, colorHex: riskColorHex(headline) }
    : null

  return (
    <div className="globe-page replay">
      {/* The globe is the page. Everything else floats over it. */}
      <div className="globe-page__globe">
        <CesiumGlobe
          propagateAll={replay.propagateAll}
          satelliteCount={replay.objectCount}
          onTelemetry={handleTelemetry}
          highlightPair={highlightPair}
          orbitTrackFor={replay.orbitTrackFor}
          maneuverOverlay={maneuverOverlay}
          simTimeFor={simTimeFor}
          clockKey={tcaMs}
          telemetryIntervalMs={100}
          initialView={encounterView}
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

        <div className="globe-page__field">
          {/* --- Centre: countdown and clock, over the globe ----------- */}
          <div className="globe-page__center">
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


            <div className="replay__clockbar">
              <div className="globe-page__hud replay__hud">
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
            </div>

            <ReplayScrubber
              tcaMs={tcaMs}
              simMs={simMs}
              onSeek={seek}
              tcaColorHex={headline ? riskColorHex(headline) : undefined}
            />
          </div>

          {/* --- Left rail: what this is ------------------------------- */}
          <div className="globe-page__rail globe-page__rail--left">
            <FloatingPanel
              id="replay.case"
              title="Validation case"
              resize={['e', 's']}
              className="globe-page__float"
            >
              <div className="replay__case">
                <span className="replay__case-name">
                  {replay.eventName ?? 'Envisat vs. Zenith-2 Debris (October 2004)'}
                </span>
                <p className="replay__case-body">
                  A real 2004 close approach that ESA published, re-run through
                  the same pipeline as the live console.
                </p>
                <p className="replay__case-source">Source: {PUBLISHED_SOURCE}</p>
                <MoreDetails summary="About this case">
                  <p>
                    On 22 October 2004 ESA predicted a close approach between
                    Envisat and a fragment of a Russian Zenith-2 upper stage
                    (92-093EE), and flew an avoidance maneuver.
                  </p>
                  <p>
                    The archived element sets go to the same{' '}
                    <code>/api/physics/screening</code> endpoint the live console
                    calls. Nothing about this case is special-cased in the pipeline.
                  </p>
                  <p>
                    Search window: {REPLAY_SCREEN_WINDOW_HOURS} h from 2004-10-22
                    00:00Z. Propagator: SGP4.
                  </p>
                </MoreDetails>
              </div>
            </FloatingPanel>

            <FloatingPanel
              id="replay.esa"
              title="What ESA did"
              resize={['e', 's']}
              className="globe-page__float globe-page__float--fill"
            >
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
                  Above: history, from the paper. Below: this pipeline re-flying
                  that burn.
                </p>
                <ManeuverPanel event={headline} maneuver={maneuver} />
              </div>
            </FloatingPanel>
          </div>

          {/* --- Right rail: the numbers ------------------------------- */}
          <div className="globe-page__rail globe-page__rail--right">
            <FloatingPanel
              id="replay.tca"
              title="Closest approach — 22 Oct prediction"
              resize={['w', 's']}
              className="globe-page__float"
            >
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
                    <span className="ui-label"><Term id="pc">Collision probability</Term></span>
                    <span className="replay__pc-value ui-readout">{formatPc(headline.pc)}</span>
                    <span className="replay__pc-note">
                      ESA&rsquo;s acceptance level at the time was{' '}
                      {PC_ACCEPTED_LEVEL.toExponential(0)}.
                    </span>
                  </div>

                  <dl className="replay__rows">
                    <div className="replay__row">
                      <dt className="replay__key"><Term id="missDistance">Miss distance</Term></dt>
                      <dd className="replay__val ui-readout">
                        {formatMissDistance(headline.miss_distance_m)}
                      </dd>
                    </div>
                    {Number.isFinite(headline.hard_body_radius_m) && (
                      <div className="replay__row">
                        <dt className="replay__key">
                          <Term id="hardBodyRadius">Hard-body radius</Term>
                        </dt>
                        <dd className="replay__val ui-readout">
                          {headline.hard_body_radius_m.toFixed(1)} m
                        </dd>
                      </div>
                    )}
                    <div className="replay__row">
                      <dt className="replay__key"><Term id="relativeSpeed">Relative speed</Term></dt>
                      <dd className="replay__val ui-readout">
                        {formatRelativeSpeed(headline.relative_speed_km_s)}
                      </dd>
                    </div>
                    <div className="replay__row">
                      <dt className="replay__key"><Term id="tca">TCA</Term> — computed</dt>
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
                    Computed by the physics pipeline: SGP4, refined TCA, 2D
                    encounter-plane Pc. No AI in any number on this page.
                  </p>
                </div>
              )}
            </FloatingPanel>

            <FloatingPanel
              id="replay.ai"
              title="AI explanation"
              resize={['w', 's']}
              className="globe-page__float globe-page__float--fill"
            >
              <AdvisorPanel event={headline} ai={ai} />
            </FloatingPanel>
          </div>

          {/* --- Bottom: the four predictions -------------------------- */}
          <div className="globe-page__strip">
            <FloatingPanel
              id="replay.predictions"
              title="Four consecutive predictions, re-run through this pipeline"
              resize={['n']}
              minHeight={90}
              className="globe-page__float globe-page__float--strip"
            >
              <PredictionTable days={days} loading={loading} />
            </FloatingPanel>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Replay
