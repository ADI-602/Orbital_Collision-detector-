import {
  HISTORICAL_MANEUVER,
  formatTMinus,
  replayProgress,
  replayWindow,
  tMinus,
} from '../../lib/replay.js'
import './ReplayScrubber.css'

const MINUTE_MS = 60_000

/**
 * A timeline over the replay window, with the two moments a presenter talks
 * through marked on it: the burn ESA flew, and the closest approach.
 *
 * It moves the replay clock and nothing else — every figure on the page is
 * the pipeline's and is unaffected by where the clock is.
 *
 * The burn mark sits HISTORICAL_MANEUVER.leadTimeMinutes before the TCA this
 * pipeline refined, which is the same lead the burn simulation uses.
 *
 * @param {object} props
 * @param {number} props.tcaMs     the refined TCA, epoch ms
 * @param {number} props.simMs     the instant currently drawn
 * @param {(targetSimMs: number) => void} props.onSeek
 * @param {string} [props.tcaColorHex] the event's risk colour, for the TCA mark
 */
function ReplayScrubber({ tcaMs, simMs, onSeek, tcaColorHex }) {
  if (!Number.isFinite(tcaMs)) return null

  const { startMs, spanMs } = replayWindow(tcaMs)
  const spanMinutes = spanMs / MINUTE_MS
  const value = Number.isFinite(simMs)
    ? Math.min(spanMinutes, Math.max(0, (simMs - startMs) / MINUTE_MS))
    : 0
  const burnMs = tcaMs - HISTORICAL_MANEUVER.leadTimeMinutes * MINUTE_MS

  // The thumb is 16 px wide, so its centre runs from 8 px to (100% - 8 px).
  // Marks use the same span, so a mark and the thumb line up exactly.
  const at = (ms) => `calc(8px + (100% - 16px) * ${replayProgress(tcaMs, ms)})`

  return (
    <div className="replay-scrubber">
      <div className="replay-scrubber__track">
        <input
          type="range"
          className="replay-scrubber__range"
          style={{ '--fill': `${(value / spanMinutes) * 100}%` }}
          min={0}
          max={spanMinutes}
          step={0.25}
          value={value}
          onChange={(event) => onSeek(startMs + Number(event.target.value) * MINUTE_MS)}
          aria-label="Replay time"
          aria-valuetext={formatTMinus(tMinus(tcaMs, simMs))}
        />
        <button
          type="button"
          className="replay-scrubber__mark replay-scrubber__mark--burn"
          style={{ left: at(burnMs) }}
          onClick={() => onSeek(burnMs)}
          title={`Jump to the burn, ${HISTORICAL_MANEUVER.leadTimeMinutes} min before TCA (B)`}
        >
          Burn
        </button>
        <button
          type="button"
          className="replay-scrubber__mark replay-scrubber__mark--tca"
          style={{ left: at(tcaMs), color: tcaColorHex }}
          onClick={() => onSeek(tcaMs)}
          title="Jump to the closest approach (T)"
        >
          TCA
        </button>
      </div>
      <p className="replay-scrubber__keys">
        <kbd>Space</kbd> pause · <kbd>R</kbd> restart · <kbd>←</kbd> <kbd>→</kbd> 1 min ·{' '}
        <kbd>B</kbd> burn · <kbd>T</kbd> TCA
      </p>
    </div>
  )
}

export default ReplayScrubber
