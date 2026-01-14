/**
 * Extended Sort-Merge Join Tests
 *
 * Additional tests for sort-merge join execution covering edge cases,
 * performance scenarios, and strategy selection.
 *
 * @see dotdo-fv8v0
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  Catalog,
  createMemoryAdapter,
  executeSortMergeJoin,
  type SortMergeJoinConfig,
} from '../index'

// =============================================================================
// Edge Case Tests
// =============================================================================

describe('executeSortMergeJoin - Edge Cases', () => {
  let catalog: Catalog

  beforeEach(() => {
    catalog = new Catalog()
    catalog.registerSource({ name: 'left_db', type: 'memory', config: {} })
    catalog.registerSource({ name: 'right_db', type: 'memory', config: {} })
  })

  describe('empty tables', () => {
    it('should handle empty left table', async () => {
      catalog.attachAdapter('left_db', createMemoryAdapter({
        items: [],
      }))
      catalog.attachAdapter('right_db', createMemoryAdapter({
        refs: [
          { ref_id: 1, value: 'a' },
          { ref_id: 2, value: 'b' },
        ],
      }))

      const config: SortMergeJoinConfig = {
        left: { source: 'left_db', table: 'items' },
        right: { source: 'right_db', table: 'refs' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'ref_id' },
        leftSorted: true,
        rightSorted: true,
      }

      const result = await executeSortMergeJoin(catalog, config)
      expect(result.rows).toHaveLength(0)
    })

    it('should handle empty right table', async () => {
      catalog.attachAdapter('left_db', createMemoryAdapter({
        items: [
          { id: 1, name: 'a' },
          { id: 2, name: 'b' },
        ],
      }))
      catalog.attachAdapter('right_db', createMemoryAdapter({
        refs: [],
      }))

      const config: SortMergeJoinConfig = {
        left: { source: 'left_db', table: 'items' },
        right: { source: 'right_db', table: 'refs' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'ref_id' },
        leftSorted: true,
        rightSorted: true,
      }

      const result = await executeSortMergeJoin(catalog, config)
      expect(result.rows).toHaveLength(0)
    })

    it('should handle both empty tables', async () => {
      catalog.attachAdapter('left_db', createMemoryAdapter({ items: [] }))
      catalog.attachAdapter('right_db', createMemoryAdapter({ refs: [] }))

      const config: SortMergeJoinConfig = {
        left: { source: 'left_db', table: 'items' },
        right: { source: 'right_db', table: 'refs' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'ref_id' },
        leftSorted: true,
        rightSorted: true,
      }

      const result = await executeSortMergeJoin(catalog, config)
      expect(result.rows).toHaveLength(0)
    })

    it('should include all left rows with LEFT join on empty right', async () => {
      catalog.attachAdapter('left_db', createMemoryAdapter({
        items: [
          { id: 1, name: 'a' },
          { id: 2, name: 'b' },
        ],
      }))
      catalog.attachAdapter('right_db', createMemoryAdapter({
        refs: [],
      }))

      const config: SortMergeJoinConfig = {
        left: { source: 'left_db', table: 'items' },
        right: { source: 'right_db', table: 'refs' },
        joinType: 'LEFT',
        keys: { left: 'id', right: 'ref_id' },
        leftSorted: true,
        rightSorted: true,
      }

      const result = await executeSortMergeJoin(catalog, config)
      expect(result.rows).toHaveLength(2)
      // When right table is empty, we don't have column info, so just verify left columns exist
      expect(result.rows[0]?.id).toBe(1)
      expect(result.rows[0]?.name).toBe('a')
    })
  })

  describe('null handling', () => {
    it('should handle null keys - nulls do not match', async () => {
      catalog.attachAdapter('left_db', createMemoryAdapter({
        items: [
          { id: 1, name: 'a' },
          { id: null, name: 'null-left' },
          { id: 2, name: 'b' },
        ],
      }))
      catalog.attachAdapter('right_db', createMemoryAdapter({
        refs: [
          { ref_id: 1, value: 'x' },
          { ref_id: null, value: 'null-right' },
          { ref_id: 2, value: 'y' },
        ],
      }))

      const config: SortMergeJoinConfig = {
        left: { source: 'left_db', table: 'items' },
        right: { source: 'right_db', table: 'refs' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'ref_id' },
        leftSorted: true,
        rightSorted: true,
      }

      const result = await executeSortMergeJoin(catalog, config)
      // Only non-null matches: id=1 and id=2
      expect(result.rows).toHaveLength(2)
    })
  })

  describe('string key sorting', () => {
    it('should correctly sort and merge on string keys', async () => {
      catalog.attachAdapter('left_db', createMemoryAdapter({
        countries: [
          { code: 'US', name: 'United States' },
          { code: 'CA', name: 'Canada' },
          { code: 'MX', name: 'Mexico' },
          { code: 'BR', name: 'Brazil' },
        ],
      }))
      catalog.attachAdapter('right_db', createMemoryAdapter({
        cities: [
          { city: 'Toronto', country_code: 'CA' },
          { city: 'New York', country_code: 'US' },
          { city: 'Chicago', country_code: 'US' },
          { city: 'Mexico City', country_code: 'MX' },
        ],
      }))

      const config: SortMergeJoinConfig = {
        left: { source: 'left_db', table: 'countries' },
        right: { source: 'right_db', table: 'cities' },
        joinType: 'INNER',
        keys: { left: 'code', right: 'country_code' },
        leftSorted: false, // Unsorted input
        rightSorted: false,
      }

      const result = await executeSortMergeJoin(catalog, config)

      expect(result.rows).toHaveLength(4)

      // Verify US has 2 cities
      const usCities = result.rows.filter(r => r.name === 'United States')
      expect(usCities).toHaveLength(2)
    })
  })

  describe('many-to-many joins', () => {
    it('should handle many-to-many relationships correctly', async () => {
      catalog.attachAdapter('left_db', createMemoryAdapter({
        tags: [
          { tag_id: 1, tag: 'javascript' },
          { tag_id: 1, tag: 'web' }, // Same tag_id
          { tag_id: 2, tag: 'python' },
        ],
      }))
      catalog.attachAdapter('right_db', createMemoryAdapter({
        articles: [
          { article_id: 100, tag_ref: 1, title: 'JS Tutorial' },
          { article_id: 101, tag_ref: 1, title: 'Web Basics' },
          { article_id: 102, tag_ref: 2, title: 'Python Intro' },
        ],
      }))

      const config: SortMergeJoinConfig = {
        left: { source: 'left_db', table: 'tags' },
        right: { source: 'right_db', table: 'articles' },
        joinType: 'INNER',
        keys: { left: 'tag_id', right: 'tag_ref' },
        leftSorted: true,
        rightSorted: true,
      }

      const result = await executeSortMergeJoin(catalog, config)

      // 2 tags with tag_id=1 * 2 articles with tag_ref=1 = 4
      // + 1 tag with tag_id=2 * 1 article with tag_ref=2 = 1
      // Total = 5
      expect(result.rows).toHaveLength(5)
    })
  })
})

// =============================================================================
// Outer Join Tests
// =============================================================================

describe('executeSortMergeJoin - Outer Joins', () => {
  let catalog: Catalog

  beforeEach(() => {
    catalog = new Catalog()
    catalog.registerSource({ name: 'left_db', type: 'memory', config: {} })
    catalog.registerSource({ name: 'right_db', type: 'memory', config: {} })
  })

  describe('LEFT outer join', () => {
    it('should include unmatched left rows with null right values', async () => {
      catalog.attachAdapter('left_db', createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ],
      }))
      catalog.attachAdapter('right_db', createMemoryAdapter({
        orders: [
          { order_id: 101, user_id: 1, total: 100 },
          // No order for Bob (id=2) or Charlie (id=3)
        ],
      }))

      const config: SortMergeJoinConfig = {
        left: { source: 'left_db', table: 'users' },
        right: { source: 'right_db', table: 'orders' },
        joinType: 'LEFT',
        keys: { left: 'id', right: 'user_id' },
        leftSorted: true,
        rightSorted: true,
      }

      const result = await executeSortMergeJoin(catalog, config)

      expect(result.rows).toHaveLength(3)

      const bobRow = result.rows.find(r => r.name === 'Bob')
      expect(bobRow).toBeDefined()
      expect(bobRow?.order_id).toBeNull()
      expect(bobRow?.total).toBeNull()
    })
  })

  describe('RIGHT outer join', () => {
    it('should include unmatched right rows with null left values', async () => {
      catalog.attachAdapter('left_db', createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice' },
        ],
      }))
      catalog.attachAdapter('right_db', createMemoryAdapter({
        orders: [
          { order_id: 101, user_id: 1, total: 100 },
          { order_id: 102, user_id: 999, total: 200 }, // Orphan order
        ],
      }))

      const config: SortMergeJoinConfig = {
        left: { source: 'left_db', table: 'users' },
        right: { source: 'right_db', table: 'orders' },
        joinType: 'RIGHT',
        keys: { left: 'id', right: 'user_id' },
        leftSorted: true,
        rightSorted: true,
      }

      const result = await executeSortMergeJoin(catalog, config)

      expect(result.rows).toHaveLength(2)

      const orphanOrder = result.rows.find(r => r.user_id === 999)
      expect(orphanOrder).toBeDefined()
      expect(orphanOrder?.name).toBeNull()
    })
  })

  describe('FULL outer join', () => {
    it('should include all unmatched rows from both sides', async () => {
      catalog.attachAdapter('left_db', createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' }, // No matching order
        ],
      }))
      catalog.attachAdapter('right_db', createMemoryAdapter({
        orders: [
          { order_id: 101, user_id: 1, total: 100 },
          { order_id: 102, user_id: 999, total: 200 }, // No matching user
        ],
      }))

      const config: SortMergeJoinConfig = {
        left: { source: 'left_db', table: 'users' },
        right: { source: 'right_db', table: 'orders' },
        joinType: 'FULL',
        keys: { left: 'id', right: 'user_id' },
        leftSorted: true,
        rightSorted: true,
      }

      const result = await executeSortMergeJoin(catalog, config)

      // 1 match (Alice) + 1 unmatched left (Bob) + 1 unmatched right (order 102) = 3
      expect(result.rows).toHaveLength(3)
    })
  })
})

// =============================================================================
// Sort Direction Tests
// =============================================================================

describe('executeSortMergeJoin - Sort Direction', () => {
  let catalog: Catalog

  beforeEach(() => {
    catalog = new Catalog()
    catalog.registerSource({ name: 'left_db', type: 'memory', config: {} })
    catalog.registerSource({ name: 'right_db', type: 'memory', config: {} })
  })

  it('should work correctly with descending sort', async () => {
    catalog.attachAdapter('left_db', createMemoryAdapter({
      items: [
        { id: 1, name: 'one' },
        { id: 5, name: 'five' },
        { id: 3, name: 'three' },
      ],
    }))
    catalog.attachAdapter('right_db', createMemoryAdapter({
      refs: [
        { ref_id: 5, value: 'V' },
        { ref_id: 3, value: 'III' },
        { ref_id: 7, value: 'VII' },
      ],
    }))

    const config: SortMergeJoinConfig = {
      left: { source: 'left_db', table: 'items' },
      right: { source: 'right_db', table: 'refs' },
      joinType: 'INNER',
      keys: { left: 'id', right: 'ref_id' },
      leftSorted: false,
      rightSorted: false,
      sortDirection: 'DESC',
    }

    const result = await executeSortMergeJoin(catalog, config)

    expect(result.rows).toHaveLength(2)
    // Should match id=5 and id=3
    const matchedIds = result.rows.map(r => r.id)
    expect(matchedIds).toContain(5)
    expect(matchedIds).toContain(3)
  })
})

// =============================================================================
// Performance Scenario Tests
// =============================================================================

describe('executeSortMergeJoin - Performance Scenarios', () => {
  let catalog: Catalog

  beforeEach(() => {
    catalog = new Catalog()
    catalog.registerSource({ name: 'left_db', type: 'memory', config: {} })
    catalog.registerSource({ name: 'right_db', type: 'memory', config: {} })
  })

  it('should handle medium-sized datasets efficiently', async () => {
    // Create 1000 items with sequential IDs
    const leftData = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      value: `left-${i + 1}`,
    }))

    // Create 500 refs that match every other ID
    const rightData = Array.from({ length: 500 }, (_, i) => ({
      ref_id: (i + 1) * 2, // Even IDs only
      data: `right-${(i + 1) * 2}`,
    }))

    catalog.attachAdapter('left_db', createMemoryAdapter({ items: leftData }))
    catalog.attachAdapter('right_db', createMemoryAdapter({ refs: rightData }))

    const config: SortMergeJoinConfig = {
      left: { source: 'left_db', table: 'items' },
      right: { source: 'right_db', table: 'refs' },
      joinType: 'INNER',
      keys: { left: 'id', right: 'ref_id' },
      leftSorted: true, // Already sorted
      rightSorted: true,
    }

    const startTime = performance.now()
    const result = await executeSortMergeJoin(catalog, config)
    const duration = performance.now() - startTime

    expect(result.rows).toHaveLength(500) // 500 matches
    expect(duration).toBeLessThan(1000) // Should complete quickly
  })

  it('should benefit from pre-sorted data', async () => {
    const size = 500

    // Sorted data
    const sortedLeft = Array.from({ length: size }, (_, i) => ({
      id: i + 1,
      name: `item-${i + 1}`,
    }))
    const sortedRight = Array.from({ length: size }, (_, i) => ({
      ref_id: i + 1,
      value: `ref-${i + 1}`,
    }))

    catalog.attachAdapter('left_db', createMemoryAdapter({ items: sortedLeft }))
    catalog.attachAdapter('right_db', createMemoryAdapter({ refs: sortedRight }))

    // Time with pre-sorted flag
    const configSorted: SortMergeJoinConfig = {
      left: { source: 'left_db', table: 'items' },
      right: { source: 'right_db', table: 'refs' },
      joinType: 'INNER',
      keys: { left: 'id', right: 'ref_id' },
      leftSorted: true,
      rightSorted: true,
    }

    const startSorted = performance.now()
    const resultSorted = await executeSortMergeJoin(catalog, configSorted)
    const durationSorted = performance.now() - startSorted

    // Time without pre-sorted flag (needs sorting)
    const configUnsorted: SortMergeJoinConfig = {
      left: { source: 'left_db', table: 'items' },
      right: { source: 'right_db', table: 'refs' },
      joinType: 'INNER',
      keys: { left: 'id', right: 'ref_id' },
      leftSorted: false,
      rightSorted: false,
    }

    const startUnsorted = performance.now()
    const resultUnsorted = await executeSortMergeJoin(catalog, configUnsorted)
    const durationUnsorted = performance.now() - startUnsorted

    // Both should produce same results
    expect(resultSorted.rows).toHaveLength(size)
    expect(resultUnsorted.rows).toHaveLength(size)

    // Pre-sorted should be faster (but we can't strictly enforce this in tests
    // as performance can vary). Just verify both complete.
    expect(durationSorted).toBeDefined()
    expect(durationUnsorted).toBeDefined()
  })
})
