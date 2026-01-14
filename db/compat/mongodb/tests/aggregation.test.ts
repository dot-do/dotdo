/**
 * Aggregation Pipeline Tests
 *
 * Tests for MongoDB-compatible aggregation pipeline.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Collection, type Document } from '../index'

interface Order extends Document {
  item: string
  qty: number
  price: number
  status?: string
  date?: Date
}

describe('Aggregation Pipeline', () => {
  let collection: Collection<Order>

  beforeEach(async () => {
    collection = new Collection<Order>('testdb', 'orders')
    await collection.insertMany([
      { item: 'apple', qty: 5, price: 1.0, status: 'A' },
      { item: 'banana', qty: 10, price: 0.5, status: 'A' },
      { item: 'apple', qty: 3, price: 1.0, status: 'B' },
      { item: 'orange', qty: 8, price: 0.75, status: 'A' },
      { item: 'apple', qty: 2, price: 1.0, status: 'A' },
    ])
  })

  describe('$match stage', () => {
    it('should filter documents', async () => {
      const result = await collection
        .aggregate([{ $match: { item: 'apple' } }])
        .toArray()

      expect(result.length).toBe(3)
    })

    it('should filter with operators', async () => {
      const result = await collection
        .aggregate([{ $match: { qty: { $gt: 5 } } }])
        .toArray()

      expect(result.length).toBe(2)
    })
  })

  describe('$group stage', () => {
    it('should group by field', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: '$item', count: { $sum: 1 } } },
        ])
        .toArray()

      expect(result.length).toBe(3)
      const apple = result.find((r: any) => r._id === 'apple')
      expect(apple!.count).toBe(3)
    })

    it('should calculate $sum', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: '$item', totalQty: { $sum: '$qty' } } },
        ])
        .toArray()

      const apple = result.find((r: any) => r._id === 'apple')
      expect(apple!.totalQty).toBe(10)
    })

    it('should calculate $avg', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: '$item', avgQty: { $avg: '$qty' } } },
        ])
        .toArray()

      const apple = result.find((r: any) => r._id === 'apple')
      expect(apple!.avgQty).toBeCloseTo(10 / 3)
    })

    it('should calculate $min', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: '$item', minQty: { $min: '$qty' } } },
        ])
        .toArray()

      const apple = result.find((r: any) => r._id === 'apple')
      expect(apple!.minQty).toBe(2)
    })

    it('should calculate $max', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: '$item', maxQty: { $max: '$qty' } } },
        ])
        .toArray()

      const apple = result.find((r: any) => r._id === 'apple')
      expect(apple!.maxQty).toBe(5)
    })

    it('should calculate $first', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: '$item', firstQty: { $first: '$qty' } } },
        ])
        .toArray()

      const apple = result.find((r: any) => r._id === 'apple')
      expect(apple!.firstQty).toBe(5)
    })

    it('should calculate $last', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: '$item', lastQty: { $last: '$qty' } } },
        ])
        .toArray()

      const apple = result.find((r: any) => r._id === 'apple')
      expect(apple!.lastQty).toBe(2)
    })

    it('should collect with $push', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: '$item', quantities: { $push: '$qty' } } },
        ])
        .toArray()

      const apple = result.find((r: any) => r._id === 'apple')
      expect(apple!.quantities).toEqual([5, 3, 2])
    })

    it('should collect unique with $addToSet', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: '$item', prices: { $addToSet: '$price' } } },
        ])
        .toArray()

      const apple = result.find((r: any) => r._id === 'apple')
      expect(apple!.prices).toEqual([1.0])
    })

    it('should group by null for totals', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: null, totalQty: { $sum: '$qty' } } },
        ])
        .toArray()

      expect(result.length).toBe(1)
      expect(result[0].totalQty).toBe(28)
    })

    it('should group by compound key', async () => {
      const result = await collection
        .aggregate([
          { $group: { _id: { item: '$item', status: '$status' }, count: { $sum: 1 } } },
        ])
        .toArray()

      expect(result.length).toBe(4)
    })
  })

  describe('$sort stage', () => {
    it('should sort ascending', async () => {
      const result = await collection
        .aggregate([{ $sort: { qty: 1 } }])
        .toArray()

      expect(result[0].qty).toBe(2)
      expect(result[4].qty).toBe(10)
    })

    it('should sort descending', async () => {
      const result = await collection
        .aggregate([{ $sort: { qty: -1 } }])
        .toArray()

      expect(result[0].qty).toBe(10)
      expect(result[4].qty).toBe(2)
    })
  })

  describe('$limit stage', () => {
    it('should limit results', async () => {
      const result = await collection
        .aggregate([{ $limit: 2 }])
        .toArray()

      expect(result.length).toBe(2)
    })
  })

  describe('$skip stage', () => {
    it('should skip results', async () => {
      const result = await collection
        .aggregate([{ $skip: 3 }])
        .toArray()

      expect(result.length).toBe(2)
    })
  })

  describe('$project stage', () => {
    it('should include fields', async () => {
      const result = await collection
        .aggregate([{ $project: { item: 1, qty: 1 } }])
        .toArray()

      expect(result[0].item).toBeDefined()
      expect(result[0].qty).toBeDefined()
      expect((result[0] as any).price).toBeUndefined()
    })

    it('should exclude fields', async () => {
      const result = await collection
        .aggregate([{ $project: { price: 0 } }])
        .toArray()

      expect(result[0].item).toBeDefined()
      expect((result[0] as any).price).toBeUndefined()
    })

    it('should compute new fields', async () => {
      const result = await collection
        .aggregate([
          { $project: { item: 1, total: { $multiply: ['$qty', '$price'] } } },
        ])
        .toArray()

      const apple = result.find((r: any) => r.item === 'apple' && (r as any).total === 5)
      expect(apple).toBeDefined()
    })
  })

  describe('$addFields stage', () => {
    it('should add computed fields', async () => {
      const result = await collection
        .aggregate([
          { $addFields: { total: { $multiply: ['$qty', '$price'] } } },
        ])
        .toArray()

      expect((result[0] as any).total).toBeDefined()
      expect(result[0].item).toBeDefined() // original field preserved
    })
  })

  describe('$set stage', () => {
    it('should set fields (alias for $addFields)', async () => {
      const result = await collection
        .aggregate([
          { $set: { total: { $multiply: ['$qty', '$price'] } } },
        ])
        .toArray()

      expect((result[0] as any).total).toBeDefined()
    })
  })

  describe('$count stage', () => {
    it('should count documents', async () => {
      const result = await collection
        .aggregate([{ $match: { item: 'apple' } }, { $count: 'total' }])
        .toArray()

      expect(result.length).toBe(1)
      expect((result[0] as any).total).toBe(3)
    })
  })

  describe('$unwind stage', () => {
    beforeEach(async () => {
      await collection.drop()
      await collection.insertMany([
        { item: 'apple', qty: 5, price: 1.0, tags: ['fruit', 'red'] } as any,
        { item: 'banana', qty: 10, price: 0.5, tags: ['fruit', 'yellow'] } as any,
      ])
    })

    it('should unwind array field', async () => {
      const result = await collection
        .aggregate([{ $unwind: '$tags' }])
        .toArray()

      expect(result.length).toBe(4)
    })

    it('should preserve null and empty arrays', async () => {
      await collection.insertOne({ item: 'orange', qty: 3, price: 0.75, tags: [] } as any)
      await collection.insertOne({ item: 'grape', qty: 7, price: 0.5 } as any)

      const result = await collection
        .aggregate([
          { $unwind: { path: '$tags', preserveNullAndEmptyArrays: true } },
        ])
        .toArray()

      expect(result.length).toBe(6)
    })

    it('should include array index', async () => {
      const result = await collection
        .aggregate([
          { $unwind: { path: '$tags', includeArrayIndex: 'tagIndex' } },
        ])
        .toArray()

      expect((result[0] as any).tagIndex).toBe(0)
      expect((result[1] as any).tagIndex).toBe(1)
    })
  })

  describe('Pipeline Combinations', () => {
    it('should combine multiple stages', async () => {
      const result = await collection
        .aggregate([
          { $match: { qty: { $gte: 5 } } },
          { $group: { _id: '$item', totalQty: { $sum: '$qty' } } },
          { $sort: { totalQty: -1 } },
          { $limit: 2 },
        ])
        .toArray()

      expect(result.length).toBe(2)
      expect((result[0] as any).totalQty).toBeGreaterThanOrEqual((result[1] as any).totalQty)
    })

    it('should handle match -> group -> sort', async () => {
      const result = await collection
        .aggregate([
          { $match: { status: 'A' } },
          { $group: { _id: '$item', avgQty: { $avg: '$qty' } } },
          { $sort: { avgQty: 1 } },
        ])
        .toArray()

      expect(result.length).toBe(3)
    })
  })

  describe('Cursor Operations', () => {
    it('should iterate with hasNext/next', async () => {
      const cursor = collection.aggregate([{ $match: { item: 'apple' } }])
      const items: unknown[] = []

      while (await cursor.hasNext()) {
        items.push(await cursor.next())
      }

      expect(items.length).toBe(3)
    })

    it('should convert to array', async () => {
      const result = await collection
        .aggregate([{ $match: { item: 'apple' } }])
        .toArray()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(3)
    })

    it('should iterate with forEach', async () => {
      const items: unknown[] = []

      await collection
        .aggregate([{ $match: { item: 'apple' } }])
        .forEach((doc) => {
          items.push(doc)
        })

      expect(items.length).toBe(3)
    })
  })

  describe('$facet stage', () => {
    it('should run multiple pipelines in parallel', async () => {
      const result = await collection
        .aggregate([
          {
            $facet: {
              byItem: [
                { $group: { _id: '$item', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
              ],
              byStatus: [
                { $group: { _id: '$status', count: { $sum: 1 } } },
              ],
              totalQty: [
                { $group: { _id: null, total: { $sum: '$qty' } } },
              ],
            },
          },
        ])
        .toArray()

      expect(result.length).toBe(1)
      expect((result[0] as any).byItem.length).toBe(3)
      expect((result[0] as any).byStatus.length).toBe(2)
      expect((result[0] as any).totalQty[0].total).toBe(28)
    })
  })

  describe('$bucket stage', () => {
    it('should categorize documents into buckets', async () => {
      const result = await collection
        .aggregate([
          {
            $bucket: {
              groupBy: '$qty',
              boundaries: [0, 5, 10, 15],
              default: 'Other',
            },
          },
        ])
        .toArray()

      expect(result.length).toBeGreaterThan(0)
      expect(result.some((r: any) => r._id === 0)).toBe(true)
    })

    it('should apply output accumulators', async () => {
      const result = await collection
        .aggregate([
          {
            $bucket: {
              groupBy: '$qty',
              boundaries: [0, 5, 10, 15],
              output: {
                count: { $sum: 1 },
                avgPrice: { $avg: '$price' },
              },
            },
          },
        ])
        .toArray()

      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('count')
      expect(result[0]).toHaveProperty('avgPrice')
    })
  })

  describe('$replaceRoot stage', () => {
    beforeEach(async () => {
      await collection.drop()
      await collection.insertMany([
        { item: 'apple', qty: 5, price: 1.0, metadata: { color: 'red', size: 'medium' } } as any,
        { item: 'banana', qty: 10, price: 0.5, metadata: { color: 'yellow', size: 'large' } } as any,
      ])
    })

    it('should replace document with nested field', async () => {
      const result = await collection
        .aggregate([
          { $replaceRoot: { newRoot: '$metadata' } },
        ])
        .toArray()

      expect(result.length).toBe(2)
      expect((result[0] as any).color).toBeDefined()
      expect((result[0] as any).item).toBeUndefined()
    })
  })

  describe('$replaceWith stage', () => {
    beforeEach(async () => {
      await collection.drop()
      await collection.insertMany([
        { item: 'apple', qty: 5, price: 1.0, details: { vendor: 'Farm A', organic: true } } as any,
      ])
    })

    it('should replace document with expression result', async () => {
      const result = await collection
        .aggregate([
          { $replaceWith: '$details' },
        ])
        .toArray()

      expect(result.length).toBe(1)
      expect((result[0] as any).vendor).toBe('Farm A')
      expect((result[0] as any).item).toBeUndefined()
    })
  })

  describe('$sample stage', () => {
    it('should randomly sample documents', async () => {
      const result = await collection
        .aggregate([{ $sample: { size: 2 } }])
        .toArray()

      expect(result.length).toBe(2)
    })

    it('should return all docs if sample size exceeds total', async () => {
      const result = await collection
        .aggregate([{ $sample: { size: 100 } }])
        .toArray()

      expect(result.length).toBe(5)
    })
  })
})
