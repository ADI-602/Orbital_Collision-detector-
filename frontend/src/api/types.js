/**
 * types.js — shared JSDoc typedefs for the backend wire contract.
 *
 * There is no TypeScript in this project, so these exist purely for editor
 * autocomplete and to keep the contract documented next to the code that
 * uses it. Endpoint-specific response shapes live at the top of the module
 * that returns them (physics.js, ai.js, ...); only shapes used in more than
 * one place live here.
 *
 * Deliberately NOT `// @ts-check` — without a tsconfig referencing
 * vite/client that would red-squiggle `import.meta.env` for no benefit.
 *
 * Source of truth: backend/api/main.py:49-76 and backend/ai/schema.py:12-53.
 */

/**
 * A two-line TLE plus a display name. All three fields are required
 * (backend/api/main.py:49-52).
 * @typedef {object} TleInput
 * @property {string} name
 * @property {string} line1
 * @property {string} line2
 */

/**
 * Threat classification assigned by the screening endpoint
 * (backend/api/main.py:233): RED at Pc >= 1e-4, YELLOW at Pc >= 1e-5,
 * GREEN otherwise.
 * @typedef {'RED' | 'YELLOW' | 'GREEN'} ThreatLevel
 */

/**
 * Per-call overrides accepted by every endpoint function.
 * @typedef {object} ApiRequestOptions
 * @property {AbortSignal} [signal] caller cancellation (component unmount)
 * @property {number} [timeoutMs] overrides the endpoint's default budget
 */

export {}
