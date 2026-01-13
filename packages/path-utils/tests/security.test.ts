/**
 * @dotdo/path-utils/security - Path Security Validation Tests
 *
 * TDD RED Phase: Tests for path security utilities to prevent
 * traversal attacks, validate paths, and ensure safety.
 */

import { describe, it, expect } from 'vitest'
import {
  containsPathTraversal,
  isAbsolutePath,
  containsDangerousCharacters,
  normalizePath,
  validatePath,
  PathSecurityError,
} from '../src/security'

describe('containsPathTraversal', () => {
  describe('literal .. sequences', () => {
    it('detects .. in path', () => {
      expect(containsPathTraversal('..')).toBe(true)
      expect(containsPathTraversal('../foo')).toBe(true)
      expect(containsPathTraversal('foo/../bar')).toBe(true)
      expect(containsPathTraversal('foo/bar/..')).toBe(true)
    })

    it('detects multiple .. sequences', () => {
      expect(containsPathTraversal('../../etc/passwd')).toBe(true)
      expect(containsPathTraversal('foo/../../../bar')).toBe(true)
    })
  })

  describe('URL-encoded variants', () => {
    it('detects URL-encoded ..', () => {
      expect(containsPathTraversal('%2e%2e')).toBe(true)
      expect(containsPathTraversal('%2E%2E')).toBe(true)
      expect(containsPathTraversal('%2e%2e/foo')).toBe(true)
      expect(containsPathTraversal('foo/%2e%2e/bar')).toBe(true)
    })

    it('detects double URL-encoded ..', () => {
      expect(containsPathTraversal('%252e%252e')).toBe(true)
      expect(containsPathTraversal('%252E%252E')).toBe(true)
    })
  })

  describe('null byte injection', () => {
    it('detects null bytes', () => {
      expect(containsPathTraversal('foo\0bar')).toBe(true)
      expect(containsPathTraversal('%00')).toBe(true)
      expect(containsPathTraversal('foo%00.txt')).toBe(true)
    })
  })

  describe('safe paths', () => {
    it('allows normal paths', () => {
      expect(containsPathTraversal('foo/bar')).toBe(false)
      expect(containsPathTraversal('/foo/bar/baz')).toBe(false)
      expect(containsPathTraversal('foo/bar.txt')).toBe(false)
    })

    it('allows paths with single dots', () => {
      expect(containsPathTraversal('./foo')).toBe(false)
      expect(containsPathTraversal('foo/./bar')).toBe(false)
    })

    it('allows dotfiles', () => {
      expect(containsPathTraversal('.gitignore')).toBe(false)
      expect(containsPathTraversal('foo/.hidden')).toBe(false)
    })
  })
})

describe('isAbsolutePath', () => {
  describe('Unix paths', () => {
    it('detects Unix absolute paths', () => {
      expect(isAbsolutePath('/')).toBe(true)
      expect(isAbsolutePath('/foo')).toBe(true)
      expect(isAbsolutePath('/foo/bar')).toBe(true)
    })

    it('detects relative paths', () => {
      expect(isAbsolutePath('foo')).toBe(false)
      expect(isAbsolutePath('foo/bar')).toBe(false)
      expect(isAbsolutePath('./foo')).toBe(false)
      expect(isAbsolutePath('../foo')).toBe(false)
    })
  })

  describe('Windows paths', () => {
    it('detects Windows drive paths', () => {
      expect(isAbsolutePath('C:/')).toBe(true)
      expect(isAbsolutePath('C:\\foo')).toBe(true)
      expect(isAbsolutePath('D:/bar')).toBe(true)
    })

    it('detects UNC paths', () => {
      expect(isAbsolutePath('\\\\server\\share')).toBe(true)
    })
  })

  describe('URL-encoded paths', () => {
    it('detects URL-encoded leading slash', () => {
      expect(isAbsolutePath('%2f')).toBe(true)
      expect(isAbsolutePath('%2F')).toBe(true)
      expect(isAbsolutePath('%2ffoo')).toBe(true)
    })
  })
})

describe('containsDangerousCharacters', () => {
  describe('null bytes', () => {
    it('detects null bytes', () => {
      const result = containsDangerousCharacters('foo\0bar')
      expect(result.dangerous).toBe(true)
      expect(result.reason).toBe('null byte detected')
    })
  })

  describe('control characters', () => {
    it('detects control characters', () => {
      const result = containsDangerousCharacters('foo\x01bar')
      expect(result.dangerous).toBe(true)
      expect(result.reason).toBe('control character detected')
    })

    it('detects DEL character', () => {
      const result = containsDangerousCharacters('foo\x7fbar')
      expect(result.dangerous).toBe(true)
      expect(result.reason).toBe('control character detected')
    })

    it('allows tab and newline', () => {
      // Tab and newline are typically allowed in filenames
      const tabResult = containsDangerousCharacters('foo\tbar')
      const newlineResult = containsDangerousCharacters('foo\nbar')
      expect(tabResult.dangerous).toBe(false)
      expect(newlineResult.dangerous).toBe(false)
    })
  })

  describe('safe characters', () => {
    it('allows normal characters', () => {
      const result = containsDangerousCharacters('foo/bar/baz.txt')
      expect(result.dangerous).toBe(false)
    })

    it('allows Unicode characters', () => {
      const result = containsDangerousCharacters('foo/日本語/bar.txt')
      expect(result.dangerous).toBe(false)
    })

    it('allows special but safe characters', () => {
      const result = containsDangerousCharacters('foo-bar_baz.test.txt')
      expect(result.dangerous).toBe(false)
    })
  })
})

describe('normalizePath', () => {
  describe('backslash conversion', () => {
    it('converts backslashes to forward slashes', () => {
      expect(normalizePath('foo\\bar')).toBe('foo/bar')
      expect(normalizePath('foo\\bar\\baz')).toBe('foo/bar/baz')
    })
  })

  describe('duplicate slashes', () => {
    it('removes duplicate slashes', () => {
      expect(normalizePath('foo//bar')).toBe('foo/bar')
      expect(normalizePath('foo///bar')).toBe('foo/bar')
    })
  })

  describe('trailing slashes', () => {
    it('removes trailing slash', () => {
      expect(normalizePath('foo/bar/')).toBe('foo/bar')
    })

    it('preserves root', () => {
      expect(normalizePath('/')).toBe('/')
    })
  })

  describe('dot segments', () => {
    it('removes . segments', () => {
      expect(normalizePath('./foo')).toBe('foo')
      expect(normalizePath('foo/./bar')).toBe('foo/bar')
    })

    it('handles empty result', () => {
      expect(normalizePath('.')).toBe('.')
      expect(normalizePath('./')).toBe('.')
    })
  })

  describe('preserves leading slash', () => {
    it('preserves absolute path nature', () => {
      expect(normalizePath('/foo/bar')).toBe('/foo/bar')
      expect(normalizePath('/foo//bar')).toBe('/foo/bar')
    })
  })
})

describe('validatePath', () => {
  describe('valid paths', () => {
    it('validates normal paths', () => {
      const result = validatePath('foo/bar/baz.txt')
      expect(result.valid).toBe(true)
      expect(result.normalizedPath).toBe('foo/bar/baz.txt')
    })

    it('validates absolute paths', () => {
      const result = validatePath('/foo/bar')
      expect(result.valid).toBe(true)
      expect(result.normalizedPath).toBe('/foo/bar')
    })

    it('normalizes paths', () => {
      const result = validatePath('foo//bar/./baz')
      expect(result.valid).toBe(true)
      expect(result.normalizedPath).toBe('foo/bar/baz')
    })
  })

  describe('invalid paths', () => {
    it('rejects empty paths', () => {
      const result = validatePath('')
      expect(result.valid).toBe(false)
      expect(result.code).toBe('EMPTY_PATH')
    })

    it('rejects paths with traversal', () => {
      const result = validatePath('../etc/passwd')
      expect(result.valid).toBe(false)
      expect(result.code).toBe('PATH_TRAVERSAL')
    })

    it('rejects paths with dangerous characters', () => {
      const result = validatePath('foo\0bar')
      expect(result.valid).toBe(false)
      expect(result.code).toBe('DANGEROUS_CHARS')
    })
  })

  describe('options', () => {
    it('rejects absolute paths when requireRelative is true', () => {
      const result = validatePath('/foo/bar', { requireRelative: true })
      expect(result.valid).toBe(false)
      expect(result.code).toBe('ABSOLUTE_PATH')
    })

    it('allows absolute paths by default', () => {
      const result = validatePath('/foo/bar')
      expect(result.valid).toBe(true)
    })

    it('restricts to allowed characters when pattern provided', () => {
      const result = validatePath('foo@bar', { allowedPattern: /^[a-zA-Z0-9_\-./]+$/ })
      expect(result.valid).toBe(false)
      expect(result.code).toBe('INVALID_CHARS')
    })
  })
})

describe('PathSecurityError', () => {
  it('has correct name', () => {
    const error = new PathSecurityError('test message')
    expect(error.name).toBe('PathSecurityError')
  })

  it('has correct message', () => {
    const error = new PathSecurityError('test message')
    expect(error.message).toBe('test message')
  })

  it('has default code', () => {
    const error = new PathSecurityError('test message')
    expect(error.code).toBe('PATH_SECURITY_VIOLATION')
  })

  it('accepts custom code', () => {
    const error = new PathSecurityError('test message', 'CUSTOM_CODE')
    expect(error.code).toBe('CUSTOM_CODE')
  })

  it('is instanceof Error', () => {
    const error = new PathSecurityError('test message')
    expect(error).toBeInstanceOf(Error)
  })
})
