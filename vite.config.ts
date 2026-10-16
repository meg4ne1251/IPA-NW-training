import { defineConfig } from 'vite';
export default defineConfig({ server: { host: '127.0.0.1', proxy: {
  '/api': 'http://127.0.0.1:3001', '/assets/2025-spring': 'http://127.0.0.1:3001', '/assets/archive': 'http://127.0.0.1:3001',
} } });
