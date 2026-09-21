import { describe, expect, it } from 'vitest'

import { LABEL_EDGE_MARGIN_PX, shouldFlipLabel } from './labelPlacement.js'

describe('shouldFlipLabel', () => {
  it('leaves a label on the right out in open canvas', () => {
    expect(shouldFlipLabel(400, 1200)).toBe(false)
  })

  it('flips a label inside the right margin', () => {
    expect(shouldFlipLabel(1150, 1200)).toBe(true)
  })

  it('does not flip exactly at the margin boundary', () => {
    expect(shouldFlipLabel(1200 - LABEL_EDGE_MARGIN_PX, 1200)).toBe(false)
  })

  it('flips one pixel past the boundary', () => {
    expect(shouldFlipLabel(1200 - LABEL_EDGE_MARGIN_PX + 1, 1200)).toBe(true)
  })

  // A point that did not project has no screen position to reason about.
  // Flipping on it would make labels jump for reasons a viewer cannot see.
  it.each([null, undefined, Number.NaN])('does not flip on an unprojected point (%s)', (x) => {
    expect(shouldFlipLabel(x, 1200)).toBe(false)
  })

  it('does not flip before the canvas has been measured', () => {
    expect(shouldFlipLabel(100, 0)).toBe(false)
  })

  // A narrow canvas is legitimately all margin; flipping everything is the
  // right answer there, not an edge case to suppress.
  it('flips everything on a canvas narrower than the margin', () => {
    expect(shouldFlipLabel(10, 80)).toBe(true)
  })
})
