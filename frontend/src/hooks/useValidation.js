import { useCallback, useEffect, useRef, useState } from 'react'

import { CanceledError } from '../api/client.js'
import { getValidationStatus } from '../api/validation.js'

/**
 * useValidation — the server's known-answer check report, for the header badge.
 *
 * Read once on mount; `retry` reads it again. An unreachable endpoint is
 * reported as such ('error'), never as a pass or a fail: the badge may only
 * say "validated" when the pipeline itself said so.
 *
 * @returns {{status: 'loading' | 'ready' | 'error', report: object|null, error: Error|null, retry: () => void}}
 */
export function useValidation() {
  const [status, setStatus] = useState('loading')
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const controller = new AbortController()
    setStatus('loading')
    getValidationStatus({ signal: controller.signal })
      .then((payload) => {
        if (!mountedRef.current) return
        setReport(payload)
        setError(null)
        setStatus('ready')
      })
      .catch((err) => {
        if (!mountedRef.current || err instanceof CanceledError) return
        setError(err)
        setStatus('error')
      })
    return () => {
      mountedRef.current = false
      controller.abort()
    }
  }, [nonce])

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  return { status, report, error, retry }
}
