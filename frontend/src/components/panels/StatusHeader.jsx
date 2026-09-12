import { API_BASE_URL } from '../../api/client.js'
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
 * Console top bar: identity, view tabs, UTC clock, system status.
 *
 * Takes health as a prop rather than calling the hook itself, so the page
 * that owns the view polls exactly once and the offline banner reads the same
 * state this chip does. Console and Replay each poll their own, which is not
 * duplication: they are mounted exclusively, so only one poller ever runs.
 *
 * @param {object} props
 * @param {{status: string, data: object|null, error: Error|null}} props.health
 * @param {'console'|'replay'} [props.view]  which view is showing
 * @param {(view: 'console'|'replay') => void} [props.onViewChange]
 */
function StatusHeader({ health, view = 'console', onViewChange }) {
  const clock = useMissionClock()
  const backend = backendChip(health)

  return (
    <header className="status-header">
      <div className="status-header__left">
        <span className="status-header__wordmark">ORBITAL RISK ADVISOR</span>

        <nav className="status-header__tabs">
          {/*
            Two views, both live. The replay is the system's correctness proof
            and keeps its own slot in the information architecture rather than
            being buried inside the console.
          */}
          <button
            type="button"
            className={`status-header__tab ${view === 'console' ? 'is-active' : ''}`}
            onClick={() => onViewChange?.('console')}
            aria-current={view === 'console' ? 'page' : undefined}
          >
            Live console
          </button>
          <button
            type="button"
            className={`status-header__tab ${view === 'replay' ? 'is-active' : ''}`}
            onClick={() => onViewChange?.('replay')}
            aria-current={view === 'replay' ? 'page' : undefined}
            title="Historical Envisat 2004 conjunction, recomputed by the live pipeline"
          >
            Envisat replay
          </button>
        </nav>
      </div>

      <div className="status-header__right">
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
