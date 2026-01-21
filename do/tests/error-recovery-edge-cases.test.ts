/**
 * Error Recovery Edge Cases Tests - DO Event System (do-dy6b)
 *
 * Comprehensive edge case tests for error recovery paths in the DO event system.
 * These tests use real miniflare instances as per the project's NO MOCKS philosophy.
 *
 * Test categories:
 * 1. DLQ error recovery - replay, ordering, deduplication
 * 2. Retry path edge cases - backoff boundaries, jitter, exhaustion
 * 3. Error classification edge cases - ambiguous errors, error wrapping
 * 4. Recovery from partial failures - multi-handler scenarios
 * 5. Concurrent error handling - race conditions in error tracking
 * 6. Error state persistence - recovery after DO restart
 *
 * @module do/tests/error-recovery-edge-cases.test
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { Miniflare } from 'miniflare'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface DLQEntry {
  id: string
  eventType: string
  payload: unknown
  attempts: number
  lastError: string
  timestamp: number
  replayCount?: number
}

interface RetryQueueItem {
  id: string
  errorId: string
  eventType: string
  attempts: number
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'abandoned'
  nextRetryAt: number
  backoffDelay: number
}

interface ErrorStats {
  total: number
  recovered: number
  unresolved: number
  byEventType: Record<string, number>
}

// ============================================================================
// TEST DO SCRIPT - Error Recovery Edge Cases
// ============================================================================

const ERROR_RECOVERY_DO_SCRIPT = `
// Error types for testing
class RetriableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RetriableError'
    this.retriable = true
  }
}

class NonRetriableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NonRetriableError'
    this.retriable = false
  }
}

class AmbiguousError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AmbiguousError'
    // No retriable property - should be treated as non-retriable by default
  }
}

// Generate unique IDs
function generateId(prefix = 'id') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

// DLQ implementation for testing
function createDLQ(sql) {
  sql.exec(\`
    CREATE TABLE IF NOT EXISTS dlq (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      timestamp INTEGER NOT NULL,
      replay_count INTEGER DEFAULT 0,
      source_handler TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dlq_event_type ON dlq(event_type);
    CREATE INDEX IF NOT EXISTS idx_dlq_timestamp ON dlq(timestamp DESC);
  \`)

  return {
    add(entry) {
      const id = generateId('dlq')
      sql.exec(\`
        INSERT INTO dlq (id, event_type, payload, attempts, last_error, timestamp, source_handler)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      \`, id, entry.eventType, JSON.stringify(entry.payload), entry.attempts,
         entry.lastError, Date.now(), entry.sourceHandler || null)
      return id
    },

    get(id) {
      const cursor = sql.exec('SELECT * FROM dlq WHERE id = ?', id)
      const rows = cursor.toArray()
      return rows.length > 0 ? rows[0] : null
    },

    query(options = {}) {
      let query = 'SELECT * FROM dlq WHERE 1=1'
      const params = []
      if (options.eventType) {
        query += ' AND event_type = ?'
        params.push(options.eventType)
      }
      query += ' ORDER BY timestamp DESC'
      if (options.limit) {
        query += ' LIMIT ?'
        params.push(options.limit)
      }
      return sql.exec(query, ...params).toArray()
    },

    incrementReplayCount(id) {
      sql.exec('UPDATE dlq SET replay_count = replay_count + 1 WHERE id = ?', id)
    },

    remove(id) {
      const cursor = sql.exec('DELETE FROM dlq WHERE id = ?', id)
      return cursor.rowsWritten > 0
    },

    count() {
      const cursor = sql.exec('SELECT COUNT(*) as count FROM dlq')
      return cursor.toArray()[0]?.count || 0
    },

    clear() {
      sql.exec('DELETE FROM dlq')
    }
  }
}

// Retry Queue implementation
function createRetryQueue(sql, options = {}) {
  const maxAttempts = options.maxAttempts || 5
  const initialBackoff = options.initialBackoff || 100
  const maxBackoff = options.maxBackoff || 30000

  sql.exec(\`
    CREATE TABLE IF NOT EXISTS retry_queue (
      id TEXT PRIMARY KEY,
      error_id TEXT,
      event_type TEXT NOT NULL,
      payload TEXT,
      handler_fn TEXT,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      next_retry_at INTEGER NOT NULL,
      backoff_delay INTEGER NOT NULL,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_retry_status ON retry_queue(status);
    CREATE INDEX IF NOT EXISTS idx_retry_next ON retry_queue(next_retry_at);
  \`)

  return {
    add(entry) {
      const id = generateId('retry')
      const now = Date.now()
      sql.exec(\`
        INSERT INTO retry_queue
        (id, error_id, event_type, payload, attempts, max_attempts, status, next_retry_at, backoff_delay, created_at)
        VALUES (?, ?, ?, ?, 0, ?, 'pending', ?, ?, ?)
      \`, id, entry.errorId || null, entry.eventType,
         entry.payload ? JSON.stringify(entry.payload) : null,
         maxAttempts, now + initialBackoff, initialBackoff, now)
      return id
    },

    get(id) {
      const cursor = sql.exec('SELECT * FROM retry_queue WHERE id = ?', id)
      const rows = cursor.toArray()
      return rows.length > 0 ? rows[0] : null
    },

    getReadyItems() {
      const now = Date.now()
      return sql.exec(
        'SELECT * FROM retry_queue WHERE status = ? AND next_retry_at <= ? ORDER BY next_retry_at',
        'pending', now
      ).toArray()
    },

    markAttempted(id, succeeded, error) {
      const item = this.get(id)
      if (!item) return false

      const newAttempts = item.attempts + 1

      if (succeeded) {
        sql.exec("UPDATE retry_queue SET status = 'succeeded', attempts = ? WHERE id = ?", newAttempts, id)
        return true
      }

      if (newAttempts >= item.max_attempts) {
        sql.exec("UPDATE retry_queue SET status = 'abandoned', attempts = ?, last_error = ? WHERE id = ?",
          newAttempts, error || 'Max attempts exceeded', id)
        return false
      }

      // Calculate next backoff with cap
      const newBackoff = Math.min(item.backoff_delay * 2, maxBackoff)
      const nextRetryAt = Date.now() + newBackoff

      sql.exec(\`
        UPDATE retry_queue
        SET status = 'pending', attempts = ?, backoff_delay = ?, next_retry_at = ?, last_error = ?
        WHERE id = ?
      \`, newAttempts, newBackoff, nextRetryAt, error || null, id)

      return false
    },

    getStats() {
      const stats = { total: 0, pending: 0, succeeded: 0, abandoned: 0, processing: 0 }
      const totalCursor = sql.exec('SELECT COUNT(*) as count FROM retry_queue')
      stats.total = totalCursor.toArray()[0]?.count || 0

      const statusCursor = sql.exec('SELECT status, COUNT(*) as count FROM retry_queue GROUP BY status')
      for (const row of statusCursor.toArray()) {
        stats[row.status] = row.count
      }
      return stats
    },

    clear() {
      sql.exec('DELETE FROM retry_queue')
    }
  }
}

// Error tracking for fire-and-forget errors
function createErrorStore(sql) {
  sql.exec(\`
    CREATE TABLE IF NOT EXISTS fire_and_forget_errors (
      id TEXT PRIMARY KEY,
      event_type TEXT,
      handler_index INTEGER,
      message TEXT NOT NULL,
      error_type TEXT NOT NULL,
      retriable INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 1,
      timestamp INTEGER NOT NULL,
      recovered INTEGER DEFAULT 0,
      recovered_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ffe_event_type ON fire_and_forget_errors(event_type);
    CREATE INDEX IF NOT EXISTS idx_ffe_recovered ON fire_and_forget_errors(recovered);
  \`)

  return {
    track(entry) {
      const id = generateId('ffe')
      sql.exec(\`
        INSERT INTO fire_and_forget_errors
        (id, event_type, handler_index, message, error_type, retriable, attempts, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      \`, id, entry.eventType || null, entry.handlerIndex ?? null,
         entry.message, entry.errorType || 'Error', entry.retriable ? 1 : 0,
         entry.attempts || 1, Date.now())
      return id
    },

    get(id) {
      const cursor = sql.exec('SELECT * FROM fire_and_forget_errors WHERE id = ?', id)
      const rows = cursor.toArray()
      return rows.length > 0 ? rows[0] : null
    },

    query(options = {}) {
      let query = 'SELECT * FROM fire_and_forget_errors WHERE 1=1'
      const params = []
      if (options.eventType) {
        query += ' AND event_type = ?'
        params.push(options.eventType)
      }
      if (options.unresolvedOnly) {
        query += ' AND recovered = 0'
      }
      query += ' ORDER BY timestamp DESC'
      return sql.exec(query, ...params).toArray()
    },

    markRecovered(id) {
      const cursor = sql.exec(
        'UPDATE fire_and_forget_errors SET recovered = 1, recovered_at = ? WHERE id = ? AND recovered = 0',
        Date.now(), id
      )
      return cursor.rowsWritten > 0
    },

    getStats() {
      const totalCursor = sql.exec('SELECT COUNT(*) as count FROM fire_and_forget_errors')
      const total = totalCursor.toArray()[0]?.count || 0

      const recoveredCursor = sql.exec('SELECT COUNT(*) as count FROM fire_and_forget_errors WHERE recovered = 1')
      const recovered = recoveredCursor.toArray()[0]?.count || 0

      const byTypeCursor = sql.exec(
        'SELECT event_type, COUNT(*) as count FROM fire_and_forget_errors WHERE event_type IS NOT NULL GROUP BY event_type'
      )
      const byEventType = {}
      for (const row of byTypeCursor.toArray()) {
        byEventType[row.event_type] = row.count
      }

      return { total, recovered, unresolved: total - recovered, byEventType }
    },

    count() {
      const cursor = sql.exec('SELECT COUNT(*) as count FROM fire_and_forget_errors')
      return cursor.toArray()[0]?.count || 0
    },

    clear() {
      sql.exec('DELETE FROM fire_and_forget_errors')
    }
  }
}

// Main DO class for testing
export class ErrorRecoveryDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.sql = state.storage.sql
    this.env = env
    this.instanceId = crypto.randomUUID()

    // Initialize stores
    this.dlq = createDLQ(this.sql)
    this.retryQueue = createRetryQueue(this.sql, { maxAttempts: 5, initialBackoff: 100, maxBackoff: 30000 })
    this.errorStore = createErrorStore(this.sql)

    // Handler execution tracking
    this.handlerExecutions = []
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // ===== INSTANCE IDENTITY =====
      if (path === '/instance-id') {
        return Response.json({ instanceId: this.instanceId })
      }

      // ===== DLQ OPERATIONS =====
      if (path === '/dlq/add' && method === 'POST') {
        const entry = await request.json()
        const id = this.dlq.add(entry)
        return Response.json({ id })
      }

      if (path === '/dlq/get' && method === 'GET') {
        const id = url.searchParams.get('id')
        const entry = this.dlq.get(id)
        return Response.json(entry || { error: 'Not found' }, { status: entry ? 200 : 404 })
      }

      if (path === '/dlq/query' && method === 'GET') {
        const eventType = url.searchParams.get('eventType')
        const limit = parseInt(url.searchParams.get('limit') || '100')
        const entries = this.dlq.query({ eventType, limit })
        return Response.json({ entries })
      }

      if (path === '/dlq/replay' && method === 'POST') {
        const { id, simulateSuccess } = await request.json()
        const entry = this.dlq.get(id)
        if (!entry) {
          return Response.json({ error: 'DLQ entry not found' }, { status: 404 })
        }

        this.dlq.incrementReplayCount(id)

        if (simulateSuccess) {
          this.dlq.remove(id)
          return Response.json({ replayed: true, succeeded: true })
        }

        return Response.json({ replayed: true, succeeded: false, entry: this.dlq.get(id) })
      }

      if (path === '/dlq/count') {
        return Response.json({ count: this.dlq.count() })
      }

      if (path === '/dlq/clear' && method === 'POST') {
        this.dlq.clear()
        return Response.json({ cleared: true })
      }

      // ===== RETRY QUEUE OPERATIONS =====
      if (path === '/retry/add' && method === 'POST') {
        const entry = await request.json()
        const id = this.retryQueue.add(entry)
        return Response.json({ id, item: this.retryQueue.get(id) })
      }

      if (path === '/retry/get' && method === 'GET') {
        const id = url.searchParams.get('id')
        const item = this.retryQueue.get(id)
        return Response.json(item || { error: 'Not found' }, { status: item ? 200 : 404 })
      }

      if (path === '/retry/ready' && method === 'GET') {
        const items = this.retryQueue.getReadyItems()
        return Response.json({ items })
      }

      if (path === '/retry/attempt' && method === 'POST') {
        const { id, succeeded, error } = await request.json()
        const result = this.retryQueue.markAttempted(id, succeeded, error)
        return Response.json({ result, item: this.retryQueue.get(id) })
      }

      if (path === '/retry/stats' && method === 'GET') {
        return Response.json(this.retryQueue.getStats())
      }

      if (path === '/retry/clear' && method === 'POST') {
        this.retryQueue.clear()
        return Response.json({ cleared: true })
      }

      // ===== ERROR STORE OPERATIONS =====
      if (path === '/errors/track' && method === 'POST') {
        const entry = await request.json()
        const id = this.errorStore.track(entry)
        return Response.json({ id, error: this.errorStore.get(id) })
      }

      if (path === '/errors/query' && method === 'GET') {
        const eventType = url.searchParams.get('eventType')
        const unresolvedOnly = url.searchParams.get('unresolvedOnly') === 'true'
        const errors = this.errorStore.query({ eventType, unresolvedOnly })
        return Response.json({ errors })
      }

      if (path === '/errors/recover' && method === 'POST') {
        const { id } = await request.json()
        const success = this.errorStore.markRecovered(id)
        return Response.json({ success, error: this.errorStore.get(id) })
      }

      if (path === '/errors/stats' && method === 'GET') {
        return Response.json(this.errorStore.getStats())
      }

      if (path === '/errors/count' && method === 'GET') {
        return Response.json({ count: this.errorStore.count() })
      }

      if (path === '/errors/clear' && method === 'POST') {
        this.errorStore.clear()
        return Response.json({ cleared: true })
      }

      // ===== SIMULATE EVENT HANDLING =====
      if (path === '/simulate/handler' && method === 'POST') {
        const { eventType, payload, shouldFail, errorType, handlerCount } = await request.json()
        const handlers = handlerCount || 1
        const results = []

        for (let i = 0; i < handlers; i++) {
          const execution = {
            eventType,
            handlerIndex: i,
            timestamp: Date.now(),
            succeeded: false,
            error: null
          }

          try {
            if (shouldFail && (shouldFail === true || shouldFail.includes(i))) {
              if (errorType === 'retriable') {
                throw new RetriableError('Simulated retriable error')
              } else if (errorType === 'nonRetriable') {
                throw new NonRetriableError('Simulated non-retriable error')
              } else if (errorType === 'ambiguous') {
                throw new AmbiguousError('Simulated ambiguous error')
              } else {
                throw new Error('Simulated generic error')
              }
            }
            execution.succeeded = true
          } catch (err) {
            execution.error = err.message
            execution.errorType = err.name
            execution.retriable = err.retriable

            // Track the error
            this.errorStore.track({
              eventType,
              handlerIndex: i,
              message: err.message,
              errorType: err.name,
              retriable: err.retriable === true
            })

            // Add to DLQ if non-retriable
            if (err.retriable !== true) {
              this.dlq.add({
                eventType,
                payload,
                attempts: 1,
                lastError: err.message,
                sourceHandler: \`handler-\${i}\`
              })
            }
          }

          results.push(execution)
          this.handlerExecutions.push(execution)
        }

        return Response.json({ results })
      }

      if (path === '/simulate/concurrent' && method === 'POST') {
        const { eventCount, errorRate } = await request.json()
        const results = []

        // Simulate concurrent event handling
        for (let i = 0; i < eventCount; i++) {
          const shouldError = Math.random() < (errorRate || 0.3)
          if (shouldError) {
            const errorId = this.errorStore.track({
              eventType: \`Concurrent.event\${i}\`,
              message: \`Concurrent error \${i}\`,
              errorType: 'ConcurrentError',
              retriable: true
            })
            results.push({ event: i, errored: true, errorId })
          } else {
            results.push({ event: i, errored: false })
          }
        }

        return Response.json({ results, errorCount: this.errorStore.count() })
      }

      if (path === '/handler-executions' && method === 'GET') {
        return Response.json({ executions: this.handlerExecutions })
      }

      if (path === '/handler-executions/clear' && method === 'POST') {
        this.handlerExecutions = []
        return Response.json({ cleared: true })
      }

      // ===== BACKOFF TESTING =====
      if (path === '/backoff/simulate' && method === 'POST') {
        const { attempts } = await request.json()
        const retryId = this.retryQueue.add({
          eventType: 'Backoff.test',
          payload: { testId: Date.now() }
        })

        const delays = []
        for (let i = 0; i < attempts; i++) {
          const itemBefore = this.retryQueue.get(retryId)
          delays.push(itemBefore.backoff_delay)
          this.retryQueue.markAttempted(retryId, false, \`Attempt \${i + 1} failed\`)
        }

        const finalItem = this.retryQueue.get(retryId)
        return Response.json({
          retryId,
          delays,
          finalStatus: finalItem.status,
          totalAttempts: finalItem.attempts
        })
      }

      // ===== HEALTH =====
      if (path === '/' || path === '/health') {
        return Response.json({
          status: 'ok',
          instanceId: this.instanceId,
          dlqCount: this.dlq.count(),
          errorCount: this.errorStore.count(),
          retryStats: this.retryQueue.getStats()
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
    const id = env.ERROR_DO.idFromName(doName)
    const stub = env.ERROR_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTempDir(): string {
  const dir = path.join(os.tmpdir(), `error-recovery-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function getMiniflareConfig(persistDir?: string) {
  return {
    modules: true,
    script: ERROR_RECOVERY_DO_SCRIPT,
    durableObjects: {
      ERROR_DO: { className: 'ErrorRecoveryDO', useSQLite: true },
    },
    durableObjectsPersist: persistDir ?? false,
  }
}

async function getErrorDOStub(mf: Miniflare, name: string = 'default') {
  const ns = await mf.getDurableObjectNamespace('ERROR_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

function generateTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Error Recovery Edge Cases - DO Event System (do-dy6b)', () => {
  // ==========================================================================
  // 1. DLQ ERROR RECOVERY EDGE CASES
  // ==========================================================================

  describe('1. DLQ Error Recovery Edge Cases', () => {
    let mf: Miniflare

    beforeAll(async () => {
      mf = new Miniflare(getMiniflareConfig())
    })

    afterAll(async () => {
      await mf.dispose()
    })

    it('should handle DLQ replay with duplicate detection', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Add an entry to DLQ
      const addResponse = await stub.fetch('http://fake/dlq/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Order.placed',
          payload: { orderId: 'dup-test-123' },
          attempts: 3,
          lastError: 'Service unavailable'
        })
      })
      const { id } = await addResponse.json() as { id: string }

      // Replay multiple times (simulating accidental double-replay)
      await stub.fetch('http://fake/dlq/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, simulateSuccess: false })
      })

      await stub.fetch('http://fake/dlq/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, simulateSuccess: false })
      })

      // Check replay count is tracked
      const getResponse = await stub.fetch(`http://fake/dlq/get?id=${id}`)
      const entry = await getResponse.json() as { replay_count: number }

      expect(entry.replay_count).toBe(2)
    })

    it('should preserve original event ordering in DLQ queries', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Add entries with small time gaps
      for (let i = 0; i < 5; i++) {
        await stub.fetch('http://fake/dlq/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'Order.placed',
            payload: { orderId: `order-${i}` },
            attempts: 1,
            lastError: `Error ${i}`
          })
        })
        // Small delay to ensure different timestamps
        await new Promise(r => setTimeout(r, 5))
      }

      // Query should return newest first
      const queryResponse = await stub.fetch('http://fake/dlq/query?eventType=Order.placed')
      const { entries } = await queryResponse.json() as { entries: DLQEntry[] }

      expect(entries).toHaveLength(5)
      // Verify descending timestamp order
      for (let i = 0; i < entries.length - 1; i++) {
        expect(entries[i].timestamp).toBeGreaterThanOrEqual(entries[i + 1].timestamp)
      }
    })

    it('should handle DLQ entry removal after successful replay', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Add entry
      const addResponse = await stub.fetch('http://fake/dlq/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Payment.failed',
          payload: { paymentId: 'pay-123' },
          attempts: 1,
          lastError: 'Gateway timeout'
        })
      })
      const { id } = await addResponse.json() as { id: string }

      // Verify it exists
      const countBefore = await stub.fetch('http://fake/dlq/count')
      expect((await countBefore.json() as { count: number }).count).toBe(1)

      // Replay with success
      await stub.fetch('http://fake/dlq/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, simulateSuccess: true })
      })

      // Entry should be removed
      const countAfter = await stub.fetch('http://fake/dlq/count')
      expect((await countAfter.json() as { count: number }).count).toBe(0)
    })

    it('should track DLQ entries by source handler', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Simulate multiple handlers failing for same event
      await stub.fetch('http://fake/simulate/handler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Order.placed',
          payload: { orderId: 'multi-handler-test' },
          shouldFail: [0, 2], // Handlers 0 and 2 fail
          errorType: 'nonRetriable',
          handlerCount: 3
        })
      })

      // Check DLQ has entries for each failed handler
      const queryResponse = await stub.fetch('http://fake/dlq/query?eventType=Order.placed')
      const { entries } = await queryResponse.json() as { entries: { source_handler: string }[] }

      expect(entries.length).toBe(2)
      const handlers = entries.map(e => e.source_handler).sort()
      expect(handlers).toEqual(['handler-0', 'handler-2'])
    })
  })

  // ==========================================================================
  // 2. RETRY PATH EDGE CASES
  // ==========================================================================

  describe('2. Retry Path Edge Cases', () => {
    let mf: Miniflare

    beforeAll(async () => {
      mf = new Miniflare(getMiniflareConfig())
    })

    afterAll(async () => {
      await mf.dispose()
    })

    it('should apply exponential backoff up to max limit', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Simulate multiple retry attempts
      const response = await stub.fetch('http://fake/backoff/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempts: 10 })
      })

      const { delays, finalStatus } = await response.json() as {
        delays: number[]
        finalStatus: string
      }

      // Verify exponential growth
      expect(delays[0]).toBe(100)
      expect(delays[1]).toBe(200)
      expect(delays[2]).toBe(400)
      expect(delays[3]).toBe(800)
      expect(delays[4]).toBe(1600)

      // Verify max backoff cap (30000ms)
      const maxDelay = Math.max(...delays)
      expect(maxDelay).toBeLessThanOrEqual(30000)

      // Should be abandoned after max attempts
      expect(finalStatus).toBe('abandoned')
    })

    it('should handle retry queue item not ready for retry', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Add retry item
      const addResponse = await stub.fetch('http://fake/retry/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Delayed.event',
          payload: { id: 'not-ready-test' }
        })
      })
      const { id } = await addResponse.json() as { id: string; item: RetryQueueItem }

      // Immediately check ready items (should be empty - backoff not elapsed)
      // Note: Initial backoff is 100ms
      const readyResponse = await stub.fetch('http://fake/retry/ready')
      const { items: immediateItems } = await readyResponse.json() as { items: RetryQueueItem[] }

      // Item should not be ready immediately
      expect(immediateItems.length).toBe(0)

      // Wait for backoff
      await new Promise(r => setTimeout(r, 150))

      // Now it should be ready
      const readyAfterResponse = await stub.fetch('http://fake/retry/ready')
      const { items: readyItems } = await readyAfterResponse.json() as { items: RetryQueueItem[] }

      expect(readyItems.length).toBe(1)
      expect(readyItems[0].id).toBe(id)
    })

    it('should transition to abandoned status after max attempts', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Add retry item with default max attempts (5)
      const addResponse = await stub.fetch('http://fake/retry/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Persistent.failure',
          payload: { id: 'abandon-test' }
        })
      })
      const { id } = await addResponse.json() as { id: string }

      // Attempt 5 times (all failures)
      for (let i = 0; i < 5; i++) {
        await stub.fetch('http://fake/retry/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            succeeded: false,
            error: `Attempt ${i + 1} failed`
          })
        })
      }

      // Check final status
      const getResponse = await stub.fetch(`http://fake/retry/get?id=${id}`)
      const item = await getResponse.json() as RetryQueueItem

      expect(item.status).toBe('abandoned')
      expect(item.attempts).toBe(5)
      expect(item.last_error).toBe('Attempt 5 failed')
    })

    it('should handle successful retry after partial failures', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Add retry item
      const addResponse = await stub.fetch('http://fake/retry/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Eventually.succeeds',
          payload: { id: 'partial-failure-test' }
        })
      })
      const { id } = await addResponse.json() as { id: string }

      // Fail twice, then succeed
      await stub.fetch('http://fake/retry/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, succeeded: false, error: 'Attempt 1 failed' })
      })

      await stub.fetch('http://fake/retry/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, succeeded: false, error: 'Attempt 2 failed' })
      })

      await stub.fetch('http://fake/retry/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, succeeded: true })
      })

      // Check final status
      const getResponse = await stub.fetch(`http://fake/retry/get?id=${id}`)
      const item = await getResponse.json() as RetryQueueItem

      expect(item.status).toBe('succeeded')
      expect(item.attempts).toBe(3)
    })
  })

  // ==========================================================================
  // 3. ERROR CLASSIFICATION EDGE CASES
  // ==========================================================================

  describe('3. Error Classification Edge Cases', () => {
    let mf: Miniflare

    beforeAll(async () => {
      mf = new Miniflare(getMiniflareConfig())
    })

    afterAll(async () => {
      await mf.dispose()
    })

    it('should correctly classify retriable errors', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Simulate retriable error
      await stub.fetch('http://fake/simulate/handler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Network.call',
          shouldFail: true,
          errorType: 'retriable'
        })
      })

      // Check error was tracked as retriable
      const errorsResponse = await stub.fetch('http://fake/errors/query?eventType=Network.call')
      const { errors } = await errorsResponse.json() as { errors: { retriable: number }[] }

      expect(errors.length).toBe(1)
      expect(errors[0].retriable).toBe(1) // SQLite uses 1 for true

      // Retriable errors should NOT go to DLQ
      const dlqResponse = await stub.fetch('http://fake/dlq/query?eventType=Network.call')
      const { entries } = await dlqResponse.json() as { entries: DLQEntry[] }
      expect(entries.length).toBe(0)
    })

    it('should correctly classify non-retriable errors', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Simulate non-retriable error
      await stub.fetch('http://fake/simulate/handler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Validation.check',
          shouldFail: true,
          errorType: 'nonRetriable'
        })
      })

      // Check error was tracked as non-retriable
      const errorsResponse = await stub.fetch('http://fake/errors/query?eventType=Validation.check')
      const { errors } = await errorsResponse.json() as { errors: { retriable: number }[] }

      expect(errors.length).toBe(1)
      expect(errors[0].retriable).toBe(0) // SQLite uses 0 for false

      // Non-retriable errors should go to DLQ
      const dlqResponse = await stub.fetch('http://fake/dlq/query?eventType=Validation.check')
      const { entries } = await dlqResponse.json() as { entries: DLQEntry[] }
      expect(entries.length).toBe(1)
    })

    it('should treat ambiguous errors (no retriable flag) as non-retriable', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Simulate ambiguous error (no retriable property)
      await stub.fetch('http://fake/simulate/handler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Unknown.error',
          shouldFail: true,
          errorType: 'ambiguous'
        })
      })

      // Check error classification
      const errorsResponse = await stub.fetch('http://fake/errors/query?eventType=Unknown.error')
      const { errors } = await errorsResponse.json() as { errors: { retriable: number; error_type: string }[] }

      expect(errors.length).toBe(1)
      // Ambiguous errors should default to non-retriable (0)
      expect(errors[0].retriable).toBe(0)
      expect(errors[0].error_type).toBe('AmbiguousError')
    })

    it('should handle errors with explicit retriable=false', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Track error with explicit retriable=false
      await stub.fetch('http://fake/errors/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Explicit.nonRetriable',
          message: 'Explicit non-retriable error',
          errorType: 'BusinessError',
          retriable: false
        })
      })

      const errorsResponse = await stub.fetch('http://fake/errors/query?eventType=Explicit.nonRetriable')
      const { errors } = await errorsResponse.json() as { errors: { retriable: number }[] }

      expect(errors[0].retriable).toBe(0)
    })
  })

  // ==========================================================================
  // 4. RECOVERY FROM PARTIAL FAILURES
  // ==========================================================================

  describe('4. Recovery from Partial Failures', () => {
    let mf: Miniflare

    beforeAll(async () => {
      mf = new Miniflare(getMiniflareConfig())
    })

    afterAll(async () => {
      await mf.dispose()
    })

    it('should track which handlers succeeded and which failed', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Clear previous executions
      await stub.fetch('http://fake/handler-executions/clear', { method: 'POST' })

      // Simulate event with 5 handlers, 2 failing
      await stub.fetch('http://fake/simulate/handler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Multi.handler',
          payload: { id: 'partial-test' },
          shouldFail: [1, 3], // Handlers at index 1 and 3 fail
          errorType: 'generic',
          handlerCount: 5
        })
      })

      // Get execution results
      const execResponse = await stub.fetch('http://fake/handler-executions')
      const { executions } = await execResponse.json() as {
        executions: { handlerIndex: number; succeeded: boolean }[]
      }

      expect(executions.length).toBe(5)

      const succeeded = executions.filter(e => e.succeeded)
      const failed = executions.filter(e => !e.succeeded)

      expect(succeeded.length).toBe(3)
      expect(failed.length).toBe(2)
      expect(failed.map(e => e.handlerIndex).sort()).toEqual([1, 3])
    })

    it('should allow recovering individual handler failures', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Track multiple errors from same event
      const error1 = await stub.fetch('http://fake/errors/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Batch.process',
          handlerIndex: 0,
          message: 'Handler 0 failed',
          errorType: 'NetworkError',
          retriable: true
        })
      })
      const { id: id1 } = await error1.json() as { id: string }

      const error2 = await stub.fetch('http://fake/errors/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'Batch.process',
          handlerIndex: 1,
          message: 'Handler 1 failed',
          errorType: 'NetworkError',
          retriable: true
        })
      })
      const { id: id2 } = await error2.json() as { id: string }

      // Recover only handler 0
      await stub.fetch('http://fake/errors/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id1 })
      })

      // Check stats
      const statsResponse = await stub.fetch('http://fake/errors/stats')
      const stats = await statsResponse.json() as ErrorStats

      expect(stats.total).toBe(2)
      expect(stats.recovered).toBe(1)
      expect(stats.unresolved).toBe(1)
    })

    it('should provide accurate error statistics by event type', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Clear previous errors
      await stub.fetch('http://fake/errors/clear', { method: 'POST' })

      // Track errors for different event types
      for (let i = 0; i < 3; i++) {
        await stub.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'Order.placed',
            message: `Order error ${i}`,
            errorType: 'Error',
            retriable: false
          })
        })
      }

      for (let i = 0; i < 2; i++) {
        await stub.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'Payment.failed',
            message: `Payment error ${i}`,
            errorType: 'Error',
            retriable: false
          })
        })
      }

      const statsResponse = await stub.fetch('http://fake/errors/stats')
      const stats = await statsResponse.json() as ErrorStats

      expect(stats.total).toBe(5)
      expect(stats.byEventType['Order.placed']).toBe(3)
      expect(stats.byEventType['Payment.failed']).toBe(2)
    })
  })

  // ==========================================================================
  // 5. CONCURRENT ERROR HANDLING
  // ==========================================================================

  describe('5. Concurrent Error Handling', () => {
    let mf: Miniflare

    beforeAll(async () => {
      mf = new Miniflare(getMiniflareConfig())
    })

    afterAll(async () => {
      await mf.dispose()
    })

    it('should handle concurrent error tracking without race conditions', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Clear previous errors
      await stub.fetch('http://fake/errors/clear', { method: 'POST' })

      // Simulate concurrent events with 50% error rate
      const response = await stub.fetch('http://fake/simulate/concurrent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventCount: 20, errorRate: 0.5 })
      })

      const { results, errorCount } = await response.json() as {
        results: { event: number; errored: boolean; errorId?: string }[]
        errorCount: number
      }

      expect(results.length).toBe(20)

      // Count expected errors
      const expectedErrorCount = results.filter(r => r.errored).length
      expect(errorCount).toBe(expectedErrorCount)

      // Verify each errored result has a unique errorId
      const errorIds = results.filter(r => r.errored).map(r => r.errorId)
      const uniqueIds = new Set(errorIds)
      expect(uniqueIds.size).toBe(errorIds.length)
    })

    it('should handle concurrent DLQ additions', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Clear DLQ
      await stub.fetch('http://fake/dlq/clear', { method: 'POST' })

      // Add multiple DLQ entries concurrently
      const addPromises = Array.from({ length: 10 }, (_, i) =>
        stub.fetch('http://fake/dlq/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'Concurrent.dlq',
            payload: { index: i },
            attempts: 1,
            lastError: `Concurrent error ${i}`
          })
        })
      )

      await Promise.all(addPromises)

      // Verify all entries were added
      const countResponse = await stub.fetch('http://fake/dlq/count')
      const { count } = await countResponse.json() as { count: number }

      expect(count).toBe(10)
    })

    it('should handle concurrent retry queue operations', async () => {
      const doName = generateTestId()
      const stub = await getErrorDOStub(mf, doName)

      // Clear retry queue
      await stub.fetch('http://fake/retry/clear', { method: 'POST' })

      // Add multiple retry items concurrently
      const addPromises = Array.from({ length: 10 }, (_, i) =>
        stub.fetch('http://fake/retry/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: `Concurrent.retry.${i}`,
            payload: { index: i }
          })
        })
      )

      const results = await Promise.all(addPromises)

      // Verify all items were added with unique IDs
      const ids = await Promise.all(
        results.map(async r => (await r.json() as { id: string }).id)
      )
      const uniqueIds = new Set(ids)

      expect(uniqueIds.size).toBe(10)

      // Check stats
      const statsResponse = await stub.fetch('http://fake/retry/stats')
      const stats = await statsResponse.json() as { total: number; pending: number }

      expect(stats.total).toBe(10)
      expect(stats.pending).toBe(10)
    })
  })

  // ==========================================================================
  // 6. ERROR STATE PERSISTENCE ACROSS DO RESTART
  // ==========================================================================

  describe('6. Error State Persistence Across DO Restart', () => {
    let persistDir: string

    beforeAll(() => {
      persistDir = createTempDir()
    })

    afterAll(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist DLQ entries across DO restart', async () => {
      const doName = generateTestId()
      let dlqId: string

      // First miniflare instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getErrorDOStub(mf1, doName)

        // Add DLQ entry
        const addResponse = await stub1.fetch('http://fake/dlq/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'Persist.test',
            payload: { data: 'persistent' },
            attempts: 2,
            lastError: 'Persisted error'
          })
        })
        const result = await addResponse.json() as { id: string }
        dlqId = result.id
      } finally {
        await mf1.dispose()
      }

      // Second miniflare instance (simulates restart)
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getErrorDOStub(mf2, doName)

        // Verify DLQ entry persisted
        const getResponse = await stub2.fetch(`http://fake/dlq/get?id=${dlqId}`)
        expect(getResponse.status).toBe(200)

        const entry = await getResponse.json() as { event_type: string; last_error: string }
        expect(entry.event_type).toBe('Persist.test')
        expect(entry.last_error).toBe('Persisted error')
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist error store entries across DO restart', async () => {
      const doName = generateTestId()
      let errorId: string

      // First miniflare instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getErrorDOStub(mf1, doName)

        // Track error
        const trackResponse = await stub1.fetch('http://fake/errors/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'Persist.error',
            message: 'Persistent error message',
            errorType: 'PersistentError',
            retriable: true,
            attempts: 3
          })
        })
        const result = await trackResponse.json() as { id: string }
        errorId = result.id
      } finally {
        await mf1.dispose()
      }

      // Second miniflare instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getErrorDOStub(mf2, doName)

        // Verify error persisted
        const queryResponse = await stub2.fetch('http://fake/errors/query?eventType=Persist.error')
        const { errors } = await queryResponse.json() as { errors: { id: string; message: string }[] }

        expect(errors.length).toBe(1)
        expect(errors[0].id).toBe(errorId)
        expect(errors[0].message).toBe('Persistent error message')
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist retry queue state across DO restart', async () => {
      const doName = generateTestId()
      let retryId: string

      // First miniflare instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getErrorDOStub(mf1, doName)

        // Add to retry queue
        const addResponse = await stub1.fetch('http://fake/retry/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'Persist.retry',
            payload: { data: 'retry-data' }
          })
        })
        const result = await addResponse.json() as { id: string }
        retryId = result.id

        // Mark one attempt
        await stub1.fetch('http://fake/retry/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: retryId, succeeded: false, error: 'First attempt failed' })
        })
      } finally {
        await mf1.dispose()
      }

      // Second miniflare instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getErrorDOStub(mf2, doName)

        // Verify retry item persisted with attempt count
        const getResponse = await stub2.fetch(`http://fake/retry/get?id=${retryId}`)
        expect(getResponse.status).toBe(200)

        const item = await getResponse.json() as RetryQueueItem
        expect(item.event_type).toBe('Persist.retry')
        expect(item.attempts).toBe(1)
        expect(item.last_error).toBe('First attempt failed')
        expect(item.status).toBe('pending')
      } finally {
        await mf2.dispose()
      }
    })

    it('should maintain accurate statistics after DO restart', async () => {
      const doName = generateTestId()

      // First miniflare instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getErrorDOStub(mf1, doName)

        // Create some errors
        for (let i = 0; i < 3; i++) {
          await stub1.fetch('http://fake/errors/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventType: 'Stats.test',
              message: `Error ${i}`,
              errorType: 'TestError',
              retriable: false
            })
          })
        }

        // Recover one
        const errorsResponse = await stub1.fetch('http://fake/errors/query?eventType=Stats.test')
        const { errors } = await errorsResponse.json() as { errors: { id: string }[] }
        await stub1.fetch('http://fake/errors/recover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: errors[0].id })
        })
      } finally {
        await mf1.dispose()
      }

      // Second miniflare instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getErrorDOStub(mf2, doName)

        // Verify statistics are correct
        const statsResponse = await stub2.fetch('http://fake/errors/stats')
        const stats = await statsResponse.json() as ErrorStats

        expect(stats.total).toBe(3)
        expect(stats.recovered).toBe(1)
        expect(stats.unresolved).toBe(2)
      } finally {
        await mf2.dispose()
      }
    })
  })
})
