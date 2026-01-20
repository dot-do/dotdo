import { defineConfig } from 'vitest/config'
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineConfig({
  test: {
    globals: true,
    // Default project for non-workers tests
    include: ['**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/.worktrees/**',
      '**/primitives/**',
      // SQLite tests require workers pool - handled by separate project
      '**/db/tests/sqlite.test.ts',
      '**/db/tests/migrations.test.ts',
    ],
  },
})
