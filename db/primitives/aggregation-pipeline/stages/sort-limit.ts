/**
 * $sort, $limit, and $skip Stages - MongoDB-style ordering and pagination
 *
 * $sort supports:
 * - Single field sorting (ascending/descending)
 * - Multi-field sorting (stable)
 * - Nested field sorting (dot notation)
 * - Null positioning (nullsFirst, nullsLast)
 * - Memory-efficient top-K optimization
 *
 * $limit supports:
 * - Simple limiting
 * - Memory-efficient top-K with preceding $sort
 *
 * $skip supports:
 * - Offset-based pagination
 */

import type { Stage } from '../index'

// ============================================================================
// Types
// ============================================================================

/**
 * Sort direction
 */
export type SortDirection = 1 | -1 | 'asc' | 'desc'

/**
 * Null positioning
 */
export type NullPosition = 'first' | 'last' | 'nullsFirst' | 'nullsLast'

/**
 * Sort specification for a single field or multiple fields
 */
export type SortSpec<T> = {
  [key: string]: SortDirection | { $meta: 'textScore' }
}

/**
 * Sort options
 */
export interface SortOptions {
  nulls?: NullPosition
  collation?: {
    locale: string
    caseLevel?: boolean
    strength?: 1 | 2 | 3 | 4 | 5
    numericOrdering?: boolean
  }
  stable?: boolean // Default true
}

/**
 * Sort stage interface
 */
export interface SortStage<T> extends Stage<T, T> {
  name: '$sort'
  specification: SortSpec<T>
  options?: SortOptions
}

/**
 * Limit options
 */
export interface LimitOptions {
  heapOptimized?: boolean
}

/**
 * Limit stage interface
 */
export interface LimitStage<T> extends Stage<T, T> {
  name: '$limit'
  count: number
  limit: number
  isHeapOptimized?: boolean
}

/**
 * Skip stage interface
 */
export interface SkipStage<T> extends Stage<T, T> {
  name: '$skip'
  count: number
  skip: number
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined

  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Normalize sort direction to 1 or -1
 */
function normalizeDirection(dir: SortDirection | { $meta: string }): 1 | -1 {
  if (typeof dir === 'object') return 1 // $meta textScore defaults to descending
  if (dir === 'asc' || dir === 1) return 1
  return -1
}

/**
 * Compare two values for sorting
 */
function compareValues(
  a: unknown,
  b: unknown,
  direction: 1 | -1,
  nulls?: NullPosition,
  collation?: SortOptions['collation']
): number {
  // Handle null/undefined
  const aIsNull = a === null || a === undefined
  const bIsNull = b === null || b === undefined

  if (aIsNull && bIsNull) return 0

  if (aIsNull) {
    if (nulls === 'nullsFirst' || nulls === 'first') return -1
    if (nulls === 'nullsLast' || nulls === 'last') return 1
    // Default: nulls at end for ascending, at end for descending (always last)
    return 1
  }

  if (bIsNull) {
    if (nulls === 'nullsFirst' || nulls === 'first') return 1
    if (nulls === 'nullsLast' || nulls === 'last') return -1
    // Default: nulls at end for ascending, at end for descending (always last)
    return -1
  }

  // Handle same types
  if (typeof a === typeof b) {
    // String comparison with collation
    if (typeof a === 'string' && typeof b === 'string') {
      if (collation) {
        return a.localeCompare(b, collation.locale, {
          sensitivity: collation.strength === 1 ? 'base' : collation.strength === 2 ? 'accent' : 'variant',
          numeric: collation.numericOrdering,
          caseFirst: collation.caseLevel ? 'upper' : undefined,
        }) * direction
      }
      return a.localeCompare(b) * direction
    }

    // Number comparison
    if (typeof a === 'number' && typeof b === 'number') {
      return (a - b) * direction
    }

    // Date comparison
    if (a instanceof Date && b instanceof Date) {
      return (a.getTime() - b.getTime()) * direction
    }

    // Boolean comparison
    if (typeof a === 'boolean' && typeof b === 'boolean') {
      return (a === b ? 0 : a ? 1 : -1) * direction
    }

    // Array comparison (by first element)
    if (Array.isArray(a) && Array.isArray(b)) {
      const aFirst = a[0]
      const bFirst = b[0]
      return compareValues(aFirst, bFirst, direction, nulls, collation)
    }
  }

  // Type ordering: numbers < strings < objects < arrays < booleans < dates < null
  const typeOrder = (val: unknown): number => {
    if (val === null || val === undefined) return 7
    if (typeof val === 'number') return 1
    if (typeof val === 'string') return 2
    if (val instanceof Date) return 6
    if (typeof val === 'boolean') return 5
    if (Array.isArray(val)) return 4
    if (typeof val === 'object') return 3
    return 8
  }

  return (typeOrder(a) - typeOrder(b)) * direction
}

/**
 * Create a comparator function for sorting
 */
function createComparator<T>(
  spec: SortSpec<T>,
  options?: SortOptions
): (a: T, b: T) => number {
  const fields = Object.entries(spec).map(([field, dir]) => ({
    field,
    direction: normalizeDirection(dir),
  }))

  return (a: T, b: T): number => {
    for (const { field, direction } of fields) {
      const aValue = getNestedValue(a, field)
      const bValue = getNestedValue(b, field)

      const cmp = compareValues(aValue, bValue, direction, options?.nulls, options?.collation)
      if (cmp !== 0) return cmp
    }
    return 0
  }
}

/**
 * Memory-efficient top-K using a min-heap (for largest K) or max-heap (for smallest K)
 * This is used when $limit follows $sort
 */
class MinHeap<T> {
  private heap: T[] = []
  private comparator: (a: T, b: T) => number

  constructor(comparator: (a: T, b: T) => number) {
    // Invert comparator for max-heap behavior (to keep smallest K elements)
    this.comparator = (a, b) => -comparator(a, b)
  }

  size(): number {
    return this.heap.length
  }

  peek(): T | undefined {
    return this.heap[0]
  }

  push(item: T): void {
    this.heap.push(item)
    this.bubbleUp(this.heap.length - 1)
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined
    const top = this.heap[0]
    const last = this.heap.pop()!
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.bubbleDown(0)
    }
    return top
  }

  pushPop(item: T): T {
    if (this.heap.length === 0) {
      return item
    }
    if (this.comparator(item, this.heap[0]) < 0) {
      return item
    }
    const top = this.heap[0]
    this.heap[0] = item
    this.bubbleDown(0)
    return top
  }

  toSortedArray(): T[] {
    const result: T[] = []
    const heapCopy = [...this.heap]

    while (this.heap.length > 0) {
      result.push(this.pop()!)
    }

    this.heap = heapCopy
    return result.reverse()
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.comparator(this.heap[index], this.heap[parentIndex]) >= 0) break
      ;[this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]]
      index = parentIndex
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length

    while (true) {
      const leftChild = 2 * index + 1
      const rightChild = 2 * index + 2
      let smallest = index

      if (leftChild < length && this.comparator(this.heap[leftChild], this.heap[smallest]) < 0) {
        smallest = leftChild
      }
      if (rightChild < length && this.comparator(this.heap[rightChild], this.heap[smallest]) < 0) {
        smallest = rightChild
      }

      if (smallest === index) break

      ;[this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]]
      index = smallest
    }
  }
}

// ============================================================================
// Sort Stage Factory
// ============================================================================

/**
 * Create a $sort stage
 */
export function createSortStage<T>(spec: SortSpec<T>, options?: SortOptions): SortStage<T> {
  return {
    name: '$sort',
    specification: spec,
    options,

    process(input: T[]): T[] {
      if (input.length === 0) return []
      if (input.length === 1) return input

      const comparator = createComparator(spec, options)

      // Use stable sort (default in modern JS)
      const result = [...input]
      result.sort(comparator)

      return result
    },
  }
}

/**
 * Create a $limit stage
 */
export function createLimitStage<T>(count: number, options?: LimitOptions): LimitStage<T> {
  if (count < 0) {
    throw new Error('$limit value must be non-negative')
  }

  return {
    name: '$limit',
    limit: count,
    isHeapOptimized: options?.heapOptimized,
    count,

    process(input: T[]): T[] {
      return input.slice(0, count)
    },
  }
}

/**
 * Create a $skip stage
 */
export function createSkipStage<T>(count: number): SkipStage<T> {
  if (count < 0) {
    throw new Error('$skip value must be non-negative')
  }

  return {
    name: '$skip',
    count,
    skip: count,

    process(input: T[]): T[] {
      return input.slice(count)
    },
  }
}

/**
 * Create an optimized sort+limit stage that uses top-K algorithm
 * This is more memory efficient for large datasets with small limits
 */
export function createTopKStage<T>(
  sortSpec: SortSpec<T>,
  limit: number,
  options?: SortOptions
): Stage<T, T> {
  const comparator = createComparator(sortSpec, options)

  return {
    name: '$sortLimit',
    description: `Optimized top-${limit} sort`,

    process(input: T[]): T[] {
      if (input.length === 0) return []
      if (input.length <= limit) {
        // Just sort the small array
        return [...input].sort(comparator)
      }

      // Use heap for memory efficiency
      const heap = new MinHeap<T>(comparator)

      for (const item of input) {
        if (heap.size() < limit) {
          heap.push(item)
        } else {
          heap.pushPop(item)
        }
      }

      return heap.toSortedArray()
    },
  }
}
