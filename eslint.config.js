import tsParser from '@typescript-eslint/parser'

/**
 * Package Boundary Configuration for dotdo monorepo
 *
 * This ESLint configuration enforces package boundaries by preventing
 * cross-package relative imports. See PACKAGE_BOUNDARIES.md for details.
 *
 * The rules detect imports like:
 *   import { foo } from '../db'        // BAD - cross-package relative
 *   import { foo } from '../../rpc'    // BAD - cross-package relative
 *   import { foo } from '@dotdo/db'    // GOOD - workspace package
 */

/**
 * Package Boundary Definitions
 *
 * Defines allowed dependencies for each workspace package.
 * Utils packages (@dotdo/utils) are allowed everywhere.
 */
const packageBoundaries = {
  // Layer 0 - Foundation (no internal workspace dependencies)
  db: { allowed: [], forbidden: ['do', 'rpc', 'api', 'auth', 'ai', 'mcp', 'app', 'integrations'] },
  ai: { allowed: [], forbidden: ['do', 'rpc', 'api', 'auth', 'db', 'mcp', 'app', 'integrations'] },
  observability: { allowed: [], forbidden: ['do', 'rpc', 'api', 'auth', 'db', 'ai', 'mcp', 'app', 'integrations'] },

  // Layer 1 - Core Services
  rpc: { allowed: [], forbidden: ['do', 'api', 'auth', 'ai', 'mcp', 'app', 'integrations'] },
  auth: { allowed: ['observability'], forbidden: ['do', 'rpc', 'api', 'ai', 'db', 'mcp', 'app', 'integrations'] },

  // Layer 2 - Domain
  do: { allowed: ['db', 'rpc', 'auth', 'observability', 'integrations'], forbidden: ['api', 'mcp', 'app', 'ai'] },
  integrations: { allowed: ['db'], forbidden: ['do', 'rpc', 'api', 'auth', 'ai', 'mcp', 'app'] },

  // Layer 3 - Application
  api: { allowed: ['do', 'db', 'rpc', 'auth', 'observability'], forbidden: ['mcp', 'app', 'ai', 'integrations'] },
  mcp: { allowed: ['do', 'db', 'rpc'], forbidden: ['api', 'app', 'auth', 'ai', 'integrations', 'observability'] },
  app: { allowed: ['api', 'auth'], forbidden: ['do', 'db', 'rpc', 'ai', 'mcp', 'integrations', 'observability'] },

  // Layer 4 - Distribution
  dotdo: { allowed: ['ai', 'api', 'auth', 'db', 'do', 'mcp', 'rpc'], forbidden: [] },
}

// Workspace package names that should not be imported with relative paths
const workspacePackages = ['db', 'do', 'rpc', 'api', 'auth', 'ai', 'mcp', 'app', 'observability', 'utils', 'integrations', 'test-utils', 'testing', 'core', 'oauth', 'clickhouse', 'business']

/**
 * Generate restriction patterns for cross-package imports for a specific package.
 * This allows imports within the same package but forbids imports to other packages.
 */
function createCrossPackagePatternsForPackage(currentPackage) {
  const patterns = []

  for (const pkg of workspacePackages) {
    // Skip the current package - allow internal relative imports
    if (pkg === currentPackage) continue

    // Detect ../<package> imports
    patterns.push({
      group: [`../${pkg}`, `../${pkg}/*`, `../${pkg}/**`],
      message: `Use @dotdo/${pkg} instead of relative import ../${pkg}. See PACKAGE_BOUNDARIES.md`
    })

    // Detect ../../<package> imports
    patterns.push({
      group: [`../../${pkg}`, `../../${pkg}/*`, `../../${pkg}/**`],
      message: `Use @dotdo/${pkg} instead of relative import ../../${pkg}. See PACKAGE_BOUNDARIES.md`
    })

    // Detect ../../../<package> imports (for deeply nested files)
    patterns.push({
      group: [`../../../${pkg}`, `../../../${pkg}/*`, `../../../${pkg}/**`],
      message: `Use @dotdo/${pkg} instead of relative import ../../../${pkg}. See PACKAGE_BOUNDARIES.md`
    })
  }

  return patterns
}

/**
 * Generate restriction patterns for cross-package imports
 * This creates patterns that detect relative imports crossing package boundaries
 */
function createCrossPackagePatterns() {
  const patterns = []

  for (const pkg of workspacePackages) {
    // Detect ../<package> imports
    patterns.push({
      group: [`../${pkg}`, `../${pkg}/*`, `../${pkg}/**`],
      message: `Use @dotdo/${pkg} instead of relative import ../${pkg}. See PACKAGE_BOUNDARIES.md`
    })

    // Detect ../../<package> imports
    patterns.push({
      group: [`../../${pkg}`, `../../${pkg}/*`, `../../${pkg}/**`],
      message: `Use @dotdo/${pkg} instead of relative import ../../${pkg}. See PACKAGE_BOUNDARIES.md`
    })

    // Detect ../../../<package> imports (for deeply nested files)
    patterns.push({
      group: [`../../../${pkg}`, `../../../${pkg}/*`, `../../../${pkg}/**`],
      message: `Use @dotdo/${pkg} instead of relative import ../../../${pkg}. See PACKAGE_BOUNDARIES.md`
    })
  }

  return patterns
}

/**
 * Generate forbidden workspace import rules for a package
 */
function createForbiddenPackageRules(packageName) {
  const config = packageBoundaries[packageName]
  if (!config) return []

  return config.forbidden.map(pkg => ({
    name: `@dotdo/${pkg}`,
    message: `Package @dotdo/${packageName} cannot depend on @dotdo/${pkg}. See PACKAGE_BOUNDARIES.md for layer rules.`
  }))
}

// Base cross-package patterns (applies to all files)
const crossPackagePatterns = createCrossPackagePatterns()

/**
 * ESLint flat configuration
 */
export default [
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.wrangler/**',
      '**/.worktrees/**',
      '**/primitives/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/bashx/**',
      '**/fsx/**',
      '**/gitx/**',
      '**/npmx/**',
      '**/e2e/**',
      '**/examples/**',
    ]
  },

  // Base TypeScript configuration with cross-package import detection
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Detect cross-package relative imports
      'no-restricted-imports': ['warn', {
        patterns: crossPackagePatterns
      }],
    },
  },

  // Package-specific rules for layer enforcement

  // @dotdo/db - Layer 0 (foundation)
  {
    files: ['db/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: createForbiddenPackageRules('db'),
        patterns: createCrossPackagePatternsForPackage('db')
      }]
    }
  },

  // @dotdo/ai - Layer 0 (foundation)
  {
    files: ['ai/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: createForbiddenPackageRules('ai'),
        patterns: createCrossPackagePatternsForPackage('ai')
      }]
    }
  },

  // @dotdo/observability - Layer 0 (foundation)
  {
    files: ['observability/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: createForbiddenPackageRules('observability'),
        patterns: createCrossPackagePatternsForPackage('observability')
      }]
    }
  },

  // @dotdo/rpc - Layer 1
  {
    files: ['rpc/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: createForbiddenPackageRules('rpc'),
        patterns: createCrossPackagePatternsForPackage('rpc')
      }]
    }
  },

  // @dotdo/auth - Layer 1
  {
    files: ['auth/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: createForbiddenPackageRules('auth'),
        patterns: createCrossPackagePatternsForPackage('auth')
      }]
    }
  },

  // @dotdo/do - Layer 2
  {
    files: ['do/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: createForbiddenPackageRules('do'),
        patterns: createCrossPackagePatternsForPackage('do')
      }]
    }
  },

  // @dotdo/integrations - Layer 2
  {
    files: ['integrations/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: createForbiddenPackageRules('integrations'),
        patterns: createCrossPackagePatternsForPackage('integrations')
      }]
    }
  },

  // @dotdo/api - Layer 3
  {
    files: ['api/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: createForbiddenPackageRules('api'),
        patterns: createCrossPackagePatternsForPackage('api')
      }]
    }
  },

  // @dotdo/mcp - Layer 3
  {
    files: ['mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: createForbiddenPackageRules('mcp'),
        patterns: createCrossPackagePatternsForPackage('mcp')
      }]
    }
  },

  // @dotdo/app - Layer 3
  {
    files: ['app/**/*.ts', 'app/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: createForbiddenPackageRules('app'),
        patterns: createCrossPackagePatternsForPackage('app')
      }]
    }
  },
]
