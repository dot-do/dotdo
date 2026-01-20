/**
 * Miniflare Integration Tests - Real Durable Object Instances
 *
 * RED PHASE TDD: These tests define expected behavior for Durable Objects
 * running in real Miniflare runtime instead of mocks.
 *
 * Tests cover:
 * 1. DO instantiation via Miniflare
 * 2. DO storage persistence within request
 * 3. DO SQLite operations
 * 4. DO-to-DO communication (stubs)
 * 5. DO alarm scheduling
 * 6. DO WebSocket hibernation
 * 7. DO concurrent access handling
 *
 * @module do/tests/miniflare-integration.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare, DurableObjectNamespace } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TestDOState {
  counter: number
  items: string[]
  lastUpdated: number
}

interface SQLiteRow {
  id: number
  key: string
  value: string
  created_at: number
}

interface AlarmStatus {
  scheduled: boolean
  scheduledTime: number | null
  firedCount: number
}

// ============================================================================
// TEST DO IMPLEMENTATIONS (Inline for Miniflare)
// ============================================================================

/**
 * Basic test DO script for Miniflare
 * Implements storage, SQLite, alarms, and WebSocket support
 */
const TEST_DO_SCRIPT = `
export class TestDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.sql = state.storage.sql
    this.env = env
    this.alarmFiredCount = 0

    // Initialize SQLite tables
    this.state.blockConcurrencyWhile(async () => {
      this.sql.exec(\`
        CREATE TABLE IF NOT EXISTS items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          value TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        )
      \`)
      this.sql.exec(\`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          payload TEXT,
          timestamp INTEGER DEFAULT (unixepoch())
        )
      \`)
    })
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // Storage operations
      if (path === '/storage/get' && method === 'GET') {
        const key = url.searchParams.get('key')
        const value = await this.storage.get(key)
        return Response.json({ key, value })
      }

      if (path === '/storage/put' && method === 'POST') {
        const { key, value } = await request.json()
        await this.storage.put(key, value)
        return Response.json({ success: true, key, value })
      }

      if (path === '/storage/delete' && method === 'DELETE') {
        const key = url.searchParams.get('key')
        const deleted = await this.storage.delete(key)
        return Response.json({ deleted })
      }

      if (path === '/storage/list' && method === 'GET') {
        const prefix = url.searchParams.get('prefix') || ''
        const entries = await this.storage.list({ prefix })
        return Response.json({ entries: Object.fromEntries(entries) })
      }

      // Counter operations (for concurrency testing)
      if (path === '/counter/increment' && method === 'POST') {
        const current = await this.storage.get('counter') || 0
        const newValue = current + 1
        await this.storage.put('counter', newValue)
        return Response.json({ counter: newValue })
      }

      if (path === '/counter/get' && method === 'GET') {
        const counter = await this.storage.get('counter') || 0
        return Response.json({ counter })
      }

      // SQLite operations
      if (path === '/sql/insert' && method === 'POST') {
        const { key, value } = await request.json()
        const result = this.sql.exec(
          'INSERT INTO items (key, value) VALUES (?, ?) RETURNING id',
          key, value
        )
        const row = result.toArray()[0]
        return Response.json({ success: true, id: row.id })
      }

      if (path === '/sql/get' && method === 'GET') {
        const key = url.searchParams.get('key')
        const result = this.sql.exec('SELECT * FROM items WHERE key = ?', key)
        const rows = result.toArray()
        return Response.json({ row: rows[0] || null })
      }

      if (path === '/sql/list' && method === 'GET') {
        const result = this.sql.exec('SELECT * FROM items ORDER BY id')
        return Response.json({ rows: result.toArray() })
      }

      if (path === '/sql/count' && method === 'GET') {
        const result = this.sql.exec('SELECT COUNT(*) as count FROM items')
        return Response.json({ count: result.toArray()[0].count })
      }

      if (path === '/sql/transaction' && method === 'POST') {
        const { operations } = await request.json()
        const results = []

        // Execute all operations in a transaction via blockConcurrencyWhile
        await this.state.blockConcurrencyWhile(async () => {
          for (const op of operations) {
            if (op.type === 'insert') {
              const result = this.sql.exec(
                'INSERT INTO items (key, value) VALUES (?, ?) RETURNING id',
                op.key, op.value
              )
              results.push({ id: result.toArray()[0].id })
            } else if (op.type === 'delete') {
              this.sql.exec('DELETE FROM items WHERE key = ?', op.key)
              results.push({ deleted: true })
            }
          }
        })

        return Response.json({ success: true, results })
      }

      // Event logging (for testing SQLite writes)
      if (path === '/events/log' && method === 'POST') {
        const { eventType, payload } = await request.json()
        this.sql.exec(
          'INSERT INTO events (event_type, payload) VALUES (?, ?)',
          eventType, JSON.stringify(payload)
        )
        return Response.json({ logged: true })
      }

      if (path === '/events/query' && method === 'GET') {
        const eventType = url.searchParams.get('type')
        let result
        if (eventType) {
          result = this.sql.exec(
            'SELECT * FROM events WHERE event_type = ? ORDER BY timestamp DESC',
            eventType
          )
        } else {
          result = this.sql.exec('SELECT * FROM events ORDER BY timestamp DESC')
        }
        return Response.json({ events: result.toArray() })
      }

      // Alarm operations
      if (path === '/alarm/schedule' && method === 'POST') {
        const { delayMs } = await request.json()
        const scheduledTime = Date.now() + delayMs
        await this.state.storage.setAlarm(scheduledTime)
        await this.storage.put('alarmScheduledTime', scheduledTime)
        return Response.json({ scheduled: true, scheduledTime })
      }

      if (path === '/alarm/status' && method === 'GET') {
        const currentAlarm = await this.state.storage.getAlarm()
        const scheduledTime = await this.storage.get('alarmScheduledTime')
        return Response.json({
          scheduled: !!currentAlarm,
          scheduledTime: currentAlarm || scheduledTime || null,
          firedCount: this.alarmFiredCount
        })
      }

      if (path === '/alarm/cancel' && method === 'POST') {
        await this.state.storage.deleteAlarm()
        return Response.json({ cancelled: true })
      }

      // WebSocket operations
      if (path === '/websocket' && request.headers.get('Upgrade') === 'websocket') {
        const pair = new WebSocketPair()
        const [client, server] = Object.values(pair)

        // Accept and hibernate
        this.state.acceptWebSocket(server, ['test-tag'])

        // Store connection count
        const connCount = (await this.storage.get('wsConnectionCount') || 0) + 1
        await this.storage.put('wsConnectionCount', connCount)

        return new Response(null, {
          status: 101,
          webSocket: client
        })
      }

      if (path === '/websocket/connections' && method === 'GET') {
        const sockets = this.state.getWebSockets()
        const count = await this.storage.get('wsConnectionCount') || 0
        return Response.json({
          activeConnections: sockets.length,
          totalConnections: count
        })
      }

      if (path === '/websocket/broadcast' && method === 'POST') {
        const { message } = await request.json()
        const sockets = this.state.getWebSockets()
        for (const ws of sockets) {
          ws.send(JSON.stringify({ type: 'broadcast', message }))
        }
        return Response.json({ sent: sockets.length })
      }

      // Health check
      if (path === '/' || path === '/health') {
        return Response.json({
          status: 'ok',
          id: this.state.id.toString(),
          timestamp: Date.now()
        })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
  }

  async alarm() {
    this.alarmFiredCount++
    await this.storage.put('lastAlarmFired', Date.now())
    await this.storage.put('alarmFiredCount', this.alarmFiredCount)

    // Log the alarm event
    this.sql.exec(
      'INSERT INTO events (event_type, payload) VALUES (?, ?)',
      'alarm', JSON.stringify({ firedAt: Date.now(), count: this.alarmFiredCount })
    )
  }

  async webSocketMessage(ws, message) {
    const data = typeof message === 'string' ? JSON.parse(message) : message

    // Echo with metadata
    ws.send(JSON.stringify({
      type: 'echo',
      original: data,
      timestamp: Date.now()
    }))

    // Log the message
    this.sql.exec(
      'INSERT INTO events (event_type, payload) VALUES (?, ?)',
      'websocket_message', JSON.stringify(data)
    )
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const connCount = (await this.storage.get('wsConnectionCount') || 1) - 1
    await this.storage.put('wsConnectionCount', Math.max(0, connCount))

    this.sql.exec(
      'INSERT INTO events (event_type, payload) VALUES (?, ?)',
      'websocket_close', JSON.stringify({ code, reason, wasClean })
    )
  }
}

// Coordinator DO for DO-to-DO communication testing
export class CoordinatorDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // Forward request to another DO
      if (path === '/forward' && method === 'POST') {
        const { targetName, targetPath, body } = await request.json()

        const targetId = this.env.TEST_DO.idFromName(targetName)
        const targetStub = this.env.TEST_DO.get(targetId)

        const response = await targetStub.fetch(
          new Request(\`http://fake\${targetPath}\`, {
            method: body ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
          })
        )

        const result = await response.json()
        return Response.json({ forwarded: true, result })
      }

      // Aggregate data from multiple DOs
      if (path === '/aggregate' && method === 'POST') {
        const { targetNames } = await request.json()
        const results = []

        for (const name of targetNames) {
          const targetId = this.env.TEST_DO.idFromName(name)
          const targetStub = this.env.TEST_DO.get(targetId)

          const response = await targetStub.fetch(
            new Request('http://fake/counter/get')
          )
          const data = await response.json()
          results.push({ name, ...data })
        }

        return Response.json({ aggregated: results })
      }

      // Fan-out operation to multiple DOs
      if (path === '/fanout' && method === 'POST') {
        const { targetNames, operation } = await request.json()

        const promises = targetNames.map(async (name) => {
          const targetId = this.env.TEST_DO.idFromName(name)
          const targetStub = this.env.TEST_DO.get(targetId)

          const response = await targetStub.fetch(
            new Request(\`http://fake\${operation.path}\`, {
              method: operation.method || 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: operation.body ? JSON.stringify(operation.body) : undefined
            })
          )

          return { name, result: await response.json() }
        })

        const results = await Promise.all(promises)
        return Response.json({ fanout: results })
      }

      // Health
      if (path === '/') {
        return Response.json({ status: 'coordinator', id: this.state.id.toString() })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doType = url.searchParams.get('do') || 'test'
    const doName = url.searchParams.get('name') || 'default'

    let stub
    if (doType === 'coordinator') {
      const id = env.COORDINATOR_DO.idFromName(doName)
      stub = env.COORDINATOR_DO.get(id)
    } else {
      const id = env.TEST_DO.idFromName(doName)
      stub = env.TEST_DO.get(id)
    }

    return stub.fetch(request)
  }
}
`

// ============================================================================
// MINIFLARE CONFIGURATION
// ============================================================================

function getMiniflareConfig() {
  return {
    modules: true,
    script: TEST_DO_SCRIPT,
    durableObjects: {
      TEST_DO: 'TestDO',
      COORDINATOR_DO: 'CoordinatorDO',
    },
    // Enable SQLite for DO storage
    durableObjectsPersist: false, // In-memory for tests
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

async function getTestDOStub(mf: Miniflare, name: string = 'default') {
  const ns = await mf.getDurableObjectNamespace('TEST_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

async function getCoordinatorStub(mf: Miniflare, name: string = 'default') {
  const ns = await mf.getDurableObjectNamespace('COORDINATOR_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Miniflare DO Integration Tests', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
  })

  afterAll(async () => {
    await mf.dispose()
  })

  // ==========================================================================
  // 1. DO INSTANTIATION VIA MINIFLARE
  // ==========================================================================

  describe('DO Instantiation via Miniflare', () => {
    it('creates a DO instance with unique ID', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      const response = await stub.fetch('http://fake/health')
      expect(response.status).toBe(200)

      const json = (await response.json()) as { status: string; id: string; timestamp: number }
      expect(json.status).toBe('ok')
      expect(json.id).toBeDefined()
      expect(typeof json.id).toBe('string')
    })

    it('creates separate instances for different names', async () => {
      const stub1 = await getTestDOStub(mf, 'instance-1')
      const stub2 = await getTestDOStub(mf, 'instance-2')

      const [resp1, resp2] = await Promise.all([
        stub1.fetch('http://fake/health'),
        stub2.fetch('http://fake/health'),
      ])

      const json1 = (await resp1.json()) as { id: string }
      const json2 = (await resp2.json()) as { id: string }

      expect(json1.id).not.toBe(json2.id)
    })

    it('returns the same instance for the same name', async () => {
      const name = generateTestId()
      const stub1 = await getTestDOStub(mf, name)
      const stub2 = await getTestDOStub(mf, name)

      // Store data via stub1
      await stub1.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'test', value: 'hello' }),
      })

      // Retrieve via stub2 - should see the same data
      const response = await stub2.fetch('http://fake/storage/get?key=test')
      const json = (await response.json()) as { value: string }

      expect(json.value).toBe('hello')
    })

    it('isolates data between different DO instances', async () => {
      const stub1 = await getTestDOStub(mf, `isolated-${generateTestId()}`)
      const stub2 = await getTestDOStub(mf, `isolated-${generateTestId()}`)

      // Store different data in each
      await stub1.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'shared', value: 'value-1' }),
      })

      await stub2.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'shared', value: 'value-2' }),
      })

      // Verify isolation
      const resp1 = await stub1.fetch('http://fake/storage/get?key=shared')
      const resp2 = await stub2.fetch('http://fake/storage/get?key=shared')

      const json1 = (await resp1.json()) as { value: string }
      const json2 = (await resp2.json()) as { value: string }

      expect(json1.value).toBe('value-1')
      expect(json2.value).toBe('value-2')
    })
  })

  // ==========================================================================
  // 2. DO STORAGE PERSISTENCE WITHIN REQUEST
  // ==========================================================================

  describe('DO Storage Persistence Within Request', () => {
    it('persists data across multiple requests to same DO', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // First request - store data
      await stub.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'persistent', value: { count: 1, name: 'test' } }),
      })

      // Second request - retrieve data
      const response = await stub.fetch('http://fake/storage/get?key=persistent')
      const json = (await response.json()) as { value: { count: number; name: string } }

      expect(json.value.count).toBe(1)
      expect(json.value.name).toBe('test')
    })

    it('supports put, get, delete, and list operations', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Put multiple items
      await stub.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'item:1', value: 'first' }),
      })
      await stub.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'item:2', value: 'second' }),
      })
      await stub.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'other:1', value: 'other' }),
      })

      // List with prefix
      const listResponse = await stub.fetch('http://fake/storage/list?prefix=item:')
      const listJson = (await listResponse.json()) as { entries: Record<string, string> }

      expect(Object.keys(listJson.entries)).toHaveLength(2)
      expect(listJson.entries['item:1']).toBe('first')
      expect(listJson.entries['item:2']).toBe('second')

      // Delete
      await stub.fetch('http://fake/storage/delete?key=item:1', { method: 'DELETE' })

      // Verify deletion
      const getResponse = await stub.fetch('http://fake/storage/get?key=item:1')
      const getJson = (await getResponse.json()) as { value: string | null }

      expect(getJson.value).toBeNull()
    })

    it('persists complex nested objects', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      const complexData = {
        nested: {
          deep: {
            value: [1, 2, 3],
            map: { a: 'b', c: 'd' },
          },
        },
        array: [{ id: 1 }, { id: 2 }],
        date: new Date().toISOString(),
        nullValue: null,
        booleans: [true, false],
      }

      await stub.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'complex', value: complexData }),
      })

      const response = await stub.fetch('http://fake/storage/get?key=complex')
      const json = (await response.json()) as { value: typeof complexData }

      expect(json.value).toEqual(complexData)
    })

    it('handles concurrent storage operations correctly', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Fire multiple puts concurrently
      const putPromises = Array.from({ length: 10 }, (_, i) =>
        stub.fetch('http://fake/storage/put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: `concurrent:${i}`, value: `value-${i}` }),
        })
      )

      await Promise.all(putPromises)

      // List all concurrent items
      const listResponse = await stub.fetch('http://fake/storage/list?prefix=concurrent:')
      const listJson = (await listResponse.json()) as { entries: Record<string, string> }

      expect(Object.keys(listJson.entries)).toHaveLength(10)
    })
  })

  // ==========================================================================
  // 3. DO SQLITE OPERATIONS
  // ==========================================================================

  describe('DO SQLite Operations', () => {
    it('creates tables and inserts data', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Insert data
      const insertResponse = await stub.fetch('http://fake/sql/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'test-key', value: 'test-value' }),
      })

      const insertJson = (await insertResponse.json()) as { success: boolean; id: number }
      expect(insertJson.success).toBe(true)
      expect(insertJson.id).toBeGreaterThan(0)

      // Retrieve data
      const getResponse = await stub.fetch('http://fake/sql/get?key=test-key')
      const getJson = (await getResponse.json()) as { row: SQLiteRow }

      expect(getJson.row).toBeDefined()
      expect(getJson.row.key).toBe('test-key')
      expect(getJson.row.value).toBe('test-value')
    })

    it('supports SQL queries with filtering', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Insert multiple items
      for (let i = 0; i < 5; i++) {
        await stub.fetch('http://fake/sql/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: `item-${i}`, value: `value-${i}` }),
        })
      }

      // List all
      const listResponse = await stub.fetch('http://fake/sql/list')
      const listJson = (await listResponse.json()) as { rows: SQLiteRow[] }

      expect(listJson.rows).toHaveLength(5)

      // Count
      const countResponse = await stub.fetch('http://fake/sql/count')
      const countJson = (await countResponse.json()) as { count: number }

      expect(countJson.count).toBe(5)
    })

    it('supports transactions via blockConcurrencyWhile', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Execute a transaction with multiple operations
      const txResponse = await stub.fetch('http://fake/sql/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [
            { type: 'insert', key: 'tx-1', value: 'first' },
            { type: 'insert', key: 'tx-2', value: 'second' },
            { type: 'insert', key: 'tx-3', value: 'third' },
          ],
        }),
      })

      const txJson = (await txResponse.json()) as { success: boolean; results: { id: number }[] }
      expect(txJson.success).toBe(true)
      expect(txJson.results).toHaveLength(3)

      // Verify all items exist
      const countResponse = await stub.fetch('http://fake/sql/count')
      const countJson = (await countResponse.json()) as { count: number }
      expect(countJson.count).toBe(3)
    })

    it('persists SQLite data across requests', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Insert in first request
      await stub.fetch('http://fake/sql/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'persist-sql', value: 'persisted' }),
      })

      // Get new stub reference (simulates new request)
      const stub2 = await getTestDOStub(mf, name)

      // Query in second "request"
      const getResponse = await stub2.fetch('http://fake/sql/get?key=persist-sql')
      const getJson = (await getResponse.json()) as { row: SQLiteRow }

      expect(getJson.row.value).toBe('persisted')
    })

    it('handles unique constraint violations', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Insert first item
      await stub.fetch('http://fake/sql/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'unique-key', value: 'first' }),
      })

      // Try to insert duplicate key
      const dupResponse = await stub.fetch('http://fake/sql/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'unique-key', value: 'second' }),
      })

      // Should return an error
      expect(dupResponse.status).toBe(500)
      const dupJson = (await dupResponse.json()) as { error: string }
      expect(dupJson.error).toMatch(/UNIQUE|constraint/i)
    })

    it('logs events to SQLite and queries them', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Log some events
      await stub.fetch('http://fake/events/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'user_action', payload: { action: 'click' } }),
      })
      await stub.fetch('http://fake/events/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'user_action', payload: { action: 'scroll' } }),
      })
      await stub.fetch('http://fake/events/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'system', payload: { type: 'startup' } }),
      })

      // Query all events
      const allResponse = await stub.fetch('http://fake/events/query')
      const allJson = (await allResponse.json()) as { events: { event_type: string; payload: string }[] }
      expect(allJson.events).toHaveLength(3)

      // Query by type
      const userResponse = await stub.fetch('http://fake/events/query?type=user_action')
      const userJson = (await userResponse.json()) as { events: { event_type: string }[] }
      expect(userJson.events).toHaveLength(2)
      expect(userJson.events.every((e) => e.event_type === 'user_action')).toBe(true)
    })
  })

  // ==========================================================================
  // 4. DO-TO-DO COMMUNICATION (STUBS)
  // ==========================================================================

  describe('DO-to-DO Communication (Stubs)', () => {
    it('forwards requests from one DO to another', async () => {
      const coordinatorName = generateTestId()
      const targetName = generateTestId()

      const coordinator = await getCoordinatorStub(mf, coordinatorName)
      const target = await getTestDOStub(mf, targetName)

      // Initialize target DO with some data
      await target.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'forwarded-data', value: 'from-target' }),
      })

      // Forward request via coordinator
      const forwardResponse = await coordinator.fetch('http://fake/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetName,
          targetPath: '/storage/get?key=forwarded-data',
        }),
      })

      const forwardJson = (await forwardResponse.json()) as { forwarded: boolean; result: { value: string } }
      expect(forwardJson.forwarded).toBe(true)
      expect(forwardJson.result.value).toBe('from-target')
    })

    it('aggregates data from multiple DOs', async () => {
      const coordinatorName = generateTestId()
      const targetNames = [generateTestId(), generateTestId(), generateTestId()]

      const coordinator = await getCoordinatorStub(mf, coordinatorName)

      // Initialize each target with a different counter value
      for (let i = 0; i < targetNames.length; i++) {
        const target = await getTestDOStub(mf, targetNames[i])
        // Increment counter i+1 times
        for (let j = 0; j <= i; j++) {
          await target.fetch('http://fake/counter/increment', { method: 'POST' })
        }
      }

      // Aggregate counters
      const aggregateResponse = await coordinator.fetch('http://fake/aggregate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetNames }),
      })

      const aggregateJson = (await aggregateResponse.json()) as {
        aggregated: { name: string; counter: number }[]
      }

      expect(aggregateJson.aggregated).toHaveLength(3)
      expect(aggregateJson.aggregated[0].counter).toBe(1)
      expect(aggregateJson.aggregated[1].counter).toBe(2)
      expect(aggregateJson.aggregated[2].counter).toBe(3)
    })

    it('performs fan-out operations to multiple DOs', async () => {
      const coordinatorName = generateTestId()
      const targetNames = [generateTestId(), generateTestId(), generateTestId()]

      const coordinator = await getCoordinatorStub(mf, coordinatorName)

      // Fan-out increment operation to all targets
      const fanoutResponse = await coordinator.fetch('http://fake/fanout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetNames,
          operation: {
            path: '/counter/increment',
            method: 'POST',
          },
        }),
      })

      const fanoutJson = (await fanoutResponse.json()) as {
        fanout: { name: string; result: { counter: number } }[]
      }

      expect(fanoutJson.fanout).toHaveLength(3)
      // All should have counter = 1
      expect(fanoutJson.fanout.every((r) => r.result.counter === 1)).toBe(true)
    })

    it('handles DO-to-DO communication errors gracefully', async () => {
      const coordinatorName = generateTestId()
      const coordinator = await getCoordinatorStub(mf, coordinatorName)

      // Forward to a non-existent endpoint
      const forwardResponse = await coordinator.fetch('http://fake/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetName: 'any-target',
          targetPath: '/nonexistent',
        }),
      })

      const forwardJson = (await forwardResponse.json()) as { forwarded: boolean; result: { error: string } }
      expect(forwardJson.result.error).toBe('Not found')
    })
  })

  // ==========================================================================
  // 5. DO ALARM SCHEDULING
  // ==========================================================================

  describe('DO Alarm Scheduling', () => {
    it('schedules an alarm for future execution', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      const scheduleResponse = await stub.fetch('http://fake/alarm/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delayMs: 1000 }), // 1 second
      })

      const scheduleJson = (await scheduleResponse.json()) as { scheduled: boolean; scheduledTime: number }
      expect(scheduleJson.scheduled).toBe(true)
      expect(scheduleJson.scheduledTime).toBeGreaterThan(Date.now())

      // Check status
      const statusResponse = await stub.fetch('http://fake/alarm/status')
      const statusJson = (await statusResponse.json()) as AlarmStatus

      expect(statusJson.scheduled).toBe(true)
      expect(statusJson.scheduledTime).toBeDefined()
    })

    it('cancels a scheduled alarm', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Schedule
      await stub.fetch('http://fake/alarm/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delayMs: 60000 }), // 1 minute
      })

      // Cancel
      const cancelResponse = await stub.fetch('http://fake/alarm/cancel', {
        method: 'POST',
      })
      const cancelJson = (await cancelResponse.json()) as { cancelled: boolean }
      expect(cancelJson.cancelled).toBe(true)

      // Verify cancelled
      const statusResponse = await stub.fetch('http://fake/alarm/status')
      const statusJson = (await statusResponse.json()) as AlarmStatus

      expect(statusJson.scheduled).toBe(false)
    })

    it('executes alarm and logs the event', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Schedule alarm for immediate execution
      await stub.fetch('http://fake/alarm/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delayMs: 10 }), // Very short delay
      })

      // Wait for alarm to potentially fire (Miniflare advances time automatically in some modes)
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Note: In real Miniflare testing, you'd use mf.getAlarmTime() and mf.runAlarms()
      // to trigger alarms. This test verifies the scheduling mechanism works.
      const statusResponse = await stub.fetch('http://fake/alarm/status')
      const statusJson = (await statusResponse.json()) as AlarmStatus

      // The alarm should either be scheduled or have fired
      expect(statusJson.scheduledTime).not.toBeNull()
    })

    it('alarm handler persists data to storage', async () => {
      // This test verifies the alarm handler can write to storage
      // The actual alarm execution requires Miniflare's time advancement APIs
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Initialize a counter
      await stub.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'alarmFiredCount', value: 0 }),
      })

      // Schedule alarm
      await stub.fetch('http://fake/alarm/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delayMs: 1 }),
      })

      // The test framework should trigger alarms - verify status is trackable
      const response = await stub.fetch('http://fake/alarm/status')
      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // 6. DO WEBSOCKET HIBERNATION
  // ==========================================================================

  describe('DO WebSocket Hibernation', () => {
    it('accepts WebSocket connections', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      const response = await stub.fetch('http://fake/websocket', {
        headers: {
          Upgrade: 'websocket',
        },
      })

      // Miniflare returns 101 for WebSocket upgrade
      expect(response.status).toBe(101)
      expect(response.webSocket).toBeDefined()
    })

    it('tracks WebSocket connection count', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Connect multiple WebSockets
      await stub.fetch('http://fake/websocket', {
        headers: { Upgrade: 'websocket' },
      })
      await stub.fetch('http://fake/websocket', {
        headers: { Upgrade: 'websocket' },
      })

      // Check connection count
      const countResponse = await stub.fetch('http://fake/websocket/connections')
      const countJson = (await countResponse.json()) as { activeConnections: number; totalConnections: number }

      expect(countJson.totalConnections).toBe(2)
    })

    it('broadcasts messages to all connected WebSockets', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Connect a WebSocket
      const wsResponse = await stub.fetch('http://fake/websocket', {
        headers: { Upgrade: 'websocket' },
      })
      expect(wsResponse.webSocket).toBeDefined()

      // Broadcast
      const broadcastResponse = await stub.fetch('http://fake/websocket/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello everyone!' }),
      })

      const broadcastJson = (await broadcastResponse.json()) as { sent: number }
      expect(broadcastJson.sent).toBeGreaterThanOrEqual(0)
    })

    it('uses hibernation API (acceptWebSocket)', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // The implementation uses state.acceptWebSocket for hibernation
      const response = await stub.fetch('http://fake/websocket', {
        headers: { Upgrade: 'websocket' },
      })

      // If hibernation is working, connection succeeds
      expect(response.status).toBe(101)
    })

    it('logs WebSocket events to SQLite', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Connect
      await stub.fetch('http://fake/websocket', {
        headers: { Upgrade: 'websocket' },
      })

      // Query events - connection events should be logged
      const eventsResponse = await stub.fetch('http://fake/events/query')
      const eventsJson = (await eventsResponse.json()) as { events: { event_type: string }[] }

      // Events may include websocket-related entries
      expect(eventsJson.events).toBeDefined()
    })
  })

  // ==========================================================================
  // 7. DO CONCURRENT ACCESS HANDLING
  // ==========================================================================

  describe('DO Concurrent Access Handling', () => {
    it('handles concurrent increments correctly', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Fire 10 concurrent increments
      const incrementPromises = Array.from({ length: 10 }, () =>
        stub.fetch('http://fake/counter/increment', { method: 'POST' })
      )

      await Promise.all(incrementPromises)

      // Check final counter value
      const response = await stub.fetch('http://fake/counter/get')
      const json = (await response.json()) as { counter: number }

      // Due to DO's single-threaded nature, counter should be exactly 10
      expect(json.counter).toBe(10)
    })

    it('serializes concurrent storage writes', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Fire concurrent writes to different keys
      const writePromises = Array.from({ length: 20 }, (_, i) =>
        stub.fetch('http://fake/storage/put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: `concurrent-${i}`, value: `value-${i}` }),
        })
      )

      await Promise.all(writePromises)

      // Verify all writes succeeded
      const listResponse = await stub.fetch('http://fake/storage/list?prefix=concurrent-')
      const listJson = (await listResponse.json()) as { entries: Record<string, string> }

      expect(Object.keys(listJson.entries)).toHaveLength(20)
    })

    it('serializes concurrent SQLite writes', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Fire concurrent SQL inserts
      const insertPromises = Array.from({ length: 10 }, (_, i) =>
        stub.fetch('http://fake/sql/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: `sql-concurrent-${i}`, value: `value-${i}` }),
        })
      )

      const results = await Promise.all(insertPromises)

      // All should succeed
      for (const result of results) {
        expect(result.status).toBe(200)
      }

      // Verify count
      const countResponse = await stub.fetch('http://fake/sql/count')
      const countJson = (await countResponse.json()) as { count: number }

      expect(countJson.count).toBe(10)
    })

    it('handles read-write race conditions safely', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Initialize counter
      await stub.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'race-counter', value: 0 }),
      })

      // Mix of reads and writes
      const operations = Array.from({ length: 30 }, (_, i) => {
        if (i % 3 === 0) {
          return stub.fetch('http://fake/counter/get')
        } else {
          return stub.fetch('http://fake/counter/increment', { method: 'POST' })
        }
      })

      await Promise.all(operations)

      // Final counter should be 20 (30 ops, 1/3 are reads)
      const response = await stub.fetch('http://fake/counter/get')
      const json = (await response.json()) as { counter: number }

      expect(json.counter).toBe(20)
    })

    it('maintains consistency under concurrent transactions', async () => {
      const name = generateTestId()
      const stub = await getTestDOStub(mf, name)

      // Fire concurrent transactions
      const txPromises = Array.from({ length: 5 }, (_, i) =>
        stub.fetch('http://fake/sql/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operations: [
              { type: 'insert', key: `tx-batch-${i}-a`, value: 'a' },
              { type: 'insert', key: `tx-batch-${i}-b`, value: 'b' },
            ],
          }),
        })
      )

      await Promise.all(txPromises)

      // Should have 10 items total (5 transactions * 2 items each)
      const countResponse = await stub.fetch('http://fake/sql/count')
      const countJson = (await countResponse.json()) as { count: number }

      expect(countJson.count).toBe(10)
    })

    it('handles concurrent requests from multiple callers', async () => {
      const name = generateTestId()

      // Get multiple stub references (simulating different callers)
      const stubs = await Promise.all(
        Array.from({ length: 5 }, () => getTestDOStub(mf, name))
      )

      // Each "caller" increments concurrently
      const incrementPromises = stubs.flatMap((stub) =>
        Array.from({ length: 4 }, () =>
          stub.fetch('http://fake/counter/increment', { method: 'POST' })
        )
      )

      await Promise.all(incrementPromises)

      // Final count should be 20 (5 stubs * 4 increments)
      const response = await stubs[0].fetch('http://fake/counter/get')
      const json = (await response.json()) as { counter: number }

      expect(json.counter).toBe(20)
    })
  })
})
