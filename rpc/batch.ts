// Batch Map Promise - Efficient batching for array operations
// Implements the BatchMapPromise pattern for RPC operations

export interface BatchMapOptions<T, R> {
  // Maximum number of concurrent operations
  concurrency?: number

  // Maximum items per batch (for splitting large arrays)
  batchSize?: number

  // Progress callback
  onProgress?: (done: number, total: number) => void

  // Transform function applied to each result
  // Returns unknown to allow type-safe transformation with explicit typing at call sites
  transform?: (result: R) => unknown

  // Error handling strategy
  onError?: 'fail' | 'continue' | 'retry'

  // Number of retry attempts for failed items
  retries?: number

  // Callback for individual item errors
  onItemError?: (index: number, item: T, error: Error) => void
}

export interface BatchMapPromise<T> extends Promise<T[]> {
  // Set batch size
  batch(size: number): BatchMapPromise<T>

  // Set progress callback
  progress(callback: (done: number, total: number) => void): BatchMapPromise<T>
}

/**
 * Creates a BatchMapPromise that efficiently processes arrays with batching and concurrency control
 */
export function createBatchMapPromise<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R> | R,
  options: BatchMapOptions<T, R> = {}
): BatchMapPromise<R> {
  const {
    concurrency = Infinity,
    batchSize: _batchSize,
    onProgress,
    transform,
    onError = 'fail',
    retries = 0,
    onItemError
  } = options

  // Core processing logic
  const execute = async (): Promise<R[]> => {
    if (items.length === 0) return []

    // Results array preserving input order
    const results: R[] = new Array(items.length)
    const errors: Map<number, Error> = new Map()
    let completed = 0

    // Process a single item with retry logic
    const processItem = async (item: T, index: number, attemptsLeft = retries + 1): Promise<void> => {
      try {
        let result: R = await fn(item, index)

        // Apply transform if provided
        // The transform function can change the type, but this is type-erased at runtime
        // Callers using transform should ensure type compatibility
        if (transform) {
          result = (await transform(result)) as R
        }

        results[index] = result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))

        // Retry logic - applies regardless of error handling strategy
        if (attemptsLeft > 1) {
          return processItem(item, index, attemptsLeft - 1)
        }

        // Error handling after all retries exhausted
        if (onError === 'fail' || onError === 'retry') {
          throw err
        }

        if (onError === 'continue') {
          errors.set(index, err)
          if (onItemError) {
            onItemError(index, item, err)
          }
          // Leave result undefined for failed items
        }
      } finally {
        completed++
        if (onProgress) {
          onProgress(completed, items.length)
        }
      }
    }

    // Concurrency control
    if (concurrency === Infinity) {
      // Parallel execution - all at once
      await Promise.all(items.map((item, index) => processItem(item, index)))
    } else {
      // Limited concurrency using a worker pool
      const queue = items.map((item, index) => ({ item, index }))
      const workers: Promise<void>[] = []

      for (let i = 0; i < Math.min(concurrency, items.length); i++) {
        workers.push((async () => {
          while (queue.length > 0) {
            const next = queue.shift()
            if (next) {
              await processItem(next.item, next.index)
            }
          }
        })())
      }

      await Promise.all(workers)
    }

    return results
  }

  // Create the promise
  const promise = execute() as BatchMapPromise<R>

  // Add chainable methods
  Object.defineProperty(promise, 'batch', {
    value: (size: number): BatchMapPromise<R> => {
      return createBatchMapPromise(items, fn, {
        ...options,
        batchSize: size,
        concurrency: size
      })
    },
    enumerable: false
  })

  Object.defineProperty(promise, 'progress', {
    value: (callback: (done: number, total: number) => void): BatchMapPromise<R> => {
      return createBatchMapPromise(items, fn, {
        ...options,
        onProgress: callback
      })
    },
    enumerable: false
  })

  return promise
}

/**
 * Batch process an array with automatic chunking and concurrency control
 */
export async function batchMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R> | R,
  options: BatchMapOptions<T, R> = {}
): Promise<R[]> {
  return createBatchMapPromise(items, fn, options)
}
