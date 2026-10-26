import { useId, useMemo, useState } from 'react'

import { searchObjects } from '../../lib/objectSearch.js'
import './ObjectSearch.css'

const MAX_RESULTS = 6

/**
 * Type-ahead search over the tracked set, by name or NORAD id.
 *
 * An ARIA combobox: arrow keys move through the matches, Enter picks the
 * highlighted one, Escape clears. Results render inline rather than as a
 * floating dropdown, because floating panels clip their bodies.
 *
 * @param {object} props
 * @param {Array<{id: string, name: string, noradId: string}>} props.objects
 * @param {(id: string) => void} props.onPick
 */
function ObjectSearch({ objects, onPick }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const inputId = useId()

  const { results, total } = useMemo(
    () => searchObjects(objects, query, MAX_RESULTS),
    [objects, query],
  )
  const open = query.trim().length > 0
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0))

  const pick = (object) => {
    onPick(object.id)
    setQuery('')
    setActive(0)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault()
      setActive((activeIndex + 1) % results.length)
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault()
      setActive((activeIndex - 1 + results.length) % results.length)
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      pick(results[activeIndex])
    } else if (event.key === 'Escape') {
      setQuery('')
      setActive(0)
    }
  }

  return (
    <div className="object-search">
      <label htmlFor={inputId} className="object-search__label ui-label">
        Find an object
      </label>
      <input
        id={inputId}
        type="search"
        className="object-search__input"
        placeholder="Name or NORAD id"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results.length ? `${listId}-${activeIndex}` : undefined}
      />

      {open && (
        <ul id={listId} className="object-search__results" role="listbox" aria-label="Matching objects">
          {results.map((object, i) => (
            <li
              key={object.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`object-search__option${i === activeIndex ? ' is-active' : ''}`}
              // mousedown, not click: picking must happen before the input
              // loses focus.
              onMouseDown={(event) => {
                event.preventDefault()
                pick(object)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="object-search__name">{object.name}</span>
              <span className="object-search__norad ui-readout">{object.noradId}</span>
            </li>
          ))}
          {results.length === 0 && (
            <li className="object-search__empty" role="presentation">
              No tracked object matches “{query.trim()}”.
            </li>
          )}
          {total > results.length && (
            <li className="object-search__more" role="presentation">
              {total - results.length} more — keep typing to narrow it down.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

export default ObjectSearch
