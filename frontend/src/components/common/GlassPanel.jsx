import './GlassPanel.css'

/**
 * The one translucent card style, reused across every panel in the console.
 *
 * @param {object} props
 * @param {string} [props.title]   optional HUD label in the header row
 * @param {import('react').ReactNode} [props.actions] right-aligned header slot
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
function GlassPanel({ title, actions, className = '', children }) {
  return (
    <section className={`glass-panel ${className}`.trim()}>
      {(title || actions) && (
        <header className="glass-panel__header">
          {title && <span className="glass-panel__title ui-label">{title}</span>}
          {actions && <div className="glass-panel__actions">{actions}</div>}
        </header>
      )}
      <div className="glass-panel__body">{children}</div>
    </section>
  )
}

export default GlassPanel
