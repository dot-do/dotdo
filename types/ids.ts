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
// ID FORMAT PATTERNS
// ============================================================================

/**
 * Regex patterns for validating ID formats.
 */
export const ID_PATTERNS = {
  /**
   * ThingId: lowercase alphanumeric slug with dashes and dots allowed.
   * Must start with a letter. No leading/trailing special chars.
   * Excludes 'evt-' prefix to distinguish from EventId.
   * Examples: 'acme', 'my-startup', 'headless.ly', 'tenant-123'
   */
  thingId: /^[a-z][a-z0-9]*(?:[-.]?[a-z0-9]+)*$/,

  /**
   * Pattern to exclude EventId format from ThingId.
   */
  eventIdPrefix: /^evt-/i,

  /**
   * ActionId: UUID v4 format (8-4-4-4-12 hex pattern).
   * The version nibble must be 4, variant nibble must be 8, 9, a, or b.
   * Example: '550e8400-e29b-41d4-a716-446655440000'
   */
  actionId: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,

  /**
   * EventId: 'evt-' prefix followed by alphanumeric identifier.
   * Examples: 'evt-123', 'evt-abc456', 'evt-a1b2c3'
   */
  eventId: /^evt-[a-z0-9]+$/i,

  /**
   * NounId: PascalCase identifier (must start with uppercase letter).
   * Examples: 'Startup', 'Customer', 'PaymentMethod'
   */
  nounId: /^[A-Z][a-zA-Z0-9]*$/,
} as const

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard that narrows unknown to ThingId.
 * Validates that the value is a string matching the ThingId format (lowercase slug).
 * Rejects strings that match EventId format (evt-* prefix).
 *
 * @param value - The value to check
 * @returns true if the value is a valid ThingId format, narrowing the type
 *
 * @example
 * const maybeId: unknown = 'my-startup'
 * if (isThingId(maybeId)) {
 *   // maybeId is now typed as ThingId
 *   processThingId(maybeId)
 * }
 */
export function isThingId(value: unknown): value is ThingId {
  if (typeof value !== 'string') return false
  // Reject excessively long strings (security/DoS protection)
  if (value.length > 255) return false
  // Exclude EventId format (evt-* prefix)
  if (ID_PATTERNS.eventIdPrefix.test(value)) return false
  return ID_PATTERNS.thingId.test(value)
}

/**
 * Type guard that narrows unknown to ActionId.
 * Validates that the value is a string matching UUID v4 format.
 *
 * @param value - The value to check
 * @returns true if the value is a valid ActionId format, narrowing the type
 */
export function isActionId(value: unknown): value is ActionId {
  if (typeof value !== 'string') return false
  return ID_PATTERNS.actionId.test(value)
}

/**
 * Type guard that narrows unknown to EventId.
 * Validates that the value is a string with the 'evt-' prefix followed by alphanumeric id.
 *
 * @param value - The value to check
 * @returns true if the value is a valid EventId format, narrowing the type
 */
export function isEventId(value: unknown): value is EventId {
  if (typeof value !== 'string') return false
  return ID_PATTERNS.eventId.test(value)
}

/**
 * Type guard that narrows unknown to NounId.
 * Validates that the value is a string in PascalCase format.
 *
 * @param value - The value to check
 * @returns true if the value is a valid NounId format, narrowing the type
 */
export function isNounId(value: unknown): value is NounId {
  if (typeof value !== 'string') return false
  return ID_PATTERNS.nounId.test(value)
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
