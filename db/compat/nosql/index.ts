/**
 * @dotdo/db/compat/nosql
 *
 * NoSQL database compatibility SDKs for Durable Objects.
 * Each adapter provides API-compatible implementations backed by DO SQLite storage.
 *
 * Supported databases:
 * - MongoDB (mongo): MongoDB Node.js driver compatible
 * - CouchDB (couchdb): nano-style API compatible
 * - Firebase (firebase): Firestore and Realtime Database compatible
 * - DynamoDB (dynamodb): AWS SDK v3 compatible
 * - Convex (convex): Convex client SDK compatible
 */

// MongoDB
export * as mongo from './mongo/mongo'
export type * from './mongo/types'

// CouchDB
export * as couchdb from './couchdb/couchdb'
export { default as nano, CouchError } from './couchdb/couchdb'

// Firebase
export * as firebase from './firebase/firebase'

// DynamoDB
export * as dynamodb from './dynamodb/dynamodb'
export {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteItemCommand,
  BatchGetItemCommand,
  TransactGetItemsCommand,
  TransactWriteItemsCommand,
  marshall,
  marshallItem,
  unmarshall,
  unmarshallItem,
} from './dynamodb/dynamodb'

// Convex
export * as convex from './convex/convex'
export { ConvexClient } from './convex/convex'
