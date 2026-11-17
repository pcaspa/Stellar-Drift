import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, host: '0.0.0.0', allowedHosts: true },
  preview: { port: 5173, host: '0.0.0.0', allowedHosts: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
