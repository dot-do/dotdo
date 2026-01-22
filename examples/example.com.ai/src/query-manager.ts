/**
 * Query Manager for Parent DO
 *
 * Provides global query capabilities across all child DOs:
 * - Query by entity type ($type)
 * - Filter by properties
 * - Pagination support
 * - Child-specific queries
 *
 * @module examples/example.com.ai/src/query-manager
 */

import type { GlobalQueryOptions, ChildDOInfo } from './types'
import type { ChildrenManager } from './children-manager'

/**
 * Query result item with source information
 */
export interface QueryResultItem<T = unknown> {
  data: T
  childId?: string
}

/**
 * Query Manager
 *
 * Handles global and child-specific queries.
 */
export class QueryManager {
  private childrenManager: ChildrenManager
  private dataStore: Map<string, unknown[]> = new Map()

  constructor(childrenManager: ChildrenManager) {
    this.childrenManager = childrenManager
  }

  /**
   * Store data from a child for querying
   */
  storeData(childId: string, type: string, item: unknown): void {
    const key = `${childId}:${type}`
    const existing = this.dataStore.get(key) || []
    this.dataStore.set(key, [...existing, item])
  }

  /**
   * Global query across all children
   */
  async global<T = unknown>(options: GlobalQueryOptions): Promise<T[]> {
    const { $type, filters, limit, offset = 0 } = options
    const results: T[] = []

    // Iterate through all stored data
    for (const [key, items] of this.dataStore) {
      // Filter by type if specified
      if ($type && !key.endsWith(`:${$type}`)) {
        continue
      }

      for (const item of items) {
        // Apply filters if specified
        if (filters && !this.matchesFilters(item, filters)) {
          continue
        }

        results.push(item as T)
      }
    }

    // Apply pagination
    const paginatedResults = results.slice(offset, limit ? offset + limit : undefined)

    return paginatedResults
  }

  /**
   * Query specific child DO
   */
  async child<T = unknown>(childId: string, options: GlobalQueryOptions): Promise<T[]> {
    const { $type, filters, limit, offset = 0 } = options
    const results: T[] = []

    // Only query data from the specific child
    for (const [key, items] of this.dataStore) {
      // Only include data from this child
      if (!key.startsWith(`${childId}:`)) {
        continue
      }

      // Filter by type if specified
      if ($type && !key.endsWith(`:${$type}`)) {
        continue
      }

      for (const item of items) {
        // Apply filters if specified
        if (filters && !this.matchesFilters(item, filters)) {
          continue
        }

        results.push(item as T)
      }
    }

    // Apply pagination
    const paginatedResults = results.slice(offset, limit ? offset + limit : undefined)

    return paginatedResults
  }

  /**
   * Check if an item matches the given filters
   */
  private matchesFilters(item: unknown, filters: Record<string, unknown>): boolean {
    if (typeof item !== 'object' || item === null) {
      return false
    }

    const obj = item as Record<string, unknown>

    for (const [key, value] of Object.entries(filters)) {
      if (obj[key] !== value) {
        return false
      }
    }

    return true
  }

  /**
   * Clear all stored data
   */
  clear(): void {
    this.dataStore.clear()
  }
}

/**
 * Create the $.query proxy interface
 */
export function createQueryProxy(manager: QueryManager): {
  global: <T = unknown>(options: GlobalQueryOptions) => Promise<T[]>
  child: <T = unknown>(childId: string, options: GlobalQueryOptions) => Promise<T[]>
} {
  return {
    global: <T = unknown>(options: GlobalQueryOptions) => manager.global<T>(options),
    child: <T = unknown>(childId: string, options: GlobalQueryOptions) => manager.child<T>(childId, options),
  }
}
