import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { privatePublicAssets } from './scripts/privatePublicAssets.js';

export default defineConfig({
  plugins: [react(), privatePublicAssets()],
  build: { copyPublicDir: false },
  server: {
    port: 5173,
  },
});
