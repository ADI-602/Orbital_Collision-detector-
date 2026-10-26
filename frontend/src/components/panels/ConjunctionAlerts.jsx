import RiskBadge from '../common/RiskBadge.jsx'
import { adviceProvenance } from '../../lib/advice.js'
import { formatMissDistance, formatPc, splitTcaIso } from '../../lib/conjunctions.js'
import './ConjunctionAlerts.css'

/**
 * Non-blocking alerts for new elevated-risk detections.
 *
 * Two layers, always visually separate and always in this order:
 *   1. What the physics found — threat, pair, Pc, miss distance, TCA, exactly
 *      as the scheduled screening returned them. Shown immediately.
 *   2. The AI's explanation of those figures, fetched afterwards and labelled
 *      with its provenance. It never adds a number of its own here.
 *
 * Nothing here is ever labelled "AI detected" or "AI monitoring": the AI did
 * neither (CLAUDE.md §5.2).
 *
 * @param {object} props
 * @param {object[]} props.alerts      from useConjunctionAlerts
 * @param {number} props.overflow      further new alerts not shown
 * @param {(id: string) => void} props.onDismiss
 * @param {() => void} props.onDismissAll
 * @param {(event: object) => void} props.onView select the event in the console
 */
function ConjunctionAlerts({ alerts, overflow, onDismiss, onDismissAll, onView }) {
  if (!alerts.length && !overflow) return null

  return (
    <div className="conj-alerts" role="status" aria-live="polite">
      {alerts.map((alert) => {
        const { event } = alert
        const tca = splitTcaIso(event.tca_utc_iso)
        const level = event.threat_level === 'RED' ? 'critical' : 'watch'
        const provenance = alert.advice ? adviceProvenance(alert.advice) : null

        return (
          <article key={alert.id} className={`conj-alert conj-alert--${level}`}>
            <header className="conj-alert__head">
              <span className="conj-alert__title ui-label">
                New conjunction · scheduled screening
              </span>
              <button
                type="button"
                className="conj-alert__close"
                onClick={() => onDismiss(alert.id)}
                aria-label="Dismiss alert"
                title="Dismiss"
              >
                ×
              </button>
            </header>

            <div className="conj-alert__pair">
              <RiskBadge level={event.threat_level} />
              <span className="conj-alert__names">
                {event.primary_name ?? 'Primary'} <span aria-hidden="true">↔</span>{' '}
                {event.secondary_name ?? 'Secondary'}
              </span>
            </div>

            <dl className="conj-alert__figures">
              <div>
                <dt>Pc</dt>
                <dd className="ui-readout">{formatPc(event.pc)}</dd>
              </div>
              <div>
                <dt>Miss</dt>
                <dd className="ui-readout">{formatMissDistance(event.miss_distance_m)}</dd>
              </div>
              <div>
                <dt>TCA (UTC)</dt>
                <dd className="ui-readout" title={tca.raw}>
                  {tca.date} {tca.time}
                </dd>
              </div>
            </dl>

            <section className="conj-alert__ai">
              <span className="conj-alert__ai-label ui-label">
                AI explanation
                {provenance && (
                  <span
                    className={`conj-alert__chip${provenance.live ? ' is-live' : ''}`}
                    title={provenance.note}
                  >
                    {provenance.live ? 'LIVE' : 'OFFLINE ADVISOR'}
                  </span>
                )}
              </span>
              {alert.adviceStatus === 'loading' && (
                <p className="conj-alert__ai-text is-pending">Asking the advisor…</p>
              )}
              {alert.adviceStatus === 'ready' && (
                <p className="conj-alert__ai-text">{alert.advice.executive_summary}</p>
              )}
              {alert.adviceStatus === 'error' && (
                <p className="conj-alert__ai-text is-pending">
                  The advisor did not answer. The figures above stand on their own.
                </p>
              )}
            </section>

            <footer className="conj-alert__actions">
              <button type="button" className="conj-alert__view" onClick={() => onView(event)}>
                View event
              </button>
            </footer>
          </article>
        )
      })}

      {(overflow > 0 || alerts.length > 1) && (
        <div className="conj-alerts__more">
          {overflow > 0 && (
            <span>
              +{overflow} more new elevated-risk event{overflow === 1 ? '' : 's'} in this pass
              — see Conjunction events.
            </span>
          )}
          <button type="button" className="conj-alerts__clear" onClick={onDismissAll}>
            Dismiss all
          </button>
        </div>
      )}
    </div>
  )
}

export default ConjunctionAlerts
