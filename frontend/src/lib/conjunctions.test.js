/**
 * conjunctions.test.js
 *
 * These tests exist because the display order and the co-orbital label are
 * both places where the UI could tell a lie about validated physics:
 *
 *  - the backend returns events sorted by COARSE separation
 *    (backend/physics/screening.py:499), so rendering them in wire order can
 *    put a GREEN event above a RED one;
 *  - the tracked set contains docked vehicles, which screen as sub-kilometre
 *    approaches and would otherwise render as RED conjunctions.
 *
 * Neither failure would crash anything — it would just be wrong on screen,
 * which is exactly the class of bug this project cannot afford.
 */

import { describe, it, expect } from 'vitest'

import {
  CO_ORBITAL_MAX_REL_SPEED_KM_S,
  EVENT_ORIGIN,
  classifyEncounter,
  eventKey,
  formatMissDistance,
  formatPc,
  formatRelativeSpeed,
  hasGlobePresence,
  isCoOrbital,
  isCoOrbitalRefusal,
  isNotARisk,
  isUnassessable,
  rankEvents,
  riskColorHex,
  splitTcaIso,
  unassessableEvent,
} from './conjunctions.js'

/**
 * Shaped exactly like the objects pushed at backend/api/main.py:227-234.
 * Values are the published Oct 22 2004 Envisat/Zenith-2 numbers the pipeline
 * reproduces (268.0 m, Pc 6.59e-4).
 */
const ENVISAT_EVENT = {
  secondary_name: 'ZENITH-2 DEB',
  tca_utc_iso: '2004-10-22T05:10:37Z',
  miss_distance_m: 268.9,
  pc: 6.59e-4,
  relative_speed_km_s: 14.8,
  threat_level: 'RED',
}

/** A docked cargo vehicle: real sub-km separation, but no relative motion. */
const DOCKED_EVENT = {
  secondary_name: 'PROGRESS MS-27',
  tca_utc_iso: '2026-08-31T12:00:00Z',
  miss_distance_m: 12.4,
  pc: 0.94,
  relative_speed_km_s: 0.004,
  threat_level: 'RED',
}

const GREEN_EVENT = {
  secondary_name: 'CSS (TIANHE)',
  tca_utc_iso: '2026-08-31T09:00:00Z',
  miss_distance_m: 4200,
  pc: 1e-9,
  relative_speed_km_s: 7.4,
  threat_level: 'GREEN',
}

/**
 * The verbatim 500 detail the screening route returns when compute_pc refuses
 * a stationary pair (backend/physics/collision_probability.py:234-237). Copied
 * from a live response, not paraphrased.
 */
const REFUSAL_DETAIL =
  'Screening failed: Relative velocity at TCA is effectively zero (0.00e+00 km/s). ' +
  'Cannot define a B-plane for a stationary conjunction.'

describe('isCoOrbitalRefusal', () => {
  it('recognises the B-plane refusal from the error detail', () => {
    expect(isCoOrbitalRefusal({ detail: REFUSAL_DETAIL })).toBe(true)
    expect(isCoOrbitalRefusal(new Error(REFUSAL_DETAIL))).toBe(true)
  })

  it('does not claim any other 500 is co-orbital', () => {
    // Relabelling a real break as "co-orbital" would hide a broken pipeline
    // behind a reassuring word — the whole point of matching narrowly.
    expect(isCoOrbitalRefusal({ detail: 'Screening failed: TLE parse error' })).toBe(false)
    expect(isCoOrbitalRefusal({ detail: 'Internal Server Error' })).toBe(false)
    expect(isCoOrbitalRefusal(undefined)).toBe(false)
    expect(isCoOrbitalRefusal({})).toBe(false)
  })
})

describe('unassessableEvent', () => {
  const row = unassessableEvent('POISK', 'ISS (ZARYA)', REFUSAL_DETAIL)

  it('carries no Pc, miss distance or TCA — there are none to carry', () => {
    expect(row.pc).toBeUndefined()
    expect(row.miss_distance_m).toBeUndefined()
    expect(row.tca_utc_iso).toBeUndefined()
    expect(row.threat_level).toBeUndefined()
  })

  it('quotes the backend reason verbatim', () => {
    expect(row.reason).toBe(REFUSAL_DETAIL)
  })

  it('is flagged unassessable and is not a risk', () => {
    expect(isUnassessable(row)).toBe(true)
    expect(isNotARisk(row)).toBe(true)
  })

  it('is not also reported as co-orbital — it has no relative speed to judge', () => {
    expect(isCoOrbital(row)).toBe(false)
  })

  it('defaults to the live origin and takes an override', () => {
    expect(row.origin).toBe(EVENT_ORIGIN.LIVE)
    expect(unassessableEvent('X', 'Y', 'r', EVENT_ORIGIN.VALIDATION).origin)
      .toBe(EVENT_ORIGIN.VALIDATION)
  })
})

describe('classifyEncounter', () => {
  it('calls a high relative speed a conjunction', () => {
    expect(classifyEncounter(ENVISAT_EVENT).kind).toBe('conjunction')
  })

  it('calls a near-zero relative speed co-orbital', () => {
    const { kind, reason } = classifyEncounter(DOCKED_EVENT)
    expect(kind).toBe('co-orbital')
    expect(reason).toMatch(/flying together/)
  })

  it('treats the cutoff itself as a conjunction — the test is strict below', () => {
    const atCutoff = { ...DOCKED_EVENT, relative_speed_km_s: CO_ORBITAL_MAX_REL_SPEED_KM_S }
    expect(classifyEncounter(atCutoff).kind).toBe('conjunction')
  })

  it('classifies just under the cutoff as co-orbital', () => {
    const under = { ...DOCKED_EVENT, relative_speed_km_s: CO_ORBITAL_MAX_REL_SPEED_KM_S - 1e-6 }
    expect(classifyEncounter(under).kind).toBe('co-orbital')
  })

  it('keeps the pipeline verdict when relative speed is missing', () => {
    // Defaulting to "co-orbital" here would silently downgrade a real threat.
    const { relative_speed_km_s, ...noSpeed } = ENVISAT_EVENT
    expect(relative_speed_km_s).toBeTypeOf('number')
    expect(classifyEncounter(noSpeed).kind).toBe('conjunction')
    expect(classifyEncounter({ ...ENVISAT_EVENT, relative_speed_km_s: NaN }).kind).toBe('conjunction')
  })

  it('is sign-agnostic — speed is a magnitude', () => {
    expect(isCoOrbital({ ...DOCKED_EVENT, relative_speed_km_s: -0.004 })).toBe(true)
  })
})

describe('rankEvents', () => {
  it('puts RED ahead of GREEN regardless of input order', () => {
    const ranked = rankEvents([GREEN_EVENT, ENVISAT_EVENT])
    expect(ranked.map((e) => e.secondary_name)).toEqual(['ZENITH-2 DEB', 'CSS (TIANHE)'])
  })

  it('sorts co-orbital pairs last even though their Pc is the highest', () => {
    // The docked pair carries Pc 0.94 — far above the Envisat event — but it
    // is not a risk statement, so it must not lead the list.
    const ranked = rankEvents([DOCKED_EVENT, GREEN_EVENT, ENVISAT_EVENT])
    expect(ranked.map((e) => e.secondary_name)).toEqual([
      'ZENITH-2 DEB',
      'CSS (TIANHE)',
      'PROGRESS MS-27',
    ])
  })

  it('breaks a threat-level tie by descending Pc', () => {
    const lower = { ...ENVISAT_EVENT, secondary_name: 'DEB A', pc: 1.1e-4 }
    const higher = { ...ENVISAT_EVENT, secondary_name: 'DEB B', pc: 9.9e-4 }
    expect(rankEvents([lower, higher]).map((e) => e.secondary_name)).toEqual(['DEB B', 'DEB A'])
  })

  it('breaks a Pc tie by earliest TCA', () => {
    const later = { ...ENVISAT_EVENT, secondary_name: 'DEB A', tca_utc_iso: '2004-10-22T06:00:00Z' }
    const sooner = { ...ENVISAT_EVENT, secondary_name: 'DEB B', tca_utc_iso: '2004-10-22T05:00:00Z' }
    expect(rankEvents([later, sooner]).map((e) => e.secondary_name)).toEqual(['DEB B', 'DEB A'])
  })

  it('is deterministic on full ties — same input, same order', () => {
    const a = { ...ENVISAT_EVENT, secondary_name: 'DEB B' }
    const b = { ...ENVISAT_EVENT, secondary_name: 'DEB A' }
    expect(rankEvents([a, b]).map((e) => e.secondary_name)).toEqual(['DEB A', 'DEB B'])
    expect(rankEvents([b, a]).map((e) => e.secondary_name)).toEqual(['DEB A', 'DEB B'])
  })

  it('does not mutate the array it is given', () => {
    const input = [GREEN_EVENT, ENVISAT_EVENT]
    const snapshot = [...input]
    rankEvents(input)
    expect(input).toEqual(snapshot)
  })

  it('ranks an unknown threat level below the known ones rather than above', () => {
    const weird = { ...GREEN_EVENT, secondary_name: 'DEB ?', threat_level: 'MAUVE', pc: 1 }
    expect(rankEvents([weird, GREEN_EVENT])[0].secondary_name).toBe('CSS (TIANHE)')
  })

  it('sorts unassessable pairs last, below real events', () => {
    const refused = unassessableEvent('POISK', 'ISS (ZARYA)', REFUSAL_DETAIL)
    const ranked = rankEvents([refused, GREEN_EVENT, ENVISAT_EVENT])
    expect(ranked.map((e) => e.secondary_name)).toEqual([
      'ZENITH-2 DEB',
      'CSS (TIANHE)',
      'POISK',
    ])
  })

  it('returns an empty array for a non-array input', () => {
    expect(rankEvents(undefined)).toEqual([])
    expect(rankEvents(null)).toEqual([])
  })
})

describe('isNotARisk', () => {
  it('covers both the refused and the merely co-orbital case', () => {
    expect(isNotARisk(unassessableEvent('POISK', 'ISS', REFUSAL_DETAIL))).toBe(true)
    expect(isNotARisk(DOCKED_EVENT)).toBe(true)
  })

  it('leaves a genuine conjunction alone', () => {
    expect(isNotARisk(ENVISAT_EVENT)).toBe(false)
    expect(isNotARisk(GREEN_EVENT)).toBe(false)
  })
})

describe('hasGlobePresence', () => {
  it('is true for a live event carrying both object ids', () => {
    const live = { ...ENVISAT_EVENT, origin: EVENT_ORIGIN.LIVE, primary_id: '25544', secondary_id: '49044' }
    expect(hasGlobePresence(live)).toBe(true)
  })

  it('is false for the injected event even with the same shape', () => {
    // The 2004 replay pair is never part of the live tracked set — carrying
    // ids would be a lie about what is actually on screen.
    const injected = { ...ENVISAT_EVENT, origin: EVENT_ORIGIN.VALIDATION, primary_id: '27386', secondary_id: '22437' }
    expect(hasGlobePresence(injected)).toBe(false)
  })

  it('is false for a live event missing an id', () => {
    expect(hasGlobePresence({ ...ENVISAT_EVENT, origin: EVENT_ORIGIN.LIVE, primary_id: '25544' })).toBe(false)
  })

  it('is false for null or undefined', () => {
    expect(hasGlobePresence(null)).toBe(false)
    expect(hasGlobePresence(undefined)).toBe(false)
  })
})

describe('riskColorHex', () => {
  it('follows the threat level for a genuine conjunction', () => {
    expect(riskColorHex(ENVISAT_EVENT)).toBe('#f43f5e')
    expect(riskColorHex(GREEN_EVENT)).toBe('#4ade80')
  })

  it('never uses a risk colour for a co-orbital or unassessable pair', () => {
    // Their Pc/threat_level is not a risk statement, so the globe must not
    // paint them red just because the backend happened to say RED.
    expect(riskColorHex(DOCKED_EVENT)).toBe('#71717a')
    const refused = unassessableEvent('POISK', 'ISS', 'irrelevant here')
    expect(riskColorHex(refused)).toBe('#71717a')
  })

  it('falls back to the neutral colour for an unrecognised threat level', () => {
    expect(riskColorHex({ ...GREEN_EVENT, threat_level: 'MAUVE' })).toBe('#71717a')
  })
})

describe('eventKey', () => {
  it('distinguishes two pairs that share a secondary and have no TCA', () => {
    // The regression this exists for. All-pairs screening
    // (backend/api/monitoring.py) reports ISS (ZARYA) x ISS (NAUKA) AND
    // POISK x ISS (NAUKA); both are refused as co-located, so neither carries
    // a TCA. A key built from the secondary and TCA alone collided, React
    // dropped one row, and selecting the survivor highlighted the wrong pair.
    const a = unassessableEvent('ISS (NAUKA)', 'ISS (ZARYA)', REFUSAL_DETAIL)
    const b = unassessableEvent('ISS (NAUKA)', 'POISK', REFUSAL_DETAIL)
    expect(eventKey(a)).not.toBe(eventKey(b))
  })

  it('prefers tracked-set ids over display names when both are present', () => {
    // Two catalogued objects can share a name; the id is the real identity.
    const a = { ...ENVISAT_EVENT, primary_id: '27386', secondary_id: '11962' }
    const b = { ...ENVISAT_EVENT, primary_id: '27386', secondary_id: '99999' }
    expect(eventKey(a)).not.toBe(eventKey(b))
  })

  it('distinguishes two origins carrying the same secondary name and TCA', () => {
    const live = { ...ENVISAT_EVENT, origin: EVENT_ORIGIN.LIVE }
    const injected = { ...ENVISAT_EVENT, origin: EVENT_ORIGIN.VALIDATION }
    expect(eventKey(live)).not.toBe(eventKey(injected))
  })

  it('is stable across identical events', () => {
    expect(eventKey({ ...ENVISAT_EVENT })).toBe(eventKey({ ...ENVISAT_EVENT }))
  })
})

describe('formatPc', () => {
  it('never renders a real Pc as zero', () => {
    // Fixed-point would print "0.00" here and read as no risk at all.
    expect(formatPc(1.93e-3)).toBe('1.93e-3')
    expect(formatPc(6.59e-4)).toBe('6.59e-4')
  })

  it('shows an exact zero as zero, and no number as an em dash', () => {
    expect(formatPc(0)).toBe('0')
    expect(formatPc(undefined)).toBe('—')
    expect(formatPc(NaN)).toBe('—')
  })
})

describe('formatMissDistance', () => {
  it('uses metres in the range where conjunctions are decided', () => {
    expect(formatMissDistance(268.9)).toBe('269 m')
  })

  it('switches to kilometres above 10 km', () => {
    expect(formatMissDistance(16000)).toBe('16.0 km')
  })

  it('renders a missing value as an em dash, not as 0 m', () => {
    expect(formatMissDistance(null)).toBe('—')
  })
})

describe('formatRelativeSpeed', () => {
  it('renders km/s to two decimals', () => {
    expect(formatRelativeSpeed(14.8)).toBe('14.80 km/s')
  })

  it('renders a missing value as an em dash', () => {
    expect(formatRelativeSpeed(undefined)).toBe('—')
  })
})

describe('splitTcaIso', () => {
  it('splits the backend wire format and keeps the Z', () => {
    expect(splitTcaIso('2004-10-22T05:10:37Z')).toEqual({
      date: '2004-10-22',
      time: '05:10:37Z',
      raw: '2004-10-22T05:10:37Z',
    })
  })

  it('refuses to guess at an unexpected shape', () => {
    // Reinterpreting a non-conforming string via Date would risk showing it in
    // the viewer's local timezone — a wrong time on stage.
    expect(splitTcaIso('yesterday')).toEqual({ date: '—', time: '—', raw: 'yesterday' })
    expect(splitTcaIso(undefined).date).toBe('—')
  })
})
