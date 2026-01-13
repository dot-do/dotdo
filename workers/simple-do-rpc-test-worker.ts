/**
 * Simple DO RPC Test Worker
 *
 * A minimal test worker that directly extends DurableObject
 * to verify Workers RPC works at all before using the full DOBase class.
 *
 * @module workers/simple-do-rpc-test-worker
 */

import { DurableObject } from 'cloudflare:workers'
import { RpcTarget } from 'cloudflare:workers'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/durable-sqlite'

// ============================================================================
// SIMPLE DURABLE OBJECT
// ============================================================================

interface ThingRecord {
  id: string
  type: string
  name: string | null
  data: string | null
}

/**
 * Simple DO that directly extends DurableObject for RPC testing.
 */
export class SimpleDO extends DurableObject {
  private db: ReturnType<typeof drizzle>
  private initialized = false

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env)
    this.db = drizzle(ctx.storage)
  }

  private async ensureSchema() {
    if (this.initialized) return
    try {
      await this.db.run(sql.raw(`
        CREATE TABLE IF NOT EXISTS simple_things (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT,
          data TEXT
        )
      `))
      this.initialized = true
    } catch {
      this.initialized = true
    }
  }

  /**
   * Simple RPC method to create a thing
   */
  async createThing(type: string, name: string): Promise<ThingRecord> {
    await this.ensureSchema()
    const id = crypto.randomUUID()
    await this.db.run(sql.raw(`INSERT INTO simple_things (id, type, name) VALUES ('${id}', '${type}', '${name}')`))
    return { id, type, name, data: null }
  }

  /**
   * Simple RPC method to get a thing
   */
  async getThing(id: string): Promise<ThingRecord | null> {
    await this.ensureSchema()
    const result = await this.db.all(sql.raw(`SELECT * FROM simple_things WHERE id = '${id}'`))
    const rows = result as ThingRecord[]
    return rows[0] ?? null
  }

  /**
   * Simple RPC method to list things
   */
  async listThings(): Promise<ThingRecord[]> {
    await this.ensureSchema()
    const result = await this.db.all(sql.raw(`SELECT * FROM simple_things`))
    return result as ThingRecord[]
  }

  /**
   * Simple RPC property - namespace
   */
  get ns(): string {
    return 'simple-do'
  }

  /**
   * Simple RPC method to echo back a value
   */
  async echo(value: string): Promise<string> {
    return `Echo: ${value}`
  }

  /**
   * Fetch handler
   */
  async fetch(request: Request): Promise<Response> {
    return Response.json({ ok: true, ns: this.ns })
  }
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

export interface SimpleEnv {
  SIMPLE_DO: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: SimpleEnv): Promise<Response> {
    const id = env.SIMPLE_DO.idFromName('test')
    const stub = env.SIMPLE_DO.get(id)
    return stub.fetch(request)
  },
}
