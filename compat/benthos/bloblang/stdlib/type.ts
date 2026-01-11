/**
 * Bloblang Stdlib Type Functions Implementation
 * Issue: dotdo-yk5as - Bloblang Stdlib: Type Functions - Milestone 2
 *
 * Type conversion and type checking functions following Benthos semantics:
 * - bool: 0, "", null, false, [], {} are falsy; everything else truthy
 * - int: truncation not rounding (3.9 -> 3)
 * - type names are lowercase
 * - string: JSON serialization for complex types
 */

/**
 * Convert value to string
 * - primitives: String()
 * - arrays/objects: JSON.stringify()
 */
export const string = {
  call(value: any): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (value === null) return 'null'
    if (Array.isArray(value) || typeof value === 'object') {
      return JSON.stringify(value)
    }
    return String(value)
  }
}

/**
 * Convert value to integer with truncation (not rounding)
 * Throws on invalid conversions
 */
export const int = {
  call(value: any): number {
    if (typeof value === 'number') {
      return Math.trunc(value)
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      const parsed = Number(trimmed)
      if (isNaN(parsed)) {
        throw new Error(`Cannot parse "${value}" as integer`)
      }
      return Math.trunc(parsed)
    }
    throw new Error(`Cannot convert ${typeof value} to integer`)
  }
}

/**
 * Convert value to float
 * Throws on invalid conversions
 */
export const float = {
  call(value: any): number {
    if (typeof value === 'number') {
      return value
    }
    if (typeof value === 'boolean') {
      return value ? 1.0 : 0.0
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      const parsed = Number(trimmed)
      if (isNaN(parsed)) {
        throw new Error(`Cannot parse "${value}" as float`)
      }
      return parsed
    }
    throw new Error(`Cannot convert ${typeof value} to float`)
  }
}

/**
 * Convert value to boolean following Benthos semantics:
 * Falsy: 0, "", null, false, [], {}
 * Truthy: everything else
 */
export const bool = {
  call(value: any): boolean {
    // Explicit false values
    if (value === false || value === null) return false

    // Numbers: 0 is false, others are true
    if (typeof value === 'number') return value !== 0

    // Strings: empty string is false, others are true
    if (typeof value === 'string') return value !== ''

    // Arrays: empty array is false, non-empty is true
    if (Array.isArray(value)) return value.length > 0

    // Objects: empty object is false, non-empty is true
    if (typeof value === 'object' && value !== null) {
      return Object.keys(value).length > 0
    }

    // Boolean true
    if (value === true) return true

    // Default to truthy for other values
    return true
  }
}

/**
 * Wrap value in array if not already an array
 * Returns same reference for arrays
 */
export const array = {
  call(value: any): any[] {
    if (Array.isArray(value)) return value
    return [value]
  }
}

/**
 * Convert entries array to object, or return object unchanged
 * entries format: [[key, value], [key, value], ...]
 * Throws on invalid input
 */
export const object = {
  call(value: any): Record<string, any> {
    // Return objects unchanged
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value
    }

    // Convert entries array to object
    if (Array.isArray(value)) {
      const result: Record<string, any> = {}
      for (const entry of value) {
        if (Array.isArray(entry) && entry.length >= 2) {
          const [key, val] = entry
          result[String(key)] = val
        } else if (Array.isArray(entry) && entry.length === 0) {
          // Skip empty arrays in entries
          continue
        } else if (!Array.isArray(entry)) {
          throw new Error('Invalid entry format: expected array')
        }
      }
      return result
    }

    throw new Error(`Cannot convert ${typeof value} to object`)
  }
}

/**
 * Return lowercase type name
 * Types: string, number, bool, array, object, null
 */
export const type = {
  call(value: any): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'boolean') return 'bool'
    if (typeof value === 'object') return 'object'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'string') return 'string'
    return typeof value
  }
}

/**
 * Type check: is string?
 */
export const isString = {
  call(value: any): boolean {
    return typeof value === 'string'
  }
}

/**
 * Type check: is number?
 */
export const isNumber = {
  call(value: any): boolean {
    return typeof value === 'number'
  }
}

/**
 * Type check: is boolean?
 */
export const isBool = {
  call(value: any): boolean {
    return typeof value === 'boolean'
  }
}

/**
 * Type check: is array?
 */
export const isArray = {
  call(value: any): boolean {
    return Array.isArray(value)
  }
}

/**
 * Type check: is object (not array)?
 */
export const isObject = {
  call(value: any): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
}

/**
 * Type check: is null?
 */
export const isNull = {
  call(value: any): boolean {
    return value === null
  }
}

/**
 * Throw if null, return value otherwise
 */
export const notNull = {
  call(value: any): any {
    if (value === null) {
      throw new Error('Value is null but was required')
    }
    return value
  }
}

/**
 * Return default if value is null or undefined
 */
export const or = {
  call(value: any, defaultValue: any): any {
    if (value === null || value === undefined) {
      return defaultValue
    }
    return value
  }
}

/**
 * Return default if value is an Error
 * Named catch_ to avoid reserved word 'catch'
 */
export const catch_ = {
  call(value: any, defaultValue: any): any {
    if (value instanceof Error) {
      return defaultValue
    }
    return value
  }
}
