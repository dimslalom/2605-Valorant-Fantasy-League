import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The call game is its own app: own entry, own build, own Worker (see wrangler.jsonc).
// It shares the engine, the player cards and the card art with the old site by
// importing from ../../src and serving ../../public, so nothing is duplicated.
const here = dir => fileURLToPath(new URL(dir, import.meta.url));

export default defineConfig({
  root: here('.'),
  plugins: [react()],
  publicDir: here('../../public'),
  server: {
    port: 5174,
    fs: { allow: [here('../..')] },
    // In dev, read the live feed (GET only) so the app has real data without a local Worker.
    proxy: { '/api/feed': { target: 'https://vctfantasy.dimas.works', changeOrigin: true } },
  },
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
});
