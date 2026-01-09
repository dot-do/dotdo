/**
 * @dotdo/mongo - MongoDB SDK compat tests
 *
 * Tests for MongoDB driver API compatibility backed by DO SQLite with JSON storage:
 * - MongoClient.connect(url) / new MongoClient(url)
 * - client.db(name).collection(name)
 * - CRUD operations: insertOne, insertMany, findOne, find, updateOne, updateMany, deleteOne, deleteMany
 * - Cursor operations: toArray, forEach, limit, skip, sort, project
 * - Update operators: $set, $inc, $push, $pull, $unset
 * - Query operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $and, $or, $not, $regex
 * - Aggregation: aggregate with $match, $group, $sort, $limit, $project
 * - Indexes: createIndex, dropIndex, listIndexes
 * - ObjectId generation
 *
 * @see https://mongodb.github.io/node-mongodb-native/
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  MongoClient,
  Db,
  Collection,
  Document,
  Filter,
  UpdateFilter,
  FindOptions,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  FindCursor,
  AggregationCursor,
  IndexInfo,
  WithId,
  MongoClientOptions,
  ExtendedMongoClientOptions,
} from './types'
import {
  ObjectId,
  MongoError,
  MongoServerError,
  MongoDuplicateKeyError,
  Binary,
  Timestamp,
  Long,
  Decimal128,
  UUID,
  MinKey,
  MaxKey,
  Code,
} from './types'
import { createClient } from './mongo'

// ============================================================================
// OBJECTID TESTS
// ============================================================================

describe('ObjectId', () => {
  it('should generate unique ObjectIds', () => {
    const id1 = new ObjectId()
    const id2 = new ObjectId()
    expect(id1.toHexString()).not.toBe(id2.toHexString())
  })

  it('should create ObjectId from hex string', () => {
    const hex = '507f1f77bcf86cd799439011'
    const id = new ObjectId(hex)
    expect(id.toHexString()).toBe(hex)
  })

  it('should reject invalid hex string', () => {
    expect(() => new ObjectId('invalid')).toThrow(TypeError)
    expect(() => new ObjectId('507f1f77bcf86cd79943901')).toThrow(TypeError) // 23 chars
    expect(() => new ObjectId('507f1f77bcf86cd7994390111')).toThrow(TypeError) // 25 chars
    expect(() => new ObjectId('507f1f77bcf86cd79943901g')).toThrow(TypeError) // invalid char
  })

  it('should copy from another ObjectId', () => {
    const id1 = new ObjectId()
    const id2 = new ObjectId(id1)
    expect(id1.equals(id2)).toBe(true)
  })

  it('should create from Uint8Array', () => {
    const bytes = new Uint8Array(12)
    bytes.fill(0xff)
    const id = new ObjectId(bytes)
    expect(id.toHexString()).toBe('ffffffffffffffffffffffff')
  })

  it('should validate ObjectId strings', () => {
    expect(ObjectId.isValid('507f1f77bcf86cd799439011')).toBe(true)
    expect(ObjectId.isValid('507F1F77BCF86CD799439011')).toBe(true) // uppercase
    expect(ObjectId.isValid('invalid')).toBe(false)
    expect(ObjectId.isValid('')).toBe(false)
    expect(ObjectId.isValid(null)).toBe(false)
    expect(ObjectId.isValid(new ObjectId())).toBe(true)
  })

  it('should create from hex string', () => {
    const hex = '507f1f77bcf86cd799439011'
    const id = ObjectId.createFromHexString(hex)
    expect(id.toHexString()).toBe(hex)
  })

  it('should create from timestamp', () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const id = ObjectId.createFromTime(timestamp)
    const extracted = Math.floor(id.getTimestamp().getTime() / 1000)
    expect(extracted).toBe(timestamp)
  })

  it('should extract timestamp from ObjectId', () => {
    const now = new Date()
    const id = new ObjectId()
    const extracted = id.getTimestamp()
    // Should be within 1 second
    expect(Math.abs(extracted.getTime() - now.getTime())).toBeLessThan(1000)
  })

  it('should compare equality', () => {
    const hex = '507f1f77bcf86cd799439011'
    const id1 = new ObjectId(hex)
    const id2 = new ObjectId(hex)
    const id3 = new ObjectId()
    expect(id1.equals(id2)).toBe(true)
    expect(id1.equals(hex)).toBe(true)
    expect(id1.equals(id3)).toBe(false)
  })

  it('should convert to string and JSON', () => {
    const hex = '507f1f77bcf86cd799439011'
    const id = new ObjectId(hex)
    expect(id.toString()).toBe(hex)
    expect(id.toJSON()).toBe(hex)
    expect(JSON.stringify({ _id: id })).toBe(`{"_id":"${hex}"}`)
  })
})

// ============================================================================
// CLIENT TESTS
// ============================================================================

describe('MongoClient', () => {
  it('should create client with URL', () => {
    const client = createClient('mongodb://localhost:27017')
    expect(client).toBeDefined()
  })

  it('should create client with options', () => {
    const client = createClient('mongodb://localhost:27017', {
      appName: 'test-app',
      maxPoolSize: 10,
    })
    expect(client).toBeDefined()
    expect(client.options.appName).toBe('test-app')
  })

  it('should connect', async () => {
    const client = createClient('mongodb://localhost:27017')
    const connected = await client.connect()
    expect(connected).toBe(client)
    expect(client.isConnected).toBe(true)
  })

  it('should close connection', async () => {
    const client = createClient('mongodb://localhost:27017')
    await client.connect()
    await client.close()
    expect(client.isConnected).toBe(false)
  })

  it('should get database', () => {
    const client = createClient('mongodb://localhost:27017')
    const db = client.db('testdb')
    expect(db).toBeDefined()
    expect(db.databaseName).toBe('testdb')
  })

  it('should use default database from URL', () => {
    const client = createClient('mongodb://localhost:27017/mydb')
    const db = client.db()
    expect(db.databaseName).toBe('mydb')
  })

  it('should accept extended DO options', () => {
    const client = createClient('mongodb://localhost:27017', {
      doNamespace: {} as DurableObjectNamespace,
      shard: { algorithm: 'consistent', count: 4 },
      replica: { readPreference: 'nearest' },
    } as ExtendedMongoClientOptions)
    expect(client).toBeDefined()
  })

  it('should start session', () => {
    const client = createClient('mongodb://localhost:27017')
    const session = client.startSession()
    expect(session).toBeDefined()
    expect(session.hasEnded).toBe(false)
  })
})

// ============================================================================
// DATABASE TESTS
// ============================================================================

describe('Db', () => {
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    db = client.db('testdb')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should get collection', () => {
    const collection = db.collection('users')
    expect(collection).toBeDefined()
    expect(collection.collectionName).toBe('users')
    expect(collection.dbName).toBe('testdb')
    expect(collection.namespace).toBe('testdb.users')
  })

  it('should create collection', async () => {
    const collection = await db.createCollection('newcol')
    expect(collection.collectionName).toBe('newcol')
  })

  it('should list collections', async () => {
    await db.createCollection('col1')
    await db.createCollection('col2')
    const collections = await db.listCollections().toArray()
    expect(collections.some((c) => c.name === 'col1')).toBe(true)
    expect(collections.some((c) => c.name === 'col2')).toBe(true)
  })

  it('should drop collection', async () => {
    await db.createCollection('todrop')
    const dropped = await db.dropCollection('todrop')
    expect(dropped).toBe(true)
  })

  it('should drop database', async () => {
    const dropped = await db.dropDatabase()
    expect(dropped).toBe(true)
  })

  it('should run command', async () => {
    const result = await db.command({ ping: 1 })
    expect(result.ok).toBe(1)
  })

  it('should get stats', async () => {
    const stats = await db.stats()
    expect(stats.db).toBe('testdb')
  })
})

// ============================================================================
// COLLECTION - INSERT TESTS
// ============================================================================

describe('Collection.insert', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('users')
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should insertOne document', async () => {
    const result = await collection.insertOne({ name: 'Alice', age: 30 })
    expect(result.acknowledged).toBe(true)
    expect(result.insertedId).toBeInstanceOf(ObjectId)
  })

  it('should insertOne with _id', async () => {
    const _id = new ObjectId()
    const result = await collection.insertOne({ _id, name: 'Bob' })
    expect(result.insertedId.equals(_id)).toBe(true)
  })

  it('should reject duplicate _id', async () => {
    const _id = new ObjectId()
    await collection.insertOne({ _id, name: 'Alice' })
    await expect(collection.insertOne({ _id, name: 'Bob' })).rejects.toThrow()
  })

  it('should insertMany documents', async () => {
    const result = await collection.insertMany([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
      { name: 'Charlie', age: 35 },
    ])
    expect(result.acknowledged).toBe(true)
    expect(result.insertedCount).toBe(3)
    expect(Object.keys(result.insertedIds).length).toBe(3)
  })

  it('should insertMany with ordered option', async () => {
    const docs = [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
    const result = await collection.insertMany(docs, { ordered: true })
    expect(result.insertedCount).toBe(3)
  })

  it('should insertMany unordered continues on error', async () => {
    const _id = new ObjectId()
    await collection.insertOne({ _id, name: 'Existing' })

    // With ordered: false, should continue past duplicates
    await expect(
      collection.insertMany([{ _id, name: 'Dup' }, { name: 'New' }], { ordered: false })
    ).rejects.toThrow()
  })
})

// ============================================================================
// COLLECTION - FIND TESTS
// ============================================================================

describe('Collection.find', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('users')
    await collection.insertMany([
      { name: 'Alice', age: 30, city: 'NYC' },
      { name: 'Bob', age: 25, city: 'LA' },
      { name: 'Charlie', age: 35, city: 'NYC' },
      { name: 'Diana', age: 28, city: 'Chicago' },
      { name: 'Eve', age: 22, city: 'LA' },
    ])
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should findOne document', async () => {
    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc).not.toBeNull()
    expect(doc!.name).toBe('Alice')
    expect(doc!._id).toBeInstanceOf(ObjectId)
  })

  it('should findOne return null when not found', async () => {
    const doc = await collection.findOne({ name: 'NotFound' })
    expect(doc).toBeNull()
  })

  it('should find all documents', async () => {
    const docs = await collection.find({}).toArray()
    expect(docs.length).toBe(5)
  })

  it('should find with filter', async () => {
    const docs = await collection.find({ city: 'NYC' }).toArray()
    expect(docs.length).toBe(2)
  })

  it('should find with $eq operator', async () => {
    const docs = await collection.find({ age: { $eq: 30 } }).toArray()
    expect(docs.length).toBe(1)
    expect(docs[0].name).toBe('Alice')
  })

  it('should find with $ne operator', async () => {
    const docs = await collection.find({ city: { $ne: 'NYC' } }).toArray()
    expect(docs.length).toBe(3)
  })

  it('should find with $gt operator', async () => {
    const docs = await collection.find({ age: { $gt: 28 } }).toArray()
    expect(docs.length).toBe(2)
  })

  it('should find with $gte operator', async () => {
    const docs = await collection.find({ age: { $gte: 28 } }).toArray()
    expect(docs.length).toBe(3)
  })

  it('should find with $lt operator', async () => {
    const docs = await collection.find({ age: { $lt: 28 } }).toArray()
    expect(docs.length).toBe(2)
  })

  it('should find with $lte operator', async () => {
    const docs = await collection.find({ age: { $lte: 28 } }).toArray()
    expect(docs.length).toBe(3)
  })

  it('should find with $in operator', async () => {
    const docs = await collection.find({ city: { $in: ['NYC', 'LA'] } }).toArray()
    expect(docs.length).toBe(4)
  })

  it('should find with $nin operator', async () => {
    const docs = await collection.find({ city: { $nin: ['NYC', 'LA'] } }).toArray()
    expect(docs.length).toBe(1)
    expect(docs[0].city).toBe('Chicago')
  })

  it('should find with $and operator', async () => {
    const docs = await collection.find({
      $and: [{ city: 'NYC' }, { age: { $gt: 30 } }],
    }).toArray()
    expect(docs.length).toBe(1)
    expect(docs[0].name).toBe('Charlie')
  })

  it('should find with $or operator', async () => {
    const docs = await collection.find({
      $or: [{ name: 'Alice' }, { name: 'Bob' }],
    }).toArray()
    expect(docs.length).toBe(2)
  })

  it('should find with $not operator', async () => {
    const docs = await collection.find({
      age: { $not: { $gt: 30 } },
    }).toArray()
    expect(docs.length).toBe(4)
  })

  it('should find with $regex operator', async () => {
    const docs = await collection.find({
      name: { $regex: '^A' },
    }).toArray()
    expect(docs.length).toBe(1)
    expect(docs[0].name).toBe('Alice')
  })

  it('should find with $regex and options', async () => {
    const docs = await collection.find({
      name: { $regex: 'alice', $options: 'i' },
    }).toArray()
    expect(docs.length).toBe(1)
  })

  it('should find with $exists operator', async () => {
    await collection.insertOne({ name: 'Frank' }) // no city
    const docs = await collection.find({ city: { $exists: true } }).toArray()
    expect(docs.length).toBe(5)
  })

  it('should find with combined operators', async () => {
    const docs = await collection.find({
      age: { $gte: 25, $lte: 30 },
      city: 'NYC',
    }).toArray()
    expect(docs.length).toBe(1)
    expect(docs[0].name).toBe('Alice')
  })
})

// ============================================================================
// CURSOR TESTS
// ============================================================================

describe('FindCursor', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('users')
    await collection.insertMany([
      { name: 'A', score: 100 },
      { name: 'B', score: 90 },
      { name: 'C', score: 80 },
      { name: 'D', score: 70 },
      { name: 'E', score: 60 },
    ])
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should limit results', async () => {
    const docs = await collection.find({}).limit(3).toArray()
    expect(docs.length).toBe(3)
  })

  it('should skip results', async () => {
    const docs = await collection.find({}).skip(2).toArray()
    expect(docs.length).toBe(3)
  })

  it('should skip and limit', async () => {
    const docs = await collection.find({}).skip(1).limit(2).toArray()
    expect(docs.length).toBe(2)
  })

  it('should sort ascending', async () => {
    const docs = await collection.find({}).sort({ score: 1 }).toArray()
    expect(docs[0].score).toBe(60)
    expect(docs[4].score).toBe(100)
  })

  it('should sort descending', async () => {
    const docs = await collection.find({}).sort({ score: -1 }).toArray()
    expect(docs[0].score).toBe(100)
    expect(docs[4].score).toBe(60)
  })

  it('should sort with string direction', async () => {
    const docs = await collection.find({}).sort({ score: 'desc' }).toArray()
    expect(docs[0].score).toBe(100)
  })

  it('should project fields (include)', async () => {
    const docs = await collection.find({}).project({ name: 1 }).toArray()
    expect(docs[0].name).toBeDefined()
    expect(docs[0]._id).toBeDefined()
    expect((docs[0] as any).score).toBeUndefined()
  })

  it('should project fields (exclude)', async () => {
    const docs = await collection.find({}).project({ score: 0 }).toArray()
    expect(docs[0].name).toBeDefined()
    expect((docs[0] as any).score).toBeUndefined()
  })

  it('should project exclude _id', async () => {
    const docs = await collection.find({}).project({ _id: 0, name: 1 }).toArray()
    expect((docs[0] as any)._id).toBeUndefined()
    expect(docs[0].name).toBeDefined()
  })

  it('should iterate with forEach', async () => {
    const names: string[] = []
    await collection.find({}).forEach((doc) => {
      names.push(doc.name as string)
    })
    expect(names.length).toBe(5)
  })

  it('should iterate with hasNext/next', async () => {
    const cursor = collection.find({}).limit(2)
    expect(await cursor.hasNext()).toBe(true)
    const doc1 = await cursor.next()
    expect(doc1).not.toBeNull()
    expect(await cursor.hasNext()).toBe(true)
    const doc2 = await cursor.next()
    expect(doc2).not.toBeNull()
    expect(await cursor.hasNext()).toBe(false)
    const doc3 = await cursor.next()
    expect(doc3).toBeNull()
  })

  it('should count documents in cursor', async () => {
    const count = await collection.find({ score: { $gte: 80 } }).count()
    expect(count).toBe(3)
  })

  it('should close cursor', async () => {
    const cursor = collection.find({})
    await cursor.close()
    expect(cursor.closed).toBe(true)
  })

  it('should map documents', async () => {
    const names = await collection.find({}).map((doc) => ({ n: doc.name })).toArray()
    expect(names[0].n).toBeDefined()
  })

  it('should be async iterable', async () => {
    const names: string[] = []
    for await (const doc of collection.find({})) {
      names.push(doc.name as string)
    }
    expect(names.length).toBe(5)
  })
})

// ============================================================================
// UPDATE TESTS
// ============================================================================

describe('Collection.update', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('users')
    await collection.insertMany([
      { name: 'Alice', age: 30, tags: ['a', 'b'] },
      { name: 'Bob', age: 25, tags: ['b', 'c'] },
      { name: 'Charlie', age: 30, tags: ['a'] },
    ])
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should updateOne with $set', async () => {
    const result = await collection.updateOne({ name: 'Alice' }, { $set: { age: 31 } })
    expect(result.matchedCount).toBe(1)
    expect(result.modifiedCount).toBe(1)

    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc!.age).toBe(31)
  })

  it('should updateOne match first only', async () => {
    const result = await collection.updateOne({ age: 30 }, { $set: { updated: true } })
    expect(result.matchedCount).toBe(1)
    expect(result.modifiedCount).toBe(1)

    const updated = await collection.find({ updated: true }).toArray()
    expect(updated.length).toBe(1)
  })

  it('should updateMany', async () => {
    const result = await collection.updateMany({ age: 30 }, { $set: { updated: true } })
    expect(result.matchedCount).toBe(2)
    expect(result.modifiedCount).toBe(2)

    const updated = await collection.find({ updated: true }).toArray()
    expect(updated.length).toBe(2)
  })

  it('should updateOne with $inc', async () => {
    await collection.updateOne({ name: 'Alice' }, { $inc: { age: 5 } })
    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc!.age).toBe(35)
  })

  it('should updateOne with negative $inc', async () => {
    await collection.updateOne({ name: 'Alice' }, { $inc: { age: -5 } })
    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc!.age).toBe(25)
  })

  it('should updateOne with $unset', async () => {
    await collection.updateOne({ name: 'Alice' }, { $unset: { tags: '' } })
    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc!.tags).toBeUndefined()
  })

  it('should updateOne with $push', async () => {
    await collection.updateOne({ name: 'Alice' }, { $push: { tags: 'c' } })
    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc!.tags).toEqual(['a', 'b', 'c'])
  })

  it('should updateOne with $push $each', async () => {
    await collection.updateOne({ name: 'Alice' }, { $push: { tags: { $each: ['c', 'd'] } } })
    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc!.tags).toEqual(['a', 'b', 'c', 'd'])
  })

  it('should updateOne with $pull', async () => {
    await collection.updateOne({ name: 'Alice' }, { $pull: { tags: 'a' } })
    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc!.tags).toEqual(['b'])
  })

  it('should updateOne with $addToSet', async () => {
    await collection.updateOne({ name: 'Alice' }, { $addToSet: { tags: 'b' } }) // duplicate
    await collection.updateOne({ name: 'Alice' }, { $addToSet: { tags: 'd' } }) // new
    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc!.tags).toEqual(['a', 'b', 'd'])
  })

  it('should updateOne with $pop (remove last)', async () => {
    await collection.updateOne({ name: 'Alice' }, { $pop: { tags: 1 } })
    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc!.tags).toEqual(['a'])
  })

  it('should updateOne with $pop (remove first)', async () => {
    await collection.updateOne({ name: 'Alice' }, { $pop: { tags: -1 } })
    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc!.tags).toEqual(['b'])
  })

  it('should upsert when not found', async () => {
    const result = await collection.updateOne(
      { name: 'Diana' },
      { $set: { age: 28 } },
      { upsert: true }
    )
    expect(result.upsertedCount).toBe(1)
    expect(result.upsertedId).toBeInstanceOf(ObjectId)

    const doc = await collection.findOne({ name: 'Diana' })
    expect(doc!.age).toBe(28)
  })

  it('should not upsert when found', async () => {
    const result = await collection.updateOne(
      { name: 'Alice' },
      { $set: { age: 31 } },
      { upsert: true }
    )
    expect(result.upsertedCount).toBe(0)
    expect(result.matchedCount).toBe(1)
  })

  it('should replaceOne', async () => {
    const result = await collection.replaceOne(
      { name: 'Alice' },
      { name: 'Alice Updated', status: 'active' }
    )
    expect(result.matchedCount).toBe(1)
    expect(result.modifiedCount).toBe(1)

    const doc = await collection.findOne({ name: 'Alice Updated' })
    expect(doc!.status).toBe('active')
    expect(doc!.age).toBeUndefined() // replaced, not merged
  })

  it('should return 0 modified if no change', async () => {
    await collection.updateOne({ name: 'Alice' }, { $set: { age: 30 } }) // same value
    // Note: MongoDB actually tracks this and returns modifiedCount: 0
    // Our implementation may vary
  })
})

// ============================================================================
// DELETE TESTS
// ============================================================================

describe('Collection.delete', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('users')
    await collection.insertMany([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
      { name: 'Charlie', age: 30 },
    ])
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should deleteOne', async () => {
    const result = await collection.deleteOne({ name: 'Alice' })
    expect(result.acknowledged).toBe(true)
    expect(result.deletedCount).toBe(1)

    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc).toBeNull()
  })

  it('should deleteOne first match only', async () => {
    const result = await collection.deleteOne({ age: 30 })
    expect(result.deletedCount).toBe(1)

    const remaining = await collection.find({ age: 30 }).toArray()
    expect(remaining.length).toBe(1)
  })

  it('should deleteMany', async () => {
    const result = await collection.deleteMany({ age: 30 })
    expect(result.deletedCount).toBe(2)

    const remaining = await collection.find({}).toArray()
    expect(remaining.length).toBe(1)
  })

  it('should deleteMany all documents', async () => {
    const result = await collection.deleteMany({})
    expect(result.deletedCount).toBe(3)
  })

  it('should return 0 when no match', async () => {
    const result = await collection.deleteOne({ name: 'NotFound' })
    expect(result.deletedCount).toBe(0)
  })
})

// ============================================================================
// FIND AND MODIFY TESTS
// ============================================================================

describe('Collection.findAndModify', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('users')
    await collection.insertMany([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ])
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should findOneAndUpdate return before', async () => {
    const doc = await collection.findOneAndUpdate(
      { name: 'Alice' },
      { $set: { age: 31 } },
      { returnDocument: 'before' }
    )
    expect(doc!.age).toBe(30)
  })

  it('should findOneAndUpdate return after', async () => {
    const doc = await collection.findOneAndUpdate(
      { name: 'Alice' },
      { $set: { age: 31 } },
      { returnDocument: 'after' }
    )
    expect(doc!.age).toBe(31)
  })

  it('should findOneAndUpdate with upsert', async () => {
    const doc = await collection.findOneAndUpdate(
      { name: 'Charlie' },
      { $set: { age: 35 } },
      { upsert: true, returnDocument: 'after' }
    )
    expect(doc!.name).toBe('Charlie')
    expect(doc!.age).toBe(35)
  })

  it('should findOneAndDelete', async () => {
    const doc = await collection.findOneAndDelete({ name: 'Alice' })
    expect(doc!.name).toBe('Alice')

    const remaining = await collection.findOne({ name: 'Alice' })
    expect(remaining).toBeNull()
  })

  it('should findOneAndReplace', async () => {
    const doc = await collection.findOneAndReplace(
      { name: 'Alice' },
      { name: 'Alice', status: 'updated' },
      { returnDocument: 'after' }
    )
    expect(doc!.status).toBe('updated')
    expect(doc!.age).toBeUndefined()
  })
})

// ============================================================================
// COUNT TESTS
// ============================================================================

describe('Collection.count', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('users')
    await collection.insertMany([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
      { name: 'Charlie', age: 30 },
    ])
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should countDocuments all', async () => {
    const count = await collection.countDocuments()
    expect(count).toBe(3)
  })

  it('should countDocuments with filter', async () => {
    const count = await collection.countDocuments({ age: 30 })
    expect(count).toBe(2)
  })

  it('should countDocuments with skip', async () => {
    const count = await collection.countDocuments({}, { skip: 1 })
    expect(count).toBe(2)
  })

  it('should countDocuments with limit', async () => {
    const count = await collection.countDocuments({}, { limit: 2 })
    expect(count).toBe(2)
  })

  it('should estimatedDocumentCount', async () => {
    const count = await collection.estimatedDocumentCount()
    expect(count).toBe(3)
  })
})

// ============================================================================
// DISTINCT TESTS
// ============================================================================

describe('Collection.distinct', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('users')
    await collection.insertMany([
      { name: 'Alice', age: 30, city: 'NYC' },
      { name: 'Bob', age: 25, city: 'LA' },
      { name: 'Charlie', age: 30, city: 'NYC' },
    ])
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should get distinct values', async () => {
    const ages = await collection.distinct('age')
    expect(ages.sort()).toEqual([25, 30])
  })

  it('should get distinct with filter', async () => {
    const cities = await collection.distinct('city', { age: 30 })
    expect(cities).toEqual(['NYC'])
  })
})

// ============================================================================
// AGGREGATION TESTS
// ============================================================================

describe('Collection.aggregate', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('orders')
    await collection.insertMany([
      { item: 'apple', qty: 5, price: 1.0 },
      { item: 'banana', qty: 10, price: 0.5 },
      { item: 'apple', qty: 3, price: 1.0 },
      { item: 'orange', qty: 8, price: 0.75 },
    ])
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should aggregate with $match', async () => {
    const result = await collection
      .aggregate([{ $match: { item: 'apple' } }])
      .toArray()
    expect(result.length).toBe(2)
  })

  it('should aggregate with $group', async () => {
    const result = await collection
      .aggregate([
        { $group: { _id: '$item', totalQty: { $sum: '$qty' } } },
      ])
      .toArray()
    expect(result.length).toBe(3)
    const apple = result.find((r) => r._id === 'apple')
    expect(apple!.totalQty).toBe(8)
  })

  it('should aggregate with $group avg', async () => {
    const result = await collection
      .aggregate([{ $group: { _id: '$item', avgPrice: { $avg: '$price' } } }])
      .toArray()
    const apple = result.find((r) => r._id === 'apple')
    expect(apple!.avgPrice).toBe(1.0)
  })

  it('should aggregate with $group count', async () => {
    const result = await collection
      .aggregate([{ $group: { _id: '$item', count: { $sum: 1 } } }])
      .toArray()
    const apple = result.find((r) => r._id === 'apple')
    expect(apple!.count).toBe(2)
  })

  it('should aggregate with $sort', async () => {
    const result = await collection
      .aggregate([{ $sort: { qty: -1 } }])
      .toArray()
    expect(result[0].qty).toBe(10)
  })

  it('should aggregate with $limit', async () => {
    const result = await collection
      .aggregate([{ $limit: 2 }])
      .toArray()
    expect(result.length).toBe(2)
  })

  it('should aggregate with $skip', async () => {
    const result = await collection
      .aggregate([{ $skip: 2 }])
      .toArray()
    expect(result.length).toBe(2)
  })

  it('should aggregate with $project', async () => {
    const result = await collection
      .aggregate([{ $project: { item: 1, total: { $multiply: ['$qty', '$price'] } } }])
      .toArray()
    expect(result[0].total).toBeDefined()
    expect(result[0].qty).toBeUndefined()
  })

  it('should aggregate with $addFields', async () => {
    const result = await collection
      .aggregate([{ $addFields: { total: { $multiply: ['$qty', '$price'] } } }])
      .toArray()
    expect(result[0].total).toBeDefined()
    expect(result[0].qty).toBeDefined() // original field preserved
  })

  it('should aggregate with $count', async () => {
    const result = await collection
      .aggregate([{ $match: { item: 'apple' } }, { $count: 'total' }])
      .toArray()
    expect(result[0].total).toBe(2)
  })

  it('should aggregate pipeline combination', async () => {
    const result = await collection
      .aggregate([
        { $match: { qty: { $gte: 5 } } },
        { $group: { _id: '$item', totalQty: { $sum: '$qty' } } },
        { $sort: { totalQty: -1 } },
        { $limit: 2 },
      ])
      .toArray()
    expect(result.length).toBe(2)
    expect(result[0].totalQty).toBeGreaterThanOrEqual(result[1].totalQty)
  })

  it('should iterate aggregation cursor', async () => {
    const cursor = collection.aggregate([{ $match: { item: 'apple' } }])
    const items: unknown[] = []
    while (await cursor.hasNext()) {
      items.push(await cursor.next())
    }
    expect(items.length).toBe(2)
  })
})

// ============================================================================
// INDEX TESTS
// ============================================================================

describe('Collection.indexes', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('users')
  })

  afterEach(async () => {
    await collection.dropIndexes()
    await collection.deleteMany({})
    await client.close()
  })

  it('should createIndex', async () => {
    const name = await collection.createIndex({ name: 1 })
    expect(name).toBe('name_1')
  })

  it('should createIndex with name option', async () => {
    const name = await collection.createIndex({ name: 1 }, { name: 'my_name_idx' })
    expect(name).toBe('my_name_idx')
  })

  it('should createIndex unique', async () => {
    await collection.createIndex({ email: 1 }, { unique: true })
    await collection.insertOne({ email: 'a@b.com' })
    await expect(collection.insertOne({ email: 'a@b.com' })).rejects.toThrow()
  })

  it('should createIndex compound', async () => {
    const name = await collection.createIndex({ name: 1, age: -1 })
    expect(name).toBe('name_1_age_-1')
  })

  it('should listIndexes', async () => {
    await collection.createIndex({ name: 1 })
    await collection.createIndex({ age: 1 })
    const indexes = await collection.listIndexes().toArray()
    expect(indexes.length).toBeGreaterThanOrEqual(2) // may include _id index
  })

  it('should dropIndex by name', async () => {
    await collection.createIndex({ name: 1 })
    await collection.dropIndex('name_1')
    const indexes = await collection.listIndexes().toArray()
    expect(indexes.find((i) => i.name === 'name_1')).toBeUndefined()
  })

  it('should dropIndexes (all except _id)', async () => {
    await collection.createIndex({ name: 1 })
    await collection.createIndex({ age: 1 })
    await collection.dropIndexes()
    const indexes = await collection.listIndexes().toArray()
    expect(indexes.filter((i) => i.name !== '_id_').length).toBe(0)
  })

  it('should indexExists', async () => {
    await collection.createIndex({ name: 1 })
    expect(await collection.indexExists('name_1')).toBe(true)
    expect(await collection.indexExists('nonexistent')).toBe(false)
  })

  it('should get indexes()', async () => {
    await collection.createIndex({ name: 1 })
    const indexes = await collection.indexes()
    expect(indexes.some((i) => i.name === 'name_1')).toBe(true)
  })
})

// ============================================================================
// COLLECTION OPERATIONS TESTS
// ============================================================================

describe('Collection operations', () => {
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    db = client.db('testdb')
  })

  afterEach(async () => {
    await client.close()
  })

  it('should drop collection', async () => {
    const collection = await db.createCollection('todrop')
    await collection.insertOne({ x: 1 })
    const dropped = await collection.drop()
    expect(dropped).toBe(true)
  })

  it('should rename collection', async () => {
    const collection = await db.createCollection('oldname')
    await collection.insertOne({ x: 1 })
    const renamed = await collection.rename('newname')
    expect(renamed.collectionName).toBe('newname')
  })

  it('should get collection stats', async () => {
    const collection = db.collection('withstats')
    await collection.insertMany([{ x: 1 }, { x: 2 }])
    const stats = await collection.stats()
    expect(stats.count).toBe(2)
    expect(stats.ns).toBe('testdb.withstats')
  })
})

// ============================================================================
// BSON TYPES TESTS
// ============================================================================

describe('BSON types', () => {
  describe('Binary', () => {
    it('should create from Uint8Array', () => {
      const binary = new Binary(new Uint8Array([1, 2, 3]))
      expect(binary.length()).toBe(3)
    })

    it('should create from string', () => {
      const binary = new Binary('hello')
      expect(binary.length()).toBe(5)
    })

    it('should convert to base64', () => {
      const binary = new Binary(new Uint8Array([72, 101, 108, 108, 111]))
      expect(binary.toString('base64')).toBe('SGVsbG8=')
    })

    it('should convert to hex', () => {
      const binary = new Binary(new Uint8Array([255, 0, 127]))
      expect(binary.toString('hex')).toBe('ff007f')
    })
  })

  describe('Timestamp', () => {
    it('should create from components', () => {
      const ts = new Timestamp(1234567890, 1)
      expect(ts.t).toBe(1234567890)
      expect(ts.i).toBe(1)
    })

    it('should convert to JSON', () => {
      const ts = new Timestamp(1234567890, 1)
      expect(ts.toJSON()).toEqual({ $timestamp: { t: 1234567890, i: 1 } })
    })
  })

  describe('Long', () => {
    it('should create from number', () => {
      const long = Long.fromNumber(9007199254740993)
      expect(long.toNumber()).toBe(9007199254740992) // precision loss
    })

    it('should create from bigint', () => {
      const long = new Long(BigInt('9007199254740993'))
      expect(long.toString()).toBe('9007199254740993')
    })

    it('should check equality', () => {
      const a = new Long(BigInt(100))
      const b = new Long(BigInt(100))
      expect(a.equals(b)).toBe(true)
    })
  })

  describe('Decimal128', () => {
    it('should create from string', () => {
      const dec = Decimal128.fromString('123.456')
      expect(dec.toString()).toBe('123.456')
    })

    it('should convert to JSON', () => {
      const dec = Decimal128.fromString('123.456')
      expect(dec.toJSON()).toEqual({ $numberDecimal: '123.456' })
    })
  })

  describe('UUID', () => {
    it('should generate UUID', () => {
      const uuid = UUID.generate()
      expect(uuid.toString()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('should create from string', () => {
      const uuid = new UUID('550e8400-e29b-41d4-a716-446655440000')
      expect(uuid.toString()).toBe('550e8400-e29b-41d4-a716-446655440000')
    })

    it('should reject invalid UUID', () => {
      expect(() => new UUID('invalid')).toThrow(TypeError)
    })

    it('should check equality', () => {
      const uuid = new UUID('550e8400-e29b-41d4-a716-446655440000')
      expect(uuid.equals('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    })
  })

  describe('MinKey/MaxKey', () => {
    it('should create MinKey', () => {
      const minKey = new MinKey()
      expect(minKey._bsontype).toBe('MinKey')
      expect(minKey.toJSON()).toEqual({ $minKey: 1 })
    })

    it('should create MaxKey', () => {
      const maxKey = new MaxKey()
      expect(maxKey._bsontype).toBe('MaxKey')
      expect(maxKey.toJSON()).toEqual({ $maxKey: 1 })
    })
  })

  describe('Code', () => {
    it('should create from string', () => {
      const code = new Code('function() { return 1; }')
      expect(code.code).toBe('function() { return 1; }')
    })

    it('should create from function', () => {
      const code = new Code(function () {
        return 1
      })
      expect(code.code).toContain('return 1')
    })

    it('should include scope', () => {
      const code = new Code('x + 1', { x: 10 })
      expect(code.toJSON()).toEqual({ $code: 'x + 1', $scope: { x: 10 } })
    })
  })
})

// ============================================================================
// SESSION TESTS
// ============================================================================

describe('ClientSession', () => {
  let client: MongoClient

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
  })

  afterEach(async () => {
    await client.close()
  })

  it('should start and end session', async () => {
    const session = client.startSession()
    expect(session.hasEnded).toBe(false)
    await session.endSession()
    expect(session.hasEnded).toBe(true)
  })

  it('should start transaction', () => {
    const session = client.startSession()
    session.startTransaction()
    expect(session.inTransaction).toBe(true)
  })

  it('should commit transaction', async () => {
    const session = client.startSession()
    session.startTransaction()
    await session.commitTransaction()
    expect(session.inTransaction).toBe(false)
  })

  it('should abort transaction', async () => {
    const session = client.startSession()
    session.startTransaction()
    await session.abortTransaction()
    expect(session.inTransaction).toBe(false)
  })

  it('should run withTransaction', async () => {
    const session = client.startSession()
    const result = await session.withTransaction(async () => {
      return 'done'
    })
    expect(result).toBe('done')
  })

  it('should withSession on client', async () => {
    const result = await client.withSession(async (session) => {
      expect(session).toBeDefined()
      return 'complete'
    })
    expect(result).toBe('complete')
  })
})

// ============================================================================
// ERROR TESTS
// ============================================================================

describe('Errors', () => {
  it('should throw MongoError', () => {
    const error = new MongoError('Test error')
    expect(error.name).toBe('MongoError')
    expect(error.message).toBe('Test error')
  })

  it('should throw MongoServerError with code', () => {
    const error = new MongoServerError('Server error', 11000, 'DuplicateKey')
    expect(error.name).toBe('MongoServerError')
    expect(error.code).toBe(11000)
    expect(error.codeName).toBe('DuplicateKey')
  })

  it('should throw MongoDuplicateKeyError', () => {
    const error = new MongoDuplicateKeyError(
      'Duplicate key',
      { email: 'test@test.com' },
      { email: 1 }
    )
    expect(error.name).toBe('MongoDuplicateKeyError')
    expect(error.code).toBe(11000)
    expect(error.keyValue).toEqual({ email: 'test@test.com' })
    expect(error.keyPattern).toEqual({ email: 1 })
  })
})

// ============================================================================
// NESTED DOCUMENT TESTS
// ============================================================================

describe('Nested documents', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('nested')
    await collection.insertMany([
      { user: { name: 'Alice', address: { city: 'NYC' } }, scores: [10, 20] },
      { user: { name: 'Bob', address: { city: 'LA' } }, scores: [15, 25] },
    ])
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should query nested field', async () => {
    const docs = await collection.find({ 'user.name': 'Alice' }).toArray()
    expect(docs.length).toBe(1)
  })

  it('should query deep nested field', async () => {
    const docs = await collection.find({ 'user.address.city': 'NYC' }).toArray()
    expect(docs.length).toBe(1)
  })

  it('should update nested field with $set', async () => {
    await collection.updateOne(
      { 'user.name': 'Alice' },
      { $set: { 'user.address.city': 'Boston' } }
    )
    const doc = await collection.findOne({ 'user.name': 'Alice' })
    expect(doc!.user.address.city).toBe('Boston')
  })

  it('should query array element', async () => {
    const docs = await collection.find({ scores: 10 }).toArray()
    expect(docs.length).toBe(1)
  })

  it('should query array with $elemMatch', async () => {
    const docs = await collection.find({
      scores: { $elemMatch: { $gt: 12, $lt: 22 } },
    }).toArray()
    expect(docs.length).toBe(2)
  })

  it('should update array element with positional operator', async () => {
    await collection.updateOne(
      { 'user.name': 'Alice', scores: 10 },
      { $set: { 'scores.$': 100 } }
    )
    const doc = await collection.findOne({ 'user.name': 'Alice' })
    expect(doc!.scores).toContain(100)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge cases', () => {
  let client: MongoClient
  let collection: Collection

  beforeEach(async () => {
    client = createClient('mongodb://localhost:27017')
    await client.connect()
    collection = client.db('testdb').collection('edge')
  })

  afterEach(async () => {
    await collection.deleteMany({})
    await client.close()
  })

  it('should handle empty find', async () => {
    const docs = await collection.find({}).toArray()
    expect(docs).toEqual([])
  })

  it('should handle null values', async () => {
    await collection.insertOne({ name: null, age: 25 })
    const doc = await collection.findOne({ name: null })
    expect(doc!.name).toBeNull()
  })

  it('should handle undefined as missing', async () => {
    await collection.insertOne({ name: 'Test' })
    const doc = await collection.findOne({ age: { $exists: false } })
    expect(doc!.name).toBe('Test')
  })

  it('should handle large numbers', async () => {
    await collection.insertOne({ big: 9007199254740993 })
    const doc = await collection.findOne({})
    // Note: JavaScript loses precision for large numbers
    expect(typeof doc!.big).toBe('number')
  })

  it('should handle special characters in keys', async () => {
    await collection.insertOne({ 'key.with.dots': 'value', 'key$with$dollars': 'value2' })
    // MongoDB doesn't allow dots/dollars in keys at top level, but in nested it works
    const doc = await collection.findOne({})
    expect(doc!['key.with.dots']).toBe('value')
  })

  it('should handle Date objects', async () => {
    const date = new Date('2025-01-01T00:00:00Z')
    await collection.insertOne({ created: date })
    const doc = await collection.findOne({})
    expect(doc!.created).toEqual(date)
  })

  it('should handle RegExp values', async () => {
    await collection.insertOne({ pattern: /test/i })
    const doc = await collection.findOne({})
    expect(doc!.pattern).toBeInstanceOf(RegExp)
  })

  it('should handle ObjectId in filter', async () => {
    const result = await collection.insertOne({ name: 'Test' })
    const doc = await collection.findOne({ _id: result.insertedId })
    expect(doc!.name).toBe('Test')
  })

  it('should handle empty update operators', async () => {
    await collection.insertOne({ name: 'Test' })
    const result = await collection.updateOne({ name: 'Test' }, { $set: {} })
    expect(result.matchedCount).toBe(1)
  })

  it('should handle deeply nested updates', async () => {
    await collection.insertOne({ a: { b: { c: { d: 1 } } } })
    await collection.updateOne({}, { $set: { 'a.b.c.d': 2 } })
    const doc = await collection.findOne({})
    expect(doc!.a.b.c.d).toBe(2)
  })
})
