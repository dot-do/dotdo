/**
 * Result Merger Tests
 *
 * TDD tests for result merging and ordering across federated sources:
 * - K-way merge with sorted inputs
 * - Global ORDER BY correctness
 * - LIMIT optimization with over-fetch
 * - DISTINCT behavior and deduplication
 *
 * @see dotdo-cm0et
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  // Result Merger
  ResultMerger,
  type MergeConfig,
  type SortSpec,
  type DeduplicationConfig,
  type PaginationConfig,
  type MergeResult,
  type SortedStreamSource,

  // Existing types
  Catalog,
  createMemoryAdapter,
  FederatedExecutor,
  type ExecutionPlan,
} from '../index'

// =============================================================================
// K-way Merge Tests
// =============================================================================

describe('K-way Merge', () => {
  let merger: ResultMerger

  beforeEach(() => {
    merger = new ResultMerger()
  })

  describe('basic merge', () => {
    it('should merge two sorted arrays preserving order', async () => {
      const stream1: SortedStreamSource = {
        id: 'source1',
        rows: [
          { id: 1, score: 95 },
          { id: 3, score: 85 },
          { id: 5, score: 75 },
        ],
        exhausted: true,
      }

      const stream2: SortedStreamSource = {
        id: 'source2',
        rows: [
          { id: 2, score: 90 },
          { id: 4, score: 80 },
          { id: 6, score: 70 },
        ],
        exhausted: true,
      }

      const result = await merger.merge([stream1, stream2], {
        sort: [{ column: 'score', direction: 'DESC' }],
      })

      expect(result.rows).toHaveLength(6)
      expect(result.rows.map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should merge three or more sources (k-way merge)', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 4 }, { v: 7 }], exhausted: true },
        { id: 's2', rows: [{ v: 2 }, { v: 5 }, { v: 8 }], exhausted: true },
        { id: 's3', rows: [{ v: 3 }, { v: 6 }, { v: 9 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
      })

      expect(result.rows.map(r => r.v)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    })

    it('should handle empty sources gracefully', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 3 }], exhausted: true },
        { id: 's2', rows: [], exhausted: true },
        { id: 's3', rows: [{ v: 2 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
      })

      expect(result.rows.map(r => r.v)).toEqual([1, 2, 3])
    })

    it('should handle single source as passthrough', async () => {
      const source: SortedStreamSource = {
        id: 'only',
        rows: [{ v: 1 }, { v: 2 }, { v: 3 }],
        exhausted: true,
      }

      const result = await merger.merge([source], {
        sort: [{ column: 'v', direction: 'ASC' }],
      })

      expect(result.rows.map(r => r.v)).toEqual([1, 2, 3])
    })
  })

  describe('sort direction', () => {
    it('should merge with ASC ordering', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 10 }, { v: 30 }], exhausted: true },
        { id: 's2', rows: [{ v: 20 }, { v: 40 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
      })

      expect(result.rows.map(r => r.v)).toEqual([10, 20, 30, 40])
    })

    it('should merge with DESC ordering', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 40 }, { v: 20 }], exhausted: true },
        { id: 's2', rows: [{ v: 30 }, { v: 10 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'DESC' }],
      })

      expect(result.rows.map(r => r.v)).toEqual([40, 30, 20, 10])
    })
  })

  describe('multi-column sort', () => {
    it('should merge with compound sort key', async () => {
      const sources: SortedStreamSource[] = [
        {
          id: 's1',
          rows: [
            { dept: 'A', score: 90 },
            { dept: 'B', score: 80 },
          ],
          exhausted: true,
        },
        {
          id: 's2',
          rows: [
            { dept: 'A', score: 85 },
            { dept: 'B', score: 75 },
          ],
          exhausted: true,
        },
      ]

      const result = await merger.merge(sources, {
        sort: [
          { column: 'dept', direction: 'ASC' },
          { column: 'score', direction: 'DESC' },
        ],
      })

      expect(result.rows).toEqual([
        { dept: 'A', score: 90 },
        { dept: 'A', score: 85 },
        { dept: 'B', score: 80 },
        { dept: 'B', score: 75 },
      ])
    })

    it('should handle nulls in sort columns', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: null }, { v: 3 }], exhausted: true },
        { id: 's2', rows: [{ v: 2 }, { v: null }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
        nullsFirst: true,
      })

      // Nulls first, then sorted values
      expect(result.rows.slice(0, 2).every(r => r.v === null)).toBe(true)
      expect(result.rows.slice(2).map(r => r.v)).toEqual([1, 2, 3])
    })
  })

  describe('type coercion in sorting', () => {
    it('should compare strings lexicographically', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ name: 'alice' }, { name: 'charlie' }], exhausted: true },
        { id: 's2', rows: [{ name: 'bob' }, { name: 'dave' }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'name', direction: 'ASC' }],
      })

      expect(result.rows.map(r => r.name)).toEqual(['alice', 'bob', 'charlie', 'dave'])
    })

    it('should compare dates correctly', async () => {
      const sources: SortedStreamSource[] = [
        {
          id: 's1',
          rows: [
            { created: '2024-01-01T00:00:00Z' },
            { created: '2024-03-01T00:00:00Z' },
          ],
          exhausted: true,
        },
        {
          id: 's2',
          rows: [
            { created: '2024-02-01T00:00:00Z' },
            { created: '2024-04-01T00:00:00Z' },
          ],
          exhausted: true,
        },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'created', direction: 'ASC' }],
      })

      expect(result.rows.map(r => r.created)).toEqual([
        '2024-01-01T00:00:00Z',
        '2024-02-01T00:00:00Z',
        '2024-03-01T00:00:00Z',
        '2024-04-01T00:00:00Z',
      ])
    })
  })
})

// =============================================================================
// Global ORDER BY Tests
// =============================================================================

describe('Global ORDER BY', () => {
  let merger: ResultMerger

  beforeEach(() => {
    merger = new ResultMerger()
  })

  describe('unsorted source handling', () => {
    it('should sort unsorted sources before merging', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 3 }, { v: 1 }, { v: 2 }], exhausted: true, sorted: false },
        { id: 's2', rows: [{ v: 6 }, { v: 4 }, { v: 5 }], exhausted: true, sorted: false },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
      })

      expect(result.rows.map(r => r.v)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should preserve already sorted sources', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 3 }, { v: 5 }], exhausted: true, sorted: true },
        { id: 's2', rows: [{ v: 2 }, { v: 4 }, { v: 6 }], exhausted: true, sorted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
      })

      expect(result.rows.map(r => r.v)).toEqual([1, 2, 3, 4, 5, 6])
    })
  })

  describe('order verification', () => {
    it('should verify merged output is correctly ordered', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 5 }, { v: 9 }], exhausted: true },
        { id: 's2', rows: [{ v: 2 }, { v: 6 }, { v: 10 }], exhausted: true },
        { id: 's3', rows: [{ v: 3 }, { v: 7 }, { v: 11 }], exhausted: true },
        { id: 's4', rows: [{ v: 4 }, { v: 8 }, { v: 12 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
        verifyOrder: true,
      })

      // Verify output is in correct order
      for (let i = 1; i < result.rows.length; i++) {
        expect(result.rows[i].v).toBeGreaterThanOrEqual(result.rows[i - 1].v)
      }
    })

    it('should throw on inconsistently sorted sources when verification enabled', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 3 }, { v: 2 }], exhausted: true, sorted: true }, // Not actually sorted
        { id: 's2', rows: [{ v: 4 }, { v: 5 }, { v: 6 }], exhausted: true, sorted: true },
      ]

      await expect(
        merger.merge(sources, {
          sort: [{ column: 'v', direction: 'ASC' }],
          verifyOrder: true,
          strictSourceOrder: true,
        })
      ).rejects.toThrow('Source s1 is not correctly sorted')
    })
  })
})

// =============================================================================
// LIMIT Optimization Tests
// =============================================================================

describe('LIMIT Optimization', () => {
  let merger: ResultMerger

  beforeEach(() => {
    merger = new ResultMerger()
  })

  describe('basic limit', () => {
    it('should apply limit to merged results', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 3 }, { v: 5 }], exhausted: true },
        { id: 's2', rows: [{ v: 2 }, { v: 4 }, { v: 6 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
        pagination: { limit: 3 },
      })

      expect(result.rows).toHaveLength(3)
      expect(result.rows.map(r => r.v)).toEqual([1, 2, 3])
    })

    it('should apply offset with limit', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 3 }, { v: 5 }], exhausted: true },
        { id: 's2', rows: [{ v: 2 }, { v: 4 }, { v: 6 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
        pagination: { limit: 3, offset: 2 },
      })

      expect(result.rows).toHaveLength(3)
      expect(result.rows.map(r => r.v)).toEqual([3, 4, 5])
    })
  })

  describe('over-fetch strategy', () => {
    it('should calculate required over-fetch per source', () => {
      // With LIMIT 10, OFFSET 20, and 3 sources, each source should fetch at least 10 rows
      // because we need to skip 20 and return 10
      const overFetch = merger.calculateOverFetch({
        sourceCount: 3,
        limit: 10,
        offset: 20,
      })

      // Each source should fetch at least (offset + limit) / sourceCount, rounded up
      // Plus some buffer for robustness
      expect(overFetch).toBeGreaterThanOrEqual(10)
    })

    it('should track source exhaustion for accurate over-fetch', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 5 }], exhausted: true },
        { id: 's2', rows: Array.from({ length: 100 }, (_, i) => ({ v: i * 2 + 2 })), exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
        pagination: { limit: 10 },
      })

      expect(result.rows).toHaveLength(10)
      expect(result.metadata?.sourceExhausted).toEqual({ s1: true, s2: false })
    })
  })

  describe('pagination metadata', () => {
    it('should indicate if more results are available', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 3 }, { v: 5 }], exhausted: true },
        { id: 's2', rows: [{ v: 2 }, { v: 4 }, { v: 6 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
        pagination: { limit: 4 },
      })

      expect(result.hasMore).toBe(true)
    })

    it('should indicate when no more results', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 3 }], exhausted: true },
        { id: 's2', rows: [{ v: 2 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
        pagination: { limit: 10 },
      })

      expect(result.hasMore).toBe(false)
    })

    it('should provide cursor for next page', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ v: 1 }, { v: 3 }, { v: 5 }, { v: 7 }], exhausted: true },
        { id: 's2', rows: [{ v: 2 }, { v: 4 }, { v: 6 }, { v: 8 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
        pagination: { limit: 4 },
      })

      expect(result.cursor).toBeDefined()

      // Use cursor for next page
      const nextResult = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
        pagination: { limit: 4, cursor: result.cursor },
      })

      expect(nextResult.rows.map(r => r.v)).toEqual([5, 6, 7, 8])
    })
  })
})

// =============================================================================
// DISTINCT / Deduplication Tests
// =============================================================================

describe('DISTINCT and Deduplication', () => {
  let merger: ResultMerger

  beforeEach(() => {
    merger = new ResultMerger()
  })

  describe('exact duplicate removal', () => {
    it('should remove exact duplicates from merged results', async () => {
      const sources: SortedStreamSource[] = [
        {
          id: 's1',
          rows: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
          exhausted: true,
        },
        {
          id: 's2',
          rows: [
            { id: 1, name: 'Alice' }, // Duplicate
            { id: 3, name: 'Charlie' },
          ],
          exhausted: true,
        },
      ]

      const result = await merger.merge(sources, {
        deduplication: { mode: 'exact' },
      })

      expect(result.rows).toHaveLength(3)
      expect(result.rows.map(r => r.name)).toEqual(['Alice', 'Bob', 'Charlie'])
    })
  })

  describe('key-based deduplication', () => {
    it('should deduplicate by specified key columns', async () => {
      const sources: SortedStreamSource[] = [
        {
          id: 's1',
          rows: [
            { id: 1, name: 'Alice', version: 1 },
            { id: 2, name: 'Bob', version: 1 },
          ],
          exhausted: true,
        },
        {
          id: 's2',
          rows: [
            { id: 1, name: 'Alice Updated', version: 2 }, // Same id, different data
            { id: 3, name: 'Charlie', version: 1 },
          ],
          exhausted: true,
        },
      ]

      const result = await merger.merge(sources, {
        deduplication: { mode: 'key', keyColumns: ['id'] },
      })

      expect(result.rows).toHaveLength(3)
      expect(result.rows.find(r => r.id === 1)?.name).toBe('Alice') // First wins
    })

    it('should support composite keys for deduplication', async () => {
      const sources: SortedStreamSource[] = [
        {
          id: 's1',
          rows: [
            { tenant: 'a', id: 1, data: 'first' },
            { tenant: 'a', id: 2, data: 'second' },
          ],
          exhausted: true,
        },
        {
          id: 's2',
          rows: [
            { tenant: 'a', id: 1, data: 'duplicate' },
            { tenant: 'b', id: 1, data: 'different_tenant' },
          ],
          exhausted: true,
        },
      ]

      const result = await merger.merge(sources, {
        deduplication: { mode: 'key', keyColumns: ['tenant', 'id'] },
      })

      expect(result.rows).toHaveLength(3)
    })
  })

  describe('deduplication strategies', () => {
    it('should keep first occurrence (default)', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ id: 1, value: 'first' }], exhausted: true },
        { id: 's2', rows: [{ id: 1, value: 'second' }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'id', direction: 'ASC' }],
        deduplication: { mode: 'key', keyColumns: ['id'], strategy: 'first' },
      })

      expect(result.rows[0]?.value).toBe('first')
    })

    it('should keep last occurrence when specified', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ id: 1, value: 'first' }], exhausted: true },
        { id: 's2', rows: [{ id: 1, value: 'second' }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'id', direction: 'ASC' }],
        deduplication: { mode: 'key', keyColumns: ['id'], strategy: 'last' },
      })

      expect(result.rows[0]?.value).toBe('second')
    })

    it('should use custom merge function when specified', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ id: 1, count: 10 }], exhausted: true },
        { id: 's2', rows: [{ id: 1, count: 20 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        deduplication: {
          mode: 'key',
          keyColumns: ['id'],
          strategy: 'custom',
          mergeFn: (a, b) => ({ ...a, count: (a.count as number) + (b.count as number) }),
        },
      })

      expect(result.rows[0]?.count).toBe(30)
    })
  })

  describe('distinct columns', () => {
    it('should return distinct values for specified columns only', async () => {
      const sources: SortedStreamSource[] = [
        {
          id: 's1',
          rows: [
            { category: 'A', item: 1 },
            { category: 'A', item: 2 },
            { category: 'B', item: 3 },
          ],
          exhausted: true,
        },
        {
          id: 's2',
          rows: [
            { category: 'A', item: 4 },
            { category: 'C', item: 5 },
          ],
          exhausted: true,
        },
      ]

      const result = await merger.merge(sources, {
        deduplication: { mode: 'distinct', distinctColumns: ['category'] },
      })

      expect(result.rows).toHaveLength(3) // A, B, C
      expect(result.rows.map(r => r.category).sort()).toEqual(['A', 'B', 'C'])
    })
  })

  describe('deduplication stats', () => {
    it('should report deduplication statistics', async () => {
      const sources: SortedStreamSource[] = [
        { id: 's1', rows: [{ id: 1 }, { id: 2 }], exhausted: true },
        { id: 's2', rows: [{ id: 1 }, { id: 3 }], exhausted: true },
      ]

      const result = await merger.merge(sources, {
        deduplication: { mode: 'key', keyColumns: ['id'] },
        collectStats: true,
      })

      expect(result.stats?.duplicatesRemoved).toBe(1)
      expect(result.stats?.totalScanned).toBe(4)
      expect(result.stats?.finalCount).toBe(3)
    })
  })
})

// =============================================================================
// Streaming Merge Tests
// =============================================================================

describe('Streaming Merge', () => {
  let merger: ResultMerger

  beforeEach(() => {
    merger = new ResultMerger()
  })

  describe('async generator sources', () => {
    it('should merge async generator sources', async () => {
      async function* source1(): AsyncGenerator<Record<string, unknown>> {
        yield { v: 1 }
        yield { v: 3 }
        yield { v: 5 }
      }

      async function* source2(): AsyncGenerator<Record<string, unknown>> {
        yield { v: 2 }
        yield { v: 4 }
        yield { v: 6 }
      }

      const result = await merger.mergeStreams(
        [
          { id: 's1', generator: source1() },
          { id: 's2', generator: source2() },
        ],
        {
          sort: [{ column: 'v', direction: 'ASC' }],
        }
      )

      const rows: Record<string, unknown>[] = []
      for await (const row of result) {
        rows.push(row)
      }

      expect(rows.map(r => r.v)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should support early termination with limit', async () => {
      let fetchedFromS1 = 0
      let fetchedFromS2 = 0

      async function* source1(): AsyncGenerator<Record<string, unknown>> {
        for (let i = 1; i <= 100; i += 2) {
          fetchedFromS1++
          yield { v: i }
        }
      }

      async function* source2(): AsyncGenerator<Record<string, unknown>> {
        for (let i = 2; i <= 100; i += 2) {
          fetchedFromS2++
          yield { v: i }
        }
      }

      const result = await merger.mergeStreams(
        [
          { id: 's1', generator: source1() },
          { id: 's2', generator: source2() },
        ],
        {
          sort: [{ column: 'v', direction: 'ASC' }],
          pagination: { limit: 5 },
        }
      )

      const rows: Record<string, unknown>[] = []
      for await (const row of result) {
        rows.push(row)
      }

      expect(rows).toHaveLength(5)
      // Should not have fetched all 100 rows from each source
      expect(fetchedFromS1 + fetchedFromS2).toBeLessThan(20)
    })
  })

  describe('buffered streaming', () => {
    it('should use minimal memory with streaming merge', async () => {
      const largeSource1 = Array.from({ length: 10000 }, (_, i) => ({ v: i * 2 + 1 }))
      const largeSource2 = Array.from({ length: 10000 }, (_, i) => ({ v: i * 2 + 2 }))

      const sources: SortedStreamSource[] = [
        { id: 's1', rows: largeSource1, exhausted: true },
        { id: 's2', rows: largeSource2, exhausted: true },
      ]

      const result = await merger.merge(sources, {
        sort: [{ column: 'v', direction: 'ASC' }],
        pagination: { limit: 100 },
        streaming: { bufferSize: 100 },
      })

      expect(result.rows).toHaveLength(100)
      // Verify correct ordering in limited result
      for (let i = 0; i < 99; i++) {
        expect(result.rows[i + 1].v).toBeGreaterThan(result.rows[i].v)
      }
    })
  })
})

// =============================================================================
// Integration with FederatedExecutor Tests
// =============================================================================

describe('ResultMerger Integration', () => {
  let catalog: Catalog
  let executor: FederatedExecutor
  let merger: ResultMerger

  beforeEach(() => {
    catalog = new Catalog()
    executor = new FederatedExecutor(catalog)
    merger = new ResultMerger()

    // Setup multiple sources with overlapping data
    catalog.registerSource({ name: 'region_us', type: 'memory', config: {} })
    catalog.registerSource({ name: 'region_eu', type: 'memory', config: {} })
    catalog.registerSource({ name: 'region_asia', type: 'memory', config: {} })

    catalog.attachAdapter(
      'region_us',
      createMemoryAdapter({
        orders: [
          { id: 'us-1', total: 500, created: '2024-01-01' },
          { id: 'us-2', total: 300, created: '2024-01-03' },
          { id: 'us-3', total: 700, created: '2024-01-05' },
        ],
      })
    )

    catalog.attachAdapter(
      'region_eu',
      createMemoryAdapter({
        orders: [
          { id: 'eu-1', total: 450, created: '2024-01-02' },
          { id: 'eu-2', total: 600, created: '2024-01-04' },
        ],
      })
    )

    catalog.attachAdapter(
      'region_asia',
      createMemoryAdapter({
        orders: [
          { id: 'asia-1', total: 350, created: '2024-01-01' },
          { id: 'asia-2', total: 550, created: '2024-01-03' },
        ],
      })
    )
  })

  it('should merge federated execution results with global ordering', async () => {
    const plans: ExecutionPlan[] = [
      { fragments: [{ source: 'region_us', pushdown: { table: 'orders' } }] },
      { fragments: [{ source: 'region_eu', pushdown: { table: 'orders' } }] },
      { fragments: [{ source: 'region_asia', pushdown: { table: 'orders' } }] },
    ]

    const results = await Promise.all(plans.map(p => executor.execute(p)))

    const sources: SortedStreamSource[] = results.map((r, i) => ({
      id: ['region_us', 'region_eu', 'region_asia'][i],
      rows: r.rows,
      exhausted: true,
    }))

    const merged = await merger.merge(sources, {
      sort: [{ column: 'total', direction: 'DESC' }],
    })

    expect(merged.rows).toHaveLength(7)
    expect(merged.rows[0].total).toBe(700)
    expect(merged.rows[merged.rows.length - 1].total).toBe(300)
  })

  it('should apply global limit across federated results', async () => {
    const plans: ExecutionPlan[] = [
      { fragments: [{ source: 'region_us', pushdown: { table: 'orders' } }] },
      { fragments: [{ source: 'region_eu', pushdown: { table: 'orders' } }] },
      { fragments: [{ source: 'region_asia', pushdown: { table: 'orders' } }] },
    ]

    const results = await Promise.all(plans.map(p => executor.execute(p)))

    const sources: SortedStreamSource[] = results.map((r, i) => ({
      id: ['region_us', 'region_eu', 'region_asia'][i],
      rows: r.rows,
      exhausted: true,
    }))

    const merged = await merger.merge(sources, {
      sort: [{ column: 'created', direction: 'ASC' }],
      pagination: { limit: 3 },
    })

    expect(merged.rows).toHaveLength(3)
    // First 3 by date should be us-1, asia-1, eu-1
    expect(merged.rows.map(r => r.created)).toEqual([
      '2024-01-01',
      '2024-01-01',
      '2024-01-02',
    ])
  })
})
