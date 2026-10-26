import MoreDetails from '../common/MoreDetails.jsx'
import RiskBadge from '../common/RiskBadge.jsx'
import TMinus from '../common/TMinus.jsx'
import {
  EVENT_ORIGIN,
  THREAT_THRESHOLDS,
  classifyEncounter,
  formatMissDistance,
  formatPc,
  formatRelativeSpeed,
  hasGlobePresence,
  isUnassessable,
  splitTcaIso,
} from '../../lib/conjunctions.js'
import { isoToMs } from '../../lib/replay.js'
import './EventDetail.css'

/**
 * The selected conjunction, in full.
 *
 * Every figure below is rendered exactly as /api/physics/screening returned
 * it — no rescaling, no rounding into a friendlier range, no derived
 * "severity score". The threat badge is the backend's own threat_level
 * (backend/api/main.py:233).
 *
 * Pc is a plain readout rather than a gauge on purpose. GaugeCard fills
 * linearly over 0..max, and a real Pc of 6.6e-4 would draw as an empty ring —
 * a RED event that looks like nothing. Severity is carried by the badge, which
 * cannot be misread at a distance.
 *
 * @param {object} props
 * @param {object|null} props.event selected screening event, or null
 * @param {() => void} [props.onOpenReplay] switch to the Envisat replay view
 */
/**
 * What the globe is showing for a selected pair.
 *
 * Said explicitly because the two orbit rings are the one thing on screen that
 * the pipeline did not produce: they are the markers' own paths, propagated
 * in-browser from the same element sets (lib/orbitTrack.js), drawn so the
 * encounter geometry is visible. Every figure on this panel is the pipeline's.
 */
const GLOBE_PRESENT_NOTE =
  'Highlighted on the globe — both objects are in the live tracked set, with ' +
  'one revolution of each orbit drawn from the same element sets. The rings ' +
  'are propagated in-browser to show the geometry; the numbers here are the ' +
  "pipeline's."

function EventDetail({ event, onOpenReplay }) {
  if (!event) {
    return (
      <div className="event-detail event-detail--empty">
        <span className="event-detail__empty-title">No conjunction selected</span>
        <span className="event-detail__empty-hint">
          Pick an event from the Conjunction events tab to see its miss
          distance, collision probability and time of closest approach.
          Screening runs continuously on the server; the list holds the last
          completed pass.
        </span>
      </div>
    )
  }

  const unassessable = isUnassessable(event)
  const { kind, reason } = classifyEncounter(event)
  const coOrbital = !unassessable && kind === 'co-orbital'
  const injected = event.origin === EVENT_ORIGIN.VALIDATION
  const tca = splitTcaIso(event.tca_utc_iso)

  // A pair the pipeline refused carries no numbers at all, so the whole
  // numeric block is omitted rather than filled with em dashes pretending to
  // be measurements that were simply unavailable.
  if (unassessable) {
    return (
      <div className="event-detail">
        <div className="event-detail__head">
          <div className="event-detail__pair">
            <span className="event-detail__primary">{event.primary_name ?? 'Primary'}</span>
            <span className="event-detail__arrow" aria-hidden="true">↔</span>
            <span className="event-detail__secondary">{event.secondary_name}</span>
          </div>
          <RiskBadge label="Not assessed" />
        </div>

        <p className="event-detail__co-orbital">
          The pipeline declined to compute a collision probability for this
          pair, reporting:
          <span className="event-detail__reason">{event.reason}</span>
          <span className="event-detail__co-orbital-note">
            These two catalogue entries share an orbit — they are parts of one
            stack, not objects approaching each other. This is the physics
            refusing an undefined calculation, not a pipeline failure, and no
            number has been substituted for the one it would not produce.
          </span>
        </p>

        <p className="event-detail__globe-note">
          {hasGlobePresence(event) ? GLOBE_PRESENT_NOTE : 'Not shown on the globe.'}
        </p>
      </div>
    )
  }

  return (
    <div className="event-detail">
      <div className="event-detail__head">
        <div className="event-detail__pair">
          <span className="event-detail__primary">{event.primary_name ?? 'Primary'}</span>
          <span className="event-detail__arrow" aria-hidden="true">↔</span>
          <span className="event-detail__secondary">{event.secondary_name}</span>
        </div>
        <div className="event-detail__tags">
          {coOrbital ? <RiskBadge label="Co-orbital" /> : <RiskBadge level={event.threat_level} />}
          {/* The tag stays on screen; its full provenance is one click away. */}
          {injected && <span className="event-detail__tag">Injected · 2004 replay</span>}
        </div>
      </div>

      {/* Pc leads: it is the number the whole pipeline exists to produce. */}
      <div className="event-detail__headline">
        <span className="event-detail__headline-label ui-label">Collision probability</span>
        {coOrbital ? (
          <span className="event-detail__headline-na">Not applicable</span>
        ) : (
          <span className="event-detail__headline-value ui-readout">{formatPc(event.pc)}</span>
        )}
        {!coOrbital && (
          <span className="event-detail__scale">
            RED ≥ {THREAT_THRESHOLDS.RED.toExponential(0)} · YELLOW ≥{' '}
            {THREAT_THRESHOLDS.YELLOW.toExponential(0)}
          </span>
        )}
      </div>

      {coOrbital && (
        <p className="event-detail__co-orbital">
          {reason}
          <span className="event-detail__co-orbital-note">
            Frontend classification from the pipeline's own relative speed — not
            a backend verdict, and nothing was discarded.
          </span>
        </p>
      )}

      <div className="event-detail__rows">
        <div className="event-detail__row">
          <span className="event-detail__key">Miss distance</span>
          <span className="event-detail__val ui-readout">
            {formatMissDistance(event.miss_distance_m)}
          </span>
        </div>
        <div className="event-detail__row">
          <span className="event-detail__key">Relative speed</span>
          <span className="event-detail__val ui-readout">
            {formatRelativeSpeed(event.relative_speed_km_s)}
          </span>
        </div>
        <div className="event-detail__row">
          <span className="event-detail__key">TCA (UTC)</span>
          <span className="event-detail__val ui-readout" title={tca.raw}>
            {tca.date} {tca.time}
          </span>
        </div>
      </div>

      {/*
        A countdown only means something against a clock that can reach the
        target. A live event's TCA is a real future instant, so it counts down
        against real UTC. The injected 2004 case would read "T+21 years" here,
        which is true and useless — it gets a route to the replay view, which
        has a clock that actually runs through the encounter.
      */}
      {injected ? (
        onOpenReplay && (
          <button type="button" className="event-detail__replay-button" onClick={onOpenReplay}>
            Open Envisat replay
          </button>
        )
      ) : (
        <TMinus targetMs={isoToMs(event.tca_utc_iso)} mode="wall" />
      )}

      {/* The one provenance line that must never be hidden. */}
      <p className="event-detail__source">
        Computed by the physics pipeline. No AI in any number here.
      </p>

      <MoreDetails>
        <p>
          SGP4 propagation, refined TCA, 2D encounter-plane Pc (Foster/Chan/Alfano).
        </p>
        {injected && (
          <p>
            <strong>Injected validation case.</strong> {event.provenance?.label}. Published:{' '}
            {event.provenance?.published} ({event.provenance?.source}). Replayed through
            the live pipeline — the values above are computed, not quoted.
          </p>
        )}
        {injected ? (
          <p>
            This encounter happened in October 2004. Counting down to it against
            today&rsquo;s clock would be meaningless, so the countdown lives in the
            replay view, which runs on a clock around the real TCA.
          </p>
        ) : (
          <p>The countdown runs against real UTC to the TCA the pipeline refined.</p>
        )}
        <p>
          {hasGlobePresence(event)
            ? GLOBE_PRESENT_NOTE
            : 'Not shown on the globe: this is a historical 2004 event, and the ' +
              'globe is tracking objects at the current time.'}
        </p>
      </MoreDetails>
    </div>
  )
}

export default EventDetail
