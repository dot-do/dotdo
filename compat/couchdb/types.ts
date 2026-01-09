/**
 * @dotdo/couchdb types
 *
 * CouchDB/nano-compatible type definitions
 * for the CouchDB SDK backed by Durable Objects with JSON storage
 *
 * @see https://github.com/apache/couchdb-nano
 */

// ============================================================================
// BASIC TYPES
// ============================================================================

/**
 * Base document type with CouchDB metadata
 */
export interface Document {
  _id?: string
  _rev?: string
  _deleted?: boolean
  _attachments?: Attachments
  _conflicts?: string[]
  _deleted_conflicts?: string[]
  _local_seq?: string
  _revisions?: {
    start: number
    ids: string[]
  }
  _revs_info?: Array<{
    rev: string
    status: 'available' | 'missing' | 'deleted'
  }>
  [key: string]: unknown
}

/**
 * Document with required _id and _rev
 */
export interface DocumentWithRevision extends Document {
  _id: string
  _rev: string
}

/**
 * Attachments object
 */
export interface Attachments {
  [name: string]: AttachmentData | AttachmentStub
}

/**
 * Full attachment data
 */
export interface AttachmentData {
  content_type: string
  data: string | ArrayBuffer
  digest?: string
  length?: number
}

/**
 * Attachment stub (when not fetching full data)
 */
export interface AttachmentStub {
  content_type: string
  digest: string
  length: number
  revpos: number
  stub: true
}

// ============================================================================
// SERVER TYPES
// ============================================================================

/**
 * Server configuration
 */
export interface ServerConfig {
  url: string
  auth?: {
    username: string
    password: string
  }
  cookie?: string
  requestDefaults?: RequestDefaults
}

/**
 * Request defaults
 */
export interface RequestDefaults {
  timeout?: number
  headers?: Record<string, string>
  agent?: unknown
}

/**
 * Server info response
 */
export interface ServerInfo {
  couchdb: string
  version: string
  git_sha: string
  uuid: string
  features: string[]
  vendor: {
    name: string
  }
}

/**
 * UUID response
 */
export interface UUIDResponse {
  uuids: string[]
}

// ============================================================================
// DATABASE TYPES
// ============================================================================

/**
 * Database info response
 */
export interface DatabaseInfo {
  db_name: string
  doc_count: number
  doc_del_count: number
  update_seq: string | number
  purge_seq: string | number
  compact_running: boolean
  disk_size: number
  data_size: number
  instance_start_time: string
  disk_format_version: number
  committed_update_seq: string | number
  compacted_seq?: string | number
  props?: {
    partitioned?: boolean
  }
}

/**
 * Database create options
 */
export interface DatabaseCreateOptions {
  partitioned?: boolean
  q?: number
  n?: number
}

/**
 * OK response
 */
export interface OkResponse {
  ok: boolean
}

// ============================================================================
// DOCUMENT RESPONSE TYPES
// ============================================================================

/**
 * Document insert response
 */
export interface DocumentInsertResponse {
  ok: boolean
  id: string
  rev: string
}

/**
 * Document get response (extends Document)
 */
export interface DocumentGetResponse extends Document {
  _id: string
  _rev: string
}

/**
 * Document destroy response
 */
export interface DocumentDestroyResponse {
  ok: boolean
  id: string
  rev: string
}

/**
 * Document revision response (for HEAD requests)
 */
export interface DocumentRevisionResponse {
  etag: string
  'content-length'?: number
}

// ============================================================================
// BULK OPERATIONS TYPES
// ============================================================================

/**
 * Bulk docs request wrapper
 */
export interface BulkModifyDocsWrapper {
  docs: Document[]
  new_edits?: boolean
}

/**
 * Bulk docs response item
 */
export interface BulkDocsResponseItem {
  ok?: boolean
  id?: string
  rev?: string
  error?: string
  reason?: string
}

/**
 * Bulk get request
 */
export interface BulkGetRequest {
  docs: Array<{
    id: string
    rev?: string
    atts_since?: string[]
  }>
  revs?: boolean
}

/**
 * Bulk get response
 */
export interface BulkGetResponse {
  results: Array<{
    id: string
    docs: Array<{
      ok?: DocumentGetResponse
      error?: {
        id: string
        rev: string
        error: string
        reason: string
      }
    }>
  }>
}

// ============================================================================
// VIEW TYPES
// ============================================================================

/**
 * View parameters
 */
export interface ViewParams {
  key?: unknown
  keys?: unknown[]
  startkey?: unknown
  endkey?: unknown
  startkey_docid?: string
  endkey_docid?: string
  limit?: number
  skip?: number
  descending?: boolean
  include_docs?: boolean
  inclusive_end?: boolean
  reduce?: boolean
  group?: boolean
  group_level?: number
  stale?: 'ok' | 'update_after'
  update?: 'true' | 'false' | 'lazy'
  update_seq?: boolean
  sorted?: boolean
}

/**
 * View response
 */
export interface ViewResponse<V = unknown, D = Document> {
  total_rows?: number
  offset?: number
  rows: Array<ViewRow<V, D>>
  update_seq?: string | number
}

/**
 * View row
 */
export interface ViewRow<V = unknown, D = Document> {
  id?: string
  key: unknown
  value: V
  doc?: D & { _id: string; _rev: string }
  error?: string
}

// ============================================================================
// LIST TYPES
// ============================================================================

/**
 * Document list parameters
 */
export interface DocumentListParams {
  include_docs?: boolean
  conflicts?: boolean
  descending?: boolean
  endkey?: string
  end_key?: string
  endkey_docid?: string
  end_key_doc_id?: string
  key?: string
  keys?: string[]
  limit?: number
  skip?: number
  startkey?: string
  start_key?: string
  startkey_docid?: string
  start_key_doc_id?: string
  update_seq?: boolean
}

/**
 * Document list response
 */
export interface DocumentListResponse<D = Document> {
  total_rows: number
  offset: number
  rows: Array<{
    id: string
    key: string
    value: { rev: string }
    doc?: D & { _id: string; _rev: string }
    error?: string
  }>
  update_seq?: string | number
}

// ============================================================================
// MANGO QUERY TYPES
// ============================================================================

/**
 * Mango selector operators
 */
export interface MangoSelector {
  $eq?: unknown
  $ne?: unknown
  $gt?: unknown
  $gte?: unknown
  $lt?: unknown
  $lte?: unknown
  $in?: unknown[]
  $nin?: unknown[]
  $exists?: boolean
  $type?: string
  $mod?: [number, number]
  $regex?: string
  $or?: MangoSelector[]
  $and?: MangoSelector[]
  $nor?: MangoSelector[]
  $not?: MangoSelector
  $all?: unknown[]
  $elemMatch?: MangoSelector
  $size?: number
  $allMatch?: MangoSelector
  $keyMapMatch?: MangoSelector
  [key: string]: unknown
}

/**
 * Mango query
 */
export interface MangoQuery {
  selector: MangoSelector | Record<string, unknown>
  fields?: string[]
  sort?: Array<string | Record<string, 'asc' | 'desc'>>
  limit?: number
  skip?: number
  bookmark?: string
  update?: boolean
  stable?: boolean
  stale?: string
  execution_stats?: boolean
  r?: number
  use_index?: string | [string, string]
}

/**
 * Mango response
 */
export interface MangoResponse<D = Document> {
  docs: Array<D & { _id: string; _rev: string }>
  bookmark?: string
  warning?: string
  execution_stats?: {
    total_keys_examined: number
    total_docs_examined: number
    total_quorum_docs_examined: number
    results_returned: number
    execution_time_ms: number
  }
}

// ============================================================================
// INDEX TYPES
// ============================================================================

/**
 * Create index request
 */
export interface CreateIndexRequest {
  index: {
    fields: Array<string | Record<string, 'asc' | 'desc'>>
    partial_filter_selector?: MangoSelector
  }
  ddoc?: string
  name?: string
  type?: 'json' | 'text'
  partial_filter_selector?: MangoSelector
}

/**
 * Create index response
 */
export interface CreateIndexResponse {
  result: 'created' | 'exists'
  id: string
  name: string
}

/**
 * List indexes response
 */
export interface ListIndexesResponse {
  total_rows: number
  indexes: Array<{
    ddoc: string | null
    name: string
    type: 'json' | 'text' | 'special'
    def: {
      fields: Array<Record<string, 'asc' | 'desc'>>
      partial_filter_selector?: MangoSelector
    }
  }>
}

// ============================================================================
// CHANGES TYPES
// ============================================================================

/**
 * Changes parameters
 */
export interface ChangesParams {
  doc_ids?: string[]
  conflicts?: boolean
  descending?: boolean
  feed?: 'normal' | 'longpoll' | 'continuous' | 'eventsource'
  filter?: string
  heartbeat?: number
  include_docs?: boolean
  attachments?: boolean
  att_encoding_info?: boolean
  last_event_id?: string
  limit?: number
  since?: string | number
  style?: 'main_only' | 'all_docs'
  timeout?: number
  view?: string
  seq_interval?: number
}

/**
 * Changes response
 */
export interface ChangesResponse<D = Document> {
  last_seq: string | number
  pending?: number
  results: Array<ChangeItem<D>>
}

/**
 * Change item
 */
export interface ChangeItem<D = Document> {
  id: string
  seq: string | number
  changes: Array<{ rev: string }>
  doc?: D & { _id: string; _rev: string }
  deleted?: boolean
}

/**
 * Changes reader interface
 */
export interface ChangesReader {
  start(params?: ChangesParams): void
  stop(): void
  get(seq?: string | number): Promise<ChangesResponse>
  on(event: 'change' | 'batch' | 'seq' | 'error' | 'end', callback: (...args: unknown[]) => void): void
  off(event: string, callback: (...args: unknown[]) => void): void
}

// ============================================================================
// REPLICATION TYPES
// ============================================================================

/**
 * Replication options
 */
export interface ReplicationOptions {
  cancel?: boolean
  continuous?: boolean
  create_target?: boolean
  doc_ids?: string[]
  filter?: string
  proxy?: string
  query_params?: Record<string, string>
  selector?: MangoSelector
  since_seq?: string | number
  source_proxy?: string
  target_proxy?: string
}

/**
 * Replication response
 */
export interface ReplicationResponse {
  ok: boolean
  session_id?: string
  source_last_seq?: string | number
  replication_id_version?: number
  history?: Array<{
    session_id: string
    start_time: string
    end_time: string
    start_last_seq: string | number
    end_last_seq: string | number
    recorded_seq: string | number
    missing_checked: number
    missing_found: number
    docs_read: number
    docs_written: number
    doc_write_failures: number
  }>
  docs_read?: number
  docs_written?: number
  doc_write_failures?: number
  start_time?: string
  end_time?: string
}

// ============================================================================
// DESIGN DOCUMENT TYPES
// ============================================================================

/**
 * Design document
 */
export interface DesignDocument extends Document {
  _id: string
  language?: string
  views?: Record<string, {
    map: string
    reduce?: string
  }>
  shows?: Record<string, string>
  lists?: Record<string, string>
  updates?: Record<string, string>
  filters?: Record<string, string>
  validate_doc_update?: string
  indexes?: Record<string, {
    analyzer?: string | { name: string; stopwords?: string[] }
    index: string
  }>
  rewrites?: Array<{
    from: string
    to: string
    method?: string
    query?: Record<string, string>
  }>
  options?: {
    local_seq?: boolean
    include_design?: boolean
  }
}

// ============================================================================
// SECURITY TYPES
// ============================================================================

/**
 * Security object
 */
export interface SecurityObject {
  admins?: {
    names?: string[]
    roles?: string[]
  }
  members?: {
    names?: string[]
    roles?: string[]
  }
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Search parameters
 */
export interface SearchParams {
  q: string
  bookmark?: string
  counts?: string[]
  drilldown?: string[][]
  group_field?: string
  group_limit?: number
  group_sort?: string[]
  highlight_fields?: string[]
  highlight_pre_tag?: string
  highlight_post_tag?: string
  highlight_number?: number
  highlight_size?: number
  include_docs?: boolean
  include_fields?: string[]
  limit?: number
  ranges?: Record<string, Record<string, unknown>>
  sort?: string | string[]
  stale?: 'ok'
}

/**
 * Search response
 */
export interface SearchResponse<D = Document> {
  total_rows: number
  bookmark: string
  rows: Array<{
    id: string
    order: number[]
    fields?: Record<string, unknown>
    doc?: D & { _id: string; _rev: string }
    highlights?: Record<string, string[]>
  }>
  counts?: Record<string, Record<string, number>>
  ranges?: Record<string, Record<string, number>>
  groups?: Array<{
    by: string
    total_rows: number
    rows: Array<{
      id: string
      order: number[]
      fields?: Record<string, unknown>
      doc?: D & { _id: string; _rev: string }
    }>
  }>
}

// ============================================================================
// MULTIPART TYPES
// ============================================================================

/**
 * Multipart attachment for insert
 */
export interface MultipartAttachment {
  name: string
  data: string | ArrayBuffer
  content_type: string
}

/**
 * Multipart get response
 */
export interface MultipartGetResponse<D = Document> {
  doc: D & { _id: string; _rev: string }
  attachments: Record<string, ArrayBuffer | string>
}

// ============================================================================
// REVS DIFF TYPES
// ============================================================================

/**
 * Revs diff request
 */
export interface RevsDiffRequest {
  [docId: string]: string[]
}

/**
 * Revs diff response
 */
export interface RevsDiffResponse {
  [docId: string]: {
    missing?: string[]
    possible_ancestors?: string[]
  }
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * CouchDB error interface
 */
export interface CouchDBError {
  error: string
  reason: string
  statusCode: number
}

// ============================================================================
// DOCUMENT SCOPE INTERFACE
// ============================================================================

/**
 * Document scope (database operations)
 */
export interface DocumentScope<D extends Document = Document> {
  // Info
  info(): Promise<DatabaseInfo>

  // Document operations
  insert(doc: D, params?: string | { docName?: string }): Promise<DocumentInsertResponse>
  get(docId: string, params?: { rev?: string; revs?: boolean; revs_info?: boolean; conflicts?: boolean; attachments?: boolean; att_encoding_info?: boolean }): Promise<DocumentGetResponse & D>
  destroy(docId: string, rev: string): Promise<DocumentDestroyResponse>
  head(docId: string): Promise<DocumentRevisionResponse>
  copy(srcDoc: string, destDoc: string, options?: { overwrite?: string }): Promise<DocumentInsertResponse>

  // Bulk operations
  bulk(docs: BulkModifyDocsWrapper): Promise<BulkDocsResponseItem[]>
  bulkGet(request: BulkGetRequest): Promise<BulkGetResponse>

  // List operations
  list(params?: DocumentListParams): Promise<DocumentListResponse<D>>
  fetch(options: { keys: string[] }): Promise<DocumentListResponse<D>>

  // View operations
  view<V = unknown>(designName: string, viewName: string, params?: ViewParams): Promise<ViewResponse<V, D>>

  // Mango query operations
  find(query: MangoQuery): Promise<MangoResponse<D>>
  createIndex(indexDef: CreateIndexRequest): Promise<CreateIndexResponse>
  listIndexes(): Promise<ListIndexesResponse>
  deleteIndex(ddoc: string, name: string): Promise<OkResponse>

  // Changes
  changes(params?: ChangesParams): Promise<ChangesResponse<D>>
  changesReader: ChangesReader

  // Attachments
  attachment: {
    insert(docId: string, attName: string, data: string | ArrayBuffer, contentType: string, params?: { rev?: string }): Promise<DocumentInsertResponse>
    get(docId: string, attName: string, params?: { rev?: string }): Promise<ArrayBuffer | string>
    getAsStream(docId: string, attName: string, params?: { rev?: string }): Promise<ReadableStream>
    destroy(docId: string, attName: string, params: { rev: string }): Promise<DocumentDestroyResponse>
  }

  // Multipart
  multipart: {
    insert(doc: D, attachments: MultipartAttachment[], params?: { docName?: string }): Promise<DocumentInsertResponse>
    get(docId: string, params?: { rev?: string; attachments?: boolean }): Promise<MultipartGetResponse<D>>
  }

  // Partitioned queries (for partitioned databases)
  partitionedList(partitionKey: string, params?: DocumentListParams): Promise<DocumentListResponse<D>>
  partitionedFind(partitionKey: string, query: MangoQuery): Promise<MangoResponse<D>>
  partitionedView<V = unknown>(partitionKey: string, designName: string, viewName: string, params?: ViewParams): Promise<ViewResponse<V, D>>

  // Update handlers
  updateWithHandler(designName: string, updateName: string, docId: string, body?: unknown): Promise<unknown>

  // Show functions
  show(designName: string, showName: string, docId: string): Promise<unknown>

  // Search
  search(designName: string, searchName: string, params: SearchParams): Promise<SearchResponse<D>>

  // Revisions
  revsDiff(revs: RevsDiffRequest): Promise<RevsDiffResponse>

  // Security
  security(secObj?: SecurityObject): Promise<SecurityObject | OkResponse>
}

// ============================================================================
// SERVER SCOPE INTERFACE
// ============================================================================

/**
 * Server scope (server-level operations)
 */
export interface ServerScope {
  config: ServerConfig

  // Server info
  info(): Promise<ServerInfo>

  // Database operations
  db: {
    create(name: string, options?: DatabaseCreateOptions): Promise<OkResponse>
    destroy(name: string): Promise<OkResponse>
    get(name: string): Promise<DatabaseInfo>
    list(): Promise<string[]>
    use<D extends Document = Document>(name: string): DocumentScope<D>
    compact(name: string, designDoc?: string): Promise<OkResponse>
    replicate(source: string, target: string, options?: ReplicationOptions): Promise<ReplicationResponse>
    changes(name: string, params?: ChangesParams): Promise<ChangesResponse>
  }

  // Shortcuts
  use<D extends Document = Document>(name: string): DocumentScope<D>
  scope<D extends Document = Document>(name: string): DocumentScope<D>

  // UUIDs
  uuids(count?: number): Promise<UUIDResponse>

  // Raw request
  request(options: { path: string; method?: string; body?: unknown; qs?: Record<string, unknown> }): Promise<unknown>

  // Session/auth
  session(): Promise<{ ok: boolean; userCtx: { name: string | null; roles: string[] } }>
  auth(username: string, password: string): Promise<{ ok: boolean; name: string; roles: string[] }>
}
