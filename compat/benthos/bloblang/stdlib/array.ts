/**
 * Bloblang Array Stdlib Functions - GREEN Phase Implementation
 * Issue: dotdo-6lpbo
 *
 * Minimal implementation to make all tests pass.
 * All operations are immutable (return new arrays).
 */

type PredicateFn<T> = (elem: T, idx: number) => boolean
type MapFn<T, R> = (elem: T, idx: number) => R
type SortByFn<T> = (elem: T, idx: number) => any

function assertArray(input: any, fnName: string): void {
  if (!Array.isArray(input)) {
    throw new Error(`${fnName}: input must be an array`)
  }
}

function assertFunction(fn: any, fnName: string): void {
  if (typeof fn !== 'function') {
    throw new Error(`${fnName}: function argument is required`)
  }
}

function assertNumber(val: any, fnName: string, paramName: string): void {
  if (typeof val !== 'number') {
    throw new Error(`${fnName}: ${paramName} must be a number`)
  }
}

/**
 * map_each(fn) - Transform each element using lambda function
 * Passes element and index to the function
 */
export function map_each<T, R>(this: T[], fn: MapFn<T, R>): R[] {
  assertArray(this, 'map_each')
  assertFunction(fn, 'map_each')

  return this.map((elem, idx) => fn(elem, idx))
}

/**
 * filter(fn) - Keep elements matching predicate
 * Passes element and index to the predicate
 */
export function filter<T>(this: T[], fn: PredicateFn<T>): T[] {
  assertArray(this, 'filter')
  assertFunction(fn, 'filter')

  return this.filter((elem, idx) => fn(elem, idx))
}

/**
 * flatten() - Flatten nested arrays one level
 * Only flattens one level deep
 */
export function flatten<T>(this: T[]): any[] {
  assertArray(this, 'flatten')

  return this.flat(1)
}

/**
 * index(i) - Get element at index (supports negative indexing)
 * Returns null for out of bounds
 */
export function index<T>(this: T[], i: number): T | null {
  assertArray(this, 'index')
  assertNumber(i, 'index', 'index')

  const actualIndex = i < 0 ? this.length + i : i

  if (actualIndex < 0 || actualIndex >= this.length) {
    return null
  }

  return this[actualIndex]
}

/**
 * length() - Return array length
 */
export function length<T>(this: T[]): number {
  assertArray(this, 'length')

  return this.length
}

/**
 * sort() - Sort array in ascending order
 * Does not mutate original array
 */
export function sort<T>(this: T[]): T[] {
  assertArray(this, 'sort')

  return [...this].sort((a, b) => {
    if (a < b) return -1
    if (a > b) return 1
    return 0
  })
}

/**
 * sort_by(fn) - Sort by function result in ascending order
 * Passes element and index to the function
 * Does not mutate original array
 */
export function sort_by<T>(this: T[], fn: SortByFn<T>): T[] {
  assertArray(this, 'sort_by')
  assertFunction(fn, 'sort_by')

  // Pre-compute sort values with original indices
  const items = this.map((elem, idx) => ({
    elem,
    idx,
    sortVal: fn(elem, idx)
  }))

  // Sort by computed values, with reverse-stable ordering (later items first when equal)
  items.sort((a, b) => {
    if (a.sortVal < b.sortVal) return -1
    if (a.sortVal > b.sortVal) return 1
    // When sort values are equal, reverse the original order (unstable/reverse-stable)
    return b.idx - a.idx
  })

  return items.map(item => item.elem)
}

/**
 * reverse() - Reverse array order
 * Does not mutate original array
 */
export function reverse<T>(this: T[]): T[] {
  assertArray(this, 'reverse')

  return [...this].reverse()
}

/**
 * unique() - Remove duplicates, preserving first occurrence order
 * Does not mutate original array
 */
export function unique<T>(this: T[]): T[] {
  assertArray(this, 'unique')

  return [...new Set(this)]
}

/**
 * append(val) - Add element to end of array
 * Does not mutate original array
 */
export function append<T>(this: T[], val: any): T[] {
  assertArray(this, 'append')

  return [...this, val]
}

/**
 * concat(arr) - Combine two arrays
 * Does not mutate original arrays
 */
export function concat<T>(this: T[], arr: any[]): T[] {
  assertArray(this, 'concat')

  if (!Array.isArray(arr)) {
    throw new Error('concat: argument must be an array')
  }

  return [...this, ...arr]
}

/**
 * contains(val) - Check if array contains value
 * Uses reference equality for objects
 */
export function contains<T>(this: T[], val: any): boolean {
  assertArray(this, 'contains')

  return this.includes(val)
}

/**
 * any(fn) - Check if any element matches predicate
 * Short-circuits on first match
 * Passes element and index to predicate
 */
export function any<T>(this: T[], fn: PredicateFn<T>): boolean {
  assertArray(this, 'any')
  assertFunction(fn, 'any')

  for (let i = 0; i < this.length; i++) {
    if (fn(this[i], i)) {
      return true
    }
  }

  return false
}

/**
 * all(fn) - Check if all elements match predicate
 * Short-circuits on first non-match
 * Passes element and index to predicate
 * Returns true for empty array
 */
export function all<T>(this: T[], fn: PredicateFn<T>): boolean {
  assertArray(this, 'all')
  assertFunction(fn, 'all')

  for (let i = 0; i < this.length; i++) {
    if (!fn(this[i], i)) {
      return false
    }
  }

  return true
}

/**
 * first() - Get first element
 * Returns null for empty array
 */
export function first<T>(this: T[]): T | null {
  assertArray(this, 'first')

  return this.length > 0 ? this[0] : null
}

/**
 * last() - Get last element
 * Returns null for empty array
 */
export function last<T>(this: T[]): T | null {
  assertArray(this, 'last')

  return this.length > 0 ? this[this.length - 1] : null
}

/**
 * slice(start, end?) - Extract subarray
 * Supports negative indices
 * Does not mutate original array
 */
export function slice<T>(this: T[], start: number, end?: number): T[] {
  assertArray(this, 'slice')
  assertNumber(start, 'slice', 'start')

  if (end !== undefined) {
    assertNumber(end, 'slice', 'end')
  }

  return this.slice(start, end)
}
