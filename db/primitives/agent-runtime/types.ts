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

// ============================================================================
// Agent Loop Types - Think-Act-Observe Pattern
// ============================================================================

/**
 * Agent loop phase identifiers
 *
 * The agent loop follows a classic ReAct (Reasoning + Acting) pattern:
 * - THINK: LLM reasons about the current state and decides what to do
 * - ACT: Execute tool calls decided during thinking
 * - OBSERVE: Process tool results and update state for next iteration
 */
export type AgentPhase = 'think' | 'act' | 'observe'

/**
 * Result of the THINK phase
 *
 * Contains the LLM's reasoning output including any tool calls it wants to make.
 */
export interface ThinkResult {
  /** Phase identifier */
  phase: 'think'
  /** LLM response text (reasoning/explanation) */
  text?: string
  /** Tool calls the LLM wants to execute */
  toolCalls: ToolCall[]
  /** Token usage for this thinking step */
  usage: TokenUsage
  /** Response latency in milliseconds */
  latencyMs: number
  /** Whether the agent should stop (no tool calls and has final answer) */
  shouldStop: boolean
  /** Provider that served this request */
  provider: ProviderName
}

/**
 * Result of a single tool execution in the ACT phase
 */
export interface ActToolResult {
  /** The tool call that was executed */
  toolCall: ToolCall
  /** Result from tool execution */
  result: ToolResult
  /** Execution time in milliseconds */
  durationMs: number
  /** Whether execution was successful */
  success: boolean
}

/**
 * Result of the ACT phase
 *
 * Contains results from executing all tool calls from the think phase.
 */
export interface ActResult {
  /** Phase identifier */
  phase: 'act'
  /** Results from each tool execution */
  toolResults: ActToolResult[]
  /** Total execution time for all tools in milliseconds */
  totalDurationMs: number
  /** Number of successful tool executions */
  successCount: number
  /** Number of failed tool executions */
  errorCount: number
}

/**
 * Result of the OBSERVE phase
 *
 * Contains the updated state after processing tool results.
 */
export interface ObserveResult {
  /** Phase identifier */
  phase: 'observe'
  /** Updated message history with tool results */
  messages: Message[]
  /** Summary of observations from tool results */
  observations: ToolObservation[]
  /** Total tokens used so far */
  totalTokens: number
  /** Whether to continue the loop */
  continueLoop: boolean
}

/**
 * A single observation from a tool result
 */
export interface ToolObservation {
  /** Tool that produced this observation */
  toolName: string
  /** The tool call ID */
  toolCallId: string
  /** Whether the tool succeeded */
  success: boolean
  /** Summary of the result (for logging/debugging) */
  summary: string
  /** The full result data */
  data: unknown
}

/**
 * Combined result from a single loop iteration
 */
export interface LoopIterationResult {
  /** Iteration number (1-based) */
  iteration: number
  /** Result from think phase */
  think: ThinkResult
  /** Result from act phase (null if no tools to execute) */
  act: ActResult | null
  /** Result from observe phase (null if no tools executed) */
  observe: ObserveResult | null
  /** Whether this iteration ended the loop */
  isTerminal: boolean
  /** Reason for loop termination (if terminal) */
  terminationReason?: LoopTerminationReason
}

/**
 * Reasons why the agent loop terminated
 */
export type LoopTerminationReason =
  | 'completed'       // Agent finished naturally (no more tool calls, has answer)
  | 'max_steps'       // Reached maximum step limit
  | 'aborted'         // Cancelled via abort signal
  | 'error'           // Unrecoverable error occurred
  | 'budget_exceeded' // Cost budget exceeded

/**
 * Complete agent loop execution result
 */
export interface AgentLoopResult {
  /** All iteration results */
  iterations: LoopIterationResult[]
  /** Total number of iterations */
  totalIterations: number
  /** Final text output */
  finalText: string
  /** All tool calls across all iterations */
  allToolCalls: ToolCall[]
  /** All tool results across all iterations */
  allToolResults: ToolResult[]
  /** Final message history */
  messages: Message[]
  /** Why the loop terminated */
  terminationReason: LoopTerminationReason
  /** Total token usage */
  totalUsage: TokenUsage
  /** Total cost in USD */
  totalCostUsd: number
  /** Total execution time in milliseconds */
  totalLatencyMs: number
}

/**
 * Hooks for observing and customizing agent loop behavior
 */
export interface AgentLoopHooks {
  /**
   * Called before the think phase starts
   * Can modify messages or context before LLM call
   */
  onBeforeThink?: (context: LoopContext) => Promise<LoopContext | void>

  /**
   * Called after think phase completes
   * Can inspect or modify tool calls before execution
   */
  onAfterThink?: (result: ThinkResult, context: LoopContext) => Promise<ThinkResult | void>

  /**
   * Called before each tool is executed
   * Can modify arguments, skip execution, or provide cached results
   */
  onBeforeAct?: (
    toolCall: ToolCall,
    context: LoopContext
  ) => Promise<{ action: 'execute' | 'skip' | 'cache'; cachedResult?: unknown; modifiedArgs?: Record<string, unknown> }>

  /**
   * Called after each tool execution
   * Can modify or augment tool results
   */
  onAfterAct?: (actResult: ActToolResult, context: LoopContext) => Promise<ActToolResult | void>

  /**
   * Called after observe phase with all tool results
   * Can modify observations or add additional context
   */
  onAfterObserve?: (result: ObserveResult, context: LoopContext) => Promise<ObserveResult | void>

  /**
   * Called at end of each iteration
   * Can force early termination or continue despite stop signals
   */
  onIterationEnd?: (result: LoopIterationResult, context: LoopContext) => Promise<{ forceStop?: boolean; forceContinue?: boolean }>

  /**
   * Called when an error occurs during any phase
   * Can handle/recover from errors or let them propagate
   */
  onError?: (error: Error, phase: AgentPhase, context: LoopContext) => Promise<{ handled: boolean; result?: unknown }>
}

/**
 * Context passed to hooks and available throughout loop execution
 */
export interface LoopContext {
  /** Agent ID */
  agentId: string
  /** Session ID */
  sessionId: string
  /** Current iteration number */
  iteration: number
  /** Current messages */
  messages: Message[]
  /** Available tools */
  tools: ToolDefinition[]
  /** Model being used */
  model: string
  /** Abort signal */
  signal?: AbortSignal
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** Usage so far */
  usageSoFar: TokenUsage
  /** Cost so far in USD */
  costSoFar: number
  /** Time elapsed so far in milliseconds */
  elapsedMs: number
}
