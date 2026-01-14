/**
 * Query Execution Tests
 *
 * Tests for MongoDB query operators and filter execution.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Collection, ObjectId, evaluateFilterDirect, type Document, type WithId } from '../index'

interface User extends Document {
  name: string
  age: number
  city?: string
  tags?: string[]
  nested?: {
    field?: string
    deep?: {
      value?: number
    }
  }
}

describe('Query Operators', () => {
  let collection: Collection<User>

  beforeEach(async () => {
    collection = new Collection<User>('testdb', 'users')
    await collection.insertMany([
      { name: 'Alice', age: 30, city: 'NYC', tags: ['a', 'b'] },
      { name: 'Bob', age: 25, city: 'LA', tags: ['b', 'c'] },
      { name: 'Charlie', age: 35, city: 'NYC', tags: ['a'] },
      { name: 'Diana', age: 28, city: 'Chicago', tags: ['c', 'd'] },
      { name: 'Eve', age: 22, city: 'LA', tags: [] },
    ])
  })

  describe('Comparison Operators', () => {
    it('should filter with $eq', async () => {
      const docs = await collection.find({ age: { $eq: 30 } }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].name).toBe('Alice')
    })

    it('should filter with $ne', async () => {
      const docs = await collection.find({ city: { $ne: 'NYC' } }).toArray()

      expect(docs.length).toBe(3)
    })

    it('should filter with $gt', async () => {
      const docs = await collection.find({ age: { $gt: 28 } }).toArray()

      expect(docs.length).toBe(2)
    })

    it('should filter with $gte', async () => {
      const docs = await collection.find({ age: { $gte: 28 } }).toArray()

      expect(docs.length).toBe(3)
    })

    it('should filter with $lt', async () => {
      const docs = await collection.find({ age: { $lt: 28 } }).toArray()

      expect(docs.length).toBe(2)
    })

    it('should filter with $lte', async () => {
      const docs = await collection.find({ age: { $lte: 28 } }).toArray()

      expect(docs.length).toBe(3)
    })

    it('should filter with $in', async () => {
      const docs = await collection.find({ city: { $in: ['NYC', 'LA'] } }).toArray()

      expect(docs.length).toBe(4)
    })

    it('should filter with $nin', async () => {
      const docs = await collection.find({ city: { $nin: ['NYC', 'LA'] } }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].city).toBe('Chicago')
    })
  })

  describe('Logical Operators', () => {
    it('should filter with $and', async () => {
      const docs = await collection.find({
        $and: [{ city: 'NYC' }, { age: { $gt: 30 } }],
      }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].name).toBe('Charlie')
    })

    it('should filter with $or', async () => {
      const docs = await collection.find({
        $or: [{ name: 'Alice' }, { name: 'Bob' }],
      }).toArray()

      expect(docs.length).toBe(2)
    })

    it('should filter with $nor', async () => {
      const docs = await collection.find({
        $nor: [{ city: 'NYC' }, { city: 'LA' }],
      }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].city).toBe('Chicago')
    })

    it('should filter with $not', async () => {
      const docs = await collection.find({
        age: { $not: { $gt: 30 } },
      }).toArray()

      expect(docs.length).toBe(4)
    })
  })

  describe('Element Operators', () => {
    it('should filter with $exists true', async () => {
      const docs = await collection.find({ city: { $exists: true } }).toArray()

      expect(docs.length).toBe(5)
    })

    it('should filter with $exists false', async () => {
      await collection.insertOne({ name: 'Frank', age: 40 })

      const docs = await collection.find({ city: { $exists: false } }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].name).toBe('Frank')
    })
  })

  describe('Evaluation Operators', () => {
    it('should filter with $regex', async () => {
      const docs = await collection.find({
        name: { $regex: '^A' },
      }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].name).toBe('Alice')
    })

    it('should filter with $regex and $options', async () => {
      const docs = await collection.find({
        name: { $regex: 'alice', $options: 'i' },
      }).toArray()

      expect(docs.length).toBe(1)
    })
  })

  describe('Array Operators', () => {
    it('should filter array element match', async () => {
      const docs = await collection.find({ tags: 'a' }).toArray()

      expect(docs.length).toBe(2)
    })

    it('should filter with $all', async () => {
      const docs = await collection.find({
        tags: { $all: ['a', 'b'] },
      }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].name).toBe('Alice')
    })

    it('should filter with $size', async () => {
      const docs = await collection.find({
        tags: { $size: 2 },
      }).toArray()

      expect(docs.length).toBe(3)
    })

    it('should filter empty array with $size', async () => {
      const docs = await collection.find({
        tags: { $size: 0 },
      }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].name).toBe('Eve')
    })
  })

  describe('Combined Operators', () => {
    it('should filter with combined operators', async () => {
      const docs = await collection.find({
        age: { $gte: 25, $lte: 30 },
        city: 'NYC',
      }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].name).toBe('Alice')
    })

    it('should filter with implicit $and', async () => {
      const docs = await collection.find({
        city: 'NYC',
        age: { $gt: 30 },
      }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].name).toBe('Charlie')
    })
  })

  describe('Nested Field Queries', () => {
    beforeEach(async () => {
      await collection.insertOne({
        name: 'Nested',
        age: 40,
        nested: {
          field: 'value',
          deep: {
            value: 100,
          },
        },
      })
    })

    it('should query nested field', async () => {
      const docs = await collection.find({ 'nested.field': 'value' }).toArray()

      expect(docs.length).toBe(1)
      expect(docs[0].name).toBe('Nested')
    })

    it('should query deeply nested field', async () => {
      const docs = await collection.find({ 'nested.deep.value': 100 }).toArray()

      expect(docs.length).toBe(1)
    })
  })
})

describe('evaluateFilterDirect', () => {
  it('should match empty filter to all documents', () => {
    const doc = { _id: new ObjectId(), name: 'Test' } as WithId<Document>

    expect(evaluateFilterDirect({}, doc)).toBe(true)
  })

  it('should match equality filter', () => {
    const doc = { _id: new ObjectId(), name: 'Test' } as WithId<Document>

    expect(evaluateFilterDirect({ name: 'Test' }, doc)).toBe(true)
    expect(evaluateFilterDirect({ name: 'Other' }, doc)).toBe(false)
  })

  it('should handle null values', () => {
    const doc = { _id: new ObjectId(), name: null } as WithId<Document>

    expect(evaluateFilterDirect({ name: null }, doc)).toBe(true)
    expect(evaluateFilterDirect({ name: { $exists: true } }, doc)).toBe(true)
  })

  it('should handle undefined values', () => {
    const doc = { _id: new ObjectId() } as WithId<Document>

    expect(evaluateFilterDirect({ name: { $exists: false } }, doc)).toBe(true)
  })
})
