/**
 * Path Extractor for Document Store
 *
 * Extracts, tracks, and manipulates JSON paths within documents.
 * Based on ClickHouse's JSON column type approach for automatic typed
 * subcolumn extraction.
 *
 * ## Features
 * - **Path Extraction** - Extract all paths from JSON with type inference
 * - **Path Statistics** - Track field frequency, types, and cardinality
 * - **Path Manipulation** - Get/set values using dot notation
 * - **Array Support** - Handle array elements with [*] notation
 * - **Frequency-Based Promotion** - Identify hot paths for column extraction
 *
 * ## Use Cases
 * - Secondary index creation for document stores
 * - Schema inference from JSON documents
 * - Query optimization hints
 * - Columnar storage layout decisions
 *
 * @example Basic Usage
 * ```typescript
 * import { extractPaths, getPath, setPath, PathStatisticsTracker } from './path-extractor'
 *
 * // Extract all paths from a document
 * const doc = { user: { name: 'Alice', age: 30 }, tags: ['admin'] }
 * const paths = extractPaths(doc)
 * // Map { 'user' => 'object', 'user.name' => 'string', 'user.age' => 'number', 'tags' => 'array' }
 *
 * // Get value at path
 * const name = getPath(doc, 'user.name') // 'Alice'
 *
 * // Set value at path
 * setPath(doc, 'user.email', 'alice@example.com')
 *
 * // Track statistics across many documents
 * const tracker = new PathStatisticsTracker({ extractionThreshold: 0.1 })
 * tracker.track(doc1)
 * tracker.track(doc2)
 * const hotPaths = tracker.getExtractedPaths() // paths appearing in >10% of docs
 * ```
 *
 * @module db/primitives/document-store/path-extractor
 */

// ============================================================================
// Types
// ============================================================================

/**
 * JSON value types
 */
export type JSONValue = string | number | boolean | null | JSONObject | JSONArray

/**
 * JSON object type
 */
export interface JSONObject {
  [key: string]: JSONValue
}

/**
 * JSON array type
 */
export type JSONArray = JSONValue[]

/**
 * JSON type discriminator
 */
export type JSONType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object'

/**
 * Statistics for a single JSON path
 */
export interface PathStatistics {
  /** The JSON path (dot notation) */
  path: string
  /** Frequency of occurrence (0-1) across tracked documents */
  frequency: number
  /** Dominant type at this path */
  type: JSONType
  /** Distribution of types seen at this path */
  typeDistribution: Record<JSONType, number>
  /** Estimated cardinality (unique values) */
  cardinality: number
  /** Whether this path should be extracted as a column */
  isExtracted: boolean
  /** Average size in bytes (for strings) */
  avgSize?: number
}

/**
 * Options for PathStatisticsTracker
 */
export interface PathStatisticsOptions {
  /**
   * Minimum frequency for a path to be extracted as a column.
   * Paths appearing in >= this fraction of documents are extracted.
   * @default 0.1 (10% of documents)
   */
  extractionThreshold?: number

  /**
   * Maximum depth for path extraction.
   * Limits how deep into nested objects we go.
   * @default 10
   */
  maxDepth?: number

  /**
   * Whether to track array element paths with [*] notation.
   * @default true
   */
  trackArrayElements?: boolean
}

/**
 * Column configuration derived from path statistics
 */
export interface ColumnConfig {
  /** The JSON path */
  path: string
  /** The column type */
  type: JSONType
  /** Whether null values are allowed */
  nullable: boolean
  /** The extraction threshold that was met */
  extractionThreshold: number
  /** Whether the column has been extracted */
  isExtracted: boolean
}

// ============================================================================
// Path Extraction Functions
// ============================================================================

/**
 * Extract all paths from a JSON value with their types.
 *
 * Traverses nested objects and arrays, producing a map of dot-notation
 * paths to their JSON types.
 *
 * @param obj - The JSON value to extract paths from
 * @param prefix - Optional path prefix for recursive calls
 * @param maxDepth - Maximum nesting depth to traverse
 * @returns Map of paths to their types
 *
 * @example
 * ```typescript
 * const doc = {
 *   user: { name: 'Alice', age: 30 },
 *   tags: ['admin', 'premium']
 * }
 *
 * const paths = extractPaths(doc)
 * // Map {
 * //   'user' => 'object',
 * //   'user.name' => 'string',
 * //   'user.age' => 'number',
 * //   'tags' => 'array',
 * //   'tags[*]' => 'string'
 * // }
 * ```
 */
export function extractPaths(
  obj: JSONValue,
  prefix = '',
  maxDepth = 10
): Map<string, JSONType> {
  const paths = new Map<string, JSONType>()

  if (maxDepth <= 0) {
    if (prefix) {
      paths.set(prefix, inferType(obj))
    }
    return paths
  }

  if (obj === null) {
    if (prefix) paths.set(prefix, 'null')
    return paths
  }

  if (Array.isArray(obj)) {
    if (prefix) paths.set(prefix, 'array')
    // Index into arrays with [*] notation
    for (const item of obj) {
      const subPaths = extractPaths(item, prefix ? `${prefix}[*]` : '[*]', maxDepth - 1)
      for (const [p, t] of subPaths) {
        // Keep the first type seen for each path, or merge
        if (!paths.has(p)) {
          paths.set(p, t)
        }
      }
    }
    return paths
  }

  if (typeof obj === 'object') {
    if (prefix) paths.set(prefix, 'object')
    for (const [key, value] of Object.entries(obj)) {
      const newPrefix = prefix ? `${prefix}.${key}` : key
      const subPaths = extractPaths(value, newPrefix, maxDepth - 1)
      for (const [p, t] of subPaths) {
        paths.set(p, t)
      }
    }
    return paths
  }

  // Primitive types
  if (prefix) {
    paths.set(prefix, inferType(obj))
  }
  return paths
}

/**
 * Infer the JSON type of a value
 */
export function inferType(value: JSONValue): JSONType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const t = typeof value
  if (t === 'string') return 'string'
  if (t === 'number') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t === 'object') return 'object'
  return 'null'
}

/**
 * Get value at a JSON path using dot notation.
 *
 * Supports nested objects and array access.
 *
 * @param obj - The object to query
 * @param path - Dot-notation path (e.g., 'user.address.city')
 * @returns The value at the path, or undefined if not found
 *
 * @example
 * ```typescript
 * const doc = { user: { name: 'Alice', addresses: [{ city: 'NYC' }] } }
 *
 * getPath(doc, 'user.name')           // 'Alice'
 * getPath(doc, 'user.addresses.0.city') // 'NYC'
 * getPath(doc, 'user.missing')        // undefined
 * ```
 */
export function getPath(obj: JSONValue, path: string): JSONValue | undefined {
  if (!path) return obj

  // Split on dots and array brackets
  const parts = path.split(/\.|\[|\]/).filter((p) => p && p !== '*')
  let current: JSONValue = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined

    if (Array.isArray(current)) {
      const index = parseInt(part, 10)
      if (isNaN(index)) return undefined
      current = current[index]
    } else {
      current = (current as JSONObject)[part]
    }
  }

  return current
}

/**
 * Set value at a JSON path using dot notation.
 *
 * Creates intermediate objects as needed.
 *
 * @param obj - The object to modify
 * @param path - Dot-notation path (e.g., 'user.address.city')
 * @param value - The value to set
 *
 * @example
 * ```typescript
 * const doc = {}
 * setPath(doc, 'user.address.city', 'NYC')
 * // doc = { user: { address: { city: 'NYC' } } }
 * ```
 */
export function setPath(obj: JSONObject, path: string, value: JSONValue): void {
  const parts = path.split('.')
  let current: JSONValue = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (!(current as JSONObject)[part]) {
      // Check if next part is a number (array index)
      const nextPart = parts[i + 1]
      if (nextPart && /^\d+$/.test(nextPart)) {
        ;(current as JSONObject)[part] = []
      } else {
        ;(current as JSONObject)[part] = {}
      }
    }
    current = (current as JSONObject)[part]
  }

  const lastPart = parts[parts.length - 1]!

  // Handle array index assignment
  if (Array.isArray(current)) {
    const index = parseInt(lastPart, 10)
    if (!isNaN(index)) {
      current[index] = value
      return
    }
  }

  ;(current as JSONObject)[lastPart] = value
}

/**
 * Delete value at a JSON path.
 *
 * @param obj - The object to modify
 * @param path - Dot-notation path to delete
 * @returns true if the path existed and was deleted
 *
 * @example
 * ```typescript
 * const doc = { user: { name: 'Alice', age: 30 } }
 * deletePath(doc, 'user.age')
 * // doc = { user: { name: 'Alice' } }
 * ```
 */
export function deletePath(obj: JSONObject, path: string): boolean {
  const parts = path.split('.')
  let current: JSONValue = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (!(current as JSONObject)[part]) return false
    if (typeof (current as JSONObject)[part] !== 'object') return false
    current = (current as JSONObject)[part]
  }

  const lastPart = parts[parts.length - 1]!
  if ((current as JSONObject)[lastPart] === undefined) return false

  delete (current as JSONObject)[lastPart]
  return true
}

/**
 * Check if a path exists in an object
 *
 * @param obj - The object to check
 * @param path - Dot-notation path
 * @returns true if the path exists
 */
export function hasPath(obj: JSONValue, path: string): boolean {
  return getPath(obj, path) !== undefined
}

/**
 * Get all leaf paths (non-object, non-array) from a document
 *
 * @param obj - The object to extract leaf paths from
 * @returns Array of paths that point to primitive values
 */
export function getLeafPaths(obj: JSONValue): string[] {
  const allPaths = extractPaths(obj)
  return Array.from(allPaths.entries())
    .filter(([_, type]) => type !== 'object' && type !== 'array')
    .map(([path]) => path)
}

// ============================================================================
// Path Statistics Tracker
// ============================================================================

/**
 * Tracks path statistics across multiple documents.
 *
 * Used to identify frequently-accessed paths that should be
 * extracted as separate columns for efficient querying.
 *
 * @example
 * ```typescript
 * const tracker = new PathStatisticsTracker({ extractionThreshold: 0.1 })
 *
 * // Track many documents
 * for (const doc of documents) {
 *   tracker.track(doc)
 * }
 *
 * // Get paths that appear in >10% of documents
 * const hotPaths = tracker.getExtractedPaths()
 *
 * // Get all statistics
 * const allStats = tracker.getAllStats()
 * ```
 */
export class PathStatisticsTracker {
  private pathStats: Map<string, PathStatistics & { count: number }> = new Map()
  private recordCount = 0
  private uniqueValues: Map<string, Set<string>> = new Map()
  private readonly options: Required<PathStatisticsOptions>

  constructor(options: PathStatisticsOptions = {}) {
    this.options = {
      extractionThreshold: options.extractionThreshold ?? 0.1,
      maxDepth: options.maxDepth ?? 10,
      trackArrayElements: options.trackArrayElements ?? true,
    }
  }

  /**
   * Track paths from a JSON document
   *
   * @param data - The document to track
   */
  track(data: JSONObject): void {
    this.recordCount++
    const paths = extractPaths(data, '', this.options.maxDepth)

    for (const [path, type] of paths) {
      // Skip array wildcard paths if not tracking
      if (!this.options.trackArrayElements && path.includes('[*]')) {
        continue
      }

      let stats = this.pathStats.get(path)

      if (!stats) {
        stats = {
          path,
          frequency: 0,
          type,
          typeDistribution: { string: 0, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
          cardinality: 0,
          isExtracted: false,
          count: 0,
        }
        this.pathStats.set(path, stats)
        this.uniqueValues.set(path, new Set())
      }

      stats.count++
      stats.frequency = stats.count / this.recordCount
      stats.typeDistribution[type]++

      // Update dominant type
      let maxCount = 0
      let dominantType: JSONType = 'null'
      for (const [t, count] of Object.entries(stats.typeDistribution)) {
        if (count > maxCount) {
          maxCount = count
          dominantType = t as JSONType
        }
      }
      stats.type = dominantType

      // Track cardinality for leaf paths
      if (type !== 'object' && type !== 'array') {
        const value = getPath(data, path)
        if (value !== undefined) {
          const valueStr = JSON.stringify(value)
          this.uniqueValues.get(path)!.add(valueStr)
          stats.cardinality = this.uniqueValues.get(path)!.size

          // Track average size for strings
          if (type === 'string' && typeof value === 'string') {
            const currentAvg = stats.avgSize ?? 0
            const prevCount = stats.count - 1
            stats.avgSize = (currentAvg * prevCount + value.length) / stats.count
          }
        }
      }
    }

    // Update frequencies for paths not seen in this record
    for (const stats of this.pathStats.values()) {
      if (!paths.has(stats.path)) {
        stats.frequency = stats.count / this.recordCount
      }
    }
  }

  /**
   * Get paths that should be extracted as columns.
   *
   * Returns leaf paths (primitives) that appear in at least
   * `extractionThreshold` fraction of documents.
   *
   * @returns Array of path statistics for extracted paths, sorted by frequency
   */
  getExtractedPaths(): PathStatistics[] {
    const extracted: PathStatistics[] = []

    for (const stats of this.pathStats.values()) {
      // Only extract leaf paths (primitives), not objects/arrays
      if (stats.type !== 'object' && stats.type !== 'array') {
        if (stats.frequency >= this.options.extractionThreshold) {
          stats.isExtracted = true
          extracted.push({ ...stats })
        }
      }
    }

    return extracted.sort((a, b) => b.frequency - a.frequency)
  }

  /**
   * Get all path statistics
   *
   * @returns Array of all path statistics, sorted by frequency
   */
  getAllStats(): PathStatistics[] {
    return Array.from(this.pathStats.values())
      .map((stats) => ({ ...stats }))
      .sort((a, b) => b.frequency - a.frequency)
  }

  /**
   * Get statistics for a specific path
   *
   * @param path - The path to get statistics for
   * @returns Path statistics or undefined if not tracked
   */
  getStats(path: string): PathStatistics | undefined {
    const stats = this.pathStats.get(path)
    return stats ? { ...stats } : undefined
  }

  /**
   * Get the number of documents tracked
   */
  getRecordCount(): number {
    return this.recordCount
  }

  /**
   * Get paths matching a filter
   *
   * @param filter - Filter function
   * @returns Matching path statistics
   */
  filter(filter: (stats: PathStatistics) => boolean): PathStatistics[] {
    return this.getAllStats().filter(filter)
  }

  /**
   * Get paths by type
   *
   * @param type - The JSON type to filter by
   * @returns Path statistics for paths of the given type
   */
  getPathsByType(type: JSONType): PathStatistics[] {
    return this.filter((stats) => stats.type === type)
  }

  /**
   * Get high cardinality paths (many unique values)
   *
   * @param minCardinality - Minimum cardinality threshold
   * @returns Paths with cardinality >= threshold
   */
  getHighCardinalityPaths(minCardinality: number): PathStatistics[] {
    return this.filter((stats) => stats.cardinality >= minCardinality)
  }

  /**
   * Generate column configurations for extracted paths
   *
   * @returns Column configurations for use with TypedColumnStore
   */
  getColumnConfigs(): ColumnConfig[] {
    return this.getExtractedPaths().map((stats) => ({
      path: stats.path,
      type: stats.type,
      nullable: stats.frequency < 1.0,
      extractionThreshold: this.options.extractionThreshold,
      isExtracted: true,
    }))
  }

  /**
   * Merge statistics from another tracker
   *
   * @param other - The tracker to merge from
   */
  merge(other: PathStatisticsTracker): void {
    const otherRecordCount = other.getRecordCount()
    const totalRecords = this.recordCount + otherRecordCount

    for (const otherStats of other.getAllStats()) {
      const existing = this.pathStats.get(otherStats.path)

      if (existing) {
        // Merge counts and frequencies
        const newCount = existing.count + (otherStats as PathStatistics & { count: number }).count || 0
        existing.count = newCount
        existing.frequency = newCount / totalRecords

        // Merge type distributions
        for (const [type, count] of Object.entries(otherStats.typeDistribution)) {
          existing.typeDistribution[type as JSONType] += count
        }

        // Update dominant type
        let maxCount = 0
        let dominantType: JSONType = 'null'
        for (const [t, count] of Object.entries(existing.typeDistribution)) {
          if (count > maxCount) {
            maxCount = count
            dominantType = t as JSONType
          }
        }
        existing.type = dominantType

        // Max cardinality (approximate)
        existing.cardinality = Math.max(existing.cardinality, otherStats.cardinality)
      } else {
        // Add new path
        this.pathStats.set(otherStats.path, {
          ...otherStats,
          count: (otherStats as PathStatistics & { count: number }).count || Math.round(otherStats.frequency * otherRecordCount),
          frequency: (otherStats.frequency * otherRecordCount) / totalRecords,
        })
        this.uniqueValues.set(otherStats.path, new Set())
      }
    }

    this.recordCount = totalRecords
  }

  /**
   * Reset all statistics
   */
  reset(): void {
    this.pathStats.clear()
    this.uniqueValues.clear()
    this.recordCount = 0
  }

  /**
   * Serialize statistics to JSON
   */
  toJSON(): { recordCount: number; paths: PathStatistics[] } {
    return {
      recordCount: this.recordCount,
      paths: this.getAllStats(),
    }
  }

  /**
   * Create tracker from serialized JSON
   */
  static fromJSON(
    json: { recordCount: number; paths: PathStatistics[] },
    options?: PathStatisticsOptions
  ): PathStatisticsTracker {
    const tracker = new PathStatisticsTracker(options)
    tracker.recordCount = json.recordCount

    for (const stats of json.paths) {
      tracker.pathStats.set(stats.path, {
        ...stats,
        count: Math.round(stats.frequency * json.recordCount),
      })
      tracker.uniqueValues.set(stats.path, new Set())
    }

    return tracker
  }
}

// ============================================================================
// Type Coercion
// ============================================================================

/**
 * Coerce a value to a target type
 *
 * @param value - The value to coerce
 * @param targetType - The target type
 * @returns The coerced value, or null if coercion fails
 */
export function coerceType(value: JSONValue, targetType: JSONType): JSONValue {
  if (value === null) return null
  const currentType = inferType(value)
  if (currentType === targetType) return value

  switch (targetType) {
    case 'string':
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
      }
      return JSON.stringify(value)

    case 'number':
      if (typeof value === 'string') {
        const num = parseFloat(value)
        return isNaN(num) ? null : num
      }
      if (typeof value === 'boolean') {
        return value ? 1 : 0
      }
      return null

    case 'boolean':
      if (typeof value === 'string') {
        const lower = value.toLowerCase()
        if (lower === 'true' || lower === '1' || lower === 'yes') return true
        if (lower === 'false' || lower === '0' || lower === 'no') return false
        return null
      }
      if (typeof value === 'number') {
        return value !== 0
      }
      return null

    case 'null':
      return null

    case 'array':
      if (Array.isArray(value)) return value
      return [value]

    case 'object':
      if (typeof value === 'object' && !Array.isArray(value)) return value
      return null
  }
}

/**
 * Check if a value can be coerced to a target type without data loss
 */
export function canCoerce(value: JSONValue, targetType: JSONType): boolean {
  const coerced = coerceType(value, targetType)
  if (coerced === null && value !== null) return false

  // Check round-trip for primitives
  if (targetType === 'string' && typeof value !== 'string') {
    const roundTrip = coerceType(coerced, inferType(value))
    return JSON.stringify(roundTrip) === JSON.stringify(value)
  }

  return true
}
