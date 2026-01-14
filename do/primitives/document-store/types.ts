/**
 * DocumentStore Primitive Types
 *
 * Core type definitions for the DocumentStore primitive, providing a unified
 * interface for document databases. This serves as the foundation for MongoDB,
 * Firestore, DynamoDB, and other document database compat layers.
 *
 * @module db/primitives/document-store
 */

// ============================================================================
// Document Core Types
// ============================================================================

/**
 * Document ID type - string identifier for documents
 */
export type DocumentId = string

/**
 * JSON-serializable value types
 */
export type JsonPrimitive = string | number | boolean | null

/**
 * JSON value type (recursive)
 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/**
 * Base document interface - all documents have an _id field
 */
export interface Document {
  _id: DocumentId
  [key: string]: unknown
}

/**
 * Document with optional _id for insertion
 */
export type DocumentInput<TDoc extends Document = Document> = Omit<TDoc, '_id'> | TDoc

/**
 * Metadata attached to documents
 */
export interface DocumentMetadata {
  /** Document creation timestamp */
  createdAt?: Date | number
  /** Document last update timestamp */
  updatedAt?: Date | number
  /** Document version for optimistic locking */
  version?: number
  /** TTL expiration timestamp */
  expiresAt?: Date | number
  /** Custom metadata */
  [key: string]: unknown
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * MongoDB-style query filter
 */
export type QueryFilter<TDoc extends Document = Document> = {
  [K in keyof TDoc]?: TDoc[K] | QueryOperators<TDoc[K]>
} & LogicalOperators<TDoc>

/**
 * Comparison operators for field queries
 */
export interface QueryOperators<T = unknown> {
  /** Equals */
  $eq?: T
  /** Not equals */
  $ne?: T
  /** Greater than */
  $gt?: T
  /** Greater than or equal */
  $gte?: T
  /** Less than */
  $lt?: T
  /** Less than or equal */
  $lte?: T
  /** In array */
  $in?: T[]
  /** Not in array */
  $nin?: T[]
  /** Field exists */
  $exists?: boolean
  /** Type check */
  $type?: BsonType
  /** Regular expression (strings only) */
  $regex?: string | RegExp
  /** Regex options (used with $regex) */
  $options?: string
  /** Modulo operation (numbers only) */
  $mod?: [number, number]
  /** Array size */
  $size?: number
  /** All elements match */
  $all?: T extends unknown[] ? T : never
  /** Element matches condition */
  $elemMatch?: T extends unknown[] ? QueryFilter : never
  /** Not operator */
  $not?: QueryOperators<T>
  /** Between range (inclusive) */
  $between?: [T, T]
  /** Starts with (strings only) */
  $startsWith?: string
  /** Ends with (strings only) */
  $endsWith?: string
  /** Contains substring (strings only) */
  $contains?: string
}

/**
 * Logical operators for combining queries
 */
export interface LogicalOperators<TDoc extends Document = Document> {
  /** AND - all conditions must match */
  $and?: QueryFilter<TDoc>[]
  /** OR - at least one condition must match */
  $or?: QueryFilter<TDoc>[]
  /** NOR - none of the conditions must match */
  $nor?: QueryFilter<TDoc>[]
  /** NOT - invert the condition */
  $not?: QueryFilter<TDoc>
}

/**
 * BSON type identifiers
 */
export type BsonType =
  | 'string'
  | 'number'
  | 'int'
  | 'long'
  | 'double'
  | 'decimal'
  | 'bool'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null'
  | 'undefined'
  | 'date'
  | 'timestamp'
  | 'objectId'
  | 'binary'
  | 'regex'

// ============================================================================
// Find Options
// ============================================================================

/**
 * Options for find operations
 */
export interface FindOptions<TDoc extends Document = Document> {
  /** Maximum number of documents to return */
  limit?: number
  /** Number of documents to skip */
  skip?: number
  /** Sort specification */
  sort?: SortSpec<TDoc>
  /** Fields to include/exclude (projection) */
  projection?: Projection<TDoc>
  /** Hint for index usage */
  hint?: string | IndexSpec
  /** Read preference for replica sets */
  readPreference?: ReadPreference
  /** Session for transactions */
  session?: TransactionSession
  /** Maximum time in milliseconds for the query */
  maxTimeMs?: number
  /** Batch size for cursor */
  batchSize?: number
  /** Allow disk use for large sorts */
  allowDiskUse?: boolean
  /** Collation options for string comparison */
  collation?: CollationOptions
}

/**
 * Sort specification - field to direction mapping
 */
export type SortSpec<TDoc extends Document = Document> = {
  [K in keyof TDoc]?: SortDirection
} & { [key: string]: SortDirection }

/**
 * Sort direction
 */
export type SortDirection = 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending'

/**
 * Projection specification for field selection
 */
export type Projection<TDoc extends Document = Document> = {
  [K in keyof TDoc]?: 0 | 1 | boolean | ProjectionOperator
} & { [key: string]: 0 | 1 | boolean | ProjectionOperator }

/**
 * Projection operators for computed fields
 */
export interface ProjectionOperator {
  /** Slice array */
  $slice?: number | [number, number]
  /** Element match for arrays */
  $elemMatch?: QueryFilter
  /** Metadata projection */
  $meta?: 'textScore' | 'indexKey'
}

/**
 * Collation options for string comparison
 */
export interface CollationOptions {
  locale: string
  caseLevel?: boolean
  caseFirst?: 'upper' | 'lower' | 'off'
  strength?: 1 | 2 | 3 | 4 | 5
  numericOrdering?: boolean
  alternate?: 'non-ignorable' | 'shifted'
  maxVariable?: 'punct' | 'space'
  backwards?: boolean
}

/**
 * Read preference for replica set queries
 */
export type ReadPreference =
  | 'primary'
  | 'primaryPreferred'
  | 'secondary'
  | 'secondaryPreferred'
  | 'nearest'

// ============================================================================
// Update Types
// ============================================================================

/**
 * Update operators for modifying documents
 */
export interface UpdateOperators<TDoc extends Document = Document> {
  /** Set field values */
  $set?: Partial<TDoc> & { [key: string]: unknown }
  /** Unset (remove) fields */
  $unset?: { [K in keyof TDoc]?: 1 | '' | true } & { [key: string]: 1 | '' | true }
  /** Increment numeric fields */
  $inc?: { [K in keyof TDoc]?: number } & { [key: string]: number }
  /** Multiply numeric fields */
  $mul?: { [K in keyof TDoc]?: number } & { [key: string]: number }
  /** Rename fields */
  $rename?: { [key: string]: string }
  /** Set field only if inserting (upsert) */
  $setOnInsert?: Partial<TDoc> & { [key: string]: unknown }
  /** Set to minimum value */
  $min?: Partial<TDoc> & { [key: string]: unknown }
  /** Set to maximum value */
  $max?: Partial<TDoc> & { [key: string]: unknown }
  /** Set current date */
  $currentDate?: {
    [K in keyof TDoc]?: boolean | { $type: 'date' | 'timestamp' }
  } & { [key: string]: boolean | { $type: 'date' | 'timestamp' } }
  /** Push to array */
  $push?: ArrayPushOperator<TDoc>
  /** Pull from array */
  $pull?: { [key: string]: unknown | QueryFilter }
  /** Add to set (unique push) */
  $addToSet?: ArrayPushOperator<TDoc>
  /** Pop from array (-1 = first, 1 = last) */
  $pop?: { [key: string]: -1 | 1 }
  /** Pull all matching values from array */
  $pullAll?: { [key: string]: unknown[] }
  /** Bitwise operations */
  $bit?: { [key: string]: { and?: number; or?: number; xor?: number } }
}

/**
 * Array push operator with modifiers
 */
export type ArrayPushOperator<TDoc extends Document = Document> = {
  [K in keyof TDoc]?: TDoc[K] extends unknown[] ? TDoc[K][number] | ArrayPushModifiers<TDoc[K][number]> : never
} & { [key: string]: unknown | ArrayPushModifiers }

/**
 * Modifiers for $push operator
 */
export interface ArrayPushModifiers<T = unknown> {
  /** Values to push */
  $each: T[]
  /** Sort after push */
  $sort?: SortSpec | SortDirection
  /** Slice array after push */
  $slice?: number
  /** Position to insert */
  $position?: number
}

/**
 * Update options
 */
export interface UpdateOptions {
  /** Insert if not found */
  upsert?: boolean
  /** Return document before or after update */
  returnDocument?: 'before' | 'after'
  /** Bypass document validation */
  bypassDocumentValidation?: boolean
  /** Session for transactions */
  session?: TransactionSession
  /** Array filters for positional updates */
  arrayFilters?: QueryFilter[]
  /** Hint for index usage */
  hint?: string | IndexSpec
  /** Collation options */
  collation?: CollationOptions
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result from insert operation
 */
export interface InsertResult {
  /** ID of inserted document */
  insertedId: DocumentId
  /** Whether operation was acknowledged */
  acknowledged: boolean
}

/**
 * Result from insertMany operation
 */
export interface InsertManyResult {
  /** IDs of inserted documents in order */
  insertedIds: DocumentId[]
  /** Number of documents inserted */
  insertedCount: number
  /** Whether operation was acknowledged */
  acknowledged: boolean
}

/**
 * Result from update operation
 */
export interface UpdateResult {
  /** Number of documents matched by filter */
  matchedCount: number
  /** Number of documents actually modified */
  modifiedCount: number
  /** ID of upserted document (if any) */
  upsertedId?: DocumentId
  /** Number of documents upserted */
  upsertedCount: number
  /** Whether operation was acknowledged */
  acknowledged: boolean
}

/**
 * Result from delete operation
 */
export interface DeleteResult {
  /** Number of documents deleted */
  deletedCount: number
  /** Whether operation was acknowledged */
  acknowledged: boolean
}

/**
 * Result from replace operation
 */
export interface ReplaceResult {
  /** Number of documents matched */
  matchedCount: number
  /** Number of documents modified */
  modifiedCount: number
  /** ID of upserted document (if any) */
  upsertedId?: DocumentId
  /** Whether operation was acknowledged */
  acknowledged: boolean
}

/**
 * Result from bulk write operation
 */
export interface BulkWriteResult {
  /** Number of documents inserted */
  insertedCount: number
  /** Number of documents matched for update */
  matchedCount: number
  /** Number of documents modified */
  modifiedCount: number
  /** Number of documents deleted */
  deletedCount: number
  /** Number of documents upserted */
  upsertedCount: number
  /** IDs of upserted documents */
  upsertedIds: { [index: number]: DocumentId }
  /** IDs of inserted documents */
  insertedIds: { [index: number]: DocumentId }
  /** Whether operation was acknowledged */
  acknowledged: boolean
}

// ============================================================================
// Index Types
// ============================================================================

/**
 * Index specification
 */
export interface IndexSpec {
  /** Fields to index with direction */
  fields: IndexFields
  /** Index options */
  options?: IndexOptions
}

/**
 * Index field specification
 */
export type IndexFields = {
  [field: string]: IndexDirection | IndexType
}

/**
 * Index direction or type
 */
export type IndexDirection = 1 | -1
export type IndexType = '2d' | '2dsphere' | 'text' | 'hashed' | 'geohaystack'

/**
 * Index creation options
 */
export interface IndexOptions {
  /** Index name (auto-generated if not provided) */
  name?: string
  /** Whether values must be unique */
  unique?: boolean
  /** Only index documents where indexed field exists */
  sparse?: boolean
  /** Expire documents after TTL seconds */
  expireAfterSeconds?: number
  /** Background index creation */
  background?: boolean
  /** Partial filter expression */
  partialFilterExpression?: QueryFilter
  /** Text index language */
  default_language?: string
  /** Text index language override field */
  language_override?: string
  /** Text index weights */
  weights?: { [field: string]: number }
  /** Index version */
  version?: number
  /** Collation options */
  collation?: CollationOptions
  /** Hidden index (query planner ignores) */
  hidden?: boolean
  /** Wildcard projection */
  wildcardProjection?: Projection
}

/**
 * Index information returned by listIndexes
 */
export interface IndexInfo {
  /** Index name */
  name: string
  /** Index key specification */
  key: IndexFields
  /** Index version */
  v?: number
  /** Unique constraint */
  unique?: boolean
  /** Sparse index */
  sparse?: boolean
  /** Partial filter expression */
  partialFilterExpression?: QueryFilter
  /** Expire after seconds for TTL indexes */
  expireAfterSeconds?: number
  /** Background build status */
  background?: boolean
  /** Text index weights */
  weights?: { [field: string]: number }
  /** Default language for text indexes */
  default_language?: string
  /** Collation options */
  collation?: CollationOptions
  /** Whether index is hidden */
  hidden?: boolean
  /** Index size in bytes */
  size?: number
}

// ============================================================================
// Aggregation Pipeline Types
// ============================================================================

/**
 * Aggregation pipeline stage
 */
export type AggregationStage =
  | MatchStage
  | ProjectStage
  | GroupStage
  | SortStage
  | LimitStage
  | SkipStage
  | UnwindStage
  | LookupStage
  | CountStage
  | AddFieldsStage
  | ReplaceRootStage
  | FacetStage
  | BucketStage
  | BucketAutoStage
  | SortByCountStage
  | GraphLookupStage
  | SampleStage
  | RedactStage
  | OutStage
  | MergeStage
  | SetStage
  | UnsetStage
  | ReplaceWithStage
  | SetWindowFieldsStage
  | DensifyStage
  | FillStage

/** Match stage - filter documents */
export interface MatchStage {
  $match: QueryFilter
}

/** Project stage - reshape documents */
export interface ProjectStage {
  $project: Projection | { [field: string]: ProjectionExpression }
}

/** Projection expression for computed fields */
export type ProjectionExpression =
  | 0
  | 1
  | boolean
  | string
  | AggregationExpression
  | { [key: string]: ProjectionExpression }

/** Group stage - aggregate by key */
export interface GroupStage {
  $group: GroupSpec
}

/** Group specification */
export interface GroupSpec {
  _id: GroupId
  [field: string]: GroupId | AccumulatorExpression
}

/** Group ID specification */
export type GroupId = null | string | { [field: string]: string | AggregationExpression }

/** Accumulator expressions for $group */
export interface AccumulatorExpression {
  $sum?: AggregationExpression | number
  $avg?: AggregationExpression
  $min?: AggregationExpression
  $max?: AggregationExpression
  $first?: AggregationExpression
  $last?: AggregationExpression
  $push?: AggregationExpression
  $addToSet?: AggregationExpression
  $count?: Record<string, never>
  $stdDevPop?: AggregationExpression
  $stdDevSamp?: AggregationExpression
  $mergeObjects?: AggregationExpression
  $accumulator?: CustomAccumulator
}

/** Custom accumulator definition */
export interface CustomAccumulator {
  init: string | ((...args: unknown[]) => unknown)
  initArgs?: unknown[]
  accumulate: string | ((state: unknown, ...args: unknown[]) => unknown)
  accumulateArgs?: string[]
  merge: string | ((state1: unknown, state2: unknown) => unknown)
  finalize?: string | ((state: unknown) => unknown)
  lang: 'js'
}

/** Sort stage */
export interface SortStage {
  $sort: SortSpec
}

/** Limit stage */
export interface LimitStage {
  $limit: number
}

/** Skip stage */
export interface SkipStage {
  $skip: number
}

/** Unwind stage - deconstruct arrays */
export interface UnwindStage {
  $unwind: string | UnwindOptions
}

export interface UnwindOptions {
  path: string
  includeArrayIndex?: string
  preserveNullAndEmptyArrays?: boolean
}

/** Lookup stage - join with another collection */
export interface LookupStage {
  $lookup: LookupOptions | LookupPipelineOptions
}

export interface LookupOptions {
  from: string
  localField: string
  foreignField: string
  as: string
}

export interface LookupPipelineOptions {
  from: string
  let?: { [variable: string]: AggregationExpression }
  pipeline: AggregationStage[]
  as: string
}

/** Count stage */
export interface CountStage {
  $count: string
}

/** AddFields stage */
export interface AddFieldsStage {
  $addFields: { [field: string]: AggregationExpression }
}

/** ReplaceRoot stage */
export interface ReplaceRootStage {
  $replaceRoot: { newRoot: AggregationExpression }
}

/** ReplaceWith stage (alias for $replaceRoot) */
export interface ReplaceWithStage {
  $replaceWith: AggregationExpression
}

/** Facet stage - multiple pipelines */
export interface FacetStage {
  $facet: { [outputField: string]: AggregationStage[] }
}

/** Bucket stage - categorize by boundaries */
export interface BucketStage {
  $bucket: {
    groupBy: AggregationExpression
    boundaries: unknown[]
    default?: unknown
    output?: { [field: string]: AccumulatorExpression }
  }
}

/** BucketAuto stage - auto boundaries */
export interface BucketAutoStage {
  $bucketAuto: {
    groupBy: AggregationExpression
    buckets: number
    output?: { [field: string]: AccumulatorExpression }
    granularity?: 'R5' | 'R10' | 'R20' | 'R40' | 'R80' | '1-2-5' | 'E6' | 'E12' | 'E24' | 'E48' | 'E96' | 'E192' | 'POWERSOF2'
  }
}

/** SortByCount stage */
export interface SortByCountStage {
  $sortByCount: AggregationExpression
}

/** GraphLookup stage - recursive lookup */
export interface GraphLookupStage {
  $graphLookup: {
    from: string
    startWith: AggregationExpression
    connectFromField: string
    connectToField: string
    as: string
    maxDepth?: number
    depthField?: string
    restrictSearchWithMatch?: QueryFilter
  }
}

/** Sample stage - random sample */
export interface SampleStage {
  $sample: { size: number }
}

/** Redact stage - field-level access control */
export interface RedactStage {
  $redact: AggregationExpression
}

/** Out stage - write to collection */
export interface OutStage {
  $out: string | { db: string; coll: string }
}

/** Merge stage - merge into collection */
export interface MergeStage {
  $merge: string | MergeOptions
}

export interface MergeOptions {
  into: string | { db: string; coll: string }
  on?: string | string[]
  let?: { [variable: string]: AggregationExpression }
  whenMatched?: 'replace' | 'keepExisting' | 'merge' | 'fail' | AggregationStage[]
  whenNotMatched?: 'insert' | 'discard' | 'fail'
}

/** Set stage (alias for $addFields) */
export interface SetStage {
  $set: { [field: string]: AggregationExpression }
}

/** Unset stage - remove fields */
export interface UnsetStage {
  $unset: string | string[]
}

/** SetWindowFields stage - window functions */
export interface SetWindowFieldsStage {
  $setWindowFields: {
    partitionBy?: AggregationExpression
    sortBy?: SortSpec
    output: {
      [field: string]: WindowOperator
    }
  }
}

export interface WindowOperator {
  $sum?: AggregationExpression
  $avg?: AggregationExpression
  $min?: AggregationExpression
  $max?: AggregationExpression
  $count?: Record<string, never>
  $stdDevPop?: AggregationExpression
  $stdDevSamp?: AggregationExpression
  $first?: AggregationExpression
  $last?: AggregationExpression
  $push?: AggregationExpression
  $addToSet?: AggregationExpression
  $rank?: Record<string, never>
  $denseRank?: Record<string, never>
  $documentNumber?: Record<string, never>
  $shift?: { output: AggregationExpression; by: number; default?: AggregationExpression }
  $derivative?: { input: AggregationExpression; unit?: TimeUnit }
  $integral?: { input: AggregationExpression; unit?: TimeUnit }
  $covariancePop?: [AggregationExpression, AggregationExpression]
  $covarianceSamp?: [AggregationExpression, AggregationExpression]
  $expMovingAvg?: { input: AggregationExpression; N?: number; alpha?: number }
  $linearFill?: AggregationExpression
  $locf?: AggregationExpression
  window?: WindowBounds
}

export type TimeUnit = 'week' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond'

export interface WindowBounds {
  documents?: [WindowBound, WindowBound]
  range?: [WindowBound, WindowBound]
  unit?: TimeUnit
}

export type WindowBound = 'unbounded' | 'current' | number

/** Densify stage - fill gaps in time series */
export interface DensifyStage {
  $densify: {
    field: string
    partitionByFields?: string[]
    range: {
      step: number
      unit?: TimeUnit
      bounds: 'full' | 'partition' | [unknown, unknown]
    }
  }
}

/** Fill stage - fill missing values */
export interface FillStage {
  $fill: {
    partitionBy?: AggregationExpression
    partitionByFields?: string[]
    sortBy?: SortSpec
    output: {
      [field: string]: { value: AggregationExpression } | { method: 'linear' | 'locf' }
    }
  }
}

/**
 * Aggregation expression types
 */
export type AggregationExpression =
  | string // Field path like "$fieldName"
  | number
  | boolean
  | null
  | AggregationExpression[]
  | { [key: string]: AggregationExpression | unknown }

/**
 * Aggregation options
 */
export interface AggregateOptions {
  /** Explain query plan instead of executing */
  explain?: boolean | 'queryPlanner' | 'executionStats' | 'allPlansExecution'
  /** Allow disk use for large aggregations */
  allowDiskUse?: boolean
  /** Maximum time in milliseconds */
  maxTimeMs?: number
  /** Batch size for cursor */
  batchSize?: number
  /** Read preference */
  readPreference?: ReadPreference
  /** Session for transactions */
  session?: TransactionSession
  /** Collation options */
  collation?: CollationOptions
  /** Hint for index usage */
  hint?: string | IndexSpec
  /** Comment for profiler */
  comment?: string
  /** Write concern for $out/$merge */
  writeConcern?: WriteConcern
  /** Let variables accessible in pipeline */
  let?: { [variable: string]: unknown }
}

// ============================================================================
// Query Builder Types
// ============================================================================

/**
 * Fluent query builder interface
 */
export interface QueryBuilder<TDoc extends Document = Document> {
  /** Set filter conditions */
  where(filter: QueryFilter<TDoc>): QueryBuilder<TDoc>
  /** Add AND condition */
  and(filter: QueryFilter<TDoc>): QueryBuilder<TDoc>
  /** Add OR condition */
  or(filter: QueryFilter<TDoc>): QueryBuilder<TDoc>
  /** Set sort order */
  sort(spec: SortSpec<TDoc>): QueryBuilder<TDoc>
  /** Set field projection */
  select(projection: Projection<TDoc>): QueryBuilder<TDoc>
  /** Set limit */
  limit(n: number): QueryBuilder<TDoc>
  /** Set skip */
  skip(n: number): QueryBuilder<TDoc>
  /** Set index hint */
  hint(hint: string | IndexSpec): QueryBuilder<TDoc>
  /** Execute and return all results */
  exec(): Promise<TDoc[]>
  /** Execute and return first result */
  first(): Promise<TDoc | null>
  /** Execute and return count */
  count(): Promise<number>
  /** Execute and return cursor */
  cursor(): AsyncIterable<TDoc>
  /** Get explain plan */
  explain(): Promise<ExplainResult>
}

/**
 * Query explain result
 */
export interface ExplainResult {
  queryPlanner: {
    namespace: string
    indexFilterSet: boolean
    parsedQuery: QueryFilter
    winningPlan: QueryPlan
    rejectedPlans: QueryPlan[]
  }
  executionStats?: {
    executionSuccess: boolean
    nReturned: number
    executionTimeMillis: number
    totalKeysExamined: number
    totalDocsExamined: number
    executionStages: ExecutionStage
  }
}

export interface QueryPlan {
  stage: string
  inputStage?: QueryPlan
  inputStages?: QueryPlan[]
  indexName?: string
  keyPattern?: IndexFields
  direction?: 'forward' | 'backward'
  filter?: QueryFilter
}

export interface ExecutionStage {
  stage: string
  nReturned: number
  executionTimeMillisEstimate: number
  works: number
  inputStage?: ExecutionStage
  inputStages?: ExecutionStage[]
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Bulk write operation types
 */
export type BulkWriteOperation<TDoc extends Document = Document> =
  | InsertOneOperation<TDoc>
  | UpdateOneOperation<TDoc>
  | UpdateManyOperation<TDoc>
  | ReplaceOneOperation<TDoc>
  | DeleteOneOperation<TDoc>
  | DeleteManyOperation<TDoc>

export interface InsertOneOperation<TDoc extends Document = Document> {
  insertOne: { document: DocumentInput<TDoc> }
}

export interface UpdateOneOperation<TDoc extends Document = Document> {
  updateOne: {
    filter: QueryFilter<TDoc>
    update: UpdateOperators<TDoc>
    upsert?: boolean
    arrayFilters?: QueryFilter[]
    hint?: string | IndexSpec
    collation?: CollationOptions
  }
}

export interface UpdateManyOperation<TDoc extends Document = Document> {
  updateMany: {
    filter: QueryFilter<TDoc>
    update: UpdateOperators<TDoc>
    upsert?: boolean
    arrayFilters?: QueryFilter[]
    hint?: string | IndexSpec
    collation?: CollationOptions
  }
}

export interface ReplaceOneOperation<TDoc extends Document = Document> {
  replaceOne: {
    filter: QueryFilter<TDoc>
    replacement: TDoc
    upsert?: boolean
    hint?: string | IndexSpec
    collation?: CollationOptions
  }
}

export interface DeleteOneOperation<TDoc extends Document = Document> {
  deleteOne: {
    filter: QueryFilter<TDoc>
    hint?: string | IndexSpec
    collation?: CollationOptions
  }
}

export interface DeleteManyOperation<TDoc extends Document = Document> {
  deleteMany: {
    filter: QueryFilter<TDoc>
    hint?: string | IndexSpec
    collation?: CollationOptions
  }
}

/**
 * Bulk write options
 */
export interface BulkWriteOptions {
  /** Whether to continue on error */
  ordered?: boolean
  /** Bypass document validation */
  bypassDocumentValidation?: boolean
  /** Session for transactions */
  session?: TransactionSession
  /** Write concern */
  writeConcern?: WriteConcern
  /** Comment for profiler */
  comment?: string
}

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * Transaction session interface
 */
export interface TransactionSession {
  /** Session ID */
  id: string
  /** Whether session has active transaction */
  inTransaction: boolean
  /** Start a transaction */
  startTransaction(options?: TransactionOptions): void
  /** Commit the current transaction */
  commitTransaction(): Promise<void>
  /** Abort the current transaction */
  abortTransaction(): Promise<void>
  /** End the session */
  endSession(): Promise<void>
  /** Run callback in transaction with automatic retry */
  withTransaction<T>(
    fn: (session: TransactionSession) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>
}

/**
 * Transaction options
 */
export interface TransactionOptions {
  /** Read concern level */
  readConcern?: ReadConcern
  /** Write concern */
  writeConcern?: WriteConcern
  /** Read preference */
  readPreference?: ReadPreference
  /** Maximum commit time in milliseconds */
  maxCommitTimeMs?: number
}

/**
 * Read concern levels
 */
export interface ReadConcern {
  level: 'local' | 'available' | 'majority' | 'linearizable' | 'snapshot'
}

/**
 * Write concern configuration
 */
export interface WriteConcern {
  /** Number of replicas or 'majority' */
  w?: number | 'majority'
  /** Journal acknowledgment */
  j?: boolean
  /** Timeout in milliseconds */
  wtimeout?: number
}

// ============================================================================
// Change Stream Types
// ============================================================================

/**
 * Change stream event types
 */
export type ChangeEventType =
  | 'insert'
  | 'update'
  | 'replace'
  | 'delete'
  | 'invalidate'
  | 'drop'
  | 'dropDatabase'
  | 'rename'

/**
 * Change stream event
 */
export interface ChangeEvent<TDoc extends Document = Document> {
  /** Event ID for resuming */
  _id: { _data: string }
  /** Type of change */
  operationType: ChangeEventType
  /** Full namespace */
  ns: { db: string; coll: string }
  /** Document key */
  documentKey: { _id: DocumentId }
  /** Full document (for insert, replace, or with fullDocument option) */
  fullDocument?: TDoc
  /** Full document before change (with fullDocumentBeforeChange option) */
  fullDocumentBeforeChange?: TDoc
  /** Update description (for update events) */
  updateDescription?: UpdateDescription
  /** Cluster time of the event */
  clusterTime: { $timestamp: { t: number; i: number } }
  /** Wall clock time */
  wallTime?: Date
}

/**
 * Update description for change events
 */
export interface UpdateDescription {
  /** Fields that were updated */
  updatedFields: { [field: string]: unknown }
  /** Fields that were removed */
  removedFields: string[]
  /** Truncated arrays */
  truncatedArrays?: Array<{ field: string; newSize: number }>
}

/**
 * Change stream options
 */
export interface ChangeStreamOptions {
  /** Resume after this token */
  resumeAfter?: { _data: string }
  /** Start at this operation time */
  startAtOperationTime?: { $timestamp: { t: number; i: number } }
  /** Start after this token */
  startAfter?: { _data: string }
  /** Include full document on update */
  fullDocument?: 'default' | 'updateLookup' | 'whenAvailable' | 'required'
  /** Include full document before change */
  fullDocumentBeforeChange?: 'off' | 'whenAvailable' | 'required'
  /** Maximum await time in milliseconds */
  maxAwaitTimeMs?: number
  /** Batch size */
  batchSize?: number
  /** Collation options */
  collation?: CollationOptions
  /** Read preference */
  readPreference?: ReadPreference
}

/**
 * Change stream interface
 */
export interface ChangeStream<TDoc extends Document = Document>
  extends AsyncIterable<ChangeEvent<TDoc>> {
  /** Close the change stream */
  close(): Promise<void>
  /** Get current resume token */
  resumeToken: { _data: string } | null
  /** Whether stream is closed */
  closed: boolean
  /** Pause the stream */
  pause(): void
  /** Resume the stream */
  resume(): void
}

// ============================================================================
// DocumentStore Interface
// ============================================================================

/**
 * Core DocumentStore interface
 *
 * Provides a unified interface for document database operations including
 * CRUD, queries, indexes, aggregations, transactions, and change streams.
 */
export interface DocumentStore<TDoc extends Document = Document> {
  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Insert a single document
   */
  insert(doc: DocumentInput<TDoc>): Promise<InsertResult>

  /**
   * Insert multiple documents
   */
  insertMany(docs: DocumentInput<TDoc>[]): Promise<InsertManyResult>

  /**
   * Get a document by ID
   */
  get(id: DocumentId): Promise<TDoc | null>

  /**
   * Get document as it existed at a specific timestamp (time travel)
   */
  getAsOf?(id: DocumentId, timestamp: number | Date): Promise<TDoc | null>

  /**
   * Find documents matching a filter
   */
  find(filter: QueryFilter<TDoc>, options?: FindOptions<TDoc>): Promise<TDoc[]>

  /**
   * Find a single document matching a filter
   */
  findOne(filter: QueryFilter<TDoc>, options?: FindOptions<TDoc>): Promise<TDoc | null>

  /**
   * Update documents matching a filter
   */
  update(
    filter: QueryFilter<TDoc>,
    update: UpdateOperators<TDoc>,
    options?: UpdateOptions
  ): Promise<UpdateResult>

  /**
   * Update a single document matching a filter
   */
  updateOne(
    filter: QueryFilter<TDoc>,
    update: UpdateOperators<TDoc>,
    options?: UpdateOptions
  ): Promise<UpdateResult>

  /**
   * Replace a document
   */
  replaceOne?(
    filter: QueryFilter<TDoc>,
    replacement: TDoc,
    options?: UpdateOptions
  ): Promise<ReplaceResult>

  /**
   * Delete documents matching a filter
   */
  delete(filter: QueryFilter<TDoc>): Promise<DeleteResult>

  /**
   * Delete a single document matching a filter
   */
  deleteOne(filter: QueryFilter<TDoc>): Promise<DeleteResult>

  /**
   * Find and modify a document atomically
   */
  findOneAndUpdate?(
    filter: QueryFilter<TDoc>,
    update: UpdateOperators<TDoc>,
    options?: UpdateOptions & { returnDocument?: 'before' | 'after' }
  ): Promise<TDoc | null>

  /**
   * Find and delete a document atomically
   */
  findOneAndDelete?(
    filter: QueryFilter<TDoc>,
    options?: FindOptions<TDoc>
  ): Promise<TDoc | null>

  /**
   * Find and replace a document atomically
   */
  findOneAndReplace?(
    filter: QueryFilter<TDoc>,
    replacement: TDoc,
    options?: UpdateOptions & { returnDocument?: 'before' | 'after' }
  ): Promise<TDoc | null>

  // ===========================================================================
  // Index Operations
  // ===========================================================================

  /**
   * Create an index
   */
  createIndex(spec: IndexSpec): Promise<string>

  /**
   * Create multiple indexes
   */
  createIndexes?(specs: IndexSpec[]): Promise<string[]>

  /**
   * Drop an index by name
   */
  dropIndex(name: string): Promise<void>

  /**
   * Drop all indexes except _id
   */
  dropIndexes?(): Promise<void>

  /**
   * List all indexes
   */
  listIndexes(): Promise<IndexInfo[]>

  /**
   * Check if an index exists
   */
  indexExists?(name: string): Promise<boolean>

  /**
   * Reindex the collection
   */
  reIndex?(): Promise<void>

  // ===========================================================================
  // Aggregation
  // ===========================================================================

  /**
   * Execute an aggregation pipeline
   */
  aggregate(pipeline: AggregationStage[], options?: AggregateOptions): Promise<unknown[]>

  /**
   * Execute an aggregation pipeline with cursor
   */
  aggregateCursor?(
    pipeline: AggregationStage[],
    options?: AggregateOptions
  ): AsyncIterable<unknown>

  // ===========================================================================
  // Query Builder
  // ===========================================================================

  /**
   * Get a fluent query builder
   */
  query?(): QueryBuilder<TDoc>

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  /**
   * Execute bulk write operations
   */
  bulkWrite?(
    operations: BulkWriteOperation<TDoc>[],
    options?: BulkWriteOptions
  ): Promise<BulkWriteResult>

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  /**
   * Start a new session
   */
  startSession?(): Promise<TransactionSession>

  /**
   * Execute operations in a transaction
   */
  transaction<T>(
    fn: (session: DocumentStoreSession<TDoc>) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>

  // ===========================================================================
  // Change Streams
  // ===========================================================================

  /**
   * Watch for changes to the collection
   */
  watch?(
    pipeline?: AggregationStage[],
    options?: ChangeStreamOptions
  ): ChangeStream<TDoc>

  // ===========================================================================
  // Collection Management
  // ===========================================================================

  /**
   * Count documents matching a filter
   */
  count(filter?: QueryFilter<TDoc>): Promise<number>

  /**
   * Estimate document count (fast, may be approximate)
   */
  estimatedDocumentCount?(): Promise<number>

  /**
   * Get distinct values for a field
   */
  distinct(field: string, filter?: QueryFilter<TDoc>): Promise<unknown[]>

  /**
   * Drop all documents and indexes
   */
  drop(): Promise<void>

  /**
   * Rename the collection
   */
  rename?(newName: string, options?: { dropTarget?: boolean }): Promise<void>

  /**
   * Get collection stats
   */
  stats?(): Promise<CollectionStats>

  // ===========================================================================
  // Schema Operations
  // ===========================================================================

  /**
   * Get the inferred or defined schema
   */
  getSchema?(): DocumentSchema

  /**
   * Set validation schema
   */
  setSchema?(schema: DocumentSchema, options?: SchemaOptions): Promise<void>

  /**
   * Validate a document against the schema
   */
  validateDocument?(doc: unknown): ValidationResult

  // ===========================================================================
  // Maintenance
  // ===========================================================================

  /**
   * Compact the collection (reclaim disk space)
   */
  compact?(): Promise<CompactResult>

  /**
   * Validate the collection
   */
  validate?(): Promise<ValidateResult>
}

/**
 * Session interface for transactions
 */
export interface DocumentStoreSession<TDoc extends Document = Document> {
  insert(doc: DocumentInput<TDoc>): Promise<InsertResult>
  insertMany(docs: DocumentInput<TDoc>[]): Promise<InsertManyResult>
  get(id: DocumentId): Promise<TDoc | null>
  find(filter: QueryFilter<TDoc>, options?: FindOptions<TDoc>): Promise<TDoc[]>
  findOne(filter: QueryFilter<TDoc>, options?: FindOptions<TDoc>): Promise<TDoc | null>
  update(
    filter: QueryFilter<TDoc>,
    update: UpdateOperators<TDoc>,
    options?: UpdateOptions
  ): Promise<UpdateResult>
  updateOne(
    filter: QueryFilter<TDoc>,
    update: UpdateOperators<TDoc>,
    options?: UpdateOptions
  ): Promise<UpdateResult>
  delete(filter: QueryFilter<TDoc>): Promise<DeleteResult>
  deleteOne(filter: QueryFilter<TDoc>): Promise<DeleteResult>
}

// ============================================================================
// Schema Types
// ============================================================================

/**
 * Document schema definition
 */
export interface DocumentSchema {
  /** Schema type (always 'object' for documents) */
  type: 'object'
  /** Schema title */
  title?: string
  /** Schema description */
  description?: string
  /** Field definitions */
  properties?: { [field: string]: FieldSchema }
  /** Required field names */
  required?: string[]
  /** Allow additional properties */
  additionalProperties?: boolean | FieldSchema
  /** Minimum number of properties */
  minProperties?: number
  /** Maximum number of properties */
  maxProperties?: number
  /** Pattern properties */
  patternProperties?: { [pattern: string]: FieldSchema }
}

/**
 * Field schema definition (JSON Schema compatible)
 */
export interface FieldSchema {
  type?: JsonSchemaType | JsonSchemaType[]
  enum?: unknown[]
  const?: unknown
  description?: string
  default?: unknown
  // String validations
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  // Number validations
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number
  // Array validations
  items?: FieldSchema | FieldSchema[]
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  contains?: FieldSchema
  // Object validations
  properties?: { [field: string]: FieldSchema }
  required?: string[]
  additionalProperties?: boolean | FieldSchema
  // Conditional
  if?: FieldSchema
  then?: FieldSchema
  else?: FieldSchema
  // Composition
  allOf?: FieldSchema[]
  anyOf?: FieldSchema[]
  oneOf?: FieldSchema[]
  not?: FieldSchema
}

export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null'

/**
 * Schema validation options
 */
export interface SchemaOptions {
  /** Validation action */
  validationAction?: 'error' | 'warn'
  /** Validation level */
  validationLevel?: 'off' | 'strict' | 'moderate'
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/**
 * Validation error
 */
export interface ValidationError {
  path: string
  message: string
  keyword?: string
  params?: { [key: string]: unknown }
}

// ============================================================================
// Statistics Types
// ============================================================================

/**
 * Collection statistics
 */
export interface CollectionStats {
  /** Collection namespace */
  ns: string
  /** Number of documents */
  count: number
  /** Data size in bytes */
  size: number
  /** Average document size */
  avgObjSize: number
  /** Storage size including padding */
  storageSize: number
  /** Number of indexes */
  nindexes: number
  /** Total index size */
  totalIndexSize: number
  /** Size per index */
  indexSizes: { [indexName: string]: number }
  /** Collection is capped */
  capped?: boolean
  /** Maximum documents for capped */
  max?: number
  /** Maximum size for capped */
  maxSize?: number
}

/**
 * Compact operation result
 */
export interface CompactResult {
  /** Bytes freed */
  bytesFreed: number
  /** Operation duration in milliseconds */
  durationMs: number
}

/**
 * Validate operation result
 */
export interface ValidateResult {
  valid: boolean
  warnings: string[]
  errors: string[]
  nrecords: number
  nIndexes: number
  keysPerIndex: { [indexName: string]: number }
}

// ============================================================================
// Factory Options
// ============================================================================

/**
 * DocumentStore creation options
 */
export interface DocumentStoreOptions {
  /** Collection name */
  collection?: string
  /** Database name */
  database?: string
  /** Enable time-travel queries */
  enableTimeTravel?: boolean
  /** Retention policy for document versions */
  retention?: RetentionPolicy
  /** Enable schema validation */
  enableSchemaValidation?: boolean
  /** Initial schema */
  schema?: DocumentSchema
  /** Schema validation options */
  schemaOptions?: SchemaOptions
  /** Initial indexes to create */
  indexes?: IndexSpec[]
  /** Default read preference */
  readPreference?: ReadPreference
  /** Default write concern */
  writeConcern?: WriteConcern
  /** Default read concern */
  readConcern?: ReadConcern
  /** Enable change streams */
  enableChangeStreams?: boolean
  /** Collation options */
  collation?: CollationOptions
  /** Connection string or config */
  connection?: string | ConnectionConfig
}

/**
 * Connection configuration
 */
export interface ConnectionConfig {
  /** Host or hosts */
  hosts: string | string[]
  /** Port */
  port?: number
  /** Database name */
  database?: string
  /** Username */
  username?: string
  /** Password */
  password?: string
  /** Authentication source */
  authSource?: string
  /** Replica set name */
  replicaSet?: string
  /** SSL/TLS options */
  tls?: TlsOptions
  /** Connection pool options */
  pool?: PoolOptions
  /** Additional options */
  options?: { [key: string]: unknown }
}

/**
 * TLS/SSL options
 */
export interface TlsOptions {
  enabled?: boolean
  ca?: string | Buffer
  cert?: string | Buffer
  key?: string | Buffer
  passphrase?: string
  rejectUnauthorized?: boolean
}

/**
 * Connection pool options
 */
export interface PoolOptions {
  minSize?: number
  maxSize?: number
  maxIdleTimeMs?: number
  waitQueueTimeoutMs?: number
}

/**
 * Retention policy for versioned documents
 */
export interface RetentionPolicy {
  /** Keep versions for this duration */
  maxAge?: number | Duration
  /** Keep at most this many versions */
  maxVersions?: number
  /** Keep at least this many versions regardless of age */
  minVersions?: number
}

/**
 * Duration specification
 */
export interface Duration {
  days?: number
  hours?: number
  minutes?: number
  seconds?: number
  milliseconds?: number
}

// ============================================================================
// Factory Function Type
// ============================================================================

/**
 * Factory function to create a DocumentStore instance
 */
export type CreateDocumentStore = <TDoc extends Document = Document>(
  options?: DocumentStoreOptions
) => DocumentStore<TDoc>
