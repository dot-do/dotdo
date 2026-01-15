/**
 * @module workflow/workflow-context
 *
 * WorkflowContext ($) - The unified interface for DO operations
 *
 * Implements:
 * 1. Event Handlers ($.on) - $.on.Noun.verb(handler), wildcards
 * 2. Scheduling DSL ($.every) - $.every.Monday.at9am(), $.every.day.at('6pm')()
 * 3. Durable Execution - $.do(action), $.try(action), $.send(event)
 * 4. Cross-DO RPC - $.Customer(id).method()
 * 5. Cascade Execution - code -> generative -> agentic -> human tiers
 */

// Import canonical types from types/index.ts
import type {
  Event,
  EventHandler,
  CircuitBreakerContextConfig,
  CreateContextOptions,
  SendErrorInfo,
  CascadeOptions,
  CascadeResult,
  CascadeTimeoutResult,
  CascadeTierTimeout,
  CascadeCircuitBreakerConfig,
  GracefulDegradationOptions,
} from '../types'

// Re-export types for backwards compatibility
export type {
  Event,
  CircuitBreakerContextConfig,
  CreateContextOptions,
  SendErrorInfo,
  CascadeOptions,
  CascadeResult,
  CascadeTimeoutResult,
  CascadeTierTimeout,
  CascadeCircuitBreakerConfig,
  GracefulDegradationOptions,
}

// ============================================================================
// CONSTANTS - Retry & Timeout Configuration
// ============================================================================

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RPC_TIMEOUT_MS = 30000
const MAX_BACKOFF_MS = 10000
const EXPONENTIAL_BACKOFF_BASE = 2
const DEFAULT_CASCADE_TIER_TIMEOUT_MS = 30000
const DEFAULT_CASCADE_FAILURE_THRESHOLD = 5
const DEFAULT_CASCADE_RESET_TIMEOUT_MS = 60000

// ============================================================================
// CASCADE TIMEOUT HELPER
// ============================================================================

/**
 * Execute a promise with timeout tracking
 *
 * Returns metadata about the execution including:
 * - result: The resolved value (if successful)
 * - timedOut: Whether the operation timed out
 * - duration: How long the operation took (in ms)
 *
 * @param promise - The promise to execute
 * @param ms - Timeout in milliseconds
 * @param fallback - Optional fallback value to return on timeout
 */
async function withCascadeTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback?: T
): Promise<CascadeTimeoutResult<T>> {
  const start = Date.now()

  type SuccessResult = { value: T; timedOut: false }
  type TimeoutResult = { timedOut: true }

  const timeoutPromise = new Promise<TimeoutResult>((resolve) =>
    setTimeout(() => resolve({ timedOut: true }), ms)
  )

  try {
    const result: SuccessResult | TimeoutResult = await Promise.race([
      promise.then((value): SuccessResult => ({ value, timedOut: false })),
      timeoutPromise,
    ])

    const duration = Date.now() - start

    if (result.timedOut === true) {
      return {
        result: fallback,
        timedOut: true,
        duration,
      }
    }

    return {
      result: result.value,
      timedOut: false,
      duration,
    }
  } catch (error) {
    // Re-throw non-timeout errors
    throw error
  }
}

// ============================================================================
// CASCADE TIER CIRCUIT BREAKER
// ============================================================================

type CascadeTierName = 'code' | 'generative' | 'agentic' | 'human'
type CascadeCircuitState = 'closed' | 'open' | 'half-open'

interface CascadeTierCircuitState {
  state: CascadeCircuitState
  failures: number
  lastFailure: number | null
  lastSuccess: number | null
  openedAt: number | null
}

/**
 * Circuit breaker for cascade tier execution
 *
 * Maintains circuit breaker state per tier to prevent cascading failures:
 * - Opens circuit after consecutive failures
 * - Allows probe requests in half-open state
 * - Resets to closed on successful probe
 */
class CascadeTierCircuitBreaker {
  private circuits: Map<CascadeTierName, CascadeTierCircuitState> = new Map()
  private failureThreshold: number
  private resetTimeout: number
  private fallback?: unknown

  constructor(config?: CascadeCircuitBreakerConfig) {
    this.failureThreshold = config?.failureThreshold ?? DEFAULT_CASCADE_FAILURE_THRESHOLD
    this.resetTimeout = config?.resetTimeout ?? DEFAULT_CASCADE_RESET_TIMEOUT_MS
    this.fallback = config?.fallback
  }

  /**
   * Get or create circuit state for a tier
   */
  private getCircuitState(tier: CascadeTierName): CascadeTierCircuitState {
    if (!this.circuits.has(tier)) {
      this.circuits.set(tier, {
        state: 'closed',
        failures: 0,
        lastFailure: null,
        lastSuccess: null,
        openedAt: null,
      })
    }
    return this.circuits.get(tier)!
  }

  /**
   * Check if a tier circuit allows execution
   */
  canExecute(tier: CascadeTierName): boolean {
    const circuit = this.getCircuitState(tier)
    this.checkStateTransition(tier, circuit)

    if (circuit.state === 'open') {
      return false
    }

    return true
  }

  /**
   * Get the current state of a tier's circuit
   */
  getState(tier: CascadeTierName): CascadeCircuitState {
    const circuit = this.getCircuitState(tier)
    this.checkStateTransition(tier, circuit)
    return circuit.state
  }

  /**
   * Get all circuit states
   */
  getAllStates(): Record<string, CascadeCircuitState> {
    const states: Record<string, CascadeCircuitState> = {}
    for (const tier of ['code', 'generative', 'agentic', 'human'] as const) {
      if (this.circuits.has(tier)) {
        states[tier] = this.getState(tier)
      }
    }
    return states
  }

  /**
   * Record a successful execution for a tier
   */
  recordSuccess(tier: CascadeTierName): void {
    const circuit = this.getCircuitState(tier)
    circuit.failures = 0
    circuit.lastSuccess = Date.now()

    if (circuit.state === 'half-open') {
      circuit.state = 'closed'
      circuit.openedAt = null
    }
  }

  /**
   * Record a failed execution for a tier
   */
  recordFailure(tier: CascadeTierName): void {
    const circuit = this.getCircuitState(tier)
    circuit.failures++
    circuit.lastFailure = Date.now()

    if (circuit.state === 'half-open') {
      // Failed probe - back to open
      circuit.state = 'open'
      circuit.openedAt = Date.now()
      return
    }

    if (circuit.failures >= this.failureThreshold) {
      circuit.state = 'open'
      circuit.openedAt = Date.now()
    }
  }

  /**
   * Get fallback value if configured
   */
  getFallback(): unknown | undefined {
    return this.fallback
  }

  /**
   * Check and perform state transitions
   */
  private checkStateTransition(tier: CascadeTierName, circuit: CascadeTierCircuitState): void {
    if (circuit.state === 'open' && circuit.openedAt !== null) {
      const elapsed = Date.now() - circuit.openedAt
      if (elapsed >= this.resetTimeout) {
        circuit.state = 'half-open'
      }
    }
  }

  /**
   * Reset a tier's circuit breaker
   */
  reset(tier: CascadeTierName): void {
    this.circuits.set(tier, {
      state: 'closed',
      failures: 0,
      lastFailure: null,
      lastSuccess: null,
      openedAt: null,
    })
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.circuits.clear()
  }
}

// EventHandler imported from ../types

interface ScheduleEntry {
  handler: Function
  cron: string
}

interface OneTimeScheduleEntry {
  handler: Function
  date: string
}

interface ActionLogEntry {
  stepId: string
  status: 'pending' | 'completed' | 'failed'
  result?: unknown
  error?: { message: string }
}

interface EventLogEntry {
  id: string
  type: string
  data: unknown
  timestamp: Date
}

type ErrorCallback = (errorInfo: SendErrorInfo) => void

class CascadeError extends Error {
  tierErrors: Record<string, Error>

  constructor(message: string, tierErrors: Record<string, Error>) {
    super(message)
    this.name = 'CascadeError'
    this.tierErrors = tierErrors
  }
}

// ============================================================================
// DAY MAPPING
// ============================================================================

const DAY_MAP: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
}

// ============================================================================
// TIME PARSING
// ============================================================================

function parseTime(time: string): { hour: number; minute: number } {
  // Named times
  if (time === 'noon') return { hour: 12, minute: 0 }
  if (time === 'midnight') return { hour: 0, minute: 0 }

  // Parse time like "9am", "5pm", "9:30am", "6:45pm"
  const match = time.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i)
  if (!match) {
    throw new Error(`Invalid time format: ${time}`)
  }

  let hour = parseInt(match[1], 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const period = match[3]?.toLowerCase()

  if (period === 'pm' && hour < 12) {
    hour += 12
  } else if (period === 'am' && hour === 12) {
    hour = 0
  }

  return { hour, minute }
}

// ============================================================================
// GENERATE UNIQUE IDS
// ============================================================================

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// ============================================================================
// WORKFLOW CONTEXT IMPLEMENTATION
// ============================================================================

// ============================================================================
// SIMPLE CIRCUIT BREAKER FOR WORKFLOW CONTEXT
// ============================================================================

type SimpleCircuitState = 'closed' | 'open' | 'half-open'

class SimpleCircuitBreaker {
  private state: SimpleCircuitState = 'closed'
  private consecutiveFailures = 0
  private failureThreshold: number
  private resetTimeout: number
  private openedAt: number | null = null

  constructor(config: { failureThreshold: number; resetTimeout: number }) {
    this.failureThreshold = config.failureThreshold
    this.resetTimeout = config.resetTimeout
  }

  getState(): SimpleCircuitState {
    this.checkStateTransition()
    return this.state
  }

  private checkStateTransition(): void {
    if (this.state === 'open' && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt
      if (elapsed >= this.resetTimeout) {
        this.state = 'half-open'
      }
    }
  }

  async execute<T>(fn: () => T | Promise<T>): Promise<T> {
    this.checkStateTransition()

    if (this.state === 'open') {
      throw new Error('Circuit is open')
    }

    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (error) {
      this.recordFailure()
      throw error
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0
    if (this.state === 'half-open') {
      this.state = 'closed'
      this.openedAt = null
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++

    if (this.state === 'half-open') {
      this.state = 'open'
      this.openedAt = Date.now()
      return
    }

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open'
      this.openedAt = Date.now()
    }
  }
}

// ============================================================================
// WORKFLOW CONTEXT IMPLEMENTATION
// ============================================================================

class WorkflowContextImpl {
  private handlers: Map<string, EventHandler[]> = new Map()
  private schedules: Map<string, ScheduleEntry> = new Map()
  private oneTimeSchedules: Map<string, OneTimeScheduleEntry> = new Map()
  private actionLog: ActionLogEntry[] = []
  private eventLog: EventLogEntry[] = []
  private errorLog: SendErrorInfo[] = []
  private errorCallbacks: ErrorCallback[] = []
  private stubResolver?: (noun: string, id: string) => Record<string, Function>
  private rpcTimeout: number
  private circuitBreakerConfig?: CircuitBreakerContextConfig
  private circuitBreakers: Map<string, SimpleCircuitBreaker> = new Map()
  private cascadeCircuitBreakers: Map<string, CascadeTierCircuitBreaker> = new Map()

  constructor(options?: CreateContextOptions) {
    this.stubResolver = options?.stubResolver
    this.rpcTimeout = options?.rpcTimeout ?? DEFAULT_RPC_TIMEOUT_MS
    this.circuitBreakerConfig = options?.circuitBreaker
  }

  /**
   * Get or create a cascade circuit breaker for a specific task/context
   */
  getCascadeCircuitBreaker(taskId: string, config?: CascadeCircuitBreakerConfig): CascadeTierCircuitBreaker {
    if (!this.cascadeCircuitBreakers.has(taskId)) {
      this.cascadeCircuitBreakers.set(taskId, new CascadeTierCircuitBreaker(config))
    }
    return this.cascadeCircuitBreakers.get(taskId)!
  }

  getCircuitBreaker(id: string): SimpleCircuitBreaker {
    if (!this.circuitBreakerConfig) {
      throw new Error('Circuit breaker not configured')
    }

    if (!this.circuitBreakers.has(id)) {
      this.circuitBreakers.set(
        id,
        new SimpleCircuitBreaker({
          failureThreshold: this.circuitBreakerConfig.failureThreshold,
          resetTimeout: this.circuitBreakerConfig.resetTimeout,
        })
      )
    }

    return this.circuitBreakers.get(id)!
  }

  // ==========================================================================
  // EVENT HANDLERS ($.on)
  // ==========================================================================

  /**
   * Register event handlers with pattern matching
   *
   * Usage:
   *   $.on.Customer.signup(handler)  // Exact match
   *   $.on['*'].created(handler)     // Wildcard noun match
   *   $.on.Customer['*'](handler)    // Wildcard verb match
   *   $.on['*']['*'](handler)        // All events
   *
   * @returns unsubscribe function to remove the handler
   */
  get on(): Record<string, Record<string, (handler: EventHandler) => () => void>> {
    return new Proxy(
      {},
      {
        get: (_target, noun: string) => {
          return new Proxy(
            {},
            {
              get: (_t, verb: string) => {
                return (handler: EventHandler): (() => void) => {
                  const key = `${noun}.${verb}`
                  const handlers = this.handlers.get(key) ?? []
                  handlers.push(handler)
                  this.handlers.set(key, handlers)

                  // Return unsubscribe function
                  return () => {
                    const current = this.handlers.get(key) ?? []
                    const idx = current.indexOf(handler)
                    if (idx >= 0) {
                      current.splice(idx, 1)
                      this.handlers.set(key, current)
                    }
                  }
                }
              },
            }
          )
        },
      }
    )
  }

  getRegisteredHandlers(eventKey: string): Function[] {
    return this.handlers.get(eventKey) ?? []
  }

  matchHandlers(eventKey: string): Function[] {
    const [noun, verb] = eventKey.split('.')
    const matched: Function[] = []

    // Exact match
    const exactHandlers = this.handlers.get(eventKey) ?? []
    matched.push(...exactHandlers)

    // Wildcard noun match: *.verb
    const wildcardNounHandlers = this.handlers.get(`*.${verb}`) ?? []
    matched.push(...wildcardNounHandlers)

    // Wildcard verb match: Noun.*
    const wildcardVerbHandlers = this.handlers.get(`${noun}.*`) ?? []
    matched.push(...wildcardVerbHandlers)

    // Global wildcard: *.*
    const globalWildcardHandlers = this.handlers.get('*.*') ?? []
    matched.push(...globalWildcardHandlers)

    return matched
  }

  async dispatch(eventKey: string, data: unknown): Promise<void> {
    const [subject, object] = eventKey.split('.')
    const event: Event = {
      id: generateEventId(),
      type: eventKey,
      subject,
      object,
      data,
      timestamp: new Date(),
    }

    const handlers = this.matchHandlers(eventKey)

    for (const handler of handlers) {
      await handler(event)
    }
  }

  // ==========================================================================
  // SCHEDULING DSL ($.every)
  // ==========================================================================

  /**
   * Schedule periodic and one-time task execution
   *
   * Usage:
   *   $.every.Monday.at9am(handler)      // Weekly schedule with time shortcut
   *   $.every.day.at('6:30pm')(handler)  // Daily at specific time
   *   $.every.hour(handler)              // Hourly
   *   $.every(5).minutes(handler)        // Every N units
   *   $.at('2024-12-25T00:00:00Z')(h)    // One-time execution
   *
   * @returns schedule builder with day/time properties and interval functions
   */
  get every(): ScheduleBuilder & ((n: number) => IntervalBuilder) {
    const self = this

    function createTimeBuilder(dayOfWeek: string | null): TimeBuilder {
      const dow = dayOfWeek ? DAY_MAP[dayOfWeek] : '*'

      // Pre-defined time shortcuts
      const shortcuts: Record<string, { hour: number; minute: number }> = {
        at9am: { hour: 9, minute: 0 },
        at5pm: { hour: 17, minute: 0 },
        at6am: { hour: 6, minute: 0 },
      }

      return new Proxy(
        {},
        {
          get: (_target, prop: string) => {
            if (prop === 'at') {
              return (time: string) => {
                return (handler: Function): (() => void) => {
                  const { hour, minute } = parseTime(time)
                  return self.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
                }
              }
            }

            if (shortcuts[prop]) {
              return (handler: Function): (() => void) => {
                const { hour, minute } = shortcuts[prop]
                return self.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
              }
            }

            return undefined
          },
        }
      ) as TimeBuilder
    }

    const scheduleBuilder: ScheduleBuilder = {
      Monday: createTimeBuilder('Monday'),
      Tuesday: createTimeBuilder('Tuesday'),
      Wednesday: createTimeBuilder('Wednesday'),
      Thursday: createTimeBuilder('Thursday'),
      Friday: createTimeBuilder('Friday'),
      Saturday: createTimeBuilder('Saturday'),
      Sunday: createTimeBuilder('Sunday'),
      day: createTimeBuilder(null),
      hour: (handler: Function): (() => void) => self.registerSchedule('0 * * * *', handler),
      minute: (handler: Function): (() => void) => self.registerSchedule('* * * * *', handler),
    }

    // Make it callable for $.every(n)
    const everyFn = (n: number): IntervalBuilder => {
      return {
        minutes: (handler: Function): (() => void) => self.registerSchedule(`*/${n} * * * *`, handler),
        hours: (handler: Function): (() => void) => self.registerSchedule(`0 */${n} * * *`, handler),
        seconds: (handler: Function): (() => void) => self.registerSchedule(`every:${n}s`, handler),
      }
    }

    // Combine function with schedule builder properties
    return Object.assign(everyFn, scheduleBuilder) as ScheduleBuilder & ((n: number) => IntervalBuilder)
  }

  /**
   * Helper to register a schedule and return unsubscribe function
   */
  private registerSchedule(cron: string, handler: Function): () => void {
    this.schedules.set(cron, { handler, cron })
    return () => {
      this.schedules.delete(cron)
    }
  }

  at(date: string | Date): (handler: Function) => () => void {
    const self = this
    return (handler: Function): (() => void) => {
      const isoDate = date instanceof Date ? date.toISOString() : date
      self.oneTimeSchedules.set(isoDate, { handler, date: isoDate })
      return () => {
        self.oneTimeSchedules.delete(isoDate)
      }
    }
  }

  getSchedule(cron: string): { handler: Function } | undefined {
    return this.schedules.get(cron)
  }

  getOneTimeSchedule(date: string): { handler: Function } | undefined {
    return this.oneTimeSchedules.get(date)
  }

  // ==========================================================================
  // ERROR HANDLING (for fire-and-forget)
  // ==========================================================================

  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.push(callback)
    return () => {
      const idx = this.errorCallbacks.indexOf(callback)
      if (idx >= 0) {
        this.errorCallbacks.splice(idx, 1)
      }
    }
  }

  getErrorCount(): number {
    return this.errorLog.length
  }

  getErrorLog(): SendErrorInfo[] {
    return [...this.errorLog]
  }

  private handleSendError(error: Error, eventType: string, eventId: string, data: unknown): void {
    const errorInfo: SendErrorInfo = {
      error,
      eventType,
      eventId,
      timestamp: new Date(),
      data,
    }

    // Log the error
    this.errorLog.push(errorInfo)

    // Invoke all registered error callbacks
    for (const callback of this.errorCallbacks) {
      try {
        callback(errorInfo)
      } catch {
        // Swallow callback errors to prevent cascade
      }
    }
  }

  // ==========================================================================
  // DURABLE EXECUTION ($.send, $.try, $.do)
  // ==========================================================================

  /**
   * Fire-and-forget event emission
   *
   * - Dispatches event to all matching handlers
   * - Returns immediately with event ID (no waiting)
   * - Handlers execute asynchronously
   * - Errors in handlers are logged but don't propagate
   * - Does not retry
   *
   * @param eventType - Event type (e.g., "Customer.signup")
   * @param data - Event payload
   * @returns event ID for tracking
   */
  send(eventType: string, data: unknown): string {
    const eventId = generateEventId()
    const event: EventLogEntry = {
      id: eventId,
      type: eventType,
      data,
      timestamp: new Date(),
    }
    this.eventLog.push(event)

    // Fire-and-forget dispatch with per-handler error capture (don't await, don't throw)
    Promise.resolve().then(async () => {
      const [subject, object] = eventType.split('.')
      const eventData: Event = {
        id: eventId,
        type: eventType,
        subject,
        object,
        data,
        timestamp: new Date(),
      }

      const handlers = this.matchHandlers(eventType)

      // Execute all handlers, capturing errors from each individually
      for (const handler of handlers) {
        try {
          await handler(eventData)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          this.handleSendError(error, eventType, eventId, data)
        }
      }
    })

    return eventId
  }

  /**
   * Single-attempt action execution
   *
   * - Executes action once
   * - No retries on failure
   * - Does not persist to action log
   * - Useful for non-critical, fast operations
   * - Supports optional timeout
   *
   * @param action - The function to execute
   * @param options - { timeout?: milliseconds }
   * @returns action result
   */
  async try<T>(action: () => T | Promise<T>, options?: { timeout?: number }): Promise<T> {
    if (options?.timeout) {
      return Promise.race([
        Promise.resolve(action()),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), options.timeout)),
      ])
    }
    return action()
  }

  /**
   * Execute action with durable semantics
   * - Retries with exponential backoff on failure
   * - Replays from log on restart (idempotent by stepId)
   * - Records all attempts and final result
   * - Supports circuit breaker protection
   *
   * @param action - The function to execute
   * @param options - { stepId, maxRetries, circuitBreakerId }
   */
  async do<T>(
    action: () => T | Promise<T>,
    options?: { stepId?: string; maxRetries?: number; circuitBreakerId?: string }
  ): Promise<T> {
    const stepId = options?.stepId ?? generateEventId()
    const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES

    // Check for existing completed entry (replay semantics)
    const existingEntry = this.actionLog.find((e) => e.stepId === stepId && e.status === 'completed')
    if (existingEntry) {
      return existingEntry.result as T
    }

    // If circuit breaker is configured and an ID is provided, use circuit breaker
    if (this.circuitBreakerConfig && options?.circuitBreakerId) {
      const breaker = this.getCircuitBreaker(options.circuitBreakerId)

      // With circuit breaker, we try each attempt through the breaker
      let lastError: Error | undefined
      let attempts = 0

      while (attempts < maxRetries) {
        attempts++
        try {
          const result = await breaker.execute(action)
          this.recordActionSuccess(stepId, result)
          return result
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))

          // If circuit is open, fail immediately
          if (lastError.message === 'Circuit is open') {
            this.recordActionFailure(stepId, lastError)
            throw lastError
          }

          // If not last attempt, wait with exponential backoff
          if (attempts < maxRetries) {
            const backoffMs = this.calculateBackoff(attempts)
            await new Promise((r) => setTimeout(r, backoffMs))
          }
        }
      }

      // Record failure and throw
      this.recordActionFailure(stepId, lastError!)
      throw lastError
    }

    // Standard execution without circuit breaker
    let lastError: Error | undefined
    let attempts = 0

    while (attempts < maxRetries) {
      attempts++
      try {
        const result = await action()
        this.recordActionSuccess(stepId, result)
        return result
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // If not last attempt, wait with exponential backoff
        if (attempts < maxRetries) {
          const backoffMs = this.calculateBackoff(attempts)
          await new Promise((r) => setTimeout(r, backoffMs))
        }
      }
    }

    // Record failure and throw
    this.recordActionFailure(stepId, lastError!)
    throw lastError
  }

  /**
   * Calculate exponential backoff with maximum cap
   */
  private calculateBackoff(attemptNumber: number): number {
    const baseBackoff = 1000 * Math.pow(EXPONENTIAL_BACKOFF_BASE, attemptNumber - 1)
    return Math.min(baseBackoff, MAX_BACKOFF_MS)
  }

  /**
   * Record successful action completion
   */
  private recordActionSuccess<T>(stepId: string, result: T): void {
    const logEntry: ActionLogEntry = {
      stepId,
      status: 'completed',
      result,
    }

    const existingIdx = this.actionLog.findIndex((e) => e.stepId === stepId)
    if (existingIdx >= 0) {
      this.actionLog[existingIdx] = logEntry
    } else {
      this.actionLog.push(logEntry)
    }
  }

  /**
   * Record action failure
   */
  private recordActionFailure(stepId: string, error: Error): void {
    const failureEntry: ActionLogEntry = {
      stepId,
      status: 'failed',
      error: { message: error.message },
    }

    const existingIdx = this.actionLog.findIndex((e) => e.stepId === stepId)
    if (existingIdx >= 0) {
      this.actionLog[existingIdx] = failureEntry
    } else {
      this.actionLog.push(failureEntry)
    }
  }

  track(_event: string, _data: unknown): void {
    // Fire-and-forget telemetry - no persistence, no return value
    // Intentionally does nothing to action log
  }

  getActionLog(): ActionLogEntry[] {
    return this.actionLog
  }

  getEventLog(): EventLogEntry[] {
    return this.eventLog
  }

  // ==========================================================================
  // CASCADE EXECUTION
  // ==========================================================================

  async cascade(options: CascadeOptions): Promise<CascadeResult> {
    const {
      task,
      tiers,
      confidenceThreshold = 0.8,
      skipAutomation = false,
      timeout,
      tierTimeouts,
      circuitBreaker: circuitBreakerConfig,
      gracefulDegradation,
    } = options

    const tierOrder: Array<'code' | 'generative' | 'agentic' | 'human'> = skipAutomation
      ? ['human']
      : ['code', 'generative', 'agentic', 'human']

    const executionPath: string[] = []
    const confidenceScores: Record<string, number> = {}
    const timing: Record<string, number> = {}
    const tierErrors: Record<string, Error> = {}
    const completedTiers: string[] = []
    const failedTiers: string[] = []
    let attempts = 0
    let anyTimedOut = false
    let bestPartialResult: unknown = undefined
    let bestPartialTier: string | undefined = undefined
    let bestPartialConfidence = 0

    // Get or create circuit breaker for this cascade task if configured
    const circuitBreaker = circuitBreakerConfig
      ? this.getCascadeCircuitBreaker(task, circuitBreakerConfig)
      : null

    // Helper to build tier error messages for result
    const buildTierErrorMessages = (): Record<string, string> => {
      const messages: Record<string, string> = {}
      for (const [tierName, error] of Object.entries(tierErrors)) {
        messages[tierName] = error.message
      }
      return messages
    }

    // Helper to build a successful result with graceful degradation fields
    const buildSuccessResult = (
      value: unknown,
      tierName: 'code' | 'generative' | 'agentic' | 'human',
      confidence: number,
      result: unknown
    ): CascadeResult => {
      const cascadeResult: CascadeResult = {
        value,
        tier: tierName,
        confidence,
        executionPath,
        attempts,
        timing,
        confidenceScores,
        timedOut: anyTimedOut,
        degraded: false,
        completedTiers,
        failedTiers,
      }

      // Include tier errors if any tiers failed before success
      if (failedTiers.length > 0) {
        cascadeResult.tierErrors = buildTierErrorMessages()
      }

      // Include circuit states if circuit breaker is active
      if (circuitBreaker) {
        cascadeResult.circuitStates = circuitBreaker.getAllStates()
      }

      // Include queueEntry if present (for human tier)
      if (typeof result === 'object' && result !== null && 'queueEntry' in result) {
        cascadeResult.queueEntry = (result as { queueEntry: unknown }).queueEntry
      }

      return cascadeResult
    }

    // Helper to build a degraded result
    const buildDegradedResult = (): CascadeResult => {
      // Determine what value to return in degraded mode
      let degradedValue: unknown = undefined
      let degradedTier: 'code' | 'generative' | 'agentic' | 'human' = 'code'

      // Priority: fallbackValue > partialResult from best tier > undefined
      if (gracefulDegradation?.fallbackValue !== undefined) {
        degradedValue = gracefulDegradation.fallbackValue
      } else if (bestPartialResult !== undefined) {
        degradedValue = bestPartialResult
        degradedTier = bestPartialTier as 'code' | 'generative' | 'agentic' | 'human'
      }

      return {
        value: degradedValue,
        tier: degradedTier,
        confidence: bestPartialConfidence,
        executionPath,
        attempts,
        timing,
        confidenceScores,
        timedOut: anyTimedOut,
        degraded: true,
        completedTiers,
        failedTiers,
        partialResult: bestPartialResult,
        tierErrors: buildTierErrorMessages(),
        circuitStates: circuitBreaker?.getAllStates(),
      }
    }

    for (const tierName of tierOrder) {
      const tierHandler = tiers[tierName]
      if (!tierHandler) continue

      // Check circuit breaker state before attempting tier
      if (circuitBreaker && !circuitBreaker.canExecute(tierName)) {
        // Circuit is open - skip this tier and record in errors
        const circuitState = circuitBreaker.getState(tierName)
        tierErrors[tierName] = new Error(`Circuit breaker ${circuitState} for tier ${tierName}`)
        failedTiers.push(tierName)
        timing[tierName] = 0

        // If there's a fallback configured, we can use it
        const fallback = circuitBreaker.getFallback()
        if (fallback !== undefined && tierName === 'human') {
          // Only use fallback for human tier as last resort
          return {
            value: fallback,
            tier: tierName,
            confidence: 0,
            executionPath: [...executionPath, tierName],
            attempts: attempts + 1,
            timing,
            confidenceScores,
            circuitStates: circuitBreaker.getAllStates(),
            degraded: true,
            completedTiers,
            failedTiers,
            tierErrors: buildTierErrorMessages(),
          }
        }

        // Continue to next tier
        continue
      }

      attempts++
      executionPath.push(tierName)

      const startTime = performance.now()

      // Determine timeout for this tier (per-tier takes precedence over global)
      const tierTimeout = tierTimeouts?.[tierName] ?? timeout ?? DEFAULT_CASCADE_TIER_TIMEOUT_MS

      try {
        // Execute with timeout tracking
        const timeoutResult = await withCascadeTimeout(
          Promise.resolve(tierHandler()),
          tierTimeout
        )

        // Use Math.max to ensure at least 0.001ms is recorded for synchronous operations
        timing[tierName] = Math.max(timeoutResult.duration, 0.001)

        if (timeoutResult.timedOut) {
          anyTimedOut = true
          failedTiers.push(tierName)

          // Record timeout as failure in circuit breaker
          if (circuitBreaker) {
            circuitBreaker.recordFailure(tierName)
          }

          // For global timeout, throw immediately (unless graceful degradation with returnPartialOnTimeout)
          if (timeout && !tierTimeouts) {
            if (gracefulDegradation?.enabled && gracefulDegradation.returnPartialOnTimeout) {
              tierErrors[tierName] = new Error(`Global timeout after ${timeout}ms`)
              // Continue to return degraded result
              break
            }
            throw new Error('Timeout')
          }

          // For per-tier timeout, record error and continue to next tier
          tierErrors[tierName] = new Error(`Tier ${tierName} timed out after ${tierTimeout}ms`)
          continue
        }

        const result = timeoutResult.result
        completedTiers.push(tierName)

        // Record success in circuit breaker
        if (circuitBreaker) {
          circuitBreaker.recordSuccess(tierName)
        }

        // Extract confidence and value
        const confidence =
          typeof result === 'object' && result !== null && 'confidence' in result
            ? (result as { confidence: number }).confidence
            : 1.0

        confidenceScores[tierName] = confidence

        const value =
          typeof result === 'object' && result !== null && 'value' in result
            ? (result as { value: unknown }).value
            : result

        // Track best partial result (for graceful degradation)
        if (confidence > bestPartialConfidence) {
          bestPartialResult = value
          bestPartialTier = tierName
          bestPartialConfidence = confidence
        }

        // Check if this tier meets the threshold
        if (confidence >= confidenceThreshold) {
          return buildSuccessResult(value, tierName, confidence, result)
        }

        // Confidence too low, continue to next tier
      } catch (err) {
        timing[tierName] = Math.max(performance.now() - startTime, 0.001)
        const error = err instanceof Error ? err : new Error(String(err))
        tierErrors[tierName] = error
        failedTiers.push(tierName)

        // Record failure in circuit breaker
        if (circuitBreaker) {
          circuitBreaker.recordFailure(tierName)
        }

        // If it's a timeout error from global timeout, handle based on degradation settings
        if (error.message === 'Timeout') {
          if (gracefulDegradation?.enabled && gracefulDegradation.returnPartialOnTimeout) {
            // Return degraded result instead of throwing
            break
          }
          throw error
        }

        // For other errors, check if we should return partial on error
        if (gracefulDegradation?.enabled && gracefulDegradation.returnPartialOnError && bestPartialResult !== undefined) {
          // We have a partial result, we could continue or return it
          // Continue to try remaining tiers for now
        }
        // Continue to next tier on other errors
      }
    }

    // All tiers failed or didn't meet confidence
    // Check if graceful degradation is enabled
    if (gracefulDegradation?.enabled) {
      // Return degraded result instead of throwing
      return buildDegradedResult()
    }

    throw new CascadeError(`All tiers failed for task: ${task}`, tierErrors)
  }
}

// ============================================================================
// TYPE DEFINITIONS FOR DSL
// ============================================================================

interface TimeBuilder {
  at9am: (handler: Function) => () => void
  at5pm: (handler: Function) => () => void
  at6am: (handler: Function) => () => void
  at: (time: string) => (handler: Function) => () => void
}

interface ScheduleBuilder {
  Monday: TimeBuilder
  Tuesday: TimeBuilder
  Wednesday: TimeBuilder
  Thursday: TimeBuilder
  Friday: TimeBuilder
  Saturday: TimeBuilder
  Sunday: TimeBuilder
  day: TimeBuilder
  hour: (handler: Function) => () => void
  minute: (handler: Function) => () => void
}

interface IntervalBuilder {
  minutes: (handler: Function) => () => void
  hours: (handler: Function) => () => void
  seconds: (handler: Function) => () => void
}

// ============================================================================
// WORKFLOW CONTEXT TYPE
// ============================================================================

export interface WorkflowContext {
  // Event handlers
  on: Record<string, Record<string, (handler: EventHandler) => () => void>>
  getRegisteredHandlers(eventKey: string): Function[]
  matchHandlers(eventKey: string): Function[]
  dispatch(eventKey: string, data: unknown): Promise<void>

  // Scheduling
  every: ScheduleBuilder & ((n: number) => IntervalBuilder)
  at(date: string | Date): (handler: Function) => () => void
  getSchedule(cron: string): { handler: Function } | undefined
  getOneTimeSchedule(date: string): { handler: Function } | undefined

  // Execution
  send(event: string, data: unknown): string
  try<T>(action: () => T | Promise<T>, options?: { timeout?: number }): Promise<T>
  do<T>(
    action: () => T | Promise<T>,
    options?: { stepId?: string; maxRetries?: number; circuitBreakerId?: string }
  ): Promise<T>
  track(event: string, data: unknown): void
  getActionLog(): ActionLogEntry[]
  getEventLog(): EventLogEntry[]

  // Error handling (for fire-and-forget)
  onError(callback: (errorInfo: SendErrorInfo) => void): () => void
  getErrorCount(): number
  getErrorLog(): SendErrorInfo[]

  // Cascade
  cascade(options: CascadeOptions): Promise<CascadeResult>

  // Cross-DO RPC (dynamic access)
  [noun: string]: unknown
}

// ============================================================================
// PIPELINED PROMISE FOR RPC
// ============================================================================

/**
 * Create a pipelined promise that supports chained property/method access
 *
 * Enables patterns like:
 *   await $.Customer(id).getProfile().email
 *   await $.Order(id).getItems().map(item => item.name)
 *
 * The promise chains lazy evaluation while remaining awaitable.
 */
function createPipelinedPromise<T>(promise: Promise<T>): Promise<T> & Record<string, unknown> {
  const handler: ProxyHandler<Promise<T>> = {
    get(target, prop) {
      // Handle standard Promise methods
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const method = target[prop as keyof Promise<T>]
        if (typeof method === 'function') {
          return method.bind(target)
        }
      }

      // For other property access, create a chained promise that might be callable
      // When the result is accessed (like .map), we need to handle two cases:
      // 1. Direct property access (like .email) - returns value
      // 2. Method access (like .map) - returns a function that can be called

      // Create a callable pipelined promise
      const chainedPromise = target.then((result) => {
        if (result === null || result === undefined) {
          return undefined
        }
        return (result as Record<string | symbol, unknown>)[prop]
      })

      // Return a function that's also a promise
      // This allows both `.map(...)` and await `.email`
      const callablePromise = (...args: unknown[]) => {
        return createPipelinedPromise(
          chainedPromise.then((fn) => {
            if (typeof fn === 'function') {
              // Get the original result to use as 'this' context
              return target.then((result) => {
                return (fn as Function).apply(result, args)
              })
            }
            throw new Error('Attempted to call non-function')
          })
        )
      }

      // Make it thenable so it works with await
      callablePromise.then = (onFulfilled: unknown, onRejected: unknown) =>
        chainedPromise.then(onFulfilled as Parameters<Promise<unknown>['then']>[0], onRejected as Parameters<Promise<unknown>['then']>[1])
      callablePromise.catch = (onRejected: unknown) =>
        chainedPromise.catch(onRejected as Parameters<Promise<unknown>['catch']>[0])
      callablePromise.finally = (onFinally: unknown) =>
        chainedPromise.finally(onFinally as Parameters<Promise<unknown>['finally']>[0])

      return callablePromise
    },
  }

  return new Proxy(promise, handler) as Promise<T> & Record<string, unknown>
}

// ============================================================================
// DOMAIN PROXY FOR RPC
// ============================================================================

/**
 * Create a proxy for cross-DO RPC method calls
 *
 * Enables patterns like:
 *   $.Customer(id).notify()
 *   $.Order(id).ship()
 *   $.Invoice(id).calculate()
 *
 * - Method calls are wrapped with RPC timeout
 * - Results are pipelined promises (support chaining)
 * - Errors propagate to caller
 * - Optional circuit breaker protection
 */
function createDomainProxy(
  noun: string,
  id: string,
  stubResolver: (noun: string, id: string) => Record<string, Function>,
  rpcTimeout: number,
  circuitBreaker?: SimpleCircuitBreaker
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return new Proxy(
    {},
    {
      get(_target, method: string) {
        return (...args: unknown[]): Promise<unknown> & Record<string, unknown> => {
          const executeCall = async (): Promise<unknown> => {
            // Resolve stub inside the execute call so circuit breaker tracks resolution errors
            const stub = stubResolver(noun, id)
            const methodFn = stub[method]
            if (!methodFn) {
              throw new Error(`Method ${method} not found on ${noun}`)
            }

            return Promise.race([
              Promise.resolve(methodFn(...args)),
              new Promise((_, reject) => setTimeout(() => reject(new Error('RPC Timeout')), rpcTimeout)),
            ])
          }

          // If circuit breaker is provided, use it
          if (circuitBreaker) {
            return createPipelinedPromise(circuitBreaker.execute(executeCall))
          }

          // Without circuit breaker, execute directly
          return createPipelinedPromise(executeCall())
        }
      },
    }
  )
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createWorkflowContext(options?: CreateContextOptions): WorkflowContext {
  const impl = new WorkflowContextImpl(options)

  // Pre-bind methods that need it
  const boundMethods: Record<string, unknown> = {
    getRegisteredHandlers: impl.getRegisteredHandlers.bind(impl),
    matchHandlers: impl.matchHandlers.bind(impl),
    dispatch: impl.dispatch.bind(impl),
    at: impl.at.bind(impl),
    getSchedule: impl.getSchedule.bind(impl),
    getOneTimeSchedule: impl.getOneTimeSchedule.bind(impl),
    send: impl.send.bind(impl),
    try: impl.try.bind(impl),
    do: impl.do.bind(impl),
    track: impl.track.bind(impl),
    getActionLog: impl.getActionLog.bind(impl),
    getEventLog: impl.getEventLog.bind(impl),
    cascade: impl.cascade.bind(impl),
    // Error handling methods
    onError: impl.onError.bind(impl),
    getErrorCount: impl.getErrorCount.bind(impl),
    getErrorLog: impl.getErrorLog.bind(impl),
  }

  // Create a proxy that handles both known methods and dynamic Noun(id) accessors
  return new Proxy({} as WorkflowContext, {
    get(_target, prop: string) {
      // Handle 'on' specially - it's a getter that returns a Proxy
      if (prop === 'on') {
        return impl.on
      }

      // Handle 'every' specially - it's a getter that returns a callable with properties
      if (prop === 'every') {
        return impl.every
      }

      // Check bound methods
      if (prop in boundMethods) {
        return boundMethods[prop]
      }

      // Dynamic Noun accessor: $.Customer(id) returns a domain proxy
      if (typeof prop === 'string' && prop[0] === prop[0].toUpperCase()) {
        // It's a capitalized word - treat as noun accessor
        return (id: string) => {
          if (!options?.stubResolver) {
            throw new Error(`No stubResolver configured for ${prop}(${id})`)
          }

          // Get circuit breaker if configured
          let circuitBreaker: SimpleCircuitBreaker | undefined
          if (options?.circuitBreaker) {
            // Determine circuit ID based on configuration
            const circuitId = options.circuitBreaker.circuitPerDOType ? `rpc:${prop}` : 'rpc:global'
            circuitBreaker = impl.getCircuitBreaker(circuitId)
          }

          return createDomainProxy(prop, id, options.stubResolver, options?.rpcTimeout ?? 30000, circuitBreaker)
        }
      }

      return undefined
    },
  })
}
