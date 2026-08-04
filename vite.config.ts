import { resolve } from 'path';
import { defineConfig } from 'vite';

// Served from https://<user>.github.io/pixel-art-smoother-movement/ on Pages,
// so the production build needs that base path. Dev stays at '/'.
const REPO_BASE = '/pixel-art-smoother-movement/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? REPO_BASE : '/',
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        'smoother-canvas': resolve(import.meta.dirname, 'smoother-canvas.html'),
        fullscreen: resolve(import.meta.dirname, 'fullscreen.html'),
        'fullscreen-css': resolve(import.meta.dirname, 'fullscreen-css.html'),
        'fullscreen-shmup': resolve(import.meta.dirname, 'fullscreen-shmup.html'),
        'fullscreen-shmup-css': resolve(
          import.meta.dirname,
          'fullscreen-shmup-css.html',
        ),
        'space-drift': resolve(import.meta.dirname, 'space-drift.html'),
      },
    },
  },
}));
