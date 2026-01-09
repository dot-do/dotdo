/**
 * Template Literal API for AI Functions
 *
 * Provides tagged template literal functions for convenient AI operations:
 * - ai`prompt` - general AI completion
 * - write`text` - text generation with structured output
 * - summarize`text` - summarization
 * - list`items` - list generation
 * - extract`data` - data extraction
 *
 * All functions integrate with the AI Gateway and return typed PipelinePromises.
 */

import { AIGatewayClient, AIGatewayEnv, ChatMessage } from '../lib/ai/gateway'
import { AIConfig, AIProvider } from '../types/AI'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for template literal AI functions
 */
export interface TemplateLiteralConfig {
  /** AI provider configuration */
  provider?: AIProvider
  /** Model to use */
  model?: string
  /** AI Gateway ID */
  gateway?: string
  /** Temperature (0-2) */
  temperature?: number
  /** Max tokens */
  maxTokens?: number
  /** Environment bindings */
  env?: AIGatewayEnv
}

/**
 * Options that can be passed to template literal functions
 */
export interface TemplateLiteralOptions extends TemplateLiteralConfig {
  /** System prompt */
  systemPrompt?: string
  /** Schema for structured output */
  schema?: JSONSchema
}

/**
 * JSON Schema definition
 */
export interface JSONSchema {
  type: string
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  enum?: unknown[]
  description?: string
}

/**
 * Write result with destructurable properties
 */
export interface WriteResult {
  title?: string
  body?: string
  summary?: string
  content?: string
  [key: string]: string | undefined
}

/**
 * Extract result with typed entities
 */
export interface ExtractResult<T = Record<string, unknown>> {
  entities: T[]
  raw: string
}

/**
 * PipelinePromise - Promise with chainable methods for no-await operations
 */
export interface PipelinePromise<T> extends Promise<T> {
  /** Access a property on the resolved value */
  get<K extends keyof T>(key: K): PipelinePromise<T[K]>
  /** Transform the result */
  map<R>(fn: (value: T) => R | Promise<R>): PipelinePromise<R>
  /** Handle errors */
  catch<R = T>(fn: (error: Error) => R | Promise<R>): PipelinePromise<R>
}

// ============================================================================
// PipelinePromise Implementation
// ============================================================================

/**
 * Creates a PipelinePromise from a regular Promise
 */
function createPipelinePromise<T>(promise: Promise<T>): PipelinePromise<T> {
  const pipelinePromise = promise as PipelinePromise<T>

  // Add get method for property access
  pipelinePromise.get = <K extends keyof T>(key: K): PipelinePromise<T[K]> => {
    return createPipelinePromise(promise.then((value) => value[key]))
  }

  // Add map method for transformation
  pipelinePromise.map = <R>(fn: (value: T) => R | Promise<R>): PipelinePromise<R> => {
    return createPipelinePromise(promise.then(fn))
  }

  // Override catch to return PipelinePromise
  const originalCatch = pipelinePromise.catch.bind(pipelinePromise)
  pipelinePromise.catch = <R = T>(fn: (error: Error) => R | Promise<R>): PipelinePromise<R> => {
    return createPipelinePromise(originalCatch(fn) as Promise<R>)
  }

  return pipelinePromise
}

// ============================================================================
// Global Configuration
// ============================================================================

let globalConfig: TemplateLiteralConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.7,
}

/**
 * Configure default settings for template literal functions
 */
export function configure(config: Partial<TemplateLiteralConfig>): void {
  globalConfig = { ...globalConfig, ...config }
}

/**
 * Get current configuration
 */
export function getConfig(): TemplateLiteralConfig {
  return { ...globalConfig }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Interpolate template literal strings and values
 */
function interpolate(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce((result, str, i) => {
    const value = i < values.length ? String(values[i] ?? '') : ''
    return result + str + value
  }, '')
}

/**
 * Create AI client from configuration
 */
function createClient(config: TemplateLiteralConfig): AIGatewayClient {
  const aiConfig: AIConfig = {
    provider: config.provider ?? globalConfig.provider ?? 'anthropic',
    model: config.model ?? globalConfig.model ?? 'claude-sonnet-4-20250514',
    gateway: config.gateway ?? globalConfig.gateway,
    temperature: config.temperature ?? globalConfig.temperature,
    maxTokens: config.maxTokens ?? globalConfig.maxTokens,
  }

  const env = config.env ?? globalConfig.env ?? {}

  return new AIGatewayClient(aiConfig, env)
}

/**
 * Execute AI chat and return response
 */
async function executeChat(
  prompt: string,
  options: TemplateLiteralOptions = {}
): Promise<string> {
  const client = createClient(options)

  const messages: ChatMessage[] = []

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }

  messages.push({ role: 'user', content: prompt })

  const response = await client.chat(messages)
  return response.content
}

/**
 * Parse JSON from AI response, handling code blocks
 */
function parseJSON<T>(text: string): T {
  // Try direct parse
  try {
    return JSON.parse(text)
  } catch {
    // Continue
  }

  // Try extracting from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // Continue
    }
  }

  // Try extracting JSON object/array from text
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1])
    } catch {
      // Continue
    }
  }

  throw new Error('Failed to parse JSON from AI response')
}

// ============================================================================
// Template Literal Functions
// ============================================================================

/**
 * ai`prompt` - General AI completion
 *
 * @example
 * const response = await ai`What is the capital of France?`
 * // => "The capital of France is Paris."
 *
 * @example
 * const response = await ai`Explain ${topic} in simple terms`
 * // => "..." (explanation of the topic)
 */
export function ai(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<string> {
  const prompt = interpolate(strings, values)
  return createPipelinePromise(executeChat(prompt))
}

/**
 * Create a configured ai function with custom options
 */
ai.configure = (options: TemplateLiteralOptions) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<string> => {
    const prompt = interpolate(strings, values)
    return createPipelinePromise(executeChat(prompt, options))
  }
}

/**
 * write`prompt` - Text generation with structured output
 *
 * Returns an object with destructurable properties like title, body, summary.
 *
 * @example
 * const { title, body } = await write`Write a blog post about ${topic}`
 *
 * @example
 * const result = await write`Create an email about ${subject}`
 * console.log(result.title) // Email subject
 * console.log(result.body) // Email body
 */
export function write(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<WriteResult> {
  const prompt = interpolate(strings, values)

  const systemPrompt = `You are a writing assistant. Generate structured content with clear sections.
Always respond with a JSON object containing relevant fields like:
- title: A concise title or headline
- body: The main content
- summary: A brief summary (if applicable)
- content: Alternative field for the main content

Respond ONLY with valid JSON, no additional text.`

  const executePromise = async (): Promise<WriteResult> => {
    const response = await executeChat(prompt, { systemPrompt })
    return parseJSON<WriteResult>(response)
  }

  return createPipelinePromise(executePromise())
}

/**
 * Create a configured write function with custom options
 */
write.configure = (options: TemplateLiteralOptions) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<WriteResult> => {
    const prompt = interpolate(strings, values)

    const systemPrompt = options.systemPrompt ?? `You are a writing assistant. Generate structured content with clear sections.
Always respond with a JSON object containing relevant fields like:
- title: A concise title or headline
- body: The main content
- summary: A brief summary (if applicable)
- content: Alternative field for the main content

Respond ONLY with valid JSON, no additional text.`

    const executePromise = async (): Promise<WriteResult> => {
      const response = await executeChat(prompt, { ...options, systemPrompt })
      return parseJSON<WriteResult>(response)
    }

    return createPipelinePromise(executePromise())
  }
}

/**
 * summarize`text` - Summarization
 *
 * @example
 * const summary = await summarize`${longArticle}`
 * // => "This article discusses..."
 *
 * @example
 * const summary = await summarize`Summarize the key points: ${document}`
 */
export function summarize(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<string> {
  const text = interpolate(strings, values)

  const systemPrompt = `You are a summarization assistant. Provide concise, accurate summaries.
Focus on the key points and main ideas. Keep summaries clear and informative.
Respond with only the summary text, no additional formatting or preamble.`

  const prompt = `Summarize the following:\n\n${text}`

  return createPipelinePromise(executeChat(prompt, { systemPrompt }))
}

/**
 * Create a configured summarize function with custom options
 */
summarize.configure = (options: TemplateLiteralOptions & { length?: 'short' | 'medium' | 'long' }) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<string> => {
    const text = interpolate(strings, values)

    const lengthInstruction = options.length === 'short'
      ? 'Keep the summary to 1-2 sentences.'
      : options.length === 'long'
        ? 'Provide a detailed summary covering all key points.'
        : 'Provide a moderate-length summary.'

    const systemPrompt = options.systemPrompt ?? `You are a summarization assistant. Provide concise, accurate summaries.
Focus on the key points and main ideas. ${lengthInstruction}
Respond with only the summary text, no additional formatting or preamble.`

    const prompt = `Summarize the following:\n\n${text}`

    return createPipelinePromise(executeChat(prompt, { ...options, systemPrompt }))
  }
}

/**
 * list`prompt` - List generation
 *
 * Returns an array of strings extracted from the AI response.
 *
 * @example
 * const items = await list`List 5 programming languages for web development`
 * // => ["JavaScript", "TypeScript", "Python", "Ruby", "Go"]
 *
 * @example
 * const steps = await list`Steps to ${task}`
 */
export function list(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<string[]> {
  const prompt = interpolate(strings, values)

  const systemPrompt = `You are a list generation assistant. Generate lists as JSON arrays.
Always respond with a JSON array of strings, no additional text.
Example: ["item 1", "item 2", "item 3"]`

  const executePromise = async (): Promise<string[]> => {
    const response = await executeChat(prompt, { systemPrompt })
    return parseJSON<string[]>(response)
  }

  return createPipelinePromise(executePromise())
}

/**
 * Create a configured list function with custom options
 */
list.configure = (options: TemplateLiteralOptions & { count?: number }) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<string[]> => {
    const prompt = interpolate(strings, values)

    const countInstruction = options.count
      ? `Generate exactly ${options.count} items.`
      : ''

    const systemPrompt = options.systemPrompt ?? `You are a list generation assistant. Generate lists as JSON arrays.
${countInstruction}
Always respond with a JSON array of strings, no additional text.
Example: ["item 1", "item 2", "item 3"]`

    const executePromise = async (): Promise<string[]> => {
      const response = await executeChat(prompt, { ...options, systemPrompt })
      return parseJSON<string[]>(response)
    }

    return createPipelinePromise(executePromise())
  }
}

/**
 * extract`data` - Data extraction
 *
 * Extracts structured entities from text.
 *
 * @example
 * const { entities } = await extract`Extract all company names from: ${article}`
 * // => { entities: ["Apple", "Google", "Microsoft"], raw: "..." }
 *
 * @example
 * const data = await extract`Extract dates and locations from: ${text}`
 */
export function extract<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<ExtractResult<T>> {
  const prompt = interpolate(strings, values)

  const systemPrompt = `You are a data extraction assistant. Extract structured data from text.
Respond with a JSON object containing:
- entities: An array of extracted items (each can be an object with relevant properties)
- raw: The original text that was analyzed

Example response:
{
  "entities": [{"name": "John", "type": "person"}, {"name": "Acme Corp", "type": "company"}],
  "raw": "original text here"
}`

  const executePromise = async (): Promise<ExtractResult<T>> => {
    const response = await executeChat(prompt, { systemPrompt })
    return parseJSON<ExtractResult<T>>(response)
  }

  return createPipelinePromise(executePromise())
}

/**
 * Create a configured extract function with custom options and schema
 */
extract.configure = <T = Record<string, unknown>>(
  options: TemplateLiteralOptions & { entityType?: string }
) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<ExtractResult<T>> => {
    const prompt = interpolate(strings, values)

    const entityInstruction = options.entityType
      ? `Focus on extracting ${options.entityType} entities.`
      : ''

    const schemaInstruction = options.schema
      ? `Each entity should match this structure: ${JSON.stringify(options.schema)}`
      : ''

    const systemPrompt = options.systemPrompt ?? `You are a data extraction assistant. Extract structured data from text.
${entityInstruction}
${schemaInstruction}
Respond with a JSON object containing:
- entities: An array of extracted items
- raw: The original text that was analyzed`

    const executePromise = async (): Promise<ExtractResult<T>> => {
      const response = await executeChat(prompt, { ...options, systemPrompt })
      return parseJSON<ExtractResult<T>>(response)
    }

    return createPipelinePromise(executePromise())
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  ai,
  write,
  summarize,
  list,
  extract,
  configure,
  getConfig,
}
