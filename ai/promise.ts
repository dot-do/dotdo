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
  boolean(): AIPromise<boolean>
  list<U = unknown>(): AIPromise<U[]>
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

  Object.defineProperty(aiPromise, 'boolean', {
    value: function (): AIPromise<boolean> {
      return createAIPromise<boolean>(
        async (boolMeta) => {
          // Wait for base promise to resolve
          const result = await basePromise

          // Copy meta from original promise
          Object.assign(boolMeta, meta)

          // Convert result to string for parsing
          const resultString = String(result).trim().toLowerCase()

          // Parse as boolean - check for affirmative responses
          // Accepts: true, yes, y, 1, on, affirmative, correct, etc.
          const affirmativePatterns = /^(true|yes|y|1|on|affirmative|correct|right|ok|okay|sure|indeed|absolutely|definitely)$/i
          return affirmativePatterns.test(resultString)
        },
        { ...meta }
      )
    },
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'list', {
    value: function <U = unknown>(): AIPromise<U[]> {
      return createAIPromise<U[]>(
        async (listMeta) => {
          // Wait for base promise to resolve
          const result = await basePromise

          // Copy meta from original promise
          Object.assign(listMeta, meta)

          // Parse as JSON array
          // If already an array, return as-is
          if (Array.isArray(result)) {
            return result as U[]
          }

          // Try to parse as JSON if it's a string
          const resultString = String(result).trim()

          // Try to parse as JSON array
          try {
            const parsed = JSON.parse(resultString)
            if (Array.isArray(parsed)) {
              return parsed as U[]
            }
            // If it parses to a JSON object, wrap it in an array
            return [parsed] as U[]
          } catch {
            // If JSON parsing fails, try to parse as a newline-delimited list
            // Split by newlines, commas, or markdown list markers
            const lines = resultString
              .split(/[\n,]/)
              .map(line => line.trim())
              .filter(line => {
                // Remove markdown list markers, bullets, numbers
                return line.length > 0 && !line.match(/^[-*•+\d+.]\s*$/)
              })
              .map(line => {
                // Clean up markdown list markers (numbered: "1. ", "2. ", etc., and bullets: "- ", "* ", etc.)
                return line.replace(/^\d+\.\s+/, '').replace(/^[-*•+]\s+/, '').trim()
              })
              .filter(line => line.length > 0)

            // Try to parse each line as JSON if it looks like JSON
            return lines.map(line => {
              try {
                return JSON.parse(line) as U
              } catch {
                // If not JSON, return as string
                return line as unknown as U
              }
            })
          }
        },
        { ...meta }
      )
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
