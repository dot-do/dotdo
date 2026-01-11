/**
 * @dotdo/rpc - Serialization Utilities
 *
 * Handles serialization of special types like Date, Uint8Array, Error,
 * and function references for RPC transport.
 *
 * @module @dotdo/rpc/serialization
 */

import type { SerializedValue, FunctionReference } from './types.js'

// =============================================================================
// Type Constants
// =============================================================================

const TYPE_DATE = 'Date'
const TYPE_UINT8ARRAY = 'Uint8Array'
const TYPE_ERROR = 'Error'
const TYPE_FUNCTION = 'Function'
const TYPE_UNDEFINED = 'undefined'
const TYPE_BIGINT = 'BigInt'
const TYPE_MAP = 'Map'
const TYPE_SET = 'Set'
const TYPE_REGEXP = 'RegExp'

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is a serialized value marker.
 */
function isSerializedValue(value: unknown): value is SerializedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rpc_type__' in value &&
    typeof (value as SerializedValue).__rpc_type__ === 'string'
  )
}

/**
 * Check if a value is a function reference marker.
 */
function isFunctionReference(value: unknown): value is FunctionReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rpc_fn__' in value &&
    (value as FunctionReference).__rpc_fn__ === true
  )
}

// =============================================================================
// Serialization
// =============================================================================

/**
 * Serialize a value for RPC transport.
 *
 * Handles special types:
 * - Date: ISO string
 * - Uint8Array: Base64 encoded
 * - Error: { name, message, stack }
 * - Function: Reference marker
 * - BigInt: String representation
 * - Map/Set: Array of entries/values
 * - RegExp: { source, flags }
 * - undefined: Marker
 *
 * @param value - The value to serialize
 * @returns JSON-serializable value
 *
 * @example
 * ```typescript
 * const serialized = serialize({
 *   created: new Date(),
 *   data: new Uint8Array([1, 2, 3])
 * })
 * ```
 */
export function serialize(value: unknown): unknown {
  // Handle null and primitives
  if (value === null) {
    return null
  }

  if (value === undefined) {
    return { __rpc_type__: TYPE_UNDEFINED, value: null }
  }

  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }

  // Handle BigInt
  if (typeof value === 'bigint') {
    return { __rpc_type__: TYPE_BIGINT, value: value.toString() }
  }

  // Handle Date
  if (value instanceof Date) {
    return { __rpc_type__: TYPE_DATE, value: value.toISOString() }
  }

  // Handle Uint8Array (and other typed arrays)
  if (value instanceof Uint8Array) {
    return {
      __rpc_type__: TYPE_UINT8ARRAY,
      value: uint8ArrayToBase64(value),
    }
  }

  // Handle Error
  if (value instanceof Error) {
    return {
      __rpc_type__: TYPE_ERROR,
      value: {
        name: value.name,
        message: value.message,
        stack: value.stack,
      },
    }
  }

  // Handle RegExp
  if (value instanceof RegExp) {
    return {
      __rpc_type__: TYPE_REGEXP,
      value: { source: value.source, flags: value.flags },
    }
  }

  // Handle Map
  if (value instanceof Map) {
    return {
      __rpc_type__: TYPE_MAP,
      value: Array.from(value.entries()).map(([k, v]) => [serialize(k), serialize(v)]),
    }
  }

  // Handle Set
  if (value instanceof Set) {
    return {
      __rpc_type__: TYPE_SET,
      value: Array.from(value.values()).map(serialize),
    }
  }

  // Handle Function
  if (typeof value === 'function') {
    return {
      __rpc_fn__: true,
      name: value.name || undefined,
    } as FunctionReference
  }

  // Handle Array
  if (Array.isArray(value)) {
    return value.map(serialize)
  }

  // Handle plain objects
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = serialize(val)
    }
    return result
  }

  // Fallback: return as-is
  return value
}

/**
 * Deserialize a value from RPC transport.
 *
 * Reconstructs special types from their serialized form.
 *
 * @param value - The serialized value
 * @returns The deserialized value
 *
 * @example
 * ```typescript
 * const data = deserialize(serialized)
 * data.created // Date object
 * data.data // Uint8Array
 * ```
 */
export function deserialize(value: unknown): unknown {
  // Handle null and primitives
  if (value === null) {
    return null
  }

  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }

  // Handle array
  if (Array.isArray(value)) {
    return value.map(deserialize)
  }

  // Handle function reference
  if (isFunctionReference(value)) {
    return value // Return as-is so tests can check for it
  }

  // Handle serialized values
  if (isSerializedValue(value)) {
    switch (value.__rpc_type__) {
      case TYPE_DATE:
        return new Date(value.value as string)

      case TYPE_UINT8ARRAY:
        return base64ToUint8Array(value.value as string)

      case TYPE_ERROR: {
        const errorData = value.value as { name: string; message: string; stack?: string }
        const error = new Error(errorData.message)
        error.name = errorData.name
        if (errorData.stack) {
          error.stack = errorData.stack
        }
        return error
      }

      case TYPE_BIGINT:
        return BigInt(value.value as string)

      case TYPE_REGEXP: {
        const regexData = value.value as { source: string; flags: string }
        return new RegExp(regexData.source, regexData.flags)
      }

      case TYPE_MAP: {
        const entries = value.value as Array<[unknown, unknown]>
        return new Map(entries.map(([k, v]) => [deserialize(k), deserialize(v)]))
      }

      case TYPE_SET: {
        const values = value.value as unknown[]
        return new Set(values.map(deserialize))
      }

      case TYPE_UNDEFINED:
        return undefined

      default:
        // Unknown type - return as-is
        return value.value
    }
  }

  // Handle plain objects
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deserialize(val)
    }
    return result
  }

  return value
}

// =============================================================================
// Base64 Helpers
// =============================================================================

/**
 * Convert Uint8Array to Base64 string.
 */
function uint8ArrayToBase64(data: Uint8Array): string {
  // Browser and modern Node.js
  if (typeof btoa === 'function') {
    return btoa(String.fromCharCode(...data))
  }

  // Node.js fallback using globalThis to avoid TypeScript errors
  const NodeBuffer = (globalThis as unknown as { Buffer?: typeof import('buffer').Buffer }).Buffer
  if (NodeBuffer !== undefined) {
    return NodeBuffer.from(data).toString('base64')
  }

  // Manual fallback (shouldn't reach here normally)
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = ''
  const len = data.length

  for (let i = 0; i < len; i += 3) {
    const a = data[i]
    const b = i + 1 < len ? data[i + 1] : 0
    const c = i + 2 < len ? data[i + 2] : 0

    result += CHARS[a >> 2]
    result += CHARS[((a & 3) << 4) | (b >> 4)]
    result += i + 1 < len ? CHARS[((b & 15) << 2) | (c >> 6)] : '='
    result += i + 2 < len ? CHARS[c & 63] : '='
  }

  return result
}

/**
 * Convert Base64 string to Uint8Array.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  // Browser and modern Node.js
  if (typeof atob === 'function') {
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  // Node.js fallback using globalThis to avoid TypeScript errors
  const NodeBuffer = (globalThis as unknown as { Buffer?: typeof import('buffer').Buffer }).Buffer
  if (NodeBuffer !== undefined) {
    return new Uint8Array(NodeBuffer.from(base64, 'base64'))
  }

  // Manual fallback
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lookup = new Uint8Array(256)
  for (let i = 0; i < 64; i++) {
    lookup[CHARS.charCodeAt(i)] = i
  }

  // Remove padding
  let len = base64.length
  while (base64[len - 1] === '=') len--

  const bytes = new Uint8Array((len * 3) / 4)
  let p = 0

  for (let i = 0; i < len; i += 4) {
    const a = lookup[base64.charCodeAt(i)]
    const b = lookup[base64.charCodeAt(i + 1)]
    const c = lookup[base64.charCodeAt(i + 2)]
    const d = lookup[base64.charCodeAt(i + 3)]

    bytes[p++] = (a << 2) | (b >> 4)
    if (i + 2 < len) bytes[p++] = ((b & 15) << 4) | (c >> 2)
    if (i + 3 < len) bytes[p++] = ((c & 3) << 6) | d
  }

  return bytes
}
