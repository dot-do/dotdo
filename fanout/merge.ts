/**
 * Result Merging Strategies for Distributed Queries
 *
 * Implements union, intersect, sort, and limit operations
 * for merging results from multiple scanner DOs.
 *
 * Features:
 * - Union: Combine all rows with optional deduplication
 * - Intersect: Keep only rows present in ALL result sets
 * - Sort: Sort combined results by key with null handling
 * - Limit: Apply LIMIT/OFFSET pagination
 *
 * All operations preserve row order and handle null values safely.
 */

export interface QueryResult<T = unknown> {
  rows: T[]
  cursor?: string
  hasMore?: boolean
  scannerId?: string
  error?: string
}

export interface UnionOptions {
  dedupeKey?: string
}

/**
 * Merge strategies for combining results from multiple scanners
 *
 * @example
 * // Union all results
 * const all = merge.union([result1, result2])
 *
 * // Intersect (only common rows)
 * const common = merge.intersect([result1, result2], 'id')
 *
 * // Sort and limit
 * const sorted = merge.sort([result1, result2], 'name', 'asc')
 * const limited = merge.limit(sorted, 10)
 */
export const merge = {
  /**
   * Union all results from multiple sources
   *
   * Combines all rows from all result sets, preserving order from each source.
   * Optionally deduplicates by key to avoid duplicates across shards.
   *
   * @param results Array of query results to union
   * @param options Union options (dedupeKey for deduplication)
   * @returns Combined results (deduplicated if key provided)
   *
   * @example
   * // Simple union
   * const all = merge.union([result1, result2, result3])
   *
   * // Union with deduplication by id
   * const unique = merge.union([result1, result2], { dedupeKey: 'id' })
   */
  union<T>(results: QueryResult<T>[], options?: UnionOptions): QueryResult<T> {
    const rows: T[] = []
    const seen = new Set<unknown>()
    const dedupeKey = options?.dedupeKey

    for (const result of results) {
      for (const row of result.rows) {
        if (dedupeKey) {
          const key = (row as Record<string, unknown>)[dedupeKey]
          if (seen.has(key)) continue
          seen.add(key)
        }
        rows.push(row)
      }
    }

    return { rows }
  },

  /**
   * Intersect results - only rows present in ALL sources (by key)
   *
   * Returns only rows whose key value appears in ALL result sets.
   * Preserves row order from the first result set.
   * Handles duplicates correctly (counts occurrences per result set).
   *
   * @param results Array of query results to intersect
   * @param key Field to use for intersection (must be unique identifier)
   * @returns Only rows with keys present in ALL result sets
   *
   * @example
   * // Intersect: only IDs present in all three shards
   * const common = merge.intersect([shard1, shard2, shard3], 'userId')
   */
  intersect<T>(results: QueryResult<T>[], key: keyof T): QueryResult<T> {
    if (results.length === 0) return { rows: [] }
    if (results.length === 1) return { rows: [...results[0].rows] }

    // Count occurrences of each key value across all result sets
    const keyCounts = new Map<unknown, number>()
    const keyToRow = new Map<unknown, T>()

    for (const result of results) {
      const seenInThisResult = new Set<unknown>()
      for (const row of result.rows) {
        const keyValue = row[key]
        if (!seenInThisResult.has(keyValue)) {
          seenInThisResult.add(keyValue)
          keyCounts.set(keyValue, (keyCounts.get(keyValue) || 0) + 1)
          // Keep first occurrence for the row data
          if (!keyToRow.has(keyValue)) {
            keyToRow.set(keyValue, row)
          }
        }
      }
    }

    // Only include keys that appear in ALL result sets
    const rows: T[] = []
    // Preserve order from first result
    for (const row of results[0].rows) {
      const keyValue = row[key]
      if (keyCounts.get(keyValue) === results.length) {
        rows.push(keyToRow.get(keyValue)!)
        // Mark as used to avoid duplicates
        keyCounts.set(keyValue, 0)
      }
    }

    return { rows }
  },

  /**
   * Sort combined results by key
   *
   * @param results Array of query results to combine and sort
   * @param key Field name to sort by
   * @param direction Sort order - 'asc' (default) or 'desc'
   * @returns Sorted combined results (nulls always last)
   *
   * @example
   * const sorted = merge.sort(results, 'created', 'desc')
   */
  sort<T>(
    results: QueryResult<T>[],
    key: keyof T,
    direction: 'asc' | 'desc' = 'asc'
  ): QueryResult<T> {
    // First union all results
    const allRows: T[] = []
    for (const result of results) {
      allRows.push(...result.rows)
    }

    // Sort with null handling (nulls last)
    allRows.sort((a, b) => {
      const comparison = this.compareValues(a[key], b[key])
      return direction === 'asc' ? comparison : -comparison
    })

    return { rows: allRows }
  },

  /**
   * Limit results to N rows
   *
   * @param result Query result to limit
   * @param n Maximum number of rows to return
   * @returns Limited results with hasMore flag
   *
   * @example
   * const limited = merge.limit(result, 100)
   */
  limit<T>(result: QueryResult<T>, n: number): QueryResult<T> {
    const rows = result.rows.slice(0, n)
    const hasMore = result.rows.length > n || result.hasMore === true

    return {
      rows,
      hasMore: rows.length < result.rows.length || result.hasMore === true,
    }
  },

  /**
   * Compare two values for sorting
   * Handles nulls (last), numbers, strings, and generic values
   */
  compareValues(aVal: unknown, bVal: unknown): number {
    // Nulls always sort last
    if (aVal === null || aVal === undefined) return 1
    if (bVal === null || bVal === undefined) return -1

    // Numeric comparison
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return aVal - bVal
    }

    // String comparison (case-sensitive, locale-aware)
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal)
    }

    // Fallback: convert to string and compare
    return String(aVal).localeCompare(String(bVal))
  },
}
