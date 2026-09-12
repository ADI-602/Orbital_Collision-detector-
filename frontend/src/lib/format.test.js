import { describe, it, expect } from 'vitest'

import {
  formatDecade,
  formatDeltaV,
  formatKg,
  formatKmPerSecond,
  formatMetres,
  formatPc,
  formatPercent,
} from './format.js'

describe('formatPc', () => {
  it('renders probabilities the way the literature writes them', () => {
    expect(formatPc(2.74e-4)).toBe('2.74×10⁻⁴')
    expect(formatPc(1.93e-3)).toBe('1.93×10⁻³')
    expect(formatPc(1e-4)).toBe('1.00×10⁻⁴')
  })

  it('keeps the exponent right across a decade boundary', () => {
    expect(formatPc(9.99e-4)).toBe('9.99×10⁻⁴')
    expect(formatPc(1.001e-3)).toBe('1.00×10⁻³')
  })

  it('renders an em dash for a value that does not exist', () => {
    expect(formatPc(null)).toBe('—')
    expect(formatPc(undefined)).toBe('—')
    expect(formatPc(Number.NaN)).toBe('—')
    expect(formatPc('0.0001')).toBe('—')
  })

  it('renders an exact zero as zero, not as an exponent', () => {
    expect(formatPc(0)).toBe('0')
  })
})

describe('unit formatters', () => {
  it('keeps miss distance in metres at sub-kilometre resolution', () => {
    expect(formatMetres(268.9094974690535)).toBe('268.9 m')
    expect(formatMetres(81)).toBe('81.0 m')
  })

  it('formats relative speed and propellant', () => {
    expect(formatKmPerSecond(14.8)).toBe('14.80 km/s')
    expect(formatKg(0.15202900787223417)).toBe('0.152 kg')
  })

  it('preserves the sign of a delta-V, since it names the burn direction', () => {
    expect(formatDeltaV(-4)).toBe('-4.0 cm/s')
    expect(formatDeltaV(3.9)).toBe('+3.9 cm/s')
  })

  it('formats a percentage', () => {
    expect(formatPercent(91.36500750506575)).toBe('91.4%')
  })

  it('em-dashes every missing value rather than substituting a zero', () => {
    expect(formatMetres(null)).toBe('—')
    expect(formatKmPerSecond(undefined)).toBe('—')
    expect(formatDeltaV(Number.NaN)).toBe('—')
    expect(formatPercent(null)).toBe('—')
    expect(formatKg(null)).toBe('—')
  })
})

describe('formatDecade', () => {
  it('renders exact powers of ten as bare decades', () => {
    expect(formatDecade(1e-4)).toBe('10\u207b\u2074')
    expect(formatDecade(1e-3)).toBe('10\u207b\u00b3')
    expect(formatDecade(1)).toBe('10\u2070')
  })

  it('falls back to the full form rather than dropping a mantissa', () => {
    // 5.5e-4 is not a decade; rendering it as "10⁻⁴" would silently lose the
    // 5.5 and misplace the label on a log axis.
    expect(formatDecade(5.5e-4)).toBe('5.50\u00d710\u207b\u2074')
  })

  it('em-dashes values a log axis cannot place', () => {
    expect(formatDecade(0)).toBe('—')
    expect(formatDecade(-1e-4)).toBe('—')
    expect(formatDecade(null)).toBe('—')
  })
})
