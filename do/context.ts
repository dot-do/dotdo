/**
 * WorkflowContext ($) - Re-exports from workflow module
 *
 * This file maintains backward compatibility by re-exporting
 * the WorkflowContext from the new workflow/ module.
 *
 * @module do/context
 * @stable
 * @since 1.0.0
 */

// Re-export everything from the workflow module
export {
  createContext,
  type WorkflowContext,
  type $,
  type DoOptions,
  type DOStubFactory,
  type CreateContextOptions,
  type EventHandler,
  type OnProxy,
  type RetryOptions,
  type ScheduleHandler,
  type ScheduleInterval,
  type ScheduleRegistration,
  type DOStubProxy,
} from './workflow'

// Additional imports needed for typed context
import type {
  TypedWorkflowContext,
  DOBindingsConstraint,
  EventSchemasConstraint,
  EmptyBindings,
  EmptyEventSchemas,
  CreateTypedContextOptions
} from './types'

import { createContext } from './workflow'

/**
 * Creates a typed WorkflowContext with full type inference for DO bindings and events.
 *
 * This is a type-safe wrapper around createContext that provides:
 * - Typed cross-DO RPC calls: $.Customer(id).method() with proper return types
 * - Typed event handlers: $.on.Customer.signup(handler) with typed event payloads
 * - Typed scheduling: $.every.Monday.at('9am')(handler) with proper return types
 *
 * @template B - DO bindings map (maps binding names to DO interface types)
 * @template E - Event schemas map (maps 'Noun.verb' to payload types)
 *
 * @param state - The DurableObjectState
 * @param env - The environment containing DO namespace bindings
 * @param options - Optional configuration
 *
 * @stable
 * @since 1.1.0
 *
 * @example
 * ```typescript
 * // Define your DO interfaces
 * interface CustomerDO {
 *   getProfile(): Promise<{ name: string; email: string }>
 *   notify(params: { message: string }): Promise<{ delivered: boolean }>
 * }
 *
 * interface OrderDO {
 *   ship(): Promise<{ status: string }>
 *   getItems(): Promise<string[]>
 * }
 *
 * // Define DO bindings map
 * interface DOBindings {
 *   Customer: CustomerDO
 *   Order: OrderDO
 * }
 *
 * // Define event schemas
 * interface EventSchemas {
 *   'Customer.signup': { customerId: string; email: string; plan: string }
 *   'Order.placed': { orderId: string; items: string[]; total: number }
 * }
 *
 * // Create typed context
 * const $ = createTypedContext<DOBindings, EventSchemas>(state, env)
 *
 * // Now get full type inference!
 * const customer = $.Customer('user-123')
 * const profile = await customer.getProfile()  // Typed as { name: string; email: string }
 *
 * $.on.Customer.signup((event) => {
 *   // event.payload is typed as { customerId: string; email: string; plan: string }
 *   console.log(event.payload.email)
 * })
 *
 * $.every.Monday.at('9am')(async () => {
 *   await generateWeeklyReport()
 * })
 * ```
 */
export function createTypedContext<
  B extends DOBindingsConstraint = EmptyBindings,
  E extends EventSchemasConstraint = EmptyEventSchemas
>(
  state: DurableObjectState,
  env: unknown,
  options?: CreateTypedContextOptions
): TypedWorkflowContext<B, E> {
  // The underlying createContext already creates the proper proxy structure
  // We just cast the result to the typed version for compile-time type checking
  return createContext(state, env, options) as unknown as TypedWorkflowContext<B, E>
}
