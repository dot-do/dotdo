/**
 * Filtered Vector Search Tests
 *
 * RED phase TDD tests for filtered HNSW index with metadata filtering.
 * Tests define expected behavior for MongoDB-like query operators on vector metadata.
 *
 * @module db/edgevec/tests/filtered-search.test
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  createFilteredIndex,
  FilteredHNSWIndexImpl,
  type FilteredHNSWIndex,
  type MetadataFilter,
  type FilteredSearchOptions,
} from '../filtered-search'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate a random normalized vector
 */
function randomVector(dim: number): Float32Array {
  const v = new Float32Array(dim)
  let norm = 0
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() * 2 - 1
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dim; i++) {
    v[i] /= norm
  }
  return v
}

/**
 * Generate a reproducible vector based on seed
 */
function seededVector(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim)
  let norm = 0
  for (let i = 0; i < dim; i++) {
    // Simple PRNG
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    v[i] = (seed / 0x7fffffff) * 2 - 1
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dim; i++) {
    v[i] /= norm
  }
  return v
}

// ============================================================================
// TEST DATA FACTORY
// ============================================================================

interface TestDocument {
  id: string
  vector: Float32Array
  metadata: Record<string, unknown>
}

/**
 * Create a test dataset with various metadata types
 */
function createTestDataset(count: number = 100): TestDocument[] {
  const categories = ['electronics', 'clothing', 'books', 'food', 'sports']
  const brands = ['acme', 'globex', 'initech', 'umbrella', 'wayne']
  const tags = ['sale', 'new', 'popular', 'limited', 'clearance']

  return Array.from({ length: count }, (_, i) => ({
    id: `doc-${i}`,
    vector: seededVector(128, i),
    metadata: {
      category: categories[i % categories.length],
      brand: brands[i % brands.length],
      price: 10 + (i % 100) * 5, // 10 to 505
      rating: 1 + (i % 5), // 1 to 5
      inStock: i % 3 !== 0,
      quantity: i % 20,
      tags: [tags[i % tags.length], tags[(i + 2) % tags.length]],
      createdAt: new Date(2024, 0, 1 + (i % 365)).toISOString(),
      discount: i % 4 === 0 ? null : i % 10,
      description: i % 5 === 0 ? undefined : `Item ${i} description`,
    },
  }))
}

/**
 * Populate index with test documents
 */
function populateIndex(index: FilteredHNSWIndex, docs: TestDocument[]): void {
  for (const doc of docs) {
    index.insert(doc.id, doc.vector, doc.metadata)
  }
}

// ============================================================================
// BASIC FILTER OPERATION TESTS
// ============================================================================

describe('Filtered Search - Basic Equality Filters', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('filters by string equality (shorthand)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { category: 'electronics' },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('electronics')
    })
  })

  it('filters by string equality ($eq operator)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { brand: { $eq: 'acme' } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.brand).toBe('acme')
    })
  })

  it('filters by number equality', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { rating: 5 },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.rating).toBe(5)
    })
  })

  it('filters by boolean equality', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { inStock: true },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.inStock).toBe(true)
    })
  })

  it('filters by not-equal ($ne operator)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { category: { $ne: 'electronics' } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).not.toBe('electronics')
    })
  })
})

// ============================================================================
// NUMERIC COMPARISON FILTER TESTS
// ============================================================================

describe('Filtered Search - Numeric Comparisons', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('filters by greater than ($gt)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { price: { $gt: 200 } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.price).toBeGreaterThan(200)
    })
  })

  it('filters by greater than or equal ($gte)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { price: { $gte: 200 } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.price).toBeGreaterThanOrEqual(200)
    })
  })

  it('filters by less than ($lt)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { price: { $lt: 50 } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.price).toBeLessThan(50)
    })
  })

  it('filters by less than or equal ($lte)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { price: { $lte: 50 } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.price).toBeLessThanOrEqual(50)
    })
  })

  it('filters by range (combined $gt and $lt)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { price: { $gt: 100, $lt: 200 } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.price).toBeGreaterThan(100)
      expect(meta?.price).toBeLessThan(200)
    })
  })

  it('filters by inclusive range (combined $gte and $lte)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { price: { $gte: 100, $lte: 200 } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.price).toBeGreaterThanOrEqual(100)
      expect(meta?.price).toBeLessThanOrEqual(200)
    })
  })

  it('returns empty when no documents match numeric filter', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { price: { $gt: 10000 } }, // No documents have price > 10000
    })

    expect(results).toHaveLength(0)
  })
})

// ============================================================================
// MULTI-VALUE FILTER TESTS ($in / $nin)
// ============================================================================

describe('Filtered Search - Multi-Value Filters', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('filters by $in operator with strings', () => {
    const query = randomVector(128)
    const targetCategories = ['electronics', 'books']
    const results = index.search(query, {
      k: 50,
      filter: { category: { $in: targetCategories } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(targetCategories).toContain(meta?.category)
    })
  })

  it('filters by $in operator with numbers', () => {
    const query = randomVector(128)
    const targetRatings = [4, 5]
    const results = index.search(query, {
      k: 50,
      filter: { rating: { $in: targetRatings } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(targetRatings).toContain(meta?.rating)
    })
  })

  it('filters by $nin operator (not in array)', () => {
    const query = randomVector(128)
    const excludedCategories = ['electronics', 'clothing']
    const results = index.search(query, {
      k: 50,
      filter: { category: { $nin: excludedCategories } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(excludedCategories).not.toContain(meta?.category)
    })
  })

  it('filters by $in with single value (equivalent to $eq)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { brand: { $in: ['acme'] } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.brand).toBe('acme')
    })
  })

  it('returns empty when $in array has no matches', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { category: { $in: ['nonexistent1', 'nonexistent2'] } },
    })

    expect(results).toHaveLength(0)
  })
})

// ============================================================================
// ARRAY CONTAINS FILTER TESTS ($contains)
// ============================================================================

describe('Filtered Search - Array Contains ($contains)', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('filters by array contains single value', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { tags: { $contains: 'sale' } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.tags).toContain('sale')
    })
  })

  it('returns false when field is not an array', () => {
    const query = randomVector(128)
    // category is a string, not an array
    const results = index.search(query, {
      k: 50,
      filter: { category: { $contains: 'elec' } },
    })

    // Should return empty because $contains requires array field
    expect(results).toHaveLength(0)
  })

  it('returns empty when value not found in any array', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { tags: { $contains: 'nonexistent-tag' } },
    })

    expect(results).toHaveLength(0)
  })
})

// ============================================================================
// EXISTENCE FILTER TESTS ($exists)
// ============================================================================

describe('Filtered Search - Field Existence ($exists)', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('filters by field exists ($exists: true)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { description: { $exists: true } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.description).toBeDefined()
    })
  })

  it('filters by field does not exist ($exists: false)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { description: { $exists: false } },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.description).toBeUndefined()
    })
  })

  it('handles $exists on field that never exists', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { nonexistentField: { $exists: true } },
    })

    // No documents have this field
    expect(results).toHaveLength(0)
  })

  it('handles $exists: false on field that always exists', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { category: { $exists: false } },
    })

    // All documents have category
    expect(results).toHaveLength(0)
  })
})

// ============================================================================
// NULL/UNDEFINED HANDLING TESTS
// ============================================================================

describe('Filtered Search - Null/Undefined Handling', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('filters for null values explicitly', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { discount: null },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.discount).toBeNull()
    })
  })

  it('filters for undefined values explicitly', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { description: undefined },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.description).toBeUndefined()
    })
  })

  it('distinguishes null from undefined', () => {
    const query = randomVector(128)

    // Filter for null discount
    const nullResults = index.search(query, {
      k: 100,
      filter: { discount: null },
    })

    // Filter for undefined description
    const undefinedResults = index.search(query, {
      k: 100,
      filter: { description: undefined },
    })

    // These should be different sets (some overlap possible but not identical)
    const nullIds = new Set(nullResults.map(r => r.id))
    const undefinedIds = new Set(undefinedResults.map(r => r.id))

    // Verify null results have null discount
    nullResults.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.discount).toBeNull()
    })

    // Verify undefined results have undefined description
    undefinedResults.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.description).toBeUndefined()
    })
  })

  it('handles documents without metadata gracefully', () => {
    // Insert a document without metadata
    index.insert('no-meta', randomVector(128))

    const query = randomVector(128)
    const results = index.search(query, {
      k: 100,
      filter: { category: 'electronics' },
    })

    // Document without metadata should NOT appear in filtered results
    const resultIds = results.map(r => r.id)
    expect(resultIds).not.toContain('no-meta')
  })
})

// ============================================================================
// COMPOUND FILTER TESTS ($and / $or / $not)
// ============================================================================

describe('Filtered Search - Compound Filters ($and)', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('combines filters with explicit $and', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        $and: [
          { category: 'electronics' },
          { inStock: true },
        ],
      },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('electronics')
      expect(meta?.inStock).toBe(true)
    })
  })

  it('combines multiple field filters implicitly (AND behavior)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        category: 'electronics',
        inStock: true,
        rating: { $gte: 3 },
      },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('electronics')
      expect(meta?.inStock).toBe(true)
      expect(meta?.rating).toBeGreaterThanOrEqual(3)
    })
  })

  it('handles nested $and with multiple conditions', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        $and: [
          { price: { $gte: 50, $lte: 150 } },
          { rating: { $in: [4, 5] } },
          { inStock: true },
        ],
      },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.price).toBeGreaterThanOrEqual(50)
      expect(meta?.price).toBeLessThanOrEqual(150)
      expect([4, 5]).toContain(meta?.rating)
      expect(meta?.inStock).toBe(true)
    })
  })

  it('returns empty when $and conditions are mutually exclusive', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        $and: [
          { category: 'electronics' },
          { category: 'books' }, // Same field, different value
        ],
      },
    })

    expect(results).toHaveLength(0)
  })
})

describe('Filtered Search - Compound Filters ($or)', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('combines filters with $or', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        $or: [
          { category: 'electronics' },
          { category: 'books' },
        ],
      },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(['electronics', 'books']).toContain(meta?.category)
    })
  })

  it('handles $or with different field conditions', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        $or: [
          { price: { $lt: 20 } },
          { rating: 5 },
        ],
      },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      const matchesPrice = (meta?.price as number) < 20
      const matchesRating = meta?.rating === 5
      expect(matchesPrice || matchesRating).toBe(true)
    })
  })

  it('handles empty $or array (should match nothing)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { $or: [] },
    })

    // Empty $or should match nothing (no conditions to satisfy)
    expect(results).toHaveLength(0)
  })

  it('handles single condition in $or (equivalent to direct filter)', () => {
    const query = randomVector(128)
    const orResults = index.search(query, {
      k: 50,
      filter: { $or: [{ category: 'electronics' }] },
    })

    const directResults = index.search(query, {
      k: 50,
      filter: { category: 'electronics' },
    })

    expect(orResults.map(r => r.id).sort()).toEqual(
      directResults.map(r => r.id).sort()
    )
  })
})

describe('Filtered Search - Compound Filters ($not)', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('negates a simple filter with $not', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        $not: { category: 'electronics' },
      },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).not.toBe('electronics')
    })
  })

  it('negates a compound filter with $not', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        $not: {
          $and: [
            { category: 'electronics' },
            { inStock: true },
          ],
        },
      },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      // Should NOT match both conditions
      const isElectronicsInStock = meta?.category === 'electronics' && meta?.inStock === true
      expect(isElectronicsInStock).toBe(false)
    })
  })

  it('combines $not with other filters', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        rating: { $gte: 4 },
        $not: { category: 'electronics' },
      },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.rating).toBeGreaterThanOrEqual(4)
      expect(meta?.category).not.toBe('electronics')
    })
  })

  it('handles double negation ($not within $not)', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        $not: {
          $not: { category: 'electronics' },
        },
      },
    })

    expect(results.length).toBeGreaterThan(0)
    // Double negation should equal original
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('electronics')
    })
  })
})

describe('Filtered Search - Complex Nested Filters', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('handles deeply nested AND/OR combinations', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        $and: [
          {
            $or: [
              { category: 'electronics' },
              { category: 'books' },
            ],
          },
          {
            $or: [
              { price: { $lt: 50 } },
              { rating: 5 },
            ],
          },
        ],
      },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      const matchesCategory = meta?.category === 'electronics' || meta?.category === 'books'
      const matchesPriceOrRating = (meta?.price as number) < 50 || meta?.rating === 5
      expect(matchesCategory && matchesPriceOrRating).toBe(true)
    })
  })

  it('handles $or containing $and', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        $or: [
          {
            $and: [
              { category: 'electronics' },
              { price: { $lt: 100 } },
            ],
          },
          {
            $and: [
              { category: 'books' },
              { rating: 5 },
            ],
          },
        ],
      },
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      const isCheapElectronics = meta?.category === 'electronics' && (meta?.price as number) < 100
      const isTopRatedBooks = meta?.category === 'books' && meta?.rating === 5
      expect(isCheapElectronics || isTopRatedBooks).toBe(true)
    })
  })
})

// ============================================================================
// FILTER MODE TESTS (pre vs post filtering)
// ============================================================================

describe('Filtered Search - Filter Modes', () => {
  let index: FilteredHNSWIndex
  let testDocs: TestDocument[]

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
    testDocs = createTestDataset(100)
    populateIndex(index, testDocs)
  })

  it('supports explicit post-filter mode', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 20,
      filter: { category: 'electronics' },
      filterMode: 'post',
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('electronics')
    })
  })

  it('supports explicit pre-filter mode', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 20,
      filter: { category: 'electronics' },
      filterMode: 'pre',
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('electronics')
    })
  })

  it('auto mode produces same filtered results as explicit modes', () => {
    const query = seededVector(128, 42)

    const autoResults = index.search(query, {
      k: 20,
      filter: { category: 'electronics' },
      filterMode: 'auto',
    })

    const postResults = index.search(query, {
      k: 20,
      filter: { category: 'electronics' },
      filterMode: 'post',
    })

    // Results should be filtered correctly regardless of mode
    // (exact ranking may vary due to different search strategies)
    autoResults.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('electronics')
    })

    postResults.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('electronics')
    })
  })

  it('pre-filter handles selective filters efficiently', () => {
    // Add more documents to test selectivity
    for (let i = 100; i < 500; i++) {
      const meta = { category: i < 110 ? 'rare' : 'common' }
      index.insert(`extra-${i}`, seededVector(128, i), meta)
    }

    const query = randomVector(128)
    const results = index.search(query, {
      k: 10,
      filter: { category: 'rare' },
      filterMode: 'pre',
    })

    // Should find results even with highly selective filter
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(10)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('rare')
    })
  })
})

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('Filtered Search - Edge Cases', () => {
  let index: FilteredHNSWIndex

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
  })

  it('handles empty index with filter', () => {
    const query = randomVector(128)
    const results = index.search(query, {
      k: 10,
      filter: { category: 'electronics' },
    })

    expect(results).toHaveLength(0)
  })

  it('handles filter that matches all documents', () => {
    // Insert documents where all match filter
    for (let i = 0; i < 50; i++) {
      index.insert(`doc-${i}`, seededVector(128, i), { type: 'item' })
    }

    const query = randomVector(128)
    const results = index.search(query, {
      k: 20,
      filter: { type: 'item' },
    })

    expect(results).toHaveLength(20)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.type).toBe('item')
    })
  })

  it('handles filter that matches no documents', () => {
    for (let i = 0; i < 50; i++) {
      index.insert(`doc-${i}`, seededVector(128, i), { type: 'item' })
    }

    const query = randomVector(128)
    const results = index.search(query, {
      k: 20,
      filter: { type: 'nonexistent' },
    })

    expect(results).toHaveLength(0)
  })

  it('handles search without filter (should return all eligible)', () => {
    for (let i = 0; i < 50; i++) {
      index.insert(`doc-${i}`, seededVector(128, i), { type: 'item' })
    }

    const query = randomVector(128)
    const resultsWithoutFilter = index.search(query, { k: 20 })
    const resultsWithEmptyOptions = index.search(query, { k: 20, filter: undefined })

    expect(resultsWithoutFilter).toHaveLength(20)
    expect(resultsWithEmptyOptions).toHaveLength(20)
  })

  it('handles k larger than matching documents', () => {
    for (let i = 0; i < 100; i++) {
      index.insert(`doc-${i}`, seededVector(128, i), {
        category: i < 5 ? 'rare' : 'common'
      })
    }

    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: { category: 'rare' },
    })

    // Should return only 5 results (all matching documents)
    expect(results).toHaveLength(5)
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('rare')
    })
  })

  it('handles very restrictive combined filters', () => {
    for (let i = 0; i < 1000; i++) {
      index.insert(`doc-${i}`, seededVector(128, i), {
        category: ['a', 'b', 'c', 'd', 'e'][i % 5],
        status: i % 10 === 0 ? 'active' : 'inactive',
        score: i % 100,
      })
    }

    const query = randomVector(128)
    const results = index.search(query, {
      k: 50,
      filter: {
        category: 'a',
        status: 'active',
        score: { $gte: 50, $lt: 60 },
      },
    })

    // Very restrictive - may match few or none
    results.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('a')
      expect(meta?.status).toBe('active')
      expect(meta?.score).toBeGreaterThanOrEqual(50)
      expect(meta?.score).toBeLessThan(60)
    })
  })

  it('handles special characters in string values', () => {
    index.insert('doc-special', randomVector(128), {
      name: "O'Brien & Co.",
      description: 'Contains "quotes" and\nnewlines',
      path: '/path/to/file.txt',
    })

    const query = randomVector(128)

    const results1 = index.search(query, {
      k: 10,
      filter: { name: "O'Brien & Co." },
    })
    expect(results1.length).toBe(1)

    const results2 = index.search(query, {
      k: 10,
      filter: { path: '/path/to/file.txt' },
    })
    expect(results2.length).toBe(1)
  })

  it('handles numeric edge values (zero, negative, float)', () => {
    index.insert('zero', randomVector(128), { value: 0 })
    index.insert('negative', randomVector(128), { value: -100 })
    index.insert('float', randomVector(128), { value: 3.14159 })
    index.insert('large', randomVector(128), { value: Number.MAX_SAFE_INTEGER })
    index.insert('small', randomVector(128), { value: Number.MIN_SAFE_INTEGER })

    const query = randomVector(128)

    // Test zero
    const zeroResults = index.search(query, {
      k: 10,
      filter: { value: 0 },
    })
    expect(zeroResults.map(r => r.id)).toContain('zero')

    // Test negative
    const negResults = index.search(query, {
      k: 10,
      filter: { value: { $lt: 0 } },
    })
    expect(negResults.map(r => r.id)).toContain('negative')
    expect(negResults.map(r => r.id)).toContain('small')

    // Test float comparison
    const floatResults = index.search(query, {
      k: 10,
      filter: { value: { $gt: 3, $lt: 4 } },
    })
    expect(floatResults.map(r => r.id)).toContain('float')
  })
})

// ============================================================================
// METADATA OPERATIONS TESTS
// ============================================================================

describe('Filtered Search - Metadata Operations', () => {
  let index: FilteredHNSWIndex

  beforeEach(() => {
    index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })
  })

  it('inserts vectors with metadata', () => {
    index.insert('doc-1', randomVector(128), { category: 'test', score: 42 })

    const meta = index.getMetadata('doc-1')
    expect(meta).toEqual({ category: 'test', score: 42 })
  })

  it('returns undefined metadata for non-existent document', () => {
    const meta = index.getMetadata('nonexistent')
    expect(meta).toBeUndefined()
  })

  it('updates metadata completely', () => {
    index.insert('doc-1', randomVector(128), { category: 'old', score: 10 })

    index.updateMetadata('doc-1', { category: 'new', rating: 5 })

    const meta = index.getMetadata('doc-1')
    expect(meta).toEqual({ category: 'new', rating: 5 })
    expect(meta?.score).toBeUndefined() // Old field removed
  })

  it('patches metadata (merges)', () => {
    index.insert('doc-1', randomVector(128), { category: 'test', score: 10 })

    index.patchMetadata('doc-1', { rating: 5, score: 20 })

    const meta = index.getMetadata('doc-1')
    expect(meta?.category).toBe('test') // Unchanged
    expect(meta?.score).toBe(20) // Updated
    expect(meta?.rating).toBe(5) // Added
  })

  it('throws when updating metadata for non-existent document', () => {
    expect(() => {
      index.updateMetadata('nonexistent', { foo: 'bar' })
    }).toThrow(/not found/)
  })

  it('throws when patching metadata for non-existent document', () => {
    expect(() => {
      index.patchMetadata('nonexistent', { foo: 'bar' })
    }).toThrow(/not found/)
  })

  it('deletes metadata when document is deleted', () => {
    index.insert('doc-1', randomVector(128), { category: 'test' })

    expect(index.getMetadata('doc-1')).toBeDefined()

    index.delete('doc-1')

    expect(index.getMetadata('doc-1')).toBeUndefined()
  })

  it('returns copy of metadata (not reference)', () => {
    index.insert('doc-1', randomVector(128), { category: 'test' })

    const meta1 = index.getMetadata('doc-1')
    meta1!.category = 'modified'

    const meta2 = index.getMetadata('doc-1')
    expect(meta2?.category).toBe('test') // Should be unchanged
  })

  it('searches respect updated metadata', () => {
    index.insert('doc-1', seededVector(128, 1), { category: 'old' })

    const query = seededVector(128, 1) // Similar to doc-1

    // Should find with old category
    const results1 = index.search(query, {
      k: 10,
      filter: { category: 'old' },
    })
    expect(results1.map(r => r.id)).toContain('doc-1')

    // Update metadata
    index.updateMetadata('doc-1', { category: 'new' })

    // Should NOT find with old category
    const results2 = index.search(query, {
      k: 10,
      filter: { category: 'old' },
    })
    expect(results2.map(r => r.id)).not.toContain('doc-1')

    // Should find with new category
    const results3 = index.search(query, {
      k: 10,
      filter: { category: 'new' },
    })
    expect(results3.map(r => r.id)).toContain('doc-1')
  })
})

// ============================================================================
// SERIALIZATION WITH METADATA TESTS
// ============================================================================

describe('Filtered Search - Serialization', () => {
  it('serializes and deserializes index with metadata', () => {
    const original = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })

    for (let i = 0; i < 50; i++) {
      original.insert(`doc-${i}`, seededVector(128, i), {
        category: ['a', 'b', 'c'][i % 3],
        score: i * 10,
        tags: ['tag1', 'tag2'],
      })
    }

    const serialized = original.serialize()
    const restored = FilteredHNSWIndexImpl.deserialize(serialized)

    expect(restored.size()).toBe(50)

    // Verify metadata preserved
    for (let i = 0; i < 50; i++) {
      const meta = restored.getMetadata(`doc-${i}`)
      expect(meta?.category).toBe(['a', 'b', 'c'][i % 3])
      expect(meta?.score).toBe(i * 10)
      expect(meta?.tags).toEqual(['tag1', 'tag2'])
    }
  })

  it('filtered search works after deserialization', () => {
    const original = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })

    for (let i = 0; i < 50; i++) {
      original.insert(`doc-${i}`, seededVector(128, i), {
        category: i < 10 ? 'special' : 'normal',
      })
    }

    const serialized = original.serialize()
    const restored = FilteredHNSWIndexImpl.deserialize(serialized)

    const query = randomVector(128)
    const results = restored.search(query, {
      k: 20,
      filter: { category: 'special' },
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(10) // Only 10 'special' docs
    results.forEach((r) => {
      const meta = restored.getMetadata(r.id)
      expect(meta?.category).toBe('special')
    })
  })

  it('toJSON includes metadata', () => {
    const index = createFilteredIndex({ dimensions: 128 })

    index.insert('doc-1', randomVector(128), { foo: 'bar' })
    index.insert('doc-2', randomVector(128), { baz: 123 })

    const json = index.toJSON()

    expect(json.metadata).toBeDefined()
    expect(json.metadata['doc-1']).toEqual({ foo: 'bar' })
    expect(json.metadata['doc-2']).toEqual({ baz: 123 })
  })
})

// ============================================================================
// PERFORMANCE CHARACTERISTICS TESTS
// ============================================================================

describe('Filtered Search - Performance Characteristics', () => {
  it('maintains vector search quality with filters', () => {
    const index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 200 })

    // Create clustered data where similar vectors have same category
    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 500; i++) {
      const category = ['a', 'b', 'c', 'd', 'e'][Math.floor(i / 100)]
      const baseVec = seededVector(128, Math.floor(i / 100)) // Same base per category
      const vec = new Float32Array(128)
      for (let j = 0; j < 128; j++) {
        vec[j] = baseVec[j] + (Math.random() - 0.5) * 0.1 // Small perturbation
      }
      // Normalize
      let norm = 0
      for (let j = 0; j < 128; j++) norm += vec[j] * vec[j]
      norm = Math.sqrt(norm)
      for (let j = 0; j < 128; j++) vec[j] /= norm

      vectors.set(`doc-${i}`, vec)
      index.insert(`doc-${i}`, vec, { category })
    }

    // Query for category 'a' vectors (indices 0-99)
    const queryVec = seededVector(128, 0) // Base vector for category 'a'

    const filteredResults = index.search(queryVec, {
      k: 10,
      filter: { category: 'a' },
      ef: 100,
    })

    expect(filteredResults.length).toBe(10)

    // All results should be from category 'a'
    filteredResults.forEach((r) => {
      const meta = index.getMetadata(r.id)
      expect(meta?.category).toBe('a')
    })

    // Results should be relevant (high similarity to query)
    // Top results should have reasonably high scores
    expect(filteredResults[0].score).toBeGreaterThan(0.5)
  })

  it('handles large number of filtered results efficiently', () => {
    const index = createFilteredIndex({ dimensions: 128, M: 16, efConstruction: 100 })

    // Insert many documents, most matching filter
    for (let i = 0; i < 1000; i++) {
      index.insert(`doc-${i}`, seededVector(128, i), {
        status: i < 900 ? 'active' : 'inactive',
      })
    }

    const query = randomVector(128)
    const startTime = performance.now()

    const results = index.search(query, {
      k: 50,
      filter: { status: 'active' },
    })

    const elapsed = performance.now() - startTime

    expect(results).toHaveLength(50)
    // Should complete in reasonable time (< 100ms for this size)
    expect(elapsed).toBeLessThan(100)
  })
})
