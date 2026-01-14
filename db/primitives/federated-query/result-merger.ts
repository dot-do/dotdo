/**
 * Result Merger - Cross-source result merging and ordering
 *
 * Implements k-way merge for combining sorted results from multiple federated
 * sources with support for global ordering, pagination, and deduplication.
 *
 * ## Features
 * - K-way merge with sorted inputs using min-heap
 * - Global ORDER BY across merged results
 * - LIMIT/OFFSET with over-fetch optimization
 * - DISTINCT and key-based deduplication
 * - Streaming merge for large result sets
 *
 * @see dotdo-cm0et
 * @module db/primitives/federated-query/result-merger
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Sort specification for ordering
 */
export interface SortSpec {
  column: string
  direction: 'ASC' | 'DESC'
}

/**
 * Deduplication configuration
 */
export interface DeduplicationConfig {
  /** Deduplication mode */
  mode: 'exact' | 'key' | 'distinct'
  /** Key columns for key-based deduplication */
  keyColumns?: string[]
  /** Columns for DISTINCT */
  distinctColumns?: string[]
  /** Strategy for handling duplicates: first, last, or custom merge */
  strategy?: 'first' | 'last' | 'custom'
  /** Custom merge function for combining duplicate rows */
  mergeFn?: (a: Record<string, unknown>, b: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Pagination configuration
 */
export interface PaginationConfig {
  limit?: number
  offset?: number
  /** Cursor for keyset pagination */
  cursor?: string
}

/**
 * Streaming configuration
 */
export interface StreamingConfig {
  /** Buffer size for streaming operations */
  bufferSize?: number
}

/**
 * Merge configuration
 */
export interface MergeConfig {
  /** Sort specifications */
  sort?: SortSpec[]
  /** Pagination settings */
  pagination?: PaginationConfig
  /** Deduplication settings */
  deduplication?: DeduplicationConfig
  /** Streaming settings */
  streaming?: StreamingConfig
  /** Whether to verify output order */
  verifyOrder?: boolean
  /** Verify source inputs are correctly sorted */
  strictSourceOrder?: boolean
  /** Null handling: true = nulls first, false = nulls last */
  nullsFirst?: boolean
  /** Collect statistics */
  collectStats?: boolean
}

/**
 * Sorted stream source
 */
export interface SortedStreamSource {
  id: string
  rows: Record<string, unknown>[]
  exhausted: boolean
  /** Whether the source is pre-sorted (default: true) */
  sorted?: boolean
}

/**
 * Stream source with async generator
 */
export interface AsyncStreamSource {
  id: string
  generator: AsyncGenerator<Record<string, unknown>>
}

/**
 * Merge result metadata
 */
export interface MergeResultMetadata {
  sourceExhausted: Record<string, boolean>
}

/**
 * Merge statistics
 */
export interface MergeStats {
  duplicatesRemoved: number
  totalScanned: number
  finalCount: number
}

/**
 * Merge result
 */
export interface MergeResult {
  rows: Record<string, unknown>[]
  metadata?: MergeResultMetadata
  hasMore?: boolean
  cursor?: string
  stats?: MergeStats
}

/**
 * Over-fetch calculation input
 */
export interface OverFetchInput {
  sourceCount: number
  limit: number
  offset?: number
}

// =============================================================================
// MIN HEAP FOR K-WAY MERGE
// =============================================================================

/**
 * Heap entry wrapping a row with its source index
 */
interface HeapEntry {
  row: Record<string, unknown>
  sourceIndex: number
  rowIndex: number
}

/**
 * Min-heap implementation for k-way merge
 */
class MinHeap {
  private heap: HeapEntry[] = []
  private compareFn: (a: Record<string, unknown>, b: Record<string, unknown>) => number

  constructor(compareFn: (a: Record<string, unknown>, b: Record<string, unknown>) => number) {
    this.compareFn = compareFn
  }

  get size(): number {
    return this.heap.length
  }

  push(entry: HeapEntry): void {
    this.heap.push(entry)
    this.bubbleUp(this.heap.length - 1)
  }

  pop(): HeapEntry | undefined {
    if (this.heap.length === 0) return undefined
    if (this.heap.length === 1) return this.heap.pop()

    const result = this.heap[0]
    this.heap[0] = this.heap.pop()!
    this.bubbleDown(0)
    return result
  }

  peek(): HeapEntry | undefined {
    return this.heap[0]
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.compare(index, parentIndex) >= 0) break
      this.swap(index, parentIndex)
      index = parentIndex
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      const leftChild = 2 * index + 1
      const rightChild = 2 * index + 2
      let smallest = index

      if (leftChild < this.heap.length && this.compare(leftChild, smallest) < 0) {
        smallest = leftChild
      }
      if (rightChild < this.heap.length && this.compare(rightChild, smallest) < 0) {
        smallest = rightChild
      }

      if (smallest === index) break
      this.swap(index, smallest)
      index = smallest
    }
  }

  private compare(i: number, j: number): number {
    return this.compareFn(this.heap[i]!.row, this.heap[j]!.row)
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i]!
    this.heap[i] = this.heap[j]!
    this.heap[j] = temp
  }
}

// =============================================================================
// RESULT MERGER
// =============================================================================

/**
 * ResultMerger - Merges results from multiple federated sources
 *
 * Uses k-way merge algorithm with a min-heap for efficient merging
 * of pre-sorted result streams from multiple sources.
 */
export class ResultMerger {
  /**
   * Merge multiple sorted stream sources into a single sorted result
   */
  async merge(
    sources: SortedStreamSource[],
    config: MergeConfig = {}
  ): Promise<MergeResult> {
    const { sort = [], pagination, deduplication, verifyOrder, strictSourceOrder, nullsFirst = false, collectStats } = config

    // Prepare sources (sort unsorted ones if needed)
    const preparedSources = this.prepareSources(sources, sort, strictSourceOrder, nullsFirst)

    // Build comparison function
    const compareFn = this.buildComparator(sort, nullsFirst)

    // Perform k-way merge with source tagging
    const { merged: mergedRows, sourceIndices } = this.kWayMergeWithSourceTracking(preparedSources, compareFn)
    let merged = mergedRows
    let mergedSourceIndices = sourceIndices

    // Apply deduplication if configured
    let duplicatesRemoved = 0
    const totalScanned = merged.length
    if (deduplication) {
      const [deduped, removed] = this.deduplicate(merged, deduplication)
      merged = deduped
      duplicatesRemoved = removed
      // Note: source tracking after dedup is complex; skip for now
    }

    // Apply cursor-based pagination if cursor provided
    if (pagination?.cursor) {
      const cursorResult = this.applyCursorWithTracking(merged, mergedSourceIndices, pagination.cursor, sort)
      merged = cursorResult.rows
      mergedSourceIndices = cursorResult.sourceIndices
    }

    // Apply offset
    if (pagination?.offset) {
      merged = merged.slice(pagination.offset)
      mergedSourceIndices = mergedSourceIndices.slice(pagination.offset)
    }

    // Track if there are more results before applying limit
    let hasMore = false
    if (pagination?.limit !== undefined) {
      hasMore = merged.length > pagination.limit
      merged = merged.slice(0, pagination.limit)
      mergedSourceIndices = mergedSourceIndices.slice(0, pagination.limit)
    }

    // Verify output order if requested
    if (verifyOrder && sort.length > 0) {
      this.verifyOutputOrder(merged, compareFn)
    }

    // Count how many rows from each source are in final output
    const consumedPerSource = sources.map(() => 0)
    for (const sourceIndex of mergedSourceIndices) {
      consumedPerSource[sourceIndex]!++
    }

    // Build metadata - determine if source is exhausted based on whether all rows were consumed
    // A source is exhausted if: we consumed all its rows in the final output AND the source itself is exhausted
    const metadata: MergeResultMetadata = {
      sourceExhausted: Object.fromEntries(
        sources.map((s, i) => {
          const preparedSource = preparedSources[i]!
          const totalRows = preparedSource.rows.length
          const consumed = consumedPerSource[i] ?? 0
          // Source is exhausted if we used all its rows and the source claims to be exhausted
          const isExhausted = consumed >= totalRows && s.exhausted
          return [s.id, isExhausted]
        })
      ),
    }

    // Generate cursor for next page
    const cursor = hasMore && merged.length > 0
      ? this.generateCursor(merged[merged.length - 1]!, sort)
      : undefined

    // Build result
    const result: MergeResult = {
      rows: merged,
      metadata,
      hasMore,
    }

    if (cursor) {
      result.cursor = cursor
    }

    if (collectStats) {
      result.stats = {
        duplicatesRemoved,
        totalScanned,
        finalCount: merged.length,
      }
    }

    return result
  }

  /**
   * Merge async generator sources with streaming output
   */
  async *mergeStreams(
    sources: AsyncStreamSource[],
    config: MergeConfig = {}
  ): AsyncGenerator<Record<string, unknown>> {
    const { sort = [], pagination, nullsFirst = false } = config
    const compareFn = this.buildComparator(sort, nullsFirst)

    // Buffer for each source
    const buffers: Array<{ row: Record<string, unknown> | null; done: boolean }> = sources.map(() => ({
      row: null,
      done: false,
    }))

    // Initialize buffers with first row from each source
    await Promise.all(
      sources.map(async (source, i) => {
        const result = await source.generator.next()
        if (result.done) {
          buffers[i] = { row: null, done: true }
        } else {
          buffers[i] = { row: result.value, done: false }
        }
      })
    )

    // Build heap
    const heap = new MinHeap(compareFn)
    for (let i = 0; i < buffers.length; i++) {
      const buffer = buffers[i]!
      if (!buffer.done && buffer.row !== null) {
        heap.push({ row: buffer.row, sourceIndex: i, rowIndex: 0 })
      }
    }

    let emitted = 0
    const limit = pagination?.limit

    // K-way merge using heap
    while (heap.size > 0) {
      const entry = heap.pop()!
      yield entry.row

      emitted++
      if (limit !== undefined && emitted >= limit) {
        break
      }

      // Fetch next row from the same source
      const source = sources[entry.sourceIndex]!
      const result = await source.generator.next()

      if (!result.done) {
        heap.push({
          row: result.value,
          sourceIndex: entry.sourceIndex,
          rowIndex: entry.rowIndex + 1,
        })
      }
    }
  }

  /**
   * Calculate required over-fetch per source for LIMIT queries
   */
  calculateOverFetch(input: OverFetchInput): number {
    const { sourceCount, limit, offset = 0 } = input
    const totalNeeded = limit + offset

    // Each source should fetch enough rows to potentially contribute to the result
    // In the worst case, all rows come from one source, so each source needs
    // at least totalNeeded rows. Add buffer for safety.
    const perSource = Math.ceil(totalNeeded / sourceCount)
    const buffer = Math.ceil(limit * 0.2) // 20% buffer

    return Math.max(perSource + buffer, limit)
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  /**
   * Prepare sources by sorting unsorted ones
   */
  private prepareSources(
    sources: SortedStreamSource[],
    sort: SortSpec[],
    strictSourceOrder?: boolean,
    nullsFirst?: boolean
  ): SortedStreamSource[] {
    const compareFn = this.buildComparator(sort, nullsFirst ?? false)

    return sources.map(source => {
      // If source claims to be sorted but strictSourceOrder is enabled, verify
      if (strictSourceOrder && source.sorted !== false && source.rows.length > 1) {
        for (let i = 1; i < source.rows.length; i++) {
          if (compareFn(source.rows[i - 1]!, source.rows[i]!) > 0) {
            throw new Error(`Source ${source.id} is not correctly sorted`)
          }
        }
      }

      // Always sort if sort is specified - we can't trust pre-sorted sources
      // to match our exact sorting requirements (e.g., nullsFirst)
      if (sort.length > 0) {
        // Check if already sorted correctly
        let needsSort = source.sorted === false
        if (!needsSort && source.rows.length > 1) {
          for (let i = 1; i < source.rows.length; i++) {
            if (compareFn(source.rows[i - 1]!, source.rows[i]!) > 0) {
              needsSort = true
              break
            }
          }
        }

        if (needsSort) {
          const sortedRows = [...source.rows].sort(compareFn)
          return { ...source, rows: sortedRows, sorted: true }
        }
      }

      return source
    })
  }

  /**
   * Build comparison function from sort specs
   */
  private buildComparator(
    sort: SortSpec[],
    nullsFirst: boolean
  ): (a: Record<string, unknown>, b: Record<string, unknown>) => number {
    return (a, b) => {
      for (const spec of sort) {
        const aVal = a[spec.column]
        const bVal = b[spec.column]

        // Handle nulls
        if (aVal === null || aVal === undefined) {
          if (bVal === null || bVal === undefined) continue
          return nullsFirst ? -1 : 1
        }
        if (bVal === null || bVal === undefined) {
          return nullsFirst ? 1 : -1
        }

        // Compare values
        let cmp: number
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal
        } else if (typeof aVal === 'string' && typeof bVal === 'string') {
          cmp = aVal.localeCompare(bVal)
        } else {
          cmp = String(aVal).localeCompare(String(bVal))
        }

        if (cmp !== 0) {
          return spec.direction === 'DESC' ? -cmp : cmp
        }
      }
      return 0
    }
  }

  /**
   * K-way merge using min-heap with source index tracking
   */
  private kWayMergeWithSourceTracking(
    sources: SortedStreamSource[],
    compareFn: (a: Record<string, unknown>, b: Record<string, unknown>) => number
  ): { merged: Record<string, unknown>[]; sourceIndices: number[] } {
    if (sources.length === 0) return { merged: [], sourceIndices: [] }
    if (sources.length === 1) {
      return {
        merged: [...sources[0]!.rows],
        sourceIndices: sources[0]!.rows.map(() => 0),
      }
    }

    const heap = new MinHeap(compareFn)

    // Initialize heap with first element from each source
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]!
      if (source.rows.length > 0) {
        heap.push({ row: source.rows[0]!, sourceIndex: i, rowIndex: 0 })
      }
    }

    const result: Record<string, unknown>[] = []
    const sourceIndices: number[] = []

    while (heap.size > 0) {
      const entry = heap.pop()!
      result.push(entry.row)
      sourceIndices.push(entry.sourceIndex)

      // Advance to next row in the same source
      const nextIndex = entry.rowIndex + 1
      const source = sources[entry.sourceIndex]!

      if (nextIndex < source.rows.length) {
        heap.push({
          row: source.rows[nextIndex]!,
          sourceIndex: entry.sourceIndex,
          rowIndex: nextIndex,
        })
      }
    }

    return { merged: result, sourceIndices }
  }

  /**
   * Deduplicate merged results
   */
  private deduplicate(
    rows: Record<string, unknown>[],
    config: DeduplicationConfig
  ): [Record<string, unknown>[], number] {
    if (rows.length === 0) return [rows, 0]

    const { mode, keyColumns = [], distinctColumns = [], strategy = 'first', mergeFn } = config
    const seen = new Map<string, Record<string, unknown>>()
    const result: Record<string, unknown>[] = []
    let removed = 0

    for (const row of rows) {
      let key: string

      switch (mode) {
        case 'exact':
          key = JSON.stringify(row)
          break
        case 'key':
          key = keyColumns.map(col => JSON.stringify(row[col])).join('|')
          break
        case 'distinct':
          key = distinctColumns.map(col => JSON.stringify(row[col])).join('|')
          break
      }

      const existing = seen.get(key)
      if (existing) {
        removed++

        if (strategy === 'last') {
          // Replace with new row
          const idx = result.indexOf(existing)
          if (idx !== -1) {
            result[idx] = row
          }
          seen.set(key, row)
        } else if (strategy === 'custom' && mergeFn) {
          // Merge rows
          const merged = mergeFn(existing, row)
          const idx = result.indexOf(existing)
          if (idx !== -1) {
            result[idx] = merged
          }
          seen.set(key, merged)
        }
        // For 'first' strategy, do nothing (keep original)
      } else {
        seen.set(key, row)
        result.push(row)
      }
    }

    return [result, removed]
  }

  /**
   * Apply cursor-based pagination
   */
  private applyCursor(
    rows: Record<string, unknown>[],
    cursor: string,
    sort: SortSpec[]
  ): Record<string, unknown>[] {
    try {
      const cursorValues = JSON.parse(atob(cursor)) as Record<string, unknown>

      // Find the first row that comes after the cursor position
      const compareFn = this.buildComparator(sort, false)
      const cursorRow = cursorValues

      const startIndex = rows.findIndex(row => compareFn(row, cursorRow) > 0)
      if (startIndex === -1) return []
      return rows.slice(startIndex)
    } catch {
      // Invalid cursor, return all rows
      return rows
    }
  }

  /**
   * Apply cursor-based pagination with source tracking
   */
  private applyCursorWithTracking(
    rows: Record<string, unknown>[],
    sourceIndices: number[],
    cursor: string,
    sort: SortSpec[]
  ): { rows: Record<string, unknown>[]; sourceIndices: number[] } {
    try {
      const cursorValues = JSON.parse(atob(cursor)) as Record<string, unknown>

      // Find the first row that comes after the cursor position
      const compareFn = this.buildComparator(sort, false)
      const cursorRow = cursorValues

      const startIndex = rows.findIndex(row => compareFn(row, cursorRow) > 0)
      if (startIndex === -1) return { rows: [], sourceIndices: [] }
      return {
        rows: rows.slice(startIndex),
        sourceIndices: sourceIndices.slice(startIndex),
      }
    } catch {
      // Invalid cursor, return all rows
      return { rows, sourceIndices }
    }
  }

  /**
   * Generate cursor from last row
   */
  private generateCursor(row: Record<string, unknown>, sort: SortSpec[]): string {
    const cursorValues: Record<string, unknown> = {}
    for (const spec of sort) {
      cursorValues[spec.column] = row[spec.column]
    }
    return btoa(JSON.stringify(cursorValues))
  }

  /**
   * Verify output is correctly ordered
   */
  private verifyOutputOrder(
    rows: Record<string, unknown>[],
    compareFn: (a: Record<string, unknown>, b: Record<string, unknown>) => number
  ): void {
    for (let i = 1; i < rows.length; i++) {
      if (compareFn(rows[i - 1]!, rows[i]!) > 0) {
        throw new Error('Output is not correctly ordered')
      }
    }
  }
}
