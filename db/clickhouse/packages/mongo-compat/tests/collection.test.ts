/**
 * Collection Tests
 *
 * These tests verify that our Collection implementation matches the
 * MongoDB driver's Collection interface for CRUD operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  WithId,
  Document,
} from 'mongodb';
import { MongoClient, Collection } from '../src/index.js';
import { TEST_ENDPOINT, TestUser, TestProduct } from './setup.js';

describe('Collection<T>', () => {
  let client: MongoClient;
  let collection: Collection<TestUser>;

  beforeEach(async () => {
    client = new MongoClient(TEST_ENDPOINT);
    await client.connect();
    collection = client.db('testdb').collection<TestUser>('users');
  });

  afterEach(async () => {
    try {
      await client.close();
    } catch {
      // Ignore errors during cleanup in RED phase
    }
  });

  describe('insertOne()', () => {
    it('insertOne returns InsertOneResult', async () => {
      const doc: TestUser = {
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        active: true,
        createdAt: new Date(),
      };

      const result = await collection.insertOne(doc);

      expect(result).toBeDefined();
      expect(result.acknowledged).toBe(true);
      expect(result.insertedId).toBeDefined();
    });

    it('insertOne generates _id if not provided', async () => {
      const doc: TestUser = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        age: 25,
        active: true,
        createdAt: new Date(),
      };

      const result = await collection.insertOne(doc);
      expect(result.insertedId).toBeDefined();
    });

    it('insertOne preserves _id if provided', async () => {
      const customId = 'custom-id-123';
      const doc: TestUser = {
        _id: customId,
        name: 'Custom ID User',
        email: 'custom@example.com',
        age: 40,
        active: true,
        createdAt: new Date(),
      };

      const result = await collection.insertOne(doc);
      expect(result.insertedId).toBe(customId);
    });

    it('insertOne result has correct type structure', async () => {
      const doc: TestUser = {
        name: 'Type Test',
        email: 'type@example.com',
        age: 35,
        active: false,
        createdAt: new Date(),
      };

      const result = await collection.insertOne(doc);

      // Verify structure matches InsertOneResult
      expect(typeof result.acknowledged).toBe('boolean');
      expect('insertedId' in result).toBe(true);
    });
  });

  describe('insertMany()', () => {
    it('insertMany returns InsertManyResult', async () => {
      const docs: TestUser[] = [
        { name: 'User 1', email: 'user1@example.com', age: 20, active: true, createdAt: new Date() },
        { name: 'User 2', email: 'user2@example.com', age: 25, active: true, createdAt: new Date() },
        { name: 'User 3', email: 'user3@example.com', age: 30, active: false, createdAt: new Date() },
      ];

      const result = await collection.insertMany(docs);

      expect(result).toBeDefined();
      expect(result.acknowledged).toBe(true);
      expect(result.insertedCount).toBe(3);
      expect(result.insertedIds).toBeDefined();
    });

    it('insertMany returns correct insertedCount', async () => {
      const docs: TestUser[] = [
        { name: 'Batch 1', email: 'b1@example.com', age: 21, active: true, createdAt: new Date() },
        { name: 'Batch 2', email: 'b2@example.com', age: 22, active: true, createdAt: new Date() },
      ];

      const result = await collection.insertMany(docs);
      expect(result.insertedCount).toBe(docs.length);
    });

    it('insertMany returns insertedIds map', async () => {
      const docs: TestUser[] = [
        { name: 'Map 1', email: 'm1@example.com', age: 31, active: true, createdAt: new Date() },
        { name: 'Map 2', email: 'm2@example.com', age: 32, active: true, createdAt: new Date() },
      ];

      const result = await collection.insertMany(docs);

      expect(result.insertedIds).toBeDefined();
      expect(result.insertedIds[0]).toBeDefined();
      expect(result.insertedIds[1]).toBeDefined();
    });

    it('insertMany handles empty array', async () => {
      const result = await collection.insertMany([]);

      expect(result.acknowledged).toBe(true);
      expect(result.insertedCount).toBe(0);
    });
  });

  describe('findOne()', () => {
    it('findOne returns T | null', async () => {
      // First insert a document
      const doc: TestUser = {
        name: 'Find Me',
        email: 'findme@example.com',
        age: 45,
        active: true,
        createdAt: new Date(),
      };
      await collection.insertOne(doc);

      // Then find it
      const found = await collection.findOne({ email: 'findme@example.com' });

      expect(found).toBeDefined();
      expect(found?.name).toBe('Find Me');
    });

    it('findOne returns null when not found', async () => {
      const found = await collection.findOne({ email: 'nonexistent@example.com' });
      expect(found).toBeNull();
    });

    it('findOne with empty filter returns first document', async () => {
      await collection.insertOne({
        name: 'First',
        email: 'first@example.com',
        age: 1,
        active: true,
        createdAt: new Date(),
      });

      const found = await collection.findOne({});
      expect(found).toBeDefined();
    });

    it('findOne supports comparison operators', async () => {
      await collection.insertMany([
        { name: 'Young', email: 'young@example.com', age: 18, active: true, createdAt: new Date() },
        { name: 'Old', email: 'old@example.com', age: 65, active: true, createdAt: new Date() },
      ]);

      const found = await collection.findOne({ age: { $gt: 60 } });
      expect(found?.name).toBe('Old');
    });

    it('findOne supports $and operator', async () => {
      await collection.insertOne({
        name: 'Match Both',
        email: 'both@example.com',
        age: 30,
        active: true,
        createdAt: new Date(),
      });

      const found = await collection.findOne({
        $and: [{ age: { $gte: 25 } }, { active: true }],
      });

      expect(found?.name).toBe('Match Both');
    });

    it('findOne supports $or operator', async () => {
      await collection.insertMany([
        { name: 'Either 1', email: 'e1@example.com', age: 20, active: true, createdAt: new Date() },
        { name: 'Either 2', email: 'e2@example.com', age: 50, active: false, createdAt: new Date() },
      ]);

      const found = await collection.findOne({
        $or: [{ age: { $lt: 25 } }, { active: false }],
      });

      expect(found).toBeDefined();
    });
  });

  describe('find()', () => {
    it('find returns FindCursor<T>', async () => {
      const cursor = collection.find({});
      expect(cursor).toBeDefined();
      expect(typeof cursor.toArray).toBe('function');
    });

    it('find with filter returns matching documents', async () => {
      await collection.insertMany([
        { name: 'Active 1', email: 'a1@example.com', age: 25, active: true, createdAt: new Date() },
        { name: 'Inactive', email: 'in@example.com', age: 30, active: false, createdAt: new Date() },
        { name: 'Active 2', email: 'a2@example.com', age: 35, active: true, createdAt: new Date() },
      ]);

      const cursor = collection.find({ active: true });
      const results = await cursor.toArray();

      expect(results.length).toBe(2);
      expect(results.every((r) => r.active === true)).toBe(true);
    });

    it('find with empty filter returns all documents', async () => {
      await collection.insertMany([
        { name: 'All 1', email: 'all1@example.com', age: 20, active: true, createdAt: new Date() },
        { name: 'All 2', email: 'all2@example.com', age: 30, active: false, createdAt: new Date() },
      ]);

      const results = await collection.find({}).toArray();
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('find supports $in operator', async () => {
      await collection.insertMany([
        { name: 'In 1', email: 'in1@example.com', age: 20, active: true, createdAt: new Date() },
        { name: 'In 2', email: 'in2@example.com', age: 25, active: true, createdAt: new Date() },
        { name: 'In 3', email: 'in3@example.com', age: 30, active: true, createdAt: new Date() },
      ]);

      const results = await collection.find({ age: { $in: [20, 30] } }).toArray();
      expect(results.length).toBe(2);
    });
  });

  describe('updateOne()', () => {
    it('updateOne with filter and update', async () => {
      await collection.insertOne({
        name: 'To Update',
        email: 'update@example.com',
        age: 25,
        active: true,
        createdAt: new Date(),
      });

      const result = await collection.updateOne(
        { email: 'update@example.com' },
        { $set: { age: 26, name: 'Updated' } }
      );

      expect(result).toBeDefined();
      expect(result.acknowledged).toBe(true);
      expect(result.matchedCount).toBe(1);
      expect(result.modifiedCount).toBe(1);
    });

    it('updateOne returns UpdateResult structure', async () => {
      await collection.insertOne({
        name: 'Result Test',
        email: 'result@example.com',
        age: 30,
        active: true,
        createdAt: new Date(),
      });

      const result = await collection.updateOne(
        { email: 'result@example.com' },
        { $set: { active: false } }
      );

      expect(typeof result.acknowledged).toBe('boolean');
      expect(typeof result.matchedCount).toBe('number');
      expect(typeof result.modifiedCount).toBe('number');
    });

    it('updateOne with $inc operator', async () => {
      await collection.insertOne({
        name: 'Inc Test',
        email: 'inc@example.com',
        age: 30,
        active: true,
        createdAt: new Date(),
      });

      const result = await collection.updateOne({ email: 'inc@example.com' }, { $inc: { age: 1 } });

      expect(result.modifiedCount).toBe(1);

      const updated = await collection.findOne({ email: 'inc@example.com' });
      expect(updated?.age).toBe(31);
    });

    it('updateOne with no match returns matchedCount 0', async () => {
      const result = await collection.updateOne(
        { email: 'nonexistent@example.com' },
        { $set: { name: 'Should not match' } }
      );

      expect(result.matchedCount).toBe(0);
      expect(result.modifiedCount).toBe(0);
    });
  });

  describe('deleteOne()', () => {
    it('deleteOne returns DeleteResult', async () => {
      await collection.insertOne({
        name: 'To Delete',
        email: 'delete@example.com',
        age: 40,
        active: true,
        createdAt: new Date(),
      });

      const result = await collection.deleteOne({ email: 'delete@example.com' });

      expect(result).toBeDefined();
      expect(result.acknowledged).toBe(true);
      expect(result.deletedCount).toBe(1);
    });

    it('deleteOne removes the document', async () => {
      await collection.insertOne({
        name: 'Delete Verify',
        email: 'deleteverify@example.com',
        age: 35,
        active: true,
        createdAt: new Date(),
      });

      await collection.deleteOne({ email: 'deleteverify@example.com' });

      const found = await collection.findOne({ email: 'deleteverify@example.com' });
      expect(found).toBeNull();
    });

    it('deleteOne with no match returns deletedCount 0', async () => {
      const result = await collection.deleteOne({ email: 'nonexistent@example.com' });

      expect(result.acknowledged).toBe(true);
      expect(result.deletedCount).toBe(0);
    });

    it('deleteOne only removes one document', async () => {
      await collection.insertMany([
        {
          name: 'Duplicate 1',
          email: 'dup@example.com',
          age: 25,
          active: true,
          createdAt: new Date(),
        },
        {
          name: 'Duplicate 2',
          email: 'dup@example.com',
          age: 26,
          active: true,
          createdAt: new Date(),
        },
      ]);

      const result = await collection.deleteOne({ email: 'dup@example.com' });
      expect(result.deletedCount).toBe(1);

      const remaining = await collection.find({ email: 'dup@example.com' }).toArray();
      expect(remaining.length).toBe(1);
    });
  });

  describe('countDocuments()', () => {
    it('countDocuments returns number', async () => {
      await collection.insertMany([
        {
          name: 'Count 1',
          email: 'count1@example.com',
          age: 20,
          active: true,
          createdAt: new Date(),
        },
        {
          name: 'Count 2',
          email: 'count2@example.com',
          age: 25,
          active: true,
          createdAt: new Date(),
        },
        {
          name: 'Count 3',
          email: 'count3@example.com',
          age: 30,
          active: false,
          createdAt: new Date(),
        },
      ]);

      const count = await collection.countDocuments({});

      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('countDocuments with filter', async () => {
      await collection.insertMany([
        {
          name: 'Filter Count 1',
          email: 'fc1@example.com',
          age: 20,
          active: true,
          createdAt: new Date(),
        },
        {
          name: 'Filter Count 2',
          email: 'fc2@example.com',
          age: 25,
          active: false,
          createdAt: new Date(),
        },
        {
          name: 'Filter Count 3',
          email: 'fc3@example.com',
          age: 30,
          active: true,
          createdAt: new Date(),
        },
      ]);

      const activeCount = await collection.countDocuments({ active: true });
      expect(activeCount).toBeGreaterThanOrEqual(2);
    });

    it('countDocuments returns 0 for no matches', async () => {
      const count = await collection.countDocuments({ email: 'nonexistent@example.com' });
      expect(count).toBe(0);
    });
  });

  describe('typed collections', () => {
    it('preserves generic type T in operations', async () => {
      const productCollection = client.db('testdb').collection<TestProduct>('products');

      const product: TestProduct = {
        sku: 'SKU-001',
        name: 'Test Product',
        price: 99.99,
        quantity: 100,
        category: 'electronics',
      };

      const insertResult = await productCollection.insertOne(product);
      expect(insertResult.insertedId).toBeDefined();

      const found = await productCollection.findOne({ sku: 'SKU-001' });
      expect(found?.name).toBe('Test Product');
      expect(found?.price).toBe(99.99);
    });
  });
});
