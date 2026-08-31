import './StatusChip.css'

/**
 * Small pill reporting the state of a SYSTEM (backend reachable, AI layer
 * connected). Kept deliberately separate from RiskBadge: system health and
 * conjunction threat are different things, and letting them share a visual
 * language would blur the physics/AI boundary the project rests on.
 *
 * @param {object} props
 * @param {string} props.label     e.g. "BACKEND"
 * @param {string} props.value     e.g. "ONLINE"
 * @param {'online'|'offline'|'pending'} [props.tone]
 * @param {string} [props.title]   hover text, used for debugging detail
 */
function StatusChip({ label, value, tone = 'pending', title }) {
  return (
    <span className={`status-chip status-chip--${tone}`} title={title}>
      <span className="status-chip__dot" aria-hidden="true" />
      <span className="status-chip__label">{label}</span>
      <span className="status-chip__value">{value}</span>
    </span>
  )
}

export default StatusChip
