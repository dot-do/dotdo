/**
 * Query Validation Integration Tests
 *
 * Tests operator query validation integrated into DOCore.listThingsInternal.
 * Uses real miniflare DO instances (no mocks).
 *
 * @see do-tsy: [VAL-1] Operator query input validation
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { QueryValidationError } from './query-validation'

describe('DOCore Operator Query Integration', () => {
  let stub: DurableObjectStub

  beforeAll(async () => {
    // Get a fresh DO instance with unique name per test run
    const uniqueId = `query-validation-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const id = env.DOCore.idFromName(uniqueId)
    stub = env.DOCore.get(id)
  })

  describe('list with operator queries', () => {
    beforeAll(async () => {
      // Create test data via RPC
      await stub.create('Product', {
        name: 'Widget A',
        price: 29.99,
        quantity: 100,
        category: 'electronics',
      })
      await stub.create('Product', {
        name: 'Widget B',
        price: 49.99,
        quantity: 50,
        category: 'electronics',
      })
      await stub.create('Product', {
        name: 'Widget C',
        price: 99.99,
        quantity: 10,
        category: 'premium',
      })
      await stub.create('Product', {
        name: 'Gadget D',
        price: 19.99,
        quantity: 200,
        category: 'electronics',
      })
    })

    it('filters with $gt operator', async () => {
      const results = await stub.listThings('Product', {
        where: { price: { $gt: 30 } },
      })

      expect(results.length).toBe(2)
      expect(results.every((r: { price: number }) => r.price > 30)).toBe(true)
    })

    it('filters with $lt operator', async () => {
      const results = await stub.listThings('Product', {
        where: { price: { $lt: 50 } },
      })

      // Widget A (29.99), Widget B (49.99), Gadget D (19.99) = 3 items
      expect(results.length).toBe(3)
      expect(results.every((r: { price: number }) => r.price < 50)).toBe(true)
    })

    it('filters with range operators ($gte and $lte)', async () => {
      const results = await stub.listThings('Product', {
        where: { price: { $gte: 29.99, $lte: 49.99 } },
      })

      expect(results.length).toBe(2)
      expect(results.every((r: { price: number }) => r.price >= 29.99 && r.price <= 49.99)).toBe(true)
    })

    it('filters with $in operator', async () => {
      const results = await stub.listThings('Product', {
        where: { category: { $in: ['premium'] } },
      })

      expect(results.length).toBe(1)
      expect(results[0].name).toBe('Widget C')
    })

    it('filters with $ne operator', async () => {
      const results = await stub.listThings('Product', {
        where: { category: { $ne: 'premium' } },
      })

      expect(results.length).toBe(3)
      expect(results.every((r: { category: string }) => r.category !== 'premium')).toBe(true)
    })

    it('filters with combined equality and operators', async () => {
      const results = await stub.listThings('Product', {
        where: {
          category: 'electronics',
          quantity: { $gte: 50 },
        },
      })

      // Widget A (100), Widget B (50), Gadget D (200) = 3 items with electronics & qty >= 50
      expect(results.length).toBe(3)
      expect(results.every((r: { category: string; quantity: number }) =>
        r.category === 'electronics' && r.quantity >= 50
      )).toBe(true)
    })

    it('filters with $regex operator', async () => {
      const results = await stub.listThings('Product', {
        where: { name: { $regex: '^Widget' } },
      })

      expect(results.length).toBe(3)
      expect(results.every((r: { name: string }) => r.name.startsWith('Widget'))).toBe(true)
    })

    it('rejects invalid operator queries', async () => {
      await expect(
        stub.listThings('Product', {
          where: { price: { $badOp: 50 } },
        })
      ).rejects.toThrow()
    })

    it('rejects $in with non-array value', async () => {
      await expect(
        stub.listThings('Product', {
          where: { category: { $in: 'not-an-array' } },
        })
      ).rejects.toThrow()
    })
  })
})
