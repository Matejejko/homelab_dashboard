import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` and `npm run preview` forward /api to a backend on this machine.
// The Host header is left untouched so the backend's Origin check still passes.
const api = { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
});
