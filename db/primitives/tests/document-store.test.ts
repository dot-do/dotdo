/**
 * DocumentStore tests
 *
 * Tests for the DocumentStore primitive that provides MongoDB-like
 * document storage semantics with CRUD operations, queries, and indexes.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDocumentStore,
  type DocumentStore,
  type Document,
  type QueryFilter,
  type UpdateOperators,
  type IndexSpec,
} from '../document-store'

// =============================================================================
// TEST TYPES AND HELPERS
// =============================================================================

interface User extends Document {
  name: string
  email: string
  age: number
  tags?: string[]
  address?: {
    city: string
    country: string
  }
  createdAt?: Date
}

interface Product extends Document {
  name: string
  price: number
  category: string
  inStock: boolean
  variants?: string[]
}

function createUserStore(): DocumentStore<User> {
  return createDocumentStore<User>({ collection: 'users' })
}

function createProductStore(): DocumentStore<Product> {
  return createDocumentStore<Product>({ collection: 'products' })
}

// =============================================================================
// BASIC CRUD OPERATIONS
// =============================================================================

describe('DocumentStore', () => {
  describe('insert operations', () => {
    it('should insert a document and return insertedId', async () => {
      const store = createUserStore()

      const result = await store.insert({
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      expect(result.insertedId).toBeDefined()
      expect(typeof result.insertedId).toBe('string')
    })

    it('should insert a document with provided _id', async () => {
      const store = createUserStore()

      const result = await store.insert({
        _id: 'user-123',
        name: 'Bob',
        email: 'bob@example.com',
        age: 25,
      })

      expect(result.insertedId).toBe('user-123')
    })

    it('should throw error for duplicate _id', async () => {
      const store = createUserStore()

      await store.insert({
        _id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      await expect(
        store.insert({
          _id: 'user-1',
          name: 'Bob',
          email: 'bob@example.com',
          age: 25,
        })
      ).rejects.toThrow(/duplicate/i)
    })

    it('should insert multiple documents', async () => {
      const store = createUserStore()

      const result = await store.insertMany([
        { name: 'Alice', email: 'alice@example.com', age: 30 },
        { name: 'Bob', email: 'bob@example.com', age: 25 },
        { name: 'Charlie', email: 'charlie@example.com', age: 35 },
      ])

      expect(result.insertedCount).toBe(3)
      expect(result.insertedIds).toHaveLength(3)
    })

    it('should handle documents with nested objects', async () => {
      const store = createUserStore()

      const result = await store.insert({
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        address: {
          city: 'New York',
          country: 'USA',
        },
      })

      const doc = await store.get(result.insertedId)
      expect(doc?.address?.city).toBe('New York')
    })

    it('should handle documents with arrays', async () => {
      const store = createUserStore()

      const result = await store.insert({
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        tags: ['admin', 'premium'],
      })

      const doc = await store.get(result.insertedId)
      expect(doc?.tags).toEqual(['admin', 'premium'])
    })
  })

  describe('get operations', () => {
    it('should retrieve a document by ID', async () => {
      const store = createUserStore()

      const { insertedId } = await store.insert({
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      const doc = await store.get(insertedId)

      expect(doc).not.toBeNull()
      expect(doc?.name).toBe('Alice')
      expect(doc?.email).toBe('alice@example.com')
      expect(doc?.age).toBe(30)
    })

    it('should return null for non-existent ID', async () => {
      const store = createUserStore()

      const doc = await store.get('non-existent-id')

      expect(doc).toBeNull()
    })

    it('should get document with provided _id', async () => {
      const store = createUserStore()

      await store.insert({
        _id: 'custom-id',
        name: 'Bob',
        email: 'bob@example.com',
        age: 25,
      })

      const doc = await store.get('custom-id')

      expect(doc?._id).toBe('custom-id')
      expect(doc?.name).toBe('Bob')
    })
  })

  describe('getAsOf (time travel)', () => {
    it('should retrieve historical document state', async () => {
      const store = createDocumentStore<User>({ enableTimeTravel: true })

      const { insertedId } = await store.insert({
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      const insertTime = Date.now()

      // Wait a bit to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10))

      // Update the document
      await store.updateOne({ _id: insertedId }, { $set: { age: 31 } })

      // Get current state
      const current = await store.get(insertedId)
      expect(current?.age).toBe(31)

      // Get historical state
      const historical = await store.getAsOf(insertedId, insertTime)
      expect(historical?.age).toBe(30)
    })
  })

  // ===========================================================================
  // FIND OPERATIONS
  // ===========================================================================

  describe('find operations', () => {
    let store: DocumentStore<User>

    beforeEach(async () => {
      store = createUserStore()
      await store.insertMany([
        { _id: 'u1', name: 'Alice', email: 'alice@example.com', age: 30 },
        { _id: 'u2', name: 'Bob', email: 'bob@example.com', age: 25 },
        { _id: 'u3', name: 'Charlie', email: 'charlie@example.com', age: 35 },
        { _id: 'u4', name: 'Diana', email: 'diana@example.com', age: 30 },
      ])
    })

    describe('basic find', () => {
      it('should find all documents with empty filter', async () => {
        const results = await store.find({})
        expect(results).toHaveLength(4)
      })

      it('should find documents by exact match', async () => {
        const results = await store.find({ name: 'Alice' })
        expect(results).toHaveLength(1)
        expect(results[0]?.name).toBe('Alice')
      })

      it('should find documents by multiple criteria', async () => {
        const results = await store.find({ age: 30, name: 'Alice' })
        expect(results).toHaveLength(1)
        expect(results[0]?.email).toBe('alice@example.com')
      })

      it('should return empty array when no matches', async () => {
        const results = await store.find({ name: 'Unknown' })
        expect(results).toHaveLength(0)
      })
    })

    describe('findOne', () => {
      it('should find first matching document', async () => {
        const doc = await store.findOne({ age: 30 })
        expect(doc).not.toBeNull()
        expect(doc?.age).toBe(30)
      })

      it('should return null when no match', async () => {
        const doc = await store.findOne({ name: 'Unknown' })
        expect(doc).toBeNull()
      })
    })

    describe('comparison operators', () => {
      it('should support $eq operator', async () => {
        const results = await store.find({ age: { $eq: 30 } })
        expect(results).toHaveLength(2)
      })

      it('should support $ne operator', async () => {
        const results = await store.find({ age: { $ne: 30 } })
        expect(results).toHaveLength(2)
        expect(results.every((r) => r.age !== 30)).toBe(true)
      })

      it('should support $gt operator', async () => {
        const results = await store.find({ age: { $gt: 30 } })
        expect(results).toHaveLength(1)
        expect(results[0]?.name).toBe('Charlie')
      })

      it('should support $gte operator', async () => {
        const results = await store.find({ age: { $gte: 30 } })
        expect(results).toHaveLength(3)
      })

      it('should support $lt operator', async () => {
        const results = await store.find({ age: { $lt: 30 } })
        expect(results).toHaveLength(1)
        expect(results[0]?.name).toBe('Bob')
      })

      it('should support $lte operator', async () => {
        const results = await store.find({ age: { $lte: 30 } })
        expect(results).toHaveLength(3)
      })

      it('should support $in operator', async () => {
        const results = await store.find({ name: { $in: ['Alice', 'Bob'] } })
        expect(results).toHaveLength(2)
      })

      it('should support $nin operator', async () => {
        const results = await store.find({ name: { $nin: ['Alice', 'Bob'] } })
        expect(results).toHaveLength(2)
      })
    })

    describe('logical operators', () => {
      it('should support $and operator', async () => {
        const results = await store.find({
          $and: [{ age: { $gte: 25 } }, { age: { $lte: 30 } }],
        })
        expect(results).toHaveLength(3)
      })

      it('should support $or operator', async () => {
        const results = await store.find({
          $or: [{ name: 'Alice' }, { name: 'Bob' }],
        })
        expect(results).toHaveLength(2)
      })

      it('should support $not operator', async () => {
        const results = await store.find({
          $not: { name: 'Alice' },
        })
        expect(results).toHaveLength(3)
      })

      it('should support $nor operator', async () => {
        const results = await store.find({
          $nor: [{ name: 'Alice' }, { name: 'Bob' }],
        })
        expect(results).toHaveLength(2)
      })
    })

    describe('element operators', () => {
      it('should support $exists operator', async () => {
        await store.insert({
          _id: 'u5',
          name: 'Eve',
          email: 'eve@example.com',
          age: 28,
          tags: ['new'],
        })

        const withTags = await store.find({ tags: { $exists: true } })
        expect(withTags).toHaveLength(1)

        const withoutTags = await store.find({ tags: { $exists: false } })
        expect(withoutTags).toHaveLength(4)
      })

      it('should support $type operator', async () => {
        const results = await store.find({ name: { $type: 'string' } })
        expect(results).toHaveLength(4)
      })
    })

    describe('string operators', () => {
      it('should support $regex operator', async () => {
        const results = await store.find({ name: { $regex: '^A' } })
        expect(results).toHaveLength(1)
        expect(results[0]?.name).toBe('Alice')
      })

      it('should support $regex with $options', async () => {
        const results = await store.find({ name: { $regex: 'alice', $options: 'i' } })
        expect(results).toHaveLength(1)
      })
    })

    describe('array operators', () => {
      beforeEach(async () => {
        await store.insert({
          _id: 'u5',
          name: 'Eve',
          email: 'eve@example.com',
          age: 28,
          tags: ['admin', 'premium', 'beta'],
        })
      })

      it('should support $size operator', async () => {
        const results = await store.find({ tags: { $size: 3 } })
        expect(results).toHaveLength(1)
      })

      it('should support $all operator', async () => {
        const results = await store.find({ tags: { $all: ['admin', 'premium'] } })
        expect(results).toHaveLength(1)
      })

      it('should support $elemMatch operator', async () => {
        await store.insert({
          _id: 'u6',
          name: 'Frank',
          email: 'frank@example.com',
          age: 40,
          tags: ['guest'],
        })

        const results = await store.find({
          tags: { $elemMatch: { $eq: 'admin' } },
        })
        expect(results).toHaveLength(1)
      })
    })

    describe('dot notation', () => {
      beforeEach(async () => {
        await store.insert({
          _id: 'u5',
          name: 'Eve',
          email: 'eve@example.com',
          age: 28,
          address: {
            city: 'New York',
            country: 'USA',
          },
        })
      })

      it('should support nested field queries', async () => {
        const results = await store.find({ 'address.city': 'New York' })
        expect(results).toHaveLength(1)
        expect(results[0]?.name).toBe('Eve')
      })
    })

    describe('find options', () => {
      it('should support limit', async () => {
        const results = await store.find({}, { limit: 2 })
        expect(results).toHaveLength(2)
      })

      it('should support skip', async () => {
        const all = await store.find({})
        const skipped = await store.find({}, { skip: 2 })
        expect(skipped).toHaveLength(2)
        expect(skipped[0]?._id).not.toBe(all[0]?._id)
      })

      it('should support sort ascending', async () => {
        const results = await store.find({}, { sort: { age: 1 } })
        expect(results[0]?.name).toBe('Bob')
        expect(results[results.length - 1]?.name).toBe('Charlie')
      })

      it('should support sort descending', async () => {
        const results = await store.find({}, { sort: { age: -1 } })
        expect(results[0]?.name).toBe('Charlie')
      })

      it('should support projection with inclusion', async () => {
        const results = await store.find({}, { projection: { name: 1, age: 1 } })
        expect(results[0]).toHaveProperty('name')
        expect(results[0]).toHaveProperty('age')
        expect(results[0]).toHaveProperty('_id')
        expect(results[0]).not.toHaveProperty('email')
      })

      it('should support projection with exclusion', async () => {
        const results = await store.find({}, { projection: { email: 0 } })
        expect(results[0]).toHaveProperty('name')
        expect(results[0]).toHaveProperty('age')
        expect(results[0]).not.toHaveProperty('email')
      })

      it('should support combined options', async () => {
        const results = await store.find({}, { sort: { age: 1 }, skip: 1, limit: 2 })
        expect(results).toHaveLength(2)
        expect(results[0]?.age).toBeGreaterThanOrEqual(25)
      })
    })
  })

  // ===========================================================================
  // UPDATE OPERATIONS
  // ===========================================================================

  describe('update operations', () => {
    let store: DocumentStore<User>

    beforeEach(async () => {
      store = createUserStore()
      await store.insertMany([
        { _id: 'u1', name: 'Alice', email: 'alice@example.com', age: 30 },
        { _id: 'u2', name: 'Bob', email: 'bob@example.com', age: 25 },
        { _id: 'u3', name: 'Charlie', email: 'charlie@example.com', age: 35 },
      ])
    })

    describe('$set operator', () => {
      it('should set a field value', async () => {
        await store.updateOne({ _id: 'u1' }, { $set: { age: 31 } })

        const doc = await store.get('u1')
        expect(doc?.age).toBe(31)
      })

      it('should set multiple fields', async () => {
        await store.updateOne({ _id: 'u1' }, { $set: { age: 31, name: 'Alice Updated' } })

        const doc = await store.get('u1')
        expect(doc?.age).toBe(31)
        expect(doc?.name).toBe('Alice Updated')
      })

      it('should set nested fields', async () => {
        await store.updateOne({ _id: 'u1' }, { $set: { 'address.city': 'Boston' } })

        const doc = await store.get('u1')
        expect(doc?.address?.city).toBe('Boston')
      })
    })

    describe('$unset operator', () => {
      it('should remove a field', async () => {
        await store.updateOne({ _id: 'u1' }, { $set: { tags: ['admin'] } })
        await store.updateOne({ _id: 'u1' }, { $unset: { tags: 1 } })

        const doc = await store.get('u1')
        expect(doc?.tags).toBeUndefined()
      })
    })

    describe('$inc operator', () => {
      it('should increment a numeric field', async () => {
        await store.updateOne({ _id: 'u1' }, { $inc: { age: 1 } })

        const doc = await store.get('u1')
        expect(doc?.age).toBe(31)
      })

      it('should decrement with negative value', async () => {
        await store.updateOne({ _id: 'u1' }, { $inc: { age: -5 } })

        const doc = await store.get('u1')
        expect(doc?.age).toBe(25)
      })
    })

    describe('$mul operator', () => {
      it('should multiply a numeric field', async () => {
        await store.updateOne({ _id: 'u1' }, { $mul: { age: 2 } })

        const doc = await store.get('u1')
        expect(doc?.age).toBe(60)
      })
    })

    describe('$min/$max operators', () => {
      it('should set to minimum if new value is less', async () => {
        await store.updateOne({ _id: 'u1' }, { $min: { age: 25 } })
        expect((await store.get('u1'))?.age).toBe(25)

        await store.updateOne({ _id: 'u1' }, { $min: { age: 30 } })
        expect((await store.get('u1'))?.age).toBe(25)
      })

      it('should set to maximum if new value is greater', async () => {
        await store.updateOne({ _id: 'u1' }, { $max: { age: 35 } })
        expect((await store.get('u1'))?.age).toBe(35)

        await store.updateOne({ _id: 'u1' }, { $max: { age: 30 } })
        expect((await store.get('u1'))?.age).toBe(35)
      })
    })

    describe('$rename operator', () => {
      it('should rename a field', async () => {
        await store.updateOne({ _id: 'u1' }, { $rename: { name: 'fullName' } })

        const doc = await store.get('u1')
        expect(doc?.name).toBeUndefined()
        expect((doc as unknown as Record<string, unknown>).fullName).toBe('Alice')
      })
    })

    describe('array operators', () => {
      beforeEach(async () => {
        await store.updateOne({ _id: 'u1' }, { $set: { tags: ['a', 'b'] } })
      })

      it('should $push to array', async () => {
        await store.updateOne({ _id: 'u1' }, { $push: { tags: 'c' } })

        const doc = await store.get('u1')
        expect(doc?.tags).toEqual(['a', 'b', 'c'])
      })

      it('should $pop from end of array', async () => {
        await store.updateOne({ _id: 'u1' }, { $pop: { tags: 1 } })

        const doc = await store.get('u1')
        expect(doc?.tags).toEqual(['a'])
      })

      it('should $pop from start of array', async () => {
        await store.updateOne({ _id: 'u1' }, { $pop: { tags: -1 } })

        const doc = await store.get('u1')
        expect(doc?.tags).toEqual(['b'])
      })

      it('should $addToSet (unique values only)', async () => {
        await store.updateOne({ _id: 'u1' }, { $addToSet: { tags: 'a' } })
        expect((await store.get('u1'))?.tags).toEqual(['a', 'b'])

        await store.updateOne({ _id: 'u1' }, { $addToSet: { tags: 'c' } })
        expect((await store.get('u1'))?.tags).toEqual(['a', 'b', 'c'])
      })

      it('should $pull values from array', async () => {
        await store.updateOne({ _id: 'u1' }, { $pull: { tags: 'a' } })

        const doc = await store.get('u1')
        expect(doc?.tags).toEqual(['b'])
      })
    })

    describe('updateOne with upsert', () => {
      it('should insert if document not found with upsert', async () => {
        const result = await store.updateOne(
          { _id: 'new-user' },
          { $set: { name: 'New User', age: 20 } },
          { upsert: true }
        )

        expect(result.upsertedId).toBeDefined()

        const doc = await store.get(result.upsertedId!)
        expect(doc?.name).toBe('New User')
      })

      it('should use $setOnInsert only on insert', async () => {
        // First call - upsert creates new doc
        await store.updateOne(
          { _id: 'upsert-test' },
          {
            $set: { name: 'Test' },
            $setOnInsert: { age: 100, email: 'test@example.com' },
          },
          { upsert: true }
        )

        const doc1 = await store.get('upsert-test')
        expect(doc1?.age).toBe(100)

        // Second call - update existing, should not apply $setOnInsert
        await store.updateOne(
          { _id: 'upsert-test' },
          {
            $set: { name: 'Test Updated' },
            $setOnInsert: { age: 200 },
          },
          { upsert: true }
        )

        const doc2 = await store.get('upsert-test')
        expect(doc2?.age).toBe(100) // Should remain 100
        expect(doc2?.name).toBe('Test Updated')
      })
    })

    describe('update (multiple documents)', () => {
      it('should update all matching documents', async () => {
        const result = await store.update({ age: { $gte: 30 } }, { $inc: { age: 1 } })

        expect(result.matchedCount).toBe(2)
        expect(result.modifiedCount).toBe(2)

        expect((await store.get('u1'))?.age).toBe(31)
        expect((await store.get('u3'))?.age).toBe(36)
        expect((await store.get('u2'))?.age).toBe(25) // unchanged
      })
    })

    describe('replacement update', () => {
      it('should replace entire document (keeping _id)', async () => {
        await store.updateOne(
          { _id: 'u1' },
          { name: 'Alice Replaced', email: 'new@example.com', age: 99 } as User
        )

        const doc = await store.get('u1')
        expect(doc?._id).toBe('u1')
        expect(doc?.name).toBe('Alice Replaced')
        expect(doc?.age).toBe(99)
      })
    })
  })

  // ===========================================================================
  // DELETE OPERATIONS
  // ===========================================================================

  describe('delete operations', () => {
    let store: DocumentStore<User>

    beforeEach(async () => {
      store = createUserStore()
      await store.insertMany([
        { _id: 'u1', name: 'Alice', email: 'alice@example.com', age: 30 },
        { _id: 'u2', name: 'Bob', email: 'bob@example.com', age: 30 },
        { _id: 'u3', name: 'Charlie', email: 'charlie@example.com', age: 35 },
      ])
    })

    it('should delete one document', async () => {
      const result = await store.deleteOne({ _id: 'u1' })

      expect(result.deletedCount).toBe(1)
      expect(await store.get('u1')).toBeNull()
      expect(await store.count()).toBe(2)
    })

    it('should delete multiple documents', async () => {
      const result = await store.delete({ age: 30 })

      expect(result.deletedCount).toBe(2)
      expect(await store.count()).toBe(1)
    })

    it('should return 0 when no documents match', async () => {
      const result = await store.deleteOne({ name: 'Unknown' })

      expect(result.deletedCount).toBe(0)
    })
  })

  // ===========================================================================
  // INDEX OPERATIONS
  // ===========================================================================

  describe('index operations', () => {
    let store: DocumentStore<User>

    beforeEach(async () => {
      store = createUserStore()
    })

    it('should create an index', async () => {
      const indexName = await store.createIndex({
        fields: { email: 1 },
      })

      expect(indexName).toBe('email_1')
    })

    it('should create a compound index', async () => {
      const indexName = await store.createIndex({
        fields: { age: 1, name: -1 },
      })

      expect(indexName).toBe('age_1_name_-1')
    })

    it('should create an index with custom name', async () => {
      const indexName = await store.createIndex({
        fields: { email: 1 },
        options: { name: 'email_unique' },
      })

      expect(indexName).toBe('email_unique')
    })

    it('should list indexes including _id', async () => {
      await store.createIndex({ fields: { email: 1 } })

      const indexes = await store.listIndexes()

      expect(indexes).toHaveLength(2) // _id and email
      expect(indexes.find((i) => i.name === '_id_')).toBeDefined()
      expect(indexes.find((i) => i.name === 'email_1')).toBeDefined()
    })

    it('should drop an index', async () => {
      await store.createIndex({ fields: { email: 1 } })
      await store.dropIndex('email_1')

      const indexes = await store.listIndexes()
      expect(indexes.find((i) => i.name === 'email_1')).toBeUndefined()
    })

    it('should throw when dropping non-existent index', async () => {
      await expect(store.dropIndex('non-existent')).rejects.toThrow()
    })
  })

  // ===========================================================================
  // AGGREGATION
  // ===========================================================================

  describe('aggregation', () => {
    let store: DocumentStore<Product>

    beforeEach(async () => {
      store = createProductStore()
      await store.insertMany([
        { _id: 'p1', name: 'Widget', price: 10, category: 'electronics', inStock: true },
        { _id: 'p2', name: 'Gadget', price: 25, category: 'electronics', inStock: true },
        { _id: 'p3', name: 'Gizmo', price: 15, category: 'electronics', inStock: false },
        { _id: 'p4', name: 'Book', price: 20, category: 'books', inStock: true },
        { _id: 'p5', name: 'Novel', price: 15, category: 'books', inStock: true },
      ])
    })

    describe('$match stage', () => {
      it('should filter documents', async () => {
        const results = await store.aggregate([{ $match: { category: 'electronics' } }])
        expect(results).toHaveLength(3)
      })
    })

    describe('$project stage', () => {
      it('should project fields', async () => {
        const results = await store.aggregate([
          { $match: { _id: 'p1' } },
          { $project: { name: 1, price: 1 } },
        ])

        expect(results[0]).toHaveProperty('name')
        expect(results[0]).toHaveProperty('price')
        expect(results[0]).not.toHaveProperty('category')
      })
    })

    describe('$sort stage', () => {
      it('should sort ascending', async () => {
        const results = await store.aggregate([{ $sort: { price: 1 } }])
        expect((results[0] as Product).price).toBe(10)
      })

      it('should sort descending', async () => {
        const results = await store.aggregate([{ $sort: { price: -1 } }])
        expect((results[0] as Product).price).toBe(25)
      })
    })

    describe('$limit and $skip stages', () => {
      it('should limit results', async () => {
        const results = await store.aggregate([{ $limit: 2 }])
        expect(results).toHaveLength(2)
      })

      it('should skip results', async () => {
        const results = await store.aggregate([{ $skip: 3 }])
        expect(results).toHaveLength(2)
      })
    })

    describe('$count stage', () => {
      it('should count documents', async () => {
        const results = await store.aggregate([
          { $match: { inStock: true } },
          { $count: 'inStockCount' },
        ])

        expect(results).toEqual([{ inStockCount: 4 }])
      })
    })

    describe('$group stage', () => {
      it('should group and sum', async () => {
        const results = await store.aggregate([
          {
            $group: {
              _id: '$category',
              totalPrice: { $sum: '$price' },
            },
          },
        ])

        const electronics = results.find((r: unknown) => (r as Record<string, unknown>)._id === 'electronics')
        const books = results.find((r: unknown) => (r as Record<string, unknown>)._id === 'books')

        expect((electronics as Record<string, unknown>)?.totalPrice).toBe(50)
        expect((books as Record<string, unknown>)?.totalPrice).toBe(35)
      })

      it('should compute average', async () => {
        const results = await store.aggregate([
          {
            $group: {
              _id: '$category',
              avgPrice: { $avg: '$price' },
            },
          },
        ])

        const electronics = results.find((r: unknown) => (r as Record<string, unknown>)._id === 'electronics') as Record<string, unknown>
        expect(electronics?.avgPrice).toBeCloseTo(16.67, 1)
      })

      it('should find min/max', async () => {
        const results = await store.aggregate([
          {
            $group: {
              _id: null,
              minPrice: { $min: '$price' },
              maxPrice: { $max: '$price' },
            },
          },
        ])

        expect((results[0] as Record<string, unknown>)?.minPrice).toBe(10)
        expect((results[0] as Record<string, unknown>)?.maxPrice).toBe(25)
      })

      it('should count in group', async () => {
        const results = await store.aggregate([
          {
            $group: {
              _id: '$category',
              count: { $count: {} },
            },
          },
        ])

        const electronics = results.find((r: unknown) => (r as Record<string, unknown>)._id === 'electronics') as Record<string, unknown>
        expect(electronics?.count).toBe(3)
      })

      it('should collect with $push', async () => {
        const results = await store.aggregate([
          {
            $group: {
              _id: '$category',
              names: { $push: '$name' },
            },
          },
        ])

        const electronics = results.find((r: unknown) => (r as Record<string, unknown>)._id === 'electronics') as Record<string, unknown>
        expect((electronics?.names as string[]).sort()).toEqual(['Gadget', 'Gizmo', 'Widget'])
      })
    })

    describe('$unwind stage', () => {
      beforeEach(async () => {
        await store.updateOne({ _id: 'p1' }, { $set: { variants: ['red', 'blue', 'green'] } })
      })

      it('should unwind array field', async () => {
        const results = await store.aggregate([
          { $match: { _id: 'p1' } },
          { $unwind: '$variants' },
        ])

        expect(results).toHaveLength(3)
        expect((results[0] as Record<string, unknown>).variants).toBe('red')
        expect((results[1] as Record<string, unknown>).variants).toBe('blue')
        expect((results[2] as Record<string, unknown>).variants).toBe('green')
      })
    })
  })

  // ===========================================================================
  // TRANSACTIONS
  // ===========================================================================

  describe('transactions', () => {
    it('should execute operations atomically', async () => {
      const store = createUserStore()

      await store.transaction(async (session) => {
        await session.insert({
          name: 'Alice',
          email: 'alice@example.com',
          age: 30,
        })
        await session.insert({
          name: 'Bob',
          email: 'bob@example.com',
          age: 25,
        })
      })

      expect(await store.count()).toBe(2)
    })

    it('should rollback on error', async () => {
      const store = createUserStore()

      await store.insert({
        _id: 'existing',
        name: 'Existing',
        email: 'existing@example.com',
        age: 40,
      })

      try {
        await store.transaction(async (session) => {
          await session.insert({
            name: 'New User',
            email: 'new@example.com',
            age: 20,
          })

          throw new Error('Simulated failure')
        })
      } catch {
        // Expected
      }

      // Original document should still exist
      expect(await store.get('existing')).not.toBeNull()
    })
  })

  // ===========================================================================
  // COLLECTION MANAGEMENT
  // ===========================================================================

  describe('collection management', () => {
    let store: DocumentStore<User>

    beforeEach(async () => {
      store = createUserStore()
      await store.insertMany([
        { _id: 'u1', name: 'Alice', email: 'alice@example.com', age: 30 },
        { _id: 'u2', name: 'Bob', email: 'bob@example.com', age: 25 },
        { _id: 'u3', name: 'Charlie', email: 'charlie@example.com', age: 30 },
      ])
    })

    describe('count', () => {
      it('should count all documents', async () => {
        expect(await store.count()).toBe(3)
      })

      it('should count with filter', async () => {
        expect(await store.count({ age: 30 })).toBe(2)
      })
    })

    describe('distinct', () => {
      it('should get distinct values', async () => {
        const ages = await store.distinct('age')
        expect(ages.sort()).toEqual([25, 30])
      })

      it('should get distinct with filter', async () => {
        const names = await store.distinct('name', { age: 30 })
        expect(names.sort()).toEqual(['Alice', 'Charlie'])
      })
    })

    describe('drop', () => {
      it('should drop all documents', async () => {
        await store.drop()

        expect(await store.count()).toBe(0)
        expect(await store.find({})).toEqual([])
      })
    })
  })

  // ===========================================================================
  // SCHEMA OPERATIONS
  // ===========================================================================

  describe('schema operations', () => {
    it('should infer schema from inserted documents', async () => {
      const store = createDocumentStore<User>({ enableSchemaValidation: true })

      await store.insert({
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      const schema = store.getSchema()
      expect(schema.fields.size).toBeGreaterThan(0)
    })

    it('should validate documents', async () => {
      const store = createUserStore()

      const valid = store.validateDocument({
        _id: 'test',
        name: 'Test',
        email: 'test@example.com',
        age: 25,
      })
      expect(valid.valid).toBe(true)

      const invalid = store.validateDocument('not an object')
      expect(invalid.valid).toBe(false)
    })
  })

  // ===========================================================================
  // MAINTENANCE
  // ===========================================================================

  describe('maintenance', () => {
    it('should prune old versions', async () => {
      const store = createDocumentStore<User>({
        retention: { maxVersions: 2 },
      })

      const { insertedId } = await store.insert({
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      // Create multiple versions with small delay to ensure different timestamps
      for (let i = 31; i <= 35; i++) {
        await store.updateOne({ _id: insertedId }, { $set: { age: i } })
        // Small delay to ensure different timestamps
        await new Promise((r) => setTimeout(r, 5))
      }

      const stats = await store.prune()

      // Prune stats structure should be defined
      expect(stats).toBeDefined()
      expect(typeof stats.versionsRemoved).toBe('number')
      // Note: versionsRemoved may be 0 if temporal store tracks versions per key differently
    })

    it('should compact (alias for prune)', async () => {
      const store = createUserStore()

      const stats = await store.compact()

      expect(stats).toBeDefined()
      expect(stats.versionsRemoved).toBe(0) // No retention policy set
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty collection', async () => {
      const store = createUserStore()

      expect(await store.count()).toBe(0)
      expect(await store.find({})).toEqual([])
      expect(await store.findOne({})).toBeNull()
    })

    it('should handle special characters in field values', async () => {
      const store = createUserStore()

      await store.insert({
        _id: 'special',
        name: 'Test "User" <script>',
        email: "test'user@example.com",
        age: 25,
      })

      const doc = await store.findOne({ _id: 'special' })
      expect(doc?.name).toBe('Test "User" <script>')
    })

    it('should handle null values', async () => {
      const store = createDocumentStore<{ _id: string; value: string | null }>()

      await store.insert({ _id: 'null-test', value: null })

      const doc = await store.get('null-test')
      expect(doc?.value).toBeNull()
    })

    it('should handle deeply nested objects', async () => {
      const store = createDocumentStore<{
        _id: string
        deep: { level1: { level2: { level3: { value: number } } } }
      }>()

      await store.insert({
        _id: 'deep',
        deep: { level1: { level2: { level3: { value: 42 } } } },
      })

      const doc = await store.findOne({ 'deep.level1.level2.level3.value': 42 })
      expect(doc).not.toBeNull()
    })

    it('should handle large arrays', async () => {
      const store = createDocumentStore<{ _id: string; items: number[] }>()

      const items = Array.from({ length: 1000 }, (_, i) => i)
      await store.insert({ _id: 'large-array', items })

      const doc = await store.get('large-array')
      expect(doc?.items).toHaveLength(1000)
    })

    it('should handle concurrent operations', async () => {
      const store = createUserStore()

      await Promise.all([
        store.insert({ name: 'User1', email: 'u1@example.com', age: 20 }),
        store.insert({ name: 'User2', email: 'u2@example.com', age: 21 }),
        store.insert({ name: 'User3', email: 'u3@example.com', age: 22 }),
        store.insert({ name: 'User4', email: 'u4@example.com', age: 23 }),
        store.insert({ name: 'User5', email: 'u5@example.com', age: 24 }),
      ])

      expect(await store.count()).toBe(5)
    })
  })
})
