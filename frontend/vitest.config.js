import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.js.
//
// vite.config.js loads vite-plugin-cesium, which stages Cesium's large static
// asset tree (Workers/, Assets/, Widgets/). Pulling that into every unit-test
// run is pure overhead, and that file currently produces a working Cesium
// build that is not worth risking for test config.
//
// Vitest prefers vitest.config.* over vite.config.* automatically, so no CLI
// flag is needed. `defineConfig` must come from 'vitest/config' — the one
// exported by 'vite' does not recognise a `test` key.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    globals: false,
    // Pin the base URL so a developer's real .env.local cannot bleed in and
    // make the URL-construction assertions machine-dependent.
    env: {
      VITE_API_BASE_URL: 'http://api.test',
    },
  },
})
