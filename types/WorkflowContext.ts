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
