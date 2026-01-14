/**
 * @dotdo/cohere - Type Definitions
 *
 * Type definitions for the Cohere API compatibility layer.
 * Matches the official cohere-ai SDK interface.
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the Cohere client
 */
export interface CohereClientConfig {
  /** API token for authentication */
  token: string
  /** Base URL for API requests (default: https://api.cohere.com) */
  baseURL?: string
  /** Request timeout in milliseconds */
  timeout?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
}

// =============================================================================
// Common Types
// =============================================================================

export interface ApiMeta {
  api_version?: { version: string; is_deprecated?: boolean; is_experimental?: boolean }
  billed_units?: {
    input_tokens?: number
    output_tokens?: number
    search_units?: number
    classifications?: number
    images?: number
  }
  tokens?: {
    input_tokens?: number
    output_tokens?: number
  }
  cached_tokens?: number
  warnings?: string[]
}

// =============================================================================
// Generate API Types
// =============================================================================

export interface GenerateRequest {
  /** The prompt to generate from */
  prompt: string
  /** Model ID to use (default: command) */
  model?: string
  /** Maximum tokens to generate */
  maxTokens?: number
  /** Sampling temperature (0-5) */
  temperature?: number
  /** Number of generations to return (1-5) */
  numGenerations?: number
  /** Top-k sampling */
  k?: number
  /** Nucleus sampling probability */
  p?: number
  /** Frequency penalty (0-1) */
  frequencyPenalty?: number
  /** Presence penalty (0-1) */
  presencePenalty?: number
  /** Stop sequences */
  stopSequences?: string[]
  /** End sequences */
  endSequences?: string[]
  /** Return token likelihoods: GENERATION, ALL, or NONE */
  returnLikelihoods?: 'GENERATION' | 'ALL' | 'NONE'
  /** Truncate strategy: NONE, START, or END */
  truncate?: 'NONE' | 'START' | 'END'
  /** Random seed for deterministic output */
  seed?: number
  /** Preset ID */
  preset?: string
  /** Bypass prompt preprocessing */
  rawPrompting?: boolean
}

export interface TokenLikelihood {
  token: string
  likelihood: number
}

export interface Generation {
  id: string
  text: string
  index: number
  likelihood?: number
  token_likelihoods?: TokenLikelihood[]
}

export interface GenerateResponse {
  id: string
  prompt?: string
  generations: Generation[]
  meta?: ApiMeta
}

export interface GenerateStreamEvent {
  is_finished: boolean
  text?: string
  finish_reason?: string
  response?: GenerateResponse
}

// =============================================================================
// Chat API Types
// =============================================================================

export interface ChatMessage {
  role: 'USER' | 'CHATBOT' | 'SYSTEM'
  message: string
}

export interface ChatContentBlock {
  type: 'text'
  text: string
}

export interface ChatToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description?: string; enum?: string[] }>
      required?: string[]
    }
  }
}

export interface ChatRequest {
  /** The user message to respond to */
  message: string
  /** Model ID to use */
  model: string
  /** Conversation ID for memory */
  conversationId?: string
  /** Chat history for context */
  chatHistory?: ChatMessage[]
  /** System prompt / preamble */
  preamble?: string
  /** Temperature (0-1) */
  temperature?: number
  /** Maximum tokens to generate */
  maxTokens?: number
  /** Top-k sampling */
  k?: number
  /** Nucleus sampling probability */
  p?: number
  /** Frequency penalty */
  frequencyPenalty?: number
  /** Presence penalty */
  presencePenalty?: number
  /** Stop sequences */
  stopSequences?: string[]
  /** Tools for function calling */
  tools?: ChatTool[]
  /** Random seed */
  seed?: number
}

export interface ChatResponseMessage {
  role: 'assistant'
  content: ChatContentBlock[]
  tool_calls?: ChatToolCall[]
  tool_plan?: string
  citations?: unknown[]
}

export interface ChatResponse {
  id: string
  finish_reason: 'COMPLETE' | 'STOP_SEQUENCE' | 'MAX_TOKENS' | 'TOOL_CALL' | 'ERROR' | 'TIMEOUT'
  message: ChatResponseMessage
  usage?: {
    billed_units?: { input_tokens?: number; output_tokens?: number; search_units?: number }
    tokens?: { input_tokens?: number; output_tokens?: number }
    cached_tokens?: number
  }
  logprobs?: unknown[]
}

export interface ChatStreamEvent {
  type: 'message-start' | 'content-start' | 'content-delta' | 'content-end' | 'message-end' | 'tool-call-start' | 'tool-call-delta' | 'tool-call-end'
  id?: string
  index?: number
  delta?: {
    message?: {
      content?: { text?: string }
    }
    finish_reason?: string
  }
}

// =============================================================================
// Embed API Types
// =============================================================================

export type EmbedInputType = 'search_document' | 'search_query' | 'classification' | 'clustering' | 'image'
export type EmbeddingType = 'float' | 'int8' | 'uint8' | 'binary' | 'ubinary' | 'base64'
export type TruncateOption = 'NONE' | 'START' | 'END'

export interface EmbedRequest {
  /** Texts to embed (up to 96) */
  texts: string[]
  /** Model ID */
  model: string
  /** Input type for embedding optimization */
  inputType: EmbedInputType
  /** Embedding types to return */
  embeddingTypes?: EmbeddingType[]
  /** Truncation strategy */
  truncate?: TruncateOption
  /** Maximum tokens per input */
  maxTokens?: number
  /** Output dimension (for v4+ models) */
  outputDimension?: 256 | 512 | 1024 | 1536
}

export interface EmbedResponse {
  id: string
  response_type: 'embeddings_by_type'
  embeddings: {
    float?: number[][]
    int8?: number[][]
    uint8?: number[][]
    binary?: number[][]
    ubinary?: number[][]
    base64?: string[]
  }
  texts?: string[]
  images?: { width: number; height: number; format: string; bit_depth: number }[]
  meta?: ApiMeta
}

// =============================================================================
// Rerank API Types
// =============================================================================

export interface RerankRequest {
  /** Search query */
  query: string
  /** Documents to rank */
  documents: string[]
  /** Model ID */
  model: string
  /** Number of results to return */
  topN?: number
  /** Maximum tokens per document */
  maxTokensPerDoc?: number
}

export interface RerankResult {
  index: number
  relevance_score: number
}

export interface RerankResponse {
  id: string
  results: RerankResult[]
  meta?: ApiMeta
}

// =============================================================================
// Classify API Types
// =============================================================================

export interface ClassifyExample {
  text: string
  label: string
}

export interface ClassifyRequest {
  /** Texts to classify (up to 96) */
  inputs: string[]
  /** Training examples (not required for fine-tuned models) */
  examples?: ClassifyExample[]
  /** Fine-tuned model ID */
  model?: string
  /** Truncation strategy */
  truncate?: TruncateOption
  /** Preset ID */
  preset?: string
}

export interface ClassificationLabel {
  confidence: number
}

export interface Classification {
  id: string
  input: string
  prediction: string
  predictions: string[]
  confidence: number
  confidences: number[]
  labels: Record<string, ClassificationLabel>
  classification_type: 'single-label' | 'multi-label'
}

export interface ClassifyResponse {
  id: string
  classifications: Classification[]
  meta?: ApiMeta
}
