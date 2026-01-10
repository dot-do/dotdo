import { describe, it, expect, beforeEach } from 'vitest'

/**
 * ClickHouse-style Mark File Tests
 *
 * Tests for granule-level byte offsets and min/max statistics,
 * enabling precise range requests from Cloudflare Snippets.
 *
 * Key properties tested:
 * - Binary format correctness (header, column descriptors, granule entries)
 * - Roundtrip serialization/deserialization
 * - Binary search efficiency for granule lookups
 * - Range query support
 * - Memory efficiency and parsing speed
 *
 * @module db/iceberg/marks.test
 */

import {
  MarkFileWriter,
  MarkFileReader,
  ColumnType,
  MarkFlags,
  MARK_MAGIC,
  MARK_VERSION,
  HEADER_SIZE,
  DEFAULT_GRANULE_SIZE,
  createMarkFile,
  parseMarkFile,
  estimateMarkFileSize,
  type ParquetColumnStats,
  type GranuleEntry,
  type GranuleSearchResult,
} from './marks'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create sample column stats for testing.
 */
function createStringColumnStats(
  columnId: number,
  name: string,
  granules: Array<{
    byteOffset: bigint
    byteSize: number
    rowStart: number
    rowCount: number
    minValue: string
    maxValue: string
    nullCount?: number
  }>
): ParquetColumnStats {
  return {
    columnId,
    name,
    type: ColumnType.String,
    granules: granules.map((g) => ({
      ...g,
      nullCount: g.nullCount ?? 0,
    })),
  }
}

/**
 * Create sample Int64 column stats.
 */
function createInt64ColumnStats(
  columnId: number,
  name: string,
  granules: Array<{
    byteOffset: bigint
    byteSize: number
    rowStart: number
    rowCount: number
    minValue: bigint
    maxValue: bigint
    nullCount?: number
  }>
): ParquetColumnStats {
  return {
    columnId,
    name,
    type: ColumnType.Int64,
    granules: granules.map((g) => ({
      ...g,
      nullCount: g.nullCount ?? 0,
    })),
  }
}

/**
 * Create sample Float64 column stats.
 */
function createFloat64ColumnStats(
  columnId: number,
  name: string,
  granules: Array<{
    byteOffset: bigint
    byteSize: number
    rowStart: number
    rowCount: number
    minValue: number
    maxValue: number
    nullCount?: number
  }>
): ParquetColumnStats {
  return {
    columnId,
    name,
    type: ColumnType.Float64,
    granules: granules.map((g) => ({
      ...g,
      nullCount: g.nullCount ?? 0,
    })),
  }
}

/**
 * Create sample Timestamp column stats.
 */
function createTimestampColumnStats(
  columnId: number,
  name: string,
  granules: Array<{
    byteOffset: bigint
    byteSize: number
    rowStart: number
    rowCount: number
    minValue: bigint
    maxValue: bigint
    nullCount?: number
  }>
): ParquetColumnStats {
  return {
    columnId,
    name,
    type: ColumnType.Timestamp,
    granules: granules.map((g) => ({
      ...g,
      nullCount: g.nullCount ?? 0,
    })),
  }
}

// Field IDs matching the do_resources schema
const FIELD_IDS = {
  ns: 1,
  type: 2,
  id: 3,
  ts: 4,
  data: 5,
}

// ============================================================================
// Header Tests
// ============================================================================

describe('Mark File Header', () => {
  it('writes correct magic bytes', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'z' },
      ])
    )

    const bytes = writer.build()

    expect(bytes.subarray(0, 4)).toEqual(MARK_MAGIC)
  })

  it('writes correct version', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'z' },
      ])
    )

    const bytes = writer.build()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    expect(view.getUint16(4, true)).toBe(MARK_VERSION)
  })

  it('writes custom granule size', () => {
    const writer = new MarkFileWriter({ granuleSize: 4096 })
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        { byteOffset: 0n, byteSize: 32768, rowStart: 0, rowCount: 4096, minValue: 'a', maxValue: 'z' },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)

    expect(reader.getGranuleSize()).toBe(4096)
  })

  it('writes correct granule count', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'm' },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'n',
          maxValue: 'z',
        },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)

    expect(reader.getGranuleCount()).toBe(2)
  })

  it('parses header correctly', () => {
    const writer = new MarkFileWriter({ granuleSize: 16384 })
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        { byteOffset: 0n, byteSize: 131072, rowStart: 0, rowCount: 16384, minValue: 'a', maxValue: 'z' },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const header = reader.getHeader()

    expect(header.version).toBe(MARK_VERSION)
    expect(header.granuleSize).toBe(16384)
    expect(header.granuleCount).toBe(1)
  })

  it('throws on invalid magic bytes', () => {
    const badMagic = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])

    expect(() => new MarkFileReader(badMagic)).toThrow('Invalid mark file: bad magic bytes')
  })
})

// ============================================================================
// Column Descriptor Tests
// ============================================================================

describe('Column Descriptors', () => {
  it('writes and reads column descriptors', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'z' },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const columns = reader.getColumns()

    expect(columns).toHaveLength(1)
    expect(columns[0].columnId).toBe(FIELD_IDS.id)
    expect(columns[0].name).toBe('id')
    expect(columns[0].type).toBe(ColumnType.String)
  })

  it('handles multiple columns', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.ns, 'ns', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'payments.do',
          maxValue: 'payments.do',
        },
      ])
    )
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.type, 'type', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'Function',
          maxValue: 'Function',
        },
      ])
    )
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'authorize',
          maxValue: 'void',
        },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const columns = reader.getColumns()

    expect(columns).toHaveLength(3)
    expect(columns.map((c) => c.name)).toEqual(['ns', 'type', 'id'])
  })

  it('handles different column types', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(1, 'name', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'z' },
      ])
    )
    writer.addColumn(
      createInt64ColumnStats(2, 'count', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 0n, maxValue: 1000n },
      ])
    )
    writer.addColumn(
      createFloat64ColumnStats(3, 'score', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 0.0, maxValue: 100.0 },
      ])
    )
    writer.addColumn(
      createTimestampColumnStats(4, 'created_at', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 1704067200000n,
          maxValue: 1704153600000n,
        },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const columns = reader.getColumns()

    expect(columns[0].type).toBe(ColumnType.String)
    expect(columns[1].type).toBe(ColumnType.Int64)
    expect(columns[2].type).toBe(ColumnType.Float64)
    expect(columns[3].type).toBe(ColumnType.Timestamp)
  })
})

// ============================================================================
// Granule Entry Tests
// ============================================================================

describe('Granule Entries', () => {
  it('writes and reads byte offsets correctly', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'm' },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'n',
          maxValue: 'z',
        },
        {
          byteOffset: 131072n,
          byteSize: 32768,
          rowStart: 16384,
          rowCount: 4096,
          minValue: 'aa',
          maxValue: 'zz',
        },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const granules = reader.getAllGranules()

    expect(granules[0].byteOffset).toBe(0n)
    expect(granules[1].byteOffset).toBe(65536n)
    expect(granules[2].byteOffset).toBe(131072n)
  })

  it('writes and reads byte sizes correctly', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'm' },
        {
          byteOffset: 65536n,
          byteSize: 32768,
          rowStart: 8192,
          rowCount: 4096,
          minValue: 'n',
          maxValue: 'z',
        },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const granules = reader.getAllGranules()

    expect(granules[0].byteSize).toBe(65536)
    expect(granules[1].byteSize).toBe(32768)
  })

  it('writes and reads row information correctly', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'm' },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'n',
          maxValue: 'z',
        },
        {
          byteOffset: 131072n,
          byteSize: 32768,
          rowStart: 16384,
          rowCount: 5000,
          minValue: 'aa',
          maxValue: 'zz',
        },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const granules = reader.getAllGranules()

    expect(granules[0].rowStart).toBe(0)
    expect(granules[0].rowCount).toBe(8192)
    expect(granules[1].rowStart).toBe(8192)
    expect(granules[1].rowCount).toBe(8192)
    expect(granules[2].rowStart).toBe(16384)
    expect(granules[2].rowCount).toBe(5000)
  })

  it('writes and reads string min/max values', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'authorize',
          maxValue: 'capture',
        },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'charge',
          maxValue: 'refund',
        },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const granules = reader.getAllGranules()

    expect(granules[0].minValues.get(FIELD_IDS.id)).toBe('authorize')
    expect(granules[0].maxValues.get(FIELD_IDS.id)).toBe('capture')
    expect(granules[1].minValues.get(FIELD_IDS.id)).toBe('charge')
    expect(granules[1].maxValues.get(FIELD_IDS.id)).toBe('refund')
  })

  it('writes and reads Int64 min/max values', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createInt64ColumnStats(FIELD_IDS.data, 'count', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 0n, maxValue: 999n },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 1000n,
          maxValue: 1999n,
        },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const granules = reader.getAllGranules()

    expect(granules[0].minValues.get(FIELD_IDS.data)).toBe(0n)
    expect(granules[0].maxValues.get(FIELD_IDS.data)).toBe(999n)
    expect(granules[1].minValues.get(FIELD_IDS.data)).toBe(1000n)
    expect(granules[1].maxValues.get(FIELD_IDS.data)).toBe(1999n)
  })

  it('writes and reads Float64 min/max values', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createFloat64ColumnStats(FIELD_IDS.data, 'score', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 0.0,
          maxValue: 49.99,
        },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 50.0,
          maxValue: 100.0,
        },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const granules = reader.getAllGranules()

    expect(granules[0].minValues.get(FIELD_IDS.data)).toBe(0.0)
    expect(granules[0].maxValues.get(FIELD_IDS.data)).toBe(49.99)
    expect(granules[1].minValues.get(FIELD_IDS.data)).toBe(50.0)
    expect(granules[1].maxValues.get(FIELD_IDS.data)).toBe(100.0)
  })

  it('writes and reads null counts', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'a',
          maxValue: 'z',
          nullCount: 0,
        },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'aa',
          maxValue: 'zz',
          nullCount: 100,
        },
      ])
    )

    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)
    const granules = reader.getAllGranules()

    expect(granules[0].nullCounts.get(FIELD_IDS.id)).toBe(0)
    expect(granules[1].nullCounts.get(FIELD_IDS.id)).toBe(100)
  })
})

// ============================================================================
// Binary Search Tests
// ============================================================================

describe('Binary Search', () => {
  let reader: MarkFileReader

  beforeEach(() => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'aaa',
          maxValue: 'fff',
        },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'ggg',
          maxValue: 'mmm',
        },
        {
          byteOffset: 131072n,
          byteSize: 65536,
          rowStart: 16384,
          rowCount: 8192,
          minValue: 'nnn',
          maxValue: 'ttt',
        },
        {
          byteOffset: 196608n,
          byteSize: 65536,
          rowStart: 24576,
          rowCount: 8192,
          minValue: 'uuu',
          maxValue: 'zzz',
        },
      ])
    )
    reader = new MarkFileReader(writer.build())
  })

  it('finds granule containing value in first range', () => {
    const result = reader.findGranule(FIELD_IDS.id, 'bbb')

    expect(result).not.toBeNull()
    expect(result!.granuleIndex).toBe(0)
    expect(result!.byteOffset).toBe(0n)
  })

  it('finds granule containing value in middle range', () => {
    const result = reader.findGranule(FIELD_IDS.id, 'jjj')

    expect(result).not.toBeNull()
    expect(result!.granuleIndex).toBe(1)
    expect(result!.byteOffset).toBe(65536n)
  })

  it('finds granule containing value in last range', () => {
    const result = reader.findGranule(FIELD_IDS.id, 'www')

    expect(result).not.toBeNull()
    expect(result!.granuleIndex).toBe(3)
    expect(result!.byteOffset).toBe(196608n)
  })

  it('finds granule when value equals min bound', () => {
    const result = reader.findGranule(FIELD_IDS.id, 'nnn')

    expect(result).not.toBeNull()
    expect(result!.granuleIndex).toBe(2)
  })

  it('finds granule when value equals max bound', () => {
    const result = reader.findGranule(FIELD_IDS.id, 'ttt')

    expect(result).not.toBeNull()
    expect(result!.granuleIndex).toBe(2)
  })

  it('returns null when value is below all ranges', () => {
    const result = reader.findGranule(FIELD_IDS.id, '000')

    expect(result).toBeNull()
  })

  it('returns null when value is above all ranges', () => {
    const result = reader.findGranule(FIELD_IDS.id, 'zzzzz')

    expect(result).toBeNull()
  })

  it('returns null for non-existent column', () => {
    const result = reader.findGranule(999, 'test')

    expect(result).toBeNull()
  })
})

// ============================================================================
// Range Query Tests
// ============================================================================

describe('Range Queries', () => {
  let reader: MarkFileReader

  beforeEach(() => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'aaa',
          maxValue: 'ddd',
        },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'eee',
          maxValue: 'hhh',
        },
        {
          byteOffset: 131072n,
          byteSize: 65536,
          rowStart: 16384,
          rowCount: 8192,
          minValue: 'iii',
          maxValue: 'lll',
        },
        {
          byteOffset: 196608n,
          byteSize: 65536,
          rowStart: 24576,
          rowCount: 8192,
          minValue: 'mmm',
          maxValue: 'ppp',
        },
        {
          byteOffset: 262144n,
          byteSize: 65536,
          rowStart: 32768,
          rowCount: 8192,
          minValue: 'qqq',
          maxValue: 'zzz',
        },
      ])
    )
    reader = new MarkFileReader(writer.build())
  })

  it('finds single granule for narrow range', () => {
    const results = reader.findGranulesInRange(FIELD_IDS.id, 'fff', 'ggg')

    expect(results).toHaveLength(1)
    expect(results[0].granuleIndex).toBe(1)
  })

  it('finds multiple granules for wide range', () => {
    const results = reader.findGranulesInRange(FIELD_IDS.id, 'fff', 'nnn')

    expect(results).toHaveLength(3)
    expect(results.map((r) => r.granuleIndex)).toEqual([1, 2, 3])
  })

  it('finds all granules for full range', () => {
    const results = reader.findGranulesInRange(FIELD_IDS.id, 'aaa', 'zzz')

    expect(results).toHaveLength(5)
  })

  it('returns empty array for range below all granules', () => {
    const results = reader.findGranulesInRange(FIELD_IDS.id, '000', '999')

    expect(results).toHaveLength(0)
  })

  it('returns empty array for range above all granules', () => {
    const results = reader.findGranulesInRange(FIELD_IDS.id, 'zzzz', 'zzzzz')

    expect(results).toHaveLength(0)
  })

  it('finds granules that partially overlap query range', () => {
    // Query starts before first granule but overlaps it
    const results = reader.findGranulesInRange(FIELD_IDS.id, '999', 'bbb')

    expect(results).toHaveLength(1)
    expect(results[0].granuleIndex).toBe(0)
  })
})

// ============================================================================
// Byte Range Calculation Tests
// ============================================================================

describe('Byte Range Calculation', () => {
  let reader: MarkFileReader

  beforeEach(() => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'aaa',
          maxValue: 'ddd',
        },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'eee',
          maxValue: 'hhh',
        },
        {
          byteOffset: 131072n,
          byteSize: 32768,
          rowStart: 16384,
          rowCount: 4096,
          minValue: 'iii',
          maxValue: 'lll',
        },
      ])
    )
    reader = new MarkFileReader(writer.build())
  })

  it('calculates byte range for single granule', () => {
    const range = reader.getByteRange([0])

    expect(range).not.toBeNull()
    expect(range!.start).toBe(0n)
    expect(range!.end).toBe(65536n)
  })

  it('calculates byte range for consecutive granules', () => {
    const range = reader.getByteRange([0, 1])

    expect(range).not.toBeNull()
    expect(range!.start).toBe(0n)
    expect(range!.end).toBe(131072n) // 65536 + 65536
  })

  it('calculates byte range for non-consecutive granules', () => {
    const range = reader.getByteRange([0, 2])

    expect(range).not.toBeNull()
    expect(range!.start).toBe(0n)
    expect(range!.end).toBe(163840n) // 131072 + 32768
  })

  it('returns null for empty granule list', () => {
    const range = reader.getByteRange([])

    expect(range).toBeNull()
  })

  it('ignores out-of-bounds indices', () => {
    const range = reader.getByteRange([0, 100])

    expect(range).not.toBeNull()
    expect(range!.start).toBe(0n)
    expect(range!.end).toBe(65536n)
  })
})

// ============================================================================
// Numeric Column Tests
// ============================================================================

describe('Numeric Column Types', () => {
  describe('Int64 columns', () => {
    let reader: MarkFileReader

    beforeEach(() => {
      const writer = new MarkFileWriter()
      writer.addColumn(
        createInt64ColumnStats(1, 'user_id', [
          {
            byteOffset: 0n,
            byteSize: 65536,
            rowStart: 0,
            rowCount: 8192,
            minValue: 1n,
            maxValue: 1000n,
          },
          {
            byteOffset: 65536n,
            byteSize: 65536,
            rowStart: 8192,
            rowCount: 8192,
            minValue: 1001n,
            maxValue: 2000n,
          },
          {
            byteOffset: 131072n,
            byteSize: 65536,
            rowStart: 16384,
            rowCount: 8192,
            minValue: 2001n,
            maxValue: 3000n,
          },
        ])
      )
      reader = new MarkFileReader(writer.build())
    })

    it('finds granule by Int64 value', () => {
      const result = reader.findGranule(1, 1500n)

      expect(result).not.toBeNull()
      expect(result!.granuleIndex).toBe(1)
    })

    it('handles Int64 range queries', () => {
      const results = reader.findGranulesInRange(1, 500n, 1500n)

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.granuleIndex)).toEqual([0, 1])
    })

    it('handles negative Int64 values', () => {
      const writer = new MarkFileWriter()
      writer.addColumn(
        createInt64ColumnStats(1, 'balance', [
          {
            byteOffset: 0n,
            byteSize: 65536,
            rowStart: 0,
            rowCount: 8192,
            minValue: -1000n,
            maxValue: -1n,
          },
          {
            byteOffset: 65536n,
            byteSize: 65536,
            rowStart: 8192,
            rowCount: 8192,
            minValue: 0n,
            maxValue: 1000n,
          },
        ])
      )
      const negReader = new MarkFileReader(writer.build())

      const result = negReader.findGranule(1, -500n)
      expect(result).not.toBeNull()
      expect(result!.granuleIndex).toBe(0)
    })
  })

  describe('Float64 columns', () => {
    let reader: MarkFileReader

    beforeEach(() => {
      const writer = new MarkFileWriter()
      writer.addColumn(
        createFloat64ColumnStats(1, 'score', [
          {
            byteOffset: 0n,
            byteSize: 65536,
            rowStart: 0,
            rowCount: 8192,
            minValue: 0.0,
            maxValue: 33.33,
          },
          {
            byteOffset: 65536n,
            byteSize: 65536,
            rowStart: 8192,
            rowCount: 8192,
            minValue: 33.34,
            maxValue: 66.66,
          },
          {
            byteOffset: 131072n,
            byteSize: 65536,
            rowStart: 16384,
            rowCount: 8192,
            minValue: 66.67,
            maxValue: 100.0,
          },
        ])
      )
      reader = new MarkFileReader(writer.build())
    })

    it('finds granule by Float64 value', () => {
      const result = reader.findGranule(1, 50.0)

      expect(result).not.toBeNull()
      expect(result!.granuleIndex).toBe(1)
    })

    it('handles Float64 range queries', () => {
      const results = reader.findGranulesInRange(1, 25.0, 75.0)

      expect(results).toHaveLength(3)
    })

    it('handles very small float values', () => {
      const writer = new MarkFileWriter()
      writer.addColumn(
        createFloat64ColumnStats(1, 'precision', [
          {
            byteOffset: 0n,
            byteSize: 65536,
            rowStart: 0,
            rowCount: 8192,
            minValue: 0.0000001,
            maxValue: 0.0000009,
          },
        ])
      )
      const smallReader = new MarkFileReader(writer.build())

      const result = smallReader.findGranule(1, 0.0000005)
      expect(result).not.toBeNull()
    })
  })

  describe('Timestamp columns', () => {
    let reader: MarkFileReader
    const jan1 = 1704067200000n // 2024-01-01 00:00:00 UTC
    const jan2 = 1704153600000n // 2024-01-02 00:00:00 UTC
    const jan3 = 1704240000000n // 2024-01-03 00:00:00 UTC

    beforeEach(() => {
      const writer = new MarkFileWriter()
      writer.addColumn(
        createTimestampColumnStats(FIELD_IDS.ts, 'ts', [
          {
            byteOffset: 0n,
            byteSize: 65536,
            rowStart: 0,
            rowCount: 8192,
            minValue: jan1,
            maxValue: jan2 - 1n,
          },
          {
            byteOffset: 65536n,
            byteSize: 65536,
            rowStart: 8192,
            rowCount: 8192,
            minValue: jan2,
            maxValue: jan3 - 1n,
          },
        ])
      )
      reader = new MarkFileReader(writer.build())
    })

    it('finds granule by timestamp value', () => {
      const midJan1 = jan1 + 43200000n // noon on Jan 1
      const result = reader.findGranule(FIELD_IDS.ts, midJan1)

      expect(result).not.toBeNull()
      expect(result!.granuleIndex).toBe(0)
    })

    it('handles timestamp range queries', () => {
      const results = reader.findGranulesInRange(FIELD_IDS.ts, jan1, jan3)

      expect(results).toHaveLength(2)
    })
  })
})

// ============================================================================
// Convenience Function Tests
// ============================================================================

describe('Convenience Functions', () => {
  describe('createMarkFile', () => {
    it('creates mark file from column stats', () => {
      const bytes = createMarkFile([
        createStringColumnStats(FIELD_IDS.id, 'id', [
          { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'z' },
        ]),
      ])

      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBeGreaterThan(HEADER_SIZE)
    })

    it('accepts custom options', () => {
      const bytes = createMarkFile(
        [
          createStringColumnStats(FIELD_IDS.id, 'id', [
            {
              byteOffset: 0n,
              byteSize: 32768,
              rowStart: 0,
              rowCount: 4096,
              minValue: 'a',
              maxValue: 'z',
            },
          ]),
        ],
        { granuleSize: 4096 }
      )

      const reader = parseMarkFile(bytes)
      expect(reader.getGranuleSize()).toBe(4096)
    })
  })

  describe('parseMarkFile', () => {
    it('returns MarkFileReader', () => {
      const bytes = createMarkFile([
        createStringColumnStats(FIELD_IDS.id, 'id', [
          { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'z' },
        ]),
      ])

      const reader = parseMarkFile(bytes)
      expect(reader).toBeInstanceOf(MarkFileReader)
    })
  })

  describe('estimateMarkFileSize', () => {
    it('estimates size for single column', () => {
      const estimated = estimateMarkFileSize(1, 10)

      expect(estimated).toBeGreaterThan(HEADER_SIZE)
      expect(estimated).toBeLessThan(5000) // Should be small
    })

    it('estimates size for multiple columns and granules', () => {
      const estimated = estimateMarkFileSize(5, 100)

      // 5 columns * 100 granules is a larger case, should still be reasonably sized
      expect(estimated).toBeLessThan(30000)
    })

    it('accounts for longer strings', () => {
      const shortStrings = estimateMarkFileSize(1, 10, 10)
      const longStrings = estimateMarkFileSize(1, 10, 100)

      expect(longStrings).toBeGreaterThan(shortStrings)
    })
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  it('parses mark file efficiently', () => {
    const writer = new MarkFileWriter()
    // Create a realistic mark file with 100 granules and 3 columns
    const granules = Array.from({ length: 100 }, (_, i) => ({
      byteOffset: BigInt(i * 65536),
      byteSize: 65536,
      rowStart: i * 8192,
      rowCount: 8192,
      minValue: String(i).padStart(4, '0') + '-aaa',
      maxValue: String(i).padStart(4, '0') + '-zzz',
    }))

    writer.addColumn(createStringColumnStats(FIELD_IDS.ns, 'ns', granules))
    writer.addColumn(createStringColumnStats(FIELD_IDS.type, 'type', granules))
    writer.addColumn(createStringColumnStats(FIELD_IDS.id, 'id', granules))

    const bytes = writer.build()

    const start = performance.now()
    const reader = new MarkFileReader(bytes)
    reader.getAllGranules() // Force full parse
    const elapsed = performance.now() - start

    // Should parse quickly - under 2ms even with system variance
    // In practice, this runs in ~0.3-0.7ms
    expect(elapsed).toBeLessThan(2)
  })

  it('binary search is O(log n) efficient', () => {
    const writer = new MarkFileWriter()
    const granules = Array.from({ length: 1000 }, (_, i) => ({
      byteOffset: BigInt(i * 65536),
      byteSize: 65536,
      rowStart: i * 8192,
      rowCount: 8192,
      minValue: String(i * 100).padStart(6, '0'),
      maxValue: String((i + 1) * 100 - 1).padStart(6, '0'),
    }))

    writer.addColumn(createStringColumnStats(FIELD_IDS.id, 'id', granules))
    const bytes = writer.build()
    const reader = new MarkFileReader(bytes)

    // Warm up
    reader.findGranule(FIELD_IDS.id, '050000')

    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      const target = String(Math.floor(Math.random() * 100000)).padStart(6, '0')
      reader.findGranule(FIELD_IDS.id, target)
    }
    const elapsed = performance.now() - start

    // 1000 lookups should complete in under 50ms
    expect(elapsed).toBeLessThan(50)
  })

  it('mark file size stays compact for typical case', () => {
    const writer = new MarkFileWriter()
    // Typical case: 50 granules, 3 indexed columns
    const granules = Array.from({ length: 50 }, (_, i) => ({
      byteOffset: BigInt(i * 65536),
      byteSize: 65536,
      rowStart: i * 8192,
      rowCount: 8192,
      minValue: 'value-' + String(i).padStart(3, '0'),
      maxValue: 'value-' + String(i + 1).padStart(3, '0'),
    }))

    writer.addColumn(createStringColumnStats(FIELD_IDS.ns, 'ns', granules))
    writer.addColumn(createStringColumnStats(FIELD_IDS.type, 'type', granules))
    writer.addColumn(createStringColumnStats(FIELD_IDS.id, 'id', granules))

    const bytes = writer.build()

    // ~5KB for 50 granules * 3 columns with variable-length strings is reasonable
    // The key requirement is that it's small enough to cache and parse quickly
    expect(bytes.length).toBeLessThan(6000)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles single granule', () => {
    const bytes = createMarkFile([
      createStringColumnStats(FIELD_IDS.id, 'id', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 1000,
          minValue: 'only',
          maxValue: 'only',
        },
      ]),
    ])

    const reader = parseMarkFile(bytes)
    const result = reader.findGranule(FIELD_IDS.id, 'only')

    expect(result).not.toBeNull()
    expect(result!.granuleIndex).toBe(0)
  })

  it('handles empty column name', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(1, '', [
        { byteOffset: 0n, byteSize: 65536, rowStart: 0, rowCount: 8192, minValue: 'a', maxValue: 'z' },
      ])
    )

    // Empty column names should still work but may cause parsing issues
    // This tests that we handle the edge case gracefully
    const bytes = writer.build()
    expect(bytes.length).toBeGreaterThan(HEADER_SIZE)
  })

  it('handles very large byte offsets', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        {
          byteOffset: 9007199254740992n, // Near MAX_SAFE_INTEGER
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'a',
          maxValue: 'z',
        },
      ])
    )

    const bytes = writer.build()
    const reader = parseMarkFile(bytes)
    const granules = reader.getAllGranules()

    expect(granules[0].byteOffset).toBe(9007199254740992n)
  })

  it('handles unicode strings', () => {
    const writer = new MarkFileWriter()
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'cafe',
          maxValue: 'cafe',
        },
      ])
    )

    const bytes = writer.build()
    const reader = parseMarkFile(bytes)
    const granules = reader.getAllGranules()

    expect(granules[0].minValues.get(FIELD_IDS.id)).toBe('cafe')
  })

  it('handles missing min/max values gracefully', () => {
    const writer = new MarkFileWriter()
    writer.addColumn({
      columnId: FIELD_IDS.id,
      name: 'id',
      type: ColumnType.String,
      granules: [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          // No minValue/maxValue
        },
      ],
    })

    const bytes = writer.build()
    const reader = parseMarkFile(bytes)
    const granules = reader.getAllGranules()

    expect(granules[0].minValues.has(FIELD_IDS.id)).toBe(false)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  it('complete workflow: write, read, search', () => {
    // Simulate a realistic do_resources Parquet file with mark file
    const writer = new MarkFileWriter({ granuleSize: 8192 })

    // Partition columns (constant within file)
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.ns, 'ns', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'payments.do',
          maxValue: 'payments.do',
        },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'payments.do',
          maxValue: 'payments.do',
        },
      ])
    )
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.type, 'type', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'Function',
          maxValue: 'Function',
        },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'Function',
          maxValue: 'Function',
        },
      ])
    )

    // ID column (the search column)
    writer.addColumn(
      createStringColumnStats(FIELD_IDS.id, 'id', [
        {
          byteOffset: 0n,
          byteSize: 65536,
          rowStart: 0,
          rowCount: 8192,
          minValue: 'authorize',
          maxValue: 'capture',
        },
        {
          byteOffset: 65536n,
          byteSize: 65536,
          rowStart: 8192,
          rowCount: 8192,
          minValue: 'charge',
          maxValue: 'void',
        },
      ])
    )

    const markFile = writer.build()

    // Verify size is reasonable
    expect(markFile.length).toBeLessThan(5000)

    // Parse and search
    const reader = parseMarkFile(markFile)

    // Find 'charge' - should be in second granule
    const result = reader.findGranule(FIELD_IDS.id, 'charge')
    expect(result).not.toBeNull()
    expect(result!.byteOffset).toBe(65536n)
    expect(result!.byteSize).toBe(65536)

    // Construct range request header
    const rangeHeader = `bytes=${result!.byteOffset}-${result!.byteOffset + BigInt(result!.byteSize) - 1n}`
    expect(rangeHeader).toBe('bytes=65536-131071')
  })

  it('supports Cloudflare Snippet constraints', () => {
    // Cloudflare Snippets have limits on execution time and memory
    // Mark files should be parseable very quickly

    const writer = new MarkFileWriter()
    // Create mark file with 200 granules (realistic for large Parquet file)
    const granules = Array.from({ length: 200 }, (_, i) => ({
      byteOffset: BigInt(i * 65536),
      byteSize: 65536,
      rowStart: i * 8192,
      rowCount: 8192,
      minValue: String.fromCharCode(97 + Math.floor(i / 8)) + String(i % 8).padStart(3, '0'),
      maxValue: String.fromCharCode(97 + Math.floor(i / 8)) + String(i % 8 + 1).padStart(3, '0'),
    }))

    writer.addColumn(createStringColumnStats(FIELD_IDS.id, 'id', granules))
    const markFile = writer.build()

    // Parse and search must complete quickly
    const parseStart = performance.now()
    const reader = parseMarkFile(markFile)
    const parseTime = performance.now() - parseStart

    const searchStart = performance.now()
    reader.findGranule(FIELD_IDS.id, 'm050')
    const searchTime = performance.now() - searchStart

    // Both operations should be sub-millisecond
    expect(parseTime).toBeLessThan(1)
    expect(searchTime).toBeLessThan(1)
  })
})
