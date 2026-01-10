/**
 * Search Snippet - Range Query Pruning with Zonemaps
 *
 * This module provides range query pruning using ClickHouse-style marks files.
 * The search snippet fetches marks files from CDN to determine which blocks
 * need to be read for a given range query, minimizing data transfer.
 *
 * Memory Budget:
 * - 65,536 blocks per 1MB marks file
 * - 16 bytes per block entry (int64 min + int64 max)
 *
 * @module snippets/search
 * @see db/iceberg/marks.ts for the full marks file format
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Supported column types for marks files.
 */
export type ColumnType = 'int64' | 'float64' | 'timestamp' | 'string'

/**
 * Metadata about a marks file required for parsing.
 */
export interface MarksMetadata {
  /** Column data type */
  columnType: ColumnType
  /** Number of blocks in the marks file */
  blockCount: number
  /** Rows per block */
  blockSize: number
  /** Bytes per block in the data file (optional, for byte range calculation) */
  blockByteSize?: number
}

/**
 * Parsed block range with min/max statistics.
 */
export interface BlockRange<T = bigint | number | string> {
  /** Minimum value in this block */
  min: T | null
  /** Maximum value in this block */
  max: T | null
  /** Zero-based block index */
  blockIndex: number
  /** Number of null values in this block (optional) */
  nullCount?: number
  /** Multi-column support (optional) */
  columns?: Record<string, { min: T | null; max: T | null }>
}

/**
 * Range query condition.
 */
export interface RangeCondition<T = bigint | number | string> {
  /** Minimum value (inclusive by default) */
  min?: T
  /** Maximum value (inclusive by default) */
  max?: T
  /** Whether min is inclusive (default: true) */
  minInclusive?: boolean
  /** Whether max is inclusive (default: true) */
  maxInclusive?: boolean
  /** Query for NULL values */
  isNull?: boolean
}

/**
 * Options for pruneBlocks.
 */
export interface PruneOptions {
  /** Logical operator for multiple conditions */
  operator?: 'AND' | 'OR'
}

/**
 * Options for parseMarksFile.
 */
export interface ParseOptions {
  /** Expected number of blocks (for validation) */
  expectedBlocks?: number
}

/**
 * Result of a range query.
 */
export interface QueryRangeResult {
  /** Individual block ranges that match the query */
  blockRanges: Array<{
    blockIndex: number
    byteOffset: number
    byteSize: number
  }>
  /** Coalesced byte range if blocks are adjacent */
  coalesced?: {
    byteOffset: number
    byteSize: number
  }
  /** Ready-to-use HTTP Range header, or null if no matches */
  rangeHeader: string | null
}

// ============================================================================
// Stub Functions (to be implemented)
// ============================================================================

/**
 * Query a marks file and return the byte ranges that need to be fetched.
 *
 * @param cdnUrl - URL to the marks file on CDN
 * @param metadata - Marks file metadata
 * @param condition - Range query condition
 * @returns Promise resolving to query result with byte ranges
 *
 * @example
 * ```typescript
 * const result = await queryRange(
 *   'https://cdn.example.com/marks/users.marks',
 *   { columnType: 'int64', blockCount: 100, blockSize: 8192 },
 *   { min: 1000n, max: 2000n }
 * )
 *
 * if (result.rangeHeader) {
 *   const response = await fetch(dataUrl, {
 *     headers: { Range: result.rangeHeader }
 *   })
 * }
 * ```
 */
export async function queryRange(
  _cdnUrl: string,
  _metadata: MarksMetadata,
  _condition: RangeCondition
): Promise<QueryRangeResult> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: queryRange')
}

/**
 * Parse a binary marks file into block ranges.
 *
 * @param data - Raw marks file data
 * @param columnType - Data type of the column
 * @param options - Parse options
 * @returns Array of parsed block ranges
 */
export function parseMarksFile(
  _data: Uint8Array,
  _columnType: ColumnType,
  _options?: ParseOptions
): BlockRange[] {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: parseMarksFile')
}

/**
 * Prune blocks based on range condition(s).
 *
 * @param blocks - Array of block ranges or raw buffer with metadata
 * @param condition - Single condition or array of conditions
 * @param options - Prune options (AND/OR operator)
 * @returns Array of blocks that may contain matching values
 */
export function pruneBlocks<T>(
  _blocks: BlockRange<T>[] | { buffer: Uint8Array; blockCount: number; columnType: ColumnType },
  _condition: RangeCondition<T> | RangeCondition<T>[] | Record<string, RangeCondition<T>>,
  _options?: PruneOptions
): BlockRange<T>[] {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: pruneBlocks')
}
