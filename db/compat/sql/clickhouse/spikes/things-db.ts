/**
 * SPIKE: Things + Relationships Schema with DO SQLite Hot Tier
 *
 * Universal data model:
 * - Things: Generic entities with type, JSON data, optional embeddings
 * - Relationships: Typed connections between Things
 *
 * Designed for Durable Object SQLite (10GB per DO, zero latency)
 * Uses better-sqlite3 for local testing
 */

import type Database from 'better-sqlite3'

// ============================================================================
// Types
// ============================================================================

export interface Thing {
  id: string
  type: string
  data: Record<string, unknown>
  embedding?: Float32Array | null
  createdAt: Date
  updatedAt: Date
}

export interface ThingInput {
  id?: string
  type: string
  data: Record<string, unknown>
  embedding?: Float32Array | number[]
}

export interface Relationship {
  id: string
  fromId: string
  toId: string
  type: string
  data?: Record<string, unknown> | null
  createdAt: Date
}

export interface RelationshipInput {
  id?: string
  fromId: string
  toId: string
  type: string
  data?: Record<string, unknown>
}

export interface QueryResult<T = unknown> {
  rows: T[]
  columns: string[]
  changes?: number
  lastInsertRowid?: number | bigint
}

export interface ThingsDBOptions {
  /** Enable WAL mode for better concurrent read/write performance */
  enableWAL?: boolean
  /** Enable foreign key constraints */
  enableForeignKeys?: boolean
  /** Create indexes for JSON fields (experimental) */
  jsonIndexes?: string[]
}

// ============================================================================
// ThingsDB Implementation
// ============================================================================

export class ThingsDB {
  private db: Database.Database
  private statements: {
    insertThing: Database.Statement
    getThing: Database.Statement
    updateThing: Database.Statement
    deleteThing: Database.Statement
    findByType: Database.Statement
    insertRelationship: Database.Statement
    getRelationship: Database.Statement
    deleteRelationship: Database.Statement
    findRelatedFrom: Database.Statement
    findRelatedTo: Database.Statement
    findRelatedFromByType: Database.Statement
    findRelatedToByType: Database.Statement
  }

  constructor(db: Database.Database, options: ThingsDBOptions = {}) {
    this.db = db

    // Configure database
    if (options.enableWAL !== false) {
      this.db.pragma('journal_mode = WAL')
    }
    if (options.enableForeignKeys !== false) {
      this.db.pragma('foreign_keys = ON')
    }

    // Initialize schema
    this.initSchema()

    // Create optional JSON indexes
    if (options.jsonIndexes) {
      for (const path of options.jsonIndexes) {
        this.createJsonIndex(path)
      }
    }

    // Prepare statements for performance
    this.statements = this.prepareStatements()
  }

  private initSchema(): void {
    this.db.exec(`
      -- Things table: generic entities with JSON data
      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        embedding BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);
      CREATE INDEX IF NOT EXISTS idx_things_created ON things(created_at);
      CREATE INDEX IF NOT EXISTS idx_things_updated ON things(updated_at);

      -- Relationships table: typed connections between things
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (from_id) REFERENCES things(id) ON DELETE CASCADE,
        FOREIGN KEY (to_id) REFERENCES things(id) ON DELETE CASCADE
      );

      -- Indexes for relationship traversal
      CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_id, type);
      CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_id, type);
      CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(type);

      -- Unique constraint to prevent duplicate relationships
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rel_unique
        ON relationships(from_id, to_id, type);
    `)
  }

  private prepareStatements() {
    return {
      insertThing: this.db.prepare(`
        INSERT INTO things (id, type, data, embedding, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),

      getThing: this.db.prepare(`
        SELECT id, type, data, embedding, created_at, updated_at
        FROM things WHERE id = ?
      `),

      updateThing: this.db.prepare(`
        UPDATE things
        SET type = COALESCE(?, type),
            data = COALESCE(?, data),
            embedding = COALESCE(?, embedding),
            updated_at = ?
        WHERE id = ?
      `),

      deleteThing: this.db.prepare(`
        DELETE FROM things WHERE id = ?
      `),

      findByType: this.db.prepare(`
        SELECT id, type, data, embedding, created_at, updated_at
        FROM things WHERE type = ?
        ORDER BY created_at DESC
      `),

      insertRelationship: this.db.prepare(`
        INSERT INTO relationships (id, from_id, to_id, type, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),

      getRelationship: this.db.prepare(`
        SELECT id, from_id, to_id, type, data, created_at
        FROM relationships WHERE id = ?
      `),

      deleteRelationship: this.db.prepare(`
        DELETE FROM relationships WHERE id = ?
      `),

      findRelatedFrom: this.db.prepare(`
        SELECT t.id, t.type, t.data, t.embedding, t.created_at, t.updated_at
        FROM things t
        JOIN relationships r ON r.to_id = t.id
        WHERE r.from_id = ?
        ORDER BY t.created_at DESC
      `),

      findRelatedTo: this.db.prepare(`
        SELECT t.id, t.type, t.data, t.embedding, t.created_at, t.updated_at
        FROM things t
        JOIN relationships r ON r.from_id = t.id
        WHERE r.to_id = ?
        ORDER BY t.created_at DESC
      `),

      findRelatedFromByType: this.db.prepare(`
        SELECT t.id, t.type, t.data, t.embedding, t.created_at, t.updated_at
        FROM things t
        JOIN relationships r ON r.to_id = t.id
        WHERE r.from_id = ? AND r.type = ?
        ORDER BY t.created_at DESC
      `),

      findRelatedToByType: this.db.prepare(`
        SELECT t.id, t.type, t.data, t.embedding, t.created_at, t.updated_at
        FROM things t
        JOIN relationships r ON r.from_id = t.id
        WHERE r.to_id = ? AND r.type = ?
        ORDER BY t.created_at DESC
      `),
    }
  }

  /**
   * Create an index on a JSON path for faster queries
   * Uses SQLite's generated columns feature
   */
  createJsonIndex(jsonPath: string): void {
    // Sanitize path for column name (replace dots and $ with underscores)
    const columnName = `json_${jsonPath.replace(/[\$\.]/g, '_').replace(/^_+/, '')}`
    const tableName = `idx_json_${columnName}`

    try {
      // Create a virtual column for the JSON path
      this.db.exec(`
        ALTER TABLE things
        ADD COLUMN ${columnName} TEXT
        GENERATED ALWAYS AS (json_extract(data, '${jsonPath}')) VIRTUAL
      `)

      // Create an index on the virtual column
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS ${tableName} ON things(${columnName})
      `)
    } catch (err: unknown) {
      // Column might already exist, ignore duplicate column errors
      const errMessage = (err as Error).message
      if (!errMessage.includes('duplicate column name')) {
        throw err
      }
    }
  }

  // ============================================================================
  // Thing CRUD Operations
  // ============================================================================

  createThing(input: ThingInput): Thing {
    const id = input.id ?? generateId()
    const now = Date.now()
    const dataJson = JSON.stringify(input.data)
    const embeddingBlob = input.embedding
      ? serializeEmbedding(input.embedding)
      : null

    this.statements.insertThing.run(
      id,
      input.type,
      dataJson,
      embeddingBlob,
      now,
      now
    )

    return {
      id,
      type: input.type,
      data: input.data,
      embedding: input.embedding ? new Float32Array(input.embedding) : null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  getThing(id: string): Thing | null {
    const row = this.statements.getThing.get(id) as ThingRow | undefined
    return row ? this.rowToThing(row) : null
  }

  updateThing(id: string, updates: Partial<ThingInput>): Thing {
    const now = Date.now()

    // Get current thing to merge with
    const current = this.getThing(id)
    if (!current) {
      throw new Error(`Thing not found: ${id}`)
    }

    const type = updates.type ?? null
    const dataJson = updates.data ? JSON.stringify(updates.data) : null
    const embeddingBlob = updates.embedding
      ? serializeEmbedding(updates.embedding)
      : null

    const result = this.statements.updateThing.run(
      type,
      dataJson,
      embeddingBlob,
      now,
      id
    )

    if (result.changes === 0) {
      throw new Error(`Thing not found: ${id}`)
    }

    return this.getThing(id)!
  }

  deleteThing(id: string): void {
    const result = this.statements.deleteThing.run(id)
    if (result.changes === 0) {
      throw new Error(`Thing not found: ${id}`)
    }
  }

  // ============================================================================
  // Relationship CRUD Operations
  // ============================================================================

  createRelationship(input: RelationshipInput): Relationship {
    const id = input.id ?? generateId()
    const now = Date.now()
    const dataJson = input.data ? JSON.stringify(input.data) : null

    try {
      this.statements.insertRelationship.run(
        id,
        input.fromId,
        input.toId,
        input.type,
        dataJson,
        now
      )
    } catch (err: unknown) {
      const errMessage = (err as Error).message
      if (errMessage.includes('UNIQUE constraint failed')) {
        throw new Error(
          `Relationship already exists: ${input.fromId} -[${input.type}]-> ${input.toId}`
        )
      }
      if (errMessage.includes('FOREIGN KEY constraint failed')) {
        throw new Error(
          `Referenced thing not found: ${input.fromId} or ${input.toId}`
        )
      }
      throw err
    }

    return {
      id,
      fromId: input.fromId,
      toId: input.toId,
      type: input.type,
      data: input.data ?? null,
      createdAt: new Date(now),
    }
  }

  getRelationship(id: string): Relationship | null {
    const row = this.statements.getRelationship.get(id) as
      | RelationshipRow
      | undefined
    return row ? this.rowToRelationship(row) : null
  }

  deleteRelationship(id: string): void {
    const result = this.statements.deleteRelationship.run(id)
    if (result.changes === 0) {
      throw new Error(`Relationship not found: ${id}`)
    }
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  /**
   * Execute raw SQL query
   */
  query<T = unknown>(sql: string, params: unknown[] = []): QueryResult<T> {
    const stmt = this.db.prepare(sql)
    const isSelect = sql.trim().toUpperCase().startsWith('SELECT')

    if (isSelect) {
      const rows = stmt.all(...params) as T[]
      return {
        rows,
        columns: stmt.columns().map((c) => c.name),
      }
    } else {
      const result = stmt.run(...params)
      return {
        rows: [],
        columns: [],
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      }
    }
  }

  /**
   * Find all things of a given type
   */
  findByType(type: string): Thing[] {
    const rows = this.statements.findByType.all(type) as ThingRow[]
    return rows.map((row) => this.rowToThing(row))
  }

  /**
   * Find things by JSON path query
   * Uses json_extract() for flexible querying
   */
  findByJsonPath(path: string, value: unknown): Thing[] {
    // Use prepared statement with json_extract
    const sql = `
      SELECT id, type, data, embedding, created_at, updated_at
      FROM things
      WHERE json_extract(data, ?) = ?
      ORDER BY created_at DESC
    `
    const stmt = this.db.prepare(sql)
    // Handle different value types - json_extract returns native types
    let sqlValue: unknown
    if (typeof value === 'string') {
      sqlValue = value
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      sqlValue = value
    } else if (value === null) {
      sqlValue = null
    } else {
      sqlValue = JSON.stringify(value)
    }
    const rows = stmt.all(path, sqlValue) as ThingRow[]
    return rows.map((row) => this.rowToThing(row))
  }

  /**
   * Find things matching multiple JSON conditions
   */
  findByJsonQuery(conditions: Record<string, unknown>): Thing[] {
    const whereClauses: string[] = []
    const params: unknown[] = []

    for (const [path, value] of Object.entries(conditions)) {
      whereClauses.push(`json_extract(data, ?) = ?`)
      params.push(path)
      // Handle different value types appropriately
      if (typeof value === 'string') {
        params.push(value)
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        params.push(value)
      } else {
        params.push(JSON.stringify(value))
      }
    }

    const sql = `
      SELECT id, type, data, embedding, created_at, updated_at
      FROM things
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY created_at DESC
    `
    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as ThingRow[]
    return rows.map((row) => this.rowToThing(row))
  }

  /**
   * Find all things related to a given thing
   * @param thingId - The ID of the source thing
   * @param relType - Optional relationship type filter
   * @param direction - 'outgoing' (from this thing) or 'incoming' (to this thing)
   */
  findRelated(
    thingId: string,
    relType?: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'outgoing'
  ): Thing[] {
    const results: Thing[] = []

    if (direction === 'outgoing' || direction === 'both') {
      const rows = relType
        ? (this.statements.findRelatedFromByType.all(
            thingId,
            relType
          ) as ThingRow[])
        : (this.statements.findRelatedFrom.all(thingId) as ThingRow[])
      results.push(...rows.map((row) => this.rowToThing(row)))
    }

    if (direction === 'incoming' || direction === 'both') {
      const rows = relType
        ? (this.statements.findRelatedToByType.all(
            thingId,
            relType
          ) as ThingRow[])
        : (this.statements.findRelatedTo.all(thingId) as ThingRow[])
      results.push(...rows.map((row) => this.rowToThing(row)))
    }

    return results
  }

  /**
   * Find relationships for a thing
   */
  findRelationships(
    thingId: string,
    relType?: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'outgoing'
  ): Relationship[] {
    const results: Relationship[] = []

    if (direction === 'outgoing' || direction === 'both') {
      const sql = relType
        ? `SELECT * FROM relationships WHERE from_id = ? AND type = ?`
        : `SELECT * FROM relationships WHERE from_id = ?`
      const stmt = this.db.prepare(sql)
      const rows = (
        relType ? stmt.all(thingId, relType) : stmt.all(thingId)
      ) as RelationshipRow[]
      results.push(...rows.map((row) => this.rowToRelationship(row)))
    }

    if (direction === 'incoming' || direction === 'both') {
      const sql = relType
        ? `SELECT * FROM relationships WHERE to_id = ? AND type = ?`
        : `SELECT * FROM relationships WHERE to_id = ?`
      const stmt = this.db.prepare(sql)
      const rows = (
        relType ? stmt.all(thingId, relType) : stmt.all(thingId)
      ) as RelationshipRow[]
      results.push(...rows.map((row) => this.rowToRelationship(row)))
    }

    return results
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  /**
   * Create multiple things in a single transaction
   */
  createThings(inputs: ThingInput[]): Thing[] {
    const things: Thing[] = []

    const insertMany = this.db.transaction((items: ThingInput[]) => {
      for (const input of items) {
        things.push(this.createThing(input))
      }
    })

    insertMany(inputs)
    return things
  }

  /**
   * Create multiple relationships in a single transaction
   */
  createRelationships(inputs: RelationshipInput[]): Relationship[] {
    const relationships: Relationship[] = []

    const insertMany = this.db.transaction((items: RelationshipInput[]) => {
      for (const input of items) {
        relationships.push(this.createRelationship(input))
      }
    })

    insertMany(inputs)
    return relationships
  }

  // ============================================================================
  // Stats and Maintenance
  // ============================================================================

  /**
   * Get database statistics
   */
  stats(): {
    thingCount: number
    relationshipCount: number
    sizeBytes: number
  } {
    const thingCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM things').get() as {
        count: number
      }
    ).count
    const relationshipCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM relationships').get() as {
        count: number
      }
    ).count

    // Get page count and page size for size calculation
    const pageCount = (this.db.pragma('page_count')[0] as Record<string, unknown>)['page_count'] as number
    const pageSize = (this.db.pragma('page_size')[0] as Record<string, unknown>)['page_size'] as number

    return {
      thingCount,
      relationshipCount,
      sizeBytes: pageCount * pageSize,
    }
  }

  /**
   * Optimize the database
   */
  optimize(): void {
    this.db.pragma('optimize')
    this.db.exec('VACUUM')
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close()
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private rowToThing(row: ThingRow): Thing {
    return {
      id: row.id,
      type: row.type,
      data: JSON.parse(row.data),
      embedding: row.embedding ? deserializeEmbedding(row.embedding) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  private rowToRelationship(row: RelationshipRow): Relationship {
    return {
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      type: row.type,
      data: row.data ? JSON.parse(row.data) : null,
      createdAt: new Date(row.created_at),
    }
  }
}

// ============================================================================
// Internal Types
// ============================================================================

interface ThingRow {
  id: string
  type: string
  data: string
  embedding: Buffer | null
  created_at: number
  updated_at: number
}

interface RelationshipRow {
  id: string
  from_id: string
  to_id: string
  type: string
  data: string | null
  created_at: number
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique ID using timestamp + random suffix
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}_${random}`
}

/**
 * Serialize Float32Array to Buffer for storage
 */
function serializeEmbedding(
  embedding: Float32Array | number[]
): Buffer {
  const array =
    embedding instanceof Float32Array
      ? embedding
      : new Float32Array(embedding)
  return Buffer.from(array.buffer)
}

/**
 * Deserialize Buffer back to Float32Array
 */
function deserializeEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )
  )
}

// Export utility functions for testing
export { generateId, serializeEmbedding, deserializeEmbedding }
