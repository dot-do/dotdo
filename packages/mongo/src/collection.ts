/**
 * MongoDB-compatible Collection
 */

import type { Backend } from './backends/interface'
import type {
  Document,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  MongoFilter,
  MongoUpdate,
  UpdateOptions,
  SortSpec,
  FindOptions,
} from './types'

/** Cursor for iterating over find results */
export class Cursor<T = Document> {
  private backend: Backend
  private dbName: string
  private collName: string
  private filter: MongoFilter
  private options: FindOptions

  constructor(
    backend: Backend,
    dbName: string,
    collName: string,
    filter: MongoFilter
  ) {
    this.backend = backend
    this.dbName = dbName
    this.collName = collName
    this.filter = filter
    this.options = {}
  }

  /** Set sort order */
  sort(spec: SortSpec): Cursor<T> {
    this.options.sort = spec
    return this
  }

  /** Set maximum documents to return */
  limit(n: number): Cursor<T> {
    this.options.limit = n
    return this
  }

  /** Set number of documents to skip */
  skip(n: number): Cursor<T> {
    this.options.skip = n
    return this
  }

  /** Execute and return array of documents */
  async toArray(): Promise<T[]> {
    const docs = await this.backend.find(this.dbName, this.collName, this.filter, this.options)
    return docs as T[]
  }
}

/** MongoDB-compatible Collection */
export class Collection<T extends Document = Document> {
  private backend: Backend
  private dbName: string
  private name: string

  constructor(backend: Backend, dbName: string, name: string) {
    this.backend = backend
    this.dbName = dbName
    this.name = name
  }

  /** Get collection name */
  get collectionName(): string {
    return this.name
  }

  /** Insert a single document */
  async insertOne(doc: T): Promise<InsertOneResult> {
    return this.backend.insertOne(this.dbName, this.name, doc)
  }

  /** Insert multiple documents */
  async insertMany(docs: T[]): Promise<InsertManyResult> {
    return this.backend.insertMany(this.dbName, this.name, docs)
  }

  /** Find documents matching filter */
  find(filter: MongoFilter): Cursor<T> {
    return new Cursor<T>(this.backend, this.dbName, this.name, filter)
  }

  /** Find a single document */
  async findOne(filter: MongoFilter): Promise<T | null> {
    const doc = await this.backend.findOne(this.dbName, this.name, filter)
    return doc as T | null
  }

  /** Update a single document */
  async updateOne(
    filter: MongoFilter,
    update: MongoUpdate,
    options?: UpdateOptions
  ): Promise<UpdateResult> {
    return this.backend.updateOne(this.dbName, this.name, filter, update, options)
  }

  /** Update multiple documents */
  async updateMany(
    filter: MongoFilter,
    update: MongoUpdate,
    options?: UpdateOptions
  ): Promise<UpdateResult> {
    return this.backend.updateMany(this.dbName, this.name, filter, update, options)
  }

  /** Delete a single document */
  async deleteOne(filter: MongoFilter): Promise<DeleteResult> {
    return this.backend.deleteOne(this.dbName, this.name, filter)
  }

  /** Delete multiple documents */
  async deleteMany(filter: MongoFilter): Promise<DeleteResult> {
    return this.backend.deleteMany(this.dbName, this.name, filter)
  }

  /** Count documents matching filter */
  async countDocuments(filter?: MongoFilter): Promise<number> {
    return this.backend.countDocuments(this.dbName, this.name, filter)
  }
}
