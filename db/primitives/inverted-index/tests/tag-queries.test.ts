/**
 * Tag/Label Query Tests (RED Phase)
 *
 * Tests for tag/label indexing and exact match queries.
 * Used for time-series labels (metric_name, host, region) and
 * document metadata (category, author, status).
 *
 * @module db/primitives/inverted-index/tests/tag-queries
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TagIndex, TagQuery, TagMatcher } from '../tag-index'

describe('Tag/Label Queries', () => {
  // ============================================================================
  // TagIndex Basic Operations
  // ============================================================================

  describe('TagIndex', () => {
    let index: TagIndex

    beforeEach(() => {
      index = new TagIndex()
    })

    describe('add', () => {
      it('should add document with single tag', () => {
        index.add(1, { region: 'us-east' })
        expect(index.documentCount).toBe(1)
      })

      it('should add document with multiple tags', () => {
        index.add(1, {
          metric_name: 'cpu_usage',
          host: 'server1',
          region: 'us-east',
        })
        expect(index.documentCount).toBe(1)
      })

      it('should add multiple documents with same tags', () => {
        index.add(1, { region: 'us-east' })
        index.add(2, { region: 'us-east' })
        index.add(3, { region: 'us-east' })
        expect(index.documentCount).toBe(3)
      })

      it('should add multiple documents with different tags', () => {
        index.add(1, { region: 'us-east' })
        index.add(2, { region: 'us-west' })
        index.add(3, { region: 'eu-west' })
        expect(index.documentCount).toBe(3)
      })

      it('should update tags on re-add', () => {
        index.add(1, { region: 'us-east' })
        index.add(1, { region: 'us-west' })

        const results = index.query({ region: 'us-east' })
        expect(results).not.toContain(1)

        const results2 = index.query({ region: 'us-west' })
        expect(results2).toContain(1)
      })

      it('should handle empty tags object', () => {
        index.add(1, {})
        expect(index.documentCount).toBe(1)
      })

      it('should handle tags with empty string values', () => {
        index.add(1, { key: '' })
        const results = index.query({ key: '' })
        expect(results).toContain(1)
      })

      it('should handle tags with special characters', () => {
        index.add(1, { 'key-with-dash': 'value.with.dots' })
        const results = index.query({ 'key-with-dash': 'value.with.dots' })
        expect(results).toContain(1)
      })
    })

    describe('remove', () => {
      it('should remove document from index', () => {
        index.add(1, { region: 'us-east' })
        index.remove(1)
        expect(index.documentCount).toBe(0)
      })

      it('should clean up tag entries when last document removed', () => {
        index.add(1, { region: 'us-east' })
        index.remove(1)
        const results = index.query({ region: 'us-east' })
        expect(results).toHaveLength(0)
      })

      it('should handle removing non-existent document', () => {
        expect(() => index.remove(999)).not.toThrow()
      })

      it('should not affect other documents', () => {
        index.add(1, { region: 'us-east' })
        index.add(2, { region: 'us-east' })
        index.remove(1)

        const results = index.query({ region: 'us-east' })
        expect(results).toContain(2)
        expect(results).not.toContain(1)
      })
    })

    describe('query - single tag', () => {
      beforeEach(() => {
        index.add(1, { host: 'server1', region: 'us-east' })
        index.add(2, { host: 'server2', region: 'us-east' })
        index.add(3, { host: 'server1', region: 'us-west' })
        index.add(4, { host: 'server2', region: 'us-west' })
      })

      it('should find documents by single tag', () => {
        const results = index.query({ region: 'us-east' })
        expect(results).toHaveLength(2)
        expect(results).toContain(1)
        expect(results).toContain(2)
      })

      it('should return empty for non-matching tag value', () => {
        const results = index.query({ region: 'eu-west' })
        expect(results).toHaveLength(0)
      })

      it('should return empty for non-existent tag key', () => {
        const results = index.query({ nonexistent: 'value' })
        expect(results).toHaveLength(0)
      })

      it('should perform exact match only', () => {
        // Should NOT match "us-east" with partial "us"
        const results = index.query({ region: 'us' })
        expect(results).toHaveLength(0)
      })
    })

    describe('query - multiple tags (AND)', () => {
      beforeEach(() => {
        index.add(1, { metric: 'cpu', host: 'server1', region: 'us-east' })
        index.add(2, { metric: 'cpu', host: 'server2', region: 'us-east' })
        index.add(3, { metric: 'memory', host: 'server1', region: 'us-east' })
        index.add(4, { metric: 'cpu', host: 'server1', region: 'us-west' })
      })

      it('should AND multiple tag constraints', () => {
        const results = index.query({ metric: 'cpu', region: 'us-east' })
        expect(results).toHaveLength(2)
        expect(results).toContain(1)
        expect(results).toContain(2)
      })

      it('should narrow results with more tags', () => {
        const results = index.query({
          metric: 'cpu',
          host: 'server1',
          region: 'us-east',
        })
        expect(results).toHaveLength(1)
        expect(results).toContain(1)
      })

      it('should return empty when any tag does not match', () => {
        const results = index.query({
          metric: 'cpu',
          region: 'eu-west', // No documents have this
        })
        expect(results).toHaveLength(0)
      })

      it('should handle empty query object (return all documents)', () => {
        const results = index.query({})
        expect(results).toHaveLength(4)
      })
    })

    describe('queryOr - OR across tag sets', () => {
      beforeEach(() => {
        index.add(1, { status: 'active', priority: 'high' })
        index.add(2, { status: 'active', priority: 'low' })
        index.add(3, { status: 'inactive', priority: 'high' })
        index.add(4, { status: 'inactive', priority: 'low' })
      })

      it('should OR multiple tag sets', () => {
        const results = index.queryOr([{ status: 'active' }, { priority: 'high' }])
        // Matches: 1 (active), 2 (active), 3 (high priority)
        expect(results).toHaveLength(3)
        expect(results).toContain(1)
        expect(results).toContain(2)
        expect(results).toContain(3)
      })

      it('should handle single tag set', () => {
        const results = index.queryOr([{ status: 'active' }])
        expect(results).toHaveLength(2)
      })

      it('should handle empty tag sets array', () => {
        const results = index.queryOr([])
        expect(results).toHaveLength(0)
      })

      it('should combine AND within each set, OR between sets', () => {
        // (status=active AND priority=high) OR (status=inactive AND priority=low)
        const results = index.queryOr([
          { status: 'active', priority: 'high' },
          { status: 'inactive', priority: 'low' },
        ])
        expect(results).toHaveLength(2)
        expect(results).toContain(1) // active + high
        expect(results).toContain(4) // inactive + low
      })
    })
  })

  // ============================================================================
  // Tag Enumeration
  // ============================================================================

  describe('tag enumeration', () => {
    let index: TagIndex

    beforeEach(() => {
      index = new TagIndex()
      index.add(1, { metric: 'cpu', host: 'server1', region: 'us-east' })
      index.add(2, { metric: 'memory', host: 'server1', region: 'us-west' })
      index.add(3, { metric: 'disk', host: 'server2', region: 'eu-west' })
    })

    describe('getKeys', () => {
      it('should return all unique tag keys', () => {
        const keys = index.getKeys()
        expect(keys).toHaveLength(3)
        expect(keys).toContain('metric')
        expect(keys).toContain('host')
        expect(keys).toContain('region')
      })

      it('should return keys in sorted order', () => {
        const keys = index.getKeys()
        expect(keys).toEqual(['host', 'metric', 'region'])
      })

      it('should return empty array for empty index', () => {
        const emptyIndex = new TagIndex()
        expect(emptyIndex.getKeys()).toEqual([])
      })
    })

    describe('getValues', () => {
      it('should return all unique values for a key', () => {
        const values = index.getValues('region')
        expect(values).toHaveLength(3)
        expect(values).toContain('us-east')
        expect(values).toContain('us-west')
        expect(values).toContain('eu-west')
      })

      it('should return values in sorted order', () => {
        const values = index.getValues('region')
        expect(values).toEqual(['eu-west', 'us-east', 'us-west'])
      })

      it('should return empty array for non-existent key', () => {
        const values = index.getValues('nonexistent')
        expect(values).toEqual([])
      })

      it('should handle key with single value', () => {
        index.add(4, { unique_key: 'unique_value' })
        const values = index.getValues('unique_key')
        expect(values).toEqual(['unique_value'])
      })
    })

    describe('getCardinality', () => {
      it('should return number of unique values for a key', () => {
        expect(index.getCardinality('region')).toBe(3)
        expect(index.getCardinality('host')).toBe(2)
        expect(index.getCardinality('metric')).toBe(3)
      })

      it('should return 0 for non-existent key', () => {
        expect(index.getCardinality('nonexistent')).toBe(0)
      })

      it('should update after document changes', () => {
        const newIndex = new TagIndex()
        newIndex.add(1, { status: 'active' })
        expect(newIndex.getCardinality('status')).toBe(1)

        newIndex.add(2, { status: 'inactive' })
        expect(newIndex.getCardinality('status')).toBe(2)

        newIndex.add(3, { status: 'active' }) // Duplicate value
        expect(newIndex.getCardinality('status')).toBe(2) // Still 2
      })
    })

    describe('getTagStats', () => {
      it('should return stats for all tag keys', () => {
        const stats = index.getTagStats()
        expect(stats.get('region')?.cardinality).toBe(3)
        expect(stats.get('host')?.cardinality).toBe(2)
        expect(stats.get('metric')?.cardinality).toBe(3)
      })

      it('should include document counts per value', () => {
        const newIndex = new TagIndex()
        newIndex.add(1, { status: 'active' })
        newIndex.add(2, { status: 'active' })
        newIndex.add(3, { status: 'inactive' })

        const stats = newIndex.getTagStats()
        const statusStats = stats.get('status')
        expect(statusStats?.valueCounts.get('active')).toBe(2)
        expect(statusStats?.valueCounts.get('inactive')).toBe(1)
      })
    })
  })

  // ============================================================================
  // Time-series Use Cases
  // ============================================================================

  describe('time-series labels', () => {
    let index: TagIndex

    beforeEach(() => {
      index = new TagIndex()
      // Simulate metric series with labels
      index.add(1, { __name__: 'http_requests_total', method: 'GET', status: '200' })
      index.add(2, { __name__: 'http_requests_total', method: 'GET', status: '404' })
      index.add(3, { __name__: 'http_requests_total', method: 'POST', status: '200' })
      index.add(4, { __name__: 'node_cpu_seconds', cpu: '0', mode: 'user' })
      index.add(5, { __name__: 'node_cpu_seconds', cpu: '0', mode: 'system' })
      index.add(6, { __name__: 'node_cpu_seconds', cpu: '1', mode: 'user' })
    })

    it('should filter by metric name', () => {
      const results = index.query({ __name__: 'http_requests_total' })
      expect(results).toHaveLength(3)
    })

    it('should filter by metric name and label', () => {
      const results = index.query({
        __name__: 'http_requests_total',
        method: 'GET',
      })
      expect(results).toHaveLength(2)
    })

    it('should support PromQL-style exact match', () => {
      const results = index.query({
        __name__: 'http_requests_total',
        method: 'GET',
        status: '200',
      })
      expect(results).toHaveLength(1)
      expect(results).toContain(1)
    })

    it('should list all metric names', () => {
      const names = index.getValues('__name__')
      expect(names).toContain('http_requests_total')
      expect(names).toContain('node_cpu_seconds')
    })

    it('should get label values for a metric', () => {
      // First filter to metric, then get label values
      // This is a simplification - real implementation might need different API
      const cpuSeries = index.query({ __name__: 'node_cpu_seconds' })
      expect(cpuSeries).toHaveLength(3)
    })
  })

  // ============================================================================
  // Document Metadata Use Cases
  // ============================================================================

  describe('document metadata', () => {
    let index: TagIndex

    beforeEach(() => {
      index = new TagIndex()
      index.add(1, { type: 'article', category: 'tech', author: 'alice' })
      index.add(2, { type: 'article', category: 'tech', author: 'bob' })
      index.add(3, { type: 'article', category: 'science', author: 'alice' })
      index.add(4, { type: 'video', category: 'tech', author: 'charlie' })
      index.add(5, { type: 'podcast', category: 'tech', author: 'alice' })
    })

    it('should find all articles', () => {
      const results = index.query({ type: 'article' })
      expect(results).toHaveLength(3)
    })

    it('should find tech articles by alice', () => {
      const results = index.query({
        type: 'article',
        category: 'tech',
        author: 'alice',
      })
      expect(results).toHaveLength(1)
      expect(results).toContain(1)
    })

    it('should find all content by alice', () => {
      const results = index.query({ author: 'alice' })
      expect(results).toHaveLength(3)
    })

    it('should support OR for multiple types', () => {
      const results = index.queryOr([{ type: 'article' }, { type: 'video' }])
      expect(results).toHaveLength(4)
    })

    it('should enumerate categories', () => {
      const categories = index.getValues('category')
      expect(categories).toContain('tech')
      expect(categories).toContain('science')
    })
  })

  // ============================================================================
  // Serialization
  // ============================================================================

  describe('serialize and deserialize', () => {
    it('should round-trip empty index', () => {
      const index = new TagIndex()
      const bytes = index.serialize()
      const restored = TagIndex.deserialize(bytes)
      expect(restored.documentCount).toBe(0)
    })

    it('should round-trip index with documents', () => {
      const index = new TagIndex()
      index.add(1, { a: 'x', b: 'y' })
      index.add(2, { a: 'x', b: 'z' })

      const bytes = index.serialize()
      const restored = TagIndex.deserialize(bytes)

      expect(restored.documentCount).toBe(2)
      expect(restored.query({ a: 'x' })).toHaveLength(2)
      expect(restored.query({ b: 'y' })).toHaveLength(1)
    })

    it('should preserve tag enumeration after round-trip', () => {
      const index = new TagIndex()
      index.add(1, { region: 'us-east', host: 'server1' })
      index.add(2, { region: 'us-west', host: 'server2' })

      const bytes = index.serialize()
      const restored = TagIndex.deserialize(bytes)

      expect(restored.getKeys()).toEqual(['host', 'region'])
      expect(restored.getValues('region')).toEqual(['us-east', 'us-west'])
    })

    it('should handle large number of tags efficiently', () => {
      const index = new TagIndex()

      for (let i = 0; i < 1000; i++) {
        index.add(i, {
          id: `id_${i}`,
          bucket: `bucket_${i % 10}`,
          shard: `shard_${i % 100}`,
        })
      }

      const bytes = index.serialize()
      const restored = TagIndex.deserialize(bytes)

      expect(restored.documentCount).toBe(1000)
      expect(restored.getCardinality('bucket')).toBe(10)
      expect(restored.getCardinality('shard')).toBe(100)
    })
  })

  // ============================================================================
  // TagQuery Builder (Optional Advanced API)
  // ============================================================================

  describe('TagQuery', () => {
    let index: TagIndex

    beforeEach(() => {
      index = new TagIndex()
      index.add(1, { status: 'active', priority: 'high', region: 'us' })
      index.add(2, { status: 'active', priority: 'low', region: 'eu' })
      index.add(3, { status: 'inactive', priority: 'high', region: 'us' })
    })

    it('should support fluent query building', () => {
      const query = new TagQuery(index).where('status', 'active').where('region', 'us')

      const results = query.execute()
      expect(results).toHaveLength(1)
      expect(results).toContain(1)
    })

    it('should support OR with orWhere', () => {
      const query = new TagQuery(index).where('status', 'active').orWhere('priority', 'high')

      const results = query.execute()
      expect(results).toHaveLength(3) // All docs match one of the conditions
    })

    it('should support count without fetching IDs', () => {
      const query = new TagQuery(index).where('status', 'active')

      expect(query.count()).toBe(2)
    })

    it('should support exists check', () => {
      const activeQuery = new TagQuery(index).where('status', 'active')
      const missingQuery = new TagQuery(index).where('status', 'unknown')

      expect(activeQuery.exists()).toBe(true)
      expect(missingQuery.exists()).toBe(false)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle numeric-looking string values', () => {
      const index = new TagIndex()
      index.add(1, { port: '8080' })
      index.add(2, { port: '3000' })

      const results = index.query({ port: '8080' })
      expect(results).toContain(1)
      expect(results).not.toContain(2)
    })

    it('should handle boolean-looking string values', () => {
      const index = new TagIndex()
      index.add(1, { enabled: 'true' })
      index.add(2, { enabled: 'false' })

      expect(index.query({ enabled: 'true' })).toEqual([1])
      expect(index.query({ enabled: 'false' })).toEqual([2])
    })

    it('should handle very long tag values', () => {
      const index = new TagIndex()
      const longValue = 'a'.repeat(1000)
      index.add(1, { key: longValue })

      const results = index.query({ key: longValue })
      expect(results).toContain(1)
    })

    it('should handle documents with many tags', () => {
      const index = new TagIndex()
      const tags: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        tags[`key${i}`] = `value${i}`
      }
      index.add(1, tags)

      expect(index.query({ key50: 'value50' })).toContain(1)
      expect(index.getKeys()).toHaveLength(100)
    })

    it('should handle concurrent-looking operations', () => {
      const index = new TagIndex()

      // Simulate rapid add/query operations
      for (let i = 0; i < 100; i++) {
        index.add(i, { batch: String(i % 10) })
        const results = index.query({ batch: String(i % 10) })
        expect(results.length).toBeGreaterThan(0)
      }
    })
  })
})
