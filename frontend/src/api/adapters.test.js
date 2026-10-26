/**
 * Unit tests for the physics -> AI boundary adapters.
 *
 * These cover exactly the renames and unit conversions that would otherwise
 * corrupt a demo number silently: a dropped tca, a flipped recommendation, a
 * hard-body radius off by 1000x.
 */

import { describe, it, expect } from 'vitest'

import {
  HARD_BODY_RADIUS_KM,
  HARD_BODY_RADIUS_M,
  maneuverResultToManeuverOption,
  screeningEventToConjunctionContext,
  tcaResultToConjunctionContext,
} from './adapters.js'

/** Shaped exactly like backend/api/main.py:227-234. */
const screeningEvent = {
  secondary_name: 'ZENITH-2 DEBRIS',
  tca_utc_iso: '2004-10-22T05:10:35Z',
  miss_distance_m: 112.4,
  pc: 0.00014,
  relative_speed_km_s: 9.81,
  threat_level: 'RED',
}

/** Shaped exactly like backend/api/main.py:280-292. */
const maneuverResult = {
  primary_name: 'ENVISAT',
  secondary_name: 'ZENITH-2 DEBRIS',
  delta_v_cm_s: -4.0,
  lead_time_minutes: 50.0,
  pre_burn_miss_distance_m: 112.4,
  post_burn_miss_distance_m: 1240.5,
  pre_burn_pc: 0.00014,
  post_burn_pc: 3.2e-7,
  risk_reduction_pct: 99.8,
  fuel_consumed_kg: 0.076,
  maneuver_recommended: true,
}

describe('hard-body radius', () => {
  it('converts the physics layer kilometres to the AI schema metres', () => {
    expect(HARD_BODY_RADIUS_KM).toBe(0.0145)
    expect(HARD_BODY_RADIUS_M).toBe(14.5)
  })
})

describe('screeningEventToConjunctionContext', () => {
  const ctx = screeningEventToConjunctionContext(screeningEvent, 'ENVISAT')

  it('renames tca_utc_iso to tca_iso', () => {
    expect(ctx.tca_iso).toBe('2004-10-22T05:10:35Z')
    expect(ctx).not.toHaveProperty('tca_utc_iso')
  })

  it('maps pc to pre_burn_pc without altering the value', () => {
    expect(ctx.pre_burn_pc).toBe(screeningEvent.pc)
  })

  it('carries miss distance and relative speed through unchanged', () => {
    expect(ctx.miss_distance_m).toBe(112.4)
    expect(ctx.relative_speed_km_s).toBe(9.81)
  })

  it('supplies the hard-body radius in metres', () => {
    expect(ctx.hard_body_radius_m).toBe(14.5)
  })

  it('names both objects', () => {
    expect(ctx.primary_name).toBe('ENVISAT')
    expect(ctx.secondary_name).toBe('ZENITH-2 DEBRIS')
  })

  it('does not leak the threat_level UI concern into the AI payload', () => {
    expect(ctx).not.toHaveProperty('threat_level')
  })

  it('honours explicit overrides', () => {
    const withAlt = screeningEventToConjunctionContext(screeningEvent, 'ENVISAT', {
      primary_alt_km: 785.2,
    })
    expect(withAlt.primary_alt_km).toBe(785.2)
  })
})

describe('tcaResultToConjunctionContext', () => {
  const tca = {
    tca_utc_iso: '2004-10-22T05:10:35Z',
    miss_distance_m: 112.4,
    miss_distance_km: 0.1124,
    relative_speed_km_s: 9.81,
    primary_pos_eci_km: [1, 2, 3],
    secondary_pos_eci_km: [1, 2, 3],
  }

  it('builds a context when a real Pc is supplied', () => {
    const ctx = tcaResultToConjunctionContext(tca, {
      primary_name: 'ENVISAT',
      secondary_name: 'ZENITH-2 DEBRIS',
      pc: 0.00014,
    })

    expect(ctx.tca_iso).toBe('2004-10-22T05:10:35Z')
    expect(ctx.pre_burn_pc).toBe(0.00014)
    expect(ctx.miss_distance_m).toBe(112.4)
  })

  it('refuses to fabricate a Pc when none is supplied', () => {
    // /api/physics/tca returns no Pc. Defaulting one here would put an
    // invented probability in front of the AI layer.
    expect(() =>
      tcaResultToConjunctionContext(tca, {
        primary_name: 'ENVISAT',
        secondary_name: 'ZENITH-2 DEBRIS',
      }),
    ).toThrow(TypeError)
  })

  it('refuses a NaN Pc', () => {
    expect(() =>
      tcaResultToConjunctionContext(tca, {
        primary_name: 'ENVISAT',
        secondary_name: 'ZENITH-2 DEBRIS',
        pc: Number.NaN,
      }),
    ).toThrow(TypeError)
  })
})

describe('maneuverResultToManeuverOption', () => {
  const option = maneuverResultToManeuverOption(maneuverResult)

  it('renames maneuver_recommended to recommended', () => {
    expect(option.recommended).toBe(true)
    expect(option).not.toHaveProperty('maneuver_recommended')
  })

  it('drops pre-burn values, which belong to the conjunction not the burn', () => {
    expect(option).not.toHaveProperty('pre_burn_pc')
    expect(option).not.toHaveProperty('pre_burn_miss_distance_m')
  })

  it('drops the object names', () => {
    expect(option).not.toHaveProperty('primary_name')
    expect(option).not.toHaveProperty('secondary_name')
  })

  it('carries every post-burn number through unchanged', () => {
    expect(option.delta_v_cm_s).toBe(-4.0)
    expect(option.lead_time_minutes).toBe(50.0)
    expect(option.post_burn_miss_distance_m).toBe(1240.5)
    expect(option.post_burn_pc).toBe(3.2e-7)
    expect(option.risk_reduction_pct).toBe(99.8)
    expect(option.fuel_consumed_kg).toBe(0.076)
  })

  it('produces exactly the seven fields ManeuverOption requires', () => {
    expect(Object.keys(option).sort()).toEqual([
      'delta_v_cm_s',
      'fuel_consumed_kg',
      'lead_time_minutes',
      'post_burn_miss_distance_m',
      'post_burn_pc',
      'recommended',
      'risk_reduction_pct',
    ])
  })
})
