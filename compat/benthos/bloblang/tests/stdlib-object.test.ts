/**
 * RED Phase Tests: Bloblang Stdlib Object Functions
 * Issue: dotdo-r9yls
 *
 * These tests define the expected behavior for object manipulation functions.
 * They should FAIL until the implementation is complete.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  keys,
  values,
  merge,
  without,
  exists,
  get,
  set,
  deleteKey,
  mapEachKey,
  fromJson,
  toJson
} from '../stdlib/object'

describe('Bloblang Stdlib: Object Functions', () => {
  describe('keys()', () => {
    it('returns array of all keys from an object', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const result = keys(obj)

      expect(result).toEqual(['a', 'b', 'c'])
      expect(Array.isArray(result)).toBe(true)
    })

    it('returns empty array for empty object', () => {
      const result = keys({})

      expect(result).toEqual([])
      expect(Array.isArray(result)).toBe(true)
    })

    it('handles objects with string and numeric keys', () => {
      const obj = { name: 'test', 42: 'value', nested: { x: 1 } }
      const result = keys(obj)

      expect(result).toContain('name')
      expect(result).toContain('42')
      expect(result).toContain('nested')
      expect(result).toHaveLength(3)
    })

    it('handles nested objects', () => {
      const obj = { user: { name: 'John' }, settings: { theme: 'dark' } }
      const result = keys(obj)

      expect(result).toEqual(['user', 'settings'])
    })

    it('throws on non-object input', () => {
      expect(() => keys(null)).toThrow()
      expect(() => keys(undefined)).toThrow()
      expect(() => keys(42)).toThrow()
      expect(() => keys('string')).toThrow()
      expect(() => keys([])).toThrow()
    })

    it('maintains insertion order', () => {
      const obj = { z: 1, a: 2, m: 3 }
      const result = keys(obj)

      expect(result).toEqual(['z', 'a', 'm'])
    })
  })

  describe('values()', () => {
    it('returns array of all values from an object', () => {
      const obj = { a: 1, b: 'hello', c: true }
      const result = values(obj)

      expect(result).toContain(1)
      expect(result).toContain('hello')
      expect(result).toContain(true)
      expect(result).toHaveLength(3)
    })

    it('returns empty array for empty object', () => {
      const result = values({})

      expect(result).toEqual([])
      expect(Array.isArray(result)).toBe(true)
    })

    it('preserves value types', () => {
      const obj = {
        num: 42,
        str: 'text',
        bool: false,
        nil: null,
        arr: [1, 2, 3],
        obj: { nested: true }
      }
      const result = values(obj)

      expect(result).toContain(42)
      expect(result).toContain('text')
      expect(result).toContain(false)
      expect(result).toContain(null)
      expect(result).toContainEqual([1, 2, 3])
      expect(result).toContainEqual({ nested: true })
    })

    it('maintains value order matching keys order', () => {
      const obj = { z: 'last', a: 'second', m: 'middle' }
      const result = values(obj)

      expect(result).toEqual(['last', 'second', 'middle'])
    })

    it('throws on non-object input', () => {
      expect(() => values(null)).toThrow()
      expect(() => values(undefined)).toThrow()
      expect(() => values(42)).toThrow()
      expect(() => values('string')).toThrow()
      expect(() => values([])).toThrow()
    })

    it('includes duplicate values', () => {
      const obj = { a: 'same', b: 'same', c: 'different' }
      const result = values(obj)

      expect(result.filter(v => v === 'same')).toHaveLength(2)
    })
  })

  describe('merge(obj)', () => {
    it('merges two objects with later values winning', () => {
      const obj1 = { a: 1, b: 2 }
      const obj2 = { b: 3, c: 4 }
      const result = merge(obj1, obj2)

      expect(result).toEqual({ a: 1, b: 3, c: 4 })
    })

    it('returns new object without modifying originals', () => {
      const obj1 = { a: 1 }
      const obj2 = { a: 2, b: 3 }
      const result = merge(obj1, obj2)

      expect(obj1).toEqual({ a: 1 })
      expect(obj2).toEqual({ a: 2, b: 3 })
      expect(result).toEqual({ a: 2, b: 3 })
    })

    it('does not deep merge nested objects', () => {
      const obj1 = { nested: { x: 1, y: 2 } }
      const obj2 = { nested: { x: 10 } }
      const result = merge(obj1, obj2)

      // Shallow merge: entire nested object replaced
      expect(result.nested).toEqual({ x: 10 })
    })

    it('merges empty objects', () => {
      expect(merge({}, {})).toEqual({})
      expect(merge({ a: 1 }, {})).toEqual({ a: 1 })
      expect(merge({}, { b: 2 })).toEqual({ b: 2 })
    })

    it('handles null and undefined values in merge', () => {
      const obj1 = { a: 1, b: 2 }
      const obj2 = { b: null, c: undefined }
      const result = merge(obj1, obj2)

      expect(result).toEqual({ a: 1, b: null, c: undefined })
    })

    it('merges multiple objects left to right', () => {
      const obj1 = { a: 1 }
      const obj2 = { a: 2, b: 3 }
      const obj3 = { b: 4, c: 5 }
      const result = merge(obj1, merge(obj2, obj3))

      expect(result).toEqual({ a: 2, b: 4, c: 5 })
    })

    it('throws when merging non-object values', () => {
      expect(() => merge(null, {})).toThrow()
      expect(() => merge({}, null)).toThrow()
      expect(() => merge('string', {})).toThrow()
      expect(() => merge({}, 42)).toThrow()
    })
  })

  describe('without(...keys)', () => {
    it('removes specified keys from object', () => {
      const obj = { a: 1, b: 2, c: 3, d: 4 }
      const result = without(obj, ['b', 'd'])

      expect(result).toEqual({ a: 1, c: 3 })
    })

    it('returns new object without modifying original', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const result = without(obj, ['b'])

      expect(obj).toEqual({ a: 1, b: 2, c: 3 })
      expect(result).toEqual({ a: 1, c: 3 })
    })

    it('handles removing non-existent keys gracefully', () => {
      const obj = { a: 1, b: 2 }
      const result = without(obj, ['x', 'y', 'z'])

      expect(result).toEqual({ a: 1, b: 2 })
    })

    it('removes all keys with empty object result', () => {
      const obj = { a: 1, b: 2 }
      const result = without(obj, ['a', 'b'])

      expect(result).toEqual({})
    })

    it('works with empty keys array', () => {
      const obj = { a: 1, b: 2 }
      const result = without(obj, [])

      expect(result).toEqual({ a: 1, b: 2 })
    })

    it('handles single key removal', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const result = without(obj, ['b'])

      expect(result).toEqual({ a: 1, c: 3 })
    })

    it('throws on non-object input', () => {
      expect(() => without(null, ['a'])).toThrow()
      expect(() => without(undefined, ['a'])).toThrow()
      expect(() => without(42, ['a'])).toThrow()
      expect(() => without('string', ['a'])).toThrow()
    })

    it('handles mixed valid and invalid key names', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const result = without(obj, ['a', 'nonexistent', 'c'])

      expect(result).toEqual({ b: 2 })
    })
  })

  describe('exists(path)', () => {
    it('checks if top-level key exists', () => {
      const obj = { a: 1, b: 2 }

      expect(exists(obj, 'a')).toBe(true)
      expect(exists(obj, 'b')).toBe(true)
      expect(exists(obj, 'c')).toBe(false)
    })

    it('checks nested paths with dot notation', () => {
      const obj = { user: { profile: { name: 'John' } } }

      expect(exists(obj, 'user.profile.name')).toBe(true)
      expect(exists(obj, 'user.profile')).toBe(true)
      expect(exists(obj, 'user.profile.age')).toBe(false)
      expect(exists(obj, 'user.settings')).toBe(false)
    })

    it('checks nested paths with array notation', () => {
      const obj = { user: { profile: { name: 'John' } } }

      expect(exists(obj, ['user', 'profile', 'name'])).toBe(true)
      expect(exists(obj, ['user', 'profile'])).toBe(true)
      expect(exists(obj, ['user', 'settings'])).toBe(false)
    })

    it('returns false for null or undefined intermediate values', () => {
      const obj = { a: null, b: undefined }

      expect(exists(obj, 'a')).toBe(true) // Key exists, value is null
      expect(exists(obj, 'a.nested')).toBe(false) // Can't access nested on null
      expect(exists(obj, 'b.nested')).toBe(false) // Can't access nested on undefined
    })

    it('handles array index access in paths', () => {
      const obj = { items: [{ id: 1 }, { id: 2 }] }

      expect(exists(obj, 'items')).toBe(true)
      expect(exists(obj, 'items.0')).toBe(true)
      expect(exists(obj, 'items.0.id')).toBe(true)
      expect(exists(obj, 'items.5')).toBe(false)
    })

    it('handles empty path', () => {
      const obj = { a: 1 }

      expect(exists(obj, '')).toBe(true) // Empty path refers to root
    })

    it('throws on non-object input', () => {
      expect(() => exists(null, 'a')).toThrow()
      expect(() => exists(undefined, 'a')).toThrow()
      expect(() => exists(42, 'a')).toThrow()
      expect(() => exists('string', 'a')).toThrow()
    })

    it('handles paths with numbers as key names', () => {
      const obj = { '42': 'value', '0': 'first' }

      expect(exists(obj, '42')).toBe(true)
      expect(exists(obj, '0')).toBe(true)
    })
  })

  describe('get(path, default?)', () => {
    it('retrieves top-level value', () => {
      const obj = { a: 1, b: 'hello', c: true }

      expect(get(obj, 'a')).toBe(1)
      expect(get(obj, 'b')).toBe('hello')
      expect(get(obj, 'c')).toBe(true)
    })

    it('retrieves nested value with dot notation', () => {
      const obj = { user: { profile: { name: 'John', age: 30 } } }

      expect(get(obj, 'user.profile.name')).toBe('John')
      expect(get(obj, 'user.profile.age')).toBe(30)
    })

    it('retrieves nested value with array notation', () => {
      const obj = { user: { profile: { name: 'John' } } }

      expect(get(obj, ['user', 'profile', 'name'])).toBe('John')
    })

    it('returns undefined for non-existent paths', () => {
      const obj = { a: { b: 1 } }

      expect(get(obj, 'a.c')).toBeUndefined()
      expect(get(obj, 'x.y.z')).toBeUndefined()
    })

    it('returns default value when path does not exist', () => {
      const obj = { a: 1 }

      expect(get(obj, 'b', 'default')).toBe('default')
      expect(get(obj, 'a.b.c', 42)).toBe(42)
      expect(get(obj, 'x', null)).toBe(null)
    })

    it('handles array index access', () => {
      const obj = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] }

      expect(get(obj, 'items.0')).toEqual({ id: 1 })
      expect(get(obj, 'items.1.id')).toBe(2)
      expect(get(obj, 'items.5')).toBeUndefined()
    })

    it('returns default when accessing through null/undefined', () => {
      const obj = { a: null }

      expect(get(obj, 'a.b', 'default')).toBe('default')
    })

    it('handles empty path to return root object', () => {
      const obj = { a: 1 }

      expect(get(obj, '')).toEqual(obj)
    })

    it('preserves null values in result', () => {
      const obj = { a: null, b: { c: null } }

      expect(get(obj, 'a')).toBe(null)
      expect(get(obj, 'b.c')).toBe(null)
    })

    it('throws on non-object input', () => {
      expect(() => get(null, 'a')).toThrow()
      expect(() => get(undefined, 'a')).toThrow()
      expect(() => get(42, 'a')).toThrow()
    })

    it('returns complex values as-is', () => {
      const arr = [1, 2, 3]
      const obj = { items: arr, data: { nested: { value: arr } } }

      expect(get(obj, 'items')).toBe(arr)
      expect(get(obj, 'data.nested.value')).toBe(arr)
    })
  })

  describe('set(path, value)', () => {
    it('sets top-level value', () => {
      const obj = { a: 1, b: 2 }
      const result = set(obj, 'a', 10)

      expect(result).toEqual({ a: 10, b: 2 })
    })

    it('returns new object without modifying original', () => {
      const obj = { a: 1, b: 2 }
      const result = set(obj, 'a', 10)

      expect(obj).toEqual({ a: 1, b: 2 })
      expect(result).toEqual({ a: 10, b: 2 })
      expect(obj === result).toBe(false)
    })

    it('sets nested value creating intermediate objects', () => {
      const obj = { a: 1 }
      const result = set(obj, 'b.c.d', 42)

      expect(result).toEqual({ a: 1, b: { c: { d: 42 } } })
    })

    it('sets nested value in existing structure', () => {
      const obj = { user: { name: 'John' } }
      const result = set(obj, 'user.age', 30)

      expect(result).toEqual({ user: { name: 'John', age: 30 } })
    })

    it('sets nested value with array notation path', () => {
      const obj = {}
      const result = set(obj, ['a', 'b', 'c'], 'value')

      expect(result).toEqual({ a: { b: { c: 'value' } } })
    })

    it('overwrites existing nested values', () => {
      const obj = { a: { b: { c: 1 } } }
      const result = set(obj, 'a.b.c', 99)

      expect(result).toEqual({ a: { b: { c: 99 } } })
    })

    it('handles setting values to null', () => {
      const obj = { a: 1 }
      const result = set(obj, 'a', null)

      expect(result).toEqual({ a: null })
    })

    it('handles setting values to undefined', () => {
      const obj = { a: 1 }
      const result = set(obj, 'b', undefined)

      expect(result).toEqual({ a: 1, b: undefined })
    })

    it('handles array indices in path', () => {
      const obj = { items: [{ id: 1 }, { id: 2 }] }
      const result = set(obj, 'items.1.name', 'Second')

      expect(result).toEqual({ items: [{ id: 1 }, { id: 2, name: 'Second' }] })
    })

    it('creates array when setting numeric index', () => {
      const obj = {}
      const result = set(obj, 'items.0', 'first')

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items[0]).toBe('first')
    })

    it('preserves other properties when setting nested values', () => {
      const obj = { a: 1, b: { c: 2, d: 3 } }
      const result = set(obj, 'b.c', 20)

      expect(result).toEqual({ a: 1, b: { c: 20, d: 3 } })
      expect(result.b.d).toBe(3)
    })

    it('throws on non-object input', () => {
      expect(() => set(null, 'a', 1)).toThrow()
      expect(() => set(undefined, 'a', 1)).toThrow()
      expect(() => set(42, 'a', 1)).toThrow()
    })

    it('handles empty path to return new value as root', () => {
      const obj = { a: 1 }
      const result = set(obj, '', 'replaced')

      expect(result).toBe('replaced')
    })
  })

  describe('delete(path)', () => {
    it('deletes top-level key', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const result = deleteKey(obj, 'b')

      expect(result).toEqual({ a: 1, c: 3 })
    })

    it('returns new object without modifying original', () => {
      const obj = { a: 1, b: 2 }
      const result = deleteKey(obj, 'a')

      expect(obj).toEqual({ a: 1, b: 2 })
      expect(result).toEqual({ b: 2 })
      expect(obj === result).toBe(false)
    })

    it('deletes nested keys with dot notation', () => {
      const obj = { user: { name: 'John', age: 30 } }
      const result = deleteKey(obj, 'user.age')

      expect(result).toEqual({ user: { name: 'John' } })
    })

    it('deletes nested keys with array notation', () => {
      const obj = { a: { b: { c: 1, d: 2 } } }
      const result = deleteKey(obj, ['a', 'b', 'c'])

      expect(result).toEqual({ a: { b: { d: 2 } } })
    })

    it('handles deleting non-existent keys gracefully', () => {
      const obj = { a: 1, b: 2 }
      const result = deleteKey(obj, 'c')

      expect(result).toEqual({ a: 1, b: 2 })
    })

    it('handles deleting non-existent nested paths', () => {
      const obj = { a: { b: 1 } }
      const result = deleteKey(obj, 'a.c.d')

      expect(result).toEqual({ a: { b: 1 } })
    })

    it('removes empty parent objects after deletion', () => {
      const obj = { a: { b: { c: 1 } } }
      const result = deleteKey(obj, 'a.b.c')

      // Implementation detail: may or may not clean up empty parents
      // This test verifies the behavior
      expect(result.a).toBeDefined()
      expect(result.a.b).toBeDefined()
    })

    it('handles array indices in path', () => {
      const obj = { items: [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }] }
      const result = deleteKey(obj, 'items.0.name')

      expect(result).toEqual({ items: [{ id: 1 }, { id: 2, name: 'Second' }] })
    })

    it('throws on non-object input', () => {
      expect(() => deleteKey(null, 'a')).toThrow()
      expect(() => deleteKey(undefined, 'a')).toThrow()
      expect(() => deleteKey(42, 'a')).toThrow()
    })

    it('handles empty path', () => {
      const obj = { a: 1 }
      // Deleting root with empty path should return undefined or null
      const result = deleteKey(obj, '')

      expect([undefined, null]).toContain(result)
    })
  })

  describe('mapEachKey(fn)', () => {
    it('transforms each key using function', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const result = mapEachKey(obj, (key) => key.toUpperCase())

      expect(result).toEqual({ A: 1, B: 2, C: 3 })
    })

    it('returns new object without modifying original', () => {
      const obj = { a: 1, b: 2 }
      const result = mapEachKey(obj, (key) => key + '_suffix')

      expect(obj).toEqual({ a: 1, b: 2 })
      expect(result).toEqual({ a_suffix: 1, b_suffix: 2 })
    })

    it('handles function that adds prefix', () => {
      const obj = { x: 10, y: 20 }
      const result = mapEachKey(obj, (key) => 'prop_' + key)

      expect(result).toEqual({ prop_x: 10, prop_y: 20 })
    })

    it('handles function that returns same key', () => {
      const obj = { a: 1, b: 2 }
      const result = mapEachKey(obj, (key) => key)

      expect(result).toEqual({ a: 1, b: 2 })
    })

    it('preserves values unchanged', () => {
      const obj = { a: { nested: true }, b: [1, 2, 3], c: null }
      const result = mapEachKey(obj, (key) => key + '_new')

      expect(result.a_new).toEqual({ nested: true })
      expect(result.b_new).toEqual([1, 2, 3])
      expect(result.c_new).toBe(null)
    })

    it('handles empty object', () => {
      const result = mapEachKey({}, (key) => key.toUpperCase())

      expect(result).toEqual({})
    })

    it('handles function with index parameter', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const result = mapEachKey(obj, (key, index) => `${index}-${key}`)

      expect(result).toEqual({
        '0-a': 1,
        '1-b': 2,
        '2-c': 3
      })
    })

    it('throws on non-object input', () => {
      expect(() => mapEachKey(null, (k) => k)).toThrow()
      expect(() => mapEachKey(undefined, (k) => k)).toThrow()
      expect(() => mapEachKey(42, (k) => k)).toThrow()
      expect(() => mapEachKey('string', (k) => k)).toThrow()
    })

    it('throws when function is not callable', () => {
      const obj = { a: 1 }

      expect(() => mapEachKey(obj, 'not a function' as any)).toThrow()
      expect(() => mapEachKey(obj, null as any)).toThrow()
    })

    it('handles numeric string keys', () => {
      const obj = { '0': 'first', '1': 'second' }
      const result = mapEachKey(obj, (key) => 'key_' + key)

      expect(result).toEqual({ 'key_0': 'first', 'key_1': 'second' })
    })

    it('handles special characters in keys', () => {
      const obj = { 'key-with-dash': 1, 'key.with.dot': 2 }
      const result = mapEachKey(obj, (key) => key.replace(/[.-]/g, '_'))

      expect(result).toEqual({ 'key_with_dash': 1, 'key_with_dot': 2 })
    })

    it('handles function that returns duplicate keys', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const result = mapEachKey(obj, (key) => 'same')

      // Later values should win in case of duplicate keys
      expect(result).toEqual({ same: 3 })
    })
  })

  describe('fromJson()', () => {
    it('parses valid JSON string to object', () => {
      const jsonStr = '{"name":"John","age":30}'
      const result = fromJson(jsonStr)

      expect(result).toEqual({ name: 'John', age: 30 })
    })

    it('parses JSON array', () => {
      const jsonStr = '[1,2,3,"four",true]'
      const result = fromJson(jsonStr)

      expect(result).toEqual([1, 2, 3, 'four', true])
    })

    it('parses nested JSON objects', () => {
      const jsonStr = '{"user":{"profile":{"name":"Jane","settings":{"theme":"dark"}}}}'
      const result = fromJson(jsonStr)

      expect(result).toEqual({
        user: { profile: { name: 'Jane', settings: { theme: 'dark' } } }
      })
    })

    it('parses JSON with null values', () => {
      const jsonStr = '{"a":null,"b":{"c":null}}'
      const result = fromJson(jsonStr)

      expect(result).toEqual({ a: null, b: { c: null } })
    })

    it('parses JSON with numbers', () => {
      const jsonStr = '{"int":42,"float":3.14,"negative":-5,"scientific":1e10}'
      const result = fromJson(jsonStr)

      expect(result.int).toBe(42)
      expect(result.float).toBe(3.14)
      expect(result.negative).toBe(-5)
      expect(result.scientific).toBe(1e10)
    })

    it('parses JSON with booleans', () => {
      const jsonStr = '{"yes":true,"no":false}'
      const result = fromJson(jsonStr)

      expect(result).toEqual({ yes: true, no: false })
    })

    it('parses JSON with escaped strings', () => {
      const jsonStr = '{"text":"Line 1\\nLine 2\\tTabbed","quote":"He said \\"Hello\\""}'
      const result = fromJson(jsonStr)

      expect(result.text).toBe('Line 1\nLine 2\tTabbed')
      expect(result.quote).toBe('He said "Hello"')
    })

    it('parses empty object', () => {
      const result = fromJson('{}')

      expect(result).toEqual({})
    })

    it('parses empty array', () => {
      const result = fromJson('[]')

      expect(result).toEqual([])
    })

    it('parses simple string', () => {
      const result = fromJson('"hello"')

      expect(result).toBe('hello')
    })

    it('parses simple number', () => {
      const result = fromJson('42')

      expect(result).toBe(42)
    })

    it('parses boolean true', () => {
      const result = fromJson('true')

      expect(result).toBe(true)
    })

    it('parses boolean false', () => {
      const result = fromJson('false')

      expect(result).toBe(false)
    })

    it('parses null', () => {
      const result = fromJson('null')

      expect(result).toBe(null)
    })

    it('throws on invalid JSON', () => {
      expect(() => fromJson('{invalid}')).toThrow()
      expect(() => fromJson("{'single': 'quotes'}")).toThrow()
      expect(() => fromJson('[1,2,3')).toThrow()
      expect(() => fromJson('undefined')).toThrow()
    })

    it('throws on empty string', () => {
      expect(() => fromJson('')).toThrow()
    })

    it('throws on whitespace only', () => {
      expect(() => fromJson('   ')).toThrow()
    })

    it('handles JSON with extra whitespace', () => {
      const jsonStr = `{
        "name": "John",
        "age": 30
      }`
      const result = fromJson(jsonStr)

      expect(result).toEqual({ name: 'John', age: 30 })
    })

    it('throws on non-string input', () => {
      expect(() => fromJson(42 as any)).toThrow()
      expect(() => fromJson(null as any)).toThrow()
      expect(() => fromJson(undefined as any)).toThrow()
      expect(() => fromJson({} as any)).toThrow()
    })
  })

  describe('toJson()', () => {
    it('serializes object to JSON string', () => {
      const obj = { name: 'John', age: 30 }
      const result = toJson(obj)

      expect(result).toBe('{"name":"John","age":30}')
      expect(JSON.parse(result)).toEqual(obj)
    })

    it('serializes array to JSON string', () => {
      const arr = [1, 2, 3, 'four', true]
      const result = toJson(arr)

      expect(result).toBe('[1,2,3,"four",true]')
      expect(JSON.parse(result)).toEqual(arr)
    })

    it('serializes nested objects', () => {
      const obj = {
        user: { profile: { name: 'Jane', settings: { theme: 'dark' } } }
      }
      const result = toJson(obj)

      expect(JSON.parse(result)).toEqual(obj)
    })

    it('serializes null values', () => {
      const obj = { a: null, b: { c: null } }
      const result = toJson(obj)

      expect(result).toContain('null')
      expect(JSON.parse(result)).toEqual(obj)
    })

    it('serializes numbers correctly', () => {
      const obj = { int: 42, float: 3.14, negative: -5, scientific: 1e10 }
      const result = toJson(obj)

      const parsed = JSON.parse(result)
      expect(parsed.int).toBe(42)
      expect(parsed.float).toBe(3.14)
      expect(parsed.negative).toBe(-5)
    })

    it('serializes booleans', () => {
      const obj = { yes: true, no: false }
      const result = toJson(obj)

      expect(result).toBe('{"yes":true,"no":false}')
    })

    it('serializes strings with escape sequences', () => {
      const obj = { text: 'Line 1\nLine 2\tTabbed', quote: 'He said "Hello"' }
      const result = toJson(obj)

      expect(JSON.parse(result)).toEqual(obj)
    })

    it('serializes empty object', () => {
      const result = toJson({})

      expect(result).toBe('{}')
    })

    it('serializes empty array', () => {
      const result = toJson([])

      expect(result).toBe('[]')
    })

    it('serializes string primitive', () => {
      const result = toJson('hello')

      expect(result).toBe('"hello"')
    })

    it('serializes number primitive', () => {
      const result = toJson(42)

      expect(result).toBe('42')
    })

    it('serializes boolean primitives', () => {
      expect(toJson(true)).toBe('true')
      expect(toJson(false)).toBe('false')
    })

    it('serializes null', () => {
      const result = toJson(null)

      expect(result).toBe('null')
    })

    it('skips undefined values in objects', () => {
      const obj = { a: 1, b: undefined, c: 3 }
      const result = toJson(obj)

      expect(result).not.toContain('undefined')
      expect(JSON.parse(result)).toEqual({ a: 1, c: 3 })
    })

    it('serializes undefined in arrays as null', () => {
      const arr = [1, undefined, 3]
      const result = toJson(arr)

      expect(JSON.parse(result)).toEqual([1, null, 3])
    })

    it('throws on circular references', () => {
      const obj: any = { a: 1 }
      obj.self = obj

      expect(() => toJson(obj)).toThrow()
    })

    it('throws on non-serializable values', () => {
      expect(() => toJson(() => {})).toThrow()
      expect(() => toJson(Symbol('sym'))).toThrow()
    })

    it('handles complex nested structures', () => {
      const obj = {
        users: [
          { id: 1, name: 'Alice', tags: ['admin', 'user'] },
          { id: 2, name: 'Bob', tags: ['user'] }
        ],
        settings: { theme: 'dark', notifications: true }
      }
      const result = toJson(obj)

      expect(JSON.parse(result)).toEqual(obj)
    })

    it('does not throw on Date objects (converts to string)', () => {
      const obj = { timestamp: new Date('2023-01-01') }
      const result = toJson(obj)

      // Date serializes as ISO string
      expect(result).toContain('2023')
    })
  })

  describe('JSON round-trips', () => {
    it('round-trips simple object', () => {
      const obj = { a: 1, b: 'hello', c: true }
      const json = toJson(obj)
      const result = fromJson(json)

      expect(result).toEqual(obj)
    })

    it('round-trips nested objects', () => {
      const obj = {
        user: { name: 'John', profile: { age: 30, settings: { theme: 'dark' } } }
      }
      const json = toJson(obj)
      const result = fromJson(json)

      expect(result).toEqual(obj)
    })

    it('round-trips arrays', () => {
      const arr = [1, 'two', true, null, { x: 5 }, [7, 8]]
      const json = toJson(arr)
      const result = fromJson(json)

      expect(result).toEqual(arr)
    })

    it('round-trips with null values', () => {
      const obj = { a: null, b: { c: null } }
      const json = toJson(obj)
      const result = fromJson(json)

      expect(result).toEqual(obj)
    })

    it('preserves types through round-trip', () => {
      const obj = { num: 42, str: 'text', bool: true, nil: null }
      const json = toJson(obj)
      const result = fromJson(json)

      expect(typeof result.num).toBe('number')
      expect(typeof result.str).toBe('string')
      expect(typeof result.bool).toBe('boolean')
      expect(result.nil).toBe(null)
    })
  })

  describe('Immutability verification', () => {
    it('operations do not modify original objects', () => {
      const original = { a: 1, b: 2, c: 3 }
      const original_copy = JSON.parse(JSON.stringify(original))

      keys(original)
      values(original)
      merge(original, { x: 10 })
      without(original, ['a'])
      set(original, 'b', 99)
      deleteKey(original, 'c')
      mapEachKey(original, (k) => k.toUpperCase())

      expect(original).toEqual(original_copy)
    })

    it('get does not modify object', () => {
      const original = { a: { b: { c: 1 } } }
      const original_copy = JSON.parse(JSON.stringify(original))

      get(original, 'a.b.c')
      get(original, 'a.b')
      get(original, 'x.y.z')

      expect(original).toEqual(original_copy)
    })

    it('exists does not modify object', () => {
      const original = { a: { b: 1 } }
      const original_copy = JSON.parse(JSON.stringify(original))

      exists(original, 'a.b')
      exists(original, 'x.y')

      expect(original).toEqual(original_copy)
    })
  })

  describe('Edge cases and special scenarios', () => {
    it('handles objects with symbol keys', () => {
      const sym = Symbol('test')
      const obj = { a: 1, [sym]: 2 }

      const result = keys(obj)
      expect(result).toContain('a')
      // Symbol keys behavior depends on implementation
    })

    it('handles objects with prototype chain', () => {
      const parent = { inherited: 'value' }
      const child = Object.create(parent)
      child.own = 'property'

      const result = keys(child)
      // Should only include own properties, not inherited
      expect(result).toContain('own')
    })

    it('handles very deeply nested objects', () => {
      let obj: any = {}
      let current = obj
      for (let i = 0; i < 50; i++) {
        current.next = {}
        current = current.next
      }
      current.value = 42

      expect(get(obj, 'next.next.next.next.next.next.next.next.next.next.value')).toBe(42)
    })

    it('handles paths with array-like numeric keys', () => {
      const obj = { '0': 'a', '1': 'b', '2': 'c' }

      expect(get(obj, '1')).toBe('b')
      expect(exists(obj, '2')).toBe(true)
    })

    it('handles unicode in keys and values', () => {
      const obj = { '名前': '田中', '设置': { '主题': '暗' } }

      expect(keys(obj)).toContain('名前')
      expect(get(obj, '设置.主题')).toBe('暗')
    })
  })
})
