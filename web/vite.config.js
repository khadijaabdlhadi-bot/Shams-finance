import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_URL || 'http://localhost:8080', changeOrigin: true },
      '/uploads': { target: process.env.API_URL || 'http://localhost:8080', changeOrigin: true }
    }
  }
});
