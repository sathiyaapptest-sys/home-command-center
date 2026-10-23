import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only ever talks to the local assistant server; AWS credentials never reach it.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:4200', ws: true } } },
});
