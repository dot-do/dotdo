/**
 * Standard Pagination Utilities
 *
 * Unified pagination interface across REST, RPC, and compat layers.
 * Supports both cursor-based and offset-based pagination with consistent metadata.
 *
 * @module lib/pagination
 */

// ============================================================================
// Constants
// ============================================================================

/** Default page size when limit is not specified */
export const DEFAULT_LIMIT = 20

/** Maximum allowed page size */
export const MAX_LIMIT = 100

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Pagination parameters accepted by paginated endpoints.
 * Supports multiple pagination strategies for flexibility.
 */
export interface PaginationParams {
  /** Opaque cursor from previous response (cursor-based pagination) */
  cursor?: string
  /** Maximum items to return (default: 20, max: 100) */
  limit?: number
  /** Number of items to skip (offset-based pagination) */
  offset?: number
  /** Page number, 1-indexed (convenience for offset-based) */
  page?: number
}

/**
 * Pagination metadata included in responses.
 * Uses GraphQL Relay-style cursor naming conventions.
 */
export interface PaginationMeta {
  /** Total count of all items matching the query (optional for performance) */
  total?: number
  /** Whether more items exist after the current page */
  hasNextPage: boolean
  /** Whether more items exist before the current page */
  hasPreviousPage: boolean
  /** Cursor pointing to the first item in the current page */
  startCursor?: string
  /** Cursor pointing to the last item in the current page */
  endCursor?: string
}

/**
 * Paginated result with data and metadata
 */
export interface PaginatedResult<T> {
  /** The actual data items */
  data: T[]
  /** Pagination metadata */
  meta: PaginationMeta
}

/**
 * Internal cursor data structure.
 * Contains position information encoded into the cursor.
 */
export interface CursorData {
  /** Current offset position */
  offset: number
  /** Optional sort key for keyset pagination */
  sortKey?: string | number
  /** Optional secondary sort key for composite ordering */
  secondaryKey?: string | number
  /** Cursor version for forward compatibility */
  v?: number
}

/**
 * Options for the paginate function
 */
export interface PaginateOptions {
  /** Skip including total count (for performance) */
  skipTotal?: boolean
  /** Extract a key from each item for cursor generation */
  getItemKey?: (item: unknown, index: number) => string | number
}

// ============================================================================
// Cursor Encoding/Decoding
// ============================================================================

/**
 * Encode data into an opaque, URL-safe cursor string.
 *
 * Uses base64url encoding (RFC 4648 section 5) for URL safety.
 * The cursor is opaque to clients - they should not parse or modify it.
 *
 * @param data - Object to encode into cursor
 * @returns URL-safe opaque cursor string
 *
 * @example
 * ```ts
 * const cursor = encodeCursor({ offset: 20, sortKey: 'item-20' })
 * // Returns something like "eyJvZmZzZXQiOjIwLCJzb3J0S2V5IjoiaXRlbS0yMCJ9"
 * ```
 */
export function encodeCursor(data: object): string {
  try {
    const json = JSON.stringify(data)
    // Use base64url encoding (URL-safe: + -> -, / -> _, no padding)
    const base64 = btoa(json)
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    throw new Error('Failed to encode cursor: invalid data')
  }
}

/**
 * Decode a cursor string back to its original data.
 *
 * Returns the decoded object or throws if the cursor is invalid.
 * For graceful handling, catch the error and treat as invalid cursor.
 *
 * @param cursor - The opaque cursor string to decode
 * @returns The decoded data object
 * @throws Error if cursor is invalid or malformed
 *
 * @example
 * ```ts
 * const data = decodeCursor<{ offset: number }>('eyJvZmZzZXQiOjIwfQ')
 * // Returns { offset: 20 }
 * ```
 */
export function decodeCursor<T = CursorData>(cursor: string): T {
  if (!cursor || typeof cursor !== 'string') {
    throw new Error('Invalid cursor: cursor must be a non-empty string')
  }

  try {
    // Convert base64url back to standard base64
    let base64 = cursor.replace(/-/g, '+').replace(/_/g, '/')
    // Add padding if needed
    const paddingNeeded = (4 - (base64.length % 4)) % 4
    base64 += '='.repeat(paddingNeeded)

    const json = atob(base64)
    const data = JSON.parse(json)

    if (typeof data !== 'object' || data === null) {
      throw new Error('Invalid cursor: decoded data is not an object')
    }

    return data as T
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Invalid cursor:')) {
      throw e
    }
    throw new Error('Invalid cursor: failed to decode')
  }
}

/**
 * Safely decode a cursor, returning null on failure instead of throwing.
 *
 * @param cursor - The opaque cursor string to decode
 * @returns The decoded data object, or null if invalid
 *
 * @example
 * ```ts
 * const data = tryDecodeCursor<{ offset: number }>('invalid')
 * // Returns null
 * ```
 */
export function tryDecodeCursor<T = CursorData>(cursor: string): T | null {
  try {
    return decodeCursor<T>(cursor)
  } catch {
    return null
  }
}

// ============================================================================
// Pagination Functions
// ============================================================================

/**
 * Normalize pagination parameters with defaults and constraints.
 *
 * - Applies default limit (20) when not specified
 * - Enforces maximum limit (100)
 * - Handles negative values gracefully
 * - Converts page number to offset
 *
 * @param params - Raw pagination parameters
 * @returns Normalized parameters with sensible defaults
 */
export function normalizePaginationParams(params: PaginationParams): {
  limit: number
  offset: number
  cursor?: string
} {
  let limit = params.limit

  // Handle missing, negative, or invalid limit
  if (limit === undefined || limit === null || limit < 0 || !Number.isFinite(limit)) {
    limit = DEFAULT_LIMIT
  }

  // Enforce maximum limit
  limit = Math.min(limit, MAX_LIMIT)

  // Calculate offset from page or use provided offset
  let offset = 0
  if (params.page !== undefined && params.page > 0) {
    offset = (params.page - 1) * limit
  } else if (params.offset !== undefined && params.offset >= 0) {
    offset = params.offset
  }

  return {
    limit,
    offset,
    cursor: params.cursor,
  }
}

/**
 * Paginate an array of items with cursor or offset-based pagination.
 *
 * This is the main pagination function that handles:
 * - Cursor-based navigation (forward and backward)
 * - Offset-based navigation
 * - Page number convenience
 * - Consistent metadata generation
 *
 * @param items - Full array of items to paginate
 * @param params - Pagination parameters
 * @param options - Additional options
 * @returns Paginated result with data and metadata
 *
 * @example
 * ```ts
 * // First page
 * const page1 = paginate(items, { limit: 20 })
 *
 * // Next page using cursor
 * const page2 = paginate(items, { limit: 20, cursor: page1.meta.endCursor })
 *
 * // Using offset
 * const page3 = paginate(items, { limit: 20, offset: 40 })
 *
 * // Using page number
 * const page2Alt = paginate(items, { limit: 20, page: 2 })
 * ```
 */
export function paginate<T>(
  items: T[],
  params: PaginationParams = {},
  options: PaginateOptions = {}
): PaginatedResult<T> {
  const totalItems = items.length
  const normalized = normalizePaginationParams(params)
  let { limit, offset } = normalized
  const { cursor } = normalized

  // If cursor is provided, decode it to get the offset
  if (cursor) {
    const cursorData = tryDecodeCursor<CursorData>(cursor)
    if (cursorData && typeof cursorData.offset === 'number') {
      offset = cursorData.offset
    }
  }

  // Handle limit=0 special case
  if (limit === 0) {
    return {
      data: [],
      meta: {
        total: options.skipTotal ? undefined : totalItems,
        hasNextPage: false,
        hasPreviousPage: offset > 0,
        startCursor: undefined,
        endCursor: undefined,
      },
    }
  }

  // Slice the items for this page
  const startIndex = Math.max(0, offset)
  const endIndex = Math.min(startIndex + limit, totalItems)
  const pageItems = items.slice(startIndex, endIndex)

  // Calculate pagination state
  const hasNextPage = endIndex < totalItems
  const hasPreviousPage = startIndex > 0
  const actualCount = pageItems.length

  // Generate cursors for navigation
  let startCursor: string | undefined
  let endCursor: string | undefined

  if (actualCount > 0) {
    // Start cursor points to the position of the first item
    const startCursorData: CursorData = {
      offset: startIndex,
      v: 1,
    }

    // End cursor points to the position AFTER the last item (for next page)
    const endCursorData: CursorData = {
      offset: endIndex,
      v: 1,
    }

    // Include sort keys if a key extractor is provided
    if (options.getItemKey) {
      startCursorData.sortKey = options.getItemKey(pageItems[0], startIndex)
      endCursorData.sortKey = options.getItemKey(pageItems[actualCount - 1], endIndex - 1)
    }

    startCursor = encodeCursor(startCursorData)
    endCursor = hasNextPage ? encodeCursor(endCursorData) : undefined
  }

  return {
    data: pageItems,
    meta: {
      total: options.skipTotal ? undefined : totalItems,
      hasNextPage,
      hasPreviousPage,
      startCursor,
      endCursor,
    },
  }
}

/**
 * Create pagination metadata for a known total and current position.
 *
 * Useful when paginating database queries where you have separate
 * count and data queries.
 *
 * @param total - Total number of items
 * @param offset - Current offset
 * @param limit - Page size
 * @param actualCount - Actual number of items returned (may be less than limit on last page)
 * @returns Pagination metadata
 *
 * @example
 * ```ts
 * const meta = createPaginationMeta(100, 20, 10, 10)
 * // { total: 100, hasNextPage: true, hasPreviousPage: true, ... }
 * ```
 */
export function createPaginationMeta(
  total: number,
  offset: number,
  limit: number,
  actualCount: number
): PaginationMeta {
  const hasNextPage = offset + actualCount < total
  const hasPreviousPage = offset > 0

  let startCursor: string | undefined
  let endCursor: string | undefined

  if (actualCount > 0) {
    startCursor = encodeCursor({ offset, v: 1 })
    endCursor = hasNextPage ? encodeCursor({ offset: offset + actualCount, v: 1 }) : undefined
  }

  return {
    total,
    hasNextPage,
    hasPreviousPage,
    startCursor,
    endCursor,
  }
}

/**
 * Parse pagination parameters from a query string or request.
 *
 * Handles type coercion and validation of pagination parameters.
 *
 * @param query - Object with string values (e.g., from URL query params)
 * @returns Parsed pagination parameters
 *
 * @example
 * ```ts
 * // From Hono context
 * const params = parsePaginationQuery({
 *   limit: c.req.query('limit'),
 *   offset: c.req.query('offset'),
 *   cursor: c.req.query('cursor'),
 *   page: c.req.query('page'),
 * })
 * ```
 */
export function parsePaginationQuery(query: {
  limit?: string | null
  offset?: string | null
  cursor?: string | null
  page?: string | null
}): PaginationParams {
  const params: PaginationParams = {}

  if (query.cursor) {
    params.cursor = query.cursor
  }

  if (query.limit !== undefined && query.limit !== null) {
    const limit = parseInt(query.limit, 10)
    if (!Number.isNaN(limit)) {
      params.limit = limit
    }
  }

  if (query.offset !== undefined && query.offset !== null) {
    const offset = parseInt(query.offset, 10)
    if (!Number.isNaN(offset) && offset >= 0) {
      params.offset = offset
    }
  }

  if (query.page !== undefined && query.page !== null) {
    const page = parseInt(query.page, 10)
    if (!Number.isNaN(page) && page > 0) {
      params.page = page
    }
  }

  return params
}

/**
 * Validate that pagination parameters are not conflicting.
 *
 * Returns an error message if parameters conflict, or null if valid.
 *
 * @param params - Pagination parameters to validate
 * @returns Error message or null
 */
export function validatePaginationParams(params: PaginationParams): string | null {
  // Cursor and offset/page are mutually exclusive
  if (params.cursor && (params.offset !== undefined || params.page !== undefined)) {
    return 'Cannot use cursor with offset or page parameters'
  }

  // Page must be positive
  if (params.page !== undefined && params.page < 1) {
    return 'Page must be a positive integer (1-indexed)'
  }

  // Offset must be non-negative
  if (params.offset !== undefined && params.offset < 0) {
    return 'Offset must be a non-negative integer'
  }

  return null
}
