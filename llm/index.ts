/**
 * LLM.do - OpenAI/Anthropic-Compatible LLM Routing
 *
 * A unified LLM API that provides:
 * - OpenAI-compatible /v1/chat/completions endpoint
 * - Anthropic-compatible /v1/messages endpoint
 * - Intelligent multi-provider routing
 * - SSE streaming support
 * - Usage tracking per agent
 *
 * @example
 * ```typescript
 * import { LLM } from 'dotdo'
 *
 * // Export as Cloudflare Worker
 * export default LLM()
 *
 * // Or with custom configuration
 * export default LLM({
 *   defaultProvider: 'anthropic',
 *   customMappings: [
 *     { from: 'my-model', provider: 'openai', to: 'gpt-4o' }
 *   ]
 * })
 * ```
 *
 * @module llm
 */

// Types
export type {
  // OpenAI types
  OpenAIChatMessage,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIToolCall,
  OpenAITool,
  OpenAIFunction,
  OpenAIUsage,

  // Anthropic types
  AnthropicMessage,
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  AnthropicContentBlock,
  AnthropicStreamEvent,
  AnthropicTool,
  AnthropicUsage,

  // Provider types
  LLMProvider,
  LLMEnv,
  LLMRequestContext,
  ProviderAdapter,
  ProviderConfig,
  ModelMapping,
  ModelRoutingCriteria,
  UsageRecord,
  LLMErrorResponse,
} from './types'

// Router
export {
  ModelRouter,
  createRouter,
  defaultRouter,
  MODEL_MAPPINGS,
  MODEL_ALIASES,
  type RouterConfig,
  type RouteResult,
} from './router'

// Providers
export {
  providerRegistry,
  getProvider,
  getAllProviders,
  getAvailableProviders,
  findProviderForModel,
  OpenAIAdapter,
  AnthropicAdapter,
  WorkersAIAdapter,
  GoogleAIAdapter,
  OllamaAdapter,
  openaiAdapter,
  anthropicAdapter,
  workersAIAdapter,
  googleAdapter,
  ollamaAdapter,
} from './providers'

// Streaming utilities
export {
  createSSEResponse,
  formatOpenAISSE,
  formatAnthropicSSE,
  formatOpenAIDone,
  openAIChunksToSSE,
  anthropicEventsToSSE,
  aggregateOpenAIStream,
  aggregateAnthropicStream,
  createSSEErrorResponse,
} from './streaming'

// Routes
export { default as routes } from './routes'

// ============================================================================
// Worker Factory
// ============================================================================

import type { LLMEnv } from './types'
import type { RouterConfig } from './router'
import routes from './routes'

export interface LLMConfig extends RouterConfig {
  /** Enable request logging */
  logging?: boolean
  /** Enable usage tracking */
  trackUsage?: boolean
}

/**
 * Worker handler type for environments without Cloudflare types
 */
interface WorkerHandler {
  fetch(request: Request, env: LLMEnv, ctx?: unknown): Promise<Response>
}

/**
 * Create an LLM API worker
 *
 * @param config - Optional configuration
 * @returns Cloudflare Worker handler
 */
export function LLM(_config?: LLMConfig): WorkerHandler {
  return {
    async fetch(request: Request, env: LLMEnv, ctx?: unknown): Promise<Response> {
      // Add configuration to request context if needed
      // For now, just pass through to routes

      return routes.fetch(request, env, ctx)
    },
  }
}

// Default export
export default LLM
