import { useEffect, useState } from 'react'

import { formatTMinus, tMinus } from '../../lib/replay.js'
import './TMinus.css'

/**
 * Countdown to a time of closest approach.
 *
 * The target instant is always a TCA the physics pipeline computed and handed
 * us — this component subtracts two timestamps and formats the result. It
 * never invents a target, and when it is given no valid one it renders an em
 * dash rather than counting down to something plausible.
 *
 * Two clocks can drive it, and which one is in use is stated on screen:
 *
 *   'wall'  real UTC now. Correct for a live event, whose TCA is a real
 *           future instant.
 *   'sim'   an instant supplied by the caller — the replay view's 2004 clock.
 *           Counting a historical encounter against today's date would read
 *           "T+21 years", which is true and useless.
 *
 * Runs past zero into "T+" instead of freezing at 00:00:00. A conjunction does
 * not stop existing at TCA, and a stuck countdown looks like a crash.
 *
 * @param {object} props
 * @param {number} props.targetMs   epoch ms of TCA; NaN renders as unknown
 * @param {'wall'|'sim'} [props.mode]
 * @param {number} [props.nowMs]    required for mode 'sim'; ignored for 'wall'
 * @param {string} [props.label]
 * @param {string} [props.note]     one line under the readout, e.g. which clock
 */
function TMinus({ targetMs, mode = 'wall', nowMs, label = 'Time to closest approach', note }) {
  // Only the wall-clock mode owns a ticker; in sim mode the caller's clock is
  // already advancing, and a second timer would fight it.
  const [wallNow, setWallNow] = useState(() => Date.now())

  useEffect(() => {
    if (mode !== 'wall') return undefined

    let timer
    const tick = () => {
      setWallNow(Date.now())
      // Re-align to the second boundary every tick so drift cannot build up
      // into a visible stutter — same approach as useMissionClock.
      timer = setTimeout(tick, 1000 - (Date.now() % 1000))
    }
    timer = setTimeout(tick, 1000 - (Date.now() % 1000))
    return () => clearTimeout(timer)
  }, [mode])

  const reference = mode === 'sim' ? nowMs : wallNow
  const t = tMinus(targetMs, reference)
  const text = formatTMinus(t)

  // Colour is a function of proximity, and never of threat: this is a clock,
  // not a risk indicator. The risk badge is the only thing that says RED.
  const tone = !t.valid ? 'unknown' : t.past ? 'past' : t.totalSeconds < 600 ? 'imminent' : 'nominal'

  return (
    <div className={`t-minus t-minus--${tone}`}>
      <span className="t-minus__label ui-label">{label}</span>
      <span className="t-minus__value ui-readout" role="timer">
        {text}
      </span>
      {note && <span className="t-minus__note">{note}</span>}
    </div>
  )
}

export default TMinus
