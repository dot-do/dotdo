import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  // Node tests for file system / config verification
  {
    test: {
      name: 'node',
      include: [
        'tests/setup.test.ts',
        'tests/static-assets.test.ts',
      ],
      environment: 'node',
    },
  },
  // Workers tests for runtime integration
  {
    extends: './vitest.workers.config.ts',
    test: {
      name: 'workers',
      include: [
        'tests/infrastructure/**/*.test.ts',
        'tests/routes/**/*.test.ts',
        'tests/middleware/**/*.test.ts',
      ],
    },
  },
])
