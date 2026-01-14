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
      // Stricter type safety rules - warn to allow gradual migration
      // @see do-i3s: Add stricter ESLint rules for TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      // Note: no-unsafe-assignment and no-unsafe-member-access require type-aware linting
      // (parserOptions.project) which significantly slows down linting. Enable these later
      // when type-aware linting is configured. For now, no-explicit-any catches most issues.
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',

      // General best practices
      'no-console': 'off',
      'no-debugger': 'warn',
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['warn', 'smart'],

      // Security: Prevent eval()-like code execution
      // new Function() is equivalent to eval() and poses security risks
      // @see do-1bb - prevents reintroduction of new Function() patterns
      'no-new-func': 'error',
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

  // Cloudflare Workers runtime - prevent process.env usage
  // Workers don't have Node.js process global; use Cloudflare env bindings instead
  // @see do-goy: Add lint rule to prevent process.env in Workers
  {
    files: [
      'api/**/*.ts',
      'api/**/*.tsx',
      'objects/**/*.ts',
      'streaming/**/*.ts',
      'workers/**/*.ts',
    ],
    ignores: [
      // Test files can use process.env for test setup
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/tests/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[object.name="process"][property.name="env"]',
          message:
            'process.env is not available in Cloudflare Workers. Use Cloudflare env bindings instead (pass env as a parameter from the fetch handler).',
        },
      ],
    },
  },
]
