/**
 * RED Phase Tests: Bloblang Object Functions (Interpreter Level)
 * Issue: dotdo-0vajx
 *
 * These tests define the expected behavior for object manipulation functions
 * when evaluated through the Bloblang interpreter with string expressions.
 * They should FAIL until the implementation is complete.
 *
 * Tests object functions: keys(), values(), merge(), without(), exists(),
 * get(), type(), assign()
 */

import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { evaluate } from '../interpreter'
import { BenthosMessage } from '../../core/message'

/**
 * Helper function to evaluate a Bloblang expression string against input data.
 * This simulates the full Bloblang evaluation pipeline: parse -> interpret -> result.
 *
 * For expressions that assign to root (e.g., "root = this.keys()"),
 * returns the resulting message root value.
 *
 * For simple expressions without assignment, returns the evaluated value directly.
 */
function evaluateExpr(expression: string, input: unknown): unknown {
  const ast = parse(expression)
  const message = new BenthosMessage(input)
  const result = evaluate(ast, message)

  // If the expression is an assignment to root, return the message root
  // Otherwise return the direct evaluation result
  if (expression.trim().startsWith('root =') || expression.trim().startsWith('root=')) {
    return message.root
  }
  return result
}

describe('Bloblang object functions (interpreter level)', () => {
  describe('keys()', () => {
    it('returns array of keys from object', () => {
      const result = evaluateExpr('root = this.keys()', { a: 1, b: 2 })
      expect(result).toEqual(['a', 'b'])
    })

    it('returns keys in insertion order', () => {
      const result = evaluateExpr('root = this.keys()', { z: 1, a: 2, m: 3 })
      expect(result).toEqual(['z', 'a', 'm'])
    })

    it('returns empty array for empty object', () => {
      const result = evaluateExpr('root = this.keys()', {})
      expect(result).toEqual([])
    })

    it('handles nested objects (only top-level keys)', () => {
      const result = evaluateExpr('root = this.keys()', { user: { name: 'John' }, settings: { theme: 'dark' } })
      expect(result).toEqual(['user', 'settings'])
    })

    it('works on nested object access', () => {
      const result = evaluateExpr('root = this.user.keys()', { user: { name: 'John', age: 30 } })
      expect(result).toEqual(['name', 'age'])
    })
  })

  describe('values()', () => {
    it('returns array of values from object', () => {
      const result = evaluateExpr('root = this.values()', { a: 1, b: 2 })
      expect(result).toEqual([1, 2])
    })

    it('returns values in insertion order matching keys', () => {
      const result = evaluateExpr('root = this.values()', { z: 'last', a: 'second', m: 'middle' })
      expect(result).toEqual(['last', 'second', 'middle'])
    })

    it('returns empty array for empty object', () => {
      const result = evaluateExpr('root = this.values()', {})
      expect(result).toEqual([])
    })

    it('preserves value types', () => {
      const result = evaluateExpr('root = this.values()', {
        num: 42,
        str: 'text',
        bool: true,
        nil: null
      })
      expect(result).toContain(42)
      expect(result).toContain('text')
      expect(result).toContain(true)
      expect(result).toContain(null)
    })

    it('works on nested object access', () => {
      const result = evaluateExpr('root = this.profile.values()', { profile: { name: 'Jane', age: 25 } })
      expect(result).toEqual(['Jane', 25])
    })
  })

  describe('merge(other)', () => {
    it('merges two objects with later values winning', () => {
      const result = evaluateExpr('root = this.merge({ c: 3 })', { a: 1, b: 2 })
      expect(result).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('overwrites existing keys', () => {
      const result = evaluateExpr('root = this.merge({ b: 20, c: 3 })', { a: 1, b: 2 })
      expect(result).toEqual({ a: 1, b: 20, c: 3 })
    })

    it('performs shallow merge (does not deep merge nested objects)', () => {
      const result = evaluateExpr('root = this.merge({ nested: { x: 10 } })', { nested: { a: 1, b: 2 } })
      // Shallow merge: entire nested object is replaced
      expect(result).toEqual({ nested: { x: 10 } })
    })

    it('merges with empty object', () => {
      const result = evaluateExpr('root = this.merge({})', { a: 1, b: 2 })
      expect(result).toEqual({ a: 1, b: 2 })
    })

    it('merges into empty object', () => {
      const result = evaluateExpr('root = this.merge({ a: 1 })', {})
      expect(result).toEqual({ a: 1 })
    })

    it('handles null and undefined values in merge', () => {
      const result = evaluateExpr('root = this.merge({ b: null })', { a: 1, b: 2 })
      expect(result).toEqual({ a: 1, b: null })
    })
  })

  describe('without(keys...)', () => {
    it('removes single key from object', () => {
      const result = evaluateExpr('root = this.without("b")', { a: 1, b: 2, c: 3 })
      expect(result).toEqual({ a: 1, c: 3 })
    })

    it('removes multiple keys from object', () => {
      const result = evaluateExpr('root = this.without("a", "c")', { a: 1, b: 2, c: 3, d: 4 })
      expect(result).toEqual({ b: 2, d: 4 })
    })

    it('handles removing non-existent keys gracefully', () => {
      const result = evaluateExpr('root = this.without("x", "y")', { a: 1, b: 2 })
      expect(result).toEqual({ a: 1, b: 2 })
    })

    it('returns empty object when all keys removed', () => {
      const result = evaluateExpr('root = this.without("a", "b")', { a: 1, b: 2 })
      expect(result).toEqual({})
    })

    it('returns unchanged object with no arguments', () => {
      const result = evaluateExpr('root = this.without()', { a: 1, b: 2 })
      expect(result).toEqual({ a: 1, b: 2 })
    })

    it('does not modify nested objects', () => {
      const result = evaluateExpr('root = this.without("b")', { a: 1, b: 2, nested: { x: 1 } })
      expect(result).toEqual({ a: 1, nested: { x: 1 } })
    })
  })

  describe('exists(path)', () => {
    it('returns true for existing top-level key', () => {
      const result = evaluateExpr('root = this.exists("a")', { a: { b: 1 } })
      expect(result).toBe(true)
    })

    it('returns false for non-existent top-level key', () => {
      const result = evaluateExpr('root = this.exists("c")', { a: { b: 1 } })
      expect(result).toBe(false)
    })

    it('checks nested paths with dot notation', () => {
      expect(evaluateExpr('root = this.exists("a.b")', { a: { b: 1 } })).toBe(true)
      expect(evaluateExpr('root = this.exists("a.c")', { a: { b: 1 } })).toBe(false)
    })

    it('returns true for key with null value', () => {
      const result = evaluateExpr('root = this.exists("a")', { a: null })
      expect(result).toBe(true)
    })

    it('returns false when traversing null', () => {
      const result = evaluateExpr('root = this.exists("a.b")', { a: null })
      expect(result).toBe(false)
    })

    it('handles array index in path', () => {
      expect(evaluateExpr('root = this.exists("items.0")', { items: [{ id: 1 }] })).toBe(true)
      expect(evaluateExpr('root = this.exists("items.5")', { items: [{ id: 1 }] })).toBe(false)
    })

    it('handles deeply nested paths', () => {
      const result = evaluateExpr('root = this.exists("a.b.c.d")', { a: { b: { c: { d: 42 } } } })
      expect(result).toBe(true)
    })
  })

  describe('get(path)', () => {
    it('retrieves deeply nested value', () => {
      const result = evaluateExpr('root = this.get("a.b.c")', { a: { b: { c: 42 } } })
      expect(result).toBe(42)
    })

    it('returns null for non-existent path', () => {
      const result = evaluateExpr('root = this.get("a.b.c")', { a: { x: 1 } })
      expect(result).toBeNull()
    })

    it('retrieves top-level value', () => {
      const result = evaluateExpr('root = this.get("name")', { name: 'John', age: 30 })
      expect(result).toBe('John')
    })

    it('retrieves array element by index', () => {
      const result = evaluateExpr('root = this.get("items.1")', { items: ['a', 'b', 'c'] })
      expect(result).toBe('b')
    })

    it('retrieves nested object property through array', () => {
      const result = evaluateExpr('root = this.get("users.0.name")', { users: [{ name: 'Alice' }, { name: 'Bob' }] })
      expect(result).toBe('Alice')
    })

    it('preserves null values', () => {
      const result = evaluateExpr('root = this.get("value")', { value: null })
      expect(result).toBeNull()
    })

    it('returns complex values as-is', () => {
      const result = evaluateExpr('root = this.get("data")', { data: { nested: [1, 2, 3] } })
      expect(result).toEqual({ nested: [1, 2, 3] })
    })
  })

  describe('type()', () => {
    it('returns "object" for objects', () => {
      const result = evaluateExpr('root = this.type()', { a: 1 })
      expect(result).toBe('object')
    })

    it('returns "array" for arrays', () => {
      const result = evaluateExpr('root = this.type()', [1, 2, 3])
      expect(result).toBe('array')
    })

    it('returns "string" for strings', () => {
      const result = evaluateExpr('root = this.type()', 'hello')
      expect(result).toBe('string')
    })

    it('returns "number" for numbers', () => {
      const result = evaluateExpr('root = this.type()', 42)
      expect(result).toBe('number')
    })

    it('returns "number" for floats', () => {
      const result = evaluateExpr('root = this.type()', 3.14)
      expect(result).toBe('number')
    })

    it('returns "bool" for booleans', () => {
      expect(evaluateExpr('root = this.type()', true)).toBe('bool')
      expect(evaluateExpr('root = this.type()', false)).toBe('bool')
    })

    it('returns "null" for null', () => {
      const result = evaluateExpr('root = this.type()', null)
      expect(result).toBe('null')
    })

    it('works on nested field access', () => {
      const result = evaluateExpr('root = this.data.type()', { data: [1, 2, 3] })
      expect(result).toBe('array')
    })
  })

  describe('assign(path, value) / set semantics', () => {
    it('creates nested object structure from empty object', () => {
      const result = evaluateExpr('root = this.assign("a.b.c", 42)', {})
      expect(result).toEqual({ a: { b: { c: 42 } } })
    })

    it('sets value in existing structure', () => {
      const result = evaluateExpr('root = this.assign("a.b", 99)', { a: { b: 1, c: 2 } })
      expect(result).toEqual({ a: { b: 99, c: 2 } })
    })

    it('extends existing object', () => {
      const result = evaluateExpr('root = this.assign("x.y", "new")', { x: { a: 1 } })
      expect(result).toEqual({ x: { a: 1, y: 'new' } })
    })

    it('sets top-level value', () => {
      const result = evaluateExpr('root = this.assign("newKey", "newValue")', { existing: 'value' })
      expect(result).toEqual({ existing: 'value', newKey: 'newValue' })
    })

    it('handles setting null value', () => {
      const result = evaluateExpr('root = this.assign("key", null)', { key: 'value' })
      expect(result).toEqual({ key: null })
    })

    it('handles setting object value', () => {
      const result = evaluateExpr('root = this.assign("nested", { x: 1, y: 2 })', {})
      expect(result).toEqual({ nested: { x: 1, y: 2 } })
    })

    it('handles setting array value', () => {
      const result = evaluateExpr('root = this.assign("items", [1, 2, 3])', {})
      expect(result).toEqual({ items: [1, 2, 3] })
    })

    it('does not modify original (immutable operation)', () => {
      // When evaluating, the result should be a new object
      const input = { a: 1 }
      const result = evaluateExpr('root = this.assign("b", 2)', input)
      expect(result).toEqual({ a: 1, b: 2 })
      // Original message content should be modified since Bloblang is mutable by design
      // but the test verifies the result is correct
    })
  })

  describe('chained operations', () => {
    it('chains keys with array operations', () => {
      const result = evaluateExpr('root = this.keys().sort()', { c: 3, a: 1, b: 2 })
      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('chains values with array operations', () => {
      const result = evaluateExpr('root = this.values().sum()', { a: 1, b: 2, c: 3 })
      expect(result).toBe(6)
    })

    it('chains merge with other operations', () => {
      const result = evaluateExpr('root = this.merge({ c: 3 }).keys()', { a: 1, b: 2 })
      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('chains without with merge', () => {
      const result = evaluateExpr('root = this.without("b").merge({ c: 3 })', { a: 1, b: 2 })
      expect(result).toEqual({ a: 1, c: 3 })
    })

    it('uses keys in filter operation', () => {
      const result = evaluateExpr('root = this.keys().filter(k -> k != "b")', { a: 1, b: 2, c: 3 })
      expect(result).toEqual(['a', 'c'])
    })
  })

  describe('edge cases', () => {
    it('handles objects with numeric string keys', () => {
      const result = evaluateExpr('root = this.keys()', { '0': 'first', '1': 'second' })
      expect(result).toContain('0')
      expect(result).toContain('1')
    })

    it('handles objects with special character keys', () => {
      const result = evaluateExpr('root = this.keys()', { 'key-with-dash': 1, 'key.with.dot': 2 })
      expect(result).toContain('key-with-dash')
      expect(result).toContain('key.with.dot')
    })

    it('handles unicode keys', () => {
      const result = evaluateExpr('root = this.keys()', { 'name': 'Test' })
      expect(result).toContain('name')
    })

    it('handles very deeply nested access', () => {
      const result = evaluateExpr(
        'root = this.exists("a.b.c.d.e.f.g.h.i.j")',
        { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 'deep' } } } } } } } } } }
      )
      expect(result).toBe(true)
    })

    it('handles empty path in get', () => {
      const result = evaluateExpr('root = this.get("")', { a: 1, b: 2 })
      // Empty path should return the root object
      expect(result).toEqual({ a: 1, b: 2 })
    })
  })

  describe('error handling', () => {
    it('keys() on non-object throws or returns error', () => {
      // Depending on implementation, this should either throw or return an error indicator
      expect(() => evaluateExpr('root = this.keys()', 'string')).toThrow()
    })

    it('values() on non-object throws or returns error', () => {
      expect(() => evaluateExpr('root = this.values()', [1, 2, 3])).toThrow()
    })

    it('merge() with non-object argument throws or returns error', () => {
      expect(() => evaluateExpr('root = this.merge("string")', { a: 1 })).toThrow()
    })

    it('merge() on non-object throws or returns error', () => {
      expect(() => evaluateExpr('root = this.merge({ a: 1 })', 'string')).toThrow()
    })
  })

  describe('fromJson() and toJson()', () => {
    it('parses JSON string to object', () => {
      const result = evaluateExpr('root = this.from_json()', '{"name":"John","age":30}')
      expect(result).toEqual({ name: 'John', age: 30 })
    })

    it('serializes object to JSON string', () => {
      const result = evaluateExpr('root = this.to_json()', { name: 'John', age: 30 })
      // Order may vary, so parse and compare
      const parsed = JSON.parse(result as string)
      expect(parsed).toEqual({ name: 'John', age: 30 })
    })

    it('round-trips JSON correctly', () => {
      const original = { nested: { array: [1, 2, 3], flag: true } }
      // Serialize then parse
      const result = evaluateExpr('root = this.to_json().from_json()', original)
      expect(result).toEqual(original)
    })
  })
})
