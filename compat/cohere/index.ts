/**
 * @dotdo/cohere - Cohere API Compatibility Layer
 *
 * Drop-in replacement for cohere-ai SDK with edge compatibility.
 * Provides Generate, Chat, Embed, Rerank, and Classify APIs.
 *
 * @example
 * ```typescript
 * import { CohereClient } from '@dotdo/cohere'
 *
 * const cohere = new CohereClient({ token: 'your-api-key' })
 *
 * // Generate
 * const response = await cohere.generate({
 *   prompt: 'Write a tagline for an ice cream shop',
 *   model: 'command',
 *   maxTokens: 50,
 *   temperature: 0.7,
 * })
 *
 * // Chat
 * const chat = await cohere.chat({
 *   message: 'What is the capital of France?',
 *   model: 'command',
 * })
 *
 * // Embed
 * const embeddings = await cohere.embed({
 *   texts: ['Hello world', 'Goodbye world'],
 *   model: 'embed-english-v3.0',
 *   inputType: 'search_document',
 * })
 *
 * // Rerank
 * const reranked = await cohere.rerank({
 *   query: 'What is the capital of France?',
 *   documents: ['Paris is the capital of France.', 'London is the capital of England.'],
 *   model: 'rerank-english-v2.0',
 * })
 *
 * // Classify
 * const classified = await cohere.classify({
 *   inputs: ['This is wonderful', 'This is terrible'],
 *   examples: [
 *     { text: 'I love this', label: 'positive' },
 *     { text: 'I hate this', label: 'negative' },
 *   ],
 * })
 * ```
 *
 * @module @dotdo/cohere
 */

// Export main client
export { CohereClient, CohereError, CohereTimeoutError } from './cohere'

// Export all types
export type {
  // Config
  CohereClientConfig,
  // Common
  ApiMeta,
  // Generate
  GenerateRequest,
  GenerateResponse,
  GenerateStreamEvent,
  Generation,
  TokenLikelihood,
  // Chat
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  ChatMessage,
  ChatContentBlock,
  ChatToolCall,
  ChatTool,
  ChatResponseMessage,
  // Embed
  EmbedRequest,
  EmbedResponse,
  EmbedInputType,
  EmbeddingType,
  TruncateOption,
  // Rerank
  RerankRequest,
  RerankResponse,
  RerankResult,
  // Classify
  ClassifyRequest,
  ClassifyResponse,
  ClassifyExample,
  Classification,
  ClassificationLabel,
} from './types'
