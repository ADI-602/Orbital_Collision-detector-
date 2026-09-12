import { useState } from 'react'

import {
  PC_ACCEPTED_THRESHOLD,
  PUBLISHED_PC,
} from '../../lib/envisatGroundTruth.js'
import { formatDecade, formatPc } from '../../lib/format.js'
import './PcTrend.css'

/**
 * PcTrend — collision probability across the four 2004 prediction days,
 * against the published band and the operational threshold.
 *
 * One data series (our computed Pc) plus two reference annotations (the
 * published band, ESA's Pc_acc threshold). Both annotations are direct-
 * labelled, so nothing is identified by colour alone, and a single series
 * needs no legend box — the title names it.
 *
 * A day with no result leaves a GAP: the line breaks rather than joining the
 * points either side of it. Bridging the gap would draw a Pc for a day the
 * pipeline never produced one for.
 *
 * PALETTE NOTE. The series wears the project's own --accent (#5fd9d0) from
 * styles/tokens.css. The dataviz validator marks that hex outside its
 * dark-mode lightness band, but every legibility check passes — chroma,
 * contrast vs. surface, and CVD separation from the threshold red at ΔE 18.1
 * (deutan), well clear of the 8 target. Stepping it darker to satisfy the band
 * (#3fb3ab) still failed the band AND dropped CVD separation to 10.8, so it
 * would trade real legibility for a ramp-calibration number. The design
 * system's accent stands.
 */

const W = 380
const H = 200
const PAD = { top: 18, right: 18, bottom: 36, left: 52 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

/** Two decades, chosen to clear both the threshold and the highest Pc. */
const DOMAIN = { min: 5e-5, max: 5e-3 }

const LOG_MIN = Math.log10(DOMAIN.min)
const LOG_MAX = Math.log10(DOMAIN.max)

/** Log-scale y position for a probability. */
function yOf(value) {
  const clamped = Math.min(Math.max(value, DOMAIN.min), DOMAIN.max)
  const t = (Math.log10(clamped) - LOG_MIN) / (LOG_MAX - LOG_MIN)
  return PAD.top + (1 - t) * PLOT_H
}

/** Band centre for each day slot. */
function xOf(index, count) {
  return PAD.left + ((index + 0.5) * PLOT_W) / Math.max(count, 1)
}

/**
 * @param {object} props
 * @param {Array<{day: string, label: string, lead: string, status: string,
 *   event: {pc: number}|null}>} props.days
 */
function PcTrend({ days = [] }) {
  const [hovered, setHovered] = useState(null)

  const points = days.map((d, i) => ({
    ...d,
    index: i,
    pc: typeof d.event?.pc === 'number' ? d.event.pc : null,
    x: xOf(i, days.length),
  }))

  const plotted = points.filter((p) => p.pc !== null)

  // Split into runs of consecutive days that have values, so a missing day
  // breaks the line instead of being interpolated across.
  const segments = []
  let run = []
  for (const p of points) {
    if (p.pc === null) {
      if (run.length > 1) segments.push(run)
      run = []
    } else {
      run.push(p)
    }
  }
  if (run.length > 1) segments.push(run)

  // Direct labels on the peak and the final decision day only — the full set
  // of values lives in the table beneath this chart.
  const peak = plotted.reduce((a, b) => (b.pc > (a?.pc ?? -Infinity) ? b : a), null)
  const last = plotted.length ? plotted[plotted.length - 1] : null
  const labelled = new Set([peak?.day, last?.day].filter(Boolean))

  const bandTop = yOf(PUBLISHED_PC.max)
  const bandBottom = yOf(PUBLISHED_PC.min)
  const thresholdY = yOf(PC_ACCEPTED_THRESHOLD)

  const summary = plotted.length
    ? `Computed collision probability across ${plotted.length} prediction days, ` +
      `ranging ${formatPc(Math.min(...plotted.map((p) => p.pc)))} to ` +
      `${formatPc(Math.max(...plotted.map((p) => p.pc)))}, against a published band of ` +
      `${formatPc(PUBLISHED_PC.min)} to ${formatPc(PUBLISHED_PC.max)}.`
    : 'No collision probabilities computed yet.'

  return (
    <div className="pc-trend">
      <svg
        className="pc-trend__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={summary}
      >
        {/* Published band — a region, not a series. */}
        <rect
          className="pc-trend__band"
          x={PAD.left}
          y={bandTop}
          width={PLOT_W}
          height={Math.max(bandBottom - bandTop, 1)}
        />
        <text
          className="pc-trend__annot"
          x={PAD.left + PLOT_W - 6}
          y={(bandTop + bandBottom) / 2 + 3}
          textAnchor="end"
        >
          published {formatPc(PUBLISHED_PC.min)}–{formatPc(PUBLISHED_PC.max)}
        </text>

        {/* Decade gridlines, recessive. */}
        {[1e-4, 1e-3].map((tick) => (
          <g key={tick}>
            <line
              className="pc-trend__grid"
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={yOf(tick)}
              y2={yOf(tick)}
            />
            <text className="pc-trend__tick" x={PAD.left - 8} y={yOf(tick) + 3.5}>
              {formatDecade(tick)}
            </text>
          </g>
        ))}

        {/* ESA's accepted-risk threshold: the line that forced the burn. */}
        <line
          className="pc-trend__threshold"
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={thresholdY}
          y2={thresholdY}
        />
        <text
          className="pc-trend__annot pc-trend__annot--threshold"
          x={PAD.left + 2}
          y={thresholdY + 12}
        >
          Pc_acc {formatPc(PC_ACCEPTED_THRESHOLD, 0)} — ESA 2004
        </text>

        {segments.map((seg) => (
          <polyline
            key={seg[0].day}
            className="pc-trend__line"
            points={seg.map((p) => `${p.x},${yOf(p.pc)}`).join(' ')}
          />
        ))}

        {points.map((p) => (
          <g key={p.day}>
            {p.pc !== null && (
              <>
                <circle
                  className="pc-trend__dot"
                  cx={p.x}
                  cy={yOf(p.pc)}
                  r={hovered === p.day ? 6 : 4.5}
                />
                {labelled.has(p.day) && (
                  <text
                    className="pc-trend__value"
                    x={p.x}
                    y={yOf(p.pc) - 11}
                    textAnchor="middle"
                  >
                    {formatPc(p.pc)}
                  </text>
                )}
              </>
            )}

            <text className="pc-trend__day" x={p.x} y={H - 16} textAnchor="middle">
              {p.label}
            </text>
            <text className="pc-trend__lead" x={p.x} y={H - 5} textAnchor="middle">
              {p.lead}
            </text>

            {/* Hit target spanning the full column, far larger than the dot. */}
            <rect
              className="pc-trend__hit"
              x={p.x - PLOT_W / Math.max(days.length, 1) / 2}
              y={PAD.top}
              width={PLOT_W / Math.max(days.length, 1)}
              height={PLOT_H}
              onMouseEnter={() => setHovered(p.day)}
              onMouseLeave={() => setHovered(null)}
            />
          </g>
        ))}
      </svg>

      {hovered && (
        <div
          className="pc-trend__tip"
          style={{
            left: `${(points.find((p) => p.day === hovered).x / W) * 100}%`,
          }}
        >
          <span className="pc-trend__tip-day">
            {points.find((p) => p.day === hovered).label}{' '}
            {points.find((p) => p.day === hovered).lead}
          </span>
          <span className="pc-trend__tip-pc ui-readout">
            {points.find((p) => p.day === hovered).pc === null
              ? 'no result'
              : `Pc ${formatPc(points.find((p) => p.day === hovered).pc)}`}
          </span>
        </div>
      )}
    </div>
  )
}

export default PcTrend
