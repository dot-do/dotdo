/**
 * @dotdo/ai - AI Routing Layer
 *
 * Provides a unified AI interface with:
 * - Template literal syntax for ergonomic AI calls
 * - Multi-provider routing (OpenAI, Anthropic, Google, Cloudflare)
 * - Automatic fallback and retry logic
 * - Cost optimization and load balancing
 * - Streaming support
 * - Token counting and cost tracking
 *
 * This module is the base for functions.do managed service.
 *
 * @module @dotdo/ai
 *
 * @example
 * ```typescript
 * import { ai, Router } from '@dotdo/ai'
 *
 * // Simple template literal usage
 * const summary = await ai`Summarize this text: ${text}`
 *
 * // With options
 * const code = await ai`Write a function to sort an array`.with({
 *   model: 'gpt-4',
 *   temperature: 0.7
 * })
 *
 * // Multi-provider routing
 * const router = new Router({
 *   providers: [
 *     { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
 *     { provider: 'openai', apiKey: process.env.OPENAI_API_KEY }
 *   ],
 *   fallback: ['anthropic', 'openai'],
 *   loadBalancing: 'least-loaded'
 * })
 *
 * const result = await router.execute('Generate a haiku')
 * ```
 */

/**
 * Template literal AI interface.
 * Provides ergonomic AI calls using tagged template literals.
 *
 * @example
 * ```typescript
 * const result = await ai`Summarize: ${text}`
 * const withOptions = await ai`Generate code`.with({ model: 'gpt-4' })
 * ```
 */
export * from './template'

/**
 * AIPromise for chainable AI operations.
 * Extends Promise with AI-specific methods like .with() and .$meta.
 */
export * from './promise'

/**
 * Multi-provider router with fallback, retry, and load balancing.
 * Supports OpenAI, Anthropic, Google, and Cloudflare Workers AI.
 */
// Note: ./providers just re-exports from ./router, so we skip it to avoid duplicate exports
export * from './router'

/**
 * Streaming support for real-time AI responses.
 * Provides async iterators for token-by-token output.
 */
export * from './stream'

/**
 * Usage tracking for tokens, cost, and performance.
 * Captures metrics for billing and optimization.
 */
export * from './tracking'

/**
 * Fallback handling for provider failures.
 * Implements automatic retry and provider switching.
 */
export * from './fallback'

/**
 * Token counting and cost estimation.
 * Uses tiktoken for accurate OpenAI-compatible counting.
 */
export {
  countMessageTokens,
  getModelPricing,
  preloadEncoders,
  clearEncoderCache,
  type ModelPricing,
  type Tiktoken,
} from './tokens'

/**
 * Core AI generation using Vercel AI SDK.
 * Low-level interface for direct AI calls.
 */
export * from './ai-core'

/**
 * Error classes for AI operations.
 * Provides typed errors with context for debugging.
 */
export * from './errors'

/**
 * Mock model support for testing.
 * Allows tests to run without real AI providers.
 */
export * from './mock'

/**
 * Model resolution and aliases.
 * Maps short names to full model identifiers.
 */
export * from './models'
