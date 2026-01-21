/**
 * Tests for remote event handler registration (do-qkqhm)
 *
 * This tests the ability to register event handlers remotely where:
 * 1. Client stringifies handler via handler.toString()
 * 2. Code is sent to backend via RPC
 * 3. Backend stores and executes the handler with $ context
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  registerRemoteHandler,
  matchRemoteHandlers,
  executeRemoteHandler,
  invokeRemoteHandlers,
  removeRemoteHandler,
  clearRemoteHandlers,
  clearAllRemoteHandlers,
  getAllRemoteHandlers,
  type RemoteEventHandler,
  type CodeEvaluator,
} from '../workflow/events'

/**
 * Test evaluator that uses indirect eval for testing purposes.
 * In production, this would be replaced with a sandboxed evaluator
 * like V8 isolates, WebAssembly, or a custom interpreter.
 *
 * NOTE: The Cloudflare Workers runtime disallows new Function() and eval()
 * for security. This evaluator is only for testing in Node.js environment.
 */
const testEvaluator: CodeEvaluator = async (code, event, context) => {
  // Create context variables in scope
  const contextKeys = Object.keys(context)
  const contextValues = Object.values(context)

  // Build the function with context in scope
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const createFn = new Function(
    ...contextKeys,
    '__code__',
    '__event__',
    `
    'use strict';
    const fn = eval('(' + __code__ + ')');
    return fn(__event__);
    `
  )

  return createFn(...contextValues, code, event)
}

describe('Remote Event Handler Management', () => {
  let remoteHandlers: Map<string, RemoteEventHandler[]>

  beforeEach(() => {
    remoteHandlers = new Map()
  })

  describe('registerRemoteHandler', () => {
    it('should register a remote handler with stringified code', () => {
      const code = 'async (event) => { console.log(event.email) }'

      const handler = registerRemoteHandler(
        'Customer.signup',
        code,
        remoteHandlers,
        'client-123'
      )

      expect(handler.id).toBeDefined()
      expect(handler.id).toMatch(/^rh-/)
      expect(handler.event).toBe('Customer.signup')
      expect(handler.code).toBe(code)
      expect(handler.source).toBe('client-123')
      expect(handler.registeredAt).toBeGreaterThan(0)
    })

    it('should support multiple handlers for the same event', () => {
      registerRemoteHandler('Order.placed', 'handler1', remoteHandlers)
      registerRemoteHandler('Order.placed', 'handler2', remoteHandlers)
      registerRemoteHandler('Order.placed', 'handler3', remoteHandlers)

      const handlers = remoteHandlers.get('Order.placed')
      expect(handlers).toHaveLength(3)
    })

    it('should store handlers in the correct event key', () => {
      registerRemoteHandler('Customer.signup', 'code1', remoteHandlers)
      registerRemoteHandler('Order.placed', 'code2', remoteHandlers)
      registerRemoteHandler('Payment.failed', 'code3', remoteHandlers)

      expect(remoteHandlers.has('Customer.signup')).toBe(true)
      expect(remoteHandlers.has('Order.placed')).toBe(true)
      expect(remoteHandlers.has('Payment.failed')).toBe(true)
    })

    it('should support wildcard event patterns', () => {
      registerRemoteHandler('*.created', 'code1', remoteHandlers)
      registerRemoteHandler('Customer.*', 'code2', remoteHandlers)
      registerRemoteHandler('*.*', 'code3', remoteHandlers)

      expect(remoteHandlers.has('*.created')).toBe(true)
      expect(remoteHandlers.has('Customer.*')).toBe(true)
      expect(remoteHandlers.has('*.*')).toBe(true)
    })
  })

  describe('matchRemoteHandlers', () => {
    it('should match exact event type', () => {
      const handler = registerRemoteHandler('Customer.signup', 'code', remoteHandlers)

      const matched = matchRemoteHandlers('Customer.signup', remoteHandlers)

      expect(matched).toHaveLength(1)
      expect(matched[0]).toBe(handler)
    })

    it('should match noun wildcard (Customer.*)', () => {
      const handler = registerRemoteHandler('Customer.*', 'code', remoteHandlers)

      const matched = matchRemoteHandlers('Customer.signup', remoteHandlers)

      expect(matched).toContain(handler)
    })

    it('should match verb wildcard (*.created)', () => {
      const handler = registerRemoteHandler('*.created', 'code', remoteHandlers)

      const matched = matchRemoteHandlers('Order.created', remoteHandlers)

      expect(matched).toContain(handler)
    })

    it('should match global wildcard (*.*)', () => {
      const handler = registerRemoteHandler('*.*', 'code', remoteHandlers)

      const matched = matchRemoteHandlers('Any.event', remoteHandlers)

      expect(matched).toContain(handler)
    })

    it('should collect all matching handlers in specificity order', () => {
      const exactHandler = registerRemoteHandler('Order.placed', 'exact', remoteHandlers)
      const nounWildcard = registerRemoteHandler('Order.*', 'noun', remoteHandlers)
      const verbWildcard = registerRemoteHandler('*.placed', 'verb', remoteHandlers)
      const globalWildcard = registerRemoteHandler('*.*', 'global', remoteHandlers)

      const matched = matchRemoteHandlers('Order.placed', remoteHandlers)

      expect(matched).toHaveLength(4)
      expect(matched[0]).toBe(exactHandler)
      expect(matched[1]).toBe(nounWildcard)
      expect(matched[2]).toBe(verbWildcard)
      expect(matched[3]).toBe(globalWildcard)
    })

    it('should return empty array for non-matching event', () => {
      registerRemoteHandler('Customer.signup', 'code', remoteHandlers)

      const matched = matchRemoteHandlers('Order.placed', remoteHandlers)

      expect(matched).toHaveLength(0)
    })
  })

  describe('executeRemoteHandler', () => {
    it('should execute a simple handler and return success', async () => {
      const handler: RemoteEventHandler = {
        id: 'test-1',
        event: 'Test.event',
        code: '(event) => { return event.value * 2 }',
        registeredAt: Date.now()
      }

      const result = await executeRemoteHandler(handler, { value: 21 }, { evaluator: testEvaluator })

      expect(result.succeeded).toBe(true)
      expect(result.attempts).toBe(1)
      expect(result.error).toBeUndefined()
    })

    it('should execute an async handler', async () => {
      const handler: RemoteEventHandler = {
        id: 'test-2',
        event: 'Test.event',
        code: 'async (event) => { await Promise.resolve(); return event.name }',
        registeredAt: Date.now()
      }

      const result = await executeRemoteHandler(handler, { name: 'Alice' }, { evaluator: testEvaluator })

      expect(result.succeeded).toBe(true)
    })

    it('should handle handler that throws an error', async () => {
      const handler: RemoteEventHandler = {
        id: 'test-3',
        event: 'Test.event',
        code: '(event) => { throw new Error("Handler error") }',
        registeredAt: Date.now()
      }

      const result = await executeRemoteHandler(handler, {}, { evaluator: testEvaluator })

      expect(result.succeeded).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Handler error')
    })

    it('should handle syntax error in handler code', async () => {
      const handler: RemoteEventHandler = {
        id: 'test-4',
        event: 'Test.event',
        code: '(event => { invalid syntax',
        registeredAt: Date.now()
      }

      const result = await executeRemoteHandler(handler, {}, { evaluator: testEvaluator })

      expect(result.succeeded).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should provide context variables to the handler', async () => {
      const mockContext = {
        send: vi.fn(),
        log: vi.fn((msg: string) => msg)
      }

      const handler: RemoteEventHandler = {
        id: 'test-5',
        event: 'Test.event',
        code: '(event) => { $.log("Hello " + event.name) }',
        registeredAt: Date.now()
      }

      const result = await executeRemoteHandler(handler, { name: 'World' }, {
        context: { $: mockContext },
        evaluator: testEvaluator
      })

      expect(result.succeeded).toBe(true)
      expect(mockContext.log).toHaveBeenCalledWith('Hello World')
    })

    it('should timeout long-running handlers', async () => {
      const handler: RemoteEventHandler = {
        id: 'test-6',
        event: 'Test.event',
        code: 'async (event) => { await new Promise(r => setTimeout(r, 5000)) }',
        registeredAt: Date.now()
      }

      const result = await executeRemoteHandler(handler, {}, { timeout: 100, evaluator: testEvaluator })

      expect(result.succeeded).toBe(false)
      expect(result.error?.message).toContain('timed out')
    })

    it('should handle arrow function with implicit return', async () => {
      const handler: RemoteEventHandler = {
        id: 'test-7',
        event: 'Test.event',
        code: '(event) => event.value + 10',
        registeredAt: Date.now()
      }

      const result = await executeRemoteHandler(handler, { value: 5 }, { evaluator: testEvaluator })

      expect(result.succeeded).toBe(true)
    })

    it('should handle traditional function syntax', async () => {
      const handler: RemoteEventHandler = {
        id: 'test-8',
        event: 'Test.event',
        code: 'function(event) { return event.x + event.y }',
        registeredAt: Date.now()
      }

      const result = await executeRemoteHandler(handler, { x: 3, y: 4 }, { evaluator: testEvaluator })

      expect(result.succeeded).toBe(true)
    })
  })

  describe('invokeRemoteHandlers', () => {
    it('should invoke all matching remote handlers', async () => {
      registerRemoteHandler(
        'Test.event',
        '(event) => { event.results.push("handler1") }',
        remoteHandlers
      )
      registerRemoteHandler(
        'Test.event',
        '(event) => { event.results.push("handler2") }',
        remoteHandlers
      )

      const eventData = { results: [] as string[] }
      const result = await invokeRemoteHandlers('Test.event', eventData, remoteHandlers, { evaluator: testEvaluator })

      expect(result.succeeded).toHaveLength(2)
      expect(result.failed).toHaveLength(0)
      expect(eventData.results).toContain('handler1')
      expect(eventData.results).toContain('handler2')
    })

    it('should separate succeeded and failed handlers', async () => {
      registerRemoteHandler(
        'Test.event',
        '(event) => { /* success */ }',
        remoteHandlers
      )
      registerRemoteHandler(
        'Test.event',
        '(event) => { throw new Error("fail") }',
        remoteHandlers
      )

      const result = await invokeRemoteHandlers('Test.event', {}, remoteHandlers, { evaluator: testEvaluator })

      expect(result.succeeded).toHaveLength(1)
      expect(result.failed).toHaveLength(1)
    })

    it('should return empty arrays when no handlers match', async () => {
      const result = await invokeRemoteHandlers('NoHandlers.event', {}, remoteHandlers, { evaluator: testEvaluator })

      expect(result.succeeded).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
    })

    it('should pass context to all handlers', async () => {
      const calls: string[] = []
      const mockContext = {
        track: (msg: string) => calls.push(msg)
      }

      registerRemoteHandler(
        'Test.event',
        '(event) => { $.track("first") }',
        remoteHandlers
      )
      registerRemoteHandler(
        'Test.event',
        '(event) => { $.track("second") }',
        remoteHandlers
      )

      await invokeRemoteHandlers('Test.event', {}, remoteHandlers, {
        context: { $: mockContext },
        evaluator: testEvaluator
      })

      expect(calls).toContain('first')
      expect(calls).toContain('second')
    })
  })

  describe('removeRemoteHandler', () => {
    it('should remove a handler by ID', () => {
      const handler = registerRemoteHandler('Test.event', 'code', remoteHandlers)

      const removed = removeRemoteHandler(handler.id, remoteHandlers)

      expect(removed).toBe(true)
      expect(matchRemoteHandlers('Test.event', remoteHandlers)).toHaveLength(0)
    })

    it('should return false for non-existent handler', () => {
      const removed = removeRemoteHandler('non-existent-id', remoteHandlers)

      expect(removed).toBe(false)
    })

    it('should only remove the specified handler', () => {
      const handler1 = registerRemoteHandler('Test.event', 'code1', remoteHandlers)
      const handler2 = registerRemoteHandler('Test.event', 'code2', remoteHandlers)

      removeRemoteHandler(handler1.id, remoteHandlers)

      const remaining = matchRemoteHandlers('Test.event', remoteHandlers)
      expect(remaining).toHaveLength(1)
      expect(remaining[0]).toBe(handler2)
    })

    it('should clean up empty event entries', () => {
      const handler = registerRemoteHandler('Test.event', 'code', remoteHandlers)

      removeRemoteHandler(handler.id, remoteHandlers)

      expect(remoteHandlers.has('Test.event')).toBe(false)
    })
  })

  describe('clearRemoteHandlers', () => {
    it('should clear all handlers for a specific event', () => {
      registerRemoteHandler('Test.event', 'code1', remoteHandlers)
      registerRemoteHandler('Test.event', 'code2', remoteHandlers)
      registerRemoteHandler('Other.event', 'code3', remoteHandlers)

      clearRemoteHandlers('Test.event', remoteHandlers)

      expect(remoteHandlers.has('Test.event')).toBe(false)
      expect(remoteHandlers.has('Other.event')).toBe(true)
    })
  })

  describe('clearAllRemoteHandlers', () => {
    it('should clear all remote handlers', () => {
      registerRemoteHandler('Test.event', 'code1', remoteHandlers)
      registerRemoteHandler('Other.event', 'code2', remoteHandlers)
      registerRemoteHandler('Third.event', 'code3', remoteHandlers)

      clearAllRemoteHandlers(remoteHandlers)

      expect(remoteHandlers.size).toBe(0)
    })
  })

  describe('getAllRemoteHandlers', () => {
    it('should return all registered handlers', () => {
      registerRemoteHandler('Event1.test', 'code1', remoteHandlers)
      registerRemoteHandler('Event2.test', 'code2', remoteHandlers)
      registerRemoteHandler('Event2.test', 'code3', remoteHandlers)

      const all = getAllRemoteHandlers(remoteHandlers)

      expect(all).toHaveLength(3)
    })

    it('should return empty array when no handlers registered', () => {
      const all = getAllRemoteHandlers(remoteHandlers)

      expect(all).toHaveLength(0)
    })
  })
})

describe('Handler Code Stringification', () => {
  it('should correctly stringify arrow functions', () => {
    const handler = async (event: { email: string }) => {
      console.log('New customer:', event.email)
    }

    const code = handler.toString()

    expect(code).toContain('=>')
    expect(code).toContain('event.email')
  })

  it('should correctly stringify traditional functions', () => {
    const handler = function processEvent(event: { id: string }) {
      return event.id
    }

    const code = handler.toString()

    expect(code).toContain('function')
    expect(code).toContain('processEvent')
    expect(code).toContain('event.id')
  })

  it('should correctly stringify async functions', () => {
    const handler = async function asyncHandler(event: unknown) {
      await Promise.resolve(event)
    }

    const code = handler.toString()

    expect(code).toContain('async')
    expect(code).toContain('function')
  })

  it('should preserve handler logic in stringified form', async () => {
    // Original handler
    const originalHandler = (event: { value: number }) => event.value * 2

    // Stringify it
    const code = originalHandler.toString()

    // Register as remote handler
    const remoteHandlers = new Map<string, RemoteEventHandler[]>()
    registerRemoteHandler('Test.event', code, remoteHandlers)

    // Execute the remote handler
    const matched = matchRemoteHandlers('Test.event', remoteHandlers)
    const result = await executeRemoteHandler(matched[0], { value: 21 }, { evaluator: testEvaluator })

    expect(result.succeeded).toBe(true)
  })
})
