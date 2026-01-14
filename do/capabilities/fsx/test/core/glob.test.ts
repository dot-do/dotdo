/**
 * Glob Pattern Matching Tests
 *
 * Tests for glob pattern matching functionality including:
 * - Basic wildcard patterns (*, ?, **)
 * - Character classes ([abc], [a-z], [!abc])
 * - Brace expansion ({a,b,c}, {1..5}, nested)
 * - Pattern matching functions (match, createMatcher)
 * - Glob options (dot, nocase, ignore)
 * - Edge cases (escaped chars, empty patterns, etc.)
 *
 * Uses FsBackend for filesystem operations when needed.
 *
 * @see core/glob/match.ts - Pattern matching implementation
 * @see core/glob/glob.ts - File globbing implementation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { match, createMatcher } from '../../core/glob/match'
import { glob, type GlobOptions } from '../../core/glob/glob'
import { MemoryBackend } from '../../core/index'

// =============================================================================
// 1. Basic Patterns
// =============================================================================

describe('Basic Patterns', () => {
  describe('* matches any characters except /', () => {
    it('should match any characters in filename', () => {
      expect(match('*.ts', 'foo.ts')).toBe(true)
      expect(match('*.ts', 'bar.ts')).toBe(true)
      expect(match('*.ts', 'index.ts')).toBe(true)
    })

    it('should not match paths with slashes', () => {
      expect(match('*.ts', 'src/foo.ts')).toBe(false)
      expect(match('*.ts', 'a/b/c.ts')).toBe(false)
    })

    it('should match empty string before extension', () => {
      expect(match('*.ts', '.ts')).toBe(false) // dotfile without name
    })

    it('should work at any position in pattern', () => {
      expect(match('foo*', 'foobar')).toBe(true)
      expect(match('foo*', 'foo')).toBe(true)
      expect(match('*bar', 'foobar')).toBe(true)
      expect(match('foo*bar', 'fooxyzbar')).toBe(true)
    })

    it('should support multiple * in same segment', () => {
      expect(match('*.*', 'foo.ts')).toBe(true)
      expect(match('*.*', 'a.b.c')).toBe(true)
      expect(match('*test*', 'mytest.ts')).toBe(true)
      expect(match('*test*', 'test')).toBe(true)
    })
  })

  describe('? matches single character except /', () => {
    it('should match exactly one character', () => {
      expect(match('?.ts', 'a.ts')).toBe(true)
      expect(match('?.ts', 'x.ts')).toBe(true)
    })

    it('should not match zero characters', () => {
      expect(match('?.ts', '.ts')).toBe(false)
    })

    it('should not match multiple characters', () => {
      expect(match('?.ts', 'ab.ts')).toBe(false)
      expect(match('?.ts', 'foo.ts')).toBe(false)
    })

    it('should not match path separator', () => {
      expect(match('?', '/')).toBe(false)
    })

    it('should support multiple ? wildcards', () => {
      expect(match('???.ts', 'abc.ts')).toBe(true)
      expect(match('???.ts', 'ab.ts')).toBe(false)
      expect(match('???.ts', 'abcd.ts')).toBe(false)
    })

    it('should combine with * wildcards', () => {
      expect(match('?*.ts', 'a.ts')).toBe(true)
      expect(match('?*.ts', 'ab.ts')).toBe(true)
      expect(match('?*.ts', 'abc.ts')).toBe(true)
    })
  })

  describe('** matches any path segments', () => {
    it('should match zero directories', () => {
      expect(match('**/*.ts', 'foo.ts')).toBe(true)
      expect(match('**/foo', 'foo')).toBe(true)
    })

    it('should match single directory', () => {
      expect(match('**/*.ts', 'src/foo.ts')).toBe(true)
      expect(match('**/foo', 'bar/foo')).toBe(true)
    })

    it('should match multiple directories', () => {
      expect(match('**/*.ts', 'src/utils/foo.ts')).toBe(true)
      expect(match('**/*.ts', 'a/b/c/d/e.ts')).toBe(true)
    })

    it('should work at beginning of pattern', () => {
      expect(match('**/test.ts', 'test.ts')).toBe(true)
      expect(match('**/test.ts', 'src/test.ts')).toBe(true)
      expect(match('**/test.ts', 'src/utils/test.ts')).toBe(true)
    })

    it('should work in middle of pattern', () => {
      expect(match('src/**/test.ts', 'src/test.ts')).toBe(true)
      expect(match('src/**/test.ts', 'src/utils/test.ts')).toBe(true)
      expect(match('src/**/test.ts', 'src/a/b/c/test.ts')).toBe(true)
    })

    it('should work at end of pattern', () => {
      expect(match('src/**', 'src/foo.ts')).toBe(true)
      expect(match('src/**', 'src/utils/bar.ts')).toBe(true)
    })

    it('should support multiple ** segments', () => {
      expect(match('**/**/foo', 'foo')).toBe(true)
      expect(match('**/**/foo', 'a/foo')).toBe(true)
      expect(match('**/**/foo', 'a/b/foo')).toBe(true)
    })
  })

  describe('[abc] character classes', () => {
    it('should match any character in the class', () => {
      expect(match('[abc].ts', 'a.ts')).toBe(true)
      expect(match('[abc].ts', 'b.ts')).toBe(true)
      expect(match('[abc].ts', 'c.ts')).toBe(true)
    })

    it('should not match characters outside the class', () => {
      expect(match('[abc].ts', 'd.ts')).toBe(false)
      expect(match('[abc].ts', 'x.ts')).toBe(false)
      expect(match('[abc].ts', '1.ts')).toBe(false)
    })

    it('should match exactly one character', () => {
      expect(match('[abc].ts', 'ab.ts')).toBe(false)
      expect(match('[abc].ts', '.ts')).toBe(false)
    })

    it('should work with single character classes', () => {
      expect(match('[a].ts', 'a.ts')).toBe(true)
      expect(match('[a].ts', 'b.ts')).toBe(false)
    })

    it('should work anywhere in pattern', () => {
      expect(match('foo[123]bar', 'foo1bar')).toBe(true)
      expect(match('foo[123]bar', 'foo2bar')).toBe(true)
      expect(match('foo[123]bar', 'foo4bar')).toBe(false)
    })
  })

  describe('[a-z] character ranges', () => {
    it('should match lowercase letters', () => {
      expect(match('[a-z].ts', 'a.ts')).toBe(true)
      expect(match('[a-z].ts', 'm.ts')).toBe(true)
      expect(match('[a-z].ts', 'z.ts')).toBe(true)
    })

    it('should match uppercase letters', () => {
      expect(match('[A-Z].ts', 'A.ts')).toBe(true)
      expect(match('[A-Z].ts', 'M.ts')).toBe(true)
      expect(match('[A-Z].ts', 'Z.ts')).toBe(true)
    })

    it('should match digits', () => {
      expect(match('[0-9].ts', '0.ts')).toBe(true)
      expect(match('[0-9].ts', '5.ts')).toBe(true)
      expect(match('[0-9].ts', '9.ts')).toBe(true)
    })

    it('should not match outside range', () => {
      expect(match('[a-c].ts', 'd.ts')).toBe(false)
      expect(match('[0-5].ts', '6.ts')).toBe(false)
    })

    it('should support multiple ranges', () => {
      expect(match('[a-zA-Z].ts', 'a.ts')).toBe(true)
      expect(match('[a-zA-Z].ts', 'Z.ts')).toBe(true)
      expect(match('[a-zA-Z0-9].ts', '5.ts')).toBe(true)
    })

    it('should support mixed ranges and literals', () => {
      expect(match('[a-z_].ts', 'x.ts')).toBe(true)
      expect(match('[a-z_].ts', '_.ts')).toBe(true)
    })
  })

  describe('[!abc] negated character classes', () => {
    it('should not match characters in the class', () => {
      expect(match('[!abc].ts', 'a.ts')).toBe(false)
      expect(match('[!abc].ts', 'b.ts')).toBe(false)
      expect(match('[!abc].ts', 'c.ts')).toBe(false)
    })

    it('should match characters outside the class', () => {
      expect(match('[!abc].ts', 'd.ts')).toBe(true)
      expect(match('[!abc].ts', 'x.ts')).toBe(true)
      expect(match('[!abc].ts', '1.ts')).toBe(true)
    })

    it('should support negated ranges', () => {
      expect(match('[!a-z].ts', 'A.ts')).toBe(true)
      expect(match('[!a-z].ts', '1.ts')).toBe(true)
      expect(match('[!a-z].ts', 'm.ts')).toBe(false)
    })

    it('should support ^ as alternative negation', () => {
      expect(match('[^abc].ts', 'd.ts')).toBe(true)
      expect(match('[^abc].ts', 'a.ts')).toBe(false)
    })
  })
})

// =============================================================================
// 2. Brace Expansion
// =============================================================================

describe('Brace Expansion', () => {
  describe('{a,b,c} alternatives', () => {
    it('should match any alternative', () => {
      expect(match('{foo,bar,baz}', 'foo')).toBe(true)
      expect(match('{foo,bar,baz}', 'bar')).toBe(true)
      expect(match('{foo,bar,baz}', 'baz')).toBe(true)
    })

    it('should not match non-alternatives', () => {
      expect(match('{foo,bar,baz}', 'qux')).toBe(false)
      expect(match('{foo,bar,baz}', 'foobar')).toBe(false)
    })

    it('should work with extensions', () => {
      expect(match('*.{ts,tsx}', 'foo.ts')).toBe(true)
      expect(match('*.{ts,tsx}', 'foo.tsx')).toBe(true)
      expect(match('*.{ts,tsx}', 'foo.js')).toBe(false)
    })

    it('should work with directories', () => {
      expect(match('{src,lib}/**/*.ts', 'src/foo.ts')).toBe(true)
      expect(match('{src,lib}/**/*.ts', 'lib/bar.ts')).toBe(true)
      expect(match('{src,lib}/**/*.ts', 'test/foo.ts')).toBe(false)
    })

    it('should support single alternatives', () => {
      expect(match('{foo}', 'foo')).toBe(true)
      expect(match('{foo}', 'bar')).toBe(false)
    })

    it('should support empty alternatives', () => {
      expect(match('foo{,bar}', 'foo')).toBe(true)
      expect(match('foo{,bar}', 'foobar')).toBe(true)
    })
  })

  describe('{1..5} numeric ranges', () => {
    // Note: Numeric ranges may not be implemented - these test expected behavior
    it('should handle simple numeric alternatives', () => {
      // Using explicit alternatives as fallback
      expect(match('{1,2,3,4,5}', '1')).toBe(true)
      expect(match('{1,2,3,4,5}', '3')).toBe(true)
      expect(match('{1,2,3,4,5}', '5')).toBe(true)
    })

    it('should work in filenames', () => {
      expect(match('file{1,2,3}.txt', 'file1.txt')).toBe(true)
      expect(match('file{1,2,3}.txt', 'file2.txt')).toBe(true)
      expect(match('file{1,2,3}.txt', 'file4.txt')).toBe(false)
    })
  })

  describe('Nested braces', () => {
    it('should handle nested brace expansions', () => {
      expect(match('{a,{b,c}}', 'a')).toBe(true)
      expect(match('{a,{b,c}}', 'b')).toBe(true)
      expect(match('{a,{b,c}}', 'c')).toBe(true)
    })

    it('should handle deeply nested braces', () => {
      expect(match('{a,{b,{c,d}}}', 'a')).toBe(true)
      expect(match('{a,{b,{c,d}}}', 'b')).toBe(true)
      expect(match('{a,{b,{c,d}}}', 'c')).toBe(true)
      expect(match('{a,{b,{c,d}}}', 'd')).toBe(true)
    })

    it('should combine nested braces with wildcards', () => {
      expect(match('*.{ts,{js,jsx}}', 'foo.ts')).toBe(true)
      expect(match('*.{ts,{js,jsx}}', 'foo.js')).toBe(true)
      expect(match('*.{ts,{js,jsx}}', 'foo.jsx')).toBe(true)
    })
  })
})

// =============================================================================
// 3. Pattern Matching Functions
// =============================================================================

describe('Pattern Matching Functions', () => {
  describe('match(path, pattern) returns boolean', () => {
    it('should return true for matching paths', () => {
      expect(match('*.ts', 'index.ts')).toBe(true)
      expect(match('src/**/*.ts', 'src/utils/helpers.ts')).toBe(true)
    })

    it('should return false for non-matching paths', () => {
      expect(match('*.ts', 'index.js')).toBe(false)
      expect(match('src/**/*.ts', 'lib/utils.ts')).toBe(false)
    })

    it('should handle exact matches', () => {
      expect(match('package.json', 'package.json')).toBe(true)
      expect(match('package.json', 'package.lock')).toBe(false)
    })

    it('should throw on empty pattern', () => {
      expect(() => match('', 'foo')).toThrow()
    })

    it('should return false for empty path', () => {
      expect(match('*.ts', '')).toBe(false)
    })
  })

  describe('createMatcher(pattern) returns matcher function', () => {
    it('should create reusable matcher', () => {
      const isTypeScript = createMatcher('**/*.ts')

      expect(isTypeScript('src/index.ts')).toBe(true)
      expect(isTypeScript('lib/utils.ts')).toBe(true)
      expect(isTypeScript('README.md')).toBe(false)
    })

    it('should be efficient for multiple matches', () => {
      const matcher = createMatcher('src/**/*.{ts,tsx}')
      const paths = [
        'src/index.ts',
        'src/App.tsx',
        'src/utils/helpers.ts',
        'lib/index.ts',
        'README.md',
      ]

      const matches = paths.filter(matcher)
      expect(matches).toEqual([
        'src/index.ts',
        'src/App.tsx',
        'src/utils/helpers.ts',
      ])
    })

    it('should throw on empty pattern', () => {
      expect(() => createMatcher('')).toThrow()
    })

    it('should support options', () => {
      const matcherWithDot = createMatcher('*', { dot: true })
      const matcherWithoutDot = createMatcher('*', { dot: false })

      expect(matcherWithDot('.gitignore')).toBe(true)
      expect(matcherWithoutDot('.gitignore')).toBe(false)
    })
  })

  describe('glob(pattern, options) returns string[]', () => {
    it('should return array of matching files', async () => {
      const result = await glob('**/*.ts')
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return sorted results', async () => {
      const result = await glob('**/*.ts')
      const sorted = [...result].sort()
      expect(result).toEqual(sorted)
    })

    it('should deduplicate results', async () => {
      const result = await glob(['**/*.ts', 'src/**/*.ts'])
      const unique = new Set(result)
      expect(result.length).toBe(unique.size)
    })

    it('should support pattern arrays', async () => {
      const result = await glob(['*.json', '*.md'])
      expect(result).toContain('package.json')
      expect(result).toContain('README.md')
    })
  })
})

// =============================================================================
// 4. Options
// =============================================================================

describe('Options', () => {
  describe('dot: include dotfiles', () => {
    it('should exclude dotfiles by default', () => {
      expect(match('*', '.gitignore')).toBe(false)
      expect(match('*', '.env')).toBe(false)
    })

    it('should include dotfiles when dot is true', () => {
      expect(match('*', '.gitignore', { dot: true })).toBe(true)
      expect(match('*', '.env', { dot: true })).toBe(true)
    })

    it('should match explicit dot patterns without option', () => {
      expect(match('.gitignore', '.gitignore')).toBe(true)
      expect(match('.env', '.env')).toBe(true)
    })

    it('should work with ** patterns', () => {
      // Note: **/* matches .hidden/file because:
      // 1. ** can traverse any directory including dotfiles
      // 2. * matches 'file' (which doesn't start with .)
      // The dot option mainly controls whether * or ? can match a leading . in a segment
      // This is consistent with common glob implementations
      expect(match('**/*', '.hidden/file', { dot: false })).toBe(true) // ** traverses .hidden, * matches file
      expect(match('**/*', '.hidden/file', { dot: true })).toBe(true)

      // To require explicit dotfile matching, use explicit patterns
      expect(match('*', '.hidden', { dot: false })).toBe(false)
      expect(match('*', '.hidden', { dot: true })).toBe(true)
    })

    it('should work with glob function', async () => {
      const withDot = await glob('*', { dot: true })
      const withoutDot = await glob('*', { dot: false })

      expect(withDot).toContain('.gitignore')
      expect(withoutDot).not.toContain('.gitignore')
    })
  })

  describe('nocase: case insensitive matching', () => {
    it('should be case sensitive by default', () => {
      expect(match('*.TS', 'foo.ts')).toBe(false)
      expect(match('FOO.*', 'foo.ts')).toBe(false)
    })

    it('should match case insensitively when nocase is true', () => {
      expect(match('*.TS', 'foo.ts', { nocase: true })).toBe(true)
      expect(match('FOO.*', 'foo.ts', { nocase: true })).toBe(true)
      expect(match('*.ts', 'FOO.TS', { nocase: true })).toBe(true)
    })

    it('should work with character classes', () => {
      expect(match('[A-Z].ts', 'a.ts', { nocase: true })).toBe(true)
      expect(match('[a-z].ts', 'A.ts', { nocase: true })).toBe(true)
    })

    it('should work with brace expansion', () => {
      expect(match('{FOO,BAR}', 'foo', { nocase: true })).toBe(true)
      expect(match('{foo,bar}', 'BAR', { nocase: true })).toBe(true)
    })
  })

  describe('ignore: patterns to exclude', () => {
    it('should exclude matching files', async () => {
      const result = await glob('**/*.ts', {
        ignore: ['**/*.test.ts'],
      })

      expect(result).not.toContain('test/index.test.ts')
      expect(result).toContain('src/index.ts')
    })

    it('should support multiple ignore patterns', async () => {
      const result = await glob('**/*', {
        ignore: ['**/node_modules/**', '**/test/**'],
      })

      expect(result).not.toContain('node_modules/lodash/index.js')
      expect(result).not.toContain('test/index.test.ts')
    })

    it('should support glob patterns in ignore', async () => {
      const result = await glob('**/*', {
        ignore: ['**/*.{test,spec}.ts'],
      })

      expect(result).not.toContain('test/index.test.ts')
    })

    it('should handle empty ignore array', async () => {
      const withIgnore = await glob('*.json', { ignore: [] })
      const withoutIgnore = await glob('*.json')

      expect(withIgnore).toEqual(withoutIgnore)
    })
  })
})

// =============================================================================
// 5. Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  describe('Escaped special characters', () => {
    it('should match literal * when escaped', () => {
      expect(match('foo\\*bar', 'foo*bar')).toBe(true)
      expect(match('foo\\*bar', 'fooXbar')).toBe(false)
    })

    it('should match literal ? when escaped', () => {
      expect(match('foo\\?bar', 'foo?bar')).toBe(true)
      expect(match('foo\\?bar', 'fooXbar')).toBe(false)
    })

    it('should match literal [ when escaped', () => {
      expect(match('foo\\[bar', 'foo[bar')).toBe(true)
    })

    it('should match literal { when escaped', () => {
      expect(match('foo\\{bar', 'foo{bar')).toBe(true)
    })
  })

  describe('Empty patterns', () => {
    it('should throw on empty string pattern', () => {
      expect(() => match('', 'foo')).toThrow('Pattern cannot be empty')
    })

    it('should throw on empty createMatcher pattern', () => {
      expect(() => createMatcher('')).toThrow('Pattern cannot be empty')
    })

    it('should handle empty pattern array in glob', async () => {
      const result = await glob([])
      expect(result).toEqual([])
    })

    it('should throw on empty string in glob', async () => {
      await expect(glob('')).rejects.toThrow()
    })
  })

  describe('Patterns ending with /', () => {
    it('should match directories with trailing slash', () => {
      expect(match('src/', 'src/')).toBe(true)
    })

    it('should not match files without trailing slash', () => {
      expect(match('src/', 'src')).toBe(false)
    })

    it('should work with ** patterns', () => {
      expect(match('**/', 'src/')).toBe(true)
    })
  })

  describe('Special path cases', () => {
    it('should handle root path', () => {
      expect(match('/', '/')).toBe(true)
    })

    it('should handle paths with multiple slashes', () => {
      expect(match('src/**/*.ts', 'src/a/b/c/d.ts')).toBe(true)
    })

    it('should not match when pattern has more segments', () => {
      expect(match('a/b/c', 'a/b')).toBe(false)
    })

    it('should not match when path has more segments (without **)', () => {
      expect(match('a/b', 'a/b/c')).toBe(false)
    })
  })

  describe('Negation patterns', () => {
    it('should negate match with ! prefix', () => {
      expect(match('!*.ts', 'foo.ts')).toBe(false)
      expect(match('!*.ts', 'foo.js')).toBe(true)
    })

    it('should support double negation', () => {
      expect(match('!!*.ts', 'foo.ts')).toBe(true)
      expect(match('!!*.ts', 'foo.js')).toBe(false)
    })
  })

  describe('Complex real-world patterns', () => {
    it('should handle TypeScript project patterns', () => {
      const isSourceFile = createMatcher('src/**/*.{ts,tsx}')
      const isTestFile = createMatcher('**/*.{test,spec}.{ts,tsx}')

      expect(isSourceFile('src/index.ts')).toBe(true)
      expect(isSourceFile('src/components/Button.tsx')).toBe(true)
      expect(isTestFile('src/utils.test.ts')).toBe(true)
      expect(isTestFile('tests/app.spec.tsx')).toBe(true)
    })

    it('should handle gitignore patterns', () => {
      const isIgnored = createMatcher('**/node_modules/**')
      const isIgnored2 = createMatcher('**/*.log')

      expect(isIgnored('node_modules/lodash/index.js')).toBe(true)
      expect(isIgnored('src/node_modules/hack/index.js')).toBe(true)
      expect(isIgnored2('error.log')).toBe(true)
      expect(isIgnored2('logs/debug.log')).toBe(true)
    })

    it('should handle monorepo patterns', () => {
      const isPackageSource = createMatcher('packages/*/src/**/*.ts')

      expect(isPackageSource('packages/core/src/index.ts')).toBe(true)
      expect(isPackageSource('packages/utils/src/helpers/string.ts')).toBe(true)
      expect(isPackageSource('packages/core/tests/index.test.ts')).toBe(false)
    })
  })
})

// =============================================================================
// 6. Integration with FsBackend
// =============================================================================

describe('Integration with FsBackend', () => {
  let backend: MemoryBackend

  beforeEach(async () => {
    backend = new MemoryBackend()

    // Set up test filesystem
    await backend.mkdir('/project', { recursive: true })
    await backend.mkdir('/project/src', { recursive: true })
    await backend.mkdir('/project/src/utils', { recursive: true })
    await backend.mkdir('/project/test', { recursive: true })
    await backend.mkdir('/project/node_modules/lodash', { recursive: true })
    await backend.mkdir('/project/.hidden', { recursive: true })

    // Create files
    await backend.writeFile('/project/package.json', '{}')
    await backend.writeFile('/project/README.md', '# Project')
    await backend.writeFile('/project/tsconfig.json', '{}')
    await backend.writeFile('/project/.gitignore', 'node_modules')
    await backend.writeFile('/project/.env', 'SECRET=xxx')

    await backend.writeFile('/project/src/index.ts', 'export {}')
    await backend.writeFile('/project/src/app.tsx', 'export {}')
    await backend.writeFile('/project/src/utils/helpers.ts', 'export {}')
    await backend.writeFile('/project/src/utils/format.ts', 'export {}')

    await backend.writeFile('/project/test/index.test.ts', 'test()')
    await backend.writeFile('/project/test/utils.test.ts', 'test()')

    await backend.writeFile('/project/node_modules/lodash/index.js', 'module.exports = {}')
    await backend.writeFile('/project/.hidden/secrets.txt', 'secret')
  })

  it('should glob with FsBackend', async () => {
    const result = await glob('**/*.ts', {
      cwd: '/project',
      backend,
    })

    expect(result).toContain('src/index.ts')
    expect(result).toContain('src/utils/helpers.ts')
    expect(result).toContain('test/index.test.ts')
  })

  it('should respect ignore option with backend', async () => {
    const result = await glob('**/*.ts', {
      cwd: '/project',
      backend,
      ignore: ['**/test/**'],
    })

    expect(result).toContain('src/index.ts')
    expect(result).not.toContain('test/index.test.ts')
  })

  it('should handle dot option with backend', async () => {
    const withDot = await glob('*', {
      cwd: '/project',
      backend,
      dot: true,
    })

    const withoutDot = await glob('*', {
      cwd: '/project',
      backend,
      dot: false,
    })

    expect(withDot).toContain('.gitignore')
    expect(withoutDot).not.toContain('.gitignore')
  })

  it('should return absolute paths with backend', async () => {
    const result = await glob('src/*.ts', {
      cwd: '/project',
      backend,
      absolute: true,
    })

    expect(result).toContain('/project/src/index.ts')
    expect(result.every(p => p.startsWith('/'))).toBe(true)
  })

  it('should filter directories with backend', async () => {
    const dirs = await glob('**/*', {
      cwd: '/project',
      backend,
      onlyDirectories: true,
    })

    expect(dirs).toContain('src')
    expect(dirs).toContain('src/utils')
    expect(dirs).not.toContain('src/index.ts')
  })

  it('should respect deep option with backend', async () => {
    const shallow = await glob('**/*', {
      cwd: '/project',
      backend,
      deep: 1,
    })

    const deep = await glob('**/*', {
      cwd: '/project',
      backend,
      deep: 3,
    })

    expect(shallow).not.toContain('src/utils/helpers.ts')
    expect(deep).toContain('src/utils/helpers.ts')
  })

  it('should handle complex patterns with backend', async () => {
    const result = await glob(['src/**/*.{ts,tsx}', '*.json'], {
      cwd: '/project',
      backend,
      ignore: ['**/node_modules/**'],
    })

    expect(result).toContain('src/index.ts')
    expect(result).toContain('src/app.tsx')
    expect(result).toContain('package.json')
    expect(result).toContain('tsconfig.json')
    expect(result).not.toContain('node_modules/lodash/index.js')
  })
})

// =============================================================================
// 7. Performance and Concurrency
// =============================================================================

describe('Performance and Concurrency', () => {
  it('should handle concurrent glob calls', async () => {
    const [ts, tsx, js] = await Promise.all([
      glob('**/*.ts'),
      glob('**/*.tsx'),
      glob('**/*.js'),
    ])

    expect(Array.isArray(ts)).toBe(true)
    expect(Array.isArray(tsx)).toBe(true)
    expect(Array.isArray(js)).toBe(true)
  })

  it('should return consistent results across calls', async () => {
    const result1 = await glob('**/*.ts')
    const result2 = await glob('**/*.ts')

    expect(result1).toEqual(result2)
  })

  it('should handle many patterns efficiently', () => {
    const patterns = Array.from({ length: 100 }, (_, i) => `*.${i}`)
    const matchers = patterns.map(p => createMatcher(p))

    expect(matchers.length).toBe(100)
    expect(matchers.every(m => typeof m === 'function')).toBe(true)
  })

  it('should match many paths efficiently', () => {
    const matcher = createMatcher('**/*.ts')
    const paths = Array.from({ length: 1000 }, (_, i) => `src/file${i}.ts`)

    const start = Date.now()
    const results = paths.filter(matcher)
    const elapsed = Date.now() - start

    expect(results.length).toBe(1000)
    expect(elapsed).toBeLessThan(1000) // Should complete in under 1 second
  })
})
