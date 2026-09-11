import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Prod: the Express server serves the built client from dist/client and owns
// /api. Dev: `pnpm --filter @astellum/atlas dev` runs Vite on 5174 and proxies
// /api + /refimg to the atlas server (default :3100), so both hot-reload.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3100',
      '/refimg': 'http://localhost:3100',
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
