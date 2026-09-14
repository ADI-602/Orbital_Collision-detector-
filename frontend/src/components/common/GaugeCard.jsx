import './GaugeCard.css'

const SIZE = 104
const STROKE = 6
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Circular gauge with a value in the middle.
 *
 * Handles the empty case as a first-class state rather than an afterthought:
 * when `value` is null the ring renders as a bare track and the readout shows
 * an em dash. There is no "0%" stand-in, because a zero would be a claim.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {number|null} [props.value]    numerator; null renders the empty state
 * @param {number} [props.max]           denominator for the arc sweep
 * @param {string} [props.display]       text in the centre; defaults to `value`
 * @param {string} [props.unit]          small caption under the centre text
 * @param {string} [props.tone]          'accent' | 'nominal' | 'watch' | 'critical'
 * @param {string} [props.footnote]      small line under the gauge
 */
function GaugeCard({
  label,
  value = null,
  max = 100,
  display,
  unit,
  tone = 'accent',
  footnote,
}) {
  const isEmpty = value === null || value === undefined || !Number.isFinite(value)
  const readout = isEmpty ? '—' : (display ?? String(value))
  const ratio = isEmpty || max <= 0 ? 0 : Math.min(Math.max(value / max, 0), 1)
  const dash = CIRCUMFERENCE * ratio

  return (
    <div className={`gauge-card gauge-card--${tone}`}>
      <span className="gauge-card__label ui-label">{label}</span>

      <div className="gauge-card__ring">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle
            className="gauge-card__track"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
          />
          {!isEmpty && (
            <circle
              className="gauge-card__value"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          )}
        </svg>

        <div className="gauge-card__centre">
          {/*
            Long readouts (a formatted Pc runs to ~10 glyphs) get a smaller
            step so they fit inside the ring. Clipping a probability mid-
            exponent turns 4.66x10^-5 into 4.66x10^-, which reads as a
            different number entirely.
          */}
          <span
            className={`gauge-card__readout ui-readout${
              readout.length > 6 ? ' gauge-card__readout--long' : ''
            }`}
          >
            {readout}
          </span>
          {unit && <span className="gauge-card__unit">{unit}</span>}
        </div>
      </div>

      {footnote && <span className="gauge-card__footnote">{footnote}</span>}
    </div>
  )
}

export default GaugeCard
