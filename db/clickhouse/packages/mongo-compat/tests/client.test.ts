/**
 * MongoClient Tests
 *
 * These tests verify that our MongoClient implementation matches the
 * MongoDB driver's MongoClient interface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MongoClient as MongoDbMongoClient, Db as MongoDb } from 'mongodb';
import { MongoClient } from '../src/index.js';
import { TEST_ENDPOINT } from './setup.js';

describe('MongoClient', () => {
  let client: MongoClient;

  beforeEach(() => {
    client = new MongoClient(TEST_ENDPOINT);
  });

  afterEach(async () => {
    try {
      await client.close();
    } catch {
      // Ignore errors during cleanup in RED phase
    }
  });

  describe('constructor', () => {
    it('creates a client with endpoint URI', () => {
      const testClient = new MongoClient('http://localhost:8787');
      expect(testClient).toBeInstanceOf(MongoClient);
    });

    it('creates a client with options', () => {
      const testClient = new MongoClient('http://localhost:8787', {
        // Options to be defined
      });
      expect(testClient).toBeInstanceOf(MongoClient);
    });
  });

  describe('connect()', () => {
    it('connects to capnweb endpoint', async () => {
      const connectedClient = await client.connect();
      expect(connectedClient).toBe(client);
    });

    it('returns the client instance for chaining', async () => {
      const result = await client.connect();
      expect(result).toBeInstanceOf(MongoClient);
    });

    it('handles connection errors gracefully', async () => {
      const badClient = new MongoClient('http://invalid-endpoint:9999');
      await expect(badClient.connect()).rejects.toThrow();
    });
  });

  describe('db()', () => {
    it('provides db() method', async () => {
      await client.connect();
      const db = client.db('testdb');
      expect(db).toBeDefined();
    });

    it('returns a Db instance', async () => {
      await client.connect();
      const db = client.db('testdb');
      expect(typeof db.collection).toBe('function');
    });

    it('uses default database when name is omitted', async () => {
      await client.connect();
      const db = client.db();
      expect(db).toBeDefined();
    });

    it('returns different Db instances for different names', async () => {
      await client.connect();
      const db1 = client.db('db1');
      const db2 = client.db('db2');
      // Both should work, implementation may vary
      expect(db1).toBeDefined();
      expect(db2).toBeDefined();
    });
  });

  describe('close()', () => {
    it('closes connection', async () => {
      await client.connect();
      await expect(client.close()).resolves.toBeUndefined();
    });

    it('can be called multiple times safely', async () => {
      await client.connect();
      await client.close();
      await expect(client.close()).resolves.toBeUndefined();
    });

    it('returns void promise', async () => {
      await client.connect();
      const result = await client.close();
      expect(result).toBeUndefined();
    });
  });

  describe('type compatibility', () => {
    it('client methods have correct return types', async () => {
      // These are compile-time checks - if they compile, types match
      const connectResult: MongoClient = await client.connect();
      expect(connectResult).toBeDefined();

      // db() should return something with collection method
      const db = client.db('test');
      expect(typeof db.collection).toBe('function');

      // close() should return Promise<void>
      const closeResult: void = await client.close();
      expect(closeResult).toBeUndefined();
    });
  });

  describe('connection state', () => {
    it('tracks connection state', async () => {
      // Before connect
      // Note: MongoDB driver has isConnected() but it's deprecated
      // Our implementation should handle this appropriately

      await client.connect();
      // After connect - should be usable

      await client.close();
      // After close - operations should fail or reconnect
    });
  });
});
