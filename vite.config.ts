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
      },
    },
  },
});
