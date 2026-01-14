// Tests for shouldInclude/createIncludeChecker functionality
//
// Tests include/exclude pattern matching for sparse checkout support.
//
// Expected API:
//   const checker = createIncludeChecker({
//     patterns: ['src/**', 'package.json'],
//     excludePatterns: ['**/test/**', '**/*.spec.ts']
//   })
//
//   checker.shouldInclude('src/index.ts')       // true
//   checker.shouldInclude('src/test/helper.ts') // false
//   checker.shouldInclude('lib/index.ts')       // false

import { describe, it, expect } from 'vitest'
import { createIncludeChecker, type IncludeChecker, type IncludeCheckerOptions } from './include'

describe('createIncludeChecker', () => {
  // ========================================
  // 1. Include patterns only (5 tests)
  // ========================================
  describe('include patterns only', () => {
    it('should include path that matches single pattern', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**']
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
    })

    it('should exclude path that does not match any pattern', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**']
      })

      expect(checker.shouldInclude('lib/index.ts')).toBe(false)
    })

    it('should include path that matches any of multiple patterns', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**', 'package.json', 'lib/**']
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('package.json')).toBe(true)
      expect(checker.shouldInclude('lib/utils.ts')).toBe(true)
    })

    it('should include nested paths that match globstar pattern', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**']
      })

      expect(checker.shouldInclude('src/utils/helpers.ts')).toBe(true)
      expect(checker.shouldInclude('src/components/ui/Button.tsx')).toBe(true)
    })

    it('should include exact filename patterns', () => {
      const checker = createIncludeChecker({
        patterns: ['package.json', 'tsconfig.json']
      })

      expect(checker.shouldInclude('package.json')).toBe(true)
      expect(checker.shouldInclude('tsconfig.json')).toBe(true)
      expect(checker.shouldInclude('other.json')).toBe(false)
    })
  })

  // ========================================
  // 2. Exclude patterns only (5 tests)
  // ========================================
  describe('exclude patterns only', () => {
    it('should include everything when only exclude patterns provided', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['**/node_modules/**']
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('lib/index.ts')).toBe(true)
    })

    it('should exclude path that matches exclude pattern', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['**/node_modules/**']
      })

      expect(checker.shouldInclude('node_modules/lodash/index.js')).toBe(false)
    })

    it('should exclude path that matches any exclude pattern', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['**/node_modules/**', '**/dist/**', '**/*.test.ts']
      })

      expect(checker.shouldInclude('node_modules/lodash/index.js')).toBe(false)
      expect(checker.shouldInclude('dist/index.js')).toBe(false)
      expect(checker.shouldInclude('src/index.test.ts')).toBe(false)
    })

    it('should exclude nested paths that match exclude pattern', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['**/test/**']
      })

      expect(checker.shouldInclude('src/test/helpers.ts')).toBe(false)
      expect(checker.shouldInclude('lib/test/fixtures/data.json')).toBe(false)
    })

    it('should include path that does not match any exclude pattern', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['**/test/**', '**/*.test.ts']
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('lib/utils.ts')).toBe(true)
    })
  })

  // ========================================
  // 3. Include and exclude combined (6 tests)
  // ========================================
  describe('include and exclude combined', () => {
    it('should include path that matches include but not exclude', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**', 'package.json'],
        excludePatterns: ['**/test/**', '**/*.spec.ts']
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('package.json')).toBe(true)
    })

    it('should exclude path that matches both include and exclude', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**'],
        excludePatterns: ['**/test/**']
      })

      // src/test/helper.ts matches src/** but also matches **/test/**
      expect(checker.shouldInclude('src/test/helper.ts')).toBe(false)
    })

    it('should exclude path that matches exclude even when include matches', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**'],
        excludePatterns: ['**/*.spec.ts']
      })

      expect(checker.shouldInclude('src/index.spec.ts')).toBe(false)
    })

    it('should exclude path that does not match any include pattern', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**'],
        excludePatterns: ['**/test/**']
      })

      // lib/index.ts doesn't match src/** include pattern
      expect(checker.shouldInclude('lib/index.ts')).toBe(false)
    })

    it('should handle complex pattern combinations', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**', 'lib/**', '*.json'],
        excludePatterns: ['**/test/**', '**/node_modules/**', '**/*.test.ts']
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('lib/utils.ts')).toBe(true)
      expect(checker.shouldInclude('package.json')).toBe(true)
      expect(checker.shouldInclude('src/test/helper.ts')).toBe(false)
      expect(checker.shouldInclude('src/index.test.ts')).toBe(false)
      expect(checker.shouldInclude('docs/readme.md')).toBe(false)
    })

    it('should correctly handle overlapping include patterns', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**/*.ts', 'src/**/*.tsx'],
        excludePatterns: ['**/*.test.ts', '**/*.spec.ts']
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/Button.tsx')).toBe(true)
      expect(checker.shouldInclude('src/index.test.ts')).toBe(false)
      expect(checker.shouldInclude('src/index.spec.ts')).toBe(false)
    })
  })

  // ========================================
  // 4. Edge cases (6 tests)
  // ========================================
  describe('edge cases', () => {
    it('should handle empty patterns array', () => {
      const checker = createIncludeChecker({
        patterns: []
      })

      // With no include patterns, nothing should be included
      expect(checker.shouldInclude('src/index.ts')).toBe(false)
      expect(checker.shouldInclude('package.json')).toBe(false)
    })

    it('should handle empty exclude patterns array', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**'],
        excludePatterns: []
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/test/helper.ts')).toBe(true)
    })

    it('should handle root path', () => {
      const checker = createIncludeChecker({
        patterns: ['**']
      })

      expect(checker.shouldInclude('')).toBe(false) // Empty path
    })

    it('should handle hidden files (dotfiles)', () => {
      const checker = createIncludeChecker({
        patterns: ['**']
      })

      expect(checker.shouldInclude('.gitignore')).toBe(true)
      expect(checker.shouldInclude('.env')).toBe(true)
      expect(checker.shouldInclude('src/.hidden')).toBe(true)
    })

    it('should handle paths with special characters', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**']
      })

      expect(checker.shouldInclude('src/file-name.ts')).toBe(true)
      expect(checker.shouldInclude('src/file_name.ts')).toBe(true)
      expect(checker.shouldInclude('src/FileName.ts')).toBe(true)
    })

    it('should handle undefined excludePatterns', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**']
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
    })
  })

  // ========================================
  // 5. Directory traversal optimization (5 tests)
  // ========================================
  describe('shouldTraverseDirectory', () => {
    it('should traverse directory that could contain matching files', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**']
      })

      expect(checker.shouldTraverseDirectory('src')).toBe(true)
      expect(checker.shouldTraverseDirectory('src/utils')).toBe(true)
    })

    it('should not traverse directory that cannot contain matching files', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**']
      })

      expect(checker.shouldTraverseDirectory('lib')).toBe(false)
      expect(checker.shouldTraverseDirectory('docs')).toBe(false)
    })

    it('should not traverse excluded directories', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['**/node_modules/**']
      })

      expect(checker.shouldTraverseDirectory('node_modules')).toBe(false)
      expect(checker.shouldTraverseDirectory('src/node_modules')).toBe(false)
    })

    it('should handle multiple include patterns for directory traversal', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**', 'lib/**']
      })

      expect(checker.shouldTraverseDirectory('src')).toBe(true)
      expect(checker.shouldTraverseDirectory('lib')).toBe(true)
      expect(checker.shouldTraverseDirectory('test')).toBe(false)
    })

    it('should traverse parent directories of included paths', () => {
      const checker = createIncludeChecker({
        patterns: ['src/components/**']
      })

      expect(checker.shouldTraverseDirectory('src')).toBe(true)
      expect(checker.shouldTraverseDirectory('src/components')).toBe(true)
      expect(checker.shouldTraverseDirectory('src/utils')).toBe(false)
    })
  })

  // ========================================
  // 6. Pattern priority (4 tests)
  // ========================================
  describe('pattern priority', () => {
    it('should exclude always takes priority over include', () => {
      // Even if include pattern is more specific
      const checker = createIncludeChecker({
        patterns: ['src/**/*.ts'],
        excludePatterns: ['**/*.test.ts']
      })

      expect(checker.shouldInclude('src/utils/helper.test.ts')).toBe(false)
    })

    it('should handle negation patterns in exclude', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**'],
        excludePatterns: ['**/test/**']
      })

      // Standard exclusion
      expect(checker.shouldInclude('src/test/helper.ts')).toBe(false)
    })

    it('should match first applicable pattern for include', () => {
      const checker = createIncludeChecker({
        patterns: ['*.json', 'src/**']
      })

      expect(checker.shouldInclude('package.json')).toBe(true)
      expect(checker.shouldInclude('src/config.json')).toBe(true)
    })

    it('should apply all exclude patterns', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['**/test/**', '**/spec/**', '**/__tests__/**']
      })

      expect(checker.shouldInclude('src/test/helper.ts')).toBe(false)
      expect(checker.shouldInclude('src/spec/helper.ts')).toBe(false)
      expect(checker.shouldInclude('src/__tests__/helper.ts')).toBe(false)
      expect(checker.shouldInclude('src/utils/helper.ts')).toBe(true)
    })
  })

  // ========================================
  // 7. Real-world scenarios (4 tests)
  // ========================================
  describe('real-world scenarios', () => {
    it('should handle sparse checkout for monorepo', () => {
      const checker = createIncludeChecker({
        patterns: [
          'packages/core/**',
          'packages/shared/**',
          'package.json',
          'tsconfig.json'
        ],
        excludePatterns: [
          '**/node_modules/**',
          '**/dist/**',
          '**/*.test.ts',
          '**/__tests__/**'
        ]
      })

      expect(checker.shouldInclude('packages/core/src/index.ts')).toBe(true)
      expect(checker.shouldInclude('packages/shared/utils.ts')).toBe(true)
      expect(checker.shouldInclude('package.json')).toBe(true)
      expect(checker.shouldInclude('packages/other/index.ts')).toBe(false)
      expect(checker.shouldInclude('packages/core/node_modules/lodash/index.js')).toBe(false)
    })

    it('should handle gitignore-like patterns', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: [
          '**/node_modules/**',
          '**/dist/**',
          '**/*.log',
          '**/.env*',
          '**/coverage/**'
        ]
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('node_modules/lodash/index.js')).toBe(false)
      expect(checker.shouldInclude('dist/bundle.js')).toBe(false)
      expect(checker.shouldInclude('logs/app.log')).toBe(false)
      expect(checker.shouldInclude('.env.local')).toBe(false)
    })

    it('should handle frontend project patterns', () => {
      const checker = createIncludeChecker({
        patterns: [
          'src/**/*.{ts,tsx}',
          'public/**',
          '*.json'
        ],
        excludePatterns: [
          '**/*.test.tsx',
          '**/*.spec.tsx',
          '**/__mocks__/**'
        ]
      })

      expect(checker.shouldInclude('src/App.tsx')).toBe(true)
      expect(checker.shouldInclude('src/components/Button.tsx')).toBe(true)
      expect(checker.shouldInclude('public/index.html')).toBe(true)
      expect(checker.shouldInclude('package.json')).toBe(true)
      expect(checker.shouldInclude('src/App.test.tsx')).toBe(false)
      expect(checker.shouldInclude('src/__mocks__/api.ts')).toBe(false)
    })

    it('should handle backend project patterns', () => {
      const checker = createIncludeChecker({
        patterns: [
          'src/**',
          'config/**',
          'package.json',
          'tsconfig.json'
        ],
        excludePatterns: [
          '**/test/**',
          '**/*.test.ts',
          '**/*.spec.ts',
          '**/fixtures/**'
        ]
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/controllers/user.ts')).toBe(true)
      expect(checker.shouldInclude('config/database.ts')).toBe(true)
      expect(checker.shouldInclude('src/test/helper.ts')).toBe(false)
      expect(checker.shouldInclude('src/user.test.ts')).toBe(false)
    })
  })

  // ========================================
  // 8. Cone mode (git sparse-checkout compatible)
  // ========================================
  describe('cone mode', () => {
    it('should include toplevel files with empty directories', () => {
      const checker = createIncludeChecker({
        patterns: [],
        cone: true
      })

      // Git cone mode always includes toplevel files
      expect(checker.shouldInclude('package.json')).toBe(true)
      expect(checker.shouldInclude('README.md')).toBe(true)
      expect(checker.shouldInclude('.gitignore')).toBe(true)
    })

    it('should exclude nested files with empty directories', () => {
      const checker = createIncludeChecker({
        patterns: [],
        cone: true
      })

      // But excludes anything nested
      expect(checker.shouldInclude('src/index.ts')).toBe(false)
      expect(checker.shouldInclude('lib/utils.ts')).toBe(false)
    })

    it('should include all files under specified directory', () => {
      const checker = createIncludeChecker({
        patterns: ['src/'],
        cone: true
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/utils/helper.ts')).toBe(true)
      expect(checker.shouldInclude('src/components/ui/Button.tsx')).toBe(true)
    })

    it('should include toplevel files when directories specified', () => {
      const checker = createIncludeChecker({
        patterns: ['src/'],
        cone: true
      })

      // Cone mode always includes toplevel
      expect(checker.shouldInclude('package.json')).toBe(true)
      expect(checker.shouldInclude('tsconfig.json')).toBe(true)
    })

    it('should exclude unspecified nested directories', () => {
      const checker = createIncludeChecker({
        patterns: ['src/'],
        cone: true
      })

      // lib/ is not specified, so excluded
      expect(checker.shouldInclude('lib/index.ts')).toBe(false)
      expect(checker.shouldInclude('test/helper.ts')).toBe(false)
    })

    it('should include multiple specified directories', () => {
      const checker = createIncludeChecker({
        patterns: ['src/', 'lib/'],
        cone: true
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('lib/utils.ts')).toBe(true)
      expect(checker.shouldInclude('test/helper.ts')).toBe(false)
    })

    it('should include ancestor directory immediate files', () => {
      const checker = createIncludeChecker({
        patterns: ['src/components/ui/'],
        cone: true
      })

      // Git cone mode includes immediate files of ancestor directories
      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/components/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/components/ui/Button.tsx')).toBe(true)
    })

    it('should exclude sibling directories of specified path', () => {
      const checker = createIncludeChecker({
        patterns: ['src/components/ui/'],
        cone: true
      })

      // src/utils is sibling of src/components, should be excluded
      expect(checker.shouldInclude('src/utils/helper.ts')).toBe(false)
      // src/components/forms is sibling of src/components/ui, should be excluded
      expect(checker.shouldInclude('src/components/forms/Input.tsx')).toBe(false)
    })

    it('should traverse directories on path to specified cone', () => {
      const checker = createIncludeChecker({
        patterns: ['packages/core/src/'],
        cone: true
      })

      expect(checker.shouldTraverseDirectory('packages')).toBe(true)
      expect(checker.shouldTraverseDirectory('packages/core')).toBe(true)
      expect(checker.shouldTraverseDirectory('packages/core/src')).toBe(true)
    })

    it('should not traverse sibling directories', () => {
      const checker = createIncludeChecker({
        patterns: ['packages/core/src/'],
        cone: true
      })

      // packages/other is not on the path to packages/core/src/
      expect(checker.shouldTraverseDirectory('packages/other')).toBe(false)
      expect(checker.shouldTraverseDirectory('src')).toBe(false)
    })

    it('should normalize directory patterns without trailing slash', () => {
      const checker = createIncludeChecker({
        patterns: ['src', 'lib'],  // No trailing slash - should still work
        cone: true
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('lib/utils.ts')).toBe(true)
    })

    it('should throw error for file patterns in cone mode', () => {
      expect(() => createIncludeChecker({
        patterns: ['src/**/*.ts'],  // Glob pattern - not allowed in cone mode
        cone: true
      })).toThrow(/cone mode only accepts directory patterns/i)
    })

    it('should throw error for glob patterns in cone mode', () => {
      expect(() => createIncludeChecker({
        patterns: ['**/node_modules/**'],
        cone: true
      })).toThrow(/cone mode only accepts directory patterns/i)
    })

    it('should handle nested cone directories correctly', () => {
      const checker = createIncludeChecker({
        patterns: ['packages/core/', 'packages/shared/utils/'],
        cone: true
      })

      // packages/core/ - full access
      expect(checker.shouldInclude('packages/core/src/index.ts')).toBe(true)
      expect(checker.shouldInclude('packages/core/test/helper.ts')).toBe(true)

      // packages/shared/utils/ - full access
      expect(checker.shouldInclude('packages/shared/utils/index.ts')).toBe(true)

      // packages/shared/ immediate files - included (ancestor of specified cone)
      expect(checker.shouldInclude('packages/shared/index.ts')).toBe(true)

      // packages/shared/src/ - not included (sibling of utils/)
      expect(checker.shouldInclude('packages/shared/src/index.ts')).toBe(false)
    })
  })

  // ========================================
  // 9. Negation patterns (!pattern) - RED PHASE
  // ========================================
  describe('negation patterns (!pattern)', () => {
    it('should re-include files with negated exclude pattern', () => {
      // Gitignore semantics: !pattern negates a previous exclusion
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['**/test/**', '!**/test/fixtures/**']
      })

      // test/** is excluded, but !**/test/fixtures/** should re-include fixtures
      expect(checker.shouldInclude('src/test/helper.ts')).toBe(false)
      expect(checker.shouldInclude('src/test/fixtures/data.json')).toBe(true) // FAILING - negation should re-include
    })

    it('should handle multiple negation patterns', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: [
          '**/node_modules/**',
          '!**/node_modules/@company/**', // Keep company internal packages
          '!**/node_modules/lodash/**'    // Keep lodash for debugging
        ]
      })

      expect(checker.shouldInclude('node_modules/random/index.js')).toBe(false)
      expect(checker.shouldInclude('node_modules/@company/core/index.js')).toBe(true) // FAILING
      expect(checker.shouldInclude('node_modules/lodash/index.js')).toBe(true) // FAILING
    })

    it('should process patterns in order - last match wins', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: [
          '*.log',      // exclude all logs
          '!debug.log', // but keep debug.log
          'error.log'   // but exclude error.log specifically (negation can be re-negated)
        ]
      })

      expect(checker.shouldInclude('app.log')).toBe(false)
      expect(checker.shouldInclude('debug.log')).toBe(true)  // FAILING - should be re-included
      expect(checker.shouldInclude('error.log')).toBe(false) // this should still be excluded
    })

    it('should handle negation in include patterns', () => {
      // Negation can also appear in include patterns
      const checker = createIncludeChecker({
        patterns: ['src/**', '!src/internal/**']
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/internal/secret.ts')).toBe(false) // FAILING - negation should exclude
    })

    it('should handle escaped negation', () => {
      // \! at start should match literal ! in filename
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['\\!important.txt']  // Match file literally named "!important.txt"
      })

      expect(checker.shouldInclude('!important.txt')).toBe(false) // FAILING - should match escaped
      expect(checker.shouldInclude('important.txt')).toBe(true)
    })
  })

  // ========================================
  // 10. Include/exclude priority (last pattern wins) - RED PHASE
  // ========================================
  describe('pattern ordering - last match wins (gitignore semantics)', () => {
    it('should allow later exclude to override earlier include', () => {
      // In gitignore: patterns are processed in order, last matching wins
      const checker = createIncludeChecker({
        patterns: ['src/**'],                    // First: include src
        excludePatterns: ['src/deprecated/**']   // Later: exclude deprecated
      })

      // Current behavior: this works, exclude takes priority
      expect(checker.shouldInclude('src/deprecated/old.ts')).toBe(false)
    })

    it('should allow later include to override earlier exclude', () => {
      // This is the challenging case - re-including after exclude
      const checker = createIncludeChecker({
        patterns: ['src/**', 'src/deprecated/keep.ts'], // Include, then specifically re-include
        excludePatterns: ['src/deprecated/**']          // But this is in exclude...
      })

      // FAILING: Current implementation always has exclude win
      // Expected: The specific file should be included because it's explicitly listed
      expect(checker.shouldInclude('src/deprecated/keep.ts')).toBe(true)
    })

    it('should support unified pattern list with sequential processing', () => {
      // Some systems use a single pattern list with +/- prefixes
      // This test documents expected behavior for a unified API
      const checker = createIncludeChecker({
        patterns: [
          'src/**',           // include all of src
          '!src/test/**',     // but exclude test directory
          'src/test/e2e/**'   // but include e2e subdirectory
        ]
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/test/unit/test.ts')).toBe(false)  // FAILING
      expect(checker.shouldInclude('src/test/e2e/test.ts')).toBe(true)    // FAILING
    })

    it('should process exclude patterns in order', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: [
          '**/dist/**',     // Exclude all dist
          '!**/dist/types/**' // But include types for TypeScript
        ]
      })

      expect(checker.shouldInclude('dist/bundle.js')).toBe(false)
      expect(checker.shouldInclude('dist/types/index.d.ts')).toBe(true) // FAILING - should be re-included
    })
  })

  // ========================================
  // 11. Directory vs file pattern matching - RED PHASE
  // ========================================
  describe('directory vs file pattern matching', () => {
    it('should match directory pattern (trailing slash) only for directories', () => {
      const checker = createIncludeChecker({
        patterns: ['build/']  // Pattern ends with / - should only match directories
      })

      // 'build/' should match the directory named 'build' and its contents
      expect(checker.shouldInclude('build/output.js')).toBe(true)
      // But should NOT match a file named 'build' (no extension)
      expect(checker.shouldInclude('build')).toBe(false) // FAILING - treats as file vs directory
    })

    it('should exclude directory pattern (trailing slash) correctly', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['logs/']  // Exclude only if 'logs' is a directory
      })

      // Should exclude files inside logs/
      expect(checker.shouldInclude('logs/app.log')).toBe(false)
      // A file literally named 'logs' (no directory) should NOT be excluded
      expect(checker.shouldInclude('logs')).toBe(true) // FAILING - pattern should only match directories
    })

    it('should differentiate between foo and foo/ patterns', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['temp']  // No trailing slash - matches file OR directory named 'temp'
      })

      expect(checker.shouldInclude('temp')).toBe(false)       // File named temp - excluded
      expect(checker.shouldInclude('temp/data.txt')).toBe(false)  // Contents of temp/ - excluded

      const checker2 = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['temp/']  // Trailing slash - only matches directory
      })

      expect(checker2.shouldInclude('temp')).toBe(true)        // FAILING: File named temp - should NOT be excluded
      expect(checker2.shouldInclude('temp/data.txt')).toBe(false)  // Contents of temp/ - excluded
    })

    it('should handle isDirectory hint in shouldInclude', () => {
      // Some implementations allow passing whether path is a directory
      // This enables correct matching of trailing-slash patterns
      const checker = createIncludeChecker({
        patterns: ['data/']  // Only include if 'data' is a directory
      })

      // If we had an isDirectory parameter:
      // expect(checker.shouldInclude('data', { isDirectory: true })).toBe(true)
      // expect(checker.shouldInclude('data', { isDirectory: false })).toBe(false)

      // Current API doesn't support this - test documents need
      expect(checker.shouldInclude('data/file.txt')).toBe(true)  // This should work (file inside dir)
    })
  })

  // ========================================
  // 12. Edge cases - whitespace and special patterns - RED PHASE
  // ========================================
  describe('whitespace and special pattern edge cases', () => {
    it('should handle patterns with leading whitespace', () => {
      const checker = createIncludeChecker({
        patterns: ['  src/**']  // Leading whitespace - should be trimmed? or literal?
      })

      // Gitignore trims trailing whitespace but not leading
      // A pattern '  src/**' should match '  src/file.ts' literally
      expect(checker.shouldInclude('  src/index.ts')).toBe(true)  // If literal match
      expect(checker.shouldInclude('src/index.ts')).toBe(false)   // FAILING if whitespace is trimmed
    })

    it('should handle patterns with trailing whitespace', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**  ']  // Trailing whitespace - gitignore ignores it
      })

      // Gitignore: trailing whitespace is ignored unless escaped with backslash
      expect(checker.shouldInclude('src/index.ts')).toBe(true)  // Should match (trailing ws ignored)
    })

    it('should handle escaped trailing whitespace', () => {
      const checker = createIncludeChecker({
        patterns: ['file\\ ']  // Escaped space at end - matches 'file '
      })

      expect(checker.shouldInclude('file ')).toBe(true)  // FAILING - escaped space should be literal
      expect(checker.shouldInclude('file')).toBe(false)
    })

    it('should handle whitespace-only patterns', () => {
      // Whitespace-only should be treated as empty/skipped
      expect(() => createIncludeChecker({
        patterns: ['   ']  // Whitespace-only pattern
      })).toThrow(/empty|whitespace|invalid/i)  // FAILING - should throw or skip
    })

    it('should handle empty string pattern', () => {
      expect(() => createIncludeChecker({
        patterns: ['']  // Empty string pattern
      })).toThrow(/empty|invalid/i)  // FAILING - should throw or skip
    })

    it('should handle patterns with internal whitespace', () => {
      const checker = createIncludeChecker({
        patterns: ['my files/**']  // Directory with space in name
      })

      expect(checker.shouldInclude('my files/doc.txt')).toBe(true)
      expect(checker.shouldInclude('my/files/doc.txt')).toBe(false)  // Different path
    })

    it('should handle comment-like patterns', () => {
      const checker = createIncludeChecker({
        patterns: ['#readme.md']  // Pattern starting with # - is it a comment or literal?
      })

      // If we follow gitignore: # at start is a comment (ignored)
      // If we follow literal matching: matches file named '#readme.md'
      expect(checker.shouldInclude('#readme.md')).toBe(true)  // FAILING depending on interpretation
    })

    it('should handle escaped hash pattern', () => {
      const checker = createIncludeChecker({
        patterns: ['\\#important']  // Escaped # - matches file named '#important'
      })

      expect(checker.shouldInclude('#important')).toBe(true)  // FAILING - needs escape handling
    })
  })

  // ========================================
  // 13. Additional include/exclude edge cases - RED PHASE
  // ========================================
  describe('additional edge cases', () => {
    it('should handle overlapping exclude patterns with different specificity', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: [
          '**/*.test.ts',      // Exclude all .test.ts files
          '**/critical.test.ts' // This is more specific but same outcome
        ]
      })

      expect(checker.shouldInclude('src/critical.test.ts')).toBe(false)
      expect(checker.shouldInclude('src/utils.test.ts')).toBe(false)
    })

    it('should handle deeply nested paths efficiently', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**'],
        excludePatterns: ['**/node_modules/**']
      })

      // Deep nesting should still work correctly
      expect(checker.shouldInclude('src/a/b/c/d/e/f/g/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/a/b/node_modules/c/d/e/index.ts')).toBe(false)
    })

    it('should handle case sensitivity correctly', () => {
      const checker = createIncludeChecker({
        patterns: ['SRC/**']  // Uppercase
      })

      // Default should be case-sensitive (Unix behavior)
      expect(checker.shouldInclude('SRC/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/index.ts')).toBe(false)  // Different case
      expect(checker.shouldInclude('Src/index.ts')).toBe(false)  // Different case
    })

    it('should handle double-star at various positions', () => {
      const checker = createIncludeChecker({
        patterns: ['src/**/test/**']  // Double globstar pattern
      })

      expect(checker.shouldInclude('src/test/file.ts')).toBe(true)
      expect(checker.shouldInclude('src/foo/test/file.ts')).toBe(true)
      expect(checker.shouldInclude('src/foo/bar/test/baz/file.ts')).toBe(true)
    })

    it('should handle patterns with question mark wildcard', () => {
      const checker = createIncludeChecker({
        patterns: ['src/?.ts']  // Single character wildcard
      })

      expect(checker.shouldInclude('src/a.ts')).toBe(true)
      expect(checker.shouldInclude('src/ab.ts')).toBe(false)  // Two chars - no match
      expect(checker.shouldInclude('src/.ts')).toBe(false)    // No char - no match
    })

    it('should handle character class patterns', () => {
      const checker = createIncludeChecker({
        patterns: ['src/[abc].ts']  // Character class
      })

      expect(checker.shouldInclude('src/a.ts')).toBe(true)
      expect(checker.shouldInclude('src/b.ts')).toBe(true)
      expect(checker.shouldInclude('src/d.ts')).toBe(false)
    })

    it('should handle negated character class patterns', () => {
      const checker = createIncludeChecker({
        patterns: ['src/[!abc].ts']  // Negated character class
      })

      expect(checker.shouldInclude('src/d.ts')).toBe(true)   // FAILING - [!...] may not work
      expect(checker.shouldInclude('src/a.ts')).toBe(false)
    })

    it('should handle range patterns in character class', () => {
      const checker = createIncludeChecker({
        patterns: ['src/file[0-9].ts']  // Range pattern
      })

      expect(checker.shouldInclude('src/file5.ts')).toBe(true)
      expect(checker.shouldInclude('src/filea.ts')).toBe(false)
    })
  })
})
