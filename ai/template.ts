// AI Template literal interface

import { createAIPromise, type AIPromise, type AIMeta } from './promise'

/**
 * AI template literal function - provides ergonomic AI calls using template literals.
 *
 * @stable
 * @since 1.0.0
 *
 * @example
 * ```ts
 * const result = await ai`Summarize: ${text}`
 * const withOptions = await ai`Generate code`.with({ model: 'gpt-4', temperature: 0.7 })
 * ```
 *
 * Implementation notes:
 * - Integrates with ai-core.ts for real LLM calls via generateText()
 * - Requires ai-providers package and API key configuration (ANTHROPIC_API_KEY)
 * - Throws clear errors when dependencies or configuration are missing
 * - Tracks usage metadata (tokens, cost, duration) in .$meta property
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
        // Attempt to use real AI implementation via ai-core
        // This will throw if ai-providers is not installed
        const { generateText } = await import('./ai-core.js')

        const model = meta.model || 'sonnet' // Default to Anthropic Sonnet (fast, high quality)

        // Build options with explicit undefined for optional properties (exactOptionalPropertyTypes)
        const options: {
          model: string
          prompt: string
          temperature?: number
          maxTokens: number
        } = {
          model,
          prompt,
          maxTokens: 1000, // Reasonable default for template literal usage
        }

        // Only set temperature if it's defined
        if (meta.temperature !== undefined) {
          options.temperature = meta.temperature
        }

        const result = await generateText(options)

        // Update meta with real usage data
        meta.duration = Date.now() - startTime
        meta.tokens = {
          input: result.usage.promptTokens,
          output: result.usage.completionTokens,
        }

        return result.text
      } catch (error) {
        // Check if this is a module resolution error (ai-providers not installed)
        const isModuleError = error instanceof Error &&
          (error.message.includes('Cannot find module') ||
           error.message.includes('Cannot find package') ||
           error.message.includes('Failed to resolve'))

        if (isModuleError) {
          // TODO: ai-providers package not installed
          // Install with: npm install ai-providers
          // This package provides the LLM integration layer
          throw new Error(
            'AI providers not configured. Install ai-providers package: npm install ai-providers'
          )
        }

        if (!process.env['ANTHROPIC_API_KEY']) {
          // TODO: Configure AI provider API keys
          // Set ANTHROPIC_API_KEY environment variable for Anthropic models
          // Or configure other providers (OpenAI, etc.) as needed
          throw new Error(
            'AI provider API key not configured. Set ANTHROPIC_API_KEY environment variable.'
          )
        }

        // Re-throw real errors (auth failures, API errors, etc.)
        throw error
      }
    },
    { model: 'default' }
  )
}

/**
 * Convenience function for writing content using AI.
 *
 * Wraps the prompt with "Write: " prefix for content generation tasks.
 *
 * @param strings - Template literal strings
 * @param values - Template literal interpolated values
 * @returns An AIPromise that resolves to the generated text
 *
 * @example
 * ```typescript
 * import { write } from '@dotdo/ai'
 *
 * const blogPost = await write`a blog post about TypeScript best practices`
 * const email = await write`a professional email declining a meeting`.with({ temperature: 0.3 })
 * ```
 *
 * @stable
 * @since 1.0.0
 */
export function write(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  return ai`Write: ${strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')}`
}

/**
 * Convenience function for summarizing content using AI.
 *
 * Wraps the prompt with "Summarize: " prefix for summarization tasks.
 *
 * @param strings - Template literal strings
 * @param values - Template literal interpolated values
 * @returns An AIPromise that resolves to the summary
 *
 * @example
 * ```typescript
 * import { summarize } from '@dotdo/ai'
 *
 * const summary = await summarize`${longArticle}`
 * const briefing = await summarize`${meetingNotes} in 3 bullet points`
 * ```
 *
 * @stable
 * @since 1.0.0
 */
export function summarize(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  return ai`Summarize: ${strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')}`
}

/**
 * Convenience function for generating code using AI.
 *
 * Wraps the prompt with "Generate code: " prefix for code generation tasks.
 *
 * @param strings - Template literal strings
 * @param values - Template literal interpolated values
 * @returns An AIPromise that resolves to the generated code
 *
 * @example
 * ```typescript
 * import { code } from '@dotdo/ai'
 *
 * const sortFunc = await code`a TypeScript function to sort an array of objects by date`
 * const regex = await code`a regex to validate email addresses`
 * ```
 *
 * @stable
 * @since 1.0.0
 */
export function code(strings: TemplateStringsArray, ...values: unknown[]): AIPromise<string> {
  return ai`Generate code: ${strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')}`
}
