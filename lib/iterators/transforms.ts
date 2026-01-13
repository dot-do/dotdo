/**
 * Transforms Module - Iterator transformation utilities
 *
 * Provides additional transformation utilities:
 * - Deduplication
 * - Unique filtering
 * - Partitioning
 * - Sorting
 * - Distinct
 */

import type {
  AsyncIterableSource,
  DeduplicationOptions,
  Transform,
  Predicate,
} from './types'
import { iterate } from './iterator'
import { collect } from './aggregators'

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Deduplicate items based on key
 *
 * @example
 * ```typescript
 * // By default, uses string representation
 * const unique = dedupe([1, 2, 1, 3, 2])
 * // yields: 1, 2, 3
 *
 * // Custom key extractor
 * const uniqueUsers = dedupe(users, { keyExtractor: u => u.id })
 * ```
 */
export async function* dedupe<T>(
  source: AsyncIterableSource<T>,
  options: DeduplicationOptions<T> = {}
): AsyncGenerator<T, void, undefined> {
  const { keyExtractor = String, maxKeys = 10000, windowMs } = options

  const seen = new Map<string, number>() // key -> timestamp
  let oldestTime = Date.now()

  for await (const item of iterate(source)) {
    const key = keyExtractor(item)
    const now = Date.now()

    // Clean up old keys if time window is set
    if (windowMs && seen.size > 0) {
      const cutoff = now - windowMs
      if (oldestTime < cutoff) {
        for (const [k, ts] of seen) {
          if (ts < cutoff) {
            seen.delete(k)
          }
        }
        oldestTime = now
      }
    }

    // Check if we've seen this key
    const lastSeen = seen.get(key)
    if (lastSeen !== undefined) {
      // Within window if windowMs is set, otherwise always skip
      if (!windowMs || now - lastSeen < windowMs) {
        continue
      }
    }

    // LRU eviction if at capacity
    if (seen.size >= maxKeys) {
      // Remove oldest entry
      let oldestKey: string | undefined
      let oldestTs = Infinity
      for (const [k, ts] of seen) {
        if (ts < oldestTs) {
          oldestTs = ts
          oldestKey = k
        }
      }
      if (oldestKey) {
        seen.delete(oldestKey)
      }
    }

    seen.set(key, now)
    yield item
  }
}

/**
 * Get unique items (alias for dedupe)
 */
export const unique = dedupe

/**
 * Get distinct items by a specific field
 */
export async function* distinctBy<T, K>(
  source: AsyncIterableSource<T>,
  keyExtractor: (item: T) => K
): AsyncGenerator<T, void, undefined> {
  const seen = new Set<string>()

  for await (const item of iterate(source)) {
    const key = JSON.stringify(keyExtractor(item))
    if (!seen.has(key)) {
      seen.add(key)
      yield item
    }
  }
}

// ============================================================================
// Partitioning
// ============================================================================

/**
 * Partition items into two groups based on predicate
 *
 * @example
 * ```typescript
 * const [evens, odds] = await partition([1, 2, 3, 4, 5], x => x % 2 === 0)
 * console.log(evens) // [2, 4]
 * console.log(odds)  // [1, 3, 5]
 * ```
 */
export async function partition<T>(
  source: AsyncIterableSource<T>,
  predicate: Predicate<T>
): Promise<[T[], T[]]> {
  const truthy: T[] = []
  const falsy: T[] = []

  for await (const item of iterate(source)) {
    if (await predicate(item)) {
      truthy.push(item)
    } else {
      falsy.push(item)
    }
  }

  return [truthy, falsy]
}

/**
 * Partition items into N buckets based on key function
 */
export async function partitionBy<T, K extends string | number>(
  source: AsyncIterableSource<T>,
  keyExtractor: (item: T) => K
): Promise<Map<K, T[]>> {
  const buckets = new Map<K, T[]>()

  for await (const item of iterate(source)) {
    const key = keyExtractor(item)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      buckets.set(key, [item])
    }
  }

  return buckets
}

// ============================================================================
// Sorting
// ============================================================================

/**
 * Sort items (requires collecting all items first)
 *
 * @example
 * ```typescript
 * const sorted = sort([3, 1, 4, 1, 5], (a, b) => a - b)
 * // yields: 1, 1, 3, 4, 5
 * ```
 */
export async function* sort<T>(
  source: AsyncIterableSource<T>,
  comparator?: (a: T, b: T) => number
): AsyncGenerator<T, void, undefined> {
  const items = await collect(source)
  items.sort(comparator)

  for (const item of items) {
    yield item
  }
}

/**
 * Sort by a key extracted from items
 */
export async function* sortBy<T, K>(
  source: AsyncIterableSource<T>,
  keyExtractor: (item: T) => K,
  direction: 'asc' | 'desc' = 'asc'
): AsyncGenerator<T, void, undefined> {
  const items = await collect(source)

  const multiplier = direction === 'asc' ? 1 : -1

  items.sort((a, b) => {
    const keyA = keyExtractor(a)
    const keyB = keyExtractor(b)

    if (keyA < keyB) return -1 * multiplier
    if (keyA > keyB) return 1 * multiplier
    return 0
  })

  for (const item of items) {
    yield item
  }
}

/**
 * Get top N items by a key
 */
export async function* topN<T, K>(
  source: AsyncIterableSource<T>,
  n: number,
  keyExtractor: (item: T) => K
): AsyncGenerator<T, void, undefined> {
  // Use a simple approach: collect, sort, take n
  // For very large datasets, consider a heap-based approach
  const items = await collect(source)

  items.sort((a, b) => {
    const keyA = keyExtractor(a)
    const keyB = keyExtractor(b)
    if (keyA > keyB) return -1 // Descending for "top"
    if (keyA < keyB) return 1
    return 0
  })

  for (let i = 0; i < Math.min(n, items.length); i++) {
    yield items[i]!
  }
}

/**
 * Get bottom N items by a key
 */
export async function* bottomN<T, K>(
  source: AsyncIterableSource<T>,
  n: number,
  keyExtractor: (item: T) => K
): AsyncGenerator<T, void, undefined> {
  const items = await collect(source)

  items.sort((a, b) => {
    const keyA = keyExtractor(a)
    const keyB = keyExtractor(b)
    if (keyA < keyB) return -1 // Ascending for "bottom"
    if (keyA > keyB) return 1
    return 0
  })

  for (let i = 0; i < Math.min(n, items.length); i++) {
    yield items[i]!
  }
}

// ============================================================================
// Parallel Processing
// ============================================================================

/**
 * Process items in parallel with concurrency limit
 *
 * @example
 * ```typescript
 * // Process up to 5 items concurrently
 * for await (const result of parallel(items, processItem, { concurrency: 5 })) {
 *   console.log(result)
 * }
 * ```
 */
export async function* parallel<T, R>(
  source: AsyncIterableSource<T>,
  transform: Transform<T, R>,
  options: ParallelOptions = {}
): AsyncGenerator<R, void, undefined> {
  const { concurrency = 4, preserveOrder = true } = options

  if (preserveOrder) {
    yield* parallelOrdered(source, transform, concurrency)
  } else {
    yield* parallelUnordered(source, transform, concurrency)
  }
}

/**
 * Parallel options
 */
export interface ParallelOptions {
  /**
   * Maximum concurrent operations
   * @default 4
   */
  concurrency?: number

  /**
   * Preserve input order in output
   * @default true
   */
  preserveOrder?: boolean
}

/**
 * Parallel processing with preserved order
 */
async function* parallelOrdered<T, R>(
  source: AsyncIterableSource<T>,
  transform: Transform<T, R>,
  concurrency: number
): AsyncGenerator<R, void, undefined> {
  const pending: Array<Promise<R>> = []
  const iterator = iterate(source)[Symbol.asyncIterator]()

  // Fill initial batch
  for (let i = 0; i < concurrency; i++) {
    const { done, value } = await iterator.next()
    if (done) break
    pending.push(Promise.resolve(transform(value)))
  }

  while (pending.length > 0) {
    // Wait for first to complete
    const result = await pending.shift()!
    yield result

    // Start next if available
    const { done, value } = await iterator.next()
    if (!done) {
      pending.push(Promise.resolve(transform(value)))
    }
  }
}

/**
 * Parallel processing without order preservation (faster)
 */
async function* parallelUnordered<T, R>(
  source: AsyncIterableSource<T>,
  transform: Transform<T, R>,
  concurrency: number
): AsyncGenerator<R, void, undefined> {
  const pending = new Map<number, Promise<{ id: number; result: R }>>()
  let nextId = 0
  const iterator = iterate(source)[Symbol.asyncIterator]()
  let sourceExhausted = false

  // Start initial batch
  for (let i = 0; i < concurrency; i++) {
    const { done, value } = await iterator.next()
    if (done) {
      sourceExhausted = true
      break
    }
    const id = nextId++
    pending.set(id, transform(value).then(result => ({ id, result })) as Promise<{ id: number; result: R }>)
  }

  while (pending.size > 0) {
    // Wait for any to complete
    const { id, result } = await Promise.race(pending.values())
    pending.delete(id)
    yield result

    // Start next if available
    if (!sourceExhausted) {
      const { done, value } = await iterator.next()
      if (!done) {
        const newId = nextId++
        pending.set(newId, transform(value).then(r => ({ id: newId, result: r })) as Promise<{ id: number; result: R }>)
      } else {
        sourceExhausted = true
      }
    }
  }
}

// ============================================================================
// Scan (Running Accumulation)
// ============================================================================

/**
 * Like reduce, but yields intermediate results
 *
 * @example
 * ```typescript
 * const runningSum = scan([1, 2, 3, 4], (acc, x) => acc + x, 0)
 * // yields: 1, 3, 6, 10
 * ```
 */
export async function* scan<T, R>(
  source: AsyncIterableSource<T>,
  reducer: (accumulator: R, item: T) => R | Promise<R>,
  initial: R
): AsyncGenerator<R, void, undefined> {
  let accumulator = initial

  for await (const item of iterate(source)) {
    accumulator = await reducer(accumulator, item)
    yield accumulator
  }
}

// ============================================================================
// Interleave
// ============================================================================

/**
 * Interleave items from multiple sources
 *
 * @example
 * ```typescript
 * const interleaved = interleave([1, 2, 3], ['a', 'b', 'c'])
 * // yields: 1, 'a', 2, 'b', 3, 'c'
 * ```
 */
export async function* interleave<T>(
  ...sources: AsyncIterableSource<T>[]
): AsyncGenerator<T, void, undefined> {
  const iterators = sources.map(s => iterate(s)[Symbol.asyncIterator]())
  const active = new Set(iterators.keys())

  while (active.size > 0) {
    for (const index of active) {
      const it = iterators[index]!
      const { done, value } = await it.next()

      if (done) {
        active.delete(index)
      } else {
        yield value
      }
    }
  }
}

// ============================================================================
// Timeout
// ============================================================================

/**
 * Add timeout to each item
 *
 * @example
 * ```typescript
 * // Error if any item takes longer than 5 seconds
 * for await (const item of timeout(source, 5000)) {
 *   await process(item)
 * }
 * ```
 */
export async function* timeout<T>(
  source: AsyncIterableSource<T>,
  ms: number
): AsyncGenerator<T, void, undefined> {
  const iterator = iterate(source)[Symbol.asyncIterator]()

  try {
    while (true) {
      const result = await Promise.race([
        iterator.next(),
        sleep(ms).then(() => {
          throw new Error(`Iterator timeout after ${ms}ms`)
        }),
      ])

      if (result.done) break
      yield result.value
    }
  } finally {
    if ('return' in iterator && typeof iterator.return === 'function') {
      await iterator.return()
    }
  }
}

/**
 * Skip items that take too long
 */
export async function* skipSlow<T>(
  source: AsyncIterableSource<T>,
  ms: number
): AsyncGenerator<T, void, undefined> {
  const iterator = iterate(source)[Symbol.asyncIterator]()

  try {
    while (true) {
      try {
        const result = await Promise.race([
          iterator.next(),
          sleep(ms).then(() => ({ done: false, value: undefined, timedOut: true })),
        ])

        if ('timedOut' in result && result.timedOut) {
          continue // Skip this item
        }

        if (result.done) break
        yield result.value as T
      } catch {
        // Skip on error
        continue
      }
    }
  } finally {
    if ('return' in iterator && typeof iterator.return === 'function') {
      await iterator.return()
    }
  }
}

// ============================================================================
// Utility
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
