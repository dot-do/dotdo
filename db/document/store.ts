/**
 * DocumentStore
 *
 * Schema-free JSON document storage with JSONPath queries.
 *
 * Features:
 * - CRUD operations with automatic versioning
 * - JSONPath queries with MongoDB-like operators
 * - Secondary indexes for optimized queries
 * - Storage tiering (hot/warm/cold)
 * - Change Data Capture (CDC) for event streaming
 * - Bloom filters for existence checks
 * - Atomic batch operations with SQLite transactions
 * - Optimistic locking with version checks
 * - Transaction API for complex operations
 */

import { sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type Database from 'better-sqlite3'

import {
  WriteLockManager,
  withRetry as withRetryInternal,
  type RetryOptions,
} from '../concurrency'

/**
 * Transient SQLite errors that can be retried
 */
const TRANSIENT_ERRORS = [
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'database is locked',
  'database table is locked',
]

/**
 * Check if an error is transient (can be retried)
 */
function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return TRANSIENT_ERRORS.some(e => message.includes(e.toLowerCase()))
}

export type { RetryOptions }
import {
  buildWhereClause,
  buildOrderByClause,
  getFieldExpr,
} from './queries'
import type {
  Document,
  CreateInput,
  UpdateInput,
  CDCEvent,
  DocumentStoreOptions,
  DocumentRow,
  QueryOptions,
  CountOptions,
  BloomFilter,
  UpsertFilter,
  CDCErrorContext,
  CDCStats,
} from './types'
import { IndexManager, type IndexDefinition } from './indexes'
import { DocumentTieringManager, type DocumentTieringOptions } from './tiering'
import type { StorageTier, TierOperationResult } from '../core/tiering/types'

/**
 * Simple bloom filter implementation
 */
class SimpleBloomFilter implements BloomFilter {
  private bits: Set<number>
  private size: number
  private hashCount: number

  constructor(size = 1000, hashCount = 3) {
    this.bits = new Set()
    this.size = size
    this.hashCount = hashCount
  }

  private hash(value: string, seed: number): number {
    let h = seed
    for (let i = 0; i < value.length; i++) {
      h = (h * 31 + value.charCodeAt(i)) >>> 0
    }
    return h % this.size
  }

  add(value: string): void {
    for (let i = 0; i < this.hashCount; i++) {
      this.bits.add(this.hash(value, i))
    }
  }

  mightContain(value: string): boolean {
    for (let i = 0; i < this.hashCount; i++) {
      if (!this.bits.has(this.hash(value, i))) {
        return false
      }
    }
    return true
  }
}

/**
 * Get the underlying SQLite database from a drizzle instance
 */
function getUnderlyingDb(db: BetterSQLite3Database): Database.Database {
  // Access the underlying better-sqlite3 database
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (db as any).session
  if (session && session.client) {
    return session.client
  }
  // Fallback - try direct access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any)._client || (db as any).client
}

import type { CDCEmitter } from '../cdc'

/**
 * Extended options for DocumentStore with indexing and tiering
 */
export interface ExtendedDocumentStoreOptions extends DocumentStoreOptions {
  /** Enable secondary indexing */
  indexes?: IndexDefinition[]
  /** Enable storage tiering */
  tiering?: Omit<DocumentTieringOptions, 'db' | 'type'>
  /** CDC change listener */
  onCDCChange?: (event: CDCChangeEvent) => void
}

/**
 * CDC change event with additional metadata
 */
export interface CDCChangeEvent extends CDCEvent {
  /** Sequence number for ordering */
  lsn?: number
  /** Transaction ID for batching */
  txid?: string
  /** Timestamp of the change */
  timestamp: number
  /** Document version after change */
  version: number
}

/**
 * CDC subscription for streaming changes
 */
export interface CDCSubscription {
  /** Unsubscribe from changes */
  unsubscribe: () => void
  /** Subscription ID */
  id: string
}

/**
 * Transaction context for atomic operations
 */
export interface TransactionContext<T extends Record<string, unknown>> {
  /** Get a document by ID */
  get($id: string): Promise<Document<T> | null>
  /** Create a document */
  create(input: CreateInput<T>): Promise<Document<T>>
  /** Update a document */
  update($id: string, updates: UpdateInput): Promise<Document<T>>
  /** Delete a document */
  delete($id: string): Promise<boolean>
  /** Count documents matching filter */
  count(options?: CountOptions): Promise<number>
  /** Query documents */
  query(options: QueryOptions): Promise<Document<T>[]>
}

/**
 * Batch operation for atomicBatch
 */
export interface BatchOperation {
  op: 'create' | 'update' | 'delete'
  id?: string
  data?: Record<string, unknown>
}

/**
 * DocumentStore class
 *
 * @example Basic usage
 * ```typescript
 * const docs = new DocumentStore<Customer>(db, { type: 'Customer' })
 * const customer = await docs.create({ name: 'Alice', email: 'alice@example.com' })
 * ```
 *
 * @example With indexes
 * ```typescript
 * const docs = new DocumentStore<Customer>(db, {
 *   type: 'Customer',
 *   indexes: [
 *     { name: 'email_idx', fields: [{ path: 'email' }], unique: true },
 *     { name: 'tier_idx', fields: [{ path: 'metadata.tier' }] },
 *   ],
 * })
 * ```
 *
 * @example With tiering
 * ```typescript
 * const docs = new DocumentStore<Customer>(db, {
 *   type: 'Customer',
 *   tiering: {
 *     policy: ageBasedPolicy(7, 90),
 *     r2Warm: env.R2_WARM,
 *     r2Cold: env.R2_COLD,
 *   },
 * })
 * ```
 */
export class DocumentStore<T extends Record<string, unknown>> {
  private db: BetterSQLite3Database
  private sqlite: Database.Database
  private type: string
  private onEvent?: (event: CDCEvent) => void
  private cdcEmitter?: CDCEmitter
  private onCDCError?: (context: CDCErrorContext) => void
  private cdcErrorCount: number = 0
  private bloomFilters: Map<string, SimpleBloomFilter> = new Map()

  // New features
  private indexManager?: IndexManager
  private tieringManager?: DocumentTieringManager<T>
  private cdcSubscribers: Map<string, (event: CDCChangeEvent) => void> = new Map()
  private lsn: number = 0
  private onCDCChange?: (event: CDCChangeEvent) => void

  // Transaction state
  private inTransaction: boolean = false
  private bufferedCDCEvents: Array<{ event: CDCEvent; version: number }> = []

  // Concurrency control
  private lockManager: WriteLockManager

  constructor(db: BetterSQLite3Database, options: DocumentStoreOptions | ExtendedDocumentStoreOptions) {
    this.db = db
    this.sqlite = getUnderlyingDb(db)
    this.type = options.type
    this.onEvent = options.onEvent
    this.cdcEmitter = options.cdcEmitter
    this.onCDCError = options.onCDCError
    this.lockManager = new WriteLockManager()

    // Initialize extended features if provided
    const extOptions = options as ExtendedDocumentStoreOptions

    // Initialize index manager if indexes are specified
    if (extOptions.indexes && extOptions.indexes.length > 0) {
      this.indexManager = new IndexManager(this.sqlite, { type: this.type })
      // Create indexes (async, but we don't wait)
      this.initializeIndexes(extOptions.indexes)
    }

    // Initialize tiering manager if tiering is configured
    if (extOptions.tiering) {
      this.tieringManager = new DocumentTieringManager<T>({
        ...extOptions.tiering,
        db: this.sqlite,
        type: this.type,
      })
    }

    // Store CDC change listener
    if (extOptions.onCDCChange) {
      this.onCDCChange = extOptions.onCDCChange
    }
  }

  /**
   * Initialize indexes asynchronously
   */
  private async initializeIndexes(indexes: IndexDefinition[]): Promise<void> {
    if (!this.indexManager) return

    for (const indexDef of indexes) {
      try {
        const existing = this.indexManager.getIndexes()
        if (!existing.find(i => i.name === indexDef.name)) {
          await this.indexManager.createIndex(indexDef)
        }
      } catch {
        // Index might already exist
      }
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    // Simple ID generation using crypto.randomUUID or fallback
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 21)
    }
    // Fallback for environments without crypto.randomUUID
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 11)}`
  }

  /**
   * Emit a CDC event with enhanced metadata
   * If in a transaction, buffers events until commit
   */
  private emit(event: CDCEvent, version: number = 1): void {
    // If in a transaction, buffer the event for later emission
    if (this.inTransaction) {
      this.bufferedCDCEvents.push({ event, version })
      return
    }

    this.emitImmediate(event, version)
  }

  /**
   * Immediately emit a CDC event (bypasses transaction buffering)
   */
  private emitImmediate(event: CDCEvent, version: number = 1): void {
    // Increment LSN for ordering
    this.lsn++

    // Create enhanced CDC event
    const enhancedEvent: CDCChangeEvent = {
      ...event,
      lsn: this.lsn,
      timestamp: Date.now(),
      version,
    }

    // Call legacy event handler
    if (this.onEvent) {
      this.onEvent(event)
    }

    // Call new CDC change listener
    if (this.onCDCChange) {
      this.onCDCChange(enhancedEvent)
    }

    // Notify subscribers
    for (const callback of this.cdcSubscribers.values()) {
      try {
        callback(enhancedEvent)
      } catch {
        // Don't let subscriber errors break the flow
      }
    }

    // Also emit to unified CDC pipeline if configured
    if (this.cdcEmitter) {
      this.cdcEmitter.emit({
        op: event.op,
        store: 'document',
        table: event.table,
        key: event.key,
        before: event.before,
        after: event.after,
      }).catch((error: Error) => {
        // Track CDC error for metrics
        this.cdcErrorCount++

        // Invoke error callback with context if configured
        if (this.onCDCError) {
          this.onCDCError({
            error,
            documentId: event.key,
            eventType: event.type,
            store: 'document',
            timestamp: Date.now(),
          })
        }
      })
    }
  }

  /**
   * Get CDC statistics for monitoring
   */
  getCDCStats(): CDCStats {
    return {
      cdcErrorCount: this.cdcErrorCount,
    }
  }

  /**
   * Flush all buffered CDC events (called on transaction commit)
   */
  private flushBufferedEvents(): void {
    for (const { event, version } of this.bufferedCDCEvents) {
      this.emitImmediate(event, version)
    }
    this.bufferedCDCEvents = []
  }

  /**
   * Clear buffered CDC events without emitting (called on transaction rollback)
   */
  private clearBufferedEvents(): void {
    this.bufferedCDCEvents = []
  }

  // ============================================================================
  // CDC STREAMING METHODS
  // ============================================================================

  /**
   * Subscribe to CDC changes
   *
   * @example
   * ```typescript
   * const subscription = docs.subscribe((event) => {
   *   console.log(`${event.type}: ${event.key}`)
   * })
   *
   * // Later...
   * subscription.unsubscribe()
   * ```
   */
  subscribe(callback: (event: CDCChangeEvent) => void): CDCSubscription {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.cdcSubscribers.set(id, callback)

    return {
      id,
      unsubscribe: () => {
        this.cdcSubscribers.delete(id)
      },
    }
  }

  /**
   * Get current LSN (log sequence number)
   * Useful for checkpointing and resuming change streams
   */
  getCurrentLSN(): number {
    return this.lsn
  }

  /**
   * Get changes since a specific LSN
   * Note: This requires event log storage (not implemented in base version)
   */
  async getChangesSince(_lsn: number): Promise<CDCChangeEvent[]> {
    // This would require persistent event log storage
    // For now, return empty - full implementation would use EventLog from db/cdc
    console.warn('getChangesSince requires EventLog storage - not implemented in base DocumentStore')
    return []
  }

  /**
   * Convert a row to a document
   */
  private rowToDocument(row: DocumentRow): Document<T> {
    const data = JSON.parse(row.data) as T
    return {
      ...data,
      $id: row.$id,
      $type: row.$type,
      $createdAt: row.$createdAt,
      $updatedAt: row.$updatedAt,
      $version: row.$version,
    } as Document<T>
  }

  /**
   * Update bloom filter for a field
   */
  private updateBloomFilter(field: string, value: string): void {
    if (!this.bloomFilters.has(field)) {
      this.bloomFilters.set(field, new SimpleBloomFilter(10000, 5))
    }
    this.bloomFilters.get(field)!.add(value)
  }

  /**
   * Set a nested value in an object using dot notation
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]
      if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {}
      }
      current = current[key] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }

  /**
   * Get a nested value from an object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Create a document
   */
  async create(input: CreateInput<T>): Promise<Document<T>> {
    // Check for circular references
    try {
      JSON.stringify(input)
    } catch (e) {
      throw new Error('Cannot create document with circular reference')
    }

    const now = Date.now()
    const $id = (input as Record<string, unknown>).$id as string || this.generateId()

    // Extract data (without $id if provided)
    const { $id: _, ...data } = input as Record<string, unknown>

    const row: DocumentRow = {
      $id,
      $type: this.type,
      data: JSON.stringify(data),
      $createdAt: now,
      $updatedAt: now,
      $version: 1,
    }

    try {
      this.db.run(sql`
        INSERT INTO documents ("$id", "$type", data, "$createdAt", "$updatedAt", "$version")
        VALUES (${row.$id}, ${row.$type}, ${row.data}, ${row.$createdAt}, ${row.$updatedAt}, ${row.$version})
      `)
    } catch (e) {
      const error = e as Error
      if (error.message.includes('UNIQUE constraint failed') || error.message.includes('PRIMARY KEY')) {
        throw new Error(`Document with $id "${$id}" already exists`)
      }
      throw e
    }

    // Update bloom filter for common fields
    if (typeof (data as Record<string, unknown>).email === 'string') {
      this.updateBloomFilter('email', (data as Record<string, unknown>).email as string)
    }

    const document = this.rowToDocument(row)

    // Update secondary indexes
    if (this.indexManager) {
      this.indexManager.updateDocument($id, {
        ...data,
        $id,
        $type: this.type,
        $createdAt: now,
        $updatedAt: now,
        $version: 1,
      })
    }

    // Initialize tiering metadata
    if (this.tieringManager) {
      const sizeBytes = row.data.length
      this.tieringManager.initializeMetadata($id, 1, sizeBytes)
    }

    // Emit CDC event with version
    this.emit({
      type: 'cdc.insert',
      op: 'c',
      store: 'document',
      table: this.type,
      key: $id,
      after: { ...data },
    }, 1)

    return document
  }

  /**
   * Get a document by ID
   */
  async get($id: string): Promise<Document<T> | null> {
    const result = this.db.all<DocumentRow>(sql`
      SELECT "$id", "$type", data, "$createdAt", "$updatedAt", "$version"
      FROM documents
      WHERE "$id" = ${$id} AND "$type" = ${this.type}
    `)

    if (result.length === 0) {
      // If tiering is enabled, check warm/cold tiers
      if (this.tieringManager) {
        const tiered = await this.tieringManager.getFromAnyTier($id)
        if (tiered) {
          return tiered.data
        }
      }
      return null
    }

    // Record access for tiering decisions
    if (this.tieringManager) {
      this.tieringManager.recordAccess($id)
    }

    return this.rowToDocument(result[0])
  }

  /**
   * Update a document
   *
   * Uses write locks to serialize concurrent updates to the same document.
   */
  async update($id: string, updates: UpdateInput): Promise<Document<T>> {
    // If already in a transaction, perform update directly (transaction holds the lock)
    if (this.inTransaction) {
      return this.updateInner($id, updates)
    }

    // Acquire lock for this document to serialize concurrent writes
    const handle = await this.lockManager.acquireLock($id, { timeout: 30000 })
    try {
      return await this.updateInner($id, updates)
    } finally {
      handle.release()
    }
  }

  /**
   * Internal update implementation (assumes lock is held or in transaction)
   */
  private async updateInner($id: string, updates: UpdateInput): Promise<Document<T>> {
    // Get existing document
    const existing = await this.get($id)
    if (!existing) {
      throw new Error(`Document with $id "${$id}" not found`)
    }

    const now = Date.now()
    const { $id: _, $type: __, $createdAt, $updatedAt: ___, $version, ...existingData } = existing

    // Apply updates (handle dot notation)
    const newData = { ...existingData } as Record<string, unknown>
    const changedFields: Record<string, { before: unknown; after: unknown }> = {}

    for (const [key, value] of Object.entries(updates)) {
      const beforeValue = this.getNestedValue(newData, key)
      this.setNestedValue(newData, key, value)
      changedFields[key] = { before: beforeValue, after: value }
    }

    const newVersion = $version + 1

    this.db.run(sql`
      UPDATE documents
      SET data = ${JSON.stringify(newData)},
          "$updatedAt" = ${now},
          "$version" = ${newVersion}
      WHERE "$id" = ${$id}
    `)

    // Build before/after for CDC event with only changed fields
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const [key, { before: b, after: a }] of Object.entries(changedFields)) {
      before[key] = b
      after[key] = a
    }

    // Update secondary indexes
    if (this.indexManager) {
      this.indexManager.updateDocument($id, {
        ...newData,
        $id,
        $type: this.type,
        $createdAt,
        $updatedAt: now,
        $version: newVersion,
      })
    }

    // Record access for tiering
    if (this.tieringManager) {
      this.tieringManager.recordAccess($id)
    }

    // Emit CDC event with version
    this.emit({
      type: 'cdc.update',
      op: 'u',
      store: 'document',
      table: this.type,
      key: $id,
      before,
      after,
    }, newVersion)

    return {
      ...newData,
      $id,
      $type: this.type,
      $createdAt,
      $updatedAt: now,
      $version: newVersion,
    } as Document<T>
  }

  /**
   * Delete a document
   */
  async delete($id: string): Promise<boolean> {
    // Get document for CDC event
    const existing = await this.get($id)
    if (!existing) {
      return false
    }

    const { $id: _, $type: __, $createdAt: ___, $updatedAt: ____, $version, ...data } = existing

    this.db.run(sql`
      DELETE FROM documents
      WHERE "$id" = ${$id} AND "$type" = ${this.type}
    `)

    // Remove from secondary indexes
    if (this.indexManager) {
      this.indexManager.removeDocument($id)
    }

    // Emit CDC event
    this.emit({
      type: 'cdc.delete',
      op: 'd',
      store: 'document',
      table: this.type,
      key: $id,
      before: { ...data },
    }, $version)

    return true
  }

  /**
   * Query documents
   */
  async query(options: QueryOptions): Promise<Document<T>[]> {
    const params: unknown[] = []

    // Build WHERE clause
    const whereClause = buildWhereClause(options.where, params)

    // Build ORDER BY clause
    let orderByClause = buildOrderByClause(options.orderBy)

    // Always add $id as tie-breaker for consistent ordering (needed for cursor pagination)
    if (orderByClause) {
      orderByClause = `${orderByClause}, "$id" ASC`
    } else {
      orderByClause = `ORDER BY "$id" ASC`
    }

    // Build LIMIT/OFFSET
    let limitClause = ''
    if (options.limit !== undefined) {
      limitClause = `LIMIT ${options.limit}`
      if (options.offset !== undefined) {
        limitClause += ` OFFSET ${options.offset}`
      }
    }

    // Handle cursor-based pagination
    // Cursor params are added to a separate array and appended after where params
    const cursorParams: unknown[] = []
    let cursorCondition = ''
    if (options.cursor) {
      // Get the cursor document to find its position
      const cursorDoc = await this.get(options.cursor)
      if (cursorDoc) {
        // Add condition to get documents after cursor
        // Uses $createdAt as primary key, $id as tie-breaker
        cursorParams.push(cursorDoc.$createdAt, cursorDoc.$createdAt, options.cursor)
        cursorCondition = `AND ("$createdAt" > ? OR ("$createdAt" = ? AND "$id" > ?))`
      }
    }

    // Build the raw SQL string with parameters
    const sqlStr = `
      SELECT "$id", "$type", data, "$createdAt", "$updatedAt", "$version"
      FROM documents
      WHERE "$type" = ? AND (${whereClause}) ${cursorCondition}
      ${orderByClause}
      ${limitClause}
    `

    // Execute with type as first param using the underlying SQLite driver
    const allParams = [this.type, ...params, ...cursorParams]
    const stmt = this.sqlite.prepare(sqlStr)
    const result = stmt.all(...allParams) as DocumentRow[]

    return result.map((row) => this.rowToDocument(row))
  }

  /**
   * Count documents
   */
  async count(options?: CountOptions): Promise<number> {
    const params: unknown[] = []
    const whereClause = buildWhereClause(options?.where, params)

    const sqlStr = `
      SELECT COUNT(*) as count
      FROM documents
      WHERE "$type" = ? AND (${whereClause})
    `

    const stmt = this.sqlite.prepare(sqlStr)
    const result = stmt.all(this.type, ...params) as { count: number }[]
    return result[0]?.count ?? 0
  }

  /**
   * List all documents
   */
  async list(): Promise<Document<T>[]> {
    return this.query({})
  }

  /**
   * Create multiple documents atomically using SQLite transaction
   */
  async createMany(inputs: CreateInput<T>[]): Promise<Document<T>[]> {
    // First check for duplicate $ids within the batch
    const ids = inputs.map((i) => (i as Record<string, unknown>).$id).filter(Boolean)
    const uniqueIds = new Set(ids)
    if (ids.length !== uniqueIds.size) {
      throw new Error('Duplicate $id in batch')
    }

    // Use SQLite transaction for atomicity
    const documents: Document<T>[] = []

    // Begin transaction
    this.sqlite.exec('BEGIN IMMEDIATE')
    this.inTransaction = true

    try {
      // Create each document
      for (const input of inputs) {
        const doc = await this.createInTransaction(input)
        documents.push(doc)
      }

      // Commit transaction
      this.sqlite.exec('COMMIT')
      this.inTransaction = false

      // Flush buffered CDC events after successful commit
      this.flushBufferedEvents()

      return documents
    } catch (e) {
      // Rollback on any error
      this.sqlite.exec('ROLLBACK')
      this.inTransaction = false

      // Clear buffered events - don't emit since we rolled back
      this.clearBufferedEvents()

      throw e
    }
  }

  /**
   * Internal create method for use within transactions
   * Does not manage transaction state, just inserts
   */
  private async createInTransaction(input: CreateInput<T>): Promise<Document<T>> {
    // Check for circular references
    try {
      JSON.stringify(input)
    } catch (e) {
      throw new Error('Cannot create document with circular reference')
    }

    const now = Date.now()
    const $id = (input as Record<string, unknown>).$id as string || this.generateId()

    // Extract data (without $id if provided)
    const { $id: _, ...data } = input as Record<string, unknown>

    const row: DocumentRow = {
      $id,
      $type: this.type,
      data: JSON.stringify(data),
      $createdAt: now,
      $updatedAt: now,
      $version: 1,
    }

    try {
      this.db.run(sql`
        INSERT INTO documents ("$id", "$type", data, "$createdAt", "$updatedAt", "$version")
        VALUES (${row.$id}, ${row.$type}, ${row.data}, ${row.$createdAt}, ${row.$updatedAt}, ${row.$version})
      `)
    } catch (e) {
      const error = e as Error
      if (error.message.includes('UNIQUE constraint failed') || error.message.includes('PRIMARY KEY')) {
        throw new Error(`Document with $id "${$id}" already exists`)
      }
      throw e
    }

    // Update bloom filter for common fields
    if (typeof (data as Record<string, unknown>).email === 'string') {
      this.updateBloomFilter('email', (data as Record<string, unknown>).email as string)
    }

    const document = this.rowToDocument(row)

    // Update secondary indexes
    if (this.indexManager) {
      this.indexManager.updateDocument($id, {
        ...data,
        $id,
        $type: this.type,
        $createdAt: now,
        $updatedAt: now,
        $version: 1,
      })
    }

    // Initialize tiering metadata
    if (this.tieringManager) {
      const sizeBytes = row.data.length
      this.tieringManager.initializeMetadata($id, 1, sizeBytes)
    }

    // Emit CDC event (will be buffered if in transaction)
    this.emit({
      type: 'cdc.insert',
      op: 'c',
      store: 'document',
      table: this.type,
      key: $id,
      after: { ...data },
    }, 1)

    return document
  }

  /**
   * Update multiple documents matching filter atomically
   *
   * Uses batch SQL with WHERE IN clause for O(1) query complexity.
   */
  async updateMany(
    filter: QueryOptions,
    updates: UpdateInput
  ): Promise<number> {
    // Find matching documents first - cache them for CDC events
    const docs = await this.query(filter)

    if (docs.length === 0) {
      return 0
    }

    const now = Date.now()
    const ids = docs.map((d) => d.$id)

    // Begin transaction
    this.sqlite.exec('BEGIN IMMEDIATE')
    this.inTransaction = true

    try {
      // Build batch UPDATE using json_set for each update field
      // For each document, we need to apply updates to their data
      // Use a single UPDATE with CASE statement for batch efficiency
      const placeholders = ids.map(() => '?').join(', ')

      // Build json_set chain for all update fields
      let jsonSetExpr = 'data'
      const updateParams: unknown[] = []
      for (const [key, value] of Object.entries(updates)) {
        // Convert dot notation to JSON path (e.g., 'metadata.tier' -> '$.metadata.tier')
        const jsonPath = '$.' + key.replace(/\./g, '.')
        jsonSetExpr = `json_set(${jsonSetExpr}, '${jsonPath}', json(?))`
        updateParams.push(JSON.stringify(value))
      }

      // Execute single batch UPDATE
      const updateSql = `
        UPDATE documents
        SET data = ${jsonSetExpr},
            "$updatedAt" = ?,
            "$version" = "$version" + 1
        WHERE "$id" IN (${placeholders}) AND "$type" = ?
      `

      const stmt = this.sqlite.prepare(updateSql)
      stmt.run(...updateParams, now, ...ids, this.type)

      // Emit CDC events for each updated document (using cached docs)
      for (const doc of docs) {
        const { $id, $type: __, $createdAt: ___, $updatedAt: ____, $version, ...existingData } = doc

        // Build before/after for CDC event
        const before: Record<string, unknown> = {}
        const after: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(updates)) {
          before[key] = this.getNestedValue(existingData as Record<string, unknown>, key)
          after[key] = value
        }

        // Update secondary indexes if configured
        if (this.indexManager) {
          const newData = { ...existingData } as Record<string, unknown>
          for (const [key, value] of Object.entries(updates)) {
            this.setNestedValue(newData, key, value)
          }
          this.indexManager.updateDocument($id, {
            ...newData,
            $id,
            $type: this.type,
            $createdAt: doc.$createdAt,
            $updatedAt: now,
            $version: $version + 1,
          })
        }

        // Record access for tiering
        if (this.tieringManager) {
          this.tieringManager.recordAccess($id)
        }

        // Emit CDC event (will be buffered)
        this.emit({
          type: 'cdc.update',
          op: 'u',
          store: 'document',
          table: this.type,
          key: $id,
          before,
          after,
        }, $version + 1)
      }

      // Commit transaction
      this.sqlite.exec('COMMIT')
      this.inTransaction = false

      // Flush buffered CDC events
      this.flushBufferedEvents()

      return docs.length
    } catch (e) {
      // Rollback on any error
      this.sqlite.exec('ROLLBACK')
      this.inTransaction = false

      // Clear buffered events
      this.clearBufferedEvents()

      throw e
    }
  }

  /**
   * Internal update method for use within transactions
   */
  private async updateInTransaction($id: string, updates: UpdateInput): Promise<Document<T>> {
    // Get existing document
    const existing = await this.get($id)
    if (!existing) {
      throw new Error(`Document with $id "${$id}" not found`)
    }

    const now = Date.now()
    const { $id: _, $type: __, $createdAt, $updatedAt: ___, $version, ...existingData } = existing

    // Apply updates (handle dot notation)
    const newData = { ...existingData } as Record<string, unknown>
    const changedFields: Record<string, { before: unknown; after: unknown }> = {}

    for (const [key, value] of Object.entries(updates)) {
      const beforeValue = this.getNestedValue(newData, key)
      this.setNestedValue(newData, key, value)
      changedFields[key] = { before: beforeValue, after: value }
    }

    const newVersion = $version + 1

    this.db.run(sql`
      UPDATE documents
      SET data = ${JSON.stringify(newData)},
          "$updatedAt" = ${now},
          "$version" = ${newVersion}
      WHERE "$id" = ${$id}
    `)

    // Build before/after for CDC event with only changed fields
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const [key, { before: b, after: a }] of Object.entries(changedFields)) {
      before[key] = b
      after[key] = a
    }

    // Update secondary indexes
    if (this.indexManager) {
      this.indexManager.updateDocument($id, {
        ...newData,
        $id,
        $type: this.type,
        $createdAt,
        $updatedAt: now,
        $version: newVersion,
      })
    }

    // Record access for tiering
    if (this.tieringManager) {
      this.tieringManager.recordAccess($id)
    }

    // Emit CDC event (will be buffered if in transaction)
    this.emit({
      type: 'cdc.update',
      op: 'u',
      store: 'document',
      table: this.type,
      key: $id,
      before,
      after,
    }, newVersion)

    return {
      ...newData,
      $id,
      $type: this.type,
      $createdAt,
      $updatedAt: now,
      $version: newVersion,
    } as Document<T>
  }

  /**
   * Delete multiple documents matching filter atomically
   *
   * Uses batch SQL with WHERE IN clause for O(1) query complexity.
   */
  async deleteMany(filter: QueryOptions): Promise<number> {
    // Find matching documents - cache for CDC events
    const docs = await this.query(filter)

    if (docs.length === 0) {
      return 0
    }

    const ids = docs.map((d) => d.$id)

    // Begin transaction
    this.sqlite.exec('BEGIN IMMEDIATE')
    this.inTransaction = true

    try {
      // Execute single batch DELETE with WHERE IN clause
      const placeholders = ids.map(() => '?').join(', ')
      const deleteSql = `
        DELETE FROM documents
        WHERE "$id" IN (${placeholders}) AND "$type" = ?
      `

      const stmt = this.sqlite.prepare(deleteSql)
      stmt.run(...ids, this.type)

      // Emit CDC events for each deleted document (using cached docs)
      for (const doc of docs) {
        const { $id, $type: __, $createdAt: ___, $updatedAt: ____, $version, ...data } = doc

        // Remove from secondary indexes if configured
        if (this.indexManager) {
          this.indexManager.removeDocument($id)
        }

        // Emit CDC event (will be buffered)
        this.emit({
          type: 'cdc.delete',
          op: 'd',
          store: 'document',
          table: this.type,
          key: $id,
          before: { ...data },
        }, $version)
      }

      // Commit transaction
      this.sqlite.exec('COMMIT')
      this.inTransaction = false

      // Flush buffered CDC events
      this.flushBufferedEvents()

      return docs.length
    } catch (e) {
      // Rollback on any error
      this.sqlite.exec('ROLLBACK')
      this.inTransaction = false

      // Clear buffered events
      this.clearBufferedEvents()

      throw e
    }
  }

  /**
   * Internal delete method for use within transactions
   */
  private async deleteInTransaction($id: string): Promise<boolean> {
    // Get document for CDC event
    const existing = await this.get($id)
    if (!existing) {
      return false
    }

    const { $id: _, $type: __, $createdAt: ___, $updatedAt: ____, $version, ...data } = existing

    this.db.run(sql`
      DELETE FROM documents
      WHERE "$id" = ${$id} AND "$type" = ${this.type}
    `)

    // Remove from secondary indexes
    if (this.indexManager) {
      this.indexManager.removeDocument($id)
    }

    // Emit CDC event (will be buffered if in transaction)
    this.emit({
      type: 'cdc.delete',
      op: 'd',
      store: 'document',
      table: this.type,
      key: $id,
      before: { ...data },
    }, $version)

    return true
  }

  // ============================================================================
  // OPTIMISTIC LOCKING METHODS
  // ============================================================================

  /**
   * Update a document only if the version matches (optimistic locking)
   *
   * This is atomic: the version check happens in the same SQL statement as the update.
   * If the version doesn't match, throws an error without modifying the document.
   *
   * @example
   * ```typescript
   * const doc = await docs.get('cust_123')
   * const updated = await docs.updateIfVersion('cust_123', { value: 100 }, doc.$version)
   * ```
   */
  async updateIfVersion($id: string, updates: UpdateInput, expectedVersion: number): Promise<Document<T>> {
    // Get existing document to build the new data
    const existing = await this.get($id)
    if (!existing) {
      throw new Error(`Document with $id "${$id}" not found`)
    }

    const now = Date.now()
    const { $id: _, $type: __, $createdAt, $updatedAt: ___, $version, ...existingData } = existing

    // Apply updates (handle dot notation)
    const newData = { ...existingData } as Record<string, unknown>
    const changedFields: Record<string, { before: unknown; after: unknown }> = {}

    for (const [key, value] of Object.entries(updates)) {
      const beforeValue = this.getNestedValue(newData, key)
      this.setNestedValue(newData, key, value)
      changedFields[key] = { before: beforeValue, after: value }
    }

    const newVersion = expectedVersion + 1

    // Atomic update with version check in WHERE clause
    // This ensures the update only happens if version matches
    const updateSql = `
      UPDATE documents
      SET data = ?,
          "$updatedAt" = ?,
          "$version" = ?
      WHERE "$id" = ? AND "$type" = ? AND "$version" = ?
    `
    const stmt = this.sqlite.prepare(updateSql)
    const result = stmt.run(
      JSON.stringify(newData),
      now,
      newVersion,
      $id,
      this.type,
      expectedVersion
    )

    // Check if any row was updated
    if (result.changes === 0) {
      // Re-fetch to get actual version for error message
      const current = await this.get($id)
      const actualVersion = current?.$version ?? 'unknown'
      throw new Error(
        `Version mismatch: expected ${expectedVersion}, found ${actualVersion}. Document was modified concurrently.`
      )
    }

    // Build before/after for CDC event with only changed fields
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const [key, { before: b, after: a }] of Object.entries(changedFields)) {
      before[key] = b
      after[key] = a
    }

    // Update secondary indexes
    if (this.indexManager) {
      this.indexManager.updateDocument($id, {
        ...newData,
        $id,
        $type: this.type,
        $createdAt,
        $updatedAt: now,
        $version: newVersion,
      })
    }

    // Record access for tiering
    if (this.tieringManager) {
      this.tieringManager.recordAccess($id)
    }

    // Emit CDC event with version
    this.emit({
      type: 'cdc.update',
      op: 'u',
      store: 'document',
      table: this.type,
      key: $id,
      before,
      after,
    }, newVersion)

    return {
      ...newData,
      $id,
      $type: this.type,
      $createdAt,
      $updatedAt: now,
      $version: newVersion,
    } as Document<T>
  }

  /**
   * Update with version check (alias for updateIfVersion)
   */
  async updateWithVersion($id: string, updates: UpdateInput, expectedVersion: number): Promise<Document<T>> {
    return this.updateIfVersion($id, updates, expectedVersion)
  }

  /**
   * Delete a document only if the version matches (optimistic locking)
   *
   * @example
   * ```typescript
   * const doc = await docs.get('cust_123')
   * const deleted = await docs.deleteIfVersion('cust_123', doc.$version)
   * ```
   */
  async deleteIfVersion($id: string, expectedVersion: number): Promise<boolean> {
    // Atomic delete with version check in WHERE clause
    const deleteSql = `
      DELETE FROM documents
      WHERE "$id" = ? AND "$type" = ? AND "$version" = ?
    `
    const stmt = this.sqlite.prepare(deleteSql)
    const result = stmt.run($id, this.type, expectedVersion)

    return result.changes > 0
  }

  // ============================================================================
  // TRANSACTION API
  // ============================================================================

  /**
   * Execute operations within a transaction
   *
   * @example
   * ```typescript
   * const result = await docs.transaction(async (tx) => {
   *   const a = await tx.get('account_a')
   *   const b = await tx.get('account_b')
   *   await tx.update('account_a', { balance: a.balance - 100 })
   *   await tx.update('account_b', { balance: b.balance + 100 })
   *   return { transferred: 100 }
   * })
   * ```
   */
  async transaction<R>(fn: (tx: TransactionContext<T>) => Promise<R>): Promise<R> {
    // Begin transaction
    this.sqlite.exec('BEGIN IMMEDIATE')
    this.inTransaction = true

    // Create transaction context
    const tx: TransactionContext<T> = {
      get: async ($id: string) => this.get($id),
      create: async (input: CreateInput<T>) => this.createInTransaction(input),
      update: async ($id: string, updates: UpdateInput) => this.updateInTransaction($id, updates),
      delete: async ($id: string) => this.deleteInTransaction($id),
      count: async (options?: CountOptions) => this.count(options),
      query: async (options: QueryOptions) => this.query(options),
    }

    try {
      const result = await fn(tx)

      // Commit transaction
      this.sqlite.exec('COMMIT')
      this.inTransaction = false

      // Flush buffered CDC events
      this.flushBufferedEvents()

      return result
    } catch (e) {
      // Rollback on any error
      this.sqlite.exec('ROLLBACK')
      this.inTransaction = false

      // Clear buffered events
      this.clearBufferedEvents()

      throw e
    }
  }

  /**
   * Execute a complex operation with automatic rollback on failure
   * Alias for transaction() for semantic clarity
   */
  async complexOperation<R>($id: string, fn: (tx: TransactionContext<T>) => Promise<R>): Promise<R> {
    return this.transaction(fn)
  }

  /**
   * Execute atomic batch operations
   *
   * @example
   * ```typescript
   * await docs.atomicBatch([
   *   { op: 'update', id: 'doc_1', data: { value: 100 } },
   *   { op: 'update', id: 'doc_2', data: { value: 200 } },
   *   { op: 'delete', id: 'doc_3' },
   * ])
   * ```
   */
  async atomicBatch(operations: BatchOperation[]): Promise<void> {
    await this.transaction(async (tx) => {
      for (const op of operations) {
        switch (op.op) {
          case 'create':
            if (!op.data) {
              throw new Error('Create operation requires data')
            }
            await tx.create(op.data as CreateInput<T>)
            break
          case 'update':
            if (!op.id) {
              throw new Error('Update operation requires id')
            }
            // Verify document exists before updating
            const existing = await tx.get(op.id)
            if (!existing) {
              throw new Error(`Document with $id "${op.id}" not found`)
            }
            await tx.update(op.id, op.data || {})
            break
          case 'delete':
            if (!op.id) {
              throw new Error('Delete operation requires id')
            }
            await tx.delete(op.id)
            break
          default:
            throw new Error(`Unknown operation: ${(op as BatchOperation).op}`)
        }
      }
    })
  }

  // ============================================================================
  // RETRY HELPER
  // ============================================================================

  /**
   * Execute a function with retry for transient errors
   *
   * @example
   * ```typescript
   * const doc = await docs.withRetry(
   *   () => docs.create({ name: 'Test' }),
   *   { maxRetries: 3, backoff: 'exponential' }
   * )
   * ```
   */
  async withRetry<R>(fn: () => Promise<R>, options: RetryOptions = {}): Promise<R> {
    const maxRetries = options.maxRetries ?? 3
    const backoff = options.backoff ?? 'exponential'
    const baseDelayMs = options.baseDelayMs ?? 50

    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn()
      } catch (e) {
        const error = e as Error

        // Don't retry non-transient errors
        if (!isTransientError(error)) {
          throw error
        }

        lastError = error

        // Don't delay after last attempt
        if (attempt < maxRetries) {
          const delayMs = backoff === 'exponential'
            ? baseDelayMs * Math.pow(2, attempt)
            : baseDelayMs

          await new Promise(resolve => setTimeout(resolve, delayMs))
        }
      }
    }

    throw lastError
  }

  /**
   * Upsert a document
   */
  async upsert(
    filter: UpsertFilter,
    data: CreateInput<T> | UpdateInput
  ): Promise<Document<T>> {
    const existing = await this.get(filter.$id)

    if (existing) {
      // Update
      return this.update(filter.$id, data as UpdateInput)
    } else {
      // Create
      return this.create({
        ...data,
        $id: filter.$id,
      } as CreateInput<T>)
    }
  }

  /**
   * Get document as of a specific timestamp (time travel)
   */
  async getAsOf($id: string, timestamp: string): Promise<Document<T> | null> {
    const ts = new Date(timestamp).getTime()

    const result = this.db.all<DocumentRow>(sql`
      SELECT "$id", "$type", data, "$createdAt", "$updatedAt", "$version"
      FROM documents
      WHERE "$id" = ${$id} AND "$type" = ${this.type} AND "$createdAt" <= ${ts}
    `)

    if (result.length === 0) {
      return null
    }

    // For now, return the current document if it existed at that time
    // Full time travel would require event sourcing
    return this.rowToDocument(result[0])
  }

  /**
   * Get bloom filter for a field
   */
  getBloomFilter(field: string): BloomFilter {
    if (!this.bloomFilters.has(field)) {
      // Create new bloom filter and populate from existing data
      const bloom = new SimpleBloomFilter(10000, 5)
      this.bloomFilters.set(field, bloom)

      // Populate from existing documents
      const fieldExpr = getFieldExpr(field)
      const sqlStr = `
        SELECT ${fieldExpr} as value
        FROM documents
        WHERE "$type" = ?
      `
      const stmt = this.sqlite.prepare(sqlStr)
      const results = stmt.all(this.type) as { value: string }[]
      for (const row of results) {
        if (row.value) {
          bloom.add(row.value)
        }
      }
    }

    return this.bloomFilters.get(field)!
  }

  // ============================================================================
  // INDEX MANAGEMENT METHODS
  // ============================================================================

  /**
   * Create a secondary index
   *
   * @example
   * ```typescript
   * await docs.createIndex({
   *   name: 'email_idx',
   *   fields: [{ path: 'email' }],
   *   unique: true,
   * })
   * ```
   */
  async createIndex(definition: IndexDefinition): Promise<void> {
    if (!this.indexManager) {
      this.indexManager = new IndexManager(this.sqlite, { type: this.type })
    }
    await this.indexManager.createIndex(definition)
  }

  /**
   * Drop a secondary index
   */
  async dropIndex(name: string): Promise<void> {
    if (!this.indexManager) {
      throw new Error('No indexes configured')
    }
    await this.indexManager.dropIndex(name)
  }

  /**
   * List all indexes
   */
  getIndexes(): IndexDefinition[] {
    return this.indexManager?.getIndexes() ?? []
  }

  /**
   * Lookup documents by indexed field values
   *
   * @example
   * ```typescript
   * const ids = docs.lookupByIndex('email_idx', { email: 'alice@example.com' })
   * ```
   */
  lookupByIndex(indexName: string, values: Record<string, unknown>): string[] {
    if (!this.indexManager) {
      throw new Error('No indexes configured')
    }
    return this.indexManager.lookup(indexName, values)
  }

  /**
   * Range lookup by indexed field
   *
   * @example
   * ```typescript
   * const ids = docs.lookupByIndexRange('created_at_idx', '$createdAt', {
   *   gte: Date.now() - 86400000, // Last 24 hours
   *   limit: 100,
   * })
   * ```
   */
  lookupByIndexRange(
    indexName: string,
    field: string,
    options: {
      gt?: unknown
      gte?: unknown
      lt?: unknown
      lte?: unknown
      limit?: number
      order?: 'asc' | 'desc'
    }
  ): string[] {
    if (!this.indexManager) {
      throw new Error('No indexes configured')
    }
    return this.indexManager.lookupRange(indexName, field, options)
  }

  /**
   * Rebuild an index from scratch
   */
  async rebuildIndex(name: string): Promise<void> {
    if (!this.indexManager) {
      throw new Error('No indexes configured')
    }
    await this.indexManager.rebuildIndex(name)
  }

  // ============================================================================
  // TIERING MANAGEMENT METHODS
  // ============================================================================

  /**
   * Get document with tier information
   *
   * @example
   * ```typescript
   * const result = await docs.getWithTier('cust_123')
   * console.log(`Document in ${result.tier} tier`)
   * ```
   */
  async getWithTier($id: string): Promise<{ data: Document<T>; tier: StorageTier } | null> {
    if (!this.tieringManager) {
      // No tiering configured, return from hot tier
      const doc = await this.get($id)
      if (!doc) return null
      return { data: doc, tier: 'hot' }
    }
    return this.tieringManager.getFromAnyTier($id)
  }

  /**
   * Manually tier a document to warm storage
   */
  async tierToWarm($id: string): Promise<TierOperationResult> {
    if (!this.tieringManager) {
      return {
        success: false,
        key: $id,
        error: 'Tiering not configured',
      }
    }
    return this.tieringManager.tierToWarm($id)
  }

  /**
   * Manually tier a document to cold storage
   */
  async tierToCold($id: string): Promise<TierOperationResult> {
    if (!this.tieringManager) {
      return {
        success: false,
        key: $id,
        error: 'Tiering not configured',
      }
    }
    return this.tieringManager.tierToCold($id)
  }

  /**
   * Promote a document back to hot storage
   */
  async promoteToHot($id: string): Promise<TierOperationResult> {
    if (!this.tieringManager) {
      return {
        success: false,
        key: $id,
        error: 'Tiering not configured',
      }
    }
    return this.tieringManager.promoteToHot($id)
  }

  /**
   * Run tiering batch to move eligible documents to warm/cold storage
   *
   * @example
   * ```typescript
   * // Dry run to see what would be tiered
   * const preview = await docs.runTieringBatch({ dryRun: true })
   *
   * // Actually tier documents
   * const results = await docs.runTieringBatch({ limit: 100 })
   * console.log(`Tiered ${results.tieredToWarm} to warm, ${results.tieredToCold} to cold`)
   * ```
   */
  async runTieringBatch(options: { limit?: number; dryRun?: boolean } = {}): Promise<{
    evaluated: number
    tieredToWarm: number
    tieredToCold: number
    errors: number
    results: TierOperationResult[]
  }> {
    if (!this.tieringManager) {
      return {
        evaluated: 0,
        tieredToWarm: 0,
        tieredToCold: 0,
        errors: 0,
        results: [],
      }
    }
    return this.tieringManager.runTieringBatch(options)
  }

  /**
   * Get tiering statistics
   */
  async getTieringStats(): Promise<{
    hot: { count: number; sizeBytes: number; avgAge: number; avgAccessCount: number }
    warm: { count: number; sizeBytes: number }
    cold: { count: number; sizeBytes: number }
  } | null> {
    if (!this.tieringManager) {
      return null
    }
    return this.tieringManager.getStats()
  }

  /**
   * Find documents that are candidates for tiering
   */
  findTieringCandidates(options: { limit?: number; targetTier?: StorageTier } = {}): Array<{
    $id: string
    targetTier: StorageTier
  }> {
    if (!this.tieringManager) {
      return []
    }
    return this.tieringManager.findTieringCandidates(options).map(c => ({
      $id: c.$id,
      targetTier: c.targetTier,
    }))
  }
}
