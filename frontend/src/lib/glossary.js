/**
 * glossary.js — plain-language definitions for the terms on screen.
 *
 * Written for a viewer who is not an orbital-mechanics specialist. Every entry
 * is a definition, not a claim about this event: no figures appear here except
 * the threat thresholds, which are read from the same constants the badges use
 * so the two can never disagree.
 */
import { THREAT_THRESHOLDS } from './conjunctions.js'

const RED = THREAT_THRESHOLDS.RED.toExponential(0)
const YELLOW = THREAT_THRESHOLDS.YELLOW.toExponential(0)

/** @type {Record<string, {term: string, definition: string}>} */
export const GLOSSARY = {
  pc: {
    term: 'Collision probability (Pc)',
    definition:
      'The chance that the two objects pass within their combined size of each other at ' +
      'closest approach, given the uncertainty in both orbits. Computed with the 2D ' +
      'encounter-plane method (Foster/Chan/Alfano).',
  },
  tca: {
    term: 'TCA',
    definition: 'Time of closest approach: the instant the two objects are nearest each other.',
  },
  missDistance: {
    term: 'Miss distance',
    definition: 'The predicted distance between the two objects at the time of closest approach.',
  },
  relativeSpeed: {
    term: 'Relative speed',
    definition:
      'How fast one object moves as seen from the other at closest approach. Objects on ' +
      'crossing orbits meet at kilometres per second; objects flying together, almost zero.',
  },
  threatLevel: {
    term: 'Threat level',
    definition:
      `The band this pipeline assigns from Pc: RED at ${RED} or above, YELLOW at ${YELLOW} ` +
      'or above, GREEN below that.',
  },
  alongTrackDv: {
    term: 'Along-track ΔV',
    definition:
      'A small change in speed along the direction of travel. Braking or boosting changes ' +
      'when the satellite reaches the encounter point, which moves it away from the debris.',
  },
  hardBodyRadius: {
    term: 'Hard-body radius',
    definition:
      'The two objects’ combined size, treated as a sphere. A collision means their centres ' +
      'come closer than this.',
  },
  sgp4: {
    term: 'SGP4',
    definition:
      'The standard propagator for public two-line element sets (TLEs): it predicts where ' +
      'a catalogued object will be at a given time.',
  },
  coOrbital: {
    term: 'Co-orbital',
    definition:
      'Two catalogue entries flying together, such as modules of one station. They are close ' +
      'but not approaching, so a collision probability does not apply.',
  },
}
