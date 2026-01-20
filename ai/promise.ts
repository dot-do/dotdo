// AIPromise wrapper

import { createStream, type Stream } from './stream'
import type { JSONSchema } from './ai-core'
import type { ZodTypeAny } from 'zod'

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

export function createAIPromise<T>(
  executor: (meta: AIMeta) => Promise<T>,
  initialMeta: AIMeta = {}
): AIPromise<T> {
  const meta: AIMeta = { ...initialMeta }

  // Create the base promise
  const basePromise = executor(meta)

  // Extend with AIPromise methods
  const aiPromise = basePromise as AIPromise<T>

  Object.defineProperty(aiPromise, '$meta', {
    get: () => meta,
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'with', {
    value: (options: Partial<AIMeta>) => {
      return createAIPromise(executor, { ...meta, ...options })
    },
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'stream', {
    value: function (): Stream<string> {
      // Create an async generator that yields the result
      // In a real implementation, this would stream from the LLM
      async function* generator() {
        const result = await basePromise
        const resultString = String(result)

        // Simulate streaming by chunking the result
        // Real implementation would get chunks from LLM
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
        { ...meta }
      )
    },
    enumerable: true
  })

  return aiPromise
}
