/**
 * Iterator Module - Convert data sources to async iterators
 *
 * Provides standardized patterns for creating async iterators from
 * various data sources with support for lazy evaluation.
 */

import type {
  AsyncIterableSource,
  IteratorOptions,
  BatchIteratorOptions,
  Transform,
  Predicate,
} from './types'

// ============================================================================
// Core Iterator Functions
// ============================================================================

/**
 * Convert any iterable source to an async iterator
 *
 * Supports:
 * - Arrays
 * - Sync iterables
 * - Async iterables
 * - Generators
 * - ReadableStreams
 *
 * @example
 * ```typescript
 * // From array
 * for await (const item of iterate([1, 2, 3])) {
 *   console.log(item)
 * }
 *
 * // With options
 * for await (const item of iterate(data, { limit: 10, offset: 5 })) {
 *   console.log(item)
 * }
 * ```
 */
export async function* iterate<T>(
  source: AsyncIterableSource<T>,
  options: IteratorOptions = {}
): AsyncGenerator<T, void, undefined> {
  const { limit, offset = 0, delayMs, signal } = options

  let index = 0
  let yielded = 0

  // Convert source to async iterator
  const iterator = toAsyncIterator(source)

  try {
    for await (const item of iterator) {
      // Check for cancellation
      if (signal?.aborted) {
        break
      }

      // Handle offset
      if (index < offset) {
        index++
        continue
      }

      // Handle limit
      if (limit !== undefined && yielded >= limit) {
        break
      }

      // Apply delay for rate limiting
      if (delayMs && delayMs > 0 && yielded > 0) {
        await sleep(delayMs)
      }

      yield item
      yielded++
      index++
    }
  } finally {
    // Cleanup: call return() on iterator if it exists
    if ('return' in iterator && typeof iterator.return === 'function') {
      await iterator.return()
    }
  }
}

/**
 * Iterate in batches for efficient bulk processing
 *
 * @example
 * ```typescript
 * // Process 100 items at a time
 * for await (const batch of batchIterate(largeDataset, { batchSize: 100 })) {
 *   await processBatch(batch)
 * }
 * ```
 */
export async function* batchIterate<T>(
  source: AsyncIterableSource<T>,
  options: BatchIteratorOptions = {}
): AsyncGenerator<T[], void, undefined> {
  const { batchSize = 100, emitPartial = true, signal, ...iteratorOptions } = options

  let batch: T[] = []

  for await (const item of iterate(source, { ...iteratorOptions, signal })) {
    batch.push(item)

    if (batch.length >= batchSize) {
      yield batch
      batch = []
    }
  }

  // Emit remaining items
  if (emitPartial && batch.length > 0) {
    yield batch
  }
}

/**
 * Create a range iterator (lazy sequence generation)
 *
 * @example
 * ```typescript
 * // Generate numbers 0 to 99
 * for await (const n of range(100)) {
 *   console.log(n)
 * }
 *
 * // Generate 10 to 20 with step 2
 * for await (const n of range(10, 20, 2)) {
 *   console.log(n) // 10, 12, 14, 16, 18
 * }
 * ```
 */
export async function* range(
  startOrEnd: number,
  end?: number,
  step: number = 1
): AsyncGenerator<number, void, undefined> {
  const start = end === undefined ? 0 : startOrEnd
  const actualEnd = end === undefined ? startOrEnd : end
  const actualStep = step === 0 ? 1 : step

  if (actualStep > 0) {
    for (let i = start; i < actualEnd; i += actualStep) {
      yield i
    }
  } else {
    for (let i = start; i > actualEnd; i += actualStep) {
      yield i
    }
  }
}

/**
 * Create an infinite iterator that repeats values
 *
 * @example
 * ```typescript
 * // Repeat a value infinitely (use with take())
 * const ones = repeat(1)
 *
 * // Cycle through values
 * const colors = cycle(['red', 'green', 'blue'])
 * ```
 */
export async function* repeat<T>(value: T): AsyncGenerator<T, void, undefined> {
  while (true) {
    yield value
  }
}

/**
 * Cycle through values indefinitely
 */
export async function* cycle<T>(
  values: T[]
): AsyncGenerator<T, void, undefined> {
  if (values.length === 0) return

  while (true) {
    for (const value of values) {
      yield value
    }
  }
}

/**
 * Generate values from a factory function
 *
 * @example
 * ```typescript
 * // Generate timestamps
 * const timestamps = generate(() => Date.now())
 *
 * // Generate with index
 * const indexed = generate((i) => ({ id: i, value: Math.random() }))
 * ```
 */
export async function* generate<T>(
  factory: (index: number) => T | Promise<T>,
  options: IteratorOptions = {}
): AsyncGenerator<T, void, undefined> {
  const { limit, signal } = options
  let index = 0

  while (true) {
    if (signal?.aborted) break
    if (limit !== undefined && index >= limit) break

    yield await factory(index)
    index++
  }
}

// ============================================================================
// Iterator Combinators
// ============================================================================

/**
 * Map items through a transform function (lazy)
 *
 * @example
 * ```typescript
 * const doubled = map(iterate([1, 2, 3]), x => x * 2)
 * for await (const n of doubled) {
 *   console.log(n) // 2, 4, 6
 * }
 * ```
 */
export async function* map<T, R>(
  source: AsyncIterableSource<T>,
  transform: Transform<T, R>
): AsyncGenerator<R, void, undefined> {
  for await (const item of iterate(source)) {
    yield await transform(item)
  }
}

/**
 * Filter items based on a predicate (lazy)
 *
 * @example
 * ```typescript
 * const evens = filter(iterate([1, 2, 3, 4]), x => x % 2 === 0)
 * ```
 */
export async function* filter<T>(
  source: AsyncIterableSource<T>,
  predicate: Predicate<T>
): AsyncGenerator<T, void, undefined> {
  for await (const item of iterate(source)) {
    if (await predicate(item)) {
      yield item
    }
  }
}

/**
 * Take first N items from an iterator
 *
 * @example
 * ```typescript
 * const first10 = take(infiniteGenerator(), 10)
 * ```
 */
export async function* take<T>(
  source: AsyncIterableSource<T>,
  count: number
): AsyncGenerator<T, void, undefined> {
  yield* iterate(source, { limit: count })
}

/**
 * Skip first N items from an iterator
 *
 * @example
 * ```typescript
 * const afterFirst10 = skip(data, 10)
 * ```
 */
export async function* skip<T>(
  source: AsyncIterableSource<T>,
  count: number
): AsyncGenerator<T, void, undefined> {
  yield* iterate(source, { offset: count })
}

/**
 * Take items while predicate is true
 */
export async function* takeWhile<T>(
  source: AsyncIterableSource<T>,
  predicate: Predicate<T>
): AsyncGenerator<T, void, undefined> {
  for await (const item of iterate(source)) {
    if (!(await predicate(item))) break
    yield item
  }
}

/**
 * Skip items while predicate is true
 */
export async function* skipWhile<T>(
  source: AsyncIterableSource<T>,
  predicate: Predicate<T>
): AsyncGenerator<T, void, undefined> {
  let skipping = true

  for await (const item of iterate(source)) {
    if (skipping && (await predicate(item))) {
      continue
    }
    skipping = false
    yield item
  }
}

/**
 * Flatten nested iterables
 *
 * @example
 * ```typescript
 * const flat = flatten([[1, 2], [3, 4], [5, 6]])
 * // yields: 1, 2, 3, 4, 5, 6
 * ```
 */
export async function* flatten<T>(
  source: AsyncIterableSource<Iterable<T> | AsyncIterable<T>>
): AsyncGenerator<T, void, undefined> {
  for await (const iterable of iterate(source)) {
    for await (const item of iterate(iterable as AsyncIterableSource<T>)) {
      yield item
    }
  }
}

/**
 * FlatMap - map and flatten in one operation
 */
export async function* flatMap<T, R>(
  source: AsyncIterableSource<T>,
  transform: (item: T) => Iterable<R> | AsyncIterable<R> | Promise<Iterable<R> | AsyncIterable<R>>
): AsyncGenerator<R, void, undefined> {
  for await (const item of iterate(source)) {
    const result = await transform(item)
    for await (const mapped of iterate(result as AsyncIterableSource<R>)) {
      yield mapped
    }
  }
}

/**
 * Zip multiple iterators together
 *
 * @example
 * ```typescript
 * const zipped = zip([1, 2, 3], ['a', 'b', 'c'])
 * // yields: [1, 'a'], [2, 'b'], [3, 'c']
 * ```
 */
export async function* zip<T extends unknown[]>(
  ...sources: { [K in keyof T]: AsyncIterableSource<T[K]> }
): AsyncGenerator<T, void, undefined> {
  const iterators = sources.map(s => toAsyncIterator(s))

  try {
    while (true) {
      const results = await Promise.all(
        iterators.map(it => it.next())
      )

      if (results.some(r => r.done)) break

      yield results.map(r => r.value) as T
    }
  } finally {
    // Cleanup all iterators
    for (const it of iterators) {
      if ('return' in it && typeof it.return === 'function') {
        await it.return()
      }
    }
  }
}

/**
 * Concatenate multiple iterators
 *
 * @example
 * ```typescript
 * const all = concat([1, 2], [3, 4], [5, 6])
 * // yields: 1, 2, 3, 4, 5, 6
 * ```
 */
export async function* concat<T>(
  ...sources: AsyncIterableSource<T>[]
): AsyncGenerator<T, void, undefined> {
  for (const source of sources) {
    yield* iterate(source)
  }
}

/**
 * Merge multiple async iterators, yielding items as they arrive
 *
 * @example
 * ```typescript
 * const merged = merge(fastSource, slowSource)
 * // Items yielded in order of arrival
 * ```
 */
export async function* merge<T>(
  ...sources: AsyncIterableSource<T>[]
): AsyncGenerator<T, void, undefined> {
  const iterators = sources.map(s => toAsyncIterator(s))
  const pending = new Map<number, Promise<{ index: number; result: IteratorResult<T> }>>()

  // Start all iterators
  for (let i = 0; i < iterators.length; i++) {
    const it = iterators[i]!
    pending.set(i, it.next().then(result => ({ index: i, result })))
  }

  try {
    while (pending.size > 0) {
      // Wait for any iterator to yield
      const { index, result } = await Promise.race(pending.values())

      if (result.done) {
        pending.delete(index)
      } else {
        yield result.value

        // Request next value from same iterator
        const it = iterators[index]!
        pending.set(index, it.next().then(r => ({ index, result: r })))
      }
    }
  } finally {
    // Cleanup
    for (const it of iterators) {
      if ('return' in it && typeof it.return === 'function') {
        await it.return()
      }
    }
  }
}

/**
 * Add index to each item
 *
 * @example
 * ```typescript
 * for await (const [index, item] of enumerate(['a', 'b', 'c'])) {
 *   console.log(index, item) // 0 'a', 1 'b', 2 'c'
 * }
 * ```
 */
export async function* enumerate<T>(
  source: AsyncIterableSource<T>,
  start: number = 0
): AsyncGenerator<[number, T], void, undefined> {
  let index = start
  for await (const item of iterate(source)) {
    yield [index++, item]
  }
}

/**
 * Window/sliding window over items
 *
 * @example
 * ```typescript
 * const windows = window([1, 2, 3, 4, 5], 3)
 * // yields: [1, 2, 3], [2, 3, 4], [3, 4, 5]
 * ```
 */
export async function* window<T>(
  source: AsyncIterableSource<T>,
  size: number
): AsyncGenerator<T[], void, undefined> {
  const buffer: T[] = []

  for await (const item of iterate(source)) {
    buffer.push(item)

    if (buffer.length > size) {
      buffer.shift()
    }

    if (buffer.length === size) {
      yield [...buffer]
    }
  }
}

/**
 * Chunk items into fixed-size arrays
 *
 * @example
 * ```typescript
 * const chunks = chunk([1, 2, 3, 4, 5], 2)
 * // yields: [1, 2], [3, 4], [5]
 * ```
 */
export async function* chunk<T>(
  source: AsyncIterableSource<T>,
  size: number
): AsyncGenerator<T[], void, undefined> {
  yield* batchIterate(source, { batchSize: size, emitPartial: true })
}

/**
 * Tap into stream without modifying it (for side effects/logging)
 *
 * @example
 * ```typescript
 * const logged = tap(source, item => console.log('Processing:', item))
 * ```
 */
export async function* tap<T>(
  source: AsyncIterableSource<T>,
  fn: (item: T, index: number) => void | Promise<void>
): AsyncGenerator<T, void, undefined> {
  let index = 0
  for await (const item of iterate(source)) {
    await fn(item, index++)
    yield item
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert any source to an async iterator
 */
function toAsyncIterator<T>(
  source: AsyncIterableSource<T>
): AsyncIterator<T> {
  // ReadableStream
  if (source instanceof ReadableStream) {
    return streamToAsyncIterator(source)
  }

  // Async iterable
  if (Symbol.asyncIterator in source) {
    return (source as AsyncIterable<T>)[Symbol.asyncIterator]()
  }

  // Sync iterable (including arrays)
  if (Symbol.iterator in source) {
    return syncToAsyncIterator((source as Iterable<T>)[Symbol.iterator]())
  }

  throw new Error('Source is not iterable')
}

/**
 * Convert sync iterator to async
 */
async function* syncToAsyncIterator<T>(
  iterator: Iterator<T>
): AsyncGenerator<T, void, undefined> {
  while (true) {
    const result = iterator.next()
    if (result.done) break
    yield result.value
  }
}

/**
 * Convert ReadableStream to async iterator
 */
async function* streamToAsyncIterator<T>(
  stream: ReadableStream<T>
): AsyncGenerator<T, void, undefined> {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// Export convenience function
// ============================================================================

export { toAsyncIterator }
