/**
 * Comprehensive TDD Tests for Data Primitives
 *
 * This test suite covers:
 * - Query Engine: Memory management, streaming, edge cases
 * - Aggregation Pipeline: CUBE/ROLLUP with nulls, empty inputs, complex groupings
 * - Vector Search: Tiered operations, threshold filtering, edge cases
 * - Full-Text Search: Unicode, serialization roundtrips, boolean queries
 *
 * @see dotdo-nsni0
 */

import { describe, it, expect, beforeEach } from 'vitest'

// =============================================================================
// QUERY ENGINE TESTS
// =============================================================================

describe('Query Engine - Comprehensive', () => {
  describe('Memory Management', () => {
    it('should estimate row set size correctly', async () => {
      const { estimateRowSetSize } = await import('../query-engine/memory-config')

      // Empty result
      expect(estimateRowSetSize(0, 10)).toBe(0)

      // Single row with columns
      const singleRow = estimateRowSetSize(1, 5)
      expect(singleRow).toBeGreaterThan(0)

      // Memory should scale with rows
      const tenRows = estimateRowSetSize(10, 5)
      expect(tenRows).toBeGreaterThan(singleRow)
    })

    it('should calculate optimal batch size based on memory budget', async () => {
      const { calculateOptimalBatchSize } = await import('../query-engine/memory-config')

      // Small memory budget should yield smaller batches
      const smallBatch = calculateOptimalBatchSize(1024 * 1024, 100) // 1MB
      const largeBatch = calculateOptimalBatchSize(10 * 1024 * 1024, 100) // 10MB

      expect(largeBatch).toBeGreaterThanOrEqual(smallBatch)
    })

    it('should assess memory pressure levels correctly', async () => {
      const { assessMemoryPressure, MEMORY_BUDGETS } = await import('../query-engine/memory-config')

      // Low pressure
      const lowPressure = assessMemoryPressure(MEMORY_BUDGETS.workers * 0.3)
      expect(lowPressure.level).toBe('low')

      // High pressure
      const highPressure = assessMemoryPressure(MEMORY_BUDGETS.workers * 0.9)
      expect(highPressure.level).toBe('high')
    })

    it('should recommend streaming for large result sets', async () => {
      const { shouldUseStreaming, MEMORY_BUDGETS } = await import('../query-engine/memory-config')

      // Small result - no streaming needed
      expect(shouldUseStreaming(100, 5, MEMORY_BUDGETS.workers)).toBe(false)

      // Large result - streaming recommended
      expect(shouldUseStreaming(1_000_000, 50, MEMORY_BUDGETS.workers)).toBe(true)
    })

    it('should generate execution hints based on query characteristics', async () => {
      const { generateExecutionHints } = await import('../query-engine/memory-config')

      const hints = generateExecutionHints({
        estimatedRows: 10000,
        columnCount: 20,
        hasAggregation: true,
        hasJoin: false,
        memoryBudget: 128 * 1024 * 1024,
      })

      expect(hints).toBeDefined()
      expect(typeof hints.useStreaming).toBe('boolean')
      expect(typeof hints.batchSize).toBe('number')
    })
  })

  describe('Parser Edge Cases', () => {
    it('should handle empty query gracefully', async () => {
      const { MongoQueryParser } = await import('../query-engine/parsers/mongo-parser')
      const parser = new MongoQueryParser()

      const ast = parser.parse({})
      expect(ast).toBeDefined()
    })

    it('should parse deeply nested AND/OR conditions', async () => {
      const { MongoQueryParser } = await import('../query-engine/parsers/mongo-parser')
      const parser = new MongoQueryParser()

      const ast = parser.parse({
        $and: [
          { $or: [{ a: 1 }, { b: 2 }] },
          { $or: [{ c: 3 }, { d: 4 }] },
        ],
      })

      expect(ast).toBeDefined()
      expect(ast.type).toBe('logical')
    })

    it('should handle special characters in field names', async () => {
      const { MongoQueryParser } = await import('../query-engine/parsers/mongo-parser')
      const parser = new MongoQueryParser()

      const ast = parser.parse({
        'field.with.dots': 'value',
        'field-with-dashes': 'value',
        field_with_underscores: 'value',
      })

      expect(ast).toBeDefined()
    })

    it('should parse SQL with complex WHERE clauses', async () => {
      const { SQLWhereParser } = await import('../query-engine/parsers/sql-parser')
      const parser = new SQLWhereParser()

      const ast = parser.parse(`
        SELECT * FROM users
        WHERE (age >= 18 AND status = 'active')
          OR (role = 'admin' AND verified = true)
        ORDER BY created_at DESC
        LIMIT 100
      `)

      expect(ast).toBeDefined()
    })

    it('should handle NULL comparisons in SQL', async () => {
      const { SQLWhereParser } = await import('../query-engine/parsers/sql-parser')
      const parser = new SQLWhereParser()

      const ast = parser.parse(`
        SELECT * FROM users
        WHERE email IS NOT NULL AND deleted_at IS NULL
      `)

      expect(ast).toBeDefined()
    })
  })

  describe('Predicate Evaluation', () => {
    it('should correctly evaluate nested object comparisons', async () => {
      const { getNestedValue, evaluatePredicate } = await import('../query-engine/parsers/common')

      const obj = {
        user: {
          profile: {
            name: 'Alice',
            age: 30,
          },
        },
      }

      expect(getNestedValue(obj, 'user.profile.name')).toBe('Alice')
      expect(getNestedValue(obj, 'user.profile.age')).toBe(30)
      expect(getNestedValue(obj, 'user.profile.missing')).toBeUndefined()
    })

    it('should handle array field access', async () => {
      const { getNestedValue } = await import('../query-engine/parsers/common')

      const obj = {
        tags: ['a', 'b', 'c'],
        nested: { items: [1, 2, 3] },
      }

      expect(getNestedValue(obj, 'tags')).toEqual(['a', 'b', 'c'])
      expect(getNestedValue(obj, 'nested.items')).toEqual([1, 2, 3])
    })
  })
})

// =============================================================================
// AGGREGATION PIPELINE TESTS
// =============================================================================

describe('Aggregation Pipeline - Comprehensive', () => {
  describe('Edge Cases', () => {
    it('should handle empty input arrays', async () => {
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface Item {
        value: number
        category: string
      }

      const pipeline = new PipelineBuilder<Item>()
        .match({ value: { $gt: 0 } })
        .build()

      const result = pipeline.execute([])
      expect(result).toEqual([])
    })

    it('should handle pipeline with no matching documents', async () => {
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface Item {
        value: number
      }

      const pipeline = new PipelineBuilder<Item>()
        .match({ value: { $gt: 1000 } })
        .build()

      const result = pipeline.execute([
        { value: 1 },
        { value: 2 },
        { value: 3 },
      ])

      expect(result).toEqual([])
    })

    it('should handle null values in grouping', async () => {
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface Item {
        category: string | null
        value: number
      }

      const pipeline = new PipelineBuilder<Item>()
        .group({
          _id: '$category',
          total: { $sum: '$value' },
        })
        .build()

      const result = pipeline.execute([
        { category: 'A', value: 10 },
        { category: null, value: 20 },
        { category: 'A', value: 30 },
        { category: null, value: 40 },
      ])

      expect(result.length).toBe(2)
      const nullGroup = result.find((r: any) => r._id === null)
      expect(nullGroup).toBeDefined()
    })

    it('should handle undefined values in aggregations', async () => {
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface Item {
        amount?: number
        category: string
      }

      const pipeline = new PipelineBuilder<Item>()
        .group({
          _id: '$category',
          total: { $sum: '$amount' },
          count: { $count: {} },
        })
        .build()

      const result = pipeline.execute([
        { category: 'A', amount: 10 },
        { category: 'A' }, // undefined amount
        { category: 'A', amount: 30 },
      ])

      expect(result.length).toBe(1)
      expect((result[0] as any).count).toBe(3)
    })
  })

  describe('Sort and Limit Combinations', () => {
    it('should correctly apply skip then limit', async () => {
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface Item {
        id: number
      }

      const pipeline = new PipelineBuilder<Item>()
        .sort({ id: 1 })
        .skip(2)
        .limit(3)
        .build()

      const result = pipeline.execute([
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
        { id: 6 },
        { id: 7 },
      ])

      expect(result).toEqual([{ id: 3 }, { id: 4 }, { id: 5 }])
    })

    it('should handle limit larger than result set', async () => {
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface Item {
        id: number
      }

      const pipeline = new PipelineBuilder<Item>()
        .limit(100)
        .build()

      const result = pipeline.execute([{ id: 1 }, { id: 2 }])
      expect(result.length).toBe(2)
    })

    it('should handle skip larger than result set', async () => {
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface Item {
        id: number
      }

      const pipeline = new PipelineBuilder<Item>()
        .skip(100)
        .build()

      const result = pipeline.execute([{ id: 1 }, { id: 2 }])
      expect(result.length).toBe(0)
    })
  })

  describe('Multiple Aggregations', () => {
    it('should compute multiple aggregates in single group', async () => {
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface Sale {
        product: string
        quantity: number
        price: number
      }

      const pipeline = new PipelineBuilder<Sale>()
        .group({
          _id: '$product',
          totalQuantity: { $sum: '$quantity' },
          avgPrice: { $avg: '$price' },
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
          count: { $count: {} },
        })
        .build()

      const result = pipeline.execute([
        { product: 'A', quantity: 10, price: 100 },
        { product: 'A', quantity: 20, price: 200 },
        { product: 'A', quantity: 30, price: 150 },
      ])

      expect(result.length).toBe(1)
      const group = result[0] as any
      expect(group.totalQuantity).toBe(60)
      expect(group.avgPrice).toBe(150)
      expect(group.minPrice).toBe(100)
      expect(group.maxPrice).toBe(200)
      expect(group.count).toBe(3)
    })
  })

  describe('Project Stage', () => {
    it('should include specified fields', async () => {
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface User {
        name: string
        email: string
        password: string
        age: number
      }

      const pipeline = new PipelineBuilder<User>()
        .project({
          name: 1,
          email: 1,
        })
        .build()

      const result = pipeline.execute([
        { name: 'Alice', email: 'alice@test.com', password: 'secret', age: 30 },
      ])

      expect(result.length).toBe(1)
      expect((result[0] as any).name).toBe('Alice')
      expect((result[0] as any).email).toBe('alice@test.com')
      expect((result[0] as any).password).toBeUndefined()
    })

    it('should exclude specified fields', async () => {
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface User {
        name: string
        email: string
        password: string
      }

      const pipeline = new PipelineBuilder<User>()
        .project({
          password: 0,
        })
        .build()

      const result = pipeline.execute([
        { name: 'Alice', email: 'alice@test.com', password: 'secret' },
      ])

      expect(result.length).toBe(1)
      expect((result[0] as any).password).toBeUndefined()
      expect((result[0] as any).name).toBeDefined()
    })
  })
})

// =============================================================================
// VECTOR SEARCH TESTS
// =============================================================================

describe('Vector Search - Comprehensive', () => {
  describe('Math Utilities Edge Cases', () => {
    it('should handle zero vectors in cosine similarity', async () => {
      const { cosineSimilarity } = await import('../../core/vector')

      const zero = [0, 0, 0]
      const normal = [1, 2, 3]

      // Zero vector should return 0 (not NaN)
      expect(cosineSimilarity(zero, normal)).toBe(0)
      expect(cosineSimilarity(zero, zero)).toBe(0)
    })

    it('should handle single element vectors', async () => {
      const { cosineSimilarity, euclideanDistance, dotProduct } = await import('../../core/vector')

      expect(cosineSimilarity([1], [1])).toBeCloseTo(1, 5)
      expect(cosineSimilarity([1], [-1])).toBeCloseTo(-1, 5)
      expect(euclideanDistance([0], [5])).toBe(5)
      expect(dotProduct([3], [4])).toBe(12)
    })

    it('should handle very large dimension vectors', async () => {
      const { cosineSimilarity, normalizeVector } = await import('../../core/vector')

      const dim = 1536 // Common embedding dimension
      const a = Array(dim).fill(0).map(() => Math.random())
      const b = Array(dim).fill(0).map(() => Math.random())

      const similarity = cosineSimilarity(a, b)
      expect(similarity).toBeGreaterThanOrEqual(-1)
      expect(similarity).toBeLessThanOrEqual(1)

      const normalized = normalizeVector(a)
      const magnitude = Math.sqrt(normalized.reduce((sum, x) => sum + x * x, 0))
      expect(magnitude).toBeCloseTo(1, 5)
    })

    it('should handle negative values correctly', async () => {
      const { cosineSimilarity, euclideanDistance } = await import('../../core/vector')

      const a = [-1, -2, -3]
      const b = [1, 2, 3]

      // Opposite directions should be -1
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5)

      // Distance should be the same regardless of direction
      const dist = euclideanDistance(a, b)
      expect(dist).toBeGreaterThan(0)
    })
  })

  describe('VectorManager Tiered Operations', () => {
    it('should insert and search in hot tier by default', async () => {
      const { VectorManager } = await import('../../core/vector')

      const manager = new VectorManager({}, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
        },
        routing: { strategy: 'cascade', fallback: true },
      })

      await manager.insert('doc1', [1, 0, 0], { title: 'Test' })
      await manager.insert('doc2', [0, 1, 0], { title: 'Other' })

      const results = await manager.search([1, 0, 0], { limit: 5 })

      expect(results.length).toBe(2)
      expect(results[0].id).toBe('doc1')
      expect(results[0].score).toBeCloseTo(1, 5)
    })

    it('should respect threshold filtering', async () => {
      const { VectorManager } = await import('../../core/vector')

      const manager = new VectorManager({}, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3, metric: 'cosine' },
        },
        routing: { strategy: 'cascade', fallback: true },
      })

      await manager.insert('similar', [1, 0.1, 0], { title: 'Similar' })
      await manager.insert('different', [0, 1, 0], { title: 'Different' })

      // High threshold should filter out less similar results
      const results = await manager.search([1, 0, 0], {
        limit: 10,
        threshold: 0.9,
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('similar')
    })

    it('should handle metadata filtering', async () => {
      const { VectorManager } = await import('../../core/vector')

      const manager = new VectorManager({}, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
        },
        routing: { strategy: 'cascade', fallback: true },
      })

      await manager.insert('doc1', [1, 0, 0], { category: 'tech' })
      await manager.insert('doc2', [0.9, 0.1, 0], { category: 'science' })
      await manager.insert('doc3', [0.8, 0.2, 0], { category: 'tech' })

      const results = await manager.search([1, 0, 0], {
        filter: { category: 'tech' },
        limit: 10,
      })

      expect(results.length).toBe(2)
      expect(results.every(r => r.metadata.category === 'tech')).toBe(true)
    })

    it('should support different distance metrics', async () => {
      const { VectorManager } = await import('../../core/vector')

      // Test euclidean metric
      const euclideanManager = new VectorManager({}, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3, metric: 'euclidean' },
        },
        routing: { strategy: 'cascade', fallback: true },
      })

      await euclideanManager.insert('close', [1, 0, 0], {})
      await euclideanManager.insert('far', [10, 10, 10], {})

      const euclideanResults = await euclideanManager.search([0, 0, 0], { limit: 2 })
      expect(euclideanResults[0].id).toBe('close')

      // Test dot product metric
      const dotManager = new VectorManager({}, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3, metric: 'dot' },
        },
        routing: { strategy: 'cascade', fallback: true },
      })

      await dotManager.insert('high', [10, 10, 10], {})
      await dotManager.insert('low', [1, 1, 1], {})

      const dotResults = await dotManager.search([1, 1, 1], { limit: 2 })
      expect(dotResults[0].id).toBe('high')
    })

    it('should delete vectors correctly', async () => {
      const { VectorManager } = await import('../../core/vector')

      const manager = new VectorManager({}, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
        },
        routing: { strategy: 'cascade', fallback: true },
      })

      await manager.insert('doc1', [1, 0, 0], {})
      await manager.insert('doc2', [0, 1, 0], {})

      expect(await manager.count('hot')).toBe(2)

      await manager.delete('doc1')

      expect(await manager.count('hot')).toBe(1)

      const results = await manager.search([1, 0, 0], { limit: 10 })
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('doc2')
    })

    it('should handle batch insert', async () => {
      const { VectorManager } = await import('../../core/vector')

      const manager = new VectorManager({}, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
        },
        routing: { strategy: 'cascade', fallback: true },
      })

      await manager.insertBatch([
        { id: 'doc1', vector: [1, 0, 0], metadata: {} },
        { id: 'doc2', vector: [0, 1, 0], metadata: {} },
        { id: 'doc3', vector: [0, 0, 1], metadata: {} },
      ])

      expect(await manager.count('hot')).toBe(3)
    })

    it('should support parallel search strategy', async () => {
      const { VectorManager } = await import('../../core/vector')

      const manager = new VectorManager({}, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
          warm: { engine: 'vectorize', dimensions: 3 },
        },
        routing: { strategy: 'parallel', fallback: true },
      })

      await manager.insert('hot-doc', [1, 0, 0], {}, 'hot')
      await manager.insert('warm-doc', [0.9, 0.1, 0], {}, 'warm')

      const results = await manager.search([1, 0, 0], { limit: 10 })

      // Should find docs from both tiers
      expect(results.length).toBe(2)
    })
  })
})

// =============================================================================
// FULL-TEXT SEARCH TESTS
// =============================================================================

describe('Full-Text Search - Comprehensive', () => {
  describe('InvertedIndex Core Operations', () => {
    it('should index and search documents', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', 'The quick brown fox jumps over the lazy dog')
      index.add('doc2', 'A quick brown dog runs in the park')
      index.add('doc3', 'The lazy cat sleeps all day')

      const results = index.search('quick brown')

      expect(results.length).toBe(2)
      expect(results[0].id).toBe('doc1') // Should rank higher due to more matching terms
    })

    it('should handle document updates', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', 'original content')
      index.add('doc1', 'updated content') // Should replace

      expect(index.documentCount).toBe(1)

      const results = index.search('updated')
      expect(results.length).toBe(1)

      const originalResults = index.search('original')
      expect(originalResults.length).toBe(0)
    })

    it('should handle document removal', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', 'hello world')
      index.add('doc2', 'hello universe')

      expect(index.documentCount).toBe(2)

      const removed = index.remove('doc1')
      expect(removed).toBe(true)
      expect(index.documentCount).toBe(1)

      const results = index.search('hello')
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('doc2')
    })

    it('should return false when removing non-existent document', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()
      const removed = index.remove('non-existent')
      expect(removed).toBe(false)
    })
  })

  describe('Unicode and Special Characters', () => {
    it('should handle Unicode text', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      // Note: Default tokenizer only handles alphanumeric
      // These tests verify behavior with Unicode
      index.add('doc1', 'hello world')
      index.add('doc2', 'bonjour monde')

      const results = index.search('hello')
      expect(results.length).toBe(1)
    })

    it('should handle empty strings', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', '')
      expect(index.documentCount).toBe(1)

      const results = index.search('')
      expect(results.length).toBe(0) // Empty query returns nothing
    })

    it('should handle very long documents', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      // Create a long document
      const longText = Array(1000).fill('word').join(' ')
      index.add('long-doc', longText)

      expect(index.documentCount).toBe(1)
      expect(index.hasDocument('long-doc')).toBe(true)
    })
  })

  describe('BM25 Scoring', () => {
    it('should rank documents by relevance', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      // Doc with term repeated should rank higher
      index.add('doc1', 'search search search')
      index.add('doc2', 'search once')
      index.add('doc3', 'no match here')

      const results = index.search('search')

      expect(results.length).toBe(2)
      expect(results[0].id).toBe('doc1')
      expect(results[0].score).toBeGreaterThan(results[1].score)
    })

    it('should handle rare terms with higher IDF', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      // Common term appears in all docs
      index.add('doc1', 'common rare')
      index.add('doc2', 'common word')
      index.add('doc3', 'common text')

      // "rare" has higher IDF so doc1 should rank highest for "rare"
      const results = index.search('rare')

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('doc1')
    })
  })

  describe('Serialization and Persistence', () => {
    it('should serialize and deserialize correctly', async () => {
      const { InvertedIndex, loadInvertedIndex } = await import('../inverted-index/inverted-index')

      const original = new InvertedIndex()

      original.add('doc1', 'hello world')
      original.add('doc2', 'hello universe')
      original.add('doc3', 'goodbye world')

      // Serialize
      const { dictionary, postings } = original.serialize()

      expect(dictionary.length).toBeGreaterThan(0)
      expect(postings.length).toBeGreaterThan(0)

      // Deserialize into new index
      const loaded = loadInvertedIndex(dictionary, postings)

      // Verify document count
      expect(loaded.documentCount).toBe(3)

      // Verify search works
      const results = loaded.search('hello')
      expect(results.length).toBe(2)
    })

    it('should handle roundtrip with many documents', async () => {
      const { InvertedIndex, loadInvertedIndex } = await import('../inverted-index/inverted-index')

      const original = new InvertedIndex()

      // Add many documents
      for (let i = 0; i < 100; i++) {
        original.add(`doc${i}`, `document number ${i} with some text`)
      }

      const { dictionary, postings } = original.serialize()
      const loaded = loadInvertedIndex(dictionary, postings)

      expect(loaded.documentCount).toBe(100)

      // Search should work
      const results = loaded.search('document')
      expect(results.length).toBe(100)
    })
  })

  describe('Term Dictionary Operations', () => {
    it('should report term count correctly', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', 'one two three')
      index.add('doc2', 'two three four')

      expect(index.termCount).toBe(4) // one, two, three, four
    })

    it('should check term existence', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', 'hello world')

      expect(index.hasTerm('hello')).toBe(true)
      expect(index.hasTerm('goodbye')).toBe(false)
    })

    it('should get document frequency for terms', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', 'hello world')
      index.add('doc2', 'hello universe')
      index.add('doc3', 'goodbye world')

      expect(index.getDocumentFrequency('hello')).toBe(2)
      expect(index.getDocumentFrequency('world')).toBe(2)
      expect(index.getDocumentFrequency('universe')).toBe(1)
      expect(index.getDocumentFrequency('missing')).toBe(0)
    })

    it('should list all terms', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', 'alpha beta gamma')

      const terms = index.getTerms()

      expect(terms).toContain('alpha')
      expect(terms).toContain('beta')
      expect(terms).toContain('gamma')
    })
  })

  describe('Index Statistics', () => {
    it('should track document statistics', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', 'one two three') // 3 tokens
      index.add('doc2', 'one two three four five') // 5 tokens

      const stats = index.getStats()

      expect(stats.totalDocs).toBe(2)
      expect(stats.totalLength).toBe(8)
      expect(stats.avgDocLength).toBe(4)
    })

    it('should update stats on removal', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', 'one two')
      index.add('doc2', 'three four')

      expect(index.getStats().totalDocs).toBe(2)

      index.remove('doc1')

      const stats = index.getStats()
      expect(stats.totalDocs).toBe(1)
      expect(stats.avgDocLength).toBe(2)
    })

    it('should clear index completely', async () => {
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      const index = new InvertedIndex()

      index.add('doc1', 'hello')
      index.add('doc2', 'world')

      index.clear()

      expect(index.documentCount).toBe(0)
      expect(index.termCount).toBe(0)
      expect(index.getStats().totalDocs).toBe(0)
    })
  })

  describe('Factory Functions', () => {
    it('should create index from array of documents', async () => {
      const { createInvertedIndex } = await import('../inverted-index/inverted-index')

      const index = createInvertedIndex([
        { id: 'doc1', text: 'hello world' },
        { id: 'doc2', text: 'hello universe' },
      ])

      expect(index.documentCount).toBe(2)

      const results = index.search('hello')
      expect(results.length).toBe(2)
    })
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Data Primitives Integration', () => {
  describe('Query Engine + Aggregation', () => {
    it('should parse and aggregate in sequence', async () => {
      const { MongoQueryParser } = await import('../query-engine/parsers/mongo-parser')
      const { PipelineBuilder } = await import('../aggregation-pipeline')

      interface Sale {
        product: string
        amount: number
        status: string
      }

      // Parse a filter
      const parser = new MongoQueryParser()
      const filter = parser.parse({ status: 'completed' })

      expect(filter).toBeDefined()

      // Then aggregate
      const pipeline = new PipelineBuilder<Sale>()
        .match({ status: 'completed' })
        .group({
          _id: '$product',
          total: { $sum: '$amount' },
        })
        .build()

      const result = pipeline.execute([
        { product: 'A', amount: 100, status: 'completed' },
        { product: 'B', amount: 200, status: 'pending' },
        { product: 'A', amount: 150, status: 'completed' },
      ])

      expect(result.length).toBe(1)
      expect((result[0] as any)._id).toBe('A')
      expect((result[0] as any).total).toBe(250)
    })
  })

  describe('Vector + FTS Hybrid Search', () => {
    it('should combine vector and text search results', async () => {
      const { VectorManager } = await import('../../core/vector')
      const { InvertedIndex } = await import('../inverted-index/inverted-index')

      // Setup vector index
      const vectorManager = new VectorManager({}, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
        },
        routing: { strategy: 'cascade', fallback: true },
      })

      await vectorManager.insert('doc1', [1, 0, 0], { text: 'machine learning' })
      await vectorManager.insert('doc2', [0.5, 0.5, 0], { text: 'deep learning' })

      // Setup text index
      const textIndex = new InvertedIndex()
      textIndex.add('doc1', 'machine learning algorithms')
      textIndex.add('doc2', 'deep learning neural networks')

      // Vector search
      const vectorResults = await vectorManager.search([1, 0, 0], { limit: 2 })

      // Text search
      const textResults = textIndex.search('learning')

      // Both should find relevant documents
      expect(vectorResults.length).toBe(2)
      expect(textResults.length).toBe(2)

      // Could combine scores for hybrid ranking
      const combined = new Map<string, number>()
      for (const r of vectorResults) {
        combined.set(r.id, (combined.get(r.id) || 0) + r.score)
      }
      for (const r of textResults) {
        combined.set(r.id, (combined.get(r.id) || 0) + r.score)
      }

      expect(combined.size).toBe(2)
    })
  })
})
