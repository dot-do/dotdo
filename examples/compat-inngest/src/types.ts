/**
 * Inngest-Compatible Types for Durable Objects
 *
 * Complete type definitions matching the Inngest SDK API.
 */

// ============================================================================
// EVENTS
// ============================================================================

/**
 * Inngest event structure
 */
export interface InngestEvent<T = unknown> {
  /** Event name (e.g., 'user/signup', 'order/created') */
  name: string
  /** Event payload data */
  data: T
  /** User context */
  user?: Record<string, unknown>
  /** Event timestamp (ms since epoch) */
  ts?: number
  /** Unique event ID */
  id?: string
  /** Event version */
  v?: string
}

/**
 * Payload for sending events
 */
export interface SendEventPayload<T = unknown> {
  name: string
  data: T
  user?: Record<string, unknown>
  ts?: number
  id?: string
  v?: string
}

// ============================================================================
// FUNCTION CONFIGURATION
// ============================================================================

/**
 * Function definition configuration
 */
export interface FunctionConfig {
  /** Unique function ID */
  id: string
  /** Human-readable name */
  name?: string
  /** Retry configuration */
  retries?: number | RetryConfig
  /** Timeout configuration */
  timeouts?: TimeoutConfig
  /** Throttle configuration (rate limiting) */
  throttle?: ThrottleConfig
  /** Rate limit configuration */
  rateLimit?: RateLimitConfig
  /** Debounce configuration */
  debounce?: DebounceConfig
  /** Event batching configuration */
  batchEvents?: BatchConfig
  /** Priority configuration */
  priority?: PriorityConfig
  /** Concurrency limits */
  concurrency?: number | ConcurrencyConfig
  /** Cancel on specific events */
  cancelOn?: CancelOnConfig[]
  /** Idempotency key expression */
  idempotency?: string
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum retry attempts */
  attempts?: number
  /** Backoff strategy */
  backoff?: 'exponential' | 'linear' | 'constant'
  /** Initial retry interval */
  initialInterval?: string | number
  /** Maximum retry interval */
  maxInterval?: string | number
  /** Non-retryable error types */
  nonRetryableErrorTypes?: string[]
}

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  /** Overall function timeout */
  function?: string | number
  /** Per-step timeout */
  step?: string | number
}

/**
 * Throttle configuration (leaky bucket rate limiting)
 */
export interface ThrottleConfig {
  /** Key expression for per-key throttling */
  key?: string
  /** Number of executions allowed per period */
  count: number
  /** Time period for throttle window */
  period: string | number
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Key expression for per-key rate limiting */
  key?: string
  /** Maximum requests per period */
  limit: number
  /** Time period */
  period: string | number
}

/**
 * Debounce configuration
 */
export interface DebounceConfig {
  /** Key expression for per-key debouncing */
  key?: string
  /** Debounce period */
  period: string | number
  /** Maximum time to wait before forcing execution */
  timeout?: string | number
}

/**
 * Batch configuration
 */
export interface BatchConfig {
  /** Maximum batch size */
  maxSize: number
  /** Maximum time to wait for batch to fill */
  timeout: string | number
  /** Key expression for batching */
  key?: string
}

/**
 * Priority configuration
 */
export interface PriorityConfig {
  /** Priority level expression */
  run?: string
}

/**
 * Concurrency configuration
 */
export interface ConcurrencyConfig {
  /** Maximum concurrent executions */
  limit: number
  /** Key expression for per-key concurrency */
  key?: string
  /** Scope of concurrency limit */
  scope?: 'fn' | 'env' | 'account'
}

/**
 * Cancel-on configuration
 */
export interface CancelOnConfig {
  /** Event name that triggers cancellation */
  event: string
  /** Field path to match between trigger and cancel events */
  match?: string
  /** Expression to evaluate for cancellation */
  if?: string
  /** Timeout for listening to cancel events */
  timeout?: string | number
}

// ============================================================================
// TRIGGERS
// ============================================================================

/**
 * Event trigger
 */
export interface EventTrigger {
  event: string
  expression?: string
  if?: string
}

/**
 * Cron trigger
 */
export interface CronTrigger {
  cron: string
}

/**
 * Function trigger (event name, event config, or cron)
 */
export type FunctionTrigger = EventTrigger | CronTrigger | string

// ============================================================================
// STEP TOOLS
// ============================================================================

/**
 * Step execution tools available in function handler
 */
export interface StepTools {
  /**
   * Run a step with automatic memoization and retries
   */
  run: <T>(stepId: string, fn: () => T | Promise<T>) => Promise<T>

  /**
   * Sleep for a duration (durable - survives restarts)
   */
  sleep: (stepId: string, duration: string | number) => Promise<void>

  /**
   * Sleep until a specific timestamp
   */
  sleepUntil: (stepId: string, timestamp: Date | string | number) => Promise<void>

  /**
   * Wait for an event with optional timeout and matching
   */
  waitForEvent: <T = unknown>(
    stepId: string,
    options: WaitForEventOptions
  ) => Promise<InngestEvent<T> | null>

  /**
   * Invoke another function
   */
  invoke: <T = unknown>(
    stepId: string,
    options: InvokeOptions
  ) => Promise<T>

  /**
   * Send events from within a function
   */
  sendEvent: (
    stepId: string,
    event: SendEventPayload | SendEventPayload[]
  ) => Promise<{ ids: string[] }>

  /**
   * Run multiple steps in parallel
   */
  parallel: <T extends readonly unknown[]>(
    stepId: string,
    steps: { [K in keyof T]: () => Promise<T[K]> }
  ) => Promise<T>
}

/**
 * Options for waitForEvent
 */
export interface WaitForEventOptions {
  /** Event name to wait for */
  event: string
  /** Maximum time to wait */
  timeout?: string | number
  /** Field path to match between events */
  match?: string
  /** Expression to evaluate for matching */
  if?: string
}

/**
 * Options for invoke
 */
export interface InvokeOptions {
  /** Function to invoke */
  function: InngestFunctionRef
  /** Data to pass to the function */
  data: unknown
  /** Timeout for the invocation */
  timeout?: string | number
}

/**
 * Reference to an Inngest function (can be ID or function object)
 */
export type InngestFunctionRef = string | { id: string }

// ============================================================================
// FUNCTION CONTEXT
// ============================================================================

/**
 * Context passed to function handlers
 */
export interface FunctionContext<TEvent = unknown> {
  /** The triggering event */
  event: InngestEvent<TEvent>
  /** All events when batching is enabled */
  events: InngestEvent<TEvent>[]
  /** Step execution tools */
  step: StepTools
  /** Unique run ID */
  runId: string
  /** Current attempt number (1-indexed) */
  attempt: number
  /** Logger */
  logger: Logger
}

/**
 * Function handler type
 */
export type FunctionHandler<TEvent, TResult> = (
  ctx: FunctionContext<TEvent>
) => Promise<TResult>

// ============================================================================
// RUN STATE
// ============================================================================

/**
 * Run status
 */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'sleeping'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * Function run state
 */
export interface FunctionRun {
  /** Unique run ID */
  runId: string
  /** Function ID */
  functionId: string
  /** Current status */
  status: RunStatus
  /** Triggering event */
  event: InngestEvent
  /** All events (for batched runs) */
  events?: InngestEvent[]
  /** Start timestamp */
  startedAt: number
  /** Completion timestamp */
  completedAt?: number
  /** Current step being executed */
  currentStep?: string
  /** Error message if failed */
  error?: string
  /** Result if completed */
  result?: unknown
  /** Attempt number */
  attempt: number
  /** Priority level */
  priority?: number
  /** Parent run ID (for invoked functions) */
  parentRunId?: string
}

/**
 * Step execution state
 */
export interface StepState {
  /** Step ID */
  stepId: string
  /** Run ID this step belongs to */
  runId: string
  /** Step status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'sleeping'
  /** Result if completed */
  result?: unknown
  /** Error if failed */
  error?: string
  /** Started timestamp */
  startedAt?: number
  /** Completed timestamp */
  completedAt?: number
  /** Sleep until timestamp */
  sleepUntil?: number
  /** Attempt count */
  attempts: number
}

// ============================================================================
// STORED EVENTS
// ============================================================================

/**
 * Stored event for replay and debugging
 */
export interface StoredEvent extends InngestEvent {
  /** Storage timestamp */
  storedAt: number
  /** Whether event has been processed */
  processed: boolean
  /** Run IDs that processed this event */
  processedBy?: string[]
}

// ============================================================================
// LOGGER
// ============================================================================

/**
 * Logger interface
 */
export interface Logger {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Middleware context
 */
export interface MiddlewareContext {
  event: InngestEvent
  runId: string
  functionId: string
}

/**
 * Middleware lifecycle hooks
 */
export interface MiddlewareLifecycle {
  transformInput?: (ctx: FunctionContext<unknown>) => FunctionContext<unknown> | Promise<FunctionContext<unknown>>
  transformOutput?: (result: unknown) => unknown | Promise<unknown>
  beforeExecution?: () => void | Promise<void>
  afterExecution?: () => void | Promise<void>
  onError?: (error: Error) => void | Promise<void>
}

/**
 * Middleware definition
 */
export interface InngestMiddleware {
  name: string
  init?: () => void | Promise<void>
  onFunctionRun?: (ctx: MiddlewareContext) => MiddlewareLifecycle | Promise<MiddlewareLifecycle>
  onSendEvent?: (events: SendEventPayload[]) => SendEventPayload[] | Promise<SendEventPayload[]>
}

// ============================================================================
// ENVIRONMENT
// ============================================================================

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  INNGEST_DO: DurableObjectNamespace
  EVENT_DO: DurableObjectNamespace
  STEP_DO: DurableObjectNamespace
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse duration string to milliseconds
 */
export function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration

  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseFloat(match[1])
  const unit = match[2]

  switch (unit) {
    case 'ms': return value
    case 's': return value * 1000
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    case 'w': return value * 7 * 24 * 60 * 60 * 1000
    default: throw new Error(`Unknown duration unit: ${unit}`)
  }
}

/**
 * Generate unique IDs
 */
export function generateRunId(): string {
  return `run_${crypto.randomUUID().replace(/-/g, '')}`
}

export function generateEventId(): string {
  return `evt_${crypto.randomUUID().replace(/-/g, '')}`
}

export function generateStepId(): string {
  return `step_${crypto.randomUUID().replace(/-/g, '')}`
}

/**
 * Ensure value is an Error object
 */
export function ensureError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  return new Error(String(value))
}

/**
 * Get value from object using dot notation path
 */
export function getValueByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}
