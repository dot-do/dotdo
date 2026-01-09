/**
 * @dotdo/mongo types
 *
 * MongoDB driver-compatible type definitions
 * for the MongoDB SDK backed by Durable Objects with JSON storage
 *
 * @see https://mongodb.github.io/node-mongodb-native/
 */

// ============================================================================
// OBJECT ID
// ============================================================================

/**
 * MongoDB ObjectId implementation
 * 12-byte BSON type: 4-byte timestamp + 5-byte random + 3-byte counter
 */
export class ObjectId {
  private _id: string

  /** Counter for ObjectId generation */
  private static _counter = Math.floor(Math.random() * 0xffffff)

  /** Machine/process identifier (5 random bytes) */
  private static _machineId = ObjectId._generateMachineId()

  constructor(id?: string | ObjectId | Buffer | Uint8Array) {
    if (id instanceof ObjectId) {
      this._id = id.toHexString()
    } else if (typeof id === 'string') {
      if (!ObjectId.isValid(id)) {
        throw new TypeError(`Invalid ObjectId string: ${id}`)
      }
      this._id = id.toLowerCase()
    } else if (id instanceof Uint8Array || id instanceof ArrayBuffer) {
      const bytes = id instanceof ArrayBuffer ? new Uint8Array(id) : id
      if (bytes.length !== 12) {
        throw new TypeError('ObjectId buffer must be 12 bytes')
      }
      this._id = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    } else if (id === undefined || id === null) {
      this._id = ObjectId._generate()
    } else {
      throw new TypeError('Invalid ObjectId input')
    }
  }

  private static _generateMachineId(): string {
    const bytes = new Uint8Array(5)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private static _generate(): string {
    // 4-byte timestamp
    const timestamp = Math.floor(Date.now() / 1000)
      .toString(16)
      .padStart(8, '0')

    // 5-byte machine/process id
    const machineId = ObjectId._machineId

    // 3-byte counter
    ObjectId._counter = (ObjectId._counter + 1) % 0xffffff
    const counter = ObjectId._counter.toString(16).padStart(6, '0')

    return timestamp + machineId + counter
  }

  /**
   * Check if a value is a valid ObjectId
   */
  static isValid(id: unknown): boolean {
    if (id instanceof ObjectId) return true
    if (typeof id !== 'string') return false
    return /^[0-9a-fA-F]{24}$/.test(id)
  }

  /**
   * Create ObjectId from hex string
   */
  static createFromHexString(hex: string): ObjectId {
    return new ObjectId(hex)
  }

  /**
   * Create ObjectId from timestamp
   */
  static createFromTime(time: number): ObjectId {
    const timestamp = Math.floor(time).toString(16).padStart(8, '0')
    const padding = '0'.repeat(16)
    return new ObjectId(timestamp + padding)
  }

  /**
   * Get hex string representation
   */
  toHexString(): string {
    return this._id
  }

  /**
   * Get timestamp from ObjectId
   */
  getTimestamp(): Date {
    const timestamp = parseInt(this._id.substring(0, 8), 16)
    return new Date(timestamp * 1000)
  }

  /**
   * Check equality
   */
  equals(other: ObjectId | string): boolean {
    if (other instanceof ObjectId) {
      return this._id === other._id
    }
    return this._id === other?.toLowerCase()
  }

  toString(): string {
    return this._id
  }

  toJSON(): string {
    return this._id
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `ObjectId("${this._id}")`
  }
}

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * Base document type
 */
export interface Document {
  [key: string]: unknown
}

/**
 * Document with _id field
 */
export interface WithId<T extends Document> {
  _id: ObjectId
}

/**
 * Optional _id for insertion
 */
export type OptionalId<T extends Document> = Omit<T, '_id'> & {
  _id?: ObjectId
}

/**
 * Optional unwind for aggregation
 */
export type OptionalUnlessRequiredId<T extends Document> = T extends { _id: infer Id }
  ? Id extends ObjectId
    ? T
    : OptionalId<T>
  : OptionalId<T>

// ============================================================================
// FILTER TYPES
// ============================================================================

/**
 * Comparison operators
 */
export interface ComparisonOperators<T = unknown> {
  $eq?: T
  $ne?: T
  $gt?: T
  $gte?: T
  $lt?: T
  $lte?: T
  $in?: T[]
  $nin?: T[]
}

/**
 * Element operators
 */
export interface ElementOperators {
  $exists?: boolean
  $type?: string | number
}

/**
 * Evaluation operators
 */
export interface EvaluationOperators {
  $regex?: string | RegExp
  $options?: string
  $mod?: [number, number]
  $text?: { $search: string; $language?: string; $caseSensitive?: boolean }
}

/**
 * Array operators
 */
export interface ArrayOperators<T = unknown> {
  $all?: T[]
  $elemMatch?: Filter<T extends (infer U)[] ? U : never>
  $size?: number
}

/**
 * Logical operators
 */
export interface LogicalOperators<T extends Document = Document> {
  $and?: Filter<T>[]
  $or?: Filter<T>[]
  $nor?: Filter<T>[]
  $not?: Filter<T>
}

/**
 * Field filter operators
 */
export type FilterOperators<T = unknown> = ComparisonOperators<T> &
  ElementOperators &
  EvaluationOperators &
  ArrayOperators<T>

/**
 * Condition for a single field
 */
export type Condition<T> = T | FilterOperators<T>

/**
 * Root filter type for queries
 */
export type RootFilterOperators<T extends Document> = LogicalOperators<T>

/**
 * Filter type for document queries
 */
export type Filter<T extends Document = Document> = {
  [P in keyof T]?: Condition<T[P]>
} & RootFilterOperators<T>

// ============================================================================
// UPDATE TYPES
// ============================================================================

/**
 * Field update operators
 */
export interface UpdateOperators<T extends Document = Document> {
  /** Set field values */
  $set?: Partial<T>
  /** Unset (remove) fields */
  $unset?: { [P in keyof T]?: '' | 1 | true }
  /** Increment numeric fields */
  $inc?: { [P in keyof T]?: number }
  /** Multiply numeric fields */
  $mul?: { [P in keyof T]?: number }
  /** Set minimum value */
  $min?: Partial<T>
  /** Set maximum value */
  $max?: Partial<T>
  /** Rename fields */
  $rename?: { [key: string]: string }
  /** Set on insert only */
  $setOnInsert?: Partial<T>
  /** Set current date */
  $currentDate?: { [P in keyof T]?: true | { $type: 'date' | 'timestamp' } }
}

/**
 * Array update operators
 */
export interface ArrayUpdateOperators<T extends Document = Document> {
  /** Push to array */
  $push?: {
    [P in keyof T]?: T[P] extends unknown[]
      ? T[P][number] | { $each?: T[P]; $position?: number; $slice?: number; $sort?: 1 | -1 | object }
      : never
  }
  /** Pull from array */
  $pull?: {
    [P in keyof T]?: T[P] extends unknown[] ? T[P][number] | Filter<T[P][number] extends Document ? T[P][number] : never> : never
  }
  /** Add to set (unique) */
  $addToSet?: {
    [P in keyof T]?: T[P] extends unknown[] ? T[P][number] | { $each: T[P] } : never
  }
  /** Pop from array */
  $pop?: { [P in keyof T]?: 1 | -1 }
  /** Pull all matching values */
  $pullAll?: {
    [P in keyof T]?: T[P] extends unknown[] ? T[P] : never
  }
}

/**
 * Complete update filter
 */
export type UpdateFilter<T extends Document = Document> = UpdateOperators<T> & ArrayUpdateOperators<T>

// ============================================================================
// PROJECTION TYPES
// ============================================================================

/**
 * Projection for find operations
 */
export type Projection<T extends Document = Document> = {
  [P in keyof T]?: 0 | 1 | boolean
} & {
  _id?: 0 | 1 | boolean
}

// ============================================================================
// SORT TYPES
// ============================================================================

/**
 * Sort direction
 */
export type SortDirection = 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending'

/**
 * Sort specification
 */
export type Sort<T extends Document = Document> = {
  [P in keyof T]?: SortDirection
} | [string, SortDirection][] | string

// ============================================================================
// AGGREGATION TYPES
// ============================================================================

/**
 * Match stage
 */
export interface MatchStage<T extends Document = Document> {
  $match: Filter<T>
}

/**
 * Group accumulator operators
 */
export interface AccumulatorOperators {
  $sum?: number | string | object
  $avg?: string | object
  $first?: string | object
  $last?: string | object
  $max?: string | object
  $min?: string | object
  $push?: string | object
  $addToSet?: string | object
  $count?: object
}

/**
 * Group stage
 */
export interface GroupStage {
  $group: {
    _id: unknown
    [field: string]: unknown
  }
}

/**
 * Sort stage
 */
export interface SortStage<T extends Document = Document> {
  $sort: { [P in keyof T]?: SortDirection } | { [key: string]: SortDirection }
}

/**
 * Limit stage
 */
export interface LimitStage {
  $limit: number
}

/**
 * Skip stage
 */
export interface SkipStage {
  $skip: number
}

/**
 * Project stage
 */
export interface ProjectStage<T extends Document = Document> {
  $project: Projection<T> | { [key: string]: unknown }
}

/**
 * Unwind stage
 */
export interface UnwindStage {
  $unwind: string | { path: string; preserveNullAndEmptyArrays?: boolean; includeArrayIndex?: string }
}

/**
 * Lookup stage
 */
export interface LookupStage {
  $lookup: {
    from: string
    localField: string
    foreignField: string
    as: string
  }
}

/**
 * Count stage
 */
export interface CountStage {
  $count: string
}

/**
 * Add fields stage
 */
export interface AddFieldsStage {
  $addFields: { [key: string]: unknown }
}

/**
 * Set stage (alias for $addFields)
 */
export interface SetStage {
  $set: { [key: string]: unknown }
}

/**
 * Aggregate pipeline stage
 */
export type PipelineStage<T extends Document = Document> =
  | MatchStage<T>
  | GroupStage
  | SortStage<T>
  | LimitStage
  | SkipStage
  | ProjectStage<T>
  | UnwindStage
  | LookupStage
  | CountStage
  | AddFieldsStage
  | SetStage

// ============================================================================
// INDEX TYPES
// ============================================================================

/**
 * Index key specification
 */
export type IndexSpecification = {
  [key: string]: 1 | -1 | 'text' | '2d' | '2dsphere' | 'hashed'
}

/**
 * Index options
 */
export interface CreateIndexesOptions {
  name?: string
  unique?: boolean
  sparse?: boolean
  background?: boolean
  expireAfterSeconds?: number
  partialFilterExpression?: Filter<Document>
  weights?: { [key: string]: number }
  default_language?: string
  language_override?: string
}

/**
 * Index information
 */
export interface IndexInfo {
  name: string
  key: IndexSpecification
  unique?: boolean
  sparse?: boolean
  expireAfterSeconds?: number
  v?: number
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Insert one result
 */
export interface InsertOneResult {
  acknowledged: boolean
  insertedId: ObjectId
}

/**
 * Insert many result
 */
export interface InsertManyResult {
  acknowledged: boolean
  insertedCount: number
  insertedIds: { [key: number]: ObjectId }
}

/**
 * Update result
 */
export interface UpdateResult {
  acknowledged: boolean
  matchedCount: number
  modifiedCount: number
  upsertedCount: number
  upsertedId?: ObjectId
}

/**
 * Delete result
 */
export interface DeleteResult {
  acknowledged: boolean
  deletedCount: number
}

/**
 * Bulk write result
 */
export interface BulkWriteResult {
  acknowledged: boolean
  insertedCount: number
  matchedCount: number
  modifiedCount: number
  deletedCount: number
  upsertedCount: number
  insertedIds: { [key: number]: ObjectId }
  upsertedIds: { [key: number]: ObjectId }
}

// ============================================================================
// OPTIONS TYPES
// ============================================================================

/**
 * Find options
 */
export interface FindOptions<T extends Document = Document> {
  projection?: Projection<T>
  sort?: Sort<T>
  skip?: number
  limit?: number
  hint?: string | IndexSpecification
  comment?: string
  maxTimeMS?: number
  noCursorTimeout?: boolean
  batchSize?: number
  returnKey?: boolean
  showRecordId?: boolean
  allowPartialResults?: boolean
  collation?: CollationOptions
}

/**
 * Find one and update options
 */
export interface FindOneAndUpdateOptions<T extends Document = Document> extends FindOptions<T> {
  upsert?: boolean
  returnDocument?: 'before' | 'after'
  arrayFilters?: object[]
}

/**
 * Find one and delete options
 */
export interface FindOneAndDeleteOptions<T extends Document = Document> extends FindOptions<T> {}

/**
 * Find one and replace options
 */
export interface FindOneAndReplaceOptions<T extends Document = Document> extends FindOptions<T> {
  upsert?: boolean
  returnDocument?: 'before' | 'after'
}

/**
 * Update options
 */
export interface UpdateOptions {
  upsert?: boolean
  arrayFilters?: object[]
  hint?: string | IndexSpecification
  collation?: CollationOptions
}

/**
 * Delete options
 */
export interface DeleteOptions {
  hint?: string | IndexSpecification
  collation?: CollationOptions
}

/**
 * Insert options
 */
export interface InsertOneOptions {
  forceServerObjectId?: boolean
  bypassDocumentValidation?: boolean
  comment?: string
}

/**
 * Insert many options
 */
export interface InsertManyOptions extends InsertOneOptions {
  ordered?: boolean
}

/**
 * Count options
 */
export interface CountDocumentsOptions {
  skip?: number
  limit?: number
  maxTimeMS?: number
  hint?: string | IndexSpecification
  collation?: CollationOptions
}

/**
 * Estimated count options
 */
export interface EstimatedDocumentCountOptions {
  maxTimeMS?: number
}

/**
 * Distinct options
 */
export interface DistinctOptions {
  maxTimeMS?: number
  collation?: CollationOptions
}

/**
 * Aggregate options
 */
export interface AggregateOptions {
  allowDiskUse?: boolean
  maxTimeMS?: number
  maxAwaitTimeMS?: number
  bypassDocumentValidation?: boolean
  collation?: CollationOptions
  comment?: string
  hint?: string | IndexSpecification
  batchSize?: number
  let?: Document
}

/**
 * Collation options
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

// ============================================================================
// CURSOR TYPES
// ============================================================================

/**
 * Find cursor for iterating results
 */
export interface FindCursor<T extends Document = Document> extends AsyncIterable<WithId<T>> {
  /** Convert to array */
  toArray(): Promise<WithId<T>[]>
  /** Execute callback for each document */
  forEach(callback: (doc: WithId<T>) => void | Promise<void>): Promise<void>
  /** Check if there are more documents */
  hasNext(): Promise<boolean>
  /** Get next document */
  next(): Promise<WithId<T> | null>
  /** Count documents */
  count(): Promise<number>
  /** Limit results */
  limit(value: number): FindCursor<T>
  /** Skip documents */
  skip(value: number): FindCursor<T>
  /** Sort results */
  sort(sort: Sort<T>): FindCursor<T>
  /** Project fields */
  project<P extends Document = Document>(projection: Projection<T>): FindCursor<P>
  /** Filter results */
  filter(filter: Filter<T>): FindCursor<T>
  /** Map documents */
  map<U>(transform: (doc: WithId<T>) => U): FindCursor<U & Document>
  /** Close cursor */
  close(): Promise<void>
  /** Check if cursor is closed */
  readonly closed: boolean
}

/**
 * Aggregation cursor
 */
export interface AggregationCursor<T extends Document = Document> extends AsyncIterable<T> {
  toArray(): Promise<T[]>
  forEach(callback: (doc: T) => void | Promise<void>): Promise<void>
  hasNext(): Promise<boolean>
  next(): Promise<T | null>
  close(): Promise<void>
  readonly closed: boolean
}

// ============================================================================
// COLLECTION INTERFACE
// ============================================================================

/**
 * MongoDB Collection interface
 */
export interface Collection<T extends Document = Document> {
  /** Collection name */
  readonly collectionName: string
  /** Database name */
  readonly dbName: string
  /** Full namespace (db.collection) */
  readonly namespace: string

  // Insert operations
  insertOne(doc: OptionalId<T>, options?: InsertOneOptions): Promise<InsertOneResult>
  insertMany(docs: OptionalId<T>[], options?: InsertManyOptions): Promise<InsertManyResult>

  // Find operations
  findOne(filter?: Filter<T>, options?: FindOptions<T>): Promise<WithId<T> | null>
  find(filter?: Filter<T>, options?: FindOptions<T>): FindCursor<T>

  // Update operations
  updateOne(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<UpdateResult>
  updateMany(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<UpdateResult>
  replaceOne(filter: Filter<T>, replacement: T, options?: UpdateOptions): Promise<UpdateResult>

  // Delete operations
  deleteOne(filter: Filter<T>, options?: DeleteOptions): Promise<DeleteResult>
  deleteMany(filter: Filter<T>, options?: DeleteOptions): Promise<DeleteResult>

  // Find and modify
  findOneAndUpdate(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: FindOneAndUpdateOptions<T>
  ): Promise<WithId<T> | null>
  findOneAndDelete(filter: Filter<T>, options?: FindOneAndDeleteOptions<T>): Promise<WithId<T> | null>
  findOneAndReplace(
    filter: Filter<T>,
    replacement: T,
    options?: FindOneAndReplaceOptions<T>
  ): Promise<WithId<T> | null>

  // Aggregation
  aggregate<R extends Document = Document>(
    pipeline: PipelineStage<T>[],
    options?: AggregateOptions
  ): AggregationCursor<R>

  // Count operations
  countDocuments(filter?: Filter<T>, options?: CountDocumentsOptions): Promise<number>
  estimatedDocumentCount(options?: EstimatedDocumentCountOptions): Promise<number>

  // Distinct
  distinct<K extends keyof WithId<T>>(
    key: K,
    filter?: Filter<T>,
    options?: DistinctOptions
  ): Promise<WithId<T>[K][]>

  // Index operations
  createIndex(keys: IndexSpecification, options?: CreateIndexesOptions): Promise<string>
  createIndexes(indexes: { key: IndexSpecification; options?: CreateIndexesOptions }[]): Promise<string[]>
  dropIndex(indexName: string): Promise<void>
  dropIndexes(): Promise<void>
  listIndexes(): FindCursor<IndexInfo>
  indexExists(name: string | string[]): Promise<boolean>
  indexes(): Promise<IndexInfo[]>

  // Collection operations
  drop(): Promise<boolean>
  rename(newName: string): Promise<Collection<T>>
  isCapped(): Promise<boolean>
  stats(): Promise<CollStats>

  // Watch (change streams - may be limited)
  watch<C extends Document = T>(
    pipeline?: PipelineStage<T>[],
    options?: ChangeStreamOptions
  ): ChangeStream<C>
}

/**
 * Collection stats
 */
export interface CollStats {
  ns: string
  count: number
  size: number
  avgObjSize: number
  storageSize: number
  totalIndexSize: number
  indexSizes: { [indexName: string]: number }
  nindexes: number
}

/**
 * Change stream options
 */
export interface ChangeStreamOptions {
  fullDocument?: 'default' | 'updateLookup'
  resumeAfter?: unknown
  startAfter?: unknown
  startAtOperationTime?: Date
  batchSize?: number
  maxAwaitTimeMS?: number
}

/**
 * Change stream
 */
export interface ChangeStream<T extends Document = Document> extends AsyncIterable<ChangeStreamDocument<T>> {
  close(): Promise<void>
  hasNext(): Promise<boolean>
  next(): Promise<ChangeStreamDocument<T>>
  readonly closed: boolean
}

/**
 * Change stream document
 */
export interface ChangeStreamDocument<T extends Document = Document> {
  _id: unknown
  operationType: 'insert' | 'update' | 'replace' | 'delete' | 'invalidate' | 'drop' | 'dropDatabase' | 'rename'
  fullDocument?: T
  documentKey?: { _id: ObjectId }
  updateDescription?: {
    updatedFields: Document
    removedFields: string[]
  }
  ns: { db: string; coll: string }
  clusterTime?: Date
}

// ============================================================================
// DATABASE INTERFACE
// ============================================================================

/**
 * Database interface
 */
export interface Db {
  /** Database name */
  readonly databaseName: string

  /** Get a collection */
  collection<T extends Document = Document>(name: string): Collection<T>

  /** Create a collection */
  createCollection<T extends Document = Document>(
    name: string,
    options?: CreateCollectionOptions
  ): Promise<Collection<T>>

  /** List collections */
  listCollections(filter?: Document, options?: ListCollectionsOptions): ListCollectionsCursor

  /** Drop a collection */
  dropCollection(name: string): Promise<boolean>

  /** Drop the database */
  dropDatabase(): Promise<boolean>

  /** Get collection names */
  collections(): Promise<Collection[]>

  /** Run a command */
  command(command: Document): Promise<Document>

  /** Get database stats */
  stats(): Promise<DbStats>

  /** Get admin interface */
  admin(): Admin
}

/**
 * Create collection options
 */
export interface CreateCollectionOptions {
  capped?: boolean
  size?: number
  max?: number
  validator?: Document
  validationLevel?: 'off' | 'strict' | 'moderate'
  validationAction?: 'error' | 'warn'
  viewOn?: string
  pipeline?: PipelineStage<Document>[]
  collation?: CollationOptions
}

/**
 * List collections options
 */
export interface ListCollectionsOptions {
  nameOnly?: boolean
  authorizedCollections?: boolean
  batchSize?: number
}

/**
 * List collections cursor
 */
export interface ListCollectionsCursor extends AsyncIterable<CollectionInfo> {
  toArray(): Promise<CollectionInfo[]>
  hasNext(): Promise<boolean>
  next(): Promise<CollectionInfo | null>
  close(): Promise<void>
}

/**
 * Collection info
 */
export interface CollectionInfo {
  name: string
  type: 'collection' | 'view'
  options?: Document
  info?: { readOnly: boolean }
  idIndex?: IndexInfo
}

/**
 * Database stats
 */
export interface DbStats {
  db: string
  collections: number
  views: number
  objects: number
  avgObjSize: number
  dataSize: number
  storageSize: number
  indexes: number
  indexSize: number
}

/**
 * Admin interface
 */
export interface Admin {
  listDatabases(): Promise<ListDatabasesResult>
  serverInfo(): Promise<Document>
  serverStatus(): Promise<Document>
  ping(): Promise<Document>
}

/**
 * List databases result
 */
export interface ListDatabasesResult {
  databases: { name: string; sizeOnDisk: number; empty: boolean }[]
  totalSize: number
  ok: number
}

// ============================================================================
// CLIENT INTERFACE
// ============================================================================

/**
 * MongoDB client options
 */
export interface MongoClientOptions {
  /** Application name */
  appName?: string
  /** Auth source database */
  authSource?: string
  /** Auth mechanism */
  authMechanism?: string
  /** Connection timeout in ms */
  connectTimeoutMS?: number
  /** Socket timeout in ms */
  socketTimeoutMS?: number
  /** Server selection timeout in ms */
  serverSelectionTimeoutMS?: number
  /** Max pool size */
  maxPoolSize?: number
  /** Min pool size */
  minPoolSize?: number
  /** Max idle time in ms */
  maxIdleTimeMS?: number
  /** Write concern */
  w?: number | 'majority'
  /** Write concern timeout */
  wtimeoutMS?: number
  /** Journal acknowledgment */
  journal?: boolean
  /** Read preference */
  readPreference?: 'primary' | 'primaryPreferred' | 'secondary' | 'secondaryPreferred' | 'nearest'
  /** Read concern */
  readConcern?: { level: 'local' | 'available' | 'majority' | 'linearizable' | 'snapshot' }
  /** Retry reads */
  retryReads?: boolean
  /** Retry writes */
  retryWrites?: boolean
  /** Use TLS */
  tls?: boolean
  /** Direct connection */
  directConnection?: boolean
  /** Replica set name */
  replicaSet?: string
}

/**
 * Extended client options for DO backing
 */
export interface ExtendedMongoClientOptions extends MongoClientOptions {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Shard configuration */
  shard?: {
    algorithm?: 'consistent' | 'range' | 'hash'
    count?: number
    key?: string
  }
  /** Replica configuration */
  replica?: {
    readPreference?: 'primary' | 'secondary' | 'nearest'
    writeThrough?: boolean
    jurisdiction?: 'eu' | 'us' | 'fedramp'
  }
}

/**
 * MongoDB Client interface
 */
export interface MongoClient {
  /** Get a database */
  db(name?: string): Db

  /** Connect to the database */
  connect(): Promise<MongoClient>

  /** Close the client */
  close(force?: boolean): Promise<void>

  /** Check if connected */
  readonly isConnected: boolean

  /** Client options */
  readonly options: MongoClientOptions

  /** Start a session */
  startSession(options?: SessionOptions): ClientSession

  /** Run with session */
  withSession<T>(fn: (session: ClientSession) => Promise<T>): Promise<T>

  /** Watch for changes */
  watch<T extends Document = Document>(
    pipeline?: PipelineStage<T>[],
    options?: ChangeStreamOptions
  ): ChangeStream<T>
}

/**
 * Session options
 */
export interface SessionOptions {
  causalConsistency?: boolean
  defaultTransactionOptions?: TransactionOptions
}

/**
 * Transaction options
 */
export interface TransactionOptions {
  readConcern?: { level: string }
  writeConcern?: { w: number | 'majority'; j?: boolean; wtimeoutMS?: number }
  readPreference?: string
  maxCommitTimeMS?: number
}

/**
 * Client session
 */
export interface ClientSession {
  /** Session ID */
  readonly id: { id: unknown }
  /** Is session ended */
  readonly hasEnded: boolean
  /** Is in transaction */
  readonly inTransaction: boolean
  /** Start a transaction */
  startTransaction(options?: TransactionOptions): void
  /** Commit transaction */
  commitTransaction(): Promise<void>
  /** Abort transaction */
  abortTransaction(): Promise<void>
  /** End session */
  endSession(): Promise<void>
  /** Run with transaction */
  withTransaction<T>(fn: (session: ClientSession) => Promise<T>, options?: TransactionOptions): Promise<T>
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base MongoDB error
 */
export class MongoError extends Error {
  code?: number
  codeName?: string

  constructor(message: string) {
    super(message)
    this.name = 'MongoError'
  }
}

/**
 * Server error (returned by database)
 */
export class MongoServerError extends MongoError {
  constructor(message: string, code?: number, codeName?: string) {
    super(message)
    this.name = 'MongoServerError'
    this.code = code
    this.codeName = codeName
  }
}

/**
 * Driver error (client-side)
 */
export class MongoDriverError extends MongoError {
  constructor(message: string) {
    super(message)
    this.name = 'MongoDriverError'
  }
}

/**
 * Network error
 */
export class MongoNetworkError extends MongoError {
  constructor(message: string) {
    super(message)
    this.name = 'MongoNetworkError'
  }
}

/**
 * Timeout error
 */
export class MongoTimeoutError extends MongoError {
  constructor(message: string) {
    super(message)
    this.name = 'MongoTimeoutError'
  }
}

/**
 * Write concern error
 */
export class MongoWriteConcernError extends MongoServerError {
  result: Document

  constructor(message: string, result: Document) {
    super(message)
    this.name = 'MongoWriteConcernError'
    this.result = result
  }
}

/**
 * Bulk write error
 */
export class MongoBulkWriteError extends MongoServerError {
  writeErrors: WriteError[]
  result: BulkWriteResult

  constructor(message: string, writeErrors: WriteError[], result: BulkWriteResult) {
    super(message)
    this.name = 'MongoBulkWriteError'
    this.writeErrors = writeErrors
    this.result = result
  }
}

/**
 * Write error
 */
export interface WriteError {
  index: number
  code: number
  errmsg: string
  op: Document
}

/**
 * Duplicate key error
 */
export class MongoDuplicateKeyError extends MongoServerError {
  keyValue: Document
  keyPattern: Document

  constructor(message: string, keyValue: Document, keyPattern: Document) {
    super(message, 11000, 'DuplicateKey')
    this.name = 'MongoDuplicateKeyError'
    this.keyValue = keyValue
    this.keyPattern = keyPattern
  }
}

// ============================================================================
// BSON TYPES (Simplified)
// ============================================================================

/**
 * Binary data
 */
export class Binary {
  private _buffer: Uint8Array
  readonly subType: number

  constructor(buffer: Uint8Array | ArrayBuffer | string, subType?: number) {
    if (typeof buffer === 'string') {
      const encoder = new TextEncoder()
      this._buffer = encoder.encode(buffer)
    } else if (buffer instanceof ArrayBuffer) {
      this._buffer = new Uint8Array(buffer)
    } else {
      this._buffer = buffer
    }
    this.subType = subType ?? 0
  }

  get buffer(): Uint8Array {
    return this._buffer
  }

  length(): number {
    return this._buffer.length
  }

  toJSON(): string {
    return btoa(String.fromCharCode(...this._buffer))
  }

  toString(encoding?: 'base64' | 'hex' | 'utf8'): string {
    if (encoding === 'base64') {
      return btoa(String.fromCharCode(...this._buffer))
    }
    if (encoding === 'hex') {
      return Array.from(this._buffer)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
    return new TextDecoder().decode(this._buffer)
  }
}

/**
 * Timestamp (for oplog/replication)
 */
export class Timestamp {
  readonly i: number
  readonly t: number

  constructor(t: number | bigint, i?: number) {
    if (typeof t === 'bigint') {
      this.t = Number(t >> BigInt(32))
      this.i = Number(t & BigInt(0xffffffff))
    } else {
      this.t = t
      this.i = i ?? 0
    }
  }

  static fromBits(i: number, t: number): Timestamp {
    return new Timestamp(t, i)
  }

  toJSON(): { $timestamp: { t: number; i: number } } {
    return { $timestamp: { t: this.t, i: this.i } }
  }
}

/**
 * Long integer (for 64-bit integers)
 */
export class Long {
  private _value: bigint

  constructor(low: number | bigint, high?: number) {
    if (typeof low === 'bigint') {
      this._value = low
    } else if (high !== undefined) {
      this._value = BigInt(high) * BigInt(0x100000000) + BigInt(low >>> 0)
    } else {
      this._value = BigInt(low)
    }
  }

  static fromNumber(value: number): Long {
    return new Long(BigInt(Math.floor(value)))
  }

  static fromString(str: string, radix?: number): Long {
    return new Long(BigInt(parseInt(str, radix)))
  }

  toNumber(): number {
    return Number(this._value)
  }

  toString(radix?: number): string {
    return this._value.toString(radix)
  }

  toJSON(): string {
    return this._value.toString()
  }

  equals(other: Long): boolean {
    return this._value === other._value
  }
}

/**
 * Decimal128 (high precision decimal)
 */
export class Decimal128 {
  private _bytes: Uint8Array

  constructor(value: string | Uint8Array) {
    if (typeof value === 'string') {
      // Simplified: store as string bytes
      const encoder = new TextEncoder()
      this._bytes = encoder.encode(value)
    } else {
      this._bytes = value
    }
  }

  static fromString(value: string): Decimal128 {
    return new Decimal128(value)
  }

  toString(): string {
    return new TextDecoder().decode(this._bytes)
  }

  toJSON(): { $numberDecimal: string } {
    return { $numberDecimal: this.toString() }
  }
}

/**
 * UUID
 */
export class UUID {
  private _id: string

  constructor(input?: string | Uint8Array) {
    if (input === undefined) {
      this._id = crypto.randomUUID()
    } else if (typeof input === 'string') {
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(input)) {
        throw new TypeError('Invalid UUID string')
      }
      this._id = input.toLowerCase()
    } else {
      // Convert bytes to UUID string
      const hex = Array.from(input)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      this._id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
  }

  static generate(): UUID {
    return new UUID()
  }

  toString(): string {
    return this._id
  }

  toHexString(): string {
    return this._id.replace(/-/g, '')
  }

  toJSON(): string {
    return this._id
  }

  equals(other: UUID | string): boolean {
    const otherId = other instanceof UUID ? other._id : other.toLowerCase()
    return this._id === otherId
  }
}

/**
 * MinKey (compares less than all other values)
 */
export class MinKey {
  readonly _bsontype = 'MinKey'
  toJSON(): { $minKey: 1 } {
    return { $minKey: 1 }
  }
}

/**
 * MaxKey (compares greater than all other values)
 */
export class MaxKey {
  readonly _bsontype = 'MaxKey'
  toJSON(): { $maxKey: 1 } {
    return { $maxKey: 1 }
  }
}

/**
 * Code (JavaScript code)
 */
export class Code {
  readonly code: string
  readonly scope?: Document

  constructor(code: string | Function, scope?: Document) {
    this.code = typeof code === 'function' ? code.toString() : code
    this.scope = scope
  }

  toJSON(): { $code: string; $scope?: Document } {
    const result: { $code: string; $scope?: Document } = { $code: this.code }
    if (this.scope) {
      result.$scope = this.scope
    }
    return result
  }
}
