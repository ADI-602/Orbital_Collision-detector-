import './SelectedObjectPanel.css'

/**
 * Format a signed degree value with a fixed width so the readout does not
 * jitter as the satellite moves.
 */
function deg(value) {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(3)}°`
}

/**
 * Details for the satellite the operator clicked on the globe or found by
 * search.
 *
 * Every value shown here is propagated by SGP4 from a real TLE for the
 * current simulated instant — see the boundary note in useLiveSatellites.js.
 * These are ephemeris positions, NOT a conjunction assessment; the panel is
 * careful not to imply otherwise.
 *
 * Compact on purpose: it shares the right rail with the selected event and the
 * AI advisor, and five full-width rows pushed the advisor off a laptop screen.
 *
 * @param {object} props
 * @param {object|null} props.satellite propagated LiveSatellite, or null
 */
function SelectedObjectPanel({ satellite }) {
  if (!satellite) {
    return (
      <div className="selected-object selected-object--empty">
        <span className="selected-object__empty-title">No object selected</span>
        <span className="selected-object__empty-hint">
          Click a satellite on the globe, or find one by name in Tracking.
        </span>
      </div>
    )
  }

  const stats = [
    ['Latitude', deg(satellite.latitude_deg)],
    ['Longitude', deg(satellite.longitude_deg)],
    ['Altitude', `${satellite.altitude_km.toFixed(1)} km`],
  ]

  return (
    <div className="selected-object">
      <div className="selected-object__id">
        <span className="selected-object__name">{satellite.name}</span>
        <span className="selected-object__norad ui-readout" title="NORAD catalogue number">
          {satellite.noradId}
        </span>
      </div>
      <dl className="selected-object__stats">
        {stats.map(([label, value]) => (
          <div className="selected-object__stat" key={label}>
            <dt className="selected-object__key">{label}</dt>
            <dd className="selected-object__val ui-readout">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="selected-object__note">Live TLE position — not a conjunction assessment.</p>
    </div>
  )
}

export default SelectedObjectPanel
