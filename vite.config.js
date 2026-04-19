const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');

// Configuration Vite pour le renderer Electron.
// base: './' est indispensable car l'app charge les fichiers via file://.
module.exports = defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
