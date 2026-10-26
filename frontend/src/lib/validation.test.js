import { describe, expect, it } from 'vitest'

import { formatRange, validationBadge } from './validation.js'

describe('validationBadge', () => {
  it('says validated only when the server reported a pass', () => {
    expect(validationBadge('ready', { passed: true })).toEqual({ tone: 'passed', text: 'Validated' })
  })

  it('says failed when the server reported a fail', () => {
    expect(validationBadge('ready', { passed: false }).tone).toBe('failed')
  })

  it('never treats a missing or odd flag as a pass', () => {
    expect(validationBadge('ready', {}).tone).toBe('failed')
    expect(validationBadge('ready', { passed: 'yes' }).tone).toBe('failed')
  })

  it('is neither pass nor fail while loading or unreachable', () => {
    expect(validationBadge('loading', null).tone).toBe('pending')
    expect(validationBadge('error', null)).toEqual({ tone: 'pending', text: 'Validation unavailable' })
  })
})

describe('formatRange', () => {
  it('formats a pair and refuses anything else', () => {
    expect(formatRange([100, 1000], (v) => `${v} m`)).toBe('100 m – 1000 m')
    expect(formatRange(null, String)).toBe('—')
    expect(formatRange([1], String)).toBe('—')
  })
})
