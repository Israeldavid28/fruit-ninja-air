import { defineConfig } from 'vite';
import { resolve }      from 'path';

export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    open: '/index.html',
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        inicio:        resolve(__dirname, 'index.html'),
        login:         resolve(__dirname, 'login.html'),
        dojo:          resolve(__dirname, 'dojo.html'),
        clasificacion: resolve(__dirname, 'clasificacion.html'),
      },
    },
  },
});
