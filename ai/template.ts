/**
 * @dotdo/ai - Template Literal Interface
 *
 * Provides a simple, ergonomic way to call AI models using JavaScript template literals.
 * The ai tagged template returns an AIPromise that can be configured with model, temperature,
 * and other options before being awaited.
 *
 * @module @dotdo/ai/template
 */

import { createAIPromise, type AIPromise, type AIMeta } from './promise'
import { generateText } from './ai-core'

/** Default model to use when none is specified */
const DEFAULT_MODEL = 'sonnet'

/**
 * AI template literal for generating text with LLMs.
 *
 * Returns an AIPromise that can be configured with model, temperature, and other options
 * before being awaited. The promise includes metadata about the request after resolution.
 *
 * @param strings - Template literal strings
 * @param values - Interpolated values
 * @returns An AIPromise that resolves to the generated text
 *
 * @example
 * ```typescript
 * import { ai } from '@dotdo/ai'
 *
 * // Simple usage
 * const response = await ai`Summarize this text: ${article}`
 *
 * // With model selection
 * const response = await ai`Write a poem about ${topic}`.model('haiku')
 *
 * // With temperature
 * const creative = await ai`Generate a story about ${subject}`
 *   .model('sonnet')
 *   .temperature(0.9)
 *
 * // Access metadata after completion
 * const promise = ai`Explain ${concept}`
 * const text = await promise
 * console.log('Tokens used:', promise.meta.tokens)
 * ```
 */
export function ai(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  // Build the prompt from template literal
  const prompt = strings.reduce((acc, str, i) => {
    return acc + str + (values[i] !== undefined ? String(values[i]) : '')
  }, '')

  return createAIPromise<string>(
    async (meta) => {
      const startTime = Date.now()

      try {
        // Use the model from meta if specified, otherwise use default
        const modelId = meta.model === 'default' ? DEFAULT_MODEL : (meta.model || DEFAULT_MODEL)

        // Call the actual AI provider via generateText
        const result = await generateText({
          model: modelId,
          prompt,
          ...(meta.temperature !== undefined && { temperature: meta.temperature }),
        })

        meta.duration = Date.now() - startTime
        meta.tokens = {
          input: result.usage.promptTokens,
          output: result.usage.completionTokens,
        }

        return result.text
      } catch (error) {
        meta.duration = Date.now() - startTime

        // Re-throw the error with additional context
        if (error instanceof Error) {
          throw new Error(`AI template literal failed: ${error.message}`, { cause: error })
        }
        throw error
      }
    },
    { model: 'default' }
  )
}

/**
 * Convenience template for writing content.
 * Prepends "Write:" to the prompt for better LLM instruction.
 *
 * @example
 * ```typescript
 * const email = await write`a professional email declining a meeting`
 * ```
 */
export function write(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  return ai`Write: ${strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')}`
}

/**
 * Convenience template for summarizing content.
 * Prepends "Summarize:" to the prompt for better LLM instruction.
 *
 * @example
 * ```typescript
 * const summary = await summarize`${longArticle}`
 * ```
 */
export function summarize(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  return ai`Summarize: ${strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')}`
}

/**
 * Convenience template for code generation.
 * Prepends "Generate code:" to the prompt for better LLM instruction.
 *
 * @example
 * ```typescript
 * const fn = await code`a TypeScript function that calculates fibonacci numbers`
 * ```
 */
export function code(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  return ai`Generate code: ${strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')}`
}
