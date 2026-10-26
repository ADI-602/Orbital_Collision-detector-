import './ErrorState.css'

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" role="img" aria-label="error" focusable="false">
      <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.6v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.85" fill="currentColor" />
    </svg>
  )
}

/**
 * Explicit failure state.
 *
 * Renders the raw backend `detail` string verbatim rather than a friendly
 * paraphrase — when a demo goes wrong, the real message is what makes it
 * fixable. Pairs an icon with the label so the state does not depend on
 * colour alone. Renders no numbers of its own.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.detail] raw message from the API error
 * @param {import('react').ReactNode} [props.hint] what to do about it
 * @param {() => void} [props.onRetry]
 */
function ErrorState({ title, detail, hint, onRetry }) {
  return (
    <div className="error-state" role="alert">
      <div className="error-state__head">
        <AlertIcon />
        <span className="error-state__title">{title}</span>
      </div>

      {detail && <pre className="error-state__detail">{detail}</pre>}
      {hint && <p className="error-state__hint">{hint}</p>}

      {onRetry && (
        <button type="button" className="error-state__retry" onClick={onRetry}>
          RETRY
        </button>
      )}
    </div>
  )
}

export default ErrorState
