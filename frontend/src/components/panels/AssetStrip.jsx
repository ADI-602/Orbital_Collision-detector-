import { useState } from 'react'

import PendingRegion from '../common/PendingRegion.jsx'
import './AssetStrip.css'

/**
 * Bottom strip: a local tab switch between the objects currently being
 * tracked and the conjunction events detected between them.
 *
 * The two tabs are deliberately in different states of completeness, and the
 * UI says so plainly. "Tracked Objects" is real, live data. "Conjunction
 * Events" has no detection wired yet, so it renders an empty state rather
 * than sample rows — placeholder conjunctions would be indistinguishable
 * from real pipeline output on a projector.
 *
 * @param {object} props
 * @param {Array<object>} props.satellites propagated LiveSatellite list
 * @param {string|null} props.selectedId
 * @param {(id: string) => void} props.onSelect
 */
function AssetStrip({ satellites, selectedId, onSelect }) {
  const [tab, setTab] = useState('objects')

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
        <PendingRegion
          region="No detection run yet"
          awaiting="Conjunction screening across the tracked set is not wired up yet."
        />
      )}
    </div>
  )
}

export default AssetStrip
