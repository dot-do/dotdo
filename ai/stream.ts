/**
 * Stream utilities for AI token streaming
 *
 * Provides AsyncIterable interface with transformations, backpressure, and cancellation.
 * Integrates with AIPromise.stream() to enable streaming responses from LLMs.
 *
 * @example
 * ```ts
 * // Basic streaming
 * const response = ai`Write a story about dragons`
 * for await (const chunk of response.stream()) {
 *   process.stdout.write(chunk)
 * }
 *
 * // Stream transformations
 * const uppercased = await response.stream()
 *   .map(chunk => chunk.toUpperCase())
 *   .collect()
 *
 * // Stream filtering
 * const onlyLetters = await response.stream()
 *   .filter(chunk => /[a-zA-Z]/.test(chunk))
 *   .join('')
 *
 * // Stream cancellation
 * const controller = new AbortController()
 * const stream = response.stream({ signal: controller.signal })
 * setTimeout(() => controller.abort(), 1000) // Cancel after 1s
 *
 * // Collect to array
 * const chunks = await response.stream().collect()
 *
 * // Join to string
 * const fullText = await response.stream().join('')
 * ```
 *
 * @module stream
 */

/**
 * Options for stream creation
 */
export interface StreamOptions {
  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

/**
 * Stream interface with transformation and collection methods
 */
export interface Stream<T> extends AsyncIterable<T> {
  /** Transform each chunk */
  map<U>(fn: (chunk: T) => U | Promise<U>): Stream<U>

  /** Filter chunks */
  filter(fn: (chunk: T) => boolean | Promise<boolean>): Stream<T>

  /** Take first n chunks */
  take(n: number): Stream<T>

  /** Peek at each chunk without consuming */
  peek(fn: (chunk: T) => void | Promise<void>): Stream<T>

  /** Collect all chunks into array */
  collect(): Promise<T[]>

  /** Join string chunks */
  join(separator?: string): Promise<string>

  /** Execute side effect for each chunk */
  forEach(fn: (chunk: T) => void | Promise<void>): Promise<void>

  /** Reduce stream to single value */
  reduce<U>(fn: (acc: U, chunk: T) => U | Promise<U>, initial: U): Promise<U>
  reduce(fn: (acc: T, chunk: T) => T | Promise<T>): Promise<T>
}

/**
 * Internal stream implementation
 */
class StreamImpl<T> implements Stream<T> {
  private source: AsyncIterable<T>
  private options: StreamOptions
  private cache: T[] | null = null
  private consumed = false
  private error: unknown = null

  constructor(source: AsyncIterable<T>, options: StreamOptions = {}) {
    this.source = source
    this.options = options
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    // Check if already aborted
    if (this.options.signal?.aborted) {
      throw new DOMException('Stream aborted', 'AbortError')
    }

    // If already consumed, return cached chunks
    if (this.cache !== null) {
      for (const chunk of this.cache) {
        yield chunk
      }
      return
    }

    // If we encountered an error before, re-throw
    if (this.error !== null) {
      throw this.error
    }

    // Initialize cache for multiple consumers
    this.cache = []
    this.consumed = true

    // Set up abort listener with proper cleanup
    // Use { once: true } to auto-cleanup if abort fires, and track for manual cleanup
    let abortListenerAttached = false
    const abortListener = () => {
      // Listener fired - no need to manually remove since { once: true }
      abortListenerAttached = false
    }

    if (this.options.signal) {
      this.options.signal.addEventListener('abort', abortListener, { once: true })
      abortListenerAttached = true
    }

    try {
      for await (const chunk of this.source) {
        // Check for cancellation
        if (this.options.signal?.aborted) {
          throw new DOMException('Stream aborted', 'AbortError')
        }

        this.cache.push(chunk)
        yield chunk
      }
    } catch (error) {
      this.error = error
      throw error
    } finally {
      // Only remove if listener is still attached (abort didn't fire)
      if (abortListenerAttached && this.options.signal) {
        this.options.signal.removeEventListener('abort', abortListener)
      }
    }
  }

  map<U>(fn: (chunk: T) => U | Promise<U>): Stream<U> {
    const source = this
    async function* mapGenerator(): AsyncGenerator<U> {
      for await (const chunk of source) {
        yield await fn(chunk)
      }
    }
    return new StreamImpl(mapGenerator(), this.options)
  }

  filter(fn: (chunk: T) => boolean | Promise<boolean>): Stream<T> {
    const source = this
    async function* filterGenerator(): AsyncGenerator<T> {
      for await (const chunk of source) {
        if (await fn(chunk)) {
          yield chunk
        }
      }
    }
    return new StreamImpl(filterGenerator(), this.options)
  }

  take(n: number): Stream<T> {
    const source = this
    async function* takeGenerator(): AsyncGenerator<T> {
      let count = 0
      for await (const chunk of source) {
        if (count >= n) break
        yield chunk
        count++
      }
    }
    return new StreamImpl(takeGenerator(), this.options)
  }

  peek(fn: (chunk: T) => void | Promise<void>): Stream<T> {
    const source = this
    async function* peekGenerator(): AsyncGenerator<T> {
      for await (const chunk of source) {
        await fn(chunk)
        yield chunk
      }
    }
    return new StreamImpl(peekGenerator(), this.options)
  }

  async collect(): Promise<T[]> {
    const result: T[] = []
    for await (const chunk of this) {
      result.push(chunk)
    }
    return result
  }

  async join(separator = ''): Promise<string> {
    const chunks = await this.collect()
    return chunks.map(String).join(separator)
  }

  async forEach(fn: (chunk: T) => void | Promise<void>): Promise<void> {
    for await (const chunk of this) {
      await fn(chunk)
    }
  }

  async reduce(
    fn: (acc: T, chunk: T) => T | Promise<T>
  ): Promise<T>
  async reduce<U>(
    fn: (acc: U, chunk: T) => U | Promise<U>,
    initial: U
  ): Promise<U>
  async reduce<U>(
    fn: (acc: U | T, chunk: T) => U | T | Promise<U | T>,
    initial?: U
  ): Promise<U | T> {
    const hasInitial = arguments.length >= 2
    let acc: U | T | undefined = initial
    let first = true

    for await (const chunk of this) {
      if (first && !hasInitial) {
        acc = chunk
        first = false
        continue
      }
      acc = await fn(acc as U | T, chunk)
      first = false
    }

    if (first && !hasInitial) {
      throw new Error('Reduce of empty stream with no initial value')
    }

    return acc as U | T
  }
}

/**
 * Create a stream from an async iterable
 */
export function createStream<T>(
  source: AsyncIterable<T>,
  options?: StreamOptions
): Stream<T> {
  return new StreamImpl(source, options)
}

/**
 * Create a stream from an array
 */
export function fromArray<T>(array: T[], options?: StreamOptions): Stream<T> {
  async function* generator() {
    for (const item of array) {
      yield item
    }
  }
  return createStream(generator(), options)
}

/**
 * Create a stream from values
 */
export function fromValues<T>(...values: T[]): Stream<T> {
  return fromArray(values)
}

/**
 * Merge multiple streams into one
 */
export function merge<T>(...streams: Stream<T>[]): Stream<T> {
  async function* mergeGenerator() {
    for (const stream of streams) {
      for await (const chunk of stream) {
        yield chunk
      }
    }
  }
  return createStream(mergeGenerator())
}

/**
 * Create a stream that emits values at intervals
 */
export function interval(ms: number, options?: StreamOptions): Stream<number> {
  async function* intervalGenerator() {
    let count = 0
    while (true) {
      if (options?.signal?.aborted) {
        throw new DOMException('Stream aborted', 'AbortError')
      }
      yield count++
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
  }
  return createStream(intervalGenerator(), options)
}

/**
 * Create an empty stream
 */
export function empty<T>(): Stream<T> {
  async function* emptyGenerator() {
    // empty
  }
  return createStream(emptyGenerator())
}
