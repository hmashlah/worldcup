/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import checker from 'vite-plugin-checker';
import path from 'path';
import fs from 'fs';

/** Vite plugin: injects a unique cache version into sw.js at build time.
 *  This replaces the old pre-push hook approach that caused git conflicts. */
function swCacheVersion() {
  return {
    name: 'sw-cache-version',
    writeBundle(options: { dir?: string }) {
      const outDir = options.dir || path.resolve(__dirname, 'dist');
      const swPath = path.join(outDir, 'sw.js');
      if (!fs.existsSync(swPath)) return;
      const version = `wc26-${Date.now()}`;
      const content = fs.readFileSync(swPath, 'utf-8');
      fs.writeFileSync(swPath, content.replace('__SW_CACHE_VERSION__', version));
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    checker({ typescript: true }),
    swCacheVersion(),
  ],
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'data-vendor': ['zustand', '@tanstack/react-query', '@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    port: 8000,
    open: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/**/*.test.ts',
        'src/lib/supabase.ts',      // client init — nothing to test
        'src/lib/ui-store.ts',      // Zustand store — tested via integration
        'src/lib/types.ts',         // type-only file
        'src/lib/match-detail.ts',  // type-only file
        'src/lib/push.ts',          // browser Push API — can't unit test
      ],
      reporter: ['text', 'text-summary'],
      thresholds: {
        lines: 85,
        functions: 90,
        branches: 80,
      },
    },
  },
});
