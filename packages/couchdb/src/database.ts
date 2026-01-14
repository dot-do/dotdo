/**
 * CouchDB Database Class
 *
 * Represents a single CouchDB database with document CRUD,
 * Mango queries, views, and changes feed.
 */

import { createHash, randomUUID } from 'crypto'
import type { Backend, StoredDocument } from './backends/interface'
import { parseMapFunction, applyReduce } from './mapreduce'
import type {
  CouchDocument,
  WriteResult,
  BulkResult,
  AllDocsOptions,
  AllDocsResponse,
  FindQuery,
  FindResponse,
  ViewOptions,
  ViewResponse,
  ViewRow,
  DesignDocument,
  ChangesOptions,
  ChangesResponse,
  MangoSelector,
  AttachmentStub,
} from './types'

/**
 * CouchDB Database
 */
export class Database {
  readonly name: string
  private backend: Backend

  constructor(name: string, backend: Backend) {
    this.name = name
    this.backend = backend
  }

  /**
   * Generate a new document ID
   */
  private generateId(): string {
    return randomUUID().replace(/-/g, '')
  }

  /**
   * Generate a revision string
   */
  private generateRev(revNum: number, data: object): string {
    const hash = createHash('md5').update(JSON.stringify(data)).digest('hex').slice(0, 16)
    return `${revNum}-${hash}`
  }

  /**
   * Get the revision number from a revision string
   */
  private getRevNum(rev: string): number {
    const match = rev.match(/^(\d+)-/)
    return match ? parseInt(match[1], 10) : 0
  }

  /**
   * Put a document (create or update)
   */
  async put(doc: CouchDocument): Promise<WriteResult> {
    const id = doc._id || this.generateId()
    const existing = await this.backend.getDocument(this.name, id)

    if (existing && !existing.deleted) {
      // Update - must provide correct _rev
      if (!doc._rev) {
        throw new Error('Document update conflict: _rev required')
      }
      if (doc._rev !== existing.rev) {
        throw new Error('Document update conflict: wrong _rev')
      }
    } else if (doc._rev && !existing) {
      // Trying to update non-existent document
      throw new Error('Document update conflict: document not found')
    }

    const revNum = existing ? this.getRevNum(existing.rev) + 1 : 1
    const newDoc = { ...doc, _id: id }
    delete (newDoc as Record<string, unknown>)._rev

    // Add attachment stubs if document has attachments
    if (existing && !existing.deleted) {
      const attachments = await this.backend.getAttachments(this.name, id)
      if (attachments.length > 0 && !newDoc._attachments) {
        newDoc._attachments = {}
        for (const att of attachments) {
          newDoc._attachments[att.name] = {
            content_type: att.contentType,
            digest: att.digest,
            length: att.length,
            stub: true,
          }
        }
      }
    }

    const newRev = this.generateRev(revNum, newDoc)
    const seq = await this.backend.getNextSeq(this.name)

    await this.backend.putDocument(this.name, { ...newDoc, _id: id }, newRev, seq)

    return { ok: true, id, rev: newRev }
  }

  /**
   * Get a document by ID
   */
  async get(id: string, options?: { rev?: string }): Promise<CouchDocument> {
    let doc: StoredDocument | null

    if (options?.rev) {
      doc = await this.backend.getDocumentRevision(this.name, id, options.rev)
      if (!doc) {
        throw new Error(`Document revision '${options.rev}' not found`)
      }
    } else {
      doc = await this.backend.getDocument(this.name, id)
      if (!doc) {
        throw new Error(`Document '${id}' not found`)
      }
      if (doc.deleted) {
        throw new Error(`Document '${id}' not found (deleted)`)
      }
    }

    // Add attachment stubs
    const result = { ...doc.data }
    const attachments = await this.backend.getAttachments(this.name, id)
    if (attachments.length > 0) {
      result._attachments = {}
      for (const att of attachments) {
        result._attachments[att.name] = {
          content_type: att.contentType,
          digest: att.digest,
          length: att.length,
          stub: true,
        }
      }
    }

    return result
  }

  /**
   * Delete a document
   */
  async delete(id: string, rev: string): Promise<WriteResult> {
    const existing = await this.backend.getDocument(this.name, id)
    if (!existing) {
      throw new Error(`Document '${id}' not found`)
    }
    if (existing.deleted) {
      throw new Error(`Document '${id}' not found (deleted)`)
    }
    if (existing.rev !== rev) {
      throw new Error('Document update conflict: wrong _rev')
    }

    const newRevNum = this.getRevNum(rev) + 1
    const newRev = this.generateRev(newRevNum, { _deleted: true })
    const seq = await this.backend.getNextSeq(this.name)

    await this.backend.deleteDocument(this.name, id, newRev, seq)

    // Delete all attachments
    const attachments = await this.backend.getAttachments(this.name, id)
    for (const att of attachments) {
      await this.backend.deleteAttachment(this.name, id, att.name)
    }

    return { ok: true, id, rev: newRev }
  }

  /**
   * Bulk document operations
   */
  async bulkDocs(docs: CouchDocument[]): Promise<BulkResult[]> {
    const results: BulkResult[] = []

    for (const doc of docs) {
      try {
        if (doc._deleted) {
          const result = await this.delete(doc._id, doc._rev!)
          results.push({ ok: true, id: result.id, rev: result.rev })
        } else {
          const result = await this.put(doc)
          results.push({ ok: true, id: result.id, rev: result.rev })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        const errorType = message.includes('conflict') ? 'conflict' : 'error'
        results.push({
          id: doc._id || '',
          error: errorType,
          reason: message,
        })
      }
    }

    return results
  }

  /**
   * Get all documents
   */
  async allDocs(options?: AllDocsOptions): Promise<AllDocsResponse> {
    const allDocs = await this.backend.getAllDocuments(this.name)

    // Filter to non-deleted documents
    let docs = allDocs.filter((d) => !d.deleted)

    // Filter by keys if provided
    if (options?.keys) {
      const keySet = new Set(options.keys)
      docs = docs.filter((d) => keySet.has(d.id))
      // Maintain order of keys
      docs.sort((a, b) => options.keys!.indexOf(a.id) - options.keys!.indexOf(b.id))
    } else {
      // Sort by _id
      docs.sort((a, b) => a.id.localeCompare(b.id))

      // Filter by startkey/endkey
      if (options?.startkey) {
        docs = docs.filter((d) => d.id >= options.startkey!)
      }
      if (options?.endkey) {
        docs = docs.filter((d) => d.id <= options.endkey!)
      }

      // Descending order
      if (options?.descending) {
        docs.reverse()
      }
    }

    const totalRows = docs.length

    // Skip and limit
    const skip = options?.skip || 0
    const limit = options?.limit !== undefined ? options.limit : docs.length
    docs = docs.slice(skip, skip + limit)

    // Build rows
    const rows = await Promise.all(
      docs.map(async (d) => {
        const row: {
          id: string
          key: string
          value: { rev: string }
          doc?: CouchDocument
        } = {
          id: d.id,
          key: d.id,
          value: { rev: d.rev },
        }

        if (options?.include_docs) {
          const doc = await this.get(d.id)
          row.doc = doc
        }

        return row
      })
    )

    return {
      total_rows: totalRows,
      offset: skip,
      rows,
    }
  }

  /**
   * Mango find query
   */
  async find(query: FindQuery): Promise<FindResponse> {
    const allDocs = await this.backend.getAllDocuments(this.name)

    // Filter to non-deleted and match selector
    let docs = allDocs
      .filter((d) => !d.deleted)
      .map((d) => d.data)
      .filter((d) => this.matchSelector(d, query.selector))

    // Sort
    if (query.sort) {
      docs = this.sortDocuments(docs, query.sort)
    }

    // Skip and limit
    const skip = query.skip || 0
    const limit = query.limit !== undefined ? query.limit : docs.length
    docs = docs.slice(skip, skip + limit)

    // Project fields
    if (query.fields) {
      docs = docs.map((d) => this.projectFields(d, query.fields!))
    }

    return { docs }
  }

  /**
   * Check if a document matches a Mango selector
   */
  private matchSelector(doc: CouchDocument, selector: MangoSelector): boolean {
    for (const [key, condition] of Object.entries(selector)) {
      if (key === '$and') {
        const conditions = condition as MangoSelector[]
        if (!conditions.every((c) => this.matchSelector(doc, c))) {
          return false
        }
      } else if (key === '$or') {
        const conditions = condition as MangoSelector[]
        if (!conditions.some((c) => this.matchSelector(doc, c))) {
          return false
        }
      } else if (key === '$not') {
        if (this.matchSelector(doc, condition as MangoSelector)) {
          return false
        }
      } else {
        // Field condition
        const value = this.getNestedValue(doc, key)
        if (!this.matchCondition(value, condition)) {
          return false
        }
      }
    }
    return true
  }

  /**
   * Get a nested value from a document
   */
  private getNestedValue(doc: CouchDocument, path: string): unknown {
    const parts = path.split('.')
    let value: unknown = doc
    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined
      }
      value = (value as Record<string, unknown>)[part]
    }
    return value
  }

  /**
   * Check if a value matches a condition
   */
  private matchCondition(value: unknown, condition: unknown): boolean {
    // Direct equality
    if (typeof condition !== 'object' || condition === null) {
      return value === condition
    }

    // Operator conditions
    const cond = condition as Record<string, unknown>

    for (const [op, expected] of Object.entries(cond)) {
      switch (op) {
        case '$eq':
          if (value !== expected) return false
          break
        case '$ne':
          if (value === expected) return false
          break
        case '$gt':
          if (typeof value !== 'number' || typeof expected !== 'number') return false
          if (value <= expected) return false
          break
        case '$gte':
          if (typeof value !== 'number' || typeof expected !== 'number') return false
          if (value < expected) return false
          break
        case '$lt':
          if (typeof value !== 'number' || typeof expected !== 'number') return false
          if (value >= expected) return false
          break
        case '$lte':
          if (typeof value !== 'number' || typeof expected !== 'number') return false
          if (value > expected) return false
          break
        case '$in':
          if (!Array.isArray(expected) || !expected.includes(value)) return false
          break
        case '$nin':
          if (!Array.isArray(expected) || expected.includes(value)) return false
          break
        case '$exists':
          const exists = value !== undefined
          if (expected !== exists) return false
          break
        case '$regex':
          if (typeof value !== 'string' || typeof expected !== 'string') return false
          if (!new RegExp(expected).test(value)) return false
          break
        case '$not':
          if (this.matchCondition(value, expected)) return false
          break
      }
    }

    return true
  }

  /**
   * Sort documents
   */
  private sortDocuments(
    docs: CouchDocument[],
    sort: Array<{ [field: string]: 'asc' | 'desc' }>
  ): CouchDocument[] {
    return [...docs].sort((a, b) => {
      for (const sortSpec of sort) {
        const field = Object.keys(sortSpec)[0]
        const direction = sortSpec[field]
        const aVal = this.getNestedValue(a, field)
        const bVal = this.getNestedValue(b, field)

        let cmp = 0
        if (aVal < bVal) cmp = -1
        else if (aVal > bVal) cmp = 1

        if (direction === 'desc') cmp = -cmp
        if (cmp !== 0) return cmp
      }
      return 0
    })
  }

  /**
   * Project fields from a document
   */
  private projectFields(doc: CouchDocument, fields: string[]): CouchDocument {
    const result: CouchDocument = { _id: doc._id }
    if (doc._rev) result._rev = doc._rev

    for (const field of fields) {
      if (field === '_id' || field === '_rev') continue
      const value = this.getNestedValue(doc, field)
      if (value !== undefined) {
        (result as Record<string, unknown>)[field] = value
      }
    }

    return result
  }

  /**
   * Query a view
   */
  async view(designDoc: string, viewName: string, options?: ViewOptions): Promise<ViewResponse> {
    // Get design document
    const ddoc = (await this.get(`_design/${designDoc}`)) as DesignDocument
    if (!ddoc.views || !ddoc.views[viewName]) {
      throw new Error(`View '${viewName}' not found in design document '${designDoc}'`)
    }

    const viewDef = ddoc.views[viewName]
    const mapFn = parseMapFunction(viewDef.map)

    // Get all documents and apply map function
    // Skip design documents - they should not be indexed
    const allDocs = await this.backend.getAllDocuments(this.name)
    const nonDeleted = allDocs.filter((d) => !d.deleted && !d.id.startsWith('_design/'))

    let rows: ViewRow[] = []

    for (const storedDoc of nonDeleted) {
      const emitResults = mapFn(storedDoc.data)
      for (const result of emitResults) {
        rows.push({
          id: storedDoc.id,
          key: result.key,
          value: result.value,
        })
      }
    }

    // Sort by key
    rows.sort((a, b) => this.compareKeys(a.key, b.key))

    // Apply reduce if requested
    if (viewDef.reduce && options?.reduce !== false) {
      rows = this.applyReduce(rows, viewDef.reduce, options?.group ?? false)
    }

    // Filter by key
    if (options?.key !== undefined) {
      rows = rows.filter((r) => this.compareKeys(r.key, options.key) === 0)
    }

    // Filter by startkey/endkey
    if (options?.startkey !== undefined) {
      rows = rows.filter((r) => this.compareKeys(r.key, options.startkey) >= 0)
    }
    if (options?.endkey !== undefined) {
      rows = rows.filter((r) => this.compareKeys(r.key, options.endkey) <= 0)
    }

    // Descending order
    if (options?.descending) {
      rows.reverse()
    }

    // Skip and limit
    const skip = options?.skip || 0
    const limit = options?.limit !== undefined ? options.limit : rows.length
    rows = rows.slice(skip, skip + limit)

    // Include docs if requested
    if (options?.include_docs) {
      rows = await Promise.all(
        rows.map(async (row) => {
          if (row.id) {
            const doc = await this.get(row.id)
            return { ...row, doc }
          }
          return row
        })
      )
    }

    return { rows }
  }

  /**
   * Compare two view keys
   */
  private compareKeys(a: unknown, b: unknown): number {
    // Handle null/undefined
    if (a === null && b === null) return 0
    if (a === null) return -1
    if (b === null) return 1
    if (a === undefined && b === undefined) return 0
    if (a === undefined) return -1
    if (b === undefined) return 1

    // Compare arrays element by element
    if (Array.isArray(a) && Array.isArray(b)) {
      const minLen = Math.min(a.length, b.length)
      for (let i = 0; i < minLen; i++) {
        const cmp = this.compareKeys(a[i], b[i])
        if (cmp !== 0) return cmp
      }
      return a.length - b.length
    }

    // Compare primitives
    if (a < b) return -1
    if (a > b) return 1
    return 0
  }

  /**
   * Apply reduce function to view rows
   */
  private applyReduce(
    rows: ViewRow[],
    reduceFn: string | '_count' | '_sum' | '_stats',
    group: boolean
  ): ViewRow[] {
    if (!group) {
      // Single reduced value for all rows
      const values = rows.map((r) => r.value)
      const reduced = applyReduce(reduceFn, values)
      return [{ key: null, value: reduced }]
    }

    // Group by key - use a Map with proper key comparison
    const groups = new Map<string, { key: unknown; rows: ViewRow[] }>()
    for (const row of rows) {
      // Handle undefined keys properly - convert to null for JSON serialization
      const keyForJson = row.key === undefined ? null : row.key
      const keyStr = JSON.stringify(keyForJson)
      const existing = groups.get(keyStr)
      if (existing) {
        existing.rows.push(row)
      } else {
        groups.set(keyStr, { key: row.key, rows: [row] })
      }
    }

    const result: ViewRow[] = []
    for (const { key, rows: groupRows } of groups.values()) {
      const values = groupRows.map((r) => r.value)
      const reduced = applyReduce(reduceFn, values)
      result.push({ key, value: reduced })
    }

    return result
  }

  /**
   * Get changes feed
   */
  async changes(options?: ChangesOptions): Promise<ChangesResponse> {
    const since = typeof options?.since === 'number' ? options.since : 0
    const changes = await this.backend.getChanges(this.name, since, options?.limit)
    const latestSeq = await this.backend.getLatestSeq(this.name)

    const results = await Promise.all(
      changes.map(async (change) => {
        const result: {
          seq: number
          id: string
          changes: { rev: string }[]
          deleted?: boolean
          doc?: CouchDocument
        } = {
          seq: change.seq,
          id: change.id,
          changes: [{ rev: change.rev }],
        }

        if (change.deleted) {
          result.deleted = true
        }

        if (options?.include_docs && !change.deleted) {
          result.doc = change.data
        }

        return result
      })
    )

    return {
      results,
      last_seq: latestSeq,
    }
  }

  /**
   * Put an attachment
   */
  async putAttachment(
    docId: string,
    attachmentName: string,
    rev: string,
    data: Buffer,
    contentType: string
  ): Promise<WriteResult> {
    const existing = await this.backend.getDocument(this.name, docId)
    if (!existing) {
      throw new Error(`Document '${docId}' not found`)
    }
    if (existing.rev !== rev) {
      throw new Error('Document update conflict: wrong _rev')
    }

    const digest = createHash('md5').update(data).digest('hex')

    await this.backend.putAttachment(this.name, {
      docId,
      name: attachmentName,
      contentType,
      data,
      digest,
      length: data.length,
    })

    // Update document with new revision
    const newRevNum = this.getRevNum(rev) + 1
    const newRev = this.generateRev(newRevNum, { ...existing.data, _attachment_updated: true })
    const seq = await this.backend.getNextSeq(this.name)

    await this.backend.putDocument(this.name, existing.data, newRev, seq)

    return { ok: true, id: docId, rev: newRev }
  }

  /**
   * Get an attachment
   */
  async getAttachment(docId: string, attachmentName: string): Promise<Buffer> {
    const attachment = await this.backend.getAttachment(this.name, docId, attachmentName)
    if (!attachment) {
      throw new Error(`Attachment '${attachmentName}' not found`)
    }
    return attachment.data
  }

  /**
   * Delete an attachment
   */
  async deleteAttachment(docId: string, attachmentName: string, rev: string): Promise<WriteResult> {
    const existing = await this.backend.getDocument(this.name, docId)
    if (!existing) {
      throw new Error(`Document '${docId}' not found`)
    }
    if (existing.rev !== rev) {
      throw new Error('Document update conflict: wrong _rev')
    }

    await this.backend.deleteAttachment(this.name, docId, attachmentName)

    // Update document with new revision
    const newRevNum = this.getRevNum(rev) + 1
    const newRev = this.generateRev(newRevNum, { ...existing.data, _attachment_deleted: true })
    const seq = await this.backend.getNextSeq(this.name)

    await this.backend.putDocument(this.name, existing.data, newRev, seq)

    return { ok: true, id: docId, rev: newRev }
  }

  /**
   * Compact the database
   */
  async compact(): Promise<{ ok: boolean }> {
    await this.backend.compact(this.name)
    return { ok: true }
  }
}
