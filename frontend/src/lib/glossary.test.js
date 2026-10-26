import { describe, expect, it } from 'vitest'

import { THREAT_THRESHOLDS } from './conjunctions.js'
import { GLOSSARY } from './glossary.js'

describe('GLOSSARY', () => {
  it('gives every entry a term and a non-trivial definition', () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.term, key).toBeTruthy()
      expect(entry.definition.length, key).toBeGreaterThan(30)
    }
  })

  it('states the same thresholds the badges use', () => {
    const text = GLOSSARY.threatLevel.definition
    expect(text).toContain(THREAT_THRESHOLDS.RED.toExponential(0))
    expect(text).toContain(THREAT_THRESHOLDS.YELLOW.toExponential(0))
  })
})
