import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative paths: the build can be opened from any folder or static host.
  base: './',
  // The engine (zod included) and recharts make one ~800 kB bundle; fine for a local game.
  build: { chunkSizeWarningLimit: 1200 },
});
