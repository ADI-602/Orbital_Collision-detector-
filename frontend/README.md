# frontend/

React 19 + Vite + CesiumJS console for Orbital Risk Advisor. Plain per-component CSS, vitest, oxlint.
Every number on screen comes from the backend; the browser propagates objects (satellite.js, SGP4) for
display only. The structure and data flow are described in `docs/frontend-implementation-plan.md` §16.

```bash
npm install
npm run dev          # http://localhost:5173 (expects the API on :8000)
npm test             # vitest
npm run lint         # oxlint
npm run build
npm run check:api    # probe a running backend
npm run refresh:tle  # refresh the bundled TLE snapshot
```

Pages: `src/pages/Console.jsx` (live) and `src/pages/Replay.jsx` (Envisat 2004 proof). Presenting setup
and the demo flow: `demo/presentation_guide.md`.
