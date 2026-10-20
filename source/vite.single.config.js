import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
// Default build: ONE self-contained index.html (JS, CSS and fonts inlined) that works both on
// GitHub Pages and when opened by double-click from a folder (file://).
export default defineConfig({ base: './', plugins: [viteSingleFile()], build: { outDir: 'dist', emptyOutDir: true, target: 'es2020', assetsInlineLimit: 100000000 } });
