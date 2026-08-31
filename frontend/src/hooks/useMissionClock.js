import { useEffect, useState } from 'react'

/**
 * Format a Date as UTC parts. toISOString() is already UTC, so slicing it
 * avoids pulling in Intl timezone handling for no benefit.
 * @param {Date} date
 */
function formatUtc(date) {
  const iso = date.toISOString()
  return {
    iso,
    dateUtc: iso.slice(0, 10), // YYYY-MM-DD
    timeUtc: iso.slice(11, 19), // HH:MM:SS
  }
}

/**
 * Ticking UTC mission clock.
 *
 * Uses a self-scheduling setTimeout aligned to the next second boundary
 * rather than setInterval(fn, 1000). Interval drift accumulates and shows up
 * as a visible stutter in the seconds digit — distracting on a projector,
 * and three extra lines to avoid.
 *
 * @returns {{ iso: string, dateUtc: string, timeUtc: string }}
 */
export function useMissionClock() {
  const [now, setNow] = useState(() => formatUtc(new Date()))

  useEffect(() => {
    let timer

    const tick = () => {
      setNow(formatUtc(new Date()))
      // Re-align every tick so drift cannot accumulate.
      timer = setTimeout(tick, 1000 - (Date.now() % 1000))
    }

    timer = setTimeout(tick, 1000 - (Date.now() % 1000))
    return () => clearTimeout(timer)
  }, [])

  return now
}
