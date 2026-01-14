import type { RpcPromise } from './fn'
import type { Thing } from './Thing'

// ============================================================================
// BASE WORKFLOW CONTEXT TYPE (inlined from @org.ai/types)
// ============================================================================

/**
 * Event handler type for workflow events
 * @template TOutput - The return type of the handler (defaults to unknown)
 * @template TInput - The event data type (defaults to unknown)
 */
type EventHandlerTypeBase<TOutput = unknown, TInput = unknown> = (
  data: TInput,
  ctx: WorkflowContextTypeBase
) => TOutput | void | Promise<TOutput | void>

/**
 * Workflow execution context interface (base from @org.ai/types)
 * Provides methods for event handling, scheduling, and state management.
 *
 * Execution semantics:
 *
 *               |  Fire & Forget  |   Durable
 * --------------|-----------------|---------------
 *    Event      |  track() -> void|  send() -> EventId
 * --------------|-----------------|---------------
 *    Action     |  try() -> T     |  do() -> T
 */
interface WorkflowContextTypeBase {
  /**
   * Track an event (fire and forget)
   * Best effort, no confirmation, swallows errors silently
   * Use for telemetry, analytics, non-critical logging
   */
  track: (event: string, data: unknown) => void

  /**
   * Send an event (durable)
   * Guaranteed delivery with retries, returns trackable EventId
   * Use for important domain events that must not be lost
   */
  send: <T = unknown>(event: string, data: T) => string  // Returns EventId

  /**
   * Try an action (fire and forget)
   * Single attempt, use .catch() for error handling
   * No retries, no persistence
   */
  try: <TResult = unknown, TInput = unknown>(action: string, data: TInput) => Promise<TResult>

  /**
   * Do an action (durable)
   * Retries on failure, guaranteed completion
   * Stores result durably, can await receipt confirmation
   */
  do: <TResult = unknown, TInput = unknown>(action: string, data: TInput) => Promise<TResult>

  /** Event handler registry - $.on.Noun.verb(handler) */
  on: Record<string, Record<string, (handler: EventHandlerTypeBase) => void>>

  /** Scheduling registry - $.every.monday.at('9am')(handler) */
  every: Record<string, unknown>

  /** State storage */
  state: Record<string, unknown>

  /** Set a value in state */
  set: <T>(key: string, value: T) => void

  /** Get a value from state */
  get: <T>(key: string) => T | undefined
}

// ============================================================================
// USER CONTEXT - Authenticated user information from RPC middleware
// ============================================================================

/**
 * User context extracted from authentication.
 * This is passed to Durable Objects via X-User-* headers by the RPC auth middleware.
 */
export interface UserContext {
  /** Unique user identifier */
  id: string
  /** User's email address (optional) */
  email?: string
  /** User's role for authorization (optional) */
  role?: string
}

// ============================================================================
// NOUN REGISTRY - Extensible registry for domain nouns
// ============================================================================

/**
 * NounRegistry - Interface for registering domain nouns with typed payloads
 *
 * This interface is designed for module augmentation. Extend it in your
 * domain code to register nouns with their entity shapes.
 *
 * @example
 * ```typescript
 * // In your domain types:
 * declare module '../types/WorkflowContext' {
 *   interface NounRegistry {
 *     Customer: { id: string; email: string; name: string }
 *     Invoice: { id: string; amount: number; status: string }
 *     Order: { id: string; items: string[]; total: number }
 *   }
 * }
 * ```
 *
 * After registration, $.Customer, $.Invoice, $.Order will be properly typed
 * and provide autocomplete. Accessing unregistered nouns will be a type error.
 */
export interface NounRegistry {
  // Default nouns for the framework - extend via module augmentation
  Customer: unknown
  Invoice: unknown
  Order: unknown
  Payment: unknown
  Startup: unknown
  User: unknown
}

/**
 * NounAccessors - Mapped type providing typed noun access
 *
 * Each key in NounRegistry becomes a callable (id: string) => DomainProxy
 * property on WorkflowContext.
 */
export type NounAccessors = {
  [K in keyof NounRegistry]: (id: string) => DomainProxy
}

/**
 * Type guard to check if a string is a valid registered noun
 *
 * @example
 * ```typescript
 * const maybeNoun: string = 'Customer'
 * if (isValidNoun(maybeNoun)) {
 *   // maybeNoun is now typed as keyof NounRegistry
 *   $[maybeNoun](id) // type-safe access
 * }
 * ```
 */
export function isValidNoun<K extends keyof NounRegistry>(
  noun: string
): noun is K & string {
  // Runtime check - can be enhanced with actual registry lookup
  const registeredNouns = ['Customer', 'Invoice', 'Order', 'Payment', 'Startup', 'User']
  return registeredNouns.includes(noun)
}

/**
 * Safely access a noun from WorkflowContext with type narrowing
 *
 * @example
 * ```typescript
 * const customerAccessor = getNoun($, 'Customer')
 * const proxy = customerAccessor('cust-123')
 * ```
 */
export function getNoun<K extends keyof NounRegistry>(
  ctx: WorkflowContext,
  noun: K
): (id: string) => DomainProxy {
  return ctx[noun] as (id: string) => DomainProxy
}

// ============================================================================
// AI FUNCTION TYPES
// ============================================================================

/**
 * PipelinePromise - Promise with chainable methods for no-await operations
 */
export interface AIPipelinePromise<T> extends Promise<T> {
  /** Transform the result */
  map<R>(fn: (value: T) => R | Promise<R>): AIPipelinePromise<R>
  /** Access a property on the resolved value */
  get<K extends keyof T>(key: K): AIPipelinePromise<T[K]>
  /** Handle errors */
  catch<R = T>(fn: (error: Error) => R | Promise<R>): AIPipelinePromise<R>
}

/**
 * Write result with destructurable properties
 */
export interface WriteResult {
  title?: string
  body?: string
  summary?: string
  content?: string
  [key: string]: string | undefined
}

/**
 * Extract result with typed entities
 */
export interface ExtractResult<T = Record<string, unknown>> {
  entities: T[]
  raw: string
}

/**
 * Review result with approval status and feedback
 */
export interface ReviewResult {
  approved: boolean
  feedback: string
  reviewer?: string
  timestamp?: Date
}

/**
 * Template literal function type for AI functions
 */
export type AITemplateLiteralFn<T> = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => AIPipelinePromise<T>

/**
 * Decide factory function - creates a template literal classifier
 */
export type DecideFn = <T extends string>(
  options: T[]
) => AITemplateLiteralFn<T>

// ============================================================================
// EXECUTION MODE TYPES
// ============================================================================

/**
 * Retry policy configuration for durable execution ($.do())
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number
  /** Initial delay in milliseconds before first retry (default: 100) */
  initialDelayMs: number
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelayMs: number
  /** Backoff multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number
  /** Whether to add random jitter to delays (default: true) */
  jitter: boolean
}

/**
 * Options for $.try() execution
 */
export interface TryOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * Options for $.do() durable execution
 */
export interface DoOptions {
  /** Custom retry policy (merged with defaults) */
  retry?: Partial<RetryPolicy>
  /** Timeout per attempt in milliseconds */
  timeout?: number
  /** Explicit step ID for workflow integration and replay */
  stepId?: string
}

/**
 * Action status values for lifecycle tracking
 */
export type ActionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retrying'

/**
 * Error details stored in action records
 */
export interface ActionError {
  message: string
  name: string
  stack?: string
}

// ============================================================================
// WORKFLOW CONTEXT ($) - The unified interface for all DO operations
// ============================================================================

export interface WorkflowContext extends Omit<WorkflowContextTypeBase, 'on' | 'every' | 'set' | 'get'>, NounAccessors {
  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION MODES (different durability levels)
  // Inherited from WorkflowContextType: track, send, try, do
  // DO-specific overloads with additional options below
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Track an event (fire and forget)
   * Best effort, no confirmation, swallows errors silently
   * Use for telemetry, analytics, non-critical logging
   *
   * Inherited from WorkflowContextType
   */
  track: (event: string, data: unknown) => void

  /**
   * Send an event (durable)
   * Guaranteed delivery with retries, returns trackable EventId
   * Use for important domain events that must not be lost
   *
   * Inherited from WorkflowContextType, returns EventId (string)
   */
  send: <T = unknown>(event: string, data: T) => string

  /**
   * Quick attempt without durability
   * Blocking, non-durable, single attempt
   *
   * @param action - The action to execute
   * @param data - The data to pass to the action
   * @param options - Optional execution options (timeout) - DO-specific extension
   */
  try<T>(action: string, data: unknown, options?: TryOptions): Promise<T>

  /**
   * Durable execution with retries
   * Blocking, durable, guaranteed event emission
   *
   * Features:
   * - Configurable retry policy with exponential backoff
   * - Step persistence for replay
   * - Complete action lifecycle tracking
   *
   * @param action - The action to execute
   * @param data - The data to pass to the action
   * @param options - Optional execution options (retry, timeout, stepId) - DO-specific extension
   */
  do<T>(action: string, data: unknown, options?: DoOptions): Promise<T>

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to domain events
   * $.on.Customer.created(handler)
   * $.on.Invoice.paid(handler)
   */
  on: OnProxy

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Schedule recurring tasks
   * $.every.Monday.at9am(handler)
   * $.every('daily at 6am', handler)
   */
  every: ScheduleBuilder

  // ═══════════════════════════════════════════════════════════════════════════
  // AI FUNCTIONS - Template literal AI operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * General AI completion as template literal
   * $.ai`What is the capital of France?`
   * $.ai`Explain ${topic} in simple terms`
   */
  ai: AITemplateLiteralFn<string>

  /**
   * Text generation with structured output
   * const { title, body } = await $.write`Write a blog post about ${topic}`
   */
  write: AITemplateLiteralFn<WriteResult>

  /**
   * Summarization
   * const summary = await $.summarize`${longArticle}`
   */
  summarize: AITemplateLiteralFn<string>

  /**
   * List generation
   * const items = await $.list`List 5 programming languages`
   */
  list: AITemplateLiteralFn<string[]>

  /**
   * Data extraction
   * const { entities } = await $.extract`Extract companies from: ${article}`
   */
  extract: <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => AIPipelinePromise<ExtractResult<T>>

  /**
   * Binary classification
   * const isSpam = await $.is`Is this message spam? ${message}`
   */
  is: AITemplateLiteralFn<boolean>

  /**
   * Multi-option classification factory
   * const sentiment = $.decide(['positive', 'negative', 'neutral'])
   * const result = await sentiment`What is the sentiment? ${text}`
   */
  decide: DecideFn

  // ═══════════════════════════════════════════════════════════════════════════
  // HUMAN-IN-LOOP FUNCTIONS - Template literal human workflows
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ask a human for free-form input
   * const answer = await $.ask`What priority should this bug have? ${bugReport}`
   */
  ask: AITemplateLiteralFn<string>

  /**
   * Request human approval (binary yes/no)
   * const approved = await $.approve`Approve expense $${amount} for ${description}?`
   */
  approve: AITemplateLiteralFn<boolean>

  /**
   * Request human review with feedback
   * const { approved, feedback } = await $.review`Review PR #${prNumber}: ${diff}`
   */
  review: AITemplateLiteralFn<ReviewResult>

  // ═══════════════════════════════════════════════════════════════════════════
  // DOMAIN RESOLUTION (cross-DO)
  // ═══════════════════════════════════════════════════════════════════════════

  // Noun accessors are now provided by extending NounAccessors
  // $.Startup('acme').prioritize()
  // $.Invoice(id).send()
  // Register additional nouns via module augmentation of NounRegistry

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCHING & VERSION CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new branch at current HEAD
   */
  branch(name: string): Promise<void>

  /**
   * Switch to a branch or version
   * $.checkout('experiment')
   * $.checkout('@v1234')
   */
  checkout(ref: string): Promise<void>

  /**
   * Merge a branch into current
   */
  merge(branch: string): Promise<void>

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Structured logging with automatic history tracking
   */
  log(message: string, data?: unknown): void

  /**
   * Current workflow state
   */
  state: Record<string, unknown>

  // ═══════════════════════════════════════════════════════════════════════════
  // USER CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Current authenticated user context.
   * Extracted from X-User-* headers on each incoming request.
   * Set by the RPC auth middleware before forwarding to the DO.
   *
   * - `null` if the request is unauthenticated (no X-User-ID header)
   * - Contains `id`, optional `email`, and optional `role`
   *
   * @example
   * ```typescript
   * $.on.Customer.created(async (event) => {
   *   if ($.user) {
   *     console.log(`Event triggered by: ${$.user.id}`)
   *   }
   * })
   * ```
   */
  user: UserContext | null
}

// ============================================================================
// ON PROXY - Event subscription via $.on.Noun.verb(handler)
// ============================================================================

/**
 * Event payload map for typed event handling
 *
 * This interface defines the mapping from Noun.verb to payload type.
 * Extend this interface in your domain code to add typed event payloads.
 *
 * @example
 * ```typescript
 * // In your domain types:
 * declare module '../types/WorkflowContext' {
 *   interface EventPayloadMap {
 *     'Customer.created': { id: string; email: string; name: string }
 *     'Order.paid': { orderId: string; amount: number; currency: string }
 *     'Invoice.sent': { invoiceId: string; recipientEmail: string }
 *   }
 * }
 * ```
 */
export interface EventPayloadMap {
  // Default: unknown payload (allows any Noun.verb combination)
  [event: string]: unknown
}

/**
 * Extract the payload type for a given Noun.verb combination
 */
export type EventPayload<
  Noun extends string,
  Verb extends string
> = `${Noun}.${Verb}` extends keyof EventPayloadMap
  ? EventPayloadMap[`${Noun}.${Verb}`]
  : unknown

/**
 * DomainEvent with typed data payload
 *
 * @typeParam TData - The type of the event data payload
 */
export interface DomainEvent<TData = unknown> {
  id: string
  verb: string
  source: string
  data: TData
  actionId?: string
  timestamp: Date
}

/**
 * Typed event handler function
 *
 * @typeParam TPayload - The expected payload type for this event
 */
export type EventHandler<TPayload = unknown> = (event: DomainEvent<TPayload>) => Promise<void> | void

// ============================================================================
// ENHANCED HANDLER OPTIONS AND METADATA
// ============================================================================

/**
 * Filter predicate for conditional event handling
 * Returns true to allow the handler to execute, false to skip
 */
export type EventFilter<TPayload = unknown> = (event: DomainEvent<TPayload>) => boolean | Promise<boolean>

/**
 * Options for enhanced event handler registration
 */
export interface HandlerOptions<TPayload = unknown> {
  /** Priority for execution ordering (higher = runs first, default: 0) */
  priority?: number
  /** Filter predicate for conditional handling */
  filter?: EventFilter<TPayload>
  /** Handler name for debugging and metadata tracking */
  name?: string
  /** Maximum retry attempts when handler fails (for DLQ integration) */
  maxRetries?: number
}

/**
 * Handler registration metadata tracked by the system
 */
export interface HandlerRegistration<TPayload = unknown> {
  /** Handler name (from options or generated) */
  name: string
  /** Handler priority (default: 0) */
  priority: number
  /** Registration timestamp (epoch ms) */
  registeredAt: number
  /** Source DO namespace that registered this handler */
  sourceNs: string
  /** The handler function itself */
  handler: EventHandler<TPayload>
  /** Optional filter predicate */
  filter?: EventFilter<TPayload>
  /** Maximum retries for DLQ (default: 3) */
  maxRetries: number
  /** Last execution timestamp (epoch ms) */
  lastExecutedAt?: number
  /** Total execution count */
  executionCount: number
  /** Successful execution count */
  successCount: number
  /** Failed execution count */
  failureCount: number
}

/**
 * Enhanced dispatch result with additional metadata
 */
export interface EnhancedDispatchResult {
  /** Number of handlers that executed successfully */
  handled: number
  /** Array of errors from failed handlers */
  errors: Error[]
  /** IDs of DLQ entries created for failed handlers */
  dlqEntries: string[]
  /** Number of handlers skipped due to filter predicate */
  filtered: number
  /** Number of wildcard handler matches */
  wildcardMatches: number
}

/**
 * OnNounProxy - Provides typed verb access for a specific noun
 *
 * When EventPayloadMap is extended with typed events, the handler
 * will receive properly typed event payloads.
 *
 * Enhanced to support optional HandlerOptions as second parameter.
 */
export interface OnNounProxy<Noun extends string = string> {
  [verb: string]: (
    handler: EventHandler<EventPayload<Noun, string>>,
    options?: HandlerOptions<EventPayload<Noun, string>>
  ) => void
}

/**
 * Typed OnNounProxy factory that creates verb handlers for a noun
 *
 * This enables type inference: $.on.Customer.created(handler)
 * will infer the handler parameter type from EventPayloadMap['Customer.created']
 *
 * Enhanced to support optional HandlerOptions as second parameter.
 */
export type TypedOnNounProxy<Noun extends string> = {
  [Verb in string]: (
    handler: EventHandler<EventPayload<Noun, Verb>>,
    options?: HandlerOptions<EventPayload<Noun, Verb>>
  ) => void
}

/**
 * OnProxy - Provides typed noun access for event subscriptions
 *
 * Supports wildcard patterns:
 * - $.on['*'].created - all nouns with 'created' verb
 * - $.on.Customer['*'] - all verbs for Customer noun
 * - $.on['*']['*'] - all events (global handler)
 */
export interface OnProxy {
  [Noun: string]: TypedOnNounProxy<typeof Noun>
}

// ============================================================================
// SCHEDULE BUILDER - Fluent scheduling via $.every.*
// ============================================================================

export interface ScheduleBuilder {
  // Days
  Monday: ScheduleTimeProxy
  Tuesday: ScheduleTimeProxy
  Wednesday: ScheduleTimeProxy
  Thursday: ScheduleTimeProxy
  Friday: ScheduleTimeProxy
  Saturday: ScheduleTimeProxy
  Sunday: ScheduleTimeProxy
  day: ScheduleTimeProxy
  weekday: ScheduleTimeProxy
  weekend: ScheduleTimeProxy

  // Intervals
  hour: ScheduleExecutor
  minute: ScheduleExecutor;

  // Natural language
  (schedule: string, handler: ScheduleHandler): void
}

export interface ScheduleTimeProxy {
  // Times
  at6am: ScheduleExecutor
  at7am: ScheduleExecutor
  at8am: ScheduleExecutor
  at9am: ScheduleExecutor
  at10am: ScheduleExecutor
  at11am: ScheduleExecutor
  at12pm: ScheduleExecutor
  at1pm: ScheduleExecutor
  at2pm: ScheduleExecutor
  at3pm: ScheduleExecutor
  at4pm: ScheduleExecutor
  at5pm: ScheduleExecutor
  at6pm: ScheduleExecutor
  atnoon: ScheduleExecutor
  atmidnight: ScheduleExecutor;

  // Direct execution (no time specified)
  (handler: ScheduleHandler): void
}

export type ScheduleExecutor = (handler: ScheduleHandler) => void
export type ScheduleHandler = () => Promise<void>

// ============================================================================
// DOMAIN PROXY - Cross-DO method calls via $.Noun(id).method()
// ============================================================================

export interface DomainProxy {
  [method: string]: (...args: unknown[]) => RpcPromise<unknown>
}

// ============================================================================
// GENERIC FUNCTION SIGNATURE
// ============================================================================

/**
 * Generic function type for all DO methods
 * Function<Output, Input, Options>
 */
export type DOFunction<Output, Input = unknown, Options extends Record<string, unknown> = Record<string, unknown>> = (
  input: Input,
  options?: Options,
) => Promise<Output>

// ============================================================================
// CAPABILITY MODULE TYPES
// ============================================================================

/**
 * Filesystem capability for workflows that need file access
 */
export interface FsCapability {
  readFile(path: string): Promise<string | Buffer>
  writeFile(path: string, content: string | Buffer): Promise<void>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean }): Promise<void>
}

/**
 * Git capability for workflows that need version control
 */
export interface GitCapability {
  status(): Promise<{ branch: string; staged: string[]; unstaged: string[] }>
  add(files: string | string[]): Promise<void>
  commit(message: string): Promise<string | { hash: string }>
  push(remote?: string, branch?: string): Promise<void>
  pull(remote?: string, branch?: string): Promise<void>
  log(options?: { limit?: number }): Promise<Array<{ hash: string; message: string }>>
  diff(ref?: string): Promise<string>
}

/**
 * Result from bash exec command
 */
export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Options for bash exec command
 */
export interface ExecOptions {
  cwd?: string
  timeout?: number
  env?: Record<string, string>
}

/**
 * Bash capability for workflows that need shell access
 */
export interface BashCapability {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>
  spawn(command: string, args?: string[]): unknown
}

/**
 * Error thrown when a capability is not available
 */
export class CapabilityError extends Error {
  constructor(
    public capability: 'fs' | 'git' | 'bash',
    public reason: 'not_available' | 'permission_denied' | 'load_failed',
    message?: string
  ) {
    super(message ?? `Capability '${capability}' is ${reason.replace('_', ' ')}`)
    this.name = 'CapabilityError'
  }
}

// ============================================================================
// TYPE HELPERS FOR COMPOSED CONTEXTS
// ============================================================================

/**
 * WorkflowContext with required filesystem capability
 */
export type WithFs = WorkflowContext & { fs: FsCapability }

/**
 * WorkflowContext with required git capability
 */
export type WithGit = WorkflowContext & { git: GitCapability }

/**
 * WorkflowContext with required bash capability
 */
export type WithBash = WorkflowContext & { bash: BashCapability }

/**
 * WorkflowContext with all capabilities required
 */
export type WithAllCapabilities = WithFs & WithGit & WithBash

// ============================================================================
// TYPE GUARDS FOR CAPABILITY CHECKING
// ============================================================================

/**
 * Check if context has filesystem capability
 */
export function hasFs(ctx: WorkflowContext): ctx is WithFs {
  return ctx != null && typeof (ctx as WithFs).fs === 'object' && (ctx as WithFs).fs !== null
}

/**
 * Check if context has git capability
 */
export function hasGit(ctx: WorkflowContext): ctx is WithGit {
  return ctx != null && typeof (ctx as WithGit).git === 'object' && (ctx as WithGit).git !== null
}

/**
 * Check if context has bash capability
 */
export function hasBash(ctx: WorkflowContext): ctx is WithBash {
  return ctx != null && typeof (ctx as WithBash).bash === 'object' && (ctx as WithBash).bash !== null
}

// ============================================================================
// RATE LIMITING TYPES
// ============================================================================

/**
 * Result from rate limit check/consume operations
 */
export interface RateLimitResult {
  /** Whether the action is allowed */
  success: boolean
  /** Remaining quota in the current window */
  remaining: number
  /** Optional: When the limit resets (epoch ms) */
  resetAt?: number
  /** Optional: Limit that was checked */
  limit?: number
}

/**
 * Options for rate limit check
 */
export interface RateLimitCheckOptions {
  /** Maximum requests allowed in the window */
  limit?: number
  /** Window size in milliseconds */
  windowMs?: number
  /** Cost of this operation (default 1) */
  cost?: number
  /** Named limit to use (e.g., 'api', 'auth') */
  name?: string
}

/**
 * Rate limit capability on WorkflowContext
 */
export interface RateLimitCapability {
  /**
   * Check if an action is rate limited without consuming quota
   * @param key - Unique key for the rate limit (e.g., user ID, IP)
   * @param options - Rate limit configuration
   */
  check(key: string, options?: RateLimitCheckOptions): Promise<RateLimitResult>

  /**
   * Consume rate limit quota
   * @param key - Unique key for the rate limit
   * @param cost - Cost to consume (default 1)
   */
  consume(key: string, cost?: number): Promise<RateLimitResult>

  /**
   * Get current quota status without modifying it
   * @param key - Unique key for the rate limit
   */
  status(key: string): Promise<RateLimitResult>

  /**
   * Reset rate limit for a key
   * @param key - Unique key to reset
   */
  reset(key: string): Promise<void>
}

/**
 * WorkflowContext with rate limiting capability
 */
export type WithRateLimit = WorkflowContext & { rateLimit: RateLimitCapability }

/**
 * Check if context has rate limiting capability
 */
export function hasRateLimit(ctx: WorkflowContext): ctx is WithRateLimit {
  return ctx != null && typeof (ctx as WithRateLimit).rateLimit === 'object' && (ctx as WithRateLimit).rateLimit !== null
}
