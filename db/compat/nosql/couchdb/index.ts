/**
 * @dotdo/couchdb
 *
 * CouchDB SDK compatibility layer (nano style)
 * Drop-in replacement for nano backed by DO SQLite with JSON storage.
 *
 * @example
 * ```typescript
 * import nano from '@dotdo/couchdb'
 *
 * const couch = nano('http://localhost:5984')
 *
 * // Create database
 * await couch.db.create('mydb')
 * const db = couch.use('mydb')
 *
 * // Document CRUD with revisions
 * const doc = await db.insert({ name: 'Alice', age: 30 })
 * const retrieved = await db.get(doc.id)
 * await db.destroy(doc.id, doc.rev)
 *
 * // Bulk operations
 * const docs = await db.bulk({ docs: [{ name: 'Bob' }, { name: 'Carol' }] })
 *
 * // Views (MapReduce)
 * const result = await db.view('design', 'view', { key: 'value' })
 *
 * // Find (Mango queries)
 * const found = await db.find({
 *   selector: { name: { $eq: 'Alice' } },
 *   fields: ['name', 'age']
 * })
 *
 * // List all documents
 * const all = await db.list({ include_docs: true })
 *
 * // Attachments
 * await db.attachment.insert(doc.id, 'file.txt', 'Hello', 'text/plain', { rev: doc.rev })
 * const data = await db.attachment.get(doc.id, 'file.txt')
 *
 * // Changes feed
 * const changes = await db.changes({ since: 0, include_docs: true })
 *
 * // Replication
 * await couch.db.replicate('source', 'target')
 * ```
 *
 * @see https://github.com/apache/couchdb-nano
 */

// Re-export main function and error class
export { default, nano, CouchError } from './couchdb'

// Re-export types
export type {
  // Core types
  Document,
  DocumentWithRevision,
  ServerScope,
  DocumentScope,
  ServerConfig,
  ServerInfo,

  // Database types
  DatabaseInfo,
  DatabaseCreateOptions,
  OkResponse,

  // Document response types
  DocumentInsertResponse,
  DocumentGetResponse,
  DocumentDestroyResponse,
  DocumentRevisionResponse,

  // Bulk operations
  BulkModifyDocsWrapper,
  BulkDocsResponseItem,
  BulkGetRequest,
  BulkGetResponse,

  // Views
  ViewParams,
  ViewResponse,
  ViewRow,

  // List
  DocumentListParams,
  DocumentListResponse,

  // Mango queries
  MangoQuery,
  MangoSelector,
  MangoResponse,
  CreateIndexRequest,
  CreateIndexResponse,
  ListIndexesResponse,

  // Changes
  ChangesParams,
  ChangesResponse,
  ChangeItem,
  ChangesReader,

  // Replication
  ReplicationOptions,
  ReplicationResponse,

  // Design documents
  DesignDocument,

  // Attachments
  Attachments,
  AttachmentData,
  AttachmentStub,
  MultipartAttachment,
  MultipartGetResponse,

  // Security
  SecurityObject,

  // Search
  SearchParams,
  SearchResponse,

  // Other
  RevsDiffRequest,
  RevsDiffResponse,
  UUIDResponse,
  CouchDBError,
  RequestDefaults,
} from './types'
