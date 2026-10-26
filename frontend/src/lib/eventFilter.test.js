import { describe, expect, it } from 'vitest'

import { countByCategory, eventCategory, filterEvents } from './eventFilter.js'

const red = { secondary_name: 'A', threat_level: 'RED', pc: 7.9e-4, relative_speed_km_s: 3.9 }
const yellow = { secondary_name: 'B', threat_level: 'YELLOW', pc: 8.8e-5, relative_speed_km_s: 5.3 }
const green = { secondary_name: 'C', threat_level: 'GREEN', pc: 1e-9, relative_speed_km_s: 7.4 }
// Docked pair: RED by Pc, but not a risk statement.
const docked = { secondary_name: 'D', threat_level: 'RED', pc: 0.94, relative_speed_km_s: 0.004 }
const refused = { secondary_name: 'E', unassessable: true, reason: 'co-located' }
const strange = { secondary_name: 'F', threat_level: 'PURPLE', pc: 1e-3, relative_speed_km_s: 9 }

describe('eventCategory', () => {
  it('uses the backend level for an assessed encounter', () => {
    expect(eventCategory(red)).toBe('RED')
    expect(eventCategory(yellow)).toBe('YELLOW')
    expect(eventCategory(green)).toBe('GREEN')
  })

  it('puts co-orbital and refused pairs in OTHER, never under a risk level', () => {
    expect(eventCategory(docked)).toBe('OTHER')
    expect(eventCategory(refused)).toBe('OTHER')
  })

  it('never folds an unrecognised level into GREEN', () => {
    expect(eventCategory(strange)).toBe('OTHER')
  })
})

describe('countByCategory', () => {
  it('counts every event exactly once', () => {
    const all = [red, yellow, green, docked, refused, strange]
    const counts = countByCategory(all)
    expect(counts).toEqual({ RED: 1, YELLOW: 1, GREEN: 1, OTHER: 3 })
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(all.length)
  })
})

describe('filterEvents', () => {
  const all = [red, docked, yellow, green, refused]

  it('returns everything when nothing is hidden', () => {
    expect(filterEvents(all, new Set())).toEqual(all)
  })

  it('hides only the chosen categories and keeps the order', () => {
    expect(filterEvents(all, new Set(['GREEN', 'OTHER']))).toEqual([red, yellow])
  })
})
