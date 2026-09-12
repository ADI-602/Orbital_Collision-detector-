import { useCallback, useEffect, useRef, useState } from 'react'

import { CanceledError } from '../api/client.js'
import { isNoConjunctionFound, simulateManeuver } from '../api/physics.js'

/**
 * useManeuverSim — simulate one impulsive collision-avoidance burn through
 * /api/physics/maneuver.
 *
 * Every number it returns is the physics pipeline's: pre- and post-burn miss
 * distance, pre- and post-burn Pc, risk reduction, propellant. The hook adds
 * nothing of its own and defaults nothing — if `request` is incomplete it
 * simply does not fire, because a burn simulated from guessed inputs would
 * produce a number indistinguishable from a real one.
 *
 * @param {null | {
 *   primary: import('../api/types.js').TleInput,
 *   secondary: import('../api/types.js').TleInput,
 *   tca_utc_iso: string,
 *   delta_v_cm_s: number,
 *   lead_time_minutes: number,
 *   sat_mass_kg?: number
 * }} request  null disables the hook
 * @returns {{
 *   status: 'idle'|'running'|'done'|'empty'|'error',
 *   result: import('../api/physics.js').ManeuverResult|null,
 *   error: Error|null,
 *   refresh: () => void
 * }}
 */
export function useManeuverSim(request) {
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  // Serialised so the effect re-runs on a genuine change of inputs rather
  // than on every re-render handing it a fresh object literal.
  const key = request ? JSON.stringify(request) : null
  const requestRef = useRef(request)
  requestRef.current = request

  useEffect(() => {
    if (!key) {
      setStatus('idle')
      setResult(null)
      setError(null)
      return undefined
    }

    let disposed = false
    const controller = new AbortController()

    const run = async () => {
      setStatus('running')
      setError(null)

      try {
        const payload = await simulateManeuver(requestRef.current, {
          signal: controller.signal,
        })
        if (disposed) return
        setResult(payload)
        setStatus('done')
      } catch (err) {
        if (err instanceof CanceledError || disposed) return
        setResult(null)
        // "No close approach in the window" is a physics conclusion, not a
        // failure — the endpoint re-solves TCA within +/-2 h and can legitimately
        // come back empty. It must not render as a broken backend.
        setStatus(isNoConjunctionFound(err) ? 'empty' : 'error')
        setError(err)
      }
    }

    run()

    return () => {
      disposed = true
      controller.abort()
    }
  }, [key, nonce])

  return { status, result, error, refresh }
}
