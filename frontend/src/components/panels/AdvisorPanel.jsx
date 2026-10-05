import ErrorState from '../common/ErrorState.jsx'
import LoadingState from '../common/LoadingState.jsx'
import { adviceProvenance } from '../../lib/advice.js'
import './AdvisorPanel.css'

const SECTIONS = [
  ['executive_summary', 'Summary'],
  ['risk_assessment', 'Risk assessment'],
  ['recommended_action', 'Recommended action'],
  ['tradeoff_analysis', 'Trade-offs'],
]

/**
 * The AI layer's commentary on the selected conjunction.
 *
 * Narrative only. The model's `key_metrics` field is deliberately NOT
 * rendered: it is untyped on the wire, and a number shown here in the model's
 * words could differ from the one the physics panels show. Every figure on
 * screen comes from the pipeline; this panel explains them.
 *
 * Provenance is always visible. "AI: LIVE" appears only when the backend says
 * is_fallback === false; otherwise the offline rule-based advisor is named.
 *
 * @param {object} props
 * @param {object|null} props.event
 * @param {ReturnType<import('../../hooks/useAiAdvice.js').useAiAdvice>} props.ai
 */
function AdvisorPanel({ event, ai }) {
  const { status, advice, error, refusal, canAsk, ask } = ai

  if (!event) {
    return (
      <div className="advisor advisor--empty">
        <span className="advisor__empty-title">No conjunction selected</span>
        <span className="advisor__empty-hint">
          Select an event to have the advisor explain its figures.
        </span>
      </div>
    )
  }

  if (refusal) {
    return (
      <div className="advisor advisor--empty">
        <span className="advisor__empty-title">Nothing to explain</span>
        <span className="advisor__empty-hint">{refusal}</span>
      </div>
    )
  }

  const provenance = advice ? adviceProvenance(advice) : null

  return (
    <div className="advisor">
      <div className="advisor__bar">
        <button
          type="button"
          className="advisor__ask"
          onClick={ask}
          disabled={!canAsk || status === 'running'}
        >
          {advice ? 'Ask again' : 'Explain this event'}
        </button>
        {provenance && (
          <span
            className={`advisor__chip ${provenance.live ? 'is-live' : 'is-offline'}`}
            title={provenance.note}
          >
            {provenance.label}
          </span>
        )}
      </div>

      {status === 'running' && <LoadingState label="ASKING THE ADVISOR" />}

      {status === 'error' && (
        <ErrorState
          title="The advisor request failed"
          detail={error?.detail ?? error?.message ?? 'unknown error'}
          hint="The physics figures are unaffected. Nothing was substituted."
          onRetry={ask}
        />
      )}

      {status === 'ready' && advice && (
        <div className="advisor__body">
          {SECTIONS.map(([key, title]) =>
            advice[key] ? (
              <section key={key} className="advisor__section">
                <span className="advisor__title ui-label">{title}</span>
                <p className="advisor__text">{advice[key]}</p>
              </section>
            ) : null,
          )}
          <p className="advisor__note">{provenance.note}</p>
        </div>
      )}

      {status === 'idle' && (
        <p className="advisor__note">
          Commentary on the figures above. The advisor is handed the pipeline&rsquo;s
          numbers and computes none of them.
        </p>
      )}
    </div>
  )
}

export default AdvisorPanel
