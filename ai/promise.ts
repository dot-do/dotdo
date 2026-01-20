// AIPromise wrapper
// Extends Promise with AI-specific metadata, streaming, and composition

import { createStream, type Stream } from './stream'

export interface AIMeta {
  model?: string
  temperature?: number
  tokens?: { input: number; output: number }
  cost?: number
  duration?: number
}

export interface AIPromise<T> extends Promise<T> {
  readonly $meta: AIMeta
  with(options: Partial<AIMeta>): AIPromise<T>
  stream(): Stream<string>
  json<U = unknown>(): Promise<U>
  pipe<U>(fn: (value: T) => U | Promise<U>): AIPromise<U>
}

/**
 * Options for creating an AIPromise with streaming support
 */
export interface AIPromiseOptions {
  /** Initial metadata */
  initialMeta?: AIMeta
  /** Stream executor - returns an async iterable of chunks */
  streamExecutor?: (meta: AIMeta) => AsyncIterable<string>
}

/**
 * Create an AIPromise that wraps a completion executor
 *
 * @param executor - Function that executes the AI call and returns a result
 * @param options - Options including initial metadata and optional stream executor
 */
export function createAIPromise<T>(
  executor: (meta: AIMeta) => Promise<T>,
  optionsOrMeta: AIPromiseOptions | AIMeta = {}
): AIPromise<T> {
  // Support both old signature (just AIMeta) and new signature (AIPromiseOptions)
  const isAIPromiseOptions = (obj: object): obj is AIPromiseOptions =>
    'initialMeta' in obj || 'streamExecutor' in obj

  const options: AIPromiseOptions = isAIPromiseOptions(optionsOrMeta)
    ? optionsOrMeta
    : { initialMeta: optionsOrMeta }

  const meta: AIMeta = { ...(options.initialMeta || {}) }

  // Create the base promise - lazily executed
  let basePromiseCache: Promise<T> | null = null
  const getBasePromise = () => {
    if (!basePromiseCache) {
      basePromiseCache = executor(meta)
    }
    return basePromiseCache
  }

  // We need to create the promise immediately for proper Promise behavior
  const basePromise = getBasePromise()

  // Extend with AIPromise methods
  const aiPromise = basePromise as AIPromise<T>

  Object.defineProperty(aiPromise, '$meta', {
    get: () => meta,
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'with', {
    value: (newOptions: Partial<AIMeta>) => {
      // Create a new promise with updated meta but re-run the executor
      const updatedMeta = { ...meta, ...newOptions }

      // Build options for the new promise
      const newPromiseOptions: AIPromiseOptions = {
        initialMeta: updatedMeta,
      }

      // Only add streamExecutor if it exists
      if (options.streamExecutor) {
        newPromiseOptions.streamExecutor = (m) => {
          Object.assign(m, updatedMeta)
          return options.streamExecutor!(m)
        }
      }

      return createAIPromise(
        async (m) => {
          // Copy updated meta
          Object.assign(m, updatedMeta)
          // Re-run the executor with updated meta
          return executor(m)
        },
        newPromiseOptions
      )
    },
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'stream', {
    value: function (): Stream<string> {
      // Use custom stream executor if provided (real LLM streaming)
      if (options.streamExecutor) {
        return createStream(options.streamExecutor(meta))
      }

      // Fallback: chunk the completed result for backward compatibility
      async function* generator() {
        const result = await basePromise
        const resultString = String(result)

        // Simulate streaming by chunking the result
        const chunkSize = 10
        for (let i = 0; i < resultString.length; i += chunkSize) {
          yield resultString.slice(i, i + chunkSize)
        }
      }

      return createStream(generator())
    },
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'json', {
    value: async function <U = unknown>(): Promise<U> {
      const result = await basePromise

      // If already an object, return as-is
      if (typeof result === 'object' && result !== null) {
        return result as U
      }

      // Otherwise parse as JSON
      return JSON.parse(String(result)) as U
    },
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'pipe', {
    value: function <U>(fn: (value: T) => U | Promise<U>): AIPromise<U> {
      return createAIPromise<U>(
        async (pipeMeta) => {
          // Wait for base promise to resolve
          const result = await basePromise

          // Copy meta from original promise
          Object.assign(pipeMeta, meta)

          // Apply transformation
          return await fn(result)
        },
        { initialMeta: { ...meta } }
      )
    },
    enumerable: true
  })

  return aiPromise
}
