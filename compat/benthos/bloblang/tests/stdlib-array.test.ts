/**
 * RED Phase Tests: Bloblang Array Stdlib Functions - Milestone 2
 * Issue: dotdo-6lpbo
 *
 * These tests define the expected behavior for Bloblang array stdlib functions.
 * They should FAIL until the implementation is complete.
 *
 * Functions tested:
 * - map_each(fn)
 * - filter(fn)
 * - flatten()
 * - index(i)
 * - length()
 * - sort()
 * - sort_by(fn)
 * - reverse()
 * - unique()
 * - append(val)
 * - concat(arr)
 * - contains(val)
 * - any(fn)
 * - all(fn)
 * - first()
 * - last()
 * - slice(start, end?)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as arrayFunctions from '../stdlib/array'

describe('Bloblang Array Stdlib - Milestone 2', () => {
  describe('map_each(fn)', () => {
    it('transforms each element using lambda function', () => {
      const input = [1, 2, 3]
      const result = arrayFunctions.map_each.call(input, (x) => x * 2)
      expect(result).toEqual([2, 4, 6])
    })

    it('passes element and index to lambda', () => {
      const input = ['a', 'b', 'c']
      const results: any[] = []
      arrayFunctions.map_each.call(input, (elem, idx) => {
        results.push({ elem, idx })
        return elem.toUpperCase()
      })
      expect(results).toEqual([
        { elem: 'a', idx: 0 },
        { elem: 'b', idx: 1 },
        { elem: 'c', idx: 2 }
      ])
    })

    it('returns empty array for empty input', () => {
      const input: any[] = []
      const result = arrayFunctions.map_each.call(input, (x) => x * 2)
      expect(result).toEqual([])
    })

    it('transforms objects in array', () => {
      const input = [{ x: 1 }, { x: 2 }, { x: 3 }]
      const result = arrayFunctions.map_each.call(input, (obj) => ({
        ...obj,
        x: obj.x * 10
      }))
      expect(result).toEqual([{ x: 10 }, { x: 20 }, { x: 30 }])
    })

    it('handles null/undefined elements', () => {
      const input = [1, null, 3]
      const result = arrayFunctions.map_each.call(input, (x) => x ?? 0)
      expect(result).toEqual([1, 0, 3])
    })

    it('throws if function is not provided', () => {
      const input = [1, 2, 3]
      expect(() => arrayFunctions.map_each.call(input)).toThrow()
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.map_each.call('not an array', (x) => x)).toThrow()
    })
  })

  describe('filter(fn)', () => {
    it('keeps elements matching predicate', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.filter.call(input, (x) => x > 2)
      expect(result).toEqual([3, 4, 5])
    })

    it('passes element and index to predicate', () => {
      const input = ['a', 'b', 'c']
      const results: any[] = []
      arrayFunctions.filter.call(input, (elem, idx) => {
        results.push({ elem, idx })
        return idx % 2 === 0
      })
      expect(results).toEqual([
        { elem: 'a', idx: 0 },
        { elem: 'b', idx: 1 },
        { elem: 'c', idx: 2 }
      ])
    })

    it('returns empty array when no elements match', () => {
      const input = [1, 2, 3]
      const result = arrayFunctions.filter.call(input, (x) => x > 10)
      expect(result).toEqual([])
    })

    it('returns full array when all elements match', () => {
      const input = [1, 2, 3]
      const result = arrayFunctions.filter.call(input, (x) => x > 0)
      expect(result).toEqual([1, 2, 3])
    })

    it('handles empty array', () => {
      const input: any[] = []
      const result = arrayFunctions.filter.call(input, (x) => x > 0)
      expect(result).toEqual([])
    })

    it('filters objects based on properties', () => {
      const input = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 35 }
      ]
      const result = arrayFunctions.filter.call(input, (obj) => obj.age > 28)
      expect(result).toEqual([
        { name: 'Alice', age: 30 },
        { name: 'Charlie', age: 35 }
      ])
    })

    it('throws if predicate is not provided', () => {
      const input = [1, 2, 3]
      expect(() => arrayFunctions.filter.call(input)).toThrow()
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.filter.call(42, (x) => x > 0)).toThrow()
    })
  })

  describe('flatten()', () => {
    it('flattens nested arrays one level', () => {
      const input = [[1, 2], [3, 4], [5, 6]]
      const result = arrayFunctions.flatten.call(input)
      expect(result).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('handles empty nested arrays', () => {
      const input = [[1, 2], [], [3]]
      const result = arrayFunctions.flatten.call(input)
      expect(result).toEqual([1, 2, 3])
    })

    it('returns empty array for empty input', () => {
      const input: any[] = []
      const result = arrayFunctions.flatten.call(input)
      expect(result).toEqual([])
    })

    it('handles mixed nested structures', () => {
      const input = [[1], [2, 3], [4, 5, 6]]
      const result = arrayFunctions.flatten.call(input)
      expect(result).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('flattens one level only (not deeply)', () => {
      const input = [[[1, 2]], [[3, 4]]]
      const result = arrayFunctions.flatten.call(input)
      expect(result).toEqual([[1, 2], [3, 4]])
    })

    it('preserves non-array elements', () => {
      const input = [[1, 2], 3, [4, 5]]
      const result = arrayFunctions.flatten.call(input)
      expect(result).toEqual([1, 2, 3, 4, 5])
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.flatten.call('not an array')).toThrow()
    })
  })

  describe('index(i)', () => {
    it('gets element at positive index', () => {
      const input = ['a', 'b', 'c', 'd']
      const result = arrayFunctions.index.call(input, 2)
      expect(result).toBe('c')
    })

    it('gets element at index 0', () => {
      const input = [10, 20, 30]
      const result = arrayFunctions.index.call(input, 0)
      expect(result).toBe(10)
    })

    it('supports negative indexing from end', () => {
      const input = ['a', 'b', 'c', 'd']
      const result = arrayFunctions.index.call(input, -1)
      expect(result).toBe('d')
    })

    it('supports -2 as second from end', () => {
      const input = ['a', 'b', 'c', 'd']
      const result = arrayFunctions.index.call(input, -2)
      expect(result).toBe('c')
    })

    it('returns null for out of bounds positive index', () => {
      const input = ['a', 'b', 'c']
      const result = arrayFunctions.index.call(input, 10)
      expect(result).toBeNull()
    })

    it('returns null for out of bounds negative index', () => {
      const input = ['a', 'b', 'c']
      const result = arrayFunctions.index.call(input, -10)
      expect(result).toBeNull()
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.index.call('string', 0)).toThrow()
    })

    it('throws if index is not a number', () => {
      const input = ['a', 'b', 'c']
      expect(() => arrayFunctions.index.call(input, 'not a number')).toThrow()
    })
  })

  describe('length()', () => {
    it('returns length of array', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.length.call(input)
      expect(result).toBe(5)
    })

    it('returns 0 for empty array', () => {
      const input: any[] = []
      const result = arrayFunctions.length.call(input)
      expect(result).toBe(0)
    })

    it('counts all element types', () => {
      const input = [1, 'string', null, { obj: true }, [1, 2, 3]]
      const result = arrayFunctions.length.call(input)
      expect(result).toBe(5)
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.length.call('not an array')).toThrow()
    })
  })

  describe('sort()', () => {
    it('sorts numbers in ascending order', () => {
      const input = [3, 1, 4, 1, 5, 9, 2, 6]
      const result = arrayFunctions.sort.call(input)
      expect(result).toEqual([1, 1, 2, 3, 4, 5, 6, 9])
    })

    it('sorts strings in ascending order', () => {
      const input = ['charlie', 'alice', 'bob']
      const result = arrayFunctions.sort.call(input)
      expect(result).toEqual(['alice', 'bob', 'charlie'])
    })

    it('returns empty array for empty input', () => {
      const input: any[] = []
      const result = arrayFunctions.sort.call(input)
      expect(result).toEqual([])
    })

    it('handles single element array', () => {
      const input = [42]
      const result = arrayFunctions.sort.call(input)
      expect(result).toEqual([42])
    })

    it('sorts mixed numeric values', () => {
      const input = [10, 2, 30, 1]
      const result = arrayFunctions.sort.call(input)
      expect(result).toEqual([1, 2, 10, 30])
    })

    it('does not mutate original array', () => {
      const input = [3, 1, 2]
      const original = [...input]
      arrayFunctions.sort.call(input)
      expect(input).toEqual(original)
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.sort.call('not an array')).toThrow()
    })
  })

  describe('sort_by(fn)', () => {
    it('sorts by function result in ascending order', () => {
      const input = [
        { name: 'Charlie', age: 30 },
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 35 }
      ]
      const result = arrayFunctions.sort_by.call(input, (obj) => obj.age)
      expect(result).toEqual([
        { name: 'Alice', age: 25 },
        { name: 'Charlie', age: 30 },
        { name: 'Bob', age: 35 }
      ])
    })

    it('sorts strings by length', () => {
      const input = ['apple', 'hi', 'hello']
      const result = arrayFunctions.sort_by.call(input, (s) => s.length)
      expect(result).toEqual(['hi', 'hello', 'apple'])
    })

    it('returns empty array for empty input', () => {
      const input: any[] = []
      const result = arrayFunctions.sort_by.call(input, (x) => x)
      expect(result).toEqual([])
    })

    it('passes element and index to function', () => {
      const input = [{ v: 1 }, { v: 2 }, { v: 3 }]
      const results: any[] = []
      arrayFunctions.sort_by.call(input, (elem, idx) => {
        results.push({ elem, idx })
        return elem.v
      })
      // Results should contain all elements
      expect(results).toHaveLength(3)
    })

    it('does not mutate original array', () => {
      const input = [{ v: 3 }, { v: 1 }, { v: 2 }]
      const original = [...input]
      arrayFunctions.sort_by.call(input, (obj) => obj.v)
      expect(input).toEqual(original)
    })

    it('throws if function is not provided', () => {
      const input = [1, 2, 3]
      expect(() => arrayFunctions.sort_by.call(input)).toThrow()
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.sort_by.call('not an array', (x) => x)).toThrow()
    })
  })

  describe('reverse()', () => {
    it('reverses array order', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.reverse.call(input)
      expect(result).toEqual([5, 4, 3, 2, 1])
    })

    it('reverses strings in array', () => {
      const input = ['a', 'b', 'c']
      const result = arrayFunctions.reverse.call(input)
      expect(result).toEqual(['c', 'b', 'a'])
    })

    it('returns empty array for empty input', () => {
      const input: any[] = []
      const result = arrayFunctions.reverse.call(input)
      expect(result).toEqual([])
    })

    it('handles single element array', () => {
      const input = [42]
      const result = arrayFunctions.reverse.call(input)
      expect(result).toEqual([42])
    })

    it('does not mutate original array', () => {
      const input = [1, 2, 3]
      const original = [...input]
      arrayFunctions.reverse.call(input)
      expect(input).toEqual(original)
    })

    it('reverses objects in array', () => {
      const input = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const result = arrayFunctions.reverse.call(input)
      expect(result).toEqual([{ id: 3 }, { id: 2 }, { id: 1 }])
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.reverse.call('not an array')).toThrow()
    })
  })

  describe('unique()', () => {
    it('removes duplicate numbers', () => {
      const input = [1, 2, 2, 3, 1, 4, 3]
      const result = arrayFunctions.unique.call(input)
      expect(result).toEqual([1, 2, 3, 4])
    })

    it('removes duplicate strings', () => {
      const input = ['apple', 'banana', 'apple', 'cherry', 'banana']
      const result = arrayFunctions.unique.call(input)
      expect(result).toEqual(['apple', 'banana', 'cherry'])
    })

    it('returns empty array for empty input', () => {
      const input: any[] = []
      const result = arrayFunctions.unique.call(input)
      expect(result).toEqual([])
    })

    it('handles single element array', () => {
      const input = [42]
      const result = arrayFunctions.unique.call(input)
      expect(result).toEqual([42])
    })

    it('preserves first occurrence order', () => {
      const input = [3, 1, 2, 1, 3, 2, 4]
      const result = arrayFunctions.unique.call(input)
      expect(result).toEqual([3, 1, 2, 4])
    })

    it('does not mutate original array', () => {
      const input = [1, 2, 2, 3]
      const original = [...input]
      arrayFunctions.unique.call(input)
      expect(input).toEqual(original)
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.unique.call('not an array')).toThrow()
    })
  })

  describe('append(val)', () => {
    it('adds element to end of array', () => {
      const input = [1, 2, 3]
      const result = arrayFunctions.append.call(input, 4)
      expect(result).toEqual([1, 2, 3, 4])
    })

    it('appends to empty array', () => {
      const input: any[] = []
      const result = arrayFunctions.append.call(input, 'first')
      expect(result).toEqual(['first'])
    })

    it('appends object to array', () => {
      const input = [{ id: 1 }]
      const result = arrayFunctions.append.call(input, { id: 2 })
      expect(result).toEqual([{ id: 1 }, { id: 2 }])
    })

    it('appends null value', () => {
      const input = [1, 2, 3]
      const result = arrayFunctions.append.call(input, null)
      expect(result).toEqual([1, 2, 3, null])
    })

    it('appends array as single element', () => {
      const input = [1, 2, 3]
      const result = arrayFunctions.append.call(input, [4, 5])
      expect(result).toEqual([1, 2, 3, [4, 5]])
    })

    it('does not mutate original array', () => {
      const input = [1, 2, 3]
      const original = [...input]
      arrayFunctions.append.call(input, 4)
      expect(input).toEqual(original)
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.append.call('not an array', 1)).toThrow()
    })
  })

  describe('concat(arr)', () => {
    it('combines two arrays', () => {
      const input = [1, 2, 3]
      const result = arrayFunctions.concat.call(input, [4, 5, 6])
      expect(result).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('concatenates with empty array', () => {
      const input = [1, 2, 3]
      const result = arrayFunctions.concat.call(input, [])
      expect(result).toEqual([1, 2, 3])
    })

    it('concatenates empty array with values', () => {
      const input: any[] = []
      const result = arrayFunctions.concat.call(input, [1, 2, 3])
      expect(result).toEqual([1, 2, 3])
    })

    it('concatenates two empty arrays', () => {
      const input: any[] = []
      const result = arrayFunctions.concat.call(input, [])
      expect(result).toEqual([])
    })

    it('concatenates arrays of objects', () => {
      const input = [{ id: 1 }]
      const result = arrayFunctions.concat.call(input, [{ id: 2 }, { id: 3 }])
      expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    })

    it('does not mutate original arrays', () => {
      const input = [1, 2, 3]
      const toConcat = [4, 5, 6]
      const originalInput = [...input]
      const originalConcat = [...toConcat]
      arrayFunctions.concat.call(input, toConcat)
      expect(input).toEqual(originalInput)
      expect(toConcat).toEqual(originalConcat)
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.concat.call('not an array', [1, 2])).toThrow()
    })

    it('throws if argument is not an array', () => {
      const input = [1, 2, 3]
      expect(() => arrayFunctions.concat.call(input, 'not an array')).toThrow()
    })
  })

  describe('contains(val)', () => {
    it('returns true when array contains value', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.contains.call(input, 3)
      expect(result).toBe(true)
    })

    it('returns false when array does not contain value', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.contains.call(input, 10)
      expect(result).toBe(false)
    })

    it('finds strings in array', () => {
      const input = ['apple', 'banana', 'cherry']
      const result = arrayFunctions.contains.call(input, 'banana')
      expect(result).toBe(true)
    })

    it('returns false for empty array', () => {
      const input: any[] = []
      const result = arrayFunctions.contains.call(input, 'anything')
      expect(result).toBe(false)
    })

    it('finds null in array', () => {
      const input = [1, null, 3]
      const result = arrayFunctions.contains.call(input, null)
      expect(result).toBe(true)
    })

    it('does not find similar but different objects', () => {
      const input = [{ id: 1 }, { id: 2 }]
      const result = arrayFunctions.contains.call(input, { id: 1 })
      expect(result).toBe(false)
    })

    it('finds same object reference', () => {
      const obj = { id: 1 }
      const input = [obj, { id: 2 }]
      const result = arrayFunctions.contains.call(input, obj)
      expect(result).toBe(true)
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.contains.call('not an array', 'value')).toThrow()
    })
  })

  describe('any(fn)', () => {
    it('returns true if any element matches predicate', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.any.call(input, (x) => x > 3)
      expect(result).toBe(true)
    })

    it('returns false if no element matches predicate', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.any.call(input, (x) => x > 10)
      expect(result).toBe(false)
    })

    it('returns false for empty array', () => {
      const input: any[] = []
      const result = arrayFunctions.any.call(input, (x) => x > 0)
      expect(result).toBe(false)
    })

    it('passes element and index to predicate', () => {
      const input = ['a', 'b', 'c']
      const results: any[] = []
      arrayFunctions.any.call(input, (elem, idx) => {
        results.push({ elem, idx })
        return idx === 1
      })
      expect(results.length).toBeGreaterThan(0)
    })

    it('short-circuits on first match', () => {
      const input = [1, 2, 3, 4, 5]
      let callCount = 0
      arrayFunctions.any.call(input, (x) => {
        callCount++
        return x > 2
      })
      expect(callCount).toBe(3) // Should stop after finding 3
    })

    it('checks objects with properties', () => {
      const input = [
        { active: false },
        { active: true },
        { active: false }
      ]
      const result = arrayFunctions.any.call(input, (obj) => obj.active)
      expect(result).toBe(true)
    })

    it('throws if predicate is not provided', () => {
      const input = [1, 2, 3]
      expect(() => arrayFunctions.any.call(input)).toThrow()
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.any.call('not an array', (x) => x > 0)).toThrow()
    })
  })

  describe('all(fn)', () => {
    it('returns true if all elements match predicate', () => {
      const input = [2, 4, 6, 8]
      const result = arrayFunctions.all.call(input, (x) => x % 2 === 0)
      expect(result).toBe(true)
    })

    it('returns false if any element does not match predicate', () => {
      const input = [2, 4, 5, 8]
      const result = arrayFunctions.all.call(input, (x) => x % 2 === 0)
      expect(result).toBe(false)
    })

    it('returns true for empty array', () => {
      const input: any[] = []
      const result = arrayFunctions.all.call(input, (x) => x > 0)
      expect(result).toBe(true)
    })

    it('passes element and index to predicate', () => {
      const input = ['a', 'b', 'c']
      const results: any[] = []
      arrayFunctions.all.call(input, (elem, idx) => {
        results.push({ elem, idx })
        return true
      })
      expect(results).toHaveLength(3)
    })

    it('short-circuits on first non-match', () => {
      const input = [1, 2, 3, 4, 5]
      let callCount = 0
      arrayFunctions.all.call(input, (x) => {
        callCount++
        return x < 3
      })
      expect(callCount).toBe(3) // Should stop at 3
    })

    it('checks all objects with properties', () => {
      const input = [
        { active: true },
        { active: true },
        { active: true }
      ]
      const result = arrayFunctions.all.call(input, (obj) => obj.active)
      expect(result).toBe(true)
    })

    it('returns false if any object property is false', () => {
      const input = [
        { active: true },
        { active: false },
        { active: true }
      ]
      const result = arrayFunctions.all.call(input, (obj) => obj.active)
      expect(result).toBe(false)
    })

    it('throws if predicate is not provided', () => {
      const input = [1, 2, 3]
      expect(() => arrayFunctions.all.call(input)).toThrow()
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.all.call('not an array', (x) => x > 0)).toThrow()
    })
  })

  describe('first()', () => {
    it('returns first element of array', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.first.call(input)
      expect(result).toBe(1)
    })

    it('returns first element from single element array', () => {
      const input = [42]
      const result = arrayFunctions.first.call(input)
      expect(result).toBe(42)
    })

    it('returns null for empty array', () => {
      const input: any[] = []
      const result = arrayFunctions.first.call(input)
      expect(result).toBeNull()
    })

    it('returns first string from array', () => {
      const input = ['apple', 'banana', 'cherry']
      const result = arrayFunctions.first.call(input)
      expect(result).toBe('apple')
    })

    it('returns first object from array', () => {
      const obj1 = { id: 1 }
      const obj2 = { id: 2 }
      const input = [obj1, obj2]
      const result = arrayFunctions.first.call(input)
      expect(result).toBe(obj1)
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.first.call('not an array')).toThrow()
    })
  })

  describe('last()', () => {
    it('returns last element of array', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.last.call(input)
      expect(result).toBe(5)
    })

    it('returns last element from single element array', () => {
      const input = [42]
      const result = arrayFunctions.last.call(input)
      expect(result).toBe(42)
    })

    it('returns null for empty array', () => {
      const input: any[] = []
      const result = arrayFunctions.last.call(input)
      expect(result).toBeNull()
    })

    it('returns last string from array', () => {
      const input = ['apple', 'banana', 'cherry']
      const result = arrayFunctions.last.call(input)
      expect(result).toBe('cherry')
    })

    it('returns last object from array', () => {
      const obj1 = { id: 1 }
      const obj2 = { id: 2 }
      const input = [obj1, obj2]
      const result = arrayFunctions.last.call(input)
      expect(result).toBe(obj2)
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.last.call('not an array')).toThrow()
    })
  })

  describe('slice(start, end?)', () => {
    it('slices array from start to end', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.slice.call(input, 1, 4)
      expect(result).toEqual([2, 3, 4])
    })

    it('slices from start to end of array when end not provided', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.slice.call(input, 2)
      expect(result).toEqual([3, 4, 5])
    })

    it('slices from start of array with positive index', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.slice.call(input, 0, 3)
      expect(result).toEqual([1, 2, 3])
    })

    it('supports negative start index', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.slice.call(input, -3)
      expect(result).toEqual([3, 4, 5])
    })

    it('supports negative end index', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.slice.call(input, 0, -2)
      expect(result).toEqual([1, 2, 3])
    })

    it('supports both negative indices', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.slice.call(input, -4, -1)
      expect(result).toEqual([2, 3, 4])
    })

    it('returns empty array when start >= end', () => {
      const input = [1, 2, 3, 4, 5]
      const result = arrayFunctions.slice.call(input, 3, 1)
      expect(result).toEqual([])
    })

    it('returns empty array for empty input', () => {
      const input: any[] = []
      const result = arrayFunctions.slice.call(input, 0, 1)
      expect(result).toEqual([])
    })

    it('handles out of bounds indices', () => {
      const input = [1, 2, 3]
      const result = arrayFunctions.slice.call(input, 0, 10)
      expect(result).toEqual([1, 2, 3])
    })

    it('does not mutate original array', () => {
      const input = [1, 2, 3, 4, 5]
      const original = [...input]
      arrayFunctions.slice.call(input, 1, 3)
      expect(input).toEqual(original)
    })

    it('slices strings in array', () => {
      const input = ['a', 'b', 'c', 'd', 'e']
      const result = arrayFunctions.slice.call(input, 1, 4)
      expect(result).toEqual(['b', 'c', 'd'])
    })

    it('throws if input is not an array', () => {
      expect(() => arrayFunctions.slice.call('not an array', 0, 1)).toThrow()
    })

    it('throws if start is not a number', () => {
      const input = [1, 2, 3]
      expect(() => arrayFunctions.slice.call(input, 'not a number')).toThrow()
    })

    it('throws if end is provided but not a number', () => {
      const input = [1, 2, 3]
      expect(() => arrayFunctions.slice.call(input, 0, 'not a number')).toThrow()
    })
  })

  describe('Edge cases and integration tests', () => {
    it('chains multiple array operations', () => {
      const input = [1, 2, 3, 4, 5]
      let result = arrayFunctions.filter.call(input, (x) => x > 1)
      result = arrayFunctions.map_each.call(result, (x) => x * 2)
      result = arrayFunctions.reverse.call(result)
      expect(result).toEqual([10, 8, 6, 4])
    })

    it('handles deeply nested structures', () => {
      const input = [
        { values: [1, 2] },
        { values: [3, 4] },
        { values: [5, 6] }
      ]
      const result = arrayFunctions.map_each.call(input, (obj) => obj.values.length)
      expect(result).toEqual([2, 2, 2])
    })

    it('handles arrays with mixed null and undefined', () => {
      const input = [1, null, undefined, 4]
      const result = arrayFunctions.filter.call(input, (x) => x != null)
      expect(result).toEqual([1, 4])
    })

    it('maintains type information through operations', () => {
      const input = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' }
      ]
      const result = arrayFunctions.map_each.call(input, (obj) => obj.name)
      expect(result).toEqual(['Alice', 'Bob', 'Charlie'])
      expect(typeof result[0]).toBe('string')
    })

    it('handles boolean values in filter', () => {
      const input = [true, false, true, false, true]
      const result = arrayFunctions.filter.call(input, (x) => x === true)
      expect(result).toEqual([true, true, true])
    })

    it('allows map_each to return different types', () => {
      const input = [1, 2, 3]
      const result = arrayFunctions.map_each.call(input, (x) => {
        if (x === 1) return 'one'
        if (x === 2) return 2
        return { three: 3 }
      })
      expect(result).toEqual(['one', 2, { three: 3 }])
    })
  })
})
