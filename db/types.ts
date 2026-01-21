// Core types for @dotdo/db
// See do-luhm.21 - Replace Record<string, unknown> with bounded generics
// See do-grp5.12 - Replace Record<string,unknown> with StorableData

/**
 * JSON primitive types that can be stored in the database
 */
export type JsonPrimitive = string | number | boolean | null

/**
 * JSON array type for database storage
 */
export type JsonArray = JsonValue[]

/**
 * JSON-safe value type for database storage
 * This type represents all valid JSON values that can be safely serialized/deserialized
 * Excludes undefined, functions, symbols, and other non-JSON types
 */
export type JsonValue = JsonPrimitive | JsonArray | JsonObject

/**
 * JSON object type - an object with string keys and JsonValue values
 */
export type JsonObject = { [key: string]: JsonValue }

/**
 * Constraint type for data that can be stored in the database
 * Use this to bound generic type parameters for entity data
 *
 * This type improves type safety over Record<string, unknown> by:
 * - Excluding functions (not JSON serializable)
 * - Excluding undefined (use null instead)
 * - Excluding symbols (not JSON serializable)
 * - Ensuring all values are JSON-safe
 *
 * @example
 * ```typescript
 * // Used for Thing.data, Event.payload, Relationship metadata
 * interface Customer extends StorableData {
 *   name: string
 *   email: string
 *   age: number
 * }
 * ```
 */
export type StorableData = Record<string, JsonValue>

/**
 * Generic condition type for WHERE clauses and filters
 * Replaces Record<string, unknown> in query conditions
 */
export type WhereConditions<T extends StorableData = StorableData> = Partial<T>
