/**
 * Label placement rules for the globe.
 *
 * Extracted from the render loop so the decisions can be tested without a
 * WebGL context — the loop itself only runs where Cesium can construct.
 */

/** Distance from the right edge, in CSS pixels, at which a label flips side. */
export const LABEL_EDGE_MARGIN_PX = 130

/**
 * Should a label sit to the LEFT of its marker rather than the right?
 *
 * Cesium clips labels at the canvas boundary instead of reflowing them, so a
 * satellite drifting toward the right edge gets its name sliced mid-word.
 *
 * A null `windowX` means the point did not project to the screen at all
 * (behind the camera, or the scene is not ready). That is not a reason to
 * flip — it is a reason to leave the label where it was.
 *
 * @param {number|null|undefined} windowX  projected x in CSS pixels
 * @param {number} canvasWidth             canvas width in CSS pixels
 * @param {number} [margin]
 * @returns {boolean}
 */
export function shouldFlipLabel(windowX, canvasWidth, margin = LABEL_EDGE_MARGIN_PX) {
  if (windowX == null || !Number.isFinite(windowX)) return false
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return false
  return windowX > canvasWidth - margin
}
