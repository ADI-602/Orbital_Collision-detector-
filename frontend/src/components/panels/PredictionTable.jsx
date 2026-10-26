import ErrorState from '../common/ErrorState.jsx'
import MoreDetails from '../common/MoreDetails.jsx'
import RiskBadge from '../common/RiskBadge.jsx'
import Term from '../common/Term.jsx'
import { formatMissDistance, formatPc } from '../../lib/conjunctions.js'
import {
  ASSERTED_MISS_DISTANCE_M,
  ASSERTED_PC,
  PUBLISHED_MISS_DISTANCE_M,
  PUBLISHED_PC,
  PUBLISHED_SOURCE,
  formatBand,
  withinBand,
} from '../../lib/replay.js'
import './PredictionTable.css'

/**
 * The four consecutive predictions ESA made before the 22 Oct 2004
 * conjunction, each re-run through this pipeline.
 *
 * WHY FOUR ROWS AND NOT A TREND LINE. The four element sets differ only in
 * age; they all describe the same encounter. The computed miss distances do
 * NOT converge monotonically as the epoch approaches (329 m, 234 m, 152 m,
 * 269 m), and neither does Pc. Drawing them as a converging trend would
 * assert a sharpening estimate that the data does not show. What the four
 * rows actually demonstrate is agreement: every prediction, from a
 * three-day-old element set to a same-day one, puts the encounter
 * sub-kilometre and above ESA's acceptance threshold. That is the paper's own
 * framing, which reports a range rather than a per-day figure.
 *
 * WHY TWO REFERENCE BANDS. The published band is what the paper reported.
 * The asserted band is what tests/test_envisat_replay.py actually gates on,
 * and it is wider on purpose: we drive the pipeline from public-catalog TLEs
 * while ESA used Envisat's operational orbit determination. Showing only the
 * published band would mark three of four rows as misses and misreport a
 * passing pipeline; showing only the asserted band would hide the fact that
 * our inputs are coarser. Both are shown, labelled.
 *
 * @param {object} props
 * @param {Array<object>} props.days from useEnvisatReplay
 * @param {boolean} props.loading
 */
/**
 * Band membership as a CSS modifier. `withinBand` returns null when there was
 * no number to check, and that must not collapse into "outside" — an
 * uncomputed value is not a failed one.
 */
function bandClass(value, band) {
  const ok = withinBand(value, band)
  if (ok === null) return 'is-unknown'
  return ok ? 'is-in' : 'is-out'
}

function PredictionTable({ days, loading }) {
  const rows = days ?? []
  const computed = rows.filter((d) => d.event)

  return (
    <div className="prediction-table">
      {/* The reference ranges lead: they are what every row is judged
          against, and below the rows they scrolled out of a laptop-height strip. */}
      <dl className="prediction-table__bands">
        <div className="prediction-table__band">
          <dt className="ui-label">Published</dt>
          <dd className="ui-readout">
            {formatBand(PUBLISHED_MISS_DISTANCE_M, (v) => `${v} m`)} ·{' '}
            {formatBand(PUBLISHED_PC, (v) => v.toExponential(1))}
          </dd>
        </div>
        <div className="prediction-table__band">
          <dt className="ui-label" title="Values inside this range are underlined in the rows below">
            Tested range <span className="prediction-table__band-hint">(underlined)</span>
          </dt>
          <dd className="ui-readout">
            {formatBand(ASSERTED_MISS_DISTANCE_M, (v) => `${v} m`)} ·{' '}
            {formatBand(ASSERTED_PC, (v) => v.toExponential(1))}
          </dd>
        </div>
      </dl>

      <div className="prediction-table__grid" role="table" aria-label="Prediction days">
        <div className="prediction-table__head" role="row">
          <span className="ui-label" role="columnheader">Prediction</span>
          <span className="ui-label" role="columnheader">Lead</span>
          <span className="ui-label prediction-table__num" role="columnheader">
            <Term id="missDistance">Miss</Term>
          </span>
          <span className="ui-label prediction-table__num" role="columnheader">
            <Term id="pc">Pc</Term>
          </span>
          <span className="ui-label prediction-table__num" role="columnheader">Threat</span>
        </div>

        {rows.map((day) => {
          const e = day.event
          const missOk = withinBand(e?.miss_distance_m, ASSERTED_MISS_DISTANCE_M)
          const pcOk = withinBand(e?.pc, ASSERTED_PC)
          const bandTitle = (ok) =>
            ok === null
              ? 'Not computed'
              : ok
                ? 'Inside the range the regression test asserts'
                : 'Outside the range the regression test asserts'

          return (
            <div className="prediction-table__row" role="row" key={day.key}>
              <span className="prediction-table__day" role="cell">
                {day.label}
                {day.predictionDate && (
                  <span className="prediction-table__date">{day.predictionDate}</span>
                )}
              </span>
              <span className="prediction-table__lead" role="cell">{day.lead}</span>

              {e ? (
                <>
                  <span
                    className={`prediction-table__num ui-readout ${bandClass(e.miss_distance_m, ASSERTED_MISS_DISTANCE_M)}`}
                    role="cell"
                    title={bandTitle(missOk)}
                  >
                    {formatMissDistance(e.miss_distance_m)}
                  </span>
                  <span
                    className={`prediction-table__num ui-readout ${bandClass(e.pc, ASSERTED_PC)}`}
                    role="cell"
                    title={bandTitle(pcOk)}
                  >
                    {formatPc(e.pc)}
                  </span>
                  <span className="prediction-table__num" role="cell">
                    <RiskBadge level={e.threat_level} />
                  </span>
                </>
              ) : (
                /* No numbers at all rather than dashes in numeric columns: a
                   row that failed to compute must not look like a row that
                   computed something small. */
                <span className="prediction-table__pending" role="cell">
                  {loading
                    ? 'Screening…'
                    : day.error
                      ? `Failed: ${day.error.detail ?? day.error.message}`
                      : 'Pipeline returned no event for this day'}
                </span>
              )}
            </div>
          )
        })}
      </div>


      <MoreDetails summary="Why two ranges">
        <p>
          The paper gives a range across all four predictions, not a value per
          day, so there is no per-day published figure to compare against.
          Highlighting marks the range <code>tests/test_envisat_replay.py</code>{' '}
          asserts, which is wider than the published one because this pipeline
          runs on public-catalog TLEs while ESA used Envisat&rsquo;s operational
          orbit determination (in-track 1&sigma; ~3 m against ~556 m for a TLE).
        </p>
        <p>Source: {PUBLISHED_SOURCE}.</p>
      </MoreDetails>

      {!loading && computed.length === 0 && (
        <ErrorState
          title="No prediction day computed"
          detail="Every screening request for this event failed or returned no conjunction."
          hint="The replay is the pipeline's correctness proof — an empty table here means the physics, not the view, needs looking at. Check the backend log."
        />
      )}
    </div>
  )
}

export default PredictionTable
