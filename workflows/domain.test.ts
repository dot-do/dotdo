import { describe, it, expect, beforeEach, expectTypeOf } from 'vitest'
import { Domain, resolveHandler, registerDomain, clearDomainRegistry, type Handler, type DomainObject } from './domain'

/**
 * Tests for Domain Registry System
 *
 * These tests verify the behavior of the Domain factory and handler resolution.
 *
 * Related beads issues:
 * - dotdo-1wv: Domain() factory creates domain object
 * - dotdo-s0z: Handlers registered with source code
 * - dotdo-pha: resolveHandler finds handler by path
 * - dotdo-f3q: Add type inference to Domain factory
 */

describe('Domain Registry', () => {
  beforeEach(() => {
    // Clear registry between tests to ensure isolation
    clearDomainRegistry()
  })

  describe('Domain factory (dotdo-1wv)', () => {
    it('creates domain object with name property', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
      })

      expect(inventory.name).toBe('Inventory')
    })

    it('creates domain object with handlers object', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
        reserve: async (product, { quantity }, $) => ({ reservationId: '123' }),
      })

      expect(inventory.handlers).toBeDefined()
      expect(inventory.handlers.check).toBeDefined()
      expect(inventory.handlers.reserve).toBeDefined()
    })

    it('preserves handler functions that can be called', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true, sku: product.sku }),
      })

      // The handler's fn property should be callable
      expect(typeof inventory.handlers.check.fn).toBe('function')
    })

    it('creates unique domains with different names', () => {
      const inventory = Domain('Inventory', {
        check: async () => ({ available: true }),
      })
      const payment = Domain('Payment', {
        process: async () => ({ success: true }),
      })

      expect(inventory.name).toBe('Inventory')
      expect(payment.name).toBe('Payment')
      expect(inventory.name).not.toBe(payment.name)
    })
  })

  describe('Handler source code capture (dotdo-s0z)', () => {
    it('stores handler source code as string', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
      })

      expect(typeof inventory.handlers.check.source).toBe('string')
    })

    it('source contains the function body', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => {
          const result = { available: true, quantity: 42 }
          return result
        },
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
        },
      })

      // The source should contain distinctive code from the handler
      expect(inventory.handlers.check.source).toContain('inStock')
    })

    it('each handler has its own source code', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
        reserve: async (product, { quantity }, $) => ({
          reservationId: 'res-123',
          quantity,
        }),
      })

      expect(inventory.handlers.check.source).not.toBe(inventory.handlers.reserve.source)
      expect(inventory.handlers.reserve.source).toContain('reservationId')
      expect(inventory.handlers.reserve.source).toContain('res-123')
    })
  })

  describe('resolveHandler by path (dotdo-pha)', () => {
    it('finds registered handler by domain and method path', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
      })
      registerDomain(inventory)

      const handler = resolveHandler(['Inventory', 'check'])

      expect(handler).toBeDefined()
    })

    it('resolved handler has fn property that is callable', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
      })
      registerDomain(inventory)

      const handler = resolveHandler(['Inventory', 'check'])

      expect(typeof handler.fn).toBe('function')
    })

    it('resolved handler has source property', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
      })
      registerDomain(inventory)

      const handler = resolveHandler(['Inventory', 'check'])

      expect(typeof handler.source).toBe('string')
      expect(handler.source).toContain('available')
    })

    it('resolves different methods from same domain', () => {
      const inventory = Domain('Inventory', {
        check: async (product, _, $) => ({ available: true }),
        reserve: async (product, args, $) => ({ reservationId: 'abc' }),
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
        check: async () => ({ available: true }),
      })
      const payment = Domain('Payment', {
        process: async () => ({ success: true }),
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
        check: async () => ({ available: true }),
      })
      registerDomain(inventory)

      const handler = resolveHandler(['NonExistent', 'method'])

      expect(handler).toBeUndefined()
    })

    it('returns undefined for unregistered method on valid domain', () => {
      const inventory = Domain('Inventory', {
        check: async () => ({ available: true }),
      })
      registerDomain(inventory)

      const handler = resolveHandler(['Inventory', 'nonExistentMethod'])

      expect(handler).toBeUndefined()
    })
  })

  describe('Type inference (dotdo-f3q)', () => {
    // These tests verify TypeScript type inference works correctly
    // They use vitest's expectTypeOf for compile-time type checks

    it('infers handler function types from definition', () => {
      interface Product {
        sku: string
        price: number
      }

      const inventory = Domain('Inventory', {
        check: async (product: Product, _args: unknown, $: unknown) => ({
          available: true,
          sku: product.sku,
        }),
      })

      // The handler should have the correct function type
      const checkHandler = inventory.handlers.check
      expectTypeOf(checkHandler.fn).toBeFunction()
      expectTypeOf(checkHandler.source).toBeString()

      // Handler fn should be callable with correct arguments
      const result = checkHandler.fn({ sku: 'ABC123', price: 99.99 }, {}, {})
      expectTypeOf(result).toMatchTypeOf<Promise<{ available: boolean; sku: string }>>()
    })

    it('preserves multiple handler types in same domain', () => {
      interface Product {
        id: string
      }

      interface ReserveArgs {
        quantity: number
      }

      const inventory = Domain('Inventory', {
        check: async (product: Product, _: unknown, $: unknown) => ({
          available: true,
        }),
        reserve: async (product: Product, args: ReserveArgs, $: unknown) => ({
          reservationId: `res-${product.id}`,
          quantity: args.quantity,
        }),
      })

      // Both handlers should have their specific types preserved
      const checkResult = inventory.handlers.check.fn({ id: 'p1' }, {}, {})
      const reserveResult = inventory.handlers.reserve.fn({ id: 'p1' }, { quantity: 5 }, {})

      expectTypeOf(checkResult).toMatchTypeOf<Promise<{ available: boolean }>>()
      expectTypeOf(reserveResult).toMatchTypeOf<Promise<{ reservationId: string; quantity: number }>>()
    })

    it('DomainObject type correctly wraps handlers', () => {
      const domain = Domain('Test', {
        action: async (ctx: { name: string }, args: { value: number }, $: unknown) => ({
          result: ctx.name + args.value,
        }),
      })

      // DomainObject should have name and handlers
      expectTypeOf(domain.name).toBeString()
      expectTypeOf(domain.handlers).toBeObject()

      // Handlers should be wrapped with fn and source
      expectTypeOf(domain.handlers.action).toMatchTypeOf<Handler>()
      expectTypeOf(domain.handlers.action.fn).toBeFunction()
      expectTypeOf(domain.handlers.action.source).toBeString()
    })

    it('handler return values can be awaited with correct types', async () => {
      const payment = Domain('Payment', {
        process: async (order: { total: number }, _: unknown, $: unknown) => ({
          success: true,
          transactionId: 'tx-123',
          amount: order.total,
        }),
      })

      // Calling the handler and awaiting should give correct result type
      const result = await payment.handlers.process.fn({ total: 100 }, {}, {})

      expect(result.success).toBe(true)
      expect(result.transactionId).toBe('tx-123')
      expect(result.amount).toBe(100)

      // Type should be inferred correctly
      expectTypeOf(result).toMatchTypeOf<{ success: boolean; transactionId: string; amount: number }>()
    })
  })
})
