/**
 * DocumentStore Types
 *
 * Type definitions for schema-free JSON document storage.
 */

import type { CDCEmitter } from '../cdc'

/**
 * Base document metadata fields
 */
export interface DocumentMetadata {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  $version: number
}

/**
 * Document type with metadata
 */
export type Document<T> = T & DocumentMetadata

/**
 * Input for creating a document (metadata is optional/auto-generated)
 */
export type CreateInput<T> = Partial<Pick<DocumentMetadata, '$id'>> &
  Omit<T, keyof DocumentMetadata>

/**
 * Update input - partial document or dot-notation path updates
 */
export type UpdateInput = Record<string, unknown>

/**
 * CDC Event types
 */
export interface CDCEvent {
  type: 'cdc.insert' | 'cdc.update' | 'cdc.delete'
  op: 'c' | 'u' | 'd'
  store: 'document'
  table: string
  key: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

/**
 * Query operators
 */
export interface QueryOperators {
  $eq?: unknown
  $ne?: unknown
  $gt?: unknown
  $gte?: unknown
  $lt?: unknown
  $lte?: unknown
  $in?: unknown[]
  $nin?: unknown[]
  $like?: string
  $regex?: string
  $options?: string
  $exists?: boolean
}

/**
 * Query condition - either a value or operators
 */
export type QueryCondition = unknown | QueryOperators

/**
 * Where clause - field to condition mapping
 */
export interface WhereClause {
  [field: string]: QueryCondition
  $and?: WhereClause[]
  $or?: WhereClause[]
  $not?: WhereClause
}

/**
 * Order specification
 */
export type OrderDirection = 'asc' | 'desc'
export type OrderBy = Record<string, OrderDirection> | Record<string, OrderDirection>[]

/**
 * Query options
 */
export interface QueryOptions {
  where?: WhereClause
  limit?: number
  offset?: number
  cursor?: string
  orderBy?: OrderBy
}

/**
 * Count options
 */
export interface CountOptions {
  where?: WhereClause
}

/**
 * Bloom filter interface
 */
export interface BloomFilter {
  mightContain(value: string): boolean
  add(value: string): void
}

/**
 * DocumentStore options
 */
export interface DocumentStoreOptions {
  type: string
  onEvent?: (event: CDCEvent) => void
  /** Optional unified CDC emitter for pipeline integration */
  cdcEmitter?: CDCEmitter
}

/**
 * Row from SQLite documents table
 */
export interface DocumentRow {
  $id: string
  $type: string
  data: string
  $createdAt: number
  $updatedAt: number
  $version: number
}

/**
 * Upsert filter
 */
export interface UpsertFilter {
  $id: string
}
