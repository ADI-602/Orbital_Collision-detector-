import './OrbitSwatch.css'

/**
 * A short line in an object's orbit colour and dash style. Placed beside the
 * object's name, it is the legend for the rings on the globe.
 *
 * @param {object} props
 * @param {'primary'|'secondary'} props.role
 */
function OrbitSwatch({ role }) {
  return <span className={`orbit-swatch orbit-swatch--${role}`} aria-hidden="true" />
}

export default OrbitSwatch
