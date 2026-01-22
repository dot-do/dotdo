// Core types for @dotdo/db
// See do-luhm.21 - Replace Record<string, unknown> with bounded generics
// Type definitions moved here per do-stc2d.1 to break circular dependencies

import type { ThingId, EventId, CorrelationId } from './branded-types'

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

// =============================================================================
// Thing Types - Moved from things.ts per do-stc2d.1 to break circular deps
// =============================================================================

/**
 * Base Thing interface with system fields.
 * T extends StorableData for user-defined properties
 * Uses branded ThingId for type safety - see do-e3my
 *
 * @stable
 * @since 1.0.0
 */
export interface BaseThing {
  $id: ThingId
  $type: string
  $createdAt: number
  $updatedAt: number
}

/**
 * Thing type combining system fields with user data.
 * Use Thing<T> for typed entity storage
 *
 * @stable
 * @since 1.0.0
 */
export type Thing<T extends StorableData = StorableData> = BaseThing & T

/**
 * Input type for creating a Thing (excludes auto-generated fields)
 */
export type ThingInput<T extends StorableData = StorableData> =
  Omit<BaseThing, '$id' | '$createdAt' | '$updatedAt'> & T

/**
 * Input type for updating a Thing (excludes immutable fields)
 */
export type ThingUpdate<T extends StorableData = StorableData> =
  Partial<Omit<T, '$id' | '$type'>>

/**
 * Bulk update item with generic support
 * Uses branded ThingId for type safety
 */
export interface BulkUpdateItem<T extends StorableData = StorableData> {
  id: ThingId | string  // Accept both for backward compatibility
  data: ThingUpdate<T>
}

// =============================================================================
// Event Types - Moved from events.ts per do-stc2d.1 to break circular deps
// =============================================================================

/**
 * Base Event interface with system fields
 * P extends JsonValue for user-defined payload type
 * Uses branded EventId and CorrelationId for type safety - see do-e3my
 */
export interface BaseEvent {
  $id: EventId
  type: string
  $timestamp: number
  source?: ThingId | string  // Who emitted (thing $id, system, etc.)
  correlationId?: CorrelationId | string // For tracing related events
}

/**
 * Event type combining system fields with typed payload
 * Use Event<P> for typed event storage
 */
export interface Event<P extends JsonValue = JsonValue> extends BaseEvent {
  payload: P
}

/**
 * Input type for emitting an Event (excludes auto-generated fields)
 */
export type EventInput<P extends JsonValue = JsonValue> =
  Omit<Event<P>, '$id' | '$timestamp'>

/**
 * Retention policy for event storage
 * Used to prevent the 10GB Durable Object storage limit breach
 */
export interface RetentionPolicy {
  /** Maximum number of events to keep */
  maxEvents?: number
  /** Maximum age of events in days */
  maxAgeDays?: number
}

/**
 * Dead letter queue entry for failed events
 * P extends JsonValue for typed payload
 */
export interface DLQEntry<P extends JsonValue = JsonValue> {
  event: Event<P>
  attempts: number
  lastError: string
  timestamp: number
  handlerIndex?: number | undefined
}

/**
 * Event query options
 */
export interface EventQueryOptions {
  type?: string
  source?: string
  correlationId?: string
  since?: number
  until?: number
  limit?: number
  offset?: number
}

/**
 * Durability configuration per event type
 */
export interface DurabilityConfig {
  retries?: number
  backoff?: 'linear' | 'exponential'
  timeout?: number
}

// =============================================================================
// Relationship Types - Moved from relationships.ts per do-stc2d.1 to break circular deps
// =============================================================================

/**
 * Base Relationship interface with system fields
 * Uses branded ThingId for subject/object for type safety - see do-e3my
 */
export interface BaseRelationship {
  subject: ThingId | string    // Thing $id (accepts both for backward compat)
  predicate: string  // Verb (e.g., "owns", "created", "belongsTo")
  object: ThingId | string     // Thing $id (accepts both for backward compat)
  $createdAt: number
}

/**
 * Relationship type combining system fields with custom metadata
 * Use Relationship<M> for typed relationship metadata
 */
export type Relationship<M extends StorableData = StorableData> = BaseRelationship & M

/**
 * Input type for adding a Relationship (excludes auto-generated fields)
 */
export type RelationshipInput<M extends StorableData = StorableData> =
  Omit<BaseRelationship, '$createdAt'> & M

/**
 * Query type for finding relationships (core fields only)
 */
export type RelationshipQuery = Partial<Pick<BaseRelationship, 'subject' | 'predicate' | 'object'>>
