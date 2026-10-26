import { describe, expect, it } from 'vitest'

import { adviceProvenance, adviceRefusal, buildAdviceRequest } from './advice.js'

const EVENT = {
  secondary_name: 'ZENITH-2 DEB',
  tca_utc_iso: '2004-10-22T05:10:00Z',
  miss_distance_m: 268.9,
  pc: 6.59e-4,
  relative_speed_km_s: 14.8,
}

describe('buildAdviceRequest', () => {
  it('passes the pipeline numbers through unchanged', () => {
    const req = buildAdviceRequest(EVENT, 'ENVISAT')
    expect(req.conjunction.pre_burn_pc).toBe(6.59e-4)
    expect(req.conjunction.miss_distance_m).toBe(268.9)
    expect(req.conjunction.tca_iso).toBe('2004-10-22T05:10:00Z')
    expect(req.maneuvers).toEqual([])
  })

  it('includes a maneuver option only when one was simulated', () => {
    const req = buildAdviceRequest(EVENT, 'ENVISAT', {
      delta_v_cm_s: -4,
      lead_time_minutes: 50,
      post_burn_miss_distance_m: 658,
      post_burn_pc: 1e-6,
      risk_reduction_pct: 99.8,
      fuel_consumed_kg: 0.2,
      maneuver_recommended: true,
    })
    expect(req.maneuvers).toHaveLength(1)
    expect(req.maneuvers[0].post_burn_pc).toBe(1e-6)
    expect(req.maneuvers[0].recommended).toBe(true)
  })

  it('passes every compared burn, in order, with its own figures', () => {
    const burn = (dv, pc) => ({
      delta_v_cm_s: dv,
      lead_time_minutes: 50,
      post_burn_miss_distance_m: 500,
      post_burn_pc: pc,
      risk_reduction_pct: 90,
      fuel_consumed_kg: 0.1,
      maneuver_recommended: true,
    })
    const req = buildAdviceRequest(EVENT, 'ENVISAT', [burn(-2, 3e-4), null, burn(-8, 1e-6)])
    expect(req.maneuvers.map((m) => m.delta_v_cm_s)).toEqual([-2, -8])
    expect(req.maneuvers.map((m) => m.post_burn_pc)).toEqual([3e-4, 1e-6])
  })
})

describe('adviceRefusal', () => {
  it('allows a fully computed event', () => {
    expect(adviceRefusal(EVENT)).toBeNull()
  })

  it('refuses missing figures rather than defaulting them', () => {
    expect(adviceRefusal({ ...EVENT, pc: undefined })).toMatch(/collision probability/)
    expect(adviceRefusal({ ...EVENT, miss_distance_m: NaN })).toMatch(/miss distance/)
    expect(adviceRefusal({ ...EVENT, tca_utc_iso: null })).toMatch(/closest approach/)
  })

  it('refuses an unassessable pair', () => {
    expect(adviceRefusal({ ...EVENT, unassessable: true })).toMatch(/declined/)
  })
})

describe('adviceProvenance', () => {
  it('is live only for is_fallback === false', () => {
    expect(adviceProvenance({ is_fallback: false }).live).toBe(true)
    expect(adviceProvenance({ is_fallback: true }).live).toBe(false)
    expect(adviceProvenance({}).live).toBe(false)
    expect(adviceProvenance({ is_fallback: 'false' }).live).toBe(false)
    expect(adviceProvenance(null).live).toBe(false)
  })
})
