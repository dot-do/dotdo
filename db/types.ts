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
 */
export type StorableData = Record<string, JsonValue>

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
