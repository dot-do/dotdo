/**
 * $sort, $limit, and $skip Stage Tests (RED Phase)
 *
 * Tests for MongoDB-style sorting and pagination stages:
 * - $sort: single/multi-field, asc/desc, null positioning
 * - $limit: top-K, memory-efficient
 * - $skip: offset pagination
 *
 * @see dotdo-u13bs
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SortStage,
  LimitStage,
  SkipStage,
  createSortStage,
  createLimitStage,
  createSkipStage,
  SortSpec,
  SortDirection,
  NullPosition,
} from '../stages/sort-limit'

// Test data types
interface Product {
  id: string
  name: string
  price: number | null
  category: string
  rating: number | null
  stock: number
  createdAt: Date
  metadata: {
    weight: number
    dimensions: { width: number; height: number }
  } | null
}

interface SalesRecord {
  id: string
  product: string
  amount: number
  quantity: number
  region: string
  date: Date
  salesperson: string | null
}

describe('SortStage', () => {
  let sampleProducts: Product[]
  let sampleSales: SalesRecord[]

  beforeEach(() => {
    sampleProducts = [
      {
        id: '1',
        name: 'Laptop',
        price: 1299,
        category: 'Electronics',
        rating: 4.5,
        stock: 50,
        createdAt: new Date('2024-01-15'),
        metadata: { weight: 2.5, dimensions: { width: 35, height: 2 } },
      },
      {
        id: '2',
        name: 'Phone',
        price: 599,
        category: 'Electronics',
        rating: 4.8,
        stock: 200,
        createdAt: new Date('2024-02-10'),
        metadata: { weight: 0.2, dimensions: { width: 7, height: 1 } },
      },
      {
        id: '3',
        name: 'Chair',
        price: 299,
        category: 'Furniture',
        rating: 4.2,
        stock: 30,
        createdAt: new Date('2024-01-20'),
        metadata: { weight: 15, dimensions: { width: 60, height: 120 } },
      },
      {
        id: '4',
        name: 'Desk',
        price: null,
        category: 'Furniture',
        rating: null,
        stock: 15,
        createdAt: new Date('2024-03-05'),
        metadata: null,
      },
      {
        id: '5',
        name: 'Monitor',
        price: 399,
        category: 'Electronics',
        rating: 4.5,
        stock: 75,
        createdAt: new Date('2024-02-25'),
        metadata: { weight: 5, dimensions: { width: 60, height: 40 } },
      },
    ]

    sampleSales = [
      { id: '1', product: 'Laptop', amount: 1299, quantity: 1, region: 'US', date: new Date('2024-01-15'), salesperson: 'Alice' },
      { id: '2', product: 'Phone', amount: 599, quantity: 2, region: 'US', date: new Date('2024-01-16'), salesperson: 'Bob' },
      { id: '3', product: 'Chair', amount: 299, quantity: 5, region: 'EU', date: new Date('2024-01-15'), salesperson: 'Alice' },
      { id: '4', product: 'Desk', amount: 499, quantity: 2, region: 'EU', date: new Date('2024-01-17'), salesperson: null },
      { id: '5', product: 'Tablet', amount: 799, quantity: 3, region: 'APAC', date: new Date('2024-01-15'), salesperson: 'Carol' },
    ]
  })

  describe('Stage properties', () => {
    it('should have name "$sort"', () => {
      const stage = createSortStage<Product>({ price: 1 })
      expect(stage.name).toBe('$sort')
    })

    it('should expose the sort specification for inspection', () => {
      const spec: SortSpec<Product> = { price: -1, name: 1 }
      const stage = createSortStage(spec)
      expect(stage.specification).toEqual(spec)
    })
  })

  describe('Single-field sorting', () => {
    it('should sort ascending with value 1', () => {
      const stage = createSortStage<Product>({ price: 1 })
      const result = stage.process(sampleProducts)

      // null should be first or last depending on default
      const pricesWithoutNull = result.filter((p) => p.price !== null).map((p) => p.price)
      expect(pricesWithoutNull).toEqual([299, 399, 599, 1299])
    })

    it('should sort descending with value -1', () => {
      const stage = createSortStage<Product>({ price: -1 })
      const result = stage.process(sampleProducts)

      const pricesWithoutNull = result.filter((p) => p.price !== null).map((p) => p.price)
      expect(pricesWithoutNull).toEqual([1299, 599, 399, 299])
    })

    it('should sort strings alphabetically ascending', () => {
      const stage = createSortStage<Product>({ name: 1 })
      const result = stage.process(sampleProducts)

      expect(result.map((p) => p.name)).toEqual(['Chair', 'Desk', 'Laptop', 'Monitor', 'Phone'])
    })

    it('should sort strings alphabetically descending', () => {
      const stage = createSortStage<Product>({ name: -1 })
      const result = stage.process(sampleProducts)

      expect(result.map((p) => p.name)).toEqual(['Phone', 'Monitor', 'Laptop', 'Desk', 'Chair'])
    })

    it('should sort dates chronologically ascending', () => {
      const stage = createSortStage<Product>({ createdAt: 1 })
      const result = stage.process(sampleProducts)

      const dates = result.map((p) => p.createdAt.getTime())
      expect(dates).toEqual([...dates].sort((a, b) => a - b))
    })

    it('should sort dates chronologically descending', () => {
      const stage = createSortStage<Product>({ createdAt: -1 })
      const result = stage.process(sampleProducts)

      const dates = result.map((p) => p.createdAt.getTime())
      expect(dates).toEqual([...dates].sort((a, b) => b - a))
    })
  })

  describe('Multi-field sorting', () => {
    it('should sort by multiple fields in order', () => {
      const stage = createSortStage<Product>({ category: 1, price: -1 })
      const result = stage.process(sampleProducts)

      // Electronics should come first (E < F), sorted by price descending
      const electronics = result.filter((p) => p.category === 'Electronics')
      expect(electronics.map((p) => p.price)).toEqual([1299, 599, 399])

      // Furniture should come second, sorted by price descending
      const furniture = result.filter((p) => p.category === 'Furniture')
      // null should be last in descending
      expect(furniture[0].price).toBe(299)
    })

    it('should handle three-field sorting', () => {
      const dataWithTies = [
        { a: 1, b: 1, c: 3 },
        { a: 1, b: 1, c: 1 },
        { a: 1, b: 2, c: 1 },
        { a: 2, b: 1, c: 1 },
        { a: 1, b: 1, c: 2 },
      ]
      const stage = createSortStage<(typeof dataWithTies)[0]>({ a: 1, b: 1, c: 1 })
      const result = stage.process(dataWithTies)

      expect(result.map((r) => [r.a, r.b, r.c])).toEqual([
        [1, 1, 1],
        [1, 1, 2],
        [1, 1, 3],
        [1, 2, 1],
        [2, 1, 1],
      ])
    })

    it('should handle mixed ascending and descending', () => {
      const stage = createSortStage<SalesRecord>({ region: 1, amount: -1 })
      const result = stage.process(sampleSales)

      // APAC first, then EU, then US (alphabetically)
      expect(result[0].region).toBe('APAC')

      // Within US, amount should be descending
      const usRecords = result.filter((r) => r.region === 'US')
      expect(usRecords.map((r) => r.amount)).toEqual([1299, 599])
    })
  })

  describe('Null positioning', () => {
    it('should place nulls last by default in ascending sort', () => {
      const stage = createSortStage<Product>({ price: 1 })
      const result = stage.process(sampleProducts)

      expect(result[result.length - 1].price).toBeNull()
    })

    it('should place nulls first with nulls: "first" option', () => {
      const stage = createSortStage<Product>(
        { price: 1 },
        { nulls: 'first' }
      )
      const result = stage.process(sampleProducts)

      expect(result[0].price).toBeNull()
    })

    it('should place nulls last with nulls: "last" option', () => {
      const stage = createSortStage<Product>(
        { price: -1 },
        { nulls: 'last' }
      )
      const result = stage.process(sampleProducts)

      expect(result[result.length - 1].price).toBeNull()
    })

    it('should handle nulls in multi-field sort', () => {
      const stage = createSortStage<Product>({ rating: -1, price: 1 })
      const result = stage.process(sampleProducts)

      // Products with null rating should be at the end
      const nullRatingIndex = result.findIndex((p) => p.rating === null)
      expect(nullRatingIndex).toBe(result.length - 1)
    })

    it('should treat undefined same as null', () => {
      const dataWithUndefined = [
        { id: '1', value: 10 },
        { id: '2', value: undefined },
        { id: '3', value: 5 },
      ]
      const stage = createSortStage<(typeof dataWithUndefined)[0]>({ value: 1 })
      const result = stage.process(dataWithUndefined)

      // undefined should be treated like null (last in ascending)
      expect(result[result.length - 1].value).toBeUndefined()
    })
  })

  describe('Nested field sorting', () => {
    it('should sort by nested field using dot notation', () => {
      const productsWithMetadata = sampleProducts.filter((p) => p.metadata !== null)
      const stage = createSortStage<Product>({ 'metadata.weight': 1 })
      const result = stage.process(productsWithMetadata)

      expect(result[0].name).toBe('Phone') // weight: 0.2
      expect(result[result.length - 1].name).toBe('Chair') // weight: 15
    })

    it('should sort by deeply nested field', () => {
      const productsWithDimensions = sampleProducts.filter((p) => p.metadata !== null)
      const stage = createSortStage<Product>({ 'metadata.dimensions.width': -1 })
      const result = stage.process(productsWithDimensions)

      expect(result[0].name).toBe('Chair') // width: 60
    })

    it('should handle null parent in nested sort', () => {
      const stage = createSortStage<Product>({ 'metadata.weight': 1 })
      const result = stage.process(sampleProducts)

      // Product with null metadata should be at the end
      const nullMetadataIndex = result.findIndex((p) => p.metadata === null)
      expect(nullMetadataIndex).toBe(result.length - 1)
    })
  })

  describe('Stable sorting', () => {
    it('should maintain original order for equal values', () => {
      const dataWithTies = [
        { id: '1', group: 'A', order: 1 },
        { id: '2', group: 'A', order: 2 },
        { id: '3', group: 'B', order: 3 },
        { id: '4', group: 'A', order: 4 },
      ]
      const stage = createSortStage<(typeof dataWithTies)[0]>({ group: 1 })
      const result = stage.process(dataWithTies)

      // Within group A, original order should be preserved
      const groupA = result.filter((r) => r.group === 'A')
      expect(groupA.map((r) => r.order)).toEqual([1, 2, 4])
    })
  })

  describe('Collation support', () => {
    it('should support case-insensitive sorting', () => {
      const dataWithMixedCase = [
        { name: 'banana' },
        { name: 'Apple' },
        { name: 'cherry' },
        { name: 'Apricot' },
      ]
      const stage = createSortStage<(typeof dataWithMixedCase)[0]>(
        { name: 1 },
        { collation: { caseLevel: false } }
      )
      const result = stage.process(dataWithMixedCase)

      // Case-insensitive: Apple, Apricot, banana, cherry
      expect(result[0].name.toLowerCase()).toBe('apple')
    })

    it('should support locale-specific sorting', () => {
      const dataWithAccents = [
        { name: 'ecole' },
        { name: 'eclair' },
        { name: 'ecole' }, // with accent
      ]
      const stage = createSortStage<(typeof dataWithAccents)[0]>(
        { name: 1 },
        { collation: { locale: 'fr' } }
      )
      // Locale-specific behavior would be tested here
      expect(stage).toBeDefined()
    })
  })

  describe('Edge cases', () => {
    it('should handle empty input', () => {
      const stage = createSortStage<Product>({ price: 1 })
      const result = stage.process([])

      expect(result).toEqual([])
    })

    it('should handle single element', () => {
      const stage = createSortStage<Product>({ price: 1 })
      const result = stage.process([sampleProducts[0]])

      expect(result).toHaveLength(1)
    })

    it('should handle all null values', () => {
      const allNulls = [
        { id: '1', value: null },
        { id: '2', value: null },
        { id: '3', value: null },
      ]
      const stage = createSortStage<(typeof allNulls)[0]>({ value: 1 })
      const result = stage.process(allNulls)

      // Should maintain original order since all are equal
      expect(result.map((r) => r.id)).toEqual(['1', '2', '3'])
    })

    it('should handle very large arrays efficiently', () => {
      const largeData = Array.from({ length: 10000 }, (_, i) => ({
        id: String(i),
        value: Math.random() * 1000,
      }))
      const stage = createSortStage<(typeof largeData)[0]>({ value: 1 })

      const start = performance.now()
      const result = stage.process(largeData)
      const duration = performance.now() - start

      expect(result).toHaveLength(10000)
      expect(duration).toBeLessThan(1000) // Should complete in under 1 second
    })
  })
})

describe('LimitStage', () => {
  let sampleData: Array<{ id: string; value: number }>

  beforeEach(() => {
    sampleData = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      value: i * 10,
    }))
  })

  describe('Stage properties', () => {
    it('should have name "$limit"', () => {
      const stage = createLimitStage<{ id: string }>(10)
      expect(stage.name).toBe('$limit')
    })

    it('should expose the limit value for inspection', () => {
      const stage = createLimitStage<{ id: string }>(25)
      expect(stage.limit).toBe(25)
    })
  })

  describe('Basic limiting', () => {
    it('should return first N documents', () => {
      const stage = createLimitStage<(typeof sampleData)[0]>(5)
      const result = stage.process(sampleData)

      expect(result).toHaveLength(5)
      expect(result.map((r) => r.id)).toEqual(['0', '1', '2', '3', '4'])
    })

    it('should return all documents if limit exceeds count', () => {
      const stage = createLimitStage<(typeof sampleData)[0]>(200)
      const result = stage.process(sampleData)

      expect(result).toHaveLength(100)
    })

    it('should return empty array for limit 0', () => {
      const stage = createLimitStage<(typeof sampleData)[0]>(0)
      const result = stage.process(sampleData)

      expect(result).toEqual([])
    })

    it('should throw for negative limit', () => {
      expect(() => createLimitStage<{ id: string }>(-5)).toThrow()
    })
  })

  describe('Memory-efficient top-K', () => {
    it('should work efficiently with sorted data (top-K)', () => {
      // Simulating sort + limit (top-K) scenario
      const sorted = [...sampleData].sort((a, b) => b.value - a.value)
      const stage = createLimitStage<(typeof sampleData)[0]>(10)
      const result = stage.process(sorted)

      expect(result).toHaveLength(10)
      expect(result[0].value).toBe(990) // Highest value
      expect(result[9].value).toBe(900) // 10th highest
    })

    it('should support heap-based top-K for memory efficiency', () => {
      // This tests the optimized path for $sort + $limit
      const stage = createLimitStage<(typeof sampleData)[0]>(10, {
        heapOptimized: true,
      })
      expect(stage.isHeapOptimized).toBe(true)
    })

    it('should handle limit of 1', () => {
      const stage = createLimitStage<(typeof sampleData)[0]>(1)
      const result = stage.process(sampleData)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('0')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty input', () => {
      const stage = createLimitStage<(typeof sampleData)[0]>(10)
      const result = stage.process([])

      expect(result).toEqual([])
    })

    it('should preserve document structure', () => {
      const complexData = [
        { id: '1', nested: { a: 1, b: [1, 2, 3] } },
        { id: '2', nested: { a: 2, b: [4, 5, 6] } },
      ]
      const stage = createLimitStage<(typeof complexData)[0]>(1)
      const result = stage.process(complexData)

      expect(result[0]).toEqual(complexData[0])
    })
  })
})

describe('SkipStage', () => {
  let sampleData: Array<{ id: string; value: number }>

  beforeEach(() => {
    sampleData = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      value: i * 10,
    }))
  })

  describe('Stage properties', () => {
    it('should have name "$skip"', () => {
      const stage = createSkipStage<{ id: string }>(10)
      expect(stage.name).toBe('$skip')
    })

    it('should expose the skip value for inspection', () => {
      const stage = createSkipStage<{ id: string }>(25)
      expect(stage.skip).toBe(25)
    })
  })

  describe('Basic skipping', () => {
    it('should skip first N documents', () => {
      const stage = createSkipStage<(typeof sampleData)[0]>(5)
      const result = stage.process(sampleData)

      expect(result).toHaveLength(95)
      expect(result[0].id).toBe('5')
    })

    it('should return empty array if skip exceeds count', () => {
      const stage = createSkipStage<(typeof sampleData)[0]>(200)
      const result = stage.process(sampleData)

      expect(result).toEqual([])
    })

    it('should return all documents for skip 0', () => {
      const stage = createSkipStage<(typeof sampleData)[0]>(0)
      const result = stage.process(sampleData)

      expect(result).toHaveLength(100)
    })

    it('should throw for negative skip', () => {
      expect(() => createSkipStage<{ id: string }>(-5)).toThrow()
    })
  })

  describe('Pagination with skip + limit', () => {
    it('should implement offset pagination', () => {
      // Page 1: skip 0, limit 10
      // Page 2: skip 10, limit 10
      // Page 3: skip 20, limit 10

      const skipStage = createSkipStage<(typeof sampleData)[0]>(10)
      const limitStage = createLimitStage<(typeof sampleData)[0]>(10)

      const afterSkip = skipStage.process(sampleData)
      const result = limitStage.process(afterSkip)

      expect(result).toHaveLength(10)
      expect(result[0].id).toBe('10')
      expect(result[9].id).toBe('19')
    })

    it('should handle last page with fewer items', () => {
      const skipStage = createSkipStage<(typeof sampleData)[0]>(95)
      const limitStage = createLimitStage<(typeof sampleData)[0]>(10)

      const afterSkip = skipStage.process(sampleData)
      const result = limitStage.process(afterSkip)

      expect(result).toHaveLength(5)
      expect(result[0].id).toBe('95')
      expect(result[4].id).toBe('99')
    })

    it('should return empty for page beyond data', () => {
      const skipStage = createSkipStage<(typeof sampleData)[0]>(100)
      const limitStage = createLimitStage<(typeof sampleData)[0]>(10)

      const afterSkip = skipStage.process(sampleData)
      const result = limitStage.process(afterSkip)

      expect(result).toEqual([])
    })
  })

  describe('Edge cases', () => {
    it('should handle empty input', () => {
      const stage = createSkipStage<(typeof sampleData)[0]>(10)
      const result = stage.process([])

      expect(result).toEqual([])
    })

    it('should skip exactly the document count', () => {
      const stage = createSkipStage<(typeof sampleData)[0]>(100)
      const result = stage.process(sampleData)

      expect(result).toEqual([])
    })

    it('should handle skip of 1', () => {
      const stage = createSkipStage<(typeof sampleData)[0]>(1)
      const result = stage.process(sampleData)

      expect(result).toHaveLength(99)
      expect(result[0].id).toBe('1')
    })
  })
})

describe('Combined Sort/Limit/Skip operations', () => {
  let sampleProducts: Array<{ id: string; name: string; price: number; category: string }>

  beforeEach(() => {
    sampleProducts = [
      { id: '1', name: 'Laptop', price: 1299, category: 'Electronics' },
      { id: '2', name: 'Phone', price: 599, category: 'Electronics' },
      { id: '3', name: 'Chair', price: 299, category: 'Furniture' },
      { id: '4', name: 'Desk', price: 499, category: 'Furniture' },
      { id: '5', name: 'Monitor', price: 399, category: 'Electronics' },
      { id: '6', name: 'Keyboard', price: 99, category: 'Electronics' },
      { id: '7', name: 'Table', price: 599, category: 'Furniture' },
      { id: '8', name: 'Lamp', price: 79, category: 'Furniture' },
    ]
  })

  it('should implement top-N by field (sort desc + limit)', () => {
    const sortStage = createSortStage<(typeof sampleProducts)[0]>({ price: -1 })
    const limitStage = createLimitStage<(typeof sampleProducts)[0]>(3)

    const sorted = sortStage.process(sampleProducts)
    const result = limitStage.process(sorted)

    expect(result).toHaveLength(3)
    expect(result[0].name).toBe('Laptop') // 1299
    expect(result[1].name).toBe('Phone') // 599 or Table 599
    expect(result[2].price).toBe(599) // One of the 599 items
  })

  it('should implement bottom-N by field (sort asc + limit)', () => {
    const sortStage = createSortStage<(typeof sampleProducts)[0]>({ price: 1 })
    const limitStage = createLimitStage<(typeof sampleProducts)[0]>(3)

    const sorted = sortStage.process(sampleProducts)
    const result = limitStage.process(sorted)

    expect(result).toHaveLength(3)
    expect(result[0].name).toBe('Lamp') // 79
    expect(result[1].name).toBe('Keyboard') // 99
  })

  it('should implement sorted pagination', () => {
    const sortStage = createSortStage<(typeof sampleProducts)[0]>({ name: 1 })
    const skipStage = createSkipStage<(typeof sampleProducts)[0]>(2)
    const limitStage = createLimitStage<(typeof sampleProducts)[0]>(3)

    const sorted = sortStage.process(sampleProducts)
    const skipped = skipStage.process(sorted)
    const result = limitStage.process(skipped)

    // Sorted by name: Chair, Desk, Keyboard, Lamp, Laptop, Monitor, Phone, Table
    // Skip 2: Keyboard, Lamp, Laptop, Monitor, Phone, Table
    // Limit 3: Keyboard, Lamp, Laptop
    expect(result.map((p) => p.name)).toEqual(['Keyboard', 'Lamp', 'Laptop'])
  })

  it('should implement category + sorted pagination', () => {
    // Get page 1 of electronics sorted by price descending
    const electronics = sampleProducts.filter((p) => p.category === 'Electronics')
    const sortStage = createSortStage<(typeof sampleProducts)[0]>({ price: -1 })
    const limitStage = createLimitStage<(typeof sampleProducts)[0]>(2)

    const sorted = sortStage.process(electronics)
    const result = limitStage.process(sorted)

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Laptop')
    expect(result[1].name).toBe('Phone')
  })
})
