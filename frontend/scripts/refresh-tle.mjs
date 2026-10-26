#!/usr/bin/env node
/**
 * refresh-tle.mjs — regenerate src/lib/tleSnapshot.js from a live CelesTrak
 * fetch.
 *
 * The bundled snapshot is the console's offline fallback. It should be
 * refreshed shortly before a demo so propagated positions are close to
 * reality, and it must never be hand-edited: SGP4 parses TLEs by column, so
 * a stray character silently changes an orbit rather than failing loudly.
 *
 * usage: npm run refresh:tle [-- --limit 12]
 *
 * Be sparing with this. CelesTrak is free and unauthenticated, and CLAUDE.md
 * asks that it not be hammered — repeated fetches have already got this
 * machine temporarily blocked once.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const URL_ =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle'
const TIMEOUT_MS = 15000

const limitArg = process.argv.indexOf('--limit')
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity

const here = dirname(fileURLToPath(import.meta.url))
const outPath = join(here, '..', 'src', 'lib', 'tleSnapshot.js')

console.log(`Fetching ${URL_}`)

let text
try {
  const res = await fetch(URL_, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) {
    console.error(`FAILED: CelesTrak returned HTTP ${res.status}`)
    process.exit(1)
  }
  text = await res.text()
} catch (err) {
  const why =
    err?.name === 'TimeoutError'
      ? `no response within ${TIMEOUT_MS / 1000}s`
      : `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`
  console.error(`FAILED: ${why}`)
  console.error('CelesTrak may be rate-limiting this machine. Try again later.')
  console.error('The existing snapshot was left untouched.')
  process.exit(1)
}

// Keep whole 3-line blocks only; a torn block would produce a broken satrec.
const lines = text
  .split(/\r?\n/)
  .map((l) => l.trimEnd())
  .filter((l) => l.length > 0)

const blocks = []
for (let i = 0; i + 2 < lines.length + 1; i += 3) {
  const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]]
  if (!name || !l1 || !l2) break
  if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue
  blocks.push([name.trim(), l1, l2])
  if (blocks.length >= limit) break
}

if (blocks.length === 0) {
  console.error('FAILED: no complete TLE blocks in the response.')
  process.exit(1)
}

const captured = new Date().toISOString().slice(0, 10)
const body = blocks.map(([n, a, b]) => `${n}\n${a}\n${b}`).join('\n')

const file = `/**
 * tleSnapshot.js — a small, committed set of real TLEs used ONLY when the
 * live CelesTrak feed cannot be reached.
 *
 * GENERATED FILE — do not hand-edit. Regenerate with \`npm run refresh:tle\`.
 * SGP4 parses these lines by column; a stray character silently changes an
 * orbit instead of failing loudly.
 *
 * WHY THIS EXISTS
 * The globe depended on a live third-party fetch with no fallback, so an
 * unreachable CelesTrak (rate limit, conference wifi, outage) emptied the
 * hero view entirely. CLAUDE.md's data-source note asks for exactly this:
 * "fetch live or cache locally".
 *
 * HONESTY REQUIREMENTS — not optional:
 *   - These are REAL, unmodified TLEs from CelesTrak's \`stations\` group.
 *     Nothing here is synthetic or hand-tuned.
 *   - Whenever this snapshot is in use, the UI must say so and show the
 *     capture date. It must never be presented as a live feed.
 *   - Positions propagated from these elements drift as the epoch ages. That
 *     is acceptable for an ambient visualisation and unacceptable for
 *     anything else — this data must never reach the physics pipeline or an
 *     AI prompt (see useLiveSatellites.js).
 *
 * Captured: ${captured}
 * Source: ${URL_}
 * Objects: ${blocks.length}
 */

/** ISO date this snapshot was captured, shown in the UI when it is in use. */
export const SNAPSHOT_CAPTURED_UTC = '${captured}'

/**
 * Raw CelesTrak 3-line-format text, parsed by the same parseTleText() used
 * for the live feed so both paths go through identical code.
 */
export const TLE_SNAPSHOT_TEXT = \`${body}
\`
`

writeFileSync(outPath, file, 'utf8')
console.log(`Wrote ${blocks.length} objects to src/lib/tleSnapshot.js (captured ${captured})`)
console.log('Run `npm test` to confirm the snapshot still parses.')
