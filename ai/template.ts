// AI Template literal interface
// Implements the template literal AI: await ai`Summarize: ${text}`
// Uses generateText from ai-core for multi-provider LLM support

import { createAIPromise, type AIPromise, type AIMeta } from './promise'
import { generateText, streamText, type GenerateTextOptions } from './ai-core'
import { countTokens, estimateCost } from './tokens'

/**
 * AI configuration options for template literal calls
 */
export interface AIConfig {
  /** Default model to use (default: 'claude-sonnet-4') */
  defaultModel: string
  /** Default temperature (default: 0.7) */
  defaultTemperature: number
  /** Default max tokens (default: 4096) */
  defaultMaxTokens: number
  /** System prompt to prepend */
  systemPrompt?: string
}

// Global configuration
let globalConfig: AIConfig = {
  defaultModel: 'claude-sonnet-4',
  defaultTemperature: 0.7,
  defaultMaxTokens: 4096,
}

/**
 * Configure global AI settings
 *
 * @example
 * ```ts
 * configureAI({
 *   defaultModel: 'gpt-4o',
 *   defaultTemperature: 0.5,
 *   systemPrompt: 'You are a helpful assistant.',
 * })
 * ```
 */
export function configureAI(config: Partial<AIConfig>): void {
  globalConfig = { ...globalConfig, ...config }
}

/**
 * Get current AI configuration
 */
export function getAIConfig(): AIConfig {
  return { ...globalConfig }
}

/**
 * Reset AI configuration to defaults
 */
export function resetAIConfig(): void {
  globalConfig = {
    defaultModel: 'claude-sonnet-4',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
  }
}

/**
 * AI template literal function
 *
 * Use as a tagged template literal to generate AI responses:
 *
 * @example
 * ```ts
 * // Basic usage
 * const result = await ai`Summarize this text: ${longText}`
 *
 * // With options
 * const result = await ai`Write a poem about ${topic}`.with({
 *   model: 'claude-opus-4',
 *   temperature: 0.9,
 * })
 *
 * // Streaming
 * for await (const chunk of ai`Write a story`.stream()) {
 *   process.stdout.write(chunk)
 * }
 *
 * // Access metadata after resolution
 * const promise = ai`Hello`
 * await promise
 * console.log(promise.$meta.tokens) // { input: 10, output: 50 }
 * console.log(promise.$meta.cost)   // 0.00015
 * ```
 */
export function ai(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  // Build the prompt from template literal
  const prompt = strings.reduce((acc, str, i) => {
    return acc + str + (values[i] !== undefined ? String(values[i]) : '')
  }, '')

  // Completion executor - used when awaiting the promise
  const completionExecutor = async (meta: AIMeta): Promise<string> => {
    const startTime = Date.now()

    // Build options from meta and global config
    const model = meta.model || globalConfig.defaultModel
    const temperature = meta.temperature ?? globalConfig.defaultTemperature
    const maxTokens = globalConfig.defaultMaxTokens

    // Update meta with resolved model
    meta.model = model
    meta.temperature = temperature

    // Estimate input tokens before API call
    const inputTokens = countTokens(prompt, model)

    try {
      // Build options for generateText
      const generateOptions: Parameters<typeof generateText>[0] = {
        model,
        prompt,
        temperature,
        maxTokens,
      }

      // Only add system prompt if configured
      if (globalConfig.systemPrompt) {
        generateOptions.system = globalConfig.systemPrompt
      }

      // Call the actual LLM API
      const result = await generateText(generateOptions)

      // Update meta with actual usage
      meta.duration = Date.now() - startTime
      meta.tokens = {
        input: result.usage.promptTokens || inputTokens,
        output: result.usage.completionTokens || 0,
      }
      meta.cost = estimateCost(meta.tokens, model)

      return result.text
    } catch (error) {
      // Record duration even on error
      meta.duration = Date.now() - startTime
      meta.tokens = { input: inputTokens, output: 0 }

      // Re-throw with context
      if (error instanceof Error) {
        const aiError = new AIError(
          `AI generation failed: ${error.message}`,
          model,
          error
        )
        throw aiError
      }
      throw error
    }
  }

  // Stream executor - used when calling .stream()
  const streamExecutor = async function* (meta: AIMeta): AsyncIterable<string> {
    const startTime = Date.now()

    // Build options from meta and global config
    const model = meta.model || globalConfig.defaultModel
    const temperature = meta.temperature ?? globalConfig.defaultTemperature
    const maxTokens = globalConfig.defaultMaxTokens

    // Update meta with resolved model
    meta.model = model
    meta.temperature = temperature

    // Estimate input tokens before API call
    const inputTokens = countTokens(prompt, model)

    try {
      // Build options for streamText
      const streamOptions: Parameters<typeof streamText>[0] = {
        model,
        prompt,
        temperature,
        maxTokens,
      }

      // Only add system prompt if configured
      if (globalConfig.systemPrompt) {
        streamOptions.system = globalConfig.systemPrompt
      }

      // Call the streaming LLM API
      const stream = await streamText(streamOptions)

      let outputTokens = 0

      // Yield each chunk from the stream
      for await (const chunk of stream.textStream) {
        yield chunk
        // Rough token estimation per chunk (will be corrected at end)
        outputTokens += Math.ceil(chunk.length / 4)
      }

      // Get final usage from stream
      const usage = await stream.usage

      // Update meta with actual usage
      meta.duration = Date.now() - startTime
      meta.tokens = {
        input: usage.promptTokens || inputTokens,
        output: usage.completionTokens || outputTokens,
      }
      meta.cost = estimateCost(meta.tokens, model)
    } catch (error) {
      // Record duration even on error
      meta.duration = Date.now() - startTime
      meta.tokens = { input: inputTokens, output: 0 }

      // Re-throw with context
      if (error instanceof Error) {
        const aiError = new AIError(
          `AI streaming failed: ${error.message}`,
          model,
          error
        )
        throw aiError
      }
      throw error
    }
  }

  return createAIPromise<string>(completionExecutor, {
    initialMeta: { model: globalConfig.defaultModel, temperature: globalConfig.defaultTemperature },
    streamExecutor,
  })
}

/**
 * Custom error class for AI-related errors
 */
export class AIError extends Error {
  constructor(
    message: string,
    public model: string,
    public cause?: Error,
  ) {
    super(message)
    this.name = 'AIError'
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends AIError {
  constructor(
    message: string,
    model: string,
    public retryAfter?: number,
    cause?: Error,
  ) {
    super(message, model, cause)
    this.name = 'RateLimitError'
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends AIError {
  constructor(message: string, model: string, cause?: Error) {
    super(message, model, cause)
    this.name = 'AuthenticationError'
  }
}

/**
 * Model not found error
 */
export class ModelNotFoundError extends AIError {
  constructor(model: string, cause?: Error) {
    super(`Model not found: ${model}`, model, cause)
    this.name = 'ModelNotFoundError'
  }
}

// Convenience functions
export function write(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  return ai`Write: ${strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')}`
}

export function summarize(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  return ai`Summarize: ${strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')}`
}

export function code(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  return ai`Generate code: ${strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')}`
}
