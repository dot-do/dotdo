/**
 * CouchDB Types
 *
 * Type definitions for CouchDB-compatible API.
 */

/**
 * A CouchDB document with required _id and optional _rev
 */
export interface CouchDocument {
  _id: string
  _rev?: string
  _deleted?: boolean
  _attachments?: Record<string, AttachmentStub>
  [key: string]: unknown
}

/**
 * Attachment stub included in document metadata
 */
export interface AttachmentStub {
  content_type: string
  digest?: string
  length: number
  stub: true
}

/**
 * Result of put/delete operations
 */
export interface WriteResult {
  ok: boolean
  id: string
  rev: string
}

/**
 * Result of bulk operations
 */
export interface BulkResult {
  ok?: boolean
  id: string
  rev?: string
  error?: string
  reason?: string
}

/**
 * Database info response
 */
export interface DatabaseInfo {
  db_name: string
  doc_count: number
  update_seq: string | number
  sizes?: {
    file: number
    external: number
    active: number
  }
}

/**
 * allDocs query options
 */
export interface AllDocsOptions {
  include_docs?: boolean
  startkey?: string
  endkey?: string
  keys?: string[]
  limit?: number
  skip?: number
  descending?: boolean
}

/**
 * allDocs response
 */
export interface AllDocsResponse {
  total_rows: number
  offset: number
  rows: AllDocsRow[]
}

/**
 * Single row in allDocs response
 */
export interface AllDocsRow {
  id: string
  key: string
  value: { rev: string }
  doc?: CouchDocument
}

/**
 * Mango find query
 */
export interface FindQuery {
  selector: MangoSelector
  limit?: number
  skip?: number
  sort?: SortSpec[]
  fields?: string[]
}

/**
 * Mango selector operators
 */
export interface MangoSelector {
  $and?: MangoSelector[]
  $or?: MangoSelector[]
  $not?: MangoSelector
  [field: string]: MangoCondition | unknown
}

/**
 * Mango comparison operators
 */
export interface MangoCondition {
  $eq?: unknown
  $ne?: unknown
  $gt?: unknown
  $gte?: unknown
  $lt?: unknown
  $lte?: unknown
  $in?: unknown[]
  $nin?: unknown[]
  $exists?: boolean
  $regex?: string
  $not?: MangoCondition
}

/**
 * Sort specification
 */
export interface SortSpec {
  [field: string]: 'asc' | 'desc'
}

/**
 * Find response
 */
export interface FindResponse {
  docs: CouchDocument[]
  warning?: string
  bookmark?: string
}

/**
 * View query options
 */
export interface ViewOptions {
  key?: unknown
  keys?: unknown[]
  startkey?: unknown
  endkey?: unknown
  include_docs?: boolean
  limit?: number
  skip?: number
  descending?: boolean
  reduce?: boolean
  group?: boolean
  group_level?: number
}

/**
 * View query response
 */
export interface ViewResponse {
  total_rows?: number
  offset?: number
  rows: ViewRow[]
}

/**
 * Single row in view response
 */
export interface ViewRow {
  id?: string
  key: unknown
  value: unknown
  doc?: CouchDocument
}

/**
 * Design document structure
 */
export interface DesignDocument extends CouchDocument {
  views?: Record<string, ViewDefinition>
  language?: string
}

/**
 * View definition in design document
 */
export interface ViewDefinition {
  map: string
  reduce?: string | '_count' | '_sum' | '_stats'
}

/**
 * Changes feed options
 */
export interface ChangesOptions {
  since?: string | number
  include_docs?: boolean
  limit?: number
  descending?: boolean
}

/**
 * Changes feed response
 */
export interface ChangesResponse {
  results: ChangeRow[]
  last_seq: string | number
}

/**
 * Single row in changes feed
 */
export interface ChangeRow {
  seq: string | number
  id: string
  changes: { rev: string }[]
  deleted?: boolean
  doc?: CouchDocument
}

/**
 * Replication options
 */
export interface ReplicateOptions {
  create_target?: boolean
  continuous?: boolean
}

/**
 * Replication result
 */
export interface ReplicateResult {
  ok: boolean
  session_id?: string
  source_last_seq?: string | number
  docs_read: number
  docs_written: number
  doc_write_failures: number
}

/**
 * Result of a single emit() call in a map function
 */
export interface EmitResult {
  key: unknown
  value: unknown
}

/**
 * Parsed map function that can be executed
 */
export type ParsedMapFunction = (doc: CouchDocument) => EmitResult[]
