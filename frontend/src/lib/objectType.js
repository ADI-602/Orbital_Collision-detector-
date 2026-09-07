/**
 * objectType.js — payload / debris / rocket body, for legibility on a globe.
 *
 * ============================ WHAT THIS IS ============================
 * A DISPLAY HEURISTIC read off the catalogue NAME, not authoritative metadata.
 * CelesTrak's TLE format carries no object-type field; the convention is a
 * suffix on the name — "COSMOS 2251 DEB", "SL-16 R/B". This module reads that
 * convention and nothing more.
 *
 * So it can be wrong, and the UI must not present it as a catalogue fact. It
 * decides which marker shape to draw. It must never influence a risk figure, a
 * hard-body radius, a screening decision, or anything the pipeline computes —
 * a misread name would then become a wrong number.
 * =====================================================================
 *
 * WHY SHAPE AND NOT COLOUR. styles/tokens.css defines exactly two colour
 * systems — `--accent-*` for chrome and `--risk-*` for threat — and forbids
 * mixing them. Adding a third colour axis for object type would compete with
 * the risk scale, which is the one thing that has to stay unambiguous on a
 * projector. Type is carried by marker shape; colour keeps meaning risk.
 */

/** The kinds this module can report. */
export const OBJECT_KIND = {
  PAYLOAD: 'payload',
  DEBRIS: 'debris',
  ROCKET_BODY: 'rocket-body',
  UNKNOWN: 'unknown',
}

/**
 * Debris suffixes. CelesTrak uses " DEB"; some feeds carry the fuller
 * "(DEBRIS)" or a "COOLANT"/"SHRAPNEL" descriptor for known break-up clouds.
 */
const DEBRIS_PATTERN = /\bDEB\b|\bDEBRIS\b|\bCOOLANT\b|\bSHRAPNEL\b|\bFRAGMENT\b/i

/** Rocket bodies: " R/B", sometimes "AKM"/"PKM" apogee/perigee kick motors. */
const ROCKET_BODY_PATTERN = /\bR\/B\b|\bROCKET BODY\b|\bAKM\b|\bPKM\b/i

/**
 * Classify a catalogue object by its name.
 *
 * Order matters: a name can carry both markers ("SL-16 R/B DEB" is debris from
 * a rocket body, and it is debris), so debris is tested first.
 *
 * @param {string} name catalogue name as it appears in the TLE block
 * @returns {'payload'|'debris'|'rocket-body'|'unknown'}
 */
export function classifyObject(name) {
  if (typeof name !== 'string' || name.trim() === '') return OBJECT_KIND.UNKNOWN
  if (DEBRIS_PATTERN.test(name)) return OBJECT_KIND.DEBRIS
  if (ROCKET_BODY_PATTERN.test(name)) return OBJECT_KIND.ROCKET_BODY
  return OBJECT_KIND.PAYLOAD
}

/**
 * Human label for a kind, for legends and the selected-object panel.
 * @param {string} kind
 * @returns {string}
 */
export function objectKindLabel(kind) {
  switch (kind) {
    case OBJECT_KIND.DEBRIS:
      return 'Debris'
    case OBJECT_KIND.ROCKET_BODY:
      return 'Rocket body'
    case OBJECT_KIND.PAYLOAD:
      return 'Payload'
    default:
      return 'Unclassified'
  }
}

/**
 * Marker geometry per kind, consumed by the globe.
 *
 * `sides` drives a regular polygon drawn into a canvas: 0 means a circle.
 * Payloads are circles (the familiar "satellite" dot), debris are small
 * diamonds, rocket bodies are squares. Sizes differ too, so the distinction
 * survives being rendered a few pixels across on a projector.
 *
 * No colours here on purpose — see the module note.
 *
 * @param {string} kind
 * @returns {{sides: number, size: number, rotation: number}}
 */
export function markerShape(kind) {
  // Sizes are deliberately small. The tracked set runs to several hundred
  // objects, and markers big enough to read a shape from at a glance turn the
  // debris shell into a solid wall. At full-globe zoom this should look like a
  // cloud; the shapes resolve as you zoom in, which is when they are useful.
  switch (kind) {
    case OBJECT_KIND.DEBRIS:
      return { sides: 4, size: 3.2, rotation: Math.PI / 4 }
    case OBJECT_KIND.ROCKET_BODY:
      return { sides: 4, size: 3.8, rotation: 0 }
    case OBJECT_KIND.PAYLOAD:
      return { sides: 0, size: 4.2, rotation: 0 }
    default:
      return { sides: 3, size: 3.8, rotation: 0 }
  }
}
