/**
 * MongoDB Client Tests
 *
 * Tests for MongoClient API with in-memory backend.
 * Following red-green-refactor TDD pattern.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MongoClient, ObjectId } from '../src/index'

describe('MongoClient', () => {
  let client: MongoClient

  beforeEach(() => {
    client = new MongoClient()
  })

  describe('connection', () => {
    it('should connect successfully', async () => {
      await client.connect()
      expect(client.isConnected()).toBe(true)
    })

    it('should disconnect successfully', async () => {
      await client.connect()
      await client.close()
      expect(client.isConnected()).toBe(false)
    })
  })

  describe('db().collection() pattern', () => {
    it('should access database by name', () => {
      const db = client.db('testdb')
      expect(db.databaseName).toBe('testdb')
    })

    it('should access collection by name', () => {
      const collection = client.db('testdb').collection('users')
      expect(collection.collectionName).toBe('users')
    })

    it('should use default database name', () => {
      const db = client.db()
      expect(db.databaseName).toBe('test')
    })
  })
})

describe('Collection CRUD Operations', () => {
  let client: MongoClient
  let collection: ReturnType<ReturnType<MongoClient['db']>['collection']>

  beforeEach(async () => {
    client = new MongoClient()
    await client.connect()
    collection = client.db('testdb').collection('users')
  })

  describe('insertOne', () => {
    it('should insert a document and return insertedId', async () => {
      const result = await collection.insertOne({ name: 'Alice', age: 30 })

      expect(result.acknowledged).toBe(true)
      expect(result.insertedId).toBeDefined()
      expect(typeof result.insertedId).toBe('string')
    })

    it('should use provided _id if specified', async () => {
      const customId = new ObjectId().toString()
      const result = await collection.insertOne({ _id: customId, name: 'Bob' })

      expect(result.insertedId).toBe(customId)
    })

    it('should reject duplicate _id', async () => {
      const customId = new ObjectId().toString()
      await collection.insertOne({ _id: customId, name: 'Alice' })

      await expect(
        collection.insertOne({ _id: customId, name: 'Bob' })
      ).rejects.toThrow(/duplicate key/)
    })
  })

  describe('insertMany', () => {
    it('should insert multiple documents', async () => {
      const result = await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 35 },
      ])

      expect(result.acknowledged).toBe(true)
      expect(result.insertedCount).toBe(3)
      expect(result.insertedIds).toHaveLength(3)
    })
  })

  describe('findOne', () => {
    it('should find a document by filter', async () => {
      await collection.insertOne({ name: 'Alice', age: 30 })

      const doc = await collection.findOne({ name: 'Alice' })

      expect(doc).not.toBeNull()
      expect(doc?.name).toBe('Alice')
      expect(doc?.age).toBe(30)
    })

    it('should return null if no document matches', async () => {
      const doc = await collection.findOne({ name: 'NonExistent' })

      expect(doc).toBeNull()
    })

    it('should find by _id', async () => {
      const result = await collection.insertOne({ name: 'Alice' })
      const doc = await collection.findOne({ _id: result.insertedId })

      expect(doc).not.toBeNull()
      expect(doc?.name).toBe('Alice')
    })
  })

  describe('find', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' },
        { name: 'Charlie', age: 35, city: 'NYC' },
      ])
    })

    it('should find all documents with empty filter', async () => {
      const docs = await collection.find({}).toArray()

      expect(docs).toHaveLength(3)
    })

    it('should filter documents by field', async () => {
      const docs = await collection.find({ city: 'NYC' }).toArray()

      expect(docs).toHaveLength(2)
      expect(docs.every(d => d.city === 'NYC')).toBe(true)
    })

    it('should support limit', async () => {
      const docs = await collection.find({}).limit(2).toArray()

      expect(docs).toHaveLength(2)
    })

    it('should support skip', async () => {
      const docs = await collection.find({}).skip(1).toArray()

      expect(docs).toHaveLength(2)
    })

    it('should support sort ascending', async () => {
      const docs = await collection.find({}).sort({ age: 1 }).toArray()

      expect(docs[0].age).toBe(25)
      expect(docs[1].age).toBe(30)
      expect(docs[2].age).toBe(35)
    })

    it('should support sort descending', async () => {
      const docs = await collection.find({}).sort({ age: -1 }).toArray()

      expect(docs[0].age).toBe(35)
      expect(docs[1].age).toBe(30)
      expect(docs[2].age).toBe(25)
    })
  })

  describe('updateOne', () => {
    it('should update a single document', async () => {
      await collection.insertOne({ name: 'Alice', age: 30 })

      const result = await collection.updateOne(
        { name: 'Alice' },
        { $set: { age: 31 } }
      )

      expect(result.acknowledged).toBe(true)
      expect(result.matchedCount).toBe(1)
      expect(result.modifiedCount).toBe(1)

      const doc = await collection.findOne({ name: 'Alice' })
      expect(doc?.age).toBe(31)
    })

    it('should return 0 counts if no match', async () => {
      const result = await collection.updateOne(
        { name: 'NonExistent' },
        { $set: { age: 99 } }
      )

      expect(result.matchedCount).toBe(0)
      expect(result.modifiedCount).toBe(0)
    })

    it('should support upsert', async () => {
      const result = await collection.updateOne(
        { name: 'New' },
        { $set: { name: 'New', age: 20 } },
        { upsert: true }
      )

      expect(result.upsertedCount).toBe(1)
      expect(result.upsertedId).toBeDefined()

      const doc = await collection.findOne({ name: 'New' })
      expect(doc).not.toBeNull()
    })
  })

  describe('updateMany', () => {
    it('should update multiple documents', async () => {
      await collection.insertMany([
        { name: 'Alice', city: 'NYC', updated: false },
        { name: 'Bob', city: 'NYC', updated: false },
        { name: 'Charlie', city: 'LA', updated: false },
      ])

      const result = await collection.updateMany(
        { city: 'NYC' },
        { $set: { updated: true } }
      )

      expect(result.matchedCount).toBe(2)
      expect(result.modifiedCount).toBe(2)

      const docs = await collection.find({ updated: true }).toArray()
      expect(docs).toHaveLength(2)
    })
  })

  describe('deleteOne', () => {
    it('should delete a single document', async () => {
      await collection.insertOne({ name: 'Alice' })

      const result = await collection.deleteOne({ name: 'Alice' })

      expect(result.acknowledged).toBe(true)
      expect(result.deletedCount).toBe(1)

      const doc = await collection.findOne({ name: 'Alice' })
      expect(doc).toBeNull()
    })

    it('should return 0 if no match', async () => {
      const result = await collection.deleteOne({ name: 'NonExistent' })

      expect(result.deletedCount).toBe(0)
    })
  })

  describe('deleteMany', () => {
    it('should delete multiple documents', async () => {
      await collection.insertMany([
        { name: 'Alice', city: 'NYC' },
        { name: 'Bob', city: 'NYC' },
        { name: 'Charlie', city: 'LA' },
      ])

      const result = await collection.deleteMany({ city: 'NYC' })

      expect(result.deletedCount).toBe(2)

      const remaining = await collection.find({}).toArray()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].name).toBe('Charlie')
    })
  })

  describe('countDocuments', () => {
    it('should count all documents', async () => {
      await collection.insertMany([
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' },
      ])

      const count = await collection.countDocuments()

      expect(count).toBe(3)
    })

    it('should count filtered documents', async () => {
      await collection.insertMany([
        { name: 'Alice', city: 'NYC' },
        { name: 'Bob', city: 'NYC' },
        { name: 'Charlie', city: 'LA' },
      ])

      const count = await collection.countDocuments({ city: 'NYC' })

      expect(count).toBe(2)
    })
  })
})

describe('Query Operators', () => {
  let client: MongoClient
  let collection: ReturnType<ReturnType<MongoClient['db']>['collection']>

  beforeEach(async () => {
    client = new MongoClient()
    await client.connect()
    collection = client.db('testdb').collection('products')
    await collection.insertMany([
      { name: 'Apple', price: 1.5, quantity: 100, category: 'fruit' },
      { name: 'Banana', price: 0.5, quantity: 150, category: 'fruit' },
      { name: 'Carrot', price: 0.75, quantity: 80, category: 'vegetable' },
      { name: 'Milk', price: 3.0, quantity: 50, category: 'dairy' },
    ])
  })

  describe('comparison operators', () => {
    it('should support $eq', async () => {
      const docs = await collection.find({ price: { $eq: 1.5 } }).toArray()

      expect(docs).toHaveLength(1)
      expect(docs[0].name).toBe('Apple')
    })

    it('should support $ne', async () => {
      const docs = await collection.find({ category: { $ne: 'fruit' } }).toArray()

      expect(docs).toHaveLength(2)
      expect(docs.map(d => d.name)).toContain('Carrot')
      expect(docs.map(d => d.name)).toContain('Milk')
    })

    it('should support $gt', async () => {
      const docs = await collection.find({ price: { $gt: 1.0 } }).toArray()

      expect(docs).toHaveLength(2)
      expect(docs.map(d => d.name)).toContain('Apple')
      expect(docs.map(d => d.name)).toContain('Milk')
    })

    it('should support $gte', async () => {
      const docs = await collection.find({ price: { $gte: 1.5 } }).toArray()

      expect(docs).toHaveLength(2)
      expect(docs.map(d => d.name)).toContain('Apple')
      expect(docs.map(d => d.name)).toContain('Milk')
    })

    it('should support $lt', async () => {
      const docs = await collection.find({ price: { $lt: 1.0 } }).toArray()

      expect(docs).toHaveLength(2)
      expect(docs.map(d => d.name)).toContain('Banana')
      expect(docs.map(d => d.name)).toContain('Carrot')
    })

    it('should support $lte', async () => {
      const docs = await collection.find({ price: { $lte: 0.75 } }).toArray()

      expect(docs).toHaveLength(2)
      expect(docs.map(d => d.name)).toContain('Banana')
      expect(docs.map(d => d.name)).toContain('Carrot')
    })

    it('should support $in', async () => {
      const docs = await collection.find({ category: { $in: ['fruit', 'dairy'] } }).toArray()

      expect(docs).toHaveLength(3)
    })

    it('should support $nin', async () => {
      const docs = await collection.find({ category: { $nin: ['fruit', 'dairy'] } }).toArray()

      expect(docs).toHaveLength(1)
      expect(docs[0].name).toBe('Carrot')
    })
  })

  describe('logical operators', () => {
    it('should support $and', async () => {
      const docs = await collection.find({
        $and: [
          { category: 'fruit' },
          { price: { $gt: 1.0 } }
        ]
      }).toArray()

      expect(docs).toHaveLength(1)
      expect(docs[0].name).toBe('Apple')
    })

    it('should support $or', async () => {
      const docs = await collection.find({
        $or: [
          { category: 'dairy' },
          { price: { $lt: 0.6 } }
        ]
      }).toArray()

      expect(docs).toHaveLength(2)
      expect(docs.map(d => d.name)).toContain('Banana')
      expect(docs.map(d => d.name)).toContain('Milk')
    })

    it('should support implicit $and with multiple fields', async () => {
      const docs = await collection.find({
        category: 'fruit',
        price: { $gt: 1.0 }
      }).toArray()

      expect(docs).toHaveLength(1)
      expect(docs[0].name).toBe('Apple')
    })
  })

  describe('element operators', () => {
    it('should support $exists true', async () => {
      await collection.insertOne({ name: 'Test', noQuantity: true })

      const docs = await collection.find({ quantity: { $exists: true } }).toArray()

      expect(docs).toHaveLength(4) // Original 4 docs have quantity
    })

    it('should support $exists false', async () => {
      await collection.insertOne({ name: 'Test', noQuantity: true })

      const docs = await collection.find({ quantity: { $exists: false } }).toArray()

      expect(docs).toHaveLength(1)
      expect(docs[0].name).toBe('Test')
    })
  })
})

describe('Update Operators', () => {
  let client: MongoClient
  let collection: ReturnType<ReturnType<MongoClient['db']>['collection']>

  beforeEach(async () => {
    client = new MongoClient()
    await client.connect()
    collection = client.db('testdb').collection('items')
  })

  describe('$set', () => {
    it('should set a field value', async () => {
      await collection.insertOne({ name: 'Test', value: 1 })

      await collection.updateOne({ name: 'Test' }, { $set: { value: 2, newField: 'added' } })

      const doc = await collection.findOne({ name: 'Test' })
      expect(doc?.value).toBe(2)
      expect(doc?.newField).toBe('added')
    })
  })

  describe('$unset', () => {
    it('should remove a field', async () => {
      await collection.insertOne({ name: 'Test', toRemove: 'bye' })

      await collection.updateOne({ name: 'Test' }, { $unset: { toRemove: '' } })

      const doc = await collection.findOne({ name: 'Test' })
      expect(doc?.toRemove).toBeUndefined()
    })
  })

  describe('$inc', () => {
    it('should increment a numeric field', async () => {
      await collection.insertOne({ name: 'Counter', count: 5 })

      await collection.updateOne({ name: 'Counter' }, { $inc: { count: 3 } })

      const doc = await collection.findOne({ name: 'Counter' })
      expect(doc?.count).toBe(8)
    })

    it('should handle negative increment', async () => {
      await collection.insertOne({ name: 'Counter', count: 10 })

      await collection.updateOne({ name: 'Counter' }, { $inc: { count: -3 } })

      const doc = await collection.findOne({ name: 'Counter' })
      expect(doc?.count).toBe(7)
    })
  })

  describe('$push', () => {
    it('should push value to array', async () => {
      await collection.insertOne({ name: 'List', items: ['a', 'b'] })

      await collection.updateOne({ name: 'List' }, { $push: { items: 'c' } })

      const doc = await collection.findOne({ name: 'List' })
      expect(doc?.items).toEqual(['a', 'b', 'c'])
    })

    it('should create array if field does not exist', async () => {
      await collection.insertOne({ name: 'NoArray' })

      await collection.updateOne({ name: 'NoArray' }, { $push: { items: 'first' } })

      const doc = await collection.findOne({ name: 'NoArray' })
      expect(doc?.items).toEqual(['first'])
    })
  })

  describe('$pull', () => {
    it('should remove matching values from array', async () => {
      await collection.insertOne({ name: 'List', items: ['a', 'b', 'c', 'b'] })

      await collection.updateOne({ name: 'List' }, { $pull: { items: 'b' } })

      const doc = await collection.findOne({ name: 'List' })
      expect(doc?.items).toEqual(['a', 'c'])
    })
  })

  describe('$addToSet', () => {
    it('should add value only if not present', async () => {
      await collection.insertOne({ name: 'Set', values: ['a', 'b'] })

      await collection.updateOne({ name: 'Set' }, { $addToSet: { values: 'b' } })
      let doc = await collection.findOne({ name: 'Set' })
      expect(doc?.values).toEqual(['a', 'b'])

      await collection.updateOne({ name: 'Set' }, { $addToSet: { values: 'c' } })
      doc = await collection.findOne({ name: 'Set' })
      expect(doc?.values).toEqual(['a', 'b', 'c'])
    })
  })
})

describe('ObjectId', () => {
  it('should generate unique IDs', () => {
    const id1 = new ObjectId()
    const id2 = new ObjectId()

    expect(id1.toString()).not.toBe(id2.toString())
  })

  it('should accept existing ID string', () => {
    const idStr = '507f1f77bcf86cd799439011'
    const id = new ObjectId(idStr)

    expect(id.toString()).toBe(idStr)
  })

  it('should validate ID format', () => {
    expect(ObjectId.isValid('507f1f77bcf86cd799439011')).toBe(true)
    expect(ObjectId.isValid('invalid')).toBe(false)
    expect(ObjectId.isValid('507f1f77bcf86cd7994390')).toBe(false) // Too short
  })

  it('should compare IDs for equality', () => {
    const idStr = '507f1f77bcf86cd799439011'
    const id1 = new ObjectId(idStr)
    const id2 = new ObjectId(idStr)

    expect(id1.equals(id2)).toBe(true)
    expect(id1.equals(idStr)).toBe(true)
  })

  it('should extract timestamp', () => {
    const id = new ObjectId()
    const timestamp = id.getTimestamp()

    expect(timestamp instanceof Date).toBe(true)
    // Timestamp should be within the last few seconds
    expect(Date.now() - timestamp.getTime()).toBeLessThan(5000)
  })
})

describe('Isolation', () => {
  it('should isolate data between databases', async () => {
    const client = new MongoClient()
    await client.connect()

    const db1 = client.db('db1')
    const db2 = client.db('db2')

    await db1.collection('users').insertOne({ name: 'Alice' })
    await db2.collection('users').insertOne({ name: 'Bob' })

    const docs1 = await db1.collection('users').find({}).toArray()
    const docs2 = await db2.collection('users').find({}).toArray()

    expect(docs1).toHaveLength(1)
    expect(docs1[0].name).toBe('Alice')
    expect(docs2).toHaveLength(1)
    expect(docs2[0].name).toBe('Bob')
  })

  it('should isolate data between collections', async () => {
    const client = new MongoClient()
    await client.connect()

    const db = client.db('testdb')

    await db.collection('users').insertOne({ name: 'Alice' })
    await db.collection('products').insertOne({ name: 'Widget' })

    const users = await db.collection('users').find({}).toArray()
    const products = await db.collection('products').find({}).toArray()

    expect(users).toHaveLength(1)
    expect(users[0].name).toBe('Alice')
    expect(products).toHaveLength(1)
    expect(products[0].name).toBe('Widget')
  })
})
