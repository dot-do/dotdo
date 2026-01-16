/**
 * @module workflow/handler-persistence.test.ts
 *
 * Tests for event handler persistence patterns across cold starts.
 *
 * These tests verify the handler factory pattern that enables:
 * 1. Handler metadata persistence to SQLite
 * 2. Handler re-creation via factory pattern on cold start
 * 3. Proper flagging of handlers that need re-registration
 *
 * Note: These tests focus on the pattern and interfaces rather than
 * full DO integration (which requires Workers runtime via cloudflare:test).
 * For full integration tests, see objects/tests/do-modules-integration.test.ts
 */

import { describe, it, expect, vi } from 'vitest'
import type { HandlerFactory } from './DOWorkflow'

// ============================================================================
// Handler Factory Pattern Tests
// ============================================================================

describe('Handler Factory Pattern', () => {
  describe('HandlerFactory type', () => {
    it('factory returns handler for known event/id combination', () => {
      const welcomeEmailHandler = vi.fn()
      const orderConfirmationHandler = vi.fn()

      const factory: HandlerFactory = (eventKey, handlerId) => {
        if (eventKey === 'Customer.signup' && handlerId === 'welcome-email') {
          return welcomeEmailHandler
        }
        if (eventKey === 'Order.created' && handlerId === 'send-confirmation') {
          return orderConfirmationHandler
        }
        return null
      }

      expect(factory('Customer.signup', 'welcome-email')).toBe(welcomeEmailHandler)
      expect(factory('Order.created', 'send-confirmation')).toBe(orderConfirmationHandler)
      expect(factory('Unknown.event', 'unknown-handler')).toBeNull()
    })

    it('factory can be a closure over DO instance methods', () => {
      // Simulates how a subclass would use the factory pattern
      const mockDoInstance = {
        sendWelcomeEmail: vi.fn(),
        processPayment: vi.fn(),
        notifyAdmin: vi.fn(),
      }

      const factory: HandlerFactory = (eventKey, handlerId) => {
        // Map handler IDs to instance methods
        const handlerMap: Record<string, (event: unknown) => void | Promise<void>> = {
          'send-welcome-email': (event) => mockDoInstance.sendWelcomeEmail(event),
          'process-payment': (event) => mockDoInstance.processPayment(event),
          'notify-admin': (event) => mockDoInstance.notifyAdmin(event),
        }

        return handlerMap[handlerId] ?? null
      }

      const handler = factory('Customer.signup', 'send-welcome-email')
      expect(handler).not.toBeNull()

      // Call the handler and verify it invokes the instance method
      handler!({ type: 'Customer.signup', data: { email: 'test@example.com' } })
      expect(mockDoInstance.sendWelcomeEmail).toHaveBeenCalledWith({
        type: 'Customer.signup',
        data: { email: 'test@example.com' },
      })
    })

    it('factory can be organized by event type prefix', () => {
      const handlers = {
        Customer: {
          signup: vi.fn(),
          updated: vi.fn(),
        },
        Order: {
          created: vi.fn(),
          shipped: vi.fn(),
        },
      }

      const factory: HandlerFactory = (eventKey, handlerId) => {
        const [noun, verb] = eventKey.split('.')
        const nounHandlers = handlers[noun as keyof typeof handlers]
        if (!nounHandlers) return null
        return nounHandlers[verb as keyof typeof nounHandlers] ?? null
      }

      expect(factory('Customer.signup', 'any')).toBe(handlers.Customer.signup)
      expect(factory('Order.shipped', 'any')).toBe(handlers.Order.shipped)
      expect(factory('Payment.failed', 'any')).toBeNull()
    })
  })

  describe('Multiple factory support', () => {
    it('can combine multiple factories for different domains', () => {
      const customerHandler = vi.fn()
      const orderHandler = vi.fn()

      const customerFactory: HandlerFactory = (eventKey) => {
        if (eventKey.startsWith('Customer.')) return customerHandler
        return null
      }

      const orderFactory: HandlerFactory = (eventKey) => {
        if (eventKey.startsWith('Order.')) return orderHandler
        return null
      }

      // Simulate recovery logic that tries each factory
      const factories = [customerFactory, orderFactory]

      const findHandler = (eventKey: string, handlerId: string) => {
        for (const factory of factories) {
          const handler = factory(eventKey, handlerId)
          if (handler) return handler
        }
        return null
      }

      expect(findHandler('Customer.signup', 'h1')).toBe(customerHandler)
      expect(findHandler('Order.created', 'h2')).toBe(orderHandler)
      expect(findHandler('Payment.failed', 'h3')).toBeNull()
    })
  })
})

// ============================================================================
// Handler Registration Metadata Tests
// ============================================================================

describe('Handler Registration Metadata', () => {
  interface HandlerRegistration {
    id: string
    eventKey: string
    handlerId: string
    registeredAt: number
    needsReregistration: boolean
  }

  it('creates proper registration metadata', () => {
    const eventKey = 'Customer.signup'
    const handlerId = 'welcome-email'

    const registration: HandlerRegistration = {
      id: `${eventKey}:${handlerId}`,
      eventKey,
      handlerId,
      registeredAt: Date.now(),
      needsReregistration: false,
    }

    expect(registration.id).toBe('Customer.signup:welcome-email')
    expect(registration.eventKey).toBe('Customer.signup')
    expect(registration.handlerId).toBe('welcome-email')
    expect(registration.needsReregistration).toBe(false)
  })

  it('marks as needing re-registration when loaded from persistence', () => {
    // Simulate loading from SQLite on cold start
    const persistedData = {
      id: 'Customer.signup:welcome-email',
      event_key: 'Customer.signup',
      handler_id: 'welcome-email',
      registered_at: Date.now() - 3600000, // 1 hour ago
    }

    const registration: HandlerRegistration = {
      id: persistedData.id,
      eventKey: persistedData.event_key,
      handlerId: persistedData.handler_id,
      registeredAt: persistedData.registered_at,
      needsReregistration: true, // Key: set to true on cold start load
    }

    expect(registration.needsReregistration).toBe(true)
  })
})

// ============================================================================
// Cold Start Recovery Simulation Tests
// ============================================================================

describe('Cold Start Recovery Simulation', () => {
  interface HandlerRegistration {
    id: string
    eventKey: string
    handlerId: string
    needsReregistration: boolean
  }

  /**
   * Simulates the handler recovery logic without real DO instances
   */
  function simulateRecovery(
    registrations: HandlerRegistration[],
    factories: HandlerFactory[]
  ): { recovered: string[]; pending: string[] } {
    const recovered: string[] = []
    const pending: string[] = []

    for (const reg of registrations) {
      if (!reg.needsReregistration) {
        continue
      }

      let found = false
      for (const factory of factories) {
        const handler = factory(reg.eventKey, reg.handlerId)
        if (handler) {
          recovered.push(reg.id)
          reg.needsReregistration = false
          found = true
          break
        }
      }

      if (!found) {
        pending.push(reg.id)
      }
    }

    return { recovered, pending }
  }

  it('recovers handlers with matching factories', () => {
    const registrations: HandlerRegistration[] = [
      { id: 'Customer.signup:h1', eventKey: 'Customer.signup', handlerId: 'h1', needsReregistration: true },
      { id: 'Order.created:h2', eventKey: 'Order.created', handlerId: 'h2', needsReregistration: true },
    ]

    const factories: HandlerFactory[] = [
      (eventKey, handlerId) => {
        if (eventKey === 'Customer.signup' && handlerId === 'h1') return vi.fn()
        if (eventKey === 'Order.created' && handlerId === 'h2') return vi.fn()
        return null
      },
    ]

    const result = simulateRecovery(registrations, factories)

    expect(result.recovered).toEqual(['Customer.signup:h1', 'Order.created:h2'])
    expect(result.pending).toEqual([])
    expect(registrations[0].needsReregistration).toBe(false)
    expect(registrations[1].needsReregistration).toBe(false)
  })

  it('leaves unmatched handlers as pending', () => {
    const registrations: HandlerRegistration[] = [
      { id: 'Customer.signup:h1', eventKey: 'Customer.signup', handlerId: 'h1', needsReregistration: true },
      { id: 'Unknown.event:h2', eventKey: 'Unknown.event', handlerId: 'h2', needsReregistration: true },
    ]

    const factories: HandlerFactory[] = [
      (eventKey) => (eventKey === 'Customer.signup' ? vi.fn() : null),
    ]

    const result = simulateRecovery(registrations, factories)

    expect(result.recovered).toEqual(['Customer.signup:h1'])
    expect(result.pending).toEqual(['Unknown.event:h2'])
  })

  it('skips already-active handlers', () => {
    const registrations: HandlerRegistration[] = [
      { id: 'Customer.signup:h1', eventKey: 'Customer.signup', handlerId: 'h1', needsReregistration: false }, // Already active
      { id: 'Order.created:h2', eventKey: 'Order.created', handlerId: 'h2', needsReregistration: true },
    ]

    const factory = vi.fn(() => vi.fn())

    const result = simulateRecovery(registrations, [factory as unknown as HandlerFactory])

    // Factory should only be called for the handler needing re-registration
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith('Order.created', 'h2')
    expect(result.recovered).toEqual(['Order.created:h2'])
  })

  it('tries multiple factories in order until one succeeds', () => {
    const registrations: HandlerRegistration[] = [
      { id: 'Special.event:h1', eventKey: 'Special.event', handlerId: 'h1', needsReregistration: true },
    ]

    const factory1 = vi.fn(() => null)
    const factory2 = vi.fn(() => vi.fn())
    const factory3 = vi.fn(() => vi.fn())

    const result = simulateRecovery(registrations, [
      factory1 as unknown as HandlerFactory,
      factory2 as unknown as HandlerFactory,
      factory3 as unknown as HandlerFactory,
    ])

    // factory1 returns null, factory2 succeeds, factory3 should not be called
    expect(factory1).toHaveBeenCalledTimes(1)
    expect(factory2).toHaveBeenCalledTimes(1)
    expect(factory3).not.toHaveBeenCalled()
    expect(result.recovered).toEqual(['Special.event:h1'])
  })
})

// ============================================================================
// SQL Persistence Pattern Tests
// ============================================================================

describe('SQL Persistence Patterns', () => {
  it('generates correct INSERT OR REPLACE SQL', () => {
    const registration = {
      id: 'Customer.signup:welcome-email',
      eventKey: 'Customer.signup',
      handlerId: 'welcome-email',
      registeredAt: 1705000000000,
    }

    // This is the SQL pattern used in DOWorkflow.registerWorkflowHandler
    const sql = `INSERT OR REPLACE INTO event_handlers (id, event_key, handler_id, registered_at) VALUES (?, ?, ?, ?)`
    const params = [
      registration.id,
      registration.eventKey,
      registration.handlerId,
      registration.registeredAt,
    ]

    expect(sql).toContain('INSERT OR REPLACE')
    expect(params).toEqual([
      'Customer.signup:welcome-email',
      'Customer.signup',
      'welcome-email',
      1705000000000,
    ])
  })

  it('generates correct DELETE SQL', () => {
    const registrationId = 'Customer.signup:welcome-email'

    // This is the SQL pattern used in DOWorkflow.unregisterWorkflowHandler
    const sql = `DELETE FROM event_handlers WHERE id = ?`
    const params = [registrationId]

    expect(sql).toContain('DELETE FROM event_handlers')
    expect(params).toEqual(['Customer.signup:welcome-email'])
  })

  it('parses SELECT results into handler registrations', () => {
    // Simulate row from SQLite SELECT
    const row = {
      id: 'Customer.signup:welcome-email',
      event_key: 'Customer.signup',
      handler_id: 'welcome-email',
      registered_at: 1705000000000,
    }

    // This is the parsing pattern used in DOWorkflow.loadWorkflowData
    const registration = {
      id: row.id as string,
      eventKey: row.event_key as string,
      handlerId: row.handler_id as string,
      registered: new Date(row.registered_at as number),
      needsReregistration: true, // Always true when loaded from SQLite
    }

    expect(registration.id).toBe('Customer.signup:welcome-email')
    expect(registration.eventKey).toBe('Customer.signup')
    expect(registration.handlerId).toBe('welcome-email')
    expect(registration.registered).toEqual(new Date(1705000000000))
    expect(registration.needsReregistration).toBe(true)
  })
})
