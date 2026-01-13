/**
 * Tests for transforms module
 */

import { describe, it, expect } from 'vitest'
import {
  dedupe,
  unique,
  distinctBy,
  partition,
  partitionBy,
  sort,
  sortBy,
  topN,
  bottomN,
  parallel,
  scan,
  interleave,
} from '../transforms'
import { collect } from '../aggregators'

describe('dedupe', () => {
  it('should remove duplicates', async () => {
    const result = await collect(dedupe([1, 2, 1, 3, 2, 4]))
    expect(result).toEqual([1, 2, 3, 4])
  })

  it('should use custom key extractor', async () => {
    const items = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 1, name: 'c' }, // Duplicate id
    ]
    const result = await collect(
      dedupe(items, { keyExtractor: i => String(i.id) })
    )
    expect(result).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ])
  })

  it('should handle LRU eviction', async () => {
    const result = await collect(
      dedupe([1, 2, 3, 4, 5, 1], { maxKeys: 3 })
    )
    // After 4, 5 are added, 1, 2 should be evicted from tracking
    // So second 1 should be yielded
    expect(result).toContain(1)
  })
})

describe('unique', () => {
  it('should be alias for dedupe', async () => {
    const result = await collect(unique([1, 2, 1, 3]))
    expect(result).toEqual([1, 2, 3])
  })
})

describe('distinctBy', () => {
  it('should get distinct by field', async () => {
    const items = [
      { type: 'a', value: 1 },
      { type: 'b', value: 2 },
      { type: 'a', value: 3 },
    ]
    const result = await collect(distinctBy(items, i => i.type))
    expect(result).toEqual([
      { type: 'a', value: 1 },
      { type: 'b', value: 2 },
    ])
  })
})

describe('partition', () => {
  it('should partition into two groups', async () => {
    const [evens, odds] = await partition([1, 2, 3, 4, 5], x => x % 2 === 0)
    expect(evens).toEqual([2, 4])
    expect(odds).toEqual([1, 3, 5])
  })
})

describe('partitionBy', () => {
  it('should partition by key', async () => {
    const items = [
      { type: 'a', value: 1 },
      { type: 'b', value: 2 },
      { type: 'a', value: 3 },
    ]
    const result = await partitionBy(items, i => i.type)
    expect(result.get('a')).toEqual([
      { type: 'a', value: 1 },
      { type: 'a', value: 3 },
    ])
    expect(result.get('b')).toEqual([
      { type: 'b', value: 2 },
    ])
  })
})

describe('sort', () => {
  it('should sort items', async () => {
    const result = await collect(sort([3, 1, 4, 1, 5], (a, b) => a - b))
    expect(result).toEqual([1, 1, 3, 4, 5])
  })
})

describe('sortBy', () => {
  it('should sort by key ascending', async () => {
    const items = [
      { name: 'c' },
      { name: 'a' },
      { name: 'b' },
    ]
    const result = await collect(sortBy(items, i => i.name, 'asc'))
    expect(result.map(i => i.name)).toEqual(['a', 'b', 'c'])
  })

  it('should sort by key descending', async () => {
    const items = [
      { value: 1 },
      { value: 3 },
      { value: 2 },
    ]
    const result = await collect(sortBy(items, i => i.value, 'desc'))
    expect(result.map(i => i.value)).toEqual([3, 2, 1])
  })
})

describe('topN', () => {
  it('should get top N by key', async () => {
    const items = [
      { score: 10 },
      { score: 50 },
      { score: 30 },
      { score: 20 },
      { score: 40 },
    ]
    const result = await collect(topN(items, 3, i => i.score))
    expect(result.map(i => i.score)).toEqual([50, 40, 30])
  })
})

describe('bottomN', () => {
  it('should get bottom N by key', async () => {
    const items = [
      { score: 10 },
      { score: 50 },
      { score: 30 },
      { score: 20 },
      { score: 40 },
    ]
    const result = await collect(bottomN(items, 3, i => i.score))
    expect(result.map(i => i.score)).toEqual([10, 20, 30])
  })
})

describe('parallel', () => {
  it('should process items in parallel with order', async () => {
    const result = await collect(
      parallel(
        [1, 2, 3, 4],
        async x => {
          await new Promise(r => setTimeout(r, Math.random() * 10))
          return x * 2
        },
        { concurrency: 2, preserveOrder: true }
      )
    )
    expect(result).toEqual([2, 4, 6, 8])
  })

  it('should process items in parallel without order', async () => {
    const result = await collect(
      parallel(
        [1, 2, 3, 4],
        async x => {
          await new Promise(r => setTimeout(r, Math.random() * 10))
          return x * 2
        },
        { concurrency: 2, preserveOrder: false }
      )
    )
    expect(result.sort((a, b) => a - b)).toEqual([2, 4, 6, 8])
  })
})

describe('scan', () => {
  it('should yield running accumulation', async () => {
    const result = await collect(
      scan([1, 2, 3, 4], (acc, x) => acc + x, 0)
    )
    expect(result).toEqual([1, 3, 6, 10])
  })
})

describe('interleave', () => {
  it('should interleave items from sources', async () => {
    const result = await collect(
      interleave([1, 2, 3], ['a', 'b', 'c'])
    )
    expect(result).toEqual([1, 'a', 2, 'b', 3, 'c'])
  })

  it('should handle different length sources', async () => {
    const result = await collect(
      interleave([1, 2], ['a', 'b', 'c', 'd'])
    )
    expect(result).toEqual([1, 'a', 2, 'b', 'c', 'd'])
  })
})
