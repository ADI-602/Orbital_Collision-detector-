import { API_BASE_URL } from '../../api/client.js'
import { resetPanelLayout } from '../../lib/panelLayout.js'
import ValidationBadge from './ValidationBadge.jsx'
import { useMissionClock } from '../../hooks/useMissionClock.js'
import './StatusHeader.css'

/**
 * Map health-hook state onto chip presentation. Every branch reports what is
 * actually known — there is no optimistic "online".
 */
function backendChip(health) {
  if (health.status === 'online') {
    return {
      tone: 'online',
      text: 'Online',
      title: `${API_BASE_URL} — ${health.data?.service ?? ''} v${health.data?.version ?? '?'}`,
    }
  }
  if (health.status === 'offline') {
    return {
      tone: 'offline',
      text: 'Offline',
      title: `${API_BASE_URL} — ${health.error?.detail ?? health.error?.message ?? 'unreachable'}`,
    }
  }
  return { tone: 'pending', text: 'Connecting', title: API_BASE_URL }
}

/**
 * The two views, and what distinguishes them. The replay carries a permanent
 * "2004" marker because everything in it is historical: a viewer glancing at
 * the tab must never have to work out whether they are looking at live orbits.
 */
const VIEWS = [
  { key: 'console', label: 'Live console', note: null },
  { key: 'replay', label: 'Envisat replay', note: '2004' },
]

/**
 * Console top bar: identity, view tabs, UTC clock, system status.
 *
 * Takes health as a prop rather than calling the hook itself, so polling
 * happens exactly once per page and the offline banner reads the same state
 * this chip does.
 *
 * The clock here is always real UTC now, on both views. The replay's own 2004
 * clock is shown over its globe, never in this bar — one mission clock that
 * silently changed epoch when you switched tabs would be a genuine hazard on
 * stage.
 *
 * @param {object} props
 * @param {{status: string, data: object|null, error: Error|null}} props.health
 * @param {'console'|'replay'} props.view
 * @param {(view: string) => void} props.onChangeView
 */
function StatusHeader({ health, view = 'console', onChangeView }) {
  const clock = useMissionClock()
  const backend = backendChip(health)

  return (
    <header className="status-header">
      <div className="status-header__left">
        <span className="status-header__wordmark">ORBITAL RISK ADVISOR</span>

        <nav className="status-header__tabs">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={`status-header__tab${v.key === view ? ' is-active' : ''}`}
              aria-current={v.key === view ? 'page' : undefined}
              onClick={() => onChangeView?.(v.key)}
            >
              {v.label}
              {v.note && <span className="status-header__tab-note">{v.note}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="status-header__right">
        <ValidationBadge />

        <button
          type="button"
          className="status-header__reset"
          onClick={resetPanelLayout}
          title="Put every panel back to its default size and expand any that are minimised"
        >
          Reset layout
        </button>

        <div className="status-header__clock">
          <span className="status-header__clock-time ui-readout">{clock.timeUtc}</span>
          <span className="status-header__clock-zone">UTC</span>
        </div>

        <span
          className={`status-header__chip status-header__chip--${backend.tone}`}
          title={backend.title}
        >
          <span className="status-header__dot" aria-hidden="true" />
          Backend
          <strong>{backend.text}</strong>
        </span>
      </div>
    </header>
  )
}

export default StatusHeader
