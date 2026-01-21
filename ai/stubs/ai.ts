/**
 * Mock stub for ai (Vercel AI SDK) module during testing.
 *
 * This stub provides mock implementations of the AI SDK functions
 * so that @org.ai/core can be imported and tested without requiring
 * actual AI API calls.
 *
 * @module ai/stubs/ai
 */

// ============================================================================
// Types (matching Vercel AI SDK types)
// ============================================================================

export interface LanguageModel {
  readonly provider: string
  readonly modelId: string
  readonly specificationVersion: string
}

export interface GenerateObjectResult<T> {
  object: T
  finishReason: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  rawResponse?: { headers?: Record<string, string> }
  warnings?: unknown[]
  toJsonResponse?: (options?: { headers?: Record<string, string> }) => Response
}

export interface GenerateTextResult {
  text: string
  finishReason: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  rawResponse?: { headers?: Record<string, string> }
  warnings?: unknown[]
  toolCalls?: unknown[]
  toolResults?: unknown[]
  responseMessages?: unknown[]
  steps?: unknown[]
  toJsonResponse?: (options?: { headers?: Record<string, string> }) => Response
}

export interface StreamObjectResult<T, U, V> {
  partialObjectStream: AsyncIterable<Partial<T>>
  object: Promise<T>
  textStream: AsyncIterable<string>
  fullStream: AsyncIterable<unknown>
  usage: Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }>
  finishReason: Promise<string>
  warnings: Promise<unknown[]>
  rawResponse: Promise<{ headers?: Record<string, string> }>
  toTextStreamResponse?: (options?: { headers?: Record<string, string> }) => Response
}

export interface StreamTextResult {
  textStream: AsyncIterable<string>
  fullStream: AsyncIterable<unknown>
  text: Promise<string>
  usage: Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }>
  finishReason: Promise<string>
  rawResponse: Promise<{ headers?: Record<string, string> }>
  warnings: Promise<unknown[]>
  toolCalls: Promise<unknown[]>
  toolResults: Promise<unknown[]>
  steps: Promise<unknown[]>
  toTextStreamResponse?: (options?: { headers?: Record<string, string> }) => Response
  pipeTextStreamToResponse?: (response: unknown, options?: unknown) => void
}

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Extract a reasonable mock value from a schema
 */
function generateMockFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') {
    return { result: 'mock result' }
  }

  // Handle Zod schemas (duck typing)
  if ('_def' in schema && 'parse' in schema) {
    const def = (schema as {
      _def: {
        typeName?: string
        shape?: () => Record<string, unknown>
        values?: unknown
        element?: unknown
        innerType?: unknown
        type?: unknown
      }
    })._def
    const typeName = def.typeName

    if (typeName === 'ZodObject' && def.shape) {
      const shape = def.shape()
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(shape)) {
        result[key] = generateMockFromSchema(value)
      }
      return result
    }
    if (typeName === 'ZodArray') {
      // Handle ZodArray - return multiple mock elements
      const element = def.element || def.type
      if (element) {
        return [
          generateMockFromSchema(element),
          generateMockFromSchema(element),
          generateMockFromSchema(element),
        ]
      }
      return ['mock item 1', 'mock item 2', 'mock item 3']
    }
    if (typeName === 'ZodString') return 'mock string'
    if (typeName === 'ZodNumber') return 42
    if (typeName === 'ZodBoolean') return true
    if (typeName === 'ZodEnum' && def.values) {
      const values = def.values as unknown[]
      return values[0]
    }
    // Handle ZodEffects (refinements, transforms) - unwrap the inner type
    if (typeName === 'ZodEffects' && def.innerType) {
      return generateMockFromSchema(def.innerType)
    }
    // Handle other Zod types with innerType
    if (def.innerType) {
      return generateMockFromSchema(def.innerType)
    }
  }

  // Handle SimpleSchema objects
  const simpleSchema = schema as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(simpleSchema)) {
    if (Array.isArray(value)) {
      // Array schema - return array of mock strings
      result[key] = ['mock item 1', 'mock item 2', 'mock item 3']
    } else if (typeof value === 'string') {
      // String description - infer type from description
      const desc = value.toLowerCase()
      if (desc.includes('true') && desc.includes('false')) {
        result[key] = 'true'
      } else if (desc.includes('number')) {
        result[key] = 42
      } else {
        result[key] = `mock ${key}`
      }
    } else if (typeof value === 'object' && value !== null) {
      // Nested object
      result[key] = generateMockFromSchema(value)
    } else {
      result[key] = `mock ${key}`
    }
  }

  return Object.keys(result).length > 0 ? result : { result: 'mock result' }
}

/**
 * Mock generateObject - returns a mock object based on the schema
 */
export async function generateObject<T>(options: {
  model: LanguageModel | string
  schema: unknown
  prompt?: string
  messages?: unknown[]
  system?: string
  mode?: string
  maxTokens?: number
  temperature?: number
  output?: string
  [key: string]: unknown
}): Promise<GenerateObjectResult<T>> {
  const mockObject = generateMockFromSchema(options.schema) as T

  return {
    object: mockObject,
    finishReason: 'stop',
    usage: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    },
  }
}

/**
 * Mock generateText - returns mock text
 */
export async function generateText(options: {
  model: LanguageModel | string
  prompt?: string
  messages?: unknown[]
  system?: string
  maxTokens?: number
  temperature?: number
  [key: string]: unknown
}): Promise<GenerateTextResult> {
  return {
    text: `Mock response for: ${options.prompt || 'no prompt'}`,
    finishReason: 'stop',
    usage: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    },
  }
}

/**
 * Mock streamObject - returns an async iterable of partial objects
 */
export async function streamObject<T>(options: {
  model: LanguageModel | string
  schema: unknown
  prompt?: string
  messages?: unknown[]
  system?: string
  maxTokens?: number
  temperature?: number
  output?: string
  abortSignal?: AbortSignal
  [key: string]: unknown
}): Promise<StreamObjectResult<T, T, never>> {
  const mockObject = generateMockFromSchema(options.schema) as T

  // Create async iterables
  async function* createPartialObjectStream(): AsyncGenerator<Partial<T>> {
    // Simulate streaming by yielding partial objects
    const keys = Object.keys(mockObject as object)
    let partial: Partial<T> = {}
    for (const key of keys) {
      partial = { ...partial, [key]: (mockObject as Record<string, unknown>)[key] }
      yield partial
    }
  }

  async function* createTextStream(): AsyncGenerator<string> {
    yield JSON.stringify(mockObject)
  }

  async function* createFullStream(): AsyncGenerator<unknown> {
    yield { type: 'object', object: mockObject }
  }

  return {
    partialObjectStream: { [Symbol.asyncIterator]: createPartialObjectStream },
    object: Promise.resolve(mockObject),
    textStream: { [Symbol.asyncIterator]: createTextStream },
    fullStream: { [Symbol.asyncIterator]: createFullStream },
    usage: Promise.resolve({ promptTokens: 100, completionTokens: 50, totalTokens: 150 }),
    finishReason: Promise.resolve('stop'),
    warnings: Promise.resolve([]),
    rawResponse: Promise.resolve({}),
  }
}

/**
 * Mock streamText - returns an async iterable of text chunks
 */
export async function streamText(options: {
  model: LanguageModel | string
  prompt?: string
  messages?: unknown[]
  system?: string
  maxTokens?: number
  temperature?: number
  abortSignal?: AbortSignal
  [key: string]: unknown
}): Promise<StreamTextResult> {
  const mockText = `Mock streaming response for: ${options.prompt || 'no prompt'}`
  const chunks = mockText.split(' ')

  async function* createTextStream(): AsyncGenerator<string> {
    for (const chunk of chunks) {
      yield chunk + ' '
    }
  }

  async function* createFullStream(): AsyncGenerator<unknown> {
    for (const chunk of chunks) {
      yield { type: 'text-delta', textDelta: chunk + ' ' }
    }
  }

  return {
    textStream: { [Symbol.asyncIterator]: createTextStream },
    fullStream: { [Symbol.asyncIterator]: createFullStream },
    text: Promise.resolve(mockText),
    usage: Promise.resolve({ promptTokens: 100, completionTokens: 50, totalTokens: 150 }),
    finishReason: Promise.resolve('stop'),
    rawResponse: Promise.resolve({}),
    warnings: Promise.resolve([]),
    toolCalls: Promise.resolve([]),
    toolResults: Promise.resolve([]),
    steps: Promise.resolve([]),
  }
}
