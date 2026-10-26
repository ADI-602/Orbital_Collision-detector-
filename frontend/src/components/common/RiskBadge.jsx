import { THREAT_THRESHOLDS } from '../../lib/conjunctions.js'
import './RiskBadge.css'

/**
 * Threat levels as emitted by /api/physics/screening
 * (backend/api/main.py:233). Anything not in this map renders as UNKNOWN —
 * an unrecognised level must never quietly display as nominal.
 *
 * The badge says the backend's own word. It used to translate RED into
 * "Critical", so one event read "Critical" on its badge and "RED" in the row
 * beside it — two vocabularies for one value on the same screen. The Pc
 * boundary rides along as a tooltip (lib/conjunctions.js THREAT_THRESHOLDS).
 */
const LEVELS = {
  GREEN: {
    modifier: 'nominal',
    text: 'GREEN',
    title: `Pc below ${THREAT_THRESHOLDS.YELLOW.toExponential(0)}`,
  },
  YELLOW: {
    modifier: 'watch',
    text: 'YELLOW',
    title: `Pc ≥ ${THREAT_THRESHOLDS.YELLOW.toExponential(0)}`,
  },
  RED: {
    modifier: 'critical',
    text: 'RED',
    title: `Pc ≥ ${THREAT_THRESHOLDS.RED.toExponential(0)}`,
  },
}

const UNKNOWN = { modifier: 'unknown', text: 'Unknown', title: undefined }

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
  const { modifier, text, title } = LEVELS[level] ?? UNKNOWN

  return (
    <span className={`risk-badge risk-badge--${modifier}`} title={label ? undefined : title}>
      <span className="risk-badge__dot" aria-hidden="true" />
      <span className="risk-badge__text">{label ?? text}</span>
    </span>
  )
}

export default RiskBadge
