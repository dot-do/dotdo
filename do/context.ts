/**
 * WorkflowContext ($) - Re-exports from workflow module
 *
 * This file maintains backward compatibility by re-exporting
 * the WorkflowContext from the new workflow/ module.
 *
 * @module do/context
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
 *
 * DESIGN NOTE: Type casting is necessary here (do-6dc7.11)
 *
 * This function uses a single `as` cast (not double cast) to convert WorkflowContext
 * to TypedWorkflowContext<B, E>. This is necessary because:
 *
 * 1. The runtime structure returned by createContext() is WorkflowContext wrapped in
 *    a Proxy (via createDORPCProxy) that dynamically provides DO binding accessors
 *
 * 2. TypeScript cannot express this dynamic property access pattern without either:
 *    - Index signatures (too loose, allows any property)
 *    - Explicit type cast (what we use)
 *
 * 3. The cast is safe at runtime because:
 *    - createContext() returns the correct proxy structure
 *    - All properties accessed via $.Customer(id), $.on, $.every, etc. are
 *      properly validated by the Proxy handler
 *    - DO bindings are looked up from `env` with proper error handling
 *
 * 4. Alternatives considered:
 *    - Adding `Record<string, unknown>` to WorkflowContext: Too loose, loses type info
 *    - Using index signatures: Same problem as above
 *    - Generating context factory per binding: Would require build-time code generation
 *
 * The cast is a pragmatic trade-off: we get full type safety for users (proper
 * inference in their code) at the cost of one cast at this boundary.
 */
export function createTypedContext<
  B extends DOBindingsConstraint = EmptyBindings,
  E extends EventSchemasConstraint = EmptyEventSchemas
>(
  state: DurableObjectState,
  env: unknown,
  options?: CreateTypedContextOptions
): TypedWorkflowContext<B, E> {
  // Single cast: WorkflowContext → TypedWorkflowContext<B, E>
  //
  // Safe because createContext() returns WorkflowContext wrapped in a Proxy
  // (via createDORPCProxy) that provides dynamic DO binding accessors.
  // These accessors are type-safe at the boundary but look like generic
  // Record<string, DOStubFactory> to TypeScript.
  return createContext(state, env, options) as TypedWorkflowContext<B, E>
}
