import { describe, it, expect, beforeEach } from 'vitest'
import {
  parsePattern,
  parsePatterns,
  parsePatternsArray,
  matchPattern,
  createPatternMatcher,
  LazyPatternMatcher,
  getPatternCacheStats,
  resetPatternCacheStats,
  clearPatternCache,
  type ParsedPattern,
} from './patterns'

describe('parsePattern', () => {
  describe('simple patterns', () => {
    it('should parse wildcard pattern *.ts', () => {
      const result = parsePattern('*.ts')
      expect(result).toEqual({
        pattern: '*.ts',
        isNegated: false,
        segments: ['*.ts'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse wildcard pattern src/*', () => {
      const result = parsePattern('src/*')
      expect(result).toEqual({
        pattern: 'src/*',
        isNegated: false,
        segments: ['src', '*'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse simple filename', () => {
      const result = parsePattern('package.json')
      expect(result).toEqual({
        pattern: 'package.json',
        isNegated: false,
        segments: ['package.json'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })
  })

  describe('nested patterns', () => {
    it('should parse double-star pattern src/**/*.ts', () => {
      const result = parsePattern('src/**/*.ts')
      expect(result).toEqual({
        pattern: 'src/**/*.ts',
        isNegated: false,
        segments: ['src', '**', '*.ts'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse multi-level pattern lib/utils/**/*.js', () => {
      const result = parsePattern('lib/utils/**/*.js')
      expect(result).toEqual({
        pattern: 'lib/utils/**/*.js',
        isNegated: false,
        segments: ['lib', 'utils', '**', '*.js'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse double-star only pattern **/*.md', () => {
      const result = parsePattern('**/*.md')
      expect(result).toEqual({
        pattern: '**/*.md',
        isNegated: false,
        segments: ['**', '*.md'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })
  })

  describe('directory patterns', () => {
    it('should parse directory pattern src/', () => {
      const result = parsePattern('src/')
      expect(result).toEqual({
        pattern: 'src/',
        isNegated: false,
        segments: ['src'],
        isDirectory: true,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse nested directory pattern src/lib/', () => {
      const result = parsePattern('src/lib/')
      expect(result).toEqual({
        pattern: 'src/lib/',
        isNegated: false,
        segments: ['src', 'lib'],
        isDirectory: true,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse directory with wildcard pattern src/*/test/', () => {
      const result = parsePattern('src/*/test/')
      expect(result).toEqual({
        pattern: 'src/*/test/',
        isNegated: false,
        segments: ['src', '*', 'test'],
        isDirectory: true,
        isRooted: false,
      } as ParsedPattern)
    })
  })

  describe('negation patterns', () => {
    it('should parse negated pattern !node_modules', () => {
      const result = parsePattern('!node_modules')
      expect(result).toEqual({
        pattern: '!node_modules',
        isNegated: true,
        segments: ['node_modules'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse negated directory pattern !node_modules/', () => {
      const result = parsePattern('!node_modules/')
      expect(result).toEqual({
        pattern: '!node_modules/',
        isNegated: true,
        segments: ['node_modules'],
        isDirectory: true,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse negated wildcard pattern !*.test.ts', () => {
      const result = parsePattern('!*.test.ts')
      expect(result).toEqual({
        pattern: '!*.test.ts',
        isNegated: true,
        segments: ['*.test.ts'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse negated nested pattern !src/**/*.spec.ts', () => {
      const result = parsePattern('!src/**/*.spec.ts')
      expect(result).toEqual({
        pattern: '!src/**/*.spec.ts',
        isNegated: true,
        segments: ['src', '**', '*.spec.ts'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })
  })

  describe('edge cases', () => {
    it('should throw on empty string', () => {
      expect(() => parsePattern('')).toThrow()
    })

    it('should parse single character pattern', () => {
      const result = parsePattern('*')
      expect(result).toEqual({
        pattern: '*',
        isNegated: false,
        segments: ['*'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse single directory slash', () => {
      const result = parsePattern('/')
      expect(result).toEqual({
        pattern: '/',
        isNegated: false,
        segments: [],
        isDirectory: true,
        isRooted: true,
      } as ParsedPattern)
    })

    it('should handle multiple consecutive slashes', () => {
      const result = parsePattern('src//lib')
      expect(result).toEqual({
        pattern: 'src//lib',
        isNegated: false,
        segments: ['src', 'lib'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should handle leading slash', () => {
      const result = parsePattern('/src/lib')
      expect(result).toEqual({
        pattern: '/src/lib',
        isNegated: false,
        segments: ['src', 'lib'],
        isDirectory: false,
        isRooted: true,
      } as ParsedPattern)
    })
  })

  describe('special characters', () => {
    it('should parse pattern with brackets [a-z]', () => {
      const result = parsePattern('file-[a-z].ts')
      expect(result).toEqual({
        pattern: 'file-[a-z].ts',
        isNegated: false,
        segments: ['file-[a-z].ts'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse pattern with braces {js,ts}', () => {
      const result = parsePattern('*.{js,ts}')
      expect(result).toEqual({
        pattern: '*.{js,ts}',
        isNegated: false,
        segments: ['*.{js,ts}'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse pattern with question mark', () => {
      const result = parsePattern('file?.ts')
      expect(result).toEqual({
        pattern: 'file?.ts',
        isNegated: false,
        segments: ['file?.ts'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })
  })

  describe('escaped characters', () => {
    it('should parse pattern with escaped wildcard', () => {
      const result = parsePattern('file\\*.ts')
      expect(result).toEqual({
        pattern: 'file\\*.ts',
        isNegated: false,
        segments: ['file\\*.ts'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should parse pattern with escaped exclamation', () => {
      const result = parsePattern('\\!important.txt')
      expect(result).toEqual({
        pattern: '\\!important.txt',
        isNegated: false,
        segments: ['\\!important.txt'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })
  })

  describe('validation', () => {
    it('should throw on pattern with only negation', () => {
      expect(() => parsePattern('!')).toThrow()
    })

    it('should throw on invalid double-star usage ***', () => {
      expect(() => parsePattern('src/***/lib')).toThrow()
    })

    it('should throw on whitespace-only pattern', () => {
      expect(() => parsePattern('   ')).toThrow()
    })
  })

  describe('normalization', () => {
    it('should normalize Windows-style paths', () => {
      const result = parsePattern('src\\lib\\file.ts')
      expect(result).toEqual({
        pattern: 'src\\lib\\file.ts',
        isNegated: false,
        segments: ['src', 'lib', 'file.ts'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })

    it('should normalize mixed separators', () => {
      const result = parsePattern('src\\lib/file.ts')
      expect(result).toEqual({
        pattern: 'src\\lib/file.ts',
        isNegated: false,
        segments: ['src', 'lib', 'file.ts'],
        isDirectory: false,
        isRooted: false,
      } as ParsedPattern)
    })
  })

  describe('rooted patterns (gitignore-style)', () => {
    it('should detect rooted pattern with leading slash', () => {
      const result = parsePattern('/foo')
      expect(result.isRooted).toBe(true)
      expect(result.segments).toEqual(['foo'])
    })

    it('should detect non-rooted pattern without leading slash', () => {
      const result = parsePattern('foo')
      expect(result.isRooted).toBe(false)
    })

    it('should not treat escaped backslash as rooted', () => {
      // \* is an escape sequence, not a path separator
      const result = parsePattern('\\*.ts')
      expect(result.isRooted).toBe(false)
      expect(result.segments).toEqual(['\\*.ts'])
    })

    it('should handle rooted negated patterns', () => {
      const result = parsePattern('!/important')
      expect(result.isNegated).toBe(true)
      expect(result.isRooted).toBe(true)
      expect(result.segments).toEqual(['important'])
    })

    it('should handle rooted directory patterns', () => {
      const result = parsePattern('/src/')
      expect(result.isRooted).toBe(true)
      expect(result.isDirectory).toBe(true)
      expect(result.segments).toEqual(['src'])
    })
  })
})

describe('parsePatterns (gitignore-style multi-line)', () => {
  it('should skip blank lines', () => {
    const input = `
*.ts

*.js
`
    const result = parsePatterns(input)
    expect(result).toHaveLength(2)
    expect(result[0].pattern).toBe('*.ts')
    expect(result[1].pattern).toBe('*.js')
  })

  it('should skip comment lines starting with #', () => {
    const input = `
# This is a comment
*.ts
# Another comment
*.js
`
    const result = parsePatterns(input)
    expect(result).toHaveLength(2)
    expect(result[0].pattern).toBe('*.ts')
    expect(result[1].pattern).toBe('*.js')
  })

  it('should handle escaped hash as literal', () => {
    const input = `
\\#important.txt
`
    const result = parsePatterns(input)
    expect(result).toHaveLength(1)
    expect(result[0].pattern).toBe('#important.txt')
  })

  it('should parse real gitignore-style content', () => {
    const input = `
# Build artifacts
dist/
build/

# Dependencies
node_modules/

# Environment
.env
.env.local

# Keep certain files
!dist/important.js
`
    const result = parsePatterns(input)
    expect(result).toHaveLength(6)
    expect(result[0].pattern).toBe('dist/')
    expect(result[0].isDirectory).toBe(true)
    expect(result[1].pattern).toBe('build/')
    expect(result[2].pattern).toBe('node_modules/')
    expect(result[3].pattern).toBe('.env')
    expect(result[4].pattern).toBe('.env.local')
    expect(result[5].pattern).toBe('!dist/important.js')
    expect(result[5].isNegated).toBe(true)
  })

  it('should handle Windows line endings (CRLF)', () => {
    const input = "*.ts\r\n*.js\r\n"
    const result = parsePatterns(input)
    expect(result).toHaveLength(2)
  })

  it('should trim whitespace from lines', () => {
    const input = `
   *.ts
   *.js
`
    const result = parsePatterns(input)
    expect(result).toHaveLength(2)
    expect(result[0].pattern).toBe('*.ts')
    expect(result[1].pattern).toBe('*.js')
  })

  it('should return empty array for empty input', () => {
    expect(parsePatterns('')).toEqual([])
    expect(parsePatterns('   ')).toEqual([])
    expect(parsePatterns('\n\n')).toEqual([])
  })

  it('should return empty array for comments-only input', () => {
    const input = `
# Comment 1
# Comment 2
`
    expect(parsePatterns(input)).toEqual([])
  })
})

describe('parsePatternsArray', () => {
  it('should parse array of pattern strings', () => {
    const lines = ['*.ts', '# comment', 'src/', '']
    const result = parsePatternsArray(lines)
    expect(result).toHaveLength(2)
    expect(result[0].pattern).toBe('*.ts')
    expect(result[1].pattern).toBe('src/')
  })
})

// =============================================================================
// RED Phase: matchPattern tests
// =============================================================================
// These tests are for a matchPattern(path, pattern) function that should be
// implemented to make them pass. The function takes a path and pattern string
// and returns a boolean indicating whether the path matches the pattern.
// =============================================================================

describe('matchPattern', () => {
  // ========================================
  // 1. Basic matching (5 tests)
  // ========================================
  describe('basic matching', () => {
    it('should return true for exact path match', () => {
      expect(matchPattern('foo.ts', 'foo.ts')).toBe(true)
    })

    it('should return false for non-matching path', () => {
      expect(matchPattern('foo.ts', 'bar.ts')).toBe(false)
    })

    it('should return true for path matching pattern with directory', () => {
      expect(matchPattern('src/foo.ts', 'src/foo.ts')).toBe(true)
    })

    it('should return false for path in different directory', () => {
      expect(matchPattern('src/foo.ts', 'lib/foo.ts')).toBe(false)
    })

    it('should be case sensitive by default', () => {
      expect(matchPattern('Foo.ts', 'foo.ts')).toBe(false)
      expect(matchPattern('FOO.TS', 'foo.ts')).toBe(false)
    })
  })

  // ========================================
  // 2. Single wildcard * (8 tests)
  // ========================================
  describe('single wildcard *', () => {
    it('should match any filename with extension pattern', () => {
      expect(matchPattern('foo.ts', '*.ts')).toBe(true)
      expect(matchPattern('bar.ts', '*.ts')).toBe(true)
      expect(matchPattern('my-file.ts', '*.ts')).toBe(true)
    })

    it('should not match wrong extension', () => {
      expect(matchPattern('foo.js', '*.ts')).toBe(false)
      expect(matchPattern('foo.tsx', '*.ts')).toBe(false)
    })

    it('should not match path with directory separator', () => {
      // * should not cross directory boundaries
      expect(matchPattern('src/foo.ts', '*.ts')).toBe(false)
      expect(matchPattern('a/b/c.ts', '*.ts')).toBe(false)
    })

    it('should match empty string for wildcard position', () => {
      expect(matchPattern('foo', 'foo*')).toBe(true)
      expect(matchPattern('bar', '*bar')).toBe(true)
    })

    it('should match single character', () => {
      expect(matchPattern('foo', 'f*o')).toBe(true)
      expect(matchPattern('x.ts', '*.ts')).toBe(true)
    })

    it('should match multiple characters', () => {
      expect(matchPattern('faaaao', 'f*o')).toBe(true)
      expect(matchPattern('fxyz123o', 'f*o')).toBe(true)
    })

    it('should handle multiple wildcards in pattern', () => {
      expect(matchPattern('foo.ts', '*.*')).toBe(true)
      expect(matchPattern('a.b', '*.*')).toBe(true)
      expect(matchPattern('a-b-c', '*-*-*')).toBe(true)
    })

    it('should match wildcard in directory position', () => {
      expect(matchPattern('src/foo.ts', 'src/*.ts')).toBe(true)
      expect(matchPattern('lib/bar.ts', '*/bar.ts')).toBe(true)
    })
  })

  // ========================================
  // 3. Globstar ** (10 tests)
  // ========================================
  describe('globstar **', () => {
    it('should match zero directories', () => {
      expect(matchPattern('foo.ts', '**/*.ts')).toBe(true)
      expect(matchPattern('package.json', '**/package.json')).toBe(true)
    })

    it('should match one directory level', () => {
      expect(matchPattern('src/foo.ts', '**/*.ts')).toBe(true)
      expect(matchPattern('src/foo.ts', '**/foo.ts')).toBe(true)
    })

    it('should match many directory levels', () => {
      expect(matchPattern('a/b/c/foo.ts', '**/*.ts')).toBe(true)
      expect(matchPattern('src/components/ui/button.ts', '**/*.ts')).toBe(true)
      expect(matchPattern('a/b/c/d/e/foo.ts', '**/foo.ts')).toBe(true)
    })

    it('should match at start of pattern', () => {
      expect(matchPattern('foo.ts', '**/foo.ts')).toBe(true)
      expect(matchPattern('a/foo.ts', '**/foo.ts')).toBe(true)
      expect(matchPattern('a/b/foo.ts', '**/foo.ts')).toBe(true)
    })

    it('should match at end of pattern', () => {
      expect(matchPattern('src/a', 'src/**')).toBe(true)
      expect(matchPattern('src/a/b', 'src/**')).toBe(true)
      expect(matchPattern('src/a/b/c/d.ts', 'src/**')).toBe(true)
    })

    it('should match in middle of pattern', () => {
      expect(matchPattern('src/foo.ts', 'src/**/foo.ts')).toBe(true)
      expect(matchPattern('src/a/foo.ts', 'src/**/foo.ts')).toBe(true)
      expect(matchPattern('src/a/b/foo.ts', 'src/**/foo.ts')).toBe(true)
      expect(matchPattern('src/a/b/c/d/foo.ts', 'src/**/foo.ts')).toBe(true)
    })

    it('should match standalone **', () => {
      expect(matchPattern('foo.ts', '**')).toBe(true)
      expect(matchPattern('src/foo.ts', '**')).toBe(true)
      expect(matchPattern('a/b/c/d/e/f', '**')).toBe(true)
    })

    it('should not match if final segment differs', () => {
      expect(matchPattern('bar.ts', '**/foo.ts')).toBe(false)
      expect(matchPattern('src/bar.ts', '**/foo.ts')).toBe(false)
    })

    it('should not match partial directory names', () => {
      expect(matchPattern('srcfoo/a.ts', 'src/**')).toBe(false)
      expect(matchPattern('mysrc/a.ts', '**/src/**')).toBe(false)
    })

    it('should handle multiple ** in pattern', () => {
      expect(matchPattern('src/foo.ts', '**/src/**/*.ts')).toBe(true)
      expect(matchPattern('a/src/b/c.ts', '**/src/**/*.ts')).toBe(true)
      expect(matchPattern('x/y/src/z/w/file.ts', '**/src/**/*.ts')).toBe(true)
    })
  })

  // ========================================
  // 4. Single char ? (5 tests)
  // ========================================
  describe('single char ?', () => {
    it('should match exactly one character', () => {
      expect(matchPattern('foo.ts', 'fo?.ts')).toBe(true)
      expect(matchPattern('fox.ts', 'fo?.ts')).toBe(true)
      expect(matchPattern('foo.ts', '?oo.ts')).toBe(true)
    })

    it('should not match zero characters', () => {
      expect(matchPattern('fo.ts', 'fo?.ts')).toBe(false)
      expect(matchPattern('foo.ts', '?foo.ts')).toBe(false)
    })

    it('should not match multiple characters', () => {
      expect(matchPattern('fooo.ts', 'fo?.ts')).toBe(false)
      expect(matchPattern('foab.ts', 'fo?.ts')).toBe(false)
    })

    it('should handle multiple ? in sequence', () => {
      expect(matchPattern('foo.ts', 'f??.ts')).toBe(true)
      expect(matchPattern('fab.ts', 'f??.ts')).toBe(true)
      expect(matchPattern('abc.ts', '???.ts')).toBe(true)
      expect(matchPattern('fo.ts', 'f??.ts')).toBe(false)
      expect(matchPattern('fooo.ts', 'f??.ts')).toBe(false)
    })

    it('should not match path separator', () => {
      expect(matchPattern('src/foo', 'src?foo')).toBe(false)
      expect(matchPattern('a/b/c', 'a?b?c')).toBe(false)
    })
  })

  // ========================================
  // 5. Character classes [abc] (8 tests)
  // ========================================
  describe('character classes [abc]', () => {
    it('should match any character in set', () => {
      expect(matchPattern('a.ts', '[abc].ts')).toBe(true)
      expect(matchPattern('b.ts', '[abc].ts')).toBe(true)
      expect(matchPattern('c.ts', '[abc].ts')).toBe(true)
    })

    it('should not match character outside set', () => {
      expect(matchPattern('d.ts', '[abc].ts')).toBe(false)
      expect(matchPattern('x.ts', '[abc].ts')).toBe(false)
    })

    it('should handle character ranges [a-z]', () => {
      expect(matchPattern('a.ts', '[a-z].ts')).toBe(true)
      expect(matchPattern('m.ts', '[a-z].ts')).toBe(true)
      expect(matchPattern('z.ts', '[a-z].ts')).toBe(true)
      expect(matchPattern('5.ts', '[0-9].ts')).toBe(true)
      expect(matchPattern('M.ts', '[A-Z].ts')).toBe(true)
    })

    it('should handle negation with !', () => {
      expect(matchPattern('d.ts', '[!abc].ts')).toBe(true)
      expect(matchPattern('x.ts', '[!abc].ts')).toBe(true)
      expect(matchPattern('a.ts', '[!abc].ts')).toBe(false)
      expect(matchPattern('b.ts', '[!abc].ts')).toBe(false)
    })

    it('should handle negation with ^', () => {
      expect(matchPattern('d.ts', '[^abc].ts')).toBe(true)
      expect(matchPattern('x.ts', '[^abc].ts')).toBe(true)
      expect(matchPattern('a.ts', '[^abc].ts')).toBe(false)
      expect(matchPattern('c.ts', '[^abc].ts')).toBe(false)
    })

    it('should handle multiple character classes', () => {
      expect(matchPattern('ad.ts', '[abc][def].ts')).toBe(true)
      expect(matchPattern('bf.ts', '[abc][def].ts')).toBe(true)
      expect(matchPattern('ce.ts', '[abc][def].ts')).toBe(true)
      expect(matchPattern('ax.ts', '[abc][def].ts')).toBe(false)
    })

    it('should match special glob chars inside class literally', () => {
      expect(matchPattern('*.ts', '[*?].ts')).toBe(true)
      expect(matchPattern('?.ts', '[*?].ts')).toBe(true)
      expect(matchPattern('a.ts', '[*?].ts')).toBe(false)
    })

    it('should handle hyphen at boundary as literal', () => {
      expect(matchPattern('-.ts', '[-abc].ts')).toBe(true)
      expect(matchPattern('-.ts', '[abc-].ts')).toBe(true)
    })
  })

  // ========================================
  // 6. Brace expansion {a,b,c} (7 tests)
  // ========================================
  describe('brace expansion {a,b,c}', () => {
    it('should match first alternative', () => {
      expect(matchPattern('foo.ts', '*.{ts,js}')).toBe(true)
    })

    it('should match second alternative', () => {
      expect(matchPattern('foo.js', '*.{ts,js}')).toBe(true)
    })

    it('should not match non-alternatives', () => {
      expect(matchPattern('foo.py', '*.{ts,js}')).toBe(false)
    })

    it('should handle three or more alternatives', () => {
      expect(matchPattern('foo.ts', '*.{ts,tsx,js}')).toBe(true)
      expect(matchPattern('foo.tsx', '*.{ts,tsx,js}')).toBe(true)
      expect(matchPattern('foo.js', '*.{ts,tsx,js}')).toBe(true)
      expect(matchPattern('foo.jsx', '*.{ts,tsx,js}')).toBe(false)
    })

    it('should handle alternatives in path segment', () => {
      expect(matchPattern('src/foo.ts', '{src,lib}/*.ts')).toBe(true)
      expect(matchPattern('lib/foo.ts', '{src,lib}/*.ts')).toBe(true)
      expect(matchPattern('test/foo.ts', '{src,lib}/*.ts')).toBe(false)
    })

    it('should handle empty alternative', () => {
      expect(matchPattern('foo', 'foo{,.txt}')).toBe(true)
      expect(matchPattern('foo.txt', 'foo{,.txt}')).toBe(true)
      expect(matchPattern('foo.js', 'foo{,.txt}')).toBe(false)
    })

    it('should handle multiple brace groups', () => {
      expect(matchPattern('src/a.ts', '{src,lib}/{a,b}.ts')).toBe(true)
      expect(matchPattern('src/b.ts', '{src,lib}/{a,b}.ts')).toBe(true)
      expect(matchPattern('lib/a.ts', '{src,lib}/{a,b}.ts')).toBe(true)
      expect(matchPattern('lib/b.ts', '{src,lib}/{a,b}.ts')).toBe(true)
      expect(matchPattern('test/a.ts', '{src,lib}/{a,b}.ts')).toBe(false)
    })
  })

  // ========================================
  // 7. Escape sequences (6 tests)
  // ========================================
  describe('escape sequences', () => {
    it('should match literal * when escaped', () => {
      expect(matchPattern('file*.ts', 'file\\*.ts')).toBe(true)
      expect(matchPattern('fileX.ts', 'file\\*.ts')).toBe(false)
    })

    it('should match literal ? when escaped', () => {
      expect(matchPattern('file?.ts', 'file\\?.ts')).toBe(true)
      expect(matchPattern('fileX.ts', 'file\\?.ts')).toBe(false)
    })

    it('should match literal [ when escaped', () => {
      expect(matchPattern('file[1].ts', 'file\\[1\\].ts')).toBe(true)
      expect(matchPattern('file1.ts', 'file\\[1\\].ts')).toBe(false)
    })

    it('should match literal { when escaped', () => {
      expect(matchPattern('file{a,b}.ts', 'file\\{a,b\\}.ts')).toBe(true)
      expect(matchPattern('filea.ts', 'file\\{a,b\\}.ts')).toBe(false)
    })

    it('should match literal ! when escaped at start', () => {
      expect(matchPattern('!important.txt', '\\!important.txt')).toBe(true)
      expect(matchPattern('important.txt', '\\!important.txt')).toBe(false)
    })

    it('should handle escape in middle of pattern', () => {
      expect(matchPattern('a*b.ts', 'a\\*b.ts')).toBe(true)
      expect(matchPattern('aXb.ts', 'a\\*b.ts')).toBe(false)
      expect(matchPattern('a?b.ts', 'a\\?b.ts')).toBe(true)
      expect(matchPattern('aXb.ts', 'a\\?b.ts')).toBe(false)
    })
  })

  // ========================================
  // 8. Edge cases (5 tests)
  // ========================================
  describe('edge cases', () => {
    it('should return false for empty path', () => {
      expect(matchPattern('', '*.ts')).toBe(false)
      expect(matchPattern('', '**')).toBe(false)
    })

    it('should throw for empty pattern', () => {
      expect(() => matchPattern('foo.ts', '')).toThrow()
    })

    it('should handle path with trailing slash (directory)', () => {
      expect(matchPattern('src/', 'src/')).toBe(true)
      expect(matchPattern('src/lib/', 'src/lib/')).toBe(true)
    })

    it('should handle dotfiles', () => {
      // By default, * should not match dotfiles at start
      expect(matchPattern('.hidden', '*')).toBe(false)
      expect(matchPattern('.gitignore', '*.gitignore')).toBe(false)
      // Explicit dotfile pattern should match
      expect(matchPattern('.hidden', '.*')).toBe(true)
      expect(matchPattern('.gitignore', '.gitignore')).toBe(true)
    })

    it('should handle very deep paths', () => {
      const deepPath = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p.ts'
      expect(matchPattern(deepPath, '**/*.ts')).toBe(true)
      expect(matchPattern(deepPath, 'a/**/*.ts')).toBe(true)
      expect(matchPattern(deepPath, 'a/**/p.ts')).toBe(true)
    })
  })
})

// =============================================================================
// RED Phase: createPatternMatcher tests
// =============================================================================
// Tests for a factory function that creates a reusable matcher from a pattern.
// =============================================================================

describe('createPatternMatcher', () => {
  describe('basic usage', () => {
    it('should create a matcher function from pattern', () => {
      const matcher = createPatternMatcher('*.ts')
      expect(typeof matcher).toBe('function')
    })

    it('should return true for matching paths', () => {
      const matcher = createPatternMatcher('src/**/*.ts')
      expect(matcher('src/index.ts')).toBe(true)
      expect(matcher('src/utils/helper.ts')).toBe(true)
    })

    it('should return false for non-matching paths', () => {
      const matcher = createPatternMatcher('src/**/*.ts')
      expect(matcher('lib/index.ts')).toBe(false)
      expect(matcher('src/index.js')).toBe(false)
    })

    it('should throw for empty pattern', () => {
      expect(() => createPatternMatcher('')).toThrow()
    })
  })

  describe('reusability', () => {
    it('should match multiple paths efficiently', () => {
      const isTypeScript = createPatternMatcher('**/*.ts')
      const paths = [
        'index.ts',
        'src/main.ts',
        'lib/utils/helper.ts',
        'readme.md',
        'package.json',
      ]
      const matches = paths.filter(isTypeScript)
      expect(matches).toEqual(['index.ts', 'src/main.ts', 'lib/utils/helper.ts'])
    })

    it('should handle complex patterns', () => {
      const matcher = createPatternMatcher('src/**/test/**/*.{spec,test}.ts')
      expect(matcher('src/test/foo.spec.ts')).toBe(true)
      expect(matcher('src/components/test/button.test.ts')).toBe(true)
      expect(matcher('src/utils/test/a/b/c.spec.ts')).toBe(true)
      expect(matcher('src/foo.ts')).toBe(false)
    })
  })

  describe('negation patterns', () => {
    it('should invert match for negated patterns', () => {
      const notTest = createPatternMatcher('!*.test.ts')
      expect(notTest('foo.test.ts')).toBe(false)
      expect(notTest('foo.ts')).toBe(true)
    })

    it('should handle double negation', () => {
      const matcher = createPatternMatcher('!!*.ts')
      expect(matcher('foo.ts')).toBe(true)
      expect(matcher('foo.js')).toBe(false)
    })
  })
})

// =============================================================================
// Cache Statistics Tests
// =============================================================================

describe('Pattern Cache Statistics', () => {
  beforeEach(() => {
    // Clear cache and reset stats before each test
    clearPatternCache()
  })

  describe('getPatternCacheStats', () => {
    it('should return initial stats after clearing', () => {
      const stats = getPatternCacheStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.size).toBe(0)
      expect(stats.hitRate).toBe(0)
    })

    it('should track cache misses on first pattern compilation', () => {
      matchPattern('foo.ts', '*.ts')
      const stats = getPatternCacheStats()
      expect(stats.misses).toBe(1)
      expect(stats.size).toBe(1)
    })

    it('should track cache hits on repeated pattern usage', () => {
      // First use - cache miss
      matchPattern('foo.ts', '*.ts')

      // Second use - cache hit
      matchPattern('bar.ts', '*.ts')

      const stats = getPatternCacheStats()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
      expect(stats.hitRate).toBe(0.5)
    })

    it('should track multiple patterns correctly', () => {
      // Use three different patterns
      matchPattern('foo.ts', '*.ts')
      matchPattern('foo.js', '*.js')
      matchPattern('foo.md', '*.md')

      // Reuse each pattern
      matchPattern('bar.ts', '*.ts')
      matchPattern('bar.js', '*.js')
      matchPattern('bar.md', '*.md')

      const stats = getPatternCacheStats()
      expect(stats.misses).toBe(3)  // 3 unique patterns
      expect(stats.hits).toBe(3)    // 3 reuses
      expect(stats.size).toBe(3)    // 3 cached patterns
      expect(stats.hitRate).toBe(0.5) // 3 hits / 6 total
    })

    it('should have capacity information', () => {
      const stats = getPatternCacheStats()
      expect(stats.capacity).toBeGreaterThan(0)
    })
  })

  describe('resetPatternCacheStats', () => {
    it('should reset hit and miss counters', () => {
      // Generate some stats
      matchPattern('foo.ts', '*.ts')
      matchPattern('bar.ts', '*.ts')

      // Reset stats
      resetPatternCacheStats()

      const stats = getPatternCacheStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      // Cache entries should still exist
      expect(stats.size).toBe(1)
    })
  })

  describe('clearPatternCache', () => {
    it('should clear all cached patterns and stats', () => {
      // Generate some cache entries
      matchPattern('foo.ts', '*.ts')
      matchPattern('foo.js', '*.js')

      // Clear cache
      clearPatternCache()

      const stats = getPatternCacheStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.size).toBe(0)
    })

    it('should cause new cache misses after clearing', () => {
      // First use
      matchPattern('foo.ts', '*.ts')

      // Clear
      clearPatternCache()

      // Second use - should be a miss again
      matchPattern('bar.ts', '*.ts')

      const stats = getPatternCacheStats()
      expect(stats.misses).toBe(1)
      expect(stats.hits).toBe(0)
    })
  })
})

// =============================================================================
// LazyPatternMatcher Tests
// =============================================================================

describe('LazyPatternMatcher', () => {
  beforeEach(() => {
    clearPatternCache()
  })

  describe('lazy compilation', () => {
    it('should not compile pattern on construction', () => {
      const initialStats = getPatternCacheStats()
      const initialMisses = initialStats.misses

      const matcher = new LazyPatternMatcher('*.ts')

      expect(matcher.isCompiled).toBe(false)
      // No new cache misses should have occurred
      const afterStats = getPatternCacheStats()
      expect(afterStats.misses).toBe(initialMisses)
    })

    it('should compile pattern on first matches() call', () => {
      const matcher = new LazyPatternMatcher('*.ts')

      expect(matcher.isCompiled).toBe(false)
      matcher.matches('foo.ts')
      expect(matcher.isCompiled).toBe(true)
    })

    it('should reuse compiled pattern on subsequent calls', () => {
      const matcher = new LazyPatternMatcher('*.ts')

      // First call compiles
      matcher.matches('foo.ts')
      const statsAfterFirst = getPatternCacheStats()

      // Second call should use cached regex
      matcher.matches('bar.ts')
      matcher.matches('baz.ts')

      // Cache stats should show the pattern was compiled only once
      // (subsequent calls use the instance's cached regex, not the global cache)
      expect(matcher.isCompiled).toBe(true)
    })
  })

  describe('matching behavior', () => {
    it('should return true for matching paths', () => {
      const matcher = new LazyPatternMatcher('src/**/*.ts')
      expect(matcher.matches('src/index.ts')).toBe(true)
      expect(matcher.matches('src/utils/helper.ts')).toBe(true)
    })

    it('should return false for non-matching paths', () => {
      const matcher = new LazyPatternMatcher('src/**/*.ts')
      expect(matcher.matches('lib/index.ts')).toBe(false)
      expect(matcher.matches('src/index.js')).toBe(false)
    })

    it('should return false for empty path', () => {
      const matcher = new LazyPatternMatcher('*.ts')
      expect(matcher.matches('')).toBe(false)
      // Empty path should not trigger compilation
      expect(matcher.isCompiled).toBe(false)
    })

    it('should handle negated patterns', () => {
      const matcher = new LazyPatternMatcher('!*.test.ts')
      expect(matcher.matches('foo.test.ts')).toBe(false)
      expect(matcher.matches('foo.ts')).toBe(true)
    })

    it('should handle double negation', () => {
      const matcher = new LazyPatternMatcher('!!*.ts')
      expect(matcher.matches('foo.ts')).toBe(true)
      expect(matcher.matches('foo.js')).toBe(false)
    })
  })

  describe('compile() method', () => {
    it('should force immediate compilation', () => {
      const matcher = new LazyPatternMatcher('*.ts')

      expect(matcher.isCompiled).toBe(false)
      matcher.compile()
      expect(matcher.isCompiled).toBe(true)
    })

    it('should be idempotent', () => {
      const matcher = new LazyPatternMatcher('*.ts')

      matcher.compile()
      matcher.compile()
      matcher.compile()

      expect(matcher.isCompiled).toBe(true)
    })
  })

  describe('originalPattern getter', () => {
    it('should return the original pattern string', () => {
      const matcher = new LazyPatternMatcher('src/**/*.ts')
      expect(matcher.originalPattern).toBe('src/**/*.ts')
    })

    it('should preserve negation in original pattern', () => {
      const matcher = new LazyPatternMatcher('!*.test.ts')
      expect(matcher.originalPattern).toBe('!*.test.ts')
    })
  })

  describe('error handling', () => {
    it('should throw for empty pattern', () => {
      expect(() => new LazyPatternMatcher('')).toThrow('Pattern cannot be empty')
    })
  })
})
