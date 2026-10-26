import { useState } from 'react'

import EventList from './EventList.jsx'
import './AssetStrip.css'

/**
 * Bottom strip: a local tab switch between the objects currently being
 * tracked and the conjunction events detected between them.
 *
 * Both tabs now carry real data, from two different places. "Tracked objects"
 * is client-side SGP4 ephemeris for the globe. "Conjunction events" is output
 * of the validated Python pipeline. They are never mixed: no number from the
 * globe's propagation appears in an event row.
 *
 * This component owns no conjunction logic — it hands `screening` straight to
 * EventList, which is presentational over lib/conjunctions.js.
 *
 * @param {object} props
 * @param {Array<object>} props.satellites propagated LiveSatellite list
 * @param {string|null} props.selectedId
 * @param {(id: string) => void} props.onSelect
 * @param {object} props.screening        useScreening() state + actions
 * @param {string|null} props.selectedEventKey
 * @param {(key: string|null) => void} props.onSelectEvent
 */
function AssetStrip({
  satellites,
  selectedId,
  onSelect,
  screening,
  selectedEventKey,
  onSelectEvent,
}) {
  // Events first: the detections are what the console exists to show.
  const [tab, setTab] = useState('events')

  return (
    <div className="asset-strip">
      <div className="asset-strip__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'objects'}
          className={`asset-strip__tab ${tab === 'objects' ? 'is-active' : ''}`}
          onClick={() => setTab('objects')}
        >
          Tracked objects
          <span className="asset-strip__count">{satellites.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'events'}
          className={`asset-strip__tab ${tab === 'events' ? 'is-active' : ''}`}
          onClick={() => setTab('events')}
        >
          Conjunction events
          {screening.status === 'ready' && (
            <span className="asset-strip__count">{screening.events.length}</span>
          )}
        </button>
      </div>

      {tab === 'objects' ? (
        <div className="asset-strip__cards">
          {satellites.length === 0 ? (
            <span className="asset-strip__empty">Awaiting tracking data…</span>
          ) : (
            satellites.map((sat) => (
              <button
                type="button"
                key={sat.id}
                className={`asset-card ${selectedId === sat.id ? 'is-selected' : ''}`}
                onClick={() => onSelect(sat.id)}
              >
                <span className="asset-card__name">{sat.name}</span>
                <span className="asset-card__meta">
                  <span className="asset-card__norad ui-readout">{sat.noradId}</span>
                  <span className="asset-card__alt ui-readout">
                    {sat.altitude_km.toFixed(0)} km
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        <EventList
          events={screening.events}
          status={screening.status}
          pass={screening.pass}
          liveError={screening.liveError}
          validationError={screening.validationError}
          triggering={screening.triggering}
          watchingPass={screening.watchingPass}
          schedule={screening.schedule}
          selectedKey={selectedEventKey}
          onSelect={onSelectEvent}
          onRefresh={screening.refresh}
          onScreenNow={screening.screenNow}
        />
      )}
    </div>
  )
}

export default AssetStrip
