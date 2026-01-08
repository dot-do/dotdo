import { describe, it, expect, beforeEach } from 'vitest'
import { Domain, resolveHandler, registerDomain, clearDomainRegistry } from './domain'

/**
 * RED Phase Tests for Domain Registry System
 *
 * These tests define the expected behavior of the Domain factory and handler resolution.
 * They will FAIL until the implementation is created in ./domain.ts
 *
 * Related beads issues:
 * - dotdo-1wv: Domain() factory creates domain object
 * - dotdo-s0z: Handlers registered with source code
 * - dotdo-pha: resolveHandler finds handler by path
 */

describe('Domain Registry', () => {
  beforeEach(() => {
    // Clear registry between tests to ensure isolation
    clearDomainRegistry()
  })

  describe('Domain factory (dotdo-1wv)', () => {
    it('creates domain object with name property', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true })
      })

      expect(inventory.name).toBe('Inventory')
    })

    it('creates domain object with handlers object', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
        reserve: async (product, { quantity }, $) => ({ reservationId: '123' })
      })

      expect(inventory.handlers).toBeDefined()
      expect(inventory.handlers.check).toBeDefined()
      expect(inventory.handlers.reserve).toBeDefined()
    })

    it('preserves handler functions that can be called', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true, sku: product.sku })
      })

      // The handler's fn property should be callable
      expect(typeof inventory.handlers.check.fn).toBe('function')
    })

    it('creates unique domains with different names', () => {
      const inventory = Domain('Inventory', {
        check: async () => ({ available: true })
      })
      const payment = Domain('Payment', {
        process: async () => ({ success: true })
      })

      expect(inventory.name).toBe('Inventory')
      expect(payment.name).toBe('Payment')
      expect(inventory.name).not.toBe(payment.name)
    })
  })

  describe('Handler source code capture (dotdo-s0z)', () => {
    it('stores handler source code as string', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true })
      })

      expect(typeof inventory.handlers.check.source).toBe('string')
    })

    it('source contains the function body', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => {
          const result = { available: true, quantity: 42 }
          return result
        }
      })

      // Source should contain recognizable parts of the function
      expect(inventory.handlers.check.source).toContain('available')
      expect(inventory.handlers.check.source).toContain('42')
    })

    it('source contains unique handler code for serialization', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => {
          // This comment should appear in source
          return { available: product.inStock }
        }
      })

      // The source should contain distinctive code from the handler
      expect(inventory.handlers.check.source).toContain('inStock')
    })

    it('each handler has its own source code', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
        reserve: async (product, { quantity }, $) => ({
          reservationId: 'res-123',
          quantity
        })
      })

      expect(inventory.handlers.check.source).not.toBe(inventory.handlers.reserve.source)
      expect(inventory.handlers.reserve.source).toContain('reservationId')
      expect(inventory.handlers.reserve.source).toContain('res-123')
    })
  })

  describe('resolveHandler by path (dotdo-pha)', () => {
    it('finds registered handler by domain and method path', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true })
      })
      registerDomain(inventory)

      const handler = resolveHandler(['Inventory', 'check'])

      expect(handler).toBeDefined()
    })

    it('resolved handler has fn property that is callable', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true })
      })
      registerDomain(inventory)

      const handler = resolveHandler(['Inventory', 'check'])

      expect(typeof handler.fn).toBe('function')
    })

    it('resolved handler has source property', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true })
      })
      registerDomain(inventory)

      const handler = resolveHandler(['Inventory', 'check'])

      expect(typeof handler.source).toBe('string')
      expect(handler.source).toContain('available')
    })

    it('resolves different methods from same domain', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
        reserve: async (product, args, $) => ({ reservationId: 'abc' })
      })
      registerDomain(inventory)

      const checkHandler = resolveHandler(['Inventory', 'check'])
      const reserveHandler = resolveHandler(['Inventory', 'reserve'])

      expect(checkHandler).toBeDefined()
      expect(reserveHandler).toBeDefined()
      expect(checkHandler).not.toBe(reserveHandler)
    })

    it('resolves handlers from multiple registered domains', () => {
      const inventory = Domain('Inventory', {
        check: async () => ({ available: true })
      })
      const payment = Domain('Payment', {
        process: async () => ({ success: true })
      })
      registerDomain(inventory)
      registerDomain(payment)

      const inventoryHandler = resolveHandler(['Inventory', 'check'])
      const paymentHandler = resolveHandler(['Payment', 'process'])

      expect(inventoryHandler).toBeDefined()
      expect(paymentHandler).toBeDefined()
    })

    it('returns undefined for unregistered domain', () => {
      const inventory = Domain('Inventory', {
        check: async () => ({ available: true })
      })
      registerDomain(inventory)

      const handler = resolveHandler(['NonExistent', 'method'])

      expect(handler).toBeUndefined()
    })

    it('returns undefined for unregistered method on valid domain', () => {
      const inventory = Domain('Inventory', {
        check: async () => ({ available: true })
      })
      registerDomain(inventory)

      const handler = resolveHandler(['Inventory', 'nonExistentMethod'])

      expect(handler).toBeUndefined()
    })
  })
})
