import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const rootDir = import.meta.dirname;

export default defineConfig({
  root: path.resolve(rootDir, 'apps/web'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(rootDir, 'dist-web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
