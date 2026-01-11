import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * SearchSnippet - Range Pruning Tests (RED Phase)
 *
 * Tests for Cloudflare Snippet-based range query pruning using ClickHouse-style
 * zonemap/marks files. The search snippet fetches marks files from CDN to determine
 * which blocks need to be read for a given range query.
 *
 * Memory Budget (from analysis):
 * - 65,536 blocks per 1MB marks file
 * - 16 bytes per block entry (int64 min + int64 max)
 *
 * These tests are expected to FAIL until the search snippet is implemented.
 *
 * @module snippets/tests/search-range.test
 * @see db/iceberg/marks.ts for the marks file format
 */

import {
  queryRange,
  parseMarksFile,
  pruneBlocks,
  type RangeCondition,
  type BlockRange,
  type MarksMetadata,
} from '../search'

// ============================================================================
// Test Constants
// ============================================================================

/** Bytes per block entry: int64 min (8) + int64 max (8) */
const BYTES_PER_BLOCK = 16

/** Default block size in rows */
const DEFAULT_BLOCK_SIZE = 8192

// ============================================================================
// Test Fixtures - Binary Marks File Helpers
// ============================================================================

/**
 * Create a binary marks file with int64 min/max pairs.
 * Format: [min0, max0, min1, max1, ...] where each value is 8 bytes little-endian.
 */
function createInt64MarksFile(blocks: Array<{ min: bigint; max: bigint }>): Uint8Array {
  const buffer = new ArrayBuffer(blocks.length * BYTES_PER_BLOCK)
  const view = new DataView(buffer)

  blocks.forEach((block, i) => {
    const offset = i * BYTES_PER_BLOCK
    view.setBigInt64(offset, block.min, true) // little-endian
    view.setBigInt64(offset + 8, block.max, true)
  })

  return new Uint8Array(buffer)
}

/**
 * Create a binary marks file with float64 min/max pairs.
 */
function createFloat64MarksFile(blocks: Array<{ min: number; max: number }>): Uint8Array {
  const buffer = new ArrayBuffer(blocks.length * BYTES_PER_BLOCK)
  const view = new DataView(buffer)

  blocks.forEach((block, i) => {
    const offset = i * BYTES_PER_BLOCK
    view.setFloat64(offset, block.min, true)
    view.setFloat64(offset + 8, block.max, true)
  })

  return new Uint8Array(buffer)
}

/**
 * Create a binary marks file with timestamp (epoch ms) min/max pairs.
 */
function createTimestampMarksFile(blocks: Array<{ min: Date; max: Date }>): Uint8Array {
  return createInt64MarksFile(
    blocks.map((b) => ({
      min: BigInt(b.min.getTime()),
      max: BigInt(b.max.getTime()),
    }))
  )
}

/**
 * Mock CDN fetch for marks files.
 */
function mockCdnFetch(marksData: Uint8Array): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(marksData.buffer),
    headers: new Headers({
      'content-type': 'application/octet-stream',
      'content-length': String(marksData.byteLength),
    }),
  })
}

// ============================================================================
// CDN Fetch Tests
// ============================================================================

describe('SearchSnippet - Marks File Fetching', () => {
  it('fetches marks file from CDN', async () => {
    const marksData = createInt64MarksFile([
      { min: 0n, max: 100n },
      { min: 101n, max: 200n },
    ])

    const mockFetch = mockCdnFetch(marksData)
    globalThis.fetch = mockFetch

    const cdnUrl = 'https://cdn.example.com.ai/marks/table-001.marks'
    const metadata: MarksMetadata = {
      columnType: 'int64',
      blockCount: 2,
      blockSize: DEFAULT_BLOCK_SIZE,
    }

    const result = await queryRange(cdnUrl, metadata, { min: 50n, max: 150n })

    expect(mockFetch).toHaveBeenCalledWith(cdnUrl, expect.any(Object))
    expect(result).toBeDefined()
  })

  it('handles CDN fetch failure gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })
    globalThis.fetch = mockFetch

    const cdnUrl = 'https://cdn.example.com.ai/marks/nonexistent.marks'
    const metadata: MarksMetadata = {
      columnType: 'int64',
      blockCount: 10,
      blockSize: DEFAULT_BLOCK_SIZE,
    }

    await expect(queryRange(cdnUrl, metadata, { min: 0n, max: 100n })).rejects.toThrow(/fetch|404|not found/i)
  })

  it('handles CDN network timeout', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'))
    globalThis.fetch = mockFetch

    const cdnUrl = 'https://cdn.example.com.ai/marks/table-001.marks'
    const metadata: MarksMetadata = {
      columnType: 'int64',
      blockCount: 10,
      blockSize: DEFAULT_BLOCK_SIZE,
    }

    await expect(queryRange(cdnUrl, metadata, { min: 0n, max: 100n })).rejects.toThrow(/timeout|network/i)
  })

  it('uses cache headers for marks file caching', async () => {
    const marksData = createInt64MarksFile([{ min: 0n, max: 100n }])
    const mockFetch = mockCdnFetch(marksData)
    globalThis.fetch = mockFetch

    const cdnUrl = 'https://cdn.example.com.ai/marks/table-001.marks'
    const metadata: MarksMetadata = {
      columnType: 'int64',
      blockCount: 1,
      blockSize: DEFAULT_BLOCK_SIZE,
    }

    await queryRange(cdnUrl, metadata, { min: 0n, max: 100n })

    expect(mockFetch).toHaveBeenCalledWith(
      cdnUrl,
      expect.objectContaining({
        headers: expect.any(Object),
      })
    )
  })
})

// ============================================================================
// Marks File Deserialization Tests
// ============================================================================

describe('SearchSnippet - Marks File Parsing', () => {
  it('deserializes int64 min/max per block', () => {
    const marksData = createInt64MarksFile([
      { min: 0n, max: 999n },
      { min: 1000n, max: 1999n },
      { min: 2000n, max: 2999n },
    ])

    const blocks = parseMarksFile(marksData, 'int64')

    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toEqual({ min: 0n, max: 999n, blockIndex: 0 })
    expect(blocks[1]).toEqual({ min: 1000n, max: 1999n, blockIndex: 1 })
    expect(blocks[2]).toEqual({ min: 2000n, max: 2999n, blockIndex: 2 })
  })

  it('deserializes float64 min/max per block', () => {
    const marksData = createFloat64MarksFile([
      { min: 0.0, max: 99.99 },
      { min: 100.0, max: 199.99 },
      { min: 200.0, max: 299.99 },
    ])

    const blocks = parseMarksFile(marksData, 'float64')

    expect(blocks).toHaveLength(3)
    expect(blocks[0].min).toBeCloseTo(0.0)
    expect(blocks[0].max).toBeCloseTo(99.99)
    expect(blocks[1].min).toBeCloseTo(100.0)
    expect(blocks[2].max).toBeCloseTo(299.99)
  })

  it('deserializes timestamp (epoch ms) min/max per block', () => {
    const jan1 = new Date('2026-01-01T00:00:00Z')
    const jan2 = new Date('2026-01-02T00:00:00Z')
    const jan3 = new Date('2026-01-03T00:00:00Z')

    const marksData = createTimestampMarksFile([
      { min: jan1, max: jan2 },
      { min: jan2, max: jan3 },
    ])

    const blocks = parseMarksFile(marksData, 'timestamp')

    expect(blocks).toHaveLength(2)
    expect(blocks[0].min).toBe(BigInt(jan1.getTime()))
    expect(blocks[0].max).toBe(BigInt(jan2.getTime()))
  })

  it('handles empty marks file', () => {
    const emptyData = new Uint8Array(0)

    const blocks = parseMarksFile(emptyData, 'int64')

    expect(blocks).toHaveLength(0)
  })

  it('handles marks file with single block', () => {
    const marksData = createInt64MarksFile([{ min: 100n, max: 200n }])

    const blocks = parseMarksFile(marksData, 'int64')

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ min: 100n, max: 200n, blockIndex: 0 })
  })

  it('handles large marks file efficiently', () => {
    // 65,536 blocks per 1MB (from memory budget analysis)
    const blockCount = 65536
    const blocks = Array.from({ length: blockCount }, (_, i) => ({
      min: BigInt(i * 1000),
      max: BigInt((i + 1) * 1000 - 1),
    }))

    const marksData = createInt64MarksFile(blocks)

    const start = performance.now()
    const result = parseMarksFile(marksData, 'int64')
    const elapsed = performance.now() - start

    expect(result).toHaveLength(blockCount)
    // Should parse 1MB marks file in under 50ms for Cloudflare Snippet constraints
    expect(elapsed).toBeLessThan(50)
  })

  it('validates marks file size against expected block count', () => {
    // Create marks file with 3 blocks worth of data
    const marksData = createInt64MarksFile([
      { min: 0n, max: 100n },
      { min: 101n, max: 200n },
      { min: 201n, max: 300n },
    ])

    // But tell parser to expect 5 blocks
    expect(() => parseMarksFile(marksData, 'int64', { expectedBlocks: 5 })).toThrow(/size mismatch|expected.*blocks/i)
  })
})

// ============================================================================
// Block Pruning Tests - Int64
// ============================================================================

describe('SearchSnippet - Block Pruning (Int64)', () => {
  const blocks: BlockRange[] = [
    { min: 0n, max: 999n, blockIndex: 0 },
    { min: 1000n, max: 1999n, blockIndex: 1 },
    { min: 2000n, max: 2999n, blockIndex: 2 },
    { min: 3000n, max: 3999n, blockIndex: 3 },
    { min: 4000n, max: 4999n, blockIndex: 4 },
  ]

  it('prunes blocks outside range', () => {
    const condition: RangeCondition<bigint> = { min: 1500n, max: 2500n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([1, 2])
  })

  it('includes block when query range fully contains it', () => {
    const condition: RangeCondition<bigint> = { min: 0n, max: 2500n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(3)
    expect(result.map((b) => b.blockIndex)).toEqual([0, 1, 2])
  })

  it('includes block when query range partially overlaps start', () => {
    const condition: RangeCondition<bigint> = { min: 500n, max: 1500n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([0, 1])
  })

  it('includes block when query range partially overlaps end', () => {
    const condition: RangeCondition<bigint> = { min: 1500n, max: 2500n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([1, 2])
  })

  it('includes block when query range is within block', () => {
    const condition: RangeCondition<bigint> = { min: 1200n, max: 1800n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(1)
    expect(result[0].blockIndex).toBe(1)
  })

  it('prunes all blocks when range is completely outside', () => {
    const condition: RangeCondition<bigint> = { min: 10000n, max: 20000n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(0)
  })

  it('returns all blocks when range spans everything', () => {
    const condition: RangeCondition<bigint> = { min: -1000n, max: 10000n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(5)
  })

  it('handles point query (min equals max)', () => {
    const condition: RangeCondition<bigint> = { min: 1500n, max: 1500n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(1)
    expect(result[0].blockIndex).toBe(1)
  })
})

// ============================================================================
// Block Pruning Tests - Boundary Values
// ============================================================================

describe('SearchSnippet - Boundary Value Handling', () => {
  const blocks: BlockRange[] = [
    { min: 0n, max: 100n, blockIndex: 0 },
    { min: 101n, max: 200n, blockIndex: 1 },
    { min: 201n, max: 300n, blockIndex: 2 },
  ]

  it('includes block when query min equals block max (inclusive)', () => {
    const condition: RangeCondition<bigint> = { min: 100n, max: 150n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([0, 1])
  })

  it('includes block when query max equals block min (inclusive)', () => {
    const condition: RangeCondition<bigint> = { min: 50n, max: 101n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([0, 1])
  })

  it('handles exclusive range (gt/lt operators)', () => {
    const condition: RangeCondition<bigint> = {
      min: 100n,
      max: 201n,
      minInclusive: false,
      maxInclusive: false,
    }

    const result = pruneBlocks(blocks, condition)

    // Block 0 max is 100, query min is >100, so block 0 excluded
    // Block 2 min is 201, query max is <201, so block 2 excluded
    expect(result).toHaveLength(1)
    expect(result[0].blockIndex).toBe(1)
  })

  it('handles half-open range [min, max)', () => {
    const condition: RangeCondition<bigint> = {
      min: 100n,
      max: 201n,
      minInclusive: true,
      maxInclusive: false,
    }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([0, 1])
  })

  it('handles half-open range (min, max]', () => {
    const condition: RangeCondition<bigint> = {
      min: 100n,
      max: 201n,
      minInclusive: false,
      maxInclusive: true,
    }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([1, 2])
  })

  it('handles max-only constraint (unbounded min)', () => {
    const condition: RangeCondition<bigint> = { max: 150n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([0, 1])
  })

  it('handles min-only constraint (unbounded max)', () => {
    const condition: RangeCondition<bigint> = { min: 150n }

    const result = pruneBlocks(blocks, condition)

    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([1, 2])
  })
})

// ============================================================================
// Multiple Range Conditions Tests
// ============================================================================

describe('SearchSnippet - Multiple Range Conditions', () => {
  const blocks: BlockRange[] = [
    { min: 0n, max: 100n, blockIndex: 0 },
    { min: 101n, max: 200n, blockIndex: 1 },
    { min: 201n, max: 300n, blockIndex: 2 },
    { min: 301n, max: 400n, blockIndex: 3 },
    { min: 401n, max: 500n, blockIndex: 4 },
  ]

  it('handles AND of two range conditions', () => {
    const conditions: RangeCondition<bigint>[] = [
      { min: 50n, max: 250n }, // blocks 0, 1, 2
      { min: 150n, max: 350n }, // blocks 1, 2, 3
    ]

    // Intersection should be blocks 1, 2
    const result = pruneBlocks(blocks, conditions)

    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([1, 2])
  })

  it('handles AND of non-overlapping conditions (empty result)', () => {
    const conditions: RangeCondition<bigint>[] = [
      { min: 0n, max: 100n }, // block 0
      { min: 300n, max: 400n }, // block 3
    ]

    // No blocks satisfy both conditions
    const result = pruneBlocks(blocks, conditions)

    expect(result).toHaveLength(0)
  })

  it('handles OR of two range conditions', () => {
    const conditions: RangeCondition<bigint>[] = [
      { min: 0n, max: 100n }, // block 0
      { min: 400n, max: 500n }, // blocks 3 (301-400 overlaps at 400) and 4 (401-500)
    ]

    // Union should be blocks 0, 3, 4 (400 overlaps block 3's max)
    const result = pruneBlocks(blocks, conditions, { operator: 'OR' })

    expect(result).toHaveLength(3)
    expect(result.map((b) => b.blockIndex)).toEqual([0, 3, 4])
  })

  it('handles multiple columns with AND', () => {
    // Simulate two columns: column A and column B
    const blocksWithMultipleColumns = [
      {
        blockIndex: 0,
        columns: {
          colA: { min: 0n, max: 100n },
          colB: { min: 1000n, max: 2000n },
        },
      },
      {
        blockIndex: 1,
        columns: {
          colA: { min: 101n, max: 200n },
          colB: { min: 2001n, max: 3000n },
        },
      },
      {
        blockIndex: 2,
        columns: {
          colA: { min: 201n, max: 300n },
          colB: { min: 3001n, max: 4000n },
        },
      },
    ]

    const conditions = {
      colA: { min: 50n, max: 150n }, // blocks 0, 1
      colB: { min: 2500n, max: 3500n }, // blocks 1, 2
    }

    // Intersection: block 1 only
    const result = pruneBlocks(blocksWithMultipleColumns, conditions)

    expect(result).toHaveLength(1)
    expect(result[0].blockIndex).toBe(1)
  })

  it('handles complex WHERE clause: (A > 50 AND A < 150) OR (B > 2500)', () => {
    const conditions = {
      or: [{ and: [{ column: 'A', min: 50n }, { column: 'A', max: 150n }] }, { column: 'B', min: 2500n }],
    }

    // This tests the query plan optimizer
    // Implementation should handle nested AND/OR conditions
    const blocksWithMultipleColumns = [
      {
        blockIndex: 0,
        columns: {
          A: { min: 0n, max: 100n },
          B: { min: 1000n, max: 2000n },
        },
      },
      {
        blockIndex: 1,
        columns: {
          A: { min: 101n, max: 200n },
          B: { min: 2001n, max: 3000n },
        },
      },
    ]

    const result = pruneBlocks(blocksWithMultipleColumns, conditions)

    // Block 0: A in [0,100] overlaps (50,150), B max is 2000 < 2500 -- included via A condition
    // Block 1: A in [101,200] overlaps (50,150), B min is 2001, max is 3000 > 2500 -- included via both
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Different Data Types Tests
// ============================================================================

describe('SearchSnippet - Different Data Types', () => {
  describe('Float64 range pruning', () => {
    const floatBlocks: BlockRange[] = [
      { min: 0.0, max: 99.99, blockIndex: 0 },
      { min: 100.0, max: 199.99, blockIndex: 1 },
      { min: 200.0, max: 299.99, blockIndex: 2 },
    ]

    it('prunes float64 blocks correctly', () => {
      const condition: RangeCondition<number> = { min: 50.0, max: 150.0 }

      const result = pruneBlocks(floatBlocks, condition)

      expect(result).toHaveLength(2)
      expect(result.map((b) => b.blockIndex)).toEqual([0, 1])
    })

    it('handles float64 precision edge cases', () => {
      const condition: RangeCondition<number> = { min: 99.99, max: 100.0 }

      const result = pruneBlocks(floatBlocks, condition)

      // Both blocks should be included due to boundary overlap
      expect(result).toHaveLength(2)
    })

    it('handles NaN in range condition', () => {
      const condition: RangeCondition<number> = { min: NaN, max: 100.0 }

      // NaN should be handled gracefully - either throw or skip
      expect(() => pruneBlocks(floatBlocks, condition)).toThrow(/NaN|invalid/i)
    })

    it('handles Infinity in range condition', () => {
      const condition: RangeCondition<number> = { min: -Infinity, max: 150.0 }

      const result = pruneBlocks(floatBlocks, condition)

      expect(result).toHaveLength(2)
      expect(result.map((b) => b.blockIndex)).toEqual([0, 1])
    })
  })

  describe('Date/Timestamp range pruning', () => {
    const jan1 = new Date('2026-01-01T00:00:00Z')
    const jan2 = new Date('2026-01-02T00:00:00Z')
    const jan3 = new Date('2026-01-03T00:00:00Z')
    const jan4 = new Date('2026-01-04T00:00:00Z')
    const jan5 = new Date('2026-01-05T00:00:00Z')

    const dateBlocks: BlockRange[] = [
      { min: BigInt(jan1.getTime()), max: BigInt(jan2.getTime() - 1), blockIndex: 0 },
      { min: BigInt(jan2.getTime()), max: BigInt(jan3.getTime() - 1), blockIndex: 1 },
      { min: BigInt(jan3.getTime()), max: BigInt(jan4.getTime() - 1), blockIndex: 2 },
    ]

    it('prunes date blocks correctly', () => {
      const condition: RangeCondition<bigint> = {
        min: BigInt(jan1.getTime() + 12 * 60 * 60 * 1000), // noon Jan 1
        max: BigInt(jan2.getTime() + 12 * 60 * 60 * 1000), // noon Jan 2
      }

      const result = pruneBlocks(dateBlocks, condition)

      expect(result).toHaveLength(2)
      expect(result.map((b) => b.blockIndex)).toEqual([0, 1])
    })

    it('handles date-only queries (midnight to midnight)', () => {
      const condition: RangeCondition<bigint> = {
        min: BigInt(jan2.getTime()),
        max: BigInt(jan3.getTime() - 1),
      }

      const result = pruneBlocks(dateBlocks, condition)

      expect(result).toHaveLength(1)
      expect(result[0].blockIndex).toBe(1)
    })

    it('handles timezone-aware date ranges', () => {
      // Query in PST (UTC-8) for Jan 2
      const pstJan2Start = new Date('2026-01-02T08:00:00Z') // midnight PST = 8am UTC
      const pstJan2End = new Date('2026-01-03T07:59:59Z') // 11:59pm PST = 7:59am next day UTC

      const condition: RangeCondition<bigint> = {
        min: BigInt(pstJan2Start.getTime()),
        max: BigInt(pstJan2End.getTime()),
      }

      const result = pruneBlocks(dateBlocks, condition)

      // Should include blocks for Jan 2 and Jan 3 (UTC)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('String range pruning (lexicographic)', () => {
    // Note: String marks files use different format - variable length
    // This tests the concept; implementation may differ

    it('handles lexicographic string ranges', async () => {
      const stringBlocks = [
        { min: 'aaa', max: 'fff', blockIndex: 0 },
        { min: 'ggg', max: 'mmm', blockIndex: 1 },
        { min: 'nnn', max: 'zzz', blockIndex: 2 },
      ]

      const condition: RangeCondition<string> = { min: 'ccc', max: 'jjj' }

      const result = pruneBlocks(stringBlocks, condition)

      expect(result).toHaveLength(2)
      expect(result.map((b) => b.blockIndex)).toEqual([0, 1])
    })

    it('handles case-sensitive string comparison', () => {
      const stringBlocks = [
        { min: 'AAA', max: 'ZZZ', blockIndex: 0 }, // uppercase
        { min: 'aaa', max: 'zzz', blockIndex: 1 }, // lowercase
      ]

      const condition: RangeCondition<string> = { min: 'abc', max: 'xyz' }

      const result = pruneBlocks(stringBlocks, condition)

      // Depends on locale/collation - ASCII lowercase > uppercase
      // 'abc' > 'ZZZ' in ASCII, so block 0 might be excluded
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ============================================================================
// Null Handling Tests
// ============================================================================

describe('SearchSnippet - Null Value Handling', () => {
  it('handles blocks with null min (all nulls in block)', () => {
    const blocks: BlockRange[] = [
      { min: 0n, max: 100n, blockIndex: 0 },
      { min: null, max: null, blockIndex: 1, nullCount: 8192 }, // all nulls
      { min: 200n, max: 300n, blockIndex: 2 },
    ]

    const condition: RangeCondition<bigint> = { min: 50n, max: 250n }

    const result = pruneBlocks(blocks, condition)

    // Block with all nulls should be excluded for non-null range query
    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([0, 2])
  })

  it('includes null blocks when querying for NULL explicitly', () => {
    const blocks: BlockRange[] = [
      { min: 0n, max: 100n, blockIndex: 0, nullCount: 0 },
      { min: null, max: null, blockIndex: 1, nullCount: 8192 },
      { min: 200n, max: 300n, blockIndex: 2, nullCount: 100 },
    ]

    const condition: RangeCondition<bigint> = { isNull: true }

    const result = pruneBlocks(blocks, condition)

    // Include blocks that have any nulls
    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([1, 2])
  })

  it('handles blocks with mixed nulls and values', () => {
    const blocks: BlockRange[] = [
      { min: 0n, max: 100n, blockIndex: 0, nullCount: 50 }, // has some nulls
      { min: 101n, max: 200n, blockIndex: 1, nullCount: 0 }, // no nulls
    ]

    const condition: RangeCondition<bigint> = { min: 50n, max: 150n }

    const result = pruneBlocks(blocks, condition)

    // Both blocks should be included based on min/max range
    // Null count doesn't affect range pruning for non-null queries
    expect(result).toHaveLength(2)
  })

  it('handles IS NOT NULL condition', () => {
    const blocks: BlockRange[] = [
      { min: 0n, max: 100n, blockIndex: 0, nullCount: 0 },
      { min: null, max: null, blockIndex: 1, nullCount: 8192 }, // all nulls
      { min: 200n, max: 300n, blockIndex: 2, nullCount: 100 },
    ]

    const condition: RangeCondition<bigint> = { isNull: false }

    const result = pruneBlocks(blocks, condition)

    // Include blocks that have any non-null values
    expect(result).toHaveLength(2)
    expect(result.map((b) => b.blockIndex)).toEqual([0, 2])
  })
})

// ============================================================================
// End-to-End Integration Tests
// ============================================================================

describe('SearchSnippet - End-to-End Integration', () => {
  it('full flow: fetch marks, parse, prune, return byte ranges', async () => {
    const marksData = createInt64MarksFile([
      { min: 0n, max: 999n },
      { min: 1000n, max: 1999n },
      { min: 2000n, max: 2999n },
      { min: 3000n, max: 3999n },
    ])

    const mockFetch = mockCdnFetch(marksData)
    globalThis.fetch = mockFetch

    const cdnUrl = 'https://cdn.example.com.ai/marks/users.marks'
    const metadata: MarksMetadata = {
      columnType: 'int64',
      blockCount: 4,
      blockSize: DEFAULT_BLOCK_SIZE,
      blockByteSize: 65536, // 64KB per block
    }

    const result = await queryRange(cdnUrl, metadata, { min: 1500n, max: 2500n })

    // Should return byte ranges for blocks 1 and 2
    expect(result.blockRanges).toHaveLength(2)
    expect(result.blockRanges[0]).toEqual({
      blockIndex: 1,
      byteOffset: 65536,
      byteSize: 65536,
    })
    expect(result.blockRanges[1]).toEqual({
      blockIndex: 2,
      byteOffset: 131072,
      byteSize: 65536,
    })
  })

  it('returns combined byte range for adjacent blocks', async () => {
    const marksData = createInt64MarksFile([
      { min: 0n, max: 999n },
      { min: 1000n, max: 1999n },
      { min: 2000n, max: 2999n },
    ])

    const mockFetch = mockCdnFetch(marksData)
    globalThis.fetch = mockFetch

    const cdnUrl = 'https://cdn.example.com.ai/marks/users.marks'
    const metadata: MarksMetadata = {
      columnType: 'int64',
      blockCount: 3,
      blockSize: DEFAULT_BLOCK_SIZE,
      blockByteSize: 65536,
    }

    const result = await queryRange(cdnUrl, metadata, { min: 500n, max: 2500n })

    // All three blocks match, should coalesce into single range
    expect(result.coalesced).toBeDefined()
    expect(result.coalesced).toEqual({
      byteOffset: 0,
      byteSize: 196608, // 3 * 65536
    })
  })

  it('returns HTTP Range header string for Cloudflare Snippet', async () => {
    const marksData = createInt64MarksFile([
      { min: 0n, max: 999n },
      { min: 1000n, max: 1999n },
    ])

    const mockFetch = mockCdnFetch(marksData)
    globalThis.fetch = mockFetch

    const cdnUrl = 'https://cdn.example.com.ai/marks/users.marks'
    const metadata: MarksMetadata = {
      columnType: 'int64',
      blockCount: 2,
      blockSize: DEFAULT_BLOCK_SIZE,
      blockByteSize: 65536,
    }

    const result = await queryRange(cdnUrl, metadata, { min: 1500n, max: 1600n })

    // Should provide ready-to-use Range header
    expect(result.rangeHeader).toBe('bytes=65536-131071')
  })

  it('handles query that matches no blocks', async () => {
    const marksData = createInt64MarksFile([
      { min: 0n, max: 999n },
      { min: 1000n, max: 1999n },
    ])

    const mockFetch = mockCdnFetch(marksData)
    globalThis.fetch = mockFetch

    const cdnUrl = 'https://cdn.example.com.ai/marks/users.marks'
    const metadata: MarksMetadata = {
      columnType: 'int64',
      blockCount: 2,
      blockSize: DEFAULT_BLOCK_SIZE,
      blockByteSize: 65536,
    }

    const result = await queryRange(cdnUrl, metadata, { min: 5000n, max: 6000n })

    expect(result.blockRanges).toHaveLength(0)
    expect(result.rangeHeader).toBeNull()
  })
})

// ============================================================================
// Performance and Memory Tests
// ============================================================================

describe('SearchSnippet - Performance Constraints', () => {
  it('processes 1MB marks file (65,536 blocks) within Snippet limits', async () => {
    const blockCount = 65536
    const blocks = Array.from({ length: blockCount }, (_, i) => ({
      min: BigInt(i * 1000),
      max: BigInt((i + 1) * 1000 - 1),
    }))

    const marksData = createInt64MarksFile(blocks)
    expect(marksData.byteLength).toBe(blockCount * BYTES_PER_BLOCK) // 1MB

    const mockFetch = mockCdnFetch(marksData)
    globalThis.fetch = mockFetch

    const cdnUrl = 'https://cdn.example.com.ai/marks/large-table.marks'
    const metadata: MarksMetadata = {
      columnType: 'int64',
      blockCount: blockCount,
      blockSize: DEFAULT_BLOCK_SIZE,
    }

    const start = performance.now()
    const result = await queryRange(cdnUrl, metadata, {
      min: BigInt(32768 * 1000),
      max: BigInt(32768 * 1000 + 5000),
    })
    const elapsed = performance.now() - start

    // Should complete well under Cloudflare Snippet 50ms soft limit
    expect(elapsed).toBeLessThan(50)
    expect(result.blockRanges.length).toBeGreaterThanOrEqual(1)
  })

  it('memory-efficient: does not materialize all block objects', () => {
    // This is a conceptual test - implementation should use streaming/lazy parsing
    const blockCount = 65536
    const blocks = Array.from({ length: blockCount }, (_, i) => ({
      min: BigInt(i * 1000),
      max: BigInt((i + 1) * 1000 - 1),
    }))

    const marksData = createInt64MarksFile(blocks)

    // Parse should not create 65,536 objects if only checking one range
    // Implementation detail: use binary search directly on buffer
    const condition: RangeCondition<bigint> = { min: 50000000n, max: 50001000n }

    const start = performance.now()
    const result = pruneBlocks(
      {
        buffer: marksData,
        blockCount,
        columnType: 'int64',
      },
      condition
    )
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(20) // Relaxed for CI variability
    expect(result).toBeDefined()
  })
})
