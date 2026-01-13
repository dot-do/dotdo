/**
 * Standard Pagination Utilities
 *
 * Unified pagination interface across REST, RPC, and compat layers.
 * This module provides cursor-based pagination with consistent metadata.
 *
 * @module lib/response/pagination
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Pagination parameters accepted by paginated endpoints
 */
export interface PaginationParams {
  /** Maximum items to return (default: 20, max: 100) */
  limit?: number
  /** Opaque cursor from previous response */
  cursor?: string
  /** Direction to paginate (forward or backward) */
  direction?: 'forward' | 'backward'
  /** Offset for offset-based pagination (deprecated, prefer cursor) */
  offset?: number
}

/**
 * Pagination metadata included in responses
 */
export interface PaginationMeta {
  /** Total count of all items matching the query (optional for performance) */
  total?: number
  /** Number of items per page (actual limit used) */
  limit: number
  /** Whether more items exist beyond this page */
  hasMore: boolean
  /** Opaque cursor for next page (forward pagination) */
  cursor?: string
  /** Opaque cursor for previous page (backward pagination) */
  prevCursor?: string
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
 * Internal cursor position encoding
 */
export interface CursorPosition {
  /** Current offset position */
  offset: number
  /** Primary sort key value (for keyset pagination) */
  sortKey?: string
  /** Secondary sort key value (for composite keys) */
  secondaryKey?: string
}

/**
 * Options for building pagination metadata
 */
export interface PaginationMetaOptions {
  /** Requested limit */
  limit: number
  /** Total items in dataset (optional) */
  totalItems?: number
  /** Current offset position */
  currentOffset: number
  /** Skip total count for performance */
  skipTotal?: boolean
  /** Actual number of items returned (for hasMore calculation without total) */
  actualItemCount?: number
  /** Key of last item (for cursor generation) */
  lastItemKey?: string
  /** Key of first item (for prevCursor generation) */
  firstItemKey?: string
}

// ============================================================================
// Cursor Functions
// ============================================================================

/**
 * Create an opaque cursor from a position
 *
 * Uses base64url encoding (RFC 4648 section 5) for URL safety.
 * The cursor is opaque to clients - they should not parse or modify it.
 *
 * @param position - The cursor position to encode
 * @returns URL-safe opaque cursor string
 *
 * @example
 * ```ts
 * const cursor = createCursor({ offset: 20, sortKey: 'item-20' })
 * // Returns something like "eyJvIjoyMCwicyI6Iml0ZW0tMjAifQ"
 * ```
 */
export function createCursor(position: CursorPosition): string {
  // Use compact keys for smaller cursor size
  const data: Record<string, unknown> = {
    o: position.offset,
  }

  if (position.sortKey !== undefined) {
    data.s = position.sortKey
  }

  if (position.secondaryKey !== undefined) {
    data.k = position.secondaryKey
  }

  const json = JSON.stringify(data)
  // Use base64url encoding (URL-safe: + -> -, / -> _, no padding)
  const base64 = btoa(json)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Parse a cursor string back to a position
 *
 * @param cursor - The opaque cursor string
 * @returns The decoded position, or null if invalid
 *
 * @example
 * ```ts
 * const position = parseCursor("eyJvIjoyMH0")
 * // Returns { offset: 20 }
 * ```
 */
export function parseCursor(cursor: string): CursorPosition | null {
  if (!cursor || typeof cursor !== 'string') {
    return null
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
      return null
    }

    // Validate offset exists and is a number
    if (typeof data.o !== 'number') {
      return null
    }

    const position: CursorPosition = {
      offset: data.o,
    }

    if (data.s !== undefined) {
      position.sortKey = String(data.s)
    }

    if (data.k !== undefined) {
      position.secondaryKey = String(data.k)
    }

    return position
  } catch {
    return null
  }
}

// ============================================================================
// Metadata Building
// ============================================================================

/**
 * Build pagination metadata from options
 *
 * @param options - Options for building metadata
 * @returns Pagination metadata object
 *
 * @example
 * ```ts
 * const meta = buildPaginationMeta({
 *   limit: 20,
 *   totalItems: 100,
 *   currentOffset: 0,
 *   lastItemKey: 'item-20'
 * })
 * // Returns { total: 100, limit: 20, hasMore: true, cursor: '...' }
 * ```
 */
export function buildPaginationMeta(options: PaginationMetaOptions): PaginationMeta {
  const {
    limit,
    totalItems,
    currentOffset,
    skipTotal,
    actualItemCount,
    lastItemKey,
    firstItemKey,
  } = options

  // Calculate hasMore based on total or actualItemCount
  let hasMore: boolean
  if (totalItems !== undefined) {
    hasMore = currentOffset + limit < totalItems
  } else if (actualItemCount !== undefined) {
    // If we got a full page, there might be more
    hasMore = actualItemCount >= limit
  } else {
    hasMore = false
  }

  const meta: PaginationMeta = {
    limit,
    hasMore,
  }

  // Include total count unless skipped
  if (!skipTotal && totalItems !== undefined) {
    meta.total = totalItems
  }

  // Generate cursor for next page if hasMore is true
  if (hasMore) {
    const nextOffset = currentOffset + limit
    const cursorPosition: CursorPosition = { offset: nextOffset }
    if (lastItemKey) {
      cursorPosition.sortKey = lastItemKey
    }
    meta.cursor = createCursor(cursorPosition)
  }

  // Generate prevCursor when not on first page
  if (currentOffset > 0) {
    const prevOffset = Math.max(0, currentOffset - limit)
    const cursorPosition: CursorPosition = { offset: prevOffset }
    if (firstItemKey) {
      cursorPosition.sortKey = firstItemKey
    }
    meta.prevCursor = createCursor(cursorPosition)
  }

  return meta
}

// ============================================================================
// Paginate Function
// ============================================================================

/**
 * Paginate an array of items
 *
 * @param items - Full array of items to paginate
 * @param params - Pagination parameters
 * @returns Paginated result with data and metadata
 *
 * @example
 * ```ts
 * const items = [{ id: '1' }, { id: '2' }, ...]
 * const result = paginate(items, { limit: 20 })
 * // Returns { data: [...20 items...], meta: { ... } }
 *
 * // Get next page
 * const page2 = paginate(items, { limit: 20, cursor: result.meta.cursor })
 * ```
 */
export function paginate<T>(items: T[], params: PaginationParams = {}): PaginatedResult<T> {
  const totalItems = items.length

  // Normalize limit: default 20, max 100, handle negative as default
  let limit = params.limit
  if (limit === undefined || limit === null || limit < 0 || !Number.isFinite(limit)) {
    limit = DEFAULT_LIMIT
  }
  limit = Math.min(limit, MAX_LIMIT)

  // Handle limit=0 special case
  if (limit === 0) {
    return {
      data: [],
      meta: {
        limit: 0,
        hasMore: false,
        total: totalItems,
      },
    }
  }

  // Determine offset from cursor or offset parameter
  let offset = 0

  if (params.cursor) {
    const cursorPosition = parseCursor(params.cursor)
    if (cursorPosition) {
      offset = cursorPosition.offset
    }
  } else if (params.offset !== undefined && params.offset >= 0) {
    offset = params.offset
  }

  // Handle backward direction - adjust offset to go to previous page
  if (params.direction === 'backward' && params.cursor) {
    // When going backward, the cursor points to current position
    // We already parsed it above, so offset is set correctly
    // The cursor for backward navigation should already contain the correct offset
  }

  // Ensure offset is valid
  offset = Math.max(0, Math.min(offset, totalItems))

  // Slice items for current page
  const startIndex = offset
  const endIndex = Math.min(startIndex + limit, totalItems)
  const pageItems = items.slice(startIndex, endIndex)
  const actualItemCount = pageItems.length

  // Calculate hasMore
  const hasMore = endIndex < totalItems

  // Build metadata
  const meta: PaginationMeta = {
    limit,
    hasMore,
    total: totalItems,
  }

  // Generate cursor for next page if hasMore
  if (hasMore && actualItemCount > 0) {
    meta.cursor = createCursor({ offset: endIndex })
  }

  // Generate prevCursor if not on first page
  if (startIndex > 0) {
    const prevOffset = Math.max(0, startIndex - limit)
    meta.prevCursor = createCursor({ offset: prevOffset })
  }

  return {
    data: pageItems,
    meta,
  }
}

// ============================================================================
// Constants
// ============================================================================

/** Default page size when limit is not specified */
export const DEFAULT_LIMIT = 20

/** Maximum allowed page size */
export const MAX_LIMIT = 100
