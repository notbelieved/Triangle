import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';


export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/actions.json': { target: 'http://localhost:3001', changeOrigin: true }
    }
  },
  plugins: [
  react(),
  tailwindcss(),
  nodePolyfills({
    globals: {
      Buffer: true,
      global: true,
      process: true
    }
  })]

});