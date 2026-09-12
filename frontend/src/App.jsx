import { useCallback, useState } from 'react'

import Console from './pages/Console.jsx'
import Replay from './pages/Replay.jsx'

/**
 * Two views, switched by state rather than by a router.
 *
 * A router would be the third pitch-relevant dependency decision in a project
 * with exactly two screens and no URLs worth sharing. If deep links are ever
 * wanted (a judge bookmarking the replay, say), that is the moment to add one
 * — not before.
 *
 * The views are mounted exclusively. That matters for more than memory: the
 * console's globe and the replay's globe are separate Cesium viewers on
 * different clocks, and leaving both alive would run two WebGL contexts and
 * two animation loops for one visible screen.
 */
function App() {
  const [view, setView] = useState('console')
  const onViewChange = useCallback((next) => setView(next), [])

  return view === 'replay' ? (
    <Replay onViewChange={onViewChange} />
  ) : (
    <Console onViewChange={onViewChange} />
  )
}

export default App
