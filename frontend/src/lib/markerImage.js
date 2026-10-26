/**
 * markerImage.js — canvas marker sprites for the globe, one per shape+colour.
 *
 * Cesium's `point` graphic draws only circles, so distinguishing a payload
 * from a debris fragment needs a billboard with an image. Generating those
 * images in a canvas keeps them crisp at any size and avoids shipping assets.
 *
 * CACHED BY KEY, and that matters at scale. The tracked set can be several
 * hundred objects; building a canvas per entity per frame would allocate
 * thousands of images a second. There are only a handful of distinct
 * shape/colour combinations, so they are built once and reused.
 *
 * Shape carries object type; colour carries risk. See lib/objectType.js for
 * why those two axes are kept separate.
 */

import { markerShape } from './objectType.js'

/** key -> HTMLCanvasElement. Small and bounded: kinds x colours in use. */
const cache = new Map()

/** Drawn at 2x and displayed at 1x so markers stay sharp on a HiDPI projector. */
const SUPERSAMPLE = 2

/**
 * Trace a regular polygon, or a circle when `sides` is 0.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} sides  0 for a circle
 * @param {number} rotation radians
 */
function tracePolygon(ctx, cx, cy, radius, sides, rotation) {
  ctx.beginPath()
  if (!sides || sides < 3) {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    return
  }
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i * 2 * Math.PI) / sides - Math.PI / 2
    const x = cx + radius * Math.cos(angle)
    const y = cy + radius * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/**
 * A marker sprite for one object kind in one colour.
 *
 * Filled shape plus a darker outline, so a marker stays visible against both
 * the bright limb of the Earth and the black of space — the two backgrounds
 * every object crosses each orbit.
 *
 * @param {string} kind      from lib/objectType.js
 * @param {string} colorHex  CSS colour, e.g. '#f43f5e'
 * @param {number} [scale]   multiplier on the kind's base size
 * @returns {HTMLCanvasElement}
 */
export function markerImage(kind, colorHex, scale = 1) {
  const key = `${kind}|${colorHex}|${scale}`
  const hit = cache.get(key)
  if (hit) return hit

  const { sides, size, rotation } = markerShape(kind)
  const radius = size * scale
  // Room for the outline and a little anti-aliasing bleed.
  const extent = Math.ceil((radius + 1.5) * 2 * SUPERSAMPLE)

  const canvas = document.createElement('canvas')
  canvas.width = extent
  canvas.height = extent

  const ctx = canvas.getContext('2d')
  const centre = extent / 2

  ctx.lineJoin = 'round'
  tracePolygon(ctx, centre, centre, radius * SUPERSAMPLE, sides, rotation)
  ctx.fillStyle = colorHex
  ctx.fill()
  ctx.lineWidth = 1.0 * SUPERSAMPLE
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.stroke()

  cache.set(key, canvas)
  return canvas
}

/** Displayed width for a sprite built by markerImage, in CSS pixels. */
export function markerPixelSize(kind, scale = 1) {
  const { size } = markerShape(kind)
  return (size * scale + 1.5) * 2
}

/** Test/teardown hook: drop every cached sprite. */
export function clearMarkerCache() {
  cache.clear()
}
