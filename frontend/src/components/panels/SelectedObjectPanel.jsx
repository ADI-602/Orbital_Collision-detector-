import './SelectedObjectPanel.css'

/**
 * Format a signed degree value with a fixed width so the readout does not
 * jitter as the satellite moves.
 */
function deg(value) {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(3)}°`
}

/**
 * Details for the satellite the operator clicked on the globe.
 *
 * Every value shown here is propagated by SGP4 from a real TLE for the
 * current simulated instant — see the boundary note in useLiveSatellites.js.
 * These are ephemeris positions, NOT a conjunction assessment; the panel is
 * careful not to imply otherwise.
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
          Click a satellite on the globe to inspect its live position.
        </span>
      </div>
    )
  }

  const rows = [
    ['Object', satellite.name],
    ['NORAD ID', satellite.noradId],
    ['Latitude', deg(satellite.latitude_deg)],
    ['Longitude', deg(satellite.longitude_deg)],
    ['Altitude', `${satellite.altitude_km.toFixed(1)} km`],
  ]

  return (
    <div className="selected-object">
      {rows.map(([label, value]) => (
        <div className="selected-object__row" key={label}>
          <span className="selected-object__key">{label}</span>
          <span className="selected-object__val ui-readout">{value}</span>
        </div>
      ))}
      <p className="selected-object__note">
        Ephemeris from CelesTrak TLE, propagated client-side. Not a conjunction
        assessment.
      </p>
    </div>
  )
}

export default SelectedObjectPanel
