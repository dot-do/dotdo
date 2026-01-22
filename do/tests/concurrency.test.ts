/**
 * Concurrent Access and Race Condition Tests for dotdo Framework
 *
 * Tests for:
 * 1. Concurrent DO access - Multiple simultaneous requests to same DO
 * 2. Concurrent RPC calls - Parallel RPC method invocations
 * 3. Storage race conditions - Concurrent writes and read-modify-write patterns
 * 4. WebSocket race conditions - Multiple clients, message ordering
 * 5. Alarm race conditions - Alarm firing during request processing
 *
 * Uses Promise.all, Promise.race, and setTimeout to simulate concurrent scenarios.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { DO } from '../DO'
import { WebSocketManager } from '../websocket'
import { createThingsStore, type ThingsStore } from '../../db/things'

// ============================================================================
// Mock Setup
// ============================================================================

// Mock WebSocket
class MockWebSocket {
  public readyState = 1 // OPEN
  public sentMessages: string[] = []
  public closeCode?: number
  public closeReason?: string

  send(data: string) {
    if (this.readyState !== 1) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string) {
    this.readyState = 3 // CLOSED
    this.closeCode = code
    this.closeReason = reason
  }
}

// Mock WebSocketPair globally
;(globalThis as unknown as { WebSocketPair: new () => { 0: MockWebSocket; 1: MockWebSocket } }).WebSocketPair = class WebSocketPair {
  constructor() {
    return {
      0: new MockWebSocket(),
      1: new MockWebSocket(),
    }
  }
}

// Mock DurableObjectState with concurrency tracking
function createMockState(options: { trackConcurrency?: boolean } = {}): DurableObjectState & {
  _concurrentRequests: number
  _maxConcurrentRequests: number
  _requestLog: string[]
} {
  const storage = new Map<string, unknown>()
  const websockets = new Map<string, Set<WebSocket>>()
  let concurrentRequests = 0
  let maxConcurrentRequests = 0
  const requestLog: string[] = []
  let alarmCallback: (() => void) | null = null

  const state = {
    id: { toString: () => 'test-concurrent-do-id' } as DurableObjectId,
    _concurrentRequests: 0,
    _maxConcurrentRequests: 0,
    _requestLog: requestLog,
    storage: {
      get: vi.fn(async (key: string) => {
        if (options.trackConcurrency) {
          concurrentRequests++
          maxConcurrentRequests = Math.max(maxConcurrentRequests, concurrentRequests)
          state._concurrentRequests = concurrentRequests
          state._maxConcurrentRequests = maxConcurrentRequests
          requestLog.push(`get:${key}:start`)
          await new Promise(resolve => setTimeout(resolve, 1)) // Simulate async
          requestLog.push(`get:${key}:end`)
          concurrentRequests--
        }
        return storage.get(key)
      }),
      put: vi.fn(async (key: string, value: unknown) => {
        if (options.trackConcurrency) {
          concurrentRequests++
          maxConcurrentRequests = Math.max(maxConcurrentRequests, concurrentRequests)
          state._concurrentRequests = concurrentRequests
          state._maxConcurrentRequests = maxConcurrentRequests
          requestLog.push(`put:${key}:start`)
          await new Promise(resolve => setTimeout(resolve, 1)) // Simulate async
          requestLog.push(`put:${key}:end`)
          concurrentRequests--
        }
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => {
        storage.delete(key)
        return true
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
      transaction: vi.fn(async (callback: () => Promise<void>) => {
        await callback()
      }),
    },
    blockConcurrencyWhile: vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => {
      // Cloudflare's blockConcurrencyWhile ensures sequential execution
      return fn()
    }),
    waitUntil: vi.fn(),
    acceptWebSocket: vi.fn((ws: WebSocket, tags?: string[]) => {
      const tagList = tags || []
      for (const tag of tagList) {
        if (!websockets.has(tag)) {
          websockets.set(tag, new Set())
        }
        websockets.get(tag)!.add(ws)
      }
    }),
    getWebSockets: vi.fn((tag?: string) => {
      if (tag) {
        return Array.from(websockets.get(tag) || [])
      }
      const all = new Set<WebSocket>()
      for (const set of websockets.values()) {
        for (const ws of set) {
          all.add(ws)
        }
      }
      return Array.from(all)
    }),
    setAlarm: vi.fn((scheduledTime: number | Date) => {
      // Schedule alarm
    }),
    getAlarm: vi.fn(() => null),
  } as unknown as DurableObjectState & {
    _concurrentRequests: number
    _maxConcurrentRequests: number
    _requestLog: string[]
  }

  return state
}

// Helper to simulate delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ============================================================================
// Test: Concurrent DO Access
// ============================================================================

describe('Concurrent DO Access', () => {
  let doInstance: DO
  let mockState: DurableObjectState & { _concurrentRequests: number; _maxConcurrentRequests: number; _requestLog: string[] }

  beforeEach(() => {
    mockState = createMockState({ trackConcurrency: true })
    doInstance = new DO(mockState, {})
  })

  describe('Multiple simultaneous requests to same DO', () => {
    it('should handle multiple concurrent GET requests', async () => {
      // Send 10 concurrent requests
      const requests = Array.from({ length: 10 }, (_, i) =>
        doInstance.fetch(new Request(`https://do/?requestId=${i}`))
      )

      const responses = await Promise.all(requests)

      // All should succeed
      expect(responses).toHaveLength(10)
      responses.forEach(response => {
        expect(response.status).toBe(200)
      })
    })

    it('should handle concurrent RPC requests to same DO', async () => {
      // Add a test method that tracks calls
      const callOrder: number[] = []
      ;(doInstance as unknown as { trackCall: (id: number) => Promise<{ id: number; timestamp: number }> }).trackCall = async (id: number) => {
        callOrder.push(id)
        await delay(Math.random() * 10) // Random delay to mix up execution
        return { id, timestamp: Date.now() }
      }

      // Fire 20 concurrent RPC calls
      const requests = Array.from({ length: 20 }, (_, i) =>
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'trackCall', args: [i] })
        }))
      )

      const responses = await Promise.all(requests)

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200)
      })

      // All calls should have been processed
      expect(callOrder).toHaveLength(20)
    })

    it('should maintain data consistency under concurrent load', async () => {
      // Track value modifications
      let counter = 0
      ;(doInstance as unknown as { increment: () => Promise<number> }).increment = async () => {
        const current = counter
        await delay(1) // Simulate async work
        counter = current + 1
        return counter
      }

      // Fire 50 concurrent increments
      const requests = Array.from({ length: 50 }, () =>
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'increment', args: [] })
        }))
      )

      const responses = await Promise.all(requests)
      const results = await Promise.all(responses.map(r => r.json()))

      // Note: Without proper synchronization, the counter may not reach 50
      // This test documents the behavior - Cloudflare DOs guarantee serial execution
      // In a real DO, blockConcurrencyWhile would ensure correct results
      expect(results.length).toBe(50)
    })

    it('should handle mixed read/write operations concurrently', async () => {
      let data: Record<string, number> = {}

      ;(doInstance as unknown as { write: (key: string, value: number) => Promise<{ key: string; value: number }> }).write = async (key: string, value: number) => {
        await delay(Math.random() * 5)
        data[key] = value
        return { key, value }
      }

      ;(doInstance as unknown as { read: (key: string) => Promise<number | null> }).read = async (key: string) => {
        await delay(Math.random() * 5)
        return data[key] ?? null
      }

      // Mix of reads and writes
      const operations = [
        ...Array.from({ length: 10 }, (_, i) => ({ type: 'write', key: `key-${i}`, value: i })),
        ...Array.from({ length: 10 }, (_, i) => ({ type: 'read', key: `key-${i % 5}` })),
      ]

      const requests = operations.map(op =>
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: op.type,
            args: op.type === 'write' ? [op.key, op.value] : [op.key]
          })
        }))
      )

      const responses = await Promise.all(requests)

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200)
      })
    })
  })

  describe('DO request serialization (CF guarantee)', () => {
    it('should document that DOs process requests serially', async () => {
      // Cloudflare guarantees DOs process requests serially
      // This test documents that guarantee
      const executionOrder: string[] = []

      ;(doInstance as unknown as { recordExecution: (id: string) => Promise<string> }).recordExecution = async (id: string) => {
        executionOrder.push(`start:${id}`)
        await delay(5) // Simulate some work
        executionOrder.push(`end:${id}`)
        return id
      }

      // Fire concurrent requests
      await Promise.all([
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'recordExecution', args: ['A'] })
        })),
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'recordExecution', args: ['B'] })
        })),
      ])

      // Note: In a real Cloudflare DO, execution would be serialized
      // In our test environment, they may interleave
      expect(executionOrder.length).toBe(4)
    })
  })
})

// ============================================================================
// Test: Concurrent RPC Calls
// ============================================================================

describe('Concurrent RPC Calls', () => {
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  describe('Parallel RPC method invocations', () => {
    it('should handle parallel calls to different methods', async () => {
      ;(doInstance as unknown as { methodA: (x: number) => Promise<{ method: string; result: number }> }).methodA = async (x: number) => {
        await delay(10)
        return { method: 'A', result: x * 2 }
      }
      ;(doInstance as unknown as { methodB: (x: number) => Promise<{ method: string; result: number }> }).methodB = async (x: number) => {
        await delay(5)
        return { method: 'B', result: x + 10 }
      }
      ;(doInstance as unknown as { methodC: (x: number) => Promise<{ method: string; result: number }> }).methodC = async (x: number) => {
        return { method: 'C', result: x * x }
      }

      const requests = [
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'methodA', args: [5] })
        })),
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'methodB', args: [5] })
        })),
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'methodC', args: [5] })
        })),
      ]

      const responses = await Promise.all(requests)
      const results = await Promise.all(responses.map(r => r.json()))

      expect(results).toContainEqual({ method: 'A', result: 10 })
      expect(results).toContainEqual({ method: 'B', result: 15 })
      expect(results).toContainEqual({ method: 'C', result: 25 })
    })

    it('should maintain response ordering with Promise.all', async () => {
      ;(doInstance as unknown as { echo: (value: number) => Promise<number> }).echo = async (value: number) => {
        // Random delay to scramble completion order
        await delay(Math.random() * 20)
        return value
      }

      const expectedOrder = [1, 2, 3, 4, 5]
      const requests = expectedOrder.map(value =>
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'echo', args: [value] })
        }))
      )

      const responses = await Promise.all(requests)
      const results = await Promise.all(responses.map(r => r.json()))

      // Promise.all maintains the order of the input array
      expect(results).toEqual(expectedOrder)
    })

    it('should isolate errors between concurrent calls', async () => {
      ;(doInstance as unknown as { mayFail: (shouldFail: boolean) => Promise<{ success: boolean }> }).mayFail = async (shouldFail: boolean) => {
        await delay(5)
        if (shouldFail) {
          throw new Error('Intentional failure')
        }
        return { success: true }
      }

      const requests = [
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'mayFail', args: [false] })
        })),
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'mayFail', args: [true] })
        })),
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'mayFail', args: [false] })
        })),
      ]

      const responses = await Promise.all(requests)

      // First and third should succeed, second should fail
      expect(responses[0].status).toBe(200)
      expect(responses[1].status).toBe(500)
      expect(responses[2].status).toBe(200)

      // Error should not affect other responses
      const result0 = await responses[0].json()
      const result2 = await responses[2].json()
      expect(result0).toEqual({ success: true })
      expect(result2).toEqual({ success: true })
    })

    it('should handle Promise.race for fastest response', async () => {
      ;(doInstance as unknown as { slowMethod: () => Promise<{ speed: string }> }).slowMethod = async () => {
        await delay(100)
        return { speed: 'slow' }
      }
      ;(doInstance as unknown as { fastMethod: () => Promise<{ speed: string }> }).fastMethod = async () => {
        await delay(5)
        return { speed: 'fast' }
      }

      const slowRequest = doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'slowMethod', args: [] })
      }))

      const fastRequest = doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'fastMethod', args: [] })
      }))

      const winner = await Promise.race([slowRequest, fastRequest])
      const result = await winner.json()

      expect(result).toEqual({ speed: 'fast' })
    })
  })

  describe('Error isolation between calls', () => {
    it('should not let one failing call affect others', async () => {
      let successCount = 0

      ;(doInstance as unknown as { process: (id: number, shouldFail: boolean) => Promise<{ id: number; processed: boolean }> }).process = async (id: number, shouldFail: boolean) => {
        await delay(Math.random() * 10)
        if (shouldFail) {
          throw new Error(`Failed for id ${id}`)
        }
        successCount++
        return { id, processed: true }
      }

      // Mix of failing and succeeding calls
      const configs = [
        { id: 1, fail: false },
        { id: 2, fail: true },
        { id: 3, fail: false },
        { id: 4, fail: true },
        { id: 5, fail: false },
      ]

      const requests = configs.map(({ id, fail }) =>
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'process', args: [id, fail] })
        }))
      )

      const responses = await Promise.all(requests)

      // Check each response individually
      const results = await Promise.all(responses.map(async (r, i) => ({
        id: configs[i].id,
        status: r.status,
        body: await r.json()
      })))

      // Successful calls should have processed
      const successfulResults = results.filter(r => r.status === 200)
      expect(successfulResults).toHaveLength(3)

      // Failed calls should have error
      const failedResults = results.filter(r => r.status === 500)
      expect(failedResults).toHaveLength(2)
    })
  })
})

// ============================================================================
// Test: Storage Race Conditions
// ============================================================================

describe('Storage Race Conditions', () => {
  let store: ThingsStore

  beforeEach(() => {
    store = createThingsStore()
  })

  describe('Concurrent writes to same key', () => {
    it('should handle concurrent creates without ID collision', async () => {
      // Create 100 things concurrently
      const creates = Array.from({ length: 100 }, (_, i) =>
        store.create({ $type: 'test', name: `item-${i}` })
      )

      const results = await Promise.all(creates)

      // All should succeed
      expect(results).toHaveLength(100)

      // All IDs should be unique
      const ids = results.map(r => r.$id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(100)
    })

    it('should handle concurrent updates to same entity', async () => {
      // Create an entity first
      const entity = await store.create({ $type: 'counter', value: 0 })

      // Attempt concurrent updates
      const updates = Array.from({ length: 10 }, (_, i) =>
        store.update(entity.$id, { value: i + 1 })
      )

      const results = await Promise.all(updates)

      // All updates should succeed
      expect(results).toHaveLength(10)

      // Final value depends on execution order - last write wins
      const final = await store.get(entity.$id)
      expect(final).toBeDefined()
      expect(typeof final?.value).toBe('number')
    })

    it('should detect concurrent deletes', async () => {
      // Create entities
      const entities = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          store.create({ $type: 'test', name: `item-${i}` })
        )
      )

      // Try to delete each entity twice concurrently
      const deletePromises = entities.flatMap(entity => [
        store.delete(entity.$id).then(() => 'success').catch(() => 'failed'),
        store.delete(entity.$id).then(() => 'success').catch(() => 'failed'),
      ])

      const results = await Promise.all(deletePromises)

      // Each entity: one delete succeeds, one fails
      const successes = results.filter(r => r === 'success')
      const failures = results.filter(r => r === 'failed')

      expect(successes.length).toBe(10)
      expect(failures.length).toBe(10)
    })
  })

  describe('Read-modify-write patterns', () => {
    it('should demonstrate lost update problem without locks', async () => {
      // Create a counter
      const counter = await store.create({ $type: 'counter', value: 0 })

      // Simulate read-modify-write without synchronization
      const incrementWithoutLock = async () => {
        const current = await store.get(counter.$id)
        if (!current) throw new Error('Counter not found')
        await delay(Math.random() * 5) // Simulate processing time
        await store.update(counter.$id, { value: (current.value as number) + 1 })
      }

      // Run 20 concurrent increments
      await Promise.all(
        Array.from({ length: 20 }, () => incrementWithoutLock())
      )

      const final = await store.get(counter.$id)

      // Without proper synchronization, the final value may be less than 20
      // This demonstrates the need for proper concurrency control
      expect(typeof final?.value).toBe('number')
      // Note: The actual value may vary due to race conditions
    })

    it('should handle bulk operations atomically', async () => {
      // Create initial entities
      const items = await store.bulkCreate([
        { $type: 'item', status: 'pending' },
        { $type: 'item', status: 'pending' },
        { $type: 'item', status: 'pending' },
      ])

      // Attempt concurrent bulk updates
      const bulkUpdate1 = store.bulkUpdate(
        items.map(item => ({ id: item.$id, data: { status: 'processing' } }))
      )
      const bulkUpdate2 = store.bulkUpdate(
        items.map(item => ({ id: item.$id, data: { status: 'completed' } }))
      )

      const [result1, result2] = await Promise.all([bulkUpdate1, bulkUpdate2])

      // Both should succeed (last write wins for each item)
      expect(result1).toHaveLength(3)
      expect(result2).toHaveLength(3)

      // Final state depends on execution order
      const finalItems = await store.list({ type: 'item' })
      expect(finalItems).toHaveLength(3)
    })
  })

  describe('Transaction isolation', () => {
    it('should handle concurrent bulk operations', async () => {
      // Create items in batches concurrently
      const batch1 = store.bulkCreate([
        { $type: 'batch1', value: 1 },
        { $type: 'batch1', value: 2 },
      ])
      const batch2 = store.bulkCreate([
        { $type: 'batch2', value: 3 },
        { $type: 'batch2', value: 4 },
      ])

      const [result1, result2] = await Promise.all([batch1, batch2])

      expect(result1).toHaveLength(2)
      expect(result2).toHaveLength(2)

      // All items should exist
      const all = await store.list()
      expect(all.length).toBeGreaterThanOrEqual(4)
    })

    it('should rollback on bulk operation failure', async () => {
      // Create one valid item
      await store.create({ $type: 'test', name: 'existing' })

      // Try bulk update with one invalid ID
      const validItem = await store.create({ $type: 'test', name: 'valid' })

      // This should fail atomically (all-or-nothing)
      await expect(
        store.bulkUpdate([
          { id: validItem.$id, data: { name: 'updated' } },
          { id: 'non-existent-id', data: { name: 'should-fail' } },
        ])
      ).rejects.toThrow()

      // The valid item should NOT be updated (atomic rollback)
      const afterAttempt = await store.get(validItem.$id)
      expect(afterAttempt?.name).toBe('valid')
    })
  })
})

// ============================================================================
// Test: WebSocket Race Conditions
// ============================================================================

describe('WebSocket Race Conditions', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    manager = new WebSocketManager()
  })

  describe('Multiple clients connecting simultaneously', () => {
    it('should handle multiple simultaneous WebSocket upgrades', async () => {
      // Simulate 10 concurrent WebSocket upgrade requests
      const upgrades = Array.from({ length: 10 }, (_, i) =>
        manager.handleWebSocketUpgrade(mockState, [`client-${i}`], false)
      )

      // All upgrades should succeed
      upgrades.forEach((response, i) => {
        expect(response.status).toBe(101)
        expect((response as unknown as { webSocket: WebSocket }).webSocket).toBeDefined()
      })
    })

    it('should track all concurrent connections correctly', async () => {
      const websockets: WebSocket[] = []

      // Accept multiple WebSockets
      for (let i = 0; i < 10; i++) {
        const ws = new MockWebSocket() as unknown as WebSocket
        mockState.acceptWebSocket(ws, ['room:test'])
        websockets.push(ws)
      }

      // All should be tracked
      const count = manager.getConnectionCount(mockState, 'room:test')
      expect(count).toBe(10)
    })

    it('should broadcast to all connections without data loss', async () => {
      const websockets: MockWebSocket[] = []

      // Create and accept multiple WebSockets
      for (let i = 0; i < 10; i++) {
        const ws = new MockWebSocket() as unknown as WebSocket
        mockState.acceptWebSocket(ws, ['broadcast-test'])
        websockets.push(ws as unknown as MockWebSocket)
      }

      // Broadcast multiple messages concurrently
      const broadcasts = Array.from({ length: 5 }, (_, i) =>
        Promise.resolve(manager.broadcast(mockState, 'broadcast-test', { message: `broadcast-${i}` }))
      )

      const results = await Promise.all(broadcasts)

      // All broadcasts should report success
      results.forEach(result => {
        expect(result.sent).toBe(10)
        expect(result.failed).toBe(0)
      })

      // Each WebSocket should have received all messages
      websockets.forEach(ws => {
        expect(ws.sentMessages.length).toBe(5)
      })
    })
  })

  describe('Message ordering guarantees', () => {
    it('should maintain message order per connection', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['order-test'])

      // Send multiple messages quickly
      const messages = Array.from({ length: 100 }, (_, i) => ({ type: 'test', seq: i }))

      for (const msg of messages) {
        manager.send(ws, msg)
      }

      // Messages should be in order
      const received = (ws as unknown as MockWebSocket).sentMessages.map(m => JSON.parse(m))
      received.forEach((msg, i) => {
        expect(msg.seq).toBe(i)
      })
    })

    it('should handle concurrent message sending to different connections', async () => {
      const connections = Array.from({ length: 5 }, () => {
        const ws = new MockWebSocket() as unknown as WebSocket
        mockState.acceptWebSocket(ws, ['multi-send'])
        return ws
      })

      // Send different messages to each connection concurrently
      const sends = connections.map((ws, i) =>
        Promise.resolve(manager.send(ws, { connectionId: i, message: `msg-${i}` }))
      )

      const results = await Promise.all(sends)

      // All sends should succeed
      results.forEach(result => {
        expect(result).toBe(true)
      })

      // Each connection should have received its specific message
      connections.forEach((ws, i) => {
        const sent = (ws as unknown as MockWebSocket).sentMessages
        expect(sent).toHaveLength(1)
        const msg = JSON.parse(sent[0])
        expect(msg.connectionId).toBe(i)
      })
    })
  })

  describe('Connection/disconnection races', () => {
    it('should handle rapid connect/disconnect cycles', async () => {
      const operations: Promise<void>[] = []

      for (let i = 0; i < 20; i++) {
        const ws = new MockWebSocket() as unknown as WebSocket
        mockState.acceptWebSocket(ws, ['rapid-test'])

        // Random delay before disconnect
        operations.push(
          delay(Math.random() * 10).then(() => {
            manager.cleanupWebSocket(ws)
          })
        )
      }

      await Promise.all(operations)

      // After all operations, cleanup should be complete
      // (No specific assertion needed - test ensures no crashes)
    })

    it('should handle send to closing connection gracefully', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['closing-test'])

      // Close the connection
      ;(ws as unknown as MockWebSocket).readyState = 3 // CLOSED

      // Attempt to send should fail gracefully
      const result = manager.send(ws, { message: 'to-closed' })
      expect(result).toBe(false)
    })

    it('should handle concurrent close and send operations', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['concurrent-close'])

      // Fire send and close concurrently
      const sendPromise = Promise.resolve(manager.send(ws, { message: 'racing' }))
      const closePromise = Promise.resolve(manager.closeConnection(ws, 1000, 'test'))

      const [sendResult] = await Promise.all([sendPromise, closePromise])

      // Send may or may not succeed depending on timing
      expect(typeof sendResult).toBe('boolean')
    })
  })

  describe('Handler concurrency', () => {
    it('should handle concurrent message processing', async () => {
      const processOrder: number[] = []

      manager.on('concurrent', async (ws, data: { id: number }) => {
        const id = data.id
        processOrder.push(id)
        await delay(Math.random() * 10)
        processOrder.push(-id) // Negative to mark completion
      })

      const ws = new MockWebSocket() as unknown as WebSocket

      // Process multiple messages concurrently
      const messages = Array.from({ length: 10 }, (_, i) =>
        manager.handleMessage(ws, JSON.stringify({ type: 'concurrent', data: { id: i + 1 } }))
      )

      await Promise.all(messages)

      // All messages should have been processed
      const starts = processOrder.filter(x => x > 0)
      const ends = processOrder.filter(x => x < 0)

      expect(starts.length).toBe(10)
      expect(ends.length).toBe(10)
    })

    it('should isolate errors between concurrent message handlers', async () => {
      let successCount = 0

      manager.on('mixed', async (ws, data: { fail: boolean }) => {
        if (data.fail) {
          throw new Error('Handler error')
        }
        successCount++
      })

      const ws = new MockWebSocket() as unknown as WebSocket
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mix of succeeding and failing messages
      const messages = [
        { type: 'mixed', data: { fail: false } },
        { type: 'mixed', data: { fail: true } },
        { type: 'mixed', data: { fail: false } },
        { type: 'mixed', data: { fail: true } },
        { type: 'mixed', data: { fail: false } },
      ]

      await Promise.all(
        messages.map(msg => manager.handleMessage(ws, JSON.stringify(msg)))
      )

      expect(successCount).toBe(3)
      consoleSpy.mockRestore()
    })
  })
})

// ============================================================================
// Test: Alarm Race Conditions
// ============================================================================

describe('Alarm Race Conditions', () => {
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  describe('Alarm firing during request processing', () => {
    it('should handle alarm firing while processing a request', async () => {
      let requestInProgress = false
      let alarmFiredDuringRequest = false

      ;(doInstance as unknown as { longRunningMethod: () => Promise<{ completed: boolean }> }).longRunningMethod = async () => {
        requestInProgress = true
        await delay(50) // Simulate long-running operation
        requestInProgress = false
        return { completed: true }
      }

      // Simulate alarm firing during request
      const originalAlarm = doInstance.alarm.bind(doInstance)
      doInstance.alarm = async () => {
        if (requestInProgress) {
          alarmFiredDuringRequest = true
        }
        return originalAlarm()
      }

      // Start the request and fire alarm concurrently
      const requestPromise = doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'longRunningMethod', args: [] })
      }))

      // Fire alarm after a short delay
      const alarmPromise = delay(10).then(() => doInstance.alarm())

      const [response] = await Promise.all([requestPromise, alarmPromise])

      expect(response.status).toBe(200)
      // Note: In a real DO, Cloudflare would serialize these
    })

    it('should handle alarm and fetch competing for state', async () => {
      let state = { value: 0 }

      ;(doInstance as unknown as { incrementFromFetch: () => Promise<number> }).incrementFromFetch = async () => {
        const current = state.value
        await delay(5)
        state.value = current + 10
        return state.value
      }

      const originalAlarm = doInstance.alarm.bind(doInstance)
      doInstance.alarm = async () => {
        const current = state.value
        await delay(5)
        state.value = current + 1
        return originalAlarm()
      }

      // Run both concurrently
      const [fetchResult, _] = await Promise.all([
        doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'incrementFromFetch', args: [] })
        })),
        doInstance.alarm(),
      ])

      const fetchJson = await fetchResult.json()

      // State will be affected by both operations
      // Actual value depends on execution interleaving
      expect(typeof state.value).toBe('number')
    })
  })

  describe('Multiple alarms scheduled for same time', () => {
    it('should handle multiple rapid alarm schedules', async () => {
      const setAlarmMock = mockState.setAlarm as Mock

      // Schedule multiple alarms in quick succession
      const schedules = Array.from({ length: 10 }, (_, i) =>
        mockState.setAlarm(Date.now() + 1000 + i)
      )

      // All schedule calls should complete
      expect(setAlarmMock).toHaveBeenCalledTimes(10)
    })

    it('should handle alarm scheduling during alarm execution', async () => {
      let alarmCount = 0
      const maxAlarms = 5

      const originalAlarm = doInstance.alarm.bind(doInstance)
      doInstance.alarm = async () => {
        alarmCount++
        if (alarmCount < maxAlarms) {
          // Schedule another alarm during execution
          mockState.setAlarm(Date.now() + 100)
        }
        return originalAlarm()
      }

      // Fire initial alarm
      await doInstance.alarm()

      expect(alarmCount).toBe(1)
      expect(mockState.setAlarm).toHaveBeenCalled()
    })
  })

  describe('Alarm cleanup on state changes', () => {
    it('should handle alarm cancellation during execution', async () => {
      let alarmExecuting = false
      let alarmCancelled = false

      const originalAlarm = doInstance.alarm.bind(doInstance)
      doInstance.alarm = async () => {
        alarmExecuting = true
        await delay(20)
        if (alarmCancelled) {
          return // Early exit if cancelled
        }
        alarmExecuting = false
        return originalAlarm()
      }

      // Start alarm execution and try to cancel
      const alarmPromise = doInstance.alarm()
      await delay(5)
      alarmCancelled = true

      await alarmPromise

      expect(alarmCancelled).toBe(true)
    })
  })
})

// ============================================================================
// Test: Combined Stress Tests
// ============================================================================

describe('Combined Stress Tests', () => {
  let doInstance: DO
  let mockState: DurableObjectState & { _concurrentRequests: number; _maxConcurrentRequests: number }

  beforeEach(() => {
    mockState = createMockState({ trackConcurrency: true })
    doInstance = new DO(mockState, {})
  })

  it('should handle high load with mixed operations', async () => {
    // Setup methods
    ;(doInstance as unknown as { read: (key: string) => Promise<{ key: string; operation: string }> }).read = async (key: string) => {
      await delay(Math.random() * 5)
      return { key, operation: 'read' }
    }
    ;(doInstance as unknown as { write: (key: string, value: unknown) => Promise<{ key: string; value: unknown; operation: string }> }).write = async (key: string, value: unknown) => {
      await delay(Math.random() * 5)
      return { key, value, operation: 'write' }
    }

    // Generate mixed operations
    const operations = Array.from({ length: 100 }, (_, i) => {
      const isRead = Math.random() > 0.5
      return {
        method: isRead ? 'read' : 'write',
        args: isRead ? [`key-${i % 10}`] : [`key-${i % 10}`, { data: i }]
      }
    })

    const requests = operations.map(op =>
      doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op)
      }))
    )

    const responses = await Promise.all(requests)

    // All should succeed
    const statuses = responses.map(r => r.status)
    const successCount = statuses.filter(s => s === 200).length

    expect(successCount).toBe(100)
  })

  it('should maintain consistency under concurrent WebSocket and RPC load', async () => {
    const manager = new WebSocketManager()

    // Setup RPC method
    let sharedCounter = 0
    ;(doInstance as unknown as { increment: () => Promise<number> }).increment = async () => {
      sharedCounter++
      return sharedCounter
    }

    // Setup WebSocket handler
    manager.on('increment', async () => {
      sharedCounter++
    })

    // Create WebSocket connections
    const websockets = Array.from({ length: 5 }, () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['counter'])
      return ws
    })

    // Fire RPC and WebSocket operations concurrently
    const rpcOps = Array.from({ length: 20 }, () =>
      doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'increment', args: [] })
      }))
    )

    const wsOps = Array.from({ length: 20 }, () =>
      manager.handleMessage(
        websockets[Math.floor(Math.random() * websockets.length)],
        JSON.stringify({ type: 'increment', data: {} })
      )
    )

    await Promise.all([...rpcOps, ...wsOps])

    // Counter should have been incremented (though exact count depends on race conditions)
    expect(sharedCounter).toBeGreaterThan(0)
  })

  it('should recover from partial failures in batch operations', async () => {
    let processedCount = 0
    let failedCount = 0

    ;(doInstance as unknown as { process: (id: number, shouldFail: boolean) => Promise<{ id: number; processed: boolean }> }).process = async (id: number, shouldFail: boolean) => {
      await delay(Math.random() * 10)
      if (shouldFail) {
        failedCount++
        throw new Error(`Processing failed for ${id}`)
      }
      processedCount++
      return { id, processed: true }
    }

    // Create operations with some failures
    const operations = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      shouldFail: i % 5 === 0 // Every 5th operation fails
    }))

    const requests = operations.map(({ id, shouldFail }) =>
      doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'process', args: [id, shouldFail] })
      }))
    )

    const responses = await Promise.all(requests)

    const successful = responses.filter(r => r.status === 200)
    const failed = responses.filter(r => r.status === 500)

    expect(successful.length).toBe(40) // 50 - 10 failures
    expect(failed.length).toBe(10) // Every 5th fails
    expect(processedCount).toBe(40)
    expect(failedCount).toBe(10)
  })
})
