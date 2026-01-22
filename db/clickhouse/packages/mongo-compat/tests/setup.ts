/**
 * Test Setup for @chdb/mongo-compat
 *
 * This file provides test utilities and type helpers for validating
 * that our implementation satisfies the MongoDB driver interface.
 */

import type {
  MongoClient as MongoDbClient,
  Db as MongoDb,
  Collection as MongoCollection,
  FindCursor as MongoFindCursor,
  Document,
  Filter,
  FindOptions,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  WithId,
  OptionalUnlessRequiredId,
} from 'mongodb';
import { beforeEach } from 'vitest';
import { clearAllStorage } from '../src/index.js';

// Clear storage before each test for isolation
beforeEach(() => {
  clearAllStorage();
});

// Re-export mongodb types for use in tests
export type {
  Document,
  Filter,
  FindOptions,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  WithId,
  OptionalUnlessRequiredId,
};

// Type alias exports for clarity in tests
export type MongoDBMongoClient = MongoDbClient;
export type MongoDBDb = MongoDb;
export type MongoDBCollection<T extends Document = Document> = MongoCollection<T>;
export type MongoDBFindCursor<T extends Document = Document> = MongoFindCursor<T>;

/**
 * Type-level assertion helper
 * Ensures our implementation types are assignable to MongoDB types
 */
export type AssertAssignable<T, U extends T> = U;

/**
 * Test endpoint for capnweb (mock for RED phase)
 */
export const TEST_ENDPOINT = 'http://localhost:8787';

/**
 * Sample document type for testing
 */
export interface TestUser {
  _id?: string;
  name: string;
  email: string;
  age: number;
  active: boolean;
  createdAt: Date;
  tags?: string[];
}

/**
 * Sample product document for testing
 */
export interface TestProduct {
  _id?: string;
  sku: string;
  name: string;
  price: number;
  quantity: number;
  category: string;
}
