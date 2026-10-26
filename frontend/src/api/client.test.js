/**
 * Unit tests for the API client.
 *
 * Hermetic by construction: `fetch` is stubbed in every test, so even a
 * misconfigured base URL cannot produce network egress. The backend does not
 * need to be running.
 *
 * Responses are built from the real global `Response` rather than hand-rolled
 * objects, so res.ok / res.text() / res.statusText are genuinely exercised.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  API_BASE_URL,
  ApiError,
  CanceledError,
  NetworkError,
  NotFoundError,
  ServerError,
  TimeoutError,
  ValidationError,
  buildUrl,
  get,
  post,
} from './client.js'
import { getHealth } from './health.js'
import { computeTca, isNoConjunctionFound } from './physics.js'

/** Build a JSON Response with the given status. */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The one call recorded by the fetch stub. */
function lastCall() {
  return globalThis.fetch.mock.calls.at(-1)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('URL construction', () => {
  it('reads the base URL from VITE_API_BASE_URL', () => {
    expect(API_BASE_URL).toBe('http://api.test')
  })

  it('joins a leading-slash path', () => {
    expect(buildUrl('/health')).toBe('http://api.test/health')
  })

  it('joins a path with no leading slash', () => {
    expect(buildUrl('health')).toBe('http://api.test/health')
  })

  it('does not produce a double slash', () => {
    expect(buildUrl('/api/physics/tca')).toBe('http://api.test/api/physics/tca')
    expect(buildUrl('/health')).not.toContain('//health')
  })
})

describe('successful requests', () => {
  it('resolves the parsed JSON body', async () => {
    const payload = { status: 'ok', service: 'Orbital Risk Advisor API', version: '1.0.0' }
    globalThis.fetch.mockResolvedValue(jsonResponse(payload))

    await expect(getHealth()).resolves.toEqual(payload)
    expect(lastCall()[0]).toBe('http://api.test/health')
  })

  it('sends POST with JSON content type and a serialised body', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ ok: true }))
    const body = { primary: { name: 'ENVISAT', line1: '1 ...', line2: '2 ...' } }

    await post('/api/physics/tca', body)

    const [url, init] = lastCall()
    expect(url).toBe('http://api.test/api/physics/tca')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual(body)
  })

  it('never sends credentials — allow_origins=["*"] with allow_credentials=true would fail CORS', async () => {
    // A fresh Response per call: a body can only be read once.
    globalThis.fetch.mockImplementation(async () => jsonResponse({ ok: true }))

    await get('/health')
    await post('/api/physics/tca', { a: 1 })

    for (const [, init] of globalThis.fetch.mock.calls) {
      expect(init.credentials).toBeUndefined()
    }
  })

  it('returns null for 204 No Content', async () => {
    globalThis.fetch.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(get('/whatever')).resolves.toBeNull()
  })
})

describe('404 handling', () => {
  it('raises NotFoundError carrying the backend detail', async () => {
    const detail = 'No close approach found within search duration window.'
    globalThis.fetch.mockResolvedValue(jsonResponse({ detail }, 404))

    const err = await computeTca({}).catch((e) => e)

    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.status).toBe(404)
    expect(err.detail).toBe(detail)
  })

  it('treats a real "no close approach" 404 as a physics result', async () => {
    const detail = 'No close approach found within search duration window.'
    globalThis.fetch.mockResolvedValue(jsonResponse({ detail }, 404))

    const err = await computeTca({}).catch((e) => e)

    expect(isNoConjunctionFound(err)).toBe(true)
  })

  it('does NOT treat an unrouted-path 404 as a physics result', async () => {
    // FastAPI returns this for a path that does not exist. Treating it as
    // "no conjunction" would disguise a routing bug as a physics conclusion.
    globalThis.fetch.mockResolvedValue(jsonResponse({ detail: 'Not Found' }, 404))

    const err = await get('/api/physics/typo').catch((e) => e)

    expect(err).toBeInstanceOf(NotFoundError)
    expect(isNoConjunctionFound(err)).toBe(false)
  })
})

describe('422 validation errors', () => {
  it('flattens the pydantic issue array into readable text', async () => {
    const detail = [
      { loc: ['body', 'primary', 'line1'], msg: 'Field required', type: 'missing' },
      { loc: ['body', 'start_utc_iso'], msg: 'Field required', type: 'missing' },
    ]
    globalThis.fetch.mockResolvedValue(jsonResponse({ detail }, 422))

    const err = await post('/api/physics/tca', {}).catch((e) => e)

    expect(err).toBeInstanceOf(ValidationError)
    expect(err.status).toBe(422)
    expect(err.issues).toHaveLength(2)
    expect(err.detail).toBe(
      'body.primary.line1: Field required; body.start_utc_iso: Field required',
    )
  })
})

describe('500 server errors', () => {
  it('preserves the backend error string', async () => {
    const detail = 'TCA calculation failed: invalid TLE checksum'
    globalThis.fetch.mockResolvedValue(jsonResponse({ detail }, 500))

    const err = await post('/api/physics/tca', {}).catch((e) => e)

    expect(err).toBeInstanceOf(ServerError)
    expect(err.status).toBe(500)
    expect(err.detail).toBe(detail)
  })
})

describe('non-JSON error bodies', () => {
  it('does not leak a SyntaxError when a proxy returns HTML', async () => {
    globalThis.fetch.mockResolvedValue(
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const err = await get('/health').catch((e) => e)

    expect(err).toBeInstanceOf(ServerError)
    expect(err).not.toBeInstanceOf(SyntaxError)
    expect(err.detail).toContain('502')
    expect(err.message.length).toBeGreaterThan(0)
  })

  it('raises a typed parse error when a 200 body is not JSON', async () => {
    globalThis.fetch.mockResolvedValue(
      new Response('not json at all', { status: 200 }),
    )

    const err = await get('/health').catch((e) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('parse')
  })
})

describe('network failure', () => {
  it('raises NetworkError naming the base URL', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const err = await getHealth().catch((e) => e)

    expect(err).toBeInstanceOf(NetworkError)
    expect(err.message).toContain('http://api.test')
    expect(err.kind).toBe('network')
  })
})

describe('timeout and cancellation', () => {
  it('raises TimeoutError when our own budget expires', async () => {
    // Never settles until aborted — mirrors a hung backend.
    globalThis.fetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }),
    )

    const err = await get('/health', { timeoutMs: 5 }).catch((e) => e)

    expect(err).toBeInstanceOf(TimeoutError)
    expect(err.timeoutMs).toBe(5)
  })

  it('raises CanceledError — not TimeoutError — when the caller aborts', async () => {
    // This distinction is what stops React 19 StrictMode's double-invoked
    // effect from flashing an error state on every dev page load.
    globalThis.fetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }),
    )

    const controller = new AbortController()
    const promise = get('/health', { signal: controller.signal, timeoutMs: 60000 })
    controller.abort()

    const err = await promise.catch((e) => e)

    expect(err).toBeInstanceOf(CanceledError)
    expect(err).not.toBeInstanceOf(TimeoutError)
    expect(err.kind).toBe('canceled')
  })
})
