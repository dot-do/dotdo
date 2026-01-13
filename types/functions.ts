/**
 * Functions Type System
 *
 * Consolidated types for function configurations across the dotdo platform.
 * Provides discriminated unions for the four function types and type guards
 * for runtime type checking.
 *
 * This module is the single source of truth for:
 * - FunctionType discriminant
 * - FunctionConfig discriminated unions
 * - RetryConfig for execution retry logic
 * - Type guards for runtime type checking
 *
 * Used by:
 * - lib/executors/BaseFunctionExecutor.ts
 * - db/graph/adapters/function-graph-adapter.ts
 * - objects/Function.ts (for DeployedFunctionConfig)
 *
 * @module types/functions
 */

// ============================================================================
// FUNCTION TYPE DISCRIMINANT
// ============================================================================

/**
 * The four implementation types for functions.
 * - code: Deterministic TypeScript (fastest, cheapest)
 * - generative: Single AI completion
 * - agentic: AI + tools in a loop
 * - human: Human-in-the-loop (slowest, most expensive)
 *
 * @example
 * ```typescript
 * const config: FunctionConfig = {
 *   type: 'code',
 *   name: 'calculate',
 *   handler: (input) => input * 2
 * }
 * ```
 */
export type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

// ============================================================================
// RETRY CONFIGURATION
// ============================================================================

/**
 * Configuration for function execution retry logic.
 *
 * Supports multiple backoff strategies:
 * - fixed: Same delay between all retries
 * - exponential: Delay doubles each retry
 * - exponential-jitter: Exponential with random jitter to prevent thundering herd
 * - linear: Delay increases by fixed increment each retry
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (including initial attempt) */
  maxAttempts: number
  /** Base delay between retries in milliseconds */
  delay: number
  /** Backoff strategy */
  backoff?: 'fixed' | 'exponential' | 'exponential-jitter' | 'linear'
  /** Increment for linear backoff in milliseconds */
  increment?: number
  /** Maximum delay cap in milliseconds */
  maxDelay?: number
  /** Custom function to determine if error should trigger retry */
  retryIf?: (error: Error) => boolean
  /** Whether to retry on timeout errors (default: true) */
  retryOnTimeout?: boolean
  /** Callback invoked before each retry attempt */
  onRetry?: (info: { attempt: number; delay: number; error: Error }) => void
}

// ============================================================================
// BASE FUNCTION CONFIG
// ============================================================================

/**
 * Base configuration shared by all function types.
 * Extended by each specific function type config.
 */
export interface BaseFunctionConfig {
  /** Unique name identifying the function */
  name: string
  /** Human-readable description of what the function does */
  description?: string
  /** Execution timeout in milliseconds */
  timeout?: number
  /** Retry configuration for failed executions */
  retries?: RetryConfig
}

// ============================================================================
// CODE FUNCTION CONFIG
// ============================================================================

/**
 * Configuration for code functions.
 * Deterministic, synchronous or async TypeScript/JavaScript execution.
 *
 * @example
 * ```typescript
 * const config: CodeFunctionConfig = {
 *   type: 'code',
 *   name: 'double',
 *   handler: (input: number) => input * 2,
 *   sandboxed: true
 * }
 * ```
 */
export interface CodeFunctionConfig extends BaseFunctionConfig {
  /** Discriminant for code function type */
  type: 'code'
  /** The function implementation */
  handler: (input: unknown, ctx: unknown) => unknown | Promise<unknown>
  /** Whether to run in a sandboxed environment (ai-evaluate) */
  sandboxed?: boolean
}

// ============================================================================
// GENERATIVE FUNCTION CONFIG
// ============================================================================

/**
 * Configuration for generative functions.
 * Single AI model completion without tool use.
 *
 * @example
 * ```typescript
 * const config: GenerativeFunctionConfig = {
 *   type: 'generative',
 *   name: 'summarize',
 *   model: 'claude-3-opus',
 *   prompt: 'Summarize the following text: {{text}}',
 *   maxTokens: 500
 * }
 * ```
 */
export interface GenerativeFunctionConfig extends BaseFunctionConfig {
  /** Discriminant for generative function type */
  type: 'generative'
  /** AI model identifier (e.g., 'claude-3-opus', 'gpt-4') */
  model: string
  /** Prompt template with {{variable}} interpolation */
  prompt: string | ((input: unknown) => string)
  /** Temperature for generation (0-2, lower = more deterministic) */
  temperature?: number
  /** Maximum tokens to generate */
  maxTokens?: number
  /** JSON schema for structured output */
  schema?: Record<string, unknown>
}

// ============================================================================
// AGENTIC FUNCTION CONFIG
// ============================================================================

/**
 * Configuration for agentic functions.
 * AI model with access to tools, executing in a loop until goal is achieved.
 *
 * @example
 * ```typescript
 * const config: AgenticFunctionConfig = {
 *   type: 'agentic',
 *   name: 'research',
 *   model: 'claude-3-opus',
 *   tools: ['web_search', 'read_file'],
 *   goal: 'Research the topic and provide a summary',
 *   maxIterations: 10
 * }
 * ```
 */
export interface AgenticFunctionConfig extends BaseFunctionConfig {
  /** Discriminant for agentic function type */
  type: 'agentic'
  /** AI model identifier */
  model: string
  /** List of tool names available to the agent */
  tools: string[]
  /** The goal or objective for the agent to achieve */
  goal: string
  /** Maximum number of tool-use iterations */
  maxIterations?: number
  /** System prompt for agent behavior */
  systemPrompt?: string
}

// ============================================================================
// HUMAN FUNCTION CONFIG
// ============================================================================

/**
 * Configuration for human-in-the-loop functions.
 * Waits for human input, approval, or action.
 *
 * @example
 * ```typescript
 * const config: HumanFunctionConfig = {
 *   type: 'human',
 *   name: 'approve_refund',
 *   channel: 'slack',
 *   prompt: 'Please approve refund of ${{amount}} for {{customer}}',
 *   actions: ['approve', 'reject', 'escalate']
 * }
 * ```
 */
export interface HumanFunctionConfig extends BaseFunctionConfig {
  /** Discriminant for human function type */
  type: 'human'
  /** Communication channel (slack, email, sms, web, discord) */
  channel: string
  /** Prompt template shown to the human */
  prompt: string | ((input: unknown) => string)
  /** Available action buttons/options */
  actions?: string[]
  /** Form schema for structured input */
  form?: Record<string, unknown>
}

// ============================================================================
// DISCRIMINATED UNION
// ============================================================================

/**
 * Discriminated union of all function configuration types.
 * Use the `type` field to narrow to a specific function type.
 *
 * @example
 * ```typescript
 * function executeFunction(config: FunctionConfig) {
 *   switch (config.type) {
 *     case 'code':
 *       return config.handler(input, ctx) // TypeScript knows handler exists
 *     case 'generative':
 *       return generateWithModel(config.model, config.prompt)
 *     case 'agentic':
 *       return runAgentLoop(config.tools, config.goal)
 *     case 'human':
 *       return sendToChannel(config.channel, config.prompt)
 *   }
 * }
 * ```
 */
export type FunctionConfig =
  | CodeFunctionConfig
  | GenerativeFunctionConfig
  | AgenticFunctionConfig
  | HumanFunctionConfig

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for code function configs.
 *
 * @param config - Function config to check
 * @returns true if config is a CodeFunctionConfig
 *
 * @example
 * ```typescript
 * if (isCodeFunction(config)) {
 *   // TypeScript knows config.handler exists
 *   const result = await config.handler(input, ctx)
 * }
 * ```
 */
export function isCodeFunction(config: FunctionConfig): config is CodeFunctionConfig {
  return config.type === 'code'
}

/**
 * Type guard for generative function configs.
 *
 * @param config - Function config to check
 * @returns true if config is a GenerativeFunctionConfig
 *
 * @example
 * ```typescript
 * if (isGenerativeFunction(config)) {
 *   // TypeScript knows config.model and config.prompt exist
 *   const result = await generateWithModel(config.model, config.prompt)
 * }
 * ```
 */
export function isGenerativeFunction(config: FunctionConfig): config is GenerativeFunctionConfig {
  return config.type === 'generative'
}

/**
 * Type guard for agentic function configs.
 *
 * @param config - Function config to check
 * @returns true if config is an AgenticFunctionConfig
 *
 * @example
 * ```typescript
 * if (isAgenticFunction(config)) {
 *   // TypeScript knows config.tools and config.goal exist
 *   const result = await runAgentLoop(config.tools, config.goal)
 * }
 * ```
 */
export function isAgenticFunction(config: FunctionConfig): config is AgenticFunctionConfig {
  return config.type === 'agentic'
}

/**
 * Type guard for human function configs.
 *
 * @param config - Function config to check
 * @returns true if config is a HumanFunctionConfig
 *
 * @example
 * ```typescript
 * if (isHumanFunction(config)) {
 *   // TypeScript knows config.channel and config.prompt exist
 *   const result = await sendToChannel(config.channel, config.prompt)
 * }
 * ```
 */
export function isHumanFunction(config: FunctionConfig): config is HumanFunctionConfig {
  return config.type === 'human'
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Extract the config type for a given FunctionType.
 *
 * @example
 * ```typescript
 * type CodeConfig = ConfigForType<'code'> // CodeFunctionConfig
 * type GenerativeConfig = ConfigForType<'generative'> // GenerativeFunctionConfig
 * ```
 */
export type ConfigForType<T extends FunctionType> =
  T extends 'code' ? CodeFunctionConfig :
  T extends 'generative' ? GenerativeFunctionConfig :
  T extends 'agentic' ? AgenticFunctionConfig :
  T extends 'human' ? HumanFunctionConfig :
  never

/**
 * Make function config properties mutable (removes readonly).
 * Useful for builders and factories.
 */
export type MutableFunctionConfig<T extends FunctionConfig> = {
  -readonly [K in keyof T]: T[K]
}

/**
 * Partial function config for updates.
 * Keeps the type discriminant required.
 */
export type PartialFunctionConfig<T extends FunctionConfig> =
  Pick<T, 'type'> & Partial<Omit<T, 'type'>>

// ============================================================================
// DEPLOYED FUNCTION CONFIG (for objects/Function.ts)
// ============================================================================

/**
 * Configuration for a deployed function in a Durable Object.
 * This is distinct from FunctionConfig - it represents a deployable unit
 * with source code and runtime settings.
 *
 * Used by objects/Function.ts for function deployment and invocation.
 */
export interface DeployedFunctionConfig {
  /** Unique name for the deployed function */
  name: string
  /** Human-readable description */
  description?: string
  /** Runtime environment */
  runtime: 'javascript' | 'typescript'
  /** Source code for the function */
  source: string
  /** Execution timeout in milliseconds */
  timeout?: number
  /** Memory limit in MB */
  memory?: number
}

// ============================================================================
// GRAPH FUNCTION DATA (for db/graph/adapters)
// ============================================================================

/**
 * Function data structure for graph storage.
 * Used by FunctionGraphAdapter for storing functions as graph Things.
 *
 * This is the data payload stored in a GraphThing.data field.
 */
export interface FunctionGraphData {
  /** Function name */
  name: string
  /** Function type (code, generative, agentic, human) */
  type: FunctionType
  /** Human-readable description */
  description?: string
  /** Handler reference (e.g., module path or function ID) */
  handler?: string
  /** Additional configuration */
  config?: Record<string, unknown>
  /** Version string */
  version?: string
  /** Whether the function is enabled */
  enabled?: boolean
}
