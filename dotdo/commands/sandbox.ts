/**
 * Local Sandbox for dotdo REPL
 *
 * Creates an in-memory Durable Object sandbox using Miniflare for local development
 * and interactive exploration. The sandbox provides a fully functional DO environment
 * with things, events, relationships, and $ context.
 *
 * @module dotdo/commands/sandbox
 */

import type { Transport, TransportState, RPCMessage, RPCResponse } from 'rpc.do'

/**
 * DO script for local sandbox - matches the core DO functionality
 * Provides things, events, relationships stores and basic $ context
 */
const SANDBOX_DO_SCRIPT = `
import { DurableObject } from 'cloudflare:workers'

// Simple ID generator
function generateId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

export class SandboxDO extends DurableObject {
  constructor(state, env) {
    super(state, env)
    this.sql = state.storage.sql
    this.state = state

    // Initialize SQLite tables
    state.blockConcurrencyWhile(async () => {
      // Things table
      this.sql.exec(\`
        CREATE TABLE IF NOT EXISTS things (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          version INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      \`)
      this.sql.exec('CREATE INDEX IF NOT EXISTS idx_things_type ON things(type)')

      // Events table
      this.sql.exec(\`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT,
          timestamp INTEGER NOT NULL,
          metadata TEXT
        )
      \`)
      this.sql.exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)')
      this.sql.exec('CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)')

      // Relationships table
      this.sql.exec(\`
        CREATE TABLE IF NOT EXISTS relationships (
          id TEXT PRIMARY KEY,
          from_id TEXT NOT NULL,
          from_type TEXT NOT NULL,
          relation TEXT NOT NULL,
          to_id TEXT NOT NULL,
          to_type TEXT NOT NULL,
          metadata TEXT,
          created_at INTEGER NOT NULL
        )
      \`)
      this.sql.exec('CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_id, from_type)')
      this.sql.exec('CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_id, to_type)')
      this.sql.exec('CREATE INDEX IF NOT EXISTS idx_rel_relation ON relationships(relation)')
    })
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // Health check
      if (path === '/' || path === '/health') {
        return Response.json({
          status: 'ok',
          id: this.state.id.toString(),
          mode: 'sandbox',
          timestamp: Date.now()
        })
      }

      // RPC endpoint
      if (path === '/rpc' && method === 'POST') {
        const body = await request.json()
        const { method: rpcMethod, args = [] } = body

        try {
          const result = await this.handleRpc(rpcMethod, args)
          return Response.json(result)
        } catch (error) {
          return Response.json({
            type: 'RPCError',
            code: 'EXECUTION_ERROR',
            message: error.message
          }, { status: 400 })
        }
      }

      // Types endpoint for autocomplete
      if (path === '/rpc' && method === 'POST') {
        const body = await request.json()
        if (body.method === '_types') {
          return Response.json(this.getTypes())
        }
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
  }

  async handleRpc(method, args) {
    // Parse method path (e.g., "things.create", "events.list")
    const parts = method.split('.')
    const store = parts[0]
    const action = parts[1]

    switch (store) {
      case 'things':
        return this.handleThings(action, args)
      case 'events':
        return this.handleEvents(action, args)
      case 'relationships':
        return this.handleRelationships(action, args)
      case '_types':
        return this.getTypes()
      default:
        throw new Error(\`Unknown store: \${store}\`)
    }
  }

  handleThings(action, args) {
    switch (action) {
      case 'create': {
        const data = args[0] || {}
        const { $type, ...customData } = data
        if (!$type) throw new Error('$type is required')

        const id = generateId()
        const now = Date.now()
        const dataJson = JSON.stringify(customData)

        this.sql.exec(
          'INSERT INTO things (id, type, data, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
          id, $type, dataJson, now, now
        )

        return { $id: id, $type, $version: 1, $createdAt: now, $updatedAt: now, ...customData }
      }

      case 'get': {
        const id = args[0]
        if (!id) throw new Error('id is required')

        const result = this.sql.exec('SELECT * FROM things WHERE id = ?', id)
        const rows = [...result]
        if (rows.length === 0) return null

        const row = rows[0]
        const customData = JSON.parse(row.data)
        return { $id: row.id, $type: row.type, $version: row.version, $createdAt: row.created_at, $updatedAt: row.updated_at, ...customData }
      }

      case 'list': {
        const options = args[0] || {}
        let query = 'SELECT * FROM things'
        const params = []

        if (options.$type || options.type) {
          query += ' WHERE type = ?'
          params.push(options.$type || options.type)
        }

        query += ' ORDER BY created_at DESC'

        if (options.limit) {
          query += ' LIMIT ?'
          params.push(options.limit)
        }

        const result = this.sql.exec(query, ...params)
        const rows = [...result]

        return rows.map(row => {
          const customData = JSON.parse(row.data)
          return { $id: row.id, $type: row.type, $version: row.version, $createdAt: row.created_at, $updatedAt: row.updated_at, ...customData }
        })
      }

      case 'update': {
        const id = args[0]
        const data = args[1] || {}
        if (!id) throw new Error('id is required')

        const existing = this.sql.exec('SELECT * FROM things WHERE id = ?', id)
        const existingRows = [...existing]
        if (existingRows.length === 0) throw new Error('Thing not found: ' + id)

        const row = existingRows[0]
        const existingData = JSON.parse(row.data)
        const { $id, $type, $version, $createdAt, $updatedAt, ...updateData } = data
        const mergedData = { ...existingData, ...updateData }
        const now = Date.now()

        this.sql.exec(
          'UPDATE things SET data = ?, version = version + 1, updated_at = ? WHERE id = ?',
          JSON.stringify(mergedData), now, id
        )

        const updated = this.sql.exec('SELECT * FROM things WHERE id = ?', id)
        const updatedRow = [...updated][0]
        const finalData = JSON.parse(updatedRow.data)
        return { $id: updatedRow.id, $type: updatedRow.type, $version: updatedRow.version, $createdAt: updatedRow.created_at, $updatedAt: updatedRow.updated_at, ...finalData }
      }

      case 'delete': {
        const id = args[0]
        if (!id) throw new Error('id is required')

        this.sql.exec('DELETE FROM things WHERE id = ?', id)
        return { deleted: true, id }
      }

      case 'count': {
        const options = args[0] || {}
        let query = 'SELECT COUNT(*) as count FROM things'
        const params = []

        if (options.$type || options.type) {
          query += ' WHERE type = ?'
          params.push(options.$type || options.type)
        }

        const result = this.sql.exec(query, ...params)
        const rows = [...result]
        return rows[0].count
      }

      default:
        throw new Error(\`Unknown things action: \${action}\`)
    }
  }

  handleEvents(action, args) {
    switch (action) {
      case 'emit': {
        const event = args[0] || {}
        const { type, payload, ...metadata } = event
        if (!type) throw new Error('type is required')

        const id = generateId()
        const now = Date.now()

        this.sql.exec(
          'INSERT INTO events (id, type, payload, timestamp, metadata) VALUES (?, ?, ?, ?, ?)',
          id, type, JSON.stringify(payload || {}), now, JSON.stringify(metadata)
        )

        return { $id: id, type, payload, timestamp: now, ...metadata }
      }

      case 'list': {
        const options = args[0] || {}
        let query = 'SELECT * FROM events'
        const params = []
        const conditions = []

        if (options.type) {
          conditions.push('type = ?')
          params.push(options.type)
        }

        if (options.since) {
          conditions.push('timestamp > ?')
          params.push(options.since)
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ')
        }

        query += ' ORDER BY timestamp DESC'

        if (options.limit) {
          query += ' LIMIT ?'
          params.push(options.limit)
        }

        const result = this.sql.exec(query, ...params)
        return [...result].map(row => ({
          $id: row.id,
          type: row.type,
          payload: JSON.parse(row.payload || '{}'),
          timestamp: row.timestamp,
          ...JSON.parse(row.metadata || '{}')
        }))
      }

      case 'count': {
        const options = args[0] || {}
        let query = 'SELECT COUNT(*) as count FROM events'
        const params = []

        if (options.type) {
          query += ' WHERE type = ?'
          params.push(options.type)
        }

        const result = this.sql.exec(query, ...params)
        return [...result][0].count
      }

      default:
        throw new Error(\`Unknown events action: \${action}\`)
    }
  }

  handleRelationships(action, args) {
    switch (action) {
      case 'create': {
        const rel = args[0] || {}
        const { from, to, relation, ...metadata } = rel
        if (!from || !to || !relation) throw new Error('from, to, and relation are required')

        const id = generateId()
        const now = Date.now()

        this.sql.exec(
          'INSERT INTO relationships (id, from_id, from_type, relation, to_id, to_type, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          id, from.id, from.type, relation, to.id, to.type, JSON.stringify(metadata), now
        )

        return { $id: id, from, to, relation, createdAt: now, ...metadata }
      }

      case 'list': {
        const options = args[0] || {}
        let query = 'SELECT * FROM relationships'
        const params = []
        const conditions = []

        if (options.fromId) {
          conditions.push('from_id = ?')
          params.push(options.fromId)
        }
        if (options.toId) {
          conditions.push('to_id = ?')
          params.push(options.toId)
        }
        if (options.relation) {
          conditions.push('relation = ?')
          params.push(options.relation)
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ')
        }

        query += ' ORDER BY created_at DESC'

        if (options.limit) {
          query += ' LIMIT ?'
          params.push(options.limit)
        }

        const result = this.sql.exec(query, ...params)
        return [...result].map(row => ({
          $id: row.id,
          from: { id: row.from_id, type: row.from_type },
          to: { id: row.to_id, type: row.to_type },
          relation: row.relation,
          createdAt: row.created_at,
          ...JSON.parse(row.metadata || '{}')
        }))
      }

      case 'delete': {
        const id = args[0]
        if (!id) throw new Error('id is required')

        this.sql.exec('DELETE FROM relationships WHERE id = ?', id)
        return { deleted: true, id }
      }

      default:
        throw new Error(\`Unknown relationships action: \${action}\`)
    }
  }

  getTypes() {
    return \`
/**
 * Local Sandbox $ Context Types
 *
 * Provides type definitions for the local sandbox environment.
 */

interface Thing {
  $id: string
  $type: string
  $version: number
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

interface Event {
  $id: string
  type: string
  payload: unknown
  timestamp: number
}

interface Relationship {
  $id: string
  from: { id: string; type: string }
  to: { id: string; type: string }
  relation: string
  createdAt: number
}

interface ThingsStore {
  create(data: { $type: string; [key: string]: unknown }): Promise<Thing>
  get(id: string): Promise<Thing | null>
  list(options?: { $type?: string; limit?: number }): Promise<Thing[]>
  update(id: string, data: Record<string, unknown>): Promise<Thing>
  delete(id: string): Promise<{ deleted: boolean; id: string }>
  count(options?: { $type?: string }): Promise<number>
}

interface EventsStore {
  emit(event: { type: string; payload?: unknown }): Promise<Event>
  list(options?: { type?: string; since?: number; limit?: number }): Promise<Event[]>
  count(options?: { type?: string }): Promise<number>
}

interface RelationshipsStore {
  create(rel: { from: { id: string; type: string }; to: { id: string; type: string }; relation: string }): Promise<Relationship>
  list(options?: { fromId?: string; toId?: string; relation?: string; limit?: number }): Promise<Relationship[]>
  delete(id: string): Promise<{ deleted: boolean; id: string }>
}

declare const $: {
  things: ThingsStore
  events: EventsStore
  relationships: RelationshipsStore
}
\`
  }
}

export default {
  async fetch(request, env) {
    const id = env.SANDBOX_DO.idFromName('sandbox')
    const stub = env.SANDBOX_DO.get(id)
    return stub.fetch(request)
  }
}
`

/**
 * Miniflare configuration for local sandbox
 */
function getSandboxConfig() {
  return {
    modules: true,
    script: SANDBOX_DO_SCRIPT,
    durableObjects: {
      SANDBOX_DO: 'SandboxDO',
    },
    durableObjectsPersist: false, // In-memory for fast startup
    compatibilityDate: '2026-01-01',
  }
}

/**
 * Local Sandbox Transport
 *
 * A transport that sends RPC messages to a local Miniflare DO instance.
 * Used by the REPL when no remote endpoint is specified.
 */
export class SandboxTransport implements Transport {
  private mf: unknown | null = null
  private stub: unknown | null = null
  private state: TransportState = 'DISCONNECTED' as TransportState

  /**
   * Initialize the sandbox (starts Miniflare)
   */
  async initialize(): Promise<void> {
    if (this.mf) return

    const { Miniflare } = await import('miniflare')

    this.mf = new Miniflare(getSandboxConfig())
    const mf = this.mf as { getDurableObjectNamespace: (name: string) => Promise<{ idFromName: (name: string) => unknown; get: (id: unknown) => unknown }> }

    // Get the DO stub
    const ns = await mf.getDurableObjectNamespace('SANDBOX_DO')
    const id = ns.idFromName('sandbox')
    this.stub = ns.get(id)

    this.state = 'CONNECTED' as TransportState
  }

  /**
   * Send an RPC message to the local sandbox
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    if (!this.stub) {
      await this.initialize()
    }

    const stub = this.stub as { fetch: (req: Request) => Promise<Response> }

    try {
      const response = await stub.fetch(
        new Request('http://sandbox/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: message.method,
            args: message.args,
          }),
        })
      )

      if (!response.ok) {
        const errorBody = await response.json() as { type?: string; code?: string; message?: string }
        return {
          error: {
            type: errorBody.type || 'RPCError',
            code: errorBody.code || 'SANDBOX_ERROR',
            message: errorBody.message || `Sandbox error: ${response.status}`,
          },
        }
      }

      const result = await response.json() as T
      return { result }
    } catch (error) {
      return {
        error: {
          type: 'TransportError',
          code: 'SANDBOX_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  /**
   * Close the sandbox (disposes Miniflare)
   */
  async close(): Promise<void> {
    if (this.mf) {
      const mf = this.mf as { dispose: () => Promise<void> }
      await mf.dispose()
      this.mf = null
      this.stub = null
      this.state = 'CLOSED' as TransportState
    }
  }

  /**
   * Get the current transport state
   */
  getState(): TransportState {
    return this.state
  }
}

/**
 * Create a sandbox transport
 */
export function createSandboxTransport(): SandboxTransport {
  return new SandboxTransport()
}

/**
 * Options for starting the local sandbox REPL
 */
export interface SandboxReplOptions {
  /** Path to history file */
  historyPath?: string
  /** Callback when sandbox is ready */
  onReady?: (info: { id: string }) => void
}

/**
 * Start a local sandbox REPL
 *
 * Creates an in-memory Durable Object and connects the REPL to it.
 */
export async function startSandboxRepl(options: SandboxReplOptions = {}): Promise<void> {
  const { ReplService } = await import('rpc.do/cli')

  // Create sandbox transport
  const transport = createSandboxTransport()

  // Initialize sandbox and get types
  await transport.initialize()

  // Fetch types from sandbox
  let types: string | undefined
  try {
    const response = await transport.send<string>({ method: '_types', args: [] })
    if (response.result && typeof response.result === 'string') {
      types = response.result
    }
  } catch {
    // Types not available, continue without autocomplete
  }

  // Create REPL service
  const repl = new ReplService({
    transport,
    types,
    historyPath: options.historyPath,
    prompt: 'sandbox> ',
    onExit: async () => {
      await transport.close()
      process.exit(0)
    },
    onClear: () => {
      console.clear()
    },
  })

  // Print welcome message
  console.log('Local sandbox started (in-memory)')
  console.log('Data persists for this session only')
  console.log('')
  console.log('Available stores:')
  console.log('  $.things      - Entity storage (create, get, list, update, delete)')
  console.log('  $.events      - Event log (emit, list)')
  console.log('  $.relationships - Graph relationships (create, list, delete)')
  console.log('')
  console.log('Type .help for available commands')
  console.log('')

  if (options.onReady) {
    options.onReady({ id: 'sandbox' })
  }

  await repl.start()
}
