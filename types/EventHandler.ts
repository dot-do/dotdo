/**
 * EventHandler Type System
 *
 * Provides typed event handlers for domain events. This replaces the `any` type
 * used in workflows/on.ts handler signatures with proper generics.
 *
 * Issue: dotdo-1oyt - Type the event handler system
 *
 * @example
 * ```typescript
 * // Define typed event handler
 * const handleCustomerCreated: TypedEventHandler<CustomerCreatedPayload> = async (event) => {
 *   // event.data is typed as CustomerCreatedPayload
 *   console.log(`Customer ${event.data.name} created`)
 * }
 *
 * // Register with $.on
 * $.on.Customer.created(handleCustomerCreated)
 * ```
 */

import type { DomainEvent, EventHandler } from './WorkflowContext'

// ============================================================================
// TypedDomainEvent<TPayload> - Domain event with typed payload
// ============================================================================

/**
 * A domain event with a typed payload.
 *
 * Extends the base DomainEvent structure but replaces `data: unknown`
 * with a specific payload type for type-safe access.
 *
 * @template TPayload - The type of the event payload data
 *
 * @example
 * ```typescript
 * interface CustomerCreatedPayload {
 *   customerId: string
 *   name: string
 *   email: string
 * }
 *
 * const event: TypedDomainEvent<CustomerCreatedPayload> = {
 *   id: 'evt-123',
 *   verb: 'created',
 *   source: 'https://api.example.com.ai/customers',
 *   data: { customerId: 'cust-1', name: 'John', email: 'john@example.com.ai' },
 *   timestamp: new Date()
 * }
 * ```
 */
export interface TypedDomainEvent<TPayload> {
  /** Unique event identifier */
  id: string

  /** The action/verb that occurred (e.g., 'created', 'updated', 'shipped') */
  verb: string

  /** URL of the source entity that emitted the event */
  source: string

  /** The typed event payload data */
  data: TPayload

  /** Optional action ID that triggered this event */
  actionId?: string

  /** When the event occurred */
  timestamp: Date
}

// ============================================================================
// TypedEventHandler<TPayload> - Event handler with typed payload
// ============================================================================

/**
 * An event handler function that receives events with typed payloads.
 *
 * This is the typed version of EventHandler that provides compile-time
 * type checking for the event payload.
 *
 * @template TPayload - The type of the event payload data
 *
 * @example
 * ```typescript
 * interface OrderShippedPayload {
 *   orderId: string
 *   trackingNumber: string
 *   carrier: string
 * }
 *
 * const handleOrderShipped: TypedEventHandler<OrderShippedPayload> = async (event) => {
 *   // Full type safety on event.data
 *   const { orderId, trackingNumber, carrier } = event.data
 *   await sendShippingNotification(orderId, trackingNumber, carrier)
 * }
 * ```
 */
export type TypedEventHandler<TPayload> = (
  event: TypedDomainEvent<TPayload>
) => Promise<void>

// ============================================================================
// EventPayload<Noun, Verb> - Type-level payload lookup
// ============================================================================

/**
 * Event payload registry for type-level lookup.
 *
 * This interface can be extended via declaration merging to register
 * payload types for specific Noun/Verb combinations.
 *
 * @example
 * ```typescript
 * // Extend the registry in your application:
 * declare module 'dotdo/types/EventHandler' {
 *   interface EventPayloadRegistry {
 *     Customer: {
 *       created: CustomerCreatedPayload
 *       updated: CustomerUpdatedPayload
 *     }
 *     Order: {
 *       shipped: OrderShippedPayload
 *       failed: OrderFailedPayload
 *     }
 *   }
 * }
 * ```
 */
export interface EventPayloadRegistry {
  // Base registry - extend via declaration merging
  [Noun: string]: {
    [Verb: string]: unknown
  }
}

/**
 * Look up the payload type for a specific Noun and Verb combination.
 *
 * Uses the EventPayloadRegistry to resolve types. Falls back to `unknown`
 * for unregistered event combinations.
 *
 * @template Noun - The noun/entity name (e.g., 'Customer', 'Order')
 * @template Verb - The verb/action name (e.g., 'created', 'shipped')
 *
 * @example
 * ```typescript
 * // If registered in EventPayloadRegistry:
 * type Payload = EventPayload<'Customer', 'created'> // CustomerCreatedPayload
 *
 * // If not registered:
 * type Unknown = EventPayload<'Foo', 'bar'> // unknown
 * ```
 */
export type EventPayload<Noun extends string, Verb extends string> =
  Noun extends keyof EventPayloadRegistry
    ? Verb extends keyof EventPayloadRegistry[Noun]
      ? EventPayloadRegistry[Noun][Verb]
      : unknown
    : unknown

// ============================================================================
// InferEventPayload<T> - Infer payload type from handler
// ============================================================================

/**
 * Infer the payload type from an event handler function.
 *
 * Useful for extracting the expected payload type from an existing handler.
 *
 * @template T - The event handler function type
 *
 * @example
 * ```typescript
 * const myHandler: TypedEventHandler<CustomerCreatedPayload> = async (e) => {}
 * type Payload = InferEventPayload<typeof myHandler> // CustomerCreatedPayload
 * ```
 */
export type InferEventPayload<T> =
  T extends TypedEventHandler<infer P>
    ? P
    : T extends (event: TypedDomainEvent<infer P>) => Promise<void>
      ? P
      : T extends EventHandler
        ? unknown
        : never

// ============================================================================
// Helper Types for On Proxy
// ============================================================================

/**
 * Typed version of OnNounProxy for registering handlers.
 *
 * @template Noun - The noun/entity name
 */
export type TypedOnNounProxy<Noun extends string> = {
  [Verb in string]: <TPayload = EventPayload<Noun, Verb>>(
    handler: TypedEventHandler<TPayload>
  ) => void
}

/**
 * Typed version of OnProxy for event subscriptions.
 *
 * @example
 * ```typescript
 * // Usage with the $ context
 * $.on.Customer.created((event) => {
 *   // If CustomerCreatedPayload is registered, event.data is typed
 *   console.log(event.data)
 * })
 * ```
 */
export type TypedOnProxy = {
  [Noun in string]: TypedOnNounProxy<Noun>
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if an event has a specific payload shape.
 *
 * @param event - The domain event to check
 * @param validator - A function that validates the payload
 * @returns True if the event payload matches the expected type
 *
 * @example
 * ```typescript
 * if (isTypedEvent<CustomerCreatedPayload>(event, (d) => 'customerId' in d)) {
 *   // event.data is typed as CustomerCreatedPayload
 * }
 * ```
 */
export function isTypedEvent<TPayload>(
  event: DomainEvent | TypedDomainEvent<unknown>,
  validator: (data: unknown) => data is TPayload
): event is TypedDomainEvent<TPayload> {
  return validator(event.data)
}

/**
 * Assert that an event has a specific payload type.
 *
 * @param event - The domain event to assert
 * @returns The event with typed payload
 * @throws If called at runtime (this is primarily for type narrowing)
 *
 * @example
 * ```typescript
 * const typedEvent = assertEventPayload<CustomerCreatedPayload>(event)
 * console.log(typedEvent.data.customerId) // Type-safe access
 * ```
 */
export function assertEventPayload<TPayload>(
  event: DomainEvent | TypedDomainEvent<unknown>
): TypedDomainEvent<TPayload> {
  return event as TypedDomainEvent<TPayload>
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract the noun from an event key string (e.g., 'Customer.created' -> 'Customer')
 */
export type ExtractNoun<T extends string> = T extends `${infer N}.${string}` ? N : never

/**
 * Extract the verb from an event key string (e.g., 'Customer.created' -> 'created')
 */
export type ExtractVerb<T extends string> = T extends `${string}.${infer V}` ? V : never

/**
 * Create an event key from noun and verb (e.g., 'Customer' + 'created' -> 'Customer.created')
 */
export type EventKey<Noun extends string, Verb extends string> = `${Noun}.${Verb}`
