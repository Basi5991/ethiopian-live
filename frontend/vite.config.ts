import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: path.resolve(__dirname, '../backend/static/spa'),
      emptyOutDir: true,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Backend Proxy Integration: Set BACKEND_PROXY_URL to proxy relative '/api' calls to Django (e.g., http://localhost:8000)
      proxy: process.env.BACKEND_PROXY_URL ? {
        '/api': {
          target: process.env.BACKEND_PROXY_URL,
          changeOrigin: true,
          secure: false,
        }
      } : undefined,
    },
  };
});
