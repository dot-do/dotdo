/**
 * MongoDB-Compatible Document Store
 *
 * A unified document store that provides MongoDB-compatible API using
 * the unified primitives (QueryEngine, AggPipeline, InvertedIndex, etc.)
 *
 * @example
 * ```typescript
 * import { DocumentStore, Collection } from '@dotdo/mongodb'
 *
 * // Create a document store
 * const store = new DocumentStore()
 * const db = store.db('mydb')
 * const users = db.collection<User>('users')
 *
 * // Insert documents
 * await users.insertOne({ name: 'Alice', age: 30 })
 *
 * // Query with MongoDB operators
 * const adults = await users.find({ age: { $gte: 18 } }).toArray()
 *
 * // Aggregate
 * const stats = await users.aggregate([
 *   { $match: { active: true } },
 *   { $group: { _id: '$city', count: { $sum: 1 } } }
 * ]).toArray()
 * ```
 *
 * @module db/compat/mongodb
 */

import { Collection } from './collection'
import type {
  Document,
  Db as IDb,
  DocumentStoreOptions,
} from './types'

// ============================================================================
// Re-exports
// ============================================================================

// Types
export type {
  // Core types
  Document,
  WithId,
  OptionalId,

  // Filter types
  Filter,
  FilterOperators,
  ComparisonOperators,
  LogicalOperators,
  ElementOperators,
  EvaluationOperators,
  ArrayOperators,
  Condition,

  // Update types
  UpdateFilter,
  UpdateOperators,
  ArrayUpdateOperators,

  // Projection and Sort
  Projection,
  Sort,
  SortDirection,

  // Pipeline types
  PipelineStage,
  MatchStage,
  GroupStage,
  ProjectStage,
  SortStage,
  LimitStage,
  SkipStage,
  UnwindStage,
  LookupStage,
  CountStage,
  AddFieldsStage,
  SetStage,
  FacetStage,
  BucketStage,
  BucketAutoStage,
  ReplaceRootStage,
  ReplaceWithStage,
  SampleStage,
  MergeStage,
  OutStage,
  RedactStage,

  // Index types
  IndexSpecification,
  CreateIndexOptions,
  IndexInfo,

  // Result types
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,

  // Options types
  FindOptions,
  UpdateOptions,
  DeleteOptions,
  InsertOneOptions,
  InsertManyOptions,
  CountDocumentsOptions,
  AggregateOptions,
  FindOneAndUpdateOptions,
  FindOneAndDeleteOptions,
  FindOneAndReplaceOptions,

  // Cursor types
  FindCursor,
  AggregationCursor,

  // Interface types
  Collection as ICollection,
  Db as IDb,
  DocumentStoreOptions,
} from './types'

// Value exports (classes and error constructors)
export { ObjectId, MongoError, MongoDuplicateKeyError } from './types'

// Collection
export { Collection } from './collection'

// Query
export {
  QueryExecutor,
  createQueryExecutor,
  executeQuery,
  compileFilter,
  evaluateFilterDirect,
  type CompiledQuery,
} from './query'

// Aggregation
export {
  AggregationExecutor,
  createAggregationExecutor,
  executeAggregation,
} from './aggregation'

// Indexes
export {
  IndexManager,
  createIndexManager,
  DuplicateKeyError,
} from './indexes'

// ============================================================================
// Database Implementation
// ============================================================================

/**
 * Database implementation
 */
class DbImpl implements IDb {
  readonly databaseName: string
  private _collections: Map<string, Collection> = new Map()

  constructor(name: string) {
    this.databaseName = name
  }

  collection<T extends Document = Document>(name: string): Collection<T> {
    if (!this._collections.has(name)) {
      this._collections.set(name, new Collection(this.databaseName, name))
    }
    return this._collections.get(name) as Collection<T>
  }

  async createCollection<T extends Document = Document>(name: string): Promise<Collection<T>> {
    return this.collection<T>(name)
  }

  listCollections(): { toArray(): Promise<{ name: string; type: string }[]> } {
    const collectionList = Array.from(this._collections.keys()).map((name) => ({
      name,
      type: 'collection' as const,
    }))

    return {
      toArray: async () => collectionList,
    }
  }

  async dropCollection(name: string): Promise<boolean> {
    const collection = this._collections.get(name)
    if (collection) {
      await collection.drop()
      this._collections.delete(name)
      return true
    }
    return false
  }

  async dropDatabase(): Promise<boolean> {
    for (const collection of this._collections.values()) {
      await collection.drop()
    }
    this._collections.clear()
    return true
  }

  async collections(): Promise<Collection[]> {
    return Array.from(this._collections.values())
  }
}

// ============================================================================
// Document Store
// ============================================================================

/**
 * MongoDB-compatible document store using unified primitives
 *
 * This is the main entry point for the document store. It provides a
 * MongoDB-compatible API backed by the unified primitives.
 */
export class DocumentStore {
  private databases: Map<string, DbImpl> = new Map()
  private options: DocumentStoreOptions

  constructor(options?: DocumentStoreOptions) {
    this.options = options ?? {}
  }

  /**
   * Get a database by name
   */
  db(name: string = 'default'): IDb {
    if (!this.databases.has(name)) {
      this.databases.set(name, new DbImpl(name))
    }
    return this.databases.get(name)!
  }

  /**
   * List all databases
   */
  listDatabases(): { name: string }[] {
    return Array.from(this.databases.keys()).map((name) => ({ name }))
  }

  /**
   * Drop a database
   */
  async dropDatabase(name: string): Promise<boolean> {
    const db = this.databases.get(name)
    if (db) {
      await db.dropDatabase()
      this.databases.delete(name)
      return true
    }
    return false
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new document store
 */
export function createDocumentStore(options?: DocumentStoreOptions): DocumentStore {
  return new DocumentStore(options)
}

/**
 * Create a standalone collection (not attached to a database)
 */
export function createCollection<T extends Document = Document>(
  name: string,
  dbName: string = 'default'
): Collection<T> {
  return new Collection<T>(dbName, name)
}

// ============================================================================
// Default Export
// ============================================================================

export default DocumentStore
