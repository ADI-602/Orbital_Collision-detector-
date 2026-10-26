/**
 * objectType.test.js — the name-based object classifier.
 *
 * This is a display heuristic, and its job is to pick a marker shape. The
 * tests that matter are the ones pinning it as a heuristic: real catalogue
 * names it must get right, and the ordering rule that keeps "SL-16 R/B DEB"
 * from being drawn as an intact rocket body.
 */

import { describe, expect, it } from 'vitest'

import {
  OBJECT_KIND,
  classifyObject,
  markerShape,
  objectKindLabel,
} from './objectType.js'

describe('classifyObject', () => {
  it('reads debris off the CelesTrak DEB suffix', () => {
    // Real names from the cosmos-2251-debris and iridium-33-debris groups.
    expect(classifyObject('COSMOS 2251 DEB')).toBe(OBJECT_KIND.DEBRIS)
    expect(classifyObject('IRIDIUM 33 DEB')).toBe(OBJECT_KIND.DEBRIS)
  })

  it('reads a rocket body off the R/B suffix', () => {
    expect(classifyObject('SL-16 R/B')).toBe(OBJECT_KIND.ROCKET_BODY)
    expect(classifyObject('DELTA 1 R/B')).toBe(OBJECT_KIND.ROCKET_BODY)
  })

  it('treats an unsuffixed name as a payload', () => {
    expect(classifyObject('ISS (ZARYA)')).toBe(OBJECT_KIND.PAYLOAD)
    expect(classifyObject('ENVISAT')).toBe(OBJECT_KIND.PAYLOAD)
    expect(classifyObject('IRIDIUM 33')).toBe(OBJECT_KIND.PAYLOAD)
  })

  it('calls debris from a rocket body debris, not a rocket body', () => {
    // Both markers are present. The object is a fragment, so it must not be
    // drawn as an intact upper stage.
    expect(classifyObject('SL-16 R/B DEB')).toBe(OBJECT_KIND.DEBRIS)
  })

  it('does not match DEB inside an unrelated word', () => {
    // Word-boundary matching, so a name that merely contains the letters is
    // not misclassified.
    expect(classifyObject('DEBUT SAT')).toBe(OBJECT_KIND.PAYLOAD)
  })

  it('returns unknown rather than guessing for a missing name', () => {
    expect(classifyObject('')).toBe(OBJECT_KIND.UNKNOWN)
    expect(classifyObject('   ')).toBe(OBJECT_KIND.UNKNOWN)
    expect(classifyObject(undefined)).toBe(OBJECT_KIND.UNKNOWN)
    expect(classifyObject(null)).toBe(OBJECT_KIND.UNKNOWN)
    expect(classifyObject(42)).toBe(OBJECT_KIND.UNKNOWN)
  })

  it('is case insensitive', () => {
    expect(classifyObject('cosmos 2251 deb')).toBe(OBJECT_KIND.DEBRIS)
    expect(classifyObject('sl-16 r/b')).toBe(OBJECT_KIND.ROCKET_BODY)
  })
})

describe('objectKindLabel', () => {
  it('names every kind', () => {
    expect(objectKindLabel(OBJECT_KIND.PAYLOAD)).toBe('Payload')
    expect(objectKindLabel(OBJECT_KIND.DEBRIS)).toBe('Debris')
    expect(objectKindLabel(OBJECT_KIND.ROCKET_BODY)).toBe('Rocket body')
  })

  it('says unclassified rather than inventing a type', () => {
    expect(objectKindLabel(OBJECT_KIND.UNKNOWN)).toBe('Unclassified')
    expect(objectKindLabel('nonsense')).toBe('Unclassified')
  })
})

describe('markerShape', () => {
  it('gives every kind a distinct geometry', () => {
    const kinds = [
      OBJECT_KIND.PAYLOAD,
      OBJECT_KIND.DEBRIS,
      OBJECT_KIND.ROCKET_BODY,
      OBJECT_KIND.UNKNOWN,
    ]
    const signatures = kinds.map((k) => {
      const s = markerShape(k)
      return `${s.sides}:${s.size}:${s.rotation.toFixed(3)}`
    })
    expect(new Set(signatures).size).toBe(kinds.length)
  })

  it('carries no colour', () => {
    // Colour belongs to the risk scale (styles/tokens.css). If a colour ever
    // appears here it will compete with the threat indication on the globe.
    for (const kind of Object.values(OBJECT_KIND)) {
      expect(Object.keys(markerShape(kind)).sort()).toEqual([
        'rotation',
        'sides',
        'size',
      ])
    }
  })

  it('returns a usable shape for an unrecognised kind', () => {
    const shape = markerShape('nonsense')
    expect(shape.size).toBeGreaterThan(0)
    expect(Number.isFinite(shape.sides)).toBe(true)
  })
})
