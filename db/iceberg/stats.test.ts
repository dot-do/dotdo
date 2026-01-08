import { describe, it, expect } from 'vitest'

/**
 * Iceberg Column Statistics Tests
 *
 * These tests verify column statistics extraction and range-based filtering
 * for efficient file pruning in Iceberg tables. Column statistics enable
 * point lookups (50-150ms) instead of full scans (500ms-2s).
 *
 * This is RED phase TDD - tests should FAIL until the stats implementation
 * is complete in db/iceberg/stats.ts.
 *
 * Key Iceberg concepts tested:
 * - lower_bound/upper_bound: Min/max values per column (binary encoded)
 * - null_count/value_count: Column statistics for filtering
 * - File pruning: Skip files that definitely don't contain target value
 *
 * @see https://iceberg.apache.org/spec/#manifests
 * @see db/iceberg/README.md
 */

import {
  extractColumnStats,
  extractAllColumnStats,
  encodeValue,
  decodeValue,
  isInRange,
  compareBinary,
  filterByIdRange,
  selectFilesForValue,
  findFileForId,
  hasStatistics,
  getNullCount,
  hasNonNullValues,
  type ColumnStats,
  type ManifestEntry,
  type FileSelectionOptions,
  type FileSelectionResult,
} from './stats'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a mock manifest entry with column statistics
 */
function createManifestEntry(overrides: Partial<ManifestEntry['dataFile']> & { filePath: string }): ManifestEntry {
  return {
    status: 0, // existing
    snapshotId: BigInt(1234567890),
    sequenceNumber: BigInt(1),
    dataFile: {
      filePath: overrides.filePath,
      fileFormat: overrides.fileFormat ?? 'PARQUET',
      recordCount: overrides.recordCount ?? BigInt(1000),
      fileSizeBytes: overrides.fileSizeBytes ?? BigInt(1024 * 1024),
      columnSizes: overrides.columnSizes ?? null,
      valueCounts: overrides.valueCounts ?? null,
      nullValueCounts: overrides.nullValueCounts ?? null,
      nanValueCounts: overrides.nanValueCounts ?? null,
      lowerBounds: overrides.lowerBounds ?? null,
      upperBounds: overrides.upperBounds ?? null,
      partition: overrides.partition ?? {},
    },
  }
}

/**
 * Create a string-encoded lower/upper bound
 * Iceberg encodes strings as UTF-8 bytes
 */
function stringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/**
 * Create a 32-bit integer encoded as bytes (little-endian)
 */
function intToBytes(n: number): Uint8Array {
  const buffer = new ArrayBuffer(4)
  new DataView(buffer).setInt32(0, n, true) // little-endian
  return new Uint8Array(buffer)
}

/**
 * Create a 64-bit long encoded as bytes (little-endian)
 */
function longToBytes(n: bigint): Uint8Array {
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setBigInt64(0, n, true) // little-endian
  return new Uint8Array(buffer)
}

// Field IDs matching the do_resources schema from README
const FIELD_IDS = {
  ns: 1,
  type: 2,
  id: 3,
  ts: 4,
  mdx: 5,
  data: 6,
  esm: 7,
  dts: 8,
}

// ============================================================================
// Column Stats Extraction Tests
// ============================================================================

describe('Column Stats Extraction', () => {
  describe('extractColumnStats', () => {
    it('extracts stats for a specific field from manifest entry', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data/file-001.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('apple')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('banana')]]),
        nullValueCounts: new Map([[FIELD_IDS.id, BigInt(0)]]),
        valueCounts: new Map([[FIELD_IDS.id, BigInt(500)]]),
      })

      const stats = extractColumnStats(entry, FIELD_IDS.id)

      expect(stats).not.toBeNull()
      expect(stats!.fieldId).toBe(FIELD_IDS.id)
      expect(stats!.lowerBound).toEqual(stringToBytes('apple'))
      expect(stats!.upperBound).toEqual(stringToBytes('banana'))
      expect(stats!.nullCount).toBe(BigInt(0))
      expect(stats!.valueCount).toBe(BigInt(500))
    })

    it('returns null for field with no statistics', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data/file-002.parquet',
        // No column statistics
      })

      const stats = extractColumnStats(entry, FIELD_IDS.id)

      expect(stats).toBeNull()
    })

    it('handles partial statistics (only bounds, no counts)', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data/file-003.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('cat')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('dog')]]),
        // No null/value counts
      })

      const stats = extractColumnStats(entry, FIELD_IDS.id)

      expect(stats).not.toBeNull()
      expect(stats!.lowerBound).toEqual(stringToBytes('cat'))
      expect(stats!.upperBound).toEqual(stringToBytes('dog'))
      expect(stats!.nullCount).toBeNull()
      expect(stats!.valueCount).toBeNull()
    })

    it('handles field ID that exists in nullValueCounts but not in bounds', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data/file-004.parquet',
        nullValueCounts: new Map([[FIELD_IDS.mdx, BigInt(100)]]),
        // No bounds for mdx
      })

      const stats = extractColumnStats(entry, FIELD_IDS.mdx)

      expect(stats).not.toBeNull()
      expect(stats!.nullCount).toBe(BigInt(100))
      expect(stats!.lowerBound).toBeNull()
      expect(stats!.upperBound).toBeNull()
    })
  })

  describe('extractAllColumnStats', () => {
    it('extracts stats for all columns with statistics', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data/file-005.parquet',
        lowerBounds: new Map([
          [FIELD_IDS.ns, stringToBytes('payments.do')],
          [FIELD_IDS.type, stringToBytes('Function')],
          [FIELD_IDS.id, stringToBytes('charge')],
        ]),
        upperBounds: new Map([
          [FIELD_IDS.ns, stringToBytes('payments.do')],
          [FIELD_IDS.type, stringToBytes('Function')],
          [FIELD_IDS.id, stringToBytes('refund')],
        ]),
        valueCounts: new Map([
          [FIELD_IDS.ns, BigInt(100)],
          [FIELD_IDS.type, BigInt(100)],
          [FIELD_IDS.id, BigInt(100)],
        ]),
      })

      const allStats = extractAllColumnStats(entry)

      expect(allStats.size).toBe(3)
      expect(allStats.has(FIELD_IDS.ns)).toBe(true)
      expect(allStats.has(FIELD_IDS.type)).toBe(true)
      expect(allStats.has(FIELD_IDS.id)).toBe(true)

      const idStats = allStats.get(FIELD_IDS.id)!
      expect(idStats.lowerBound).toEqual(stringToBytes('charge'))
      expect(idStats.upperBound).toEqual(stringToBytes('refund'))
    })

    it('returns empty map when no statistics available', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data/file-006.parquet',
      })

      const allStats = extractAllColumnStats(entry)

      expect(allStats.size).toBe(0)
    })
  })
})

// ============================================================================
// Value Encoding/Decoding Tests
// ============================================================================

describe('Value Encoding/Decoding', () => {
  describe('encodeValue', () => {
    it('encodes string values as UTF-8', () => {
      const encoded = encodeValue('hello', 'string')

      expect(encoded).toEqual(stringToBytes('hello'))
    })

    it('encodes string with unicode characters', () => {
      const encoded = encodeValue('caf\u00e9', 'string')

      expect(encoded).toEqual(new TextEncoder().encode('caf\u00e9'))
    })

    it('encodes int values as 4-byte little-endian', () => {
      const encoded = encodeValue(42, 'int')

      expect(encoded).toEqual(intToBytes(42))
    })

    it('encodes negative int values', () => {
      const encoded = encodeValue(-1, 'int')

      expect(encoded).toEqual(intToBytes(-1))
    })

    it('encodes long values as 8-byte little-endian', () => {
      const encoded = encodeValue(BigInt(9007199254740993), 'long')

      expect(encoded).toEqual(longToBytes(BigInt(9007199254740993)))
    })

    it('encodes boolean true as single byte 1', () => {
      const encoded = encodeValue(true, 'boolean')

      expect(encoded).toEqual(new Uint8Array([1]))
    })

    it('encodes boolean false as single byte 0', () => {
      const encoded = encodeValue(false, 'boolean')

      expect(encoded).toEqual(new Uint8Array([0]))
    })
  })

  describe('decodeValue', () => {
    it('decodes UTF-8 bytes to string', () => {
      const decoded = decodeValue(stringToBytes('world'), 'string')

      expect(decoded).toBe('world')
    })

    it('decodes 4-byte little-endian to int', () => {
      const decoded = decodeValue(intToBytes(12345), 'int')

      expect(decoded).toBe(12345)
    })

    it('decodes 8-byte little-endian to long', () => {
      const decoded = decodeValue(longToBytes(BigInt(9007199254740993)), 'long')

      expect(decoded).toBe(BigInt(9007199254740993))
    })

    it('decodes single byte 1 to boolean true', () => {
      const decoded = decodeValue(new Uint8Array([1]), 'boolean')

      expect(decoded).toBe(true)
    })

    it('decodes single byte 0 to boolean false', () => {
      const decoded = decodeValue(new Uint8Array([0]), 'boolean')

      expect(decoded).toBe(false)
    })

    it('roundtrips string encoding', () => {
      const original = 'test-value-123'
      const encoded = encodeValue(original, 'string')
      const decoded = decodeValue(encoded, 'string')

      expect(decoded).toBe(original)
    })

    it('roundtrips int encoding', () => {
      const original = 2147483647 // max 32-bit signed
      const encoded = encodeValue(original, 'int')
      const decoded = decodeValue(encoded, 'int')

      expect(decoded).toBe(original)
    })

    it('roundtrips long encoding', () => {
      const original = BigInt('9223372036854775807') // max 64-bit signed
      const encoded = encodeValue(original, 'long')
      const decoded = decodeValue(encoded, 'long')

      expect(decoded).toBe(original)
    })
  })
})

// ============================================================================
// Range Filtering Tests
// ============================================================================

describe('Range Filtering', () => {
  describe('compareBinary', () => {
    it('returns 0 for equal byte arrays', () => {
      const a = stringToBytes('test')
      const b = stringToBytes('test')

      expect(compareBinary(a, b)).toBe(0)
    })

    it('returns -1 when first is less than second (lexicographic)', () => {
      const a = stringToBytes('apple')
      const b = stringToBytes('banana')

      expect(compareBinary(a, b)).toBe(-1)
    })

    it('returns 1 when first is greater than second', () => {
      const a = stringToBytes('zebra')
      const b = stringToBytes('apple')

      expect(compareBinary(a, b)).toBe(1)
    })

    it('handles different length arrays correctly', () => {
      const a = stringToBytes('app')
      const b = stringToBytes('apple')

      expect(compareBinary(a, b)).toBe(-1) // 'app' < 'apple'
    })

    it('compares numeric bytes correctly', () => {
      const a = intToBytes(100)
      const b = intToBytes(200)

      expect(compareBinary(a, b)).toBe(-1)
    })
  })

  describe('isInRange', () => {
    it('returns true when value is within bounds', () => {
      const value = stringToBytes('banana')
      const lower = stringToBytes('apple')
      const upper = stringToBytes('cherry')

      expect(isInRange(value, lower, upper)).toBe(true)
    })

    it('returns true when value equals lower bound', () => {
      const value = stringToBytes('apple')
      const lower = stringToBytes('apple')
      const upper = stringToBytes('cherry')

      expect(isInRange(value, lower, upper)).toBe(true)
    })

    it('returns true when value equals upper bound', () => {
      const value = stringToBytes('cherry')
      const lower = stringToBytes('apple')
      const upper = stringToBytes('cherry')

      expect(isInRange(value, lower, upper)).toBe(true)
    })

    it('returns false when value is below lower bound', () => {
      const value = stringToBytes('aardvark')
      const lower = stringToBytes('apple')
      const upper = stringToBytes('cherry')

      expect(isInRange(value, lower, upper)).toBe(false)
    })

    it('returns false when value is above upper bound', () => {
      const value = stringToBytes('zebra')
      const lower = stringToBytes('apple')
      const upper = stringToBytes('cherry')

      expect(isInRange(value, lower, upper)).toBe(false)
    })

    it('returns true when lower bound is null (unbounded below)', () => {
      const value = stringToBytes('anything')
      const upper = stringToBytes('cherry')

      expect(isInRange(value, null, upper)).toBe(true)
    })

    it('returns true when upper bound is null (unbounded above)', () => {
      const value = stringToBytes('anything')
      const lower = stringToBytes('apple')

      expect(isInRange(value, lower, null)).toBe(true)
    })

    it('returns true when both bounds are null', () => {
      const value = stringToBytes('anything')

      expect(isInRange(value, null, null)).toBe(true)
    })

    it('handles numeric range correctly', () => {
      const value = intToBytes(50)
      const lower = intToBytes(10)
      const upper = intToBytes(100)

      expect(isInRange(value, lower, upper)).toBe(true)
    })
  })

  describe('filterByIdRange', () => {
    const entries: ManifestEntry[] = [
      createManifestEntry({
        filePath: 's3://bucket/data/file-a.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('aaa')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('ccc')]]),
      }),
      createManifestEntry({
        filePath: 's3://bucket/data/file-b.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('ddd')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('fff')]]),
      }),
      createManifestEntry({
        filePath: 's3://bucket/data/file-c.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('ggg')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('iii')]]),
      }),
    ]

    it('returns entries where id falls within bounds', () => {
      const result = filterByIdRange(entries, FIELD_IDS.id, 'bbb')

      expect(result).toHaveLength(1)
      expect(result[0].dataFile.filePath).toBe('s3://bucket/data/file-a.parquet')
    })

    it('returns empty array when id is outside all ranges', () => {
      const result = filterByIdRange(entries, FIELD_IDS.id, 'zzz')

      expect(result).toHaveLength(0)
    })

    it('handles id at exact boundary', () => {
      const result = filterByIdRange(entries, FIELD_IDS.id, 'ddd')

      expect(result).toHaveLength(1)
      expect(result[0].dataFile.filePath).toBe('s3://bucket/data/file-b.parquet')
    })

    it('returns multiple entries when ranges overlap target', () => {
      // Create overlapping ranges
      const overlappingEntries: ManifestEntry[] = [
        createManifestEntry({
          filePath: 's3://bucket/data/overlap-1.parquet',
          lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('aaa')]]),
          upperBounds: new Map([[FIELD_IDS.id, stringToBytes('mmm')]]),
        }),
        createManifestEntry({
          filePath: 's3://bucket/data/overlap-2.parquet',
          lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('jjj')]]),
          upperBounds: new Map([[FIELD_IDS.id, stringToBytes('zzz')]]),
        }),
      ]

      const result = filterByIdRange(overlappingEntries, FIELD_IDS.id, 'kkk')

      expect(result).toHaveLength(2)
    })

    it('includes entries with no statistics (conservative approach)', () => {
      const mixedEntries: ManifestEntry[] = [
        ...entries,
        createManifestEntry({
          filePath: 's3://bucket/data/no-stats.parquet',
          // No bounds - must be included as it might contain any value
        }),
      ]

      const result = filterByIdRange(mixedEntries, FIELD_IDS.id, 'xyz')

      // Should include the file with no stats
      expect(result.some((e) => e.dataFile.filePath === 's3://bucket/data/no-stats.parquet')).toBe(true)
    })
  })
})

// ============================================================================
// File Selection Tests
// ============================================================================

describe('File Selection', () => {
  describe('selectFilesForValue', () => {
    const entries: ManifestEntry[] = [
      createManifestEntry({
        filePath: 's3://bucket/ns=payments.do/type=Function/data-001.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('authorize')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('capture')]]),
        valueCounts: new Map([[FIELD_IDS.id, BigInt(50)]]),
      }),
      createManifestEntry({
        filePath: 's3://bucket/ns=payments.do/type=Function/data-002.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('charge')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('refund')]]),
        valueCounts: new Map([[FIELD_IDS.id, BigInt(75)]]),
      }),
      createManifestEntry({
        filePath: 's3://bucket/ns=payments.do/type=Function/data-003.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('subscribe')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('void')]]),
        valueCounts: new Map([[FIELD_IDS.id, BigInt(25)]]),
      }),
    ]

    it('selects files that may contain the target value', () => {
      const options: FileSelectionOptions = {
        fieldId: FIELD_IDS.id,
        value: 'charge',
        columnType: 'string',
      }

      const result = selectFilesForValue(entries, options)

      expect(result).toHaveLength(1)
      expect(result[0].filePath).toBe('s3://bucket/ns=payments.do/type=Function/data-002.parquet')
    })

    it('returns empty array when no files match', () => {
      const options: FileSelectionOptions = {
        fieldId: FIELD_IDS.id,
        value: 'nonexistent',
        columnType: 'string',
      }

      const result = selectFilesForValue(entries, options)

      expect(result).toHaveLength(0)
    })

    it('includes decoded bounds in result', () => {
      const options: FileSelectionOptions = {
        fieldId: FIELD_IDS.id,
        value: 'payment',
        columnType: 'string',
      }

      const result = selectFilesForValue(entries, options)

      expect(result).toHaveLength(1)
      expect(result[0].lowerBound).toBe('charge')
      expect(result[0].upperBound).toBe('refund')
    })

    it('marks result as definite when value equals both bounds', () => {
      // Single-value file where lower == upper == target
      const singleValueEntry = createManifestEntry({
        filePath: 's3://bucket/single.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('exact')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('exact')]]),
      })

      const options: FileSelectionOptions = {
        fieldId: FIELD_IDS.id,
        value: 'exact',
        columnType: 'string',
      }

      const result = selectFilesForValue([singleValueEntry], options)

      expect(result).toHaveLength(1)
      expect(result[0].definite).toBe(true)
    })

    it('marks result as not definite for range match', () => {
      const options: FileSelectionOptions = {
        fieldId: FIELD_IDS.id,
        value: 'charge',
        columnType: 'string',
      }

      const result = selectFilesForValue(entries, options)

      expect(result[0].definite).toBe(false) // 'charge' is in range but not guaranteed
    })

    it('handles integer column type', () => {
      const intEntries: ManifestEntry[] = [
        createManifestEntry({
          filePath: 's3://bucket/int-data.parquet',
          lowerBounds: new Map([[100, intToBytes(1)]]),
          upperBounds: new Map([[100, intToBytes(1000)]]),
        }),
      ]

      const options: FileSelectionOptions = {
        fieldId: 100,
        value: 500,
        columnType: 'int',
      }

      const result = selectFilesForValue(intEntries, options)

      expect(result).toHaveLength(1)
    })
  })

  describe('findFileForId', () => {
    const entries: ManifestEntry[] = [
      createManifestEntry({
        filePath: 's3://bucket/data/part-001.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('aaa')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('mmm')]]),
        recordCount: BigInt(1000),
      }),
      createManifestEntry({
        filePath: 's3://bucket/data/part-002.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('nnn')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('zzz')]]),
        recordCount: BigInt(500),
      }),
    ]

    it('finds the single file containing the id', () => {
      const result = findFileForId(entries, FIELD_IDS.id, 'charge')

      expect(result).not.toBeNull()
      expect(result!.filePath).toBe('s3://bucket/data/part-001.parquet')
    })

    it('returns null when no file contains the id', () => {
      const result = findFileForId(entries, FIELD_IDS.id, '000')

      expect(result).toBeNull()
    })

    it('returns first matching file when multiple match', () => {
      // Overlapping ranges
      const overlappingEntries: ManifestEntry[] = [
        createManifestEntry({
          filePath: 's3://bucket/data/overlap-a.parquet',
          lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('aaa')]]),
          upperBounds: new Map([[FIELD_IDS.id, stringToBytes('mmm')]]),
        }),
        createManifestEntry({
          filePath: 's3://bucket/data/overlap-b.parquet',
          lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('jjj')]]),
          upperBounds: new Map([[FIELD_IDS.id, stringToBytes('zzz')]]),
        }),
      ]

      const result = findFileForId(overlappingEntries, FIELD_IDS.id, 'kkk')

      // Should return first match
      expect(result).not.toBeNull()
      expect(result!.filePath).toBe('s3://bucket/data/overlap-a.parquet')
    })

    it('prefers file with smaller range when multiple match', () => {
      // Two files match but one has a tighter range
      const preciseEntries: ManifestEntry[] = [
        createManifestEntry({
          filePath: 's3://bucket/data/wide.parquet',
          lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('aaa')]]),
          upperBounds: new Map([[FIELD_IDS.id, stringToBytes('zzz')]]),
        }),
        createManifestEntry({
          filePath: 's3://bucket/data/narrow.parquet',
          lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('pay')]]),
          upperBounds: new Map([[FIELD_IDS.id, stringToBytes('paz')]]),
        }),
      ]

      const result = findFileForId(preciseEntries, FIELD_IDS.id, 'payment')

      // Should prefer the narrower range
      expect(result).not.toBeNull()
      expect(result!.filePath).toBe('s3://bucket/data/narrow.parquet')
    })

    it('handles do_resources lookup scenario from README', () => {
      // Simulate the README example: lookup 'charge' in payments.do Function partition
      const doResourcesEntries: ManifestEntry[] = [
        createManifestEntry({
          filePath: 's3://data-catalog/do_resources/ns=payments.do/type=Function/data-00001.parquet',
          lowerBounds: new Map([
            [FIELD_IDS.ns, stringToBytes('payments.do')],
            [FIELD_IDS.type, stringToBytes('Function')],
            [FIELD_IDS.id, stringToBytes('authorize')],
          ]),
          upperBounds: new Map([
            [FIELD_IDS.ns, stringToBytes('payments.do')],
            [FIELD_IDS.type, stringToBytes('Function')],
            [FIELD_IDS.id, stringToBytes('void')],
          ]),
          partition: { ns: 'payments.do', type: 'Function' },
        }),
      ]

      const result = findFileForId(doResourcesEntries, FIELD_IDS.id, 'charge')

      expect(result).not.toBeNull()
      expect(result!.filePath).toContain('payments.do')
      expect(result!.filePath).toContain('Function')
    })
  })
})

// ============================================================================
// Statistics Helpers Tests
// ============================================================================

describe('Statistics Helpers', () => {
  describe('hasStatistics', () => {
    it('returns true when entry has lower/upper bounds', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/with-stats.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('a')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('z')]]),
      })

      expect(hasStatistics(entry)).toBe(true)
    })

    it('returns true when entry has only null counts', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/null-stats.parquet',
        nullValueCounts: new Map([[FIELD_IDS.id, BigInt(10)]]),
      })

      expect(hasStatistics(entry)).toBe(true)
    })

    it('returns false when entry has no statistics', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/no-stats.parquet',
      })

      expect(hasStatistics(entry)).toBe(false)
    })

    it('returns true when entry has only value counts', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/value-counts.parquet',
        valueCounts: new Map([[FIELD_IDS.id, BigInt(100)]]),
      })

      expect(hasStatistics(entry)).toBe(true)
    })
  })

  describe('getNullCount', () => {
    it('returns null count for specified field', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data.parquet',
        nullValueCounts: new Map([
          [FIELD_IDS.id, BigInt(0)],
          [FIELD_IDS.mdx, BigInt(50)],
        ]),
      })

      expect(getNullCount(entry, FIELD_IDS.id)).toBe(BigInt(0))
      expect(getNullCount(entry, FIELD_IDS.mdx)).toBe(BigInt(50))
    })

    it('returns null when field has no null count', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data.parquet',
        nullValueCounts: new Map([[FIELD_IDS.id, BigInt(0)]]),
      })

      expect(getNullCount(entry, FIELD_IDS.esm)).toBeNull()
    })

    it('returns null when entry has no null value counts', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data.parquet',
      })

      expect(getNullCount(entry, FIELD_IDS.id)).toBeNull()
    })
  })

  describe('hasNonNullValues', () => {
    it('returns true when value count exceeds null count', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data.parquet',
        valueCounts: new Map([[FIELD_IDS.id, BigInt(100)]]),
        nullValueCounts: new Map([[FIELD_IDS.id, BigInt(10)]]),
      })

      expect(hasNonNullValues(entry, FIELD_IDS.id)).toBe(true)
    })

    it('returns false when all values are null', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data.parquet',
        valueCounts: new Map([[FIELD_IDS.id, BigInt(0)]]),
        nullValueCounts: new Map([[FIELD_IDS.id, BigInt(100)]]),
      })

      expect(hasNonNullValues(entry, FIELD_IDS.id)).toBe(false)
    })

    it('returns true when null count is zero', () => {
      const entry = createManifestEntry({
        filePath: 's3://bucket/data.parquet',
        valueCounts: new Map([[FIELD_IDS.id, BigInt(100)]]),
        nullValueCounts: new Map([[FIELD_IDS.id, BigInt(0)]]),
      })

      expect(hasNonNullValues(entry, FIELD_IDS.id)).toBe(true)
    })

    it('returns true when stats are missing (conservative)', () => {
      // When we can't determine, assume there might be non-null values
      const entry = createManifestEntry({
        filePath: 's3://bucket/data.parquet',
      })

      expect(hasNonNullValues(entry, FIELD_IDS.id)).toBe(true)
    })

    it('returns true when only bounds are available', () => {
      // If bounds exist, the column has non-null values
      const entry = createManifestEntry({
        filePath: 's3://bucket/data.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('a')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('z')]]),
      })

      expect(hasNonNullValues(entry, FIELD_IDS.id)).toBe(true)
    })
  })
})

// ============================================================================
// Edge Cases and Error Handling Tests
// ============================================================================

describe('Edge Cases', () => {
  it('handles empty entries array', () => {
    const result = filterByIdRange([], FIELD_IDS.id, 'anything')

    expect(result).toHaveLength(0)
  })

  it('handles entries with deleted status', () => {
    const entries: ManifestEntry[] = [
      {
        ...createManifestEntry({
          filePath: 's3://bucket/deleted.parquet',
          lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('aaa')]]),
          upperBounds: new Map([[FIELD_IDS.id, stringToBytes('zzz')]]),
        }),
        status: 2, // deleted
      },
    ]

    const result = filterByIdRange(entries, FIELD_IDS.id, 'test')

    // Deleted entries should be excluded
    expect(result).toHaveLength(0)
  })

  it('handles empty string id lookup', () => {
    const entries: ManifestEntry[] = [
      createManifestEntry({
        filePath: 's3://bucket/data.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('zzz')]]),
      }),
    ]

    const result = filterByIdRange(entries, FIELD_IDS.id, '')

    expect(result).toHaveLength(1)
  })

  it('handles very long id values', () => {
    const longId = 'a'.repeat(10000)
    const entries: ManifestEntry[] = [
      createManifestEntry({
        filePath: 's3://bucket/data.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('a')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('z'.repeat(10001))]]),
      }),
    ]

    const result = filterByIdRange(entries, FIELD_IDS.id, longId)

    expect(result).toHaveLength(1)
  })

  it('handles special characters in id', () => {
    const specialId = 'user/path:with@special#chars'
    const entries: ManifestEntry[] = [
      createManifestEntry({
        filePath: 's3://bucket/data.parquet',
        lowerBounds: new Map([[FIELD_IDS.id, stringToBytes('user/')]]),
        upperBounds: new Map([[FIELD_IDS.id, stringToBytes('user/z')]]),
      }),
    ]

    const result = filterByIdRange(entries, FIELD_IDS.id, specialId)

    expect(result).toHaveLength(1)
  })
})

// ============================================================================
// Performance Considerations Tests
// ============================================================================

describe('Performance Considerations', () => {
  it('can handle large number of manifest entries efficiently', () => {
    // Create 1000 entries with non-overlapping ranges
    const entries: ManifestEntry[] = []
    for (let i = 0; i < 1000; i++) {
      const prefix = String(i).padStart(4, '0')
      entries.push(
        createManifestEntry({
          filePath: `s3://bucket/data/part-${prefix}.parquet`,
          lowerBounds: new Map([[FIELD_IDS.id, stringToBytes(`${prefix}-aaa`)]]),
          upperBounds: new Map([[FIELD_IDS.id, stringToBytes(`${prefix}-zzz`)]]),
        })
      )
    }

    const start = performance.now()
    const result = filterByIdRange(entries, FIELD_IDS.id, '0500-mmm')
    const elapsed = performance.now() - start

    expect(result).toHaveLength(1)
    expect(elapsed).toBeLessThan(100) // Should complete in < 100ms
  })

  it('binary comparison is efficient for large strings', () => {
    const largeA = stringToBytes('a'.repeat(10000))
    const largeB = stringToBytes('b'.repeat(10000))

    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      compareBinary(largeA, largeB)
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(100) // 10k comparisons in < 100ms
  })
})
