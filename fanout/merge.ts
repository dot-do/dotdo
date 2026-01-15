/**
 * Result Merging Strategies for Distributed Queries
 *
 * Implements union, intersect, sort, and limit operations
 * for merging results from multiple scanner DOs.
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
 */
export const merge = {
  /**
   * Union all results from multiple sources
   * Preserves order: source 0, then source 1, etc.
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
      const aVal = a[key]
      const bVal = b[key]

      // Nulls last
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1

      // Compare values
      let comparison: number
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal
      } else if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal)
      } else {
        comparison = String(aVal).localeCompare(String(bVal))
      }

      return direction === 'asc' ? comparison : -comparison
    })

    return { rows: allRows }
  },

  /**
   * Limit results to N rows
   */
  limit<T>(result: QueryResult<T>, n: number): QueryResult<T> {
    const rows = result.rows.slice(0, n)
    const hasMore = result.rows.length > n || result.hasMore === true

    return {
      rows,
      hasMore: rows.length < result.rows.length || result.hasMore === true,
    }
  },
}
