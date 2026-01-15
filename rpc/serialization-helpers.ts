/**
 * Shared serialization helpers for Cap'n Web RPC
 *
 * Consolidates common type detection and transformation logic.
 */

import { TypeHandler } from './transport'

/**
 * Check if a value is a Capability object
 */
export function isCapability(value: unknown): value is {
  id: string
  type: string
  methods: string[]
  expiresAt?: Date
  parent?: object
} {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    'type' in value &&
    'methods' in value &&
    'invoke' in value
  )
}

/**
 * Serialize a capability to wire format
 */
export function serializeCapabilityObject(cap: {
  id: string
  type: string
  methods: string[]
  expiresAt?: Date
  parent?: object
}): Record<string, unknown> {
  return {
    $type: 'Capability',
    id: cap.id,
    type: cap.type,
    methods: cap.methods,
    expiresAt: cap.expiresAt?.toISOString(),
  }
}

/**
 * Get the type name of a value
 */
export function getValueTypeName(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (value instanceof Date) return 'Date'
  if (value instanceof Map) return 'Map'
  if (value instanceof Set) return 'Set'
  if (typeof value === 'bigint') return 'BigInt'

  const constructor = (value as object).constructor
  if (constructor) {
    return constructor.name
  }

  return null
}

/**
 * Build a type handler lookup map from an array of handlers
 */
export function buildHandlerMap(handlers?: [string, TypeHandler][]): Map<string, TypeHandler> | undefined {
  if (!handlers || handlers.length === 0) {
    return undefined
  }

  return new Map(handlers)
}

/**
 * Check if a value is a circular reference marker
 */
export function isCircularRefMarker(value: unknown): value is { $ref: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    '$ref' in value &&
    typeof (value as Record<string, unknown>).$ref === 'string'
  )
}

/**
 * Check if a value is a typed object (with $type marker)
 */
export function isTypedObject(value: unknown): value is Record<string, unknown> & { $type: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    '$type' in value &&
    typeof (value as Record<string, unknown>).$type === 'string'
  )
}
