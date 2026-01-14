/**
 * JSON Path Extractor
 *
 * Extracts all JSON paths from objects for indexing and schema discovery.
 * Used during pipeline ingestion to track field usage patterns.
 *
 * @see dotdo-w93m9 - Pipeline Handler Implementation
 */

/**
 * Extract all paths from an object recursively
 *
 * @param obj - The object to extract paths from
 * @param prefix - Current path prefix
 * @returns Array of all paths in the object
 *
 * @example
 * ```typescript
 * extractPaths({ user: { email: 'a@b.com' } })
 * // ['user', 'user.email']
 * ```
 */
export function extractPaths(obj: unknown, prefix = ''): string[] {
  const paths: string[] = []

  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key
      paths.push(path)
      paths.push(...extractPaths(value, path))
    }
  } else if (Array.isArray(obj)) {
    // For arrays, extract paths from first element as representative
    if (obj.length > 0) {
      const path = prefix ? `${prefix}[]` : '[]'
      paths.push(path)
      paths.push(...extractPaths(obj[0], path))
    }
  }

  return paths
}

/**
 * Extract paths with types for schema inference
 *
 * @param obj - The object to extract paths from
 * @param prefix - Current path prefix
 * @returns Map of path to inferred type
 */
export function extractPathsWithTypes(
  obj: unknown,
  prefix = ''
): Map<string, string> {
  const pathTypes = new Map<string, string>()

  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key
      pathTypes.set(path, inferType(value))

      const nested = extractPathsWithTypes(value, path)
      for (const [nestedPath, nestedType] of nested) {
        pathTypes.set(nestedPath, nestedType)
      }
    }
  } else if (Array.isArray(obj)) {
    if (obj.length > 0) {
      const path = prefix ? `${prefix}[]` : '[]'
      pathTypes.set(path, 'array')

      const nested = extractPathsWithTypes(obj[0], path)
      for (const [nestedPath, nestedType] of nested) {
        pathTypes.set(nestedPath, nestedType)
      }
    }
  }

  return pathTypes
}

/**
 * Infer the type of a value
 */
function inferType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'float'
  }
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'object') return 'object'
  return 'unknown'
}

/**
 * Get value at a specific path
 *
 * @param obj - The object to get value from
 * @param path - Dot-notation path
 * @returns Value at path or undefined
 */
export function getValueAtPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Merge path sets from multiple records
 *
 * @param records - Array of records to extract paths from
 * @returns Set of all unique paths
 */
export function mergePathsFromRecords(
  records: Record<string, unknown>[]
): Set<string> {
  const allPaths = new Set<string>()

  for (const record of records) {
    const paths = extractPaths(record)
    for (const path of paths) {
      allPaths.add(path)
    }
  }

  return allPaths
}
