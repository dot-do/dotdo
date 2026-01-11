/**
 * Bloblang Object Stdlib Functions
 * Issue: dotdo-r9yls
 *
 * Implementation of object manipulation functions for Bloblang.
 * All operations are immutable (return new objects).
 */

// Type helper to check if value is a plain object (not array, not null)
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Type helper for path - can be string (dot notation) or array
type Path = string | string[]

// Convert path to array of keys
function pathToArray(path: Path): string[] {
  if (Array.isArray(path)) {
    return path
  }
  if (path === '') {
    return []
  }
  return path.split('.')
}

// Deep clone helper for immutability
function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(deepClone) as T
  }
  const cloned: Record<string, unknown> = {}
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      cloned[key] = deepClone((value as Record<string, unknown>)[key])
    }
  }
  return cloned as T
}

/**
 * Returns array of all keys from an object
 */
export function keys(obj: unknown): string[] {
  if (!isPlainObject(obj)) {
    throw new TypeError('keys() requires a plain object')
  }
  return Object.keys(obj)
}

/**
 * Returns array of all values from an object
 */
export function values(obj: unknown): unknown[] {
  if (!isPlainObject(obj)) {
    throw new TypeError('values() requires a plain object')
  }
  return Object.values(obj)
}

/**
 * Merges two objects (shallow merge, later values win)
 */
export function merge(obj1: unknown, obj2: unknown): Record<string, unknown> {
  if (!isPlainObject(obj1) || !isPlainObject(obj2)) {
    throw new TypeError('merge() requires two plain objects')
  }
  return { ...obj1, ...obj2 }
}

/**
 * Returns new object without specified keys
 */
export function without(obj: unknown, keysToRemove: string[]): Record<string, unknown> {
  if (!isPlainObject(obj)) {
    throw new TypeError('without() requires a plain object')
  }
  const result: Record<string, unknown> = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && !keysToRemove.includes(key)) {
      result[key] = obj[key]
    }
  }
  return result
}

/**
 * Checks if a path exists in an object
 */
export function exists(obj: unknown, path: Path): boolean {
  if (!isPlainObject(obj)) {
    throw new TypeError('exists() requires a plain object')
  }

  const pathKeys = pathToArray(path)
  if (pathKeys.length === 0) {
    return true // Empty path refers to root
  }

  let current: unknown = obj
  for (const key of pathKeys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return false
    }
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      return false
    }
    current = (current as Record<string, unknown>)[key]
  }
  return true
}

/**
 * Gets value at path, with optional default
 */
export function get(obj: unknown, path: Path, defaultValue?: unknown): unknown {
  if (!isPlainObject(obj)) {
    throw new TypeError('get() requires a plain object')
  }

  const pathKeys = pathToArray(path)
  if (pathKeys.length === 0) {
    return obj // Empty path returns root
  }

  let current: unknown = obj
  for (const key of pathKeys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return defaultValue
    }
    if (!(key in (current as Record<string, unknown>))) {
      return defaultValue
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Sets value at path, creating intermediate objects as needed (immutable)
 */
export function set(obj: unknown, path: Path, value: unknown): Record<string, unknown> {
  if (!isPlainObject(obj)) {
    throw new TypeError('set() requires a plain object')
  }

  const pathKeys = pathToArray(path)
  if (pathKeys.length === 0) {
    return value as Record<string, unknown> // Empty path replaces root
  }

  // Deep clone to ensure immutability
  const result = deepClone(obj)

  let current: Record<string, unknown> = result
  for (let i = 0; i < pathKeys.length - 1; i++) {
    const key = pathKeys[i]
    const nextKey = pathKeys[i + 1]

    // If next key is numeric, create array; otherwise create object
    if (!Object.prototype.hasOwnProperty.call(current, key) ||
        current[key] === null ||
        typeof current[key] !== 'object') {
      // Check if next key looks like an array index
      if (/^\d+$/.test(nextKey)) {
        current[key] = []
      } else {
        current[key] = {}
      }
    } else {
      // Clone the nested object/array for immutability
      current[key] = deepClone(current[key])
    }
    current = current[key] as Record<string, unknown>
  }

  const lastKey = pathKeys[pathKeys.length - 1]
  current[lastKey] = value

  return result
}

/**
 * Deletes key at path (immutable)
 * Named deleteKey to avoid reserved word 'delete'
 */
export function deleteKey(obj: unknown, path: Path): Record<string, unknown> | null {
  if (!isPlainObject(obj)) {
    throw new TypeError('deleteKey() requires a plain object')
  }

  const pathKeys = pathToArray(path)
  if (pathKeys.length === 0) {
    return null // Deleting root returns null
  }

  // Deep clone to ensure immutability
  const result = deepClone(obj)

  // Navigate to parent of target
  let current: Record<string, unknown> = result
  for (let i = 0; i < pathKeys.length - 1; i++) {
    const key = pathKeys[i]
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, key)) {
      return result // Path doesn't exist, return unchanged
    }
    current = current[key] as Record<string, unknown>
  }

  const lastKey = pathKeys[pathKeys.length - 1]
  if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, lastKey)) {
    delete current[lastKey]
  }

  return result
}

/**
 * Maps each key using a transformation function
 */
export function mapEachKey(obj: unknown, fn: (key: string, index: number) => string): Record<string, unknown> {
  if (!isPlainObject(obj)) {
    throw new TypeError('mapEachKey() requires a plain object')
  }
  if (typeof fn !== 'function') {
    throw new TypeError('mapEachKey() requires a function as second argument')
  }

  const result: Record<string, unknown> = {}
  const objKeys = Object.keys(obj)

  objKeys.forEach((key, index) => {
    const newKey = fn(key, index)
    result[newKey] = obj[key]
  })

  return result
}

/**
 * Parses JSON string to value
 */
export function fromJson(jsonStr: unknown): unknown {
  if (typeof jsonStr !== 'string') {
    throw new TypeError('fromJson() requires a string')
  }
  if (jsonStr.trim() === '') {
    throw new SyntaxError('Unexpected end of JSON input')
  }
  return JSON.parse(jsonStr)
}

/**
 * Serializes value to JSON string
 */
export function toJson(value: unknown): string {
  // Check for non-serializable types before attempting to stringify
  if (typeof value === 'function') {
    throw new TypeError('toJson() cannot serialize functions')
  }
  if (typeof value === 'symbol') {
    throw new TypeError('toJson() cannot serialize symbols')
  }

  // JSON.stringify will throw on circular references
  return JSON.stringify(value)
}
