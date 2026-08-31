import './RiskBadge.css'

/**
 * Threat levels as emitted by /api/physics/screening
 * (backend/api/main.py:233). Anything not in this map renders as UNKNOWN —
 * an unrecognised level must never quietly display as nominal.
 */
const LEVELS = {
  GREEN: { modifier: 'nominal', text: 'Nominal' },
  YELLOW: { modifier: 'watch', text: 'Watch' },
  RED: { modifier: 'critical', text: 'Critical' },
}

const UNKNOWN = { modifier: 'unknown', text: 'Unknown' }

/**
 * Conjunction threat indicator: a coloured dot beside a text label.
 *
 * The dot alone never carries the meaning — the label is always rendered
 * alongside it. Colour-only status is unreadable on a washed-out projector
 * and inaccessible to colour-blind viewers, so there is deliberately no
 * icon-only or dot-only variant.
 *
 * @param {object} props
 * @param {string} [props.level] raw backend threat_level string
 * @param {string} [props.label] optional text override
 */
function RiskBadge({ level, label }) {
  const { modifier, text } = LEVELS[level] ?? UNKNOWN

  return (
    <span className={`risk-badge risk-badge--${modifier}`}>
      <span className="risk-badge__dot" aria-hidden="true" />
      <span className="risk-badge__text">{label ?? text}</span>
    </span>
  )
}

export default RiskBadge
