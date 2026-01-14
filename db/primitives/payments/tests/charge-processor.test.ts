/**
 * ChargeProcessor Tests - TDD GREEN Phase
 *
 * Tests for the charge processor with idempotency support:
 * - create() - Create charge with idempotency key
 * - capture() - Capture authorized charge
 * - refund() - Full or partial refund
 * - get() - Get charge details
 * - list() - List customer charges
 *
 * Idempotency:
 * - Idempotency key storage and lookup
 * - Return cached result for duplicate requests
 * - Key expiration (24 hours)
 *
 * Status management:
 * - pending, succeeded, failed, refunded status transitions
 * - Status event emission
 * - Webhook integration points
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createChargeProcessor,
  type ChargeProcessor,
  type Charge,
  type ChargeStatus,
  type CreateChargeParams,
  type RefundResult,
  type ChargeEventHandler,
} from '../charge-processor'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestProcessor(): ChargeProcessor {
  return createChargeProcessor()
}

// =============================================================================
// Basic Charge Operations
// =============================================================================

describe('ChargeProcessor', () => {
  describe('create()', () => {
    let processor: ChargeProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should create a charge with required fields', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.id).toBeDefined()
      expect(charge.id).toMatch(/^ch_/)
      expect(charge.amount).toBe(9999)
      expect(charge.currency).toBe('USD')
      expect(charge.customerId).toBe('cust_123')
      expect(charge.paymentMethodId).toBe('pm_xxx')
      expect(charge.status).toBe('pending')
      expect(charge.createdAt).toBeInstanceOf(Date)
      expect(charge.updatedAt).toBeInstanceOf(Date)
    })

    it('should create a charge with optional description', async () => {
      const charge = await processor.create({
        amount: 5000,
        currency: 'EUR',
        customerId: 'cust_456',
        paymentMethodId: 'pm_yyy',
        description: 'Order #12345',
      })

      expect(charge.description).toBe('Order #12345')
    })

    it('should create a charge with metadata', async () => {
      const charge = await processor.create({
        amount: 2500,
        currency: 'USD',
        customerId: 'cust_789',
        paymentMethodId: 'pm_zzz',
        metadata: { orderId: 'order_abc', sku: 'ITEM-001' },
      })

      expect(charge.metadata).toEqual({ orderId: 'order_abc', sku: 'ITEM-001' })
    })

    it('should throw for non-positive amount', async () => {
      await expect(
        processor.create({
          amount: 0,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toThrow('Amount must be positive')

      await expect(
        processor.create({
          amount: -100,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toThrow('Amount must be positive')
    })

    it('should create charge in capture mode (immediate capture)', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true,
      })

      expect(charge.status).toBe('succeeded')
      expect(charge.capturedAt).toBeInstanceOf(Date)
      expect(charge.capturedAmount).toBe(9999)
    })

    it('should create charge in authorize mode (capture=false)', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: false,
      })

      expect(charge.status).toBe('pending')
      expect(charge.capturedAt).toBeUndefined()
      expect(charge.capturedAmount).toBeUndefined()
    })
  })

  // =============================================================================
  // Idempotency Tests
  // =============================================================================

  describe('idempotency', () => {
    let processor: ChargeProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should return same charge for duplicate idempotency key', async () => {
      const idempotencyKey = 'idem_key_123'

      const charge1 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      const charge2 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      expect(charge1.id).toBe(charge2.id)
      expect(charge1.createdAt.getTime()).toBe(charge2.createdAt.getTime())
    })

    it('should return cached charge even with different amounts (idempotency wins)', async () => {
      const idempotencyKey = 'idem_key_456'

      const charge1 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      // Try with different amount - should still return cached
      const charge2 = await processor.create({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      expect(charge2.id).toBe(charge1.id)
      expect(charge2.amount).toBe(9999) // Original amount
    })

    it('should create separate charges for different idempotency keys', async () => {
      const charge1 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey: 'idem_key_a',
      })

      const charge2 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey: 'idem_key_b',
      })

      expect(charge1.id).not.toBe(charge2.id)
    })

    it('should create separate charges when no idempotency key provided', async () => {
      const charge1 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const charge2 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge1.id).not.toBe(charge2.id)
    })

    it('should expire idempotency keys after 24 hours', async () => {
      const idempotencyKey = 'idem_key_expiring'
      vi.useFakeTimers()

      const charge1 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      // Advance time by 25 hours (past expiration)
      vi.advanceTimersByTime(25 * 60 * 60 * 1000)

      const charge2 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      expect(charge2.id).not.toBe(charge1.id)

      vi.useRealTimers()
    })

    it('should not expire idempotency keys before 24 hours', async () => {
      const idempotencyKey = 'idem_key_not_expiring'
      vi.useFakeTimers()

      const charge1 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      // Advance time by 23 hours (before expiration)
      vi.advanceTimersByTime(23 * 60 * 60 * 1000)

      const charge2 = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      expect(charge2.id).toBe(charge1.id)

      vi.useRealTimers()
    })
  })

  // =============================================================================
  // Capture Tests
  // =============================================================================

  describe('capture()', () => {
    let processor: ChargeProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should capture an authorized charge', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: false,
      })

      const captured = await processor.capture(charge.id)

      expect(captured.status).toBe('succeeded')
      expect(captured.capturedAt).toBeInstanceOf(Date)
      expect(captured.capturedAmount).toBe(9999)
    })

    it('should capture partial amount', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: false,
      })

      const captured = await processor.capture(charge.id, 5000)

      expect(captured.status).toBe('succeeded')
      expect(captured.capturedAmount).toBe(5000)
    })

    it('should throw when capturing non-existent charge', async () => {
      await expect(processor.capture('ch_nonexistent')).rejects.toThrow('Charge not found')
    })

    it('should throw when capturing more than authorized', async () => {
      const charge = await processor.create({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: false,
      })

      await expect(processor.capture(charge.id, 6000)).rejects.toThrow(
        'Cannot capture more than authorized amount'
      )
    })

    it('should throw when capturing already captured charge', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true, // Already captured
      })

      await expect(processor.capture(charge.id)).rejects.toThrow('Charge already captured')
    })

    it('should throw when capturing failed charge', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: false,
      })

      // Simulate failure
      ;(processor as any).charges.get(charge.id).status = 'failed'

      await expect(processor.capture(charge.id)).rejects.toThrow('Cannot capture failed charge')
    })
  })

  // =============================================================================
  // Refund Tests
  // =============================================================================

  describe('refund()', () => {
    let processor: ChargeProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should fully refund a captured charge', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true,
      })

      const result = await processor.refund(charge.id)

      expect(result.refundId).toBeDefined()
      expect(result.refundId).toMatch(/^re_/)
      expect(result.amount).toBe(9999)
      expect(result.status).toBe('succeeded')

      const updated = await processor.get(charge.id)
      expect(updated?.status).toBe('refunded')
      expect(updated?.refundedAmount).toBe(9999)
    })

    it('should partially refund a captured charge', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true,
      })

      const result = await processor.refund(charge.id, 5000)

      expect(result.amount).toBe(5000)
      expect(result.status).toBe('succeeded')

      const updated = await processor.get(charge.id)
      expect(updated?.status).toBe('partially_refunded')
      expect(updated?.refundedAmount).toBe(5000)
    })

    it('should allow multiple partial refunds', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true,
      })

      await processor.refund(charge.id, 3000)
      await processor.refund(charge.id, 3000)

      const updated = await processor.get(charge.id)
      expect(updated?.status).toBe('partially_refunded')
      expect(updated?.refundedAmount).toBe(6000)
      expect(updated?.refunds).toHaveLength(2)
    })

    it('should transition to refunded when fully refunded via partials', async () => {
      const charge = await processor.create({
        amount: 6000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true,
      })

      await processor.refund(charge.id, 3000)
      await processor.refund(charge.id, 3000)

      const updated = await processor.get(charge.id)
      expect(updated?.status).toBe('refunded')
      expect(updated?.refundedAmount).toBe(6000)
    })

    it('should throw when refunding non-existent charge', async () => {
      await expect(processor.refund('ch_nonexistent')).rejects.toThrow('Charge not found')
    })

    it('should throw when refunding uncaptured charge', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: false, // Not captured
      })

      await expect(processor.refund(charge.id)).rejects.toThrow('Cannot refund uncaptured charge')
    })

    it('should throw when refunding more than remaining amount', async () => {
      const charge = await processor.create({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true,
      })

      await processor.refund(charge.id, 3000)

      await expect(processor.refund(charge.id, 3000)).rejects.toThrow(
        'Refund amount exceeds available amount'
      )
    })

    it('should throw when refunding already fully refunded charge', async () => {
      const charge = await processor.create({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true,
      })

      await processor.refund(charge.id)

      await expect(processor.refund(charge.id)).rejects.toThrow('Charge already fully refunded')
    })
  })

  // =============================================================================
  // Get Tests
  // =============================================================================

  describe('get()', () => {
    let processor: ChargeProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should get an existing charge', async () => {
      const created = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const charge = await processor.get(created.id)

      expect(charge).toBeDefined()
      expect(charge?.id).toBe(created.id)
      expect(charge?.amount).toBe(9999)
    })

    it('should return null for non-existent charge', async () => {
      const charge = await processor.get('ch_nonexistent')
      expect(charge).toBeNull()
    })
  })

  // =============================================================================
  // List Tests
  // =============================================================================

  describe('list()', () => {
    let processor: ChargeProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should list charges for a customer', async () => {
      await processor.create({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.create({
        amount: 2000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.create({
        amount: 3000,
        currency: 'USD',
        customerId: 'cust_456', // Different customer
        paymentMethodId: 'pm_yyy',
      })

      const charges = await processor.list('cust_123')

      expect(charges).toHaveLength(2)
      expect(charges.every((c) => c.customerId === 'cust_123')).toBe(true)
    })

    it('should return empty array for customer with no charges', async () => {
      const charges = await processor.list('cust_no_charges')
      expect(charges).toEqual([])
    })

    it('should return charges sorted by createdAt descending (most recent first)', async () => {
      vi.useFakeTimers()

      await processor.create({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      vi.advanceTimersByTime(1000)

      await processor.create({
        amount: 2000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      vi.advanceTimersByTime(1000)

      await processor.create({
        amount: 3000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const charges = await processor.list('cust_123')

      expect(charges[0].amount).toBe(3000)
      expect(charges[1].amount).toBe(2000)
      expect(charges[2].amount).toBe(1000)

      vi.useRealTimers()
    })
  })

  // =============================================================================
  // Status Management and Events
  // =============================================================================

  describe('status events', () => {
    let processor: ChargeProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should emit event on charge creation', async () => {
      const handler = vi.fn()
      processor.on('charge.created', handler)

      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(handler).toHaveBeenCalledWith({
        type: 'charge.created',
        charge,
      })
    })

    it('should emit event on charge capture', async () => {
      const handler = vi.fn()
      processor.on('charge.captured', handler)

      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: false,
      })

      await processor.capture(charge.id)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'charge.captured',
        })
      )
    })

    it('should emit event on charge refund', async () => {
      const handler = vi.fn()
      processor.on('charge.refunded', handler)

      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true,
      })

      await processor.refund(charge.id)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'charge.refunded',
        })
      )
    })

    it('should emit succeeded event for immediate capture', async () => {
      const handler = vi.fn()
      processor.on('charge.succeeded', handler)

      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true,
      })

      expect(handler).toHaveBeenCalledWith({
        type: 'charge.succeeded',
        charge,
      })
    })

    it('should allow multiple event handlers', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      processor.on('charge.created', handler1)
      processor.on('charge.created', handler2)

      await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('should allow unsubscribing from events', async () => {
      const handler = vi.fn()
      const unsubscribe = processor.on('charge.created', handler)

      unsubscribe()

      await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  // =============================================================================
  // Webhook Integration Points
  // =============================================================================

  describe('webhook handlers', () => {
    let processor: ChargeProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should expose handlers for webhook integration', () => {
      expect(processor.getEventHandlers('charge.created')).toEqual([])

      const handler = vi.fn()
      processor.on('charge.created', handler)

      expect(processor.getEventHandlers('charge.created')).toContain(handler)
    })

    it('should support processing external webhook events', async () => {
      const handler = vi.fn()
      processor.on('charge.updated', handler)

      // Simulate external webhook
      await processor.processWebhook({
        type: 'charge.updated',
        data: { chargeId: 'ch_external', status: 'succeeded' },
      })

      expect(handler).toHaveBeenCalledWith({
        type: 'charge.updated',
        data: { chargeId: 'ch_external', status: 'succeeded' },
      })
    })
  })

  // =============================================================================
  // Status Transitions
  // =============================================================================

  describe('status transitions', () => {
    let processor: ChargeProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should have valid status flow: pending -> succeeded (capture)', async () => {
      const charge = await processor.create({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: false,
      })

      expect(charge.status).toBe('pending')

      const captured = await processor.capture(charge.id)
      expect(captured.status).toBe('succeeded')
    })

    it('should have valid status flow: succeeded -> partially_refunded -> refunded', async () => {
      const charge = await processor.create({
        amount: 6000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        capture: true,
      })

      expect(charge.status).toBe('succeeded')

      await processor.refund(charge.id, 3000)
      let updated = await processor.get(charge.id)
      expect(updated?.status).toBe('partially_refunded')

      await processor.refund(charge.id, 3000)
      updated = await processor.get(charge.id)
      expect(updated?.status).toBe('refunded')
    })
  })
})
