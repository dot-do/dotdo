// Core types for @dotdo/db
// See do-luhm.21 - Replace Record<string, unknown> with bounded generics

/**
 * JSON-safe value type for database storage
 * This type represents all valid JSON values that can be safely serialized/deserialized
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * JSON object type - an object with string keys and JsonValue values
 */
export type JsonObject = { [key: string]: JsonValue }

/**
 * Constraint type for data that can be stored in the database
 * Use this to bound generic type parameters for entity data
 */
export type StorableData = Record<string, JsonValue>

/**
 * Generic condition type for WHERE clauses and filters
 * Replaces Record<string, unknown> in query conditions
 */
export type WhereConditions<T extends StorableData = StorableData> = Partial<T>
