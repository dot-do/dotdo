/**
 * ColumnarStore Indexes
 *
 * Bloom filters and statistics for query optimization.
 */

import type { BloomFilter, ColumnStats, PathStats } from './types'

/**
 * Simple Bloom filter implementation using multiple hash functions.
 * Uses FNV-1a hash with different seeds for multiple hash functions.
 */
export class SimpleBloomFilter implements BloomFilter {
  private bitArray: boolean[]
  private size: number
  private hashCount: number
  config: { falsePositiveRate: number }

  constructor(expectedElements: number = 1000, falsePositiveRate: number = 0.1) {
    this.config = { falsePositiveRate }

    // Calculate optimal size and hash count
    // m = -n * ln(p) / (ln(2)^2)
    // k = (m/n) * ln(2)
    const n = Math.max(expectedElements, 1)
    const p = falsePositiveRate
    const m = Math.ceil(-n * Math.log(p) / (Math.LN2 * Math.LN2))
    const k = Math.ceil((m / n) * Math.LN2)

    this.size = Math.max(m, 64) // Minimum size of 64 bits
    this.hashCount = Math.max(k, 3) // Minimum 3 hash functions
    this.bitArray = new Array(this.size).fill(false)
  }

  /**
   * FNV-1a hash function with seed
   */
  private hash(value: string, seed: number): number {
    let hash = 2166136261 ^ seed // FNV offset basis XOR seed
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i)
      hash = (hash * 16777619) >>> 0 // FNV prime, keep as 32-bit unsigned
    }
    return hash % this.size
  }

  /**
   * Add a value to the bloom filter
   */
  add(value: string): void {
    for (let i = 0; i < this.hashCount; i++) {
      const index = this.hash(value, i)
      this.bitArray[index] = true
    }
  }

  /**
   * Check if a value might be in the set.
   * Returns true if possibly present (may be false positive).
   * Returns false if definitely not present (no false negatives).
   */
  mightContain(value: string): boolean {
    for (let i = 0; i < this.hashCount; i++) {
      const index = this.hash(value, i)
      if (!this.bitArray[index]) {
        return false
      }
    }
    return true
  }
}

/**
 * Column statistics tracker for query optimization
 */
export class ColumnStatsTracker {
  private stats: Map<string, ColumnStats> = new Map()
  private distinctValues: Map<string, Set<unknown>> = new Map()

  /**
   * Update statistics for a column path with new values
   */
  update(path: string, values: unknown[]): void {
    let current = this.stats.get(path) || {
      min: undefined as unknown,
      max: undefined as unknown,
      nullCount: 0,
      cardinality: 0,
    }

    let distinctSet = this.distinctValues.get(path) || new Set()

    for (const value of values) {
      if (value === null || value === undefined) {
        current.nullCount++
        continue
      }

      distinctSet.add(value)

      // Update min/max
      if (current.min === undefined || value < (current.min as any)) {
        current.min = value
      }
      if (current.max === undefined || value > (current.max as any)) {
        current.max = value
      }
    }

    current.cardinality = distinctSet.size

    this.stats.set(path, current)
    this.distinctValues.set(path, distinctSet)
  }

  /**
   * Get statistics for a column path
   */
  get(path: string): ColumnStats {
    return this.stats.get(path) || {
      min: undefined,
      max: undefined,
      nullCount: 0,
      cardinality: 0,
    }
  }

  /**
   * Check if a range predicate can be satisfied by any records
   */
  canSatisfy(path: string, op: string, value: unknown): boolean {
    const stats = this.stats.get(path)
    if (!stats || stats.min === undefined || stats.max === undefined) {
      // No stats available, assume it might satisfy
      return true
    }

    switch (op) {
      case '>':
        return stats.max > value
      case '>=':
        return stats.max >= value
      case '<':
        return stats.min < value
      case '<=':
        return stats.min <= value
      case '=':
        return stats.min <= value && stats.max >= value
      default:
        return true
    }
  }
}

/**
 * Path statistics tracker for JSON subcolumn extraction
 */
export class PathStatsTracker {
  private pathCounts: Map<string, number> = new Map()
  private pathTypes: Map<string, PathStats['type']> = new Map()
  private pathHasFloat: Map<string, boolean> = new Map() // Track if any value was a float
  private totalRecords: number = 0

  /**
   * Analyze records and update path statistics
   */
  analyze(records: Array<{ data: Record<string, unknown> }>): void {
    this.totalRecords += records.length

    for (const record of records) {
      this.analyzeObject(record.data, 'data')
    }
  }

  /**
   * Recursively analyze an object and track path statistics
   */
  private analyzeObject(obj: Record<string, unknown>, prefix: string): void {
    for (const [key, value] of Object.entries(obj)) {
      const path = `${prefix}.${key}`

      // Count even null values as present for frequency calculation
      // Increment count for this path
      this.pathCounts.set(path, (this.pathCounts.get(path) || 0) + 1)

      if (value !== null && value !== undefined) {
        // Track type (only for non-null values)
        const type = this.inferType(value)

        // For numeric types, track if we've seen a float
        if (type === 'Float64') {
          this.pathHasFloat.set(path, true)
        }

        // Only update type if we haven't seen a Float64 already, or if this is a new Float64
        // This preserves Float64 if any value was a float
        const existingType = this.pathTypes.get(path)
        if (!existingType || type === 'Float64' || !this.pathHasFloat.get(path)) {
          this.pathTypes.set(path, type)
        }

        // Recurse into objects
        if (type === 'Object' && typeof value === 'object') {
          this.analyzeObject(value as Record<string, unknown>, path)
        }
      }
    }
  }

  /**
   * Infer the type of a value
   */
  private inferType(value: unknown): PathStats['type'] {
    if (value === null) return 'Null'
    if (Array.isArray(value)) return 'Array'
    if (typeof value === 'boolean') return 'Bool'
    if (typeof value === 'number') {
      // Check if it has a decimal point in its string representation
      // This handles cases like 88.0 which is technically an integer but should be Float64
      const str = String(value)
      if (str.includes('.') || !Number.isInteger(value)) {
        return 'Float64'
      }
      return 'Int64'
    }
    if (typeof value === 'string') return 'String'
    if (typeof value === 'object') return 'Object'
    return 'Null'
  }

  /**
   * Get statistics for all paths
   */
  getAll(): Record<string, PathStats> {
    const result: Record<string, PathStats> = {}

    for (const [path, count] of this.pathCounts) {
      let type = this.pathTypes.get(path) || 'Null'
      // Skip Object types from being directly extracted
      if (type === 'Object') continue

      // If any value was a float, report as Float64
      if (this.pathHasFloat.get(path) && (type === 'Int64' || type === 'Float64')) {
        type = 'Float64'
      }

      result[path] = {
        frequency: this.totalRecords > 0 ? count / this.totalRecords : 0,
        type,
      }
    }

    return result
  }

  /**
   * Get paths that exceed the extraction threshold
   */
  getExtractable(threshold: number): string[] {
    const stats = this.getAll()
    return Object.entries(stats)
      .filter(([_, stat]) => stat.frequency >= threshold && stat.type !== 'Object')
      .map(([path]) => path)
  }

  /**
   * Get total record count
   */
  getTotalRecords(): number {
    return this.totalRecords
  }
}

/**
 * Extract a value at a nested path from an object
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Set a value at a nested path in an object
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current: Record<string, unknown> = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]] = value
}
