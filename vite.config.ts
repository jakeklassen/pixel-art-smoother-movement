import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        fullscreen: resolve(import.meta.dirname, 'fullscreen.html'),
        'fullscreen-css': resolve(import.meta.dirname, 'fullscreen-css.html'),
        'fullscreen-shmup': resolve(import.meta.dirname, 'fullscreen-shmup.html'),
        'fullscreen-shmup-css': resolve(import.meta.dirname, 'fullscreen-shmup-css.html'),
        'space-drift': resolve(import.meta.dirname, 'space-drift.html'),
      },
    },
  },
});
