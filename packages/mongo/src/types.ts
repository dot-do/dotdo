/**
 * MongoDB-compatible Type Definitions
 */

/** Document type representing a MongoDB document */
export interface Document {
  _id?: string
  [key: string]: unknown
}

/** Insert one result */
export interface InsertOneResult {
  acknowledged: boolean
  insertedId: string
}

/** Insert many result */
export interface InsertManyResult {
  acknowledged: boolean
  insertedCount: number
  insertedIds: string[]
}

/** Update result */
export interface UpdateResult {
  acknowledged: boolean
  matchedCount: number
  modifiedCount: number
  upsertedId?: string
  upsertedCount: number
}

/** Delete result */
export interface DeleteResult {
  acknowledged: boolean
  deletedCount: number
}

/** Find options */
export interface FindOptions {
  projection?: ProjectionSpec
  sort?: SortSpec
  limit?: number
  skip?: number
}

/** MongoDB query filter */
export interface MongoFilter {
  [key: string]: unknown
}

/** MongoDB update specification */
export interface MongoUpdate {
  $set?: Record<string, unknown>
  $unset?: Record<string, '' | 1>
  $inc?: Record<string, number>
  $push?: Record<string, unknown>
  $pull?: Record<string, unknown>
  $addToSet?: Record<string, unknown>
  $pop?: Record<string, 1 | -1>
  $min?: Record<string, unknown>
  $max?: Record<string, unknown>
  $mul?: Record<string, number>
  $rename?: Record<string, string>
}

/** Sort specification */
export interface SortSpec {
  [field: string]: 1 | -1
}

/** Projection specification */
export interface ProjectionSpec {
  [field: string]: 0 | 1
}

/** Update options */
export interface UpdateOptions {
  upsert?: boolean
}
