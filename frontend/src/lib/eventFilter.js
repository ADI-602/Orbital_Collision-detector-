/**
 * eventFilter.js — which rows of the event list are on screen.
 *
 * A display filter only: it never changes, re-ranks or re-labels an event,
 * and whatever it hides is always counted on screen (EventList), so a filter
 * can never be mistaken for "nothing was detected".
 */
import { isNotARisk } from './conjunctions.js'

/**
 * The filter categories, in display order. OTHER holds pairs that are not a
 * risk statement (co-orbital or refused) and any level the backend might emit
 * that the console does not recognise — never folded into GREEN.
 */
export const EVENT_CATEGORIES = ['RED', 'YELLOW', 'GREEN', 'OTHER']

/**
 * @param {object} event
 * @returns {'RED' | 'YELLOW' | 'GREEN' | 'OTHER'}
 */
export function eventCategory(event) {
  if (isNotARisk(event)) return 'OTHER'
  const level = event?.threat_level
  return level === 'RED' || level === 'YELLOW' || level === 'GREEN' ? level : 'OTHER'
}

/**
 * @param {object[]} events
 * @returns {Record<'RED' | 'YELLOW' | 'GREEN' | 'OTHER', number>}
 */
export function countByCategory(events) {
  const counts = { RED: 0, YELLOW: 0, GREEN: 0, OTHER: 0 }
  for (const event of events ?? []) counts[eventCategory(event)] += 1
  return counts
}

/**
 * Keep the events whose category is not hidden. Order is preserved.
 *
 * @param {object[]} events
 * @param {Set<string>} hidden categories to leave out
 * @returns {object[]}
 */
export function filterEvents(events, hidden) {
  if (!hidden?.size) return events ?? []
  return (events ?? []).filter((event) => !hidden.has(eventCategory(event)))
}
