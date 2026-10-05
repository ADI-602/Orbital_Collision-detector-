import { useCallback, useEffect, useRef, useState } from 'react'

import { getAiAdvice } from '../api/ai.js'
import { CanceledError } from '../api/client.js'
import { adviceRefusal, buildAdviceRequest } from '../lib/advice.js'

/**
 * useAiAdvice — ask the AI layer to explain ONE already-computed conjunction.
 *
 * The AI never screens and never computes: this hook hands it figures the
 * physics pipeline returned and stores the narrative that comes back.
 *
 * ON EXPLICIT ACTION, NOT ON SELECTION — same reasoning as useManeuver, plus
 * the model has a quota. The answer is discarded when the selected event
 * changes, so advice can never sit under a different conjunction's name.
 *
 * @param {object|null} event selected screening event
 * @param {string} primaryName
 * @param {object|null} maneuverResult simulated burn for this event, if any
 */
export function useAiAdvice(event, primaryName, maneuverResult = null) {
  const [status, setStatus] = useState('idle')
  const [advice, setAdvice] = useState(null)
  const [error, setError] = useState(null)
  const controllerRef = useRef(null)

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setStatus('idle')
    setAdvice(null)
    setError(null)
  }, [])

  const identity = event
    ? `${event.origin}:${event.primary_name}:${event.secondary_name}:${event.tca_utc_iso}`
    : null
  useEffect(() => {
    reset()
  }, [identity, reset])
  useEffect(() => () => controllerRef.current?.abort(), [])

  const refusal = adviceRefusal(event)

  const ask = useCallback(() => {
    if (!event || adviceRefusal(event)) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('running')
    setError(null)

    getAiAdvice(buildAdviceRequest(event, primaryName, maneuverResult), {
      signal: controller.signal,
    })
      .then((payload) => {
        if (controller.signal.aborted) return
        setAdvice(payload)
        setStatus('ready')
      })
      .catch((err) => {
        if (controller.signal.aborted || err instanceof CanceledError) return
        setError(err)
        setStatus('error')
      })
  }, [event, primaryName, maneuverResult])

  return { status, advice, error, refusal, canAsk: Boolean(event) && !refusal, ask, reset }
}
