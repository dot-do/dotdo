/**
 * BrokerDO Hibernation Recovery Tests - TDD RED Phase
 *
 * Tests for BrokerDO hibernation recovery with in-flight request persistence.
 * When a Durable Object hibernates, in-flight RPC requests must be persisted
 * to SQLite so they can be recovered when the DO wakes up.
 *
 * Key scenarios:
 * 1. Persist in-flight requests to SQLite before forwarding
 * 2. Tag WebSocket connections with client ID for recovery
 * 3. Restore in-flight requests on wake
 * 4. Find WebSocket by tag after hibernation
 * 5. Timeout stale in-flight requests (>30s)
 * 6. Clear in-flight request after response
 * 7. Handle wake with no pending requests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CallMessage,
  ReturnMessage,
  ErrorMessage,
  generateBrokerMessageId,
} from '../broker-protocol'
import {
  BrokerDO,
  type BrokerEnv,
  type BrokerDOState,
  type RpcTarget,
  type HibernationBrokerDOState,
} from '../broker-do'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Mock WebSocket for testing
 */
class MockWebSocket {
  sent: string[] = []
  closed = false
  closeCode?: number
  closeReason?: string
  readyState = 1 // WebSocket.OPEN

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closed = true
    this.closeCode = code
    this.closeReason = reason
    this.readyState = 3 // WebSocket.CLOSED
  }

  getLastMessage<T>(): T | null {
    if (this.sent.length === 0) return null
    return JSON.parse(this.sent[this.sent.length - 1]) as T
  }

  getAllMessages<T>(): T[] {
    return this.sent.map((s) => JSON.parse(s) as T)
  }
}

/**
 * Mock RpcTarget for testing RPC routing
 */
class MockRpcTarget implements RpcTarget {
  public rpcCalls: Array<{ method: string; args: unknown[]; capability?: string }> = []
  public mockResponses: Map<string, unknown> = new Map()
  public shouldError = false
  public errorMessage = 'Mock error'
  public delay = 0

  async rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown> {
    this.rpcCalls.push({ method, args, capability })

    if (this.delay > 0) {
      await new Promise((r) => setTimeout(r, this.delay))
    }

    if (this.shouldError) {
      throw new Error(this.errorMessage)
    }

    const response = this.mockResponses.get(method)
    if (response !== undefined) {
      return response
    }

    return { success: true, method, args }
  }
}

/**
 * Mock SQLite for testing persistence
 */
class MockSqlStorage {
  private tables = new Map<string, unknown[]>()
  private schema: string[] = []

  exec(sql: string, ...params: unknown[]): { toArray: () => unknown[] } {
    // Handle schema creation
    if (sql.trim().toUpperCase().startsWith('CREATE TABLE')) {
      this.schema.push(sql)
      const tableMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)
      if (tableMatch) {
        this.tables.set(tableMatch[1], [])
      }
      return { toArray: () => [] }
    }

    // Handle INSERT
    if (sql.trim().toUpperCase().startsWith('INSERT INTO')) {
      const tableMatch = sql.match(/INSERT INTO (\w+)/i)
      if (tableMatch) {
        const table = this.tables.get(tableMatch[1]) ?? []
        // Extract column names from the INSERT statement
        const columnsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i)
        if (columnsMatch) {
          const columns = columnsMatch[1].split(',').map((c) => c.trim())
          const row: Record<string, unknown> = {}
          columns.forEach((col, i) => {
            row[col] = params[i]
          })
          table.push(row)
          this.tables.set(tableMatch[1], table)
        }
      }
      return { toArray: () => [] }
    }

    // Handle DELETE
    if (sql.trim().toUpperCase().startsWith('DELETE FROM')) {
      const tableMatch = sql.match(/DELETE FROM (\w+)/i)
      if (tableMatch) {
        const table = this.tables.get(tableMatch[1]) ?? []
        // Simple WHERE id = ? handling
        const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i)
        if (whereMatch) {
          const column = whereMatch[1]
          const filtered = table.filter((row: any) => row[column] !== params[0])
          this.tables.set(tableMatch[1], filtered)
        }
      }
      return { toArray: () => [] }
    }

    // Handle SELECT
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      const tableMatch = sql.match(/FROM (\w+)/i)
      if (tableMatch) {
        return { toArray: () => this.tables.get(tableMatch[1]) ?? [] }
      }
    }

    return { toArray: () => [] }
  }

  // Helper for tests to inspect storage
  getTable(name: string): unknown[] {
    return this.tables.get(name) ?? []
  }

  getSchema(): string[] {
    return this.schema
  }
}

/**
 * Mock DurableObjectState with SQLite and hibernation support
 */
class MockDurableObjectStateWithSql implements HibernationBrokerDOState {
  private webSockets = new Map<string, WebSocket[]>()
  private webSocketTags = new Map<WebSocket, string[]>()
  public sql = new MockSqlStorage()
  public storage = { sql: this.sql }

  acceptWebSocket(ws: WebSocket, tags?: string[]): void {
    const tagList = tags ?? ['default']
    this.webSocketTags.set(ws, tagList)
    for (const tag of tagList) {
      const existing = this.webSockets.get(tag) ?? []
      existing.push(ws)
      this.webSockets.set(tag, existing)
    }
  }

  getWebSockets(tag?: string): WebSocket[] {
    if (tag) {
      return this.webSockets.get(tag) ?? []
    }
    const all: WebSocket[] = []
    const seen = new Set<WebSocket>()
    for (const sockets of this.webSockets.values()) {
      for (const s of sockets) {
        if (!seen.has(s)) {
          seen.add(s)
          all.push(s)
        }
      }
    }
    return all
  }

  getTags(ws: WebSocket): string[] {
    return this.webSocketTags.get(ws) ?? []
  }

  // Simulate hibernation: clear in-memory websocket tracking
  simulateHibernation(): void {
    // WebSockets survive hibernation on Cloudflare's end
    // but the DO instance's in-memory state is lost
    // The sql storage persists
  }

  // Simulate wake: restore websockets from Cloudflare (they just reappear)
  simulateWake(sockets: WebSocket[]): void {
    // Re-add the sockets with their original tags
    for (const ws of sockets) {
      const tags = this.webSocketTags.get(ws)
      if (tags) {
        for (const tag of tags) {
          const existing = this.webSockets.get(tag) ?? []
          if (!existing.includes(ws)) {
            existing.push(ws)
            this.webSockets.set(tag, existing)
          }
        }
      }
    }
  }
}

/**
 * Create a hibernation-capable test broker instance
 */
function createHibernationBroker(): BrokerDO<BrokerEnv> {
  const ctx = new MockDurableObjectStateWithSql()
  return new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
}

// =============================================================================
// Hibernation Persistence Tests
// =============================================================================

describe('BrokerDO Hibernation: In-Flight Request Persistence', () => {
  it('should persist in-flight requests to SQLite before forwarding', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.delay = 100 // Slow response to capture in-flight state
    targetStub.mockResponses.set('slowMethod', 'done')

    broker.addMockTarget('slow-worker', targetStub)
    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:persist-test'])

    const call: CallMessage = {
      id: 'persist-call-1',
      type: 'call',
      target: 'slow-worker',
      method: 'slowMethod',
      args: [{ data: 'test' }],
      capability: 'cap_test',
    }

    // Start the call but don't wait for it
    const callPromise = broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    // Give a small delay to allow persistence
    await new Promise((r) => setTimeout(r, 10))

    // Check that the request was persisted to SQLite
    const inFlightRows = ctx.sql.getTable('broker_in_flight')
    expect(inFlightRows.length).toBe(1)

    const row = inFlightRows[0] as Record<string, unknown>
    expect(row.id).toBe('persist-call-1')
    expect(row.target).toBe('slow-worker')
    expect(row.method).toBe('slowMethod')
    expect(JSON.parse(row.args as string)).toEqual([{ data: 'test' }])
    expect(row.capability).toBe('cap_test')
    expect(row.started_at).toBeDefined()

    // Wait for the call to complete
    await callPromise
  })

  it('should tag WebSocket with client ID for recovery', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
    const ws = new MockWebSocket()

    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:tagged-client-123'])

    // Verify the WebSocket was tagged correctly
    const sockets = broker.ctx.getWebSockets('client:tagged-client-123')
    expect(sockets).toHaveLength(1)
    expect(sockets[0]).toBe(ws)

    // Verify we can retrieve tags for the socket
    const tags = ctx.getTags(ws as unknown as WebSocket)
    expect(tags).toContain('client:tagged-client-123')
  })

  it('should clear in-flight request after response', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.mockResponses.set('fastMethod', 'result')

    broker.addMockTarget('fast-worker', targetStub)
    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:clear-test'])

    const call: CallMessage = {
      id: 'clear-call-1',
      type: 'call',
      target: 'fast-worker',
      method: 'fastMethod',
      args: [],
    }

    // Execute the call and wait for completion
    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    // Verify the in-flight request was cleared
    const inFlightRows = ctx.sql.getTable('broker_in_flight')
    expect(inFlightRows.length).toBe(0)

    // Verify response was sent
    const response = ws.getLastMessage<ReturnMessage>()
    expect(response!.type).toBe('return')
    expect(response!.value).toBe('result')
  })

  it('should clear in-flight request after error response', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.shouldError = true
    targetStub.errorMessage = 'Expected failure'

    broker.addMockTarget('error-worker', targetStub)
    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:error-clear-test'])

    const call: CallMessage = {
      id: 'error-call-1',
      type: 'call',
      target: 'error-worker',
      method: 'failMethod',
      args: [],
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    // Verify the in-flight request was cleared even after error
    const inFlightRows = ctx.sql.getTable('broker_in_flight')
    expect(inFlightRows.length).toBe(0)

    // Verify error response was sent
    const response = ws.getLastMessage<ErrorMessage>()
    expect(response!.type).toBe('error')
  })
})

// =============================================================================
// Hibernation Recovery Tests
// =============================================================================

describe('BrokerDO Hibernation: Recovery on Wake', () => {
  it('should restore in-flight requests on wake', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })

    // Manually insert a pending in-flight request as if from before hibernation
    ctx.sql.exec(
      `INSERT INTO broker_in_flight (id, client_id, target, method, args, capability, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'wake-call-1',
      'client:wake-test',
      'wake-worker',
      'wakeMethod',
      JSON.stringify(['arg1', 'arg2']),
      'cap_wake',
      Date.now()
    )

    // Simulate wake
    await broker.onStart()

    // Verify in-flight requests were restored to memory
    const inFlightMap = broker.getInFlightRequests()
    expect(inFlightMap.size).toBe(1)
    expect(inFlightMap.has('wake-call-1')).toBe(true)

    const request = inFlightMap.get('wake-call-1')!
    expect(request.clientId).toBe('client:wake-test')
    expect(request.startedAt).toBeDefined()
  })

  it('should find WebSocket by tag after hibernation', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
    const ws = new MockWebSocket()

    // Accept WebSocket with tag before hibernation
    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:hibernate-client'])

    // Simulate hibernation and wake
    ctx.simulateHibernation()
    ctx.simulateWake([ws as unknown as WebSocket])

    await broker.onStart()

    // Should be able to find the WebSocket by client tag
    const foundWs = broker.getWebSocketForClient('client:hibernate-client')
    expect(foundWs).toBe(ws)
  })

  it('should timeout stale in-flight requests (>30s)', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })

    // Insert a stale in-flight request (started 35 seconds ago)
    const staleTime = Date.now() - 35000
    ctx.sql.exec(
      `INSERT INTO broker_in_flight (id, client_id, target, method, args, capability, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'stale-call-1',
      'client:stale-test',
      'stale-worker',
      'staleMethod',
      '[]',
      null,
      staleTime
    )

    // Insert a fresh in-flight request (started 5 seconds ago)
    const freshTime = Date.now() - 5000
    ctx.sql.exec(
      `INSERT INTO broker_in_flight (id, client_id, target, method, args, capability, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'fresh-call-1',
      'client:fresh-test',
      'fresh-worker',
      'freshMethod',
      '[]',
      null,
      freshTime
    )

    // Simulate wake
    await broker.onStart()

    // Stale request should be cleaned up
    const inFlightRows = ctx.sql.getTable('broker_in_flight')
    expect(inFlightRows.length).toBe(1)
    expect((inFlightRows[0] as Record<string, unknown>).id).toBe('fresh-call-1')

    // Only fresh request should be in memory
    const inFlightMap = broker.getInFlightRequests()
    expect(inFlightMap.size).toBe(1)
    expect(inFlightMap.has('fresh-call-1')).toBe(true)
    expect(inFlightMap.has('stale-call-1')).toBe(false)
  })

  it('should handle wake with no pending requests', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })

    // No in-flight requests in SQLite

    // Simulate wake - should not throw
    await expect(broker.onStart()).resolves.not.toThrow()

    // In-flight map should be empty
    const inFlightMap = broker.getInFlightRequests()
    expect(inFlightMap.size).toBe(0)
  })
})

// =============================================================================
// In-Flight Tracking Memory Tests
// =============================================================================

describe('BrokerDO Hibernation: Memory Management', () => {
  it('should not leak memory in in-flight tracking', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()

    broker.addMockTarget('memory-worker', targetStub)
    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:memory-test'])

    // Send many requests
    const requests: Promise<void>[] = []
    for (let i = 0; i < 100; i++) {
      const call: CallMessage = {
        id: `mem-call-${i}`,
        type: 'call',
        target: 'memory-worker',
        method: 'testMethod',
        args: [],
      }
      requests.push(broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call)))
    }

    // Wait for all to complete
    await Promise.all(requests)

    // All in-flight requests should be cleared
    const inFlightRows = ctx.sql.getTable('broker_in_flight')
    expect(inFlightRows.length).toBe(0)

    const inFlightMap = broker.getInFlightRequests()
    expect(inFlightMap.size).toBe(0)
  })

  it('should track client ID in in-flight map for response routing', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.delay = 50

    broker.addMockTarget('route-worker', targetStub)
    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:route-test'])

    const call: CallMessage = {
      id: 'route-call-1',
      type: 'call',
      target: 'route-worker',
      method: 'routeMethod',
      args: [],
    }

    // Start the call
    const callPromise = broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    // Give time for persistence
    await new Promise((r) => setTimeout(r, 10))

    // Check in-flight map includes client ID
    const inFlightMap = broker.getInFlightRequests()
    expect(inFlightMap.has('route-call-1')).toBe(true)
    expect(inFlightMap.get('route-call-1')!.clientId).toBe('client:route-test')

    await callPromise
  })
})

// =============================================================================
// SQLite Schema Tests
// =============================================================================

describe('BrokerDO Hibernation: SQLite Schema', () => {
  it('should create broker_in_flight table on initialization', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const _broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })

    // Check schema was created
    const schema = ctx.sql.getSchema()
    expect(schema.length).toBeGreaterThan(0)

    const createTableSql = schema.find((s) => s.includes('broker_in_flight'))
    expect(createTableSql).toBeDefined()
    expect(createTableSql).toContain('id TEXT PRIMARY KEY')
    expect(createTableSql).toContain('client_id TEXT NOT NULL')
    expect(createTableSql).toContain('target TEXT NOT NULL')
    expect(createTableSql).toContain('method TEXT NOT NULL')
    expect(createTableSql).toContain('args TEXT NOT NULL')
    expect(createTableSql).toContain('capability TEXT')
    expect(createTableSql).toContain('started_at INTEGER NOT NULL')
  })

  it('should persist all required fields for recovery', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.delay = 100

    broker.addMockTarget('fields-worker', targetStub)
    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:fields-test'])

    const call: CallMessage = {
      id: 'fields-call-1',
      type: 'call',
      target: 'fields-worker',
      method: 'fieldsMethod',
      args: [1, 'two', { three: 3 }],
      capability: 'cap_fields',
    }

    const callPromise = broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))
    await new Promise((r) => setTimeout(r, 10))

    const inFlightRows = ctx.sql.getTable('broker_in_flight')
    expect(inFlightRows.length).toBe(1)

    const row = inFlightRows[0] as Record<string, unknown>
    expect(row.id).toBe('fields-call-1')
    expect(row.client_id).toBe('client:fields-test')
    expect(row.target).toBe('fields-worker')
    expect(row.method).toBe('fieldsMethod')
    expect(JSON.parse(row.args as string)).toEqual([1, 'two', { three: 3 }])
    expect(row.capability).toBe('cap_fields')
    expect(typeof row.started_at).toBe('number')

    await callPromise
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('BrokerDO Hibernation: Edge Cases', () => {
  it('should handle recovery when WebSocket is disconnected', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })

    // Insert an in-flight request for a client that is no longer connected
    ctx.sql.exec(
      `INSERT INTO broker_in_flight (id, client_id, target, method, args, capability, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'orphan-call-1',
      'client:disconnected',
      'orphan-worker',
      'orphanMethod',
      '[]',
      null,
      Date.now()
    )

    // Simulate wake with no WebSockets
    await broker.onStart()

    // Should attempt to find WebSocket and gracefully handle missing client
    const foundWs = broker.getWebSocketForClient('client:disconnected')
    expect(foundWs).toBeUndefined()

    // The in-flight request should still be tracked (for potential reconnection)
    const inFlightMap = broker.getInFlightRequests()
    expect(inFlightMap.has('orphan-call-1')).toBe(true)
  })

  it('should handle concurrent calls to same target', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.delay = 50

    broker.addMockTarget('concurrent-worker', targetStub)
    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:concurrent-test'])

    const calls: CallMessage[] = [
      { id: 'concurrent-1', type: 'call', target: 'concurrent-worker', method: 'm1', args: [] },
      { id: 'concurrent-2', type: 'call', target: 'concurrent-worker', method: 'm2', args: [] },
      { id: 'concurrent-3', type: 'call', target: 'concurrent-worker', method: 'm3', args: [] },
    ]

    // Send all calls concurrently
    const promises = calls.map((call) =>
      broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))
    )

    // Give time for persistence
    await new Promise((r) => setTimeout(r, 10))

    // All should be in-flight
    const inFlightRows = ctx.sql.getTable('broker_in_flight')
    expect(inFlightRows.length).toBe(3)

    // Wait for all to complete
    await Promise.all(promises)

    // All should be cleared
    const finalRows = ctx.sql.getTable('broker_in_flight')
    expect(finalRows.length).toBe(0)
  })

  it('should handle null capability correctly', async () => {
    const ctx = new MockDurableObjectStateWithSql()
    const broker = new BrokerDO(ctx, {}, { enableHibernationRecovery: true })
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.delay = 50

    broker.addMockTarget('null-cap-worker', targetStub)
    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:null-cap-test'])

    const call: CallMessage = {
      id: 'null-cap-call',
      type: 'call',
      target: 'null-cap-worker',
      method: 'noCapMethod',
      args: [],
      // No capability field
    }

    const callPromise = broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))
    await new Promise((r) => setTimeout(r, 10))

    const inFlightRows = ctx.sql.getTable('broker_in_flight')
    expect(inFlightRows.length).toBe(1)

    const row = inFlightRows[0] as Record<string, unknown>
    expect(row.capability).toBeNull()

    await callPromise
  })
})
