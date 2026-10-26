import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted so the demo works with no network. A Google Fonts <link> would
// not error on failure — it would silently fall back and change the entire
// visual identity mid-presentation.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'

import './styles/tokens.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
