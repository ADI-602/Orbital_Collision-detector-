import { describe, expect, it } from 'vitest'

import {
  alignTrackToInstant,
  formatDeltaV,
  formatEncounterDistance,
  hasEncounterGeometry,
  niceScaleBarM,
  projectEncounter,
} from './maneuver.js'

/**
 * Tests for the encounter layout.
 *
 * The load-bearing property is that the projection is an ISOMETRY on the three
 * points it is given. The panel draws a few hundred metres to scale and puts a
 * scale bar beside it, so a viewer will read distances off the picture. If the
 * projection foreshortened anything, that reading would be wrong — and it would
 * be wrong in the one place this project cannot afford it, next to a validated
 * miss distance.
 *
 * Fixture is the real October 2004 encounter as this pipeline computes it:
 * ENVISAT vs a Zenith-2 fragment, 268 m becoming 556 m after a −4 cm/s burn.
 * The ECEF vectors below were captured from the pipeline's own tca_* output.
 */

// Captured from simulate_maneuver on the Oct 22 element sets with the historical
// burn (-4.0 cm/s, 50 min lead): 268.043 m becoming 556.226 m, a 389.259 m shift.
const PRE_BURN_KM = [2242.876580, 4549.543160, -5067.003959]
const POST_BURN_KM = [2242.786694, 4549.190824, -5067.142892]
const SECONDARY_KM = [2243.023437, 4549.693400, -5067.170417]

const distance3d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 1000

describe('projectEncounter', () => {
  it('preserves every distance between the three points', () => {
    // Three points define a plane; projecting them into that plane cannot
    // change the distances between them. This is the assertion the whole
    // drawn panel rests on.
    const layout = projectEncounter(PRE_BURN_KM, POST_BURN_KM, SECONDARY_KM)

    expect(layout.preBurnMissM).toBeCloseTo(distance3d(SECONDARY_KM, PRE_BURN_KM), 6)
    expect(layout.postBurnMissM).toBeCloseTo(distance3d(SECONDARY_KM, POST_BURN_KM), 6)
    expect(layout.burnShiftM).toBeCloseTo(distance3d(POST_BURN_KM, PRE_BURN_KM), 6)
  })

  it('reproduces the pipeline figures for the 2004 encounter', () => {
    // Sanity on the fixture itself, against the published pre-burn miss of
    // 268 m: the projection must not have quietly rescaled anything.
    const layout = projectEncounter(PRE_BURN_KM, POST_BURN_KM, SECONDARY_KM)

    expect(layout.preBurnMissM).toBeCloseTo(268.043, 2)
    expect(layout.postBurnMissM).toBeCloseTo(556.226, 2)
    expect(layout.burnShiftM).toBeCloseTo(389.259, 2)
  })

  it('puts the coasting primary at the origin with the miss along +x', () => {
    // A stable orientation, so the diagram does not spin as the orbit moves.
    const layout = projectEncounter(PRE_BURN_KM, POST_BURN_KM, SECONDARY_KM)

    expect(layout.preBurn).toEqual({ x: 0, y: 0 })
    expect(layout.secondary.y).toBeCloseTo(0, 6)
    expect(layout.secondary.x).toBeCloseTo(layout.preBurnMissM, 6)
  })

  it('handles a burn that moved nothing without dividing by zero', () => {
    // A 0 cm/s burn is a real request. The three points are then collinear, the
    // second basis vector is arbitrary, and the panel must still draw.
    const layout = projectEncounter(PRE_BURN_KM, PRE_BURN_KM, SECONDARY_KM)

    expect(layout.degenerate).toBe(true)
    expect(layout.burnShiftM).toBeCloseTo(0, 9)
    expect(layout.postBurnMissM).toBeCloseTo(layout.preBurnMissM, 9)
    expect(Number.isFinite(layout.postBurn.x)).toBe(true)
    expect(Number.isFinite(layout.postBurn.y)).toBe(true)
  })

  it('refuses input it cannot project rather than drawing something wrong', () => {
    expect(projectEncounter(null, POST_BURN_KM, SECONDARY_KM)).toBeNull()
    expect(projectEncounter(PRE_BURN_KM, [1, 2], SECONDARY_KM)).toBeNull()
    expect(projectEncounter(PRE_BURN_KM, POST_BURN_KM, [1, 2, NaN])).toBeNull()
    // Primary and secondary at the same point: no miss vector, no orientation.
    expect(projectEncounter(PRE_BURN_KM, POST_BURN_KM, PRE_BURN_KM)).toBeNull()
  })

  it('reports a span large enough to contain all three points', () => {
    const layout = projectEncounter(PRE_BURN_KM, POST_BURN_KM, SECONDARY_KM)
    expect(layout.spanM).toBeGreaterThanOrEqual(layout.preBurnMissM * 0.99)
  })
})

describe('niceScaleBarM', () => {
  it('picks a round number a viewer can reason with', () => {
    expect(niceScaleBarM(1000)).toBe(200)
    expect(niceScaleBarM(600)).toBe(200)
    expect(niceScaleBarM(300)).toBe(100)
    expect(niceScaleBarM(30)).toBe(10)
  })

  it('never returns zero or a non-number', () => {
    for (const bad of [0, -50, NaN, null, undefined, Infinity]) {
      expect(niceScaleBarM(bad)).toBeGreaterThan(0)
    }
  })

  it('stays inside the span it is measuring', () => {
    for (const span of [37, 268, 570, 1234, 90000]) {
      expect(niceScaleBarM(span)).toBeLessThanOrEqual(span)
    }
  })
})

describe('formatEncounterDistance', () => {
  it('keeps hundreds of metres in metres', () => {
    // The whole point of this panel is distances in this range. Rounding 268 m
    // to "0.3 km" would erase the difference the burn made.
    expect(formatEncounterDistance(268)).toBe('268 m')
    expect(formatEncounterDistance(569.8)).toBe('570 m')
  })

  it('keeps one decimal under 10 m, where whole metres would read as zero', () => {
    expect(formatEncounterDistance(1.4)).toBe('1.4 m')
  })

  it('switches to km only once metres stop being readable', () => {
    expect(formatEncounterDistance(12000)).toBe('12.0 km')
  })

  it('shows an em dash rather than inventing a number', () => {
    expect(formatEncounterDistance(null)).toBe('—')
    expect(formatEncounterDistance(NaN)).toBe('—')
  })
})

describe('formatDeltaV', () => {
  it('always carries the sign, because the sign is the instruction', () => {
    expect(formatDeltaV(-4)).toBe('-4.0 cm/s')
    expect(formatDeltaV(4)).toBe('+4.0 cm/s')
    expect(formatDeltaV(0)).toBe('0.0 cm/s')
  })

  it('shows an em dash for a missing value', () => {
    expect(formatDeltaV(undefined)).toBe('—')
  })
})

describe('hasEncounterGeometry', () => {
  it('accepts a full tracks payload', () => {
    expect(hasEncounterGeometry({
      tca_pre_burn_pos_ecef_km: PRE_BURN_KM,
      tca_post_burn_pos_ecef_km: POST_BURN_KM,
      tca_secondary_pos_ecef_km: SECONDARY_KM,
    })).toBe(true)
  })

  it('rejects a partial one, so the panel shows numbers instead of an empty box', () => {
    expect(hasEncounterGeometry(null)).toBe(false)
    expect(hasEncounterGeometry({})).toBe(false)
    expect(hasEncounterGeometry({
      tca_pre_burn_pos_ecef_km: PRE_BURN_KM,
      tca_post_burn_pos_ecef_km: POST_BURN_KM,
    })).toBe(false)
  })
})

describe('alignTrackToInstant', () => {
  const SAMPLES = [
    '2004-10-22T05:00:00Z',
    '2004-10-22T05:05:00Z',
    '2004-10-22T05:10:00Z',
  ]
  const TRACK = [PRE_BURN_KM, POST_BURN_KM, SECONDARY_KM]

  it('rotates without rescaling', () => {
    // Undoing one Earth rotation and applying another is still a rotation, so
    // every point must keep its distance from the centre. A change here would
    // mean the arc is being drawn at the wrong altitude.
    const when = new Date('2004-10-22T05:10:35Z')
    const aligned = alignTrackToInstant(TRACK, SAMPLES, when)

    aligned.forEach((p, i) => {
      const before = Math.hypot(...TRACK[i])
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(before, 6)
    })
  })

  it('leaves a point untouched when asked for its own instant', () => {
    // The identity case: aligning to the sample's own time is a no-op, which
    // is what makes the arcs line up with the orbit rings.
    const aligned = alignTrackToInstant([PRE_BURN_KM], [SAMPLES[0]], new Date(SAMPLES[0]))

    expect(aligned[0].x).toBeCloseTo(PRE_BURN_KM[0], 6)
    expect(aligned[0].y).toBeCloseTo(PRE_BURN_KM[1], 6)
    expect(aligned[0].z).toBeCloseTo(PRE_BURN_KM[2], 6)
  })

  it('moves points that were sampled at other instants', () => {
    // Ten minutes of Earth rotation is ~2.5 degrees, which at 7000 km is
    // hundreds of km. If this came back unchanged, the rotation is not being
    // applied and the arc would be a ground track after all.
    const aligned = alignTrackToInstant(TRACK, SAMPLES, new Date(SAMPLES[2]))
    const moved = Math.hypot(
      aligned[0].x - TRACK[0][0], aligned[0].y - TRACK[0][1], aligned[0].z - TRACK[0][2],
    )
    expect(moved).toBeGreaterThan(10)
  })

  it('refuses mismatched or unusable input rather than drawing a partial arc', () => {
    const when = new Date(SAMPLES[0])
    expect(alignTrackToInstant(null, SAMPLES, when)).toBeNull()
    expect(alignTrackToInstant([], SAMPLES, when)).toBeNull()
    expect(alignTrackToInstant(TRACK, SAMPLES.slice(0, 2), when)).toBeNull()
    expect(alignTrackToInstant(TRACK, SAMPLES, new Date(NaN))).toBeNull()
    expect(alignTrackToInstant([[1, 2]], [SAMPLES[0]], when)).toBeNull()
    expect(alignTrackToInstant(TRACK, ['not a date', SAMPLES[1], SAMPLES[2]], when)).toBeNull()
  })
})
