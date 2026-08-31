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
 * Takes health as a prop rather than calling the hook itself, so polling
 * happens exactly once in Console and the offline banner reads the same
 * state this chip does.
 *
 * @param {object} props
 * @param {{status: string, data: object|null, error: Error|null}} props.health
 */
function StatusHeader({ health }) {
  const clock = useMissionClock()
  const backend = backendChip(health)

  return (
    <header className="status-header">
      <div className="status-header__left">
        <span className="status-header__wordmark">ORBITAL RISK ADVISOR</span>

        <nav className="status-header__tabs">
          <span className="status-header__tab is-active">Live console</span>
          {/*
            Disabled rather than hidden: the Envisat replay is the system's
            correctness proof and deserves a visible slot in the information
            architecture. It is marked unavailable because it genuinely is —
            a tab that looked live but did nothing would be worse than none.
          */}
          <span
            className="status-header__tab is-disabled"
            title="Historical Envisat 2004 replay — not built yet"
          >
            Envisat replay
            <span className="status-header__tab-note">soon</span>
          </span>
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
