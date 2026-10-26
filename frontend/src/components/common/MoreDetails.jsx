import './MoreDetails.css'

/**
 * A native disclosure for the long-form provenance notes.
 *
 * The notes stay in the page — CLAUDE.md requires every figure's source and
 * every scope caveat to be stated — but behind one click, so the figures
 * themselves fit on a laptop screen. Native <details> gives keyboard and
 * screen-reader support for free.
 *
 * @param {object} props
 * @param {string} [props.summary] the always-visible line
 * @param {import('react').ReactNode} props.children
 */
function MoreDetails({ summary = 'Where these numbers come from', children }) {
  return (
    <details className="more-details">
      <summary className="more-details__summary">{summary}</summary>
      <div className="more-details__body">{children}</div>
    </details>
  )
}

export default MoreDetails
