/**
 * validation.js — how the header badge words the server's validation report.
 *
 * Display only. Pass and fail are decided on the server by the regression
 * tests' own bounds (backend/api/validation.py); nothing here re-judges a
 * number, so the badge and `pytest` cannot disagree.
 */

/**
 * The badge's state and words.
 *
 * @param {'loading' | 'ready' | 'error'} status from useValidation
 * @param {{passed?: boolean} | null} report
 * @returns {{tone: 'pending' | 'passed' | 'failed', text: string}}
 */
export function validationBadge(status, report) {
  if (status === 'loading') return { tone: 'pending', text: 'Validating…' }
  if (status === 'error' || !report) return { tone: 'pending', text: 'Validation unavailable' }
  // Strictly true: an absent or malformed flag is not a pass.
  if (report.passed === true) return { tone: 'passed', text: 'Validated' }
  return { tone: 'failed', text: 'Validation failed' }
}

/** "1.0e-4 – 2.5e-3" or "100 m – 1000 m" for a [min, max] pair. */
export function formatRange(range, format) {
  if (!Array.isArray(range) || range.length !== 2) return '—'
  return `${format(range[0])} – ${format(range[1])}`
}

/** Prediction-day keys as people say them. */
export const DAY_LABEL = { oct_19: 'Oct 19', oct_20: 'Oct 20', oct_21: 'Oct 21', oct_22: 'Oct 22' }
