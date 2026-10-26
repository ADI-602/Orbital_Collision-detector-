import { describe, expect, it } from 'vitest'

import { clamp, resizedSize } from './panelResize.js'

const LIMITS = { minWidth: 200, maxWidth: 800, minHeight: 100, maxHeight: 600 }
const START = { width: 320, height: 300 }

describe('resizedSize', () => {
  it('grows an east edge to the right', () => {
    expect(resizedSize('e', START, 50, 0, LIMITS)).toEqual({ width: 370 })
  })

  it('grows a west edge to the left (right-anchored panel)', () => {
    expect(resizedSize('w', START, -50, 0, LIMITS)).toEqual({ width: 370 })
  })

  it('grows a north edge upwards (bottom-anchored panel)', () => {
    expect(resizedSize('n', START, 0, -40, LIMITS)).toEqual({ height: 340 })
  })

  it('grows a south edge downwards', () => {
    expect(resizedSize('s', START, 0, 40, LIMITS)).toEqual({ height: 340 })
  })

  it('touches only the axis the edge controls', () => {
    expect(resizedSize('e', START, 10, 999, LIMITS)).not.toHaveProperty('height')
    expect(resizedSize('s', START, 999, 10, LIMITS)).not.toHaveProperty('width')
  })

  it('clamps to the limits', () => {
    expect(resizedSize('e', START, -1000, 0, LIMITS)).toEqual({ width: 200 })
    expect(resizedSize('s', START, 0, 1000, LIMITS)).toEqual({ height: 600 })
  })
})

describe('clamp', () => {
  it('prefers the minimum when the viewport is smaller than it', () => {
    expect(clamp(50, 200, 150)).toBe(200)
  })
})
