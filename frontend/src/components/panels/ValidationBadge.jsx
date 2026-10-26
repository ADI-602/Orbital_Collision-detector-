import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useValidation } from '../../hooks/useValidation.js'
import { formatMissDistance, formatPc } from '../../lib/conjunctions.js'
import { DAY_LABEL, formatRange, validationBadge } from '../../lib/validation.js'
import './ValidationBadge.css'

const PANEL_WIDTH_PX = 400

/** "11:24 UTC" from a unix time in seconds. */
function utcTime(unixSeconds) {
  if (typeof unixSeconds !== 'number') return '—'
  return `${new Date(unixSeconds * 1000).toISOString().slice(11, 16)} UTC`
}

function Verdict({ passed }) {
  return (
    <span className={`validation__verdict ${passed ? 'is-pass' : 'is-fail'}`}>
      {passed ? 'PASS' : 'FAIL'}
    </span>
  )
}

/**
 * The header's correctness badge: the server runs the Alfano case and the four
 * Envisat prediction days through the pipeline and judges them by the
 * regression tests' own bounds; this shows the verdict and, on click, every
 * figure behind it. It decides nothing itself.
 */
function ValidationBadge() {
  const { status, report, error, retry } = useValidation()
  const badge = validationBadge(status, report)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const panelId = useId()

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.right - PANEL_WIDTH_PX, window.innerWidth - PANEL_WIDTH_PX - 8))
    setPosition({ left, top: rect.bottom + 8 })
    setOpen(true)
  }, [open])

  // Close on Escape or on a click anywhere outside the badge and its panel.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onPointer = (event) => {
      if (panelRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const alfano = report?.checks?.find((c) => c.id === 'alfano')
  const envisat = report?.checks?.find((c) => c.id === 'envisat')

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`validation-badge validation-badge--${badge.tone}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Known-answer checks, run by the physics pipeline. Click for the figures."
      >
        <span className="validation-badge__dot" aria-hidden="true" />
        {badge.text}
        {badge.tone === 'passed' && <span className="validation-badge__cases">Alfano · Envisat</span>}
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            className="validation-panel"
            role="dialog"
            aria-label="Validation checks"
            style={{ left: position.left, top: position.top, width: PANEL_WIDTH_PX }}
          >
            <p className="validation-panel__lead">
              Run by the physics pipeline on this server and judged by the
              regression tests&rsquo; own fixtures and bounds. No AI is involved.
            </p>

            {status === 'loading' && <p className="validation-panel__note">Running the checks…</p>}

            {status === 'error' && (
              <p className="validation-panel__note">
                The validation report could not be read:{' '}
                {error?.detail ?? error?.message ?? 'unknown error'}.{' '}
                <button type="button" className="validation-panel__retry" onClick={retry}>
                  Try again
                </button>
              </p>
            )}

            {alfano && (
              <section className="validation-panel__check">
                <header className="validation-panel__head">
                  <span className="validation-panel__name">{alfano.name}</span>
                  <Verdict passed={alfano.passed === true} />
                </header>
                {alfano.error ? (
                  <p className="validation-panel__error">Could not run: {alfano.error}</p>
                ) : (
                  <p className="validation-panel__figures ui-readout">
                    Pc {alfano.computed_pc?.toFixed(5)} · expected {alfano.expected_pc} ± {alfano.tolerance}
                  </p>
                )}
                <p className="validation-panel__source">{alfano.test}</p>
              </section>
            )}

            {envisat && (
              <section className="validation-panel__check">
                <header className="validation-panel__head">
                  <span className="validation-panel__name">{envisat.name}</span>
                  <Verdict passed={envisat.passed === true} />
                </header>
                <div className="validation-panel__days">
                  {envisat.days?.map((day) => (
                    <div key={day.day} className="validation-panel__day">
                      <span>{DAY_LABEL[day.day] ?? day.day}</span>
                      {day.error ? (
                        <span className="validation-panel__error">{day.error}</span>
                      ) : (
                        <span className="ui-readout">
                          {formatMissDistance(day.miss_distance_m)} · {formatPc(day.pc)}
                        </span>
                      )}
                      <Verdict passed={day.passed === true} />
                    </div>
                  ))}
                </div>
                <p className="validation-panel__note">
                  Judged by the range the test asserts:{' '}
                  {formatRange(envisat.asserted?.miss_distance_m, (v) => `${v} m`)},{' '}
                  {formatRange(envisat.asserted?.pc, (v) => v.toExponential(1))}. Published
                  (ESA): {formatRange(envisat.published?.miss_distance_m, (v) => `${v} m`)},{' '}
                  {formatRange(envisat.published?.pc, (v) => v.toExponential(1))}, TCA{' '}
                  {envisat.published?.tca_utc_iso?.slice(11, 19)}Z.
                </p>
                <p className="validation-panel__source">{envisat.test}</p>
              </section>
            )}

            {report && (
              <p className="validation-panel__foot">
                Ran at {utcTime(report.ran_at_unix)} in {report.duration_s?.toFixed(1)} s. How we
                know the numbers are right: {report.notes}.
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

export default ValidationBadge
