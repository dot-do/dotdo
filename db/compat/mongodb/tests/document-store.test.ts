/**
 * DocumentStore Integration Tests
 *
 * Tests for the main DocumentStore class and overall integration.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentStore, createDocumentStore, createCollection, ObjectId } from '../index'
import type { Document } from '../types'

interface User extends Document {
  name: string
  age: number
  email?: string
}

interface Order extends Document {
  userId: ObjectId
  item: string
  qty: number
  price: number
}

describe('DocumentStore', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  describe('db', () => {
    it('should get database by name', () => {
      const db = store.db('testdb')

      expect(db).toBeDefined()
      expect(db.databaseName).toBe('testdb')
    })

    it('should get default database when no name provided', () => {
      const db = store.db()

      expect(db.databaseName).toBe('default')
    })

    it('should return same database instance for same name', () => {
      const db1 = store.db('testdb')
      const db2 = store.db('testdb')

      expect(db1).toBe(db2)
    })
  })

  describe('listDatabases', () => {
    it('should list all databases', () => {
      store.db('db1')
      store.db('db2')
      store.db('db3')

      const dbs = store.listDatabases()

      expect(dbs.length).toBe(3)
      expect(dbs.map((d) => d.name)).toContain('db1')
      expect(dbs.map((d) => d.name)).toContain('db2')
      expect(dbs.map((d) => d.name)).toContain('db3')
    })
  })

  describe('dropDatabase', () => {
    it('should drop database', async () => {
      const db = store.db('todrop')
      const collection = db.collection('users')
      await collection.insertOne({ name: 'Test', age: 25 })

      const dropped = await store.dropDatabase('todrop')

      expect(dropped).toBe(true)
      expect(store.listDatabases().map((d) => d.name)).not.toContain('todrop')
    })

    it('should return false for non-existent database', async () => {
      const dropped = await store.dropDatabase('nonexistent')

      expect(dropped).toBe(false)
    })
  })
})

describe('Database', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  describe('collection', () => {
    it('should get collection', () => {
      const db = store.db('testdb')
      const collection = db.collection('users')

      expect(collection).toBeDefined()
      expect(collection.collectionName).toBe('users')
      expect(collection.dbName).toBe('testdb')
    })

    it('should return same collection instance', () => {
      const db = store.db('testdb')
      const c1 = db.collection('users')
      const c2 = db.collection('users')

      expect(c1).toBe(c2)
    })
  })

  describe('createCollection', () => {
    it('should create collection', async () => {
      const db = store.db('testdb')
      const collection = await db.createCollection('newcol')

      expect(collection.collectionName).toBe('newcol')
    })
  })

  describe('listCollections', () => {
    it('should list collections', async () => {
      const db = store.db('testdb')
      db.collection('col1')
      db.collection('col2')

      const collections = await db.listCollections().toArray()

      expect(collections.some((c) => c.name === 'col1')).toBe(true)
      expect(collections.some((c) => c.name === 'col2')).toBe(true)
    })
  })

  describe('dropCollection', () => {
    it('should drop collection', async () => {
      const db = store.db('testdb')
      const collection = db.collection('todrop')
      await collection.insertOne({ name: 'Test', age: 25 })

      const dropped = await db.dropCollection('todrop')

      expect(dropped).toBe(true)
    })
  })

  describe('dropDatabase', () => {
    it('should drop database', async () => {
      const db = store.db('testdb')
      db.collection('col1')
      db.collection('col2')

      const dropped = await db.dropDatabase()

      expect(dropped).toBe(true)
      expect((await db.listCollections().toArray()).length).toBe(0)
    })
  })

  describe('collections', () => {
    it('should return all collections', async () => {
      const db = store.db('testdb')
      db.collection('col1')
      db.collection('col2')

      const collections = await db.collections()

      expect(collections.length).toBe(2)
    })
  })
})

describe('Integration', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  it('should support complete CRUD workflow', async () => {
    const db = store.db('testdb')
    const users = db.collection<User>('users')

    // Create
    const insertResult = await users.insertOne({ name: 'Alice', age: 30 })
    expect(insertResult.acknowledged).toBe(true)

    // Read
    const user = await users.findOne({ name: 'Alice' })
    expect(user!.age).toBe(30)

    // Update
    await users.updateOne({ name: 'Alice' }, { $set: { age: 31 } })
    const updated = await users.findOne({ name: 'Alice' })
    expect(updated!.age).toBe(31)

    // Delete
    await users.deleteOne({ name: 'Alice' })
    const deleted = await users.findOne({ name: 'Alice' })
    expect(deleted).toBeNull()
  })

  it('should support cross-collection queries', async () => {
    const db = store.db('testdb')
    const users = db.collection<User>('users')
    const orders = db.collection<Order>('orders')

    // Insert user
    const userResult = await users.insertOne({ name: 'Alice', age: 30 })
    const userId = userResult.insertedId

    // Insert orders for user
    await orders.insertMany([
      { userId, item: 'apple', qty: 5, price: 1.0 },
      { userId, item: 'banana', qty: 10, price: 0.5 },
    ])

    // Query orders by userId
    const userOrders = await orders.find({ userId }).toArray()
    expect(userOrders.length).toBe(2)
  })

  it('should support aggregation across collections', async () => {
    const db = store.db('testdb')
    const orders = db.collection<Order>('orders')

    await orders.insertMany([
      { userId: new ObjectId(), item: 'apple', qty: 5, price: 1.0 },
      { userId: new ObjectId(), item: 'banana', qty: 10, price: 0.5 },
      { userId: new ObjectId(), item: 'apple', qty: 3, price: 1.0 },
    ])

    const result = await orders
      .aggregate([
        { $group: { _id: '$item', totalRevenue: { $sum: { $multiply: ['$qty', '$price'] } } } },
        { $sort: { totalRevenue: -1 } },
      ])
      .toArray()

    expect(result.length).toBe(2)
    expect((result[0] as any)._id).toBe('apple')
    expect((result[0] as any).totalRevenue).toBe(8)
  })
})

describe('Factory Functions', () => {
  describe('createDocumentStore', () => {
    it('should create a new document store', () => {
      const store = createDocumentStore()

      expect(store).toBeInstanceOf(DocumentStore)
    })

    it('should accept options', () => {
      const store = createDocumentStore({
        enableVersioning: true,
        enableFullTextSearch: true,
      })

      expect(store).toBeInstanceOf(DocumentStore)
    })
  })

  describe('createCollection', () => {
    it('should create a standalone collection', () => {
      const collection = createCollection<User>('users')

      expect(collection.collectionName).toBe('users')
      expect(collection.dbName).toBe('default')
    })

    it('should create collection with custom db name', () => {
      const collection = createCollection<User>('users', 'mydb')

      expect(collection.dbName).toBe('mydb')
    })
  })
})

describe('ObjectId Integration', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  it('should auto-generate ObjectId for documents', async () => {
    const collection = store.db('test').collection('docs')

    const result = await collection.insertOne({ name: 'Test' })

    expect(result.insertedId).toBeInstanceOf(ObjectId)
  })

  it('should use provided ObjectId', async () => {
    const collection = store.db('test').collection('docs')
    const _id = new ObjectId()

    const result = await collection.insertOne({ _id, name: 'Test' })

    expect(result.insertedId.equals(_id)).toBe(true)
  })

  it('should find by ObjectId', async () => {
    const collection = store.db('test').collection('docs')
    const result = await collection.insertOne({ name: 'Test' })

    const doc = await collection.findOne({ _id: result.insertedId })

    expect(doc!.name).toBe('Test')
  })

  it('should extract timestamp from ObjectId', async () => {
    const collection = store.db('test').collection('docs')
    const now = new Date()

    const result = await collection.insertOne({ name: 'Test' })
    const doc = await collection.findOne({ _id: result.insertedId })

    const timestamp = doc!._id.getTimestamp()
    expect(Math.abs(timestamp.getTime() - now.getTime())).toBeLessThan(1000)
  })
})
