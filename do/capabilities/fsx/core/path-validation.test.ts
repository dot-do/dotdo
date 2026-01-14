/**
 * Path Input Validation Tests - RED Phase
 *
 * Tests for runtime type checking at API boundaries.
 * These tests ensure that all path-accepting functions properly validate
 * their inputs and provide clear error messages for invalid types.
 *
 * The TypeScript type system catches these at compile time, but at runtime
 * (especially when called from JavaScript or with any types) we need proper
 * validation to provide meaningful error messages and prevent undefined behavior.
 *
 * @module core/path-validation.test
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
  hasTraversal,
  isWithin,
} from './path'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Invalid path values to test against all path functions.
 * Each entry includes the value and its expected type string.
 */
const INVALID_PATH_VALUES = [
  { value: null, type: 'null' },
  { value: undefined, type: 'undefined' },
  { value: 123, type: 'number' },
  { value: 12.34, type: 'number' },
  { value: true, type: 'boolean' },
  { value: false, type: 'boolean' },
  { value: {}, type: 'object' },
  { value: { path: '/foo' }, type: 'object' },
  { value: [], type: 'object' },  // typeof [] === 'object'
  { value: ['/foo', '/bar'], type: 'object' },
  { value: Symbol('path'), type: 'symbol' },
  { value: () => '/foo', type: 'function' },
] as const

/**
 * Test that a function throws TypeError for invalid path input.
 *
 * @param fn - Function to test
 * @param value - Invalid value to pass
 * @param expectedType - Expected type name in error message
 */
function expectTypeError(fn: (path: unknown) => unknown, value: unknown, expectedType: string): void {
  expect(() => fn(value)).toThrow(TypeError)
  try {
    fn(value)
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError)
    expect((error as TypeError).message).toContain('string')
    expect((error as TypeError).message).toContain(expectedType)
  }
}

// =============================================================================
// Path Type Validation Tests
// =============================================================================

describe('Path Input Validation', () => {
  describe('normalize() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type input',
      ({ value, type }) => {
        expectTypeError(normalize as (p: unknown) => string, value, type)
      }
    )

    it('should throw TypeError with clear message including actual type', () => {
      expect(() => normalize(null as unknown as string)).toThrow(TypeError)
      expect(() => normalize(null as unknown as string)).toThrow(/null/)
      expect(() => normalize(null as unknown as string)).toThrow(/string/)
    })

    it('should accept valid string paths', () => {
      expect(() => normalize('/foo/bar')).not.toThrow()
      expect(() => normalize('')).not.toThrow()
      expect(() => normalize('.')).not.toThrow()
    })
  })

  describe('join() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError when first argument is $type',
      ({ value, type }) => {
        expectTypeError((p) => join(p as string), value, type)
      }
    )

    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError when any argument is $type',
      ({ value, type }) => {
        expectTypeError((p) => join('/foo', p as string, '/bar'), value, type)
      }
    )

    it('should accept valid string paths', () => {
      expect(() => join('/foo', 'bar', 'baz')).not.toThrow()
      expect(() => join()).not.toThrow()
    })
  })

  describe('resolve() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError when first argument is $type',
      ({ value, type }) => {
        expectTypeError((p) => resolve(p as string), value, type)
      }
    )

    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError when any argument is $type',
      ({ value, type }) => {
        expectTypeError((p) => resolve('/foo', p as string, '/bar'), value, type)
      }
    )

    it('should accept valid string paths', () => {
      expect(() => resolve('/foo', 'bar')).not.toThrow()
      expect(() => resolve()).not.toThrow()
    })
  })

  describe('dirname() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type input',
      ({ value, type }) => {
        expectTypeError(dirname as (p: unknown) => string, value, type)
      }
    )

    it('should accept valid string paths', () => {
      expect(() => dirname('/foo/bar')).not.toThrow()
      expect(() => dirname('')).not.toThrow()
    })
  })

  describe('basename() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type path input',
      ({ value, type }) => {
        expectTypeError(basename as (p: unknown) => string, value, type)
      }
    )

    // ext is optional, so only test non-undefined invalid values
    const INVALID_EXT_VALUES = INVALID_PATH_VALUES.filter(
      ({ value }) => value !== undefined
    )

    it.each(INVALID_EXT_VALUES)(
      'should throw TypeError for $type ext input',
      ({ value, type }) => {
        expectTypeError((p) => basename('/foo/bar.txt', p as string), value, type)
      }
    )

    it('should accept valid string paths', () => {
      expect(() => basename('/foo/bar')).not.toThrow()
      expect(() => basename('/foo/bar.txt', '.txt')).not.toThrow()
      expect(() => basename('/foo/bar.txt', undefined)).not.toThrow()
    })
  })

  describe('extname() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type input',
      ({ value, type }) => {
        expectTypeError(extname as (p: unknown) => string, value, type)
      }
    )

    it('should accept valid string paths', () => {
      expect(() => extname('/foo/bar.txt')).not.toThrow()
      expect(() => extname('')).not.toThrow()
    })
  })

  describe('parse() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type input',
      ({ value, type }) => {
        expectTypeError(parse as (p: unknown) => unknown, value, type)
      }
    )

    it('should accept valid string paths', () => {
      expect(() => parse('/foo/bar.txt')).not.toThrow()
      expect(() => parse('')).not.toThrow()
    })
  })

  describe('isAbsolute() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type input',
      ({ value, type }) => {
        expectTypeError(isAbsolute as (p: unknown) => boolean, value, type)
      }
    )

    it('should accept valid string paths', () => {
      expect(() => isAbsolute('/foo/bar')).not.toThrow()
      expect(() => isAbsolute('foo/bar')).not.toThrow()
      expect(() => isAbsolute('')).not.toThrow()
    })
  })

  describe('relative() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type from path',
      ({ value, type }) => {
        expectTypeError((p) => relative(p as string, '/bar'), value, type)
      }
    )

    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type to path',
      ({ value, type }) => {
        expectTypeError((p) => relative('/foo', p as string), value, type)
      }
    )

    it('should accept valid string paths', () => {
      expect(() => relative('/foo', '/bar')).not.toThrow()
    })
  })

  describe('hasTraversal() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type input',
      ({ value, type }) => {
        expectTypeError(hasTraversal as (p: unknown) => boolean, value, type)
      }
    )

    it('should accept valid string paths', () => {
      expect(() => hasTraversal('/foo/bar')).not.toThrow()
      expect(() => hasTraversal('../foo')).not.toThrow()
    })
  })

  describe('isWithin() - type validation', () => {
    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type base path',
      ({ value, type }) => {
        expectTypeError((p) => isWithin(p as string, 'bar'), value, type)
      }
    )

    it.each(INVALID_PATH_VALUES)(
      'should throw TypeError for $type target path',
      ({ value, type }) => {
        expectTypeError((p) => isWithin('/foo', p as string), value, type)
      }
    )

    it('should accept valid string paths', () => {
      expect(() => isWithin('/foo', 'bar')).not.toThrow()
      expect(() => isWithin('/foo', '/foo/bar')).not.toThrow()
    })
  })
})

// =============================================================================
// Path Traversal Prevention Tests
// =============================================================================

describe('Path Traversal Prevention', () => {
  describe('hasTraversal()', () => {
    it('should detect .. at start of path', () => {
      expect(hasTraversal('../foo')).toBe(true)
      expect(hasTraversal('../../foo')).toBe(true)
    })

    it('should not flag contained traversals (after normalization)', () => {
      // These paths contain .. but normalize to paths within their original scope
      // /foo/../bar normalizes to /bar (no traversal - stays within root)
      expect(hasTraversal('/foo/../bar')).toBe(false)
      // foo/bar/../baz normalizes to foo/baz (no traversal)
      expect(hasTraversal('foo/bar/../baz')).toBe(false)
    })

    it('should not flag safe paths', () => {
      expect(hasTraversal('/foo/bar')).toBe(false)
      expect(hasTraversal('./foo/bar')).toBe(false)
      expect(hasTraversal('foo..bar')).toBe(false)
      expect(hasTraversal('/foo/bar..baz')).toBe(false)
    })

    it('should detect traversal that escapes base after normalization', () => {
      // These resolve to paths starting with .. (escape current directory)
      expect(hasTraversal('foo/../../bar')).toBe(true)
      // More levels up than down
      expect(hasTraversal('a/b/c/../../../../x')).toBe(true)
    })
  })

  describe('isWithin()', () => {
    it('should allow paths within base', () => {
      expect(isWithin('/app', 'data')).toBe(true)
      expect(isWithin('/app', 'data/file.txt')).toBe(true)
      expect(isWithin('/app', './data')).toBe(true)
    })

    it('should reject path traversal attacks', () => {
      expect(isWithin('/app', '../etc/passwd')).toBe(false)
      expect(isWithin('/app', '../../etc/passwd')).toBe(false)
      expect(isWithin('/app', 'data/../../../etc/passwd')).toBe(false)
    })

    it('should reject absolute paths outside base', () => {
      expect(isWithin('/app', '/etc/passwd')).toBe(false)
      expect(isWithin('/app', '/app/../etc/passwd')).toBe(false)
    })

    it('should handle base with trailing slash', () => {
      expect(isWithin('/app/', 'data')).toBe(true)
      expect(isWithin('/app/', '../etc')).toBe(false)
    })

    it('should prevent similar-prefix escapes', () => {
      // /app should not match /application
      expect(isWithin('/app', '/application/data')).toBe(false)
    })
  })
})
