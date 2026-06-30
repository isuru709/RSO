import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/v1/tenants': { target: 'http://localhost:80', changeOrigin: true },
      '/api/v1/users': { target: 'http://localhost:80', changeOrigin: true },
      '/api/v1/resources': { target: 'http://localhost:80', changeOrigin: true },
      '/api/v1/bookings': { target: 'http://localhost:80', changeOrigin: true },
      '/api/v1/notifications': { target: 'http://localhost:80', changeOrigin: true },
      '/uploads': {
        target: 'http://localhost:80',
        changeOrigin: true,
      },
    },
  },
});
