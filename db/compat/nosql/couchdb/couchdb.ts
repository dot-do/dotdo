/**
 * @dotdo/couchdb - CouchDB SDK compat (nano style)
 *
 * Drop-in replacement for nano backed by DO SQLite with JSON storage.
 * This in-memory implementation matches the CouchDB/nano API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://github.com/apache/couchdb-nano
 */
import type {
  ServerScope,
  DocumentScope,
  Document,
  ServerConfig,
  ServerInfo,
  DatabaseInfo,
  DatabaseCreateOptions,
  OkResponse,
  DocumentInsertResponse,
  DocumentGetResponse,
  DocumentDestroyResponse,
  DocumentRevisionResponse,
  BulkModifyDocsWrapper,
  BulkDocsResponseItem,
  BulkGetRequest,
  BulkGetResponse,
  ViewParams,
  ViewResponse,
  DocumentListParams,
  DocumentListResponse,
  MangoQuery,
  MangoResponse,
  MangoSelector,
  CreateIndexRequest,
  CreateIndexResponse,
  ListIndexesResponse,
  ChangesParams,
  ChangesResponse,
  ChangeItem,
  ChangesReader,
  ReplicationOptions,
  ReplicationResponse,
  SecurityObject,
  SearchParams,
  SearchResponse,
  MultipartAttachment,
  MultipartGetResponse,
  RevsDiffRequest,
  RevsDiffResponse,
  UUIDResponse,
  Attachments,
  AttachmentStub,
} from './types'

// ============================================================================
// COUCHDB ERROR
// ============================================================================

/**
 * CouchDB error class
 */
export class CouchError extends Error {
  error: string
  reason: string
  statusCode: number

  constructor(error: string, reason?: string) {
    super(`${error}: ${reason || error}`)
    this.name = 'CouchError'
    this.error = error
    this.reason = reason || error
    this.statusCode = CouchError.getStatusCode(error)
  }

  static getStatusCode(error: string): number {
    switch (error) {
      case 'not_found':
        return 404
      case 'conflict':
        return 409
      case 'bad_request':
        return 400
      case 'unauthorized':
        return 401
      case 'forbidden':
        return 403
      case 'file_exists':
        return 412
      case 'method_not_allowed':
        return 405
      case 'too_many_requests':
        return 429
      default:
        return 500
    }
  }
}

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

interface StoredDocument extends Document {
  _id: string
  _rev: string
  _revisions?: {
    start: number
    ids: string[]
  }
  _attachments?: Attachments
  _seq?: number
}

interface DatabaseStorage {
  docs: Map<string, StoredDocument>
  deleted: Map<string, StoredDocument>
  revHistory: Map<string, StoredDocument[]>
  indexes: Array<{
    ddoc: string | null
    name: string
    type: 'json' | 'text' | 'special'
    def: { fields: Array<Record<string, 'asc' | 'desc'>>; partial_filter_selector?: MangoSelector }
  }>
  security: SecurityObject
  partitioned: boolean
  seq: number
  changes: ChangeItem[]
}

/** Global storage for all databases */
const globalStorage = new Map<string, DatabaseStorage>()

/** Get or throw if database doesn't exist */
function getDatabase(name: string): DatabaseStorage {
  const db = globalStorage.get(name)
  if (!db) {
    throw new CouchError('not_found', `Database does not exist: ${name}`)
  }
  return db
}

/** Validate database name */
function validateDbName(name: string): void {
  if (!/^[a-z][a-z0-9_$()+/-]*$/.test(name)) {
    throw new CouchError('bad_request', `Name: '${name}'. Only lowercase characters (a-z), digits (0-9), and any of the characters _, $, (, ), +, -, and / are allowed. Must begin with a letter.`)
  }
}

/** Generate a revision string */
function generateRev(num: number, content: string): string {
  const hash = simpleHash(content).toString(16).padStart(32, '0')
  return `${num}-${hash}`
}

/** Simple hash function for revision generation */
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

/** Generate UUID */
function generateUUID(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/** Deep clone an object */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// ============================================================================
// MANGO QUERY MATCHING
// ============================================================================

function matchesSelector(doc: Document, selector: MangoSelector | Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(selector)) {
    if (key === '$and') {
      const conditions = condition as MangoSelector[]
      if (!conditions.every(c => matchesSelector(doc, c))) return false
      continue
    }
    if (key === '$or') {
      const conditions = condition as MangoSelector[]
      if (!conditions.some(c => matchesSelector(doc, c))) return false
      continue
    }
    if (key === '$nor') {
      const conditions = condition as MangoSelector[]
      if (conditions.some(c => matchesSelector(doc, c))) return false
      continue
    }
    if (key === '$not') {
      if (matchesSelector(doc, condition as MangoSelector)) return false
      continue
    }

    const value = getNestedValue(doc, key)

    if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
      if (!matchesCondition(value, condition as MangoSelector)) return false
    } else {
      if (!deepEquals(value, condition)) return false
    }
  }
  return true
}

function matchesCondition(value: unknown, condition: MangoSelector): boolean {
  for (const [op, opValue] of Object.entries(condition)) {
    switch (op) {
      case '$eq':
        if (!deepEquals(value, opValue)) return false
        break
      case '$ne':
        if (deepEquals(value, opValue)) return false
        break
      case '$gt':
        if (compareValues(value, opValue) <= 0) return false
        break
      case '$gte':
        if (compareValues(value, opValue) < 0) return false
        break
      case '$lt':
        if (compareValues(value, opValue) >= 0) return false
        break
      case '$lte':
        if (compareValues(value, opValue) > 0) return false
        break
      case '$in':
        if (!Array.isArray(opValue)) return false
        if (!opValue.some(v => deepEquals(value, v))) return false
        break
      case '$nin':
        if (!Array.isArray(opValue)) return false
        if (opValue.some(v => deepEquals(value, v))) return false
        break
      case '$exists':
        const exists = value !== undefined
        if (opValue !== exists) return false
        break
      case '$regex':
        if (typeof value !== 'string') return false
        if (!new RegExp(opValue as string).test(value)) return false
        break
      case '$size':
        if (!Array.isArray(value) || value.length !== opValue) return false
        break
      case '$all':
        if (!Array.isArray(value) || !Array.isArray(opValue)) return false
        if (!opValue.every(v => value.some(ve => deepEquals(ve, v)))) return false
        break
      case '$elemMatch':
        if (!Array.isArray(value)) return false
        if (!value.some(v => matchesCondition(v, opValue as MangoSelector))) return false
        break
      case '$not':
        if (matchesCondition(value, opValue as MangoSelector)) return false
        break
      default:
        if (!op.startsWith('$')) {
          // Nested field match
          continue
        }
        break
    }
  }
  return true
}

function getNestedValue(doc: Document, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = doc
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Document)[part]
  }
  return current
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
  return String(a).localeCompare(String(b))
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (a === undefined || b === undefined) return a === b
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEquals(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object)
    const keysB = Object.keys(b as object)
    if (keysA.length !== keysB.length) return false
    return keysA.every(key => deepEquals((a as Document)[key], (b as Document)[key]))
  }
  return false
}

// ============================================================================
// VIEW EXECUTION
// ============================================================================

interface DesignDocViews {
  [viewName: string]: {
    map: string
    reduce?: string
  }
}

function executeView(
  db: DatabaseStorage,
  designDoc: StoredDocument,
  viewName: string,
  params: ViewParams
): ViewResponse {
  const views = designDoc.views as DesignDocViews | undefined
  if (!views || !views[viewName]) {
    throw new CouchError('not_found', `missing named view ${viewName}`)
  }

  const view = views[viewName]
  const results: Array<{ id: string; key: unknown; value: unknown }> = []

  // Simple map function execution (mock - real impl would use isolate)
  const mapFn = createMapFunction(view.map)

  for (const doc of db.docs.values()) {
    if (doc._id.startsWith('_design/')) continue
    const emitted: Array<{ key: unknown; value: unknown }> = []
    const emit = (key: unknown, value: unknown) => {
      emitted.push({ key, value })
    }
    try {
      mapFn(doc, emit)
      for (const e of emitted) {
        results.push({ id: doc._id, key: e.key, value: e.value })
      }
    } catch {
      // Skip docs that error in map function
    }
  }

  // Sort by key
  results.sort((a, b) => compareValues(a.key, b.key))

  // Apply descending
  if (params.descending) {
    results.reverse()
  }

  // Filter by key/keys/startkey/endkey
  let filtered = results
  if (params.key !== undefined) {
    filtered = filtered.filter(r => deepEquals(r.key, params.key))
  }
  if (params.keys !== undefined) {
    filtered = filtered.filter(r => params.keys!.some(k => deepEquals(r.key, k)))
  }
  if (params.startkey !== undefined) {
    const cmp = params.descending ? 1 : -1
    filtered = filtered.filter(r => {
      const c = compareValues(r.key, params.startkey)
      return params.descending ? c <= 0 : c >= 0
    })
  }
  if (params.endkey !== undefined) {
    const inclusive = params.inclusive_end !== false
    filtered = filtered.filter(r => {
      const c = compareValues(r.key, params.endkey)
      if (params.descending) {
        return inclusive ? c >= 0 : c > 0
      }
      return inclusive ? c <= 0 : c < 0
    })
  }

  // Handle reduce
  if (view.reduce && params.reduce !== false) {
    return executeReduce(filtered, view.reduce, params)
  }

  // Apply skip and limit
  const skip = params.skip || 0
  const limit = params.limit !== undefined ? params.limit : filtered.length
  const sliced = filtered.slice(skip, skip + limit)

  // Build response
  const rows = sliced.map(r => {
    const row: { id?: string; key: unknown; value: unknown; doc?: Document } = {
      id: r.id,
      key: r.key,
      value: r.value,
    }
    if (params.include_docs) {
      const doc = db.docs.get(r.id)
      if (doc) {
        row.doc = deepClone(doc)
      }
    }
    return row
  })

  return {
    total_rows: results.length,
    offset: skip,
    rows,
  }
}

function createMapFunction(mapStr: string): (doc: Document, emit: (key: unknown, value: unknown) => void) => void {
  // Parse simple map functions
  // In production this would use a JS isolate
  return (doc: Document, emit: (key: unknown, value: unknown) => void) => {
    // Very simple parser for common patterns
    const emitMatch = mapStr.match(/emit\s*\(\s*doc\.(\w+)\s*,\s*(?:doc\.(\w+)|(\d+)|null)\s*\)/)
    if (emitMatch) {
      const keyField = emitMatch[1]
      const valueField = emitMatch[2]
      const numValue = emitMatch[3]

      if (doc[keyField] !== undefined) {
        if (valueField) {
          emit(doc[keyField], doc[valueField])
        } else if (numValue) {
          emit(doc[keyField], parseInt(numValue))
        } else {
          emit(doc[keyField], null)
        }
      }
    }
  }
}

function executeReduce(
  results: Array<{ id: string; key: unknown; value: unknown }>,
  reduce: string,
  params: ViewParams
): ViewResponse {
  if (params.group) {
    // Group by key
    const groups = new Map<string, Array<{ id: string; key: unknown; value: unknown }>>()
    for (const r of results) {
      const keyStr = JSON.stringify(r.key)
      if (!groups.has(keyStr)) {
        groups.set(keyStr, [])
      }
      groups.get(keyStr)!.push(r)
    }

    const rows: Array<{ key: unknown; value: unknown }> = []
    for (const [keyStr, groupResults] of groups) {
      const key = JSON.parse(keyStr)
      const value = applyReduceFunction(reduce, groupResults)
      rows.push({ key, value })
    }

    return { rows }
  }

  // Single reduce
  const value = applyReduceFunction(reduce, results)
  return { rows: [{ key: null, value }] }
}

function applyReduceFunction(reduce: string, results: Array<{ value: unknown }>): unknown {
  if (reduce === '_count') {
    return results.length
  }
  if (reduce === '_sum') {
    return results.reduce((acc, r) => acc + (typeof r.value === 'number' ? r.value : 0), 0)
  }
  if (reduce === '_stats') {
    const values = results.map(r => typeof r.value === 'number' ? r.value : 0)
    const sum = values.reduce((a, b) => a + b, 0)
    const min = Math.min(...values)
    const max = Math.max(...values)
    return { sum, count: values.length, min, max, sumsqr: values.reduce((a, b) => a + b * b, 0) }
  }
  return results.length
}

// ============================================================================
// DOCUMENT SCOPE IMPLEMENTATION
// ============================================================================

class DocumentScopeImpl<D extends Document = Document> implements DocumentScope<D> {
  private dbName: string

  constructor(dbName: string) {
    this.dbName = dbName
  }

  private getDb(): DatabaseStorage {
    return getDatabase(this.dbName)
  }

  async info(): Promise<DatabaseInfo> {
    const db = this.getDb()
    let dataSize = 0
    for (const doc of db.docs.values()) {
      dataSize += JSON.stringify(doc).length
    }

    return {
      db_name: this.dbName,
      doc_count: db.docs.size,
      doc_del_count: db.deleted.size,
      update_seq: db.seq,
      purge_seq: 0,
      compact_running: false,
      disk_size: dataSize,
      data_size: dataSize,
      instance_start_time: '0',
      disk_format_version: 8,
      committed_update_seq: db.seq,
      props: db.partitioned ? { partitioned: true } : undefined,
    }
  }

  async insert(doc: D, params?: string | { docName?: string }): Promise<DocumentInsertResponse> {
    const db = this.getDb()
    const docClone = deepClone(doc) as StoredDocument

    // Determine doc ID
    let docId = docClone._id
    if (!docId) {
      if (typeof params === 'string') {
        docId = params
      } else if (params?.docName) {
        docId = params.docName
      } else {
        docId = generateUUID()
      }
    }
    docClone._id = docId

    const existing = db.docs.get(docId)

    if (existing) {
      // Update - requires matching _rev
      if (!docClone._rev) {
        throw new CouchError('conflict', 'Document update conflict.')
      }
      if (docClone._rev !== existing._rev) {
        throw new CouchError('conflict', 'Document update conflict.')
      }

      // Generate new revision
      const revNum = parseInt(existing._rev.split('-')[0]) + 1
      const newRev = generateRev(revNum, JSON.stringify(docClone))
      docClone._rev = newRev

      // Store revision history
      if (!db.revHistory.has(docId)) {
        db.revHistory.set(docId, [])
      }
      db.revHistory.get(docId)!.push(deepClone(existing))

      docClone._revisions = {
        start: revNum,
        ids: [newRev.split('-')[1], ...(existing._revisions?.ids || [existing._rev.split('-')[1]])],
      }
    } else {
      // New document
      if (docClone._rev) {
        // Check if we're doing a forced insert (new_edits: false scenario)
        // Allow if _rev is provided
      }
      const newRev = docClone._rev || generateRev(1, JSON.stringify(docClone))
      docClone._rev = newRev
      docClone._revisions = {
        start: 1,
        ids: [newRev.split('-')[1]],
      }
    }

    // Update seq and record change
    db.seq++
    docClone._seq = db.seq

    db.docs.set(docId, docClone)

    // Record change
    db.changes.push({
      id: docId,
      seq: db.seq,
      changes: [{ rev: docClone._rev }],
    })

    return {
      ok: true,
      id: docId,
      rev: docClone._rev,
    }
  }

  async get(
    docId: string,
    params?: { rev?: string; revs?: boolean; revs_info?: boolean; conflicts?: boolean; attachments?: boolean }
  ): Promise<DocumentGetResponse & D> {
    const db = this.getDb()
    let doc: StoredDocument | undefined

    if (params?.rev) {
      // Get specific revision
      const history = db.revHistory.get(docId)
      if (history) {
        doc = history.find(d => d._rev === params.rev)
      }
      if (!doc) {
        const current = db.docs.get(docId)
        if (current && current._rev === params.rev) {
          doc = current
        }
      }
    } else {
      doc = db.docs.get(docId)
    }

    if (!doc) {
      const deleted = db.deleted.get(docId)
      if (deleted) {
        throw new CouchError('not_found', 'deleted')
      }
      throw new CouchError('not_found', 'missing')
    }

    const result = deepClone(doc) as DocumentGetResponse & D

    if (params?.revs) {
      result._revisions = doc._revisions
    } else {
      delete result._revisions
    }

    if (params?.revs_info) {
      const revs: Array<{ rev: string; status: 'available' | 'missing' | 'deleted' }> = []
      revs.push({ rev: doc._rev, status: 'available' })

      const history = db.revHistory.get(docId)
      if (history) {
        for (const h of history.reverse()) {
          revs.push({ rev: h._rev, status: 'available' })
        }
      }
      result._revs_info = revs
    }

    delete result._seq

    return result
  }

  async destroy(docId: string, rev: string): Promise<DocumentDestroyResponse> {
    const db = this.getDb()
    const doc = db.docs.get(docId)

    if (!doc) {
      throw new CouchError('not_found', 'missing')
    }

    if (doc._rev !== rev) {
      throw new CouchError('conflict', 'Document update conflict.')
    }

    // Generate deletion revision
    const revNum = parseInt(rev.split('-')[0]) + 1
    const newRev = generateRev(revNum, `deleted:${docId}`)

    // Store in revision history
    if (!db.revHistory.has(docId)) {
      db.revHistory.set(docId, [])
    }
    db.revHistory.get(docId)!.push(deepClone(doc))

    // Move to deleted
    const deletedDoc = { ...doc, _rev: newRev, _deleted: true }
    db.deleted.set(docId, deletedDoc)
    db.docs.delete(docId)

    // Update seq and record change
    db.seq++
    db.changes.push({
      id: docId,
      seq: db.seq,
      changes: [{ rev: newRev }],
      deleted: true,
    })

    return {
      ok: true,
      id: docId,
      rev: newRev,
    }
  }

  async head(docId: string): Promise<DocumentRevisionResponse> {
    const db = this.getDb()
    const doc = db.docs.get(docId)

    if (!doc) {
      throw new CouchError('not_found', 'missing')
    }

    return {
      etag: doc._rev,
      'content-length': JSON.stringify(doc).length,
    }
  }

  async copy(srcDoc: string, destDoc: string, options?: { overwrite?: string }): Promise<DocumentInsertResponse> {
    const db = this.getDb()
    const src = db.docs.get(srcDoc)

    if (!src) {
      throw new CouchError('not_found', 'missing')
    }

    const newDoc = deepClone(src) as D
    delete (newDoc as { _rev?: string })._rev
    newDoc._id = destDoc

    if (options?.overwrite) {
      (newDoc as StoredDocument)._rev = options.overwrite
    }

    return this.insert(newDoc)
  }

  async bulk(docs: BulkModifyDocsWrapper): Promise<BulkDocsResponseItem[]> {
    const results: BulkDocsResponseItem[] = []

    for (const doc of docs.docs) {
      try {
        if (doc._deleted && doc._id && doc._rev) {
          const result = await this.destroy(doc._id, doc._rev)
          results.push({ ok: true, id: result.id, rev: result.rev })
        } else {
          // For new_edits: false, allow forced revision
          if (docs.new_edits === false && doc._rev) {
            const db = this.getDb()
            const stored = deepClone(doc) as StoredDocument
            if (!stored._id) {
              stored._id = generateUUID()
            }
            stored._revisions = {
              start: parseInt(stored._rev.split('-')[0]),
              ids: [stored._rev.split('-')[1]],
            }
            db.seq++
            stored._seq = db.seq
            db.docs.set(stored._id, stored)
            db.changes.push({
              id: stored._id,
              seq: db.seq,
              changes: [{ rev: stored._rev }],
            })
            results.push({ ok: true, id: stored._id, rev: stored._rev })
          } else {
            const result = await this.insert(doc as D)
            results.push({ ok: true, id: result.id, rev: result.rev })
          }
        }
      } catch (e) {
        const err = e as CouchError
        results.push({
          id: doc._id,
          error: err.error,
          reason: err.reason,
        })
      }
    }

    return results
  }

  async bulkGet(request: BulkGetRequest): Promise<BulkGetResponse> {
    const results: BulkGetResponse['results'] = []

    for (const docReq of request.docs) {
      try {
        const doc = await this.get(docReq.id, { rev: docReq.rev })
        results.push({
          id: docReq.id,
          docs: [{ ok: doc }],
        })
      } catch (e) {
        const err = e as CouchError
        results.push({
          id: docReq.id,
          docs: [
            {
              error: {
                id: docReq.id,
                rev: docReq.rev || '',
                error: err.error,
                reason: err.reason,
              },
            },
          ],
        })
      }
    }

    return { results }
  }

  async list(params?: DocumentListParams): Promise<DocumentListResponse<D>> {
    const db = this.getDb()
    let docs = Array.from(db.docs.values())

    // Filter out design docs for normal list
    docs = docs.filter(d => !d._id.startsWith('_design/'))

    // Sort by _id
    docs.sort((a, b) => a._id.localeCompare(b._id))

    // Apply descending
    if (params?.descending) {
      docs.reverse()
    }

    // Filter by keys
    if (params?.keys) {
      docs = docs.filter(d => params.keys!.includes(d._id))
      // Maintain keys order
      docs.sort((a, b) => params.keys!.indexOf(a._id) - params.keys!.indexOf(b._id))
    }

    // Filter by startkey/endkey
    if (params?.startkey || params?.start_key) {
      const startkey = params.startkey || params.start_key
      docs = docs.filter(d => {
        const cmp = d._id.localeCompare(startkey!)
        return params.descending ? cmp <= 0 : cmp >= 0
      })
    }
    if (params?.endkey || params?.end_key) {
      const endkey = params.endkey || params.end_key
      docs = docs.filter(d => {
        const cmp = d._id.localeCompare(endkey!)
        return params.descending ? cmp >= 0 : cmp <= 0
      })
    }

    const totalRows = docs.length
    const offset = params?.skip || 0
    const limit = params?.limit !== undefined ? params.limit : docs.length

    docs = docs.slice(offset, offset + limit)

    const rows = docs.map(d => {
      const row: {
        id: string
        key: string
        value: { rev: string }
        doc?: D & { _id: string; _rev: string }
      } = {
        id: d._id,
        key: d._id,
        value: { rev: d._rev },
      }
      if (params?.include_docs) {
        const docClone = deepClone(d)
        delete (docClone as StoredDocument)._seq
        delete docClone._revisions
        row.doc = docClone as D & { _id: string; _rev: string }
      }
      return row
    })

    return {
      total_rows: totalRows,
      offset,
      rows,
    }
  }

  async fetch(options: { keys: string[] }): Promise<DocumentListResponse<D>> {
    return this.list({ keys: options.keys, include_docs: true })
  }

  async view<V = unknown>(
    designName: string,
    viewName: string,
    params?: ViewParams
  ): Promise<ViewResponse<V, D>> {
    const db = this.getDb()
    const designId = `_design/${designName}`
    const designDoc = db.docs.get(designId)

    if (!designDoc) {
      throw new CouchError('not_found', `missing design document: ${designId}`)
    }

    return executeView(db, designDoc, viewName, params || {}) as ViewResponse<V, D>
  }

  async find(query: MangoQuery): Promise<MangoResponse<D>> {
    const db = this.getDb()
    let docs = Array.from(db.docs.values()).filter(d => !d._id.startsWith('_design/'))

    // Apply selector
    if (query.selector && Object.keys(query.selector).length > 0) {
      docs = docs.filter(d => matchesSelector(d, query.selector))
    }

    // Apply sort
    if (query.sort) {
      docs.sort((a, b) => {
        for (const sortItem of query.sort!) {
          let field: string
          let direction: 'asc' | 'desc' = 'asc'

          if (typeof sortItem === 'string') {
            field = sortItem
          } else {
            field = Object.keys(sortItem)[0]
            direction = sortItem[field]
          }

          const aVal = getNestedValue(a, field)
          const bVal = getNestedValue(b, field)
          const cmp = compareValues(aVal, bVal)

          if (cmp !== 0) {
            return direction === 'desc' ? -cmp : cmp
          }
        }
        return 0
      })
    }

    // Apply skip and limit
    const skip = query.skip || 0
    const limit = query.limit !== undefined ? query.limit : 25
    docs = docs.slice(skip, skip + limit)

    // Apply fields projection
    let resultDocs = docs.map(d => {
      const docClone = deepClone(d)
      delete (docClone as StoredDocument)._seq
      delete docClone._revisions
      return docClone
    }) as Array<D & { _id: string; _rev: string }>

    if (query.fields) {
      resultDocs = resultDocs.map(d => {
        const projected: Record<string, unknown> = {
          _id: d._id,
          _rev: d._rev,
        }
        for (const field of query.fields!) {
          const value = getNestedValue(d, field)
          if (value !== undefined) {
            projected[field] = value
          }
        }
        return projected as D & { _id: string; _rev: string }
      })
    }

    return {
      docs: resultDocs,
      bookmark: `bookmark_${skip + resultDocs.length}`,
    }
  }

  async createIndex(indexDef: CreateIndexRequest): Promise<CreateIndexResponse> {
    const db = this.getDb()
    const name = indexDef.name || `idx_${indexDef.index.fields.map(f => typeof f === 'string' ? f : Object.keys(f)[0]).join('_')}`
    const ddoc = indexDef.ddoc || `_design/${name}`

    // Check if equivalent index exists
    const existing = db.indexes.find(idx =>
      JSON.stringify(idx.def.fields) === JSON.stringify(
        indexDef.index.fields.map(f => typeof f === 'string' ? { [f]: 'asc' } : f)
      )
    )

    if (existing) {
      return {
        result: 'exists',
        id: existing.ddoc || '',
        name: existing.name,
      }
    }

    const fields = indexDef.index.fields.map(f =>
      typeof f === 'string' ? { [f]: 'asc' as const } : f
    )

    db.indexes.push({
      ddoc,
      name,
      type: indexDef.type || 'json',
      def: {
        fields,
        partial_filter_selector: indexDef.partial_filter_selector,
      },
    })

    return {
      result: 'created',
      id: ddoc,
      name,
    }
  }

  async listIndexes(): Promise<ListIndexesResponse> {
    const db = this.getDb()

    // Always include _all_docs index
    const indexes = [
      {
        ddoc: null,
        name: '_all_docs',
        type: 'special' as const,
        def: { fields: [{ _id: 'asc' as const }] },
      },
      ...db.indexes,
    ]

    return {
      total_rows: indexes.length,
      indexes,
    }
  }

  async deleteIndex(ddoc: string, name: string): Promise<OkResponse> {
    const db = this.getDb()
    const idx = db.indexes.findIndex(i => i.ddoc === `_design/${ddoc}` && i.name === name)
    if (idx >= 0) {
      db.indexes.splice(idx, 1)
    }
    return { ok: true }
  }

  async changes(params?: ChangesParams): Promise<ChangesResponse<D>> {
    const db = this.getDb()
    let changes = [...db.changes] as ChangeItem<D>[]

    // Filter by since
    if (params?.since !== undefined) {
      const since = typeof params.since === 'string' ? parseInt(params.since) : params.since
      changes = changes.filter(c => (c.seq as number) > since)
    }

    // Filter by doc_ids
    if (params?.doc_ids) {
      changes = changes.filter(c => params.doc_ids!.includes(c.id))
    }

    // Deduplicate by id, keeping the most recent change for each doc
    const changeMap = new Map<string, ChangeItem<D>>()
    for (const c of changes) {
      changeMap.set(c.id, c as ChangeItem<D>)
    }
    changes = Array.from(changeMap.values())

    // Sort by seq
    changes.sort((a, b) => (a.seq as number) - (b.seq as number))

    // Apply descending
    if (params?.descending) {
      changes.reverse()
    }

    // Apply limit
    if (params?.limit !== undefined) {
      changes = changes.slice(0, params.limit)
    }

    // Include docs if requested
    if (params?.include_docs) {
      changes = changes.map(c => {
        const doc = c.deleted ? db.deleted.get(c.id) : db.docs.get(c.id)
        if (doc) {
          const docClone = deepClone(doc)
          delete (docClone as StoredDocument)._seq
          delete docClone._revisions
          return { ...c, doc: docClone as D & { _id: string; _rev: string } }
        }
        return c
      })
    }

    return {
      last_seq: db.seq,
      results: changes,
    }
  }

  get changesReader(): ChangesReader {
    const self = this
    let running = false
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

    return {
      start(params?: ChangesParams) {
        running = true
        // In production, this would set up a continuous listener
      },
      stop() {
        running = false
      },
      async get(seq?: string | number) {
        return self.changes({ since: seq })
      },
      on(event: string, callback: (...args: unknown[]) => void) {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(callback)
      },
      off(event: string, callback: (...args: unknown[]) => void) {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(cb => cb !== callback)
        }
      },
    }
  }

  get attachment() {
    const self = this
    return {
      async insert(
        docId: string,
        attName: string,
        data: string | ArrayBuffer,
        contentType: string,
        params?: { rev?: string }
      ): Promise<DocumentInsertResponse> {
        const db = self.getDb()
        let doc = db.docs.get(docId)
        let rev = params?.rev

        if (!doc) {
          // Create new doc with attachment
          doc = {
            _id: docId,
            _rev: '',
            _attachments: {},
          } as StoredDocument
        } else {
          if (!rev) {
            throw new CouchError('conflict', 'Document update conflict.')
          }
          if (doc._rev !== rev) {
            throw new CouchError('conflict', 'Document update conflict.')
          }
        }

        // Add attachment
        if (!doc._attachments) {
          doc._attachments = {}
        }

        const dataStr = typeof data === 'string' ? data : btoa(String.fromCharCode(...new Uint8Array(data)))
        const digest = `md5-${simpleHash(dataStr).toString(16)}`

        doc._attachments[attName] = {
          content_type: contentType,
          data: dataStr,
          digest,
          length: typeof data === 'string' ? data.length : (data as ArrayBuffer).byteLength,
        }

        // Generate new rev
        const revNum = rev ? parseInt(rev.split('-')[0]) + 1 : 1
        const newRev = generateRev(revNum, JSON.stringify(doc))

        if (rev) {
          // Store old version
          const oldDoc = deepClone(db.docs.get(docId)!)
          if (!db.revHistory.has(docId)) {
            db.revHistory.set(docId, [])
          }
          db.revHistory.get(docId)!.push(oldDoc)
        }

        doc._rev = newRev
        doc._revisions = {
          start: revNum,
          ids: [newRev.split('-')[1]],
        }

        db.seq++
        doc._seq = db.seq
        db.docs.set(docId, doc)

        db.changes.push({
          id: docId,
          seq: db.seq,
          changes: [{ rev: newRev }],
        })

        return { ok: true, id: docId, rev: newRev }
      },

      async get(docId: string, attName: string, _params?: { rev?: string }): Promise<ArrayBuffer | string> {
        const db = self.getDb()
        const doc = db.docs.get(docId)

        if (!doc) {
          throw new CouchError('not_found', 'missing')
        }

        const att = doc._attachments?.[attName]
        if (!att || 'stub' in att) {
          throw new CouchError('not_found', `Attachment ${attName} not found`)
        }

        return att.data
      },

      async getAsStream(docId: string, attName: string, _params?: { rev?: string }): Promise<ReadableStream> {
        const data = await this.get(docId, attName)
        const bytes = typeof data === 'string'
          ? new TextEncoder().encode(data)
          : new Uint8Array(data)

        return new ReadableStream({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        })
      },

      async destroy(docId: string, attName: string, params: { rev: string }): Promise<DocumentDestroyResponse> {
        const db = self.getDb()
        const doc = db.docs.get(docId)

        if (!doc) {
          throw new CouchError('not_found', 'missing')
        }

        if (doc._rev !== params.rev) {
          throw new CouchError('conflict', 'Document update conflict.')
        }

        if (doc._attachments) {
          delete doc._attachments[attName]
        }

        // Generate new rev
        const revNum = parseInt(params.rev.split('-')[0]) + 1
        const newRev = generateRev(revNum, JSON.stringify(doc))

        // Store old version
        const oldDoc = deepClone(db.docs.get(docId)!)
        if (!db.revHistory.has(docId)) {
          db.revHistory.set(docId, [])
        }
        db.revHistory.get(docId)!.push(oldDoc)

        doc._rev = newRev
        doc._revisions = {
          start: revNum,
          ids: [newRev.split('-')[1], ...(doc._revisions?.ids || [])],
        }

        db.seq++
        doc._seq = db.seq

        db.changes.push({
          id: docId,
          seq: db.seq,
          changes: [{ rev: newRev }],
        })

        return { ok: true, id: docId, rev: newRev }
      },
    }
  }

  get multipart() {
    const self = this
    return {
      async insert(doc: D, attachments: MultipartAttachment[], params?: { docName?: string }): Promise<DocumentInsertResponse> {
        // First insert the doc
        const result = await self.insert(doc, params)

        // Then add attachments
        let rev = result.rev
        for (const att of attachments) {
          const attResult = await self.attachment.insert(result.id, att.name, att.data, att.content_type, { rev })
          rev = attResult.rev
        }

        return { ok: true, id: result.id, rev }
      },

      async get(docId: string, _params?: { rev?: string; attachments?: boolean }): Promise<MultipartGetResponse<D>> {
        const doc = await self.get(docId)
        const attachments: Record<string, ArrayBuffer | string> = {}

        if (doc._attachments) {
          for (const [name, att] of Object.entries(doc._attachments)) {
            if (!('stub' in att)) {
              attachments[name] = att.data
            }
          }
        }

        return { doc, attachments }
      },
    }
  }

  async partitionedList(partitionKey: string, params?: DocumentListParams): Promise<DocumentListResponse<D>> {
    const result = await this.list(params)
    result.rows = result.rows.filter(r => r.id.startsWith(`${partitionKey}:`))
    result.total_rows = result.rows.length
    return result
  }

  async partitionedFind(partitionKey: string, query: MangoQuery): Promise<MangoResponse<D>> {
    const result = await this.find(query)
    result.docs = result.docs.filter(d => d._id.startsWith(`${partitionKey}:`))
    return result
  }

  async partitionedView<V = unknown>(
    partitionKey: string,
    designName: string,
    viewName: string,
    params?: ViewParams
  ): Promise<ViewResponse<V, D>> {
    const result = await this.view<V>(designName, viewName, params)
    result.rows = result.rows.filter(r => r.id?.startsWith(`${partitionKey}:`))
    return result
  }

  async updateWithHandler(designName: string, updateName: string, docId: string, _body?: unknown): Promise<unknown> {
    // Mock implementation - in production would execute the update function
    const doc = await this.get(docId)
    return { doc, response: 'Updated' }
  }

  async show(designName: string, showName: string, docId: string): Promise<unknown> {
    // Mock implementation - in production would execute the show function
    const doc = await this.get(docId)
    return { formatted: doc }
  }

  async search(designName: string, searchName: string, params: SearchParams): Promise<SearchResponse<D>> {
    // Simple text search implementation
    const db = this.getDb()
    const query = params.q.toLowerCase()
    const docs = Array.from(db.docs.values()).filter(d => {
      if (d._id.startsWith('_design/')) return false
      const text = JSON.stringify(d).toLowerCase()
      return text.includes(query.split(':')[1] || query)
    })

    return {
      total_rows: docs.length,
      bookmark: '',
      rows: docs.slice(0, params.limit || 25).map((d, i) => ({
        id: d._id,
        order: [i],
        doc: params.include_docs ? deepClone(d) as D & { _id: string; _rev: string } : undefined,
      })),
    }
  }

  async revsDiff(revs: RevsDiffRequest): Promise<RevsDiffResponse> {
    const db = this.getDb()
    const result: RevsDiffResponse = {}

    for (const [docId, requestedRevs] of Object.entries(revs)) {
      const doc = db.docs.get(docId)
      const history = db.revHistory.get(docId) || []
      const allRevs = new Set<string>()

      if (doc) {
        allRevs.add(doc._rev)
      }
      for (const h of history) {
        allRevs.add(h._rev)
      }

      const missing = requestedRevs.filter(r => !allRevs.has(r))
      if (missing.length > 0) {
        result[docId] = { missing }
      }
    }

    return result
  }

  async security(secObj?: SecurityObject): Promise<SecurityObject | OkResponse> {
    const db = this.getDb()

    if (secObj === undefined) {
      return db.security
    }

    db.security = secObj
    return { ok: true }
  }
}

// ============================================================================
// SERVER SCOPE IMPLEMENTATION
// ============================================================================

class ServerScopeImpl implements ServerScope {
  config: ServerConfig

  constructor(config: ServerConfig | string) {
    if (typeof config === 'string') {
      const url = new URL(config)
      this.config = {
        url: `${url.protocol}//${url.host}`,
      }
      if (url.username && url.password) {
        this.config.auth = {
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        }
      }
    } else {
      this.config = config
    }
  }

  async info(): Promise<ServerInfo> {
    return {
      couchdb: 'Welcome',
      version: '3.3.3',
      git_sha: 'mock',
      uuid: generateUUID(),
      features: ['access-ready', 'partitioned', 'pluggable-storage-engines', 'reshard', 'scheduler'],
      vendor: { name: 'dotdo' },
    }
  }

  get db() {
    const self = this
    return {
      async create(name: string, options?: DatabaseCreateOptions): Promise<OkResponse> {
        validateDbName(name)

        if (globalStorage.has(name)) {
          throw new CouchError('file_exists', 'The database could not be created, the file already exists.')
        }

        globalStorage.set(name, {
          docs: new Map(),
          deleted: new Map(),
          revHistory: new Map(),
          indexes: [],
          security: {},
          partitioned: options?.partitioned || false,
          seq: 0,
          changes: [],
        })

        return { ok: true }
      },

      async destroy(name: string): Promise<OkResponse> {
        if (!globalStorage.has(name)) {
          throw new CouchError('not_found', `Database does not exist: ${name}`)
        }
        globalStorage.delete(name)
        return { ok: true }
      },

      async get(name: string): Promise<DatabaseInfo> {
        const db = getDatabase(name)
        let dataSize = 0
        for (const doc of db.docs.values()) {
          dataSize += JSON.stringify(doc).length
        }

        return {
          db_name: name,
          doc_count: db.docs.size,
          doc_del_count: db.deleted.size,
          update_seq: db.seq,
          purge_seq: 0,
          compact_running: false,
          disk_size: dataSize,
          data_size: dataSize,
          instance_start_time: '0',
          disk_format_version: 8,
          committed_update_seq: db.seq,
          props: db.partitioned ? { partitioned: true } : undefined,
        }
      },

      async list(): Promise<string[]> {
        return Array.from(globalStorage.keys())
      },

      use<D extends Document = Document>(name: string): DocumentScope<D> {
        return new DocumentScopeImpl<D>(name)
      },

      async compact(name: string, _designDoc?: string): Promise<OkResponse> {
        getDatabase(name) // Verify exists
        return { ok: true }
      },

      async replicate(source: string, target: string, options?: ReplicationOptions): Promise<ReplicationResponse> {
        const srcDb = getDatabase(source)
        const tgtDb = getDatabase(target)

        let docsRead = 0
        let docsWritten = 0

        for (const [id, doc] of srcDb.docs) {
          if (!tgtDb.docs.has(id)) {
            docsRead++
            tgtDb.docs.set(id, deepClone(doc))
            tgtDb.seq++
            tgtDb.changes.push({
              id,
              seq: tgtDb.seq,
              changes: [{ rev: doc._rev }],
            })
            docsWritten++
          }
        }

        return {
          ok: true,
          docs_read: docsRead,
          docs_written: docsWritten,
          doc_write_failures: 0,
        }
      },

      async changes(name: string, params?: ChangesParams): Promise<ChangesResponse> {
        const scope = new DocumentScopeImpl(name)
        return scope.changes(params)
      },
    }
  }

  use<D extends Document = Document>(name: string): DocumentScope<D> {
    return new DocumentScopeImpl<D>(name)
  }

  scope<D extends Document = Document>(name: string): DocumentScope<D> {
    return this.use<D>(name)
  }

  async uuids(count: number = 1): Promise<UUIDResponse> {
    const uuids: string[] = []
    for (let i = 0; i < count; i++) {
      uuids.push(generateUUID())
    }
    return { uuids }
  }

  async request(options: { path: string; method?: string; body?: unknown }): Promise<unknown> {
    if (options.path === '/') {
      return this.info()
    }
    throw new CouchError('not_found', 'missing')
  }

  async session(): Promise<{ ok: boolean; userCtx: { name: string | null; roles: string[] } }> {
    return {
      ok: true,
      userCtx: {
        name: this.config.auth?.username || null,
        roles: [],
      },
    }
  }

  async auth(username: string, password: string): Promise<{ ok: boolean; name: string; roles: string[] }> {
    return {
      ok: true,
      name: username,
      roles: [],
    }
  }
}

// ============================================================================
// NANO FACTORY
// ============================================================================

/**
 * Create a CouchDB client (nano compatible)
 */
export default function nano(config: ServerConfig | string): ServerScope {
  return new ServerScopeImpl(config)
}

// Named export
export { nano }
