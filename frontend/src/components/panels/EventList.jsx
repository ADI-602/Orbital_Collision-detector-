import ErrorState from '../common/ErrorState.jsx'
import LoadingState from '../common/LoadingState.jsx'
import RiskBadge from '../common/RiskBadge.jsx'
import { formatMetres, formatPc } from '../../lib/format.js'
import { formatSimClock } from '../../lib/simClock.js'
import './EventList.css'

/**
 * EventList — conjunctions the pipeline found, ranked by collision probability.
 *
 * Ranked by Pc rather than miss distance because Pc is what an operator acts
 * on: a fast pass at 800 m can carry more risk than a slow one at 400 m, and
 * ordering by distance would bury it.
 *
 * THE EMPTY STATE IS A RESULT, NOT A GAP. Close approaches inside a few
 * kilometres are rare per object per day, so a scoped candidate set reports
 * nothing most of the time. That is a real answer and is rendered as one —
 * with the window that was actually searched, so "nothing found" can be
 * checked rather than taken on faith. It is deliberately not styled as an
 * error or as something still loading.
 *
 * `unassessable` pairs are listed separately and never mixed in with events.
 * "We could not assess this pair" and "we assessed it and it is safe" are
 * different claims, and a screening panel that blurs them is worse than one
 * that shows neither.
 *
 * @param {object} props
 * @param {'idle'|'running'|'done'|'error'} props.status
 * @param {Array<import('../../api/physics.js').ScreeningEvent>} props.events
 * @param {Array<{secondary_name: string, reason: string}>} [props.unassessable]
 * @param {Date|null} [props.windowStart]
 * @param {number|null} [props.windowHours]
 * @param {number} [props.screenedCount]
 * @param {string|null} [props.selectedName]
 * @param {(event: object) => void} [props.onSelect]
 * @param {Error|null} [props.error]
 * @param {() => void} [props.onRetry]
 */
function EventList({
  status,
  events = [],
  unassessable = [],
  windowStart,
  windowHours,
  screenedCount = 0,
  selectedName = null,
  onSelect,
  error,
  onRetry,
}) {
  if (status === 'idle') {
    return <p className="event-list__note">No candidate set to screen yet.</p>
  }

  if (status === 'running') {
    return <LoadingState label={`Screening ${screenedCount || ''} candidates`.trim()} />
  }

  if (status === 'error') {
    return (
      <ErrorState
        title="Screening failed"
        detail={error?.detail ?? error?.message}
        hint="No conjunction assessment is available for this set. This is a failure to compute, not a finding of 'no risk'."
        onRetry={onRetry}
      />
    )
  }

  const searched =
    windowStart && windowHours
      ? `${formatSimClock(windowStart)} + ${windowHours} h`
      : null

  return (
    <div className="event-list">
      {events.length === 0 ? (
        <div className="event-list__empty">
          <span className="event-list__empty-title">No close approach found</span>
          <span className="event-list__note">
            {screenedCount} candidate{screenedCount === 1 ? '' : 's'} screened
            {searched ? ` over ${searched}` : ''}. Nothing crossed the screening
            threshold — a real result, not a missing one.
          </span>
        </div>
      ) : (
        <>
          <ul className="event-list__items">
            {events.map((e) => {
              const active = selectedName === e.secondary_name
              return (
                <li key={e.secondary_name}>
                  <button
                    type="button"
                    className={`event-list__item ${active ? 'is-active' : ''}`}
                    onClick={() => onSelect?.(e)}
                    aria-pressed={active}
                  >
                    <span className="event-list__row">
                      <span className="event-list__name">{e.secondary_name}</span>
                      <RiskBadge level={e.threat_level} />
                    </span>
                    <span className="event-list__row event-list__row--nums">
                      <span className="ui-readout">{formatMetres(e.miss_distance_m)}</span>
                      <span className="ui-readout">Pc {formatPc(e.pc)}</span>
                    </span>
                    <span className="event-list__tca ui-readout">{e.tca_utc_iso}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {searched && (
            <p className="event-list__note">
              {screenedCount} candidate{screenedCount === 1 ? '' : 's'} screened over {searched}.
            </p>
          )}
        </>
      )}

      {unassessable.length > 0 && (
        <div className="event-list__unassessable">
          <span className="event-list__unassessable-title ui-label">
            Not assessed ({unassessable.length})
          </span>
          <ul>
            {unassessable.map((u) => (
              <li key={u.secondary_name}>
                <span className="event-list__name">{u.secondary_name}</span>
                <span className="event-list__note">{u.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default EventList
