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
        // CSS procesado por PostCSS/Tailwind → dist/estilos/principal.css
        principal:     resolve(__dirname, 'estilos/principal.css'),
      },
      output: {
        assetFileNames: (assetInfo) => {
          // Mantener la ruta original para el CSS principal
          if (assetInfo.name === 'principal.css') return 'estilos/principal.css';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
