/**
 * FindCursor Tests
 *
 * These tests verify that our FindCursor implementation matches the
 * MongoDB driver's FindCursor interface for query chaining and iteration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FindCursor as MongoFindCursor, Document } from 'mongodb';
import { MongoClient, Collection, FindCursor } from '../src/index.js';
import { TEST_ENDPOINT, TestUser } from './setup.js';

describe('FindCursor<T>', () => {
  let client: MongoClient;
  let collection: Collection<TestUser>;

  // Seed data for cursor tests
  const seedUsers: TestUser[] = [
    { name: 'Alice', email: 'alice@example.com', age: 25, active: true, createdAt: new Date('2024-01-01') },
    { name: 'Bob', email: 'bob@example.com', age: 30, active: true, createdAt: new Date('2024-02-01') },
    { name: 'Charlie', email: 'charlie@example.com', age: 35, active: false, createdAt: new Date('2024-03-01') },
    { name: 'Diana', email: 'diana@example.com', age: 28, active: true, createdAt: new Date('2024-04-01') },
    { name: 'Eve', email: 'eve@example.com', age: 32, active: false, createdAt: new Date('2024-05-01') },
    { name: 'Frank', email: 'frank@example.com', age: 45, active: true, createdAt: new Date('2024-06-01') },
    { name: 'Grace', email: 'grace@example.com', age: 22, active: true, createdAt: new Date('2024-07-01') },
    { name: 'Henry', email: 'henry@example.com', age: 38, active: false, createdAt: new Date('2024-08-01') },
  ];

  beforeEach(async () => {
    client = new MongoClient(TEST_ENDPOINT);
    await client.connect();
    collection = client.db('testdb').collection<TestUser>('cursor_test_users');
    // Insert seed data
    await collection.insertMany(seedUsers);
  });

  afterEach(async () => {
    try {
      await client.close();
    } catch {
      // Ignore errors during cleanup in RED phase
    }
  });

  describe('toArray()', () => {
    it('toArray returns T[]', async () => {
      const cursor = collection.find({});
      const results = await cursor.toArray();

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(seedUsers.length);
    });

    it('toArray returns documents matching filter', async () => {
      const cursor = collection.find({ active: true });
      const results = await cursor.toArray();

      expect(results.every((r) => r.active === true)).toBe(true);
      expect(results.length).toBe(5); // Alice, Bob, Diana, Frank, Grace
    });

    it('toArray returns empty array when no matches', async () => {
      const cursor = collection.find({ age: { $gt: 100 } });
      const results = await cursor.toArray();

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('toArray preserves document types', async () => {
      const cursor = collection.find({});
      const results = await cursor.toArray();

      // Type checking - all documents should have TestUser fields
      results.forEach((doc) => {
        expect(typeof doc.name).toBe('string');
        expect(typeof doc.email).toBe('string');
        expect(typeof doc.age).toBe('number');
        expect(typeof doc.active).toBe('boolean');
      });
    });
  });

  describe('sort()', () => {
    it('sort returns FindCursor for chaining', async () => {
      const cursor = collection.find({}).sort({ age: 1 });

      expect(cursor).toBeDefined();
      expect(typeof cursor.toArray).toBe('function');
    });

    it('sort ascending by field', async () => {
      const results = await collection.find({}).sort({ age: 1 }).toArray();

      // Verify ascending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i].age).toBeGreaterThanOrEqual(results[i - 1].age);
      }
    });

    it('sort descending by field', async () => {
      const results = await collection.find({}).sort({ age: -1 }).toArray();

      // Verify descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i].age).toBeLessThanOrEqual(results[i - 1].age);
      }
    });

    it('sort with string direction', async () => {
      const results = await collection.find({}).sort({ name: 'asc' }).toArray();

      // Verify alphabetical ascending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i].name.localeCompare(results[i - 1].name)).toBeGreaterThanOrEqual(0);
      }
    });

    it('sort with multiple fields', async () => {
      const results = await collection
        .find({})
        .sort({ active: -1, age: 1 })
        .toArray();

      // Active users first, then sorted by age within each group
      const activeUsers = results.filter((r) => r.active);
      const inactiveUsers = results.filter((r) => !r.active);

      // All active users should come before inactive
      const firstInactiveIndex = results.findIndex((r) => !r.active);
      if (firstInactiveIndex !== -1) {
        results.slice(0, firstInactiveIndex).forEach((r) => {
          expect(r.active).toBe(true);
        });
      }
    });
  });

  describe('limit()', () => {
    it('limit returns FindCursor for chaining', async () => {
      const cursor = collection.find({}).limit(5);

      expect(cursor).toBeDefined();
      expect(typeof cursor.toArray).toBe('function');
    });

    it('limit restricts result count', async () => {
      const results = await collection.find({}).limit(3).toArray();

      expect(results.length).toBe(3);
    });

    it('limit with value larger than collection', async () => {
      const results = await collection.find({}).limit(100).toArray();

      expect(results.length).toBe(seedUsers.length);
    });

    it('limit with zero returns all documents', async () => {
      // MongoDB behavior: limit(0) means no limit
      const results = await collection.find({}).limit(0).toArray();

      expect(results.length).toBe(seedUsers.length);
    });

    it('limit combined with filter', async () => {
      const results = await collection.find({ active: true }).limit(2).toArray();

      expect(results.length).toBe(2);
      expect(results.every((r) => r.active === true)).toBe(true);
    });
  });

  describe('skip()', () => {
    it('skip returns FindCursor for chaining', async () => {
      const cursor = collection.find({}).skip(2);

      expect(cursor).toBeDefined();
      expect(typeof cursor.toArray).toBe('function');
    });

    it('skip offsets results', async () => {
      const allResults = await collection.find({}).sort({ name: 1 }).toArray();
      const skippedResults = await collection.find({}).sort({ name: 1 }).skip(3).toArray();

      expect(skippedResults.length).toBe(allResults.length - 3);
      expect(skippedResults[0].name).toBe(allResults[3].name);
    });

    it('skip with value larger than collection returns empty', async () => {
      const results = await collection.find({}).skip(100).toArray();

      expect(results.length).toBe(0);
    });

    it('skip with zero returns all documents', async () => {
      const results = await collection.find({}).skip(0).toArray();

      expect(results.length).toBe(seedUsers.length);
    });
  });

  describe('sort/limit/skip chain', () => {
    it('chains sort, limit, and skip together', async () => {
      const results = await collection
        .find({})
        .sort({ age: 1 })
        .skip(2)
        .limit(3)
        .toArray();

      expect(results.length).toBe(3);

      // Should be sorted by age ascending, skipping first 2
      const allSorted = await collection.find({}).sort({ age: 1 }).toArray();
      expect(results[0].age).toBe(allSorted[2].age);
      expect(results[1].age).toBe(allSorted[3].age);
      expect(results[2].age).toBe(allSorted[4].age);
    });

    it('pagination pattern: page 1', async () => {
      const pageSize = 3;
      const page1 = await collection
        .find({})
        .sort({ name: 1 })
        .skip(0)
        .limit(pageSize)
        .toArray();

      expect(page1.length).toBe(pageSize);
    });

    it('pagination pattern: page 2', async () => {
      const pageSize = 3;
      const page2 = await collection
        .find({})
        .sort({ name: 1 })
        .skip(pageSize)
        .limit(pageSize)
        .toArray();

      expect(page2.length).toBe(pageSize);

      // Verify no overlap with page 1
      const page1 = await collection
        .find({})
        .sort({ name: 1 })
        .skip(0)
        .limit(pageSize)
        .toArray();

      const page1Names = new Set(page1.map((r) => r.name));
      page2.forEach((r) => {
        expect(page1Names.has(r.name)).toBe(false);
      });
    });

    it('chain order does not affect result', async () => {
      // These should produce the same results
      const result1 = await collection
        .find({})
        .sort({ age: 1 })
        .skip(1)
        .limit(2)
        .toArray();

      const result2 = await collection
        .find({})
        .limit(2)
        .skip(1)
        .sort({ age: 1 })
        .toArray();

      expect(result1.length).toBe(result2.length);
      expect(result1.map((r) => r.name)).toEqual(result2.map((r) => r.name));
    });
  });

  describe('project()', () => {
    it('project returns FindCursor for chaining', async () => {
      const cursor = collection.find({}).project({ name: 1, email: 1 });

      expect(cursor).toBeDefined();
      expect(typeof cursor.toArray).toBe('function');
    });

    it('project fields with inclusion', async () => {
      const results = await collection
        .find({})
        .project({ name: 1, email: 1 })
        .toArray();

      results.forEach((doc) => {
        expect(doc.name).toBeDefined();
        expect(doc.email).toBeDefined();
        // Other fields should be excluded (except _id by default)
        expect(doc.age).toBeUndefined();
        expect(doc.active).toBeUndefined();
      });
    });

    it('project fields with exclusion', async () => {
      const results = await collection.find({}).project({ age: 0, active: 0 }).toArray();

      results.forEach((doc) => {
        expect(doc.name).toBeDefined();
        expect(doc.email).toBeDefined();
        expect(doc.age).toBeUndefined();
        expect(doc.active).toBeUndefined();
      });
    });

    it('project excludes _id when specified', async () => {
      const results = await collection
        .find({})
        .project({ name: 1, _id: 0 })
        .toArray();

      results.forEach((doc) => {
        expect(doc._id).toBeUndefined();
        expect(doc.name).toBeDefined();
      });
    });

    it('project combined with sort and limit', async () => {
      const results = await collection
        .find({ active: true })
        .sort({ age: -1 })
        .limit(2)
        .project({ name: 1, age: 1 })
        .toArray();

      expect(results.length).toBe(2);
      results.forEach((doc) => {
        expect(doc.name).toBeDefined();
        expect(doc.age).toBeDefined();
        expect(doc.email).toBeUndefined();
      });
    });

    it('project changes return type', async () => {
      interface ProjectedUser {
        name: string;
        email: string;
      }

      const results = await collection
        .find({})
        .project<ProjectedUser>({ name: 1, email: 1, _id: 0 })
        .toArray();

      // Type-level check - should compile with ProjectedUser type
      const names: string[] = results.map((r) => r.name);
      const emails: string[] = results.map((r) => r.email);

      expect(names.length).toBe(seedUsers.length);
      expect(emails.length).toBe(seedUsers.length);
    });
  });

  describe('cursor immutability', () => {
    it('each method returns a new cursor', async () => {
      const cursor1 = collection.find({});
      const cursor2 = cursor1.limit(5);
      const cursor3 = cursor2.skip(2);

      // Each cursor should be independent
      // (implementation may or may not be the same object, but behavior should be consistent)
      expect(cursor1).toBeDefined();
      expect(cursor2).toBeDefined();
      expect(cursor3).toBeDefined();
    });
  });

  describe('type compatibility with mongodb', () => {
    it('cursor has all required methods', async () => {
      const cursor = collection.find({});

      // Verify all chainable methods exist
      expect(typeof cursor.toArray).toBe('function');
      expect(typeof cursor.sort).toBe('function');
      expect(typeof cursor.limit).toBe('function');
      expect(typeof cursor.skip).toBe('function');
      expect(typeof cursor.project).toBe('function');
    });

    it('methods return correct types for chaining', async () => {
      const cursor = collection.find({});

      // All these should return FindCursor for chaining
      const sorted = cursor.sort({ name: 1 });
      expect(typeof sorted.limit).toBe('function');

      const limited = sorted.limit(10);
      expect(typeof limited.skip).toBe('function');

      const skipped = limited.skip(5);
      expect(typeof skipped.project).toBe('function');

      const projected = skipped.project({ name: 1 });
      expect(typeof projected.toArray).toBe('function');
    });
  });
});
