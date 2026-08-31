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
