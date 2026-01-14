/**
 * Comprehensive tests for path utilities - POSIX-compliant behavior
 *
 * RED phase: These tests define the expected behavior for path manipulation.
 * Functions under test:
 * - normalize(path)
 * - join(...paths)
 * - resolve(...paths)
 * - dirname(path)
 * - basename(path, ext?)
 * - extname(path)
 * - parse(path)
 * - format(pathObject)
 * - isAbsolute(path)
 * - relative(from, to)
 * - sep, delimiter constants
 */

import { describe, it, expect } from 'vitest'
import {
  normalize,
  join,
  resolve,
  dirname,
  basename,
  extname,
  parse,
  format,
  isAbsolute,
  relative,
  sep,
  delimiter,
  type ParsedPath,
} from '../../core/path'

// ============================================================================
// PATH NORMALIZATION
// ============================================================================

describe('normalize', () => {
  describe('empty and edge cases', () => {
    it('returns "." for empty string', () => {
      // Node.js path.normalize('') returns '.'
      // Current implementation returns '' - this test expects Node.js behavior
      expect(normalize('')).toBe('.')
    })

    it('returns "." for single dot', () => {
      expect(normalize('.')).toBe('.')
    })

    it('returns ".." for double dot', () => {
      expect(normalize('..')).toBe('..')
    })

    it('returns "/" for root', () => {
      expect(normalize('/')).toBe('/')
    })

    it('handles only dots', () => {
      expect(normalize('././.')).toBe('.')
      expect(normalize('../..')).toBe('../..')
      expect(normalize('./../..')).toBe('../..')
    })
  })

  describe('duplicate slashes', () => {
    it('collapses double slashes to single', () => {
      expect(normalize('//foo')).toBe('/foo')
      expect(normalize('/foo//bar')).toBe('/foo/bar')
      expect(normalize('foo//bar')).toBe('foo/bar')
    })

    it('collapses triple slashes', () => {
      expect(normalize('///foo')).toBe('/foo')
      expect(normalize('/foo///bar')).toBe('/foo/bar')
    })

    it('collapses many consecutive slashes', () => {
      expect(normalize('/////')).toBe('/')
      expect(normalize('/foo/////bar')).toBe('/foo/bar')
      expect(normalize('foo/////bar/////baz')).toBe('foo/bar/baz')
    })

    it('handles slashes in various positions', () => {
      expect(normalize('//foo//bar//')).toBe('/foo/bar')
      expect(normalize('foo//bar//')).toBe('foo/bar')
    })
  })

  describe('resolving . (current directory)', () => {
    it('removes single . in path', () => {
      expect(normalize('/foo/./bar')).toBe('/foo/bar')
      expect(normalize('./foo')).toBe('foo')
      expect(normalize('foo/.')).toBe('foo')
    })

    it('removes multiple . segments', () => {
      expect(normalize('/./foo/./bar/.')).toBe('/foo/bar')
      expect(normalize('./././foo')).toBe('foo')
    })

    it('handles . with trailing slash', () => {
      expect(normalize('./')).toBe('.')
      expect(normalize('/foo/./')).toBe('/foo')
    })

    it('handles leading ./', () => {
      expect(normalize('./foo/bar')).toBe('foo/bar')
      expect(normalize('./foo/./bar')).toBe('foo/bar')
    })
  })

  describe('resolving .. (parent directory)', () => {
    it('resolves .. in absolute paths', () => {
      expect(normalize('/foo/bar/../baz')).toBe('/foo/baz')
      expect(normalize('/foo/../bar')).toBe('/bar')
      expect(normalize('/foo/bar/baz/../../qux')).toBe('/foo/qux')
    })

    it('resolves .. at root - cannot go above root', () => {
      expect(normalize('/..')).toBe('/')
      expect(normalize('/foo/../..')).toBe('/')
      expect(normalize('/foo/../../..')).toBe('/')
      expect(normalize('/../foo')).toBe('/foo')
    })

    it('preserves leading .. in relative paths', () => {
      expect(normalize('../foo')).toBe('../foo')
      expect(normalize('../../foo')).toBe('../../foo')
      expect(normalize('../foo/../bar')).toBe('../bar')
    })

    it('accumulates .. when going above start in relative paths', () => {
      expect(normalize('foo/../..')).toBe('..')
      expect(normalize('foo/../../bar')).toBe('../bar')
      expect(normalize('foo/bar/../../../baz')).toBe('../baz')
    })

    it('handles complex .. sequences', () => {
      expect(normalize('/a/b/c/../../d/../e')).toBe('/a/e')
      expect(normalize('a/b/c/../../d/../e')).toBe('a/e')
    })
  })

  describe('trailing slashes', () => {
    it('removes trailing slash from absolute path', () => {
      expect(normalize('/foo/')).toBe('/foo')
      expect(normalize('/foo/bar/')).toBe('/foo/bar')
    })

    it('removes trailing slash from relative path', () => {
      expect(normalize('foo/')).toBe('foo')
      expect(normalize('foo/bar/')).toBe('foo/bar')
    })

    it('preserves root when path is only slashes', () => {
      expect(normalize('//')).toBe('/')
      expect(normalize('///')).toBe('/')
    })

    it('removes multiple trailing slashes', () => {
      expect(normalize('/foo//')).toBe('/foo')
      expect(normalize('/foo///')).toBe('/foo')
      expect(normalize('foo//')).toBe('foo')
    })
  })

  describe('mixed scenarios', () => {
    it('handles . and .. together', () => {
      expect(normalize('/foo/./bar/../baz')).toBe('/foo/baz')
      expect(normalize('./foo/../bar/./baz')).toBe('bar/baz')
    })

    it('handles slashes with dots', () => {
      expect(normalize('//foo//.//bar//..//baz')).toBe('/foo/baz')
    })

    it('handles complex real-world paths', () => {
      expect(normalize('/home/user/../admin/./config//settings.json')).toBe('/home/admin/config/settings.json')
      expect(normalize('./src/../lib/./utils.ts')).toBe('lib/utils.ts')
    })
  })

  describe('absolute vs relative preservation', () => {
    it('preserves absolute path nature', () => {
      expect(normalize('/foo')).toBe('/foo')
      expect(normalize('/foo/bar')).toBe('/foo/bar')
      expect(normalize('/foo/./bar')).toBe('/foo/bar')
    })

    it('preserves relative path nature', () => {
      expect(normalize('foo')).toBe('foo')
      expect(normalize('foo/bar')).toBe('foo/bar')
      expect(normalize('./foo/bar')).toBe('foo/bar')
    })
  })
})

// ============================================================================
// PATH OPERATIONS
// ============================================================================

describe('join', () => {
  describe('basic joining', () => {
    it('joins two segments', () => {
      expect(join('foo', 'bar')).toBe('foo/bar')
    })

    it('joins multiple segments', () => {
      expect(join('foo', 'bar', 'baz')).toBe('foo/bar/baz')
    })

    it('joins absolute path with relative', () => {
      expect(join('/foo', 'bar')).toBe('/foo/bar')
      expect(join('/foo', 'bar', 'baz')).toBe('/foo/bar/baz')
    })
  })

  describe('empty segments', () => {
    it('returns "." for no arguments', () => {
      expect(join()).toBe('.')
    })

    it('filters empty strings', () => {
      expect(join('', 'foo')).toBe('foo')
      expect(join('foo', '')).toBe('foo')
      expect(join('', 'foo', '')).toBe('foo')
      expect(join('foo', '', 'bar')).toBe('foo/bar')
    })

    it('returns "." when all segments are empty', () => {
      expect(join('', '')).toBe('.')
      expect(join('', '', '')).toBe('.')
    })
  })

  describe('leading and trailing slashes', () => {
    it('strips leading slashes from non-first segments', () => {
      expect(join('/foo', '/bar')).toBe('/foo/bar')
      expect(join('foo', '/bar')).toBe('foo/bar')
    })

    it('handles trailing slashes', () => {
      expect(join('foo/', 'bar')).toBe('foo/bar')
      expect(join('foo/', 'bar/')).toBe('foo/bar')
    })

    it('handles multiple slashes in segments', () => {
      expect(join('foo//', '//bar')).toBe('foo/bar')
    })
  })

  describe('dot handling', () => {
    it('resolves . in joined path', () => {
      expect(join('foo', '.', 'bar')).toBe('foo/bar')
      expect(join('.', 'foo', 'bar')).toBe('foo/bar')
    })

    it('resolves .. in joined path', () => {
      expect(join('foo', '..', 'bar')).toBe('bar')
      expect(join('foo', 'bar', '..', 'baz')).toBe('foo/baz')
    })

    it('handles complex dot sequences', () => {
      expect(join('foo', './bar', '../baz')).toBe('foo/baz')
      expect(join('/foo', 'bar', '..', 'baz', '.')).toBe('/foo/baz')
    })
  })

  describe('single segment', () => {
    it('returns normalized single segment', () => {
      expect(join('foo')).toBe('foo')
      expect(join('/foo')).toBe('/foo')
      expect(join('./foo')).toBe('foo')
    })
  })

  describe('edge cases', () => {
    it('handles joining with root', () => {
      expect(join('/', 'foo')).toBe('/foo')
      expect(join('/', 'foo', 'bar')).toBe('/foo/bar')
    })

    it('handles joining with .', () => {
      expect(join('.', '.')).toBe('.')
      expect(join('.', 'foo')).toBe('foo')
    })

    it('handles joining with ..', () => {
      expect(join('..', 'foo')).toBe('../foo')
      expect(join('foo', '..')).toBe('.')
    })
  })
})

describe('resolve', () => {
  describe('basic resolution', () => {
    it('resolves single segment to absolute path', () => {
      expect(resolve('foo')).toBe('/foo')
    })

    it('resolves multiple segments', () => {
      expect(resolve('/foo', 'bar', 'baz')).toBe('/foo/bar/baz')
    })

    it('returns "/" for no arguments', () => {
      expect(resolve()).toBe('/')
    })
  })

  describe('absolute path overrides', () => {
    it('later absolute path overrides earlier', () => {
      expect(resolve('/foo', '/bar')).toBe('/bar')
      expect(resolve('/foo', 'baz', '/bar')).toBe('/bar')
      expect(resolve('/foo', '/bar', 'baz')).toBe('/bar/baz')
    })

    it('first absolute path sets the base', () => {
      expect(resolve('/foo', 'bar')).toBe('/foo/bar')
    })
  })

  describe('dot resolution', () => {
    it('resolves . segments', () => {
      expect(resolve('/foo', '.', 'bar')).toBe('/foo/bar')
      expect(resolve('/foo', 'bar', '.')).toBe('/foo/bar')
    })

    it('resolves .. segments', () => {
      expect(resolve('/foo/bar', '..')).toBe('/foo')
      expect(resolve('/foo/bar', '..', 'baz')).toBe('/foo/baz')
      expect(resolve('/foo/bar/baz', '..', '..', 'qux')).toBe('/foo/qux')
    })

    it('stops at root for excessive ..', () => {
      expect(resolve('/foo', '..', '..', '..', 'bar')).toBe('/bar')
      expect(resolve('/', '..')).toBe('/')
    })
  })

  describe('relative path resolution', () => {
    it('resolves relative paths from root', () => {
      expect(resolve('foo', 'bar')).toBe('/foo/bar')
    })

    it('handles leading .. in relative paths', () => {
      expect(resolve('..', 'foo')).toBe('/foo')
    })
  })

  describe('complex scenarios', () => {
    it('handles mixed . and ..', () => {
      expect(resolve('/foo', 'bar', '.', '..', 'baz')).toBe('/foo/baz')
    })

    it('normalizes result', () => {
      expect(resolve('/foo//bar', './/baz')).toBe('/foo/bar/baz')
    })
  })
})

describe('dirname', () => {
  describe('basic directory extraction', () => {
    it('extracts directory from file path', () => {
      expect(dirname('/foo/bar/baz.txt')).toBe('/foo/bar')
    })

    it('extracts directory from directory path', () => {
      expect(dirname('/foo/bar/baz')).toBe('/foo/bar')
    })

    it('handles nested directories', () => {
      expect(dirname('/a/b/c/d/e')).toBe('/a/b/c/d')
    })
  })

  describe('root and empty paths', () => {
    it('returns "/" for root', () => {
      expect(dirname('/')).toBe('/')
    })

    it('returns "." for empty string', () => {
      expect(dirname('')).toBe('.')
    })

    it('returns "/" for direct children of root', () => {
      expect(dirname('/foo')).toBe('/')
      expect(dirname('/bar.txt')).toBe('/')
    })
  })

  describe('relative paths', () => {
    it('extracts directory from relative path', () => {
      expect(dirname('foo/bar/baz')).toBe('foo/bar')
      expect(dirname('foo/bar')).toBe('foo')
    })

    it('returns "." for filename only', () => {
      expect(dirname('foo')).toBe('.')
      expect(dirname('file.txt')).toBe('.')
    })

    it('handles relative path with single directory', () => {
      expect(dirname('foo/bar')).toBe('foo')
    })
  })

  describe('trailing slashes', () => {
    it('ignores trailing slash', () => {
      expect(dirname('/foo/bar/')).toBe('/foo')
      expect(dirname('/foo/')).toBe('/')
      expect(dirname('foo/')).toBe('.')
    })

    it('ignores multiple trailing slashes', () => {
      expect(dirname('/foo/bar//')).toBe('/foo')
      expect(dirname('/foo/bar///')).toBe('/foo')
    })
  })

  describe('edge cases', () => {
    it('handles . path', () => {
      expect(dirname('.')).toBe('.')
    })

    it('handles .. path', () => {
      expect(dirname('..')).toBe('.')
    })

    it('handles ./relative paths', () => {
      expect(dirname('./foo')).toBe('.')
      expect(dirname('./foo/bar')).toBe('./foo')
    })

    it('handles ../relative paths', () => {
      expect(dirname('../foo')).toBe('..')
      expect(dirname('../foo/bar')).toBe('../foo')
    })
  })
})

describe('basename', () => {
  describe('basic filename extraction', () => {
    it('extracts filename from path', () => {
      expect(basename('/foo/bar/baz.txt')).toBe('baz.txt')
    })

    it('extracts filename from directory path', () => {
      expect(basename('/foo/bar/baz')).toBe('baz')
    })

    it('handles path without directory', () => {
      expect(basename('file.txt')).toBe('file.txt')
      expect(basename('foo')).toBe('foo')
    })
  })

  describe('extension removal', () => {
    it('removes matching extension', () => {
      expect(basename('/foo/bar.txt', '.txt')).toBe('bar')
      expect(basename('file.js', '.js')).toBe('file')
    })

    it('does not remove non-matching extension', () => {
      expect(basename('/foo/bar.txt', '.md')).toBe('bar.txt')
      expect(basename('file.ts', '.js')).toBe('file.ts')
    })

    it('removes partial extension match at end', () => {
      expect(basename('file.test.ts', '.ts')).toBe('file.test')
    })

    it('handles extension without leading dot', () => {
      expect(basename('file.txt', 'txt')).toBe('file.')
      expect(basename('file.txt', 'xt')).toBe('file.t')
    })

    it('does not remove if extension is the entire filename', () => {
      expect(basename('.txt', '.txt')).toBe('.txt')
    })
  })

  describe('empty and root paths', () => {
    it('returns empty string for root', () => {
      expect(basename('/')).toBe('')
    })

    it('returns empty string for empty path', () => {
      expect(basename('')).toBe('')
    })
  })

  describe('trailing slashes', () => {
    it('ignores trailing slash', () => {
      expect(basename('/foo/bar/')).toBe('bar')
      expect(basename('foo/')).toBe('foo')
    })

    it('ignores multiple trailing slashes', () => {
      expect(basename('/foo/bar//')).toBe('bar')
      expect(basename('/foo/bar///')).toBe('bar')
    })
  })

  describe('edge cases', () => {
    it('handles . path', () => {
      expect(basename('.')).toBe('.')
    })

    it('handles .. path', () => {
      expect(basename('..')).toBe('..')
    })

    it('handles dotfiles', () => {
      expect(basename('/foo/.gitignore')).toBe('.gitignore')
      expect(basename('.bashrc')).toBe('.bashrc')
    })

    it('handles files with multiple dots', () => {
      expect(basename('/foo/bar.test.ts')).toBe('bar.test.ts')
      expect(basename('archive.tar.gz', '.gz')).toBe('archive.tar')
    })
  })
})

describe('extname', () => {
  describe('basic extension extraction', () => {
    it('extracts extension from filename', () => {
      expect(extname('file.txt')).toBe('.txt')
      expect(extname('file.js')).toBe('.js')
      expect(extname('file.ts')).toBe('.ts')
    })

    it('extracts extension from path', () => {
      expect(extname('/foo/bar/baz.txt')).toBe('.txt')
      expect(extname('foo/bar.json')).toBe('.json')
    })
  })

  describe('multiple dots in filename', () => {
    it('returns last extension only', () => {
      expect(extname('file.test.ts')).toBe('.ts')
      expect(extname('archive.tar.gz')).toBe('.gz')
      expect(extname('a.b.c.d.e')).toBe('.e')
    })
  })

  describe('no extension', () => {
    it('returns empty string for no extension', () => {
      expect(extname('file')).toBe('')
      expect(extname('/foo/bar/baz')).toBe('')
    })

    it('returns empty string when dot is first character', () => {
      expect(extname('.gitignore')).toBe('')
      expect(extname('.bashrc')).toBe('')
      expect(extname('/home/user/.profile')).toBe('')
    })

    it('returns empty string for directory paths', () => {
      expect(extname('/foo/bar/')).toBe('')
    })
  })

  describe('edge cases', () => {
    it('returns empty string for empty path', () => {
      expect(extname('')).toBe('')
    })

    it('returns empty string for root', () => {
      expect(extname('/')).toBe('')
    })

    it('returns empty string for .', () => {
      expect(extname('.')).toBe('')
    })

    it('returns empty string for ..', () => {
      expect(extname('..')).toBe('')
    })

    it('handles dotfile with extension', () => {
      expect(extname('.gitignore.bak')).toBe('.bak')
      expect(extname('.file.txt')).toBe('.txt')
    })

    it('handles trailing dot', () => {
      expect(extname('file.')).toBe('.')
    })

    it('handles double dot in middle', () => {
      expect(extname('file..txt')).toBe('.txt')
    })
  })
})

describe('parse', () => {
  describe('absolute paths', () => {
    it('parses absolute path with extension', () => {
      const result = parse('/home/user/file.txt')
      expect(result).toEqual({
        root: '/',
        dir: '/home/user',
        base: 'file.txt',
        ext: '.txt',
        name: 'file',
      })
    })

    it('parses absolute path without extension', () => {
      const result = parse('/home/user/config')
      expect(result).toEqual({
        root: '/',
        dir: '/home/user',
        base: 'config',
        ext: '',
        name: 'config',
      })
    })

    it('parses root path', () => {
      const result = parse('/')
      expect(result).toEqual({
        root: '/',
        dir: '/',
        base: '',
        ext: '',
        name: '',
      })
    })

    it('parses direct child of root', () => {
      const result = parse('/file.txt')
      expect(result).toEqual({
        root: '/',
        dir: '/',
        base: 'file.txt',
        ext: '.txt',
        name: 'file',
      })
    })
  })

  describe('relative paths', () => {
    it('parses relative path with extension', () => {
      const result = parse('foo/bar/baz.js')
      expect(result).toEqual({
        root: '',
        dir: 'foo/bar',
        base: 'baz.js',
        ext: '.js',
        name: 'baz',
      })
    })

    it('parses relative path without extension', () => {
      const result = parse('foo/bar')
      expect(result).toEqual({
        root: '',
        dir: 'foo',
        base: 'bar',
        ext: '',
        name: 'bar',
      })
    })

    it('parses filename only', () => {
      const result = parse('file.txt')
      expect(result).toEqual({
        root: '',
        dir: '',
        base: 'file.txt',
        ext: '.txt',
        name: 'file',
      })
    })

    it('parses filename without extension', () => {
      const result = parse('file')
      expect(result).toEqual({
        root: '',
        dir: '',
        base: 'file',
        ext: '',
        name: 'file',
      })
    })
  })

  describe('dotfiles', () => {
    it('parses dotfile', () => {
      const result = parse('/home/user/.gitignore')
      expect(result).toEqual({
        root: '/',
        dir: '/home/user',
        base: '.gitignore',
        ext: '',
        name: '.gitignore',
      })
    })

    it('parses dotfile with extension', () => {
      const result = parse('.gitignore.bak')
      expect(result).toEqual({
        root: '',
        dir: '',
        base: '.gitignore.bak',
        ext: '.bak',
        name: '.gitignore',
      })
    })
  })

  describe('multiple extensions', () => {
    it('handles multiple dots', () => {
      const result = parse('/foo/bar.test.ts')
      expect(result).toEqual({
        root: '/',
        dir: '/foo',
        base: 'bar.test.ts',
        ext: '.ts',
        name: 'bar.test',
      })
    })

    it('handles tar.gz', () => {
      const result = parse('archive.tar.gz')
      expect(result).toEqual({
        root: '',
        dir: '',
        base: 'archive.tar.gz',
        ext: '.gz',
        name: 'archive.tar',
      })
    })
  })

  describe('edge cases', () => {
    it('parses empty string', () => {
      const result = parse('')
      expect(result).toEqual({
        root: '',
        dir: '',
        base: '',
        ext: '',
        name: '',
      })
    })

    it('parses .', () => {
      const result = parse('.')
      expect(result).toEqual({
        root: '',
        dir: '',
        base: '.',
        ext: '',
        name: '.',
      })
    })

    it('parses ..', () => {
      const result = parse('..')
      expect(result).toEqual({
        root: '',
        dir: '',
        base: '..',
        ext: '',
        name: '..',
      })
    })

    it('parses path with trailing slash', () => {
      const result = parse('/foo/bar/')
      expect(result).toEqual({
        root: '/',
        dir: '/foo',
        base: 'bar',
        ext: '',
        name: 'bar',
      })
    })

    it('parses path with trailing dot', () => {
      const result = parse('file.')
      expect(result).toEqual({
        root: '',
        dir: '',
        base: 'file.',
        ext: '.',
        name: 'file',
      })
    })
  })
})

describe('format', () => {
  describe('basic formatting', () => {
    it('formats complete path object', () => {
      expect(format({
        root: '/',
        dir: '/home/user',
        base: 'file.txt',
        ext: '.txt',
        name: 'file',
      })).toBe('/home/user/file.txt')
    })

    it('formats relative path object', () => {
      expect(format({
        root: '',
        dir: 'foo/bar',
        base: 'baz.js',
        ext: '.js',
        name: 'baz',
      })).toBe('foo/bar/baz.js')
    })
  })

  describe('partial path objects', () => {
    it('uses dir and base when provided', () => {
      expect(format({ dir: '/home/user', base: 'file.txt' })).toBe('/home/user/file.txt')
    })

    it('uses root and base when dir is empty', () => {
      expect(format({ root: '/', base: 'file.txt' })).toBe('/file.txt')
    })

    it('uses name and ext when base is empty', () => {
      expect(format({ dir: '/home/user', name: 'file', ext: '.txt' })).toBe('/home/user/file.txt')
    })

    it('prefers base over name+ext', () => {
      expect(format({
        dir: '/home/user',
        base: 'actual.js',
        name: 'ignored',
        ext: '.ts',
      })).toBe('/home/user/actual.js')
    })

    it('handles only dir', () => {
      expect(format({ dir: '/home/user' })).toBe('/home/user')
    })

    it('handles only base', () => {
      expect(format({ base: 'file.txt' })).toBe('file.txt')
    })

    it('handles only name', () => {
      expect(format({ name: 'file' })).toBe('file')
    })

    it('handles only ext', () => {
      expect(format({ ext: '.txt' })).toBe('.txt')
    })

    it('handles name and ext', () => {
      expect(format({ name: 'file', ext: '.txt' })).toBe('file.txt')
    })
  })

  describe('edge cases', () => {
    it('formats empty object', () => {
      expect(format({})).toBe('')
    })

    it('handles root only', () => {
      expect(format({ root: '/' })).toBe('/')
    })

    it('ignores root when dir is provided', () => {
      expect(format({ root: '/', dir: '/home/user', base: 'file.txt' })).toBe('/home/user/file.txt')
    })

    it('handles ext without leading dot', () => {
      expect(format({ name: 'file', ext: 'txt' })).toBe('filetxt')
    })
  })

  describe('roundtrip with parse', () => {
    it('format(parse(path)) returns original path', () => {
      const paths = [
        '/home/user/file.txt',
        '/foo/bar/baz',
        'relative/path.js',
        'file.txt',
        '/file.txt',
      ]
      for (const path of paths) {
        expect(format(parse(path))).toBe(path)
      }
    })
  })
})

// ============================================================================
// PATH PREDICATES
// ============================================================================

describe('isAbsolute', () => {
  describe('absolute paths', () => {
    it('returns true for paths starting with /', () => {
      expect(isAbsolute('/')).toBe(true)
      expect(isAbsolute('/foo')).toBe(true)
      expect(isAbsolute('/foo/bar')).toBe(true)
      expect(isAbsolute('/foo/bar/baz.txt')).toBe(true)
    })

    it('returns true for multiple leading slashes', () => {
      expect(isAbsolute('//')).toBe(true)
      expect(isAbsolute('//foo')).toBe(true)
      expect(isAbsolute('///foo/bar')).toBe(true)
    })
  })

  describe('relative paths', () => {
    it('returns false for paths not starting with /', () => {
      expect(isAbsolute('foo')).toBe(false)
      expect(isAbsolute('foo/bar')).toBe(false)
      expect(isAbsolute('foo/bar/baz.txt')).toBe(false)
    })

    it('returns false for dot-relative paths', () => {
      expect(isAbsolute('.')).toBe(false)
      expect(isAbsolute('..')).toBe(false)
      expect(isAbsolute('./foo')).toBe(false)
      expect(isAbsolute('../foo')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isAbsolute('')).toBe(false)
    })
  })
})

describe('relative', () => {
  describe('basic relative paths', () => {
    it('computes relative path between siblings', () => {
      expect(relative('/foo/bar', '/foo/baz')).toBe('../baz')
    })

    it('computes relative path to child', () => {
      expect(relative('/foo', '/foo/bar')).toBe('bar')
      expect(relative('/foo', '/foo/bar/baz')).toBe('bar/baz')
    })

    it('computes relative path to parent', () => {
      expect(relative('/foo/bar', '/foo')).toBe('..')
      expect(relative('/foo/bar/baz', '/foo')).toBe('../..')
    })
  })

  describe('same path', () => {
    it('returns empty string for same path', () => {
      expect(relative('/foo/bar', '/foo/bar')).toBe('')
    })

    it('returns empty string for normalized same path', () => {
      expect(relative('/foo/bar', '/foo/./bar')).toBe('')
      expect(relative('/foo/bar/', '/foo/bar')).toBe('')
    })
  })

  describe('root paths', () => {
    it('computes relative from root', () => {
      expect(relative('/', '/foo')).toBe('foo')
      expect(relative('/', '/foo/bar')).toBe('foo/bar')
    })

    it('computes relative to root', () => {
      expect(relative('/foo', '/')).toBe('..')
      expect(relative('/foo/bar', '/')).toBe('../..')
    })

    it('handles root to root', () => {
      expect(relative('/', '/')).toBe('')
    })
  })

  describe('complex paths', () => {
    it('handles deeply nested paths', () => {
      expect(relative('/a/b/c/d', '/a/b/x/y')).toBe('../../x/y')
      expect(relative('/a/b/c', '/x/y/z')).toBe('../../../x/y/z')
    })

    it('handles no common prefix', () => {
      expect(relative('/foo', '/bar')).toBe('../bar')
      expect(relative('/foo/baz', '/bar/qux')).toBe('../../bar/qux')
    })
  })

  describe('relative paths input', () => {
    it('treats relative paths as relative to root', () => {
      expect(relative('foo', 'bar')).toBe('../bar')
      expect(relative('foo/bar', 'foo/baz')).toBe('../baz')
    })
  })

  describe('edge cases', () => {
    it('handles trailing slashes', () => {
      expect(relative('/foo/', '/foo/bar')).toBe('bar')
      expect(relative('/foo', '/foo/bar/')).toBe('bar')
    })

    it('handles double slashes', () => {
      expect(relative('/foo//bar', '/foo/bar/baz')).toBe('baz')
    })
  })
})

// ============================================================================
// CONSTANTS
// ============================================================================

describe('constants', () => {
  describe('sep', () => {
    it('is "/" for POSIX', () => {
      expect(sep).toBe('/')
    })
  })

  describe('delimiter', () => {
    it('is ":" for POSIX', () => {
      expect(delimiter).toBe(':')
    })
  })
})

// ============================================================================
// POSIX COMPLIANCE
// ============================================================================

describe('POSIX compliance', () => {
  describe('separator consistency', () => {
    it('always uses / as separator in output', () => {
      expect(join('foo', 'bar')).not.toContain('\\')
      expect(normalize('foo/bar')).not.toContain('\\')
      expect(resolve('foo', 'bar')).not.toContain('\\')
    })
  })

  describe('edge cases', () => {
    it('handles empty paths', () => {
      expect(normalize('')).toBe('.')
      expect(join('')).toBe('.')
      expect(basename('')).toBe('')
      expect(dirname('')).toBe('.')
      expect(extname('')).toBe('')
    })

    it('handles single slash', () => {
      expect(normalize('/')).toBe('/')
      expect(join('/')).toBe('/')
      expect(basename('/')).toBe('')
      expect(dirname('/')).toBe('/')
      expect(extname('/')).toBe('')
    })

    it('handles double slash', () => {
      expect(normalize('//')).toBe('/')
      expect(join('//')).toBe('/')
    })

    it('handles many slashes', () => {
      expect(normalize('//////')).toBe('/')
    })
  })

  describe('Node.js path.posix compatibility', () => {
    // These tests verify behavior matches Node.js path.posix module

    it('join normalizes the result', () => {
      expect(join('foo', 'bar', '..', 'baz')).toBe('foo/baz')
    })

    it('resolve always returns absolute path', () => {
      expect(resolve('foo')).toMatch(/^\//)
      expect(resolve('foo', 'bar')).toMatch(/^\//)
    })

    it('dirname of root is root', () => {
      expect(dirname('/')).toBe('/')
    })

    it('basename of root is empty', () => {
      expect(basename('/')).toBe('')
    })

    it('extname of dotfile is empty', () => {
      expect(extname('.gitignore')).toBe('')
    })
  })
})
