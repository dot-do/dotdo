/**
 * AIFunction Type System
 *
 * Comprehensive TypeScript types for AI functions supporting:
 * - Four function types: code, generative, agentic, human
 * - Full type inference for schema-to-return-type
 * - Generic support for custom output types
 * - Strict typing for function composition
 * - PipelinePromise integration
 *
 * @module types/AIFunction
 */

import type { PipelinePromise } from '../workflows/pipeline-promise'
import type { FunctionType } from './fn'
import type { AIProvider } from './AI'

// ============================================================================
// JSON Schema Types (for schema inference)
// ============================================================================

/**
 * JSON Schema type definitions for schema-to-type inference
 */
export type JSONSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array'

/**
 * JSON Schema definition with type inference support
 */
export interface JSONSchema {
  type?: JSONSchemaType | JSONSchemaType[]
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: readonly string[]
  enum?: readonly unknown[]
  const?: unknown
  description?: string
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  additionalProperties?: boolean | JSONSchema
  oneOf?: JSONSchema[]
  anyOf?: JSONSchema[]
  allOf?: JSONSchema[]
  $ref?: string
  $defs?: Record<string, JSONSchema>
}

// ============================================================================
// Schema Inference Types
// ============================================================================

/**
 * Infer TypeScript type from JSON Schema type string
 */
export type InferSchemaType<T extends JSONSchemaType> =
  T extends 'string' ? string :
  T extends 'number' ? number :
  T extends 'integer' ? number :
  T extends 'boolean' ? boolean :
  T extends 'null' ? null :
  T extends 'object' ? Record<string, unknown> :
  T extends 'array' ? unknown[] :
  unknown

/**
 * Infer TypeScript type from JSON Schema definition
 * Provides deep type inference for complex schemas
 */
export type InferSchema<S extends JSONSchema> =
  S extends { const: infer C } ? C :
  S extends { enum: readonly (infer E)[] } ? E :
  S extends { type: 'string' } ? string :
  S extends { type: 'number' } ? number :
  S extends { type: 'integer' } ? number :
  S extends { type: 'boolean' } ? boolean :
  S extends { type: 'null' } ? null :
  S extends { type: 'array'; items: infer I extends JSONSchema } ? InferSchema<I>[] :
  S extends { type: 'object'; properties: infer P extends Record<string, JSONSchema>; required: infer R extends readonly string[] }
    ? { [K in keyof P & string as K extends R[number] ? K : never]: InferSchema<P[K]> } &
      { [K in keyof P & string as K extends R[number] ? never : K]?: InferSchema<P[K]> }
  : S extends { type: 'object'; properties: infer P extends Record<string, JSONSchema> }
    ? { [K in keyof P]?: InferSchema<P[K]> }
  : S extends { type: 'object' } ? Record<string, unknown> :
  S extends { oneOf: readonly (infer U extends JSONSchema)[] } ? InferSchema<U> :
  S extends { anyOf: readonly (infer U extends JSONSchema)[] } ? InferSchema<U> :
  unknown

// ============================================================================
// Tool Types (for agentic functions)
// ============================================================================

/**
 * Tool definition for agentic functions
 */
export interface Tool<Input = unknown, Output = unknown> {
  /** Unique tool name */
  name: string
  /** Human-readable description for the AI */
  description: string
  /** Input schema for validation and type inference */
  inputSchema?: JSONSchema
  /** Output schema for validation */
  outputSchema?: JSONSchema
  /** The tool execution function */
  execute: (input: Input) => Promise<Output>
}

/**
 * Tool invocation result
 */
export interface ToolInvocation<T = unknown> {
  /** Tool name that was invoked */
  tool: string
  /** Input provided to the tool */
  input: unknown
  /** Output from the tool */
  output: T
  /** Duration of tool execution in ms */
  durationMs: number
  /** Whether the invocation succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
}

// ============================================================================
// Executor Options
// ============================================================================

/**
 * Base options shared by all function types
 */
export interface BaseExecutorOptions {
  /** Execution timeout in milliseconds */
  timeout?: number
  /** Retry configuration */
  retry?: RetryConfig
  /** Whether to cache results */
  cache?: boolean | CacheConfig
  /** Tags for metrics/logging */
  tags?: Record<string, string>
}

/**
 * Options for code function execution
 * Deterministic, synchronous execution
 */
export interface CodeOptions extends BaseExecutorOptions {
  /** Whether to run in a sandboxed environment */
  sandbox?: boolean
  /** Memory limit in MB */
  memoryLimit?: number
}

/**
 * Options for generative function execution
 * Single AI completion
 */
export interface GenerativeOptions extends BaseExecutorOptions {
  /** AI provider to use */
  provider?: AIProvider
  /** Model identifier */
  model?: string
  /** Temperature for generation (0-2) */
  temperature?: number
  /** Maximum tokens to generate */
  maxTokens?: number
  /** System prompt */
  systemPrompt?: string
  /** Stop sequences */
  stopSequences?: string[]
  /** Top-p sampling */
  topP?: number
  /** Frequency penalty */
  frequencyPenalty?: number
  /** Presence penalty */
  presencePenalty?: number
  /** Whether to stream the response */
  stream?: boolean
  /** JSON mode - force JSON output */
  jsonMode?: boolean
  /** Output schema for structured output */
  outputSchema?: JSONSchema
  /** Seed for reproducible outputs (if supported) */
  seed?: number
}

/**
 * Options for agentic function execution
 * AI with tools in a loop
 */
export interface AgenticOptions extends GenerativeOptions {
  /** Available tools for the agent */
  tools?: Tool[]
  /** Maximum number of tool calls */
  maxToolCalls?: number
  /** Maximum iterations of the agent loop */
  maxIterations?: number
  /** Whether to allow parallel tool calls */
  parallelToolCalls?: boolean
  /** Tool choice strategy */
  toolChoice?: 'auto' | 'required' | 'none' | { type: 'tool'; name: string }
  /** Planning strategy */
  planningMode?: 'none' | 'react' | 'tree-of-thought'
  /** Memory/context management */
  memory?: MemoryConfig
}

/**
 * Options for human-in-the-loop execution
 * Waits for human input/approval
 */
export interface HumanOptions extends BaseExecutorOptions {
  /** Communication channel (email, slack, sms, web) */
  channel?: 'email' | 'slack' | 'sms' | 'web' | 'webhook'
  /** User or group to notify */
  assignee?: string | string[]
  /** Priority level */
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  /** Due date for the task */
  dueDate?: Date | string
  /** Reminder intervals */
  reminders?: ReminderConfig[]
  /** Escalation rules */
  escalation?: EscalationConfig
  /** Custom webhook for receiving responses */
  webhookUrl?: string
  /** UI form schema for structured input */
  formSchema?: JSONSchema
  /** Instructions for the human */
  instructions?: string
  /** Whether approval is required (vs informational) */
  requiresApproval?: boolean
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Retry configuration for function execution
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts?: number
  /** Initial delay between retries in ms */
  initialDelayMs?: number
  /** Maximum delay between retries in ms */
  maxDelayMs?: number
  /** Exponential backoff multiplier */
  backoffMultiplier?: number
  /** Errors that should trigger a retry */
  retryOn?: Array<string | RegExp | ((error: AIFunctionError) => boolean)>
  /** Errors that should not trigger a retry */
  noRetryOn?: Array<string | RegExp | ((error: AIFunctionError) => boolean)>
}

/**
 * Cache configuration for function results
 */
export interface CacheConfig {
  /** Time-to-live in seconds */
  ttlSeconds?: number
  /** Cache key generator */
  keyFn?: (input: unknown) => string
  /** Whether to use stale-while-revalidate */
  staleWhileRevalidate?: boolean
  /** Cache namespace */
  namespace?: string
}

/**
 * Memory configuration for agentic functions
 */
export interface MemoryConfig {
  /** Maximum conversation turns to keep */
  maxTurns?: number
  /** Maximum tokens in context */
  maxTokens?: number
  /** Summarization strategy for long contexts */
  summarization?: 'none' | 'rolling' | 'hierarchical'
  /** External memory store */
  store?: 'local' | 'redis' | 'durable-object'
}

/**
 * Reminder configuration for human tasks
 */
export interface ReminderConfig {
  /** When to send the reminder (relative to creation or due date) */
  timing: 'before_due' | 'after_creation' | 'on_date'
  /** Duration in ISO 8601 format (e.g., 'P1D' for 1 day) */
  duration?: string
  /** Specific date for 'on_date' timing */
  date?: Date | string
  /** Channel override for this reminder */
  channel?: HumanOptions['channel']
}

/**
 * Escalation configuration for human tasks
 */
export interface EscalationConfig {
  /** Time after which to escalate (ISO 8601 duration) */
  after: string
  /** Who to escalate to */
  to: string | string[]
  /** Escalation message */
  message?: string
  /** Whether to keep original assignee */
  keepOriginal?: boolean
}

// ============================================================================
// Execution Result Types
// ============================================================================

/**
 * Base execution metrics shared by all function types
 */
export interface ExecutionMetrics {
  /** Total duration in milliseconds */
  durationMs: number
  /** Start time */
  startedAt: Date
  /** End time */
  completedAt: Date
  /** Number of retry attempts */
  retryCount: number
  /** Whether result was from cache */
  cached: boolean
}

/**
 * Metrics specific to generative execution
 */
export interface GenerativeMetrics extends ExecutionMetrics {
  /** Tokens used in the prompt */
  promptTokens: number
  /** Tokens generated in completion */
  completionTokens: number
  /** Total tokens used */
  totalTokens: number
  /** Model that was used */
  model: string
  /** Provider that was used */
  provider: AIProvider
  /** Finish reason */
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error'
}

/**
 * Metrics specific to agentic execution
 */
export interface AgenticMetrics extends GenerativeMetrics {
  /** Number of iterations */
  iterations: number
  /** Tool invocations */
  toolInvocations: ToolInvocation[]
  /** Total tool execution time */
  toolDurationMs: number
  /** Planning steps if applicable */
  planningSteps?: string[]
}

/**
 * Metrics specific to human execution
 */
export interface HumanMetrics extends ExecutionMetrics {
  /** Channel used for communication */
  channel: HumanOptions['channel']
  /** User who responded */
  respondent: string
  /** Time until first response */
  timeToFirstResponseMs?: number
  /** Number of reminders sent */
  remindersSent: number
  /** Whether escalation occurred */
  escalated: boolean
}

/**
 * Base execution result type
 */
export interface ExecutionResult<T, M extends ExecutionMetrics = ExecutionMetrics> {
  /** Whether execution succeeded */
  success: boolean
  /** The result value (present if success=true) */
  value?: T
  /** The error (present if success=false) */
  error?: AIFunctionError
  /** Execution metrics */
  metrics: M
  /** Trace ID for debugging */
  traceId: string
}

/**
 * Result from code function execution
 */
export type CodeExecutionResult<T> = ExecutionResult<T, ExecutionMetrics>

/**
 * Result from generative function execution
 */
export type GenerativeExecutionResult<T> = ExecutionResult<T, GenerativeMetrics>

/**
 * Result from agentic function execution
 */
export type AgenticExecutionResult<T> = ExecutionResult<T, AgenticMetrics>

/**
 * Result from human function execution
 */
export type HumanExecutionResult<T> = ExecutionResult<T, HumanMetrics>

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for AI function errors
 */
export class AIFunctionError extends Error {
  constructor(
    public code: AIFunctionErrorCode,
    message: string,
    public details?: Record<string, unknown>,
    public cause?: Error
  ) {
    super(message)
    this.name = 'AIFunctionError'
  }

  /** Convert to plain object for serialization */
  toJSON(): AIFunctionErrorData {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      cause: this.cause ? { message: this.cause.message, name: this.cause.name } : undefined,
    }
  }
}

/**
 * Error codes for AI function errors
 */
export type AIFunctionErrorCode =
  | 'VALIDATION_ERROR'
  | 'TIMEOUT_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'MODEL_ERROR'
  | 'TOOL_ERROR'
  | 'CONTEXT_LENGTH_ERROR'
  | 'CONTENT_FILTER_ERROR'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR'
  | 'CANCELLED_ERROR'
  | 'QUOTA_ERROR'
  | 'HUMAN_TIMEOUT_ERROR'
  | 'HUMAN_REJECTED_ERROR'
  | 'ESCALATION_ERROR'

/**
 * Serializable error data
 */
export interface AIFunctionErrorData {
  code: AIFunctionErrorCode
  message: string
  details?: Record<string, unknown>
  cause?: { message: string; name: string }
}

/**
 * Validation error with field-level details
 */
export class ValidationError extends AIFunctionError {
  constructor(
    public fieldErrors: Array<{ field: string; message: string }>,
    message?: string
  ) {
    super(
      'VALIDATION_ERROR',
      message ?? `Validation failed: ${fieldErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`,
      { fieldErrors }
    )
    this.name = 'ValidationError'
  }
}

/**
 * Timeout error with duration info
 */
export class TimeoutError extends AIFunctionError {
  constructor(
    public timeoutMs: number,
    message?: string
  ) {
    super(
      'TIMEOUT_ERROR',
      message ?? `Operation timed out after ${timeoutMs}ms`,
      { timeoutMs }
    )
    this.name = 'TimeoutError'
  }
}

/**
 * Rate limit error with retry information
 */
export class RateLimitError extends AIFunctionError {
  constructor(
    public retryAfterMs: number,
    public limit?: number,
    public remaining?: number,
    message?: string
  ) {
    super(
      'RATE_LIMIT_ERROR',
      message ?? `Rate limit exceeded. Retry after ${retryAfterMs}ms`,
      { retryAfterMs, limit, remaining }
    )
    this.name = 'RateLimitError'
  }
}

/**
 * Model-specific error (e.g., context length, capability)
 */
export class ModelError extends AIFunctionError {
  constructor(
    public model: string,
    public reason: 'context_length' | 'capability' | 'unavailable' | 'deprecated' | 'unknown',
    message?: string
  ) {
    super(
      'MODEL_ERROR',
      message ?? `Model error (${reason}): ${model}`,
      { model, reason }
    )
    this.name = 'ModelError'
  }
}

/**
 * Tool execution error
 */
export class ToolError extends AIFunctionError {
  constructor(
    public toolName: string,
    public toolError: Error,
    message?: string
  ) {
    super(
      'TOOL_ERROR',
      message ?? `Tool '${toolName}' failed: ${toolError.message}`,
      { toolName },
      toolError
    )
    this.name = 'ToolError'
  }
}

/**
 * Content filter/moderation error
 */
export class ContentFilterError extends AIFunctionError {
  constructor(
    public category: string,
    public severity: 'low' | 'medium' | 'high',
    message?: string
  ) {
    super(
      'CONTENT_FILTER_ERROR',
      message ?? `Content filtered: ${category} (${severity})`,
      { category, severity }
    )
    this.name = 'ContentFilterError'
  }
}

/**
 * Human task rejected error
 */
export class HumanRejectedError extends AIFunctionError {
  constructor(
    public respondent: string,
    public reason?: string,
    message?: string
  ) {
    super(
      'HUMAN_REJECTED_ERROR',
      message ?? `Task rejected by ${respondent}${reason ? `: ${reason}` : ''}`,
      { respondent, reason }
    )
    this.name = 'HumanRejectedError'
  }
}

// ============================================================================
// AI Function Definition Types
// ============================================================================

/**
 * Base AI function definition
 */
export interface AIFunctionDefinition<
  Input = unknown,
  Output = unknown,
  Options extends BaseExecutorOptions = BaseExecutorOptions
> {
  /** Unique function name */
  name: string
  /** Human-readable description */
  description?: string
  /** Function type (code, generative, agentic, human) */
  type: FunctionType
  /** Input schema for validation and inference */
  inputSchema?: JSONSchema
  /** Output schema for validation and inference */
  outputSchema?: JSONSchema
  /** Default options */
  defaultOptions?: Partial<Options>
  /** Version for tracking changes */
  version?: string
  /** Tags for categorization */
  tags?: string[]
  /** Whether this function is deprecated */
  deprecated?: boolean
  /** Deprecation message if deprecated */
  deprecationMessage?: string
}

/**
 * Code function definition
 */
export interface CodeFunctionDefinition<Input = unknown, Output = unknown>
  extends AIFunctionDefinition<Input, Output, CodeOptions> {
  type: 'code'
  /** The implementation function */
  handler: (input: Input, options?: CodeOptions) => Output | Promise<Output>
}

/**
 * Generative function definition
 */
export interface GenerativeFunctionDefinition<Input = unknown, Output = unknown>
  extends AIFunctionDefinition<Input, Output, GenerativeOptions> {
  type: 'generative'
  /** Prompt template (tagged template literal) */
  prompt?: string | ((input: Input) => string)
  /** System prompt override */
  systemPrompt?: string
}

/**
 * Agentic function definition
 */
export interface AgenticFunctionDefinition<Input = unknown, Output = unknown>
  extends AIFunctionDefinition<Input, Output, AgenticOptions> {
  type: 'agentic'
  /** Prompt template */
  prompt?: string | ((input: Input) => string)
  /** System prompt for the agent */
  systemPrompt?: string
  /** Available tools */
  tools?: Tool[]
  /** Goal/objective for the agent */
  goal?: string | ((input: Input) => string)
}

/**
 * Human function definition
 */
export interface HumanFunctionDefinition<Input = unknown, Output = unknown>
  extends AIFunctionDefinition<Input, Output, HumanOptions> {
  type: 'human'
  /** Task description template */
  taskDescription?: string | ((input: Input) => string)
  /** Form schema for structured input */
  formSchema?: JSONSchema
  /** Default channel */
  channel?: HumanOptions['channel']
}

/**
 * Union of all function definition types
 */
export type AnyFunctionDefinition<Input = unknown, Output = unknown> =
  | CodeFunctionDefinition<Input, Output>
  | GenerativeFunctionDefinition<Input, Output>
  | AgenticFunctionDefinition<Input, Output>
  | HumanFunctionDefinition<Input, Output>

// ============================================================================
// PipelinePromise Integration Types
// ============================================================================

/**
 * AI Function that returns a PipelinePromise for lazy evaluation
 */
export interface PipelineAIFunction<Output, Input = unknown, Options extends BaseExecutorOptions = BaseExecutorOptions> {
  /** Direct call with input and options */
  (input: Input, options?: Options): PipelinePromise<ExecutionResult<Output>>

  /** Tagged template call with interpolation */
  (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<ExecutionResult<Output>>

  /** Tagged template call with named params - returns partially applied function */
  <S extends string>(
    strings: TemplateStringsArray & { raw: readonly S[] }
  ): (params: Record<string, unknown>, options?: Options) => PipelinePromise<ExecutionResult<Output>>
}

/**
 * Streaming AI Function that returns an AsyncIterable wrapped in PipelinePromise
 */
export interface StreamingAIFunction<Output, Input = unknown, Options extends BaseExecutorOptions = BaseExecutorOptions> {
  /** Direct call with input and options */
  (input: Input, options?: Options): PipelinePromise<AsyncIterable<Output>>

  /** Tagged template call with interpolation */
  (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<AsyncIterable<Output>>

  /** Tagged template call with named params */
  <S extends string>(
    strings: TemplateStringsArray & { raw: readonly S[] }
  ): (params: Record<string, unknown>, options?: Options) => PipelinePromise<AsyncIterable<Output>>
}

// ============================================================================
// Executor Types
// ============================================================================

/**
 * Executor function type - simplified async function with options
 */
export type ExecutorFn<Output, Input, Options> = (
  input: Input,
  options?: Options
) => Promise<Output>

/**
 * Executor for code functions
 */
export interface CodeExecutor {
  <Input, Output>(
    definition: CodeFunctionDefinition<Input, Output>
  ): ExecutorFn<CodeExecutionResult<Output>, Input, CodeOptions>
}

/**
 * Executor for generative functions
 */
export interface GenerativeExecutor {
  <Input, Output>(
    definition: GenerativeFunctionDefinition<Input, Output>
  ): ExecutorFn<GenerativeExecutionResult<Output>, Input, GenerativeOptions>
}

/**
 * Executor for agentic functions
 */
export interface AgenticExecutor {
  <Input, Output>(
    definition: AgenticFunctionDefinition<Input, Output>
  ): ExecutorFn<AgenticExecutionResult<Output>, Input, AgenticOptions>
}

/**
 * Executor for human functions
 */
export interface HumanExecutor {
  <Input, Output>(
    definition: HumanFunctionDefinition<Input, Output>
  ): ExecutorFn<HumanExecutionResult<Output>, Input, HumanOptions>
}

// ============================================================================
// Function Composition Types
// ============================================================================

/**
 * Compose multiple functions into a pipeline
 */
export interface ComposedFunction<Output, Input = unknown> {
  /** Execute the composed pipeline */
  (input: Input): Promise<Output>
  /** Add another function to the pipeline */
  pipe<Next>(fn: (output: Output) => Promise<Next> | Next): ComposedFunction<Next, Input>
  /** Add error handling */
  catch<Fallback>(handler: (error: AIFunctionError) => Promise<Fallback> | Fallback): ComposedFunction<Output | Fallback, Input>
  /** Add conditional branching */
  branch<A, B>(
    predicate: (output: Output) => boolean,
    onTrue: (output: Output) => Promise<A> | A,
    onFalse: (output: Output) => Promise<B> | B
  ): ComposedFunction<A | B, Input>
}

/**
 * Function that can fallback through execution methods
 */
export interface CascadingFunction<Output, Input = unknown> {
  /** Execute with cascade (code -> generative -> agentic -> human) */
  (input: Input): Promise<ExecutionResult<Output>>
  /** Get the cascade configuration */
  getCascade(): FunctionType[]
  /** Set cascade order */
  setCascade(order: FunctionType[]): CascadingFunction<Output, Input>
}

// ============================================================================
// Template Literal Function Signatures
// ============================================================================

/**
 * Extract parameter names from a template string type
 */
export type ExtractTemplateParams<S extends string> =
  S extends `${infer _}${'${'}${infer Param}${'}'}${infer Rest}`
    ? Param | ExtractTemplateParams<Rest>
    : never

/**
 * Create a type-safe template function
 */
export interface TemplateFn<Output, Params extends Record<string, unknown> = Record<string, unknown>> {
  /** Call with params object */
  (params: Params): Promise<Output>
  /** Get the raw template */
  readonly template: string
  /** Get the parameter names */
  readonly params: (keyof Params)[]
}

/**
 * AI template literal function type
 */
export type AITemplateFn<Output> = <S extends string>(
  strings: TemplateStringsArray & { raw: readonly S[] },
  ...values: unknown[]
) => TemplateFn<Output, Record<ExtractTemplateParams<S>, unknown>>

// ============================================================================
// Builder Types
// ============================================================================

/**
 * Builder for creating AI functions with fluent API
 */
export interface AIFunctionBuilder<Input = unknown, Output = unknown> {
  /** Set the function name */
  name(name: string): this
  /** Set the description */
  description(desc: string): this
  /** Set the function type */
  type(type: FunctionType): this
  /** Set the input schema */
  input<S extends JSONSchema>(schema: S): AIFunctionBuilder<InferSchema<S>, Output>
  /** Set the output schema */
  output<S extends JSONSchema>(schema: S): AIFunctionBuilder<Input, InferSchema<S>>
  /** Set default options */
  options(opts: BaseExecutorOptions): this
  /** Build a code function */
  code(handler: (input: Input) => Output | Promise<Output>): CodeFunctionDefinition<Input, Output>
  /** Build a generative function */
  generative(prompt: string | ((input: Input) => string)): GenerativeFunctionDefinition<Input, Output>
  /** Build an agentic function */
  agentic(goal: string | ((input: Input) => string), tools?: Tool[]): AgenticFunctionDefinition<Input, Output>
  /** Build a human function */
  human(taskDescription: string | ((input: Input) => string)): HumanFunctionDefinition<Input, Output>
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if error is an AIFunctionError
 */
export function isAIFunctionError(error: unknown): error is AIFunctionError {
  return error instanceof AIFunctionError
}

/**
 * Check if error is a specific error type
 */
export function isErrorCode(error: unknown, code: AIFunctionErrorCode): boolean {
  return isAIFunctionError(error) && error.code === code
}

/**
 * Check if a function definition is of a specific type
 */
export function isCodeFunction<I, O>(def: AnyFunctionDefinition<I, O>): def is CodeFunctionDefinition<I, O> {
  return def.type === 'code'
}

export function isGenerativeFunction<I, O>(def: AnyFunctionDefinition<I, O>): def is GenerativeFunctionDefinition<I, O> {
  return def.type === 'generative'
}

export function isAgenticFunction<I, O>(def: AnyFunctionDefinition<I, O>): def is AgenticFunctionDefinition<I, O> {
  return def.type === 'agentic'
}

export function isHumanFunction<I, O>(def: AnyFunctionDefinition<I, O>): def is HumanFunctionDefinition<I, O> {
  return def.type === 'human'
}

/**
 * Check if an execution result is successful
 */
export function isSuccess<T, M extends ExecutionMetrics>(result: ExecutionResult<T, M>): result is ExecutionResult<T, M> & { success: true; value: T } {
  return result.success === true && result.value !== undefined
}

/**
 * Check if an execution result is a failure
 */
export function isFailure<T, M extends ExecutionMetrics>(result: ExecutionResult<T, M>): result is ExecutionResult<T, M> & { success: false; error: AIFunctionError } {
  return result.success === false && result.error !== undefined
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Unwrap the output type from an execution result
 */
export type UnwrapResult<R> = R extends ExecutionResult<infer T, any> ? T : never

/**
 * Get the options type for a function type
 */
export type OptionsForType<T extends FunctionType> =
  T extends 'code' ? CodeOptions :
  T extends 'generative' ? GenerativeOptions :
  T extends 'agentic' ? AgenticOptions :
  T extends 'human' ? HumanOptions :
  BaseExecutorOptions

/**
 * Get the result type for a function type
 */
export type ResultForType<T extends FunctionType, Output> =
  T extends 'code' ? CodeExecutionResult<Output> :
  T extends 'generative' ? GenerativeExecutionResult<Output> :
  T extends 'agentic' ? AgenticExecutionResult<Output> :
  T extends 'human' ? HumanExecutionResult<Output> :
  ExecutionResult<Output>

/**
 * Get the metrics type for a function type
 */
export type MetricsForType<T extends FunctionType> =
  T extends 'code' ? ExecutionMetrics :
  T extends 'generative' ? GenerativeMetrics :
  T extends 'agentic' ? AgenticMetrics :
  T extends 'human' ? HumanMetrics :
  ExecutionMetrics

/**
 * Make all properties deeply required
 */
export type DeepRequired<T> = {
  [K in keyof T]-?: T[K] extends object ? DeepRequired<T[K]> : T[K]
}

/**
 * Make all properties deeply partial
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
