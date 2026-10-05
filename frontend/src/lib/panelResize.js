/**
 * panelResize.js — pure size arithmetic for FloatingPanel's edge handles.
 *
 * Edges are compass letters. A panel anchored on the opposite side grows away
 * from its anchor, so dragging a west edge LEFT (negative dx) makes a
 * right-anchored panel wider, and dragging a north edge UP makes a
 * bottom-anchored panel taller.
 */

export const RESIZE_EDGES = ['n', 'e', 's', 'w']

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Size after dragging one edge by (dx, dy) from a starting size.
 *
 * @param {'n'|'e'|'s'|'w'} edge
 * @param {{width: number, height: number}} start size when the drag began, px
 * @param {number} dx pointer movement since the drag began, px
 * @param {number} dy
 * @param {{minWidth: number, maxWidth: number, minHeight: number, maxHeight: number}} limits
 * @returns {{width?: number, height?: number}} only the axis the edge controls
 */
export function resizedSize(edge, start, dx, dy, limits) {
  switch (edge) {
    case 'e':
      return { width: clamp(start.width + dx, limits.minWidth, limits.maxWidth) }
    case 'w':
      return { width: clamp(start.width - dx, limits.minWidth, limits.maxWidth) }
    case 's':
      return { height: clamp(start.height + dy, limits.minHeight, limits.maxHeight) }
    case 'n':
      return { height: clamp(start.height - dy, limits.minHeight, limits.maxHeight) }
    default:
      return {}
  }
}
