import { useCallback, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { GLOSSARY } from '../../lib/glossary.js'
import './Term.css'

const TIP_WIDTH_PX = 280
const GAP_PX = 6

/**
 * A word with a plain-language definition on hover or keyboard focus.
 *
 * The visible tip is portalled to <body> with fixed positioning, because every
 * floating panel clips its own body and a tip rendered inside one would be cut
 * off at the panel edge. The definition is also always in the DOM, visually
 * hidden and linked by aria-describedby, so a screen reader gets it without
 * depending on hover.
 *
 * An unknown key renders the children unchanged rather than an empty tip.
 *
 * @param {object} props
 * @param {keyof typeof GLOSSARY} props.id
 * @param {import('react').ReactNode} props.children
 */
function Term({ id, children }) {
  const entry = GLOSSARY[id]
  const anchorRef = useRef(null)
  const descriptionId = useId()
  const [position, setPosition] = useState(null)

  const show = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - TIP_WIDTH_PX - 8))
    // Below the word unless that would run off the bottom of the screen.
    const above = rect.bottom + 140 > window.innerHeight
    setPosition({ left, top: above ? rect.top - GAP_PX : rect.bottom + GAP_PX, above })
  }, [])

  const hide = useCallback(() => setPosition(null), [])

  if (!entry) return children

  return (
    <>
      <span
        ref={anchorRef}
        className="term"
        tabIndex={0}
        aria-describedby={descriptionId}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(event) => {
          if (event.key === 'Escape') hide()
        }}
      >
        {children}
        <span id={descriptionId} className="term__sr">
          {entry.definition}
        </span>
      </span>
      {position &&
        createPortal(
          <span
            className={`term__tip${position.above ? ' is-above' : ''}`}
            style={{ left: position.left, top: position.top, width: TIP_WIDTH_PX }}
            aria-hidden="true"
          >
            <span className="term__tip-term">{entry.term}</span>
            {entry.definition}
          </span>,
          document.body,
        )}
    </>
  )
}

export default Term
