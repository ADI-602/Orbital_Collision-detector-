/**
 * objectSearch.js — find a tracked object by name or NORAD catalogue number.
 *
 * Ranking, best first: exact NORAD id, exact name, name prefix, NORAD prefix,
 * name substring. Ties break by name then id, so the same query always lists
 * the same objects in the same order.
 */

/**
 * @template {{name?: string, noradId?: string|number}} T
 * @param {T[]} objects
 * @param {string} query
 * @param {number} [limit]
 * @returns {{results: T[], total: number}} the best `limit` matches, and how many matched
 */
export function searchObjects(objects, query, limit = 6) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return { results: [], total: 0 }

  const scored = []
  for (const object of objects ?? []) {
    const name = String(object?.name ?? '').toLowerCase()
    const norad = String(object?.noradId ?? '').toLowerCase()
    let score = null
    if (norad && norad === q) score = 0
    else if (name === q) score = 1
    else if (name.startsWith(q)) score = 2
    else if (norad.startsWith(q)) score = 3
    else if (name.includes(q)) score = 4
    if (score !== null) scored.push({ object, score, name, norad })
  }

  scored.sort(
    (a, b) => a.score - b.score || a.name.localeCompare(b.name) || a.norad.localeCompare(b.norad),
  )
  return { results: scored.slice(0, limit).map((s) => s.object), total: scored.length }
}
