import { describe, expect, it } from 'vitest'

import { PANEL_STORAGE_PREFIX, clearStoredPanelLayout } from './panelLayout.js'

/** The slice of the Storage interface clearStoredPanelLayout uses. */
function fakeStorage(entries) {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  }
}

describe('clearStoredPanelLayout', () => {
  it('removes every panel entry, including adjacent ones', () => {
    // Adjacent keys are the case an index-based removal loop gets wrong.
    const storage = fakeStorage({
      [`${PANEL_STORAGE_PREFIX}console.ai`]: '{}',
      [`${PANEL_STORAGE_PREFIX}console.tracking`]: '{}',
      [`${PANEL_STORAGE_PREFIX}replay.esa`]: '{}',
    })
    expect(clearStoredPanelLayout(storage)).toBe(3)
    expect(storage.keys()).toEqual([])
  })

  it('leaves unrelated entries alone', () => {
    const storage = fakeStorage({
      'ora.alerts.seen': '[]',
      [`${PANEL_STORAGE_PREFIX}console.ai`]: '{}',
      'tle-cache': '{}',
    })
    expect(clearStoredPanelLayout(storage)).toBe(1)
    expect(storage.keys()).toEqual(['ora.alerts.seen', 'tle-cache'])
  })

  it('does nothing on an empty store', () => {
    expect(clearStoredPanelLayout(fakeStorage({}))).toBe(0)
  })
})
