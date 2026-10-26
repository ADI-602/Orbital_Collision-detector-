import ErrorState from '../common/ErrorState.jsx'
import LoadingState from '../common/LoadingState.jsx'
import MoreDetails from '../common/MoreDetails.jsx'
import Term from '../common/Term.jsx'
import { formatPc } from '../../lib/conjunctions.js'
import {
  formatDeltaV,
  formatEncounterDistance,
  hasEncounterGeometry,
  niceScaleBarM,
  projectEncounter,
} from '../../lib/maneuver.js'
import { DELTA_V_PRESETS_CM_S, LEAD_TIME_MINUTES } from '../../hooks/useManeuver.js'
import './ManeuverPanel.css'

/**
 * The avoidance burn, and the encounter it changes.
 *
 * WHY THIS IS DRAWN HERE AND NOT ON THE GLOBE
 *
 * Measured on the real October 2004 manoeuvre: the burn separates the flown
 * and unflown trajectories by 389 m at closest approach, across an arc 29,425
 * km long — about 1:55,000. On the globe those two tracks are the same line by
 * a wide margin. The globe still draws them, because it shows where the burn
 * happens relative to the encounter, but the burn's EFFECT is only visible at
 * encounter scale, so that is drawn to scale here with a scale bar beside it.
 *
 * The diagram is a projection of the three positions into their own plane,
 * which is an isometry: every distance drawn is the true distance, with no
 * foreshortening and nothing scaled up to look more dramatic
 * (lib/maneuver.js, with a unit test). What it is NOT is a measurement — the
 * labelled numbers come from the pipeline's own scalars, never from the
 * drawing.
 *
 * @param {object} props
 * @param {object|null} props.event      selected conjunction
 * @param {object} props.maneuver        useManeuver() state
 */
function ManeuverPanel({ event, maneuver }) {
  const {
    status,
    result,
    error,
    deltaVCmS,
    refusal,
    canSimulate,
    simulate,
    comparison,
    compareAll,
    showComparedBurn,
  } = maneuver
  const comparing = comparison?.status === 'running'

  if (!event) {
    return (
      <div className="maneuver maneuver--empty">
        <span className="maneuver__empty-title">No conjunction selected</span>
        <span className="maneuver__empty-hint">
          Pick an event to simulate an avoidance burn against it.
        </span>
      </div>
    )
  }

  if (refusal) {
    return (
      <div className="maneuver maneuver--empty">
        <span className="maneuver__empty-title">No burn to plan</span>
        <span className="maneuver__empty-hint">{refusal}</span>
      </div>
    )
  }

  return (
    <div className="maneuver">
      <div className="maneuver__controls">
        <span className="ui-label"><Term id="alongTrackDv">Along-track ΔV</Term></span>
        <div className="maneuver__presets">
          {DELTA_V_PRESETS_CM_S.map((dv) => (
            <button
              key={dv}
              type="button"
              className={`maneuver__preset${dv === deltaVCmS ? ' is-active' : ''}`}
              onClick={() => simulate(dv)}
              disabled={!canSimulate || status === 'running' || comparing}
              // -4.0 cm/s is not an arbitrary default; it is what was flown.
              title={dv === -4 ? 'The burn ESA flew on 22 October 2004' : undefined}
            >
              {formatDeltaV(dv)}
            </button>
          ))}
        </div>
        <span className="maneuver__lead">
          {LEAD_TIME_MINUTES} min before TCA
        </span>
        <button
          type="button"
          className="maneuver__compare"
          onClick={compareAll}
          disabled={!canSimulate || status === 'running' || comparing}
          title="Simulate all three burns through the physics endpoint and compare them"
        >
          Compare all three
        </button>
      </div>

      {comparing && <LoadingState label="SIMULATING THREE BURNS" />}

      {comparison?.status === 'ready' && (
        <BurnComparison
          rows={comparison.rows}
          selectedDeltaV={status === 'ready' ? deltaVCmS : null}
          onShow={showComparedBurn}
        />
      )}

      {!canSimulate && (
        <p className="maneuver__note">
          The element sets for this pair are not available to the console, so a
          burn cannot be simulated against the same inputs the screening used.
        </p>
      )}

      {status === 'idle' && canSimulate && (
        <p className="maneuver__note">
          Pick a ΔV to re-fly this conjunction through{' '}
          <code>/api/physics/maneuver</code>. Nothing is simulated until you ask.
        </p>
      )}

      {status === 'running' && <LoadingState label="SIMULATING BURN" />}

      {status === 'error' && (
        <ErrorState
          title="Maneuver simulation failed"
          detail={error?.detail ?? error?.message ?? 'unknown error'}
          hint="The conjunction figures above are unaffected — they came from a separate screening pass."
          onRetry={() => simulate(deltaVCmS)}
        />
      )}

      {status === 'ready' && result && (
        // With a comparison on screen its table already carries these
        // figures, so only the drawing for the selected burn is added.
        <ManeuverResult result={result} figures={comparison?.status !== 'ready'} />
      )}
    </div>
  )
}

/**
 * The outcome: what the burn costs, what it buys, and the encounter drawn to
 * scale.
 */
/**
 * Every preset burn side by side, each row straight from its own
 * /api/physics/maneuver response. Clicking a row draws that burn's encounter.
 */
function BurnComparison({ rows, selectedDeltaV, onShow }) {
  const baseline = rows.find((row) => row.result)?.result
  return (
    <div className="maneuver__compare-table">
      {baseline && (
        <p className="maneuver__baseline">
          Without a burn:{' '}
          <span className="ui-readout">
            {formatEncounterDistance(baseline.pre_burn_miss_distance_m)} ·{' '}
            {formatPc(baseline.pre_burn_pc)}
          </span>
        </p>
      )}
      {/* Units live in the header so every cell fits on one line. */}
      <div className="maneuver__compare-head" aria-hidden="true">
        <span>ΔV cm/s</span>
        <span>Miss</span>
        <span>Pc</span>
        <span>Risk ↓</span>
        <span>Fuel kg</span>
      </div>
      {rows.map((row) =>
        row.result ? (
          <button
            key={row.deltaV}
            type="button"
            className={`maneuver__compare-row${row.deltaV === selectedDeltaV ? ' is-selected' : ''}`}
            aria-pressed={row.deltaV === selectedDeltaV}
            onClick={() => onShow(row.deltaV)}
            title="Draw this burn's encounter"
            aria-label={`${formatDeltaV(row.deltaV)} burn`}
          >
            <span className="ui-readout">{row.deltaV.toFixed(1)}</span>
            <span className="ui-readout">
              {formatEncounterDistance(row.result.post_burn_miss_distance_m)}
            </span>
            <span className="ui-readout">{formatPc(row.result.post_burn_pc)}</span>
            <span className="ui-readout">
              {Number.isFinite(row.result.risk_reduction_pct)
                ? `${row.result.risk_reduction_pct.toFixed(1)}%`
                : '—'}
            </span>
            <span className="ui-readout">
              {Number.isFinite(row.result.fuel_consumed_kg)
                ? row.result.fuel_consumed_kg.toFixed(3)
                : '—'}
            </span>
          </button>
        ) : (
          <div key={row.deltaV} className="maneuver__compare-row is-failed">
            <span className="ui-readout">{formatDeltaV(row.deltaV)}</span>
            <span className="maneuver__compare-error">
              Failed: {row.error?.detail ?? row.error?.message ?? 'unknown error'}
            </span>
          </div>
        ),
      )}
    </div>
  )
}

function ManeuverResult({ result, figures = true }) {
  const tracks = result.tracks
  const layout = hasEncounterGeometry(tracks)
    ? projectEncounter(
      tracks.tca_pre_burn_pos_ecef_km,
      tracks.tca_post_burn_pos_ecef_km,
      tracks.tca_secondary_pos_ecef_km,
    )
    : null

  return (
    <div className="maneuver__result">
      {/* Figures first: they are the result. The diagram shows them. */}
      {figures && (
        <dl className="maneuver__rows">
          <div className="maneuver__row">
            <dt className="maneuver__key"><Term id="missDistance">Miss distance</Term></dt>
            <dd className="maneuver__val ui-readout">
              {formatEncounterDistance(result.pre_burn_miss_distance_m)}
              <span className="maneuver__arrow" aria-hidden="true"> → </span>
              <span className="maneuver__val-after">
                {formatEncounterDistance(result.post_burn_miss_distance_m)}
              </span>
            </dd>
          </div>
          <div className="maneuver__row">
            <dt className="maneuver__key"><Term id="pc">Collision probability</Term></dt>
            <dd className="maneuver__val ui-readout">
              {formatPc(result.pre_burn_pc)}
              <span className="maneuver__arrow" aria-hidden="true"> → </span>
              <span className="maneuver__val-after">{formatPc(result.post_burn_pc)}</span>
            </dd>
          </div>
          <div className="maneuver__row">
            <dt className="maneuver__key">Risk reduction</dt>
            <dd className="maneuver__val ui-readout">
              {Number.isFinite(result.risk_reduction_pct)
                ? `${result.risk_reduction_pct.toFixed(1)}%`
                : '—'}
            </dd>
          </div>
          <div className="maneuver__row">
            <dt className="maneuver__key">Propellant</dt>
            <dd className="maneuver__val ui-readout">
              {Number.isFinite(result.fuel_consumed_kg)
                ? `${result.fuel_consumed_kg.toFixed(3)} kg`
                : '—'}
            </dd>
          </div>
        </dl>
      )}

      {layout ? (
        <EncounterDiagram
          layout={layout}
          preMissM={result.pre_burn_miss_distance_m}
          postMissM={result.post_burn_miss_distance_m}
        />
      ) : (
        <p className="maneuver__note">
          The endpoint returned the burn figures without encounter geometry, so
          the numbers above stand on their own — nothing is drawn rather than a
          diagram being guessed at.
        </p>
      )}

      {tracks?.truncated && tracks?.note && (
        <p className="maneuver__note maneuver__note--warn">{tracks.note}</p>
      )}

      <MoreDetails summary="How the burn is modelled">
        <p>
          Impulsive along-track burn, Clohessy-Wiltshire displacement, Pc
          recomputed by the same 2D encounter-plane method — all from{' '}
          <code>/api/physics/maneuver</code>.
        </p>
        <p>
          The diagram is the pipeline&rsquo;s own positions at closest approach,
          projected into their plane, so it is to scale. The distances above are
          its numbers, not measurements off the picture.
        </p>
      </MoreDetails>
    </div>
  )
}

/**
 * The encounter, to scale.
 *
 * Drawn in an SVG whose viewBox is the real extent in metres, so the geometry
 * is the geometry — no fitting, no exaggeration of the shift. The scale bar is
 * what makes that claim checkable by eye.
 */
function EncounterDiagram({ layout, preMissM, postMissM }) {
  const PAD = 0.22
  const span = Math.max(layout.spanM, 1) * (1 + PAD * 2)

  // Centre the three points in a square viewBox.
  const cx = (layout.preBurn.x + layout.postBurn.x + layout.secondary.x) / 3
  const cy = (layout.preBurn.y + layout.postBurn.y + layout.secondary.y) / 3
  const minX = cx - span / 2
  const minY = cy - span / 2

  // SVG y grows downward; flip so the layout reads the way it was computed.
  const px = (p) => ({ x: p.x, y: 2 * cy - p.y })

  const pre = px(layout.preBurn)
  const post = px(layout.postBurn)
  const secondary = px(layout.secondary)

  const barM = niceScaleBarM(layout.spanM)
  const dot = span * 0.018
  const stroke = span * 0.006

  return (
    <figure className="maneuver__diagram">
      <svg
        viewBox={`${minX} ${minY} ${span} ${span}`}
        className="maneuver__svg"
        role="img"
        aria-label={
          `Encounter at closest approach, drawn to scale: ` +
          `${formatEncounterDistance(preMissM)} without the burn, ` +
          `${formatEncounterDistance(postMissM)} with it.`
        }
      >
        {/* Miss vectors. The one that gets longer is the point of the burn. */}
        <line
          x1={secondary.x} y1={secondary.y} x2={pre.x} y2={pre.y}
          className="maneuver__miss maneuver__miss--pre" strokeWidth={stroke}
        />
        <line
          x1={secondary.x} y1={secondary.y} x2={post.x} y2={post.y}
          className="maneuver__miss maneuver__miss--post" strokeWidth={stroke}
        />
        {/* Where the burn moved the primary to. */}
        <line
          x1={pre.x} y1={pre.y} x2={post.x} y2={post.y}
          className="maneuver__shift" strokeWidth={stroke}
          strokeDasharray={`${dot} ${dot}`}
        />

        <circle cx={secondary.x} cy={secondary.y} r={dot} className="maneuver__dot maneuver__dot--secondary" />
        <circle cx={pre.x} cy={pre.y} r={dot} className="maneuver__dot maneuver__dot--pre" />
        <circle cx={post.x} cy={post.y} r={dot} className="maneuver__dot maneuver__dot--post" />

        {/* Scale bar, labelled where it is drawn. A bar whose length is
            named somewhere else is not a scale a viewer can actually use, and
            this diagram's whole claim is that it is drawn to scale. */}
        <line
          x1={minX + span * 0.08} y1={minY + span * 0.9}
          x2={minX + span * 0.08 + barM} y2={minY + span * 0.9}
          className="maneuver__scalebar" strokeWidth={stroke}
        />
        <text
          x={minX + span * 0.08} y={minY + span * 0.9 + span * 0.075}
          className="maneuver__scalebar-label" fontSize={span * 0.06}
        >
          {formatEncounterDistance(barM)}
        </text>
      </svg>

      <figcaption className="maneuver__legend">
        <span className="maneuver__legend-item">
          <i className="maneuver__swatch maneuver__swatch--secondary" aria-hidden="true" />
          Debris
        </span>
        <span className="maneuver__legend-item">
          <i className="maneuver__swatch maneuver__swatch--pre" aria-hidden="true" />
          No burn · {formatEncounterDistance(preMissM)}
        </span>
        <span className="maneuver__legend-item">
          <i className="maneuver__swatch maneuver__swatch--post" aria-hidden="true" />
          After burn · {formatEncounterDistance(postMissM)}
        </span>
      </figcaption>
    </figure>
  )
}

export default ManeuverPanel
