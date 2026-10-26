import './PillStat.css'

/**
 * Compact icon + label + value pill for the console's bottom status row.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.icon
 * @param {string} props.label
 * @param {import('react').ReactNode} props.value
 * @param {'accent'|'nominal'|'critical'|'dim'} [props.tone]
 * @param {string} [props.title]
 */
function PillStat({ icon, label, value, tone = 'accent', title }) {
  return (
    <div className={`pill-stat pill-stat--${tone}`} title={title}>
      <span className="pill-stat__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="pill-stat__text">
        <span className="pill-stat__label">{label}</span>
        <span className="pill-stat__value ui-readout">{value}</span>
      </span>
    </div>
  )
}

export default PillStat
