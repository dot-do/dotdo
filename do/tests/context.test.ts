import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createContext, type WorkflowContext } from '../context'

// Mock DurableObjectState
const mockState = {
  id: { toString: () => 'test-id' },
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(() => Promise.resolve(new Map())),
  },
} as unknown as DurableObjectState

describe('WorkflowContext ($)', () => {
  let $: WorkflowContext

  beforeEach(() => {
    $ = createContext(mockState, {})
  })

  describe('send()', () => {
    it('should emit events fire-and-forget', async () => {
      $.send({ type: 'user.created', payload: { name: 'Alice' } })

      // Wait for async emission
      await new Promise(r => setTimeout(r, 50))

      const events = await $._events.query({ type: 'user.created' })
      expect(events).toHaveLength(1)
      expect(events[0].payload).toEqual({ name: 'Alice' })
    })

    it('should dispatch to registered handlers', async () => {
      const handler = vi.fn()
      $.on.user.created(handler)

      $.send({ type: 'user.created', payload: { id: '123' } })

      await new Promise(r => setTimeout(r, 50))
      expect(handler).toHaveBeenCalled()
    })

    it('should dispatch to wildcard handlers', async () => {
      const wildcardHandler = vi.fn()
      $.on.user['*'](wildcardHandler)

      $.send({ type: 'user.created', payload: { id: '123' } })

      await new Promise(r => setTimeout(r, 50))
      expect(wildcardHandler).toHaveBeenCalled()
    })

    it('should dispatch to global wildcard handlers', async () => {
      const globalHandler = vi.fn()
      $.on['*']['*'](globalHandler)

      $.send({ type: 'user.created', payload: { id: '123' } })

      await new Promise(r => setTimeout(r, 50))
      expect(globalHandler).toHaveBeenCalled()
    })
  })

  describe('try()', () => {
    it('should execute action without retries', async () => {
      const result = await $.try(async () => 'success')
      expect(result).toBe('success')
    })

    it('should propagate errors', async () => {
      await expect($.try(async () => {
        throw new Error('fail')
      })).rejects.toThrow('fail')
    })
  })

  describe('do()', () => {
    it('should execute action with retries on failure', async () => {
      let attempts = 0

      const result = await $.do(async () => {
        attempts++
        if (attempts < 3) throw new Error('Not yet')
        return 'success'
      })

      expect(result).toBe('success')
      expect(attempts).toBe(3)
    })

    it('should fail after max retries', async () => {
      await expect($.do(async () => {
        throw new Error('Always fails')
      }, { retries: 2 })).rejects.toThrow('Always fails')
    })

    it('should timeout long actions', async () => {
      await expect($.do(async () => {
        await new Promise(r => setTimeout(r, 1000))
        return 'done'
      }, { timeout: 50, retries: 0 })).rejects.toThrow('Timeout')
    })

    it('should use exponential backoff by default', async () => {
      let attempts = 0
      const timestamps: number[] = []

      await expect($.do(async () => {
        timestamps.push(Date.now())
        attempts++
        throw new Error('fail')
      }, { retries: 2, backoff: 'exponential' })).rejects.toThrow()

      expect(attempts).toBe(3)
      // Exponential backoff: 100ms, then 200ms
      if (timestamps.length >= 2) {
        const gap1 = timestamps[1] - timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90) // ~100ms with some tolerance
      }
      if (timestamps.length >= 3) {
        const gap2 = timestamps[2] - timestamps[1]
        expect(gap2).toBeGreaterThanOrEqual(180) // ~200ms with some tolerance
      }
    })

    it('should support linear backoff', async () => {
      let attempts = 0
      const timestamps: number[] = []

      await expect($.do(async () => {
        timestamps.push(Date.now())
        attempts++
        throw new Error('fail')
      }, { retries: 2, backoff: 'linear' })).rejects.toThrow()

      expect(attempts).toBe(3)
      // Linear backoff: 100ms, then 200ms, then 300ms
      if (timestamps.length >= 2) {
        const gap1 = timestamps[1] - timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90)
      }
    })

    it('should succeed on first attempt if no errors', async () => {
      let attempts = 0

      const result = await $.do(async () => {
        attempts++
        return 'immediate success'
      })

      expect(result).toBe('immediate success')
      expect(attempts).toBe(1)
    })
  })

  describe('on (event handlers)', () => {
    it('should register handlers via Proxy', () => {
      const handler = vi.fn()
      $.on.Order.placed(handler)

      expect($._handlers.get('Order.placed')).toContain(handler)
    })

    it('should support multiple handlers for same event', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()

      $.on.Order.placed(h1)
      $.on.Order.placed(h2)

      expect($._handlers.get('Order.placed')).toHaveLength(2)
    })

    it('should work with any noun/verb combination', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      $.on.Customer.signup(handler1)
      $.on.Payment.failed(handler2)
      $.on.Invoice.generated(handler3)

      expect($._handlers.get('Customer.signup')).toContain(handler1)
      expect($._handlers.get('Payment.failed')).toContain(handler2)
      expect($._handlers.get('Invoice.generated')).toContain(handler3)
    })
  })

  describe('every (scheduling DSL)', () => {
    it('should have every proxy available', () => {
      expect($.every).toBeDefined()
      expect(typeof $.every).toBe('function')
    })

    it('should allow chained access (stub)', () => {
      // This is a stub for do-7rf.6.4
      expect($.every.Monday).toBeDefined()
      expect($.every.day).toBeDefined()
      expect($.every.hour).toBeDefined()
    })
  })

  describe('send() error handling', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy.mockRestore()
    })

    it('should not throw when handler throws synchronously', async () => {
      const failingHandler = vi.fn(() => {
        throw new Error('Sync handler error')
      })
      const successHandler = vi.fn()

      $.on.test.event(failingHandler)
      $.on.test.event(successHandler)

      // This should not throw
      $.send({ type: 'test.event', payload: { data: 'test' } })

      // Wait for async processing
      await new Promise(r => setTimeout(r, 100))

      // Second handler should still have been called
      expect(successHandler).toHaveBeenCalled()
      // Error should be logged
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should not throw when handler rejects asynchronously', async () => {
      const failingHandler = vi.fn(async () => {
        throw new Error('Async handler error')
      })
      const successHandler = vi.fn()

      $.on.test.event(failingHandler)
      $.on.test.event(successHandler)

      // This should not throw
      $.send({ type: 'test.event', payload: { data: 'test' } })

      // Wait for async processing
      await new Promise(r => setTimeout(r, 100))

      // Second handler should still have been called
      expect(successHandler).toHaveBeenCalled()
      // Error should be logged
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should continue working after handler errors', async () => {
      const failingHandler = vi.fn(() => {
        throw new Error('Handler error')
      })

      $.on.test.event(failingHandler)

      // First send (will have error)
      $.send({ type: 'test.event', payload: { call: 1 } })
      await new Promise(r => setTimeout(r, 50))

      // Second send should still work
      $.send({ type: 'test.event', payload: { call: 2 } })
      await new Promise(r => setTimeout(r, 50))

      // Handler should have been called twice
      expect(failingHandler).toHaveBeenCalledTimes(2)
    })

    it('should log errors from failing handlers', async () => {
      const error = new Error('Test error for logging')
      const failingHandler = vi.fn(() => {
        throw error
      })

      $.on.test.event(failingHandler)

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 100))

      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should handle errors in wildcard handlers without affecting other handlers', async () => {
      const failingWildcard = vi.fn(() => {
        throw new Error('Wildcard error')
      })
      const exactHandler = vi.fn()

      $.on['*']['*'](failingWildcard)
      $.on.test.event(exactHandler)

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 100))

      // Both handlers should have been called
      expect(failingWildcard).toHaveBeenCalled()
      expect(exactHandler).toHaveBeenCalled()
    })

    it('should handle multiple failing handlers', async () => {
      const handler1 = vi.fn(() => {
        throw new Error('Error 1')
      })
      const handler2 = vi.fn(() => {
        throw new Error('Error 2')
      })
      const handler3 = vi.fn()

      $.on.test.event(handler1)
      $.on.test.event(handler2)
      $.on.test.event(handler3)

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 100))

      // All handlers should have been called
      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
      expect(handler3).toHaveBeenCalled()
    })

    it('should handle returned promise rejections', async () => {
      const handler = vi.fn(() => Promise.reject(new Error('Rejected promise')))
      const successHandler = vi.fn()

      $.on.test.event(handler)
      $.on.test.event(successHandler)

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 100))

      expect(successHandler).toHaveBeenCalled()
    })
  })
})
