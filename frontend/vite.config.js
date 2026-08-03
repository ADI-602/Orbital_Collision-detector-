import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

// https://vite.dev/config/
// vite-plugin-cesium copies Cesium's static assets (Workers, Assets, Widgets)
// into the build output and sets CESIUM_BASE_URL automatically.
export default defineConfig({
  plugins: [react(), cesium()],
})
