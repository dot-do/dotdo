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
  is,
  decide,
  // Human-in-loop functions
  ask,
  approve,
  review,
  // Configuration
  configure,
  getConfig,
  setHumanTaskExecutor,
  getHumanTaskExecutor,
  // Types
  type TemplateLiteralConfig,
  type TemplateLiteralOptions,
  type WriteResult,
  type ExtractResult,
  type PipelinePromise,
  type JSONSchema,
  type HumanOptions,
  type ReviewResult,
  type HumanTaskExecutor,
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
