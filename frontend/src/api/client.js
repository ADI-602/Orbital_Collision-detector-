/**
 * client.js — the single module in the app that calls `fetch`.
 *
 * Design rules, enforced here rather than left to each caller:
 *
 * 1. NO snake_case -> camelCase mapping. Wire shapes pass through untouched,
 *    so `miss_distance_m` reads identically in backend/api/main.py, the
 *    browser network tab, and the JSX. A rename layer is a place a physics
 *    number can silently get aliased or dropped; identical names make
 *    "is this number real?" auditable by eye. Do not add a mapper.
 *
 * 2. NEVER send `credentials: 'include'`. The backend sets
 *    allow_origins=["*"] together with allow_credentials=True
 *    (backend/api/main.py:38-44), an invalid pairing per the CORS spec that
 *    works only because we send no credentials. Adding 'include' breaks
 *    every request with an opaque CORS error. This is a plausible "fix" for
 *    someone to apply later, so client.test.js asserts against it.
 *
 * 3. Every request carries a timeout. Native fetch has none, and
 *    /api/physics/screening can run for minutes.
 */

const RAW_BASE = import.meta.env?.VITE_API_BASE_URL ?? 'http://localhost:8000'

/** Resolved backend origin, trailing slashes stripped. */
export const API_BASE_URL = RAW_BASE.replace(/\/+$/, '')

/** Default per-request budget. Individual endpoints override this. */
export const DEFAULT_TIMEOUT_MS = 15000

/**
 * Join the configured base URL with an endpoint path.
 * Exported so URL construction is unit-testable without stubbing env.
 * @param {string} path
 * @returns {string}
 */
export function buildUrl(path) {
  return API_BASE_URL + (path.startsWith('/') ? path : '/' + path)
}

/** Base class for every failure this module raises. */
export class ApiError extends Error {
  constructor(message, { status = 0, detail = '', path = '', kind = 'http' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.path = path
    this.kind = kind
  }
}

/** `fetch` itself rejected — backend down, DNS failure, connection refused. */
export class NetworkError extends ApiError {
  constructor(path, cause) {
    super(`Cannot reach the backend at ${API_BASE_URL}. Is uvicorn running?`, {
      status: 0,
      detail: cause?.message ?? 'fetch failed',
      path,
      kind: 'network',
    })
    this.name = 'NetworkError'
    this.cause = cause
  }
}

/** Our own timeout fired. Distinct from a caller-initiated cancel. */
export class TimeoutError extends ApiError {
  constructor(path, timeoutMs) {
    super(`Request to ${path} timed out after ${timeoutMs}ms.`, {
      status: 0,
      detail: `timeout after ${timeoutMs}ms`,
      path,
      kind: 'timeout',
    })
    this.name = 'TimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * The CALLER's signal aborted (component unmounted, or a newer request
 * supersedes this one). Kept distinct from TimeoutError because React 19
 * StrictMode double-invokes effects in dev, so the first request always
 * aborts. Callers must swallow this rather than render it as an error, or
 * the UI flashes OFFLINE on every dev load.
 */
export class CanceledError extends ApiError {
  constructor(path) {
    super(`Request to ${path} was canceled.`, {
      status: 0,
      detail: 'canceled by caller',
      path,
      kind: 'canceled',
    })
    this.name = 'CanceledError'
  }
}

/**
 * HTTP 404 — not necessarily a failure. /api/physics/tca and
 * /api/physics/maneuver return 404 to mean "no close approach in the search
 * window", a legitimate physics result. Use isNoConjunctionFound() from
 * physics.js to tell that apart from a genuinely unrouted path.
 */
export class NotFoundError extends ApiError {
  constructor(message, opts) {
    super(message, { ...opts, kind: 'not_found' })
    this.name = 'NotFoundError'
  }
}

/** HTTP 422 — FastAPI/pydantic request validation failure. */
export class ValidationError extends ApiError {
  constructor(message, opts, issues) {
    super(message, { ...opts, kind: 'validation' })
    this.name = 'ValidationError'
    /** @type {Array<{loc?: unknown[], msg?: string, type?: string}>} */
    this.issues = issues ?? []
  }
}

/** HTTP >= 500. */
export class ServerError extends ApiError {
  constructor(message, opts) {
    super(message, { ...opts, kind: 'server' })
    this.name = 'ServerError'
  }
}

/**
 * Turn a FastAPI error body into readable text.
 *
 * Three shapes occur in practice:
 *   1. {detail: "string"}                — HTTPException (404, 500)
 *   2. {detail: [{loc, msg, type}, ...]} — pydantic validation (422)
 *   3. not JSON at all                   — proxy 502 HTML, empty body
 *
 * Shape 3 is why the caller reads text() first: letting a JSON.parse
 * SyntaxError escape would surface as an unreadable error mid-demo.
 *
 * @param {unknown} parsed parsed JSON body, or undefined if unparseable
 * @param {Response} res
 * @param {string} rawText
 * @returns {{ detail: string, issues: Array<object> }}
 */
export function parseDetail(parsed, res, rawText) {
  const detail = parsed && typeof parsed === 'object' ? parsed.detail : undefined

  if (typeof detail === 'string' && detail.length > 0) {
    return { detail, issues: [] }
  }

  if (Array.isArray(detail)) {
    const text = detail
      .map((issue) => {
        const loc = Array.isArray(issue?.loc) ? issue.loc.join('.') : ''
        const msg = issue?.msg ?? 'invalid'
        return loc ? `${loc}: ${msg}` : String(msg)
      })
      .join('; ')
    return { detail: text || `HTTP ${res.status} ${res.statusText}`, issues: detail }
  }

  const excerpt = (rawText ?? '').trim().slice(0, 200)
  const base = `HTTP ${res.status} ${res.statusText || ''}`.trim()
  return { detail: excerpt ? `${base} — ${excerpt}` : base, issues: [] }
}

/**
 * Core request. All endpoint modules go through this.
 *
 * @param {string} path
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<any>}
 */
async function request(path, opts = {}) {
  const { method = 'GET', body, signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const url = buildUrl(path)

  // Explicit AbortController + setTimeout rather than AbortSignal.timeout():
  // the latter's internal timer is not patched by vitest fake timers, and we
  // need a `timedOut` flag to tell our own abort apart from the caller's.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal

  /** @type {RequestInit} */
  const init = { method, signal, headers: {} }
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  // NOTE: `credentials` is deliberately left at its default. See rule 2 above.

  let res
  try {
    res = await fetch(url, init)
  } catch (err) {
    if (timedOut) throw new TimeoutError(path, timeoutMs)
    if (callerSignal?.aborted) throw new CanceledError(path)
    throw new NetworkError(path, err)
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 204) return null

  const rawText = await res.text()
  let parsed
  try {
    parsed = rawText ? JSON.parse(rawText) : undefined
  } catch {
    parsed = undefined
  }

  if (!res.ok) {
    const { detail, issues } = parseDetail(parsed, res, rawText)
    const meta = { status: res.status, detail, path }

    if (res.status === 404) throw new NotFoundError(detail, meta)
    if (res.status === 422) throw new ValidationError(detail, meta, issues)
    if (res.status >= 500) throw new ServerError(detail, meta)
    throw new ApiError(detail, meta)
  }

  if (parsed === undefined) {
    throw new ApiError(`Malformed JSON in a 200 response from ${path}.`, {
      status: res.status,
      detail: (rawText ?? '').slice(0, 200),
      path,
      kind: 'parse',
    })
  }

  return parsed
}

/**
 * @param {string} path
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 */
export function get(path, opts = {}) {
  return request(path, { ...opts, method: 'GET' })
}

/**
 * @param {string} path
 * @param {unknown} body
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 */
export function post(path, body, opts = {}) {
  return request(path, { ...opts, method: 'POST', body })
}
