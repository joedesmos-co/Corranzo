import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // react-pdf + pdfjs-dist and tone dominate size; split for HTTP caching.
    // Demo fixtures stay in the main chunk (see tests/demoFixtureLoading.test.js).
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-pdf') || id.includes('node_modules/pdfjs-dist')) {
            return 'pdf-vendor'
          }
          if (id.includes('node_modules/tone')) {
            return 'audio-vendor'
          }
        },
      },
    },
  },
})
