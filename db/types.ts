// Core types for @dotdo/db
// See do-luhm.21 - Replace Record<string, unknown> with bounded generics

/**
 * JSON primitive type - basic JSON values (string, number, boolean, null)
 */
export type JsonPrimitive = string | number | boolean | null

/**
 * JSON array type - an array of JSON values
 */
export type JsonArray = JsonValue[]

/**
 * JSON-safe value type for database storage
 * This type represents all valid JSON values that can be safely serialized/deserialized
 */
export type JsonValue =
  | JsonPrimitive
  | JsonArray
  | { [key: string]: JsonValue }

/**
 * JSON object type - an object with string keys and JsonValue values
 */
export type JsonObject = { [key: string]: JsonValue }

/**
 * Constraint type for data that can be stored in the database
 * Use this to bound generic type parameters for entity data
 *
 * Includes `undefined` to support optional properties (T | undefined)
 * which is how TypeScript represents optional interface members.
 * During serialization, undefined values are stripped (JSON.stringify behavior).
 */
export type StorableData = Record<string, JsonValue | undefined>

/**
 * Generic condition type for WHERE clauses and filters
 * Replaces Record<string, unknown> in query conditions
 */
export type WhereConditions<T extends StorableData = StorableData> = Partial<T>

/**
 * Result of a SQL run operation, potentially including metadata about changes
 */
export interface SqlRunResult {
  meta?: { changes?: number } | undefined
}

/**
 * SqlStorage interface from Cloudflare Workers
 * Uses Record<string, unknown> for SQL result rows since raw SQL queries
 * can return any column types. Callers should cast to appropriate types.
 *
 * Note: Methods can return either sync or async results.
 * The real CF API is sync, but test wrappers may return promises.
 */
export interface SqlStorage {
  exec(sql: string): { results: Array<Record<string, unknown>> }
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first(): (Record<string, unknown> | null) | Promise<Record<string, unknown> | null>
      all(): { results: Array<Record<string, unknown>> } | Promise<{ results: Array<Record<string, unknown>> }>
      run(): SqlRunResult | Promise<SqlRunResult>
    }
  }
}

/**
 * Type guard to check if a value is a valid JsonValue.
 *
 * @param value - The value to check
 * @returns True if the value is a valid JsonValue
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value === 'object') {
    return Object.values(value).every(v => v === undefined || isJsonValue(v))
  }
  return false
}

/**
 * Convert a StorableData object to a JsonObject by stripping undefined values.
 *
 * StorableData may contain `undefined` values (for optional properties), but
 * JsonValue does not allow `undefined`. This function performs the conversion
 * safely by:
 * 1. Removing keys with undefined values
 * 2. Recursively converting nested objects
 * 3. Type-narrowing the result to JsonObject
 *
 * This replaces unsafe `thing as unknown as JsonValue` casts.
 *
 * @param data - The StorableData to convert
 * @returns A JsonObject with undefined values stripped
 *
 * @example
 * ```typescript
 * const thing = { $id: '123', name: 'Alice', age: undefined }
 * const json = toJsonObject(thing)
 * // { $id: '123', name: 'Alice' } - age key is removed
 * ```
 */
export function toJsonObject(data: StorableData): JsonObject {
  const result: JsonObject = {}

  for (const [key, value] of Object.entries(data)) {
    // Skip undefined values (JSON.stringify behavior)
    if (value === undefined) continue

    // Recursively convert nested objects
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = toJsonObject(value as StorableData)
    } else {
      result[key] = value
    }
  }

  return result
}
