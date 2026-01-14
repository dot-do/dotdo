/**
 * LLM.do - OpenAI/Anthropic-Compatible LLM Routing Types
 *
 * Type definitions for the unified LLM API that provides OpenAI and Anthropic
 * compatible endpoints with intelligent multi-provider routing.
 *
 * @module llm/types
 */

// ============================================================================
// OpenAI-Compatible Types
// ============================================================================

/**
 * OpenAI chat message format
 */
export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function'
  content: string | null
  name?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
  function_call?: {
    name: string
    arguments: string
  }
}

/**
 * OpenAI tool call
 */
export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * OpenAI function definition
 */
export interface OpenAIFunction {
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

/**
 * OpenAI tool definition
 */
export interface OpenAITool {
  type: 'function'
  function: OpenAIFunction
}

/**
 * OpenAI chat completion request
 */
export interface OpenAIChatCompletionRequest {
  model: string
  messages: OpenAIChatMessage[]
  temperature?: number
  top_p?: number
  n?: number
  stream?: boolean
  stop?: string | string[]
  max_tokens?: number
  max_completion_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
  logit_bias?: Record<string, number>
  user?: string
  tools?: OpenAITool[]
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } }
  response_format?: { type: 'text' | 'json_object' }
  seed?: number
}

/**
 * OpenAI chat completion choice
 */
export interface OpenAIChatCompletionChoice {
  index: number
  message: OpenAIChatMessage
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
  logprobs?: unknown
}

/**
 * OpenAI usage statistics
 */
export interface OpenAIUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/**
 * OpenAI chat completion response
 */
export interface OpenAIChatCompletionResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: OpenAIChatCompletionChoice[]
  usage?: OpenAIUsage
  system_fingerprint?: string
}

/**
 * OpenAI streaming chat completion chunk
 */
export interface OpenAIChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: Partial<OpenAIChatMessage>
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
    logprobs?: unknown
  }>
  system_fingerprint?: string
  usage?: OpenAIUsage
}

// ============================================================================
// Anthropic-Compatible Types
// ============================================================================

/**
 * Anthropic content block
 */
export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] }

/**
 * Anthropic message
 */
export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

/**
 * Anthropic tool definition
 */
export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

/**
 * Anthropic message request
 */
export interface AnthropicMessageRequest {
  model: string
  messages: AnthropicMessage[]
  max_tokens: number
  system?: string | Array<{ type: 'text'; text: string }>
  temperature?: number
  top_p?: number
  top_k?: number
  stop_sequences?: string[]
  stream?: boolean
  tools?: AnthropicTool[]
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string }
  metadata?: {
    user_id?: string
  }
}

/**
 * Anthropic usage statistics
 */
export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

/**
 * Anthropic message response
 */
export interface AnthropicMessageResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: AnthropicContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null
  stop_sequence?: string
  usage: AnthropicUsage
}

/**
 * Anthropic streaming event types
 */
export type AnthropicStreamEvent =
  | { type: 'message_start'; message: Omit<AnthropicMessageResponse, 'content'> & { content: [] } }
  | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string; stop_sequence?: string }; usage: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: 'ping' }
  | { type: 'error'; error: { type: string; message: string } }

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * LLM provider identifier
 */
export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'workers-ai' | 'ollama'

/**
 * Model routing criteria
 */
export interface ModelRoutingCriteria {
  /** Route based on cost optimization */
  costOptimized?: boolean
  /** Route based on latency requirements */
  lowLatency?: boolean
  /** Required capabilities */
  capabilities?: Array<'vision' | 'function_calling' | 'streaming' | 'json_mode'>
  /** Preferred provider */
  preferredProvider?: LLMProvider
  /** Fallback providers */
  fallbackProviders?: LLMProvider[]
}

/**
 * Model mapping configuration
 */
export interface ModelMapping {
  /** Original model name */
  from: string
  /** Target provider */
  provider: LLMProvider
  /** Target model name */
  to: string
  /** Model capabilities */
  capabilities?: Array<'vision' | 'function_calling' | 'streaming' | 'json_mode'>
  /** Cost tier (1 = cheapest, 5 = most expensive) */
  costTier?: number
  /** Average latency in ms */
  avgLatencyMs?: number
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** Provider name */
  name: LLMProvider
  /** API key environment variable name */
  apiKeyEnvVar: string
  /** Base URL for the API */
  baseUrl: string
  /** Custom headers */
  headers?: Record<string, string>
  /** Available models */
  models: string[]
  /** Whether provider supports streaming */
  supportsStreaming: boolean
  /** Whether provider supports vision */
  supportsVision: boolean
  /** Whether provider supports function calling */
  supportsFunctionCalling: boolean
}

// ============================================================================
// LLM Service Types
// ============================================================================

/**
 * Environment bindings for LLM service
 */
export interface LLMEnv {
  /** OpenAI API key */
  OPENAI_API_KEY?: string
  /** Anthropic API key */
  ANTHROPIC_API_KEY?: string
  /** Google API key */
  GOOGLE_API_KEY?: string
  /** Ollama base URL */
  OLLAMA_BASE_URL?: string
  /** Workers AI binding */
  AI?: { run: (model: string, params: unknown) => Promise<unknown> }
  /** Cloudflare AI Gateway ID */
  AI_GATEWAY_ID?: string
  /** R2 bucket for prompt caching */
  PROMPT_CACHE?: unknown // R2Bucket when running in Workers
  /** KV namespace for usage tracking */
  USAGE_KV?: unknown // KVNamespace when running in Workers
  /** Durable Object namespace for threads */
  THREADS?: unknown // DurableObjectNamespace when running in Workers
}

/**
 * Request context for LLM operations
 */
export interface LLMRequestContext {
  /** Request ID for tracing */
  requestId: string
  /** Agent ID (if applicable) */
  agentId?: string
  /** User ID for usage tracking */
  userId?: string
  /** Tenant/organization ID */
  tenantId?: string
  /** Request start time */
  startTime: number
}

/**
 * Usage tracking record
 */
export interface UsageRecord {
  requestId: string
  agentId?: string
  userId?: string
  tenantId?: string
  provider: LLMProvider
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  latencyMs: number
  cached: boolean
  timestamp: number
}

/**
 * Error response format
 */
export interface LLMErrorResponse {
  error: {
    message: string
    type: string
    code?: string
    param?: string
  }
}

// ============================================================================
// Provider Adapter Interface
// ============================================================================

/**
 * Unified provider adapter interface
 */
export interface ProviderAdapter {
  /** Provider name */
  readonly name: LLMProvider

  /**
   * Execute a chat completion request
   */
  chatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    ctx: LLMRequestContext
  ): Promise<OpenAIChatCompletionResponse>

  /**
   * Stream a chat completion request
   */
  streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    ctx: LLMRequestContext
  ): AsyncIterable<OpenAIChatCompletionChunk>

  /**
   * Convert from Anthropic format to provider format and execute
   */
  anthropicMessages?(
    request: AnthropicMessageRequest,
    env: LLMEnv,
    ctx: LLMRequestContext
  ): Promise<AnthropicMessageResponse>

  /**
   * Stream Anthropic messages
   */
  streamAnthropicMessages?(
    request: AnthropicMessageRequest,
    env: LLMEnv,
    ctx: LLMRequestContext
  ): AsyncIterable<AnthropicStreamEvent>

  /**
   * Check if the adapter can handle a specific model
   */
  canHandle(model: string): boolean

  /**
   * List available models
   */
  listModels(): string[]
}
