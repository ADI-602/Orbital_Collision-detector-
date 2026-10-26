import { useState } from 'react'

import ErrorState from '../common/ErrorState.jsx'
import LoadingState from '../common/LoadingState.jsx'
import RiskBadge from '../common/RiskBadge.jsx'
import {
  EVENT_ORIGIN,
  eventKey,
  formatMissDistance,
  formatPc,
  isCoOrbital,
  isUnassessable,
  splitTcaIso,
} from '../../lib/conjunctions.js'
import {
  PASS_STATE,
  describeCoverage,
  formatCount,
  formatPassAge,
  summariseEvents,
} from '../../lib/monitoring.js'
import { EVENT_CATEGORIES, countByCategory, filterEvents } from '../../lib/eventFilter.js'
import './EventList.css'

/** Chip text for each filter category. */
const CATEGORY_LABEL = {
  RED: 'RED',
  YELLOW: 'YELLOW',
  GREEN: 'GREEN',
  OTHER: 'Co-orbital / not assessed',
}

/**
 * Conjunction events from the scheduled screening pass, most serious first.
 *
 * Every value in a row was computed by the physics pipeline. Nothing is
 * interpolated, rounded up, or filled in — where the pipeline returned
 * nothing, the list says so rather than showing a plausible row.
 *
 * Four honesty rules are enforced here:
 *
 *  1. An injected event carries a visible tag. The Envisat case is a real
 *     conjunction from 2004 replayed through the live pipeline, and it is
 *     valuable precisely because its numbers are checkable — but it is not
 *     something happening in orbit now, and the row must never read that way.
 *  2. A co-orbital pair is labelled, not coloured RED. See
 *     lib/conjunctions.js for why its Pc is not a risk statement.
 *  3. A pair the pipeline refused to assess shows the refusal, with no
 *     numbers at all. An em dash here is the honest output, not a gap to fill.
 *  4. A capped pass is never described as a complete screening. When
 *     refinement was truncated, the panel says which candidates were resolved
 *     and which were only coarsely bounded — "no close approaches found" is a
 *     claim about coverage, and it has to be earned.
 *
 * The button does not compute anything. Screening runs on the server on a
 * timer; REFRESH re-reads the last completed pass, SCREEN NOW asks for a new
 * one and returns immediately.
 *
 * @param {object} props
 * @param {object[]} props.events            ranked events, live + injected
 * @param {string} props.status              'loading' | 'ready'
 * @param {object|null} props.pass           last completed pass metadata
 * @param {Error|null} props.liveError
 * @param {Error|null} props.validationError
 * @param {boolean} props.triggering         a pass request is in flight
 * @param {boolean} props.watchingPass       a pass is running and being watched
 * @param {string|null} props.selectedKey
 * @param {(key: string|null) => void} props.onSelect
 * @param {() => void} props.onRefresh
 * @param {() => void} props.onScreenNow
 */
function EventList({
  events,
  status,
  pass,
  liveError,
  validationError,
  triggering,
  watchingPass,
  selectedKey,
  onSelect,
  onRefresh,
  onScreenNow,
}) {
  // Categories the operator has switched off. A display filter only; what it
  // hides is always counted on screen below (lib/eventFilter.js).
  const [hidden, setHidden] = useState(() => new Set())
  const toggleCategory = (category) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })

  if (status === 'loading') {
    return (
      <div className="event-list event-list--busy">
        <LoadingState label="READING LAST SCREENING PASS" />
        <p className="event-list__idle-note">
          Results are served from the server's last completed pass — this is a
          cached read, not a screening run.
        </p>
      </div>
    )
  }

  const bothFailed = liveError && validationError

  // Counted separately on purpose. A pair the pipeline refused is not a
  // detection, and folding the two together would read as "2 conjunctions
  // found" when the true answer is "none found, 2 could not be assessed".
  const liveEvents = events.filter((e) => e.origin === EVENT_ORIGIN.LIVE)
  const live = summariseEvents(liveEvents)
  const coverage = describeCoverage(pass?.stats)
  const neverRun = pass?.state === PASS_STATE.NEVER_RUN
  const passFailed = pass?.state === PASS_STATE.FAILED
  const running = watchingPass || pass?.state === PASS_STATE.RUNNING
  const counts = countByCategory(events)
  const visibleEvents = filterEvents(events, hidden)
  const hiddenCount = events.length - visibleEvents.length
  // Running with nothing completed behind it: there is no result yet, so the
  // panel must not report "0 conjunctions" or "no close approaches" — both
  // are claims about a screening that has not happened.
  const firstPass = running && !pass?.finished_at_unix && !liveError
  const noResultYet = neverRun || firstPass

  return (
    <div className="event-list">
      <div className="event-list__meta">
        <span className="event-list__meta-text ui-label">
          {liveError
            ? 'Monitoring feed unreachable'
            : firstPass
              ? 'First screening pass running'
              : neverRun
              ? 'No screening pass has completed yet'
              : `${live.detected} conjunction${live.detected === 1 ? '' : 's'}` +
                (live.highRisk > 0 ? ` · ${live.highRisk} high risk` : '') +
                (live.notAssessed > 0 ? ` · ${live.notAssessed} not assessed` : '') +
                ` · ${formatCount(pass?.stats?.objects_in)} objects` +
                ` · ${formatPassAge(pass?.finished_at_unix)}`}
        </span>
        <span className="event-list__actions">
          {running && <span className="event-list__running ui-label">PASS RUNNING…</span>}
          <button type="button" className="event-list__rerun" onClick={onRefresh}>
            REFRESH
          </button>
          <button
            type="button"
            className="event-list__rerun"
            onClick={onScreenNow}
            disabled={triggering || running}
            title="Ask the server to start a new all-pairs screening pass. Returns immediately; the pass runs in the background and can take minutes."
          >
            SCREEN NOW
          </button>
        </span>
      </div>

      {/* Coverage is a claim about the whole set, so it is stated before any
          "none found" phrasing below can be read as one. */}
      {coverage.text && !liveError && !noResultYet && (
        <p
          className={`event-list__coverage ${coverage.complete ? '' : 'event-list__coverage--partial'}`}
        >
          {coverage.text}
        </p>
      )}

      {/* Each failure is reported separately: one source going down must not
          cast doubt on the other's numbers. */}
      {liveError && (
        <ErrorState
          title="Monitoring feed unreachable"
          detail={liveError.detail ?? liveError.message}
          hint="The scheduled screening results could not be read. Any rows below come from the injected validation case only."
          onRetry={onRefresh}
        />
      )}
      {passFailed && !liveError && (
        <ErrorState
          title="Last screening pass failed"
          detail={pass?.error ?? 'the server did not say why'}
          hint="No events are being reported from the tracked set. This is a pipeline failure, not an empty result."
          onRetry={onScreenNow}
        />
      )}
      {validationError && (
        <ErrorState
          title="Validation replay failed"
          detail={validationError.detail ?? validationError.message}
          hint="The Envisat known-answer check did not run, so nothing below is verified against published values."
          onRetry={onRefresh}
        />
      )}

      {noResultYet && !liveError && (
        <div className="event-list__empty">
          <span className="event-list__empty-title">
            {firstPass ? 'First screening pass in progress' : 'No pass has completed yet'}
          </span>
          <span className="event-list__empty-hint">
            {firstPass
              ? 'The server is screening every pair in the tracked set. Detections appear here when the pass completes — usually a few minutes after the backend starts. '
              : 'The server screens the tracked set on a timer and the first pass has not finished. '}
            This is not a result — nothing has been screened yet.
          </span>
        </div>
      )}

      {live.detected === 0 && !liveError && !bothFailed && !noResultYet && !passFailed && (
        <div className="event-list__empty">
          <span className="event-list__empty-title">
            {coverage.complete
              ? 'No close approaches in the tracked set'
              : 'No close approaches among the candidates resolved'}
          </span>
          <span className="event-list__empty-hint">
            {coverage.complete
              ? `The pipeline evaluated ${formatCount(pass?.stats?.pairs_evaluated)} pairs over the ` +
                `next ${pass?.window_hours ?? '—'} h and flagged none. That is a result, not a failure — ` +
                'close approaches are rare.'
              : 'Refinement was capped, so this is not a statement about the whole set. ' +
                'See the coverage note above.'}
            {live.notAssessed > 0 &&
              ` ${live.notAssessed} pair${live.notAssessed === 1 ? ' was' : 's were'} co-located and could not be assessed; ` +
                'listed below.'}
          </span>
        </div>
      )}

      {events.length > 0 && (
        <div className="event-list__filters" role="group" aria-label="Show events by threat level">
          {EVENT_CATEGORIES.map((category) =>
            counts[category] > 0 ? (
              <button
                key={category}
                type="button"
                className={`event-filter event-filter--${category.toLowerCase()}`}
                aria-pressed={!hidden.has(category)}
                onClick={() => toggleCategory(category)}
                title={hidden.has(category) ? 'Show these events' : 'Hide these events'}
              >
                <span className="event-filter__dot" aria-hidden="true" />
                {CATEGORY_LABEL[category]}
                <span className="event-filter__count ui-readout">{counts[category]}</span>
              </button>
            ) : null,
          )}
          {hiddenCount > 0 && (
            <span className="event-list__hidden">
              {hiddenCount} hidden by filter
              <button type="button" className="event-list__show-all" onClick={() => setHidden(new Set())}>
                Show all
              </button>
            </span>
          )}
        </div>
      )}

      {visibleEvents.length > 0 && (
        <div className="event-list__rows" role="list">
          {visibleEvents.map((event) => {
            const key = eventKey(event)
            const coOrbital = isCoOrbital(event)
            const unassessable = isUnassessable(event)
            const injected = event.origin === EVENT_ORIGIN.VALIDATION
            const tca = splitTcaIso(event.tca_utc_iso)

            return (
              <button
                type="button"
                role="listitem"
                key={key}
                className={`event-row ${selectedKey === key ? 'is-selected' : ''} ${
                  coOrbital || unassessable ? 'is-co-orbital' : ''
                }`}
                onClick={() => onSelect(selectedKey === key ? null : key)}
              >
                <span className="event-row__badge">
                  {/* No level passed for either non-risk case: RiskBadge's
                      UNKNOWN fallback renders grey, so a co-located pair can
                      never appear as RED. */}
                  {unassessable ? (
                    <RiskBadge label="Not assessed" />
                  ) : coOrbital ? (
                    <RiskBadge label="Co-orbital" />
                  ) : (
                    <RiskBadge level={event.threat_level} />
                  )}
                </span>

                <span className="event-row__name">
                  {/* Both objects, because in an all-pairs pass there is no
                      fixed primary to leave implied. */}
                  {event.primary_name} ↔ {event.secondary_name}
                  {injected && (
                    <span className="event-row__tag" title="Historical event replayed through the live pipeline">
                      INJECTED · 2004 REPLAY
                    </span>
                  )}
                </span>

                <span className="event-row__num ui-readout">
                  {unassessable ? '—' : formatMissDistance(event.miss_distance_m)}
                </span>
                <span className="event-row__num ui-readout">
                  {unassessable || coOrbital ? 'n/a' : formatPc(event.pc)}
                </span>
                <span className="event-row__tca ui-readout" title={unassessable ? event.reason : tca.raw}>
                  {unassessable ? 'co-located pair' : `${tca.date} ${tca.time}`}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default EventList
