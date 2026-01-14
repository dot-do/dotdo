/**
 * @dotdo/couchdb - CouchDB-compatible API for Durable Objects
 *
 * Drop-in CouchDB replacement with MapReduce views, Mango queries,
 * and pluggable storage backends.
 *
 * @example
 * ```typescript
 * import { CouchDB } from '@dotdo/couchdb'
 *
 * const client = new CouchDB()
 * await client.createDatabase('mydb')
 *
 * const db = client.use('mydb')
 *
 * // Document CRUD
 * const result = await db.put({ _id: 'doc1', type: 'post', title: 'Hello' })
 * const doc = await db.get('doc1')
 *
 * // Mango queries
 * const posts = await db.find({ selector: { type: 'post' } })
 *
 * // MapReduce views
 * await db.put({
 *   _id: '_design/posts',
 *   views: {
 *     byType: { map: `function(doc) { emit(doc.type, doc); }` }
 *   }
 * })
 * const result = await db.view('posts', 'byType', { key: 'post' })
 * ```
 */

// Main client
export { CouchDB } from './client'
export type { CouchDBOptions } from './client'

// Database
export { Database } from './database'

// MapReduce
export {
  parseMapFunction,
  executeMapFunction,
  clearMapFunctionCache,
  getMapFunctionCacheSize,
  applyReduce,
} from './mapreduce'

// Types
export type {
  // Documents
  CouchDocument,
  AttachmentStub,
  WriteResult,
  BulkResult,

  // Database info
  DatabaseInfo,

  // allDocs
  AllDocsOptions,
  AllDocsResponse,
  AllDocsRow,

  // Find/Mango
  FindQuery,
  FindResponse,
  MangoSelector,
  MangoCondition,
  SortSpec,

  // Views
  ViewOptions,
  ViewResponse,
  ViewRow,
  DesignDocument,
  ViewDefinition,

  // Changes
  ChangesOptions,
  ChangesResponse,
  ChangeRow,

  // Replication
  ReplicateOptions,
  ReplicateResult,

  // MapReduce internals
  EmitResult,
  ParsedMapFunction,
} from './types'

// Backends
export type { Backend, StoredDocument, StoredRevision, StoredAttachment } from './backends/interface'
export { MemoryBackend } from './backends/memory'
