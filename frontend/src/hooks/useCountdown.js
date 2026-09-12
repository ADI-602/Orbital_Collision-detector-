import { useEffect, useState } from 'react'

import {
  computeCountdown,
  describeCountdown,
  formatCountdown,
  toEpochMs,
} from '../lib/countdown.js'

/**
 * Ticking T-minus countdown to a TCA.
 *
 * Two modes, and which one is in force is never left implicit — the component
 * renders the basis on screen:
 *
 *   free-running (`nowUtc` omitted)  ticks once per real second against the
 *                                    wall clock. For a conjunction whose TCA
 *                                    lies in real time ahead of us.
 *   driven (`nowUtc` supplied)       recomputes purely from the instant the
 *                                    caller passes. For the Envisat replay and
 *                                    anything else stepping a simulated clock,
 *                                    where a wall-clock countdown to a 2004
 *                                    encounter would be meaningless.
 *
 * The two must never be mixed by accident: the console's globe runs on a
 * simulated clock at x120 (see lib/simClock.js), so a free-running countdown
 * shown beside it advances 120x slower than the motion on screen. That is
 * legitimate — they measure different things — but only if the readout says
 * which clock it is counting against.
 *
 * Like useMissionClock, the tick re-aligns to the next second boundary each
 * time rather than using setInterval, whose drift shows up as a visible
 * stutter in the seconds digit.
 *
 * Errors are caught and returned, not thrown. lib/countdown.js is deliberately
 * strict so a malformed timestamp fails loudly in tests; but a throw during
 * render would blank the console mid-demo, so here it becomes a state the UI
 * can show as an explicit error — never as "no conjunction", which is a
 * different and much more dangerous thing to imply.
 *
 * @param {Date|number|string|null|undefined} targetUtc  TCA from the pipeline
 * @param {{ nowUtc?: Date|number|string|null }} [options]
 * @returns {{
 *   parts: import('../lib/countdown.js').CountdownParts|null,
 *   text: string,
 *   description: string,
 *   error: Error|null,
 *   isDriven: boolean
 * }}
 */
export function useCountdown(targetUtc, { nowUtc = null } = {}) {
  const isDriven = nowUtc !== null && nowUtc !== undefined
  const [realNowMs, setRealNowMs] = useState(() => Date.now())

  useEffect(() => {
    // A driven countdown has no clock of its own — re-rendering is the caller's
    // job, so running a timer here would be pure wasted wake-ups.
    if (isDriven) return undefined

    let timer
    const tick = () => {
      setRealNowMs(Date.now())
      timer = setTimeout(tick, 1000 - (Date.now() % 1000))
    }

    timer = setTimeout(tick, 1000 - (Date.now() % 1000))
    return () => clearTimeout(timer)
  }, [isDriven])

  // Computed inline rather than memoised: it is a handful of integer
  // operations, and a dependency array over Date objects (whose identity
  // changes every render anyway) would cost more than it saves.
  try {
    const parts = computeCountdown(targetUtc, isDriven ? toEpochMs(nowUtc) : realNowMs)
    return {
      parts,
      text: formatCountdown(parts),
      description: describeCountdown(parts),
      error: null,
      isDriven,
    }
  } catch (err) {
    return { parts: null, text: '—', description: 'Countdown unavailable', error: err, isDriven }
  }
}
