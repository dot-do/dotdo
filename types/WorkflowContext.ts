import type { RpcPromise } from 'capnweb'
import type { Thing } from './Thing'

// ============================================================================
// WORKFLOW CONTEXT ($) - The unified interface for all DO operations
// ============================================================================

export interface WorkflowContext {
  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION MODES (different durability levels)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fire-and-forget event emission
   * Non-blocking, non-durable, best-effort
   */
  send(event: string, data: unknown): void

  /**
   * Quick attempt without durability
   * Blocking, non-durable
   */
  try<T>(action: string, data: unknown): Promise<T>

  /**
   * Durable execution with retries
   * Blocking, durable, guaranteed event emission
   */
  do<T>(action: string, data: unknown): Promise<T>

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
  // DOMAIN RESOLUTION (cross-DO)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve and call methods on other DOs
   * $.Startup('acme').prioritize()
   * $.Invoice(id).send()
   */
  [Noun: string]: ((id: string) => DomainProxy) | unknown

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
}

// ============================================================================
// ON PROXY - Event subscription via $.on.Noun.verb(handler)
// ============================================================================

export interface OnProxy {
  [Noun: string]: OnNounProxy
}

export interface OnNounProxy {
  [verb: string]: (handler: EventHandler) => void
}

export type EventHandler = (event: DomainEvent) => Promise<void>

export interface DomainEvent {
  id: string
  verb: string // 'created', 'updated', 'paid'
  source: string // URL of source entity
  data: unknown
  actionId?: string
  timestamp: Date
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
