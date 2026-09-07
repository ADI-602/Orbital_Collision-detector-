import { useState } from 'react'

import Console from './pages/Console.jsx'
import Replay from './pages/Replay.jsx'

/**
 * Two views, one piece of state.
 *
 * No router: there are two screens with no URL semantics anyone needs, and a
 * routing dependency is a pitch-relevant choice per CLAUDE.md §2 rather than
 * an incidental one. Add one when a third view or a shareable link needs it.
 *
 * The inactive view is unmounted rather than hidden, which matters more than
 * it looks: each view owns a Cesium viewer and an animation loop, and keeping
 * two alive would run two globes and two propagation loops for one visible
 * canvas.
 */
function App() {
  const [view, setView] = useState('console')

  return view === 'replay' ? (
    <Replay view={view} onChangeView={setView} />
  ) : (
    <Console view={view} onChangeView={setView} />
  )
}

export default App
