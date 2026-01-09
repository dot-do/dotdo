// ============================================================================
// BRANDED ID TYPES
// ============================================================================
//
// Branded types (also known as opaque types or nominal types) prevent mixing up
// different ID types at compile time. At runtime, they are just strings, but
// TypeScript treats them as distinct types.
//
// Usage:
//   const thingId: ThingId = createThingId('thing-123')
//   const actionId: ActionId = createActionId('action-456')
//
//   // Type error! ThingId is not assignable to ActionId
//   const wrong: ActionId = thingId
//
// Reference: dotdo-h1cz - Create branded ID types
// ============================================================================

/**
 * Unique symbol used for branding types.
 * This is never actually accessed at runtime - it's purely for type discrimination.
 */
declare const __brand: unique symbol

/**
 * Brand utility type that adds a nominal type tag to a base type.
 * The branded type is structurally compatible with the base type (can be used where base is expected),
 * but the base type cannot be directly assigned to the branded type.
 *
 * @template T - The base type to brand (e.g., string)
 * @template B - The brand identifier (a unique string literal)
 */
type Brand<T, B extends string> = T & { readonly [__brand]: B }

// ============================================================================
// BRANDED ID TYPES
// ============================================================================

/**
 * Branded type for Thing IDs.
 * Things are the core data entities with versioning.
 *
 * @example
 * const id: ThingId = createThingId('acme')
 * const id: ThingId = createThingId('headless.ly')
 */
export type ThingId = Brand<string, 'ThingId'>

/**
 * Branded type for Action IDs.
 * Actions are the source of truth for all mutations (append-only command log).
 *
 * @example
 * const id: ActionId = createActionId('550e8400-e29b-41d4-a716-446655440000')
 */
export type ActionId = Brand<string, 'ActionId'>

/**
 * Branded type for Event IDs.
 * Events are domain events emitted after actions complete.
 *
 * @example
 * const id: EventId = createEventId('evt-123')
 */
export type EventId = Brand<string, 'EventId'>

/**
 * Branded type for Noun IDs.
 * Nouns define the schema/type for Things.
 *
 * @example
 * const id: NounId = createNounId('Startup')
 * const id: NounId = createNounId('Customer')
 */
export type NounId = Brand<string, 'NounId'>

// ============================================================================
// CREATOR FUNCTIONS
// ============================================================================

/**
 * Creates a branded ThingId from a string.
 *
 * @param value - The string value to brand as ThingId
 * @returns A branded ThingId
 *
 * @example
 * const thingId = createThingId('acme')
 * // thingId has type ThingId, not string
 */
export function createThingId(value: string): ThingId {
  return value as ThingId
}

/**
 * Creates a branded ActionId from a string.
 *
 * @param value - The string value to brand as ActionId
 * @returns A branded ActionId
 *
 * @example
 * const actionId = createActionId('550e8400-e29b-41d4-a716-446655440000')
 */
export function createActionId(value: string): ActionId {
  return value as ActionId
}

/**
 * Creates a branded EventId from a string.
 *
 * @param value - The string value to brand as EventId
 * @returns A branded EventId
 *
 * @example
 * const eventId = createEventId('evt-123')
 */
export function createEventId(value: string): EventId {
  return value as EventId
}

/**
 * Creates a branded NounId from a string.
 *
 * @param value - The string value to brand as NounId
 * @returns A branded NounId
 *
 * @example
 * const nounId = createNounId('Startup')
 */
export function createNounId(value: string): NounId {
  return value as NounId
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard that narrows a string to ThingId.
 * At runtime, this always returns true since ThingId is just a branded string.
 * The value is in the type narrowing for TypeScript.
 *
 * @param value - The string to check
 * @returns true, narrowing the type to ThingId
 *
 * @example
 * const maybeId: string = 'thing-123'
 * if (isThingId(maybeId)) {
 *   // maybeId is now typed as ThingId
 *   processThingId(maybeId)
 * }
 */
export function isThingId(value: string): value is ThingId {
  return typeof value === 'string'
}

/**
 * Type guard that narrows a string to ActionId.
 *
 * @param value - The string to check
 * @returns true, narrowing the type to ActionId
 */
export function isActionId(value: string): value is ActionId {
  return typeof value === 'string'
}

/**
 * Type guard that narrows a string to EventId.
 *
 * @param value - The string to check
 * @returns true, narrowing the type to EventId
 */
export function isEventId(value: string): value is EventId {
  return typeof value === 'string'
}

/**
 * Type guard that narrows a string to NounId.
 *
 * @param value - The string to check
 * @returns true, narrowing the type to NounId
 */
export function isNounId(value: string): value is NounId {
  return typeof value === 'string'
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Extracts the base string type from any branded ID type.
 * Useful when you need to work with the underlying string.
 *
 * @example
 * type BaseType = UnbrandedId<ThingId> // string
 */
export type UnbrandedId<T extends Brand<string, string>> = T extends Brand<infer U, string> ? U : never

/**
 * Union type of all branded ID types.
 * Useful for functions that can accept any kind of ID.
 *
 * @example
 * function logId(id: AnyId): void {
 *   console.log(`ID: ${id}`)
 * }
 */
export type AnyId = ThingId | ActionId | EventId | NounId

/**
 * Type to check if a type is a branded ID.
 *
 * @example
 * type IsThingIdBranded = IsBrandedId<ThingId> // true
 * type IsStringBranded = IsBrandedId<string> // false
 */
export type IsBrandedId<T> = T extends Brand<string, string> ? true : false
