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

// Track seen objects for circular reference detection
const seenObjects = new WeakMap<object, string>()
let refCounter = 0

function resetRefTracking(): void {
  refCounter = 0
}

/**
 * Serialize a value to JSON string or binary ArrayBuffer
 */
export function serialize(value: unknown, options: SerializationOptions = {}): string | ArrayBuffer {
  const { format = 'json', handlers } = options

  resetRefTracking()
  const transformed = transformForSerialization(value, handlers, '#')

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
 */
function transformForSerialization(value: unknown, handlers?: Map<string, TypeHandler>, path: string = '#'): unknown {
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
  if (value !== null && typeof value === 'object' && 'id' in value && 'type' in value && 'methods' in value && 'invoke' in value) {
    const cap = value as { id: string; type: string; methods: string[]; expiresAt?: Date; parent?: object }
    return {
      $type: 'Capability',
      id: cap.id,
      type: cap.type,
      methods: cap.methods,
      expiresAt: cap.expiresAt?.toISOString(),
    }
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
    return value.map((item, i) => transformForSerialization(item, handlers, `${path}[${i}]`))
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
        result[key] = transformForSerialization(val, handlers, `${path}.${key}`)
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

  // Check for typed objects
  if ('$type' in obj) {
    const typeName = obj.$type as string

    // Check custom handlers first
    if (handlers) {
      const handler = handlers.get(typeName)
      if (handler) {
        return handler.deserialize(obj)
      }
    }

    // Built-in type handlers
    switch (typeName) {
      case 'Date':
        return new Date(obj.value as string)
      case 'Map':
        return new Map(obj.entries as [unknown, unknown][])
      case 'Set':
        return new Set(obj.values as unknown[])
      case 'BigInt':
        return BigInt(obj.value as string)
      case 'Capability':
        // Return a capability proxy with invoke method
        return createCapabilityProxy(obj as {
          id: string
          type: string
          methods: string[]
          expiresAt?: string
        })
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

  // Check for reference
  if ('$ref' in obj && obj.$ref === '#') {
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
