import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        fullscreen: resolve(__dirname, 'fullscreen.html'),
        'fullscreen-css': resolve(__dirname, 'fullscreen-css.html'),
        'fullscreen-shmup': resolve(__dirname, 'fullscreen-shmup.html'),
        'fullscreen-shmup-css': resolve(__dirname, 'fullscreen-shmup-css.html'),
      },
    },
  },
});
