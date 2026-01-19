// SQLite persistence layer for @dotdo/db
// Compatible with Cloudflare Durable Objects SqlStorage API

import type { Thing, ThingsStore } from './things'
import type { Event, EventsStore, EventQueryOptions } from './events'
import type { Relationship, RelationshipsStore } from './relationships'

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
 * SQLiteAdapter - Manages schema and transactions
 */
export class SQLiteAdapter {
  private sql: SqlStorage
  private initialized = false

  constructor(sql: SqlStorage) {
    this.sql = sql
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create all tables with indexes
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

    this.initialized = true
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
 * SQLite-backed ThingsStore
 */
export function createSQLiteThingsStore(adapter: SQLiteAdapter): ThingsStore {
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
    }
  }
}

/**
 * SQLite-backed EventsStore
 */
export function createSQLiteEventsStore(adapter: SQLiteAdapter): EventsStore {
  const sql = adapter.getSql()
  const subscribers = new Set<(event: Event) => void>()

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
