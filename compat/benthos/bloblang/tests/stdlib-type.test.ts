/**
 * RED Phase Tests: Bloblang Stdlib Type Functions
 * Issue: dotdo-yk5as - Bloblang Stdlib: Type Functions - Milestone 2
 *
 * These tests define the expected behavior for Bloblang's type conversion
 * and type checking functions in the stdlib. Tests should FAIL until the
 * implementation is complete.
 */

import { describe, it, expect } from 'vitest'
import {
  string,
  int,
  float,
  bool,
  array,
  object,
  type,
  isString,
  isNumber,
  isBool,
  isArray,
  isObject,
  isNull,
  notNull,
  or,
  catch_ // named catch_ since 'catch' is reserved
} from '../stdlib/type'

describe('Bloblang Stdlib Type Functions', () => {
  describe('string() - Convert to string', () => {
    it('converts number to string', () => {
      expect(string.call(42)).toBe('42')
    })

    it('converts float to string', () => {
      expect(string.call(3.14)).toBe('3.14')
    })

    it('converts boolean true to string', () => {
      expect(string.call(true)).toBe('true')
    })

    it('converts boolean false to string', () => {
      expect(string.call(false)).toBe('false')
    })

    it('returns string unchanged', () => {
      expect(string.call('hello')).toBe('hello')
    })

    it('converts null to string', () => {
      expect(string.call(null)).toBe('null')
    })

    it('converts array to JSON string', () => {
      expect(string.call([1, 2, 3])).toBe('[1,2,3]')
    })

    it('converts object to JSON string', () => {
      const result = string.call({ name: 'John', age: 30 })
      const parsed = JSON.parse(result)
      expect(parsed).toEqual({ name: 'John', age: 30 })
    })

    it('handles empty array', () => {
      expect(string.call([])).toBe('[]')
    })

    it('handles empty object', () => {
      const result = string.call({})
      expect(result).toBe('{}')
    })
  })

  describe('int() - Convert to integer', () => {
    it('converts string number to int', () => {
      expect(int.call('42')).toBe(42)
    })

    it('converts float to int by truncation', () => {
      expect(int.call(3.9)).toBe(3)
    })

    it('converts negative float to int by truncation', () => {
      expect(int.call(-3.9)).toBe(-3)
    })

    it('converts boolean true to 1', () => {
      expect(int.call(true)).toBe(1)
    })

    it('converts boolean false to 0', () => {
      expect(int.call(false)).toBe(0)
    })

    it('returns integer unchanged', () => {
      expect(int.call(42)).toBe(42)
    })

    it('converts string with leading/trailing whitespace', () => {
      expect(int.call('  123  ')).toBe(123)
    })

    it('converts negative string number', () => {
      expect(int.call('-456')).toBe(-456)
    })

    it('converts zero', () => {
      expect(int.call(0)).toBe(0)
    })

    it('converts string zero', () => {
      expect(int.call('0')).toBe(0)
    })

    it('throws on non-numeric string', () => {
      expect(() => int.call('not a number')).toThrow()
    })

    it('throws on null', () => {
      expect(() => int.call(null)).toThrow()
    })

    it('throws on array', () => {
      expect(() => int.call([1, 2, 3])).toThrow()
    })

    it('throws on object', () => {
      expect(() => int.call({ value: 42 })).toThrow()
    })
  })

  describe('float() - Convert to float', () => {
    it('converts string number to float', () => {
      expect(float.call('3.14')).toBe(3.14)
    })

    it('converts integer to float', () => {
      expect(float.call(42)).toBe(42.0)
    })

    it('converts boolean true to 1.0', () => {
      expect(float.call(true)).toBe(1.0)
    })

    it('converts boolean false to 0.0', () => {
      expect(float.call(false)).toBe(0.0)
    })

    it('returns float unchanged', () => {
      expect(float.call(3.14)).toBe(3.14)
    })

    it('converts string with whitespace', () => {
      expect(float.call('  3.14  ')).toBe(3.14)
    })

    it('converts negative float string', () => {
      expect(float.call('-2.71')).toBe(-2.71)
    })

    it('converts scientific notation', () => {
      expect(float.call('1e10')).toBe(1e10)
    })

    it('converts negative scientific notation', () => {
      expect(float.call('2.5e-3')).toBe(2.5e-3)
    })

    it('throws on non-numeric string', () => {
      expect(() => float.call('not a number')).toThrow()
    })

    it('throws on null', () => {
      expect(() => float.call(null)).toThrow()
    })
  })

  describe('bool() - Convert to boolean', () => {
    it('converts 0 to false', () => {
      expect(bool.call(0)).toBe(false)
    })

    it('converts non-zero number to true', () => {
      expect(bool.call(1)).toBe(true)
    })

    it('converts negative number to true', () => {
      expect(bool.call(-5)).toBe(true)
    })

    it('converts empty string to false', () => {
      expect(bool.call('')).toBe(false)
    })

    it('converts non-empty string to true', () => {
      expect(bool.call('hello')).toBe(true)
    })

    it('converts "false" string to true (non-empty string)', () => {
      expect(bool.call('false')).toBe(true)
    })

    it('converts null to false', () => {
      expect(bool.call(null)).toBe(false)
    })

    it('converts true to true', () => {
      expect(bool.call(true)).toBe(true)
    })

    it('converts false to false', () => {
      expect(bool.call(false)).toBe(false)
    })

    it('converts empty array to false', () => {
      expect(bool.call([])).toBe(false)
    })

    it('converts non-empty array to true', () => {
      expect(bool.call([1, 2, 3])).toBe(true)
    })

    it('converts empty object to false', () => {
      expect(bool.call({})).toBe(false)
    })

    it('converts non-empty object to true', () => {
      expect(bool.call({ name: 'John' })).toBe(true)
    })

    it('converts float 0.0 to false', () => {
      expect(bool.call(0.0)).toBe(false)
    })

    it('converts float 0.1 to true', () => {
      expect(bool.call(0.1)).toBe(true)
    })
  })

  describe('array() - Wrap in array if not already', () => {
    it('wraps string in array', () => {
      expect(array.call('hello')).toEqual(['hello'])
    })

    it('wraps number in array', () => {
      expect(array.call(42)).toEqual([42])
    })

    it('wraps boolean in array', () => {
      expect(array.call(true)).toEqual([true])
    })

    it('wraps object in array', () => {
      const obj = { name: 'John' }
      expect(array.call(obj)).toEqual([obj])
    })

    it('wraps null in array', () => {
      expect(array.call(null)).toEqual([null])
    })

    it('returns array unchanged', () => {
      const arr = [1, 2, 3]
      expect(array.call(arr)).toEqual([1, 2, 3])
    })

    it('returns same array reference', () => {
      const arr = [1, 2, 3]
      expect(array.call(arr)).toBe(arr)
    })

    it('wraps empty string in array', () => {
      expect(array.call('')).toEqual([''])
    })

    it('wraps zero in array', () => {
      expect(array.call(0)).toEqual([0])
    })

    it('returns empty array unchanged', () => {
      const arr: any[] = []
      expect(array.call(arr)).toEqual([])
      expect(array.call(arr)).toBe(arr)
    })

    it('wraps nested array in array', () => {
      const nested = [[1, 2], [3, 4]]
      expect(array.call(nested)).toEqual([nested])
    })
  })

  describe('object() - Convert to object (for entries)', () => {
    it('converts entries array to object', () => {
      const entries = [['key1', 'value1'], ['key2', 'value2']]
      const result = object.call(entries)
      expect(result).toEqual({ key1: 'value1', key2: 'value2' })
    })

    it('returns object unchanged', () => {
      const obj = { name: 'John', age: 30 }
      expect(object.call(obj)).toEqual(obj)
    })

    it('converts single entry array', () => {
      const result = object.call([['key', 'value']])
      expect(result).toEqual({ key: 'value' })
    })

    it('handles empty entries array', () => {
      const result = object.call([])
      expect(result).toEqual({})
    })

    it('converts entries with numeric values', () => {
      const entries = [['a', 1], ['b', 2], ['c', 3]]
      const result = object.call(entries)
      expect(result).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('converts entries with nested objects', () => {
      const entries = [['config', { debug: true }], ['data', [1, 2, 3]]]
      const result = object.call(entries)
      expect(result).toEqual({ config: { debug: true }, data: [1, 2, 3] })
    })

    it('later entries override earlier ones with same key', () => {
      const entries = [['key', 'first'], ['key', 'second']]
      const result = object.call(entries)
      expect(result).toEqual({ key: 'second' })
    })

    it('throws on non-array entries (except object)', () => {
      expect(() => object.call('not an array')).toThrow()
    })

    it('throws on null', () => {
      expect(() => object.call(null)).toThrow()
    })

    it('handles entries with non-string keys', () => {
      // Bloblang should convert keys to strings
      const entries = [[1, 'one'], [2, 'two']]
      const result = object.call(entries)
      expect(result).toEqual({ '1': 'one', '2': 'two' })
    })
  })

  describe('type() - Return type name as string', () => {
    it('returns "string" for string', () => {
      expect(type.call('hello')).toBe('string')
    })

    it('returns "number" for integer', () => {
      expect(type.call(42)).toBe('number')
    })

    it('returns "number" for float', () => {
      expect(type.call(3.14)).toBe('number')
    })

    it('returns "bool" for true', () => {
      expect(type.call(true)).toBe('bool')
    })

    it('returns "bool" for false', () => {
      expect(type.call(false)).toBe('bool')
    })

    it('returns "array" for array', () => {
      expect(type.call([1, 2, 3])).toBe('array')
    })

    it('returns "object" for object', () => {
      expect(type.call({ name: 'John' })).toBe('object')
    })

    it('returns "null" for null', () => {
      expect(type.call(null)).toBe('null')
    })

    it('returns "array" for empty array', () => {
      expect(type.call([])).toBe('array')
    })

    it('returns "object" for empty object', () => {
      expect(type.call({})).toBe('object')
    })

    it('returns "string" for empty string', () => {
      expect(type.call('')).toBe('string')
    })
  })

  describe('is_string() - Type check for string', () => {
    it('returns true for string', () => {
      expect(isString.call('hello')).toBe(true)
    })

    it('returns false for number', () => {
      expect(isString.call(42)).toBe(false)
    })

    it('returns false for boolean', () => {
      expect(isString.call(true)).toBe(false)
    })

    it('returns false for array', () => {
      expect(isString.call([1, 2])).toBe(false)
    })

    it('returns false for object', () => {
      expect(isString.call({ name: 'John' })).toBe(false)
    })

    it('returns false for null', () => {
      expect(isString.call(null)).toBe(false)
    })

    it('returns true for empty string', () => {
      expect(isString.call('')).toBe(true)
    })
  })

  describe('is_number() - Type check for number', () => {
    it('returns true for integer', () => {
      expect(isNumber.call(42)).toBe(true)
    })

    it('returns true for float', () => {
      expect(isNumber.call(3.14)).toBe(true)
    })

    it('returns true for zero', () => {
      expect(isNumber.call(0)).toBe(true)
    })

    it('returns true for negative number', () => {
      expect(isNumber.call(-42)).toBe(true)
    })

    it('returns false for string', () => {
      expect(isNumber.call('42')).toBe(false)
    })

    it('returns false for boolean', () => {
      expect(isNumber.call(true)).toBe(false)
    })

    it('returns false for array', () => {
      expect(isNumber.call([42])).toBe(false)
    })

    it('returns false for object', () => {
      expect(isNumber.call({ value: 42 })).toBe(false)
    })

    it('returns false for null', () => {
      expect(isNumber.call(null)).toBe(false)
    })
  })

  describe('is_bool() - Type check for boolean', () => {
    it('returns true for true', () => {
      expect(isBool.call(true)).toBe(true)
    })

    it('returns true for false', () => {
      expect(isBool.call(false)).toBe(true)
    })

    it('returns false for number', () => {
      expect(isBool.call(0)).toBe(false)
    })

    it('returns false for string', () => {
      expect(isBool.call('true')).toBe(false)
    })

    it('returns false for array', () => {
      expect(isBool.call([true])).toBe(false)
    })

    it('returns false for object', () => {
      expect(isBool.call({ value: true })).toBe(false)
    })

    it('returns false for null', () => {
      expect(isBool.call(null)).toBe(false)
    })
  })

  describe('is_array() - Type check for array', () => {
    it('returns true for array', () => {
      expect(isArray.call([1, 2, 3])).toBe(true)
    })

    it('returns true for empty array', () => {
      expect(isArray.call([])).toBe(true)
    })

    it('returns false for object', () => {
      expect(isArray.call({ 0: 1, 1: 2 })).toBe(false)
    })

    it('returns false for string', () => {
      expect(isArray.call('[1, 2, 3]')).toBe(false)
    })

    it('returns false for number', () => {
      expect(isArray.call(42)).toBe(false)
    })

    it('returns false for boolean', () => {
      expect(isArray.call(true)).toBe(false)
    })

    it('returns false for null', () => {
      expect(isArray.call(null)).toBe(false)
    })

    it('returns true for nested array', () => {
      expect(isArray.call([[1, 2], [3, 4]])).toBe(true)
    })
  })

  describe('is_object() - Type check for object', () => {
    it('returns true for object', () => {
      expect(isObject.call({ name: 'John' })).toBe(true)
    })

    it('returns true for empty object', () => {
      expect(isObject.call({})).toBe(true)
    })

    it('returns false for array', () => {
      expect(isObject.call([1, 2, 3])).toBe(false)
    })

    it('returns false for string', () => {
      expect(isObject.call('{"name":"John"}')).toBe(false)
    })

    it('returns false for number', () => {
      expect(isObject.call(42)).toBe(false)
    })

    it('returns false for boolean', () => {
      expect(isObject.call(false)).toBe(false)
    })

    it('returns false for null', () => {
      expect(isObject.call(null)).toBe(false)
    })

    it('returns true for nested object', () => {
      expect(isObject.call({ config: { debug: true } })).toBe(true)
    })
  })

  describe('is_null() - Type check for null', () => {
    it('returns true for null', () => {
      expect(isNull.call(null)).toBe(true)
    })

    it('returns false for undefined', () => {
      expect(isNull.call(undefined)).toBe(false)
    })

    it('returns false for string "null"', () => {
      expect(isNull.call('null')).toBe(false)
    })

    it('returns false for zero', () => {
      expect(isNull.call(0)).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isNull.call('')).toBe(false)
    })

    it('returns false for false', () => {
      expect(isNull.call(false)).toBe(false)
    })

    it('returns false for empty array', () => {
      expect(isNull.call([])).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isNull.call({})).toBe(false)
    })
  })

  describe('not_null() - Throws if null, returns value otherwise', () => {
    it('returns value for non-null string', () => {
      expect(notNull.call('hello')).toBe('hello')
    })

    it('returns value for non-null number', () => {
      expect(notNull.call(42)).toBe(42)
    })

    it('returns value for boolean true', () => {
      expect(notNull.call(true)).toBe(true)
    })

    it('returns value for boolean false', () => {
      expect(notNull.call(false)).toBe(false)
    })

    it('returns value for zero', () => {
      expect(notNull.call(0)).toBe(0)
    })

    it('returns value for empty string', () => {
      expect(notNull.call('')).toBe('')
    })

    it('returns value for empty array', () => {
      const arr: any[] = []
      expect(notNull.call(arr)).toBe(arr)
    })

    it('returns value for empty object', () => {
      const obj = {}
      expect(notNull.call(obj)).toBe(obj)
    })

    it('returns value for array', () => {
      const arr = [1, 2, 3]
      expect(notNull.call(arr)).toEqual([1, 2, 3])
    })

    it('returns value for object', () => {
      const obj = { name: 'John' }
      expect(notNull.call(obj)).toEqual({ name: 'John' })
    })

    it('throws error for null', () => {
      expect(() => notNull.call(null)).toThrow()
    })

    it('throws error message mentions null when called on null', () => {
      expect(() => notNull.call(null)).toThrow(/null/i)
    })
  })

  describe('or(default) - Return default if null/undefined', () => {
    it('returns value for non-null string', () => {
      expect(or.call('hello', 'default')).toBe('hello')
    })

    it('returns value for non-null number', () => {
      expect(or.call(42, 0)).toBe(42)
    })

    it('returns value for zero', () => {
      expect(or.call(0, 999)).toBe(0)
    })

    it('returns value for false', () => {
      expect(or.call(false, true)).toBe(false)
    })

    it('returns value for empty string', () => {
      expect(or.call('', 'default')).toBe('')
    })

    it('returns value for empty array', () => {
      const arr: any[] = []
      expect(or.call(arr, ['default'])).toBe(arr)
    })

    it('returns value for empty object', () => {
      const obj = {}
      expect(or.call(obj, { default: true })).toBe(obj)
    })

    it('returns value for array', () => {
      const arr = [1, 2, 3]
      expect(or.call(arr, [])).toEqual([1, 2, 3])
    })

    it('returns default for null', () => {
      expect(or.call(null, 'default')).toBe('default')
    })

    it('returns default for undefined', () => {
      expect(or.call(undefined, 'default')).toBe('default')
    })

    it('returns default object when input is null', () => {
      const defaultObj = { name: 'John' }
      expect(or.call(null, defaultObj)).toBe(defaultObj)
    })

    it('returns default array when input is null', () => {
      const defaultArr = [1, 2, 3]
      expect(or.call(null, defaultArr)).toBe(defaultArr)
    })

    it('returns default value when input is undefined', () => {
      expect(or.call(undefined, 42)).toBe(42)
    })
  })

  describe('catch(default) - Return default on error', () => {
    it('returns value when no error', () => {
      expect(catch_.call('hello', 'error_default')).toBe('hello')
    })

    it('returns value for number when no error', () => {
      expect(catch_.call(42, 0)).toBe(42)
    })

    it('returns default string when input is error', () => {
      const error = new Error('something went wrong')
      expect(catch_.call(error, 'default')).toBe('default')
    })

    it('returns default number when input is error', () => {
      const error = new Error('math error')
      expect(catch_.call(error, -1)).toBe(-1)
    })

    it('returns default object when input is error', () => {
      const error = new Error('object error')
      const defaultObj = { status: 'error' }
      expect(catch_.call(error, defaultObj)).toEqual(defaultObj)
    })

    it('returns default array when input is error', () => {
      const error = new Error('array error')
      const defaultArr = [0, 0, 0]
      expect(catch_.call(error, defaultArr)).toEqual(defaultArr)
    })

    it('returns non-error values unchanged', () => {
      expect(catch_.call(false, true)).toBe(false)
    })

    it('returns empty string when no error', () => {
      expect(catch_.call('', 'default')).toBe('')
    })

    it('returns zero when no error', () => {
      expect(catch_.call(0, 999)).toBe(0)
    })

    it('returns null when no error', () => {
      expect(catch_.call(null, 'default')).toBe(null)
    })

    it('handles Error objects with messages', () => {
      const error = new Error('detailed error message')
      expect(catch_.call(error, 'fallback')).toBe('fallback')
    })
  })

  describe('Type coercion edge cases', () => {
    it('int() handles decimal strings', () => {
      expect(int.call('42.7')).toBe(42)
    })

    it('float() preserves precision', () => {
      const result = float.call('3.141592653589793')
      expect(result).toBeCloseTo(3.141592653589793, 10)
    })

    it('bool() with negative numbers returns true', () => {
      expect(bool.call(-1)).toBe(true)
      expect(bool.call(-0.1)).toBe(true)
    })

    it('bool() with single-element array returns true', () => {
      expect(bool.call([null])).toBe(true)
    })

    it('string() preserves special characters in JSON', () => {
      const obj = { quote: '"hello"', newline: 'a\nb' }
      const str = string.call(obj)
      const parsed = JSON.parse(str)
      expect(parsed).toEqual(obj)
    })

    it('type() returns consistent string for all instances', () => {
      expect(type.call('a')).toEqual(type.call('b'))
      expect(type.call(1)).toEqual(type.call(2))
      expect(type.call([1])).toEqual(type.call([2]))
    })
  })

  describe('Function interface and naming', () => {
    it('exports functions with call method', () => {
      expect(typeof string.call).toBe('function')
      expect(typeof int.call).toBe('function')
      expect(typeof float.call).toBe('function')
      expect(typeof bool.call).toBe('function')
      expect(typeof array.call).toBe('function')
      expect(typeof object.call).toBe('function')
      expect(typeof type.call).toBe('function')
      expect(typeof isString.call).toBe('function')
      expect(typeof isNumber.call).toBe('function')
      expect(typeof isBool.call).toBe('function')
      expect(typeof isArray.call).toBe('function')
      expect(typeof isObject.call).toBe('function')
      expect(typeof isNull.call).toBe('function')
      expect(typeof notNull.call).toBe('function')
      expect(typeof or.call).toBe('function')
      expect(typeof catch_.call).toBe('function')
    })
  })

  describe('Integration scenarios', () => {
    it('can chain type conversions: string -> int -> float', () => {
      const str = '42'
      const intVal = int.call(str)
      const floatVal = float.call(intVal)
      expect(floatVal).toBe(42.0)
    })

    it('can use or() with null check', () => {
      const value = null
      const result = or.call(value, 'default_value')
      expect(result).toBe('default_value')
    })

    it('can use catch() with or() for safe type conversion', () => {
      const maybeError = new Error('parse failed')
      const fallback = or.call(catch_.call(maybeError, null), 'final_default')
      expect(fallback).toBe('final_default')
    })

    it('can verify and convert type safely', () => {
      const value = '123'
      if (isString.call(value)) {
        const num = int.call(value)
        expect(typeof num).toBe('number')
        expect(num).toBe(123)
      }
    })

    it('can build object from type-safe conversions', () => {
      const entries = [
        ['age', int.call('25')],
        ['active', bool.call(1)],
        ['name', string.call('Alice')]
      ]
      const result = object.call(entries)
      expect(result).toEqual({
        age: 25,
        active: true,
        name: 'Alice'
      })
    })
  })

  describe('Error messages and debugging', () => {
    it('int() error mentions the invalid value', () => {
      try {
        int.call('not a number')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toMatch(/not a number|invalid|cannot|parse/i)
      }
    })

    it('float() error is descriptive', () => {
      try {
        float.call('NaN')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toBeDefined()
      }
    })

    it('object() error mentions invalid entry format', () => {
      try {
        object.call('not an array')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toBeDefined()
      }
    })

    it('notNull() error message is informative', () => {
      try {
        notNull.call(null)
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toMatch(/null|required|missing/i)
      }
    })
  })

  describe('Benthos compatibility semantics', () => {
    it('follows Benthos bool() semantics: only 0, "", null, false, [], {} are falsy', () => {
      expect(bool.call(0)).toBe(false)
      expect(bool.call('')).toBe(false)
      expect(bool.call(null)).toBe(false)
      expect(bool.call(false)).toBe(false)
      expect(bool.call([])).toBe(false)
      expect(bool.call({})).toBe(false)

      // Everything else is truthy
      expect(bool.call(0.1)).toBe(true)
      expect(bool.call(-1)).toBe(true)
      expect(bool.call(' ')).toBe(true)
      expect(bool.call('false')).toBe(true)
      expect(bool.call([null])).toBe(true)
      expect(bool.call({ a: null })).toBe(true)
    })

    it('follows Benthos string() semantics: JSON serialization for complex types', () => {
      const obj = { a: 1, b: 2 }
      const str = string.call(obj)
      expect(JSON.parse(str)).toEqual(obj)

      const arr = [1, 2, 3]
      const arrStr = string.call(arr)
      expect(JSON.parse(arrStr)).toEqual(arr)
    })

    it('follows Benthos int() semantics: truncation not rounding', () => {
      expect(int.call(3.9)).toBe(3)
      expect(int.call(-3.9)).toBe(-3)
      expect(int.call(3.1)).toBe(3)
      expect(int.call(-3.1)).toBe(-3)
    })

    it('follows Benthos type() semantics: lowercase type names', () => {
      expect(type.call('hello')).toBe('string')
      expect(type.call(42)).toBe('number')
      expect(type.call(true)).toBe('bool')
      expect(type.call([1])).toBe('array')
      expect(type.call({ a: 1 })).toBe('object')
      expect(type.call(null)).toBe('null')
    })
  })
})
