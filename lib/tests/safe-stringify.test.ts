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
      // JSON.stringify(undefined) returns undefined, but we convert to null
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

    it('handles special number values', () => {
      expect(safeStringify(NaN)).toBe('null')
      expect(safeStringify(Infinity)).toBe('null')
      expect(safeStringify(-Infinity)).toBe('null')
      expect(safeStringify(0)).toBe('0')
      expect(safeStringify(-0)).toBe('0')
    })

    it('handles strings', () => {
      expect(safeStringify('hello')).toBe('"hello"')
    })

    it('handles empty strings', () => {
      expect(safeStringify('')).toBe('""')
    })

    it('handles strings with special characters', () => {
      expect(safeStringify('hello\nworld')).toBe('"hello\\nworld"')
      expect(safeStringify('tab\there')).toBe('"tab\\there"')
      expect(safeStringify('quote"here')).toBe('"quote\\"here"')
    })
  })

  describe('BigInt serialization', () => {
    it('handles BigInt by converting to string with n suffix', () => {
      const result = safeStringify(BigInt(9007199254740991))
      expect(result).toBe('"9007199254740991n"')
    })

    it('handles negative BigInt', () => {
      const result = safeStringify(BigInt(-12345))
      expect(result).toBe('"-12345n"')
    })

    it('handles zero BigInt', () => {
      const result = safeStringify(BigInt(0))
      expect(result).toBe('"0n"')
    })

    it('handles very large BigInt', () => {
      const result = safeStringify(BigInt('123456789012345678901234567890'))
      expect(result).toBe('"123456789012345678901234567890n"')
    })

    it('handles BigInt in objects', () => {
      const obj = { id: BigInt(123), name: 'test' }
      const result = safeStringify(obj)
      const parsed = JSON.parse(result)
      expect(parsed.id).toBe('123n')
      expect(parsed.name).toBe('test')
    })

    it('handles BigInt in arrays', () => {
      const arr = [BigInt(1), BigInt(2), BigInt(3)]
      const result = safeStringify(arr)
      const parsed = JSON.parse(result)
      expect(parsed).toEqual(['1n', '2n', '3n'])
    })
  })

  describe('Symbol handling', () => {
    it('handles Symbol by converting to string', () => {
      const result = safeStringify(Symbol('test'))
      expect(result).toBe('"Symbol(test)"')
    })

    it('handles Symbol without description', () => {
      const result = safeStringify(Symbol())
      expect(result).toBe('"Symbol()"')
    })

    it('handles well-known Symbols', () => {
      const result = safeStringify(Symbol.iterator)
      expect(result).toBe('"Symbol(Symbol.iterator)"')
    })

    it('handles Symbol.for (global symbols)', () => {
      const result = safeStringify(Symbol.for('global'))
      expect(result).toBe('"Symbol(global)"')
    })

    it('handles Symbol in objects', () => {
      const sym = Symbol('key')
      // Note: Symbol-keyed properties are not enumerable by Object.keys()
      // This tests Symbol as a value, not as a key
      const obj = { prop: sym }
      const result = safeStringify(obj)
      const parsed = JSON.parse(result)
      expect(parsed.prop).toBe('Symbol(key)')
    })

    it('handles Symbol in arrays', () => {
      const arr = [Symbol('a'), Symbol('b')]
      const result = safeStringify(arr)
      const parsed = JSON.parse(result)
      expect(parsed).toEqual(['Symbol(a)', 'Symbol(b)'])
    })
  })

  describe('function handling', () => {
    it('handles functions by replacing with placeholder', () => {
      const result = safeStringify(() => {})
      expect(result).toBe('"[Function]"')
    })

    it('handles named functions', () => {
      function namedFn() {}
      const result = safeStringify(namedFn)
      expect(result).toBe('"[Function]"')
    })

    it('handles arrow functions', () => {
      const result = safeStringify((x: number) => x * 2)
      expect(result).toBe('"[Function]"')
    })

    it('handles async functions', () => {
      const result = safeStringify(async () => {})
      expect(result).toBe('"[Function]"')
    })

    it('handles generator functions', () => {
      const result = safeStringify(function* () {})
      expect(result).toBe('"[Function]"')
    })

    it('handles functions in objects', () => {
      const obj = { fn: () => {}, data: 'value' }
      const result = safeStringify(obj)
      const parsed = JSON.parse(result)
      expect(parsed.fn).toBe('[Function]')
      expect(parsed.data).toBe('value')
    })

    it('handles class constructors', () => {
      class TestClass {}
      const result = safeStringify(TestClass)
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

    it('handles multiple circular references to same object', () => {
      const shared = { value: 'shared' }
      const obj = {
        ref1: shared,
        ref2: shared,
        ref3: shared,
      }
      const result = safeStringify(obj)
      // First reference succeeds, subsequent references are circular
      expect(result).toContain('"value": "shared"')
      expect(result).toContain('[Circular]')
    })

    it('handles mutual circular references between two objects', () => {
      const a: Record<string, unknown> = { name: 'a' }
      const b: Record<string, unknown> = { name: 'b' }
      a.ref = b
      b.ref = a
      const result = safeStringify(a)
      expect(result).toContain('[Circular]')
      expect(result).toContain('"name": "a"')
      expect(result).toContain('"name": "b"')
    })

    it('handles circular references in nested arrays', () => {
      const arr: unknown[] = []
      const nested = [1, 2, arr]
      arr.push(nested)
      const result = safeStringify(arr)
      expect(result).toContain('[Circular]')
    })

    it('handles circular references in Map values', () => {
      const obj: Record<string, unknown> = { key: 'value' }
      const map = new Map([['circular', obj]])
      obj.map = map
      const result = safeStringify(obj)
      expect(result).toContain('[Circular]')
    })

    it('handles circular references in Set values', () => {
      const obj: Record<string, unknown> = { data: 'test' }
      const set = new Set([obj])
      obj.set = set
      const result = safeStringify(obj)
      expect(result).toContain('[Circular]')
    })

    it('does not produce circular for separate but identical objects', () => {
      const obj = {
        a: { value: 1 },
        b: { value: 1 },
      }
      const result = safeStringify(obj)
      expect(result).not.toContain('[Circular]')
      const parsed = JSON.parse(result)
      expect(parsed.a.value).toBe(1)
      expect(parsed.b.value).toBe(1)
    })
  })

  describe('Date handling', () => {
    it('handles Date objects', () => {
      const date = new Date('2025-01-01T00:00:00.000Z')
      const result = safeStringify(date)
      expect(result).toBe('"2025-01-01T00:00:00.000Z"')
    })

    it('handles Date with time components', () => {
      const date = new Date('2025-06-15T14:30:45.123Z')
      const result = safeStringify(date)
      expect(result).toBe('"2025-06-15T14:30:45.123Z"')
    })

    it('handles Invalid Date', () => {
      const invalidDate = new Date('invalid')
      const result = safeStringify(invalidDate)
      expect(result).toBe('"Invalid Date"')
    })

    it('handles Date epoch (Unix timestamp 0)', () => {
      const epoch = new Date(0)
      const result = safeStringify(epoch)
      expect(result).toBe('"1970-01-01T00:00:00.000Z"')
    })

    it('handles Date in objects', () => {
      const obj = {
        created: new Date('2025-01-01T00:00:00.000Z'),
        updated: new Date('2025-06-01T12:00:00.000Z'),
      }
      const result = safeStringify(obj)
      const parsed = JSON.parse(result)
      expect(parsed.created).toBe('2025-01-01T00:00:00.000Z')
      expect(parsed.updated).toBe('2025-06-01T12:00:00.000Z')
    })

    it('handles Date in arrays', () => {
      const dates = [
        new Date('2025-01-01T00:00:00.000Z'),
        new Date('2025-02-01T00:00:00.000Z'),
      ]
      const result = safeStringify(dates)
      const parsed = JSON.parse(result)
      expect(parsed).toEqual([
        '2025-01-01T00:00:00.000Z',
        '2025-02-01T00:00:00.000Z',
      ])
    })
  })

  describe('complex objects', () => {
    it('handles RegExp objects', () => {
      const result = safeStringify(/test/gi)
      expect(result).toBe('"/test/gi"')
    })

    it('handles RegExp with special characters', () => {
      const result = safeStringify(/[a-z]+\d{2,4}/gim)
      expect(result).toBe('"/[a-z]+\\\\d{2,4}/gim"')
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

    it('handles Map with non-string keys', () => {
      const map = new Map<unknown, string>([
        [1, 'number'],
        [true, 'boolean'],
        [{}, 'object'],
      ])
      const result = safeStringify(map)
      const parsed = JSON.parse(result)
      expect(parsed.__type).toBe('Map')
      expect(parsed.entries['1']).toBe('number')
      expect(parsed.entries['true']).toBe('boolean')
    })

    it('handles nested Map and Set', () => {
      const innerSet = new Set([1, 2, 3])
      const map = new Map([['set', innerSet]])
      const result = safeStringify(map)
      const parsed = JSON.parse(result)
      expect(parsed.__type).toBe('Map')
      expect(parsed.entries.set.__type).toBe('Set')
      expect(parsed.entries.set.values).toEqual([1, 2, 3])
    })

    it('handles Set objects', () => {
      const set = new Set([1, 2, 3])
      const result = safeStringify(set)
      const parsed = JSON.parse(result)
      expect(parsed.__type).toBe('Set')
      expect(parsed.values).toEqual([1, 2, 3])
    })

    it('handles Set with mixed types', () => {
      const set = new Set(['string', 42, true, null])
      const result = safeStringify(set)
      const parsed = JSON.parse(result)
      expect(parsed.__type).toBe('Set')
      expect(parsed.values).toContain('string')
      expect(parsed.values).toContain(42)
      expect(parsed.values).toContain(true)
      expect(parsed.values).toContain(null)
    })

    it('handles empty Map', () => {
      const map = new Map()
      const result = safeStringify(map)
      const parsed = JSON.parse(result)
      expect(parsed.__type).toBe('Map')
      expect(parsed.entries).toEqual({})
    })

    it('handles empty Set', () => {
      const set = new Set()
      const result = safeStringify(set)
      const parsed = JSON.parse(result)
      expect(parsed.__type).toBe('Set')
      expect(parsed.values).toEqual([])
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

  describe('Error serialization', () => {
    it('serializes Error with name, message, and stack', () => {
      const error = new Error('test error')
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(parsed.name).toBe('Error')
      expect(parsed.message).toBe('test error')
      expect(parsed.stack).toBeDefined()
    })

    it('serializes TypeError', () => {
      const error = new TypeError('type error')
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(parsed.name).toBe('TypeError')
      expect(parsed.message).toBe('type error')
    })

    it('serializes RangeError', () => {
      const error = new RangeError('out of range')
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(parsed.name).toBe('RangeError')
      expect(parsed.message).toBe('out of range')
    })

    it('serializes SyntaxError', () => {
      const error = new SyntaxError('invalid syntax')
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(parsed.name).toBe('SyntaxError')
      expect(parsed.message).toBe('invalid syntax')
    })

    it('serializes ReferenceError', () => {
      const error = new ReferenceError('undefined variable')
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(parsed.name).toBe('ReferenceError')
      expect(parsed.message).toBe('undefined variable')
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

    it('includes numeric error codes', () => {
      const error = new Error('http error') as Error & { statusCode: number; errno: number }
      error.statusCode = 404
      error.errno = -2
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(parsed.statusCode).toBe(404)
      expect(parsed.errno).toBe(-2)
    })

    it('can exclude stack traces', () => {
      const error = new Error('test error')
      const result = safeStringify(error, { includeStacks: false })
      const parsed = JSON.parse(result)
      expect(parsed.stack).toBeUndefined()
    })

    it('handles custom Error subclasses', () => {
      class CustomError extends Error {
        constructor(
          message: string,
          public code: string
        ) {
          super(message)
          this.name = 'CustomError'
        }
      }
      const error = new CustomError('custom message', 'CUSTOM_CODE')
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(parsed.name).toBe('CustomError')
      expect(parsed.message).toBe('custom message')
      expect(parsed.code).toBe('CUSTOM_CODE')
    })

    it('handles Error in objects', () => {
      const obj = {
        success: false,
        error: new Error('operation failed'),
      }
      const result = safeStringify(obj)
      const parsed = JSON.parse(result)
      expect(parsed.success).toBe(false)
      expect(parsed.error.name).toBe('Error')
      expect(parsed.error.message).toBe('operation failed')
    })

    it('handles Error in arrays', () => {
      const errors = [new Error('error 1'), new TypeError('error 2')]
      const result = safeStringify(errors)
      const parsed = JSON.parse(result)
      expect(parsed[0].name).toBe('Error')
      expect(parsed[0].message).toBe('error 1')
      expect(parsed[1].name).toBe('TypeError')
      expect(parsed[1].message).toBe('error 2')
    })

    it('handles nested errors', () => {
      const error = new Error('outer') as Error & { inner: Error }
      error.inner = new Error('inner')
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(parsed.message).toBe('outer')
      expect(parsed.inner.message).toBe('inner')
    })

    it('handles AggregateError-like structures', () => {
      const errors = [new Error('err1'), new Error('err2')]
      const aggregateError = new Error('Multiple errors') as Error & { errors: Error[] }
      aggregateError.errors = errors
      const result = safeStringify(aggregateError)
      const parsed = JSON.parse(result)
      expect(parsed.message).toBe('Multiple errors')
      expect(parsed.errors).toHaveLength(2)
      expect(parsed.errors[0].message).toBe('err1')
      expect(parsed.errors[1].message).toBe('err2')
    })

    it('stack traces are string type', () => {
      const error = new Error('test')
      const result = safeStringify(error)
      const parsed = JSON.parse(result)
      expect(typeof parsed.stack).toBe('string')
      expect(parsed.stack).toContain('Error: test')
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
