/**
 * AI Module
 *
 * Provides AI functionality for dotdo:
 * - Template literal API for convenient AI operations
 * - AI Gateway client for multiple providers
 * - Integration with Cloudflare Workers AI
 */

// Template literal functions
export {
  ai,
  write,
  summarize,
  list,
  extract,
  configure,
  getConfig,
  type TemplateLiteralConfig,
  type TemplateLiteralOptions,
  type WriteResult,
  type ExtractResult,
  type PipelinePromise,
  type JSONSchema,
} from './template-literals'

// Re-export default as convenience object
export { default as templateLiterals } from './template-literals'

// AI Gateway (from lib)
export {
  AIGatewayClient,
  type AIGatewayEnv,
  type ChatMessage,
  type ChatResponse,
} from '../lib/ai/gateway'
