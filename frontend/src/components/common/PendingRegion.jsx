import './PendingRegion.css'

/**
 * Placeholder for a console region that is reserved but not yet built.
 *
 * Every unbuilt region uses this one component so the whole set is labelled
 * identically, is honest about what is missing, and is greppable when it is
 * time to delete them.
 *
 * HARD RULE: text only. Never put a number, a unit, or anything shaped like
 * pipeline output in here — not a sample Pc, not a placeholder miss
 * distance. During a live demo a camera cannot tell a mock number from a
 * real one, and the project's entire claim is that we did not fake the
 * science. `awaiting` describes the step that will fill the region; it must
 * stay prose.
 *
 * @param {object} props
 * @param {string} props.region   what will live here, e.g. "EVENT LIST"
 * @param {string} props.awaiting which step fills it
 */
function PendingRegion({ region, awaiting }) {
  return (
    <div className="pending-region">
      <span className="pending-region__mark" aria-hidden="true">
        +
      </span>
      <span className="pending-region__name">{region}</span>
      <span className="pending-region__awaiting">{awaiting}</span>
    </div>
  )
}

export default PendingRegion
