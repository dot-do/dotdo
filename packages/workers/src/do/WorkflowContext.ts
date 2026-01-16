/**
 * WorkflowContext ($) - Unified interface for DO operations
 *
 * Provides:
 * - Event handlers ($.on) - $.on.Noun.verb(handler), wildcards
 * - Scheduling DSL ($.every) - $.every.Monday.at9am(), $.every(5).minutes()
 * - Durable execution - $.do(action), $.try(action), $.send(event)
 * - Cross-DO RPC - $.Customer(id).method()
 *
 * @module @dotdo/workers/do
 */

/**
 * Event object passed to handlers
 */
export interface Event {
  id: string
  type: string
  subject: string
  object: string
  data: unknown
  timestamp: Date
}

/**
 * Event handler function type
 */
export type EventHandler = (event: Event) => void | Promise<void>

/**
 * Schedule handler function type
 */
export type ScheduleHandler = () => void | Promise<void>

/**
 * Time builder for scheduling DSL
 */
export interface TimeBuilder {
  at9am: (handler: ScheduleHandler) => () => void
  at5pm: (handler: ScheduleHandler) => () => void
  at6am: (handler: ScheduleHandler) => () => void
  at: (time: string) => (handler: ScheduleHandler) => () => void
}

/**
 * Schedule builder for $.every
 */
export interface ScheduleBuilder {
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

/**
 * Interval builder for $.every(n)
 */
export interface IntervalBuilder {
  minutes: (handler: ScheduleHandler) => () => void
  hours: (handler: ScheduleHandler) => () => void
  seconds: (handler: ScheduleHandler) => () => void
}

/**
 * Options for creating a WorkflowContext
 */
export interface CreateContextOptions {
  stubResolver?: (noun: string, id: string) => Record<string, Function>
  rpcTimeout?: number
  circuitBreaker?: {
    failureThreshold: number
    resetTimeout: number
    circuitPerDOType?: boolean
  }
}

/**
 * WorkflowContext interface - the $ object
 */
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

  // Execution
  send(event: string, data: unknown): string
  try<T>(action: () => T | Promise<T>, options?: { timeout?: number }): Promise<T>
  do<T>(
    action: () => T | Promise<T>,
    options?: { stepId?: string; maxRetries?: number }
  ): Promise<T>

  // Cross-DO RPC (dynamic access)
  [noun: string]: unknown
}

/**
 * Create a WorkflowContext instance
 *
 * @param options - Configuration options
 * @returns WorkflowContext ($) object
 *
 * @example
 * ```typescript
 * const $ = createWorkflowContext({ stubResolver })
 * $.on.Customer.signup(async (event) => {
 *   await $.Customer(event.data.id).sendWelcomeEmail()
 * })
 * ```
 */
export function createWorkflowContext(_options?: CreateContextOptions): WorkflowContext {
  throw new Error('createWorkflowContext not implemented yet')
}
