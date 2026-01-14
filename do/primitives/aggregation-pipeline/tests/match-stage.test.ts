/**
 * $match Stage Tests (RED Phase)
 *
 * Tests for MongoDB-style $match stage with:
 * - Predicate filtering
 * - Compound conditions (AND/OR)
 * - Nested field access
 * - Regex matching
 * - Reuse of TypedColumnStore predicate types
 *
 * @see dotdo-go54b
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MatchStage,
  createMatchStage,
  MatchPredicate,
  CompoundPredicate,
  FieldPredicate,
} from '../stages/match'
import type { ComparisonOp, Predicate } from '../../typed-column-store'

// Test data types
interface Product {
  id: string
  name: string
  price: number
  category: string
  tags: string[]
  metadata: {
    brand: string
    model: string
    specs: {
      weight: number
      dimensions: { width: number; height: number; depth: number }
    }
  }
  inStock: boolean
  createdAt: Date
}

interface SalesRecord {
  id: string
  product: string
  amount: number
  quantity: number
  region: string
  customer: {
    id: string
    name: string
    tier: 'bronze' | 'silver' | 'gold'
  }
}

describe('MatchStage', () => {
  let sampleProducts: Product[]
  let sampleSales: SalesRecord[]

  beforeEach(() => {
    sampleProducts = [
      {
        id: '1',
        name: 'Laptop Pro',
        price: 1299,
        category: 'Electronics',
        tags: ['computer', 'portable', 'premium'],
        metadata: {
          brand: 'TechCorp',
          model: 'LP-2024',
          specs: { weight: 2.5, dimensions: { width: 35, height: 2, depth: 25 } },
        },
        inStock: true,
        createdAt: new Date('2024-01-15'),
      },
      {
        id: '2',
        name: 'Budget Phone',
        price: 299,
        category: 'Electronics',
        tags: ['phone', 'budget'],
        metadata: {
          brand: 'ValueTech',
          model: 'BP-100',
          specs: { weight: 0.2, dimensions: { width: 7, height: 1, depth: 15 } },
        },
        inStock: true,
        createdAt: new Date('2024-02-20'),
      },
      {
        id: '3',
        name: 'Designer Chair',
        price: 599,
        category: 'Furniture',
        tags: ['seating', 'ergonomic', 'premium'],
        metadata: {
          brand: 'ComfortPlus',
          model: 'DC-500',
          specs: { weight: 15, dimensions: { width: 60, height: 120, depth: 60 } },
        },
        inStock: false,
        createdAt: new Date('2024-03-10'),
      },
    ]

    sampleSales = [
      { id: '1', product: 'Laptop', amount: 1299, quantity: 1, region: 'US', customer: { id: 'c1', name: 'Alice', tier: 'gold' } },
      { id: '2', product: 'Phone', amount: 599, quantity: 2, region: 'US', customer: { id: 'c2', name: 'Bob', tier: 'silver' } },
      { id: '3', product: 'Tablet', amount: 799, quantity: 1, region: 'EU', customer: { id: 'c3', name: 'Carol', tier: 'bronze' } },
      { id: '4', product: 'Laptop', amount: 1299, quantity: 3, region: 'EU', customer: { id: 'c1', name: 'Alice', tier: 'gold' } },
      { id: '5', product: 'Accessory', amount: 49, quantity: 10, region: 'APAC', customer: { id: 'c4', name: 'David', tier: 'bronze' } },
    ]
  })

  describe('Stage properties', () => {
    it('should have name "$match"', () => {
      const stage = createMatchStage<Product>({ price: { $gt: 100 } })
      expect(stage.name).toBe('$match')
    })

    it('should expose the predicate for inspection', () => {
      const predicate: MatchPredicate<Product> = { category: 'Electronics' }
      const stage = createMatchStage(predicate)

      expect(stage.predicate).toEqual(predicate)
    })
  })

  describe('Simple equality matching', () => {
    it('should match documents with exact field value', () => {
      const stage = createMatchStage<Product>({ category: 'Electronics' })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2)
      expect(result.every((p) => p.category === 'Electronics')).toBe(true)
    })

    it('should match boolean fields', () => {
      const stage = createMatchStage<Product>({ inStock: true })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2)
      expect(result.every((p) => p.inStock === true)).toBe(true)
    })

    it('should match numeric fields exactly', () => {
      const stage = createMatchStage<Product>({ price: 299 })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Budget Phone')
    })

    it('should handle null values', () => {
      const dataWithNull = [...sampleProducts, { ...sampleProducts[0], id: '4', category: null as unknown as string }]
      const stage = createMatchStage<Product>({ category: null as unknown as string })
      const result = stage.process(dataWithNull)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('4')
    })

    it('should handle undefined values', () => {
      const dataWithUndefined = [...sampleProducts, { ...sampleProducts[0], id: '4', category: undefined as unknown as string }]
      const stage = createMatchStage<Product>({ category: undefined as unknown as string })
      const result = stage.process(dataWithUndefined)

      expect(result).toHaveLength(1)
    })
  })

  describe('Comparison operators', () => {
    it('should support $gt (greater than)', () => {
      const stage = createMatchStage<Product>({ price: { $gt: 500 } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2) // Laptop Pro (1299) and Designer Chair (599)
      expect(result.every((p) => p.price > 500)).toBe(true)
    })

    it('should support $gte (greater than or equal)', () => {
      const stage = createMatchStage<Product>({ price: { $gte: 599 } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2)
      expect(result.every((p) => p.price >= 599)).toBe(true)
    })

    it('should support $lt (less than)', () => {
      const stage = createMatchStage<Product>({ price: { $lt: 500 } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Budget Phone')
    })

    it('should support $lte (less than or equal)', () => {
      const stage = createMatchStage<Product>({ price: { $lte: 599 } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2)
      expect(result.every((p) => p.price <= 599)).toBe(true)
    })

    it('should support $ne (not equal)', () => {
      const stage = createMatchStage<Product>({ category: { $ne: 'Electronics' } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].category).toBe('Furniture')
    })

    it('should support $eq (explicit equality)', () => {
      const stage = createMatchStage<Product>({ price: { $eq: 1299 } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Laptop Pro')
    })
  })

  describe('Range operators', () => {
    it('should support $in (value in array)', () => {
      const stage = createMatchStage<Product>({ category: { $in: ['Electronics', 'Furniture'] } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(3)
    })

    it('should support $nin (value not in array)', () => {
      const stage = createMatchStage<Product>({ category: { $nin: ['Electronics'] } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].category).toBe('Furniture')
    })

    it('should support $between (range matching)', () => {
      const stage = createMatchStage<Product>({ price: { $between: [300, 700] } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Designer Chair')
    })
  })

  describe('Compound conditions', () => {
    it('should support implicit AND with multiple fields', () => {
      const stage = createMatchStage<Product>({
        category: 'Electronics',
        inStock: true,
      })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2)
      expect(result.every((p) => p.category === 'Electronics' && p.inStock)).toBe(true)
    })

    it('should support explicit $and', () => {
      const stage = createMatchStage<Product>({
        $and: [{ category: 'Electronics' }, { price: { $gt: 500 } }],
      })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Laptop Pro')
    })

    it('should support $or', () => {
      const stage = createMatchStage<Product>({
        $or: [{ category: 'Furniture' }, { price: { $gt: 1000 } }],
      })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2) // Designer Chair (Furniture) and Laptop Pro (>1000)
    })

    it('should support $nor (none of conditions)', () => {
      const stage = createMatchStage<Product>({
        $nor: [{ category: 'Electronics' }, { price: { $lt: 500 } }],
      })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Designer Chair')
    })

    it('should support $not (negation)', () => {
      const stage = createMatchStage<Product>({
        price: { $not: { $gt: 1000 } },
      })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2)
      expect(result.every((p) => p.price <= 1000)).toBe(true)
    })

    it('should support nested compound conditions', () => {
      const stage = createMatchStage<Product>({
        $or: [
          { $and: [{ category: 'Electronics' }, { price: { $gt: 1000 } }] },
          { $and: [{ category: 'Furniture' }, { inStock: false }] },
        ],
      })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2) // Laptop Pro and Designer Chair
    })
  })

  describe('Nested field access', () => {
    it('should access nested fields with dot notation', () => {
      const stage = createMatchStage<Product>({ 'metadata.brand': 'TechCorp' })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Laptop Pro')
    })

    it('should access deeply nested fields', () => {
      const stage = createMatchStage<Product>({ 'metadata.specs.weight': { $gt: 10 } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Designer Chair')
    })

    it('should access three-level nested fields', () => {
      const stage = createMatchStage<Product>({ 'metadata.specs.dimensions.width': { $gt: 30 } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2) // Laptop Pro (35) and Designer Chair (60)
    })

    it('should handle missing nested paths gracefully', () => {
      const stage = createMatchStage<Product>({ 'metadata.nonexistent.field': 'value' })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(0)
    })

    it('should support nested object matching', () => {
      const stage = createMatchStage<SalesRecord>({
        customer: { tier: 'gold' },
      })
      const result = stage.process(sampleSales)

      expect(result).toHaveLength(2)
      expect(result.every((s) => s.customer.tier === 'gold')).toBe(true)
    })
  })

  describe('Regex matching', () => {
    it('should support $regex for pattern matching', () => {
      const stage = createMatchStage<Product>({ name: { $regex: /Pro$/i } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Laptop Pro')
    })

    it('should support string regex patterns', () => {
      const stage = createMatchStage<Product>({ name: { $regex: 'Phone' } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Budget Phone')
    })

    it('should support $options for case insensitivity', () => {
      const stage = createMatchStage<Product>({
        name: { $regex: 'laptop', $options: 'i' },
      })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
    })

    it('should support partial matching', () => {
      const stage = createMatchStage<Product>({ name: { $regex: /^Budget/ } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Budget Phone')
    })

    it('should support regex on nested fields', () => {
      const stage = createMatchStage<Product>({ 'metadata.model': { $regex: /^LP-/ } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].metadata.model).toBe('LP-2024')
    })
  })

  describe('Array operators', () => {
    it('should support $elemMatch for array element matching', () => {
      const stage = createMatchStage<Product>({
        tags: { $elemMatch: { $eq: 'premium' } },
      })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2) // Laptop Pro and Designer Chair
    })

    it('should support $all for matching all array elements', () => {
      const stage = createMatchStage<Product>({
        tags: { $all: ['portable', 'premium'] },
      })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Laptop Pro')
    })

    it('should support $size for array length', () => {
      const stage = createMatchStage<Product>({
        tags: { $size: 2 },
      })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Budget Phone')
    })

    it('should support direct array contains check', () => {
      const stage = createMatchStage<Product>({ tags: 'ergonomic' })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Designer Chair')
    })
  })

  describe('Existence operators', () => {
    it('should support $exists: true', () => {
      const dataWithMissing = [
        ...sampleProducts,
        { id: '4', name: 'Test', price: 100, category: 'Test', tags: [], metadata: {} as Product['metadata'], inStock: true, createdAt: new Date() },
      ]
      const stage = createMatchStage<Product>({ 'metadata.brand': { $exists: true } })
      const result = stage.process(dataWithMissing)

      expect(result).toHaveLength(3) // Original products have brand
    })

    it('should support $exists: false', () => {
      const dataWithMissing = [
        ...sampleProducts,
        { id: '4', name: 'Test', price: 100, category: 'Test', tags: [], metadata: {} as Product['metadata'], inStock: true, createdAt: new Date() },
      ]
      const stage = createMatchStage<Product>({ 'metadata.brand': { $exists: false } })
      const result = stage.process(dataWithMissing)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('4')
    })
  })

  describe('Type operators', () => {
    it('should support $type for type checking', () => {
      const stage = createMatchStage<Product>({ price: { $type: 'number' } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(3)
    })

    it('should support $type with string type', () => {
      const stage = createMatchStage<Product>({ name: { $type: 'string' } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(3)
    })
  })

  describe('Date matching', () => {
    it('should match exact dates', () => {
      const stage = createMatchStage<Product>({ createdAt: new Date('2024-01-15') })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Laptop Pro')
    })

    it('should compare dates with $gt', () => {
      const stage = createMatchStage<Product>({ createdAt: { $gt: new Date('2024-02-01') } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(2)
    })

    it('should compare dates with $lt', () => {
      const stage = createMatchStage<Product>({ createdAt: { $lt: new Date('2024-02-01') } })
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Laptop Pro')
    })
  })

  describe('TypedColumnStore Predicate compatibility', () => {
    it('should convert to TypedColumnStore Predicate format', () => {
      const stage = createMatchStage<Product>({ price: { $gt: 500 } })
      const columnPredicate = stage.toColumnStorePredicate()

      expect(columnPredicate).toEqual({
        column: 'price',
        op: '>',
        value: 500,
      })
    })

    it('should support all TypedColumnStore comparison operators', () => {
      const ops: Array<{ mongo: object; expected: ComparisonOp }> = [
        { mongo: { $eq: 100 }, expected: '=' },
        { mongo: { $ne: 100 }, expected: '!=' },
        { mongo: { $gt: 100 }, expected: '>' },
        { mongo: { $lt: 100 }, expected: '<' },
        { mongo: { $gte: 100 }, expected: '>=' },
        { mongo: { $lte: 100 }, expected: '<=' },
        { mongo: { $in: [1, 2] }, expected: 'in' },
        { mongo: { $between: [1, 10] }, expected: 'between' },
      ]

      for (const { mongo, expected } of ops) {
        const stage = createMatchStage<Product>({ price: mongo })
        const predicate = stage.toColumnStorePredicate()
        expect(predicate.op).toBe(expected)
      }
    })
  })

  describe('Edge cases', () => {
    it('should handle empty input array', () => {
      const stage = createMatchStage<Product>({ category: 'Electronics' })
      const result = stage.process([])

      expect(result).toEqual([])
    })

    it('should handle empty predicate (match all)', () => {
      const stage = createMatchStage<Product>({})
      const result = stage.process(sampleProducts)

      expect(result).toHaveLength(3)
    })

    it('should handle special characters in string values', () => {
      const dataWithSpecial = [{ ...sampleProducts[0], name: 'Test (Special) [Chars]' }]
      const stage = createMatchStage<Product>({ name: 'Test (Special) [Chars]' })
      const result = stage.process(dataWithSpecial)

      expect(result).toHaveLength(1)
    })

    it('should handle very large numbers', () => {
      const dataWithLarge = [{ ...sampleProducts[0], price: Number.MAX_SAFE_INTEGER }]
      const stage = createMatchStage<Product>({ price: { $gt: Number.MAX_SAFE_INTEGER - 1 } })
      const result = stage.process(dataWithLarge)

      expect(result).toHaveLength(1)
    })

    it('should handle NaN values', () => {
      const dataWithNaN = [{ ...sampleProducts[0], price: NaN }]
      const stage = createMatchStage<Product>({ price: NaN })
      const result = stage.process(dataWithNaN)

      // NaN !== NaN, so this should typically return empty
      // Implementation may vary based on design decision
      expect(result).toHaveLength(0)
    })
  })
})
