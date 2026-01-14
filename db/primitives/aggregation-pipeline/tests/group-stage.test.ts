/**
 * $group Stage Tests (RED Phase)
 *
 * Tests for MongoDB-style $group stage with:
 * - GroupBy key extraction
 * - Accumulator functions (sum, count, avg, min, max, first, last)
 * - Multi-field grouping
 * - Null/undefined handling
 *
 * @see dotdo-54m3k
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  GroupStage,
  createGroupStage,
  Accumulator,
  AccumulatorType,
  GroupKey,
  GroupResult,
} from '../stages/group'
import type { AggregateFunction } from '../../typed-column-store'

// Test data types
interface SalesRecord {
  id: string
  product: string
  category: string
  amount: number
  quantity: number
  region: string
  date: Date
  salesperson: string | null
}

interface LogEntry {
  timestamp: Date
  level: 'debug' | 'info' | 'warn' | 'error'
  service: string
  message: string
  responseTime: number | null
}

describe('GroupStage', () => {
  let sampleSales: SalesRecord[]
  let sampleLogs: LogEntry[]

  beforeEach(() => {
    sampleSales = [
      { id: '1', product: 'Laptop', category: 'Electronics', amount: 1299, quantity: 1, region: 'US', date: new Date('2024-01-15'), salesperson: 'Alice' },
      { id: '2', product: 'Phone', category: 'Electronics', amount: 599, quantity: 2, region: 'US', date: new Date('2024-01-16'), salesperson: 'Bob' },
      { id: '3', product: 'Chair', category: 'Furniture', amount: 299, quantity: 5, region: 'EU', date: new Date('2024-01-15'), salesperson: 'Alice' },
      { id: '4', product: 'Desk', category: 'Furniture', amount: 499, quantity: 2, region: 'EU', date: new Date('2024-01-17'), salesperson: null },
      { id: '5', product: 'Tablet', category: 'Electronics', amount: 799, quantity: 3, region: 'APAC', date: new Date('2024-01-15'), salesperson: 'Carol' },
      { id: '6', product: 'Monitor', category: 'Electronics', amount: 399, quantity: 2, region: 'US', date: new Date('2024-01-18'), salesperson: 'Alice' },
      { id: '7', product: 'Lamp', category: 'Furniture', amount: 89, quantity: 10, region: 'APAC', date: new Date('2024-01-16'), salesperson: 'Bob' },
    ]

    sampleLogs = [
      { timestamp: new Date('2024-01-15T10:00:00'), level: 'info', service: 'api', message: 'Request received', responseTime: 50 },
      { timestamp: new Date('2024-01-15T10:01:00'), level: 'error', service: 'api', message: 'Internal error', responseTime: null },
      { timestamp: new Date('2024-01-15T10:02:00'), level: 'debug', service: 'worker', message: 'Processing', responseTime: 200 },
      { timestamp: new Date('2024-01-15T10:03:00'), level: 'info', service: 'api', message: 'Request completed', responseTime: 75 },
      { timestamp: new Date('2024-01-15T10:04:00'), level: 'warn', service: 'worker', message: 'Slow operation', responseTime: 500 },
    ]
  })

  describe('Stage properties', () => {
    it('should have name "$group"', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        total: { $sum: '$amount' },
      })
      expect(stage.name).toBe('$group')
    })

    it('should expose the group specification for inspection', () => {
      const spec = {
        _id: '$category',
        total: { $sum: '$amount' },
      }
      const stage = createGroupStage<SalesRecord>(spec)
      expect(stage.specification).toEqual(spec)
    })
  })

  describe('GroupBy key extraction', () => {
    it('should group by a single field', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        count: { $count: {} },
      })
      const result = stage.process(sampleSales)

      expect(result).toHaveLength(2)
      expect(result.find((r) => r._id === 'Electronics')?.count).toBe(4)
      expect(result.find((r) => r._id === 'Furniture')?.count).toBe(3)
    })

    it('should group by multiple fields using object _id', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: { category: '$category', region: '$region' },
        count: { $count: {} },
      })
      const result = stage.process(sampleSales)

      expect(result.length).toBeGreaterThan(2)
      const usElectronics = result.find(
        (r) => r._id.category === 'Electronics' && r._id.region === 'US'
      )
      expect(usElectronics?.count).toBe(3)
    })

    it('should support null _id for global aggregation', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: null,
        totalAmount: { $sum: '$amount' },
        count: { $count: {} },
      })
      const result = stage.process(sampleSales)

      expect(result).toHaveLength(1)
      expect(result[0]._id).toBeNull()
      expect(result[0].count).toBe(7)
    })

    it('should extract nested field values for grouping', () => {
      interface NestedRecord {
        data: { type: string; value: number }
      }
      const nestedData: NestedRecord[] = [
        { data: { type: 'A', value: 10 } },
        { data: { type: 'B', value: 20 } },
        { data: { type: 'A', value: 30 } },
      ]

      const stage = createGroupStage<NestedRecord>({
        _id: '$data.type',
        total: { $sum: '$data.value' },
      })
      const result = stage.process(nestedData)

      expect(result).toHaveLength(2)
      expect(result.find((r) => r._id === 'A')?.total).toBe(40)
    })

    it('should handle computed key expressions', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
        count: { $count: {} },
      })
      const result = stage.process(sampleSales)

      expect(result).toHaveLength(1) // All dates are in 2024-01
      expect(result[0]._id).toBe('2024-01')
    })
  })

  describe('$sum accumulator', () => {
    it('should sum numeric field values', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        total: { $sum: '$amount' },
      })
      const result = stage.process(sampleSales)

      const electronics = result.find((r) => r._id === 'Electronics')
      expect(electronics?.total).toBe(1299 + 599 + 799 + 399)

      const furniture = result.find((r) => r._id === 'Furniture')
      expect(furniture?.total).toBe(299 + 499 + 89)
    })

    it('should sum constant values (count-like behavior)', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        count: { $sum: 1 },
      })
      const result = stage.process(sampleSales)

      expect(result.find((r) => r._id === 'Electronics')?.count).toBe(4)
    })

    it('should handle missing fields as 0', () => {
      const dataWithMissing = [
        { id: '1', value: 10 },
        { id: '2' }, // no value field
        { id: '3', value: 20 },
      ]
      const stage = createGroupStage<typeof dataWithMissing[0]>({
        _id: null,
        total: { $sum: '$value' },
      })
      const result = stage.process(dataWithMissing)

      expect(result[0].total).toBe(30)
    })

    it('should handle null values as 0', () => {
      const dataWithNull = [
        { id: '1', value: 10 },
        { id: '2', value: null },
        { id: '3', value: 20 },
      ]
      const stage = createGroupStage<typeof dataWithNull[0]>({
        _id: null,
        total: { $sum: '$value' },
      })
      const result = stage.process(dataWithNull as unknown[])

      expect(result[0].total).toBe(30)
    })
  })

  describe('$count accumulator', () => {
    it('should count documents in each group', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$region',
        count: { $count: {} },
      })
      const result = stage.process(sampleSales)

      expect(result.find((r) => r._id === 'US')?.count).toBe(3)
      expect(result.find((r) => r._id === 'EU')?.count).toBe(2)
      expect(result.find((r) => r._id === 'APAC')?.count).toBe(2)
    })

    it('should count using $sum: 1 as alternative', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        countAlt: { $sum: 1 },
      })
      const result = stage.process(sampleSales)

      expect(result.find((r) => r._id === 'Electronics')?.countAlt).toBe(4)
    })
  })

  describe('$avg accumulator', () => {
    it('should calculate average of numeric field', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        avgAmount: { $avg: '$amount' },
      })
      const result = stage.process(sampleSales)

      const electronics = result.find((r) => r._id === 'Electronics')
      expect(electronics?.avgAmount).toBeCloseTo((1299 + 599 + 799 + 399) / 4)
    })

    it('should ignore null values in average calculation', () => {
      const stage = createGroupStage<LogEntry>({
        _id: '$service',
        avgResponseTime: { $avg: '$responseTime' },
      })
      const result = stage.process(sampleLogs)

      const api = result.find((r) => r._id === 'api')
      // api has responseTime: 50, null, 75 -> avg of 50, 75 = 62.5
      expect(api?.avgResponseTime).toBeCloseTo(62.5)
    })

    it('should return null for groups with no valid values', () => {
      const dataWithAllNull = [
        { group: 'A', value: null },
        { group: 'A', value: null },
      ]
      const stage = createGroupStage<typeof dataWithAllNull[0]>({
        _id: '$group',
        avg: { $avg: '$value' },
      })
      const result = stage.process(dataWithAllNull as unknown[])

      expect(result[0].avg).toBeNull()
    })
  })

  describe('$min accumulator', () => {
    it('should find minimum numeric value', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        minAmount: { $min: '$amount' },
      })
      const result = stage.process(sampleSales)

      expect(result.find((r) => r._id === 'Electronics')?.minAmount).toBe(399)
      expect(result.find((r) => r._id === 'Furniture')?.minAmount).toBe(89)
    })

    it('should find minimum date value', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        firstDate: { $min: '$date' },
      })
      const result = stage.process(sampleSales)

      const electronics = result.find((r) => r._id === 'Electronics')
      expect(electronics?.firstDate).toEqual(new Date('2024-01-15'))
    })

    it('should handle string comparison', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        firstProduct: { $min: '$product' },
      })
      const result = stage.process(sampleSales)

      const electronics = result.find((r) => r._id === 'Electronics')
      expect(electronics?.firstProduct).toBe('Laptop') // alphabetically first
    })
  })

  describe('$max accumulator', () => {
    it('should find maximum numeric value', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        maxAmount: { $max: '$amount' },
      })
      const result = stage.process(sampleSales)

      expect(result.find((r) => r._id === 'Electronics')?.maxAmount).toBe(1299)
      expect(result.find((r) => r._id === 'Furniture')?.maxAmount).toBe(499)
    })

    it('should find maximum date value', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        lastDate: { $max: '$date' },
      })
      const result = stage.process(sampleSales)

      const electronics = result.find((r) => r._id === 'Electronics')
      expect(electronics?.lastDate).toEqual(new Date('2024-01-18'))
    })
  })

  describe('$first accumulator', () => {
    it('should return first value in group (document order)', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        firstProduct: { $first: '$product' },
      })
      const result = stage.process(sampleSales)

      // First Electronics product in array is 'Laptop'
      expect(result.find((r) => r._id === 'Electronics')?.firstProduct).toBe('Laptop')
    })

    it('should respect document order after sort', () => {
      // Simulating pre-sorted data
      const sorted = [...sampleSales].sort((a, b) => a.amount - b.amount)
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        cheapestProduct: { $first: '$product' },
      })
      const result = stage.process(sorted)

      // After sorting by amount asc, first furniture item should be Lamp (89)
      expect(result.find((r) => r._id === 'Furniture')?.cheapestProduct).toBe('Lamp')
    })
  })

  describe('$last accumulator', () => {
    it('should return last value in group (document order)', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        lastProduct: { $last: '$product' },
      })
      const result = stage.process(sampleSales)

      // Last Electronics product in array is 'Monitor'
      expect(result.find((r) => r._id === 'Electronics')?.lastProduct).toBe('Monitor')
    })
  })

  describe('$push accumulator', () => {
    it('should collect values into an array', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        products: { $push: '$product' },
      })
      const result = stage.process(sampleSales)

      const electronics = result.find((r) => r._id === 'Electronics')
      expect(electronics?.products).toEqual(['Laptop', 'Phone', 'Tablet', 'Monitor'])
    })

    it('should include null/undefined values', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$region',
        salespeople: { $push: '$salesperson' },
      })
      const result = stage.process(sampleSales)

      const eu = result.find((r) => r._id === 'EU')
      expect(eu?.salespeople).toContain(null)
    })

    it('should push entire documents with $$ROOT', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        docs: { $push: '$$ROOT' },
      })
      const result = stage.process(sampleSales)

      const furniture = result.find((r) => r._id === 'Furniture')
      expect(furniture?.docs).toHaveLength(3)
      expect(furniture?.docs[0]).toHaveProperty('id')
    })
  })

  describe('$addToSet accumulator', () => {
    it('should collect unique values into an array', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: null,
        uniqueCategories: { $addToSet: '$category' },
      })
      const result = stage.process(sampleSales)

      expect(result[0].uniqueCategories).toHaveLength(2)
      expect(result[0].uniqueCategories).toContain('Electronics')
      expect(result[0].uniqueCategories).toContain('Furniture')
    })

    it('should not include duplicate values', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        regions: { $addToSet: '$region' },
      })
      const result = stage.process(sampleSales)

      // Electronics has US, APAC but US appears multiple times -> should be deduplicated
      const electronics = result.find((r) => r._id === 'Electronics')
      expect(new Set(electronics?.regions).size).toBe(electronics?.regions.length)
    })
  })

  describe('Multiple accumulators', () => {
    it('should support multiple accumulators in one group', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        totalAmount: { $sum: '$amount' },
        avgAmount: { $avg: '$amount' },
        minAmount: { $min: '$amount' },
        maxAmount: { $max: '$amount' },
        count: { $count: {} },
      })
      const result = stage.process(sampleSales)

      const electronics = result.find((r) => r._id === 'Electronics')
      expect(electronics).toHaveProperty('totalAmount')
      expect(electronics).toHaveProperty('avgAmount')
      expect(electronics).toHaveProperty('minAmount')
      expect(electronics).toHaveProperty('maxAmount')
      expect(electronics).toHaveProperty('count')
    })
  })

  describe('Multi-field grouping', () => {
    it('should group by composite key', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: { category: '$category', region: '$region' },
        totalAmount: { $sum: '$amount' },
      })
      const result = stage.process(sampleSales)

      const usElectronics = result.find(
        (r) => r._id.category === 'Electronics' && r._id.region === 'US'
      )
      expect(usElectronics?.totalAmount).toBe(1299 + 599 + 399)
    })

    it('should handle three-field composite keys', () => {
      const dataWithExtraField = sampleSales.map((s) => ({
        ...s,
        quarter: 'Q1',
      }))
      const stage = createGroupStage<(typeof dataWithExtraField)[0]>({
        _id: { category: '$category', region: '$region', quarter: '$quarter' },
        count: { $count: {} },
      })
      const result = stage.process(dataWithExtraField)

      // Should have distinct combinations
      expect(result.length).toBeGreaterThan(2)
    })
  })

  describe('Null and undefined handling', () => {
    it('should group null key values together', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$salesperson',
        count: { $count: {} },
      })
      const result = stage.process(sampleSales)

      const nullGroup = result.find((r) => r._id === null)
      expect(nullGroup?.count).toBe(1)
    })

    it('should handle undefined field values in grouping', () => {
      const dataWithUndefined = [
        { group: 'A', value: 10 },
        { group: undefined, value: 20 },
        { group: 'A', value: 30 },
      ]
      const stage = createGroupStage<(typeof dataWithUndefined)[0]>({
        _id: '$group',
        total: { $sum: '$value' },
      })
      const result = stage.process(dataWithUndefined)

      expect(result.find((r) => r._id === undefined)).toBeDefined()
    })

    it('should handle null in composite keys', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: { salesperson: '$salesperson', region: '$region' },
        count: { $count: {} },
      })
      const result = stage.process(sampleSales)

      const nullSalesperson = result.find((r) => r._id.salesperson === null)
      expect(nullSalesperson).toBeDefined()
    })
  })

  describe('Expression support', () => {
    it('should support arithmetic in accumulator', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        totalValue: { $sum: { $multiply: ['$amount', '$quantity'] } },
      })
      const result = stage.process(sampleSales)

      // Electronics: 1299*1 + 599*2 + 799*3 + 399*2 = 1299 + 1198 + 2397 + 798 = 5692
      const electronics = result.find((r) => r._id === 'Electronics')
      expect(electronics?.totalValue).toBe(5692)
    })

    it('should support conditional accumulation', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$region',
        highValueCount: {
          $sum: { $cond: [{ $gt: ['$amount', 500] }, 1, 0] },
        },
      })
      const result = stage.process(sampleSales)

      const us = result.find((r) => r._id === 'US')
      expect(us?.highValueCount).toBe(2) // Laptop (1299), Phone (599)
    })
  })

  describe('TypedColumnStore compatibility', () => {
    it('should map to TypedColumnStore AggregateFunction types', () => {
      const accumulatorMapping: Record<AccumulatorType, AggregateFunction> = {
        $sum: 'sum',
        $count: 'count',
        $avg: 'avg',
        $min: 'min',
        $max: 'max',
      }

      for (const [mongoOp, columnOp] of Object.entries(accumulatorMapping)) {
        expect(columnOp).toBeDefined()
      }
    })
  })

  describe('Edge cases', () => {
    it('should handle empty input', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        count: { $count: {} },
      })
      const result = stage.process([])

      expect(result).toEqual([])
    })

    it('should handle single document', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        total: { $sum: '$amount' },
      })
      const result = stage.process([sampleSales[0]])

      expect(result).toHaveLength(1)
      expect(result[0].total).toBe(1299)
    })

    it('should handle very large groups', () => {
      const largeData = Array.from({ length: 10000 }, (_, i) => ({
        id: String(i),
        product: 'Product',
        category: i % 100 < 50 ? 'A' : 'B', // 50% A, 50% B
        amount: i,
        quantity: 1,
        region: 'US',
        date: new Date(),
        salesperson: null,
      }))

      const stage = createGroupStage<(typeof largeData)[0]>({
        _id: '$category',
        count: { $count: {} },
      })
      const result = stage.process(largeData)

      expect(result).toHaveLength(2)
      expect(result.find((r) => r._id === 'A')?.count).toBe(5000)
    })

    it('should preserve field order in output', () => {
      const stage = createGroupStage<SalesRecord>({
        _id: '$category',
        first: { $first: '$product' },
        sum: { $sum: '$amount' },
        last: { $last: '$product' },
      })
      const result = stage.process(sampleSales)

      const keys = Object.keys(result[0])
      expect(keys).toEqual(['_id', 'first', 'sum', 'last'])
    })
  })
})
