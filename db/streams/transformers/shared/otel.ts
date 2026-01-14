/**
 * Shared Utilities for Stream Transformers
 *
 * Common utilities for transforming various data formats
 * to the unified event schema.
 *
 * @module db/streams/transformers/utils
 */

// ============================================================================
// OTLP Attribute Types (shared across OTEL transformers)
// ============================================================================

/**
 * OTLP attribute value - can be various primitive types or arrays.
 * Used by spans, metrics, and logs transformers.
 */
export interface OtlpAttributeValue {
  stringValue?: string
  intValue?: string // OTLP uses string for int64
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: {
    values: OtlpAttributeValue[]
  }
  kvlistValue?: {
    values: Array<{ key: string; value: OtlpAttributeValue }>
  }
  bytesValue?: string // base64 encoded
}

/**
 * OTLP key-value attribute pair.
 */
export interface OtlpAttribute {
  key: string
  value: OtlpAttributeValue
}

// ============================================================================
// Attribute Flattening
// ============================================================================

/**
 * Extracts a primitive value from an OTLP attribute value.
 * Handles string, int, double, bool, array, and kvlist types.
 */
export function extractAttributeValue(value: OtlpAttributeValue): unknown {
  if (value.stringValue !== undefined) {
    return value.stringValue
  }
  if (value.intValue !== undefined) {
    return parseInt(value.intValue, 10)
  }
  if (value.doubleValue !== undefined) {
    return value.doubleValue
  }
  if (value.boolValue !== undefined) {
    return value.boolValue
  }
  if (value.arrayValue !== undefined) {
    return value.arrayValue.values.map(extractAttributeValue)
  }
  if (value.kvlistValue !== undefined) {
    return flattenOtlpAttributes(value.kvlistValue.values)
  }
  return null
}

/**
 * Flattens an array of OTLP attributes to a plain object.
 *
 * @param attributes - Array of OTLP key-value attributes
 * @returns Plain object with flattened values, or null if empty
 *
 * @example
 * ```typescript
 * const attrs = [
 *   { key: 'http.method', value: { stringValue: 'GET' } },
 *   { key: 'http.status_code', value: { intValue: '200' } },
 * ]
 * flattenOtlpAttributes(attrs)
 * // => { 'http.method': 'GET', 'http.status_code': 200 }
 * ```
 */
export function flattenOtlpAttributes(
  attributes: OtlpAttribute[] | undefined
): Record<string, unknown> | null {
  if (!attributes || attributes.length === 0) {
    return null
  }

  const result: Record<string, unknown> = {}
  for (const attr of attributes) {
    result[attr.key] = extractAttributeValue(attr.value)
  }
  return result
}

/**
 * Gets a string attribute value by key.
 */
export function getStringAttribute(
  attributes: OtlpAttribute[] | undefined,
  key: string
): string | null {
  if (!attributes) return null
  const attr = attributes.find((a) => a.key === key)
  return attr?.value.stringValue ?? null
}

/**
 * Gets an integer attribute value by key.
 */
export function getIntAttribute(
  attributes: OtlpAttribute[] | undefined,
  key: string
): number | null {
  if (!attributes) return null
  const attr = attributes.find((a) => a.key === key)
  if (attr?.value.intValue !== undefined) {
    return parseInt(attr.value.intValue, 10)
  }
  return null
}

/**
 * Gets a double/float attribute value by key.
 */
export function getDoubleAttribute(
  attributes: OtlpAttribute[] | undefined,
  key: string
): number | null {
  if (!attributes) return null
  const attr = attributes.find((a) => a.key === key)
  return attr?.value.doubleValue ?? null
}

/**
 * Gets a boolean attribute value by key.
 */
export function getBoolAttribute(
  attributes: OtlpAttribute[] | undefined,
  key: string
): boolean | null {
  if (!attributes) return null
  const attr = attributes.find((a) => a.key === key)
  return attr?.value.boolValue ?? null
}

// ============================================================================
// Nanosecond Timestamp Utilities
// ============================================================================

/**
 * Converts nanosecond timestamp string to ISO date string.
 *
 * @param nanoStr - Nanoseconds since Unix epoch as string
 * @returns ISO 8601 timestamp string
 *
 * @example
 * ```typescript
 * nanoToIso('1704067200000000000')
 * // => '2024-01-01T00:00:00.000Z'
 * ```
 */
export function nanoToIso(nanoStr: string): string {
  const nanos = BigInt(nanoStr)
  const millis = Number(nanos / BigInt(1_000_000))
  return new Date(millis).toISOString()
}

/**
 * Converts nanosecond timestamp string to BigInt.
 */
export function nanoToBigInt(nanoStr: string): bigint {
  return BigInt(nanoStr)
}

/**
 * Calculates duration in milliseconds from start and end nanosecond timestamps.
 *
 * @param startNano - Start time in nanoseconds
 * @param endNano - End time in nanoseconds
 * @returns Duration in milliseconds (can be fractional)
 */
export function calculateDurationMs(startNano: string, endNano: string): number {
  const start = BigInt(startNano)
  const end = BigInt(endNano)
  const durationNano = end - start
  // Convert to milliseconds with decimal precision
  return Number(durationNano) / 1_000_000
}

// ============================================================================
// Partition Derivation
// ============================================================================

/**
 * Derives hour (0-23) from nanosecond timestamp.
 * Used for hourly partitioning in data lake storage.
 */
export function deriveHour(nanoStr: string): number {
  const nanos = BigInt(nanoStr)
  const millis = Number(nanos / BigInt(1_000_000))
  return new Date(millis).getUTCHours()
}

/**
 * Derives day (YYYY-MM-DD) from nanosecond timestamp.
 * Used for daily partitioning in data lake storage.
 */
export function deriveDay(nanoStr: string): string {
  const nanos = BigInt(nanoStr)
  const millis = Number(nanos / BigInt(1_000_000))
  return new Date(millis).toISOString().split('T')[0]
}

/**
 * Derives hour from millisecond timestamp.
 */
export function deriveHourFromMs(ms: number): number {
  return new Date(ms).getUTCHours()
}

/**
 * Derives day from millisecond timestamp.
 */
export function deriveDayFromMs(ms: number): string {
  return new Date(ms).toISOString().split('T')[0]
}
