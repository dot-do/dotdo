/**
 * @dotdo/mongo - MongoDB-compatible client for Durable Objects
 *
 * Provides a MongoDB-style API with pluggable storage backends.
 * Default backend is in-memory (Map-based) for testing.
 */

// Main exports
export { MongoClient, Db, ObjectId } from './client'
export type { MongoClientOptions } from './client'
export { Collection, Cursor } from './collection'

// Types
export type {
  Document,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  FindOptions,
  MongoFilter,
  MongoUpdate,
  SortSpec,
  ProjectionSpec,
  UpdateOptions,
} from './types'

// Backends
export type { Backend } from './backends/interface'
export { MemoryBackend } from './backends/memory'
