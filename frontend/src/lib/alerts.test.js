import { describe, expect, it } from 'vitest'

import {
  SEEN_RETENTION_MS,
  TCA_MATCH_TOLERANCE_MS,
  findNewAlerts,
  isAlertable,
  markSeen,
  pairKey,
  parseSeen,
} from './alerts.js'
import { EVENT_ORIGIN } from './conjunctions.js'

const TCA = '2026-10-06T12:00:00Z'
const TCA_MS = Date.parse(TCA)

const live = (over = {}) => ({
  origin: EVENT_ORIGIN.LIVE,
  primary_id: '22675',
  secondary_id: '34427',
  primary_name: 'COSMOS 2251 DEB',
  secondary_name: 'COSMOS 2251 DEB',
  threat_level: 'YELLOW',
  pc: 2.67e-5,
  miss_distance_m: 1770,
  relative_speed_km_s: 11.2,
  tca_utc_iso: TCA,
  ...over,
})

describe('isAlertable', () => {
  it('alerts on live RED and YELLOW events', () => {
    expect(isAlertable(live({ threat_level: 'RED' }))).toBe(true)
    expect(isAlertable(live({ threat_level: 'YELLOW' }))).toBe(true)
  })

  it('does not alert on GREEN', () => {
    expect(isAlertable(live({ threat_level: 'GREEN' }))).toBe(false)
  })

  it('never alerts on the injected 2004 validation case', () => {
    expect(isAlertable(live({ origin: EVENT_ORIGIN.VALIDATION, threat_level: 'RED' }))).toBe(false)
  })

  it('never alerts on a pair the pipeline declined to assess', () => {
    expect(isAlertable(live({ unassessable: true, threat_level: 'RED' }))).toBe(false)
  })

  it('needs a real TCA', () => {
    expect(isAlertable(live({ tca_utc_iso: null }))).toBe(false)
  })
})

describe('findNewAlerts', () => {
  it('treats the same pair at a slightly re-refined TCA as the same encounter', () => {
    const seen = markSeen([], [live()], TCA_MS)
    const refined = live({ tca_utc_iso: new Date(TCA_MS + 4000).toISOString() })
    expect(findNewAlerts([refined], seen)).toEqual([])
  })

  it('treats the same pair at a different TCA as a new encounter', () => {
    const seen = markSeen([], [live()], TCA_MS)
    const later = live({ tca_utc_iso: new Date(TCA_MS + TCA_MATCH_TOLERANCE_MS + 60000).toISOString() })
    expect(findNewAlerts([later], seen)).toHaveLength(1)
  })

  it('matches a pair regardless of which object is primary', () => {
    const seen = markSeen([], [live()], TCA_MS)
    const swapped = live({ primary_id: '34427', secondary_id: '22675' })
    expect(findNewAlerts([swapped], seen)).toEqual([])
  })

  it('keeps the incoming order and skips non-alertable events', () => {
    const red = live({ threat_level: 'RED', secondary_id: '1' })
    const green = live({ threat_level: 'GREEN', secondary_id: '2' })
    const yellow = live({ secondary_id: '3' })
    expect(findNewAlerts([red, green, yellow], []).map((e) => e.secondary_id)).toEqual(['1', '3'])
  })
})

describe('markSeen', () => {
  it('forgets encounters long past their TCA', () => {
    const seen = markSeen([], [live()], TCA_MS)
    expect(markSeen(seen, [], TCA_MS + SEEN_RETENTION_MS + 1)).toEqual([])
  })

  it('does not duplicate an encounter already recorded', () => {
    const seen = markSeen([], [live()], TCA_MS)
    expect(markSeen(seen, [live()], TCA_MS)).toHaveLength(1)
  })
})

describe('pairKey / parseSeen', () => {
  it('is order-independent', () => {
    expect(pairKey({ primary_id: 'b', secondary_id: 'a' })).toBe(pairKey({ primary_id: 'a', secondary_id: 'b' }))
  })

  it('drops malformed stored entries', () => {
    expect(parseSeen('not json')).toEqual([])
    expect(parseSeen('{"a":1}')).toEqual([])
    expect(parseSeen('[{"pair":"a|b","tcaMs":5},{"pair":3},null]')).toEqual([{ pair: 'a|b', tcaMs: 5 }])
  })
})
