import { useCountdown } from '../../hooks/useCountdown.js'
import { resolveClockBasis } from '../../lib/countdown.js'
import { formatSimClock } from '../../lib/simClock.js'
import ErrorState from './ErrorState.jsx'
import './Countdown.css'

/**
 * T-minus countdown to a time of closest approach.
 *
 * Three rules govern this component, all of them about not overstating what
 * the pipeline knows:
 *
 * 1. **No TCA means no clock.** With no target it renders an em dash and says
 *    why. It never falls back to zeros, to "T-00:00:00", or to the current
 *    time — a demo camera cannot tell a placeholder clock from a real one.
 * 2. **The absolute TCA is always shown beside the countdown.** A bare
 *    relative clock is unverifiable; the instant it counts to is printed
 *    underneath so a judge can check one against the other.
 * 3. **Urgency is never inferred from the clock.** Threat level comes from
 *    the physics pipeline's `threat_level`, so `tone` is passed in by the
 *    caller. A countdown that reddened on its own would be the UI asserting a
 *    risk judgment no physics produced.
 *
 * @param {object} props
 * @param {Date|number|string|null} [props.targetUtc]  TCA, e.g. `tca_utc_iso`
 * @param {Date|number|string|null} [props.nowUtc]     drive against a supplied
 *   clock (replay/simulated time) instead of real UTC
 * @param {string} [props.label]
 * @param {'accent'|'nominal'|'watch'|'critical'} [props.tone]  from the event's
 *   threat level — never derived from how little time is left
 * @param {string} [props.emptyHint]  prose shown when there is no TCA
 * @param {string} [props.basisLabel] label for the supplied clock. Ignored
 *   when no `nowUtc` is given: an undriven countdown always reports the real
 *   clock it is actually counting against.
 */
function Countdown({
  targetUtc = null,
  nowUtc = null,
  label = 'Time to closest approach',
  tone = 'accent',
  emptyHint = 'No conjunction selected, so there is no time of closest approach to count to.',
  basisLabel,
}) {
  const { parts, text, description, error, isDriven } = useCountdown(targetUtc, { nowUtc })

  // A timestamp the pipeline produced but this component cannot parse is a
  // bug, not an empty state. Say so loudly — showing it as "no conjunction"
  // would hide a real event behind a reassuring dash.
  if (error) {
    return (
      <div className="countdown">
        <span className="countdown__label ui-label">{label}</span>
        <ErrorState
          title="Countdown unavailable"
          detail={error.message}
          hint="The time of closest approach could not be read. The conjunction itself may still be valid — check the event detail rather than treating this as 'no conjunction'."
        />
      </div>
    )
  }

  const basis = resolveClockBasis(isDriven, basisLabel)

  return (
    <div className={`countdown countdown--${tone}`}>
      <span className="countdown__label ui-label">{label}</span>

      <span
        className="countdown__clock ui-readout"
        // role="timer" with aria-live off: announcing every tick would make
        // the panel unusable with a screen reader. The accessible name carries
        // the spoken form, read on demand.
        role="timer"
        aria-live="off"
        aria-label={description}
      >
        {text}
      </span>

      {parts ? (
        <div className="countdown__meta">
          <span className="countdown__phase">
            {parts.phase === 'before' ? 'until closest approach' : 'since closest approach'}
          </span>
          <span className="countdown__tca ui-readout" title="Time of closest approach (UTC)">
            TCA {formatSimClock(new Date(parts.targetMs))}
          </span>
          <span className="countdown__basis">counted against {basis}</span>
        </div>
      ) : (
        <p className="countdown__empty">{emptyHint}</p>
      )}
    </div>
  )
}

export default Countdown
