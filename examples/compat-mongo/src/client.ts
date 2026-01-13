/**
 * Mongoose-Compatible Client
 *
 * Provides a mongoose-like API for interacting with MongoDB-compatible Durable Objects.
 * Supports schemas, models, connections, and most mongoose operations.
 */

import type { MongoFilter, MongoUpdate, SortSpec, ProjectionSpec } from './query-parser'
import type { AggregationStage, Document } from './aggregation'
import type {
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  FindOptions,
  IndexInfo,
  BulkOperation,
  BulkWriteResult,
} from './CollectionDO'
import type { MongoDO, Env as MongoEnv, CollectionInfo } from './MongoDO'

// ============================================================================
// Types
// ============================================================================

/** Connection options */
export interface ConnectOptions {
  dbName?: string
  maxPoolSize?: number
  retryWrites?: boolean
  retryReads?: boolean
}

/** Schema definition */
export interface SchemaDefinition {
  [field: string]: SchemaType | SchemaTypeOptions
}

/** Schema type */
export type SchemaType =
  | typeof String
  | typeof Number
  | typeof Boolean
  | typeof Date
  | typeof Array
  | typeof Object
  | typeof Buffer
  | { type: SchemaType; ref?: string }
  | SchemaType[]

/** Schema type options */
export interface SchemaTypeOptions {
  type: SchemaType
  required?: boolean
  default?: unknown | (() => unknown)
  unique?: boolean
  index?: boolean
  ref?: string
  validate?: (value: unknown) => boolean | { validator: (v: unknown) => boolean; message: string }
  enum?: unknown[]
  min?: number | Date
  max?: number | Date
  minLength?: number
  maxLength?: number
  match?: RegExp
  lowercase?: boolean
  uppercase?: boolean
  trim?: boolean
  select?: boolean
  immutable?: boolean
  alias?: string
  get?: (value: unknown) => unknown
  set?: (value: unknown) => unknown
}

/** Schema options */
export interface SchemaOptions {
  timestamps?: boolean | { createdAt?: string; updatedAt?: string }
  collection?: string
  strict?: boolean
  strictQuery?: boolean
  versionKey?: string | false
  minimize?: boolean
  autoIndex?: boolean
  autoCreate?: boolean
}

/** Query options */
export interface QueryOptions {
  lean?: boolean
  populate?: string | string[] | PopulateOptions | PopulateOptions[]
  select?: string | string[] | Record<string, 0 | 1>
  sort?: string | Record<string, 1 | -1>
  limit?: number
  skip?: number
  session?: ClientSession
}

/** Populate options */
export interface PopulateOptions {
  path: string
  select?: string | string[] | Record<string, 0 | 1>
  model?: string
  match?: MongoFilter
  options?: QueryOptions
}

/** Session */
export interface ClientSession {
  id: unknown
  startTransaction(options?: TransactionOptions): void
  commitTransaction(): Promise<void>
  abortTransaction(): Promise<void>
  endSession(): Promise<void>
  inTransaction(): boolean
  withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T>
}

/** Transaction options */
export interface TransactionOptions {
  readConcern?: { level: string }
  writeConcern?: { w: number | string }
  readPreference?: string
}

/** Cursor */
export interface QueryCursor<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>
  next(): Promise<T | null>
  close(): Promise<void>
}

// ============================================================================
// ObjectId
// ============================================================================

export class ObjectId {
  private _id: string

  constructor(id?: string) {
    if (id) {
      this._id = id
    } else {
      const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0')
      const random = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      this._id = timestamp + random
    }
  }

  toString(): string {
    return this._id
  }

  toHexString(): string {
    return this._id
  }

  equals(other: ObjectId | string): boolean {
    const otherId = other instanceof ObjectId ? other._id : other
    return this._id === otherId
  }

  getTimestamp(): Date {
    const timestamp = parseInt(this._id.substring(0, 8), 16)
    return new Date(timestamp * 1000)
  }

  static isValid(id: string): boolean {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)
  }

  static createFromTime(time: number | Date): ObjectId {
    const timestamp = time instanceof Date ? Math.floor(time.getTime() / 1000) : time
    const hex = timestamp.toString(16).padStart(8, '0')
    return new ObjectId(hex + '0'.repeat(16))
  }
}

// ============================================================================
// Schema
// ============================================================================

export class Schema<T = unknown> {
  private definition: SchemaDefinition
  private options: SchemaOptions
  private virtuals: Map<string, { get?: () => unknown; set?: (v: unknown) => void }> = new Map()
  private methods: Map<string, (...args: unknown[]) => unknown> = new Map()
  private statics: Map<string, (...args: unknown[]) => unknown> = new Map()
  private hooks: {
    pre: Map<string, Array<(next: () => void) => void>>
    post: Map<string, Array<(doc: unknown) => void>>
  } = { pre: new Map(), post: new Map() }
  private indexes: Array<{ fields: Record<string, 1 | -1>; options?: { unique?: boolean; sparse?: boolean } }> = []

  constructor(definition: SchemaDefinition, options?: SchemaOptions) {
    this.definition = definition
    this.options = options ?? {}

    // Add _id field if not defined
    if (!('_id' in definition)) {
      this.definition._id = { type: String, default: () => new ObjectId().toString() }
    }

    // Add timestamps
    if (this.options.timestamps) {
      const createdAt = typeof this.options.timestamps === 'object' && this.options.timestamps.createdAt
        ? this.options.timestamps.createdAt
        : 'createdAt'
      const updatedAt = typeof this.options.timestamps === 'object' && this.options.timestamps.updatedAt
        ? this.options.timestamps.updatedAt
        : 'updatedAt'

      this.definition[createdAt] = { type: Date, default: () => new Date() }
      this.definition[updatedAt] = { type: Date, default: () => new Date() }
    }

    // Add version key
    if (this.options.versionKey !== false) {
      const versionKey = this.options.versionKey ?? '__v'
      this.definition[versionKey] = { type: Number, default: 0 }
    }
  }

  /**
   * Add virtual field
   */
  virtual(name: string): { get: (fn: () => unknown) => void; set: (fn: (v: unknown) => void) => void } {
    if (!this.virtuals.has(name)) {
      this.virtuals.set(name, {})
    }
    const virtual = this.virtuals.get(name)!
    return {
      get: (fn: () => unknown) => { virtual.get = fn },
      set: (fn: (v: unknown) => void) => { virtual.set = fn },
    }
  }

  /**
   * Add instance method
   */
  method(name: string, fn: (...args: unknown[]) => unknown): void {
    this.methods.set(name, fn)
  }

  /**
   * Add static method
   */
  static(name: string, fn: (...args: unknown[]) => unknown): void {
    this.statics.set(name, fn)
  }

  /**
   * Add pre hook
   */
  pre(event: string, fn: (next: () => void) => void): void {
    if (!this.hooks.pre.has(event)) {
      this.hooks.pre.set(event, [])
    }
    this.hooks.pre.get(event)!.push(fn)
  }

  /**
   * Add post hook
   */
  post(event: string, fn: (doc: unknown) => void): void {
    if (!this.hooks.post.has(event)) {
      this.hooks.post.set(event, [])
    }
    this.hooks.post.get(event)!.push(fn)
  }

  /**
   * Add index
   */
  index(fields: Record<string, 1 | -1>, options?: { unique?: boolean; sparse?: boolean }): void {
    this.indexes.push({ fields, options })
  }

  /**
   * Set plugin
   */
  plugin(fn: (schema: Schema) => void): void {
    fn(this)
  }

  /**
   * Get field paths
   */
  paths(): string[] {
    return Object.keys(this.definition)
  }

  /**
   * Get field type
   */
  path(name: string): SchemaTypeOptions | undefined {
    const def = this.definition[name]
    if (!def) return undefined
    if (typeof def === 'function') return { type: def }
    return def as SchemaTypeOptions
  }

  /**
   * Validate document against schema
   */
  validate(doc: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    for (const [field, def] of Object.entries(this.definition)) {
      const opts = typeof def === 'function' ? { type: def } : def as SchemaTypeOptions
      const value = doc[field]

      // Required check
      if (opts.required && (value === undefined || value === null)) {
        errors.push(`${field} is required`)
        continue
      }

      if (value === undefined || value === null) continue

      // Type check
      const expectedType = opts.type
      if (!this.checkType(value, expectedType)) {
        errors.push(`${field} must be of type ${this.getTypeName(expectedType)}`)
      }

      // Enum check
      if (opts.enum && !opts.enum.includes(value)) {
        errors.push(`${field} must be one of: ${opts.enum.join(', ')}`)
      }

      // Min/max for numbers
      if (typeof value === 'number') {
        if (opts.min !== undefined && value < (opts.min as number)) {
          errors.push(`${field} must be at least ${opts.min}`)
        }
        if (opts.max !== undefined && value > (opts.max as number)) {
          errors.push(`${field} must be at most ${opts.max}`)
        }
      }

      // Min/max for strings
      if (typeof value === 'string') {
        if (opts.minLength !== undefined && value.length < opts.minLength) {
          errors.push(`${field} must be at least ${opts.minLength} characters`)
        }
        if (opts.maxLength !== undefined && value.length > opts.maxLength) {
          errors.push(`${field} must be at most ${opts.maxLength} characters`)
        }
        if (opts.match && !opts.match.test(value)) {
          errors.push(`${field} does not match the required pattern`)
        }
      }

      // Custom validator
      if (opts.validate) {
        const validator = typeof opts.validate === 'function' ? opts.validate : opts.validate.validator
        const message = typeof opts.validate === 'object' ? opts.validate.message : `${field} failed validation`
        if (!validator(value)) {
          errors.push(message)
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Apply defaults to document
   */
  applyDefaults(doc: Record<string, unknown>): Record<string, unknown> {
    const result = { ...doc }

    for (const [field, def] of Object.entries(this.definition)) {
      if (result[field] !== undefined) continue

      const opts = typeof def === 'function' ? { type: def } : def as SchemaTypeOptions
      if (opts.default !== undefined) {
        result[field] = typeof opts.default === 'function' ? opts.default() : opts.default
      }
    }

    return result
  }

  /**
   * Transform document (apply setters, lowercase, etc.)
   */
  transform(doc: Record<string, unknown>): Record<string, unknown> {
    const result = { ...doc }

    for (const [field, def] of Object.entries(this.definition)) {
      if (result[field] === undefined) continue

      const opts = typeof def === 'function' ? { type: def } : def as SchemaTypeOptions
      let value = result[field]

      // Apply transformations
      if (typeof value === 'string') {
        if (opts.lowercase) value = value.toLowerCase()
        if (opts.uppercase) value = value.toUpperCase()
        if (opts.trim) value = value.trim()
      }

      // Apply setter
      if (opts.set) {
        value = opts.set(value)
      }

      result[field] = value
    }

    return result
  }

  private checkType(value: unknown, type: SchemaType): boolean {
    if (type === String) return typeof value === 'string'
    if (type === Number) return typeof value === 'number'
    if (type === Boolean) return typeof value === 'boolean'
    if (type === Date) return value instanceof Date || typeof value === 'string'
    if (type === Array) return Array.isArray(value)
    if (type === Object) return typeof value === 'object' && value !== null
    if (Array.isArray(type)) return Array.isArray(value)
    if (typeof type === 'object' && 'type' in type) return this.checkType(value, type.type)
    return true
  }

  private getTypeName(type: SchemaType): string {
    if (type === String) return 'String'
    if (type === Number) return 'Number'
    if (type === Boolean) return 'Boolean'
    if (type === Date) return 'Date'
    if (type === Array) return 'Array'
    if (type === Object) return 'Object'
    return 'Unknown'
  }

  // Expose internals for Model
  _getDefinition() { return this.definition }
  _getOptions() { return this.options }
  _getVirtuals() { return this.virtuals }
  _getMethods() { return this.methods }
  _getStatics() { return this.statics }
  _getHooks() { return this.hooks }
  _getIndexes() { return this.indexes }
}

// ============================================================================
// Query
// ============================================================================

export class Query<T = unknown> {
  private collection: Collection
  private _filter: MongoFilter = {}
  private _projection?: ProjectionSpec
  private _sort?: SortSpec
  private _limit?: number
  private _skip?: number
  private _lean = false
  private _populate: PopulateOptions[] = []

  constructor(collection: Collection) {
    this.collection = collection
  }

  /**
   * Set filter
   */
  where(filter: MongoFilter | string, value?: unknown): Query<T> {
    if (typeof filter === 'string') {
      this._filter[filter] = value
    } else {
      this._filter = { ...this._filter, ...filter }
    }
    return this
  }

  /**
   * Equals
   */
  equals(value: unknown): Query<T> {
    const lastKey = Object.keys(this._filter).pop()
    if (lastKey) {
      this._filter[lastKey] = value
    }
    return this
  }

  /**
   * Greater than
   */
  gt(field: string, value: unknown): Query<T> {
    this._filter[field] = { $gt: value }
    return this
  }

  /**
   * Greater than or equal
   */
  gte(field: string, value: unknown): Query<T> {
    this._filter[field] = { $gte: value }
    return this
  }

  /**
   * Less than
   */
  lt(field: string, value: unknown): Query<T> {
    this._filter[field] = { $lt: value }
    return this
  }

  /**
   * Less than or equal
   */
  lte(field: string, value: unknown): Query<T> {
    this._filter[field] = { $lte: value }
    return this
  }

  /**
   * In array
   */
  in(field: string, values: unknown[]): Query<T> {
    this._filter[field] = { $in: values }
    return this
  }

  /**
   * Not in array
   */
  nin(field: string, values: unknown[]): Query<T> {
    this._filter[field] = { $nin: values }
    return this
  }

  /**
   * Regex match
   */
  regex(field: string, pattern: RegExp | string): Query<T> {
    this._filter[field] = { $regex: pattern }
    return this
  }

  /**
   * Or condition
   */
  or(conditions: MongoFilter[]): Query<T> {
    this._filter.$or = conditions
    return this
  }

  /**
   * And condition
   */
  and(conditions: MongoFilter[]): Query<T> {
    this._filter.$and = conditions
    return this
  }

  /**
   * Select fields
   */
  select(fields: string | string[] | Record<string, 0 | 1>): Query<T> {
    if (typeof fields === 'string') {
      this._projection = {}
      for (const field of fields.split(' ')) {
        if (field.startsWith('-')) {
          this._projection[field.slice(1)] = 0
        } else {
          this._projection[field] = 1
        }
      }
    } else if (Array.isArray(fields)) {
      this._projection = {}
      for (const field of fields) {
        this._projection[field] = 1
      }
    } else {
      this._projection = fields as ProjectionSpec
    }
    return this
  }

  /**
   * Sort
   */
  sort(spec: string | Record<string, 1 | -1>): Query<T> {
    if (typeof spec === 'string') {
      this._sort = {}
      for (const part of spec.split(' ')) {
        if (part.startsWith('-')) {
          this._sort[part.slice(1)] = -1
        } else {
          this._sort[part] = 1
        }
      }
    } else {
      this._sort = spec
    }
    return this
  }

  /**
   * Limit
   */
  limit(n: number): Query<T> {
    this._limit = n
    return this
  }

  /**
   * Skip
   */
  skip(n: number): Query<T> {
    this._skip = n
    return this
  }

  /**
   * Lean query (return plain objects)
   */
  lean(): Query<T> {
    this._lean = true
    return this
  }

  /**
   * Populate references
   */
  populate(options: string | PopulateOptions | PopulateOptions[]): Query<T> {
    if (typeof options === 'string') {
      this._populate.push({ path: options })
    } else if (Array.isArray(options)) {
      this._populate.push(...options)
    } else {
      this._populate.push(options)
    }
    return this
  }

  /**
   * Execute query and return array
   */
  async exec(): Promise<T[]> {
    const options: FindOptions = {
      filter: this._filter,
      projection: this._projection,
      sort: this._sort,
      limit: this._limit,
      skip: this._skip,
    }

    return this.collection.find(options) as Promise<T[]>
  }

  /**
   * Execute and return first result
   */
  async findOne(): Promise<T | null> {
    this._limit = 1
    const results = await this.exec()
    return results[0] ?? null
  }

  /**
   * Count documents
   */
  async countDocuments(): Promise<number> {
    return this.collection.countDocuments(this._filter)
  }

  /**
   * Then (for promise chaining)
   */
  then<R>(onFulfilled?: (value: T[]) => R | Promise<R>): Promise<R> {
    return this.exec().then(onFulfilled as (value: T[]) => R | Promise<R>)
  }
}

// ============================================================================
// Collection
// ============================================================================

export class Collection {
  private db: Db
  private name: string

  constructor(db: Db, name: string) {
    this.db = db
    this.name = name
  }

  get collectionName(): string {
    return this.name
  }

  /**
   * Insert one document
   */
  async insertOne(doc: Document): Promise<InsertOneResult> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).insertOne(this.name, doc)
  }

  /**
   * Insert many documents
   */
  async insertMany(docs: Document[], options?: { ordered?: boolean }): Promise<InsertManyResult> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).insertMany(this.name, docs, options)
  }

  /**
   * Find one document
   */
  async findOne(filter?: MongoFilter, options?: FindOptions): Promise<Document | null> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).findOne(this.name, filter, options)
  }

  /**
   * Find documents
   */
  async find(options?: FindOptions): Promise<Document[]> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).find(this.name, options)
  }

  /**
   * Update one document
   */
  async updateOne(filter: MongoFilter, update: MongoUpdate, options?: { upsert?: boolean }): Promise<UpdateResult> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).updateOne(this.name, filter, update, options)
  }

  /**
   * Update many documents
   */
  async updateMany(filter: MongoFilter, update: MongoUpdate, options?: { upsert?: boolean }): Promise<UpdateResult> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).updateMany(this.name, filter, update, options)
  }

  /**
   * Replace one document
   */
  async replaceOne(filter: MongoFilter, replacement: Document, options?: { upsert?: boolean }): Promise<UpdateResult> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).replaceOne(this.name, filter, replacement, options)
  }

  /**
   * Delete one document
   */
  async deleteOne(filter: MongoFilter): Promise<DeleteResult> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).deleteOne(this.name, filter)
  }

  /**
   * Delete many documents
   */
  async deleteMany(filter: MongoFilter): Promise<DeleteResult> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).deleteMany(this.name, filter)
  }

  /**
   * Find and update
   */
  async findOneAndUpdate(
    filter: MongoFilter,
    update: MongoUpdate,
    options?: { upsert?: boolean; returnDocument?: 'before' | 'after' }
  ): Promise<Document | null> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).findOneAndUpdate(this.name, filter, update, options)
  }

  /**
   * Find and delete
   */
  async findOneAndDelete(filter: MongoFilter): Promise<Document | null> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).findOneAndDelete(this.name, filter)
  }

  /**
   * Aggregate
   */
  async aggregate(pipeline: AggregationStage[]): Promise<Document[]> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).aggregate(this.name, pipeline)
  }

  /**
   * Count documents
   */
  async countDocuments(filter?: MongoFilter): Promise<number> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).countDocuments(this.name, filter)
  }

  /**
   * Estimated document count
   */
  async estimatedDocumentCount(): Promise<number> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).estimatedDocumentCount(this.name)
  }

  /**
   * Distinct values
   */
  async distinct(field: string, filter?: MongoFilter): Promise<unknown[]> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).distinct(this.name, field, filter)
  }

  /**
   * Create index
   */
  async createIndex(keys: Record<string, 1 | -1>, options?: { name?: string; unique?: boolean }): Promise<string> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).createIndex(this.name, keys, options)
  }

  /**
   * Drop index
   */
  async dropIndex(name: string): Promise<void> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).dropIndex(this.name, name)
  }

  /**
   * List indexes
   */
  async listIndexes(): Promise<IndexInfo[]> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).listIndexes(this.name)
  }

  /**
   * Bulk write
   */
  async bulkWrite(operations: BulkOperation[]): Promise<BulkWriteResult> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).bulkWrite(this.name, operations)
  }

  /**
   * Drop collection
   */
  async drop(): Promise<boolean> {
    const stub = this.db._getDbStub()
    return (stub as unknown as MongoDO).dropCollection(this.name)
  }
}

// ============================================================================
// Database
// ============================================================================

export class Db {
  private client: MongoClient
  private name: string
  private stub: DurableObjectStub | null = null

  constructor(client: MongoClient, name: string) {
    this.client = client
    this.name = name
  }

  get databaseName(): string {
    return this.name
  }

  /**
   * Get collection
   */
  collection(name: string): Collection {
    return new Collection(this, name)
  }

  /**
   * Create collection
   */
  async createCollection(name: string): Promise<Collection> {
    const stub = this._getDbStub() as unknown as MongoDO
    await stub.createCollection(name)
    return new Collection(this, name)
  }

  /**
   * List collections
   */
  async listCollections(): Promise<CollectionInfo[]> {
    const stub = this._getDbStub() as unknown as MongoDO
    return stub.listCollections()
  }

  /**
   * Drop collection
   */
  async dropCollection(name: string): Promise<boolean> {
    const stub = this._getDbStub() as unknown as MongoDO
    return stub.dropCollection(name)
  }

  /**
   * Run command
   */
  async command(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
    const stub = this._getDbStub() as unknown as MongoDO
    return stub.command(cmd)
  }

  /**
   * Get database stub (internal)
   */
  _getDbStub(): DurableObjectStub {
    if (!this.stub) {
      const env = this.client._getEnv()
      const ns = env.MONGO_DO as DurableObjectNamespace
      const id = ns.idFromName(this.name)
      this.stub = ns.get(id)
    }
    return this.stub
  }
}

// ============================================================================
// MongoClient
// ============================================================================

export class MongoClient {
  private env: MongoEnv
  private defaultDbName: string
  private connected = false

  constructor(env: MongoEnv, options?: ConnectOptions) {
    this.env = env
    this.defaultDbName = options?.dbName ?? 'test'
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<MongoClient> {
    this.connected = true
    return this
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    this.connected = false
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Get database
   */
  db(name?: string): Db {
    return new Db(this, name ?? this.defaultDbName)
  }

  /**
   * Start session
   */
  startSession(): ClientSession {
    return new ClientSessionImpl()
  }

  /**
   * Get environment (internal)
   */
  _getEnv(): MongoEnv {
    return this.env
  }
}

// ============================================================================
// Session Implementation
// ============================================================================

class ClientSessionImpl implements ClientSession {
  id = { id: new ObjectId() }
  private _inTransaction = false

  startTransaction(): void {
    this._inTransaction = true
  }

  async commitTransaction(): Promise<void> {
    this._inTransaction = false
  }

  async abortTransaction(): Promise<void> {
    this._inTransaction = false
  }

  async endSession(): Promise<void> {
    this._inTransaction = false
  }

  inTransaction(): boolean {
    return this._inTransaction
  }

  async withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    this.startTransaction()
    try {
      const result = await fn(this)
      await this.commitTransaction()
      return result
    } catch (error) {
      await this.abortTransaction()
      throw error
    }
  }
}

// ============================================================================
// Model Factory
// ============================================================================

/**
 * Create a mongoose-like model
 */
export function model<T extends Document>(
  name: string,
  schema: Schema<T>,
  collectionName?: string
): ModelClass<T> {
  const collection = collectionName ?? name.toLowerCase() + 's'

  return class extends Model<T> {
    static modelName = name
    static schema = schema
    static collection = collection

    constructor(doc?: Partial<T>) {
      super(doc)
    }
  } as unknown as ModelClass<T>
}

// ============================================================================
// Model Base Class
// ============================================================================

export abstract class Model<T extends Document = Document> {
  static modelName: string
  static schema: Schema
  static collection: string
  static db: Db

  _doc: T

  constructor(doc?: Partial<T>) {
    const schema = (this.constructor as typeof Model).schema
    const withDefaults = schema.applyDefaults(doc ?? {})
    const transformed = schema.transform(withDefaults)
    this._doc = transformed as T
  }

  /**
   * Get document value
   */
  get(path: string): unknown {
    return this._doc[path as keyof T]
  }

  /**
   * Set document value
   */
  set(path: string, value: unknown): this
  set(values: Partial<T>): this
  set(pathOrValues: string | Partial<T>, value?: unknown): this {
    if (typeof pathOrValues === 'string') {
      (this._doc as Record<string, unknown>)[pathOrValues] = value
    } else {
      Object.assign(this._doc, pathOrValues)
    }
    return this
  }

  /**
   * Convert to plain object
   */
  toObject(): T {
    return JSON.parse(JSON.stringify(this._doc))
  }

  /**
   * Convert to JSON
   */
  toJSON(): T {
    return this.toObject()
  }

  /**
   * Validate document
   */
  validate(): { valid: boolean; errors: string[] } {
    const schema = (this.constructor as typeof Model).schema
    return schema.validate(this._doc as Record<string, unknown>)
  }

  /**
   * Save document
   */
  async save(): Promise<this> {
    const validation = this.validate()
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`)
    }

    const ModelClass = this.constructor as typeof Model
    const collection = ModelClass.db?.collection(ModelClass.collection)

    if (!collection) {
      throw new Error('Model not connected to database')
    }

    const id = this._doc._id as string
    if (id) {
      await collection.replaceOne({ _id: id }, this._doc, { upsert: true })
    } else {
      const result = await collection.insertOne(this._doc)
      this._doc._id = result.insertedId as T['_id']
    }

    return this
  }

  /**
   * Remove document
   */
  async remove(): Promise<void> {
    const ModelClass = this.constructor as typeof Model
    const collection = ModelClass.db?.collection(ModelClass.collection)

    if (!collection) {
      throw new Error('Model not connected to database')
    }

    const id = this._doc._id as string
    if (id) {
      await collection.deleteOne({ _id: id })
    }
  }

  // Static methods
  static async find<T extends Document>(this: ModelClass<T>, filter?: MongoFilter): Promise<T[]> {
    const collection = this.db?.collection(this.collection)
    if (!collection) throw new Error('Model not connected to database')
    return collection.find({ filter }) as Promise<T[]>
  }

  static async findOne<T extends Document>(this: ModelClass<T>, filter?: MongoFilter): Promise<T | null> {
    const collection = this.db?.collection(this.collection)
    if (!collection) throw new Error('Model not connected to database')
    return collection.findOne(filter) as Promise<T | null>
  }

  static async findById<T extends Document>(this: ModelClass<T>, id: string): Promise<T | null> {
    return this.findOne({ _id: id })
  }

  static async create<T extends Document>(this: ModelClass<T>, doc: Partial<T> | Partial<T>[]): Promise<T | T[]> {
    const collection = this.db?.collection(this.collection)
    if (!collection) throw new Error('Model not connected to database')

    if (Array.isArray(doc)) {
      const schema = this.schema
      const docs = doc.map(d => schema.transform(schema.applyDefaults(d)))
      await collection.insertMany(docs)
      return docs as T[]
    }

    const schema = this.schema
    const processed = schema.transform(schema.applyDefaults(doc))
    await collection.insertOne(processed)
    return processed as T
  }

  static async updateOne<T extends Document>(
    this: ModelClass<T>,
    filter: MongoFilter,
    update: MongoUpdate
  ): Promise<UpdateResult> {
    const collection = this.db?.collection(this.collection)
    if (!collection) throw new Error('Model not connected to database')
    return collection.updateOne(filter, update)
  }

  static async updateMany<T extends Document>(
    this: ModelClass<T>,
    filter: MongoFilter,
    update: MongoUpdate
  ): Promise<UpdateResult> {
    const collection = this.db?.collection(this.collection)
    if (!collection) throw new Error('Model not connected to database')
    return collection.updateMany(filter, update)
  }

  static async deleteOne<T extends Document>(this: ModelClass<T>, filter: MongoFilter): Promise<DeleteResult> {
    const collection = this.db?.collection(this.collection)
    if (!collection) throw new Error('Model not connected to database')
    return collection.deleteOne(filter)
  }

  static async deleteMany<T extends Document>(this: ModelClass<T>, filter: MongoFilter): Promise<DeleteResult> {
    const collection = this.db?.collection(this.collection)
    if (!collection) throw new Error('Model not connected to database')
    return collection.deleteMany(filter)
  }

  static async countDocuments<T extends Document>(this: ModelClass<T>, filter?: MongoFilter): Promise<number> {
    const collection = this.db?.collection(this.collection)
    if (!collection) throw new Error('Model not connected to database')
    return collection.countDocuments(filter)
  }

  static async aggregate<T extends Document>(this: ModelClass<T>, pipeline: AggregationStage[]): Promise<Document[]> {
    const collection = this.db?.collection(this.collection)
    if (!collection) throw new Error('Model not connected to database')
    return collection.aggregate(pipeline)
  }
}

// Model class type
export interface ModelClass<T extends Document> {
  new (doc?: Partial<T>): Model<T>
  modelName: string
  schema: Schema<T>
  collection: string
  db: Db

  find(filter?: MongoFilter): Promise<T[]>
  findOne(filter?: MongoFilter): Promise<T | null>
  findById(id: string): Promise<T | null>
  create(doc: Partial<T> | Partial<T>[]): Promise<T | T[]>
  updateOne(filter: MongoFilter, update: MongoUpdate): Promise<UpdateResult>
  updateMany(filter: MongoFilter, update: MongoUpdate): Promise<UpdateResult>
  deleteOne(filter: MongoFilter): Promise<DeleteResult>
  deleteMany(filter: MongoFilter): Promise<DeleteResult>
  countDocuments(filter?: MongoFilter): Promise<number>
  aggregate(pipeline: AggregationStage[]): Promise<Document[]>
}

// ============================================================================
// Exports
// ============================================================================

export {
  MongoFilter,
  MongoUpdate,
  SortSpec,
  ProjectionSpec,
  AggregationStage,
  Document,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  FindOptions,
  IndexInfo,
  BulkOperation,
  BulkWriteResult,
}
