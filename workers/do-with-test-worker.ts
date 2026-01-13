/**
 * DO.with() Integration Test Worker
 *
 * Test worker that exports multiple DO classes using DO.with() for testing
 * eager initialization of features via blockConcurrencyWhile().
 *
 * This worker tests:
 * - DO.with({ things: true }) eagerly initializes ThingsStore
 * - DO.with({ search: true }) eagerly initializes SearchStore
 * - DO.with({ things: true, relationships: true, events: true }) for multiple features
 * - Base DO (no eager init) for comparison
 *
 * IMPORTANT: These tests use REAL miniflare DOs with SQLite storage.
 * NO MOCKS - this tests actual runtime behavior with real blockConcurrencyWhile().
 *
 * @module workers/do-with-test-worker
 */

import { DO } from '../objects/DOBase'
import type { Env } from '../objects/DOBase'
import { sql } from 'drizzle-orm'

// ============================================================================
// SCHEMA INITIALIZATION SQL
// ============================================================================

/**
 * Schema statements needed for store operations.
 * These are created by eager initialization when using DO.with().
 */
const SCHEMA_STATEMENTS = [
  // Nouns table (type registry)
  `CREATE TABLE IF NOT EXISTS nouns (
    noun TEXT PRIMARY KEY,
    plural TEXT,
    description TEXT,
    schema TEXT,
    do_class TEXT
  )`,

  // Things table (entity storage)
  `CREATE TABLE IF NOT EXISTS things (
    id TEXT NOT NULL,
    type INTEGER NOT NULL,
    branch TEXT,
    name TEXT,
    data TEXT,
    deleted INTEGER DEFAULT 0,
    visibility TEXT DEFAULT 'user'
  )`,

  // Indexes for things table
  `CREATE INDEX IF NOT EXISTS things_id_idx ON things(id)`,
  `CREATE INDEX IF NOT EXISTS things_type_idx ON things(type)`,
  `CREATE INDEX IF NOT EXISTS things_branch_idx ON things(branch)`,
  `CREATE INDEX IF NOT EXISTS things_id_branch_idx ON things(id, branch)`,

  // Relationships table
  `CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    data TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // Indexes for relationships table
  `CREATE INDEX IF NOT EXISTS relationships_from_idx ON relationships("from")`,
  `CREATE INDEX IF NOT EXISTS relationships_to_idx ON relationships("to")`,
  `CREATE INDEX IF NOT EXISTS relationships_verb_idx ON relationships(verb)`,

  // Events table
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    source TEXT NOT NULL,
    data TEXT,
    action_id TEXT,
    sequence INTEGER,
    streamed INTEGER DEFAULT 0,
    streamed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // Search table (with FTS)
  // Note: Column names must match schema.search ($id, $type) for Drizzle compatibility
  `CREATE TABLE IF NOT EXISTS search (
    "$id" TEXT PRIMARY KEY,
    "$type" TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB,
    embedding_dim INTEGER,
    cluster INTEGER,
    lsh1 TEXT,
    lsh2 TEXT,
    lsh3 TEXT,
    semantic_l1 TEXT,
    semantic_l2 TEXT,
    semantic_l3 TEXT,
    indexed_at INTEGER NOT NULL
  )`,

  // Actions table
  `CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    actor TEXT,
    target TEXT NOT NULL,
    input TEXT,
    output TEXT,
    options TEXT,
    durability TEXT DEFAULT 'try',
    status TEXT DEFAULT 'pending',
    error TEXT,
    request_id TEXT,
    session_id TEXT,
    workflow_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT,
    duration INTEGER,
    retry_count INTEGER DEFAULT 0
  )`,

  // Objects table (DO registry)
  `CREATE TABLE IF NOT EXISTS objects (
    ns TEXT NOT NULL,
    id TEXT NOT NULL,
    class TEXT NOT NULL,
    relation TEXT,
    shard_key TEXT,
    shard_index INTEGER,
    region TEXT,
    is_primary INTEGER,
    cached TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (ns, id)
  )`,

  // DLQ table (dead letter queue)
  `CREATE TABLE IF NOT EXISTS dlq (
    id TEXT PRIMARY KEY,
    event_key TEXT NOT NULL,
    payload TEXT NOT NULL,
    error TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_attempt_at TEXT
  )`,
]

// ============================================================================
// BASE TEST DO WITH SCHEMA INIT
// ============================================================================

/**
 * Base class that provides schema initialization for all test DOs.
 * This ensures tables exist before we test eager initialization.
 */
class BaseTestDO extends DO<Env> {
  protected schemaInitialized = false

  // Track when blockConcurrencyWhile was called
  protected initTimestamp: number = 0
  protected featuresInitialized: string[] = []

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize schema during construction
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
    })
  }

  protected async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[BaseTestDO] Schema statement failed:', err)
          }
        }
      }
      this.schemaInitialized = true
    } catch (error) {
      console.error('[BaseTestDO] Schema init error:', error)
      this.schemaInitialized = true
    }
  }

  protected override getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    return [
      { noun: 'Customer', plural: 'customers' },
      { noun: 'Order', plural: 'orders' },
      { noun: 'Product', plural: 'products' },
      { noun: 'User', plural: 'users' },
    ]
  }

  /**
   * RPC method to check if a table exists in SQLite.
   */
  async tableExists(tableName: string): Promise<boolean> {
    const result = this.ctx.storage.sql.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      tableName
    ).toArray()
    return result.length > 0
  }

  /**
   * RPC method to get the initialization timestamp.
   */
  getInitTimestamp(): number {
    return this.initTimestamp
  }

  /**
   * RPC method to get which features were eagerly initialized.
   */
  getFeaturesInitialized(): string[] {
    return this.featuresInitialized
  }

  /**
   * RPC method to check if ThingsStore is ready (table exists).
   */
  async isThingsReady(): Promise<boolean> {
    return this.tableExists('things')
  }

  /**
   * RPC method to check if RelationshipsStore is ready (table exists).
   */
  async isRelsReady(): Promise<boolean> {
    return this.tableExists('relationships')
  }

  /**
   * RPC method to check if EventsStore is ready (table exists).
   */
  async isEventsReady(): Promise<boolean> {
    return this.tableExists('events')
  }

  /**
   * RPC method to check if SearchStore is ready (table exists).
   */
  async isSearchReady(): Promise<boolean> {
    return this.tableExists('search')
  }

  /**
   * RPC method to check if ActionsStore is ready (table exists).
   */
  async isActionsReady(): Promise<boolean> {
    return this.tableExists('actions')
  }

  /**
   * RPC method to create a thing and verify eager init worked.
   */
  async createThing(data: { $type: string; name: string }): Promise<{
    $id: string
    $type: string
    name: string
    success: boolean
  }> {
    try {
      const result = await this.things.create(data)
      return {
        $id: result.$id,
        $type: result.$type,
        name: result.name || '',
        success: true,
      }
    } catch (error) {
      throw new Error(`Failed to create thing: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * RPC method to get a thing by ID.
   */
  async getThing(id: string): Promise<{
    $id: string
    $type: string
    name: string
  } | null> {
    const result = await this.things.get(id)
    if (!result) return null
    return {
      $id: result.$id,
      $type: result.$type,
      name: result.name || '',
    }
  }

  /**
   * RPC method to create a relationship.
   */
  async createRelationship(data: {
    verb: string
    from: string
    to: string
  }): Promise<{ id: string; success: boolean }> {
    try {
      const result = await this.rels.create(data)
      return { id: result.id, success: true }
    } catch (error) {
      throw new Error(`Failed to create relationship: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * RPC method to emit an event.
   */
  async emitEvent(data: {
    verb: string
    source: string
    data: Record<string, unknown>
  }): Promise<{ id: string; success: boolean }> {
    try {
      const result = await this.events.emit(data)
      return { id: result.id, success: true }
    } catch (error) {
      throw new Error(`Failed to emit event: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// ============================================================================
// DO.WITH() CLASSES FOR TESTING
// ============================================================================

/**
 * DO with things feature eagerly initialized.
 * Uses DO.with({ things: true }) to ensure ThingsStore is ready on first request.
 */
const DOWithThingsBase = DO.with({ things: true })

export class DOWithThings extends DOWithThingsBase {
  static readonly $type = 'DOWithThings'

  protected schemaInitialized = false
  protected initTimestamp: number = 0
  protected featuresInitialized: string[] = ['things']

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Record when eager init happened
    this.initTimestamp = Date.now()

    // Initialize schema first
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
    })
  }

  protected async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            // Ignore
          }
        }
      }
      this.schemaInitialized = true
    } catch {
      this.schemaInitialized = true
    }
  }

  protected override getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    return [
      { noun: 'Customer', plural: 'customers' },
      { noun: 'Order', plural: 'orders' },
    ]
  }

  // RPC methods
  async tableExists(tableName: string): Promise<boolean> {
    const result = this.ctx.storage.sql.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      tableName
    ).toArray()
    return result.length > 0
  }

  getInitTimestamp(): number { return this.initTimestamp }
  getFeaturesInitialized(): string[] { return this.featuresInitialized }

  async isThingsReady(): Promise<boolean> { return this.tableExists('things') }
  async isRelsReady(): Promise<boolean> { return this.tableExists('relationships') }
  async isEventsReady(): Promise<boolean> { return this.tableExists('events') }
  async isSearchReady(): Promise<boolean> { return this.tableExists('search') }

  async createThing(data: { $type: string; name: string }): Promise<{
    $id: string
    $type: string
    name: string
    success: boolean
  }> {
    const result = await this.things.create(data)
    return {
      $id: result.$id,
      $type: result.$type,
      name: result.name || '',
      success: true,
    }
  }

  async getThing(id: string): Promise<{ $id: string; $type: string; name: string } | null> {
    const result = await this.things.get(id)
    if (!result) return null
    return { $id: result.$id, $type: result.$type, name: result.name || '' }
  }
}

/**
 * DO with search feature eagerly initialized.
 * Uses DO.with({ search: true }) to ensure SearchStore is ready on first request.
 */
const DOWithSearchBase = DO.with({ search: true })

export class DOWithSearch extends DOWithSearchBase {
  static readonly $type = 'DOWithSearch'

  protected schemaInitialized = false
  protected initTimestamp: number = 0
  protected featuresInitialized: string[] = ['search']

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.initTimestamp = Date.now()

    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
    })
  }

  protected async initSchema(): Promise<void> {
    if (this.schemaInitialized) return
    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch {
          // Ignore
        }
      }
      this.schemaInitialized = true
    } catch {
      this.schemaInitialized = true
    }
  }

  protected override getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    return [{ noun: 'Document', plural: 'documents' }]
  }

  // RPC methods
  async tableExists(tableName: string): Promise<boolean> {
    const result = this.ctx.storage.sql.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      tableName
    ).toArray()
    return result.length > 0
  }

  getInitTimestamp(): number { return this.initTimestamp }
  getFeaturesInitialized(): string[] { return this.featuresInitialized }

  async isSearchReady(): Promise<boolean> { return this.tableExists('search') }
  async isThingsReady(): Promise<boolean> { return this.tableExists('things') }

  async indexDocument(data: { $id: string; $type: string; content: string }): Promise<{
    $id: string
    success: boolean
  }> {
    const result = await this.search.index(data)
    return { $id: result.$id, success: true }
  }

  async searchDocuments(query: string): Promise<{ $id: string; score: number }[]> {
    const results = await this.search.query(query)
    return results.map((r) => ({ $id: r.$id, score: r.score }))
  }
}

/**
 * DO with multiple features eagerly initialized.
 * Uses DO.with({ things: true, relationships: true, events: true }) for comprehensive init.
 */
const DOWithMultipleBase = DO.with({
  things: true,
  relationships: true,
  events: true,
  actions: true,
})

export class DOWithMultiple extends DOWithMultipleBase {
  static readonly $type = 'DOWithMultiple'

  protected schemaInitialized = false
  protected initTimestamp: number = 0
  protected featuresInitialized: string[] = ['things', 'relationships', 'events', 'actions']

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.initTimestamp = Date.now()

    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
    })
  }

  protected async initSchema(): Promise<void> {
    if (this.schemaInitialized) return
    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch {
          // Ignore
        }
      }
      this.schemaInitialized = true
    } catch {
      this.schemaInitialized = true
    }
  }

  protected override getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    return [
      { noun: 'Customer', plural: 'customers' },
      { noun: 'Order', plural: 'orders' },
      { noun: 'Product', plural: 'products' },
    ]
  }

  // RPC methods
  async tableExists(tableName: string): Promise<boolean> {
    const result = this.ctx.storage.sql.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      tableName
    ).toArray()
    return result.length > 0
  }

  getInitTimestamp(): number { return this.initTimestamp }
  getFeaturesInitialized(): string[] { return this.featuresInitialized }

  async isThingsReady(): Promise<boolean> { return this.tableExists('things') }
  async isRelsReady(): Promise<boolean> { return this.tableExists('relationships') }
  async isEventsReady(): Promise<boolean> { return this.tableExists('events') }
  async isActionsReady(): Promise<boolean> { return this.tableExists('actions') }

  async createThing(data: { $type: string; name: string }): Promise<{
    $id: string
    $type: string
    name: string
    success: boolean
  }> {
    const result = await this.things.create(data)
    return {
      $id: result.$id,
      $type: result.$type,
      name: result.name || '',
      success: true,
    }
  }

  async getThing(id: string): Promise<{ $id: string; $type: string; name: string } | null> {
    const result = await this.things.get(id)
    if (!result) return null
    return { $id: result.$id, $type: result.$type, name: result.name || '' }
  }

  async createRelationship(data: { verb: string; from: string; to: string }): Promise<{
    id: string
    success: boolean
  }> {
    const result = await this.rels.create(data)
    return { id: result.id, success: true }
  }

  async emitEvent(data: { verb: string; source: string; data: Record<string, unknown> }): Promise<{
    id: string
    success: boolean
  }> {
    const result = await this.events.emit(data)
    return { id: result.id, success: true }
  }

  async logAction(data: { verb: string; target: string }): Promise<{
    id: string
    success: boolean
  }> {
    const result = await this.actions.log(data)
    return { id: result.id, success: true }
  }
}

/**
 * Plain DO without eager initialization (for comparison).
 * Uses base DO class directly to show lazy init behavior.
 */
export class DOBase extends BaseTestDO {
  static readonly $type = 'DOBase'
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

export interface DOWithTestEnv extends Env {
  DO_WITH_THINGS: DurableObjectNamespace
  DO_WITH_SEARCH: DurableObjectNamespace
  DO_WITH_MULTIPLE: DurableObjectNamespace
  DO_BASE: DurableObjectNamespace
}

/**
 * Worker entry point for DO.with() integration tests.
 * Routes requests to appropriate DO class based on X-DO-CLASS header.
 */
export default {
  async fetch(request: Request, env: DOWithTestEnv): Promise<Response> {
    const doClass = request.headers.get('X-DO-CLASS') || 'DOBase'
    const ns = request.headers.get('X-DO-NS') || 'test'

    let namespace: DurableObjectNamespace

    switch (doClass) {
      case 'DOWithThings':
        namespace = env.DO_WITH_THINGS
        break
      case 'DOWithSearch':
        namespace = env.DO_WITH_SEARCH
        break
      case 'DOWithMultiple':
        namespace = env.DO_WITH_MULTIPLE
        break
      case 'DOBase':
      default:
        namespace = env.DO_BASE
        break
    }

    const id = namespace.idFromName(ns)
    const stub = namespace.get(id)

    return stub.fetch(request)
  },
}
