import { defineConfig } from 'vite';

// Standard multi-file build: the first view loads only the shell; each tab's code is a lazy
// chunk in dist/assets. scripts/precache.mjs then writes every built asset into dist/sw.js so
// the whole app still works offline after the first visit.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    reportCompressedSize: true,
  },
});
