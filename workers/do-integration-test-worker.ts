/**
 * DO Integration Test Worker
 *
 * Test worker that exports DOBase for integration tests with real SQLite storage.
 * Used by @cloudflare/vitest-pool-workers to test the REST router and DO lifecycle
 * with actual Durable Object SQLite persistence.
 *
 * @module workers/do-integration-test-worker
 */

import { DO } from '../objects/DOBase'
import type { Env } from '../objects/DOBase'
import { sql } from 'drizzle-orm'

// ============================================================================
// SCHEMA INITIALIZATION SQL
// ============================================================================

/**
 * Schema statements for integration tests.
 * Each statement creates a table or index needed for ThingsStore to work.
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
]

// ============================================================================
// TEST DURABLE OBJECT
// ============================================================================

/**
 * Test DO class that extends DOBase for integration testing.
 * Provides full DOBase functionality including:
 * - REST router (GET/POST/PUT/PATCH/DELETE)
 * - ThingsStore with real SQLite persistence
 * - JSON-LD response formatting
 */
export class TestDO extends DO<Env> {
  static readonly $type = 'TestDO'

  private schemaInitialized = false

  /**
   * Override getRegisteredNouns to provide known nouns for testing.
   * This enables the REST router to recognize these types.
   */
  protected override getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    return [
      { noun: 'Customer', plural: 'customers' },
      { noun: 'Order', plural: 'orders' },
      { noun: 'Product', plural: 'products' },
      { noun: 'User', plural: 'users' },
      { noun: 'Item', plural: 'items' },
      { noun: 'Task', plural: 'tasks' },
    ]
  }

  /**
   * Initialize SQLite schema on first access.
   * This creates the tables needed for ThingsStore operations.
   */
  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      // Run each schema statement
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          // Ignore "already exists" errors
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[TestDO] Schema statement failed:', err)
          }
        }
      }

      this.schemaInitialized = true
    } catch (error) {
      // Schema might already exist, that's fine
      console.error('[TestDO] Schema init error:', error)
      this.schemaInitialized = true
    }
  }

  /**
   * Override fetch to auto-derive namespace from X-DO-NS header
   * and initialize schema on first request.
   */
  override async fetch(request: Request): Promise<Response> {
    // Initialize schema on first request
    await this.initSchema()

    // Get ns from header, falling back to stored value or DO id
    const headerNs = request.headers.get('X-DO-NS')
    if (headerNs && !this.ns) {
      // @ts-expect-error - Setting readonly ns
      this.ns = headerNs
      // Persist for future requests
      await this.ctx.storage.put('ns', headerNs)
    }

    // If still no ns, try to load from storage or use DO id
    if (!this.ns) {
      const storedNs = await this.ctx.storage.get<string>('ns')
      if (storedNs) {
        // @ts-expect-error - Setting readonly ns
        this.ns = storedNs
      } else {
        // Use DO id as fallback
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

export interface TestEnv extends Env {
  TEST_DO: DurableObjectNamespace
}

/**
 * Worker entry point for DO integration tests.
 * Routes requests to the TestDO based on namespace from header or subdomain.
 */
export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    // Extract namespace from header or use default
    const ns = request.headers.get('X-DO-NS') || 'test'

    // Get DO stub by name
    const id = env.TEST_DO.idFromName(ns)
    const stub = env.TEST_DO.get(id)

    // Forward request to DO
    return stub.fetch(request)
  },
}
