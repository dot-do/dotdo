/**
 * DocumentStore Primitive
 *
 * A unified interface for document databases providing CRUD operations,
 * queries, indexes, aggregations, transactions, and change streams.
 *
 * This primitive serves as the foundation for MongoDB, Firestore, DynamoDB,
 * and other document database compat layers.
 *
 * @module db/primitives/document-store
 *
 * @example
 * ```typescript
 * import { createDocumentStore, type Document } from './document-store'
 *
 * interface User extends Document {
 *   name: string
 *   email: string
 *   age: number
 *   tags: string[]
 * }
 *
 * const users = createDocumentStore<User>({ collection: 'users' })
 *
 * // Insert documents
 * await users.insert({ name: 'Alice', email: 'alice@example.com', age: 30, tags: ['admin'] })
 *
 * // Query with MongoDB-style filters
 * const admins = await users.find({
 *   age: { $gte: 21 },
 *   tags: { $in: ['admin'] }
 * })
 *
 * // Update with operators
 * await users.updateOne(
 *   { email: 'alice@example.com' },
 *   { $inc: { age: 1 }, $push: { tags: 'verified' } }
 * )
 *
 * // Aggregation pipeline
 * const stats = await users.aggregate([
 *   { $match: { age: { $gte: 18 } } },
 *   { $group: { _id: null, avgAge: { $avg: '$age' }, count: { $sum: 1 } } }
 * ])
 *
 * // Transactions
 * await users.transaction(async (session) => {
 *   const user = await session.findOne({ email: 'alice@example.com' })
 *   if (user) {
 *     await session.updateOne({ _id: user._id }, { $set: { verified: true } })
 *   }
 * })
 * ```
 */

// ============================================================================
// Type Exports
// ============================================================================

// Document Core Types
export type {
  DocumentId,
  JsonPrimitive,
  JsonValue,
  Document,
  DocumentInput,
  DocumentMetadata,
} from './types'

// Query Types
export type {
  QueryFilter,
  QueryOperators,
  LogicalOperators,
  BsonType,
} from './types'

// Find Options
export type {
  FindOptions,
  SortSpec,
  SortDirection,
  Projection,
  ProjectionOperator,
  CollationOptions,
  ReadPreference,
} from './types'

// Update Types
export type {
  UpdateOperators,
  ArrayPushOperator,
  ArrayPushModifiers,
  UpdateOptions,
} from './types'

// Result Types
export type {
  InsertResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  ReplaceResult,
  BulkWriteResult,
} from './types'

// Index Types
export type {
  IndexSpec,
  IndexFields,
  IndexDirection,
  IndexType,
  IndexOptions,
  IndexInfo,
} from './types'

// Aggregation Types
export type {
  AggregationStage,
  MatchStage,
  ProjectStage,
  ProjectionExpression,
  GroupStage,
  GroupId,
  AccumulatorExpression,
  CustomAccumulator,
  SortStage,
  LimitStage,
  SkipStage,
  UnwindStage,
  UnwindOptions,
  LookupStage,
  LookupOptions,
  LookupPipelineOptions,
  CountStage,
  AddFieldsStage,
  ReplaceRootStage,
  ReplaceWithStage,
  FacetStage,
  BucketStage,
  BucketAutoStage,
  SortByCountStage,
  GraphLookupStage,
  SampleStage,
  RedactStage,
  OutStage,
  MergeStage,
  MergeOptions,
  SetStage,
  UnsetStage,
  SetWindowFieldsStage,
  WindowOperator,
  TimeUnit,
  WindowBounds,
  WindowBound,
  DensifyStage,
  FillStage,
  AggregationExpression,
  AggregateOptions,
} from './types'

// Query Builder Types
export type {
  QueryBuilder,
  ExplainResult,
  QueryPlan,
  ExecutionStage,
} from './types'

// Batch Operation Types
export type {
  BulkWriteOperation,
  InsertOneOperation,
  UpdateOneOperation,
  UpdateManyOperation,
  ReplaceOneOperation,
  DeleteOneOperation,
  DeleteManyOperation,
  BulkWriteOptions,
} from './types'

// Transaction Types
export type {
  TransactionSession,
  TransactionOptions,
  ReadConcern,
  WriteConcern,
} from './types'

// Change Stream Types
export type {
  ChangeEventType,
  ChangeEvent,
  UpdateDescription,
  ChangeStreamOptions,
  ChangeStream,
} from './types'

// DocumentStore Interface
export type {
  DocumentStore,
  DocumentStoreSession,
} from './types'

// Schema Types
export type {
  DocumentSchema,
  FieldSchema,
  JsonSchemaType,
  SchemaOptions,
  ValidationResult,
  ValidationError,
} from './types'

// Statistics Types
export type {
  CollectionStats,
  CompactResult,
  ValidateResult,
} from './types'

// Factory Options
export type {
  DocumentStoreOptions,
  ConnectionConfig,
  TlsOptions,
  PoolOptions,
  RetentionPolicy,
  Duration,
  CreateDocumentStore,
} from './types'

// ============================================================================
// Re-export from parent document-store.ts for backwards compatibility
// ============================================================================

// The main implementation is in the parent document-store.ts file
// This module provides type definitions for the compat layers
export { createDocumentStore } from '../document-store'
