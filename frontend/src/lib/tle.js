/**
 * tle.js — parsing for CelesTrak's 3-line TLE format.
 *
 * Pure string handling, no network and no propagation, so it is unit-testable
 * on its own. Propagation lives in useLiveSatellites.js and is delegated
 * entirely to satellite.js — nothing here computes orbital mechanics.
 *
 * CelesTrak's TLE format repeats in blocks of three lines:
 *
 *   ISS (ZARYA)
 *   1 25544U 98067A   26242.49847866  .00005671  00000+0  11126-3 0  9990
 *   2 25544  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909583274
 *
 * The name line is padded with trailing spaces and must be trimmed.
 */

/**
 * @typedef {object} TleRecord
 * @property {string} name    display name, trimmed
 * @property {string} noradId catalog number parsed from line 1, columns 3-7
 * @property {string} line1
 * @property {string} line2
 */

/**
 * Parse a CelesTrak 3-line-format TLE payload.
 *
 * Malformed trailing blocks are skipped rather than throwing: a truncated
 * response should still yield the satellites that did arrive intact, since a
 * partial globe is more useful than an empty one. A block is only accepted
 * when both element lines carry their expected line numbers.
 *
 * @param {string} text raw response body
 * @returns {TleRecord[]}
 */
export function parseTleText(text) {
  if (typeof text !== 'string') return []

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)

  const records = []

  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const name = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]

    if (!name || !line1 || !line2) break
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue

    records.push({
      name: name.trim(),
      noradId: line1.slice(2, 7).trim(),
      line1,
      line2,
    })
  }

  return records
}

/**
 * UTC epoch of a TLE, parsed from line 1 columns 19-32 (`YYDDD.DDDDDDDD`).
 *
 * Why anyone needs this: an element set is most accurate at its own epoch and
 * degrades either side of it. Screening "the next 24 hours from now" against a
 * two-week-old element set propagates it two weeks before it even starts,
 * which is how a conjunction search quietly becomes fiction. Anchoring the
 * search window to the epoch keeps the question honest, and with a fresh live
 * feed the epoch IS roughly now, so nothing is lost.
 *
 * The two-digit year follows the TLE convention: 57-99 means 1957-1999,
 * 00-56 means 2000-2056.
 *
 * @param {string} line1
 * @returns {Date|null} null when the field is not parseable
 */
export function tleEpochUtc(line1) {
  if (typeof line1 !== 'string' || line1.length < 32) return null

  const field = line1.slice(18, 32).trim()
  const match = /^(\d{2})(\d{3}\.\d+)$/.exec(field)
  if (!match) return null

  const yy = Number(match[1])
  const dayOfYear = Number(match[2])
  if (!Number.isFinite(dayOfYear) || dayOfYear < 1) return null

  const year = yy < 57 ? 2000 + yy : 1900 + yy

  // Day 1.0 is midnight on January 1st, so the fractional day is an offset
  // from the start of the year rather than from January 1st 00:00 plus a day.
  const ms = Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400_000
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date
}
