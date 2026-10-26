import { useCallback, useEffect, useRef, useState } from 'react'

import { PANEL_RESET_EVENT, PANEL_STORAGE_PREFIX as STORAGE_PREFIX } from '../../lib/panelLayout.js'
import { resizedSize } from '../../lib/panelResize.js'
import './GlassPanel.css'
import './FloatingPanel.css'

/** Per-browser layout memory only — never anything the app depends on. */
function readStored(id) {
  if (!id) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStored(id, value) {
  if (!id) return
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(value))
  } catch {
    // Private window or blocked storage: the layout just isn't remembered.
  }
}

/**
 * A GlassPanel that floats over the globe: it collapses to its title bar and
 * can be resized by dragging the edges listed in `resize`.
 *
 * Which edges make sense depends on where the panel is anchored — a panel in
 * the right rail grows leftwards, so it takes 'w'; a bottom-docked panel grows
 * upwards, so it takes 'n' (see lib/panelResize.js).
 *
 * @param {object} props
 * @param {string} props.id        stable key for remembering size and state
 * @param {string} props.title
 * @param {Array<'n'|'e'|'s'|'w'>} [props.resize]
 * @param {number} [props.minWidth]
 * @param {number} [props.minHeight]
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
function FloatingPanel({
  id,
  title,
  resize = [],
  minWidth = 240,
  minHeight = 120,
  className = '',
  children,
}) {
  const stored = readStored(id)
  const [collapsed, setCollapsed] = useState(Boolean(stored?.collapsed))
  const [size, setSize] = useState({ width: stored?.width, height: stored?.height })
  const panelRef = useRef(null)

  useEffect(() => {
    writeStored(id, { collapsed, width: size.width, height: size.height })
  }, [id, collapsed, size.width, size.height])

  useEffect(() => {
    const onReset = () => {
      setCollapsed(false)
      setSize({ width: undefined, height: undefined })
    }
    window.addEventListener(PANEL_RESET_EVENT, onReset)
    return () => window.removeEventListener(PANEL_RESET_EVENT, onReset)
  }, [])

  const startResize = useCallback(
    (edge) => (event) => {
      const panel = panelRef.current
      if (!panel) return
      event.preventDefault()
      const rect = panel.getBoundingClientRect()
      const start = { width: rect.width, height: rect.height }
      const origin = { x: event.clientX, y: event.clientY }
      const handle = event.currentTarget
      handle.setPointerCapture(event.pointerId)

      const limits = {
        minWidth,
        maxWidth: window.innerWidth * 0.7,
        minHeight,
        maxHeight: window.innerHeight * 0.85,
      }

      const onMove = (moveEvent) => {
        const next = resizedSize(
          edge,
          start,
          moveEvent.clientX - origin.x,
          moveEvent.clientY - origin.y,
          limits,
        )
        setSize((prev) => ({ ...prev, ...next }))
      }
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    [minWidth, minHeight],
  )

  // Double-clicking a handle forgets the dragged size on that axis.
  const resetAxis = (edge) => () =>
    setSize((prev) =>
      edge === 'n' || edge === 's' ? { ...prev, height: undefined } : { ...prev, width: undefined },
    )

  const style = {
    width: size.width,
    // A collapsed panel is its title bar, whatever height it was dragged to.
    height: collapsed ? undefined : size.height,
  }

  return (
    <section
      ref={panelRef}
      className={`glass-panel floating-panel${collapsed ? ' is-collapsed' : ''} ${className}`.trim()}
      style={style}
    >
      <header className="glass-panel__header floating-panel__header">
        <span className="glass-panel__title ui-label">{title}</span>
        <button
          type="button"
          className="floating-panel__toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Minimize ${title}`}
          title={collapsed ? 'Expand' : 'Minimize'}
        >
          <span aria-hidden="true">{collapsed ? '+' : '−'}</span>
        </button>
      </header>

      <div className="glass-panel__body" hidden={collapsed}>
        {children}
      </div>

      {resize
        .filter((edge) => !(collapsed && (edge === 'n' || edge === 's')))
        .map((edge) => (
          <div
            key={edge}
            className={`floating-panel__handle floating-panel__handle--${edge}`}
            onPointerDown={startResize(edge)}
            onDoubleClick={resetAxis(edge)}
            role="separator"
            aria-orientation={edge === 'n' || edge === 's' ? 'horizontal' : 'vertical'}
            aria-label={`Resize ${title}`}
            title="Drag to resize · double-click to reset"
          />
        ))}
    </section>
  )
}

export default FloatingPanel
