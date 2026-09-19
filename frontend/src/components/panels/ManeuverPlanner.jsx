import { useMemo, useState } from 'react'

import ErrorState from '../common/ErrorState.jsx'
import LoadingState from '../common/LoadingState.jsx'
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js'
import { isResultStale } from '../../lib/burn.js'
import { useManeuverSim } from '../../hooks/useManeuverSim.js'
import {
  formatDeltaV,
  formatKg,
  formatMetres,
  formatPc,
  formatPercent,
} from '../../lib/format.js'
import './ManeuverPlanner.css'

/**
 * ManeuverPlanner — drag a burn, watch the risk move.
 *
 * Every number here comes from /api/physics/maneuver. The sliders change the
 * request; nothing is interpolated, predicted, or smoothed between responses.
 *
 * ================== THE RULE THIS COMPONENT EXISTS TO KEEP ==================
 * Numbers on screen are ALWAYS labelled with the burn they were computed for.
 * While a new burn is in flight the previous result stays visible but is
 * explicitly marked as belonging to the old parameters, because the failure
 * mode of a live control like this is subtle and total: the slider reads
 * -6.0 cm/s, the readout still shows the -4.0 cm/s answer, and nothing on
 * screen says so. Staleness is detected from the response itself — the
 * endpoint echoes back delta_v_cm_s and lead_time_minutes — rather than from
 * a flag this component maintains, so the two cannot drift apart.
 * ===========================================================================
 *
 * TWO VERDICTS, NOT ONE. "Reduces risk" and "resolves the conjunction" are
 * reported separately, because they genuinely differ: the -4.0 cm/s burn ESA
 * flew for the Envisat conjunction reduced Pc substantially and still left it
 * above the accepted level of the day.
 *
 * @param {object} props
 * @param {null | {primary: object, secondary: object, tca_utc_iso: string}} props.target
 * @param {number} [props.satMassKg]
 * @param {string} [props.idleHint]
 */
function ManeuverPlanner({ target, satMassKg = 8200.0, idleHint }) {
  // The burn ESA actually flew, as the starting point.
  const [deltaV, setDeltaV] = useState(-4.0)
  const [leadMinutes, setLeadMinutes] = useState(50)

  const settledDeltaV = useDebouncedValue(deltaV, 250)
  const settledLead = useDebouncedValue(leadMinutes, 250)

  const request = useMemo(() => {
    if (!target) return null
    return {
      primary: target.primary,
      secondary: target.secondary,
      tca_utc_iso: target.tca_utc_iso,
      delta_v_cm_s: settledDeltaV,
      lead_time_minutes: settledLead,
      sat_mass_kg: satMassKg,
    }
  }, [target, settledDeltaV, settledLead, satMassKg])

  const { status, result, error, refresh } = useManeuverSim(request)

  // Does the displayed result belong to where the sliders are now? The rule
  // lives in lib/burn.js and is tested there — it is the one thing in this
  // component whose failure is invisible on screen.
  const stale = isResultStale(result, deltaV, leadMinutes)

  const controls = (
    <div className="burn__controls">
      <label className="burn__control">
        <span className="burn__control-head">
          <span className="ui-label">Along-track ΔV</span>
          <span className="burn__value ui-readout">{formatDeltaV(deltaV)}</span>
        </span>
        <input
          type="range"
          min={-20}
          max={20}
          step={0.5}
          value={deltaV}
          onChange={(e) => setDeltaV(Number(e.target.value))}
          aria-label="Along-track delta-V in centimetres per second"
        />
        <span className="burn__hint">
          Negative is retrograde (braking); positive is prograde.
        </span>
      </label>

      <label className="burn__control">
        <span className="burn__control-head">
          <span className="ui-label">Lead time</span>
          <span className="burn__value ui-readout">{leadMinutes} min</span>
        </span>
        <input
          type="range"
          min={5}
          max={180}
          step={5}
          value={leadMinutes}
          onChange={(e) => setLeadMinutes(Number(e.target.value))}
          aria-label="Burn lead time before closest approach, in minutes"
        />
        <span className="burn__hint">How long before TCA the burn is applied.</span>
      </label>
    </div>
  )

  if (!target) {
    return (
      <div className="burn">
        {controls}
        <p className="burn__note">
          {idleHint ?? 'Select a conjunction to simulate a burn against it.'}
        </p>
      </div>
    )
  }

  return (
    <div className="burn">
      {controls}

      {status === 'error' && (
        <ErrorState
          title="Maneuver simulation failed"
          detail={error?.detail ?? error?.message}
          onRetry={refresh}
        />
      )}

      {status === 'empty' && (
        <p className="burn__note">
          The endpoint found no close approach to act on for this pair.
        </p>
      )}

      {status === 'running' && !result && <LoadingState label="Simulating burn" />}

      {result && (
        <div className={`burn__result ${stale ? 'is-stale' : ''}`}>
          {/*
            The whole point of the staleness banner: these numbers are for the
            burn named here, which is not the burn the sliders currently show.
          */}
          {stale && (
            <p className="burn__stale" role="status">
              Showing {formatDeltaV(result.delta_v_cm_s)} at{' '}
              {result.lead_time_minutes} min — recomputing for{' '}
              {formatDeltaV(deltaV)} at {leadMinutes} min…
            </p>
          )}

          <div className="burn__rows">
            <div className="burn__row">
              <span className="burn__key">Collision probability</span>
              <span className="burn__val ui-readout">
                {formatPc(result.pre_burn_pc)} → {formatPc(result.post_burn_pc)}
              </span>
            </div>
            <div className="burn__row">
              <span className="burn__key">Risk reduction</span>
              <span className="burn__val ui-readout">
                {formatPercent(result.risk_reduction_pct)}
              </span>
            </div>
            <div className="burn__row">
              <span className="burn__key">Separation at TCA</span>
              <span className="burn__val ui-readout">
                {formatMetres(result.pre_burn_miss_distance_m)} →{' '}
                {formatMetres(result.post_burn_miss_distance_m)}
              </span>
            </div>
            <div className="burn__row">
              <span className="burn__key">Propellant</span>
              <span className="burn__val ui-readout">{formatKg(result.fuel_consumed_kg)}</span>
            </div>
          </div>

          {/*
            Two verdicts. Collapsing them would either condemn the burn ESA
            actually flew or bless a token nudge that leaves the risk standing.
          */}
          <div className="burn__verdicts">
            <span
              className={`burn__verdict burn__verdict--${
                result.maneuver_recommended ? 'good' : 'bad'
              }`}
            >
              {result.maneuver_recommended ? '✓' : '✕'}{' '}
              {result.maneuver_recommended ? 'Reduces risk' : 'Does not reduce risk'}
            </span>
            <span
              className={`burn__verdict burn__verdict--${
                result.post_burn_below_threshold ? 'good' : 'watch'
              }`}
            >
              {result.post_burn_below_threshold ? '✓' : '!'}{' '}
              {result.post_burn_below_threshold
                ? `Below the ${formatPc(result.risk_threshold_pc, 0)} threshold`
                : `Still above the ${formatPc(result.risk_threshold_pc, 0)} threshold`}
            </span>
          </div>

          <p className="burn__note">
            Separation is measured at the original time of closest approach under a
            Clohessy-Wiltshire displacement — shifting along the relative-velocity
            direction increases it without reducing risk, which is why it can rise
            while Pc does too. Pc is the quantity to decide on. Instantaneous ΔV
            only: no burn duration, attitude or thruster dynamics are modelled.
          </p>
        </div>
      )}
    </div>
  )
}

export default ManeuverPlanner
