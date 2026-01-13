/**
 * Tests for safe JSON serialization utilities
 *
 * @module lib/tests/safe-stringify.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  safeStringify,
  safeParse,
  safeJsonParse,
  safeJsonParseResult,
  safeJsonClone,
  serializeError,
  safeSerialize,
} from '../safe-stringify'

describe('safeStringify', () => {
  describe('primitives', () => {
    it('handles null', () => {
      expect(safeStringify(null)).toBe('null')
    })

    it('handles undefined', () => {
      // JSON.stringify(undefined) returns undefined, but with object wrapping we get null
      expect(safeStringify(undefined)).toBe('null')
    })

    it('handles booleans', () => {
      expect(safeStringify(true)).toBe('true')
      expect(safeStringify(false)).toBe('false')
    })

    it('handles numbers', () => {
      expect(safeStringify(42)).toBe('42')
      expect(safeStringify(3.14)).toBe('3.14')
      expect(safeStringify(-100)).toBe('-100')
    })

    it('handles strings', () => {
      expect(safeStringify('hello')).toBe('"hello"')
    })

    it('handles BigInt by converting to string with n suffix', () => {
      const result = safeStringify(BigInt(9007199254740991))
      expect(result).toBe('"9007199254740991n"')
    })

    it('handles Symbol by converting to string', () => {
      const result = safeStringify(Symbol('test'))
      expect(result).toBe('"Symbol(test)"')
    })

    it('handles functions by replacing with placeholder', () => {
      const result = safeStringify(() => {})
      expect(result).toBe('"[Function]"')
    })
  })

  describe('circular references', () => {
    it('handles circular object references', () => {
      const obj: Record<string, unknown> = { a: 1 }
      obj.self = obj
      const result = safeStringify(obj)
      expect(result).toContain('[Circular]')
      expect(result).toContain('"a": 1')
    })

    it('handles circular array references', () => {
      const arr: unknown[] = [1, 2, 3]
      arr.push(arr)
      const result = safeStringify(arr)
      expect(result).toContain('[Circular]')
    })

    it('handles deeply nested circular references', () => {
      const obj: Record<string, unknown> = {
        level1: {
          level2: {
            level3: {},
          },
        },
      }
      ;(obj.level1 as Record<string, unknown>).level2.level3 = { back: obj }
      const result = safeStringify(obj)
      expect(result).toContain('[Circular]')
    })
  })

  describe('complex objects', () => {
    it('handles Date objects', () => {
      const date = new Date('2025-01-01T00:00:00.000Z')
      const result = safeStringify(date)
      expect(result).toBe('"2025-01-01T00:00:00.000Z"')
    })

    it('handles RegExp objects', () => {
      const result = safeStringify(/test/gi)
      expect(result).toBe('"/test/gi"')
    })

    it('handles Map objects', () => {
      const map = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ])
      const result = safeStringify(map)
      const parsed = JSON.parse(result)
      expect(parsed.__type).toBe('Map')
      expect(parsed.entries.key1).toBe('value1')
      expect(parsed.entries.key2).toBe('value2')
    })

    it('handles Set objects', () => {
      const set = new Set([1, 2, 3])
      const result = safeStringify(set)
      const parsed = JSON.parse(result)
      expect(parsed.__type).toBe('Set')
      expect(parsed.values).toEqual([1, 2, 3])
    })

    it('handles nested arrays and objects', () => {
      const obj = {
        arr: [1, { nested: true }, [2, 3]],
        obj: { a: { b: { c: 'deep' } } },
      }
      const result = safeStringify(obj)
      const parsed = JSON.parse(result)
      expect(parsed.arr[1].nested).toBe(true)
      expect(parsed.obj.a.b.c).toBe('deep')
    })
  })

  describe('Error objects', () => {
    it('serializes Error with name, message, and stack', () => {
      const error = new Error('test error')
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(parsed.name).toBe('Error')
      expect(parsed.message).toBe('test error')
      expect(parsed.stack).toBeDefined()
    })

    it('includes custom error properties', () => {
      const error = new Error('test') as Error & { code: string; details: object }
      error.code = 'ERR_TEST'
      error.details = { extra: 'info' }
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(parsed.code).toBe('ERR_TEST')
      expect(parsed.details.extra).toBe('info')
    })

    it('can exclude stack traces', () => {
      const error = new Error('test error')
      const result = safeStringify(error, { includeStacks: false })
      const parsed = JSON.parse(result)
      expect(parsed.stack).toBeUndefined()
    })
  })

  describe('options', () => {
    it('respects maxDepth option', () => {
      const deep = { l1: { l2: { l3: { l4: { l5: 'deep' } } } } }
      const result = safeStringify(deep, { maxDepth: 3 })
      expect(result).toContain('[Max depth exceeded]')
    })

    it('truncates long strings', () => {
      const longString = 'a'.repeat(20000)
      const result = safeStringify(longString, { maxLength: 100 })
      expect(result.length).toBeLessThan(200)
      expect(result).toContain('truncated')
    })

    it('allows custom circular replacement', () => {
      const obj: Record<string, unknown> = { a: 1 }
      obj.self = obj
      const result = safeStringify(obj, { circularReplacement: '[CYCLE]' })
      expect(result).toContain('[CYCLE]')
    })

    it('allows custom function replacement', () => {
      const result = safeStringify(() => {}, { functionReplacement: '[fn]' })
      expect(result).toBe('"[fn]"')
    })
  })
})

describe('safeParse', () => {
  it('parses valid JSON', () => {
    expect(safeParse('{"a": 1}')).toEqual({ a: 1 })
    expect(safeParse('[1, 2, 3]')).toEqual([1, 2, 3])
    expect(safeParse('"hello"')).toBe('hello')
    expect(safeParse('42')).toBe(42)
    expect(safeParse('null')).toBe(null)
  })

  it('returns null for invalid JSON', () => {
    expect(safeParse('invalid')).toBe(null)
    expect(safeParse('{broken')).toBe(null)
    expect(safeParse('')).toBe(null)
  })
})

describe('safeJsonParse', () => {
  it('parses valid JSON and returns value', () => {
    expect(safeJsonParse('{"a": 1}')).toEqual({ a: 1 })
    expect(safeJsonParse('[1, 2, 3]')).toEqual([1, 2, 3])
  })

  it('returns undefined for invalid JSON without fallback', () => {
    expect(safeJsonParse('invalid')).toBeUndefined()
    expect(safeJsonParse('{broken')).toBeUndefined()
  })

  it('returns fallback for invalid JSON when provided', () => {
    expect(safeJsonParse('invalid', { default: true })).toEqual({ default: true })
    expect(safeJsonParse('{broken', [])).toEqual([])
  })

  it('returns fallback for empty string', () => {
    expect(safeJsonParse('', null)).toBe(null)
  })
})

describe('safeJsonParseResult', () => {
  it('returns ok: true with value for valid JSON', () => {
    const result = safeJsonParseResult('{"a": 1}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ a: 1 })
    }
  })

  it('returns ok: false with error for invalid JSON', () => {
    const result = safeJsonParseResult('invalid')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SyntaxError)
    }
  })

  it('correctly handles null values', () => {
    const result = safeJsonParseResult('null')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(null)
    }
  })
})

describe('safeJsonClone', () => {
  it('deep clones objects', () => {
    const original = { a: { b: { c: 1 } } }
    const cloned = safeJsonClone(original)
    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
    expect(cloned.a).not.toBe(original.a)
  })

  it('returns fallback for circular references', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    const result = safeJsonClone(obj, { fallback: true })
    expect(result).toEqual({ fallback: true })
  })

  it('returns fallback for BigInt', () => {
    const obj = { big: BigInt(123) }
    const result = safeJsonClone(obj, { fallback: true })
    expect(result).toEqual({ fallback: true })
  })

  it('drops undefined values (standard JSON behavior)', () => {
    const obj = { a: 1, b: undefined, c: 3 }
    const cloned = safeJsonClone(obj)
    expect(cloned).toEqual({ a: 1, c: 3 })
    expect('b' in cloned).toBe(false)
  })

  it('drops function values (standard JSON behavior)', () => {
    const obj = { a: 1, fn: () => {} }
    const cloned = safeJsonClone(obj)
    expect(cloned).toEqual({ a: 1 })
  })
})

describe('serializeError', () => {
  it('serializes Error objects', () => {
    const error = new Error('test message')
    const result = serializeError(error)
    expect(result.name).toBe('Error')
    expect(result.message).toBe('test message')
    expect(result.stack).toBeDefined()
  })

  it('serializes TypeError', () => {
    const error = new TypeError('type error')
    const result = serializeError(error)
    expect(result.name).toBe('TypeError')
    expect(result.message).toBe('type error')
  })

  it('includes cause if present', () => {
    const cause = new Error('root cause')
    const error = new Error('wrapper', { cause })
    const result = serializeError(error)
    expect(result.cause).toBeDefined()
    expect((result.cause as Record<string, unknown>).message).toBe('root cause')
  })

  it('includes custom properties', () => {
    const error = new Error('test') as Error & { code: string; statusCode: number }
    error.code = 'ERR_CUSTOM'
    error.statusCode = 500
    const result = serializeError(error)
    expect(result.code).toBe('ERR_CUSTOM')
    expect(result.statusCode).toBe(500)
  })

  it('handles non-Error objects', () => {
    const result = serializeError({ custom: 'object' })
    expect(result).toEqual({ custom: 'object' })
  })

  it('handles string errors', () => {
    const result = serializeError('string error')
    expect(result.message).toBe('string error')
  })

  it('handles null', () => {
    const result = serializeError(null)
    expect(result.message).toBe('null')
  })

  it('handles undefined', () => {
    const result = serializeError(undefined)
    expect(result.message).toBe('undefined')
  })
})

describe('safeSerialize', () => {
  it('handles null and undefined', () => {
    expect(safeSerialize(null)).toBe(null)
    expect(safeSerialize(undefined)).toBe(undefined)
  })

  it('handles primitive values', () => {
    expect(safeSerialize(42)).toBe(42)
    expect(safeSerialize('hello')).toBe('hello')
    expect(safeSerialize(true)).toBe(true)
  })

  it('handles BigInt by converting to string with n suffix', () => {
    expect(safeSerialize(BigInt(123))).toBe('123n')
  })

  it('handles Symbol by converting to string', () => {
    expect(safeSerialize(Symbol('test'))).toBe('Symbol(test)')
  })

  it('handles functions by returning placeholder', () => {
    expect(safeSerialize(() => {})).toBe('[Function]')
  })

  it('handles circular references', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    const result = safeSerialize(obj)
    expect((result as Record<string, unknown>).a).toBe(1)
    expect((result as Record<string, unknown>).self).toBe('[Circular]')
  })

  it('handles arrays', () => {
    const result = safeSerialize([1, 2, { nested: true }])
    expect(result).toEqual([1, 2, { nested: true }])
  })

  it('handles nested objects', () => {
    const obj = { a: { b: { c: 1 } } }
    const result = safeSerialize(obj)
    expect(result).toEqual(obj)
  })

  it('handles Date objects', () => {
    const date = new Date('2025-01-01T00:00:00.000Z')
    const result = safeSerialize(date)
    expect(result).toBe('2025-01-01T00:00:00.000Z')
  })

  it('handles Map objects', () => {
    const map = new Map([['key', 'value']])
    const result = safeSerialize(map) as Record<string, unknown>
    expect(result.__type).toBe('Map')
    expect((result.entries as Record<string, unknown>).key).toBe('value')
  })

  it('handles Set objects', () => {
    const set = new Set([1, 2, 3])
    const result = safeSerialize(set) as Record<string, unknown>
    expect(result.__type).toBe('Set')
    expect(result.values).toEqual([1, 2, 3])
  })
})
