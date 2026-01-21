// Search tool - MCP tool that searches Things in a DO
// Implements do-7rf.2.2
// Decoupled from @dotdo/db (do-7jse)

import type { ThingsStore, Thing, StorableData, QueryBuilder, QueryFactory } from './types'
import type { MCPTool } from './server'

export interface SearchParams {
  // Type filter
  $type?: string

  // Field value filters
  where?: Partial<StorableData>

  // Full-text search across all string fields
  query?: string

  // Sorting
  orderBy?: string
  order?: 'asc' | 'desc'

  // Pagination
  limit?: number
  offset?: number

  // Field selection (projection)
  select?: string[]
}

export interface SearchResult {
  results: Thing[]
  total: number
  hasMore: boolean
  limit: number
  offset: number
}

/**
 * Dependencies for creating a search tool
 */
export interface SearchToolDeps {
  /** The ThingsStore to search */
  store: ThingsStore

  /**
   * Optional query factory for advanced query building.
   * If not provided, uses simple list-based implementation.
   * Compatible with @dotdo/db's query() function.
   */
  query?: QueryFactory
}

/**
 * Create a simple query builder that works with the minimal ThingsStore interface.
 * This is used when no external query factory is provided.
 */
function createSimpleQueryBuilder(store: ThingsStore): QueryBuilder {
  const options: {
    type?: string
    where?: StorableData
    orderBy?: string
    order?: 'asc' | 'desc'
    limit?: number
    selectFields?: string[]
  } = {}

  const builder: QueryBuilder = {
    type(typeName: string) {
      options.type = typeName
      return builder
    },

    where(conditions: StorableData) {
      options.where = { ...(options.where || {}), ...conditions }
      return builder
    },

    orderBy(field: string, direction: 'asc' | 'desc') {
      options.orderBy = field
      options.order = direction
      return builder
    },

    select(...fields: string[]) {
      options.selectFields = fields
      return builder
    },

    limit(count: number) {
      options.limit = count
      return builder
    },

    async execute(): Promise<Thing[]> {
      // Use the store's list method with type filter
      const listOptions: { type?: string; limit?: number } = {}
      if (options.type) listOptions.type = options.type
      if (options.limit) listOptions.limit = options.limit

      let results = await store.list(listOptions)

      // Apply where filters
      if (options.where && Object.keys(options.where).length > 0) {
        results = results.filter(thing => {
          for (const [key, value] of Object.entries(options.where!)) {
            if (thing[key] !== value) return false
          }
          return true
        })
      }

      // Apply ordering
      if (options.orderBy) {
        const field = options.orderBy
        const multiplier = options.order === 'asc' ? 1 : -1
        results.sort((a, b) => {
          const aVal = a[field] as string | number | boolean | null | undefined
          const bVal = b[field] as string | number | boolean | null | undefined
          if (aVal == null && bVal == null) return 0
          if (aVal == null) return 1 * multiplier
          if (bVal == null) return -1 * multiplier
          if (aVal < bVal) return -1 * multiplier
          if (aVal > bVal) return 1 * multiplier
          return 0
        })
      }

      // Apply projection
      if (options.selectFields && options.selectFields.length > 0) {
        const fields = ['$id', '$type', ...options.selectFields]
        results = results.map(thing => {
          const projected: Record<string, unknown> = {}
          for (const field of fields) {
            if (field in thing) {
              projected[field] = thing[field]
            }
          }
          return projected as Thing
        })
      }

      return results
    }
  }

  return builder
}

/**
 * Factory function to create a search tool that operates on a ThingsStore
 *
 * This is the correct way to create a search tool. The default `searchTool` export
 * is a placeholder and will throw an error if used directly.
 *
 * @param deps - Dependencies object or ThingsStore
 * @param deps.store - The ThingsStore to search (required)
 * @param deps.query - Optional query factory for advanced query building (compatible with @dotdo/db)
 *
 * @returns A configured MCPTool ready to be added to an MCP server
 *
 * @example Basic usage with just a store
 * ```typescript
 * import { createSearchTool } from '@dotdo/mcp'
 * import { createMCPServer } from '@dotdo/mcp'
 *
 * const server = createMCPServer()
 * const searchTool = createSearchTool({ store: myThingsStore })
 * server.addTool(searchTool)
 *
 * // Now clients can search
 * const results = await searchTool.execute({
 *   $type: 'User',
 *   where: { role: 'admin' },
 *   limit: 10
 * })
 * ```
 *
 * @example Advanced usage with @dotdo/db query factory
 * ```typescript
 * import { createSearchTool } from '@dotdo/mcp'
 * import { query } from '@dotdo/db'
 *
 * const searchTool = createSearchTool({
 *   store: myThingsStore,
 *   query: (store) => query(store) // Enables advanced SQL queries
 * })
 * ```
 *
 * @example Backward compatible API (just pass store directly)
 * ```typescript
 * const searchTool = createSearchTool(myThingsStore)
 * ```
 */
export function createSearchTool(deps: SearchToolDeps | ThingsStore): MCPTool {
  // Support both old API (just store) and new API (deps object)
  const { store, query: queryFactory } = 'store' in deps
    ? deps
    : { store: deps, query: undefined }

  return {
    name: 'search',
    description: 'Search for Things in the Digital Object store. Supports filtering by type, field values, full-text search, sorting, and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        $type: {
          type: 'string',
          description: 'Filter by Thing type (e.g., "User", "Order")'
        },
        where: {
          type: 'object',
          description: 'Filter by field values (e.g., { role: "admin", age: 30 })',
          additionalProperties: true
        },
        query: {
          type: 'string',
          description: 'Full-text search across all string fields (case-insensitive)'
        },
        orderBy: {
          type: 'string',
          description: 'Field to sort by'
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order (default: desc)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20, max: 100)',
          minimum: 1,
          maximum: 100
        },
        offset: {
          type: 'number',
          description: 'Number of results to skip (for pagination)',
          minimum: 0
        },
        select: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to include in results ($id and $type always included)'
        }
      }
    },

    async execute(params: unknown): Promise<SearchResult> {
      const {
        $type,
        where,
        query: searchQuery,
        orderBy,
        order = 'desc',
        limit = 20,
        offset = 0,
        select
      } = (params as SearchParams) || {}

      // Validation
      if (limit !== undefined && (limit < 1 || limit > 100)) {
        throw new Error('limit must be between 1 and 100')
      }

      if (offset !== undefined && offset < 0) {
        throw new Error('offset must be non-negative')
      }

      if (order && order !== 'asc' && order !== 'desc') {
        throw new Error('order must be "asc" or "desc"')
      }

      // Build query using injected factory or simple built-in
      const createQueryBuilder = queryFactory || createSimpleQueryBuilder
      let q = createQueryBuilder(store)

      // Apply type filter
      if ($type) {
        q = q.type($type)
      }

      // Apply where filters
      if (where && Object.keys(where).length > 0) {
        q = q.where(where as StorableData)
      }

      // Apply ordering
      if (orderBy) {
        q = q.orderBy(orderBy, order)
      }

      // Apply field selection
      if (select && select.length > 0) {
        q = q.select(...select)
      }

      // Execute query to get all matching results (for total count)
      const allResults = await q.execute()

      // Apply full-text search filter if query provided
      let filteredResults = allResults
      if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase()
        filteredResults = allResults.filter(thing => {
          // Search in all string fields
          for (const [key, value] of Object.entries(thing)) {
            if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) {
              return true
            }
          }
          return false
        })
      }

      const total = filteredResults.length

      // Apply pagination
      const paginatedResults = filteredResults.slice(offset, offset + limit)

      return {
        results: paginatedResults,
        total,
        hasMore: offset + limit < total,
        limit,
        offset
      }
    }
  }
}

/**
 * Default search tool export - NOT DIRECTLY USABLE
 *
 * IMPORTANT: This is a placeholder export that cannot be used directly.
 * You must create a configured instance using the factory function.
 *
 * Why? The search tool needs access to a ThingsStore instance to perform
 * searches. Since this is injected at runtime, we use a factory pattern.
 *
 * @example Correct usage - Create tool with factory
 * ```typescript
 * import { createSearchTool } from '@dotdo/mcp'
 *
 * // Simple usage with just a store
 * const searchTool = createSearchTool({ store: myThingsStore })
 * server.addTool(searchTool)
 *
 * // With @dotdo/db query factory for advanced features
 * import { query } from '@dotdo/db'
 * const searchTool = createSearchTool({
 *   store: myThingsStore,
 *   query: (store) => query(store)
 * })
 * server.addTool(searchTool)
 * ```
 *
 * @example INCORRECT usage - This will throw an error
 * ```typescript
 * import { searchTool } from '@dotdo/mcp'
 *
 * // ❌ This will fail at runtime when execute() is called
 * server.addTool(searchTool)
 * await searchTool.execute({ $type: 'User' }) // throws error
 * ```
 *
 * @throws Error with instructions when execute() is called without proper initialization
 * @see createSearchTool for the factory function to create a working tool
 */
export const searchTool: MCPTool = {
  name: 'search',
  description: 'Search for Things in the Digital Object store',
  inputSchema: {
    type: 'object',
    properties: {
      $type: { type: 'string', description: 'Filter by Thing type' },
      where: { type: 'object', description: 'Filter by field values' },
      query: { type: 'string', description: 'Full-text search' },
      limit: { type: 'number', description: 'Maximum results (default: 20)' },
      offset: { type: 'number', description: 'Results to skip' }
    }
  },
  /**
   * Placeholder execute method - WILL THROW ERROR
   *
   * This method always throws an error to guide developers to use the factory pattern.
   * The searchTool export cannot function without a ThingsStore dependency injected
   * at runtime via createSearchTool().
   *
   * @throws Always throws with instructions to use createSearchTool() instead
   */
  execute: async (_params: unknown) => {
    throw new Error(
      'searchTool cannot be used directly - it requires dependency injection.\n\n' +
      'Use the factory pattern instead:\n\n' +
      '  import { createSearchTool } from "@dotdo/mcp"\n' +
      '  const searchTool = createSearchTool({ store: myThingsStore })\n' +
      '  server.addTool(searchTool)\n\n' +
      'Why? The search tool needs a ThingsStore instance to perform searches.\n' +
      'Since dependencies are injected at runtime, we use a factory function.\n\n' +
      'See createSearchTool() JSDoc for complete examples and options.'
    )
  }
}
