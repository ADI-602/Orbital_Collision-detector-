#!/usr/bin/env node
/**
 * check-api.mjs — live probe against a running backend.
 *
 * Complements the unit tests, which are hermetic and never touch the
 * network. This one answers the question those cannot: "is the real backend
 * up and serving the shape we expect right now?" Worth running as part of
 * the pre-demo checklist.
 *
 * Usage:
 *   npm run check:api
 *   npm run check:api -- http://localhost:8001
 *
 * Deliberately standalone — it must NOT import src/api/client.js, because
 * plain Node gives `undefined` for `import.meta.env` and the property access
 * would throw before the probe ever runs.
 */

const DEFAULT_BASE_URL = 'http://localhost:8000'
const TIMEOUT_MS = 5000

// Port 8000 is documentation convention, not config — nothing in main.py
// pins it — so an explicit override matters.
const baseUrl = (
  process.argv[2] ??
  process.env.VITE_API_BASE_URL ??
  DEFAULT_BASE_URL
).replace(/\/+$/, '')

const START_BACKEND_HINT = [
  'The backend is not accepting connections.',
  'Start it FROM THE REPO ROOT (backend/api/main.py imports tests.fixtures):',
  '  backend\\.venv\\Scripts\\uvicorn backend.api.main:app --reload --port 8000',
].join('\n    ')

/** @returns {Promise<{ok: boolean, note: string}>} */
async function probe(path, validate) {
  const url = baseUrl + path
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      return { ok: false, note: `no response within ${TIMEOUT_MS}ms` }
    }
    // Node surfaces connection refusal as a cause chain under TypeError.
    const code = err?.cause?.code ?? err?.code ?? ''
    if (code === 'ECONNREFUSED') {
      return { ok: false, note: `connection refused\n    ${START_BACKEND_HINT}` }
    }
    return { ok: false, note: `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}` }
  }

  if (!res.ok) {
    // Reachable but unhealthy — a genuinely different problem from "not running".
    let detail = ''
    try {
      const body = await res.json()
      detail = typeof body?.detail === 'string' ? ` — ${body.detail}` : ''
    } catch {
      detail = ''
    }
    return { ok: false, note: `HTTP ${res.status} ${res.statusText}${detail}` }
  }

  let body
  try {
    body = await res.json()
  } catch {
    return { ok: false, note: 'response was not JSON' }
  }

  return validate(body)
}

const checks = [
  {
    path: '/health',
    // Reachability only: the payload is three hardcoded literals.
    validate: (body) =>
      body?.status === 'ok'
        ? { ok: true, note: `service="${body.service}" version=${body.version}` }
        : { ok: false, note: `expected status="ok", got ${JSON.stringify(body?.status)}` },
  },
  {
    path: '/api/conjunctions/envisat',
    // Free (a static fixture read, no SGP4) and catches a half-broken
    // backend that /health alone would happily pass.
    validate: (body) => {
      const n = body?.prediction_days?.length
      return n === 4
        ? { ok: true, note: `prediction_days=4 primary="${body.primary_satellite}"` }
        : { ok: false, note: `expected 4 prediction_days, got ${n}` }
    },
  },
]

console.log(`Orbital Risk Advisor — backend probe`)
console.log(`base URL: ${baseUrl}\n`)

let failed = 0
for (const check of checks) {
  const { ok, note } = await probe(check.path, check.validate)
  if (!ok) failed += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${check.path}\n        ${note}`)
}

console.log('')
if (failed > 0) {
  console.log(`${failed} of ${checks.length} checks failed.`)
  process.exit(1)
}
console.log(`All ${checks.length} checks passed.`)
