// AI Template literal interface

import { createAIPromise, type AIPromise, type AIMeta } from './promise'
import { generateText } from './ai-core'

/** Default model to use when none is specified */
const DEFAULT_MODEL = 'sonnet'

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
