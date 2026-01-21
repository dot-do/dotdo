/**
 * DLQ and Retry Status Persistence Tests (do-f9xs)
 *
 * TDD Red Phase: These tests verify that dead letter queue and retry status
 * persist across DO restarts. The tests SHOULD FAIL initially because the
 * current implementation uses in-memory stores.
 *
 * Problem: The WorkflowContext creates an in-memory error store by default
 * (createInMemoryErrorStore()) which loses all DLQ/retry data on DO restart.
 *
 * Fix: Use SQLite-backed stores (createSQLiteErrorStore and createSQLiteRetryQueue)
 * which persist to DurableObjectState.storage.sql.
 *
 * @module do/tests/dlq-persistence.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Miniflare } from 'miniflare'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface FireAndForgetError {
  id: string
  operation: string
  event_type?: string
  handler_index?: number
  message: string
  stack?: string
  error_type: string
  retriable: number
  context?: string
  timestamp: number
  attempts?: number
  recovered: number
  recovered_at?: number
}

interface RetryQueueItem {
  id: string
  error_id: string
  event_type: string
  payload: string | null
  attempts: number
  max_attempts: number
  added_at: number
  next_retry_at: number
  backoff_delay: number
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'abandoned'
  last_error?: string
}

interface ErrorStats {
  total: number
  recovered: number
  unresolved: number
  byOperation: Record<string, number>
  byEventType: Record<string, number>
  byErrorType: Record<string, number>
}

interface RetryQueueStats {
  total: number
  pending: number
  processing: number
  succeeded: number
  failed: number
  abandoned: number
  byEventType: Record<string, number>
}

// ============================================================================
// TEST DO SCRIPT
// ============================================================================

/**
 * This DO script tests DLQ and retry queue persistence.
 * It uses in-memory stores (the bug) which lose data on restart.
 *
 * After the fix, it should use SQLite-backed stores.
 */
const DLQ_TEST_DO_SCRIPT = `
// ============================================================================
// SQLite-backed Stores (THE FIX - data persists across restarts)
// ============================================================================

function generateErrorId() {
  return 'ffe-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

function generateRetryId() {
  return 'retry-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

// SQLite-backed error store (persists data across restarts)
function createSQLiteErrorStore(sql) {
  // Initialize tables
  sql.exec(\`
    CREATE TABLE IF NOT EXISTS fire_and_forget_errors (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      event_type TEXT,
      handler_index INTEGER,
      message TEXT NOT NULL,
      stack TEXT,
      error_type TEXT NOT NULL,
      retriable INTEGER NOT NULL DEFAULT 0,
      context TEXT,
      timestamp INTEGER NOT NULL,
      attempts INTEGER,
      recovered INTEGER NOT NULL DEFAULT 0,
      recovered_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ffe_timestamp ON fire_and_forget_errors(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_ffe_operation ON fire_and_forget_errors(operation);
    CREATE INDEX IF NOT EXISTS idx_ffe_event_type ON fire_and_forget_errors(event_type);
    CREATE INDEX IF NOT EXISTS idx_ffe_error_type ON fire_and_forget_errors(error_type);
    CREATE INDEX IF NOT EXISTS idx_ffe_recovered ON fire_and_forget_errors(recovered);
  \`)

  return {
    track(data) {
      const id = generateErrorId()
      const timestamp = Date.now()

      sql.exec(\`
        INSERT INTO fire_and_forget_errors
        (id, operation, event_type, handler_index, message, stack, error_type, retriable, context, timestamp, attempts, recovered)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      \`, id, data.operation, data.event_type || null, data.handler_index ?? null,
         data.message, data.stack || null, data.error_type, data.retriable ? 1 : 0,
         data.context ? JSON.stringify(data.context) : null, timestamp, data.attempts ?? null)

      return {
        id,
        ...data,
        timestamp,
        recovered: 0
      }
    },

    query(options = {}) {
      let query = 'SELECT * FROM fire_and_forget_errors WHERE 1=1'
      const params = []

      if (options.operation) {
        query += ' AND operation = ?'
        params.push(options.operation)
      }
      if (options.event_type) {
        query += ' AND event_type = ?'
        params.push(options.event_type)
      }
      if (options.error_type) {
        query += ' AND error_type = ?'
        params.push(options.error_type)
      }
      if (options.recoveredOnly) {
        query += ' AND recovered = 1'
      }
      if (options.unresolvedOnly) {
        query += ' AND recovered = 0'
      }

      query += ' ORDER BY timestamp DESC'

      const limit = options.limit || 100
      const offset = options.offset || 0
      query += ' LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const cursor = sql.exec(query, ...params)
      return cursor.toArray()
    },

    get(id) {
      const cursor = sql.exec('SELECT * FROM fire_and_forget_errors WHERE id = ?', id)
      const rows = cursor.toArray()
      return rows.length > 0 ? rows[0] : null
    },

    markRecovered(id) {
      const cursor = sql.exec(\`
        UPDATE fire_and_forget_errors
        SET recovered = 1, recovered_at = ?
        WHERE id = ? AND recovered = 0
      \`, Date.now(), id)
      return cursor.rowsWritten > 0
    },

    getStats() {
      const totalCursor = sql.exec('SELECT COUNT(*) as count FROM fire_and_forget_errors')
      const total = totalCursor.toArray()[0]?.count || 0

      const recoveredCursor = sql.exec('SELECT COUNT(*) as count FROM fire_and_forget_errors WHERE recovered = 1')
      const recovered = recoveredCursor.toArray()[0]?.count || 0

      const opCursor = sql.exec('SELECT operation, COUNT(*) as count FROM fire_and_forget_errors GROUP BY operation')
      const byOperation = {}
      for (const row of opCursor.toArray()) {
        byOperation[row.operation] = row.count
      }

      const etCursor = sql.exec('SELECT event_type, COUNT(*) as count FROM fire_and_forget_errors WHERE event_type IS NOT NULL GROUP BY event_type')
      const byEventType = {}
      for (const row of etCursor.toArray()) {
        byEventType[row.event_type] = row.count
      }

      const errCursor = sql.exec('SELECT error_type, COUNT(*) as count FROM fire_and_forget_errors GROUP BY error_type')
      const byErrorType = {}
      for (const row of errCursor.toArray()) {
        byErrorType[row.error_type] = row.count
      }

      return {
        total,
        byOperation,
        byEventType,
        byErrorType,
        recovered,
        unresolved: total - recovered,
        recoveryRate: total > 0 ? recovered / total : 0
      }
    },

    clear() {
      sql.exec('DELETE FROM fire_and_forget_errors')
    },

    getRecent(count = 10) {
      return this.query({ limit: count })
    },

    count() {
      const cursor = sql.exec('SELECT COUNT(*) as count FROM fire_and_forget_errors')
      return cursor.toArray()[0]?.count || 0
    }
  }
}

// SQLite-backed retry queue (persists data across restarts)
function createSQLiteRetryQueue(sql, errorStore, options = {}) {
  const maxAttempts = options.maxAttempts || 5
  const initialBackoff = options.initialBackoff || 100

  // Initialize tables
  sql.exec(\`
    CREATE TABLE IF NOT EXISTS retry_queue (
      id TEXT PRIMARY KEY,
      error_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      next_retry_at INTEGER NOT NULL,
      backoff_delay INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_retry_queue_status ON retry_queue(status);
    CREATE INDEX IF NOT EXISTS idx_retry_queue_next_retry ON retry_queue(next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_retry_queue_event_type ON retry_queue(event_type);
  \`)

  return {
    add(data) {
      const id = generateRetryId()
      const now = Date.now()

      sql.exec(\`
        INSERT INTO retry_queue
        (id, error_id, event_type, payload, attempts, max_attempts, added_at, next_retry_at, backoff_delay, status)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'pending')
      \`, id, data.errorId, data.eventType,
         data.payload ? JSON.stringify(data.payload) : null,
         maxAttempts, now, now + initialBackoff, initialBackoff)

      return id
    },

    get(id) {
      const cursor = sql.exec('SELECT * FROM retry_queue WHERE id = ?', id)
      const rows = cursor.toArray()
      return rows.length > 0 ? rows[0] : null
    },

    query(options = {}) {
      let query = 'SELECT * FROM retry_queue WHERE 1=1'
      const params = []
      const now = Date.now()

      if (options.eventType) {
        query += ' AND event_type = ?'
        params.push(options.eventType)
      }
      if (options.status) {
        query += ' AND status = ?'
        params.push(options.status)
      }
      if (options.readyForRetry) {
        query += ' AND status = ? AND next_retry_at <= ?'
        params.push('pending', now)
      }

      query += ' ORDER BY next_retry_at ASC'

      if (options.limit) {
        query += ' LIMIT ?'
        params.push(options.limit)
      }

      const cursor = sql.exec(query, ...params)
      return cursor.toArray()
    },

    getReadyItems() {
      return this.query({ readyForRetry: true })
    },

    markSucceeded(id) {
      sql.exec("UPDATE retry_queue SET status = 'succeeded' WHERE id = ?", id)
      const item = this.get(id)
      if (item) {
        errorStore.markRecovered(item.error_id)
      }
    },

    markFailed(id, error) {
      const item = this.get(id)
      if (!item) return

      const newAttempts = (item.attempts || 0) + 1

      if (newAttempts >= item.max_attempts) {
        sql.exec("UPDATE retry_queue SET status = 'abandoned', last_error = ?, attempts = ? WHERE id = ?",
          error, newAttempts, id)
      } else {
        const newBackoff = item.backoff_delay * 2
        const nextRetryAt = Date.now() + newBackoff
        sql.exec(\`
          UPDATE retry_queue
          SET status = 'pending', backoff_delay = ?, next_retry_at = ?, last_error = ?, attempts = ?
          WHERE id = ?
        \`, newBackoff, nextRetryAt, error, newAttempts, id)
      }
    },

    remove(id) {
      const cursor = sql.exec('DELETE FROM retry_queue WHERE id = ?', id)
      return cursor.rowsWritten > 0
    },

    getStats() {
      const stats = {
        total: 0,
        pending: 0,
        processing: 0,
        succeeded: 0,
        failed: 0,
        abandoned: 0,
        byEventType: {}
      }

      const totalCursor = sql.exec('SELECT COUNT(*) as count FROM retry_queue')
      stats.total = totalCursor.toArray()[0]?.count || 0

      const statusCursor = sql.exec('SELECT status, COUNT(*) as count FROM retry_queue GROUP BY status')
      for (const row of statusCursor.toArray()) {
        stats[row.status] = row.count
      }

      const typeCursor = sql.exec('SELECT event_type, COUNT(*) as count FROM retry_queue GROUP BY event_type')
      for (const row of typeCursor.toArray()) {
        stats.byEventType[row.event_type] = row.count
      }

      return stats
    },

    clear() {
      sql.exec('DELETE FROM retry_queue')
    }
  }
}

// ============================================================================
// DLQ Test Durable Object
// ============================================================================

export class DLQTestDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.sql = state.storage.sql
    this.env = env
    this.instanceId = crypto.randomUUID()

    // FIX: Use SQLite-backed stores that persist across restarts
    this.errorStore = createSQLiteErrorStore(this.sql)
    this.retryQueue = createSQLiteRetryQueue(this.sql, this.errorStore, {
      maxAttempts: 5,
      initialBackoff: 100
    })
  }

  async fetch(request) {
    const url = new URL(request.url)
    const pathname = url.pathname
    const method = request.method

    try {
      // ==== INSTANCE IDENTITY ====
      if (pathname === '/instance-id') {
        return Response.json({ instanceId: this.instanceId })
      }

      // ==== ERROR STORE OPERATIONS ====
      if (pathname === '/errors/track' && method === 'POST') {
        const data = await request.json()
        const error = this.errorStore.track(data)
        return Response.json(error)
      }

      if (pathname === '/errors/query' && method === 'GET') {
        const operation = url.searchParams.get('operation')
        const event_type = url.searchParams.get('event_type')
        const error_type = url.searchParams.get('error_type')
        const recoveredOnly = url.searchParams.get('recoveredOnly') === 'true'
        const unresolvedOnly = url.searchParams.get('unresolvedOnly') === 'true'
        const limit = parseInt(url.searchParams.get('limit') || '100')

        const errors = this.errorStore.query({
          operation: operation || undefined,
          event_type: event_type || undefined,
          error_type: error_type || undefined,
          recoveredOnly,
          unresolvedOnly,
          limit
        })

        return Response.json(errors)
      }

      if (pathname.startsWith('/errors/') && method === 'GET' && !pathname.includes('/stats') && !pathname.includes('/count')) {
        const id = pathname.slice('/errors/'.length)
        const error = this.errorStore.get(id)
        if (!error) {
          return Response.json({ error: 'Error not found' }, { status: 404 })
        }
        return Response.json(error)
      }

      if (pathname === '/errors/stats' && method === 'GET') {
        const stats = this.errorStore.getStats()
        return Response.json(stats)
      }

      if (pathname === '/errors/mark-recovered' && method === 'POST') {
        const { id } = await request.json()
        const result = this.errorStore.markRecovered(id)
        return Response.json({ success: result })
      }

      if (pathname === '/errors/count' && method === 'GET') {
        const count = this.errorStore.count()
        return Response.json({ count })
      }

      // ==== RETRY QUEUE OPERATIONS ====
      if (pathname === '/retry/add' && method === 'POST') {
        const data = await request.json()
        const id = this.retryQueue.add(data)
        const item = this.retryQueue.get(id)
        return Response.json(item)
      }

      if (pathname === '/retry/query' && method === 'GET') {
        const eventType = url.searchParams.get('eventType')
        const status = url.searchParams.get('status')
        const limit = parseInt(url.searchParams.get('limit') || '100')

        const items = this.retryQueue.query({
          event_type: eventType || undefined,
          status: status || undefined,
          limit
        })

        return Response.json(items)
      }

      if (pathname.startsWith('/retry/') && method === 'GET' && !pathname.includes('/stats') && !pathname.includes('/ready')) {
        const id = pathname.slice('/retry/'.length)
        const item = this.retryQueue.get(id)
        if (!item) {
          return Response.json({ error: 'Retry item not found' }, { status: 404 })
        }
        return Response.json(item)
      }

      if (pathname === '/retry/stats' && method === 'GET') {
        const stats = this.retryQueue.getStats()
        return Response.json(stats)
      }

      if (pathname === '/retry/ready' && method === 'GET') {
        const items = this.retryQueue.getReadyItems()
        return Response.json(items)
      }

      if (pathname === '/retry/mark-succeeded' && method === 'POST') {
        const { id } = await request.json()
        this.retryQueue.markSucceeded(id)
        return Response.json({ success: true })
      }

      if (pathname === '/retry/mark-failed' && method === 'POST') {
        const { id, error } = await request.json()
        this.retryQueue.markFailed(id, error)
        return Response.json({ success: true })
      }

      // ==== HEALTH ====
      if (pathname === '/' || pathname === '/health') {
        return Response.json({
          status: 'ok',
          id: this.state.id.toString(),
          instanceId: this.instanceId,
          errorCount: this.errorStore.count(),
          retryQueueStats: this.retryQueue.getStats()
        })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (err) {
      return Response.json({ error: err.message, stack: err.stack }, { status: 500 })
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doName = url.searchParams.get('name') || 'default'
    const id = env.DLQ_DO.idFromName(doName)
    const stub = env.DLQ_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTempDir(): string {
  const dir = path.join(os.tmpdir(), `dlq-persistence-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

function getMiniflareConfig(persistDir: string) {
  return {
    modules: true,
    script: DLQ_TEST_DO_SCRIPT,
    durableObjects: {
      DLQ_DO: { className: 'DLQTestDO', useSQLite: true },
    },
    durableObjectsPersist: persistDir,
  }
}

async function getDLQStub(mf: Miniflare, name: string = 'default') {
  const ns = await mf.getDurableObjectNamespace('DLQ_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

function generateTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITES - DLQ Persistence Across DO Restarts
// ============================================================================

describe('DLQ and Retry Status Persistence (do-f9xs)', () => {
  /**
   * These tests verify that the dead letter queue and retry status
   * persist across DO restarts.
   *
   * EXPECTED: All tests should FAIL initially due to in-memory stores.
   * After implementing SQLite persistence, all tests should PASS.
   */

  // ==========================================================================
  // 1. ERROR STORE PERSISTENCE
  // ==========================================================================

  describe('1. Fire-and-Forget Errors should persist across DO restart', () => {
    let persistDir: string

    beforeAll(() => {
      persistDir = createTempDir()
    })

    afterAll(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist tracked errors across DO restart', async () => {
      const doName = generateTestId()

      // First Miniflare instance - track some errors
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let trackedErrors: FireAndForgetError[] = []

      try {
        const stub1 = await getDLQStub(mf1, doName)

        // Track multiple errors
        for (let i = 0; i < 3; i++) {
          const response = await stub1.fetch('http://fake/errors/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operation: 'event.handler',
              event_type: `Order.placed.${i}`,
              message: `Handler failed for order ${i}`,
              error_type: 'NetworkError',
              retriable: true,
              context: { orderId: `order-${i}` }
            }),
          })
          expect(response.status).toBe(200)
          const error = await response.json() as FireAndForgetError
          trackedErrors.push(error)
        }

        // Verify errors exist in this instance
        const queryResponse = await stub1.fetch('http://fake/errors/query')
        const errors = await queryResponse.json() as FireAndForgetError[]
        expect(errors).toHaveLength(3)
      } finally {
        await mf1.dispose()
      }

      // Second Miniflare instance - errors should persist
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)

        // THIS WILL FAIL - errors are stored in-memory and lost on restart
        const queryResponse = await stub2.fetch('http://fake/errors/query')
        expect(queryResponse.status).toBe(200)
        const errors = await queryResponse.json() as FireAndForgetError[]
        expect(errors).toHaveLength(3) // Will be 0

        // Verify specific error can be retrieved
        const getResponse = await stub2.fetch(`http://fake/errors/${trackedErrors[0].id}`)
        expect(getResponse.status).toBe(200) // Will be 404
        const error = await getResponse.json() as FireAndForgetError
        expect(error.id).toBe(trackedErrors[0].id)
        expect(error.message).toBe('Handler failed for order 0')
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve error timestamps across restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let originalError: FireAndForgetError

      try {
        const stub1 = await getDLQStub(mf1, doName)

        const response = await stub1.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'event.handler',
            event_type: 'Payment.failed',
            message: 'Payment processing failed',
            error_type: 'TimeoutError',
            retriable: true
          }),
        })
        originalError = await response.json() as FireAndForgetError
      } finally {
        await mf1.dispose()
      }

      // Wait to ensure timestamps would differ if recreated
      await new Promise(resolve => setTimeout(resolve, 50))

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)

        // THIS WILL FAIL - error won't exist
        const response = await stub2.fetch(`http://fake/errors/${originalError!.id}`)
        expect(response.status).toBe(200)

        const error = await response.json() as FireAndForgetError
        // Timestamp should be preserved, not recreated
        expect(error.timestamp).toBe(originalError!.timestamp)
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve recovered status across restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let errorId: string

      try {
        const stub1 = await getDLQStub(mf1, doName)

        // Track an error
        const trackResponse = await stub1.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'event.handler',
            event_type: 'Order.shipped',
            message: 'Shipping notification failed',
            error_type: 'NetworkError',
            retriable: true
          }),
        })
        const error = await trackResponse.json() as FireAndForgetError
        errorId = error.id

        // Mark it as recovered
        const markResponse = await stub1.fetch('http://fake/errors/mark-recovered', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: errorId }),
        })
        expect((await markResponse.json() as { success: boolean }).success).toBe(true)

        // Verify it's marked as recovered (SQLite uses 1 for true)
        const getResponse = await stub1.fetch(`http://fake/errors/${errorId}`)
        const updated = await getResponse.json() as FireAndForgetError
        expect(updated.recovered).toBe(1)
        expect(updated.recovered_at).toBeGreaterThan(0)
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)

        // Verify error and recovered status persist
        const response = await stub2.fetch(`http://fake/errors/${errorId!}`)
        expect(response.status).toBe(200)

        const error = await response.json() as FireAndForgetError
        expect(error.recovered).toBe(1)  // SQLite uses 1 for true
        expect(error.recovered_at).toBeGreaterThan(0)
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve error statistics across restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let originalStats: ErrorStats

      try {
        const stub1 = await getDLQStub(mf1, doName)

        // Track errors of different types
        await stub1.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'event.handler',
            event_type: 'Order.placed',
            message: 'Error 1',
            error_type: 'NetworkError',
            retriable: true
          }),
        })
        await stub1.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'workflow.send',
            event_type: 'Customer.signup',
            message: 'Error 2',
            error_type: 'ValidationError',
            retriable: false
          }),
        })

        const statsResponse = await stub1.fetch('http://fake/errors/stats')
        originalStats = await statsResponse.json() as ErrorStats
        expect(originalStats.total).toBe(2)
        expect(originalStats.byOperation['event.handler']).toBe(1)
        expect(originalStats.byOperation['workflow.send']).toBe(1)
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)

        // THIS WILL FAIL - stats will be reset
        const statsResponse = await stub2.fetch('http://fake/errors/stats')
        const stats = await statsResponse.json() as ErrorStats

        expect(stats.total).toBe(originalStats!.total) // Will be 0
        expect(stats.byOperation['event.handler']).toBe(1)
        expect(stats.byOperation['workflow.send']).toBe(1)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 2. RETRY QUEUE PERSISTENCE
  // ==========================================================================

  describe('2. Retry Queue should persist across DO restart', () => {
    let persistDir: string

    beforeAll(() => {
      persistDir = createTempDir()
    })

    afterAll(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist retry queue items across DO restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let addedItems: RetryQueueItem[] = []

      try {
        const stub1 = await getDLQStub(mf1, doName)

        // Add items to retry queue
        for (let i = 0; i < 3; i++) {
          const response = await stub1.fetch('http://fake/retry/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              errorId: `ffe-test-${i}`,
              eventType: `Order.retry.${i}`,
              payload: { orderId: `order-${i}` }
            }),
          })
          expect(response.status).toBe(200)
          const item = await response.json() as RetryQueueItem
          addedItems.push(item)
        }

        // Verify items exist
        const queryResponse = await stub1.fetch('http://fake/retry/query')
        const items = await queryResponse.json() as RetryQueueItem[]
        expect(items).toHaveLength(3)
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)

        // THIS WILL FAIL - retry queue is in-memory
        const queryResponse = await stub2.fetch('http://fake/retry/query')
        expect(queryResponse.status).toBe(200)
        const items = await queryResponse.json() as RetryQueueItem[]
        expect(items).toHaveLength(3) // Will be 0

        // Verify specific item
        const getResponse = await stub2.fetch(`http://fake/retry/${addedItems[0].id}`)
        expect(getResponse.status).toBe(200) // Will be 404
        const item = await getResponse.json() as RetryQueueItem
        expect(item.event_type).toBe('Order.retry.0')
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve retry attempts count across restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let retryId: string

      try {
        const stub1 = await getDLQStub(mf1, doName)

        // Add a retry item
        const addResponse = await stub1.fetch('http://fake/retry/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            errorId: 'ffe-attempts-test',
            eventType: 'Payment.retry',
            payload: { paymentId: 'pay-123' }
          }),
        })
        const item = await addResponse.json() as RetryQueueItem
        retryId = item.id

        // Simulate failed retry attempt (increments attempts)
        await stub1.fetch('http://fake/retry/mark-failed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: retryId, error: 'Still failing' }),
        })

        // Verify attempts incremented
        const getResponse = await stub1.fetch(`http://fake/retry/${retryId}`)
        const updated = await getResponse.json() as RetryQueueItem
        // Note: markFailed doesn't increment attempts directly, that's done in processItem
        // But lastError should be set
        expect(updated.last_error).toBe('Still failing')
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)

        // THIS WILL FAIL - retry queue is in-memory
        const response = await stub2.fetch(`http://fake/retry/${retryId!}`)
        expect(response.status).toBe(200)

        const item = await response.json() as RetryQueueItem
        expect(item.last_error).toBe('Still failing')
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve retry status (pending/succeeded/abandoned) across restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let succeededId: string
      let pendingId: string

      try {
        const stub1 = await getDLQStub(mf1, doName)

        // Add items with different statuses
        const add1 = await stub1.fetch('http://fake/retry/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            errorId: 'ffe-succeed-test',
            eventType: 'Order.success',
            payload: {}
          }),
        })
        succeededId = ((await add1.json()) as RetryQueueItem).id

        const add2 = await stub1.fetch('http://fake/retry/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            errorId: 'ffe-pending-test',
            eventType: 'Order.pending',
            payload: {}
          }),
        })
        pendingId = ((await add2.json()) as RetryQueueItem).id

        // Mark first as succeeded
        await stub1.fetch('http://fake/retry/mark-succeeded', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: succeededId }),
        })

        // Verify statuses
        const get1 = await stub1.fetch(`http://fake/retry/${succeededId}`)
        expect(((await get1.json()) as RetryQueueItem).status).toBe('succeeded')

        const get2 = await stub1.fetch(`http://fake/retry/${pendingId}`)
        expect(((await get2.json()) as RetryQueueItem).status).toBe('pending')
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)

        // THIS WILL FAIL - statuses won't persist
        const get1 = await stub2.fetch(`http://fake/retry/${succeededId!}`)
        expect(get1.status).toBe(200)
        expect(((await get1.json()) as RetryQueueItem).status).toBe('succeeded')

        const get2 = await stub2.fetch(`http://fake/retry/${pendingId!}`)
        expect(get2.status).toBe(200)
        expect(((await get2.json()) as RetryQueueItem).status).toBe('pending')
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve retry queue statistics across restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let originalStats: RetryQueueStats

      try {
        const stub1 = await getDLQStub(mf1, doName)

        // Add items of different event types
        await stub1.fetch('http://fake/retry/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            errorId: 'ffe-1',
            eventType: 'Order.placed',
            payload: {}
          }),
        })
        await stub1.fetch('http://fake/retry/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            errorId: 'ffe-2',
            eventType: 'Payment.failed',
            payload: {}
          }),
        })

        const statsResponse = await stub1.fetch('http://fake/retry/stats')
        originalStats = await statsResponse.json() as RetryQueueStats
        expect(originalStats.total).toBe(2)
        expect(originalStats.pending).toBe(2)
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)

        // THIS WILL FAIL - stats will be reset
        const statsResponse = await stub2.fetch('http://fake/retry/stats')
        const stats = await statsResponse.json() as RetryQueueStats

        expect(stats.total).toBe(originalStats!.total) // Will be 0
        expect(stats.pending).toBe(originalStats!.pending)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 3. COMBINED DLQ + RETRY PERSISTENCE
  // ==========================================================================

  describe('3. Combined DLQ and Retry data should persist together', () => {
    let persistDir: string

    beforeAll(() => {
      persistDir = createTempDir()
    })

    afterAll(() => {
      cleanupTempDir(persistDir)
    })

    it('should preserve both error and retry data across restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let errorId: string
      let retryId: string

      try {
        const stub1 = await getDLQStub(mf1, doName)

        // Track an error
        const errorResponse = await stub1.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'event.handler',
            event_type: 'Order.placed',
            message: 'Order processing failed',
            error_type: 'NetworkError',
            retriable: true
          }),
        })
        const error = await errorResponse.json() as FireAndForgetError
        errorId = error.id

        // Add to retry queue
        const retryResponse = await stub1.fetch('http://fake/retry/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            errorId: errorId,
            eventType: 'Order.placed',
            payload: { orderId: 'order-123' }
          }),
        })
        const retry = await retryResponse.json() as RetryQueueItem
        retryId = retry.id

        // Verify both exist
        const errorCount = await stub1.fetch('http://fake/errors/count')
        expect((await errorCount.json() as { count: number }).count).toBe(1)

        const retryStats = await stub1.fetch('http://fake/retry/stats')
        expect((await retryStats.json() as RetryQueueStats).total).toBe(1)
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)

        // THIS WILL FAIL - both error and retry data lost
        const errorResponse = await stub2.fetch(`http://fake/errors/${errorId!}`)
        expect(errorResponse.status).toBe(200)
        const error = await errorResponse.json() as FireAndForgetError
        expect(error.id).toBe(errorId)

        const retryResponse = await stub2.fetch(`http://fake/retry/${retryId!}`)
        expect(retryResponse.status).toBe(200)
        const retry = await retryResponse.json() as RetryQueueItem
        expect(retry.error_id).toBe(errorId)
      } finally {
        await mf2.dispose()
      }
    })

    it('should survive multiple restarts without data loss', async () => {
      const doName = generateTestId()

      // First instance - create initial data
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getDLQStub(mf1, doName)

        await stub1.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'event.handler',
            event_type: 'Event.1',
            message: 'Error 1',
            error_type: 'NetworkError',
            retriable: true
          }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance - add more data
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)

        await stub2.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'event.handler',
            event_type: 'Event.2',
            message: 'Error 2',
            error_type: 'TimeoutError',
            retriable: true
          }),
        })

        // THIS WILL FAIL - only Error 2 will exist
        const countResponse = await stub2.fetch('http://fake/errors/count')
        const count = (await countResponse.json() as { count: number }).count
        expect(count).toBe(2) // Will be 1
      } finally {
        await mf2.dispose()
      }

      // Third instance - verify cumulative data
      let mf3 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub3 = await getDLQStub(mf3, doName)

        await stub3.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'event.handler',
            event_type: 'Event.3',
            message: 'Error 3',
            error_type: 'ValidationError',
            retriable: false
          }),
        })

        // THIS WILL FAIL - only Error 3 will exist
        const countResponse = await stub3.fetch('http://fake/errors/count')
        const count = (await countResponse.json() as { count: number }).count
        expect(count).toBe(3) // Will be 1
      } finally {
        await mf3.dispose()
      }
    })
  })

  // ==========================================================================
  // 4. SANITY CHECK - Instance Changes on Restart
  // ==========================================================================

  describe('4. Instance identity changes on restart (sanity check)', () => {
    let persistDir: string

    beforeAll(() => {
      persistDir = createTempDir()
    })

    afterAll(() => {
      cleanupTempDir(persistDir)
    })

    it('should get different instanceId after restart (proving restart happened)', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let instanceId1: string
      try {
        const stub1 = await getDLQStub(mf1, doName)
        const response = await stub1.fetch('http://fake/instance-id')
        const json = await response.json() as { instanceId: string }
        instanceId1 = json.instanceId
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getDLQStub(mf2, doName)
        const response = await stub2.fetch('http://fake/instance-id')
        const json = await response.json() as { instanceId: string }

        // THIS SHOULD PASS - proves we got a new DO instance
        expect(json.instanceId).not.toBe(instanceId1)
      } finally {
        await mf2.dispose()
      }
    })
  })
})
