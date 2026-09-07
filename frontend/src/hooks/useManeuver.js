import { useCallback, useEffect, useRef, useState } from 'react'

import { CanceledError } from '../api/client.js'
import { simulateManeuver } from '../api/physics.js'
import { EVENT_ORIGIN, isNotARisk } from '../lib/conjunctions.js'

/**
 * useManeuver — re-fly a selected conjunction with an avoidance burn.
 *
 * Everything this returns came back from POST /api/physics/maneuver: the
 * miss distances, the probabilities, the fuel, and the sampled trajectories.
 * The hook chooses the burn parameters and nothing else. In particular it does
 * NOT derive a post-burn orbit — CLAUDE.md §5.2 requires that to come from the
 * backend as a sampled ephemeris, because reconstructing a maneuvered
 * trajectory in JavaScript would be orbital mechanics outside the validated
 * pipeline, and two lines computed by two different codebases would not be
 * comparable to each other.
 *
 * ON EXPLICIT ACTION, NOT ON SELECTION. Simulating a burn is a decision, and a
 * console that quietly plans one for every row a user clicks is both wasteful
 * and misleading. The result is also discarded whenever the selected event
 * changes, so a burn can never be displayed against the wrong conjunction.
 *
 * NOT EVERY EVENT CAN BE FLOWN. A pair the pipeline declined to assess, or one
 * flying in formation, has no encounter to avoid — asking for a burn there
 * would produce a number with nothing behind it. Those cases are refused here
 * with a reason, rather than being sent to the endpoint to fail.
 */

/**
 * Burns offered in the UI, in cm/s. Negative brakes, which is what an
 * avoidance manoeuvre normally does: slowing down drops the orbit slightly and
 * gives away along-track position.
 *
 * -4.0 is the burn ESA actually flew on Envisat on 22 October 2004, so the
 * middle option reproduces history rather than inventing a scenario.
 */
export const DELTA_V_PRESETS_CM_S = [-2.0, -4.0, -8.0]

/** The historical lead time, held fixed so the ΔV comparison is like-for-like. */
export const LEAD_TIME_MINUTES = 50.0

/** Envisat's wet mass. Only the fuel figure depends on it. */
export const SAT_MASS_KG = 8200.0

/**
 * Why this event cannot be flown, or null if it can.
 * @param {object|null} event
 * @returns {string|null}
 */
export function maneuverRefusal(event) {
  if (!event) return null
  if (isNotARisk(event)) {
    return (
      'This pair has no encounter to avoid — the pipeline either declined to ' +
      'assess it or it is a co-orbital pair flying together. Simulating a burn ' +
      'against it would produce numbers with nothing behind them.'
    )
  }
  if (!event.tca_utc_iso) {
    return 'No time of closest approach was computed for this pair, so there is nothing to burn away from.'
  }
  return null
}

/**
 * Find the element sets for both objects in an event.
 *
 * Two sources, because events arrive two ways: a live detection names objects
 * in the server's tracked set, while the injected 2004 case carries the
 * archived element sets it was screened from.
 *
 * @param {object} event
 * @param {(id: string) => {name: string, line1: string, line2: string}|null} tleFor
 * @returns {{primary: object, secondary: object}|null}
 */
export function elementSetsFor(event, tleFor) {
  if (event?.origin === EVENT_ORIGIN.VALIDATION) {
    const pair = event.tle_pair
    return pair?.primary && pair?.secondary
      ? { primary: pair.primary, secondary: pair.secondary }
      : null
  }

  const primary = tleFor?.(event?.primary_id)
  const secondary = tleFor?.(event?.secondary_id)
  return primary && secondary ? { primary, secondary } : null
}

/**
 * @param {object|null} event selected conjunction
 * @param {(id: string) => object|null} tleFor from useLiveSatellites
 * @returns {{
 *   status: 'idle' | 'running' | 'ready' | 'error',
 *   result: object | null,
 *   error: Error | null,
 *   deltaVCmS: number,
 *   refusal: string | null,
 *   canSimulate: boolean,
 *   simulate: (deltaVCmS?: number) => void,
 *   reset: () => void
 * }}
 */
export function useManeuver(event, tleFor) {
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [deltaVCmS, setDeltaVCmS] = useState(-4.0)

  const controllerRef = useRef(null)
  const tleForRef = useRef(tleFor)
  tleForRef.current = tleFor

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setStatus('idle')
    setResult(null)
    setError(null)
  }, [])

  // A burn belongs to one conjunction. When the selection moves, the old
  // result must go with it rather than sitting under a different pair's name.
  const eventIdentity = event ? `${event.origin}:${event.primary_name}:${event.secondary_name}:${event.tca_utc_iso}` : null
  useEffect(() => {
    reset()
    setDeltaVCmS(-4.0)
  }, [eventIdentity, reset])

  useEffect(() => () => controllerRef.current?.abort(), [])

  const refusal = maneuverRefusal(event)
  const elementSets = event && !refusal ? elementSetsFor(event, tleFor) : null
  const canSimulate = Boolean(event) && !refusal && Boolean(elementSets)

  const simulate = useCallback((requestedDeltaV) => {
    const target = event
    if (!target) return

    const sets = elementSetsFor(target, tleForRef.current)
    if (!sets) {
      setStatus('error')
      setError(new Error(
        'The element sets for this pair are not available to the console, so the ' +
        'burn cannot be simulated against the same inputs the screening used.',
      ))
      return
    }

    const deltaV = typeof requestedDeltaV === 'number' ? requestedDeltaV : deltaVCmS
    setDeltaVCmS(deltaV)

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    setStatus('running')
    setError(null)

    simulateManeuver(
      {
        primary: sets.primary,
        secondary: sets.secondary,
        tca_utc_iso: target.tca_utc_iso,
        delta_v_cm_s: deltaV,
        lead_time_minutes: LEAD_TIME_MINUTES,
        sat_mass_kg: SAT_MASS_KG,
      },
      { signal: controller.signal },
    )
      .then((payload) => {
        if (controller.signal.aborted) return
        setResult(payload)
        setStatus('ready')
      })
      .catch((err) => {
        if (controller.signal.aborted || err instanceof CanceledError) return
        setError(err)
        setStatus('error')
      })
  }, [event, deltaVCmS])

  return { status, result, error, deltaVCmS, refusal, canSimulate, simulate, reset }
}
