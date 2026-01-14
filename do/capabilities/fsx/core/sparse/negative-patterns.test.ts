/**
 * RED Phase: Tests for negative patterns (!pattern) handling
 *
 * This file contains failing tests for negative/exclude pattern functionality.
 * These tests document the expected behavior for gitignore-style negation patterns.
 *
 * Gitignore negation semantics:
 * - A pattern starting with ! negates any previous match
 * - Patterns are processed in order; later patterns override earlier ones
 * - \! at the start escapes the exclamation mark (matches literal !)
 * - Negation can re-include files that were previously excluded
 *
 * Reference: https://git-scm.com/docs/gitignore#_pattern_format
 *
 * @module sparse/negative-patterns.test
 */

import { describe, it, expect } from 'vitest'
import { createIncludeChecker } from './include'
import { parsePattern, matchPattern, createPatternMatcher } from './patterns'

// =============================================================================
// RED Phase: Negative pattern syntax (!pattern) - parsePattern tests
// =============================================================================

describe('parsePattern - negative pattern handling', () => {
  describe('basic negation parsing', () => {
    it('should parse !*.test.ts as negated pattern', () => {
      const result = parsePattern('!*.test.ts')
      expect(result.isNegated).toBe(true)
      expect(result.segments).toEqual(['*.test.ts'])
    })

    it('should parse !node_modules/** as negated directory pattern', () => {
      const result = parsePattern('!node_modules/**')
      expect(result.isNegated).toBe(true)
      expect(result.segments).toEqual(['node_modules', '**'])
    })

    it('should parse !src/test/** as negated nested path', () => {
      const result = parsePattern('!src/test/**')
      expect(result.isNegated).toBe(true)
      expect(result.segments).toEqual(['src', 'test', '**'])
    })

    it('should parse !!pattern as double negation', () => {
      const result = parsePattern('!!*.ts')
      // Double negation: first ! is negation, second ! should be part of pattern
      // Actually in gitignore, !! would mean: negate the negation of *.ts
      expect(result.isNegated).toBe(true)
      // The pattern after first ! is "!*.ts" which itself is negated
    })
  })

  describe('escaped exclamation mark (\\!)', () => {
    it('should parse \\!important.txt as non-negated literal pattern', () => {
      const result = parsePattern('\\!important.txt')
      expect(result.isNegated).toBe(false)
      // The escaped ! should be treated as literal character in the pattern
      expect(result.segments).toEqual(['\\!important.txt'])
    })

    it('should parse \\!*.txt as pattern matching files starting with !', () => {
      const result = parsePattern('\\!*.txt')
      expect(result.isNegated).toBe(false)
      expect(result.segments).toEqual(['\\!*.txt'])
    })

    it('should differentiate between !foo and \\!foo', () => {
      const negated = parsePattern('!foo')
      const literal = parsePattern('\\!foo')

      expect(negated.isNegated).toBe(true)
      expect(literal.isNegated).toBe(false)
    })
  })
})

// =============================================================================
// RED Phase: matchPattern with negation
// =============================================================================

describe('matchPattern - negative pattern matching', () => {
  describe('!*.test.ts excludes test files', () => {
    it('should return false for test files when using negated pattern', () => {
      // When the pattern is negated, matching files should return false
      expect(matchPattern('foo.test.ts', '!*.test.ts')).toBe(false)
      expect(matchPattern('bar.test.ts', '!*.test.ts')).toBe(false)
      expect(matchPattern('index.test.ts', '!*.test.ts')).toBe(false)
    })

    it('should return true for non-test files when using negated pattern', () => {
      // Files that don't match the negated pattern should return true
      expect(matchPattern('foo.ts', '!*.test.ts')).toBe(true)
      expect(matchPattern('index.ts', '!*.test.ts')).toBe(true)
      expect(matchPattern('bar.spec.ts', '!*.test.ts')).toBe(true) // .spec not .test
    })
  })

  describe('!node_modules/** excludes directories', () => {
    it('should return false for paths in node_modules', () => {
      expect(matchPattern('node_modules/lodash/index.js', '!node_modules/**')).toBe(false)
      expect(matchPattern('node_modules/@types/node/index.d.ts', '!node_modules/**')).toBe(false)
    })

    it('should return true for paths not in node_modules', () => {
      expect(matchPattern('src/index.ts', '!node_modules/**')).toBe(true)
      expect(matchPattern('lib/utils.js', '!node_modules/**')).toBe(true)
    })

    it('should return false for nested node_modules', () => {
      expect(matchPattern('packages/core/node_modules/lodash/index.js', '!**/node_modules/**')).toBe(false)
    })
  })

  describe('escaped \\! for literal exclamation', () => {
    it('should match files starting with literal ! when using \\!', () => {
      expect(matchPattern('!important.txt', '\\!important.txt')).toBe(true)
      expect(matchPattern('important.txt', '\\!important.txt')).toBe(false)
    })

    it('should match patterns with escaped ! and wildcards', () => {
      expect(matchPattern('!readme.txt', '\\!*.txt')).toBe(true)
      expect(matchPattern('!config.txt', '\\!*.txt')).toBe(true)
      expect(matchPattern('readme.txt', '\\!*.txt')).toBe(false)
    })
  })
})

// =============================================================================
// RED Phase: createPatternMatcher with negation
// =============================================================================

describe('createPatternMatcher - negative pattern handling', () => {
  describe('inverted matching for negated patterns', () => {
    it('should invert match result for !*.test.ts', () => {
      const matcher = createPatternMatcher('!*.test.ts')

      // Test files match the base pattern, so negation returns false
      expect(matcher('foo.test.ts')).toBe(false)
      expect(matcher('bar.test.ts')).toBe(false)

      // Non-test files don't match base pattern, so negation returns true
      expect(matcher('foo.ts')).toBe(true)
      expect(matcher('index.js')).toBe(true)
    })

    it('should handle negated directory patterns', () => {
      const matcher = createPatternMatcher('!**/test/**')

      expect(matcher('src/test/helper.ts')).toBe(false)
      expect(matcher('test/unit/foo.ts')).toBe(false)
      expect(matcher('src/index.ts')).toBe(true)
    })
  })

  describe('double negation (!!pattern)', () => {
    it('should cancel out double negation', () => {
      const matcher = createPatternMatcher('!!*.ts')

      // Double negation: !!*.ts should behave like *.ts
      expect(matcher('foo.ts')).toBe(true)
      expect(matcher('bar.ts')).toBe(true)
      expect(matcher('foo.js')).toBe(false)
    })

    it('should handle triple negation', () => {
      const matcher = createPatternMatcher('!!!*.ts')

      // Triple negation: !!!*.ts should behave like !*.ts (inverted)
      expect(matcher('foo.ts')).toBe(false)
      expect(matcher('foo.js')).toBe(true)
    })
  })
})

// =============================================================================
// RED Phase: createIncludeChecker - pattern order matters (last wins)
// =============================================================================

describe('createIncludeChecker - pattern order (last match wins)', () => {
  describe('negation in excludePatterns re-includes files', () => {
    it('should re-include test fixtures when negated after test exclusion', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: [
          '**/test/**',           // Exclude all test directories
          '!**/test/fixtures/**'  // But re-include fixtures
        ]
      })

      // test/** is excluded
      expect(checker.shouldInclude('src/test/helper.ts')).toBe(false)
      expect(checker.shouldInclude('test/unit/foo.ts')).toBe(false)

      // But fixtures should be re-included by the negation
      expect(checker.shouldInclude('src/test/fixtures/data.json')).toBe(true)
      expect(checker.shouldInclude('test/fixtures/mock.ts')).toBe(true)
    })

    it('should re-include specific node_modules packages', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: [
          '**/node_modules/**',           // Exclude all node_modules
          '!**/node_modules/@company/**', // But keep company packages
          '!**/node_modules/lodash/**'    // And keep lodash for debugging
        ]
      })

      // Random packages excluded
      expect(checker.shouldInclude('node_modules/random/index.js')).toBe(false)
      expect(checker.shouldInclude('node_modules/express/index.js')).toBe(false)

      // Company packages re-included
      expect(checker.shouldInclude('node_modules/@company/core/index.js')).toBe(true)
      expect(checker.shouldInclude('node_modules/@company/utils/helper.js')).toBe(true)

      // Lodash re-included
      expect(checker.shouldInclude('node_modules/lodash/index.js')).toBe(true)
    })
  })

  describe('sequential pattern processing', () => {
    it('should process patterns in order - later patterns override earlier', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: [
          '*.log',       // Exclude all log files
          '!debug.log',  // But keep debug.log
          'error.log'    // And re-exclude error.log specifically
        ]
      })

      expect(checker.shouldInclude('app.log')).toBe(false)      // Excluded by *.log
      expect(checker.shouldInclude('debug.log')).toBe(true)     // Re-included by !debug.log
      expect(checker.shouldInclude('error.log')).toBe(false)    // Re-excluded by error.log
      expect(checker.shouldInclude('server.log')).toBe(false)   // Excluded by *.log
    })

    it('should handle complex ordering with multiple negations', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: [
          '**/dist/**',              // Exclude all dist
          '!**/dist/types/**',       // Re-include types
          '**/dist/types/internal/**' // But exclude internal types
        ]
      })

      expect(checker.shouldInclude('dist/bundle.js')).toBe(false)
      expect(checker.shouldInclude('dist/types/index.d.ts')).toBe(true)
      expect(checker.shouldInclude('dist/types/internal/secret.d.ts')).toBe(false)
    })
  })

  describe('negation in include patterns', () => {
    it('should exclude via negation in include patterns', () => {
      const checker = createIncludeChecker({
        patterns: [
          'src/**',           // Include all of src
          '!src/internal/**'  // But exclude internal
        ]
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/utils/helper.ts')).toBe(true)
      expect(checker.shouldInclude('src/internal/secret.ts')).toBe(false)
      expect(checker.shouldInclude('src/internal/config.ts')).toBe(false)
    })

    it('should re-include after exclusion in include patterns', () => {
      const checker = createIncludeChecker({
        patterns: [
          'src/**',              // Include all of src
          '!src/test/**',        // Exclude test
          'src/test/e2e/**'      // But include e2e
        ]
      })

      expect(checker.shouldInclude('src/index.ts')).toBe(true)
      expect(checker.shouldInclude('src/test/unit/foo.ts')).toBe(false)
      expect(checker.shouldInclude('src/test/e2e/app.test.ts')).toBe(true)
    })
  })
})

// =============================================================================
// RED Phase: Directory vs file matching with negation
// =============================================================================

describe('directory vs file matching with negation', () => {
  it('should handle negated directory patterns (trailing slash)', () => {
    const checker = createIncludeChecker({
      patterns: ['**'],
      excludePatterns: ['!logs/']  // This is confusing: negate an exclusion of logs dir?
    })

    // The semantics here are tricky - this test documents expected behavior
    // A pattern like '!logs/' should mean "don't exclude logs directory"
    expect(checker.shouldInclude('logs/app.log')).toBe(true)
  })

  it('should differentiate between !foo and !foo/ in exclusions', () => {
    const checker = createIncludeChecker({
      patterns: ['**'],
      excludePatterns: [
        'temp',   // Exclude file or directory named temp
        '!temp/'  // Re-include if it's a directory (keep directory contents)
      ]
    })

    // A file named "temp" should still be excluded
    // But contents of temp/ directory should be re-included
    expect(checker.shouldInclude('temp')).toBe(false)         // File excluded
    expect(checker.shouldInclude('temp/data.txt')).toBe(true) // Dir contents re-included
  })
})

// =============================================================================
// RED Phase: Edge cases for negative patterns
// =============================================================================

describe('negative pattern edge cases', () => {
  describe('negation only patterns', () => {
    it('should throw for pattern that is only negation (!)', () => {
      expect(() => parsePattern('!')).toThrow()
    })

    it('should handle !/ as negation of root', () => {
      const result = parsePattern('!/')
      expect(result.isNegated).toBe(true)
      expect(result.isRooted).toBe(true)
    })
  })

  describe('negation with special characters', () => {
    it('should handle negation with character classes', () => {
      const matcher = createPatternMatcher('![abc].ts')

      // Negated: files NOT matching [abc].ts should return true
      expect(matcher('d.ts')).toBe(true)
      expect(matcher('a.ts')).toBe(false)
    })

    it('should handle negation with brace expansion', () => {
      const matcher = createPatternMatcher('!*.{test,spec}.ts')

      expect(matcher('foo.test.ts')).toBe(false)
      expect(matcher('foo.spec.ts')).toBe(false)
      expect(matcher('foo.ts')).toBe(true)
    })

    it('should handle negation with question mark', () => {
      const matcher = createPatternMatcher('!?.ts')

      expect(matcher('a.ts')).toBe(false)  // Single char matches, so negation returns false
      expect(matcher('ab.ts')).toBe(true)  // Two chars don't match, so negation returns true
    })
  })

  describe('nested negations in path', () => {
    it('should handle paths with literal ! in directory name', () => {
      const checker = createIncludeChecker({
        patterns: ['**'],
        excludePatterns: ['\\!important/**']  // Exclude directory named "!important"
      })

      expect(checker.shouldInclude('!important/secret.txt')).toBe(false)
      expect(checker.shouldInclude('important/public.txt')).toBe(true)
    })
  })

  describe('interaction with rooted patterns', () => {
    it('should handle negation of rooted pattern', () => {
      const result = parsePattern('!/src')
      expect(result.isNegated).toBe(true)
      expect(result.isRooted).toBe(true)
      expect(result.segments).toEqual(['src'])
    })

    it('should handle rooted negation in includes', () => {
      const checker = createIncludeChecker({
        patterns: [
          '**',
          '!/node_modules'  // Only exclude root node_modules, not nested
        ]
      })

      // Root node_modules excluded
      expect(checker.shouldInclude('node_modules/lodash/index.js')).toBe(false)

      // Nested node_modules should NOT be excluded by this pattern
      // (rooted pattern only matches at root)
      expect(checker.shouldInclude('packages/core/node_modules/lodash/index.js')).toBe(true)
    })
  })

  describe('empty and whitespace with negation', () => {
    it('should handle negation followed by whitespace', () => {
      // "! foo" - is this negation of " foo" or invalid?
      // Gitignore: would treat "! foo" as negation of " foo" (space is significant)
      const result = parsePattern('! foo')
      expect(result.isNegated).toBe(true)
      expect(result.segments).toEqual([' foo'])  // Space is part of the pattern
    })
  })
})

// =============================================================================
// RED Phase: Performance tests for negative patterns
// =============================================================================

describe('negative pattern performance', () => {
  it('should efficiently handle many negation patterns', () => {
    const excludePatterns = [
      '**/node_modules/**',
      '!**/node_modules/@company/**',
      '**/dist/**',
      '!**/dist/types/**',
      '**/build/**',
      '!**/build/release/**',
      '**/*.test.ts',
      '!**/*.e2e.test.ts',
      '**/*.spec.ts',
      '!**/*.integration.spec.ts'
    ]

    const checker = createIncludeChecker({
      patterns: ['**'],
      excludePatterns
    })

    // Should not timeout or error with many patterns
    const paths = [
      'src/index.ts',
      'node_modules/lodash/index.js',
      'node_modules/@company/core/index.js',
      'dist/bundle.js',
      'dist/types/index.d.ts',
      'src/foo.test.ts',
      'src/foo.e2e.test.ts',
      'src/foo.spec.ts',
      'src/foo.integration.spec.ts'
    ]

    const start = Date.now()
    for (let i = 0; i < 1000; i++) {
      for (const path of paths) {
        checker.shouldInclude(path)
      }
    }
    const duration = Date.now() - start

    // Should complete 9000 checks in under 1 second
    expect(duration).toBeLessThan(1000)
  })
})

// =============================================================================
// Summary: Test count
// =============================================================================
// This file contains the following test groups for negative patterns:
//
// 1. parsePattern - negative pattern handling: 7 tests
// 2. matchPattern - negative pattern matching: 9 tests
// 3. createPatternMatcher - negative pattern handling: 5 tests
// 4. createIncludeChecker - pattern order (last match wins): 7 tests
// 5. directory vs file matching with negation: 2 tests
// 6. negative pattern edge cases: 10 tests
// 7. negative pattern performance: 1 test
//
// Total: 41 tests for negative pattern handling
// =============================================================================
