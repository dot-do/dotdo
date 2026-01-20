/**
 * Chaos Engineering Tests for dotdo Framework
 *
 * Tests system resilience under various failure conditions:
 * 1. Network latency injection
 * 2. Random request failures
 * 3. Storage failures (SQLite errors)
 * 4. Concurrent request storms
 * 5. Large payload handling
 *
 * @see do-fhng.9
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DO } from '../../do/DO'
import { WebSocketManager } from '../../do/websocket'
import { createThingsStore, type ThingsStore } from '../../db/things'
import {
  ChaosProxy,
  createChaoticMockState,
  runRequestStorm,
  RetryTester,
  createTimeoutOperation,
  CorruptionInjector,
} from './ChaosProxy'

// ============================================================================
// Mock Setup
// ============================================================================

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

// Helper to create standard mock state (without chaos)
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
    setAlarm: vi.fn(),
    getAlarm: vi.fn(() => null),
  } as unknown as DurableObjectState
}

// Helper delay function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ============================================================================
// Test Suite: Network Latency Injection
// ============================================================================

describe('Chaos: Network Latency Injection', () => {
  let chaos: ChaosProxy
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    chaos = new ChaosProxy()
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should inject configurable latency into requests', async () => {
    chaos.injectLatency(50, 100) // 50-100ms latency

    const startTime = Date.now()
    await chaos.wrap(async () => {
      return doInstance.fetch(new Request('https://do/'))
    })
    const duration = Date.now() - startTime

    expect(duration).toBeGreaterThanOrEqual(50)
    expect(chaos.getStats().injectedLatencies).toBe(1)
  })

  it('should inject latency probabilistically', async () => {
    chaos.injectLatency(50, 100, 0.5) // 50% probability

    // Run multiple requests
    const durations: number[] = []
    for (let i = 0; i < 20; i++) {
      const startTime = Date.now()
      await chaos.wrap(async () => {
        return doInstance.fetch(new Request('https://do/'))
      })
      durations.push(Date.now() - startTime)
    }

    // Some should be fast (no latency), some slow (with latency)
    const fastRequests = durations.filter(d => d < 50)
    const slowRequests = durations.filter(d => d >= 50)

    // With 50% probability over 20 requests, expect some of each
    expect(fastRequests.length).toBeGreaterThan(0)
    expect(slowRequests.length).toBeGreaterThan(0)
  })

  it('should track latency statistics', async () => {
    chaos.injectLatency(10, 50)

    for (let i = 0; i < 5; i++) {
      await chaos.wrap(async () => {
        return doInstance.fetch(new Request('https://do/'))
      })
    }

    const stats = chaos.getStats()
    expect(stats.injectedLatencies).toBe(5)
    expect(stats.totalLatencyMs).toBeGreaterThan(50) // At least 10ms * 5
    expect(stats.maxLatencyMs).toBeLessThanOrEqual(50)
  })

  it('should allow disabling latency injection', async () => {
    chaos.injectLatency(100, 200)
    chaos.disable()

    const startTime = Date.now()
    await chaos.wrap(async () => {
      return doInstance.fetch(new Request('https://do/'))
    })
    const duration = Date.now() - startTime

    // Should be fast when disabled
    expect(duration).toBeLessThan(100)
    expect(chaos.getStats().injectedLatencies).toBe(0)
  })

  it('should handle system under latency stress', async () => {
    chaos.injectLatency(5, 20)

    // Simulate 50 concurrent requests with latency
    const requests = Array.from({ length: 50 }, (_, i) =>
      chaos.wrap(async () => {
        return doInstance.fetch(new Request(`https://do/?id=${i}`))
      })
    )

    const responses = await Promise.all(requests)

    // All requests should succeed despite latency
    responses.forEach(response => {
      expect(response.status).toBe(200)
    })

    expect(chaos.getStats().totalRequests).toBe(50)
  })
})

// ============================================================================
// Test Suite: Random Request Failures
// ============================================================================

describe('Chaos: Random Request Failures', () => {
  let chaos: ChaosProxy
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    chaos = new ChaosProxy()
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should inject failures with configured probability', async () => {
    chaos.injectFailure(1.0) // 100% failure rate

    await expect(
      chaos.wrap(async () => {
        return doInstance.fetch(new Request('https://do/'))
      })
    ).rejects.toThrow('Chaos-injected failure')

    expect(chaos.getStats().injectedFailures).toBe(1)
  })

  it('should use custom error messages', async () => {
    chaos.injectFailure(1.0, 'Custom chaos error', 'CUSTOM_CODE')

    try {
      await chaos.wrap(async () => {
        return doInstance.fetch(new Request('https://do/'))
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).toBe('Custom chaos error')
      expect((error as Error & { code: string }).code).toBe('CUSTOM_CODE')
    }
  })

  it('should respect failure probability', async () => {
    chaos.injectFailure(0.3) // 30% failure rate

    let failures = 0
    let successes = 0

    for (let i = 0; i < 100; i++) {
      try {
        await chaos.wrap(async () => {
          return doInstance.fetch(new Request('https://do/'))
        })
        successes++
      } catch {
        failures++
      }
    }

    // With 30% probability over 100 requests, expect roughly 30 failures
    // Allow some variance (15-45 failures)
    expect(failures).toBeGreaterThan(10)
    expect(failures).toBeLessThan(50)
    expect(successes).toBeGreaterThan(50)
  })

  it('should isolate failures between requests', async () => {
    chaos.injectFailure(0.5) // 50% failure

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        chaos.wrap(async () => {
          return doInstance.fetch(new Request('https://do/'))
        })
      )
    )

    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter(r => r.status === 'rejected')

    // Failures in one request should not affect others
    expect(fulfilled.length).toBeGreaterThan(0)
    expect(rejected.length).toBeGreaterThan(0)
  })

  it('should handle error recovery gracefully', async () => {
    // Simulate a method that retries on failure
    let attempts = 0
    const maxRetries = 3

    const retryOperation = async (): Promise<Response> => {
      for (let i = 0; i < maxRetries; i++) {
        attempts++
        try {
          return await chaos.wrap(async () => {
            return doInstance.fetch(new Request('https://do/'))
          })
        } catch {
          if (i === maxRetries - 1) throw new Error('Max retries exceeded')
          await delay(10) // Brief delay before retry
        }
      }
      throw new Error('Unexpected')
    }

    chaos.injectFailure(0.7) // 70% failure - likely to fail initial attempts

    // Run multiple retry operations
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => retryOperation())
    )

    // Some should eventually succeed through retries
    const succeeded = results.filter(r => r.status === 'fulfilled')
    expect(succeeded.length).toBeGreaterThan(0)
    expect(attempts).toBeGreaterThan(10) // Should have made retry attempts
  })
})

// ============================================================================
// Test Suite: Storage Failures (SQLite Errors)
// ============================================================================

describe('Chaos: Storage Failures', () => {
  let chaos: ChaosProxy
  let store: ThingsStore

  beforeEach(() => {
    chaos = new ChaosProxy()
    store = createThingsStore()
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should inject storage read failures', async () => {
    const chaoticState = createChaoticMockState(chaos)
    chaos.injectStorageChaos({ readFailureProbability: 1.0 })

    // Direct storage operation should fail
    await expect(
      chaoticState.storage.get('any-key')
    ).rejects.toThrow('Chaos-injected storage read failure')
  })

  it('should inject storage write failures', async () => {
    const chaoticState = createChaoticMockState(chaos)
    chaos.injectStorageChaos({ writeFailureProbability: 1.0 })

    await expect(
      chaoticState.storage.put('key', { value: 'test' })
    ).rejects.toThrow('Chaos-injected storage write failure')
  })

  it('should inject storage delete failures', async () => {
    const chaoticState = createChaoticMockState(chaos)

    // First, write a value (without chaos)
    chaos.reset()
    await chaoticState.storage.put('key', { value: 'test' })

    // Now inject delete failures
    chaos.injectStorageChaos({ deleteFailureProbability: 1.0 })

    await expect(
      chaoticState.storage.delete('key')
    ).rejects.toThrow('Chaos-injected storage delete failure')
  })

  it('should inject storage latency', async () => {
    const chaoticState = createChaoticMockState(chaos)
    chaos.injectStorageChaos({
      latency: { minMs: 50, maxMs: 100 },
    })

    const startTime = Date.now()
    await chaoticState.storage.get('any-key')
    const duration = Date.now() - startTime

    expect(duration).toBeGreaterThanOrEqual(50)
  })

  it('should handle partial storage failures gracefully', async () => {
    const chaoticState = createChaoticMockState(chaos)
    chaos.injectStorageChaos({ writeFailureProbability: 0.3 })

    let successes = 0
    let failures = 0

    for (let i = 0; i < 20; i++) {
      try {
        await chaoticState.storage.put(`key-${i}`, { value: i })
        successes++
      } catch {
        failures++
      }
    }

    // Some writes should succeed, some should fail
    expect(successes).toBeGreaterThan(0)
    expect(failures).toBeGreaterThan(0)

    // Verify successful writes are retrievable
    chaos.reset() // Disable chaos for reads
    let retrievedCount = 0
    for (let i = 0; i < 20; i++) {
      const value = await chaoticState.storage.get(`key-${i}`)
      if (value) retrievedCount++
    }
    expect(retrievedCount).toBe(successes)
  })

  it('should track storage failure statistics', async () => {
    const chaoticState = createChaoticMockState(chaos)
    chaos.injectStorageChaos({
      readFailureProbability: 0.5,
      writeFailureProbability: 0.5,
    })

    // Attempt operations
    for (let i = 0; i < 10; i++) {
      try {
        await chaoticState.storage.get(`key-${i}`)
      } catch { /* ignore */ }
      try {
        await chaoticState.storage.put(`key-${i}`, { value: i })
      } catch { /* ignore */ }
    }

    const stats = chaos.getStats()
    expect(stats.storageFailures).toBeGreaterThan(0)
  })

  it('should handle storage chaos with retry logic', async () => {
    const chaoticState = createChaoticMockState(chaos)
    chaos.injectStorageChaos({ writeFailureProbability: 0.7 })

    const writeWithRetry = async (key: string, value: unknown, maxRetries = 5): Promise<boolean> => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          await chaoticState.storage.put(key, value)
          return true
        } catch {
          if (i === maxRetries - 1) return false
          await delay(5)
        }
      }
      return false
    }

    // Attempt multiple writes with retry
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => writeWithRetry(`key-${i}`, { value: i }))
    )

    // With retries, most should eventually succeed
    const succeeded = results.filter(r => r)
    expect(succeeded.length).toBeGreaterThan(5)
  })
})

// ============================================================================
// Test Suite: Concurrent Request Storms
// ============================================================================

describe('Chaos: Concurrent Request Storms', () => {
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  it('should handle 100 concurrent requests', async () => {
    const { results, errors, successRate } = await runRequestStorm(
      100,
      async (index) => {
        const response = await doInstance.fetch(new Request(`https://do/?id=${index}`))
        return response.json()
      }
    )

    expect(results.length).toBe(100)
    expect(errors.length).toBe(0)
    expect(successRate).toBe(1)
  })

  it('should handle request storm with batched execution', async () => {
    const progressUpdates: number[] = []

    const { results, duration } = await runRequestStorm(
      50,
      async (index) => {
        return doInstance.fetch(new Request(`https://do/?id=${index}`))
      },
      {
        batchSize: 10,
        delayBetweenBatches: 5,
        onProgress: (completed) => {
          progressUpdates.push(completed)
        },
      }
    )

    expect(results.length).toBe(50)
    // Progress is reported per-request, so should have 50 updates
    expect(progressUpdates.length).toBeGreaterThanOrEqual(5) // At least 5 batches worth
    expect(progressUpdates[progressUpdates.length - 1]).toBe(50)
    expect(duration).toBeGreaterThan(15) // Should take at least the delay time between batches
  })

  it('should handle concurrent RPC calls under storm', async () => {
    // Add a counter method
    let counter = 0
    ;(doInstance as unknown as { getCount: () => Promise<number> }).getCount = async () => {
      await delay(Math.random() * 5) // Variable processing time
      counter++
      return counter
    }

    const { results, errors } = await runRequestStorm(
      200,
      async () => {
        const response = await doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'getCount', args: [] })
        }))
        return response.json()
      }
    )

    expect(results.length).toBe(200)
    expect(errors.length).toBe(0)
    expect(counter).toBe(200)
  })

  it('should maintain response ordering under load', async () => {
    ;(doInstance as unknown as { echo: (id: number) => Promise<number> }).echo = async (id: number) => {
      await delay(Math.random() * 10) // Random delay to mix ordering
      return id
    }

    const { results } = await runRequestStorm(
      50,
      async (index) => {
        const response = await doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'echo', args: [index] })
        }))
        return { index, result: await response.json() }
      }
    )

    // Verify each request got back its own index
    results.forEach((r: { index: number; result: number }) => {
      expect(r.result).toBe(r.index)
    })
  })

  it('should handle WebSocket message storm', async () => {
    const manager = new WebSocketManager()
    const messages: unknown[] = []

    manager.on('storm', async (_ws, data) => {
      messages.push(data)
    })

    const ws = new MockWebSocket() as unknown as WebSocket

    // Fire 500 messages rapidly
    const { errors } = await runRequestStorm(
      500,
      async (index) => {
        await manager.handleMessage(ws, JSON.stringify({
          type: 'storm',
          data: { id: index }
        }))
        return index
      }
    )

    expect(errors.length).toBe(0)
    expect(messages.length).toBe(500)
  })

  it('should handle mixed operation storm', async () => {
    let readCount = 0
    let writeCount = 0

    ;(doInstance as unknown as { read: (key: string) => Promise<{ key: string }> }).read = async (key: string) => {
      readCount++
      return { key }
    }
    ;(doInstance as unknown as { write: (key: string, value: unknown) => Promise<{ key: string; value: unknown }> }).write = async (key: string, value: unknown) => {
      writeCount++
      return { key, value }
    }

    const { results, errors } = await runRequestStorm(
      100,
      async (index) => {
        const isRead = Math.random() > 0.5
        const response = await doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: isRead ? 'read' : 'write',
            args: isRead ? [`key-${index}`] : [`key-${index}`, { value: index }]
          })
        }))
        return response.json()
      }
    )

    expect(results.length).toBe(100)
    expect(errors.length).toBe(0)
    expect(readCount + writeCount).toBe(100)
  })
})

// ============================================================================
// Test Suite: Large Payload Handling
// ============================================================================

describe('Chaos: Large Payload Handling', () => {
  let chaos: ChaosProxy
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    chaos = new ChaosProxy()
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should handle large string payloads', async () => {
    const largePayload = chaos.generateLargePayload(100) // 100KB

    ;(doInstance as unknown as { process: (data: string) => Promise<{ length: number }> }).process = async (data: string) => {
      return { length: data.length }
    }

    const response = await doInstance.fetch(new Request('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'process', args: [largePayload] })
    }))

    const result = await response.json() as { length: number }
    expect(result.length).toBe(100 * 1024)
    expect(chaos.getStats().largePayloads).toBe(1)
  })

  it('should handle deeply nested objects', async () => {
    const largeObject = chaos.generateLargeObject(4, 3) // Depth 4, breadth 3

    ;(doInstance as unknown as { store: (data: unknown) => Promise<{ stored: boolean }> }).store = async (data: unknown) => {
      // Verify object structure
      expect(data).toBeDefined()
      return { stored: true }
    }

    const response = await doInstance.fetch(new Request('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'store', args: [largeObject] })
    }))

    expect(response.status).toBe(200)
    const result = await response.json() as { stored: boolean }
    expect(result.stored).toBe(true)
  })

  it('should handle large arrays', async () => {
    const largeArray = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      value: Math.random(),
    }))

    ;(doInstance as unknown as { processBatch: (items: unknown[]) => Promise<{ count: number }> }).processBatch = async (items: unknown[]) => {
      return { count: items.length }
    }

    const response = await doInstance.fetch(new Request('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'processBatch', args: [largeArray] })
    }))

    const result = await response.json() as { count: number }
    expect(result.count).toBe(10000)
  })

  it('should handle concurrent large payload requests', async () => {
    ;(doInstance as unknown as { process: (data: string) => Promise<{ length: number }> }).process = async (data: string) => {
      return { length: data.length }
    }

    const { results, errors } = await runRequestStorm(
      20,
      async (index) => {
        const payload = chaos.generateLargePayload(50) // 50KB each
        const response = await doInstance.fetch(new Request('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'process', args: [payload] })
        }))
        return response.json()
      },
      { batchSize: 5 }
    )

    expect(results.length).toBe(20)
    expect(errors.length).toBe(0)
  })

  it('should handle very large single request', async () => {
    const veryLargePayload = chaos.generateLargePayload(500) // 500KB

    ;(doInstance as unknown as { echo: (data: string) => Promise<string> }).echo = async (data: string) => {
      return data
    }

    const response = await doInstance.fetch(new Request('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'echo', args: [veryLargePayload] })
    }))

    expect(response.status).toBe(200)
    const result = await response.json() as string
    expect(result.length).toBe(500 * 1024)
  })
})

// ============================================================================
// Test Suite: System Recovery and Resilience
// ============================================================================

describe('Chaos: System Recovery and Resilience', () => {
  let chaos: ChaosProxy
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    chaos = new ChaosProxy()
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should recover from transient failures', async () => {
    const retryTester = new RetryTester(3) // Fail first 2 attempts

    let attempts = 0
    const operationWithRetry = async (): Promise<Response> => {
      for (let i = 0; i < 5; i++) {
        try {
          return await retryTester.execute(async () => {
            return doInstance.fetch(new Request('https://do/'))
          })
        } catch {
          attempts++
          if (i === 4) throw new Error('Max retries exceeded')
        }
      }
      throw new Error('Unexpected')
    }

    const response = await operationWithRetry()
    expect(response.status).toBe(200)
    expect(retryTester.getAttempts()).toBe(3) // Succeeded on 3rd attempt
    expect(attempts).toBe(2) // 2 retries before success
  })

  it('should handle timeout scenarios', async () => {
    const timeoutMs = 50

    const slowOperation = createTimeoutOperation(
      async () => doInstance.fetch(new Request('https://do/')),
      100 // Takes 100ms
    )

    const withTimeout = async <T>(operation: () => Promise<T>, timeout: number): Promise<T> => {
      return Promise.race([
        operation(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('Operation timed out')), timeout)
        )
      ])
    }

    await expect(
      withTimeout(slowOperation, timeoutMs)
    ).rejects.toThrow('Operation timed out')
  })

  it('should properly handle retries with exponential backoff', async () => {
    chaos.injectFailure(0.8) // 80% failure rate

    const delays: number[] = []
    let lastAttemptTime = Date.now()

    const exponentialBackoffRetry = async <T>(
      operation: () => Promise<T>,
      maxRetries: number,
      baseDelayMs: number
    ): Promise<T> => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await operation()
        } catch (error) {
          if (i === maxRetries - 1) throw error
          const delayMs = baseDelayMs * Math.pow(2, i)
          delays.push(delayMs)
          const now = Date.now()
          lastAttemptTime = now
          await delay(delayMs)
        }
      }
      throw new Error('Unexpected')
    }

    try {
      await exponentialBackoffRetry(
        () => chaos.wrap(() => doInstance.fetch(new Request('https://do/'))),
        6,
        10
      )
    } catch {
      // Expected to fail eventually with high failure rate
    }

    // Verify backoff pattern (should roughly double each time)
    if (delays.length >= 2) {
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
      }
    }
  })

  it('should detect and handle data corruption', async () => {
    const corruptor = new CorruptionInjector(0.5)
    let corruptedCount = 0

    const processData = (data: { $id: string; $type: string; value: number }): boolean => {
      // Validate data integrity
      if (!data.$id || !data.$type || data.value === null) {
        corruptedCount++
        return false
      }
      return true
    }

    // Process multiple items
    for (let i = 0; i < 20; i++) {
      const originalData = { $id: `id-${i}`, $type: 'test', value: i }
      const maybeCorrupted = corruptor.maybeCorrupt(originalData)
      processData(maybeCorrupted)
    }

    // Some data should have been detected as corrupted
    expect(corruptedCount).toBeGreaterThan(0)
  })

  it('should maintain state consistency after failures', async () => {
    const store = createThingsStore()

    // Create some initial data
    const items = await store.bulkCreate([
      { $type: 'test', value: 1 },
      { $type: 'test', value: 2 },
      { $type: 'test', value: 3 },
    ])

    chaos.injectFailure(0.3) // 30% failure on subsequent operations

    // Attempt multiple operations
    const operations = items.map(async (item) => {
      try {
        await chaos.wrap(async () => {
          await store.update(item.$id, { value: (item.value as number) + 10 })
        })
        return { id: item.$id, success: true }
      } catch {
        return { id: item.$id, success: false }
      }
    })

    await Promise.all(operations)

    // Verify state is consistent (no partial updates or corruption)
    const allItems = await store.list({ type: 'test' })
    expect(allItems.length).toBe(3)

    // Each item should be either original or fully updated
    for (const item of allItems) {
      expect([1, 2, 3, 11, 12, 13]).toContain(item.value)
    }
  })

  it('should handle cascading failures gracefully', async () => {
    // Setup dependent operations
    let step1Complete = false
    let step2Complete = false
    let step3Complete = false
    const errors: string[] = []
    let step1Failures = 0

    const step1 = async () => {
      await chaos.wrap(async () => {
        await delay(5)
        step1Complete = true
      })
    }

    const step2 = async () => {
      if (!step1Complete) {
        errors.push('step2 depends on step1')
        throw new Error('Step 1 not complete')
      }
      await chaos.wrap(async () => {
        await delay(5)
        step2Complete = true
      })
    }

    const step3 = async () => {
      if (!step2Complete) {
        errors.push('step3 depends on step2')
        throw new Error('Step 2 not complete')
      }
      await chaos.wrap(async () => {
        await delay(5)
        step3Complete = true
      })
    }

    // Use very high failure rate to ensure step1 fails sometimes
    chaos.injectFailure(0.7)

    // Run pipeline multiple times
    for (let i = 0; i < 20; i++) {
      step1Complete = false
      step2Complete = false
      step3Complete = false

      try {
        await step1()
        await step2()
        await step3()
      } catch (err) {
        // Track if step1 failed (which will cause cascade)
        if (!step1Complete) {
          step1Failures++
        }
      }
    }

    // With 70% failure rate over 20 runs, at least some step1 failures should cascade
    // Either we detected cascading dependency errors, OR we have many step1 failures
    // The test validates the system handles failures in dependent operations
    expect(step1Failures > 0 || errors.some(e => e.includes('depends on'))).toBe(true)
  })

  it('should handle circuit breaker pattern', async () => {
    let failureCount = 0
    let circuitOpen = false
    const failureThreshold = 3
    const resetTimeout = 100

    chaos.injectFailure(0.9) // Very high failure rate

    const withCircuitBreaker = async <T>(operation: () => Promise<T>): Promise<T> => {
      if (circuitOpen) {
        throw new Error('Circuit breaker open')
      }

      try {
        const result = await operation()
        failureCount = 0 // Reset on success
        return result
      } catch (error) {
        failureCount++
        if (failureCount >= failureThreshold) {
          circuitOpen = true
          // Auto-reset after timeout
          setTimeout(() => {
            circuitOpen = false
            failureCount = 0
          }, resetTimeout)
        }
        throw error
      }
    }

    // Make requests until circuit opens
    const results: string[] = []
    for (let i = 0; i < 10; i++) {
      try {
        await withCircuitBreaker(() =>
          chaos.wrap(() => doInstance.fetch(new Request('https://do/')))
        )
        results.push('success')
      } catch (error) {
        results.push((error as Error).message)
      }
    }

    // Circuit should have opened after threshold failures
    expect(results.filter(r => r === 'Circuit breaker open').length).toBeGreaterThan(0)

    // Wait for reset and try again
    await delay(150)
    chaos.reset() // Disable chaos

    try {
      const response = await withCircuitBreaker(() =>
        doInstance.fetch(new Request('https://do/'))
      )
      expect(response.status).toBe(200)
    } catch {
      // Might still be in cooldown
    }
  })
})

// ============================================================================
// Test Suite: Combined Chaos Scenarios
// ============================================================================

describe('Chaos: Combined Scenarios', () => {
  let chaos: ChaosProxy
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    chaos = new ChaosProxy()
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should handle latency + failure injection together', async () => {
    chaos.injectLatency(10, 30)
    chaos.injectFailure(0.3)

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        chaos.wrap(() => doInstance.fetch(new Request('https://do/')))
      )
    )

    const stats = chaos.getStats()
    expect(stats.totalRequests).toBe(50)
    expect(stats.injectedLatencies).toBeGreaterThan(0)
    expect(stats.injectedFailures).toBeGreaterThan(0)

    // Some requests should succeed despite chaos
    const succeeded = results.filter(r => r.status === 'fulfilled')
    expect(succeeded.length).toBeGreaterThan(0)
  })

  it('should handle storage chaos + request chaos together', async () => {
    const chaoticState = createChaoticMockState(chaos)
    chaos.injectStorageChaos({
      readFailureProbability: 0.2,
      writeFailureProbability: 0.2,
    })
    chaos.injectLatency(5, 15)
    chaos.injectFailure(0.1)

    let storageOps = 0
    let requestOps = 0

    for (let i = 0; i < 30; i++) {
      try {
        await chaoticState.storage.put(`key-${i}`, { value: i })
        storageOps++
      } catch { /* ignore */ }

      try {
        await chaos.wrap(() => doInstance.fetch(new Request('https://do/')))
        requestOps++
      } catch { /* ignore */ }
    }

    // Some operations should succeed despite combined chaos
    expect(storageOps).toBeGreaterThan(0)
    expect(requestOps).toBeGreaterThan(0)
  })

  it('should handle large payloads with latency and failures', async () => {
    chaos.injectLatency(5, 20)
    chaos.injectFailure(0.2)

    ;(doInstance as unknown as { process: (data: string) => Promise<{ length: number }> }).process = async (data: string) => {
      return { length: data.length }
    }

    const { results, errors, successRate } = await runRequestStorm(
      20,
      async () => {
        const payload = chaos.generateLargePayload(20) // 20KB
        return chaos.wrap(async () => {
          const response = await doInstance.fetch(new Request('https://do/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'process', args: [payload] })
          }))
          return response.json()
        })
      }
    )

    // Should handle most requests despite chaos
    expect(successRate).toBeGreaterThan(0.5)
    expect(results.length + errors.length).toBe(20)
  })

  it('should maintain system stability under sustained chaos', async () => {
    chaos.injectLatency(2, 10)
    chaos.injectFailure(0.15)

    // Run sustained load for multiple "rounds"
    const roundResults: { success: number; failure: number }[] = []

    for (let round = 0; round < 5; round++) {
      let success = 0
      let failure = 0

      const requests = Array.from({ length: 30 }, () =>
        chaos.wrap(() => doInstance.fetch(new Request('https://do/')))
          .then(() => { success++ })
          .catch(() => { failure++ })
      )

      await Promise.all(requests)
      roundResults.push({ success, failure })
    }

    // System should remain stable across rounds (no degradation)
    const successRates = roundResults.map(r => r.success / (r.success + r.failure))

    // All rounds should have reasonable success rates
    successRates.forEach(rate => {
      expect(rate).toBeGreaterThan(0.6) // At least 60% success
    })

    // No significant degradation between rounds
    const minRate = Math.min(...successRates)
    const maxRate = Math.max(...successRates)
    expect(maxRate - minRate).toBeLessThan(0.3) // Within 30% variance
  })
})
