/**
 * AgentRuntime Types
 *
 * Core type definitions for the AgentRuntime primitive.
 * Provides multi-provider LLM support, tool calling, memory, and streaming.
 *
 * @module db/primitives/agent-runtime
 */

import type { z } from 'zod'

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface BaseMessage {
  id?: string
  role: MessageRole
  createdAt?: Date
  metadata?: Record<string, unknown>
}

export interface UserMessage extends BaseMessage {
  role: 'user'
  content: string | ContentPart[]
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant'
  content?: string
  toolCalls?: ToolCall[]
}

export interface SystemMessage extends BaseMessage {
  role: 'system'
  content: string
}

export interface ToolMessage extends BaseMessage {
  role: 'tool'
  toolCallId: string
  toolName: string
  content: unknown
}

export type Message = UserMessage | AssistantMessage | SystemMessage | ToolMessage

export interface ContentPart {
  type: 'text' | 'image' | 'audio' | 'file'
  text?: string
  data?: string | Uint8Array
  mimeType?: string
  url?: string
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  result: unknown
  error?: string
  /** Execution time in milliseconds */
  durationMs?: number
  /** Whether result was served from cache */
  cached?: boolean
}

export interface ToolSchema {
  type: 'object'
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  description?: string
  additionalProperties?: boolean
}

export interface JsonSchemaProperty {
  type: string
  description?: string
  enum?: string[]
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: ToolSchema | z.ZodType<TInput>
  outputSchema?: ToolSchema | z.ZodType<TOutput>
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>
  /** Can results be cached? */
  cacheable?: boolean
  /** Cache TTL in milliseconds */
  cacheTtl?: number
  /** Maximum execution time in milliseconds */
  timeout?: number
  /** Retry configuration */
  retry?: RetryConfig
}

export interface ToolContext {
  agentId: string
  sessionId?: string
  userId?: string
  abortSignal?: AbortSignal
  metadata?: Record<string, unknown>
}

// ============================================================================
// Provider Types
// ============================================================================

export type ProviderName = 'openai' | 'anthropic' | 'google' | 'cohere' | 'custom'

export interface ProviderConfig {
  name: ProviderName
  apiKey?: string
  baseUrl?: string
  organization?: string
  defaultModel?: string
  /** Request timeout in milliseconds */
  timeout?: number
  /** Custom headers */
  headers?: Record<string, string>
  /** Provider-specific options */
  options?: Record<string, unknown>
}

export interface ModelConfig {
  /** Model identifier (e.g., 'gpt-4o', 'claude-sonnet-4-20250514') */
  model: string
  /** Provider to use for this model */
  provider: ProviderName
  /** Maximum context window size in tokens */
  maxContextTokens?: number
  /** Maximum output tokens */
  maxOutputTokens?: number
  /** Cost per 1K input tokens in USD */
  inputCostPer1k?: number
  /** Cost per 1K output tokens in USD */
  outputCostPer1k?: number
  /** Supports tool/function calling */
  supportsTools?: boolean
  /** Supports vision/image input */
  supportsVision?: boolean
  /** Supports streaming */
  supportsStreaming?: boolean
}

export interface CompletionRequest {
  model: string
  messages: Message[]
  tools?: ToolDefinition[]
  temperature?: number
  maxTokens?: number
  topP?: number
  stop?: string[]
  /** Response format (text or json) */
  responseFormat?: 'text' | 'json_object' | 'json_schema'
  /** JSON schema for structured output */
  jsonSchema?: ToolSchema
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>
}

export interface CompletionResponse {
  id: string
  model: string
  content?: string
  toolCalls?: ToolCall[]
  finishReason: FinishReason
  usage: TokenUsage
  /** Response latency in milliseconds */
  latencyMs?: number
  /** Provider that served the request */
  provider: ProviderName
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// ============================================================================
// Router Types
// ============================================================================

export type RoutingStrategy = 'priority' | 'round-robin' | 'least-latency' | 'cost-optimized' | 'custom'

export interface RouterConfig {
  /** Available providers in priority order */
  providers: ProviderConfig[]
  /** Routing strategy */
  strategy?: RoutingStrategy
  /** Fallback behavior */
  fallback?: FallbackConfig
  /** Rate limiting */
  rateLimit?: RateLimitConfig
  /** Custom routing function */
  customRouter?: (request: CompletionRequest, providers: ProviderConfig[]) => ProviderConfig
}

export interface FallbackConfig {
  /** Enable automatic fallback to next provider on failure */
  enabled: boolean
  /** Maximum number of fallback attempts */
  maxAttempts?: number
  /** Error types that trigger fallback */
  triggerOn?: ('rate_limit' | 'timeout' | 'server_error' | 'auth_error')[]
}

export interface RateLimitConfig {
  /** Requests per minute per provider */
  requestsPerMinute?: number
  /** Tokens per minute per provider */
  tokensPerMinute?: number
  /** Queue overflow behavior */
  overflow?: 'reject' | 'queue' | 'wait'
}

// ============================================================================
// Memory Types
// ============================================================================

export interface MemoryConfig {
  /** Maximum number of messages to keep */
  maxMessages?: number
  /** Maximum total tokens in context */
  maxTokens?: number
  /** Sliding window strategy */
  windowStrategy?: 'fifo' | 'summarize' | 'importance'
  /** When to trigger summarization (token threshold) */
  summarizeThreshold?: number
  /** System message handling */
  preserveSystemMessages?: boolean
  /** Enable persistence */
  persist?: boolean
}

export interface ConversationState {
  id: string
  messages: Message[]
  summary?: string
  totalTokens: number
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface MemorySummary {
  summary: string
  tokenCount: number
  messagesCovered: number
  createdAt: Date
}

// ============================================================================
// Streaming Types
// ============================================================================

export type StreamEventType =
  | 'start'
  | 'text-delta'
  | 'tool-call-start'
  | 'tool-call-delta'
  | 'tool-call-end'
  | 'tool-result'
  | 'usage'
  | 'error'
  | 'done'

export interface StreamEvent {
  type: StreamEventType
  data: unknown
  timestamp: Date
}

export interface TextDeltaEvent extends StreamEvent {
  type: 'text-delta'
  data: { textDelta: string; accumulated: string }
}

export interface ToolCallStartEvent extends StreamEvent {
  type: 'tool-call-start'
  data: { toolCallId: string; toolName: string }
}

export interface ToolCallDeltaEvent extends StreamEvent {
  type: 'tool-call-delta'
  data: { toolCallId: string; argumentsDelta: string }
}

export interface ToolCallEndEvent extends StreamEvent {
  type: 'tool-call-end'
  data: { toolCall: ToolCall }
}

export interface ToolResultEvent extends StreamEvent {
  type: 'tool-result'
  data: { result: ToolResult }
}

export interface UsageEvent extends StreamEvent {
  type: 'usage'
  data: { usage: TokenUsage; costUsd: number }
}

export interface ErrorEvent extends StreamEvent {
  type: 'error'
  data: { error: Error; recoverable: boolean }
}

export interface DoneEvent extends StreamEvent {
  type: 'done'
  data: { response: CompletionResponse }
}

// ============================================================================
// Cost Tracking Types
// ============================================================================

export interface CostEstimate {
  inputTokens: number
  outputTokens: number
  inputCostUsd: number
  outputCostUsd: number
  totalCostUsd: number
  model: string
  provider: ProviderName
}

export interface UsageStats {
  totalRequests: number
  totalTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  averageLatencyMs: number
  successRate: number
  byProvider: Record<ProviderName, ProviderUsageStats>
  byModel: Record<string, ModelUsageStats>
}

export interface ProviderUsageStats {
  requests: number
  tokens: number
  costUsd: number
  errors: number
  averageLatencyMs: number
}

export interface ModelUsageStats {
  requests: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  averageLatencyMs: number
}

// ============================================================================
// Retry Types
// ============================================================================

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number
  /** Initial delay in milliseconds */
  initialDelayMs?: number
  /** Maximum delay in milliseconds */
  maxDelayMs?: number
  /** Backoff multiplier */
  backoffMultiplier?: number
  /** Add jitter to delays */
  jitter?: boolean
  /** Error types to retry on */
  retryOn?: ('rate_limit' | 'timeout' | 'server_error')[]
}

// ============================================================================
// Agent Runtime Types
// ============================================================================

export interface AgentRuntimeConfig {
  /** Agent identifier */
  id: string
  /** Agent name */
  name?: string
  /** System instructions */
  instructions?: string
  /** Model to use */
  model: string
  /** Available tools */
  tools?: ToolDefinition[]
  /** Router configuration */
  router: RouterConfig
  /** Memory configuration */
  memory?: MemoryConfig
  /** Maximum steps in agent loop */
  maxSteps?: number
  /** Default retry configuration */
  retry?: RetryConfig
  /** Cost budget per request in USD */
  budgetPerRequest?: number
  /** Total budget in USD */
  totalBudget?: number
}

export interface AgentRunRequest {
  /** User prompt */
  prompt?: string
  /** Or provide full message history */
  messages?: Message[]
  /** Override tools for this run */
  tools?: ToolDefinition[]
  /** Override model for this run */
  model?: string
  /** Abort signal */
  signal?: AbortSignal
  /** Session ID for memory persistence */
  sessionId?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

export interface AgentRunResponse {
  /** Final text output */
  text: string
  /** All tool calls made */
  toolCalls: ToolCall[]
  /** All tool results */
  toolResults: ToolResult[]
  /** Full message history */
  messages: Message[]
  /** Number of agent loop iterations */
  steps: number
  /** Why the agent stopped */
  finishReason: FinishReason
  /** Total token usage across all steps */
  usage: TokenUsage
  /** Total cost in USD */
  costUsd: number
  /** Total latency in milliseconds */
  latencyMs: number
}

export interface AgentStreamResponse extends AsyncIterable<StreamEvent> {
  /** Promise resolving to final response */
  response: Promise<AgentRunResponse>
  /** Promise resolving to final text */
  text: Promise<string>
  /** Promise resolving to all tool calls */
  toolCalls: Promise<ToolCall[]>
  /** Promise resolving to usage stats */
  usage: Promise<TokenUsage>
}

// ============================================================================
// Provider Interface
// ============================================================================

export interface LLMProvider {
  readonly name: ProviderName
  readonly config: ProviderConfig

  /** Check if provider supports a model */
  supportsModel(model: string): boolean

  /** Generate a completion */
  complete(request: CompletionRequest): Promise<CompletionResponse>

  /** Stream a completion */
  stream(request: CompletionRequest): AsyncIterable<StreamEvent>

  /** Count tokens for messages */
  countTokens(messages: Message[]): Promise<number>

  /** List available models */
  listModels(): Promise<ModelConfig[]>
}
