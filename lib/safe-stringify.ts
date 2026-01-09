/**
 * Safe JSON stringify utility that handles circular references,
 * large objects, and non-serializable values.
 */

/**
 * Options for safe stringification
 */
export interface SafeStringifyOptions {
  /** Maximum depth to traverse (default: 10) */
  maxDepth?: number
  /** Maximum string length before truncation (default: 10000) */
  maxLength?: number
  /** Replacement text for circular references (default: '[Circular]') */
  circularReplacement?: string
  /** Replacement text for functions (default: '[Function]') */
  functionReplacement?: string
  /** Whether to include stack traces (default: true) */
  includeStacks?: boolean
}

const DEFAULT_OPTIONS: Required<SafeStringifyOptions> = {
  maxDepth: 10,
  maxLength: 10000,
  circularReplacement: '[Circular]',
  functionReplacement: '[Function]',
  includeStacks: true,
}

/**
 * Safely stringify a value to JSON, handling:
 * - Circular references
 * - Functions
 * - BigInt
 * - Symbols
 * - Very long strings
 * - Deep nesting
 * - Error objects with stack traces
 *
 * @param value - The value to stringify
 * @param options - Stringification options
 * @returns JSON string representation
 */
export function safeStringify(value: unknown, options?: SafeStringifyOptions): string {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const seen = new WeakSet()

  function serialize(obj: unknown, depth: number): unknown {
    // Handle primitives
    if (obj === null || obj === undefined) return obj
    if (typeof obj === 'boolean' || typeof obj === 'number') return obj
    if (typeof obj === 'string') {
      return obj.length > opts.maxLength
        ? obj.slice(0, opts.maxLength) + `... [truncated ${obj.length - opts.maxLength} chars]`
        : obj
    }
    if (typeof obj === 'bigint') return obj.toString() + 'n'
    if (typeof obj === 'symbol') return obj.toString()
    if (typeof obj === 'function') return opts.functionReplacement

    // Check depth
    if (depth > opts.maxDepth) return '[Max depth exceeded]'

    // Handle objects
    if (typeof obj === 'object') {
      // Check for circular reference
      if (seen.has(obj)) return opts.circularReplacement
      seen.add(obj)

      // Handle Error objects specially
      if (obj instanceof Error) {
        const errorObj: Record<string, unknown> = {
          name: obj.name,
          message: obj.message,
        }
        if (opts.includeStacks && obj.stack) {
          errorObj.stack = obj.stack
        }
        // Copy custom properties
        for (const key of Object.keys(obj)) {
          if (key !== 'name' && key !== 'message' && key !== 'stack') {
            errorObj[key] = serialize((obj as unknown as Record<string, unknown>)[key], depth + 1)
          }
        }
        return errorObj
      }

      // Handle Date
      if (obj instanceof Date) return obj.toISOString()

      // Handle RegExp
      if (obj instanceof RegExp) return obj.toString()

      // Handle Map
      if (obj instanceof Map) {
        const mapObj: Record<string, unknown> = {}
        for (const [key, val] of obj) {
          const keyStr = typeof key === 'string' ? key : String(key)
          mapObj[keyStr] = serialize(val, depth + 1)
        }
        return { __type: 'Map', entries: mapObj }
      }

      // Handle Set
      if (obj instanceof Set) {
        return { __type: 'Set', values: Array.from(obj).map(v => serialize(v, depth + 1)) }
      }

      // Handle Arrays
      if (Array.isArray(obj)) {
        return obj.map(item => serialize(item, depth + 1))
      }

      // Handle plain objects
      const result: Record<string, unknown> = {}
      for (const key of Object.keys(obj)) {
        result[key] = serialize((obj as Record<string, unknown>)[key], depth + 1)
      }
      return result
    }

    return String(obj)
  }

  const serialized = serialize(value, 0)
  const jsonString = JSON.stringify(serialized, null, 2)

  // Final length check
  if (jsonString.length > opts.maxLength) {
    return jsonString.slice(0, opts.maxLength) + `\n... [truncated ${jsonString.length - opts.maxLength} chars]`
  }

  return jsonString
}

/**
 * Parse JSON safely, returning null on error instead of throwing
 */
export function safeParse<T = unknown>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/**
 * Serialize an error object for logging/transmission
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    }

    if (error.stack) {
      serialized.stack = error.stack
    }

    // Include cause if present
    if ('cause' in error && error.cause) {
      serialized.cause = serializeError(error.cause)
    }

    // Copy custom properties
    for (const key of Object.keys(error)) {
      if (!['name', 'message', 'stack', 'cause'].includes(key)) {
        serialized[key] = (error as unknown as Record<string, unknown>)[key]
      }
    }

    return serialized
  }

  if (typeof error === 'object' && error !== null) {
    return error as Record<string, unknown>
  }

  return { message: String(error) }
}

export default safeStringify
