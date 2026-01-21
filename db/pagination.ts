// Cursor-based pagination for @dotdo/db
// Added per do-rljr.8

import type { JsonValue } from './types'
import { DEFAULT_PAGINATION_LIMIT } from '@dotdo/utils'

/**
 * Cursor-based pagination options
 */
export interface CursorPaginationOptions {
  /** Opaque cursor from previous response */
  cursor?: string | undefined
  /** Maximum number of items to return (default: 100) */
  limit?: number
  /** Direction of pagination (default: 'forward') */
  direction?: 'forward' | 'backward'
}

/**
 * Cursor-paginated result
 */
export interface CursorPaginatedResult<T> {
  /** The items in this page */
  items: T[]
  /** Cursor to fetch the next page (if available) */
  nextCursor?: string | undefined
  /** Cursor to fetch the previous page (if available) */
  prevCursor?: string | undefined
  /** Whether there are more items available */
  hasMore: boolean
}

/**
 * Internal cursor data structure
 * Encodes the sort field value and ID for stable pagination
 */
interface CursorData {
  /** Value of the sort field at the cursor position */
  sortValue: JsonValue
  /** ID at the cursor position for tie-breaking */
  id: string
  /** Sort field name */
  sortField: string
  /** Sort direction */
  sortDirection: 'asc' | 'desc'
}

/**
 * Encode cursor data to an opaque base64 string
 */
export function encodeCursor(data: CursorData): string {
  const json = JSON.stringify(data)
  // Use base64 encoding for opacity
  // In browser/worker environments, use btoa; in Node, use globalThis.Buffer
  if (typeof btoa !== 'undefined') {
    return btoa(json)
  }
  // Node.js fallback - access Buffer via globalThis to avoid TypeScript errors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NodeBuffer = (globalThis as any).Buffer
  return NodeBuffer.from(json).toString('base64')
}

/**
 * Decode an opaque cursor string to cursor data
 * Returns null if the cursor is invalid
 */
export function decodeCursor(cursor: string): CursorData | null {
  try {
    let json: string
    if (typeof atob !== 'undefined') {
      json = atob(cursor)
    } else {
      // Node.js fallback - access Buffer via globalThis to avoid TypeScript errors
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const NodeBuffer = (globalThis as any).Buffer
      json = NodeBuffer.from(cursor, 'base64').toString('utf-8')
    }
    const data = JSON.parse(json) as CursorData

    // Validate the cursor structure
    if (
      typeof data.id !== 'string' ||
      typeof data.sortField !== 'string' ||
      (data.sortDirection !== 'asc' && data.sortDirection !== 'desc')
    ) {
      return null
    }

    return data
  } catch {
    return null
  }
}

/**
 * Compare values for sorting
 * Handles different types: numbers, strings, null
 */
function compareValues(a: JsonValue, b: JsonValue): number {
  // Handle nulls - null sorts last
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1

  // Both are numbers
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  // Both are strings
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b)
  }

  // Convert to strings for comparison
  return String(a).localeCompare(String(b))
}

/**
 * Apply cursor-based pagination to an array of items
 *
 * @param items - The full array of items (pre-sorted)
 * @param options - Cursor pagination options
 * @param sortField - The field used for sorting (e.g., '$createdAt')
 * @param sortDirection - Sort direction ('asc' or 'desc')
 * @param getId - Function to get the ID from an item
 * @param getSortValue - Function to get the sort field value from an item
 */
export function applyCursorPagination<T>(
  items: T[],
  options: CursorPaginationOptions,
  sortField: string,
  sortDirection: 'asc' | 'desc',
  getId: (item: T) => string,
  getSortValue: (item: T) => JsonValue
): CursorPaginatedResult<T> {
  const { cursor, limit = DEFAULT_PAGINATION_LIMIT, direction = 'forward' } = options

  let startIndex = 0

  // If cursor is provided, find the starting position
  if (cursor) {
    const cursorData = decodeCursor(cursor)
    if (cursorData) {
      // Find the first item AFTER the cursor position
      // The cursor points to the last item of the previous page
      // We need to find items that come after it in sort order
      const cursorIndex = items.findIndex(item => {
        const itemValue = getSortValue(item)
        const itemId = getId(item)

        // Compare by sort value first
        const cmp = compareValues(itemValue, cursorData.sortValue)

        if (sortDirection === 'desc') {
          // For descending sort: items after cursor have smaller values
          // OR same value with smaller ID
          if (cmp < 0) return true
          if (cmp > 0) return false
          // Same sort value - use ID as tie-breaker
          return itemId < cursorData.id
        } else {
          // For ascending sort: items after cursor have larger values
          // OR same value with larger ID
          if (cmp > 0) return true
          if (cmp < 0) return false
          // Same sort value - use ID as tie-breaker
          return itemId > cursorData.id
        }
      })

      startIndex = cursorIndex === -1 ? items.length : cursorIndex
    }
  }

  // Handle backward pagination
  if (direction === 'backward') {
    // For backward, we need to go before the cursor
    const endIndex = cursor ? startIndex : items.length
    startIndex = Math.max(0, endIndex - limit)
    const pageItems = items.slice(startIndex, endIndex)

    const hasMore = startIndex > 0
    const hasNext = endIndex < items.length

    const lastItem = pageItems[pageItems.length - 1]
    const firstItem = pageItems[0]

    return {
      items: pageItems,
      nextCursor: hasNext && lastItem !== undefined
        ? encodeCursor({
            sortValue: getSortValue(lastItem),
            id: getId(lastItem),
            sortField,
            sortDirection
          })
        : undefined,
      prevCursor: hasMore && firstItem !== undefined
        ? encodeCursor({
            sortValue: getSortValue(firstItem),
            id: getId(firstItem),
            sortField,
            sortDirection
          })
        : undefined,
      hasMore
    }
  }

  // Forward pagination
  const pageItems = items.slice(startIndex, startIndex + limit)
  const hasMore = startIndex + limit < items.length
  const hasPrev = startIndex > 0

  const lastForwardItem = pageItems[pageItems.length - 1]
  const firstForwardItem = pageItems[0]

  return {
    items: pageItems,
    nextCursor: hasMore && lastForwardItem !== undefined
      ? encodeCursor({
          sortValue: getSortValue(lastForwardItem),
          id: getId(lastForwardItem),
          sortField,
          sortDirection
        })
      : undefined,
    prevCursor: hasPrev && firstForwardItem !== undefined
      ? encodeCursor({
          sortValue: getSortValue(firstForwardItem),
          id: getId(firstForwardItem),
          sortField,
          sortDirection
        })
      : undefined,
    hasMore
  }
}
