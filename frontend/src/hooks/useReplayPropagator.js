import { useCallback, useMemo } from 'react'

import { buildSatrec, propagateToGeodetic } from '../lib/geodetic.js'

/**
 * useReplayPropagator — propagate the replay's two objects from one
 * prediction day's element sets, for the globe only.
 *
 * Same boundary as the live console's tracking layer (see lib/geodetic.js):
 * these positions exist to put two moving dots and a line on a globe. The
 * miss distance, TCA and Pc shown beside them come from the Python pipeline
 * over /api/physics/screening, not from this propagation. The two agree
 * because they are the same element sets run through the same SGP4 family,
 * but only the backend's numbers are the validated ones, and only those are
 * ever displayed as physics output.
 *
 * The element sets are the historical ones the API returns for that day, so
 * the globe shows where the objects were in October 2004 — not where they are
 * now. That is the entire point of a replay, and the view labels it.
 *
 * @param {{primary_tle: object, secondary_tle: object}|null} day
 * @returns {{
 *   propagateAll: (when: Date) => Array<object>,
 *   count: number,
 *   primaryId: string|null,
 *   secondaryId: string|null,
 *   rejected: string[]
 * }}
 */
export function useReplayPropagator(day) {
  const built = useMemo(() => {
    if (!day?.primary_tle || !day?.secondary_tle) {
      return { records: [], primaryId: null, secondaryId: null, rejected: [] }
    }

    const records = []
    const rejected = []

    for (const [role, tle] of [
      ['primary', day.primary_tle],
      ['secondary', day.secondary_tle],
    ]) {
      const satrec = buildSatrec(tle.line1, tle.line2, tle.name)
      if (!satrec) {
        // A rejected element set is surfaced, never quietly dropped: one
        // missing object on a conjunction globe is not a cosmetic loss.
        rejected.push(tle.name)
        continue
      }
      records.push({
        // NORAD catalog number from line 1, columns 3-7 — the same field
        // lib/tle.js reads. Stable across days, unlike a display name.
        id: tle.line1.slice(2, 7).trim() || tle.name,
        name: tle.name,
        role,
        satrec,
      })
    }

    return {
      records,
      primaryId: records.find((r) => r.role === 'primary')?.id ?? null,
      secondaryId: records.find((r) => r.role === 'secondary')?.id ?? null,
      rejected,
    }
  }, [day])

  const propagateAll = useCallback(
    (when) => {
      const out = []
      for (const rec of built.records) {
        const geo = propagateToGeodetic(rec.satrec, when)
        if (!geo) continue
        out.push({ id: rec.id, name: rec.name, role: rec.role, ...geo })
      }
      return out
    },
    [built],
  )

  return {
    propagateAll,
    count: built.records.length,
    primaryId: built.primaryId,
    secondaryId: built.secondaryId,
    rejected: built.rejected,
  }
}
