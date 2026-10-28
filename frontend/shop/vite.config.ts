import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In Docker, Nginx serves the built files. For local UI development run `npm run dev`
// and API calls are proxied to the running Docker stack.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
});
