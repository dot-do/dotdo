/**
 * Collection CRUD Tests
 *
 * Tests for MongoDB-compatible Collection class with CRUD operations.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Collection, ObjectId, type Document } from '../index'

interface User extends Document {
  name: string
  age: number
  email?: string
  city?: string
  tags?: string[]
}

describe('Collection', () => {
  let collection: Collection<User>

  beforeEach(() => {
    collection = new Collection<User>('testdb', 'users')
  })

  describe('metadata', () => {
    it('should have correct collection name', () => {
      expect(collection.collectionName).toBe('users')
    })

    it('should have correct database name', () => {
      expect(collection.dbName).toBe('testdb')
    })

    it('should have correct namespace', () => {
      expect(collection.namespace).toBe('testdb.users')
    })
  })

  describe('insertOne', () => {
    it('should insert a document', async () => {
      const result = await collection.insertOne({ name: 'Alice', age: 30 })

      expect(result.acknowledged).toBe(true)
      expect(result.insertedId).toBeInstanceOf(ObjectId)
    })

    it('should insert with provided _id', async () => {
      const _id = new ObjectId()
      const result = await collection.insertOne({ _id, name: 'Bob', age: 25 })

      expect(result.insertedId.equals(_id)).toBe(true)
    })

    it('should reject duplicate _id', async () => {
      const _id = new ObjectId()
      await collection.insertOne({ _id, name: 'Alice', age: 30 })

      await expect(collection.insertOne({ _id, name: 'Bob', age: 25 })).rejects.toThrow()
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
      expect(Object.keys(result.insertedIds).length).toBe(3)
    })

    it('should handle ordered insert with error', async () => {
      const _id = new ObjectId()
      await collection.insertOne({ _id, name: 'Existing', age: 20 })

      await expect(
        collection.insertMany([{ _id, name: 'Dup', age: 30 }, { name: 'New', age: 40 }], { ordered: true })
      ).rejects.toThrow()
    })
  })

  describe('findOne', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' },
        { name: 'Charlie', age: 35, city: 'NYC' },
      ])
    })

    it('should find one document', async () => {
      const doc = await collection.findOne({ name: 'Alice' })

      expect(doc).not.toBeNull()
      expect(doc!.name).toBe('Alice')
      expect(doc!._id).toBeInstanceOf(ObjectId)
    })

    it('should return null when not found', async () => {
      const doc = await collection.findOne({ name: 'NotFound' })

      expect(doc).toBeNull()
    })

    it('should apply projection', async () => {
      const doc = await collection.findOne({ name: 'Alice' }, { projection: { name: 1 } })

      expect(doc!.name).toBe('Alice')
      expect(doc!._id).toBeDefined()
      expect((doc as any).age).toBeUndefined()
    })
  })

  describe('find', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' },
        { name: 'Charlie', age: 35, city: 'NYC' },
        { name: 'Diana', age: 28, city: 'Chicago' },
        { name: 'Eve', age: 22, city: 'LA' },
      ])
    })

    it('should find all documents', async () => {
      const docs = await collection.find({}).toArray()

      expect(docs.length).toBe(5)
    })

    it('should filter documents', async () => {
      const docs = await collection.find({ city: 'NYC' }).toArray()

      expect(docs.length).toBe(2)
    })

    it('should limit results', async () => {
      const docs = await collection.find({}).limit(3).toArray()

      expect(docs.length).toBe(3)
    })

    it('should skip results', async () => {
      const docs = await collection.find({}).skip(2).toArray()

      expect(docs.length).toBe(3)
    })

    it('should sort results ascending', async () => {
      const docs = await collection.find({}).sort({ age: 1 }).toArray()

      expect(docs[0].age).toBe(22)
      expect(docs[4].age).toBe(35)
    })

    it('should sort results descending', async () => {
      const docs = await collection.find({}).sort({ age: -1 }).toArray()

      expect(docs[0].age).toBe(35)
      expect(docs[4].age).toBe(22)
    })

    it('should project fields', async () => {
      const docs = await collection.find({}).project({ name: 1 }).toArray()

      expect(docs[0].name).toBeDefined()
      expect(docs[0]._id).toBeDefined()
      expect((docs[0] as any).age).toBeUndefined()
    })

    it('should iterate with forEach', async () => {
      const names: string[] = []
      await collection.find({}).forEach((doc) => {
        names.push(doc.name)
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

    it('should be async iterable', async () => {
      const names: string[] = []
      for await (const doc of collection.find({})) {
        names.push(doc.name)
      }

      expect(names.length).toBe(5)
    })
  })

  describe('updateOne', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30, tags: ['a', 'b'] },
        { name: 'Bob', age: 25, tags: ['b', 'c'] },
        { name: 'Charlie', age: 30, tags: ['a'] },
      ])
    })

    it('should update with $set', async () => {
      const result = await collection.updateOne({ name: 'Alice' }, { $set: { age: 31 } })

      expect(result.matchedCount).toBe(1)
      expect(result.modifiedCount).toBe(1)

      const doc = await collection.findOne({ name: 'Alice' })
      expect(doc!.age).toBe(31)
    })

    it('should update with $inc', async () => {
      await collection.updateOne({ name: 'Alice' }, { $inc: { age: 5 } })

      const doc = await collection.findOne({ name: 'Alice' })
      expect(doc!.age).toBe(35)
    })

    it('should update with $unset', async () => {
      await collection.updateOne({ name: 'Alice' }, { $unset: { tags: '' } })

      const doc = await collection.findOne({ name: 'Alice' })
      expect(doc!.tags).toBeUndefined()
    })

    it('should update with $push', async () => {
      await collection.updateOne({ name: 'Alice' }, { $push: { tags: 'c' } })

      const doc = await collection.findOne({ name: 'Alice' })
      expect(doc!.tags).toEqual(['a', 'b', 'c'])
    })

    it('should update with $pull', async () => {
      await collection.updateOne({ name: 'Alice' }, { $pull: { tags: 'a' } })

      const doc = await collection.findOne({ name: 'Alice' })
      expect(doc!.tags).toEqual(['b'])
    })

    it('should update with $addToSet', async () => {
      await collection.updateOne({ name: 'Alice' }, { $addToSet: { tags: 'b' } }) // duplicate
      await collection.updateOne({ name: 'Alice' }, { $addToSet: { tags: 'd' } }) // new

      const doc = await collection.findOne({ name: 'Alice' })
      expect(doc!.tags).toEqual(['a', 'b', 'd'])
    })

    it('should update with $pop (remove last)', async () => {
      await collection.updateOne({ name: 'Alice' }, { $pop: { tags: 1 } })

      const doc = await collection.findOne({ name: 'Alice' })
      expect(doc!.tags).toEqual(['a'])
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
  })

  describe('updateMany', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 30 },
      ])
    })

    it('should update multiple documents', async () => {
      const result = await collection.updateMany({ age: 30 }, { $set: { updated: true } })

      expect(result.matchedCount).toBe(2)
      expect(result.modifiedCount).toBe(2)

      const updated = await collection.find({ updated: true } as any).toArray()
      expect(updated.length).toBe(2)
    })
  })

  describe('replaceOne', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ])
    })

    it('should replace document', async () => {
      const result = await collection.replaceOne(
        { name: 'Alice' },
        { name: 'Alice Updated', age: 31, city: 'NYC' }
      )

      expect(result.matchedCount).toBe(1)
      expect(result.modifiedCount).toBe(1)

      const doc = await collection.findOne({ name: 'Alice Updated' })
      expect(doc!.city).toBe('NYC')
    })
  })

  describe('deleteOne', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 30 },
      ])
    })

    it('should delete one document', async () => {
      const result = await collection.deleteOne({ name: 'Alice' })

      expect(result.acknowledged).toBe(true)
      expect(result.deletedCount).toBe(1)

      const doc = await collection.findOne({ name: 'Alice' })
      expect(doc).toBeNull()
    })

    it('should delete only first match', async () => {
      const result = await collection.deleteOne({ age: 30 })

      expect(result.deletedCount).toBe(1)

      const remaining = await collection.find({ age: 30 }).toArray()
      expect(remaining.length).toBe(1)
    })

    it('should return 0 when no match', async () => {
      const result = await collection.deleteOne({ name: 'NotFound' })

      expect(result.deletedCount).toBe(0)
    })
  })

  describe('deleteMany', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 30 },
      ])
    })

    it('should delete multiple documents', async () => {
      const result = await collection.deleteMany({ age: 30 })

      expect(result.deletedCount).toBe(2)

      const remaining = await collection.find({}).toArray()
      expect(remaining.length).toBe(1)
    })

    it('should delete all documents', async () => {
      const result = await collection.deleteMany({})

      expect(result.deletedCount).toBe(3)
    })
  })

  describe('findOneAndUpdate', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ])
    })

    it('should return document before update', async () => {
      const doc = await collection.findOneAndUpdate(
        { name: 'Alice' },
        { $set: { age: 31 } },
        { returnDocument: 'before' }
      )

      expect(doc!.age).toBe(30)
    })

    it('should return document after update', async () => {
      const doc = await collection.findOneAndUpdate(
        { name: 'Alice' },
        { $set: { age: 31 } },
        { returnDocument: 'after' }
      )

      expect(doc!.age).toBe(31)
    })

    it('should upsert when not found', async () => {
      const doc = await collection.findOneAndUpdate(
        { name: 'Charlie' },
        { $set: { age: 35 } },
        { upsert: true, returnDocument: 'after' }
      )

      expect(doc!.name).toBe('Charlie')
      expect(doc!.age).toBe(35)
    })
  })

  describe('findOneAndDelete', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ])
    })

    it('should return deleted document', async () => {
      const doc = await collection.findOneAndDelete({ name: 'Alice' })

      expect(doc!.name).toBe('Alice')

      const remaining = await collection.findOne({ name: 'Alice' })
      expect(remaining).toBeNull()
    })
  })

  describe('findOneAndReplace', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ])
    })

    it('should replace and return after', async () => {
      const doc = await collection.findOneAndReplace(
        { name: 'Alice' },
        { name: 'Alice', city: 'NYC', age: 31 },
        { returnDocument: 'after' }
      )

      expect(doc!.city).toBe('NYC')
      expect(doc!.age).toBe(31)
    })
  })

  describe('countDocuments', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 30 },
      ])
    })

    it('should count all documents', async () => {
      const count = await collection.countDocuments()

      expect(count).toBe(3)
    })

    it('should count with filter', async () => {
      const count = await collection.countDocuments({ age: 30 })

      expect(count).toBe(2)
    })

    it('should count with skip', async () => {
      const count = await collection.countDocuments({}, { skip: 1 })

      expect(count).toBe(2)
    })

    it('should count with limit', async () => {
      const count = await collection.countDocuments({}, { limit: 2 })

      expect(count).toBe(2)
    })
  })

  describe('estimatedDocumentCount', () => {
    it('should estimate count', async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 35 },
      ])

      const count = await collection.estimatedDocumentCount()

      expect(count).toBe(3)
    })
  })

  describe('distinct', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' },
        { name: 'Charlie', age: 30, city: 'NYC' },
      ])
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

  describe('drop', () => {
    it('should drop collection', async () => {
      await collection.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ])

      const dropped = await collection.drop()

      expect(dropped).toBe(true)

      const count = await collection.estimatedDocumentCount()
      expect(count).toBe(0)
    })
  })
})
