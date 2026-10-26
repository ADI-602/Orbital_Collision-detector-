import { useCallback, useEffect, useRef, useState } from 'react'

import { getAiAdvice } from '../api/ai.js'
import { buildAdviceRequest } from '../lib/advice.js'
import { MAX_ALERTS_PER_PASS, findNewAlerts, markSeen, parseSeen } from '../lib/alerts.js'
import { eventKey } from '../lib/conjunctions.js'

const SEEN_STORAGE_KEY = 'ora.alerts.seen'

function readSeen() {
  try {
    return parseSeen(window.localStorage.getItem(SEEN_STORAGE_KEY))
  } catch {
    return []
  }
}

function writeSeen(seen) {
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(seen))
  } catch {
    // Blocked storage only means alerts may repeat after a reload.
  }
}

/**
 * useConjunctionAlerts — raise a non-blocking alert for each NEW elevated-risk
 * detection from the scheduled screening.
 *
 * THE PHYSICS DETECTS, THE AI EXPLAINS (CLAUDE.md §5.2). An alert is raised by
 * the pipeline's own threat rating on a pass the server ran on its timer. The
 * AI is asked afterwards, per alert, to explain figures it is handed. The
 * alert shows the pipeline's numbers immediately and never waits on the
 * model; if the model is down the alert still stands, with the offline
 * advisor's text clearly labelled as such.
 *
 * PER VIEWER. "Already alerted" is remembered in this browser, so every person
 * watching the console gets each alert once, and a reload does not re-fire
 * them. (The backend's drain-on-read /api/monitoring/alerts is deliberately not
 * used: it hands each alert to whichever single client polls first.)
 *
 * @param {object[]} events ranked events from useScreening
 * @param {boolean} ready   true once useScreening has finished a read
 */
export function useConjunctionAlerts(events, ready) {
  const [alerts, setAlerts] = useState([])
  const [overflow, setOverflow] = useState(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const patch = useCallback((id, changes) => {
    if (!mountedRef.current) return
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, ...changes } : a)))
  }, [])

  useEffect(() => {
    if (!ready) return
    const seen = readSeen()
    const fresh = findNewAlerts(events, seen)
    if (fresh.length === 0) return

    // Marked seen BEFORE anything is shown: an alert must never fire twice,
    // even if the advisor call below fails or the page is closed mid-request.
    writeSeen(markSeen(seen, fresh))

    const shown = fresh.slice(0, MAX_ALERTS_PER_PASS)
    setOverflow(fresh.length - shown.length)
    setAlerts((prev) => {
      const incoming = shown.map((event) => ({
        id: eventKey(event),
        event,
        raisedAt: Date.now(),
        adviceStatus: 'loading',
        advice: null,
        adviceError: null,
      }))
      const ids = new Set(incoming.map((a) => a.id))
      return [...incoming, ...prev.filter((a) => !ids.has(a.id))].slice(0, MAX_ALERTS_PER_PASS)
    })

    // One advisor call per shown alert, in order. Sequential rather than
    // parallel: the model is on a rate-limited free tier.
    ;(async () => {
      for (const event of shown) {
        const id = eventKey(event)
        try {
          const advice = await getAiAdvice(
            buildAdviceRequest(event, event.primary_name ?? 'Primary'),
          )
          patch(id, { adviceStatus: 'ready', advice })
        } catch (err) {
          patch(id, { adviceStatus: 'error', adviceError: err })
        }
      }
    })()
  }, [events, ready, patch])

  const dismiss = useCallback((id) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const dismissAll = useCallback(() => {
    setAlerts([])
    setOverflow(0)
  }, [])

  return { alerts, overflow, dismiss, dismissAll }
}
