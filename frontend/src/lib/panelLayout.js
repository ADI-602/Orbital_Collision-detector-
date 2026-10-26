/**
 * panelLayout.js — the per-browser memory of floating-panel sizes, and the
 * one-click way to forget it.
 *
 * Layout memory is per browser, so a laptop that was rehearsed on keeps
 * whatever was dragged or minimised there. Resetting puts every panel back to
 * the layout the page was designed and measured at, without a reload.
 */

/** localStorage key prefix for every panel's remembered size and state. */
export const PANEL_STORAGE_PREFIX = 'ora.panel.'

/** Broadcast to every mounted panel when the remembered layout is cleared. */
export const PANEL_RESET_EVENT = 'ora:reset-panel-layout'

/**
 * Remove every remembered panel entry from a Storage-like object, leaving
 * anything else in it alone.
 *
 * Keys are collected before removal: removing while iterating by index would
 * shift the indices and skip entries.
 *
 * @param {Pick<Storage, 'length' | 'key' | 'removeItem'>} storage
 * @returns {number} how many entries were removed
 */
export function clearStoredPanelLayout(storage) {
  const keys = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key?.startsWith(PANEL_STORAGE_PREFIX)) keys.push(key)
  }
  keys.forEach((key) => storage.removeItem(key))
  return keys.length
}

/** Forget the remembered layout and reset every mounted panel. */
export function resetPanelLayout() {
  try {
    clearStoredPanelLayout(window.localStorage)
  } catch {
    // Storage unavailable: there is nothing remembered to clear.
  }
  window.dispatchEvent(new Event(PANEL_RESET_EVENT))
}
