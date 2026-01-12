/**
 * MongoDB-Compatible Document Store Types
 *
 * Type definitions for the unified MongoDB-compatible document store
 * built on top of the unified primitives (QueryEngine, AggPipeline, InvertedIndex, etc.)
 *
 * @module db/compat/mongodb/types
 */

// ============================================================================
// ObjectId Implementation
// ============================================================================

/**
 * MongoDB ObjectId implementation
 * 12-byte BSON type: 4-byte timestamp + 5-byte random + 3-byte counter
 */
export class ObjectId {
  private _id: string

  private static _counter = Math.floor(Math.random() * 0xffffff)
  private static _machineId = ObjectId._generateMachineId()

  constructor(id?: string | ObjectId | Uint8Array) {
    if (id instanceof ObjectId) {
      this._id = id.toHexString()
    } else if (typeof id === 'string') {
      if (!ObjectId.isValid(id)) {
        throw new TypeError(`Invalid ObjectId string: ${id}`)
      }
      this._id = id.toLowerCase()
    } else if (id instanceof Uint8Array) {
      if (id.length !== 12) {
        throw new TypeError('ObjectId buffer must be 12 bytes')
      }
      this._id = Array.from(id)
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
    const timestamp = Math.floor(Date.now() / 1000)
      .toString(16)
      .padStart(8, '0')
    const machineId = ObjectId._machineId
    ObjectId._counter = (ObjectId._counter + 1) % 0xffffff
    const counter = ObjectId._counter.toString(16).padStart(6, '0')
    return timestamp + machineId + counter
  }

  static isValid(id: unknown): boolean {
    if (id instanceof ObjectId) return true
    if (typeof id !== 'string') return false
    return /^[0-9a-fA-F]{24}$/.test(id)
  }

  static createFromHexString(hex: string): ObjectId {
    return new ObjectId(hex)
  }

  static createFromTime(time: number): ObjectId {
    const timestamp = Math.floor(time).toString(16).padStart(8, '0')
    return new ObjectId(timestamp + '0'.repeat(16))
  }

  toHexString(): string {
    return this._id
  }

  getTimestamp(): Date {
    const timestamp = parseInt(this._id.substring(0, 8), 16)
    return new Date(timestamp * 1000)
  }

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
}

// ============================================================================
// Document Types
// ============================================================================

/**
 * Base document type
 */
export interface Document {
  [key: string]: unknown
}

/**
 * Document with required _id field
 */
export type WithId<T> = T & { _id: ObjectId }

/**
 * Document with optional _id field (for insertion)
 */
export type OptionalId<T> = Omit<T, '_id'> & { _id?: ObjectId }

// ============================================================================
// Filter Types (MongoDB Query Operators)
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
 * Logical operators
 */
export interface LogicalOperators<T extends Document = Document> {
  $and?: Filter<T>[]
  $or?: Filter<T>[]
  $nor?: Filter<T>[]
  $not?: FilterOperators<unknown>
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
  $text?: { $search: string; $language?: string; $caseSensitive?: boolean }
}

/**
 * Array operators
 */
export interface ArrayOperators<T = unknown> {
  $all?: T[]
  $elemMatch?: Record<string, unknown>
  $size?: number
}

/**
 * Combined filter operators for a field
 */
export type FilterOperators<T = unknown> = ComparisonOperators<T> &
  ElementOperators &
  EvaluationOperators &
  ArrayOperators<T>

/**
 * Condition for a field value
 */
export type Condition<T> = T | FilterOperators<T>

/**
 * Root filter type for queries
 */
export type Filter<T extends Document = Document> = {
  [P in keyof T]?: Condition<T[P]>
} & LogicalOperators<T>

// ============================================================================
// Update Types
// ============================================================================

/**
 * Field update operators
 */
export interface UpdateOperators<T extends Document = Document> {
  $set?: Partial<T>
  $unset?: { [P in keyof T]?: '' | 1 | true }
  $inc?: { [P in keyof T]?: number }
  $mul?: { [P in keyof T]?: number }
  $min?: Partial<T>
  $max?: Partial<T>
  $rename?: { [key: string]: string }
  $setOnInsert?: Partial<T>
  $currentDate?: { [P in keyof T]?: true | { $type: 'date' | 'timestamp' } }
}

/**
 * Array update operators
 */
export interface ArrayUpdateOperators<T extends Document = Document> {
  $push?: {
    [P in keyof T]?: T[P] extends unknown[]
      ? T[P][number] | { $each?: T[P]; $position?: number; $slice?: number; $sort?: 1 | -1 | object }
      : never
  }
  $pull?: {
    [P in keyof T]?: T[P] extends unknown[] ? T[P][number] | Filter<T[P][number] extends Document ? T[P][number] : never> : never
  }
  $addToSet?: {
    [P in keyof T]?: T[P] extends unknown[] ? T[P][number] | { $each: T[P] } : never
  }
  $pop?: { [P in keyof T]?: 1 | -1 }
  $pullAll?: {
    [P in keyof T]?: T[P] extends unknown[] ? T[P] : never
  }
}

/**
 * Complete update filter
 */
export type UpdateFilter<T extends Document = Document> = UpdateOperators<T> & ArrayUpdateOperators<T>

// ============================================================================
// Projection Types
// ============================================================================

/**
 * Projection specification for queries
 */
export type Projection<T extends Document = Document> = {
  [P in keyof T]?: 0 | 1 | boolean
} & {
  _id?: 0 | 1 | boolean
}

// ============================================================================
// Sort Types
// ============================================================================

/**
 * Sort direction
 */
export type SortDirection = 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending'

/**
 * Sort specification
 */
export type Sort<T extends Document = Document> =
  | { [P in keyof T]?: SortDirection }
  | [string, SortDirection][]
  | string

// ============================================================================
// Aggregation Pipeline Types
// ============================================================================

/**
 * $match stage
 */
export interface MatchStage<T extends Document = Document> {
  $match: Filter<T>
}

/**
 * $group stage
 */
export interface GroupStage {
  $group: {
    _id: unknown
    [field: string]: unknown
  }
}

/**
 * $project stage
 */
export interface ProjectStage<T extends Document = Document> {
  $project: Projection<T> | { [key: string]: unknown }
}

/**
 * $sort stage
 */
export interface SortStage<T extends Document = Document> {
  $sort: { [P in keyof T]?: SortDirection } | { [key: string]: SortDirection }
}

/**
 * $limit stage
 */
export interface LimitStage {
  $limit: number
}

/**
 * $skip stage
 */
export interface SkipStage {
  $skip: number
}

/**
 * $unwind stage
 */
export interface UnwindStage {
  $unwind: string | { path: string; preserveNullAndEmptyArrays?: boolean; includeArrayIndex?: string }
}

/**
 * $lookup stage
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
 * $count stage
 */
export interface CountStage {
  $count: string
}

/**
 * $addFields stage
 */
export interface AddFieldsStage {
  $addFields: { [key: string]: unknown }
}

/**
 * $set stage (alias for $addFields)
 */
export interface SetStage {
  $set: { [key: string]: unknown }
}

/**
 * $facet stage - run multiple aggregation pipelines in parallel
 */
export interface FacetStage<T extends Document = Document> {
  $facet: { [facetName: string]: PipelineStage<T>[] }
}

/**
 * $bucket stage - categorize documents into buckets
 */
export interface BucketStage {
  $bucket: {
    groupBy: unknown
    boundaries: unknown[]
    default?: unknown
    output?: { [field: string]: unknown }
  }
}

/**
 * $bucketAuto stage - auto-bucket documents
 */
export interface BucketAutoStage {
  $bucketAuto: {
    groupBy: unknown
    buckets: number
    output?: { [field: string]: unknown }
    granularity?: 'R5' | 'R10' | 'R20' | 'R40' | 'R80' | '1-2-5' | 'E6' | 'E12' | 'E24' | 'E48' | 'E96' | 'E192' | 'POWERSOF2'
  }
}

/**
 * $replaceRoot stage - replace document with embedded document
 */
export interface ReplaceRootStage {
  $replaceRoot: {
    newRoot: unknown
  }
}

/**
 * $replaceWith stage - alias for $replaceRoot
 */
export interface ReplaceWithStage {
  $replaceWith: unknown
}

/**
 * $sample stage - randomly select documents
 */
export interface SampleStage {
  $sample: {
    size: number
  }
}

/**
 * $merge stage - write to another collection
 */
export interface MergeStage {
  $merge: {
    into: string | { db: string; coll: string }
    on?: string | string[]
    whenMatched?: 'replace' | 'keepExisting' | 'merge' | 'fail' | unknown[]
    whenNotMatched?: 'insert' | 'discard' | 'fail'
  }
}

/**
 * $out stage - write to collection
 */
export interface OutStage {
  $out: string | { db: string; coll: string }
}

/**
 * $redact stage - restrict document content
 */
export interface RedactStage {
  $redact: unknown
}

/**
 * All supported pipeline stages
 */
export type PipelineStage<T extends Document = Document> =
  | MatchStage<T>
  | GroupStage
  | ProjectStage<T>
  | SortStage<T>
  | LimitStage
  | SkipStage
  | UnwindStage
  | LookupStage
  | CountStage
  | AddFieldsStage
  | SetStage
  | FacetStage<T>
  | BucketStage
  | BucketAutoStage
  | ReplaceRootStage
  | ReplaceWithStage
  | SampleStage
  | MergeStage
  | OutStage
  | RedactStage

// ============================================================================
// Index Types
// ============================================================================

/**
 * Index key specification
 */
export type IndexSpecification = {
  [key: string]: 1 | -1 | 'text' | '2d' | '2dsphere' | 'hashed'
}

/**
 * Index creation options
 */
export interface CreateIndexOptions {
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
  [key: string]: unknown
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * InsertOne result
 */
export interface InsertOneResult {
  acknowledged: boolean
  insertedId: ObjectId
}

/**
 * InsertMany result
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

// ============================================================================
// Options Types
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
}

/**
 * Update options
 */
export interface UpdateOptions {
  upsert?: boolean
  arrayFilters?: object[]
  hint?: string | IndexSpecification
}

/**
 * Delete options
 */
export interface DeleteOptions {
  hint?: string | IndexSpecification
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
 * InsertMany options
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
}

/**
 * Aggregate options
 */
export interface AggregateOptions {
  allowDiskUse?: boolean
  maxTimeMS?: number
  maxAwaitTimeMS?: number
  bypassDocumentValidation?: boolean
  comment?: string
  hint?: string | IndexSpecification
  batchSize?: number
}

/**
 * FindOneAndUpdate options
 */
export interface FindOneAndUpdateOptions<T extends Document = Document> extends FindOptions<T> {
  upsert?: boolean
  returnDocument?: 'before' | 'after'
  arrayFilters?: object[]
}

/**
 * FindOneAndDelete options
 */
export interface FindOneAndDeleteOptions<T extends Document = Document> extends FindOptions<T> {}

/**
 * FindOneAndReplace options
 */
export interface FindOneAndReplaceOptions<T extends Document = Document> extends FindOptions<T> {
  upsert?: boolean
  returnDocument?: 'before' | 'after'
}

// ============================================================================
// Cursor Types
// ============================================================================

/**
 * Find cursor for iterating results
 */
export interface FindCursor<T extends Document = Document> extends AsyncIterable<WithId<T>> {
  toArray(): Promise<WithId<T>[]>
  forEach(callback: (doc: WithId<T>) => void | Promise<void>): Promise<void>
  hasNext(): Promise<boolean>
  next(): Promise<WithId<T> | null>
  count(): Promise<number>
  limit(value: number): FindCursor<T>
  skip(value: number): FindCursor<T>
  sort(sort: Sort<T>): FindCursor<T>
  project<P extends Document = Document>(projection: Projection<T>): FindCursor<P>
  filter(filter: Filter<T>): FindCursor<T>
  map<U>(transform: (doc: WithId<T>) => U): FindCursor<U & Document>
  close(): Promise<void>
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
// Collection Interface
// ============================================================================

/**
 * Collection interface (MongoDB-compatible)
 */
export interface Collection<T extends Document = Document> {
  readonly collectionName: string
  readonly dbName: string
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

  // Find and modify operations
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
  estimatedDocumentCount(): Promise<number>

  // Distinct
  distinct<K extends keyof WithId<T>>(key: K, filter?: Filter<T>): Promise<WithId<T>[K][]>

  // Index operations
  createIndex(keys: IndexSpecification, options?: CreateIndexOptions): Promise<string>
  createIndexes(indexes: { key: IndexSpecification; options?: CreateIndexOptions }[]): Promise<string[]>
  dropIndex(indexName: string): Promise<void>
  dropIndexes(): Promise<void>
  listIndexes(): FindCursor<IndexInfo>
  indexExists(name: string | string[]): Promise<boolean>
  indexes(): Promise<IndexInfo[]>

  // Collection operations
  drop(): Promise<boolean>
}

// ============================================================================
// Database Interface
// ============================================================================

/**
 * Database interface
 */
export interface Db {
  readonly databaseName: string
  collection<T extends Document = Document>(name: string): Collection<T>
  createCollection<T extends Document = Document>(name: string): Promise<Collection<T>>
  listCollections(): { toArray(): Promise<{ name: string; type: string }[]> }
  dropCollection(name: string): Promise<boolean>
  dropDatabase(): Promise<boolean>
  collections(): Promise<Collection[]>
}

// ============================================================================
// Store Options
// ============================================================================

/**
 * Document store options
 */
export interface DocumentStoreOptions {
  /** Enable versioned document storage (time-travel queries) */
  enableVersioning?: boolean
  /** Enable full-text search indexing */
  enableFullTextSearch?: boolean
  /** Enable schema validation */
  enableSchemaValidation?: boolean
  /** Retention policy for versioned documents */
  retention?: {
    maxVersions?: number
    maxAge?: string
  }
}

// ============================================================================
// Error Types
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
 * Duplicate key error
 */
export class MongoDuplicateKeyError extends MongoError {
  keyValue: Document
  keyPattern: Document

  constructor(message: string, keyValue: Document, keyPattern: Document) {
    super(message)
    this.name = 'MongoDuplicateKeyError'
    this.code = 11000
    this.codeName = 'DuplicateKey'
    this.keyValue = keyValue
    this.keyPattern = keyPattern
  }
}
