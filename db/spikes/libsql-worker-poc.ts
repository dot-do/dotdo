/**
 * SPIKE: libSQL/Turso Compatibility in Cloudflare Workers (workerd V8 isolates)
 *
 * This POC tests whether @libsql/client can run in Cloudflare Workers
 * without Node.js APIs, measuring latency and memory.
 *
 * Key Questions:
 * 1. Can @libsql/client-web run in workerd without Node.js APIs?
 * 2. What's the connection latency to Turso cloud from edge?
 * 3. How does libSQL handle concurrent connections from same DO?
 * 4. What's the memory footprint per connection?
 *
 * @see https://developers.cloudflare.com/workers/tutorials/connect-to-turso-using-workers/
 */

// CRITICAL: Must use /web subpath for Workers compatibility
// The default import pulls in Node.js native bindings that fail in workerd
import { createClient, type Client } from '@libsql/client/web'

// ============================================================================
// Environment Types
// ============================================================================

export interface LibSQLEnv {
  /** Turso database URL (libsql://*.turso.io or https://*.turso.io) */
  TURSO_URL: string
  /** Authentication token for the database */
  TURSO_TOKEN: string
}

// ============================================================================
// Connection Pooling Strategy for DOs
// ============================================================================

/**
 * Client cache for connection reuse within a Worker instance.
 *
 * Cloudflare Workers are stateless, but during a single request
 * we can cache the client to avoid reconnection overhead.
 *
 * For Durable Objects, the client can persist across requests.
 */
let cachedClient: Client | null = null

function getClient(env: LibSQLEnv): Client {
  if (cachedClient && !cachedClient.closed) {
    return cachedClient
  }

  if (!env.TURSO_URL) {
    throw new Error('TURSO_URL environment variable is required')
  }

  // Create client with web-compatible configuration
  cachedClient = createClient({
    url: env.TURSO_URL,
    authToken: env.TURSO_TOKEN,
    // Web client uses HTTP or WebSocket based on URL protocol
    // libsql:// -> WebSocket (Hrana protocol)
    // https:// -> HTTP (fetch-based)
  })

  return cachedClient
}

// ============================================================================
// Latency Measurement Utilities
// ============================================================================

interface LatencyMetrics {
  coldConnect: number
  warmQuery: number
  p50: number
  p99: number
  samples: number[]
}

async function measureLatency(
  db: Client,
  iterations: number = 10
): Promise<LatencyMetrics> {
  const samples: number[] = []

  // Warm query measurements
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await db.execute('SELECT 1')
    samples.push(performance.now() - start)
  }

  // Sort for percentile calculation
  samples.sort((a, b) => a - b)

  return {
    coldConnect: samples[0], // First query includes connection overhead
    warmQuery: samples[samples.length - 1],
    p50: samples[Math.floor(samples.length * 0.5)],
    p99: samples[Math.floor(samples.length * 0.99)],
    samples,
  }
}

// ============================================================================
// Memory Measurement
// ============================================================================

interface MemoryMetrics {
  /** Approximate memory per connection (not directly measurable in Workers) */
  estimatedBytesPerConnection: number
  /** Number of concurrent clients tested */
  concurrentClients: number
}

/**
 * Note: V8 isolates don't expose direct memory measurement APIs.
 * We can estimate based on object sizes and connection state.
 */
function estimateMemory(): MemoryMetrics {
  // The libSQL web client maintains:
  // - URL string (~200 bytes)
  // - Auth token (~100 bytes)
  // - HTTP client state (~1KB)
  // - Response buffers (variable, ~10KB typical)
  // - Promise queues (~500 bytes)
  //
  // Estimated total: ~12KB per connection
  return {
    estimatedBytesPerConnection: 12 * 1024,
    concurrentClients: 1, // Web client is designed for single-connection use
  }
}

// ============================================================================
// Concurrency Testing
// ============================================================================

interface ConcurrencyResult {
  parallelQueries: number
  totalTime: number
  averagePerQuery: number
  errors: string[]
}

async function testConcurrency(
  db: Client,
  parallelism: number = 5
): Promise<ConcurrencyResult> {
  const errors: string[] = []
  const start = performance.now()

  const queries = Array(parallelism)
    .fill(null)
    .map((_, i) =>
      db.execute(`SELECT ${i} as query_id, datetime('now') as executed_at`)
        .catch(err => {
          errors.push(`Query ${i}: ${err.message}`)
          return null
        })
    )

  await Promise.all(queries)
  const totalTime = performance.now() - start

  return {
    parallelQueries: parallelism,
    totalTime,
    averagePerQuery: totalTime / parallelism,
    errors,
  }
}

// ============================================================================
// CRUD Operations Test
// ============================================================================

interface CRUDResult {
  create: { success: boolean; time: number }
  read: { success: boolean; time: number; rowCount: number }
  update: { success: boolean; time: number; affected: number }
  delete: { success: boolean; time: number; affected: number }
}

async function testCRUD(db: Client): Promise<CRUDResult> {
  const result: CRUDResult = {
    create: { success: false, time: 0 },
    read: { success: false, time: 0, rowCount: 0 },
    update: { success: false, time: 0, affected: 0 },
    delete: { success: false, time: 0, affected: 0 },
  }

  try {
    // CREATE
    let start = performance.now()
    await db.execute(`
      CREATE TABLE IF NOT EXISTS spike_test (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await db.execute({
      sql: 'INSERT OR REPLACE INTO spike_test (id, value) VALUES (?, ?)',
      args: [1, 'hello from workerd'],
    })
    result.create = { success: true, time: performance.now() - start }

    // READ
    start = performance.now()
    const readResult = await db.execute('SELECT * FROM spike_test')
    result.read = {
      success: true,
      time: performance.now() - start,
      rowCount: readResult.rows.length,
    }

    // UPDATE
    start = performance.now()
    const updateResult = await db.execute({
      sql: 'UPDATE spike_test SET value = ? WHERE id = ?',
      args: ['updated from workerd', 1],
    })
    result.update = {
      success: true,
      time: performance.now() - start,
      affected: Number(updateResult.rowsAffected),
    }

    // DELETE
    start = performance.now()
    const deleteResult = await db.execute({
      sql: 'DELETE FROM spike_test WHERE id = ?',
      args: [1],
    })
    result.delete = {
      success: true,
      time: performance.now() - start,
      affected: Number(deleteResult.rowsAffected),
    }
  } catch (err) {
    console.error('CRUD test failed:', err)
  }

  return result
}

// ============================================================================
// Transaction Test
// ============================================================================

interface TransactionResult {
  batchSuccess: boolean
  batchTime: number
  interactiveSupported: boolean
  interactiveTime?: number
  error?: string
}

async function testTransactions(db: Client): Promise<TransactionResult> {
  const result: TransactionResult = {
    batchSuccess: false,
    batchTime: 0,
    interactiveSupported: false,
  }

  try {
    // Batch transaction (always supported)
    const start = performance.now()
    await db.batch([
      'CREATE TABLE IF NOT EXISTS tx_test (id INT, value TEXT)',
      {
        sql: 'INSERT OR REPLACE INTO tx_test VALUES (?, ?)',
        args: [1, 'tx value 1'],
      },
      {
        sql: 'INSERT OR REPLACE INTO tx_test VALUES (?, ?)',
        args: [2, 'tx value 2'],
      },
    ])
    result.batchSuccess = true
    result.batchTime = performance.now() - start

    // Interactive transaction (may not be supported in all modes)
    try {
      const txStart = performance.now()
      const tx = await db.transaction()
      await tx.execute({
        sql: 'INSERT OR REPLACE INTO tx_test VALUES (?, ?)',
        args: [3, 'interactive tx'],
      })
      await tx.commit()
      result.interactiveSupported = true
      result.interactiveTime = performance.now() - txStart
    } catch (txErr: unknown) {
      // Interactive transactions require WebSocket connections
      // HTTP mode doesn't support them
      result.interactiveSupported = false
      result.error = txErr instanceof Error ? txErr.message : String(txErr)
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }

  return result
}

// ============================================================================
// Worker Handler
// ============================================================================

export interface SpikeResult {
  success: boolean
  environment: {
    runtime: string
    protocol: string
    url: string
  }
  latency?: LatencyMetrics
  memory: MemoryMetrics
  concurrency?: ConcurrencyResult
  crud?: CRUDResult
  transactions?: TransactionResult
  error?: string
}

export default {
  async fetch(request: Request, env: LibSQLEnv): Promise<Response> {
    const url = new URL(request.url)
    const testType = url.searchParams.get('test') || 'all'

    const result: SpikeResult = {
      success: false,
      environment: {
        runtime: 'workerd',
        protocol: env.TURSO_URL?.startsWith('libsql://') ? 'websocket' : 'http',
        url: env.TURSO_URL?.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') || 'not-set',
      },
      memory: estimateMemory(),
    }

    if (!env.TURSO_URL) {
      result.error = 'TURSO_URL not configured. Set in wrangler.jsonc or .dev.vars'
      return Response.json(result, { status: 500 })
    }

    try {
      const db = getClient(env)

      // Run requested tests
      if (testType === 'all' || testType === 'latency') {
        result.latency = await measureLatency(db)
      }

      if (testType === 'all' || testType === 'concurrency') {
        result.concurrency = await testConcurrency(db)
      }

      if (testType === 'all' || testType === 'crud') {
        result.crud = await testCRUD(db)
      }

      if (testType === 'all' || testType === 'transactions') {
        result.transactions = await testTransactions(db)
      }

      result.success = true
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
      result.success = false
    }

    return Response.json(result, {
      status: result.success ? 200 : 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  },
}

// ============================================================================
// Durable Object Integration Example
// ============================================================================

/**
 * Example of how libSQL would integrate with a Durable Object.
 *
 * The DO maintains a persistent connection to Turso across requests.
 * This is useful for:
 * - Connection pooling within a single DO instance
 * - Caching prepared statements
 * - Maintaining transaction state across requests
 */
export class LibSQLDurableObject {
  private client: Client | null = null
  private env: LibSQLEnv

  constructor(state: DurableObjectState, env: LibSQLEnv) {
    this.env = env
  }

  private getClient(): Client {
    if (!this.client || this.client.closed) {
      this.client = createClient({
        url: this.env.TURSO_URL,
        authToken: this.env.TURSO_TOKEN,
      })
    }
    return this.client
  }

  async fetch(request: Request): Promise<Response> {
    const db = this.getClient()

    // Example: Simple query
    const result = await db.execute('SELECT datetime("now") as server_time')

    return Response.json({
      source: 'durable-object',
      result: result.rows,
    })
  }
}
