// Accurate token counting using tiktoken for @dotdo/ai
// Uses js-tiktoken for browser/worker compatibility

import { getEncoding, type Tiktoken } from 'js-tiktoken'

// Model to encoding mapping
// See: https://github.com/openai/tiktoken/blob/main/tiktoken/model.py
type EncodingName = 'cl100k_base' | 'o200k_base' | 'p50k_base' | 'r50k_base'

const MODEL_ENCODINGS: Record<string, EncodingName> = {
  // OpenAI GPT-4o and o1 models use o200k_base
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  'o1': 'o200k_base',
  'o1-mini': 'o200k_base',
  'o1-preview': 'o200k_base',
  'o3-mini': 'o200k_base',

  // GPT-4 and GPT-3.5 models use cl100k_base
  'gpt-4': 'cl100k_base',
  'gpt-4-turbo': 'cl100k_base',
  'gpt-4-turbo-preview': 'cl100k_base',
  'gpt-3.5-turbo': 'cl100k_base',
  'gpt-3.5-turbo-16k': 'cl100k_base',

  // Anthropic Claude models - use cl100k_base as approximation
  // Claude uses a different tokenizer but cl100k_base is a reasonable estimate
  'claude-opus-4': 'cl100k_base',
  'claude-sonnet-4': 'cl100k_base',
  'claude-haiku-4': 'cl100k_base',
  'claude-opus-4-20250514': 'cl100k_base',
  'claude-sonnet-4-20250514': 'cl100k_base',
  'claude-3-opus-20240229': 'cl100k_base',
  'claude-3-sonnet-20240229': 'cl100k_base',
  'claude-3-haiku-20240307': 'cl100k_base',
  'claude-3-5-sonnet-latest': 'cl100k_base',
  'claude-3-5-haiku-latest': 'cl100k_base',

  // Google Gemini models - use cl100k_base as approximation
  'gemini-2.0-flash': 'cl100k_base',
  'gemini-1.5-pro': 'cl100k_base',
  'gemini-1.5-flash': 'cl100k_base',

  // Cloudflare Workers AI models
  '@cf/meta/llama-3.1-8b-instruct': 'cl100k_base',
  '@cf/meta/llama-2-7b-chat-int8': 'cl100k_base',
}

// Cached encoder instances
const encoderCache = new Map<EncodingName, Tiktoken>()

/**
 * Get the encoding name for a model
 */
function getEncodingForModel(model?: string): EncodingName {
  if (!model) return 'cl100k_base'

  // Check exact match first
  if (MODEL_ENCODINGS[model]) {
    return MODEL_ENCODINGS[model]
  }

  // Check for partial matches (e.g., "gpt-4o-2024-05-13" matches "gpt-4o")
  for (const [prefix, encoding] of Object.entries(MODEL_ENCODINGS)) {
    if (model.startsWith(prefix)) {
      return encoding
    }
  }

  // Default to cl100k_base (most common)
  return 'cl100k_base'
}

/**
 * Get or create a cached encoder instance
 */
function getEncoder(encodingName: EncodingName): Tiktoken {
  let encoder = encoderCache.get(encodingName)
  if (!encoder) {
    encoder = getEncoding(encodingName)
    encoderCache.set(encodingName, encoder)
  }
  return encoder
}

/**
 * Count the number of tokens in a text string using tiktoken.
 *
 * Uses accurate BPE tokenization matching OpenAI's tokenizer.
 * For Claude and other models, uses cl100k_base as an approximation.
 *
 * @param text - The text to count tokens for
 * @param model - Optional model name to use the appropriate encoding
 * @returns The number of tokens
 *
 * @example
 * ```ts
 * const tokens = countTokens('Hello, world!')
 * console.log(tokens) // 4
 *
 * const tokens2 = countTokens('Hello, world!', 'gpt-4o')
 * console.log(tokens2) // Uses o200k_base encoding
 * ```
 */
export function countTokens(text: string, model?: string): number {
  if (!text) return 0

  const encodingName = getEncodingForModel(model)
  const encoder = getEncoder(encodingName)

  return encoder.encode(text).length
}

/**
 * Count tokens for a message array including formatting overhead.
 * Accounts for special tokens and message formatting.
 *
 * @param messages - Array of messages with role and content
 * @param model - Optional model name
 * @returns Total token count including formatting overhead
 */
export function countMessageTokens(
  messages: Array<{ role: string; content: string }>,
  model?: string,
): number {
  if (!messages || messages.length === 0) return 0

  const encodingName = getEncodingForModel(model)
  const encoder = getEncoder(encodingName)

  let totalTokens = 0

  // Different models have different formatting overhead
  // See: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
  let tokensPerMessage = 3 // <|im_start|>{role}\n{content}<|im_end|>\n
  let tokensPerName = 1

  // GPT-4o uses slightly different formatting
  if (model?.startsWith('gpt-4o') || model?.startsWith('o1') || model?.startsWith('o3')) {
    tokensPerMessage = 3
    tokensPerName = 1
  }

  for (const message of messages) {
    totalTokens += tokensPerMessage
    totalTokens += encoder.encode(message.role).length
    totalTokens += encoder.encode(message.content).length
  }

  // Every reply is primed with <|im_start|>assistant<|im_sep|>
  totalTokens += 3

  return totalTokens
}

// Model pricing per 1 million tokens (USD)
export interface ModelPricing {
  inputCostPer1M: number
  outputCostPer1M: number
}

// Pricing tables (as of January 2025)
const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI models
  'gpt-4o': { inputCostPer1M: 2.50, outputCostPer1M: 10.00 },
  'gpt-4o-mini': { inputCostPer1M: 0.15, outputCostPer1M: 0.60 },
  'gpt-4-turbo': { inputCostPer1M: 10.00, outputCostPer1M: 30.00 },
  'gpt-4': { inputCostPer1M: 30.00, outputCostPer1M: 60.00 },
  'gpt-3.5-turbo': { inputCostPer1M: 0.50, outputCostPer1M: 1.50 },
  'o1': { inputCostPer1M: 15.00, outputCostPer1M: 60.00 },
  'o1-mini': { inputCostPer1M: 3.00, outputCostPer1M: 12.00 },
  'o1-preview': { inputCostPer1M: 15.00, outputCostPer1M: 60.00 },
  'o3-mini': { inputCostPer1M: 1.10, outputCostPer1M: 4.40 },

  // Anthropic models
  'claude-opus-4': { inputCostPer1M: 15.00, outputCostPer1M: 75.00 },
  'claude-sonnet-4': { inputCostPer1M: 3.00, outputCostPer1M: 15.00 },
  'claude-haiku-4': { inputCostPer1M: 0.80, outputCostPer1M: 4.00 },
  'claude-opus-4-20250514': { inputCostPer1M: 15.00, outputCostPer1M: 75.00 },
  'claude-sonnet-4-20250514': { inputCostPer1M: 3.00, outputCostPer1M: 15.00 },
  'claude-3-opus-20240229': { inputCostPer1M: 15.00, outputCostPer1M: 75.00 },
  'claude-3-sonnet-20240229': { inputCostPer1M: 3.00, outputCostPer1M: 15.00 },
  'claude-3-haiku-20240307': { inputCostPer1M: 0.25, outputCostPer1M: 1.25 },
  'claude-3-5-sonnet-latest': { inputCostPer1M: 3.00, outputCostPer1M: 15.00 },
  'claude-3-5-haiku-latest': { inputCostPer1M: 0.25, outputCostPer1M: 1.25 },

  // Google models
  'gemini-2.0-flash': { inputCostPer1M: 0.10, outputCostPer1M: 0.40 },
  'gemini-1.5-pro': { inputCostPer1M: 1.25, outputCostPer1M: 5.00 },
  'gemini-1.5-flash': { inputCostPer1M: 0.075, outputCostPer1M: 0.30 },

  // Cloudflare Workers AI (estimated based on neuron pricing)
  '@cf/meta/llama-3.1-8b-instruct': { inputCostPer1M: 0.01, outputCostPer1M: 0.01 },
  '@cf/meta/llama-2-7b-chat-int8': { inputCostPer1M: 0.01, outputCostPer1M: 0.01 },

  // Default fallback
  'default': { inputCostPer1M: 1.00, outputCostPer1M: 3.00 },
}

/**
 * Get pricing for a model
 */
function getPricing(model: string): ModelPricing {
  // Check exact match first
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model]
  }

  // Check for partial matches
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(prefix)) {
      return pricing
    }
  }

  // Return default pricing
  return MODEL_PRICING['default']!
}

/**
 * Estimate the cost of token usage for a given model.
 *
 * @param tokens - Number of tokens (or object with input/output breakdown)
 * @param model - The model name
 * @returns Estimated cost in USD
 *
 * @example
 * ```ts
 * // Simple token count (assumes input)
 * const cost = estimateCost(1000, 'gpt-4o')
 *
 * // Detailed input/output breakdown
 * const cost2 = estimateCost({ input: 1000, output: 500 }, 'gpt-4o')
 * ```
 */
export function estimateCost(
  tokens: number | { input: number; output: number },
  model: string,
): number {
  const pricing = getPricing(model)

  if (typeof tokens === 'number') {
    // Assume all tokens are input tokens
    return (tokens * pricing.inputCostPer1M) / 1_000_000
  }

  const inputCost = (tokens.input * pricing.inputCostPer1M) / 1_000_000
  const outputCost = (tokens.output * pricing.outputCostPer1M) / 1_000_000

  return inputCost + outputCost
}

/**
 * Get the pricing information for a model
 */
export function getModelPricing(model: string): ModelPricing {
  return getPricing(model)
}

/**
 * Pre-warm the encoder cache for commonly used models.
 * Call this during application startup for faster first-use performance.
 */
export function preloadEncoders(): void {
  // Pre-load the two most common encodings
  getEncoder('cl100k_base')
  getEncoder('o200k_base')
}

/**
 * Clear all cached encoder instances.
 * Useful for memory management in long-running processes.
 * Note: js-tiktoken doesn't require explicit cleanup like native tiktoken.
 */
export function clearEncoderCache(): void {
  encoderCache.clear()
}

// Re-export types
export type { Tiktoken }
