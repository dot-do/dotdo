/**
 * Tests for remote event handler registration (do-qkqhm)
 *
 * This tests the ability to register event handlers remotely where:
 * 1. Client stringifies handler via handler.toString()
 * 2. Code is sent to backend via RPC
 * 3. Backend stores and executes the handler with $ context
 *
 * NOTE: Tests for executeRemoteHandler and invokeRemoteHandlers are in
 * utils/tests/remote-handler-execution.test.ts because they require
 * new Function()/eval() which is not available in the workers runtime.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerRemoteHandler,
  matchRemoteHandlers,
  removeRemoteHandler,
  clearRemoteHandlers,
  clearAllRemoteHandlers,
  getAllRemoteHandlers,
  type RemoteEventHandler,
} from '../workflow/events'

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

  // NOTE: executeRemoteHandler and invokeRemoteHandlers tests are in
  // utils/tests/remote-handler-execution.test.ts because they require
  // new Function()/eval() which is not available in the workers runtime.

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

  // NOTE: The execution test is in utils/tests/remote-handler-execution.test.ts
  // because it requires new Function()/eval() which is not available in workers runtime.
})
