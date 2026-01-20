// Search tool - MCP tool that searches Things in a DO
// Implements do-7rf.2.2

import type { ThingsStore, Thing } from '@dotdo/db'
import { query } from '@dotdo/db'
import type { MCPTool } from './server'

export interface SearchParams {
  // Type filter
  $type?: string

  // Field value filters
  where?: Record<string, unknown>

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
 * Create a search tool that operates on a ThingsStore
 */
export function createSearchTool(store: ThingsStore): MCPTool {
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

      // Build query
      let q = query(store)

      // Apply type filter
      if ($type) {
        q = q.type($type)
      }

      // Apply where filters
      if (where && Object.keys(where).length > 0) {
        q = q.where(where)
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
 * Default search tool (requires store injection via createSearchTool)
 * This export maintains backward compatibility with the existing import
 */
export const searchTool = {
  name: 'search',
  description: 'Search for Things in the Digital Object store',
  parameters: {} as const,
  execute: async (params: SearchParams) => {
    throw new Error('searchTool must be created with createSearchTool(store)')
  }
}
