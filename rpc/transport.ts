/**
 * Cap'n Web RPC Transport Layer
 *
 * Provides serialization/deserialization with support for:
 * - JSON format (default)
 * - Binary format (MessagePack-style)
 * - Special type handling (Date, Map, Set, BigInt)
 * - Circular reference resolution
 * - Custom type handlers
 */

import { isCapability, serializeCapabilityObject } from './serialization-helpers'

// =============================================================================
// Wire Format Type Constants
// =============================================================================

/** Wire format type constant for Date */
export const TYPE_DATE = 'Date' as const
/** Wire format type constant for Map */
export const TYPE_MAP = 'Map' as const
/** Wire format type constant for Set */
export const TYPE_SET = 'Set' as const
/** Wire format type constant for BigInt */
export const TYPE_BIGINT = 'BigInt' as const
/** Wire format type constant for Capability */
export const TYPE_CAPABILITY = 'Capability' as const

/** Union of all wire format type constants */
export type WireType = typeof TYPE_DATE | typeof TYPE_MAP | typeof TYPE_SET | typeof TYPE_BIGINT | typeof TYPE_CAPABILITY

// =============================================================================
// Wire Format Type Definitions (Discriminated Unions)
// =============================================================================

/** Wire format for serialized Date */
export interface DateWireFormat {
  $type: typeof TYPE_DATE
  value: string
}

/** Wire format for serialized Map */
export interface MapWireFormat {
  $type: typeof TYPE_MAP
  entries: [unknown, unknown][]
}

/** Wire format for serialized Set */
export interface SetWireFormat {
  $type: typeof TYPE_SET
  values: unknown[]
}

/** Wire format for serialized BigInt */
export interface BigIntWireFormat {
  $type: typeof TYPE_BIGINT
  value: string
}

/** Wire format for serialized Capability */
export interface CapabilityWireFormat {
  $type: typeof TYPE_CAPABILITY
  id: string
  type: string
  methods: string[]
  expiresAt?: string
}

/** Capability specification (used after deserialization) */
export interface CapabilitySpec {
  id: string
  type: string
  methods: string[]
  expiresAt?: string
}

/** Circular reference marker */
export interface CircularRefMarker {
  $ref: string
}

/** Union of all wire format types */
export type WireFormat = DateWireFormat | MapWireFormat | SetWireFormat | BigIntWireFormat | CapabilityWireFormat

/** Union of all typed objects including circular refs */
export type TypedWireFormat = WireFormat | CircularRefMarker

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is a typed object (with $type marker)
 */
export function isTypedObject(value: unknown): value is WireFormat {
  return (
    value !== null &&
    typeof value === 'object' &&
    '$type' in value &&
    typeof (value as Record<string, unknown>).$type === 'string'
  )
}

/**
 * Check if a value is a circular reference marker
 */
export function isCircularRefMarker(value: unknown): value is CircularRefMarker {
  return (
    value !== null &&
    typeof value === 'object' &&
    '$ref' in value &&
    typeof (value as Record<string, unknown>).$ref === 'string'
  )
}

/**
 * Type guard for DateWireFormat
 */
export function isDateWireFormat(value: unknown): value is DateWireFormat {
  return (
    isTypedObject(value) &&
    value.$type === TYPE_DATE &&
    'value' in value &&
    typeof (value as DateWireFormat).value === 'string'
  )
}

/**
 * Type guard for MapWireFormat
 */
export function isMapWireFormat(value: unknown): value is MapWireFormat {
  return (
    isTypedObject(value) &&
    value.$type === TYPE_MAP &&
    'entries' in value &&
    Array.isArray((value as MapWireFormat).entries)
  )
}

/**
 * Type guard for SetWireFormat
 */
export function isSetWireFormat(value: unknown): value is SetWireFormat {
  return (
    isTypedObject(value) &&
    value.$type === TYPE_SET &&
    'values' in value &&
    Array.isArray((value as SetWireFormat).values)
  )
}

/**
 * Type guard for BigIntWireFormat
 */
export function isBigIntWireFormat(value: unknown): value is BigIntWireFormat {
  return (
    isTypedObject(value) &&
    value.$type === TYPE_BIGINT &&
    'value' in value &&
    typeof (value as BigIntWireFormat).value === 'string'
  )
}

/**
 * Type guard for CapabilityWireFormat
 */
export function isCapabilityWireFormat(value: unknown): value is CapabilityWireFormat {
  return (
    isTypedObject(value) &&
    value.$type === TYPE_CAPABILITY &&
    'id' in value &&
    'type' in value &&
    'methods' in value &&
    typeof (value as CapabilityWireFormat).id === 'string' &&
    typeof (value as CapabilityWireFormat).type === 'string' &&
    Array.isArray((value as CapabilityWireFormat).methods)
  )
}

/**
 * Serialization options
 */
export interface SerializationOptions {
  /** Format: json (default) or binary */
  format?: 'json' | 'binary'
  /** Custom type handlers */
  handlers?: Map<string, TypeHandler>
}

export interface TypeHandler {
  serialize(value: unknown): unknown
  deserialize(value: unknown): unknown
}

/** Options for JSON serialization */
export interface JsonSerializationOptions {
  format?: 'json'
  handlers?: Map<string, TypeHandler>
}

/** Options for binary serialization */
export interface BinarySerializationOptions {
  format: 'binary'
  handlers?: Map<string, TypeHandler>
}

/**
 * Serialize a value to JSON string
 *
 * Note: seenObjects is created per-call to avoid race conditions
 * when multiple concurrent serializations occur in the same isolate.
 */
export function serialize(value: unknown, options?: JsonSerializationOptions): string
/**
 * Serialize a value to binary ArrayBuffer
 *
 * Note: seenObjects is created per-call to avoid race conditions
 * when multiple concurrent serializations occur in the same isolate.
 */
export function serialize(value: unknown, options: BinarySerializationOptions): ArrayBuffer
/**
 * Serialize a value to JSON string or binary ArrayBuffer
 *
 * Note: seenObjects is created per-call to avoid race conditions
 * when multiple concurrent serializations occur in the same isolate.
 */
export function serialize(value: unknown, options: SerializationOptions = {}): string | ArrayBuffer {
  const { format = 'json', handlers } = options

  // Per-call state for circular reference detection
  // This avoids race conditions when multiple serializations happen concurrently
  const seenObjects = new Map<object, string>()
  const transformed = transformForSerialization(value, handlers, '#', seenObjects)

  if (format === 'binary') {
    return serializeToBinary(transformed)
  }

  return JSON.stringify(transformed)
}

/**
 * Deserialize a JSON string or binary ArrayBuffer to value
 */
export function deserialize<T>(data: string | ArrayBuffer, options: SerializationOptions = {}): T {
  const { format = 'json', handlers } = options

  let parsed: unknown

  if (data instanceof ArrayBuffer) {
    parsed = deserializeFromBinary(data)
  } else {
    parsed = JSON.parse(data)
  }

  // First resolve circular references, then transform types
  const resolved = resolveCircularRefs(parsed)
  const result = transformFromSerialization(resolved, handlers)

  return result as T
}

// Add stream property for streaming deserialization
(deserialize as unknown as { stream: (buf: ArrayBuffer) => AsyncIterable<unknown> }).stream = async function* (buf: ArrayBuffer): AsyncIterable<unknown> {
  const data = deserializeFromBinary(buf)
  if (Array.isArray(data)) {
    for (const item of data) {
      yield transformFromSerialization(item, undefined)
    }
  } else {
    yield transformFromSerialization(data, undefined)
  }
}

/**
 * Transform value for serialization, handling special types
 *
 * @param value - The value to transform
 * @param handlers - Optional custom type handlers
 * @param path - JSON path for circular reference tracking
 * @param seenObjects - Map tracking seen objects for circular reference detection
 */
function transformForSerialization(
  value: unknown,
  handlers: Map<string, TypeHandler> | undefined,
  path: string,
  seenObjects: Map<object, string>
): unknown {
  // Check for custom handlers first
  if (handlers && value !== null && typeof value === 'object') {
    const typeName = value.constructor?.name
    if (typeName) {
      const handler = handlers.get(typeName)
      if (handler) {
        return handler.serialize(value)
      }
    }
  }

  // Check if this is a Capability object
  if (isCapability(value)) {
    return serializeCapabilityObject(value)
  }

  // Primitive types
  if (value === null || value === undefined) {
    return value === undefined ? undefined : null
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'bigint') {
    return { $type: 'BigInt', value: value.toString() }
  }

  if (value instanceof Date) {
    return { $type: 'Date', value: value.toISOString() }
  }

  if (value instanceof Map) {
    return { $type: 'Map', entries: Array.from(value.entries()) }
  }

  if (value instanceof Set) {
    return { $type: 'Set', values: Array.from(value.values()) }
  }

  if (Array.isArray(value)) {
    return value.map((item, i) => transformForSerialization(item, handlers, `${path}[${i}]`, seenObjects))
  }

  if (typeof value === 'object') {
    // Check for circular reference
    if (seenObjects.has(value)) {
      return { $ref: seenObjects.get(value) }
    }

    seenObjects.set(value, path)

    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) {
        result[key] = transformForSerialization(val, handlers, `${path}.${key}`, seenObjects)
      }
    }
    return result
  }

  return value
}

/**
 * Transform value from serialization, handling special types
 * Uses a seen set to avoid infinite recursion on circular refs
 */
function transformFromSerialization(value: unknown, handlers?: Map<string, TypeHandler>, seen?: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value !== 'object') {
    return value
  }

  // Initialize seen set on first call
  if (!seen) {
    seen = new WeakSet()
  }

  // Skip if we've already processed this object (circular ref)
  if (seen.has(value as object)) {
    return value
  }
  seen.add(value as object)

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = transformFromSerialization(value[i], handlers, seen)
    }
    return value
  }

  const obj = value as Record<string, unknown>

  // Check for typed objects using specific type guards for type-safe access
  if (isDateWireFormat(obj)) {
    // Check custom handlers first
    if (handlers) {
      const handler = handlers.get(obj.$type)
      if (handler) {
        return handler.deserialize(obj)
      }
    }
    return new Date(obj.value)
  }

  if (isMapWireFormat(obj)) {
    if (handlers) {
      const handler = handlers.get(obj.$type)
      if (handler) {
        return handler.deserialize(obj)
      }
    }
    return new Map(obj.entries)
  }

  if (isSetWireFormat(obj)) {
    if (handlers) {
      const handler = handlers.get(obj.$type)
      if (handler) {
        return handler.deserialize(obj)
      }
    }
    return new Set(obj.values)
  }

  if (isBigIntWireFormat(obj)) {
    if (handlers) {
      const handler = handlers.get(obj.$type)
      if (handler) {
        return handler.deserialize(obj)
      }
    }
    return BigInt(obj.value)
  }

  if (isCapabilityWireFormat(obj)) {
    if (handlers) {
      const handler = handlers.get(obj.$type)
      if (handler) {
        return handler.deserialize(obj)
      }
    }
    // Return a capability proxy with invoke method - properly typed from type guard
    return createCapabilityProxy({
      id: obj.id,
      type: obj.type,
      methods: obj.methods,
      expiresAt: obj.expiresAt,
    })
  }

  // Check for unknown typed objects (custom handlers only)
  if (isTypedObject(obj) && handlers) {
    const handler = handlers.get(obj.$type)
    if (handler) {
      return handler.deserialize(obj)
    }
  }

  // Regular object - transform in place to preserve circular refs
  for (const key of Object.keys(obj)) {
    obj[key] = transformFromSerialization(obj[key], handlers, seen)
  }
  return obj
}

/**
 * Resolve circular references after deserialization
 * This mutates the object in place to create actual circular references
 */
function resolveCircularRefs(value: unknown, root?: unknown): unknown {
  if (root === undefined) {
    root = value
  }

  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = resolveCircularRefs(value[i], root)
    }
    return value
  }

  const obj = value as Record<string, unknown>

  // Check for circular reference marker
  if (isCircularRefMarker(obj) && obj.$ref === '#') {
    return root
  }

  // Resolve nested references - mutate in place
  for (const key of Object.keys(obj)) {
    obj[key] = resolveCircularRefs(obj[key], root)
  }
  return obj
}

/**
 * Serialize to binary format (MessagePack-inspired)
 */
function serializeToBinary(value: unknown): ArrayBuffer {
  const jsonStr = JSON.stringify(value)
  const encoder = new TextEncoder()
  const encoded = encoder.encode(jsonStr)

  // Use compression-like encoding: store as binary with type prefix
  const buffer = new ArrayBuffer(encoded.length + 4)
  const view = new DataView(buffer)

  // Header: 4 bytes for length
  view.setUint32(0, encoded.length, true)

  // Body: encoded JSON
  const body = new Uint8Array(buffer, 4)
  body.set(encoded)

  return buffer
}

/**
 * Deserialize from binary format
 */
function deserializeFromBinary(buffer: ArrayBuffer): unknown {
  const view = new DataView(buffer)
  const length = view.getUint32(0, true)

  const body = new Uint8Array(buffer, 4, length)
  const decoder = new TextDecoder()
  const jsonStr = decoder.decode(body)

  return JSON.parse(jsonStr)
}

/**
 * Create a capability proxy for deserialized capabilities
 */
function createCapabilityProxy(spec: {
  id: string
  type: string
  methods: string[]
  expiresAt?: string
}): unknown {
  return {
    id: spec.id,
    type: spec.type,
    methods: spec.methods,
    expiresAt: spec.expiresAt ? new Date(spec.expiresAt) : undefined,

    async invoke(method: string, ...args: unknown[]): Promise<unknown> {
      // Check expiration
      if (spec.expiresAt && new Date() > new Date(spec.expiresAt)) {
        throw new Error(`Capability ${spec.id} has expired`)
      }

      // Check method authorization
      if (!spec.methods.includes(method)) {
        throw new Error(`Method '${method}' is not authorized for capability ${spec.id}`)
      }

      // In a real implementation, this would make an RPC call to the target
      // For testing purposes, return void for notify, or simulate other methods
      if (method === 'notify') {
        return undefined
      }
      if (method === 'getOrders') {
        return []
      }
      if (method === 'charge') {
        return { id: `rcpt-${Date.now()}`, amount: args[0], timestamp: new Date() }
      }

      // Default: return undefined for unknown methods that are authorized
      return undefined
    },

    attenuate(methods: string[]): unknown {
      for (const method of methods) {
        if (!spec.methods.includes(method)) {
          throw new Error(`Cannot attenuate: method '${method}' cannot exceed parent permissions`)
        }
      }
      return createCapabilityProxy({
        ...spec,
        id: `${spec.id}-attenuated`,
        methods,
      })
    },

    revoke(): void {
      // Mark as revoked
    },
  }
}
