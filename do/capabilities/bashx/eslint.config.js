import tseslint from 'typescript-eslint'

/**
 * ESLint configuration for bashx.do
 *
 * This config uses typescript-eslint's flat config format.
 * Rules are tuned for this specific codebase's patterns.
 */
export default tseslint.config(
  // Ignore patterns - exclude build artifacts and test files
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '**/*.d.ts',
      '**/*.test.ts',
      '**/tests/**',
      '**/test/**',
    ],
  },
  // Base recommended config for TypeScript
  ...tseslint.configs.recommended,
  // Custom rules for src/
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ============================================================
      // Type Safety Rules
      // ============================================================

      // Allow explicit any for now - too many to fix at once
      // TODO: Tighten to 'error' after systematic cleanup
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow empty interfaces - used for type extension patterns
      // e.g., Tier2ExecutorConfig extends RpcExecutorConfig
      '@typescript-eslint/no-empty-object-type': 'off',

      // Allow Function type - used in callback patterns
      // TODO: Replace with specific signatures where possible
      '@typescript-eslint/no-unsafe-function-type': 'off',

      // ============================================================
      // Code Quality Rules
      // ============================================================

      // Allow unused vars with underscore prefix
      // Includes catch clause errors (common pattern: catch (_error))
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // ============================================================
      // Style Rules
      // ============================================================

      // Allow namespaces - used in crypto module for organization
      '@typescript-eslint/no-namespace': 'off',

      // Allow ts-ignore with description - sometimes needed for edge cases
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': 'allow-with-description' },
      ],
    },
  }
)
