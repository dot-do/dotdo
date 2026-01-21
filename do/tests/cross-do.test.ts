/**
 * Cross-DO RPC via $ - Integration Tests with Real Miniflare
 *
 * Tests the WorkflowContext ($) cross-DO RPC functionality using real miniflare instances.
 * NO MOCKS - all tests run against real Durable Object instances with real communication.
 *
 * Tests cover:
 * 1. DO stub creation via $.EntityType(id) pattern
 * 2. Stub caching behavior
 * 3. Integration with other workflow context features (events, scheduling)
 * 4. Error handling for missing bindings
 *
 * Note: Full cross-DO RPC communication tests are in cross-do-rpc.test.ts
 * which uses direct Miniflare instantiation for more complex multi-DO scenarios.
 *
 * @module do/tests/cross-do.test
 */

import { describe, it, expect } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import { DO } from '../DO'
import { createContext } from '../workflow'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate unique test identifier to ensure test isolation
 */
function generateTestId(): string {
  return `cross-do-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a test DO stub with a unique name
 */
function getTestDO(name: string = generateTestId()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// ============================================================================
// TESTS: Cross-DO RPC via $
// ============================================================================

describe('Cross-DO RPC via $', () => {
  describe('DO stub access via $ context', () => {
    it('should create $ context with proper structure', async () => {
      const stub = getTestDO()

      const hasContext = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        return {
          hasOn: typeof $.on === 'object',
          hasSend: typeof $.send === 'function',
          hasDo: typeof $.do === 'function',
          hasTry: typeof $.try === 'function',
          // $.every is a function that returns a proxy for schedule DSL
          hasEvery: typeof $.every === 'function',
        }
      })

      expect(hasContext.hasOn).toBe(true)
      expect(hasContext.hasSend).toBe(true)
      expect(hasContext.hasDo).toBe(true)
      expect(hasContext.hasTry).toBe(true)
      expect(hasContext.hasEvery).toBe(true)
    })

    it('should support event handler registration via $.on', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        let handlerCalled = false

        // Register event handler
        $.on.Customer.created((event: unknown) => {
          handlerCalled = true
        })

        // Emit event
        $.send({ type: 'Customer.created', payload: { id: 'test-123' } })

        // Small delay for async handler
        await new Promise(r => setTimeout(r, 10))

        return handlerCalled
      })

      expect(result).toBe(true)
    })

    it('should support schedule registration via $.every', async () => {
      const stub = getTestDO()

      const hasSchedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        // Register a schedule
        $.every.hour(async () => {})

        // Check if schedule was registered
        return $._schedules.size > 0
      })

      expect(hasSchedule).toBe(true)
    })

    it('should support multiple schedule types', async () => {
      const stub = getTestDO()

      const scheduleCount = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.minute(async () => {})
        $.every.hour(async () => {})
        $.every.day(async () => {})

        return $._schedules.size
      })

      expect(scheduleCount).toBe(3)
    })

    it('should throw clear error for missing DO binding', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const state = (instance as any).state
        const $ = createContext(state, {}) // Empty env - no bindings

        try {
          $.NonExistent('some-id')
          return { threw: false, message: '' }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      expect(result.threw).toBe(true)
      expect(result.message).toMatch(/NonExistent.*not found/i)
    })
  })

  describe('Event handling integration', () => {
    it('should handle multiple event types', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const events: string[] = []

        $.on.Customer.created(() => events.push('customer-created'))
        $.on.Order.placed(() => events.push('order-placed'))
        $.on.Payment.received(() => events.push('payment-received'))

        $.send({ type: 'Customer.created', payload: {} })
        $.send({ type: 'Order.placed', payload: {} })
        $.send({ type: 'Payment.received', payload: {} })

        await new Promise(r => setTimeout(r, 20))

        return events
      })

      expect(result).toContain('customer-created')
      expect(result).toContain('order-placed')
      expect(result).toContain('payment-received')
    })

    it('should pass event payload to handlers', async () => {
      const stub = getTestDO()

      const receivedPayload = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        let payload: unknown = null

        $.on.Customer.signup((event: { payload: unknown }) => {
          payload = event.payload
        })

        $.send({
          type: 'Customer.signup',
          payload: { customerId: 'c-123', email: 'test@example.com' }
        })

        await new Promise(r => setTimeout(r, 10))

        return payload
      })

      expect(receivedPayload).toEqual({ customerId: 'c-123', email: 'test@example.com' })
    })

    it('should support multiple handlers for same event', async () => {
      const stub = getTestDO()

      const handlerCounts = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        let count = 0

        $.on.Order.shipped(() => count++)
        $.on.Order.shipped(() => count++)
        $.on.Order.shipped(() => count++)

        $.send({ type: 'Order.shipped', payload: {} })

        await new Promise(r => setTimeout(r, 10))

        return count
      })

      expect(handlerCounts).toBe(3)
    })
  })

  describe('Durability levels', () => {
    it('should execute $.try() with single attempt', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        let attempts = 0

        const value = await $.try(async () => {
          attempts++
          return 'success'
        })

        return { value, attempts }
      })

      expect(result.value).toBe('success')
      expect(result.attempts).toBe(1)
    })

    it('should execute $.do() with retries on failure', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        let attempts = 0

        const value = await $.do(async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Retry me')
          }
          return 'success after retries'
        }, { retries: 5 })

        return { value, attempts }
      })

      expect(result.value).toBe('success after retries')
      expect(result.attempts).toBe(3)
    })

    it('should fire-and-forget with $.send()', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        let received = false

        $.on.Task.queued(() => {
          received = true
        })

        // Fire and forget - returns immediately
        $.send({ type: 'Task.queued', payload: { taskId: 't-1' } })

        // Wait for async processing
        await new Promise(r => setTimeout(r, 10))

        return received
      })

      expect(result).toBe(true)
    })
  })

  describe('Context state isolation', () => {
    it('should maintain separate handler maps per context', async () => {
      const stub1 = getTestDO('context-1-' + generateTestId())
      const stub2 = getTestDO('context-2-' + generateTestId())

      // Register handler in first DO
      const handlers1 = await runInDurableObject(stub1, async (instance: DO) => {
        const $ = (instance as any).$
        $.on.Test.event(() => {})
        return $._handlers.size
      })

      // Check second DO has no handlers
      const handlers2 = await runInDurableObject(stub2, async (instance: DO) => {
        const $ = (instance as any).$
        return $._handlers.size
      })

      expect(handlers1).toBeGreaterThan(0)
      expect(handlers2).toBe(0)
    })

    it('should maintain separate schedule maps per context', async () => {
      const stub1 = getTestDO('schedule-1-' + generateTestId())
      const stub2 = getTestDO('schedule-2-' + generateTestId())

      // Register schedule in first DO
      const schedules1 = await runInDurableObject(stub1, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.hour(async () => {})
        $.every.day(async () => {})
        return $._schedules.size
      })

      // Check second DO has no schedules
      const schedules2 = await runInDurableObject(stub2, async (instance: DO) => {
        const $ = (instance as any).$
        return $._schedules.size
      })

      expect(schedules1).toBe(2)
      expect(schedules2).toBe(0)
    })
  })

  describe('Context initialization', () => {
    it('should initialize context with state and env', async () => {
      const stub = getTestDO()

      const hasValidContext = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        // Check that all expected properties exist
        return {
          hasHandlers: $._handlers instanceof Map,
          hasSchedules: $._schedules instanceof Map,
          hasOnProxy: typeof $.on === 'object',
          // $.every is a function that returns a proxy for schedule DSL
          hasEveryProxy: typeof $.every === 'function',
        }
      })

      expect(hasValidContext.hasHandlers).toBe(true)
      expect(hasValidContext.hasSchedules).toBe(true)
      expect(hasValidContext.hasOnProxy).toBe(true)
      expect(hasValidContext.hasEveryProxy).toBe(true)
    })
  })

  describe('Schedule DSL variations', () => {
    it('should support $.every(n).minutes syntax', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every(5).minutes(async () => {})

        const schedules = Array.from($._schedules.values())
        return schedules[0]?.interval
      })

      expect(interval?.type).toBe('minute')
      expect(interval?.value).toBe(5)
    })

    it('should support $.every.Monday syntax', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.Monday(async () => {})

        const schedules = Array.from($._schedules.values())
        return schedules[0]?.interval
      })

      expect(interval?.expression).toBe('0 0 * * 1')
    })

    it('should support $.every.weekday.at8am syntax', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.weekday.at8am(async () => {})

        const schedules = Array.from($._schedules.values())
        return schedules[0]?.interval
      })

      expect(interval?.expression).toBe('0 8 * * 1-5')
    })
  })
})
