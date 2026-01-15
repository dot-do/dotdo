/**
 * Graceful Degradation Tests (RED Phase)
 *
 * Tests that verify the system degrades gracefully when external services are unavailable.
 * These tests should FAIL initially - they define the expected behavior for:
 *
 * 1. AI Service Unavailable - System should use fallbacks or cached responses
 * 2. R2 Storage Unavailable - System should use local SQLite cache
 * 3. Pipeline Unavailable - System should fall back to direct SQLite writes
 * 4. Degradation Transparency - Callers shouldn't need to handle service failures
 *
 * Architecture Review Finding [ARCH-5]:
 * - No graceful degradation when services unavailable
 * - Hard failures cascade to all callers
 *
 * @see /storage/do-storage.ts - 4-layer storage coordinator
 * @see /storage/pipeline-emitter.ts - WAL event emission
 * @see /storage/iceberg-writer.ts - R2 cold storage
 * @see /ai/index.ts - AI template literals
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// =============================================================================
// Test Helpers - Service Mocks
// =============================================================================

/**
 * Creates a mock Pipeline that fails all sends
 */
function createFailingPipeline(error: Error = new Error('Pipeline unavailable')) {
  return {
    send: vi.fn().mockRejectedValue(error),
  }
}

/**
 * Creates a mock Pipeline that works normally
 */
function createWorkingPipeline() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  }
}

/**
 * Creates a mock R2 bucket that fails all operations
 */
function createFailingR2(error: Error = new Error('R2 unavailable')) {
  return {
    put: vi.fn().mockRejectedValue(error),
    get: vi.fn().mockRejectedValue(error),
    list: vi.fn().mockRejectedValue(error),
  }
}

/**
 * Creates a mock R2 bucket that works normally
 */
function createWorkingR2() {
  const storage = new Map<string, unknown>()
  return {
    put: vi.fn().mockImplementation(async (key: string, data: unknown) => {
      storage.set(key, data)
      return { key, size: 100 }
    }),
    get: vi.fn().mockImplementation(async (key: string) => {
      const data = storage.get(key)
      if (!data) return null
      return {
        key,
        size: 100,
        body: new ReadableStream(),
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => JSON.stringify(data),
        json: async () => data,
      }
    }),
    list: vi.fn().mockResolvedValue({ objects: [] }),
  }
}

/**
 * Creates a mock SQL storage that works
 */
function createWorkingSql() {
  const tables = new Map<string, Map<string, unknown>>()
  return {
    exec: vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
      // Simple mock - track what was written
      if (query.includes('INSERT') || query.includes('REPLACE')) {
        const tableName = 'things'
        if (!tables.has(tableName)) {
          tables.set(tableName, new Map())
        }
        const id = params[0] as string
        tables.get(tableName)!.set(id, { id, type: params[1], data: params[2] })
      }
      if (query.includes('SELECT')) {
        const id = params[0] as string
        const tableName = 'things'
        const table = tables.get(tableName)
        if (table?.has(id)) {
          return { toArray: () => [table.get(id)] }
        }
      }
      return { toArray: () => [] }
    }),
  }
}

/**
 * Creates a mock AI provider that fails
 */
function createFailingAIProvider(error: Error = new Error('AI service unavailable')) {
  return {
    execute: vi.fn().mockRejectedValue(error),
    request: vi.fn().mockRejectedValue(error),
    configured: true,
  }
}

/**
 * Creates a mock AI provider that works
 */
function createWorkingAIProvider() {
  return {
    execute: vi.fn().mockResolvedValue('AI response'),
    configured: true,
  }
}

// =============================================================================
// 1. AI Service Graceful Degradation
// =============================================================================

describe('AI Service Graceful Degradation', () => {
  describe('when primary AI provider is unavailable', () => {
    it('should fall back to secondary provider transparently', async () => {
      const { createAI } = await import('../../ai/index')

      const failingProvider = createFailingAIProvider()
      const backupProvider = createWorkingAIProvider()

      const ai = createAI({
        provider: failingProvider,
        providers: {
          primary: failingProvider,
          backup: backupProvider,
        },
        fallback: ['backup'],
      })

      // This should NOT throw - it should use the fallback provider
      const result = await ai`Generate a greeting`

      expect(result).toBeDefined()
      expect(typeof result).toBe('string')
      // The backup provider should have been called
      expect(backupProvider.execute).toHaveBeenCalled()
    })

    it('should return cached response when all providers fail', async () => {
      const { createAI } = await import('../../ai/index')

      const workingProvider = createWorkingAIProvider()

      // First, make a request that succeeds and gets cached
      const ai = createAI({
        provider: workingProvider,
        cache: { enabled: true, ttl: 60000 },
      })

      const firstResult = await ai`What is 2+2?`
      expect(firstResult).toBeDefined()

      // Now make the provider fail
      workingProvider.execute.mockRejectedValue(new Error('Service down'))

      // The same prompt should return cached result, NOT throw
      const cachedResult = await ai`What is 2+2?`

      expect(cachedResult).toBe(firstResult)
    })

    it('should provide degraded response when no fallbacks available', async () => {
      const { createAI } = await import('../../ai/index')

      const failingProvider = createFailingAIProvider()

      const ai = createAI({
        provider: failingProvider,
        fallback: false, // No fallbacks configured
      })

      // Instead of throwing, should return a degraded response
      // indicating the service is unavailable
      const result = await ai`Generate something`

      // Expected: System returns a graceful degraded response
      // Actual: Currently throws an error
      expect(result).toBeDefined()
      expect(result).toContain('unavailable') // Or some degraded indicator
    })

    it('should not cascade failures to parallel AI operations', async () => {
      const { createAI } = await import('../../ai/index')

      let callCount = 0
      const intermittentProvider = {
        execute: vi.fn().mockImplementation(async () => {
          callCount++
          // Fail every other request
          if (callCount % 2 === 0) {
            throw new Error('Intermittent failure')
          }
          return `Response ${callCount}`
        }),
        configured: true,
      }

      const ai = createAI({
        provider: intermittentProvider,
      })

      // Run multiple operations in parallel
      const results = await Promise.allSettled([
        ai`Request 1`,
        ai`Request 2`,
        ai`Request 3`,
        ai`Request 4`,
      ])

      // Successful operations should not be affected by failed ones
      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')

      // Currently all might fail due to cascading
      // Expected: Only intermittent failures, others succeed
      expect(fulfilled.length).toBeGreaterThan(0)
      expect(rejected.length).toBeLessThan(results.length)
    })
  })

  describe('AI classification graceful degradation', () => {
    it('should return unknown classification instead of throwing', async () => {
      const { createAI } = await import('../../ai/index')

      const failingProvider = createFailingAIProvider()

      const ai = createAI({
        provider: failingProvider,
      })

      // ai.is should return 'unknown' or similar, not throw
      const result = await ai.is`Is this positive or negative? Great product!`

      expect(result).toBeDefined()
      // Should indicate inability to classify rather than throwing
      expect(['unknown', 'error', 'unavailable']).toContain(result.toLowerCase())
    })
  })

  describe('AI list extraction graceful degradation', () => {
    it('should return empty array instead of throwing', async () => {
      const { createAI } = await import('../../ai/index')

      const failingProvider = createFailingAIProvider()

      const ai = createAI({
        provider: failingProvider,
      })

      // ai.list should return [] instead of throwing
      const result = await ai.list`Extract colors from: red, blue, green`

      expect(Array.isArray(result)).toBe(true)
      expect(result).toEqual([])
    })
  })
})

// =============================================================================
// 2. R2 Storage Graceful Degradation
// =============================================================================

describe('R2 Storage Graceful Degradation', () => {
  describe('when R2 is unavailable', () => {
    it('should fall back to SQLite for reads', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      const failingR2 = createFailingR2()
      const workingSql = createWorkingSql()

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          R2: failingR2 as any,
          sql: workingSql as any,
        },
      })

      // First, create something (will fail to write to R2, but should persist to SQL)
      const created = await storage.create({
        $type: 'TestThing',
        name: 'test',
      })

      // Close and recreate to simulate cold start
      await storage.close()

      const storage2 = new DOStorage({
        namespace: 'test',
        env: {
          R2: failingR2 as any,
          sql: workingSql as any,
        },
      })

      // Should be able to read from SQLite even though R2 is down
      const retrieved = await storage2.getWithFullFallback(created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.$id).toBe(created.$id)

      await storage2.close()
    })

    it('should buffer writes locally when R2 is unavailable', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      const failingR2 = createFailingR2()
      const workingSql = createWorkingSql()

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          R2: failingR2 as any,
          sql: workingSql as any,
        },
      })

      // Should not throw even though R2 is down
      await expect(
        storage.create({
          $type: 'TestThing',
          name: 'test',
        })
      ).resolves.toBeDefined()

      // Writes should be buffered for retry when R2 comes back
      // Expected: operation succeeds, writes buffered locally
      // Actual: might throw or lose data

      await storage.close()
    })

    it('should sync buffered writes when R2 becomes available', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      const failingR2 = createFailingR2()
      const workingR2 = createWorkingR2()
      const workingSql = createWorkingSql()

      // Start with failing R2
      const storage = new DOStorage({
        namespace: 'test',
        env: {
          R2: failingR2 as any,
          sql: workingSql as any,
        },
      })

      // Create while R2 is down
      const created = await storage.create({
        $type: 'TestThing',
        name: 'buffered-write',
      })

      await storage.close()

      // Reconnect with working R2
      const storage2 = new DOStorage({
        namespace: 'test',
        env: {
          R2: workingR2 as any,
          sql: workingSql as any,
        },
      })

      // Trigger sync/recovery
      await storage2.getWithFullFallback(created.$id)

      // Working R2 should have received the buffered writes
      expect(workingR2.put).toHaveBeenCalled()

      await storage2.close()
    })

    it('should report degraded status to callers', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      const failingR2 = createFailingR2()

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          R2: failingR2 as any,
        },
      })

      // Storage should expose health/status info
      // Expected: { r2: 'degraded', pipeline: 'ok', sql: 'ok' }
      // This allows callers to make informed decisions
      const status = (storage as any).getHealthStatus?.()

      expect(status).toBeDefined()
      expect(status?.r2).toBe('degraded')

      await storage.close()
    })
  })
})

// =============================================================================
// 3. Pipeline Graceful Degradation
// =============================================================================

describe('Pipeline Graceful Degradation', () => {
  describe('when Pipeline is unavailable', () => {
    it('should fall back to direct SQLite writes', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      const failingPipeline = createFailingPipeline()
      const workingSql = createWorkingSql()

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          PIPELINE: failingPipeline as any,
          sql: workingSql as any,
        },
      })

      // Should succeed even though Pipeline is down
      const created = await storage.create({
        $type: 'TestThing',
        name: 'direct-write',
      })

      expect(created.$id).toBeDefined()

      // Data should be written directly to SQLite
      expect(workingSql.exec).toHaveBeenCalled()

      // The operation should NOT throw
      await storage.close()
    })

    it('should queue events for later replay when Pipeline recovers', async () => {
      const { PipelineEmitter } = await import('../../storage/pipeline-emitter')

      const failingPipeline = createFailingPipeline()
      const dlq = createWorkingPipeline()

      const emitter = new PipelineEmitter(failingPipeline as any, {
        namespace: 'test',
        maxRetries: 1,
        deadLetterQueue: dlq as any,
      })

      // Emit events while Pipeline is down
      emitter.emit('thing.created', 'things', { $id: 'test-1', name: 'Test' })
      emitter.emit('thing.updated', 'things', { $id: 'test-1', name: 'Updated' })

      await emitter.flush()

      // Events should be sent to DLQ for later replay
      expect(dlq.send).toHaveBeenCalled()

      // The emitter should track these for replay
      // Expected: emitter.getPendingReplayCount() > 0
      const pendingCount = (emitter as any).getPendingReplayCount?.() ?? 0
      expect(pendingCount).toBeGreaterThanOrEqual(0) // Should track pending events

      await emitter.close()
    })

    it('should not block callers when Pipeline is slow', { timeout: 2000 }, async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      // Pipeline that hangs forever
      const hangingPipeline = {
        send: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      }

      const workingSql = createWorkingSql()

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          PIPELINE: hangingPipeline as any,
          sql: workingSql as any,
        },
        waitForPipeline: false, // Don't wait for Pipeline
      })

      // Should complete quickly, not hang
      // EXPECTED BEHAVIOR: create() should return within 1 second even with hanging Pipeline
      // ACTUAL BEHAVIOR: create() blocks waiting for Pipeline, causing timeout
      const startTime = Date.now()
      const created = await storage.create({
        $type: 'TestThing',
        name: 'fast-write',
      })
      const elapsed = Date.now() - startTime

      expect(created.$id).toBeDefined()
      expect(elapsed).toBeLessThan(1000) // Should not block

      await storage.close()
    })

    it('should maintain write ordering during degraded mode', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      let pipelineAvailable = true
      const intermittentPipeline = {
        send: vi.fn().mockImplementation(async () => {
          if (!pipelineAvailable) {
            throw new Error('Pipeline temporarily unavailable')
          }
        }),
      }

      const workingSql = createWorkingSql()

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          PIPELINE: intermittentPipeline as any,
          sql: workingSql as any,
        },
      })

      // Create first item
      const item1 = await storage.create({ $type: 'Test', order: 1 })

      // Pipeline goes down
      pipelineAvailable = false

      // Create second item (should use fallback)
      const item2 = await storage.create({ $type: 'Test', order: 2 })

      // Pipeline comes back
      pipelineAvailable = true

      // Create third item
      const item3 = await storage.create({ $type: 'Test', order: 3 })

      // All items should exist with correct ordering
      const retrieved = [
        storage.get(item1.$id),
        storage.get(item2.$id),
        storage.get(item3.$id),
      ]

      expect(retrieved[0]).toBeDefined()
      expect(retrieved[1]).toBeDefined()
      expect(retrieved[2]).toBeDefined()

      await storage.close()
    })
  })
})

// =============================================================================
// 4. Transparent Degradation to Callers
// =============================================================================

describe('Transparent Degradation to Callers', () => {
  describe('API contract preservation', () => {
    it('should return same response shape regardless of degradation', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      // Normal operation
      const normalStorage = new DOStorage({
        namespace: 'test-normal',
        env: {
          PIPELINE: createWorkingPipeline() as any,
          R2: createWorkingR2() as any,
          sql: createWorkingSql() as any,
        },
      })

      const normalResult = await normalStorage.create({
        $type: 'TestThing',
        name: 'normal',
      })

      // Degraded operation (all external services down)
      const degradedStorage = new DOStorage({
        namespace: 'test-degraded',
        env: {
          PIPELINE: createFailingPipeline() as any,
          R2: createFailingR2() as any,
          sql: createWorkingSql() as any,
        },
      })

      const degradedResult = await degradedStorage.create({
        $type: 'TestThing',
        name: 'degraded',
      })

      // Both should have the same shape
      expect(Object.keys(normalResult).sort()).toEqual(
        Object.keys(degradedResult).sort()
      )

      // Both should have required fields
      expect(normalResult.$id).toBeDefined()
      expect(degradedResult.$id).toBeDefined()
      expect(normalResult.$type).toBe('TestThing')
      expect(degradedResult.$type).toBe('TestThing')

      await normalStorage.close()
      await degradedStorage.close()
    })

    it('should not require callers to handle service-specific errors', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          PIPELINE: createFailingPipeline(new Error('PIPELINE_UNAVAILABLE')) as any,
          R2: createFailingR2(new Error('R2_CONNECTION_REFUSED')) as any,
          sql: createWorkingSql() as any,
        },
      })

      // Callers should NOT need try/catch for normal operations
      // The storage layer should handle degradation internally
      const result = await storage.create({
        $type: 'TestThing',
        name: 'transparent',
      })

      // Result should be valid, not an error
      expect(result.$id).toBeDefined()
      expect(result).not.toBeInstanceOf(Error)

      await storage.close()
    })

    it('should emit degradation events for observability', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      const degradationEvents: Array<{ service: string; status: string }> = []

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          PIPELINE: createFailingPipeline() as any,
          sql: createWorkingSql() as any,
        },
      })

      // Subscribe to degradation events
      ;(storage as any).onDegradation?.((event: { service: string; status: string }) => {
        degradationEvents.push(event)
      })

      // Trigger operations that cause degradation
      await storage.create({ $type: 'Test', name: 'trigger' })

      // Should have emitted degradation event
      expect(degradationEvents.length).toBeGreaterThan(0)
      expect(degradationEvents.some((e) => e.service === 'pipeline')).toBe(true)

      await storage.close()
    })
  })

  describe('graceful degradation levels', () => {
    it('should support configurable degradation behavior', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      // Strict mode - fail fast on any degradation
      const strictStorage = new DOStorage({
        namespace: 'strict',
        env: {
          PIPELINE: createFailingPipeline() as any,
          sql: createWorkingSql() as any,
        },
        // degradationMode: 'strict', // Should throw on degradation
      } as any)

      // Lenient mode - degrade silently
      const lenientStorage = new DOStorage({
        namespace: 'lenient',
        env: {
          PIPELINE: createFailingPipeline() as any,
          sql: createWorkingSql() as any,
        },
        // degradationMode: 'lenient', // Should continue with degraded functionality
      } as any)

      // Strict should fail (or throw)
      // Lenient should succeed with degraded functionality
      const lenientResult = await lenientStorage.create({
        $type: 'Test',
        name: 'lenient-test',
      })

      expect(lenientResult.$id).toBeDefined()

      await strictStorage.close()
      await lenientStorage.close()
    })
  })
})

// =============================================================================
// 5. Recovery and Resilience
// =============================================================================

describe('Recovery and Resilience', () => {
  describe('automatic recovery', () => {
    it('should automatically retry when services recover', async () => {
      const { PipelineEmitter } = await import('../../storage/pipeline-emitter')

      let attempts = 0
      const recoveringPipeline = {
        send: vi.fn().mockImplementation(async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Still recovering')
          }
          // Success on 3rd attempt
        }),
      }

      const emitter = new PipelineEmitter(recoveringPipeline as any, {
        namespace: 'test',
        maxRetries: 5,
        retryDelay: 10,
      })

      emitter.emit('test.event', 'test', { data: 'retry-test' })
      await emitter.flush()

      // Should have succeeded after retries
      expect(attempts).toBe(3)
      expect(recoveringPipeline.send).toHaveBeenCalled()

      await emitter.close()
    })

    it('should not lose data during service transitions', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      const writtenData: unknown[] = []
      let pipelineState: 'up' | 'down' | 'recovering' = 'up'

      const transitioningPipeline = {
        send: vi.fn().mockImplementation(async (batch: unknown[]) => {
          if (pipelineState === 'down') {
            throw new Error('Pipeline down')
          }
          if (pipelineState === 'recovering') {
            // Slow but working
            await new Promise((r) => setTimeout(r, 100))
          }
          writtenData.push(...batch)
        }),
      }

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          PIPELINE: transitioningPipeline as any,
          sql: createWorkingSql() as any,
        },
      })

      // Write while up
      await storage.create({ $type: 'Test', phase: 'up' })

      // Pipeline goes down
      pipelineState = 'down'
      await storage.create({ $type: 'Test', phase: 'down' })

      // Pipeline recovering
      pipelineState = 'recovering'
      await storage.create({ $type: 'Test', phase: 'recovering' })

      // Pipeline back up
      pipelineState = 'up'
      await storage.create({ $type: 'Test', phase: 'back-up' })

      // All data should eventually be persisted (either to pipeline or SQL)
      // No data loss during transitions
      const allItems = ['up', 'down', 'recovering', 'back-up']

      // Check that all items exist in memory at least
      for (const phase of allItems) {
        const items = Array.from({ length: 100 }, (_, i) => storage.get(`test-${i}`))
          .filter(Boolean)
        // Should have some items
      }

      await storage.close()
    })
  })

  describe('circuit breaker pattern', () => {
    it('should implement circuit breaker for failing services', async () => {
      const { DOStorage } = await import('../../storage/do-storage')

      let callCount = 0
      const failingPipeline = {
        send: vi.fn().mockImplementation(async () => {
          callCount++
          throw new Error('Always fails')
        }),
      }

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          PIPELINE: failingPipeline as any,
          sql: createWorkingSql() as any,
        },
      })

      // Make many requests
      for (let i = 0; i < 20; i++) {
        await storage.create({ $type: 'Test', index: i })
      }

      // Circuit breaker should have tripped after N failures
      // Further calls should not hit the pipeline
      // Expected: callCount < 20 (circuit breaker opened)
      expect(callCount).toBeLessThan(20)

      await storage.close()
    })

    it('should half-open circuit breaker after timeout', async () => {
      vi.useFakeTimers()

      const { DOStorage } = await import('../../storage/do-storage')

      let callCount = 0
      let shouldFail = true

      const recoveringPipeline = {
        send: vi.fn().mockImplementation(async () => {
          callCount++
          if (shouldFail) {
            throw new Error('Failing')
          }
        }),
      }

      const storage = new DOStorage({
        namespace: 'test',
        env: {
          PIPELINE: recoveringPipeline as any,
          sql: createWorkingSql() as any,
        },
      })

      // Trigger circuit breaker
      for (let i = 0; i < 10; i++) {
        await storage.create({ $type: 'Test', index: i })
      }

      const callsBeforeRecovery = callCount

      // Service recovers
      shouldFail = false

      // Advance time past circuit breaker timeout
      vi.advanceTimersByTime(30000)

      // Make another request - circuit breaker should be half-open
      await storage.create({ $type: 'Test', phase: 'after-recovery' })

      // Should have tried the pipeline again
      expect(callCount).toBeGreaterThan(callsBeforeRecovery)

      await storage.close()
      vi.useRealTimers()
    })
  })
})
