/**
 * Backend Interface for MongoDB-compatible storage
 */

import type {
  Document,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  FindOptions,
  MongoFilter,
  MongoUpdate,
  UpdateOptions,
} from '../types'

/** Backend interface for different storage implementations */
export interface Backend {
  /** Insert a single document */
  insertOne(db: string, collection: string, doc: Document): Promise<InsertOneResult>

  /** Insert multiple documents */
  insertMany(db: string, collection: string, docs: Document[]): Promise<InsertManyResult>

  /** Find documents matching filter */
  find(db: string, collection: string, filter: MongoFilter, options?: FindOptions): Promise<Document[]>

  /** Find a single document */
  findOne(db: string, collection: string, filter: MongoFilter, options?: FindOptions): Promise<Document | null>

  /** Update a single document */
  updateOne(
    db: string,
    collection: string,
    filter: MongoFilter,
    update: MongoUpdate,
    options?: UpdateOptions
  ): Promise<UpdateResult>

  /** Update multiple documents */
  updateMany(
    db: string,
    collection: string,
    filter: MongoFilter,
    update: MongoUpdate,
    options?: UpdateOptions
  ): Promise<UpdateResult>

  /** Delete a single document */
  deleteOne(db: string, collection: string, filter: MongoFilter): Promise<DeleteResult>

  /** Delete multiple documents */
  deleteMany(db: string, collection: string, filter: MongoFilter): Promise<DeleteResult>

  /** Count documents matching filter */
  countDocuments(db: string, collection: string, filter?: MongoFilter): Promise<number>
}
