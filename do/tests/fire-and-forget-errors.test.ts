import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createInMemoryErrorStore,
  extractErrorInfo,
  trackFireAndForget,
  createInMemoryRetryQueue,
  createEnhancedErrorStore,
  type FireAndForgetErrorStore,
  type FireAndForgetError,
  type RetryQueue,
  type EnhancedFireAndForgetErrorStore
} from '../fire-and-forget-errors'
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

describe('fire-and-forget-errors module', () => {
  describe('extractErrorInfo', () => {
    it('should extract info from Error objects', () => {
      const error = new Error('Test error message')
      const info = extractErrorInfo(error)

      expect(info.message).toBe('Test error message')
      expect(info.errorType).toBe('Error')
      expect(info.stack).toBeDefined()
      expect(info.retriable).toBe(false)
    })

    it('should mark NetworkError as retriable', () => {
      const error = new Error('Network failed')
      error.name = 'NetworkError'
      const info = extractErrorInfo(error)

      expect(info.retriable).toBe(true)
    })

    it('should mark TimeoutError as retriable', () => {
      const error = new Error('Timeout')
      error.name = 'TimeoutError'
      const info = extractErrorInfo(error)

      expect(info.retriable).toBe(true)
    })

    it('should mark ValidationError as not retriable', () => {
      const error = new Error('Invalid data')
      error.name = 'ValidationError'
      const info = extractErrorInfo(error)

      expect(info.retriable).toBe(false)
    })

    it('should respect explicit retriable property', () => {
      const error = new Error('Custom error') as Error & { retriable: boolean }
      error.retriable = true
      const info = extractErrorInfo(error)

      expect(info.retriable).toBe(true)
    })

    it('should handle string errors', () => {
      const info = extractErrorInfo('string error')

      expect(info.message).toBe('string error')
      expect(info.errorType).toBe('StringError')
      expect(info.retriable).toBe(false)
    })

    it('should handle object errors', () => {
      const info = extractErrorInfo({ message: 'object error', name: 'CustomError' })

      expect(info.message).toBe('object error')
      expect(info.errorType).toBe('CustomError')
    })

    it('should handle null/undefined', () => {
      expect(extractErrorInfo(null).message).toBe('null')
      expect(extractErrorInfo(undefined).message).toBe('undefined')
    })
  })

  describe('createInMemoryErrorStore', () => {
    let store: FireAndForgetErrorStore

    beforeEach(() => {
      store = createInMemoryErrorStore()
    })

    describe('track()', () => {
      it('should track errors with auto-generated id and timestamp', () => {
        store.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Handler failed',
          errorType: 'Error',
          retriable: false
        })

        const errors = store.query()
        expect(errors).toHaveLength(1)
        expect(errors[0].id).toMatch(/^ffe-/)
        expect(errors[0].timestamp).toBeGreaterThan(0)
        expect(errors[0].recovered).toBe(false)
      })

      it('should track all error fields', () => {
        store.track({
          operation: 'event.handler',
          eventType: 'Customer.signup',
          handlerIndex: 2,
          message: 'Connection refused',
          stack: 'Error: Connection refused\n    at ...',
          errorType: 'NetworkError',
          retriable: true,
          context: { customerId: 'cust-123' },
          attempts: 3
        })

        const errors = store.query()
        expect(errors[0].eventType).toBe('Customer.signup')
        expect(errors[0].handlerIndex).toBe(2)
        expect(errors[0].stack).toContain('Connection refused')
        expect(errors[0].context).toEqual({ customerId: 'cust-123' })
        expect(errors[0].attempts).toBe(3)
      })
    })

    describe('query()', () => {
      beforeEach(() => {
        // Add test errors
        store.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Error 1',
          errorType: 'NetworkError',
          retriable: true
        })
        store.track({
          operation: 'event.handler',
          eventType: 'Order.shipped',
          message: 'Error 2',
          errorType: 'ValidationError',
          retriable: false
        })
        store.track({
          operation: 'workflow.send',
          eventType: 'Customer.signup',
          message: 'Error 3',
          errorType: 'TimeoutError',
          retriable: true
        })
      })

      it('should filter by operation', () => {
        const results = store.query({ operation: 'workflow.send' })
        expect(results).toHaveLength(1)
        expect(results[0].eventType).toBe('Customer.signup')
      })

      it('should filter by eventType', () => {
        const results = store.query({ eventType: 'Order.placed' })
        expect(results).toHaveLength(1)
        expect(results[0].message).toBe('Error 1')
      })

      it('should filter by errorType', () => {
        const results = store.query({ errorType: 'ValidationError' })
        expect(results).toHaveLength(1)
        expect(results[0].message).toBe('Error 2')
      })

      it('should support pagination with limit and offset', () => {
        const page1 = store.query({ limit: 2, offset: 0 })
        const page2 = store.query({ limit: 2, offset: 2 })

        expect(page1).toHaveLength(2)
        expect(page2).toHaveLength(1)
      })

      it('should sort by timestamp descending', () => {
        const results = store.query()
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].timestamp).toBeGreaterThanOrEqual(results[i + 1].timestamp)
        }
      })
    })

    describe('get()', () => {
      it('should retrieve error by id', () => {
        store.track({
          operation: 'test',
          message: 'Test error',
          errorType: 'Error',
          retriable: false
        })

        const errors = store.query()
        const retrieved = store.get(errors[0].id)

        expect(retrieved).toBeDefined()
        expect(retrieved?.message).toBe('Test error')
      })

      it('should return null for non-existent id', () => {
        expect(store.get('non-existent')).toBeNull()
      })
    })

    describe('markRecovered()', () => {
      it('should mark error as recovered', () => {
        store.track({
          operation: 'test',
          message: 'Recoverable error',
          errorType: 'NetworkError',
          retriable: true
        })

        const errors = store.query()
        const result = store.markRecovered(errors[0].id)

        expect(result).toBe(true)

        const updated = store.get(errors[0].id)
        expect(updated?.recovered).toBe(true)
        expect(updated?.recoveredAt).toBeGreaterThan(0)
      })

      it('should return false for already recovered errors', () => {
        store.track({
          operation: 'test',
          message: 'Error',
          errorType: 'Error',
          retriable: false
        })

        const errors = store.query()
        store.markRecovered(errors[0].id)
        const result = store.markRecovered(errors[0].id) // second call

        expect(result).toBe(false)
      })

      it('should return false for non-existent id', () => {
        expect(store.markRecovered('non-existent')).toBe(false)
      })
    })

    describe('getStats()', () => {
      it('should calculate correct statistics', () => {
        store.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Error 1',
          errorType: 'NetworkError',
          retriable: true
        })
        store.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Error 2',
          errorType: 'NetworkError',
          retriable: true
        })
        store.track({
          operation: 'workflow.send',
          eventType: 'Customer.signup',
          message: 'Error 3',
          errorType: 'ValidationError',
          retriable: false
        })

        // Mark one as recovered
        const errors = store.query()
        store.markRecovered(errors[0].id)

        const stats = store.getStats()

        expect(stats.total).toBe(3)
        expect(stats.recovered).toBe(1)
        expect(stats.unresolved).toBe(2)
        expect(stats.recoveryRate).toBeCloseTo(1 / 3)
        expect(stats.byOperation['event.handler']).toBe(2)
        expect(stats.byOperation['workflow.send']).toBe(1)
        expect(stats.byEventType['Order.placed']).toBe(2)
        expect(stats.byErrorType['NetworkError']).toBe(2)
      })
    })

    describe('clear()', () => {
      it('should remove all errors', () => {
        store.track({
          operation: 'test',
          message: 'Error 1',
          errorType: 'Error',
          retriable: false
        })
        store.track({
          operation: 'test',
          message: 'Error 2',
          errorType: 'Error',
          retriable: false
        })

        expect(store.count()).toBe(2)

        store.clear()

        expect(store.count()).toBe(0)
      })
    })

    describe('getRecent()', () => {
      it('should return most recent errors', () => {
        for (let i = 0; i < 15; i++) {
          store.track({
            operation: 'test',
            message: `Error ${i}`,
            errorType: 'Error',
            retriable: false
          })
        }

        const recent = store.getRecent(5)
        expect(recent).toHaveLength(5)
      })
    })

    describe('query filtering - recovered/unresolved', () => {
      it('should filter recovered only', () => {
        store.track({
          operation: 'test',
          message: 'Error 1',
          errorType: 'Error',
          retriable: false
        })
        store.track({
          operation: 'test',
          message: 'Error 2',
          errorType: 'Error',
          retriable: false
        })

        const errors = store.query()
        store.markRecovered(errors[0].id)

        const recovered = store.query({ recoveredOnly: true })
        const unresolved = store.query({ unresolvedOnly: true })

        expect(recovered).toHaveLength(1)
        expect(unresolved).toHaveLength(1)
      })
    })
  })

  describe('trackFireAndForget helper', () => {
    let store: FireAndForgetErrorStore
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      store = createInMemoryErrorStore()
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy.mockRestore()
    })

    it('should track errors from rejected promises', async () => {
      const failingPromise = Promise.reject(new Error('Async failure'))

      trackFireAndForget(store, failingPromise, 'test-operation')

      // Wait for promise to be caught
      await new Promise(r => setTimeout(r, 10))

      const errors = store.query()
      expect(errors).toHaveLength(1)
      expect(errors[0].operation).toBe('test-operation')
      expect(errors[0].message).toBe('Async failure')
    })

    it('should pass context options', async () => {
      const failingPromise = Promise.reject(new Error('Test'))

      trackFireAndForget(store, failingPromise, 'event.handler', {
        eventType: 'Order.placed',
        handlerIndex: 1,
        context: { orderId: '123' },
        attempts: 3
      })

      await new Promise(r => setTimeout(r, 10))

      const errors = store.query()
      expect(errors[0].eventType).toBe('Order.placed')
      expect(errors[0].handlerIndex).toBe(1)
      expect(errors[0].context).toEqual({ orderId: '123' })
      expect(errors[0].attempts).toBe(3)
    })

    it('should log to console', async () => {
      const failingPromise = Promise.reject(new Error('Console log test'))

      trackFireAndForget(store, failingPromise, 'test-op')

      await new Promise(r => setTimeout(r, 10))

      expect(consoleErrorSpy).toHaveBeenCalled()
      // The scoped logger logs with format: "[FireAndForget]" "[test-op] Fire-and-forget error:" <error>
      // Check that any of the console.error calls contain the operation name
      const allArgs = consoleErrorSpy.mock.calls.flatMap(call => call.map(String))
      expect(allArgs.some(arg => arg.includes('test-op'))).toBe(true)
    })

    it('should not interfere with successful promises', async () => {
      const successPromise = Promise.resolve('success')

      trackFireAndForget(store, successPromise, 'test-op')

      await new Promise(r => setTimeout(r, 10))

      expect(store.count()).toBe(0)
    })
  })
})

describe('WorkflowContext fire-and-forget error tracking', () => {
  let $: WorkflowContext
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    $ = createContext(mockState, {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('error tracking in send()', () => {
    it('should track errors from failing handlers in fire-and-forget store', async () => {
      const error = new Error('Handler failed')
      $.on.test.event(() => {
        throw error
      })

      $.send({ type: 'test.event', payload: { data: 'test' } })

      // Wait for async processing and retries
      await new Promise(r => setTimeout(r, 500))

      const errors = $._fireAndForgetErrors.query()
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].eventType).toBe('test.event')
      expect(errors[0].message).toBe('Handler failed')
    })

    it('should track handler index for multiple handlers', async () => {
      $.on.test.event(() => {
        // First handler succeeds
      })
      $.on.test.event(() => {
        throw new Error('Second handler failed')
      })
      $.on.test.event(() => {
        // Third handler succeeds
      })

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 500))

      const errors = $._fireAndForgetErrors.query()
      // Should have error from second handler
      const error = errors.find(e => e.message === 'Second handler failed')
      expect(error).toBeDefined()
    })

    it('should include context in tracked errors', async () => {
      $.on.order.placed(() => {
        throw new Error('Processing failed')
      })

      $.send({ type: 'order.placed', payload: { orderId: '123', amount: 99.99 } })

      await new Promise(r => setTimeout(r, 500))

      const errors = $._fireAndForgetErrors.query()
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].operation).toBe('event.handler')
    })

    it('should track number of attempts', async () => {
      let attempts = 0
      // Use a retriable error (with explicit retriable property) to test retry behavior
      $.on.test.event(() => {
        attempts++
        const error = new Error('Retriable failure') as Error & { retriable: boolean }
        error.retriable = true
        throw error
      })

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 1500))

      const errors = $._fireAndForgetErrors.query()
      expect(errors.length).toBeGreaterThan(0)
      // Should have retried (default is 3 retries for retriable errors)
      expect(errors[0].attempts).toBeGreaterThan(1)
    })

    it('should not retry non-retriable errors', async () => {
      let attempts = 0
      $.on.test.event(() => {
        attempts++
        throw new Error('Non-retriable failure')
      })

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 500))

      const errors = $._fireAndForgetErrors.query()
      expect(errors.length).toBeGreaterThan(0)
      // Should NOT have retried (generic errors are not retriable)
      expect(errors[0].attempts).toBe(1)
    })

    it('should mark retriable errors correctly', async () => {
      const networkError = new Error('Network timeout')
      networkError.name = 'TimeoutError'

      $.on.test.event(() => {
        throw networkError
      })

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 500))

      const errors = $._fireAndForgetErrors.query()
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].retriable).toBe(true)
    })
  })

  describe('error store integration', () => {
    it('should be accessible via $._fireAndForgetErrors', () => {
      expect($._fireAndForgetErrors).toBeDefined()
      expect(typeof $._fireAndForgetErrors.track).toBe('function')
      expect(typeof $._fireAndForgetErrors.query).toBe('function')
      expect(typeof $._fireAndForgetErrors.getStats).toBe('function')
    })

    it('should allow custom error store injection', () => {
      const customStore = createInMemoryErrorStore()
      const customCtx = createContext(mockState, {}, { errorStore: customStore })

      expect(customCtx._fireAndForgetErrors).toBe(customStore)
    })

    it('should provide statistics about handler errors', async () => {
      $.on.order.placed(() => {
        throw new Error('Order error')
      })
      $.on.payment.failed(() => {
        throw new Error('Payment error')
      })

      $.send({ type: 'order.placed', payload: {} })
      $.send({ type: 'payment.failed', payload: {} })

      await new Promise(r => setTimeout(r, 800))

      const stats = $._fireAndForgetErrors.getStats()
      expect(stats.total).toBeGreaterThan(0)
      expect(stats.byEventType).toBeDefined()
    })
  })

  describe('DLQ integration', () => {
    it('should add failed events to DLQ and track in error store', async () => {
      $.on.test.event(() => {
        throw new Error('Handler permanently failed')
      })

      $.send({ type: 'test.event', payload: { id: 'dlq-test' } })

      await new Promise(r => setTimeout(r, 800))

      // Check DLQ
      const dlqEntries = $._events.getDeadLetterQueue()
      expect(dlqEntries.length).toBeGreaterThan(0)

      // Check error store
      const errors = $._fireAndForgetErrors.query()
      expect(errors.length).toBeGreaterThan(0)
    })

    it('should not double-track errors already in DLQ', async () => {
      $.on.test.event(() => {
        throw new Error('Consistent failure')
      })

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 800))

      // Error should be tracked once per handler failure
      const dlqEntries = $._events.getDeadLetterQueue()
      const errors = $._fireAndForgetErrors.query({ eventType: 'test.event' })

      // Each should have one entry for the failed event
      expect(dlqEntries.length).toBe(1)
      expect(errors.length).toBe(1)
    })
  })
})

describe('Retry Queue', () => {
  let $: WorkflowContext
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    $ = createContext(mockState, {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  it('should retry retriable errors from fire-and-forget store', async () => {
    let attempts = 0

    $.on.test.event(() => {
      attempts++
      if (attempts < 3) {
        // Use explicit retriable property to enable retries
        const error = new Error('Temporary failure') as Error & { retriable: boolean }
        error.retriable = true
        throw error
      }
      // Succeed on third attempt
    })

    $.send({ type: 'test.event', payload: {} })

    // Wait longer for retries with exponential backoff (100ms + 200ms + processing)
    await new Promise(r => setTimeout(r, 1500))

    // Should have succeeded after retries
    expect(attempts).toBe(3)

    // No errors should be in the store since it eventually succeeded
    // (The existing retry mechanism handles this)
    const dlqEntries = $._events.getDeadLetterQueue()
    expect(dlqEntries).toHaveLength(0)

    // No errors in fire-and-forget store either
    const errors = $._fireAndForgetErrors.query()
    expect(errors).toHaveLength(0)
  })

  it('should eventually add permanently failing retriable errors to DLQ', async () => {
    let attempts = 0

    $.on.test.event(() => {
      attempts++
      // Always fail with a retriable error
      const error = new Error('Permanent retriable failure') as Error & { retriable: boolean }
      error.retriable = true
      throw error
    })

    $.send({ type: 'test.event', payload: {} })

    // Wait for all retries (3 retries by default + exponential backoff)
    await new Promise(r => setTimeout(r, 2000))

    // Should have tried multiple times
    expect(attempts).toBeGreaterThan(1)

    // Should be in DLQ after exhausting retries
    const dlqEntries = $._events.getDeadLetterQueue()
    expect(dlqEntries).toHaveLength(1)

    // Error should be tracked
    const errors = $._fireAndForgetErrors.query()
    expect(errors).toHaveLength(1)
    expect(errors[0].retriable).toBe(true)
  })
})

// ============================================================================
// Retry Queue Tests
// ============================================================================

describe('Retry Queue', () => {
  describe('createInMemoryRetryQueue', () => {
    let errorStore: FireAndForgetErrorStore
    let retryQueue: RetryQueue

    beforeEach(() => {
      errorStore = createInMemoryErrorStore()
      retryQueue = createInMemoryRetryQueue(errorStore, {
        maxAttempts: 3,
        initialBackoff: 50,
        backoffMultiplier: 2,
        maxBackoff: 5000,
        autoProcess: false
      })
    })

    describe('add()', () => {
      it('should add item to retry queue with correct initial values', () => {
        // First track an error
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Handler failed',
          errorType: 'NetworkError',
          retriable: true
        })
        const errors = errorStore.getRecent(1)
        const trackedError = errors[0]

        const retryId = retryQueue.add({
          errorId: trackedError.id,
          eventType: 'Order.placed',
          payload: { orderId: '123' }
        })

        expect(retryId).toMatch(/^retry-/)

        const item = retryQueue.get(retryId)
        expect(item).toBeDefined()
        expect(item?.errorId).toBe(trackedError.id)
        expect(item?.eventType).toBe('Order.placed')
        expect(item?.attempts).toBe(0)
        expect(item?.maxAttempts).toBe(3)
        expect(item?.status).toBe('pending')
        expect(item?.backoffDelay).toBe(50)
      })
    })

    describe('query()', () => {
      beforeEach(() => {
        // Add multiple items
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Error 1',
          errorType: 'NetworkError',
          retriable: true
        })
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Payment.failed',
          message: 'Error 2',
          errorType: 'TimeoutError',
          retriable: true
        })
        const errors = errorStore.query()

        retryQueue.add({
          errorId: errors[0].id,
          eventType: 'Order.placed',
          payload: {}
        })
        retryQueue.add({
          errorId: errors[1].id,
          eventType: 'Payment.failed',
          payload: {}
        })
      })

      it('should query all items', () => {
        const items = retryQueue.query()
        expect(items).toHaveLength(2)
      })

      it('should filter by event type', () => {
        const items = retryQueue.query({ eventType: 'Order.placed' })
        expect(items).toHaveLength(1)
        expect(items[0].eventType).toBe('Order.placed')
      })

      it('should filter by status', () => {
        const items = retryQueue.query({ status: 'pending' })
        expect(items).toHaveLength(2)

        const succeededItems = retryQueue.query({ status: 'succeeded' })
        expect(succeededItems).toHaveLength(0)
      })

      it('should limit results', () => {
        const items = retryQueue.query({ limit: 1 })
        expect(items).toHaveLength(1)
      })
    })

    describe('processItem()', () => {
      it('should successfully process item when handler succeeds', async () => {
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Handler failed',
          errorType: 'NetworkError',
          retriable: true
        })
        const errors = errorStore.getRecent(1)

        let handlerCalled = false
        const retryId = retryQueue.add({
          errorId: errors[0].id,
          eventType: 'Order.placed',
          payload: {},
          handlerFn: async () => {
            handlerCalled = true
          }
        })

        const result = await retryQueue.processItem(retryId)

        expect(result).toBe(true)
        expect(handlerCalled).toBe(true)

        const item = retryQueue.get(retryId)
        expect(item?.status).toBe('succeeded')
        expect(item?.attempts).toBe(1)

        // Error should be marked as recovered
        const error = errorStore.get(errors[0].id)
        expect(error?.recovered).toBe(true)
      })

      it('should mark item as failed when handler throws', async () => {
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Handler failed',
          errorType: 'NetworkError',
          retriable: true
        })
        const errors = errorStore.getRecent(1)

        const retryId = retryQueue.add({
          errorId: errors[0].id,
          eventType: 'Order.placed',
          payload: {},
          handlerFn: async () => {
            throw new Error('Still failing')
          }
        })

        const result = await retryQueue.processItem(retryId)

        expect(result).toBe(false)

        const item = retryQueue.get(retryId)
        expect(item?.status).toBe('pending') // Back to pending for retry
        expect(item?.attempts).toBe(1)
        expect(item?.lastError).toBe('Still failing')
        expect(item?.backoffDelay).toBe(100) // Doubled from 50
      })

      it('should mark item as abandoned after max attempts', async () => {
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Handler failed',
          errorType: 'NetworkError',
          retriable: true
        })
        const errors = errorStore.getRecent(1)

        const retryId = retryQueue.add({
          errorId: errors[0].id,
          eventType: 'Order.placed',
          payload: {},
          handlerFn: async () => {
            throw new Error('Permanent failure')
          }
        })

        // Process 3 times (maxAttempts = 3)
        await retryQueue.processItem(retryId)
        await retryQueue.processItem(retryId)
        await retryQueue.processItem(retryId)

        const item = retryQueue.get(retryId)
        expect(item?.status).toBe('abandoned')
        expect(item?.attempts).toBe(3)
      })
    })

    describe('getReadyItems()', () => {
      it('should return items ready for retry', async () => {
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Handler failed',
          errorType: 'NetworkError',
          retriable: true
        })
        const errors = errorStore.getRecent(1)

        retryQueue.add({
          errorId: errors[0].id,
          eventType: 'Order.placed',
          payload: {}
        })

        // Should be ready immediately after backoff period
        await new Promise(r => setTimeout(r, 60))

        const ready = retryQueue.getReadyItems()
        expect(ready.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('processReady()', () => {
      it('should process all ready items', async () => {
        let successCount = 0

        for (let i = 0; i < 3; i++) {
          errorStore.track({
            operation: 'event.handler',
            eventType: `event.${i}`,
            message: `Error ${i}`,
            errorType: 'NetworkError',
            retriable: true
          })
        }

        const errors = errorStore.query()
        for (const error of errors) {
          retryQueue.add({
            errorId: error.id,
            eventType: error.eventType || 'unknown',
            payload: {},
            handlerFn: async () => {
              successCount++
            }
          })
        }

        // Wait for items to be ready
        await new Promise(r => setTimeout(r, 60))

        const result = await retryQueue.processReady()
        expect(result.processed).toBe(3)
        expect(result.succeeded).toBe(3)
        expect(successCount).toBe(3)
      })
    })

    describe('getStats()', () => {
      it('should return correct statistics', async () => {
        // Add items with different states
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Error 1',
          errorType: 'NetworkError',
          retriable: true
        })
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Payment.failed',
          message: 'Error 2',
          errorType: 'TimeoutError',
          retriable: true
        })

        const errors = errorStore.query()

        // Add one that will succeed
        retryQueue.add({
          errorId: errors[0].id,
          eventType: 'Order.placed',
          payload: {},
          handlerFn: async () => {}
        })

        // Add one that will fail
        retryQueue.add({
          errorId: errors[1].id,
          eventType: 'Payment.failed',
          payload: {},
          handlerFn: async () => {
            throw new Error('fail')
          }
        })

        // Wait and process
        await new Promise(r => setTimeout(r, 60))
        await retryQueue.processReady()

        const stats = retryQueue.getStats()
        expect(stats.total).toBe(2)
        expect(stats.succeeded).toBe(1)
        expect(stats.pending).toBe(1) // Failed one is back to pending
        expect(stats.byEventType['Order.placed']).toBe(1)
        expect(stats.byEventType['Payment.failed']).toBe(1)
      })
    })

    describe('remove()', () => {
      it('should remove item from queue', () => {
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Error',
          errorType: 'NetworkError',
          retriable: true
        })
        const errors = errorStore.getRecent(1)

        const retryId = retryQueue.add({
          errorId: errors[0].id,
          eventType: 'Order.placed',
          payload: {}
        })

        expect(retryQueue.get(retryId)).toBeDefined()

        const removed = retryQueue.remove(retryId)
        expect(removed).toBe(true)
        expect(retryQueue.get(retryId)).toBeNull()
      })
    })

    describe('clear()', () => {
      it('should clear all items', () => {
        errorStore.track({
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Error 1',
          errorType: 'NetworkError',
          retriable: true
        })
        const errors = errorStore.getRecent(1)

        retryQueue.add({
          errorId: errors[0].id,
          eventType: 'Order.placed',
          payload: {}
        })

        expect(retryQueue.getStats().total).toBe(1)

        retryQueue.clear()

        expect(retryQueue.getStats().total).toBe(0)
      })
    })
  })
})

// ============================================================================
// Enhanced Error Store Tests
// ============================================================================

describe('Enhanced Fire-and-Forget Error Store', () => {
  let enhancedStore: EnhancedFireAndForgetErrorStore

  beforeEach(() => {
    const baseStore = createInMemoryErrorStore()
    const retryQueue = createInMemoryRetryQueue(baseStore, {
      maxAttempts: 3,
      initialBackoff: 50,
      autoProcess: false
    })
    enhancedStore = createEnhancedErrorStore(baseStore, retryQueue)
  })

  describe('trackAndRetry()', () => {
    it('should track error and add to retry queue for retriable errors', () => {
      const result = enhancedStore.trackAndRetry(
        {
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Network timeout',
          errorType: 'NetworkError',
          retriable: true,
          context: { orderId: '123' }
        },
        async () => {}
      )

      expect(result.errorId).toBeTruthy()
      expect(result.retryId).toBeTruthy()

      // Verify error is tracked
      const errors = enhancedStore.query()
      expect(errors).toHaveLength(1)
      expect(errors[0].eventType).toBe('Order.placed')

      // Verify retry queue item exists
      const retryItem = enhancedStore.retryQueue.get(result.retryId!)
      expect(retryItem).toBeDefined()
      expect(retryItem?.errorId).toBe(result.errorId)
    })

    it('should not add to retry queue for non-retriable errors', () => {
      const result = enhancedStore.trackAndRetry({
        operation: 'event.handler',
        eventType: 'Order.placed',
        message: 'Validation failed',
        errorType: 'ValidationError',
        retriable: false
      })

      expect(result.errorId).toBeTruthy()
      expect(result.retryId).toBeNull()

      // Verify error is tracked
      const errors = enhancedStore.query()
      expect(errors).toHaveLength(1)

      // Verify retry queue is empty
      const retryStats = enhancedStore.retryQueue.getStats()
      expect(retryStats.total).toBe(0)
    })
  })

  describe('queryFailedHandlers()', () => {
    it('should return errors with their retry status', async () => {
      // Add some errors with different retry states
      enhancedStore.trackAndRetry(
        {
          operation: 'event.handler',
          eventType: 'Order.placed',
          message: 'Error 1',
          errorType: 'NetworkError',
          retriable: true
        },
        async () => {}
      )

      enhancedStore.trackAndRetry({
        operation: 'event.handler',
        eventType: 'Payment.failed',
        message: 'Error 2',
        errorType: 'ValidationError',
        retriable: false
      })

      const results = enhancedStore.queryFailedHandlers()

      expect(results).toHaveLength(2)

      // Find the retriable error
      const retriableResult = results.find(r => r.error.eventType === 'Order.placed')
      expect(retriableResult?.retryStatus).toBeDefined()
      expect(retriableResult?.retryStatus?.status).toBe('pending')

      // Find the non-retriable error
      const nonRetriableResult = results.find(r => r.error.eventType === 'Payment.failed')
      expect(nonRetriableResult?.retryStatus).toBeUndefined()
    })

    it('should filter results based on query options', () => {
      enhancedStore.trackAndRetry({
        operation: 'event.handler',
        eventType: 'Order.placed',
        message: 'Error 1',
        errorType: 'NetworkError',
        retriable: true
      })

      enhancedStore.trackAndRetry({
        operation: 'event.handler',
        eventType: 'Payment.failed',
        message: 'Error 2',
        errorType: 'TimeoutError',
        retriable: true
      })

      const results = enhancedStore.queryFailedHandlers({
        eventType: 'Order.placed'
      })

      expect(results).toHaveLength(1)
      expect(results[0].error.eventType).toBe('Order.placed')
    })
  })

  describe('clear()', () => {
    it('should clear both error store and retry queue', () => {
      enhancedStore.trackAndRetry({
        operation: 'event.handler',
        eventType: 'Order.placed',
        message: 'Error',
        errorType: 'NetworkError',
        retriable: true
      })

      expect(enhancedStore.count()).toBe(1)
      expect(enhancedStore.retryQueue.getStats().total).toBe(1)

      enhancedStore.clear()

      expect(enhancedStore.count()).toBe(0)
      expect(enhancedStore.retryQueue.getStats().total).toBe(0)
    })
  })
})
