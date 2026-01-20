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

import type { EventsStore, Event } from '../db'
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
// EVERY PROXY (SCHEDULING)
// =============================================================================

/**
 * Proxy type for the $.every scheduling DSL.
 * Supports fluent chaining like $.every.Monday.at('9am')(handler)
 */
export type EveryProxy = {
  [key: string]: EveryProxy
} & {
  (handler: () => Promise<void>): void
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

  // Event handlers (Proxy-based)
  on: OnProxy

  // Scheduling DSL
  every: EveryProxy

  // Internal state (prefixed with _ to indicate private)
  _events: EventsStore
  _handlers: Map<string, EventHandler[]>
  _schedules: Map<string, ScheduleRegistration>
  _stubCache: Map<string, DOStubProxy>
  _env: unknown
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
 * Fully typed WorkflowContext with DO binding inference.
 *
 * @template T - The DO bindings map type (default: EmptyBindings for untyped usage)
 *
 * @example
 * ```typescript
 * interface DOBindings {
 *   Customer: CustomerDO
 *   Order: OrderDO
 * }
 *
 * type $ = TypedWorkflowContext<DOBindings>
 *
 * // Usage:
 * const $ = createTypedContext<DOBindings>(state, env)
 * const customer = $.Customer('user-123')
 * const profile = await customer.getProfile() // Fully typed!
 * ```
 */
export type TypedWorkflowContext<T extends DOBindingsConstraint = EmptyBindings> =
  BaseWorkflowContext & DOBindingAccessors<T> & {
    // Allow dynamic access for bindings not in T (returns untyped proxy)
    [key: string]: unknown
  }

/**
 * Legacy WorkflowContext type (untyped, backward compatible).
 * Equivalent to TypedWorkflowContext<EmptyBindings> with loose index signature.
 */
export interface WorkflowContext extends BaseWorkflowContext {
  // Cross-DO RPC (Proxy-based)
  // Accessed dynamically via $.Customer(id), $.Worker(id), etc.
  [doName: string]: DOStubFactory | unknown
}

/**
 * Short alias for WorkflowContext (common in codebase).
 */
export type $ = WorkflowContext

/**
 * Short alias for TypedWorkflowContext.
 *
 * @template T - The DO bindings map type
 */
export type $Typed<T extends DOBindingsConstraint = EmptyBindings> = TypedWorkflowContext<T>

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

// =============================================================================
// CONTEXT CREATION HELPERS
// =============================================================================

/**
 * Configuration for creating a typed workflow context.
 *
 * @template T - The DO bindings map type
 */
export interface TypedContextConfig<T extends DOBindingsConstraint> {
  /** The DO bindings type (for type inference only, not used at runtime) */
  bindings?: T
}

/**
 * Options for the createTypedContext function.
 */
export interface CreateTypedContextOptions {
  /** Enable debug logging for RPC calls */
  debug?: boolean
}

// =============================================================================
// RE-EXPORTS FOR CONVENIENCE
// =============================================================================

// Re-export related types that users commonly need
export type { OnProxy, EventHandler } from './on'
export type { ScheduleRegistration, ScheduleHandler, ScheduleInterval } from './schedule'
export type { Event } from '../db'
