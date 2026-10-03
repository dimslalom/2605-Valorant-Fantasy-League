import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // cards.json is intentionally a shared static-data chunk. It is about
    // 85 kB over the wire despite exceeding Vite's generic 500 kB raw limit.
    chunkSizeWarningLimit: 700,
  },
})
