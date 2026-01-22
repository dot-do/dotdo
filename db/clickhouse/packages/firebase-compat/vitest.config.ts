import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts'],
    },
  },
  resolve: {
    alias: {
      '@chdb/firebase-compat/firestore': path.resolve(__dirname, './src/firestore/index.ts'),
      '@chdb/firebase-compat': path.resolve(__dirname, './src/index.ts'),
    },
  },
  esbuild: {
    target: 'esnext',
  },
});
