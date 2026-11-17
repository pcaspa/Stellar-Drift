import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  server: { port: 5173, host: '0.0.0.0', allowedHosts: true },
  preview: { port: 5173, host: '0.0.0.0', allowedHosts: true },
  build: {
    target: 'es2022', chunkSizeWarningLimit: 1500,
    // the home page is the front page; the game lives at /play/
    rollupOptions: { input: { home: resolve(__dirname, 'index.html'), play: resolve(__dirname, 'play/index.html') } },
  },
});
