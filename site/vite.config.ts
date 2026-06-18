/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import checker from 'vite-plugin-checker';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    checker({ typescript: true }),
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
        'src/lib/supabase.ts',   // client init — nothing to test
        'src/lib/ui-store.ts',   // Zustand store — tested via integration
        'src/lib/types.ts',      // type-only file
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
