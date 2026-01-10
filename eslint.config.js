import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import globals from 'globals'

export default [
  // Global ignore patterns (applies to all configs)
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.wrangler/**',
      'playwright-report/**',
      'tests/results/**',
      '*.d.ts',
      'worker.d.ts',
      // Note: app/** is intentionally NOT in global ignores because we need to lint app/__mocks__/
      // for convention enforcement. Instead, app/** is excluded via the `ignores` property in the
      // base config below.
    ],
  },

  // Convention enforcement: No mocks in app/ directory
  // Mocks should be in tests/mocks/ instead
  // @see dotdo-5jlzb, tests/conventions/mock-location.test.ts
  {
    files: ['app/__mocks__/**/*.{js,ts,jsx,tsx}', 'app/**/__mocks__/**/*.{js,ts,jsx,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsparser,
    },
    rules: {
      // This rule will report on any file in the forbidden mock directories
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message: 'Mocks should not be placed in app/__mocks__/. Move mock files to tests/mocks/ instead. See tests/conventions/mock-location.test.ts for the project convention.',
        },
      ],
    },
  },

  // Base config for all JavaScript/TypeScript files
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    ignores: [
      // Ignore app/** in base config (not global ignores) to allow __mocks__ convention enforcement
      'app/**',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // TypeScript-specific rules (minimal/non-strict)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',

      // General best practices
      'no-console': 'off',
      'no-debugger': 'warn',
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['warn', 'smart'],
    },
  },

  // Test files - even more relaxed
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-expressions': 'off',
    },
  },
]
