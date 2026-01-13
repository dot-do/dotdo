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
 * Result type for safeJsonParse with logging
 */
export type JsonParseResult<T> = {
  ok: true
  value: T
} | {
  ok: false
  error: SyntaxError
}

/**
 * Options for safeJsonParse
 */
export interface SafeJsonParseOptions {
  /** Context string for logging (e.g., function name, operation) */
  context?: string
  /** Whether to log parse failures (default: true in non-test environments) */
  log?: boolean
}

/**
 * Parse JSON safely with optional fallback value and logging.
 *
 * This is the primary utility for guarding JSON.parse() calls throughout the codebase.
 * It prevents crashes from malformed JSON by catching SyntaxError and returning a fallback.
 *
 * @param input - The JSON string to parse
 * @param fallback - Value to return on parse failure (default: undefined)
 * @param options - Optional configuration for logging
 * @returns The parsed value or fallback on error
 *
 * @example
 * // Simple usage with undefined fallback
 * const data = safeJsonParse(userInput)
 * if (data === undefined) {
 *   console.log('Invalid JSON')
 * }
 *
 * @example
 * // With explicit fallback
 * const config = safeJsonParse(configString, { enabled: false })
 *
 * @example
 * // With logging context
 * const data = safeJsonParse(row.data, null, { context: 'ThingsStore.get' })
 */
export function safeJsonParse<T = unknown>(input: string): T | undefined
export function safeJsonParse<T = unknown>(input: string, fallback: T, options?: SafeJsonParseOptions): T
export function safeJsonParse<T = unknown>(
  input: string,
  fallback?: T,
  options?: SafeJsonParseOptions
): T | undefined {
  try {
    return JSON.parse(input) as T
  } catch (error) {
    // Log parse failures for debugging (unless explicitly disabled)
    const shouldLog = options?.log !== false && typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test'
    if (shouldLog && error instanceof SyntaxError) {
      const context = options?.context ? `[${options.context}] ` : ''
      const preview = input.length > 50 ? input.slice(0, 50) + '...' : input
      console.warn(`${context}JSON parse failed: ${error.message}. Input preview: "${preview}"`)
    }
    return fallback
  }
}

/**
 * Parse JSON safely and return a Result type for explicit error handling.
 *
 * Use this when you need to distinguish between:
 * - Successfully parsed null/undefined values
 * - Parse failures
 *
 * @param input - The JSON string to parse
 * @returns Result object with either the parsed value or the error
 *
 * @example
 * const result = safeJsonParseResult(userInput)
 * if (!result.ok) {
 *   console.error('Parse failed:', result.error.message)
 *   return
 * }
 * // result.value is safely typed
 */
export function safeJsonParseResult<T = unknown>(input: string): JsonParseResult<T> {
  try {
    return { ok: true, value: JSON.parse(input) as T }
  } catch (error) {
    return { ok: false, error: error as SyntaxError }
  }
}

/**
 * Safely deep-clone an object using JSON serialization.
 *
 * Handles non-serializable values gracefully:
 * - Circular references: Returns fallback
 * - BigInt: Returns fallback
 * - Functions: Silently dropped (standard JSON.stringify behavior)
 * - undefined: Silently dropped (standard JSON.stringify behavior)
 *
 * @param obj - The object to clone
 * @param fallback - Value to return if cloning fails (default: empty object)
 * @param options - Optional configuration for logging
 * @returns A deep clone of the object or fallback on error
 */
export function safeJsonClone<T>(
  obj: T,
  fallback: T = {} as T,
  options?: SafeJsonParseOptions
): T {
  try {
    return JSON.parse(JSON.stringify(obj)) as T
  } catch (error) {
    // Log clone failures for debugging
    const shouldLog = options?.log !== false && typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test'
    if (shouldLog) {
      const context = options?.context ? `[${options.context}] ` : ''
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.warn(`${context}JSON clone failed: ${errorMsg}`)
    }
    return fallback
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

/**
 * Safely serialize a value, handling circular references and non-JSON types.
 * Unlike safeStringify, this returns the serializable object structure rather than a JSON string.
 * Useful when you need to prepare data for JSON.stringify() or other serialization.
 *
 * Handles:
 * - Circular references (returns '[Circular]')
 * - BigInt (converts to string with 'n' suffix)
 * - Symbol (converts to string representation)
 * - Functions (returns '[Function]')
 * - Date (returns ISO string)
 * - Map (returns {__type: 'Map', entries: {...}})
 * - Set (returns {__type: 'Set', values: [...]})
 * - Error objects (returns {name, message, stack, ...})
 *
 * @param value - The value to serialize
 * @param options - Serialization options (same as SafeStringifyOptions)
 * @returns A JSON-serializable representation of the value
 *
 * @example
 * const obj = { a: 1 }
 * obj.self = obj
 * const serialized = safeSerialize(obj)
 * // { a: 1, self: '[Circular]' }
 */
export function safeSerialize(value: unknown, options?: SafeStringifyOptions): unknown {
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

  return serialize(value, 0)
}

export default safeStringify
