import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// MG_API_TARGET points the dev proxy at another API instance (e.g. the mock API in .claude/launch.json).
const API = process.env.MG_API_TARGET || 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/socket.io': { target: API, changeOrigin: true, ws: true },
    },
  },
});
