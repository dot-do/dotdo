// SQLite persistence layer for @dotdo/db
// Compatible with Cloudflare Durable Objects SqlStorage API

import type { Thing, ThingsStore } from './things'
import type {
  Event,
  EventsStore,
  EventQueryOptions,
  RetentionPolicy,
  DLQEntry,
  ValidationFailure,
  EventRetryStatus,
  RetryMetrics,
  DurabilityConfig
} from './events'
import type { Relationship, RelationshipsStore } from './relationships'
import {
  type QueryOptions,
  buildWhereClause,
  buildOrderByClause,
  buildPaginationClause
} from './query'
import { MigrationRunner, coreMigrations, type Migration } from './migrations'

// SqlStorage interface from Cloudflare Workers
export interface SqlStorage {
  exec(sql: string): { results: Array<Record<string, unknown>> }
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first(): Promise<Record<string, unknown> | null>
      all(): Promise<{ results: Array<Record<string, unknown>> }>
      run(): Promise<void>
    }
  }
}

// Generate unique ID (same as in-memory implementation)
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// Generate event ID
function generateEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

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
        throw new Error(
          `Migration failed: ${error.name} (version ${error.version}): ${error.error}`
        )
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
    // SQLite in Cloudflare Workers doesn't expose explicit transaction API
    // but each SqlStorage instance is already transactional within a DO
    // All operations are atomic within a single DO request
    try {
      return await fn()
    } catch (error) {
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
    async create(data) {
      if (!data.$type) {
        throw new Error('$type is required')
      }

      const now = Date.now()
      const id = generateId()

      // Separate metadata from data
      const { $type, ...customData } = data

      const thing: Thing = {
        $id: id,
        $type,
        $createdAt: now,
        $updatedAt: now,
        ...customData
      }

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
 */
export function createSQLiteEventsStore(adapter: SQLiteAdapter): EventsStore {
  const sql = adapter.getSql()
  const subscribers = new Set<(event: Event) => void>()

  // Retention policy state
  let retentionPolicy: RetentionPolicy | undefined

  // Dead letter queue storage (in-memory, could be moved to SQLite table)
  const deadLetterQueue: DLQEntry[] = []

  // Validation failure storage
  const validationFailures: ValidationFailure[] = []

  // Event retry status tracking
  const eventRetryStatus = new Map<string, EventRetryStatus>()

  // Retry metrics per event type
  const retryMetricsData = new Map<
    string,
    { totalEvents: number; totalRetries: number; successes: number }
  >()

  // Durability configuration
  let durabilityConfig: Record<string, DurabilityConfig> = {}
  const defaultDurabilityConfig: DurabilityConfig = { retries: 3, backoff: 'exponential' }

  return {
    async emit(data) {
      const event: Event = {
        $id: generateEventId(),
        type: data.type,
        payload: data.payload,
        $timestamp: Date.now(),
        source: data.source,
        correlationId: data.correlationId
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
          console.error('Event subscriber error:', e)
        }
      })

      return event
    },

    async get(id: string) {
      const row = await sql
        .prepare(
          'SELECT id, type, payload, timestamp, source, correlation_id FROM events WHERE id = ?'
        )
        .bind(id)
        .first()

      if (!row) return null

      return {
        $id: row.id as string,
        type: row.type as string,
        payload: JSON.parse(row.payload as string),
        $timestamp: row.timestamp as number,
        source: (row.source as string) || undefined,
        correlationId: (row.correlation_id as string) || undefined
      }
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

      return result.results.map((row) => ({
        $id: row.id as string,
        type: row.type as string,
        payload: JSON.parse(row.payload as string),
        $timestamp: row.timestamp as number,
        source: (row.source as string) || undefined,
        correlationId: (row.correlation_id as string) || undefined
      }))
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

    async cleanup(options) {
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
        const countResult = await sql.prepare('SELECT COUNT(*) as count FROM events').first()
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
      const countResult = await sql.prepare('SELECT COUNT(*) as count FROM events').first()
      const eventCount = (countResult?.count as number) ?? 0

      // Estimate bytes - get average payload size from sample
      const sampleResult = await sql
        .prepare('SELECT AVG(LENGTH(payload)) as avg_size FROM events')
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

    // Dead letter queue methods (stub implementations for SQLite - can be extended)
    addToDeadLetterQueue(entry) {
      deadLetterQueue.push({
        ...entry,
        timestamp: Date.now()
      })
    },

    getDeadLetterQueue() {
      return [...deadLetterQueue]
    },

    queryDeadLetterQueue(options) {
      let results = [...deadLetterQueue]

      if (options?.type) {
        results = results.filter((entry) => entry.event.type === options.type)
      }

      if (options?.since) {
        results = results.filter((entry) => entry.timestamp >= options.since!)
      }

      if (options?.limit) {
        results = results.slice(0, options.limit)
      }

      return results
    },

    removeFromDeadLetterQueue(eventId) {
      const index = deadLetterQueue.findIndex((entry) => entry.event.$id === eventId)
      if (index >= 0) {
        deadLetterQueue.splice(index, 1)
        return true
      }
      return false
    },

    async replayDeadLetterQueue(options) {
      const toReplay = this.queryDeadLetterQueue(options)
      const replayedEvents: Event[] = []

      for (const entry of toReplay) {
        const newEvent = await this.emit({
          type: entry.event.type,
          payload: entry.event.payload,
          source: 'dlq-replay',
          correlationId: entry.event.$id
        })
        replayedEvents.push(newEvent)
        this.removeFromDeadLetterQueue(entry.event.$id)
      }

      return replayedEvents
    },

    // Validation failure tracking
    addValidationFailure(failure) {
      validationFailures.push({
        ...failure,
        timestamp: Date.now()
      })
    },

    queryValidationFailures(options) {
      if (!options?.type) {
        return [...validationFailures]
      }
      return validationFailures.filter((f) => f.type === options.type)
    },

    // Retry status tracking
    setEventRetryStatus(eventId, status) {
      eventRetryStatus.set(eventId, status)
    },

    getEventRetryStatus(eventId) {
      return eventRetryStatus.get(eventId)
    },

    // Retry metrics
    recordRetryAttempt(eventType, succeeded, retryCount) {
      const existing = retryMetricsData.get(eventType) || {
        totalEvents: 0,
        totalRetries: 0,
        successes: 0
      }

      existing.totalEvents++
      existing.totalRetries += retryCount
      if (succeeded) {
        existing.successes++
      }

      retryMetricsData.set(eventType, existing)
    },

    getRetryMetrics() {
      const result: Record<string, RetryMetrics> = {}

      for (const [eventType, data] of retryMetricsData) {
        result[eventType] = {
          totalEvents: data.totalEvents,
          totalRetries: data.totalRetries,
          successRate: data.totalEvents > 0 ? data.successes / data.totalEvents : 0
        }
      }

      return result
    },

    // Durability configuration
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
