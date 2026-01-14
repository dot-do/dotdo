/**
 * Geo-Replication Test Worker
 *
 * Test worker that exports DOFull for geo-replication integration tests.
 * DOFull includes the GeoReplication module accessible via stub.geo.*
 *
 * @module workers/geo-replication-test-worker
 */

import { DO as DOFull } from '../objects/DOFull'
import type { Env } from '../objects/DOFull'
import { sql } from 'drizzle-orm'

// ============================================================================
// SCHEMA INITIALIZATION SQL
// ============================================================================

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

  // Events table (append-only event log)
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    source TEXT NOT NULL,
    data TEXT,
    action_id TEXT,
    sequence INTEGER NOT NULL,
    streamed INTEGER DEFAULT 0,
    streamed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // Indexes for events table
  `CREATE INDEX IF NOT EXISTS events_verb_idx ON events(verb)`,
  `CREATE INDEX IF NOT EXISTS events_source_idx ON events(source)`,
  `CREATE INDEX IF NOT EXISTS events_sequence_idx ON events(sequence)`,
  `CREATE INDEX IF NOT EXISTS events_streamed_idx ON events(streamed)`,

  // Actions table (workflow action log)
  `CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    target TEXT NOT NULL,
    actor TEXT,
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
    duration INTEGER
  )`,

  // Indexes for actions table
  `CREATE INDEX IF NOT EXISTS actions_target_idx ON actions(target)`,
  `CREATE INDEX IF NOT EXISTS actions_actor_idx ON actions(actor)`,
  `CREATE INDEX IF NOT EXISTS actions_status_idx ON actions(status)`,
  `CREATE INDEX IF NOT EXISTS actions_verb_idx ON actions(verb)`,
]

// ============================================================================
// GEO-REPLICATION TEST DURABLE OBJECT
// ============================================================================

/**
 * GeoDO class that extends DOFull for geo-replication testing.
 * Provides full DOFull functionality including:
 * - GeoReplication module via stub.geo.*
 * - REST router
 * - ThingsStore with real SQLite persistence
 * - Sharding, branching, and other lifecycle operations
 */
export class GeoDO extends DOFull<Env> {
  static readonly $type = 'GeoDO'

  private schemaInitialized = false

  /**
   * Override getRegisteredNouns to provide known nouns for testing.
   */
  protected override getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    return [
      { noun: 'Customer', plural: 'customers' },
      { noun: 'Order', plural: 'orders' },
      { noun: 'Product', plural: 'products' },
      { noun: 'User', plural: 'users' },
      { noun: 'Item', plural: 'items' },
      { noun: 'Task', plural: 'tasks' },
      { noun: 'GeoData', plural: 'geodata' },
      { noun: 'ReplicatedItem', plural: 'replicateditems' },
    ]
  }

  /**
   * Initialize SQLite schema on first access.
   */
  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[GeoDO] Schema statement failed:', err)
          }
        }
      }
      this.schemaInitialized = true
    } catch (error) {
      console.error('[GeoDO] Schema init error:', error)
      this.schemaInitialized = true
    }
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize schema during construction using blockConcurrencyWhile
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
      const storedNs = await ctx.storage.get<string>('ns')
      if (storedNs) {
        // @ts-expect-error - Setting readonly ns
        this.ns = storedNs
      } else {
        // @ts-expect-error - Setting readonly ns
        this.ns = ctx.id.toString()
      }
    })
  }

  override async fetch(request: Request): Promise<Response> {
    const headerNs = request.headers.get('X-DO-NS')
    if (headerNs) {
      // @ts-expect-error - Setting readonly ns
      this.ns = headerNs
      await this.ctx.storage.put('ns', headerNs)
    } else if (!this.ns) {
      const storedNs = await this.ctx.storage.get<string>('ns')
      if (storedNs) {
        // @ts-expect-error - Setting readonly ns
        this.ns = storedNs
      } else {
        // @ts-expect-error - Setting readonly ns
        this.ns = this.ctx.id.toString()
      }
    }

    return super.fetch(request)
  }
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

export interface GeoTestEnv extends Env {
  DO: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: GeoTestEnv): Promise<Response> {
    const ns = request.headers.get('X-DO-NS') || 'test'
    const id = env.DO.idFromName(ns)
    const stub = env.DO.get(id)
    return stub.fetch(request)
  },
}
