/**
 * Type-safe WorkflowContext with DO binding inference (do-ebio)
 *
 * Provides compile-time type safety for:
 * - Cross-DO RPC calls via $.Customer(id).method()
 * - Event handlers via $.on.Customer.signup(handler) with typed events
 * - Scheduling via $.every.day.at('9am') with proper return types
 *
 * @example
 * ```typescript
 * // Define your DO interfaces
 * interface CustomerDO {
 *   getProfile(): Promise<{ name: string; email: string }>
 *   notify(params: { message: string }): Promise<{ delivered: boolean }>
 *   updateBalance(amount: number): Promise<{ balance: number }>
 * }
 *
 * interface OrderDO {
 *   ship(): Promise<{ status: string }>
 *   getItems(): Promise<string[]>
 * }
 *
 * // Define event schemas for type-safe event handlers
 * interface EventSchemas {
 *   'Customer.signup': { customerId: string; email: string; plan: string }
 *   'Customer.updated': { customerId: string; changes: Record<string, unknown> }
 *   'Order.placed': { orderId: string; items: string[]; total: number }
 *   'Payment.failed': { paymentId: string; reason: string }
 * }
 *
 * // Define DO bindings map
 * interface DOBindings {
 *   Customer: CustomerDO
 *   Order: OrderDO
 * }
 *
 * // Create typed workflow context
 * const $ = createTypedContext<DOBindings, EventSchemas>(state, env)
 *
 * // Now get full type inference!
 * const customer = $.Customer('user-123')
 * const profile = await customer.getProfile()  // Typed as { name: string; email: string }
 *
 * // Event handlers are typed based on EventSchemas
 * $.on.Customer.signup((event) => {
 *   // event is typed as { customerId: string; email: string; plan: string }
 *   console.log(event.email)
 * })
 *
 * // Scheduling returns void
 * $.every.Monday.at('9am')(async () => {
 *   await generateWeeklyReport()
 * })
 * ```
 */

import type { EventsStore, Event, EventId, ThingId, CorrelationId } from '@dotdo/db'
import type { EventHandler } from './on'
import type { ScheduleRegistration, ScheduleHandler } from './schedule'
import type { FireAndForgetErrorStore } from './fire-and-forget-errors'

// =============================================================================
// DO STUB PROXY TYPES
// =============================================================================

/**
 * A loosely-typed proxy for DO method calls (legacy/fallback behavior).
 * All methods return Promise<unknown>.
 */
export type DOStubProxy = {
  [method: string]: (...args: unknown[]) => Promise<unknown>
}

/**
 * A typed proxy that preserves the DO interface methods.
 * Methods are wrapped to ensure they return Promises.
 *
 * @template T - The DO interface type
 */
export type TypedDOStubProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? R extends Promise<unknown>
      ? (...args: A) => R
      : (...args: A) => Promise<R>
    : never
}

/**
 * Function type for creating typed DO stubs from an ID.
 *
 * @template T - The DO interface type
 */
export type TypedDOStubFactory<T> = (id: string | DurableObjectId) => TypedDOStubProxy<T>

/**
 * Function type for creating untyped DO stubs (legacy behavior).
 */
export type DOStubFactory = (id: string | DurableObjectId) => DOStubProxy

// =============================================================================
// DO BINDINGS CONSTRAINT
// =============================================================================

/**
 * Constraint type for DO bindings map.
 * Maps binding names to their DO interface types.
 *
 * @example
 * ```typescript
 * interface MyDOBindings extends DOBindingsConstraint {
 *   Customer: CustomerDO
 *   Order: OrderDO
 * }
 * ```
 */
export interface DOBindingsConstraint {
  [bindingName: string]: object
}

/**
 * Empty bindings type for untyped contexts.
 */
export type EmptyBindings = Record<string, never>

// =============================================================================
// WORKFLOW CONTEXT OPTIONS
// =============================================================================

/**
 * Options for $.do() durable action execution
 */
export interface DoOptions {
  /** Number of retry attempts (default: 3) */
  retries?: number
  /** Backoff strategy: 'linear' or 'exponential' (default: 'exponential') */
  backoff?: 'linear' | 'exponential'
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
}

// =============================================================================
// EVENT SCHEMA TYPES
// =============================================================================

/**
 * Constraint type for event schemas.
 * Maps event types ('Noun.verb') to their payload types.
 *
 * @example
 * ```typescript
 * interface MyEventSchemas extends EventSchemasConstraint {
 *   'Customer.signup': { customerId: string; email: string }
 *   'Order.placed': { orderId: string; total: number }
 * }
 * ```
 */
export interface EventSchemasConstraint {
  [eventType: string]: unknown
}

/**
 * Empty event schemas for untyped contexts.
 */
export type EmptyEventSchemas = Record<string, unknown>

/**
 * Extract noun from event type string.
 * 'Customer.signup' -> 'Customer'
 */
export type ExtractNoun<T extends string> = T extends `${infer N}.${string}` ? N : never

/**
 * Extract verb from event type string.
 * 'Customer.signup' -> 'signup'
 */
export type ExtractVerb<T extends string> = T extends `${string}.${infer V}` ? V : never

/**
 * Get all nouns from event schemas.
 */
export type EventNouns<E extends EventSchemasConstraint> = ExtractNoun<keyof E & string>

/**
 * Get all verbs for a specific noun from event schemas.
 */
export type EventVerbsForNoun<E extends EventSchemasConstraint, N extends string> = {
  [K in keyof E & string]: K extends `${N}.${infer V}` ? V : never
}[keyof E & string]

/**
 * Get the event payload type for a specific Noun.verb combination.
 */
export type EventPayloadType<
  E extends EventSchemasConstraint,
  N extends string,
  V extends string
> = `${N}.${V}` extends keyof E ? E[`${N}.${V}`] : unknown

// =============================================================================
// TYPED ON PROXY (EVENT HANDLERS)
// =============================================================================

/**
 * Full event object passed to handlers, including metadata.
 * Uses branded types for type safety - see do-eoxd
 */
export interface TypedEvent<T = unknown> {
  $id: EventId
  $timestamp: number
  type: string
  payload: T
  source: ThingId | string
  correlationId?: CorrelationId | string
}

/**
 * Typed event handler function.
 */
export type TypedEventHandler<T = unknown> = (event: TypedEvent<T>) => Promise<void> | void

/**
 * Proxy for event handlers on a specific noun with typed verbs.
 * Each verb returns void when registering a handler.
 *
 * @template E - Event schemas
 * @template N - The noun (e.g., 'Customer')
 */
export type TypedNounEventProxy<E extends EventSchemasConstraint, N extends string> = {
  // Known verbs from the event schema get typed handlers
  [V in EventVerbsForNoun<E, N>]: (handler: TypedEventHandler<EventPayloadType<E, N, V>>) => void
} & {
  // Wildcard support
  '*': (handler: TypedEventHandler<unknown>) => void
  // Index signature for unknown verbs (fallback to unknown payload)
  [verb: string]: (handler: TypedEventHandler<unknown>) => void
}

/**
 * Top-level typed OnProxy for event handler registration.
 * Each noun returns a TypedNounEventProxy with verb-specific typing.
 *
 * @template E - Event schemas
 */
export type TypedOnProxy<E extends EventSchemasConstraint> = {
  // Known nouns from event schema get typed noun proxies
  [N in EventNouns<E>]: TypedNounEventProxy<E, N>
} & {
  // Wildcard support
  '*': TypedNounEventProxy<E, '*'>
  // Index signature for unknown nouns (fallback to untyped)
  [noun: string]: TypedNounEventProxy<E, string>
}

/**
 * Untyped OnProxy (legacy, backward compatible).
 * Re-exported from on.ts for convenience.
 */
export type { OnProxy } from './on'

// =============================================================================
// TYPED EVERY PROXY (SCHEDULING)
// =============================================================================

/**
 * Handler registration function returned by scheduling chains.
 * Returns void when called with a handler.
 */
export type ScheduleRegisterFn = (handler: ScheduleHandler) => void

/**
 * Time-specific accessor for scheduling (e.g., .at('9am') or .at9am).
 * Returns a function that accepts a handler.
 */
export interface TimeAccessor {
  /** Dynamic time: .at('9am'), .at('3:45pm') */
  (time: string): ScheduleRegisterFn
}

/**
 * Day of week proxy for week-based scheduling.
 */
export interface DayOfWeekProxy extends ScheduleRegisterFn {
  // Time accessors
  at: TimeAccessor
  at6am: ScheduleRegisterFn
  at7am: ScheduleRegisterFn
  at8am: ScheduleRegisterFn
  at9am: ScheduleRegisterFn
  at10am: ScheduleRegisterFn
  at11am: ScheduleRegisterFn
  at12pm: ScheduleRegisterFn
  atnoon: ScheduleRegisterFn
  at1pm: ScheduleRegisterFn
  at2pm: ScheduleRegisterFn
  at3pm: ScheduleRegisterFn
  at4pm: ScheduleRegisterFn
  at5pm: ScheduleRegisterFn
  at6pm: ScheduleRegisterFn
  at7pm: ScheduleRegisterFn
  at8pm: ScheduleRegisterFn
  at9pm: ScheduleRegisterFn
  atmidnight: ScheduleRegisterFn
}

/**
 * Interval unit proxy for numeric intervals (e.g., every(5).minutes).
 */
export interface IntervalUnitProxy {
  seconds: ScheduleRegisterFn
  minutes: ScheduleRegisterFn
  hours: ScheduleRegisterFn
  days: ScheduleRegisterFn
  weeks: ScheduleRegisterFn
}

/**
 * Week proxy with .on accessor for day selection.
 */
export interface WeekProxy extends ScheduleRegisterFn {
  on: {
    Monday: DayOfWeekProxy
    Tuesday: DayOfWeekProxy
    Wednesday: DayOfWeekProxy
    Thursday: DayOfWeekProxy
    Friday: DayOfWeekProxy
    Saturday: DayOfWeekProxy
    Sunday: DayOfWeekProxy
  }
  at: TimeAccessor
}

/**
 * Fully typed EveryProxy for the scheduling DSL.
 *
 * Supports patterns like:
 * - $.every.Monday.at9am(handler)
 * - $.every.day.at('6pm')(handler)
 * - $.every.hour(handler)
 * - $.every(5).minutes(handler)
 * - $.every.week.on.Friday.at('3pm')(handler)
 */
export interface TypedEveryProxy extends ScheduleRegisterFn {
  // Numeric interval: $.every(5).minutes(handler)
  (value: number): IntervalUnitProxy

  // Days of week
  Monday: DayOfWeekProxy
  Tuesday: DayOfWeekProxy
  Wednesday: DayOfWeekProxy
  Thursday: DayOfWeekProxy
  Friday: DayOfWeekProxy
  Saturday: DayOfWeekProxy
  Sunday: DayOfWeekProxy

  // Time units
  second: ScheduleRegisterFn
  minute: ScheduleRegisterFn
  hour: ScheduleRegisterFn
  day: DayOfWeekProxy
  week: WeekProxy
  month: ScheduleRegisterFn
  year: ScheduleRegisterFn

  // Special patterns
  weekday: DayOfWeekProxy
  weekend: DayOfWeekProxy
  midnight: ScheduleRegisterFn
  noon: ScheduleRegisterFn
}

/**
 * Legacy untyped EveryProxy (backward compatible).
 * Uses interface with index signature for recursive Proxy pattern.
 * This is an intentional use of index signature for runtime Proxy behavior.
 */
export interface EveryProxy {
  [key: string]: EveryProxy
  (handler: () => Promise<void>): void
  (value: number): { [unit: string]: (handler: () => Promise<void>) => void }
}

// =============================================================================
// BASE WORKFLOW CONTEXT (UNTYPED)
// =============================================================================

/**
 * Base interface for WorkflowContext without DO binding types.
 * Used internally and for backward compatibility.
 */
export interface BaseWorkflowContext {
  // Durability levels
  /** Fire-and-forget event emission */
  send(event: { type: string; payload?: unknown }): void
  /** Single attempt execution (no retries) */
  try<T>(action: () => Promise<T>): Promise<T>
  /** Durable execution with retries */
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>

  // Event handlers (Proxy-based) - untyped version
  on: import('./on').OnProxy

  // Scheduling DSL - untyped version
  every: EveryProxy

  // Internal state (prefixed with _ to indicate private)
  _events: EventsStore
  _handlers: Map<string, EventHandler[]>
  _schedules: Map<string, ScheduleRegistration>
  _stubCache: Map<string, DOStubProxy>
  _env: unknown
  _fireAndForgetErrors: FireAndForgetErrorStore
}

/**
 * Typed base interface for WorkflowContext with event schema types.
 *
 * @template E - Event schemas for typed event handlers
 */
export interface TypedBaseWorkflowContext<E extends EventSchemasConstraint = EmptyEventSchemas> {
  // Durability levels
  /** Fire-and-forget event emission */
  send(event: { type: string; payload?: unknown }): void
  /** Single attempt execution (no retries) */
  try<T>(action: () => Promise<T>): Promise<T>
  /** Durable execution with retries */
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>

  // Event handlers (Proxy-based) - TYPED version
  on: TypedOnProxy<E>

  // Scheduling DSL - TYPED version
  every: TypedEveryProxy

  // Internal state (prefixed with _ to indicate private)
  _events: EventsStore
  _handlers: Map<string, EventHandler[]>
  _schedules: Map<string, ScheduleRegistration>
  _stubCache: Map<string, DOStubProxy>
  _env: unknown
  _fireAndForgetErrors: FireAndForgetErrorStore
}

// =============================================================================
// TYPED WORKFLOW CONTEXT
// =============================================================================

/**
 * Type that adds DO binding accessors to the base context.
 * For each binding name K in T, adds a method $.K(id) that returns a typed stub.
 *
 * @template T - The DO bindings map type
 */
export type DOBindingAccessors<T extends DOBindingsConstraint> = {
  [K in keyof T]: TypedDOStubFactory<T[K]>
}

/**
 * Fully typed WorkflowContext with DO binding and event schema inference.
 *
 * @template B - The DO bindings map type (default: EmptyBindings for untyped usage)
 * @template E - The event schemas type (default: EmptyEventSchemas for untyped usage)
 *
 * @example
 * ```typescript
 * interface DOBindings {
 *   Customer: CustomerDO
 *   Order: OrderDO
 * }
 *
 * interface EventSchemas {
 *   'Customer.signup': { customerId: string; email: string }
 *   'Order.placed': { orderId: string; total: number }
 * }
 *
 * type $ = TypedWorkflowContext<DOBindings, EventSchemas>
 *
 * // Usage:
 * const $ = createTypedContext<DOBindings, EventSchemas>(state, env)
 *
 * // Cross-DO RPC is fully typed
 * const customer = $.Customer('user-123')
 * const profile = await customer.getProfile() // Fully typed!
 *
 * // Event handlers are fully typed
 * $.on.Customer.signup((event) => {
 *   console.log(event.payload.email) // Typed as string
 * })
 *
 * // Scheduling has proper return types
 * $.every.Monday.at('9am')(async () => {
 *   await generateReport()
 * })
 * ```
 */
export type TypedWorkflowContext<
  B extends DOBindingsConstraint = EmptyBindings,
  E extends EventSchemasConstraint = EmptyEventSchemas
> = TypedBaseWorkflowContext<E> & DOBindingAccessors<B>

/**
 * TypedWorkflowContext with dynamic property access for unknown bindings.
 * Use this type when you need to access DO bindings not defined in B.
 */
export type TypedWorkflowContextWithDynamic<
  B extends DOBindingsConstraint = EmptyBindings,
  E extends EventSchemasConstraint = EmptyEventSchemas
> = TypedWorkflowContext<B, E> & Record<string, unknown>

/**
 * Legacy WorkflowContext type (untyped, backward compatible).
 * Cross-DO RPC is accessed dynamically via $.Customer(id), $.Worker(id), etc.
 * using JavaScript Proxy. For dynamic access, use WorkflowContextWithDynamic.
 */
export type WorkflowContext = BaseWorkflowContext

/**
 * WorkflowContext with dynamic property access for DO RPC proxies.
 * Use this when accessing DO bindings dynamically.
 */
export type WorkflowContextWithDynamic = WorkflowContext & Record<string, DOStubFactory | unknown>

/**
 * Short alias for WorkflowContext (common in codebase).
 */
export type $ = WorkflowContext

/**
 * Short alias for TypedWorkflowContext.
 *
 * @template B - The DO bindings map type
 * @template E - The event schemas type
 */
export type $Typed<
  B extends DOBindingsConstraint = EmptyBindings,
  E extends EventSchemasConstraint = EmptyEventSchemas
> = TypedWorkflowContext<B, E>

// =============================================================================
// TYPE HELPERS
// =============================================================================

/**
 * Extract the DO interface type from a binding name.
 *
 * @template T - The DO bindings map
 * @template K - The binding name
 */
export type DOTypeFromBinding<
  T extends DOBindingsConstraint,
  K extends keyof T
> = T[K]

/**
 * Extract the stub type for a specific binding.
 *
 * @template T - The DO bindings map
 * @template K - The binding name
 */
export type StubTypeForBinding<
  T extends DOBindingsConstraint,
  K extends keyof T
> = TypedDOStubProxy<T[K]>

/**
 * Infer DO bindings from an environment type.
 * Extracts binding names that have DurableObjectNamespace values.
 *
 * @template Env - The environment type
 */
export type InferDOBindings<Env> = {
  [K in keyof Env as Env[K] extends DurableObjectNamespace ? K : never]: object
}

/**
 * Create a typed bindings definition from binding names and their DO types.
 *
 * @example
 * ```typescript
 * type MyBindings = DefineDOBindings<{
 *   Customer: CustomerDO
 *   Order: OrderDO
 * }>
 * ```
 */
export type DefineDOBindings<T extends DOBindingsConstraint> = T

/**
 * Create a typed event schemas definition.
 *
 * @example
 * ```typescript
 * type MyEvents = DefineEventSchemas<{
 *   'Customer.signup': { customerId: string; email: string }
 *   'Order.placed': { orderId: string; total: number }
 * }>
 * ```
 */
export type DefineEventSchemas<T extends EventSchemasConstraint> = T

/**
 * Extract all event types (as string union) from event schemas.
 *
 * @example
 * ```typescript
 * type Events = EventTypes<MyEventSchemas>
 * // 'Customer.signup' | 'Customer.updated' | 'Order.placed'
 * ```
 */
export type EventTypes<E extends EventSchemasConstraint> = keyof E & string

/**
 * Extract the payload type for a specific event.
 *
 * @example
 * ```typescript
 * type SignupPayload = EventPayload<MyEventSchemas, 'Customer.signup'>
 * // { customerId: string; email: string }
 * ```
 */
export type EventPayload<
  E extends EventSchemasConstraint,
  T extends keyof E
> = E[T]

/**
 * Type for a typed send() method that validates event types.
 */
export type TypedSend<E extends EventSchemasConstraint> = <T extends keyof E & string>(
  event: { type: T; payload?: E[T] }
) => void

// =============================================================================
// CONTEXT CREATION HELPERS
// =============================================================================

/**
 * Configuration for creating a typed workflow context.
 *
 * @template B - The DO bindings map type
 * @template E - The event schemas type
 */
export interface TypedContextConfig<
  B extends DOBindingsConstraint = EmptyBindings,
  E extends EventSchemasConstraint = EmptyEventSchemas
> {
  /** The DO bindings type (for type inference only, not used at runtime) */
  bindings?: B
  /** The event schemas type (for type inference only, not used at runtime) */
  events?: E
}

/**
 * Options for the createTypedContext function.
 */
export interface CreateTypedContextOptions {
  /** Enable debug logging for RPC calls */
  debug?: boolean
  /** Custom error store for fire-and-forget errors */
  errorStore?: FireAndForgetErrorStore
}

// =============================================================================
// RE-EXPORTS FOR CONVENIENCE
// =============================================================================

// Re-export related types that users commonly need
export type { EventHandler } from './on'
export type { ScheduleRegistration, ScheduleHandler, ScheduleInterval } from './schedule'
export type { Event } from '@dotdo/db'
