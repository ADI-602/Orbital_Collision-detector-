import { useCallback, useEffect, useRef, useState } from 'react'

import { CanceledError } from '../api/client.js'
import { getHealth } from '../api/health.js'

/**
 * 15 seconds, not 1-2. /health is a literal dict return
 * (backend/api/main.py:81-88) so server cost is not the constraint — but
 * uvicorn logs every request, and the presenter may have that terminal
 * visible during the demo. A fast poll floods it for no gain.
 */
const DEFAULT_INTERVAL_MS = 15000

/**
 * Poll the backend's /health endpoint.
 *
 * @param {{ intervalMs?: number }} [options]
 * @returns {{
 *   status: 'connecting' | 'online' | 'offline',
 *   data: import('../api/health.js').HealthResponse | null,
 *   error: Error | null,
 *   lastCheckedAt: Date | null,
 *   refresh: () => void
 * }}
 */
export function useHealth({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  // Starts at 'connecting' and is never optimistically 'online'.
  const [status, setStatus] = useState('connecting')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [lastCheckedAt, setLastCheckedAt] = useState(null)
  const [nonce, setNonce] = useState(0)

  const abortRef = useRef(null)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let timer
    let disposed = false

    const check = async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const payload = await getHealth({ signal: controller.signal })
        if (disposed) return
        setData(payload)
        setError(null)
        setStatus('online')
        setLastCheckedAt(new Date())
      } catch (err) {
        // React 19 StrictMode double-invokes effects in dev, so the first
        // request is always aborted by the cleanup below. Rendering that as
        // an error would flash OFFLINE on every dev page load.
        if (err instanceof CanceledError || disposed) return
        setError(err)
        setStatus('offline')
        setLastCheckedAt(new Date())
      } finally {
        if (!disposed) {
          timer = setTimeout(check, intervalMs)
        }
      }
    }

    check()

    return () => {
      disposed = true
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [intervalMs, nonce])

  return { status, data, error, lastCheckedAt, refresh }
}
