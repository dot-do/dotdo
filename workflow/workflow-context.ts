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
  CascadeCircuitBreakerContextConfig,
  GracefulDegradationOptions,
  CircuitBreakerPersistenceState,
  CircuitBreakerPersistenceCallbacks,
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
  CascadeCircuitBreakerContextConfig,
  GracefulDegradationOptions,
  CircuitBreakerPersistenceState,
  CircuitBreakerPersistenceCallbacks,
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
  successes: number
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
 * - Persists state to durable storage for cold start recovery
 */
class CascadeTierCircuitBreaker {
  private circuits: Map<CascadeTierName, CascadeTierCircuitState> = new Map()
  private failureThreshold: number
  private resetTimeout: number
  private fallback?: unknown
  private persistence?: CircuitBreakerPersistenceCallbacks

  constructor(config?: CascadeCircuitBreakerConfig, persistence?: CircuitBreakerPersistenceCallbacks) {
    this.failureThreshold = config?.failureThreshold ?? DEFAULT_CASCADE_FAILURE_THRESHOLD
    this.resetTimeout = config?.resetTimeout ?? DEFAULT_CASCADE_RESET_TIMEOUT_MS
    this.fallback = config?.fallback
    this.persistence = persistence

    // Load persisted state on construction
    if (persistence) {
      this.loadPersistedState()
    }
  }

  /**
   * Load circuit breaker state from persistence
   */
  private loadPersistedState(): void {
    if (!this.persistence) return

    try {
      const states = this.persistence.load()
      for (const persisted of states) {
        // Convert persisted state format to internal format
        // Note: half_open in persistence becomes half-open internally
        const internalState: CascadeCircuitState =
          persisted.state === 'half_open' ? 'half-open' : persisted.state

        const circuit: CascadeTierCircuitState = {
          state: internalState,
          failures: persisted.failure_count,
          successes: persisted.success_count,
          lastFailure: persisted.last_failure_at,
          lastSuccess: null, // Not persisted, will be set on next success
          openedAt: persisted.opened_at,
        }

        this.circuits.set(persisted.tier as CascadeTierName, circuit)
      }
    } catch (err) {
      // Log but don't fail - start with fresh state
      console.warn('[CascadeTierCircuitBreaker] Failed to load persisted state:', (err as Error).message)
    }
  }

  /**
   * Persist circuit state for a tier
   */
  private persistState(tier: CascadeTierName): void {
    if (!this.persistence) return

    const circuit = this.circuits.get(tier)
    if (!circuit) return

    try {
      // Convert internal state format to persistence format
      // Note: half-open internally becomes half_open in persistence
      const persistedState: 'closed' | 'open' | 'half_open' =
        circuit.state === 'half-open' ? 'half_open' : circuit.state

      this.persistence.save({
        tier,
        state: persistedState,
        failure_count: circuit.failures,
        success_count: circuit.successes,
        last_failure_at: circuit.lastFailure,
        opened_at: circuit.openedAt,
        updated_at: Date.now(),
      })
    } catch (err) {
      // Log but don't fail - state may be lost on cold start
      console.warn('[CascadeTierCircuitBreaker] Failed to persist state:', (err as Error).message)
    }
  }

  /**
   * Get or create circuit state for a tier
   */
  private getCircuitState(tier: CascadeTierName): CascadeTierCircuitState {
    if (!this.circuits.has(tier)) {
      this.circuits.set(tier, {
        state: 'closed',
        failures: 0,
        successes: 0,
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
    circuit.successes++
    circuit.lastSuccess = Date.now()

    if (circuit.state === 'half-open') {
      circuit.state = 'closed'
      circuit.openedAt = null
    }

    // Persist state change
    this.persistState(tier)
  }

  /**
   * Record a failed execution for a tier
   */
  recordFailure(tier: CascadeTierName): void {
    const circuit = this.getCircuitState(tier)
    circuit.failures++
    circuit.successes = 0
    circuit.lastFailure = Date.now()

    if (circuit.state === 'half-open') {
      // Failed probe - back to open
      circuit.state = 'open'
      circuit.openedAt = Date.now()
      // Persist state change
      this.persistState(tier)
      return
    }

    if (circuit.failures >= this.failureThreshold) {
      circuit.state = 'open'
      circuit.openedAt = Date.now()
    }

    // Persist state change
    this.persistState(tier)
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
        // Persist state transition
        this.persistState(tier)
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
      successes: 0,
      lastFailure: null,
      lastSuccess: null,
      openedAt: null,
    })
    // Persist reset state
    this.persistState(tier)
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.circuits.clear()
    // Clear persisted state
    if (this.persistence) {
      try {
        this.persistence.clear()
      } catch (err) {
        console.warn('[CascadeTierCircuitBreaker] Failed to clear persisted state:', (err as Error).message)
      }
    }
  }
}

// EventHandler imported from ../types

interface ScheduleEntry {
  handler: ScheduleHandler
  cron: string
}

interface OneTimeScheduleEntry {
  handler: ScheduleHandler
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

// ============================================================================
// CASCADE CONCURRENCY LIMITER
// ============================================================================

/**
 * Semaphore for limiting concurrent cascade executions
 */
class CascadeConcurrencyLimiter {
  private currentCount = 0
  private readonly maxConcurrent: number
  private readonly maxQueued: number
  private readonly queue: Array<{
    resolve: () => void
    reject: (error: Error) => void
  }> = []

  constructor(maxConcurrent: number, maxQueued: number) {
    this.maxConcurrent = maxConcurrent
    this.maxQueued = maxQueued
  }

  async acquire(): Promise<void> {
    if (this.currentCount < this.maxConcurrent) {
      this.currentCount++
      return
    }

    if (this.queue.length >= this.maxQueued) {
      throw new Error('Cascade queue is full')
    }

    return new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject })
    })
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      next.resolve()
    } else {
      this.currentCount--
    }
  }
}

// ============================================================================
// CASCADE TASK CIRCUIT BREAKER
// ============================================================================

/**
 * Circuit breaker for cascade tasks (operates at task level, not tier level)
 */
class CascadeTaskCircuitBreaker {
  private circuits: Map<string, {
    state: 'closed' | 'open' | 'half-open'
    failures: number
    openedAt: number | null
  }> = new Map()
  private readonly threshold: number
  private readonly resetTimeout: number
  private readonly perTaskType: boolean

  constructor(config: CascadeCircuitBreakerContextConfig) {
    this.threshold = config.threshold
    this.resetTimeout = config.resetTimeout
    this.perTaskType = config.perTaskType ?? false
  }

  private getCircuitKey(taskName: string): string {
    if (this.perTaskType) {
      // Extract task type prefix (e.g., "email.send" -> "email")
      const parts = taskName.split('.')
      return parts.length > 1 ? parts[0] : taskName
    }
    return 'global'
  }

  private getOrCreateCircuit(key: string) {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, {
        state: 'closed',
        failures: 0,
        openedAt: null,
      })
    }
    return this.circuits.get(key)!
  }

  canExecute(taskName: string): boolean {
    const key = this.getCircuitKey(taskName)
    const circuit = this.getOrCreateCircuit(key)

    // Check for state transition
    if (circuit.state === 'open' && circuit.openedAt !== null) {
      const elapsed = Date.now() - circuit.openedAt
      if (elapsed >= this.resetTimeout) {
        circuit.state = 'half-open'
      }
    }

    return circuit.state !== 'open'
  }

  isOpen(taskName: string): boolean {
    const key = this.getCircuitKey(taskName)
    const circuit = this.getOrCreateCircuit(key)

    // Check for state transition
    if (circuit.state === 'open' && circuit.openedAt !== null) {
      const elapsed = Date.now() - circuit.openedAt
      if (elapsed >= this.resetTimeout) {
        circuit.state = 'half-open'
      }
    }

    return circuit.state === 'open'
  }

  recordSuccess(taskName: string): void {
    const key = this.getCircuitKey(taskName)
    const circuit = this.getOrCreateCircuit(key)
    circuit.failures = 0
    if (circuit.state === 'half-open') {
      circuit.state = 'closed'
      circuit.openedAt = null
    }
  }

  recordFailure(taskName: string): void {
    const key = this.getCircuitKey(taskName)
    const circuit = this.getOrCreateCircuit(key)
    circuit.failures++

    if (circuit.state === 'half-open') {
      circuit.state = 'open'
      circuit.openedAt = Date.now()
      return
    }

    if (circuit.failures >= this.threshold) {
      circuit.state = 'open'
      circuit.openedAt = Date.now()
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

  // New cascade timeout & concurrency fields
  private cascadeTimeout?: number
  private tierTimeout?: number
  private cascadeCircuitBreakerConfig?: CascadeCircuitBreakerContextConfig
  private cascadeTaskCircuitBreaker?: CascadeTaskCircuitBreaker
  private gracefulDegradationEnabled: boolean
  private concurrencyLimiter?: CascadeConcurrencyLimiter

  // Circuit breaker persistence
  private circuitBreakerPersistence?: CircuitBreakerPersistenceCallbacks

  constructor(options?: CreateContextOptions) {
    this.stubResolver = options?.stubResolver
    this.rpcTimeout = options?.rpcTimeout ?? DEFAULT_RPC_TIMEOUT_MS
    this.circuitBreakerConfig = options?.circuitBreaker

    // New cascade timeout configuration
    this.cascadeTimeout = options?.cascadeTimeout
    this.tierTimeout = options?.tierTimeout
    this.cascadeCircuitBreakerConfig = options?.cascadeCircuitBreaker
    this.gracefulDegradationEnabled = options?.gracefulDegradation ?? false

    // Store persistence callbacks for circuit breakers
    this.circuitBreakerPersistence = options?.circuitBreakerPersistence

    // Initialize cascade circuit breaker if configured
    if (this.cascadeCircuitBreakerConfig) {
      this.cascadeTaskCircuitBreaker = new CascadeTaskCircuitBreaker(this.cascadeCircuitBreakerConfig)
    }

    // Initialize concurrency limiter if configured
    if (options?.maxConcurrentCascades) {
      this.concurrencyLimiter = new CascadeConcurrencyLimiter(
        options.maxConcurrentCascades,
        options.maxQueuedCascades ?? Infinity
      )
    }
  }

  /**
   * Get or create a cascade circuit breaker for a specific task/context
   */
  getCascadeCircuitBreaker(taskId: string, config?: CascadeCircuitBreakerConfig): CascadeTierCircuitBreaker {
    if (!this.cascadeCircuitBreakers.has(taskId)) {
      // Pass persistence callbacks when creating circuit breaker
      this.cascadeCircuitBreakers.set(taskId, new CascadeTierCircuitBreaker(config, this.circuitBreakerPersistence))
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

  getRegisteredHandlers(eventKey: string): EventHandler[] {
    return this.handlers.get(eventKey) ?? []
  }

  matchHandlers(eventKey: string): EventHandler[] {
    const [noun, verb] = eventKey.split('.')
    const matched: EventHandler[] = []

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
                return (handler: ScheduleHandler): (() => void) => {
                  const { hour, minute } = parseTime(time)
                  return self.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
                }
              }
            }

            if (shortcuts[prop]) {
              return (handler: ScheduleHandler): (() => void) => {
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
      hour: (handler: ScheduleHandler): (() => void) => self.registerSchedule('0 * * * *', handler),
      minute: (handler: ScheduleHandler): (() => void) => self.registerSchedule('* * * * *', handler),
    }

    // Make it callable for $.every(n)
    const everyFn = (n: number): IntervalBuilder => {
      return {
        minutes: (handler: ScheduleHandler): (() => void) => self.registerSchedule(`*/${n} * * * *`, handler),
        hours: (handler: ScheduleHandler): (() => void) => self.registerSchedule(`0 */${n} * * *`, handler),
        seconds: (handler: ScheduleHandler): (() => void) => self.registerSchedule(`every:${n}s`, handler),
      }
    }

    // Combine function with schedule builder properties
    return Object.assign(everyFn, scheduleBuilder) as ScheduleBuilder & ((n: number) => IntervalBuilder)
  }

  /**
   * Helper to register a schedule and return unsubscribe function
   */
  private registerSchedule(cron: string, handler: ScheduleHandler): () => void {
    this.schedules.set(cron, { handler, cron })
    return () => {
      this.schedules.delete(cron)
    }
  }

  at(date: string | Date): (handler: ScheduleHandler) => () => void {
    const self = this
    return (handler: ScheduleHandler): (() => void) => {
      const isoDate = date instanceof Date ? date.toISOString() : date
      self.oneTimeSchedules.set(isoDate, { handler, date: isoDate })
      return () => {
        self.oneTimeSchedules.delete(isoDate)
      }
    }
  }

  getSchedule(cron: string): { handler: ScheduleHandler } | undefined {
    return this.schedules.get(cron)
  }

  getOneTimeSchedule(date: string): { handler: ScheduleHandler } | undefined {
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
      } catch (err) {
        // Swallow callback errors to prevent cascade - log for debugging
        console.warn('[WorkflowContext] Error callback failed:', (err as Error).message)
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
      timeout: explicitTimeout,
      tierTimeouts,
      circuitBreaker: circuitBreakerConfig,
      gracefulDegradation,
      fallbackValue,
    } = options

    const cascadeStartTime = Date.now()

    // Compute effective timeout: explicit > context > default
    const effectiveCascadeTimeout = explicitTimeout ?? this.cascadeTimeout ?? DEFAULT_CASCADE_TIER_TIMEOUT_MS
    const effectiveTierTimeout = this.tierTimeout

    // Check context-level cascade circuit breaker first (fail-fast)
    if (this.cascadeTaskCircuitBreaker && !this.cascadeTaskCircuitBreaker.canExecute(task)) {
      // Circuit is open - return immediately
      return {
        value: undefined as unknown,
        tier: undefined,
        circuitOpen: true,
        timedOut: false,
        duration: Date.now() - cascadeStartTime,
        executionPath: [],
        attempts: 0,
        timing: {},
        confidenceScores: {},
        completedTiers: [],
        failedTiers: [],
      }
    }

    // Acquire concurrency permit if limiter is configured
    if (this.concurrencyLimiter) {
      try {
        await this.concurrencyLimiter.acquire()
      } catch (err) {
        // Queue is full
        throw new Error('Cascade queue is full')
      }
    }

    try {
      return await this.executeCascade({
        task,
        tiers,
        confidenceThreshold,
        skipAutomation,
        cascadeTimeout: effectiveCascadeTimeout,
        tierTimeout: effectiveTierTimeout,
        tierTimeouts,
        circuitBreakerConfig,
        gracefulDegradation,
        fallbackValue,
        cascadeStartTime,
      })
    } finally {
      // Release concurrency permit
      if (this.concurrencyLimiter) {
        this.concurrencyLimiter.release()
      }
    }
  }

  /**
   * Internal cascade execution logic
   */
  private async executeCascade(params: {
    task: string
    tiers: CascadeOptions['tiers']
    confidenceThreshold: number
    skipAutomation: boolean
    cascadeTimeout: number
    tierTimeout?: number
    tierTimeouts?: CascadeTierTimeout
    circuitBreakerConfig?: CascadeCircuitBreakerConfig
    gracefulDegradation?: GracefulDegradationOptions
    fallbackValue?: unknown
    cascadeStartTime: number
  }): Promise<CascadeResult> {
    const {
      task,
      tiers,
      confidenceThreshold,
      skipAutomation,
      cascadeTimeout,
      tierTimeout,
      tierTimeouts,
      circuitBreakerConfig,
      gracefulDegradation,
      fallbackValue,
      cascadeStartTime,
    } = params

    const tierOrder: Array<'code' | 'generative' | 'agentic' | 'human'> = skipAutomation
      ? ['human']
      : ['code', 'generative', 'agentic', 'human']

    const executionPath: string[] = []
    const confidenceScores: Record<string, number> = {}
    const timing: Record<string, number> = {}
    const tierErrors: Record<string, Error> = {}
    const completedTiers: string[] = []
    const failedTiers: string[] = []
    const tierTimeoutsList: string[] = []
    const partialResults: Record<string, unknown> = {}
    let attempts = 0
    let anyTimedOut = false
    let timeoutTier: string | undefined = undefined
    let bestPartialResult: unknown = undefined
    let bestPartialTier: string | undefined = undefined
    let bestPartialConfidence = 0

    // Get or create tier-level circuit breaker for this cascade task if configured
    const tierCircuitBreaker = circuitBreakerConfig
      ? this.getCascadeCircuitBreaker(task, circuitBreakerConfig)
      : null

    // Helper to compute total elapsed time
    const getElapsedTime = (): number => Date.now() - cascadeStartTime

    // Helper to check if we've exceeded cascade timeout
    const hasExceededCascadeTimeout = (): boolean => getElapsedTime() >= cascadeTimeout

    // Helper to get remaining time for cascade
    const getRemainingCascadeTime = (): number => Math.max(0, cascadeTimeout - getElapsedTime())

    // Helper to build tier error messages for result
    const buildTierErrorMessages = (): Record<string, string> => {
      const messages: Record<string, string> = {}
      for (const [tierName, error] of Object.entries(tierErrors)) {
        messages[tierName] = error.message
      }
      return messages
    }

    // Helper to build a successful result
    const buildSuccessResult = (
      value: unknown,
      tierName: 'code' | 'generative' | 'agentic' | 'human',
      confidence: number,
      result: unknown
    ): CascadeResult => {
      // Record success in task-level circuit breaker
      if (this.cascadeTaskCircuitBreaker) {
        this.cascadeTaskCircuitBreaker.recordSuccess(task)
      }

      const cascadeResult: CascadeResult = {
        value,
        tier: tierName,
        confidence,
        executionPath,
        attempts,
        timing,
        confidenceScores,
        timedOut: anyTimedOut,
        duration: getElapsedTime(),
        completedTiers,
        failedTiers,
        degraded: false,
      }

      if (tierTimeoutsList.length > 0) {
        cascadeResult.tierTimeouts = tierTimeoutsList
      }

      if (anyTimedOut && timeoutTier) {
        cascadeResult.timeoutTier = timeoutTier
      }

      if (failedTiers.length > 0) {
        cascadeResult.tierErrors = buildTierErrorMessages()
      }

      if (tierCircuitBreaker) {
        cascadeResult.circuitStates = tierCircuitBreaker.getAllStates()
      }

      if (typeof result === 'object' && result !== null && 'queueEntry' in result) {
        cascadeResult.queueEntry = (result as { queueEntry: unknown }).queueEntry
      }

      return cascadeResult
    }

    // Helper to build a timeout result (returns result instead of throwing)
    const buildTimeoutResult = (): CascadeResult => {
      // Record failure in task-level circuit breaker
      if (this.cascadeTaskCircuitBreaker) {
        this.cascadeTaskCircuitBreaker.recordFailure(task)
      }

      // Check if we should use fallback
      if (fallbackValue !== undefined) {
        return {
          value: fallbackValue,
          tier: undefined,
          timedOut: true,
          duration: getElapsedTime(),
          timeoutTier,
          usedFallback: true,
          executionPath,
          attempts,
          timing,
          confidenceScores,
          completedTiers,
          failedTiers,
          tierTimeouts: tierTimeoutsList.length > 0 ? tierTimeoutsList : undefined,
          partialResults: Object.keys(partialResults).length > 0 ? partialResults : undefined,
          tierErrors: Object.keys(tierErrors).length > 0 ? buildTierErrorMessages() : undefined,
          degraded: true,
        }
      }

      // Check graceful degradation
      if (gracefulDegradation?.enabled || this.gracefulDegradationEnabled) {
        return {
          value: bestPartialResult,
          tier: bestPartialTier as 'code' | 'generative' | 'agentic' | 'human' | undefined,
          confidence: bestPartialConfidence,
          timedOut: true,
          duration: getElapsedTime(),
          timeoutTier,
          degraded: true,
          partialValue: bestPartialResult,
          executionPath,
          attempts,
          timing,
          confidenceScores,
          completedTiers,
          failedTiers,
          tierTimeouts: tierTimeoutsList.length > 0 ? tierTimeoutsList : undefined,
          partialResults: Object.keys(partialResults).length > 0 ? partialResults : undefined,
          tierErrors: Object.keys(tierErrors).length > 0 ? buildTierErrorMessages() : undefined,
        }
      }

      // Return timedOut result
      return {
        value: undefined as unknown,
        tier: undefined,
        timedOut: true,
        duration: getElapsedTime(),
        timeoutTier,
        executionPath,
        attempts,
        timing,
        confidenceScores,
        completedTiers,
        failedTiers,
        tierTimeouts: tierTimeoutsList.length > 0 ? tierTimeoutsList : undefined,
        partialResults: Object.keys(partialResults).length > 0 ? partialResults : undefined,
        tierErrors: Object.keys(tierErrors).length > 0 ? buildTierErrorMessages() : undefined,
      }
    }

    // Helper to build a degraded result
    const buildDegradedResult = (): CascadeResult => {
      // Record failure in task-level circuit breaker
      if (this.cascadeTaskCircuitBreaker) {
        this.cascadeTaskCircuitBreaker.recordFailure(task)
      }

      let degradedValue: unknown = undefined

      if (fallbackValue !== undefined) {
        degradedValue = fallbackValue
      } else if (gracefulDegradation?.fallbackValue !== undefined) {
        degradedValue = gracefulDegradation.fallbackValue
      } else if (bestPartialResult !== undefined) {
        degradedValue = bestPartialResult
      }

      return {
        value: degradedValue,
        tier: bestPartialTier as 'code' | 'generative' | 'agentic' | 'human' | undefined,
        confidence: bestPartialConfidence,
        executionPath,
        attempts,
        timing,
        confidenceScores,
        timedOut: anyTimedOut,
        duration: getElapsedTime(),
        degraded: true,
        completedTiers,
        failedTiers,
        partialResult: bestPartialResult,
        partialResults: Object.keys(partialResults).length > 0 ? partialResults : undefined,
        tierErrors: Object.keys(tierErrors).length > 0 ? buildTierErrorMessages() : undefined,
        circuitStates: tierCircuitBreaker?.getAllStates(),
        tierTimeouts: tierTimeoutsList.length > 0 ? tierTimeoutsList : undefined,
      }
    }

    for (const tierName of tierOrder) {
      const tierHandler = tiers[tierName]
      if (!tierHandler) continue

      // Check if cascade timeout already exceeded before starting tier
      if (hasExceededCascadeTimeout()) {
        anyTimedOut = true
        if (!timeoutTier) {
          timeoutTier = tierName
        }
        return buildTimeoutResult()
      }

      // Check tier-level circuit breaker state before attempting tier
      if (tierCircuitBreaker && !tierCircuitBreaker.canExecute(tierName)) {
        const circuitState = tierCircuitBreaker.getState(tierName)
        tierErrors[tierName] = new Error(`Circuit breaker ${circuitState} for tier ${tierName}`)
        failedTiers.push(tierName)
        timing[tierName] = 0
        continue
      }

      attempts++
      executionPath.push(tierName)

      const startTime = performance.now()

      // Determine timeout for this tier:
      // Priority: per-tier specific > context tierTimeout > remaining cascade time
      let effectiveTierTimeout: number
      if (tierTimeouts?.[tierName] !== undefined) {
        effectiveTierTimeout = tierTimeouts[tierName]!
      } else if (tierTimeout !== undefined) {
        effectiveTierTimeout = tierTimeout
      } else {
        effectiveTierTimeout = getRemainingCascadeTime()
      }

      // If tierTimeout is specified, also respect remaining cascade time
      effectiveTierTimeout = Math.min(effectiveTierTimeout, getRemainingCascadeTime())

      try {
        // Execute with timeout tracking
        const timeoutResult = await withCascadeTimeout(
          Promise.resolve(tierHandler()),
          effectiveTierTimeout
        )

        timing[tierName] = Math.max(timeoutResult.duration, 0.001)

        if (timeoutResult.timedOut) {
          anyTimedOut = true
          failedTiers.push(tierName)
          tierTimeoutsList.push(tierName)

          if (!timeoutTier) {
            timeoutTier = tierName
          }

          if (tierCircuitBreaker) {
            tierCircuitBreaker.recordFailure(tierName)
          }

          tierErrors[tierName] = new Error(`Tier ${tierName} timed out after ${effectiveTierTimeout}ms`)

          // If tier timeout is set (not cascade timeout), escalate to next tier
          if (tierTimeout !== undefined || tierTimeouts?.[tierName] !== undefined) {
            continue
          }

          // Check if cascade timeout exceeded
          if (hasExceededCascadeTimeout()) {
            return buildTimeoutResult()
          }

          continue
        }

        const result = timeoutResult.result
        completedTiers.push(tierName)

        if (tierCircuitBreaker) {
          tierCircuitBreaker.recordSuccess(tierName)
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

        // Store partial results for tracking
        partialResults[tierName] = result

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

        if (tierCircuitBreaker) {
          tierCircuitBreaker.recordFailure(tierName)
        }

        // Continue to next tier on errors
      }
    }

    // All tiers failed or didn't meet confidence
    // Check if graceful degradation is enabled
    if (gracefulDegradation?.enabled || this.gracefulDegradationEnabled || fallbackValue !== undefined) {
      return buildDegradedResult()
    }

    // Record failure in task-level circuit breaker
    if (this.cascadeTaskCircuitBreaker) {
      this.cascadeTaskCircuitBreaker.recordFailure(task)
    }

    throw new CascadeError(`All tiers failed for task: ${task}`, tierErrors)
  }
}

// ============================================================================
// TYPE DEFINITIONS FOR DSL
// ============================================================================

/**
 * ScheduleHandler - Typed handler for scheduled tasks
 */
type ScheduleHandler = () => void | Promise<void>

interface TimeBuilder {
  at9am: (handler: ScheduleHandler) => () => void
  at5pm: (handler: ScheduleHandler) => () => void
  at6am: (handler: ScheduleHandler) => () => void
  at: (time: string) => (handler: ScheduleHandler) => () => void
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
  hour: (handler: ScheduleHandler) => () => void
  minute: (handler: ScheduleHandler) => () => void
}

interface IntervalBuilder {
  minutes: (handler: ScheduleHandler) => () => void
  hours: (handler: ScheduleHandler) => () => void
  seconds: (handler: ScheduleHandler) => () => void
}

// ============================================================================
// WORKFLOW CONTEXT TYPE
// ============================================================================

export interface WorkflowContext {
  // Event handlers
  on: Record<string, Record<string, (handler: EventHandler) => () => void>>
  getRegisteredHandlers(eventKey: string): EventHandler[]
  matchHandlers(eventKey: string): EventHandler[]
  dispatch(eventKey: string, data: unknown): Promise<void>

  // Scheduling
  every: ScheduleBuilder & ((n: number) => IntervalBuilder)
  at(date: string | Date): (handler: ScheduleHandler) => () => void
  getSchedule(cron: string): { handler: ScheduleHandler } | undefined
  getOneTimeSchedule(date: string): { handler: ScheduleHandler } | undefined

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
