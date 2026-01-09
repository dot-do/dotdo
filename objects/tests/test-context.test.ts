/**
 * Test Context Factory Tests
 *
 * RED TDD: These tests define the expected interface for createTestContext().
 *
 * createTestContext() is a factory for creating mock execution contexts in tests:
 * - Creates mock execution contexts for all function types
 * - Mock state storage (in-memory)
 * - Mock services (AI, KV, DB, Queue, fetch)
 * - Event capture for assertions
 * - Log capture for assertions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// These imports will work once implementation exists
import {
  createTestContext,
  type TestContextOptions,
  type TestContext,
  type MockAI,
  type MockKV,
  type MockDB,
  type MockQueue,
  type CapturedEvent,
  type CapturedLog,
  mockAI,
  mockKV,
  mockDB,
  mockQueue,
  mockFetch,
} from '../testing/createTestContext'

// Import types from CodeFunctionExecutor for compatibility
import type { ExecutionContext } from '../CodeFunctionExecutor'

// ============================================================================
// TEST DATA FIXTURES
// ============================================================================

const defaultEnv = {
  API_KEY: 'test-api-key',
  DATABASE_URL: 'test-database-url',
}

const defaultState = {
  counter: 0,
  user: { name: 'Test User', email: 'test@example.com' },
}

// ============================================================================
// TESTS
// ============================================================================

describe('createTestContext Factory', () => {
  // ==========================================================================
  // 1. FACTORY CREATION TESTS
  // ==========================================================================

  describe('Factory Creation', () => {
    it('creates a test context with default options', () => {
      const ctx = createTestContext()

      expect(ctx).toBeDefined()
      expect(ctx.functionId).toBeDefined()
      expect(ctx.invocationId).toBeDefined()
      expect(ctx.env).toBeDefined()
      expect(ctx.state).toBeDefined()
      expect(ctx.services).toBeDefined()
      expect(ctx.log).toBeDefined()
      expect(ctx.emit).toBeDefined()
      expect(ctx.signal).toBeDefined()
    })

    it('creates context with custom env vars', () => {
      const ctx = createTestContext({
        env: { API_KEY: 'custom-key', CUSTOM_VAR: 'value' },
      })

      expect(ctx.env.API_KEY).toBe('custom-key')
      expect(ctx.env.CUSTOM_VAR).toBe('value')
    })

    it('creates context with custom function ID', () => {
      const ctx = createTestContext({
        functionId: 'my-custom-function',
      })

      expect(ctx.functionId).toBe('my-custom-function')
    })

    it('creates context with custom invocation ID', () => {
      const ctx = createTestContext({
        invocationId: 'custom-invocation-123',
      })

      expect(ctx.invocationId).toBe('custom-invocation-123')
    })

    it('generates unique IDs when not specified', () => {
      const ctx1 = createTestContext()
      const ctx2 = createTestContext()

      expect(ctx1.invocationId).not.toBe(ctx2.invocationId)
    })

    it('creates context compatible with ExecutionContext interface', () => {
      const ctx = createTestContext()

      // Verify all required ExecutionContext properties exist
      const executionCtx: ExecutionContext = ctx

      expect(executionCtx.functionId).toBeDefined()
      expect(executionCtx.invocationId).toBeDefined()
      expect(executionCtx.env).toBeDefined()
      expect(executionCtx.state.get).toBeInstanceOf(Function)
      expect(executionCtx.state.put).toBeInstanceOf(Function)
      expect(executionCtx.state.delete).toBeInstanceOf(Function)
      expect(executionCtx.state.list).toBeInstanceOf(Function)
      expect(executionCtx.services.ai.generate).toBeInstanceOf(Function)
      expect(executionCtx.services.kv.get).toBeInstanceOf(Function)
      expect(executionCtx.services.kv.put).toBeInstanceOf(Function)
      expect(executionCtx.services.db.query).toBeInstanceOf(Function)
      expect(executionCtx.services.queue.send).toBeInstanceOf(Function)
      expect(executionCtx.services.fetch).toBeInstanceOf(Function)
      expect(executionCtx.log.debug).toBeInstanceOf(Function)
      expect(executionCtx.log.info).toBeInstanceOf(Function)
      expect(executionCtx.log.warn).toBeInstanceOf(Function)
      expect(executionCtx.log.error).toBeInstanceOf(Function)
      expect(executionCtx.emit).toBeInstanceOf(Function)
      expect(executionCtx.signal).toBeInstanceOf(AbortSignal)
    })
  })

  // ==========================================================================
  // 2. STATE MOCKING TESTS
  // ==========================================================================

  describe('State Mocking', () => {
    it('initializes state with provided values', async () => {
      const ctx = createTestContext({
        state: { counter: 42, name: 'test' },
      })

      expect(await ctx.state.get('counter')).toBe(42)
      expect(await ctx.state.get('name')).toBe('test')
    })

    it('returns null for non-existent keys', async () => {
      const ctx = createTestContext()

      expect(await ctx.state.get('non-existent')).toBeNull()
    })

    it('allows putting new values', async () => {
      const ctx = createTestContext()

      await ctx.state.put('newKey', 'newValue')

      expect(await ctx.state.get('newKey')).toBe('newValue')
    })

    it('allows deleting values', async () => {
      const ctx = createTestContext({
        state: { toDelete: 'value' },
      })

      const deleted = await ctx.state.delete('toDelete')

      expect(deleted).toBe(true)
      expect(await ctx.state.get('toDelete')).toBeNull()
    })

    it('returns false when deleting non-existent key', async () => {
      const ctx = createTestContext()

      const deleted = await ctx.state.delete('non-existent')

      expect(deleted).toBe(false)
    })

    it('lists keys with prefix filter', async () => {
      const ctx = createTestContext({
        state: {
          'user:1': { name: 'Alice' },
          'user:2': { name: 'Bob' },
          'post:1': { title: 'Hello' },
        },
      })

      const users = await ctx.state.list({ prefix: 'user:' })

      expect(users.size).toBe(2)
      expect(users.has('user:1')).toBe(true)
      expect(users.has('user:2')).toBe(true)
      expect(users.has('post:1')).toBe(false)
    })

    it('lists all keys when no prefix specified', async () => {
      const ctx = createTestContext({
        state: { a: 1, b: 2, c: 3 },
      })

      const all = await ctx.state.list()

      expect(all.size).toBe(3)
    })

    it('provides getAll helper to retrieve current state snapshot', () => {
      const ctx = createTestContext({
        state: { initial: 'value' },
      })

      const snapshot = ctx.getStateSnapshot()

      expect(snapshot).toEqual({ initial: 'value' })
    })

    it('state snapshot reflects changes', async () => {
      const ctx = createTestContext()

      await ctx.state.put('added', 'value')

      const snapshot = ctx.getStateSnapshot()
      expect(snapshot.added).toBe('value')
    })
  })

  // ==========================================================================
  // 3. MOCK SERVICE INJECTION TESTS
  // ==========================================================================

  describe('Mock Service Injection', () => {
    describe('AI Service', () => {
      it('provides default mock AI service', async () => {
        const ctx = createTestContext()

        const result = await ctx.services.ai.generate({
          model: 'claude-3-sonnet',
          prompt: 'Hello',
        })

        expect(result).toBeDefined()
        expect(result.text).toBeDefined()
      })

      it('allows custom AI mock with fixed response', async () => {
        const ctx = createTestContext({
          services: {
            ai: mockAI({ response: 'Custom AI response' }),
          },
        })

        const result = await ctx.services.ai.generate({
          model: 'any',
          prompt: 'anything',
        })

        expect(result.text).toBe('Custom AI response')
      })

      it('allows AI mock with function response', async () => {
        const ctx = createTestContext({
          services: {
            ai: mockAI({
              response: (opts) => `Processed: ${opts.prompt}`,
            }),
          },
        })

        const result = await ctx.services.ai.generate({
          model: 'claude',
          prompt: 'Hello world',
        })

        expect(result.text).toBe('Processed: Hello world')
      })

      it('tracks AI calls for assertions', async () => {
        const ctx = createTestContext()

        await ctx.services.ai.generate({ model: 'model1', prompt: 'prompt1' })
        await ctx.services.ai.generate({ model: 'model2', prompt: 'prompt2' })

        expect(ctx.getAICalls()).toHaveLength(2)
        expect(ctx.getAICalls()[0]).toEqual({ model: 'model1', prompt: 'prompt1' })
        expect(ctx.getAICalls()[1]).toEqual({ model: 'model2', prompt: 'prompt2' })
      })

      it('allows AI mock to throw errors', async () => {
        const ctx = createTestContext({
          services: {
            ai: mockAI({ error: new Error('AI service unavailable') }),
          },
        })

        await expect(
          ctx.services.ai.generate({ model: 'any', prompt: 'any' })
        ).rejects.toThrow('AI service unavailable')
      })
    })

    describe('KV Service', () => {
      it('provides default mock KV service', async () => {
        const ctx = createTestContext()

        await ctx.services.kv.put('key', 'value')
        const result = await ctx.services.kv.get('key')

        expect(result).toBe('value')
      })

      it('allows custom KV mock with pre-populated data', async () => {
        const ctx = createTestContext({
          services: {
            kv: mockKV({ 'preset-key': 'preset-value' }),
          },
        })

        const result = await ctx.services.kv.get('preset-key')

        expect(result).toBe('preset-value')
      })

      it('returns null for non-existent KV keys', async () => {
        const ctx = createTestContext()

        const result = await ctx.services.kv.get('non-existent')

        expect(result).toBeNull()
      })

      it('tracks KV operations for assertions', async () => {
        const ctx = createTestContext()

        await ctx.services.kv.put('key1', 'value1')
        await ctx.services.kv.get('key2')

        expect(ctx.getKVOperations()).toHaveLength(2)
        expect(ctx.getKVOperations()[0]).toEqual({
          operation: 'put',
          key: 'key1',
          value: 'value1',
        })
        expect(ctx.getKVOperations()[1]).toEqual({
          operation: 'get',
          key: 'key2',
        })
      })
    })

    describe('DB Service', () => {
      it('provides default mock DB service', async () => {
        const ctx = createTestContext()

        const result = await ctx.services.db.query('SELECT * FROM users')

        expect(Array.isArray(result)).toBe(true)
      })

      it('allows custom DB mock with query responses', async () => {
        const ctx = createTestContext({
          services: {
            db: mockDB({
              'SELECT * FROM users': [
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' },
              ],
            }),
          },
        })

        const result = await ctx.services.db.query('SELECT * FROM users')

        expect(result).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ])
      })

      it('allows DB mock with pattern matching', async () => {
        const ctx = createTestContext({
          services: {
            db: mockDB({
              'SELECT * FROM users WHERE id = ?': (params) => [
                { id: params?.[0], name: `User ${params?.[0]}` },
              ],
            }),
          },
        })

        const result = await ctx.services.db.query(
          'SELECT * FROM users WHERE id = ?',
          [42]
        )

        expect(result).toEqual([{ id: 42, name: 'User 42' }])
      })

      it('tracks DB queries for assertions', async () => {
        const ctx = createTestContext()

        await ctx.services.db.query('SELECT * FROM users')
        await ctx.services.db.query('INSERT INTO users VALUES (?)', ['Alice'])

        expect(ctx.getDBQueries()).toHaveLength(2)
        expect(ctx.getDBQueries()[0]).toEqual({
          sql: 'SELECT * FROM users',
          params: undefined,
        })
        expect(ctx.getDBQueries()[1]).toEqual({
          sql: 'INSERT INTO users VALUES (?)',
          params: ['Alice'],
        })
      })
    })

    describe('Queue Service', () => {
      it('provides default mock queue service', async () => {
        const ctx = createTestContext()

        await ctx.services.queue.send({ type: 'email', to: 'user@test.com' })

        // Should not throw
      })

      it('allows custom queue mock', async () => {
        const onSend = vi.fn()
        const ctx = createTestContext({
          services: {
            queue: mockQueue({ onSend }),
          },
        })

        await ctx.services.queue.send({ message: 'test' })

        expect(onSend).toHaveBeenCalledWith({ message: 'test' })
      })

      it('tracks queued messages for assertions', async () => {
        const ctx = createTestContext()

        await ctx.services.queue.send({ type: 'email' })
        await ctx.services.queue.send({ type: 'notification' })

        expect(ctx.getQueuedMessages()).toHaveLength(2)
        expect(ctx.getQueuedMessages()[0]).toEqual({ type: 'email' })
        expect(ctx.getQueuedMessages()[1]).toEqual({ type: 'notification' })
      })
    })

    describe('Fetch Service', () => {
      it('provides default mock fetch service', async () => {
        const ctx = createTestContext()

        const response = await ctx.services.fetch('https://api.example.com')

        expect(response).toBeInstanceOf(Response)
      })

      it('allows custom fetch mock with URL patterns', async () => {
        const ctx = createTestContext({
          services: {
            fetch: mockFetch({
              'https://api.example.com/users': new Response(
                JSON.stringify([{ id: 1 }]),
                { status: 200 }
              ),
              'https://api.example.com/error': new Response('Not found', {
                status: 404,
              }),
            }),
          },
        })

        const usersResponse = await ctx.services.fetch(
          'https://api.example.com/users'
        )
        const errorResponse = await ctx.services.fetch(
          'https://api.example.com/error'
        )

        expect(usersResponse.status).toBe(200)
        expect(await usersResponse.json()).toEqual([{ id: 1 }])
        expect(errorResponse.status).toBe(404)
      })

      it('allows fetch mock with function handler', async () => {
        const ctx = createTestContext({
          services: {
            fetch: mockFetch((url, init) => {
              return new Response(JSON.stringify({ url, method: init?.method || 'GET' }))
            }),
          },
        })

        const response = await ctx.services.fetch('https://test.com', {
          method: 'POST',
        })
        const data = await response.json()

        expect(data.url).toBe('https://test.com')
        expect(data.method).toBe('POST')
      })

      it('tracks fetch calls for assertions', async () => {
        const ctx = createTestContext()

        await ctx.services.fetch('https://api1.com')
        await ctx.services.fetch('https://api2.com', { method: 'POST' })

        expect(ctx.getFetchCalls()).toHaveLength(2)
        expect(ctx.getFetchCalls()[0]).toEqual({
          url: 'https://api1.com',
          init: undefined,
        })
        expect(ctx.getFetchCalls()[1]).toEqual({
          url: 'https://api2.com',
          init: { method: 'POST' },
        })
      })
    })

    describe('Service Override', () => {
      it('allows partial service override', async () => {
        const ctx = createTestContext({
          services: {
            ai: mockAI({ response: 'Custom AI' }),
            // Other services use defaults
          },
        })

        const aiResult = await ctx.services.ai.generate({
          model: 'any',
          prompt: 'any',
        })
        const kvResult = await ctx.services.kv.get('any')

        expect(aiResult.text).toBe('Custom AI')
        expect(kvResult).toBeNull() // Default behavior
      })
    })
  })

  // ==========================================================================
  // 4. EVENT CAPTURE TESTS
  // ==========================================================================

  describe('Event Capture', () => {
    it('captures emitted events', async () => {
      const ctx = createTestContext()

      await ctx.emit('step.started', { step: 1 })
      await ctx.emit('step.completed', { step: 1, result: 'success' })

      expect(ctx.events).toHaveLength(2)
    })

    it('event captures include timestamp', async () => {
      const ctx = createTestContext()
      const before = Date.now()

      await ctx.emit('test.event', { data: 'test' })

      const after = Date.now()
      expect(ctx.events[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(ctx.events[0].timestamp).toBeLessThanOrEqual(after)
    })

    it('event captures include event type and data', async () => {
      const ctx = createTestContext()

      await ctx.emit('custom.event', { key: 'value', number: 42 })

      expect(ctx.events[0]).toEqual({
        type: 'custom.event',
        data: { key: 'value', number: 42 },
        timestamp: expect.any(Number),
      })
    })

    it('provides helper to find events by type', async () => {
      const ctx = createTestContext()

      await ctx.emit('step.started', { step: 1 })
      await ctx.emit('step.completed', { step: 1 })
      await ctx.emit('step.started', { step: 2 })
      await ctx.emit('step.completed', { step: 2 })

      const startedEvents = ctx.getEventsByType('step.started')

      expect(startedEvents).toHaveLength(2)
      expect(startedEvents[0].data).toEqual({ step: 1 })
      expect(startedEvents[1].data).toEqual({ step: 2 })
    })

    it('provides helper to check if event was emitted', async () => {
      const ctx = createTestContext()

      await ctx.emit('important.event', {})

      expect(ctx.hasEvent('important.event')).toBe(true)
      expect(ctx.hasEvent('missing.event')).toBe(false)
    })

    it('provides helper to clear events', async () => {
      const ctx = createTestContext()

      await ctx.emit('event1', {})
      await ctx.emit('event2', {})
      ctx.clearEvents()

      expect(ctx.events).toHaveLength(0)
    })

    it('allows custom event handler', async () => {
      const eventHandler = vi.fn()
      const ctx = createTestContext({
        onEvent: eventHandler,
      })

      await ctx.emit('test.event', { data: 'test' })

      expect(eventHandler).toHaveBeenCalledWith('test.event', { data: 'test' })
    })

    it('custom event handler receives events alongside capture', async () => {
      const eventHandler = vi.fn()
      const ctx = createTestContext({
        onEvent: eventHandler,
      })

      await ctx.emit('test.event', {})

      expect(ctx.events).toHaveLength(1)
      expect(eventHandler).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 5. LOG CAPTURE TESTS
  // ==========================================================================

  describe('Log Capture', () => {
    it('captures debug logs', () => {
      const ctx = createTestContext()

      ctx.log.debug('Debug message', { extra: 'data' })

      expect(ctx.logs).toHaveLength(1)
      expect(ctx.logs[0]).toEqual({
        level: 'debug',
        message: 'Debug message',
        data: { extra: 'data' },
        timestamp: expect.any(Number),
      })
    })

    it('captures info logs', () => {
      const ctx = createTestContext()

      ctx.log.info('Info message')

      expect(ctx.logs[0].level).toBe('info')
      expect(ctx.logs[0].message).toBe('Info message')
    })

    it('captures warn logs', () => {
      const ctx = createTestContext()

      ctx.log.warn('Warning message')

      expect(ctx.logs[0].level).toBe('warn')
    })

    it('captures error logs', () => {
      const ctx = createTestContext()

      ctx.log.error('Error message', { error: 'details' })

      expect(ctx.logs[0].level).toBe('error')
      expect(ctx.logs[0].data).toEqual({ error: 'details' })
    })

    it('provides helper to filter logs by level', () => {
      const ctx = createTestContext()

      ctx.log.debug('debug1')
      ctx.log.info('info1')
      ctx.log.debug('debug2')
      ctx.log.error('error1')

      const debugLogs = ctx.getLogsByLevel('debug')

      expect(debugLogs).toHaveLength(2)
      expect(debugLogs[0].message).toBe('debug1')
      expect(debugLogs[1].message).toBe('debug2')
    })

    it('provides helper to search logs by message', () => {
      const ctx = createTestContext()

      ctx.log.info('Processing user 123')
      ctx.log.info('Completed task')
      ctx.log.info('Processing user 456')

      const processingLogs = ctx.searchLogs('Processing user')

      expect(processingLogs).toHaveLength(2)
    })

    it('provides helper to clear logs', () => {
      const ctx = createTestContext()

      ctx.log.info('log1')
      ctx.log.info('log2')
      ctx.clearLogs()

      expect(ctx.logs).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 6. ABORT SIGNAL TESTS
  // ==========================================================================

  describe('Abort Signal', () => {
    it('provides non-aborted signal by default', () => {
      const ctx = createTestContext()

      expect(ctx.signal.aborted).toBe(false)
    })

    it('allows providing custom AbortSignal', () => {
      const controller = new AbortController()
      controller.abort()

      const ctx = createTestContext({
        signal: controller.signal,
      })

      expect(ctx.signal.aborted).toBe(true)
    })

    it('provides abort helper to trigger cancellation', () => {
      const ctx = createTestContext()

      ctx.abort('User cancelled')

      expect(ctx.signal.aborted).toBe(true)
      expect(ctx.signal.reason).toBe('User cancelled')
    })

    it('abort signal can be used with Promise.race', async () => {
      const ctx = createTestContext()

      const promise = new Promise((_, reject) => {
        ctx.signal.addEventListener('abort', () => {
          reject(new Error('Aborted'))
        })
      })

      // Abort after a short delay
      setTimeout(() => ctx.abort(), 10)

      await expect(promise).rejects.toThrow('Aborted')
    })
  })

  // ==========================================================================
  // 7. RESET AND CLEANUP TESTS
  // ==========================================================================

  describe('Reset and Cleanup', () => {
    it('provides reset method to clear all captures', async () => {
      const ctx = createTestContext({
        state: { initial: 'value' },
      })

      // Perform various operations
      await ctx.emit('event', {})
      ctx.log.info('log')
      await ctx.state.put('new', 'value')
      await ctx.services.ai.generate({ model: 'a', prompt: 'b' })

      // Reset
      ctx.reset()

      expect(ctx.events).toHaveLength(0)
      expect(ctx.logs).toHaveLength(0)
      expect(ctx.getAICalls()).toHaveLength(0)
      expect(ctx.getStateSnapshot()).toEqual({ initial: 'value' }) // Back to initial
    })

    it('reset restores initial state', async () => {
      const ctx = createTestContext({
        state: { counter: 0 },
      })

      await ctx.state.put('counter', 10)
      await ctx.state.put('newKey', 'value')

      ctx.reset()

      expect(await ctx.state.get('counter')).toBe(0)
      expect(await ctx.state.get('newKey')).toBeNull()
    })

    it('reset does not affect configuration', () => {
      const ctx = createTestContext({
        functionId: 'my-function',
        env: { KEY: 'value' },
      })

      ctx.reset()

      expect(ctx.functionId).toBe('my-function')
      expect(ctx.env.KEY).toBe('value')
    })
  })

  // ==========================================================================
  // 8. INTEGRATION WITH HANDLERS
  // ==========================================================================

  describe('Integration with Handlers', () => {
    it('can be used as ExecutionContext in handler', async () => {
      const ctx = createTestContext({
        env: { API_KEY: 'test-key' },
        state: { counter: 5 },
        services: {
          ai: mockAI({ response: 'Hello from AI' }),
        },
      })

      // Simulate a handler function
      const handler = async (input: { message: string }, context: ExecutionContext) => {
        // Use env
        const apiKey = context.env.API_KEY

        // Use state
        const counter = await context.state.get<number>('counter')
        await context.state.put('counter', (counter ?? 0) + 1)

        // Use services
        const aiResult = await context.services.ai.generate({
          model: 'claude',
          prompt: input.message,
        })

        // Emit events
        await context.emit('handler.completed', { result: aiResult.text })

        // Log
        context.log.info('Handler executed', { apiKey })

        return {
          originalCounter: counter,
          aiResponse: aiResult.text,
        }
      }

      const result = await handler({ message: 'Hello' }, ctx)

      expect(result).toEqual({
        originalCounter: 5,
        aiResponse: 'Hello from AI',
      })
      expect(await ctx.state.get('counter')).toBe(6)
      expect(ctx.hasEvent('handler.completed')).toBe(true)
      expect(ctx.logs).toHaveLength(1)
      expect(ctx.getAICalls()).toHaveLength(1)
    })

    it('supports complex handler workflows', async () => {
      const ctx = createTestContext({
        services: {
          db: mockDB({
            'SELECT * FROM users WHERE id = ?': (params) => [
              { id: params?.[0], name: 'Test User' },
            ],
          }),
          ai: mockAI({ response: 'Generated content for Test User' }),
        },
      })

      // Multi-step workflow handler
      const workflowHandler = async (
        input: { userId: number },
        context: ExecutionContext
      ) => {
        await context.emit('workflow.started', { userId: input.userId })

        // Step 1: Fetch user
        const users = await context.services.db.query(
          'SELECT * FROM users WHERE id = ?',
          [input.userId]
        )
        await context.emit('step.completed', { step: 'fetchUser', data: users[0] })

        // Step 2: Generate content
        const aiResult = await context.services.ai.generate({
          model: 'claude',
          prompt: `Generate content for ${(users[0] as { name: string }).name}`,
        })
        await context.emit('step.completed', { step: 'generateContent' })

        // Step 3: Queue notification
        await context.services.queue.send({
          type: 'notification',
          userId: input.userId,
          content: aiResult.text,
        })
        await context.emit('step.completed', { step: 'queueNotification' })

        await context.emit('workflow.completed', {})

        return { content: aiResult.text }
      }

      const result = await workflowHandler({ userId: 123 }, ctx)

      // Verify workflow execution
      expect(result.content).toBe('Generated content for Test User')

      // Verify events were captured in order
      expect(ctx.events).toHaveLength(5)
      expect(ctx.events[0].type).toBe('workflow.started')
      expect(ctx.events[4].type).toBe('workflow.completed')

      // Verify step completion events
      const stepEvents = ctx.getEventsByType('step.completed')
      expect(stepEvents).toHaveLength(3)

      // Verify all services were called
      expect(ctx.getDBQueries()).toHaveLength(1)
      expect(ctx.getAICalls()).toHaveLength(1)
      expect(ctx.getQueuedMessages()).toHaveLength(1)
    })

    it('handles errors in handlers gracefully', async () => {
      const ctx = createTestContext({
        services: {
          ai: mockAI({ error: new Error('AI service failed') }),
        },
      })

      const handler = async (_input: unknown, context: ExecutionContext) => {
        try {
          await context.emit('step.started', {})
          await context.services.ai.generate({ model: 'any', prompt: 'any' })
          await context.emit('step.completed', {})
          return 'success'
        } catch (error) {
          await context.emit('step.failed', {
            error: error instanceof Error ? error.message : String(error),
          })
          throw error
        }
      }

      await expect(handler({}, ctx)).rejects.toThrow('AI service failed')

      // Verify error handling events
      expect(ctx.hasEvent('step.started')).toBe(true)
      expect(ctx.hasEvent('step.completed')).toBe(false)
      expect(ctx.hasEvent('step.failed')).toBe(true)
    })
  })

  // ==========================================================================
  // 9. CONVENIENCE HELPERS
  // ==========================================================================

  describe('Convenience Helpers', () => {
    it('provides assertEventEmitted helper', async () => {
      const ctx = createTestContext()

      await ctx.emit('expected.event', { data: 'test' })

      // Should not throw
      ctx.assertEventEmitted('expected.event')

      // Should throw
      expect(() => ctx.assertEventEmitted('missing.event')).toThrow()
    })

    it('provides assertNoErrors helper', () => {
      const ctx = createTestContext()

      ctx.log.info('Normal log')
      ctx.log.warn('Warning')

      // Should not throw (no errors)
      ctx.assertNoErrors()

      // Add an error
      ctx.log.error('Error message')

      // Should now throw
      expect(() => ctx.assertNoErrors()).toThrow()
    })

    it('provides getLastEvent helper', async () => {
      const ctx = createTestContext()

      await ctx.emit('first', {})
      await ctx.emit('second', {})
      await ctx.emit('third', { final: true })

      const last = ctx.getLastEvent()

      expect(last?.type).toBe('third')
      expect(last?.data).toEqual({ final: true })
    })

    it('provides getLastLog helper', () => {
      const ctx = createTestContext()

      ctx.log.info('first')
      ctx.log.debug('second')
      ctx.log.error('third')

      const last = ctx.getLastLog()

      expect(last?.level).toBe('error')
      expect(last?.message).toBe('third')
    })
  })
})
