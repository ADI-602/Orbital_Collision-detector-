/**
 * countdown.js — T-minus arithmetic, kept pure so it is testable without
 * React, a render loop, or fake timers.
 *
 * What this module is NOT: a source of instants. The countdown target is
 * always a TCA (time of closest approach) that the physics pipeline already
 * computed and the API returned as `tca_utc_iso`. Nothing here estimates,
 * nudges, or invents a time — it turns one epoch and one "now" into a signed
 * duration and a string.
 *
 * Sign convention follows mission usage: `T-hh:mm:ss` counts down toward the
 * event, `T+hh:mm:ss` counts up after it, and the event instant itself reads
 * `T-00:00:00`.
 *
 * The sign characters are ASCII '-' and '+', not the typographic minus. The
 * readout is monospace with tabular figures precisely so digits hold their
 * column; a U+2212 that is not tabular-width would make the whole line shift
 * the moment the countdown crosses zero.
 *
 * Strictness: every entry point throws on input it cannot interpret rather
 * than returning a fallback. A countdown that is silently wrong by an hour is
 * exactly the failure mode CLAUDE.md §1.5 warns about, and it is invisible on
 * a projector. `null`/`undefined` is the one accepted "no value" input — it
 * means no TCA has been computed, and it returns null, not a zeroed clock.
 */

/** Everything in this module is milliseconds unless a name says otherwise. */
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86400

/**
 * ISO-8601 date-times ending in an explicit UTC designator or numeric offset.
 *
 * This guard exists because of a genuine footgun: per ECMA-262, a date-time
 * string with NO offset ("2004-10-22T05:10:35") is parsed as *local time*,
 * while a date-only string is parsed as UTC. A browser in UTC+05:30 would
 * therefore shift such a TCA by five and a half hours with no error and no
 * visible symptom beyond a wrong countdown.
 *
 * The backend emits "%Y-%m-%dT%H:%M:%SZ" (backend/api/main.py:159), so the
 * suffix is always present in practice. If that ever changes, this rejects
 * the string loudly instead of quietly localising it.
 */
const ISO_WITH_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i

/**
 * Normalise a UTC instant to epoch milliseconds.
 *
 * @param {Date|number|string|null|undefined} value
 *   Date, epoch milliseconds, or an ISO-8601 string carrying a zone
 *   designator. null/undefined means "not computed" and returns null.
 * @returns {number|null} epoch milliseconds (UTC), or null
 * @throws {TypeError}  on a type this cannot interpret, or a zoneless string
 * @throws {RangeError} on an Invalid Date, a non-finite number, or an
 *                      unparseable string
 */
export function toEpochMs(value) {
  if (value === null || value === undefined) return null

  if (value instanceof Date) {
    const ms = value.getTime()
    if (Number.isNaN(ms)) throw new RangeError('toEpochMs received an Invalid Date')
    return ms
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`toEpochMs received a non-finite epoch: ${value}`)
    }
    return value
  }

  if (typeof value === 'string') {
    if (!ISO_WITH_ZONE.test(value)) {
      throw new TypeError(
        `toEpochMs refuses the zoneless timestamp "${value}": ECMA-262 parses ` +
          'such a string as local time, which would silently shift the ' +
          'countdown by the viewer\'s UTC offset. Supply a "Z" or an offset.',
      )
    }
    const ms = Date.parse(value)
    if (Number.isNaN(ms)) throw new RangeError(`toEpochMs could not parse "${value}"`)
    return ms
  }

  throw new TypeError(`toEpochMs received an unsupported type: ${typeof value}`)
}

/**
 * @typedef {object} CountdownParts
 * @property {'before'|'after'} phase  before = TCA is ahead of now
 * @property {number} deltaMs          signed target - now, in milliseconds
 * @property {number} totalSeconds     absolute whole seconds to/since TCA
 * @property {number} days             whole days component
 * @property {number} hours            0-23, remainder after days
 * @property {number} minutes          0-59
 * @property {number} seconds          0-59
 * @property {number} targetMs         resolved TCA, epoch ms
 * @property {number} nowMs            resolved reference instant, epoch ms
 */

/**
 * Split the interval between `nowUtc` and a TCA into display components.
 *
 * Rounding differs by direction, and deliberately so. Time remaining is
 * rounded UP, so the clock reaches T-00:00:00 at the TCA itself rather than
 * up to a second early — reading "T-00:00:00" while the encounter is still
 * ahead would be a small lie told at the worst possible moment. Time elapsed
 * is rounded DOWN, because 1.9 s after the event is "1 second since", not 2.
 *
 * @param {Date|number|string|null|undefined} targetUtc  the TCA
 * @param {Date|number|string} [nowUtc]  reference instant; defaults to
 *   Date.now(). Tests and replay-driven views always pass it explicitly.
 * @returns {CountdownParts|null} null when no TCA was supplied
 */
export function computeCountdown(targetUtc, nowUtc = Date.now()) {
  const targetMs = toEpochMs(targetUtc)
  if (targetMs === null) return null

  const nowMs = toEpochMs(nowUtc)
  if (nowMs === null) throw new TypeError('computeCountdown requires a reference instant')

  const deltaMs = targetMs - nowMs
  const phase = deltaMs >= 0 ? 'before' : 'after'

  const totalSeconds =
    phase === 'before'
      ? Math.ceil(deltaMs / MS_PER_SECOND)
      : Math.floor(-deltaMs / MS_PER_SECOND)

  return {
    phase,
    deltaMs,
    totalSeconds,
    days: Math.floor(totalSeconds / SECONDS_PER_DAY),
    hours: Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR),
    minutes: Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
    seconds: totalSeconds % SECONDS_PER_MINUTE,
    targetMs,
    nowMs,
  }
}

/** Two-digit zero pad for clock fields. */
function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * Render parts as a mission clock: "T-00:04:12", or "T+3d 04:05:06" once the
 * interval passes a day.
 *
 * The day field is not clamped. A 2004 replay compared against today reads
 * "T+7999d ..." — ungainly, but a capped "T+99d" would misstate the interval,
 * and this readout exists to be checkable against the TCA shown beside it.
 *
 * @param {CountdownParts|null} parts
 * @returns {string} the clock, or an em dash when there is nothing to show
 */
export function formatCountdown(parts) {
  if (!parts) return '—'

  const sign = parts.phase === 'before' ? '-' : '+'
  const clock = `${pad2(parts.hours)}:${pad2(parts.minutes)}:${pad2(parts.seconds)}`

  return parts.days > 0 ? `T${sign}${parts.days}d ${clock}` : `T${sign}${clock}`
}

/**
 * Spoken-form equivalent of {@link formatCountdown}, for the readout's
 * accessible name — "T minus 4 minutes 12 seconds until closest approach"
 * reads correctly aloud where "T-00:04:12" does not.
 *
 * @param {CountdownParts|null} parts
 * @returns {string}
 */
export function describeCountdown(parts) {
  if (!parts) return 'No time of closest approach computed'

  const fields = [
    [parts.days, 'day'],
    [parts.hours, 'hour'],
    [parts.minutes, 'minute'],
    [parts.seconds, 'second'],
  ]
    .filter(([value]) => value > 0)
    .map(([value, noun]) => `${value} ${noun}${value === 1 ? '' : 's'}`)

  // Every field zero means we are within the TCA second itself.
  const duration = fields.length > 0 ? fields.join(' ') : '0 seconds'

  return parts.phase === 'before'
    ? `T minus ${duration} until closest approach`
    : `T plus ${duration} since closest approach`
}

/**
 * Which clock a countdown is counting against, as a caption.
 *
 * The rule this encodes: a caller-supplied label describes the clock the
 * caller supplied, so it applies ONLY when a clock was actually supplied. An
 * undriven countdown always reports real time, whatever label it was handed.
 *
 * This exists as a tested function rather than an expression in JSX because
 * the failure it prevents already happened once: the replay's globe failed to
 * start, stopped feeding the countdown its simulated clock, and the readout
 * fell back to real time while still captioned "replay clock x60" — a clock
 * labelled with a basis it was not counting against.
 *
 * @param {boolean} isDriven      whether an external instant was supplied
 * @param {string} [basisLabel]   caption for that external clock
 * @returns {string}
 */
export function resolveClockBasis(isDriven, basisLabel) {
  if (!isDriven) return 'real-time UTC'
  return basisLabel ?? 'simulated clock'
}
