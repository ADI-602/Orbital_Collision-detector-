/**
 * format.js — display formatting for physics readouts.
 *
 * Formatting only: these functions round for DISPLAY and never alter, clamp,
 * or substitute a value. Every one of them renders an em dash for a missing
 * number rather than a zero or a placeholder, because on a projector a
 * stand-in digit is indistinguishable from a computed one.
 *
 * Units are in the function names, not left to the caller to remember — the
 * physics layer mixes metres and kilometres (miss distance comes back as both)
 * and that is exactly where a silent unit slip would hide.
 */

const SUPERSCRIPTS = {
  '-': '⁻',
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
}

/** Render an integer as Unicode superscript digits. */
function superscript(n) {
  return String(n)
    .split('')
    .map((ch) => SUPERSCRIPTS[ch] ?? ch)
    .join('')
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Collision probability in the notation the literature uses: "2.74×10⁻⁴".
 *
 * @param {number|null|undefined} value
 * @param {number} [digits] mantissa decimal places
 * @returns {string}
 */
export function formatPc(value, digits = 2) {
  if (!isNumber(value)) return '—'
  if (value === 0) return '0'

  const exponent = Math.floor(Math.log10(Math.abs(value)))
  const mantissa = value / 10 ** exponent

  return `${mantissa.toFixed(digits)}×10${superscript(exponent)}`
}

/**
 * A power-of-ten axis label: 1e-4 -> "10⁻⁴".
 *
 * Only for exact decades — anything else would lose its mantissa silently, so
 * a non-decade falls through to the full formatPc form rather than rounding
 * itself into a tidier-looking lie.
 *
 * @param {number|null|undefined} value
 * @returns {string}
 */
export function formatDecade(value) {
  if (!isNumber(value) || value <= 0) return '—'

  const exponent = Math.log10(value)
  if (!Number.isInteger(exponent)) return formatPc(value)

  return `10${superscript(exponent)}`
}

/**
 * Miss distance in metres. Sub-kilometre encounters are the interesting ones,
 * so metres stay metres — converting to "0.27 km" would throw away the
 * resolution the whole event turns on.
 *
 * @param {number|null|undefined} value metres
 * @returns {string}
 */
export function formatMetres(value, digits = 1) {
  if (!isNumber(value)) return '—'
  return `${value.toFixed(digits)} m`
}

/**
 * Relative speed in km/s.
 *
 * @param {number|null|undefined} value km/s
 * @returns {string}
 */
export function formatKmPerSecond(value, digits = 2) {
  if (!isNumber(value)) return '—'
  return `${value.toFixed(digits)} km/s`
}

/**
 * Delta-V in cm/s, sign preserved — negative is a braking burn, and dropping
 * the sign would invert the manoeuvre being described.
 *
 * @param {number|null|undefined} value cm/s
 * @returns {string}
 */
export function formatDeltaV(value, digits = 1) {
  if (!isNumber(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)} cm/s`
}

/**
 * A percentage, e.g. risk reduction.
 *
 * @param {number|null|undefined} value already a percentage, not a fraction
 * @returns {string}
 */
export function formatPercent(value, digits = 1) {
  if (!isNumber(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/**
 * Propellant mass in kilograms.
 *
 * @param {number|null|undefined} value kg
 * @returns {string}
 */
export function formatKg(value, digits = 3) {
  if (!isNumber(value)) return '—'
  return `${value.toFixed(digits)} kg`
}
