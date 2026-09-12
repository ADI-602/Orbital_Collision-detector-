import { useCallback, useEffect, useRef, useState } from 'react'

import { CanceledError } from '../api/client.js'
import { getAiAdvice, isLiveAdvice } from '../api/ai.js'

/**
 * useAiAdvice — ask the AI layer to explain a conjunction the physics
 * pipeline has already assessed.
 *
 * ===================== THE BOUNDARY, IN ONE HOOK =====================
 * Input is a ConjunctionContext plus ManeuverOptions, both built by
 * api/adapters.js from real pipeline output. The AI receives finished
 * numbers and returns prose. It is never asked to compute, check, or
 * estimate anything, and this hook never fires without a real Pc — there is
 * no path here that produces narrative about a number that does not exist.
 * =====================================================================
 *
 * `isLive` is computed with the strict test from api/ai.js: only an explicit
 * `is_fallback === false` counts as live. The endpoint always returns 200 and
 * degrades to a deterministic rule-based advisor when no model is reachable,
 * so HTTP status says nothing — and rule-based text presented as live model
 * output would be exactly the fabrication CLAUDE.md 1.3 forbids.
 *
 * @param {null | {
 *   conjunction: import('../api/ai.js').ConjunctionContext,
 *   maneuvers?: import('../api/ai.js').ManeuverOption[],
 *   query_type?: string
 * }} request  null disables the hook
 * @returns {{
 *   status: 'idle'|'running'|'done'|'error',
 *   advice: import('../api/ai.js').AiAdvisorResponse|null,
 *   isLive: boolean,
 *   error: Error|null,
 *   refresh: () => void
 * }}
 */
export function useAiAdvice(request) {
  const [status, setStatus] = useState('idle')
  const [advice, setAdvice] = useState(null)
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  const key = request ? JSON.stringify(request) : null
  const requestRef = useRef(request)
  requestRef.current = request

  useEffect(() => {
    if (!key) {
      setStatus('idle')
      setAdvice(null)
      setError(null)
      return undefined
    }

    let disposed = false
    const controller = new AbortController()

    const run = async () => {
      setStatus('running')
      setError(null)

      try {
        const payload = await getAiAdvice(requestRef.current, { signal: controller.signal })
        if (disposed) return
        setAdvice(payload)
        setStatus('done')
      } catch (err) {
        if (err instanceof CanceledError || disposed) return
        // The physics panels beside this one stay fully populated: the AI
        // layer being unreachable must never take the dashboard down with it.
        setAdvice(null)
        setStatus('error')
        setError(err)
      }
    }

    run()

    return () => {
      disposed = true
      controller.abort()
    }
  }, [key, nonce])

  return { status, advice, isLive: isLiveAdvice(advice), error, refresh }
}
