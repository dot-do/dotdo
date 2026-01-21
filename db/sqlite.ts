// SQLite persistence layer for @dotdo/db
// Compatible with Cloudflare Durable Objects SqlStorage API

import { createLogger } from '../utils/logger'
import type { Thing, ThingsStore } from './things'
import type { StorableData } from './types'
import type { EventId } from './branded-types'

const logger = createLogger('[SQLite]')
import type {
  Event,
  EventsStore,
  EventInput,
  EventQueryOptions,
  RetentionPolicy,
  DLQEntry,
  ValidationFailure,
  EventRetryStatus,
  RetryMetrics,
  DurabilityConfig
} from './events'
import type { Relationship, RelationshipsStore, BaseRelationship, RelationshipInput } from './relationships'
import {
  type QueryOptions,
  buildWhereClause,
  buildOrderByClause,
  buildPaginationClause
} from './query'
import { MigrationRunner, coreMigrations, type Migration } from './migrations'
import { generateId, generateEventId } from './id'

/**
 * SqlStorage interface from Cloudflare Workers
 * Uses Record<string, unknown> for SQL result rows since raw SQL queries
 * can return any column types. Callers should cast to appropriate types.
 *
 * Note: The actual CF SqlStorage API is synchronous. These methods return values directly,
 * not Promises. Code that awaits these will still work (awaiting a non-promise returns the value).
 */
/**
 * Result of a run operation, potentially including metadata about changes
 */
export interface SqlRunResult {
  meta?: { changes?: number } | undefined
}

/**
 * SqlStorage interface from Cloudflare Workers
 * Uses Record<string, unknown> for SQL result rows since raw SQL queries
 * can return any column types. Callers should cast to appropriate types.
 *
 * Note: Methods can return either sync or async results.
 * The real CF API is sync, but test wrappers may return promises.
 */
export interface SqlStorage {
  exec(sql: string): { results: Array<Record<string, unknown>> }
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first(): (Record<string, unknown> | null) | Promise<Record<string, unknown> | null>
      all(): { results: Array<Record<string, unknown>> } | Promise<{ results: Array<Record<string, unknown>> }>
      run(): SqlRunResult | Promise<SqlRunResult>
    }
  }
}

// ID generation moved to ./id.ts (do-y5ko)

/**
 * Options for SQLiteAdapter initialization
 */
export interface SQLiteAdapterOptions {
  /**
   * Custom migrations to run in addition to core migrations.
   * These will be sorted by version and run in order.
   */
  migrations?: Migration[]

  /**
   * If true, skips running migrations during initialize().
   * Useful for testing or when you want to manage migrations manually.
   * @default false
   */
  skipMigrations?: boolean

  /**
   * If true, uses legacy inline schema creation instead of migrations.
   * This maintains backward compatibility with existing code.
   * @default false
   * @deprecated Use migrations instead
   */
  useLegacyInit?: boolean
}

/**
 * SQLiteAdapter - Manages schema and transactions
 *
 * Supports automatic schema migrations on initialization.
 * By default, runs core migrations for things, events, and relationships tables.
 */
export class SQLiteAdapter {
  private sql: SqlStorage
  private initialized = false
  private migrationRunner: MigrationRunner
  private options: SQLiteAdapterOptions

  constructor(sql: SqlStorage, options: SQLiteAdapterOptions = {}) {
    this.sql = sql
    this.options = options
    this.migrationRunner = new MigrationRunner(sql)
  }

  /**
   * Initialize the adapter by running pending migrations.
   *
   * This method is idempotent - safe to call multiple times.
   * Only pending migrations will be applied.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (this.options.useLegacyInit) {
      // Legacy mode: create tables directly (deprecated)
      this.sql.exec(`
        -- Things table
        CREATE TABLE IF NOT EXISTS things (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);
        CREATE INDEX IF NOT EXISTS idx_things_created_at ON things(created_at DESC);

        -- Events table (immutable log)
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          source TEXT,
          correlation_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
        CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
        CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);

        -- Relationships table (subject-predicate-object triples)
        CREATE TABLE IF NOT EXISTS relationships (
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (subject, predicate, object)
        );
        CREATE INDEX IF NOT EXISTS idx_relationships_subject ON relationships(subject);
        CREATE INDEX IF NOT EXISTS idx_relationships_predicate ON relationships(predicate);
        CREATE INDEX IF NOT EXISTS idx_relationships_object ON relationships(object);
      `)
    } else if (!this.options.skipMigrations) {
      // Migration mode: run migrations
      await this.migrationRunner.initialize()

      // Combine core migrations with any custom migrations
      const allMigrations = [...coreMigrations, ...(this.options.migrations || [])]

      // Run all pending migrations
      const result = await this.migrationRunner.runMigrations(allMigrations)

      if (result.errors.length > 0) {
        const error = result.errors[0]
        if (error) {
          throw new Error(
            `Migration failed: ${error.name} (version ${error.version}): ${error.error}`
          )
        }
      }
    }

    this.initialized = true
  }

  /**
   * Get the migration runner for manual migration management
   */
  getMigrationRunner(): MigrationRunner {
    return this.migrationRunner
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Use explicit SQLite transactions for atomicity (do-6dc7.5)
    // BEGIN starts a transaction, COMMIT finalizes it, ROLLBACK undoes it
    this.sql.exec('BEGIN')
    try {
      const result = await fn()
      this.sql.exec('COMMIT')
      return result
    } catch (error) {
      this.sql.exec('ROLLBACK')
      throw error
    }
  }

  getSql(): SqlStorage {
    return this.sql
  }
}

/**
 * Extended ThingsStore interface with SQL-native query support
 * This avoids fetching 1000 items into memory for client-side filtering (do-5k2l)
 */
export interface SQLiteThingsStore extends ThingsStore {
  /**
   * Execute a query with SQL WHERE clause conditions
   * This uses parameterized queries for SQL injection prevention
   */
  queryWithConditions(options: QueryOptions): Promise<Thing[]>

  /**
   * Count results with SQL WHERE clause conditions
   */
  countWithConditions(options: QueryOptions): Promise<number>
}

/**
 * SQLite-backed ThingsStore with SQL-native query support
 */
export function createSQLiteThingsStore(adapter: SQLiteAdapter): SQLiteThingsStore {
  const sql = adapter.getSql()

  return {
    async create<D extends Partial<StorableData> & { $type: string }>(data: D): Promise<Thing & D> {
      if (!data.$type) {
        throw new Error('$type is required')
      }

      const now = Date.now()
      const id = generateId()

      // Separate metadata from data
      const { $type, ...customData } = data

      const thing = {
        $id: id,
        $type,
        $createdAt: now,
        $updatedAt: now,
        ...customData
      } as unknown as Thing & D

      // Store custom data as JSON
      const dataJson = JSON.stringify(customData)

      await sql
        .prepare(
          'INSERT INTO things (id, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(id, $type, dataJson, now, now)
        .run()

      return thing
    },

    async get(id: string) {
      const row = await sql
        .prepare('SELECT id, type, data, created_at, updated_at FROM things WHERE id = ?')
        .bind(id)
        .first()

      if (!row) return null

      // Parse JSON data and merge with metadata
      const customData = JSON.parse(row.data as string)

      return {
        $id: row.id as string,
        $type: row.type as string,
        $createdAt: row.created_at as number,
        $updatedAt: row.updated_at as number,
        ...customData
      }
    },

    async update(id: string, data) {
      // First, get existing thing
      const existing = await this.get(id)
      if (!existing) {
        throw new Error(`Thing not found: ${id}`)
      }

      // Merge updates, preserving immutable fields
      const updated: Thing = {
        ...existing,
        ...data,
        $id: existing.$id,
        $type: existing.$type,
        $createdAt: existing.$createdAt,
        $updatedAt: Date.now()
      }

      // Extract custom data (exclude metadata)
      const { $id, $type, $createdAt, $updatedAt, ...customData } = updated
      const dataJson = JSON.stringify(customData)

      await sql
        .prepare('UPDATE things SET data = ?, updated_at = ? WHERE id = ?')
        .bind(dataJson, $updatedAt, id)
        .run()

      return updated
    },

    async delete(id: string) {
      // Check if exists
      const existing = await this.get(id)
      if (!existing) {
        throw new Error(`Thing not found: ${id}`)
      }

      await sql
        .prepare('DELETE FROM things WHERE id = ?')
        .bind(id)
        .run()
    },

    async list(options = {}) {
      const { type, limit = 100, offset = 0 } = options

      let query = 'SELECT id, type, data, created_at, updated_at FROM things'
      const params: unknown[] = []

      if (type) {
        query += ' WHERE type = ?'
        params.push(type)
      }

      // Always order by created_at descending (newest first)
      query += ' ORDER BY created_at DESC'

      // Add pagination
      query += ' LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const result = await sql.prepare(query).bind(...params).all()

      return result.results.map((row) => {
        const customData = JSON.parse(row.data as string)
        return {
          $id: row.id as string,
          $type: row.type as string,
          $createdAt: row.created_at as number,
          $updatedAt: row.updated_at as number,
          ...customData
        }
      })
    },

    // getMany implementation for SQLite (do-8m4e, do-6dc7.14)
    // Optimized to use single query with IN clause instead of N+1 queries
    async getMany(ids: string[]): Promise<Map<string, Thing>> {
      if (ids.length === 0) {
        return new Map()
      }

      const result = new Map<string, Thing>()

      // Use IN clause with dynamically generated placeholders
      // This fetches all items in a single query instead of N queries
      const placeholders = ids.map(() => '?').join(', ')
      const query = `SELECT id, type, data, created_at, updated_at FROM things WHERE id IN (${placeholders})`

      const queryResult = await sql.prepare(query).bind(...ids).all()

      for (const row of queryResult.results) {
        const customData = JSON.parse(row.data as string)
        const thing: Thing = {
          $id: row.id as string,
          $type: row.type as string,
          $createdAt: row.created_at as number,
          $updatedAt: row.updated_at as number,
          ...customData
        }
        result.set(thing.$id, thing)
      }

      return result
    },

    // listWithCursor implementation for SQLite (do-8m4e)
    async listWithCursor(options = {}) {
      const { type, cursor, limit = 100, direction = 'forward' } = options as any

      // For now, use offset-based pagination as a fallback
      // Full cursor implementation would parse the cursor to get position
      const items = await this.list({ type, limit: limit + 1, offset: 0 })

      // Handle cursor-based pagination logic
      let startIndex = 0
      if (cursor) {
        // Find the item matching the cursor
        const cursorIndex = items.findIndex((item: Thing) => item.$id === cursor)
        if (cursorIndex !== -1) {
          startIndex = direction === 'forward' ? cursorIndex + 1 : Math.max(0, cursorIndex - limit)
        }
      }

      const slicedItems = items.slice(startIndex, startIndex + limit)
      const hasMore = items.length > startIndex + limit

      return {
        items: slicedItems,
        nextCursor: hasMore && slicedItems.length > 0 ? slicedItems[slicedItems.length - 1]!.$id : undefined,
        prevCursor: startIndex > 0 && slicedItems.length > 0 ? slicedItems[0]!.$id : undefined,
        hasMore
      }
    },

    // bulkCreate implementation for SQLite (do-8m4e)
    // Made atomic with explicit transaction (do-6dc7.5)
    async bulkCreate<D extends Partial<StorableData> & { $type: string }>(items: D[]): Promise<(Thing & D)[]> {
      if (items.length === 0) {
        return []
      }

      // Validate all items first (before transaction)
      for (const data of items) {
        if (!data.$type) {
          throw new Error('$type is required')
        }
      }

      const now = Date.now()
      const created: (Thing & D)[] = []

      // Wrap in transaction for atomicity - either all succeed or all rollback
      return adapter.transaction(async () => {
        for (const data of items) {
          const id = generateId()
          const { $type, ...customData } = data

          const thing = {
            $id: id,
            $type,
            $createdAt: now,
            $updatedAt: now,
            ...customData
          } as unknown as Thing & D

          const dataJson = JSON.stringify(customData)

          await sql
            .prepare(
              'INSERT INTO things (id, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
            )
            .bind(id, $type, dataJson, now, now)
            .run()

          created.push(thing)
        }

        return created
      })
    },

    // bulkUpdate implementation for SQLite (do-8m4e)
    // Made atomic with explicit transaction (do-6dc7.5)
    async bulkUpdate(items: Array<{ id: string; data: Record<string, unknown> }>): Promise<Thing[]> {
      if (items.length === 0) {
        return []
      }

      // Wrap in transaction for atomicity - either all succeed or all rollback
      return adapter.transaction(async () => {
        const updated: Thing[] = []

        for (const { id, data } of items) {
          const thing = await this.update(String(id), data as Partial<Omit<StorableData, '$id' | '$type'>>)
          updated.push(thing)
        }

        return updated
      })
    },

    // bulkDelete implementation for SQLite (do-8m4e)
    // Made atomic with explicit transaction (do-6dc7.5)
    async bulkDelete(ids: string[]): Promise<void> {
      if (ids.length === 0) {
        return
      }

      // Wrap in transaction for atomicity - either all succeed or all rollback
      await adapter.transaction(async () => {
        for (const id of ids) {
          await this.delete(id)
        }
      })
    },

    /**
     * Execute query with SQL WHERE clause conditions (do-5k2l)
     * This is the key method that fixes the performance issue by pushing
     * filtering to the database instead of fetching 1000 items into memory.
     */
    async queryWithConditions(options: QueryOptions): Promise<Thing[]> {
      // Build the SQL query with proper WHERE clauses
      const { clause: whereClause, params: whereParams } = buildWhereClause(options)
      const orderByClause = buildOrderByClause(options)
      const { clause: paginationClause, params: paginationParams } = buildPaginationClause(options)

      // Construct full query
      const query = [
        'SELECT id, type, data, created_at, updated_at FROM things',
        whereClause,
        orderByClause,
        paginationClause
      ]
        .filter(Boolean)
        .join(' ')

      const allParams = [...whereParams, ...paginationParams]

      const result = await sql.prepare(query).bind(...allParams).all()

      let results = result.results.map((row) => {
        const customData = JSON.parse(row.data as string)
        return {
          $id: row.id as string,
          $type: row.type as string,
          $createdAt: row.created_at as number,
          $updatedAt: row.updated_at as number,
          ...customData
        }
      })

      // Apply projection if specified
      if (options.select && options.select.length > 0) {
        const fields = ['$id', '$type', ...options.select]
        results = results.map((thing) => {
          const projected: Record<string, unknown> = {}
          for (const field of fields) {
            if (field in thing) {
              projected[field] = thing[field]
            }
          }
          return projected as Thing
        })
      }

      return results
    },

    /**
     * Count results with SQL WHERE clause conditions (do-5k2l)
     * Uses COUNT(*) for efficient counting without fetching data.
     */
    async countWithConditions(options: QueryOptions): Promise<number> {
      const { clause: whereClause, params: whereParams } = buildWhereClause(options)

      const query = ['SELECT COUNT(*) as count FROM things', whereClause]
        .filter(Boolean)
        .join(' ')

      const result = await sql.prepare(query).bind(...whereParams).first()

      return (result?.count as number) ?? 0
    }
  }
}

/**
 * SQLite-backed EventsStore
 *
 * DLQ, validation failures, retry status, and retry metrics are persisted to SQLite
 * to survive DO hibernation and restarts (do-6dc7.6).
 */
export function createSQLiteEventsStore(adapter: SQLiteAdapter): EventsStore {
  const sql = adapter.getSql()
  const subscribers = new Set<(event: Event) => void>()

  // Retention policy state (kept in-memory as it's configuration, not data)
  let retentionPolicy: RetentionPolicy | undefined

  // Durability configuration (kept in-memory as it's configuration, not data)
  let durabilityConfig: Record<string, DurabilityConfig> = {}
  const defaultDurabilityConfig: DurabilityConfig = { retries: 3, backoff: 'exponential' }

  return {
    async emit(data) {
      // Build event with only defined properties for exactOptionalPropertyTypes
      const event: Event = {
        $id: generateEventId(),
        type: data.type,
        payload: data.payload,
        $timestamp: Date.now(),
      }
      if (data.source !== undefined) {
        event.source = data.source
      }
      if (data.correlationId !== undefined) {
        event.correlationId = data.correlationId
      }

      // Store event in SQLite
      const payloadJson = JSON.stringify(event.payload)

      await sql
        .prepare(
          'INSERT INTO events (id, type, payload, timestamp, source, correlation_id) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(
          event.$id,
          event.type,
          payloadJson,
          event.$timestamp,
          event.source || null,
          event.correlationId || null
        )
        .run()

      // Notify subscribers
      subscribers.forEach((handler) => {
        try {
          handler(event)
        } catch (e) {
          logger.error('Event subscriber error:', e)
        }
      })

      return event
    },

    async get(id: string): Promise<Event | null> {
      const row = await sql
        .prepare(
          'SELECT id, type, payload, timestamp, source, correlation_id FROM events WHERE id = ?'
        )
        .bind(id)
        .first()

      if (!row) return null

      // Build event with only defined properties for exactOptionalPropertyTypes
      const event: Event = {
        $id: row.id as EventId,
        type: row.type as string,
        payload: JSON.parse(row.payload as string),
        $timestamp: row.timestamp as number,
      }
      if (row.source) {
        event.source = row.source as string
      }
      if (row.correlation_id) {
        event.correlationId = row.correlation_id as string
      }
      return event
    },

    async query(options = {}) {
      const {
        type,
        source,
        correlationId,
        since,
        until,
        limit = 100,
        offset = 0
      } = options

      let query =
        'SELECT id, type, payload, timestamp, source, correlation_id FROM events WHERE 1=1'
      const params: unknown[] = []

      if (type) {
        query += ' AND type = ?'
        params.push(type)
      }

      if (source) {
        query += ' AND source = ?'
        params.push(source)
      }

      if (correlationId) {
        query += ' AND correlation_id = ?'
        params.push(correlationId)
      }

      if (since) {
        query += ' AND timestamp >= ?'
        params.push(since)
      }

      if (until) {
        query += ' AND timestamp <= ?'
        params.push(until)
      }

      // Order by timestamp descending (newest first)
      query += ' ORDER BY timestamp DESC'

      // Pagination
      query += ' LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const result = await sql.prepare(query).bind(...params).all()

      return result.results.map((row) => {
        const event: Event = {
          $id: row.id as EventId,
          type: row.type as string,
          payload: JSON.parse(row.payload as string),
          $timestamp: row.timestamp as number,
        }
        if (row.source) {
          event.source = row.source as string
        }
        if (row.correlation_id) {
          event.correlationId = row.correlation_id as string
        }
        return event
      })
    },

    // queryWithCursor implementation for SQLite (do-8m4e)
    async queryWithCursor(options: any = {}) {
      const { type, source, correlationId, since, until, cursor, limit = 100, direction = 'forward' } = options

      // Fetch events using query method
      const events = await this.query({ type, source, correlationId, since, until, limit: limit + 1 })

      // Handle cursor-based pagination logic
      let startIndex = 0
      if (cursor) {
        const cursorIndex = events.findIndex((e: Event) => e.$id === cursor)
        if (cursorIndex !== -1) {
          startIndex = direction === 'forward' ? cursorIndex + 1 : Math.max(0, cursorIndex - limit)
        }
      }

      const slicedEvents = events.slice(startIndex, startIndex + limit)
      const hasMore = events.length > startIndex + limit

      return {
        items: slicedEvents,
        nextCursor: hasMore && slicedEvents.length > 0 ? slicedEvents[slicedEvents.length - 1]!.$id : undefined,
        prevCursor: startIndex > 0 && slicedEvents.length > 0 ? slicedEvents[0]!.$id : undefined,
        hasMore
      }
    },

    subscribe(handler: (event: Event) => void) {
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    },

    // Retention policy methods
    async setRetentionPolicy(policy) {
      // Validate policy parameters
      if (policy.maxEvents !== undefined && policy.maxEvents <= 0) {
        throw new Error('maxEvents must be positive')
      }
      if (policy.maxAgeDays !== undefined && policy.maxAgeDays <= 0) {
        throw new Error('maxAgeDays must be positive')
      }
      retentionPolicy = policy
    },

    async getRetentionPolicy() {
      return retentionPolicy
    },

    async count(filter) {
      let query = 'SELECT COUNT(*) as count FROM events'
      const params: unknown[] = []

      if (filter?.type) {
        query += ' WHERE type = ?'
        params.push(filter.type)
      }

      const result = await sql.prepare(query).bind(...params).first()
      return (result?.count as number) ?? 0
    },

    async cleanup(_options) {
      if (!retentionPolicy) {
        return { deleted: 0 }
      }

      let deleted = 0

      // Delete by age first
      if (retentionPolicy.maxAgeDays) {
        const cutoff = Date.now() - retentionPolicy.maxAgeDays * 24 * 60 * 60 * 1000
        const result = await sql
          .prepare('DELETE FROM events WHERE timestamp < ?')
          .bind(cutoff)
          .run()
        deleted += result.meta?.changes ?? 0
      }

      // Delete by count (keep the newest events)
      if (retentionPolicy.maxEvents) {
        const countResult = await sql.prepare('SELECT COUNT(*) as count FROM events').bind().first()
        const total = (countResult?.count as number) ?? 0

        if (total > retentionPolicy.maxEvents) {
          const toDelete = total - retentionPolicy.maxEvents
          // Delete oldest events (those not in the top maxEvents by timestamp)
          const result = await sql
            .prepare(
              `DELETE FROM events WHERE id IN (
                SELECT id FROM events ORDER BY timestamp ASC LIMIT ?
              )`
            )
            .bind(toDelete)
            .run()
          deleted += result.meta?.changes ?? 0
        }
      }

      return { deleted }
    },

    async getStorageUsage() {
      // Get count
      const countResult = await sql.prepare('SELECT COUNT(*) as count FROM events').bind().first()
      const eventCount = (countResult?.count as number) ?? 0

      // Estimate bytes - get average payload size from sample
      const sampleResult = await sql
        .prepare('SELECT AVG(LENGTH(payload)) as avg_size FROM events')
        .bind()
        .first()
      const avgPayloadSize = (sampleResult?.avg_size as number) ?? 100

      // Estimate total bytes: count * (avg payload + overhead for other fields)
      const overhead = 200 // Estimate for id, type, timestamp, source, correlation_id
      const bytesUsed = eventCount * (avgPayloadSize + overhead)

      return {
        eventCount,
        bytesUsed
      }
    },

    // Dead letter queue methods - SQLite-persisted (do-6dc7.6)
    addToDeadLetterQueue(entry) {
      const id = generateId()
      const timestamp = Date.now()

      sql
        .prepare(
          `INSERT INTO dead_letter_queue
           (id, event_id, event_type, event_payload, event_timestamp, event_source, event_correlation_id, attempts, last_error, handler_index, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          entry.event.$id,
          entry.event.type,
          JSON.stringify(entry.event.payload),
          entry.event.$timestamp,
          entry.event.source || null,
          entry.event.correlationId || null,
          entry.attempts,
          entry.lastError,
          entry.handlerIndex ?? null,
          timestamp
        )
        .run()
    },

    async getDeadLetterQueue(): Promise<DLQEntry[]> {
      const result = await sql
        .prepare(
          `SELECT id, event_id, event_type, event_payload, event_timestamp, event_source, event_correlation_id, attempts, last_error, handler_index, timestamp
           FROM dead_letter_queue
           ORDER BY timestamp DESC`
        )
        .bind()
        .all()

      return result.results.map((row: Record<string, unknown>): DLQEntry => {
        const event: Event = {
          $id: row.event_id as EventId,
          type: row.event_type as string,
          payload: JSON.parse(row.event_payload as string),
          $timestamp: row.event_timestamp as number,
        }
        if (row.event_source) {
          event.source = row.event_source as string
        }
        if (row.event_correlation_id) {
          event.correlationId = row.event_correlation_id as string
        }
        return {
          event,
          attempts: row.attempts as number,
          lastError: row.last_error as string,
          handlerIndex: row.handler_index as number | undefined,
          timestamp: row.timestamp as number
        }
      })
    },

    async queryDeadLetterQueue(options): Promise<DLQEntry[]> {
      let query = `SELECT id, event_id, event_type, event_payload, event_timestamp, event_source, event_correlation_id, attempts, last_error, handler_index, timestamp
                   FROM dead_letter_queue WHERE 1=1`
      const params: unknown[] = []

      if (options?.type) {
        query += ' AND event_type = ?'
        params.push(options.type)
      }

      if (options?.since) {
        query += ' AND timestamp >= ?'
        params.push(options.since)
      }

      query += ' ORDER BY timestamp DESC'

      if (options?.limit) {
        query += ' LIMIT ?'
        params.push(options.limit)
      }

      const result = await sql.prepare(query).bind(...params).all()

      return result.results.map((row: Record<string, unknown>): DLQEntry => {
        const event: Event = {
          $id: row.event_id as EventId,
          type: row.event_type as string,
          payload: JSON.parse(row.event_payload as string),
          $timestamp: row.event_timestamp as number,
        }
        if (row.event_source) {
          event.source = row.event_source as string
        }
        if (row.event_correlation_id) {
          event.correlationId = row.event_correlation_id as string
        }
        return {
          event,
          attempts: row.attempts as number,
          lastError: row.last_error as string,
          handlerIndex: row.handler_index as number | undefined,
          timestamp: row.timestamp as number
        }
      })
    },

    async removeFromDeadLetterQueue(eventId) {
      // Check if exists
      const existing = await sql
        .prepare('SELECT 1 FROM dead_letter_queue WHERE event_id = ?')
        .bind(eventId)
        .first()

      if (!existing) {
        return false
      }

      await sql
        .prepare('DELETE FROM dead_letter_queue WHERE event_id = ?')
        .bind(eventId)
        .run()

      return true
    },

    async replayDeadLetterQueue(options) {
      const toReplay = await this.queryDeadLetterQueue(options)
      const replayedEvents: Event[] = []

      for (const entry of toReplay) {
        const newEvent = await this.emit({
          type: entry.event.type,
          payload: entry.event.payload,
          source: 'dlq-replay',
          correlationId: entry.event.$id
        })
        replayedEvents.push(newEvent)
        await this.removeFromDeadLetterQueue(entry.event.$id)
      }

      return replayedEvents
    },

    // Validation failure tracking - SQLite-persisted (do-6dc7.6)
    addValidationFailure(failure) {
      const id = generateId()
      const timestamp = Date.now()

      sql
        .prepare(
          `INSERT INTO validation_failures (id, type, payload, error, details, timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          failure.type,
          JSON.stringify(failure.payload),
          failure.error,
          failure.details ? JSON.stringify(failure.details) : null,
          timestamp
        )
        .run()
    },

    async queryValidationFailures(options) {
      let query = `SELECT id, type, payload, error, details, timestamp FROM validation_failures`
      const params: unknown[] = []

      if (options?.type) {
        query += ' WHERE type = ?'
        params.push(options.type)
      }

      query += ' ORDER BY timestamp DESC'

      const result = await sql.prepare(query).bind(...params).all()

      return result.results.map((row: Record<string, unknown>) => ({
        type: row.type as string,
        payload: JSON.parse(row.payload as string),
        error: row.error as string,
        details: row.details ? JSON.parse(row.details as string) : undefined,
        timestamp: row.timestamp as number
      }))
    },

    // Retry status tracking - SQLite-persisted (do-6dc7.6)
    async setEventRetryStatus(eventId, status) {
      // Use UPSERT (INSERT OR REPLACE) to handle both insert and update
      await sql
        .prepare(
          `INSERT OR REPLACE INTO event_retry_status (event_id, attempts, succeeded, last_attempt, errors)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          eventId,
          status.attempts,
          status.succeeded ? 1 : 0,
          status.lastAttempt,
          status.errors ? JSON.stringify(status.errors) : null
        )
        .run()
    },

    async getEventRetryStatus(eventId) {
      const row = await sql
        .prepare('SELECT event_id, attempts, succeeded, last_attempt, errors FROM event_retry_status WHERE event_id = ?')
        .bind(eventId)
        .first()

      if (!row) return undefined

      return {
        attempts: row.attempts as number,
        succeeded: (row.succeeded as number) === 1,
        lastAttempt: row.last_attempt as number,
        errors: row.errors ? JSON.parse(row.errors as string) : undefined
      }
    },

    // Retry metrics - SQLite-persisted (do-6dc7.6)
    async recordRetryAttempt(eventType, succeeded, retryCount) {
      // First check if entry exists
      const existing = await sql
        .prepare('SELECT total_events, total_retries, successes FROM retry_metrics WHERE event_type = ?')
        .bind(eventType)
        .first()

      if (existing) {
        // Update existing entry
        await sql
          .prepare(
            `UPDATE retry_metrics
             SET total_events = total_events + 1,
                 total_retries = total_retries + ?,
                 successes = successes + ?
             WHERE event_type = ?`
          )
          .bind(retryCount, succeeded ? 1 : 0, eventType)
          .run()
      } else {
        // Insert new entry
        await sql
          .prepare(
            `INSERT INTO retry_metrics (event_type, total_events, total_retries, successes)
             VALUES (?, 1, ?, ?)`
          )
          .bind(eventType, retryCount, succeeded ? 1 : 0)
          .run()
      }
    },

    async getRetryMetrics() {
      const result = await sql
        .prepare('SELECT event_type, total_events, total_retries, successes FROM retry_metrics')
        .bind()
        .all()

      const metrics: Record<string, RetryMetrics> = {}

      for (const row of result.results) {
        const totalEvents = row.total_events as number
        const successes = row.successes as number
        metrics[row.event_type as string] = {
          totalEvents,
          totalRetries: row.total_retries as number,
          successRate: totalEvents > 0 ? successes / totalEvents : 0
        }
      }

      return metrics
    },

    // Durability configuration (kept in-memory as it's configuration)
    setDurabilityConfig(config) {
      durabilityConfig = config
    },

    getDurabilityConfig(eventType) {
      if (durabilityConfig[eventType]) {
        return durabilityConfig[eventType]
      }
      if (durabilityConfig['*']) {
        return durabilityConfig['*']
      }
      return defaultDurabilityConfig
    }
  }
}

/**
 * SQLite-backed RelationshipsStore
 */
export function createSQLiteRelationshipsStore(
  adapter: SQLiteAdapter
): RelationshipsStore {
  const sql = adapter.getSql()

  return {
    async add(rel) {
      // Check for duplicate
      const existing = await sql
        .prepare(
          'SELECT 1 FROM relationships WHERE subject = ? AND predicate = ? AND object = ?'
        )
        .bind(rel.subject, rel.predicate, rel.object)
        .first()

      if (existing) {
        throw new Error('Relationship already exists')
      }

      const relationship: Relationship = {
        ...rel,
        $createdAt: Date.now()
      }

      await sql
        .prepare(
          'INSERT INTO relationships (subject, predicate, object, created_at) VALUES (?, ?, ?, ?)'
        )
        .bind(
          relationship.subject,
          relationship.predicate,
          relationship.object,
          relationship.$createdAt
        )
        .run()

      return relationship
    },

    async remove(rel) {
      // Check if exists
      const existing = await sql
        .prepare(
          'SELECT 1 FROM relationships WHERE subject = ? AND predicate = ? AND object = ?'
        )
        .bind(rel.subject, rel.predicate, rel.object)
        .first()

      if (!existing) {
        throw new Error('Relationship not found')
      }

      await sql
        .prepare('DELETE FROM relationships WHERE subject = ? AND predicate = ? AND object = ?')
        .bind(rel.subject, rel.predicate, rel.object)
        .run()
    },

    async find(query) {
      let sql_query = 'SELECT subject, predicate, object, created_at FROM relationships WHERE 1=1'
      const params: unknown[] = []

      if (query.subject) {
        sql_query += ' AND subject = ?'
        params.push(query.subject)
      }

      if (query.predicate) {
        sql_query += ' AND predicate = ?'
        params.push(query.predicate)
      }

      if (query.object) {
        sql_query += ' AND object = ?'
        params.push(query.object)
      }

      const result = await sql.prepare(sql_query).bind(...params).all()

      return result.results.map((row) => ({
        subject: row.subject as string,
        predicate: row.predicate as string,
        object: row.object as string,
        $createdAt: row.created_at as number
      }))
    },

    // findWithCursor implementation for SQLite (do-8m4e)
    async findWithCursor(options: any = {}) {
      const { subject, predicate, object, cursor, limit = 100, direction = 'forward' } = options

      // Fetch relationships using find method
      const rels = await this.find({ subject, predicate, object })

      // Sort by createdAt descending
      rels.sort((a: Relationship, b: Relationship) => b.$createdAt - a.$createdAt)

      // Handle cursor-based pagination logic
      let startIndex = 0
      if (cursor) {
        const cursorIndex = rels.findIndex((r: Relationship) =>
          `${r.subject}:${r.predicate}:${r.object}` === cursor
        )
        if (cursorIndex !== -1) {
          startIndex = direction === 'forward' ? cursorIndex + 1 : Math.max(0, cursorIndex - limit)
        }
      }

      const slicedRels = rels.slice(startIndex, startIndex + limit)
      const hasMore = rels.length > startIndex + limit

      const getRelId = (rel: Relationship) => `${rel.subject}:${rel.predicate}:${rel.object}`

      const lastRel = slicedRels[slicedRels.length - 1]
      const firstRel = slicedRels[0]

      return {
        items: slicedRels,
        nextCursor: hasMore && lastRel !== undefined ? getRelId(lastRel) : undefined,
        prevCursor: startIndex > 0 && firstRel !== undefined ? getRelId(firstRel) : undefined,
        hasMore
      }
    },

    async getRelated(subjectId: string, predicate: string) {
      const rels = await this.find({ subject: subjectId, predicate })
      return rels.map((r) => r.object)
    },

    async getRelatedTo(objectId: string, predicate: string) {
      const rels = await this.find({ object: objectId, predicate })
      return rels.map((r) => r.subject)
    }
  }
}
