/**
 * ClickHouse-style Mark Files for Granule-level Access
 *
 * Mark files provide byte offsets and min/max statistics for granules within Parquet files,
 * enabling precise range requests from Cloudflare Snippets without loading entire files.
 *
 * Binary format optimized for minimal size (<5KB typically) and fast parsing (<0.5ms).
 *
 * @module db/iceberg/marks
 * @see https://clickhouse.com/docs/en/development/architecture#marks
 */

// ============================================================================
// Constants
// ============================================================================

/** Magic bytes identifying a mark file */
export const MARK_MAGIC = new Uint8Array([0x4d, 0x41, 0x52, 0x4b]) // "MARK"

/** Current mark file format version */
export const MARK_VERSION = 1

/** Header size in bytes */
export const HEADER_SIZE = 16

/** Default granule size (rows per granule) */
export const DEFAULT_GRANULE_SIZE = 8192

// ============================================================================
// Types
// ============================================================================

/**
 * Supported column types for mark files.
 * Each type has specific encoding and comparison semantics.
 */
export enum ColumnType {
  /** UTF-8 string, variable length, lexicographic comparison */
  String = 0,
  /** 64-bit signed integer, 8 bytes, numeric comparison */
  Int64 = 1,
  /** 64-bit IEEE 754 float, 8 bytes, numeric comparison */
  Float64 = 2,
  /** Milliseconds since Unix epoch, 8 bytes, numeric comparison */
  Timestamp = 3,
}

/**
 * Header flags for mark file features.
 */
export enum MarkFlags {
  /** No special flags */
  None = 0,
  /** Granules are sorted by primary column */
  Sorted = 1 << 0,
  /** Min/max values are present for all columns */
  HasStats = 1 << 1,
  /** Null counts are present */
  HasNullCounts = 1 << 2,
}

/**
 * Mark file header structure.
 */
export interface MarkHeader {
  /** Magic bytes (must be "MARK") */
  magic: Uint8Array
  /** Format version */
  version: number
  /** Rows per granule */
  granuleSize: number
  /** Total number of granules */
  granuleCount: number
  /** Feature flags */
  flags: MarkFlags
}

/**
 * Column descriptor in mark file.
 */
export interface ColumnDescriptor {
  /** Column ID (matches Parquet/Iceberg field ID) */
  columnId: number
  /** Column name */
  name: string
  /** Column type */
  type: ColumnType
}

/**
 * Granule entry with byte offset and statistics.
 */
export interface GranuleEntry {
  /** Byte offset where this granule starts in the Parquet file */
  byteOffset: bigint
  /** Size of this granule in bytes */
  byteSize: number
  /** Starting row index (0-based) */
  rowStart: number
  /** Number of rows in this granule */
  rowCount: number
  /** Minimum value per indexed column (column ID -> value) */
  minValues: Map<number, GranuleValue>
  /** Maximum value per indexed column (column ID -> value) */
  maxValues: Map<number, GranuleValue>
  /** Null count per column (column ID -> count) */
  nullCounts: Map<number, number>
}

/**
 * Value type for granule min/max statistics.
 */
export type GranuleValue = string | bigint | number

/**
 * Result of a granule search operation.
 */
export interface GranuleSearchResult {
  /** Granule index (0-based) */
  granuleIndex: number
  /** Byte offset to start reading from */
  byteOffset: bigint
  /** Number of bytes to read */
  byteSize: number
  /** Starting row in the granule */
  rowStart: number
  /** Number of rows in the granule */
  rowCount: number
}

/**
 * Options for writing mark files.
 */
export interface MarkWriterOptions {
  /** Rows per granule (default: 8192) */
  granuleSize?: number
  /** Feature flags */
  flags?: MarkFlags
}

/**
 * Parquet metadata input for mark file generation.
 */
export interface ParquetColumnStats {
  /** Column field ID */
  columnId: number
  /** Column name */
  name: string
  /** Column type */
  type: ColumnType
  /** Per-granule statistics */
  granules: Array<{
    byteOffset: bigint
    byteSize: number
    rowStart: number
    rowCount: number
    minValue?: GranuleValue
    maxValue?: GranuleValue
    nullCount?: number
  }>
}

/**
 * Complete mark file structure.
 */
export interface MarkFile {
  /** File header */
  header: MarkHeader
  /** Column descriptors */
  columns: ColumnDescriptor[]
  /** Granule entries */
  granules: GranuleEntry[]
}

// ============================================================================
// MarkFileWriter
// ============================================================================

/**
 * Generates mark files from Parquet metadata.
 *
 * Mark files are compact binary files that store:
 * - Byte offsets for each granule in the Parquet file
 * - Min/max statistics per column per granule
 * - Row counts and null counts
 *
 * @example
 * ```typescript
 * const writer = new MarkFileWriter({ granuleSize: 8192 })
 *
 * // Add column statistics from Parquet metadata
 * writer.addColumn({
 *   columnId: 3,
 *   name: 'id',
 *   type: ColumnType.String,
 *   granules: [
 *     { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'aaa', maxValue: 'mmm' },
 *     { byteOffset: 65536n, byteSize: 65536, rowStart: 8192, rowCount: 8192, minValue: 'mmn', maxValue: 'zzz' },
 *   ]
 * })
 *
 * // Generate binary mark file
 * const bytes = writer.build()
 * ```
 */
export class MarkFileWriter {
  private readonly granuleSize: number
  private readonly flags: MarkFlags
  private readonly columns: ColumnDescriptor[] = []
  private readonly columnStats: Map<number, ParquetColumnStats> = new Map()
  private granuleCount = 0

  constructor(options: MarkWriterOptions = {}) {
    this.granuleSize = options.granuleSize ?? DEFAULT_GRANULE_SIZE
    this.flags = options.flags ?? (MarkFlags.HasStats | MarkFlags.HasNullCounts)
  }

  /**
   * Add column statistics for mark file generation.
   *
   * @param stats - Column statistics from Parquet metadata
   */
  addColumn(stats: ParquetColumnStats): void {
    this.columns.push({
      columnId: stats.columnId,
      name: stats.name,
      type: stats.type,
    })
    this.columnStats.set(stats.columnId, stats)

    // Track granule count from first column
    if (this.granuleCount === 0) {
      this.granuleCount = stats.granules.length
    }
  }

  /**
   * Build the binary mark file.
   *
   * @returns Uint8Array containing the complete mark file
   */
  build(): Uint8Array {
    // Calculate required buffer size
    const bufferSize = this.calculateBufferSize()
    const buffer = new ArrayBuffer(bufferSize)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)

    let offset = 0

    // Write header (16 bytes)
    offset = this.writeHeader(view, bytes, offset)

    // Write column descriptors
    offset = this.writeColumnDescriptors(view, bytes, offset)

    // Write granule entries
    offset = this.writeGranuleEntries(view, bytes, offset)

    return bytes.subarray(0, offset)
  }

  /**
   * Calculate total buffer size needed for the mark file.
   */
  private calculateBufferSize(): number {
    let size = HEADER_SIZE

    // Column descriptors
    for (const col of this.columns) {
      size += 2 + 1 + col.name.length + 1 // columnId + nameLength + name + type
    }

    // Granule entries (per granule)
    // Base: byteOffset(8) + byteSize(4) + rowStart(4) + rowCount(4) = 20 bytes
    // Per column: minValue + maxValue + nullCount
    const baseGranuleSize = 20
    const perColumnSize = this.estimateValueSize() * 2 + 4 // min + max + nullCount

    size += this.granuleCount * (baseGranuleSize + this.columns.length * perColumnSize)

    // Add padding for variable-length strings
    size += this.granuleCount * this.columns.length * 256 // Conservative estimate

    return size
  }

  /**
   * Estimate average value size for buffer allocation.
   */
  private estimateValueSize(): number {
    // String: 2 bytes length + ~32 bytes average content
    // Int64/Float64/Timestamp: 8 bytes
    return 34
  }

  /**
   * Write the mark file header.
   */
  private writeHeader(view: DataView, bytes: Uint8Array, offset: number): number {
    // Magic (4 bytes)
    bytes.set(MARK_MAGIC, offset)
    offset += 4

    // Version (2 bytes)
    view.setUint16(offset, MARK_VERSION, true)
    offset += 2

    // Granule size (4 bytes)
    view.setUint32(offset, this.granuleSize, true)
    offset += 4

    // Granule count (4 bytes)
    view.setUint32(offset, this.granuleCount, true)
    offset += 4

    // Flags (2 bytes)
    view.setUint16(offset, this.flags, true)
    offset += 2

    return offset
  }

  /**
   * Write column descriptors.
   */
  private writeColumnDescriptors(view: DataView, bytes: Uint8Array, offset: number): number {
    for (const col of this.columns) {
      // Column ID (2 bytes)
      view.setUint16(offset, col.columnId, true)
      offset += 2

      // Name length (1 byte)
      const nameBytes = new TextEncoder().encode(col.name)
      view.setUint8(offset, nameBytes.length)
      offset += 1

      // Name (variable)
      bytes.set(nameBytes, offset)
      offset += nameBytes.length

      // Type (1 byte)
      view.setUint8(offset, col.type)
      offset += 1
    }

    return offset
  }

  /**
   * Write granule entries.
   */
  private writeGranuleEntries(view: DataView, bytes: Uint8Array, offset: number): number {
    for (let i = 0; i < this.granuleCount; i++) {
      // Get granule info from first column (all columns share byte offsets)
      const firstColumn = this.columnStats.values().next().value
      if (!firstColumn) break

      const granule = firstColumn.granules[i]

      // Byte offset (8 bytes)
      view.setBigUint64(offset, granule.byteOffset, true)
      offset += 8

      // Byte size (4 bytes)
      view.setUint32(offset, granule.byteSize, true)
      offset += 4

      // Row start (4 bytes)
      view.setUint32(offset, granule.rowStart, true)
      offset += 4

      // Row count (4 bytes)
      view.setUint32(offset, granule.rowCount, true)
      offset += 4

      // Write per-column stats
      for (const col of this.columns) {
        const colStats = this.columnStats.get(col.columnId)
        const colGranule = colStats?.granules[i]

        // Min value
        offset = this.writeValue(view, bytes, offset, col.type, colGranule?.minValue)

        // Max value
        offset = this.writeValue(view, bytes, offset, col.type, colGranule?.maxValue)

        // Null count (4 bytes)
        view.setUint32(offset, colGranule?.nullCount ?? 0, true)
        offset += 4
      }
    }

    return offset
  }

  /**
   * Write a typed value to the buffer.
   */
  private writeValue(
    view: DataView,
    bytes: Uint8Array,
    offset: number,
    type: ColumnType,
    value: GranuleValue | undefined
  ): number {
    // Write presence flag (1 byte)
    if (value === undefined || value === null) {
      view.setUint8(offset, 0) // Not present
      return offset + 1
    }

    view.setUint8(offset, 1) // Present
    offset += 1

    switch (type) {
      case ColumnType.String: {
        const strBytes = new TextEncoder().encode(value as string)
        // Length (2 bytes)
        view.setUint16(offset, strBytes.length, true)
        offset += 2
        // Content
        bytes.set(strBytes, offset)
        offset += strBytes.length
        break
      }

      case ColumnType.Int64:
      case ColumnType.Timestamp: {
        const bigVal = typeof value === 'bigint' ? value : BigInt(value as number)
        view.setBigInt64(offset, bigVal, true)
        offset += 8
        break
      }

      case ColumnType.Float64: {
        view.setFloat64(offset, value as number, true)
        offset += 8
        break
      }
    }

    return offset
  }
}

// ============================================================================
// MarkFileReader
// ============================================================================

/**
 * Parses mark files and provides granule lookup functionality.
 *
 * Optimized for fast parsing (<0.5ms) and efficient binary search
 * to find granules containing specific values.
 *
 * @example
 * ```typescript
 * const reader = new MarkFileReader(markFileBytes)
 *
 * // Find granule containing a specific value
 * const result = reader.findGranule(3, 'charge') // columnId, value
 * if (result) {
 *   // Fetch only the bytes needed
 *   const response = await fetch(parquetUrl, {
 *     headers: { Range: `bytes=${result.byteOffset}-${result.byteOffset + BigInt(result.byteSize) - 1n}` }
 *   })
 * }
 *
 * // Find granules for a range query
 * const rangeResults = reader.findGranulesInRange(3, 'aaa', 'mmm')
 * ```
 */
export class MarkFileReader {
  private readonly view: DataView
  private readonly bytes: Uint8Array
  private readonly header: MarkHeader
  private readonly columns: ColumnDescriptor[]
  private readonly granuleDataOffset: number
  private readonly granuleEntrySize: number

  // Cached granule stats for binary search
  private readonly granuleCache: Map<number, GranuleEntry[]> = new Map()

  constructor(data: Uint8Array | ArrayBuffer) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)

    // Parse header
    this.header = this.parseHeader()

    // Parse column descriptors
    const { columns, offset } = this.parseColumnDescriptors()
    this.columns = columns
    this.granuleDataOffset = offset

    // Calculate granule entry size (for random access)
    this.granuleEntrySize = this.calculateGranuleEntrySize()
  }

  /**
   * Get the mark file header.
   */
  getHeader(): MarkHeader {
    return this.header
  }

  /**
   * Get column descriptors.
   */
  getColumns(): ColumnDescriptor[] {
    return this.columns
  }

  /**
   * Get the number of granules.
   */
  getGranuleCount(): number {
    return this.header.granuleCount
  }

  /**
   * Get the granule size (rows per granule).
   */
  getGranuleSize(): number {
    return this.header.granuleSize
  }

  /**
   * Find the granule that may contain a specific value.
   *
   * Uses binary search on min/max statistics for O(log n) lookup.
   *
   * @param columnId - Column to search
   * @param value - Value to find
   * @returns Granule search result, or null if value is outside all ranges
   */
  findGranule(columnId: number, value: GranuleValue): GranuleSearchResult | null {
    const granules = this.getGranuleStats(columnId)
    if (granules.length === 0) return null

    const column = this.columns.find((c) => c.columnId === columnId)
    if (!column) return null

    // Binary search for the granule containing the value
    const index = this.binarySearchGranule(granules, columnId, value, column.type)
    if (index < 0) return null

    const granule = granules[index]
    return {
      granuleIndex: index,
      byteOffset: granule.byteOffset,
      byteSize: granule.byteSize,
      rowStart: granule.rowStart,
      rowCount: granule.rowCount,
    }
  }

  /**
   * Find all granules that may contain values in a range.
   *
   * @param columnId - Column to search
   * @param minValue - Minimum value (inclusive)
   * @param maxValue - Maximum value (inclusive)
   * @returns Array of granule search results
   */
  findGranulesInRange(
    columnId: number,
    minValue: GranuleValue,
    maxValue: GranuleValue
  ): GranuleSearchResult[] {
    const granules = this.getGranuleStats(columnId)
    if (granules.length === 0) return []

    const column = this.columns.find((c) => c.columnId === columnId)
    if (!column) return []

    const results: GranuleSearchResult[] = []

    for (let i = 0; i < granules.length; i++) {
      const granule = granules[i]
      const granuleMin = granule.minValues.get(columnId)
      const granuleMax = granule.maxValues.get(columnId)

      // Check if granule range overlaps with query range
      if (this.rangesOverlap(minValue, maxValue, granuleMin, granuleMax, column.type)) {
        results.push({
          granuleIndex: i,
          byteOffset: granule.byteOffset,
          byteSize: granule.byteSize,
          rowStart: granule.rowStart,
          rowCount: granule.rowCount,
        })
      }
    }

    return results
  }

  /**
   * Get all granules (parsed).
   */
  getAllGranules(): GranuleEntry[] {
    return this.parseAllGranules()
  }

  /**
   * Get byte range for specific granules.
   *
   * @param granuleIndices - Array of granule indices to fetch
   * @returns Combined byte range { start, end } for all granules
   */
  getByteRange(granuleIndices: number[]): { start: bigint; end: bigint } | null {
    if (granuleIndices.length === 0) return null

    const granules = this.parseAllGranules()
    let minOffset = BigInt('9007199254740991') // MAX_SAFE_INTEGER as BigInt
    let maxEnd = 0n

    for (const idx of granuleIndices) {
      if (idx < 0 || idx >= granules.length) continue
      const g = granules[idx]
      if (g.byteOffset < minOffset) minOffset = g.byteOffset
      const end = g.byteOffset + BigInt(g.byteSize)
      if (end > maxEnd) maxEnd = end
    }

    return { start: minOffset, end: maxEnd }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Parse the mark file header.
   */
  private parseHeader(): MarkHeader {
    // Validate magic bytes
    const magic = this.bytes.subarray(0, 4)
    if (!this.arrayEquals(magic, MARK_MAGIC)) {
      throw new Error('Invalid mark file: bad magic bytes')
    }

    return {
      magic,
      version: this.view.getUint16(4, true),
      granuleSize: this.view.getUint32(6, true),
      granuleCount: this.view.getUint32(10, true),
      flags: this.view.getUint16(14, true) as MarkFlags,
    }
  }

  /**
   * Parse column descriptors.
   */
  private parseColumnDescriptors(): { columns: ColumnDescriptor[]; offset: number } {
    const columns: ColumnDescriptor[] = []
    let offset = HEADER_SIZE

    // Read columns until we hit granule data
    // We need to know how many columns there are - infer from first granule
    // For now, parse until we see a pattern break
    // A proper implementation would store column count in header

    // Heuristic: read columns while offset < expected granule start
    // Column format: 2 + 1 + name_len + 1 = 4 + name_len bytes minimum
    while (offset < this.bytes.length - 20) {
      // 20 = minimum granule entry
      const columnId = this.view.getUint16(offset, true)
      const nameLength = this.view.getUint8(offset + 2)

      // Sanity check: name length should be reasonable
      if (nameLength === 0 || nameLength > 255 || offset + 4 + nameLength > this.bytes.length) {
        break
      }

      const name = new TextDecoder().decode(this.bytes.subarray(offset + 3, offset + 3 + nameLength))
      const type = this.view.getUint8(offset + 3 + nameLength) as ColumnType

      // Sanity check: type should be valid
      if (type > ColumnType.Timestamp) {
        break
      }

      columns.push({ columnId, name, type })
      offset += 4 + nameLength

      // If we've read what looks like column descriptors, check if next looks like granule data
      // Granule data starts with byte offset (8 bytes), which would be a large number
      // compared to column IDs (typically small numbers)
      if (offset + 8 <= this.bytes.length) {
        const nextValue = this.view.getUint16(offset, true)
        // If next value looks like a reasonable column ID (< 1000), continue
        // Otherwise, we've hit granule data
        if (nextValue >= 1000 || columns.length >= 10) {
          break
        }
      }
    }

    return { columns, offset }
  }

  /**
   * Calculate the size of a single granule entry.
   */
  private calculateGranuleEntrySize(): number {
    // This is an approximation - actual size varies with string lengths
    // Base: 8 + 4 + 4 + 4 = 20 bytes
    // Per column: 1 (presence) + value_size + 1 (presence) + value_size + 4 (nullCount)
    // For strings: 1 + 2 + avg_len + 1 + 2 + avg_len + 4 = 10 + 2*avg_len
    // For fixed types: 1 + 8 + 1 + 8 + 4 = 22
    return 20 + this.columns.length * 30 // Conservative estimate
  }

  /**
   * Get granule statistics for a column (cached).
   */
  private getGranuleStats(columnId: number): GranuleEntry[] {
    if (this.granuleCache.has(columnId)) {
      return this.granuleCache.get(columnId)!
    }

    const granules = this.parseAllGranules()
    this.granuleCache.set(columnId, granules)
    return granules
  }

  /**
   * Parse all granule entries from the mark file.
   */
  private parseAllGranules(): GranuleEntry[] {
    const granules: GranuleEntry[] = []
    let offset = this.granuleDataOffset

    for (let i = 0; i < this.header.granuleCount; i++) {
      if (offset + 20 > this.bytes.length) break

      const byteOffset = this.view.getBigUint64(offset, true)
      offset += 8

      const byteSize = this.view.getUint32(offset, true)
      offset += 4

      const rowStart = this.view.getUint32(offset, true)
      offset += 4

      const rowCount = this.view.getUint32(offset, true)
      offset += 4

      const minValues = new Map<number, GranuleValue>()
      const maxValues = new Map<number, GranuleValue>()
      const nullCounts = new Map<number, number>()

      // Parse per-column stats
      for (const col of this.columns) {
        // Min value
        const { value: minValue, newOffset: offset1 } = this.readValue(offset, col.type)
        offset = offset1
        if (minValue !== undefined) {
          minValues.set(col.columnId, minValue)
        }

        // Max value
        const { value: maxValue, newOffset: offset2 } = this.readValue(offset, col.type)
        offset = offset2
        if (maxValue !== undefined) {
          maxValues.set(col.columnId, maxValue)
        }

        // Null count
        const nullCount = this.view.getUint32(offset, true)
        offset += 4
        nullCounts.set(col.columnId, nullCount)
      }

      granules.push({
        byteOffset,
        byteSize,
        rowStart,
        rowCount,
        minValues,
        maxValues,
        nullCounts,
      })
    }

    return granules
  }

  /**
   * Read a typed value from the buffer.
   */
  private readValue(
    offset: number,
    type: ColumnType
  ): { value: GranuleValue | undefined; newOffset: number } {
    // Read presence flag
    const present = this.view.getUint8(offset)
    offset += 1

    if (!present) {
      return { value: undefined, newOffset: offset }
    }

    switch (type) {
      case ColumnType.String: {
        const length = this.view.getUint16(offset, true)
        offset += 2
        const value = new TextDecoder().decode(this.bytes.subarray(offset, offset + length))
        return { value, newOffset: offset + length }
      }

      case ColumnType.Int64:
      case ColumnType.Timestamp: {
        const value = this.view.getBigInt64(offset, true)
        return { value, newOffset: offset + 8 }
      }

      case ColumnType.Float64: {
        const value = this.view.getFloat64(offset, true)
        return { value, newOffset: offset + 8 }
      }
    }

    return { value: undefined, newOffset: offset }
  }

  /**
   * Binary search for the granule containing a value.
   */
  private binarySearchGranule(
    granules: GranuleEntry[],
    columnId: number,
    value: GranuleValue,
    type: ColumnType
  ): number {
    let left = 0
    let right = granules.length - 1
    let result = -1

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const granule = granules[mid]

      const minVal = granule.minValues.get(columnId)
      const maxVal = granule.maxValues.get(columnId)

      // If no stats, conservatively include this granule
      if (minVal === undefined || maxVal === undefined) {
        result = mid
        break
      }

      const cmpMin = this.compareValues(value, minVal, type)
      const cmpMax = this.compareValues(value, maxVal, type)

      if (cmpMin >= 0 && cmpMax <= 0) {
        // Value is within this granule's range
        return mid
      } else if (cmpMin < 0) {
        // Value is before this granule
        right = mid - 1
      } else {
        // Value is after this granule
        left = mid + 1
      }
    }

    return result
  }

  /**
   * Check if two ranges overlap.
   */
  private rangesOverlap(
    queryMin: GranuleValue,
    queryMax: GranuleValue,
    granuleMin: GranuleValue | undefined,
    granuleMax: GranuleValue | undefined,
    type: ColumnType
  ): boolean {
    // If granule has no stats, conservatively include it
    if (granuleMin === undefined || granuleMax === undefined) {
      return true
    }

    // Ranges overlap if: queryMin <= granuleMax AND queryMax >= granuleMin
    return (
      this.compareValues(queryMin, granuleMax, type) <= 0 &&
      this.compareValues(queryMax, granuleMin, type) >= 0
    )
  }

  /**
   * Compare two values of the same type.
   */
  private compareValues(a: GranuleValue, b: GranuleValue, type: ColumnType): number {
    switch (type) {
      case ColumnType.String:
        return (a as string).localeCompare(b as string)

      case ColumnType.Int64:
      case ColumnType.Timestamp: {
        const aVal = typeof a === 'bigint' ? a : BigInt(a as number)
        const bVal = typeof b === 'bigint' ? b : BigInt(b as number)
        if (aVal < bVal) return -1
        if (aVal > bVal) return 1
        return 0
      }

      case ColumnType.Float64: {
        const aVal = a as number
        const bVal = b as number
        if (aVal < bVal) return -1
        if (aVal > bVal) return 1
        return 0
      }
    }
  }

  /**
   * Compare two Uint8Arrays for equality.
   */
  private arrayEquals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a mark file from Parquet column statistics.
 *
 * Convenience function for common use case.
 *
 * @example
 * ```typescript
 * const markFile = createMarkFile(
 *   [
 *     {
 *       columnId: 3,
 *       name: 'id',
 *       type: ColumnType.String,
 *       granules: [...],
 *     },
 *   ],
 *   { granuleSize: 8192 }
 * )
 * ```
 */
export function createMarkFile(
  columns: ParquetColumnStats[],
  options?: MarkWriterOptions
): Uint8Array {
  const writer = new MarkFileWriter(options)
  for (const col of columns) {
    writer.addColumn(col)
  }
  return writer.build()
}

/**
 * Parse a mark file and return a reader.
 *
 * Convenience function for common use case.
 */
export function parseMarkFile(data: Uint8Array | ArrayBuffer): MarkFileReader {
  return new MarkFileReader(data)
}

/**
 * Estimate the size of a mark file given column and granule counts.
 *
 * Useful for capacity planning.
 *
 * @param columnCount - Number of indexed columns
 * @param granuleCount - Number of granules
 * @param avgStringLength - Average string value length (for String columns)
 * @returns Estimated size in bytes
 */
export function estimateMarkFileSize(
  columnCount: number,
  granuleCount: number,
  avgStringLength = 20
): number {
  const headerSize = HEADER_SIZE
  const columnDescSize = columnCount * (4 + avgStringLength) // conservative
  const granuleBaseSize = 20 // byte offset + size + row start + row count
  const perColumnSize = 2 + avgStringLength * 2 + 4 // presence flags + values + null count

  return headerSize + columnDescSize + granuleCount * (granuleBaseSize + columnCount * perColumnSize)
}
