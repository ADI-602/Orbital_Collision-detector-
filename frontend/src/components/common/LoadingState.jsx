import './LoadingState.css'

/**
 * Indeterminate loading indicator.
 *
 * No progress percentage, deliberately: none of the physics endpoints report
 * progress, so any number here would be invented. A fabricated progress
 * figure is still a fabricated number.
 *
 * @param {object} props
 * @param {string} [props.label]
 */
function LoadingState({ label = 'QUERYING BACKEND' }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-state__bar" aria-hidden="true" />
      <span className="loading-state__label ui-label">{label}</span>
    </div>
  )
}

export default LoadingState
