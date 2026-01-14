/**
 * Index Management Tests
 *
 * Tests for MongoDB-compatible index operations.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Collection, ObjectId, type Document } from '../index'

interface User extends Document {
  name: string
  email?: string
  age?: number
  city?: string
  bio?: string
}

describe('Index Management', () => {
  let collection: Collection<User>

  beforeEach(() => {
    collection = new Collection<User>('testdb', 'users')
  })

  describe('createIndex', () => {
    it('should create a single field index', async () => {
      const name = await collection.createIndex({ name: 1 })

      expect(name).toBe('name_1')
    })

    it('should create index with custom name', async () => {
      const name = await collection.createIndex({ name: 1 }, { name: 'my_name_idx' })

      expect(name).toBe('my_name_idx')
    })

    it('should create compound index', async () => {
      const name = await collection.createIndex({ name: 1, age: -1 })

      expect(name).toBe('name_1_age_-1')
    })

    it('should create unique index', async () => {
      await collection.createIndex({ email: 1 }, { unique: true })

      await collection.insertOne({ name: 'Alice', email: 'alice@example.com' })

      await expect(
        collection.insertOne({ name: 'Bob', email: 'alice@example.com' })
      ).rejects.toThrow()
    })

    it('should enforce uniqueness on existing documents', async () => {
      await collection.insertOne({ name: 'Alice', email: 'alice@example.com' })

      // Creating unique index after duplicate exists should work
      // (but not insert another duplicate)
      await collection.createIndex({ email: 1 }, { unique: true })

      await expect(
        collection.insertOne({ name: 'Bob', email: 'alice@example.com' })
      ).rejects.toThrow()
    })
  })

  describe('createIndexes', () => {
    it('should create multiple indexes', async () => {
      const names = await collection.createIndexes([
        { key: { name: 1 } },
        { key: { age: 1 } },
        { key: { city: 1 } },
      ])

      expect(names.length).toBe(3)
      expect(names).toContain('name_1')
      expect(names).toContain('age_1')
      expect(names).toContain('city_1')
    })
  })

  describe('listIndexes', () => {
    it('should list all indexes', async () => {
      await collection.createIndex({ name: 1 })
      await collection.createIndex({ age: 1 })

      const indexes = await collection.listIndexes().toArray()

      // Should include _id index plus our indexes
      expect(indexes.length).toBeGreaterThanOrEqual(2)
      expect(indexes.some((i) => i.name === 'name_1')).toBe(true)
      expect(indexes.some((i) => i.name === 'age_1')).toBe(true)
    })

    it('should include _id index', async () => {
      const indexes = await collection.listIndexes().toArray()

      expect(indexes.some((i) => i.name === '_id_')).toBe(true)
    })
  })

  describe('dropIndex', () => {
    it('should drop index by name', async () => {
      await collection.createIndex({ name: 1 })
      await collection.dropIndex('name_1')

      const indexes = await collection.listIndexes().toArray()

      expect(indexes.find((i) => i.name === 'name_1')).toBeUndefined()
    })
  })

  describe('dropIndexes', () => {
    it('should drop all indexes except _id', async () => {
      await collection.createIndex({ name: 1 })
      await collection.createIndex({ age: 1 })
      await collection.dropIndexes()

      const indexes = await collection.listIndexes().toArray()
      const nonIdIndexes = indexes.filter((i) => i.name !== '_id_')

      expect(nonIdIndexes.length).toBe(0)
    })
  })

  describe('indexExists', () => {
    it('should check if index exists', async () => {
      await collection.createIndex({ name: 1 })

      expect(await collection.indexExists('name_1')).toBe(true)
      expect(await collection.indexExists('nonexistent')).toBe(false)
    })

    it('should check multiple indexes', async () => {
      await collection.createIndex({ name: 1 })
      await collection.createIndex({ age: 1 })

      expect(await collection.indexExists(['name_1', 'age_1'])).toBe(true)
      expect(await collection.indexExists(['name_1', 'nonexistent'])).toBe(false)
    })
  })

  describe('indexes', () => {
    it('should return all indexes', async () => {
      await collection.createIndex({ name: 1 })
      await collection.createIndex({ age: 1 })

      const indexes = await collection.indexes()

      expect(indexes.some((i) => i.name === 'name_1')).toBe(true)
      expect(indexes.some((i) => i.name === 'age_1')).toBe(true)
    })
  })

  describe('Text Indexes', () => {
    beforeEach(async () => {
      await collection.createIndex({ bio: 'text' })
      await collection.insertMany([
        { name: 'Alice', bio: 'Software engineer with expertise in JavaScript' },
        { name: 'Bob', bio: 'Data scientist specializing in machine learning' },
        { name: 'Charlie', bio: 'Full stack JavaScript developer' },
      ])
    })

    it('should create text index', async () => {
      const indexes = await collection.indexes()

      expect(indexes.some((i) => i.key.bio === 'text')).toBe(true)
    })
  })

  describe('Index Info', () => {
    it('should include key specification in index info', async () => {
      await collection.createIndex({ name: 1, age: -1 })

      const indexes = await collection.indexes()
      const idx = indexes.find((i) => i.name === 'name_1_age_-1')

      expect(idx).toBeDefined()
      expect(idx!.key).toEqual({ name: 1, age: -1 })
    })

    it('should include unique flag in index info', async () => {
      await collection.createIndex({ email: 1 }, { unique: true })

      const indexes = await collection.indexes()
      const idx = indexes.find((i) => i.name === 'email_1')

      expect(idx!.unique).toBe(true)
    })

    it('should include sparse flag in index info', async () => {
      await collection.createIndex({ city: 1 }, { sparse: true })

      const indexes = await collection.indexes()
      const idx = indexes.find((i) => i.name === 'city_1')

      expect(idx!.sparse).toBe(true)
    })
  })
})

describe('Index Usage', () => {
  let collection: Collection<User>

  beforeEach(async () => {
    collection = new Collection<User>('testdb', 'users')
    await collection.insertMany([
      { name: 'Alice', age: 30, city: 'NYC' },
      { name: 'Bob', age: 25, city: 'LA' },
      { name: 'Charlie', age: 35, city: 'NYC' },
      { name: 'Diana', age: 28, city: 'Chicago' },
      { name: 'Eve', age: 22, city: 'LA' },
    ])
  })

  it('should find documents with index on field', async () => {
    await collection.createIndex({ city: 1 })

    const docs = await collection.find({ city: 'NYC' }).toArray()

    expect(docs.length).toBe(2)
  })

  it('should update documents with indexed field', async () => {
    await collection.createIndex({ name: 1 })

    await collection.updateOne({ name: 'Alice' }, { $set: { name: 'Alicia' } })

    const doc = await collection.findOne({ name: 'Alicia' })
    expect(doc).not.toBeNull()
  })

  it('should delete documents with indexed field', async () => {
    await collection.createIndex({ age: 1 })

    await collection.deleteOne({ age: 30 })

    const doc = await collection.findOne({ name: 'Alice' })
    expect(doc).toBeNull()
  })

  it('should maintain index after bulk operations', async () => {
    await collection.createIndex({ name: 1 }, { unique: true })

    await collection.insertMany([
      { name: 'Frank', age: 40 },
      { name: 'Grace', age: 45 },
    ])

    // Should still enforce uniqueness
    await expect(
      collection.insertOne({ name: 'Frank', age: 50 })
    ).rejects.toThrow()
  })
})
