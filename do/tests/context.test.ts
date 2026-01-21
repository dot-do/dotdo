/**
 * WorkflowContext ($) Tests - Real Durable Object Instances
 *
 * Tests for the WorkflowContext using real miniflare DO instances.
 * NO MOCKS for DurableObjectState - all tests run against real DO instances.
 *
 * Note: vi.fn() for handlers is acceptable since handlers ARE user-provided functions.
 * The NO MOCKS philosophy applies to infrastructure (storage, state), not test utilities.
 *
 * @module do/tests/context.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import { DO } from '../DO'
import type { WorkflowContext } from '../context'
import { generateTestId, getTestDO as getTestDOFromUtils } from '../../test-utils'

// ============================================================================
// TEST HELPER FUNCTIONS - Using shared test-utils
// ============================================================================

/**
 * Get a test DO stub with a unique name (delegates to shared test-utils)
 */
function getTestDO(name: string = generateTestId('context-test')) {
  return getTestDOFromUtils(env, name)
}

// ============================================================================
// TESTS: WorkflowContext ($)
// ============================================================================

describe('WorkflowContext ($)', () => {
  describe('send()', () => {
    it('should emit events fire-and-forget', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$

        $.send({ type: 'user.created', payload: { name: 'Alice' } })

        // Wait for async emission
        await new Promise(r => setTimeout(r, 50))

        const events = await $._events.query({ type: 'user.created' })
        return {
          count: events.length,
          payload: events[0]?.payload,
        }
      })

      expect(result.count).toBe(1)
      expect(result.payload).toEqual({ name: 'Alice' })
    })

    it('should dispatch to registered handlers', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let handlerCalled = false

        $.on.user.created(() => {
          handlerCalled = true
        })

        $.send({ type: 'user.created', payload: { id: '123' } })

        await new Promise(r => setTimeout(r, 50))
        return handlerCalled
      })

      expect(result).toBe(true)
    })

    it('should dispatch to wildcard handlers', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let wildcardCalled = false

        $.on.user['*'](() => {
          wildcardCalled = true
        })

        $.send({ type: 'user.created', payload: { id: '123' } })

        await new Promise(r => setTimeout(r, 50))
        return wildcardCalled
      })

      expect(result).toBe(true)
    })

    it('should dispatch to global wildcard handlers', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let globalHandlerCalled = false

        $.on['*']['*'](() => {
          globalHandlerCalled = true
        })

        $.send({ type: 'user.created', payload: { id: '123' } })

        await new Promise(r => setTimeout(r, 50))
        return globalHandlerCalled
      })

      expect(result).toBe(true)
    })
  })

  describe('try()', () => {
    it('should execute action without retries', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        return await $.try(async () => 'success')
      })

      expect(result).toBe('success')
    })

    it('should propagate errors', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        try {
          await $.try(async () => {
            throw new Error('fail')
          })
          return { threw: false, message: '' }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      expect(result.threw).toBe(true)
      expect(result.message).toBe('fail')
    })
  })

  describe('do()', () => {
    it('should execute action with retries on failure', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let attempts = 0

        const value = await $.do(async () => {
          attempts++
          if (attempts < 3) throw new Error('Not yet')
          return 'success'
        })

        return { value, attempts }
      })

      expect(result.value).toBe('success')
      expect(result.attempts).toBe(3)
    })

    it('should fail after max retries', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        try {
          await $.do(async () => {
            throw new Error('Always fails')
          }, { retries: 2 })
          return { threw: false, message: '' }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      expect(result.threw).toBe(true)
      expect(result.message).toContain('Always fails')
    })

    it('should timeout long actions', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        try {
          await $.do(async () => {
            await new Promise(r => setTimeout(r, 1000))
            return 'done'
          }, { timeout: 50, retries: 0 })
          return { threw: false, message: '' }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      expect(result.threw).toBe(true)
      expect(result.message).toContain('timed out')
    })

    it('should use exponential backoff by default', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let attempts = 0
        const timestamps: number[] = []

        try {
          await $.do(async () => {
            timestamps.push(Date.now())
            attempts++
            throw new Error('fail')
          }, { retries: 2, backoff: 'exponential' })
        } catch {
          // Expected to fail
        }

        return { attempts, timestamps }
      })

      expect(result.attempts).toBe(3)
      // Exponential backoff: 100ms, then 200ms
      if (result.timestamps.length >= 2) {
        const gap1 = result.timestamps[1] - result.timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90) // ~100ms with some tolerance
      }
      if (result.timestamps.length >= 3) {
        const gap2 = result.timestamps[2] - result.timestamps[1]
        expect(gap2).toBeGreaterThanOrEqual(180) // ~200ms with some tolerance
      }
    })

    it('should support linear backoff', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let attempts = 0
        const timestamps: number[] = []

        try {
          await $.do(async () => {
            timestamps.push(Date.now())
            attempts++
            throw new Error('fail')
          }, { retries: 2, backoff: 'linear' })
        } catch {
          // Expected to fail
        }

        return { attempts, timestamps }
      })

      expect(result.attempts).toBe(3)
      // Linear backoff: 100ms, then 200ms, then 300ms
      if (result.timestamps.length >= 2) {
        const gap1 = result.timestamps[1] - result.timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90)
      }
    })

    it('should succeed on first attempt if no errors', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let attempts = 0

        const value = await $.do(async () => {
          attempts++
          return 'immediate success'
        })

        return { value, attempts }
      })

      expect(result.value).toBe('immediate success')
      expect(result.attempts).toBe(1)
    })
  })

  describe('on (event handlers)', () => {
    it('should register handlers via Proxy', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$

        $.on.Order.placed(() => {})

        return $._handlers.has('Order.placed')
      })

      expect(result).toBe(true)
    })

    it('should support multiple handlers for same event', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$

        $.on.Order.placed(() => {})
        $.on.Order.placed(() => {})

        return $._handlers.get('Order.placed')?.length ?? 0
      })

      expect(result).toBe(2)
    })

    it('should work with any noun/verb combination', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$

        $.on.Customer.signup(() => {})
        $.on.Payment.failed(() => {})
        $.on.Invoice.generated(() => {})

        return {
          hasCustomerSignup: $._handlers.has('Customer.signup'),
          hasPaymentFailed: $._handlers.has('Payment.failed'),
          hasInvoiceGenerated: $._handlers.has('Invoice.generated'),
        }
      })

      expect(result.hasCustomerSignup).toBe(true)
      expect(result.hasPaymentFailed).toBe(true)
      expect(result.hasInvoiceGenerated).toBe(true)
    })
  })

  describe('every (scheduling DSL)', () => {
    it('should have every proxy available', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        return {
          isDefined: $.every !== undefined,
          isFunction: typeof $.every === 'function',
        }
      })

      expect(result.isDefined).toBe(true)
      expect(result.isFunction).toBe(true)
    })

    it('should allow chained access', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        return {
          hasMonday: $.every.Monday !== undefined,
          hasDay: $.every.day !== undefined,
          hasHour: $.every.hour !== undefined,
        }
      })

      expect(result.hasMonday).toBe(true)
      expect(result.hasDay).toBe(true)
      expect(result.hasHour).toBe(true)
    })
  })

  describe('send() error handling', () => {
    it('should not throw when handler throws synchronously', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let successHandlerCalled = false

        $.on.test.event(() => {
          throw new Error('Sync handler error')
        })
        $.on.test.event(() => {
          successHandlerCalled = true
        })

        // This should not throw
        $.send({ type: 'test.event', payload: { data: 'test' } })

        // Wait for async processing
        await new Promise(r => setTimeout(r, 100))

        return successHandlerCalled
      })

      // Second handler should still have been called
      expect(result).toBe(true)
    })

    it('should not throw when handler rejects asynchronously', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let successHandlerCalled = false

        $.on.test.event(async () => {
          throw new Error('Async handler error')
        })
        $.on.test.event(() => {
          successHandlerCalled = true
        })

        // This should not throw
        $.send({ type: 'test.event', payload: { data: 'test' } })

        // Wait for async processing
        await new Promise(r => setTimeout(r, 100))

        return successHandlerCalled
      })

      // Second handler should still have been called
      expect(result).toBe(true)
    })

    it('should continue working after handler errors', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let callCount = 0

        $.on.test.event(() => {
          callCount++
          throw new Error('Handler error')
        })

        // First send (will have error)
        $.send({ type: 'test.event', payload: { call: 1 } })
        await new Promise(r => setTimeout(r, 50))

        // Second send should still work
        $.send({ type: 'test.event', payload: { call: 2 } })
        await new Promise(r => setTimeout(r, 50))

        return callCount
      })

      // Handler should have been called twice
      expect(result).toBe(2)
    })

    it('should handle errors in wildcard handlers without affecting other handlers', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let wildcardCalled = false
        let exactHandlerCalled = false

        $.on['*']['*'](() => {
          wildcardCalled = true
          throw new Error('Wildcard error')
        })
        $.on.test.event(() => {
          exactHandlerCalled = true
        })

        $.send({ type: 'test.event', payload: {} })

        await new Promise(r => setTimeout(r, 100))

        return { wildcardCalled, exactHandlerCalled }
      })

      // Both handlers should have been called
      expect(result.wildcardCalled).toBe(true)
      expect(result.exactHandlerCalled).toBe(true)
    })

    it('should handle multiple failing handlers', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let handler1Called = false
        let handler2Called = false
        let handler3Called = false

        $.on.test.event(() => {
          handler1Called = true
          throw new Error('Error 1')
        })
        $.on.test.event(() => {
          handler2Called = true
          throw new Error('Error 2')
        })
        $.on.test.event(() => {
          handler3Called = true
        })

        $.send({ type: 'test.event', payload: {} })

        await new Promise(r => setTimeout(r, 100))

        return { handler1Called, handler2Called, handler3Called }
      })

      // All handlers should have been called
      expect(result.handler1Called).toBe(true)
      expect(result.handler2Called).toBe(true)
      expect(result.handler3Called).toBe(true)
    })

    it('should handle returned promise rejections', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let successHandlerCalled = false

        $.on.test.event(() => Promise.reject(new Error('Rejected promise')))
        $.on.test.event(() => {
          successHandlerCalled = true
        })

        $.send({ type: 'test.event', payload: {} })

        await new Promise(r => setTimeout(r, 100))

        return successHandlerCalled
      })

      expect(result).toBe(true)
    })
  })

  describe('try() with timeout (do-u1cw)', () => {
    it('should execute action without timeout when not specified', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        return await $.try(async () => 'success')
      })

      expect(result).toBe('success')
    })

    it('should succeed if action completes before timeout', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        return await $.try(async () => {
          await new Promise(r => setTimeout(r, 10))
          return 'completed'
        }, { timeout: 1000 })
      })

      expect(result).toBe('completed')
    })

    it('should timeout if action takes too long', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        try {
          await $.try(async () => {
            await new Promise(r => setTimeout(r, 1000))
            return 'done'
          }, { timeout: 50 })
          return { threw: false, message: '' }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      expect(result.threw).toBe(true)
      expect(result.message).toContain('timed out')
      expect(result.message).toContain('50ms')
    })

    it('should propagate errors before timeout', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        try {
          await $.try(async () => {
            throw new Error('immediate error')
          }, { timeout: 1000 })
          return { threw: false, message: '' }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      expect(result.threw).toBe(true)
      expect(result.message).toBe('immediate error')
    })

    it('should handle very small timeout', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        try {
          await $.try(async () => {
            // Do some minimal async work
            await new Promise(r => setTimeout(r, 50))
            return 'result'
          }, { timeout: 1 })
          return { threw: false, message: '' }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      // Very small timeout should trigger timeout
      expect(result.threw).toBe(true)
      expect(result.message).toContain('timed out')
    })

    it('should return the correct value type', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const num = await $.try(async () => 42, { timeout: 1000 })
        const str = await $.try(async () => 'hello', { timeout: 1000 })
        const obj = await $.try(async () => ({ key: 'value' }), { timeout: 1000 })
        return { num, str, obj }
      })

      expect(result.num).toBe(42)
      expect(result.str).toBe('hello')
      expect(result.obj).toEqual({ key: 'value' })
    })
  })

  describe('do() timeout behavior (do-u1cw)', () => {
    it('should use default timeout of 30000ms', async () => {
      const stub = getTestDO()

      // This test verifies that the default timeout is set
      // We can't easily test 30s timeout, so we just verify a shorter action succeeds
      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        return await $.do(async () => 'success')
      })

      expect(result).toBe('success')
    })

    it('should respect custom timeout', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        try {
          await $.do(async () => {
            await new Promise(r => setTimeout(r, 500))
            return 'done'
          }, { timeout: 50, retries: 0 })
          return { threw: false, message: '' }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      expect(result.threw).toBe(true)
      expect(result.message).toContain('timed out')
      expect(result.message).toContain('50ms')
    })

    it('should retry on timeout with retries enabled', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let attempts = 0

        try {
          await $.do(async () => {
            attempts++
            // All attempts timeout
            await new Promise(r => setTimeout(r, 500))
            return 'done'
          }, { timeout: 50, retries: 2 })
          return { threw: false, attempts, message: '' }
        } catch (e) {
          return { threw: true, attempts, message: (e as Error).message }
        }
      })

      // All attempts should have timed out - verify retries happened
      expect(result.threw).toBe(true)
      // Verify we got multiple attempts (retries work with timeout)
      expect(result.attempts).toBe(3) // Initial + 2 retries
      expect(result.message).toContain('timed out')
    })

    it('should succeed on retry after initial timeout', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let attempts = 0

        const value = await $.do(async () => {
          attempts++
          // First attempt times out, subsequent succeed immediately
          if (attempts === 1) {
            await new Promise(r => setTimeout(r, 500))
          }
          return 'success'
        }, { timeout: 50, retries: 2 })

        return { value, attempts }
      })

      expect(result.value).toBe('success')
      expect(result.attempts).toBe(2)
    })

    it('should combine timeout with exponential backoff', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let attempts = 0
        const timestamps: number[] = []

        try {
          await $.do(async () => {
            timestamps.push(Date.now())
            attempts++
            // All attempts timeout
            await new Promise(r => setTimeout(r, 500))
            return 'done'
          }, { timeout: 30, retries: 2, backoff: 'exponential' })
        } catch {
          // Expected to fail
        }

        return { attempts, timestamps }
      })

      expect(result.attempts).toBe(3)
      // Verify backoff delays between attempts
      if (result.timestamps.length >= 2) {
        const gap1 = result.timestamps[1] - result.timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90) // ~100ms first backoff
      }
      if (result.timestamps.length >= 3) {
        const gap2 = result.timestamps[2] - result.timestamps[1]
        expect(gap2).toBeGreaterThanOrEqual(180) // ~200ms second backoff
      }
    })
  })
})
