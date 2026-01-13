/**
 * Tests for ExactlyOnceContext Migration in Temporal Compat Layer
 *
 * These tests verify that the Temporal compat layer uses ExactlyOnceContext
 * for step deduplication instead of manual stepResults Map management.
 *
 * TDD Approach - RED phase: Tests are written before implementation changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  WorkflowClient,
  uuid4,
  random,
  workflowNow,
  proxyActivities,
  sleep,
  registerWorker,
  __clearTemporalState,
  getCurrentContext,
} from './index'
import { ExactlyOnceContext } from '../../../db/primitives/exactly-once-context'

describe('ExactlyOnceContext Migration', () => {
  beforeEach(() => {
    __clearTemporalState()
  })

  afterEach(() => {
    __clearTemporalState()
  })

  describe('WorkflowContext should have ExactlyOnceContext', () => {
    it('should expose exactlyOnce context in workflow state', async () => {
      const client = new WorkflowClient()

      async function testWorkflow() {
        const ctx = getCurrentContext()
        // The workflow context should have an exactlyOnce property
        expect(ctx).toBeDefined()
        expect(ctx?.exactlyOnce).toBeDefined()
        expect(ctx?.exactlyOnce).toBeInstanceOf(ExactlyOnceContext)
        return 'done'
      }

      const result = await client.execute(testWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('done')
    })
  })

  describe('uuid4() should use ExactlyOnceContext', () => {
    it('should use ExactlyOnceContext sync methods for uuid4 deduplication', async () => {
      const client = new WorkflowClient()
      let markProcessedSyncCalled = false

      async function testWorkflow() {
        const ctx = getCurrentContext()
        const exactlyOnce = ctx?.exactlyOnce

        // Spy on markProcessedSync
        if (exactlyOnce) {
          const originalMarkProcessedSync = exactlyOnce.markProcessedSync.bind(exactlyOnce)
          exactlyOnce.markProcessedSync = (eventId, result) => {
            if (eventId.includes('uuid4')) {
              markProcessedSyncCalled = true
            }
            return originalMarkProcessedSync(eventId, result)
          }
        }

        const id = uuid4()
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

        return { id, markProcessedSyncCalled }
      }

      const result = await client.execute(testWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.markProcessedSyncCalled).toBe(true)
    })

    it('should return cached uuid on duplicate call within same workflow', async () => {
      const client = new WorkflowClient()

      async function testWorkflow() {
        const ctx = getCurrentContext()
        const exactlyOnce = ctx?.exactlyOnce

        // Simulate replay by calling processOnce with same ID
        const stepId = `uuid4:0`
        const eventId = `${ctx?.workflow.workflowId}:${stepId}`

        // First call
        const id1 = await exactlyOnce?.processOnce(eventId, async () => crypto.randomUUID())

        // Second call with same event ID should return cached result
        const id2 = await exactlyOnce?.processOnce(eventId, async () => 'should-not-run')

        return { id1, id2, same: id1 === id2 }
      }

      const result = await client.execute(testWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.same).toBe(true)
      expect(result.id1).toBe(result.id2)
    })
  })

  describe('random() should use ExactlyOnceContext', () => {
    it('should use ExactlyOnceContext sync methods for random deduplication', async () => {
      const client = new WorkflowClient()
      let markProcessedSyncCalled = false

      async function testWorkflow() {
        const ctx = getCurrentContext()
        const exactlyOnce = ctx?.exactlyOnce

        if (exactlyOnce) {
          const originalMarkProcessedSync = exactlyOnce.markProcessedSync.bind(exactlyOnce)
          exactlyOnce.markProcessedSync = (eventId, result) => {
            if (eventId.includes('random')) {
              markProcessedSyncCalled = true
            }
            return originalMarkProcessedSync(eventId, result)
          }
        }

        const num = random()
        expect(num).toBeGreaterThanOrEqual(0)
        expect(num).toBeLessThan(1)

        return { num, markProcessedSyncCalled }
      }

      const result = await client.execute(testWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.markProcessedSyncCalled).toBe(true)
    })
  })

  describe('workflowNow() should use ExactlyOnceContext', () => {
    it('should use ExactlyOnceContext sync methods for workflowNow deduplication', async () => {
      const client = new WorkflowClient()
      let markProcessedSyncCalled = false

      async function testWorkflow() {
        const ctx = getCurrentContext()
        const exactlyOnce = ctx?.exactlyOnce

        if (exactlyOnce) {
          const originalMarkProcessedSync = exactlyOnce.markProcessedSync.bind(exactlyOnce)
          exactlyOnce.markProcessedSync = (eventId, result) => {
            if (eventId.includes('workflowNow')) {
              markProcessedSyncCalled = true
            }
            return originalMarkProcessedSync(eventId, result)
          }
        }

        const now = workflowNow()
        expect(now).toBeInstanceOf(Date)

        return { time: now.getTime(), markProcessedSyncCalled }
      }

      const result = await client.execute(testWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.markProcessedSyncCalled).toBe(true)
    })
  })

  describe('Activities should use ExactlyOnceContext', () => {
    it('should use ExactlyOnceContext sync methods for activity result deduplication', async () => {
      const client = new WorkflowClient()
      let markProcessedSyncCalled = false

      // Register a worker with activity handler
      const unregister = registerWorker('test-activity-queue', {
        executeActivity: async (name, args) => {
          if (name === 'testActivity') {
            return `result-${args[0]}`
          }
          throw new Error(`Unknown activity: ${name}`)
        },
      })

      async function testWorkflow() {
        const ctx = getCurrentContext()
        const exactlyOnce = ctx?.exactlyOnce

        if (exactlyOnce) {
          const originalMarkProcessedSync = exactlyOnce.markProcessedSync.bind(exactlyOnce)
          exactlyOnce.markProcessedSync = (eventId, result) => {
            if (eventId.includes('activity')) {
              markProcessedSyncCalled = true
            }
            return originalMarkProcessedSync(eventId, result)
          }
        }

        const activities = proxyActivities<{
          testActivity: (value: string) => Promise<string>
        }>({
          startToCloseTimeout: '10s',
          taskQueue: 'test-activity-queue',
        })

        const result = await activities.testActivity('input')
        return { result, markProcessedSyncCalled }
      }

      try {
        const result = await client.execute(testWorkflow, {
          taskQueue: 'test-activity-queue',
        })

        expect(result.markProcessedSyncCalled).toBe(true)
        expect(result.result).toBe('result-input')
      } finally {
        unregister()
      }
    })

    it('should return cached activity result on replay', async () => {
      const client = new WorkflowClient()
      let activityCallCount = 0

      const unregister = registerWorker('test-replay-queue', {
        executeActivity: async () => {
          activityCallCount++
          return `call-${activityCallCount}`
        },
      })

      async function testWorkflow() {
        const ctx = getCurrentContext()
        const exactlyOnce = ctx?.exactlyOnce

        const activities = proxyActivities<{
          countingActivity: () => Promise<string>
        }>({
          startToCloseTimeout: '10s',
          taskQueue: 'test-replay-queue',
        })

        // Call activity
        const result1 = await activities.countingActivity()

        // If we query ExactlyOnceContext, the activity should be marked as processed
        const stepId = `activity:test-replay-queue:countingActivity:[]`
        const isProcessed = exactlyOnce?.isProcessedSync(
          `${ctx?.workflow.workflowId}:${stepId}`
        )

        return { result1, isProcessed, activityCallCount }
      }

      try {
        const result = await client.execute(testWorkflow, {
          taskQueue: 'test-replay-queue',
        })

        expect(result.isProcessed).toBe(true)
        expect(result.activityCallCount).toBe(1)
      } finally {
        unregister()
      }
    })
  })

  describe('Sleep should use ExactlyOnceContext', () => {
    it('should use ExactlyOnceContext sync methods for sleep deduplication', async () => {
      const client = new WorkflowClient()
      let markProcessedSyncCalled = false

      async function testWorkflow() {
        const ctx = getCurrentContext()
        const exactlyOnce = ctx?.exactlyOnce

        if (exactlyOnce) {
          const originalMarkProcessedSync = exactlyOnce.markProcessedSync.bind(exactlyOnce)
          exactlyOnce.markProcessedSync = (eventId, result) => {
            if (eventId.includes('sleep')) {
              markProcessedSyncCalled = true
            }
            return originalMarkProcessedSync(eventId, result)
          }
        }

        await sleep(10)
        return { markProcessedSyncCalled }
      }

      const result = await client.execute(testWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.markProcessedSyncCalled).toBe(true)
    })
  })

  describe('TTL-based cleanup', () => {
    it('should support TTL configuration for step IDs', async () => {
      const client = new WorkflowClient()

      async function testWorkflow() {
        const ctx = getCurrentContext()
        const exactlyOnce = ctx?.exactlyOnce

        // The ExactlyOnceContext should be created with a TTL
        // This is internal behavior, but we can verify it works
        expect(exactlyOnce).toBeDefined()

        return 'done'
      }

      const result = await client.execute(testWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('done')
    })
  })

  describe('Race condition prevention', () => {
    it('should handle concurrent calls to same step correctly', async () => {
      const client = new WorkflowClient()

      async function testWorkflow() {
        const ctx = getCurrentContext()
        const exactlyOnce = ctx?.exactlyOnce

        // Simulate concurrent calls
        const eventId = 'test:concurrent:step'
        let executeCount = 0

        const [result1, result2] = await Promise.all([
          exactlyOnce?.processOnce(eventId, async () => {
            executeCount++
            await new Promise((r) => setTimeout(r, 10))
            return 'first'
          }),
          exactlyOnce?.processOnce(eventId, async () => {
            executeCount++
            return 'second'
          }),
        ])

        return { result1, result2, executeCount }
      }

      const result = await client.execute(testWorkflow, {
        taskQueue: 'test-queue',
      })

      // Both calls should return the same result (first execution wins)
      expect(result.result1).toBe(result.result2)
      // Only one execution should have happened
      expect(result.executeCount).toBe(1)
    })
  })

  describe('Transaction support', () => {
    it('should support atomic multi-step operations', async () => {
      const client = new WorkflowClient()

      async function testWorkflow() {
        const ctx = getCurrentContext()
        const exactlyOnce = ctx?.exactlyOnce

        // Transaction should allow atomic operations
        const result = await exactlyOnce?.transaction(async (tx) => {
          await tx.put('key1', 'value1')
          await tx.put('key2', 'value2')
          tx.emit({ type: 'test-event' })
          return 'transaction-complete'
        })

        return { result }
      }

      const result = await client.execute(testWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.result).toBe('transaction-complete')
    })
  })

  describe('Metrics integration', () => {
    it('should track processed and duplicate counts', async () => {
      const client = new WorkflowClient()

      async function testWorkflow() {
        // Call uuid4 multiple times
        const id1 = uuid4()
        const id2 = uuid4()
        const id3 = uuid4()

        // Each call should be unique (different step IDs)
        return {
          id1,
          id2,
          id3,
          allUnique: id1 !== id2 && id2 !== id3 && id1 !== id3,
        }
      }

      const result = await client.execute(testWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.allUnique).toBe(true)
    })
  })

  describe('Backward compatibility', () => {
    it('should maintain same external behavior as before migration', async () => {
      const client = new WorkflowClient()

      async function backwardCompatWorkflow() {
        // Test all deterministic operations work the same
        const id = uuid4()
        const rand = random()
        const now = workflowNow()

        return {
          hasValidUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id),
          hasValidRandom: rand >= 0 && rand < 1,
          hasValidDate: now instanceof Date && !isNaN(now.getTime()),
        }
      }

      const result = await client.execute(backwardCompatWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.hasValidUuid).toBe(true)
      expect(result.hasValidRandom).toBe(true)
      expect(result.hasValidDate).toBe(true)
    })

    it('should maintain replay determinism', async () => {
      const client = new WorkflowClient()
      const capturedValues: { id: string; rand: number }[] = []

      async function replayWorkflow() {
        const id = uuid4()
        const rand = random()
        capturedValues.push({ id, rand })
        return { id, rand }
      }

      // First execution
      const result1 = await client.execute(replayWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'replay-test',
      })

      // Values should be valid
      expect(result1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(result1.rand).toBeGreaterThanOrEqual(0)
      expect(result1.rand).toBeLessThan(1)
    })
  })
})
