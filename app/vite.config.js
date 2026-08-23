import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Keep the map engine in its own chunk: it is by far the biggest dependency
    // and it changes far less often than the app, so it caches independently and
    // downloads in parallel with the shell rather than behind it.
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ['maplibre-gl'] },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})
