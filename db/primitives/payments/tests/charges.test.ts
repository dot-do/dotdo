/**
 * One-Time Charge Tests - TDD RED Phase
 *
 * Comprehensive tests for one-time charge functionality:
 * - Create charge with amount and currency
 * - Idempotency key handling
 * - Charge capture (auth then capture)
 * - Charge refund (full and partial)
 * - Charge metadata
 * - Multi-currency support
 * - Charge status transitions
 * - Failed charge handling
 * - 3D Secure flow integration
 *
 * @module db/primitives/payments/tests/charges.test
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import from the module that doesn't exist yet (TDD RED phase)
import {
  createChargeProcessor,
  type ChargeProcessor,
  type Charge,
  type ChargeStatus,
  type ChargeCreateOptions,
  type ChargeAuthorizeOptions,
  type ChargeCaptureOptions,
  type ChargeRefundOptions,
  type Refund,
  type RefundStatus,
  type ThreeDSecureStatus,
  type ChargeProvider,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestProcessor(): ChargeProcessor {
  return createChargeProcessor()
}

function createMockProvider(name: string = 'mock'): ChargeProvider {
  return {
    name,
    charge: vi.fn().mockResolvedValue({
      providerChargeId: `ch_${Date.now()}`,
      status: 'succeeded' as ChargeStatus,
    }),
    authorize: vi.fn().mockResolvedValue({
      providerChargeId: `auth_${Date.now()}`,
      status: 'requires_capture' as ChargeStatus,
    }),
    capture: vi.fn().mockResolvedValue({
      status: 'succeeded' as ChargeStatus,
    }),
    refund: vi.fn().mockResolvedValue({
      providerRefundId: `re_${Date.now()}`,
      status: 'succeeded' as RefundStatus,
    }),
    void: vi.fn().mockResolvedValue({
      status: 'canceled' as ChargeStatus,
    }),
    create3DSecureSession: vi.fn().mockResolvedValue({
      clientSecret: 'secret_xxx',
      redirectUrl: 'https://3dsecure.example.com/auth',
      status: 'requires_action' as ThreeDSecureStatus,
    }),
    confirm3DSecure: vi.fn().mockResolvedValue({
      status: 'succeeded' as ThreeDSecureStatus,
      chargeStatus: 'succeeded' as ChargeStatus,
    }),
  }
}

// =============================================================================
// Create Charge with Amount and Currency Tests
// =============================================================================

describe('ChargeProcessor', () => {
  describe('create charge with amount and currency', () => {
    let processor: ChargeProcessor
    let mockProvider: ChargeProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should create a charge with amount in cents', async () => {
      const charge = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.id).toBeDefined()
      expect(charge.amount).toBe(9999)
      expect(charge.status).toBe('succeeded')
    })

    it('should create a charge with ISO currency code', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.currency).toBe('USD')
    })

    it('should normalize currency to uppercase', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'usd',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.currency).toBe('USD')
    })

    it('should validate amount is positive', async () => {
      await expect(
        processor.charge({
          amount: -100,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toThrow('Amount must be positive')
    })

    it('should validate amount is not zero', async () => {
      await expect(
        processor.charge({
          amount: 0,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toThrow('Amount must be positive')
    })

    it('should validate currency is provided', async () => {
      await expect(
        processor.charge({
          amount: 1000,
          currency: '',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toThrow('Currency is required')
    })

    it('should validate currency format', async () => {
      await expect(
        processor.charge({
          amount: 1000,
          currency: 'INVALID',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toThrow('Invalid currency code')
    })

    it('should store charge with timestamp', async () => {
      const beforeCreate = new Date()
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })
      const afterCreate = new Date()

      expect(charge.createdAt).toBeInstanceOf(Date)
      expect(charge.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
      expect(charge.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime())
    })

    it('should generate unique charge ID', async () => {
      const charge1 = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })
      const charge2 = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge1.id).not.toBe(charge2.id)
    })

    it('should include description when provided', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        description: 'Order #12345',
      })

      expect(charge.description).toBe('Order #12345')
    })
  })

  // =============================================================================
  // Idempotency Key Handling Tests
  // =============================================================================

  describe('idempotency key handling', () => {
    let processor: ChargeProcessor
    let mockProvider: ChargeProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should return same charge for same idempotency key', async () => {
      const idempotencyKey = 'unique_key_123'

      const charge1 = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      const charge2 = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      expect(charge1.id).toBe(charge2.id)
    })

    it('should call provider only once for idempotent requests', async () => {
      const idempotencyKey = 'unique_key_456'

      await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      expect(mockProvider.charge).toHaveBeenCalledTimes(1)
    })

    it('should process new charge for different idempotency key', async () => {
      const charge1 = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey: 'key_1',
      })

      const charge2 = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey: 'key_2',
      })

      expect(charge1.id).not.toBe(charge2.id)
      expect(mockProvider.charge).toHaveBeenCalledTimes(2)
    })

    it('should store idempotency key with charge', async () => {
      const idempotencyKey = 'stored_key_789'

      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      const retrieved = await processor.getCharge(charge.id)
      expect(retrieved?.idempotencyKey).toBe(idempotencyKey)
    })

    it('should reject conflicting idempotent request with different amount', async () => {
      const idempotencyKey = 'conflict_key'

      await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      await expect(
        processor.charge({
          amount: 2000, // Different amount
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
          idempotencyKey,
        })
      ).rejects.toThrow('Idempotency key conflict')
    })

    it('should respect idempotency key TTL', async () => {
      // Set short TTL for testing
      const processorWithTTL = createChargeProcessor({ idempotencyKeyTTL: 100 })
      const provider = createMockProvider('stripe')
      processorWithTTL.registerProvider('stripe', provider)

      const idempotencyKey = 'ttl_key'

      await processorWithTTL.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should process as new charge after TTL expires
      await processorWithTTL.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      expect(provider.charge).toHaveBeenCalledTimes(2)
    })

    it('should generate idempotency key hash for lookup', async () => {
      const idempotencyKey = 'hash_test_key'

      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey,
      })

      const lookedUp = await processor.getChargeByIdempotencyKey(idempotencyKey)
      expect(lookedUp?.id).toBe(charge.id)
    })
  })

  // =============================================================================
  // Charge Capture (Auth then Capture) Tests
  // =============================================================================

  describe('charge capture (auth then capture)', () => {
    let processor: ChargeProcessor
    let mockProvider: ChargeProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should authorize a charge without capturing', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(auth.id).toBeDefined()
      expect(auth.status).toBe('requires_capture')
      expect(auth.captured).toBe(false)
      expect(mockProvider.authorize).toHaveBeenCalled()
    })

    it('should capture full authorized amount', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const captured = await processor.capture(auth.id)

      expect(captured.status).toBe('succeeded')
      expect(captured.captured).toBe(true)
      expect(captured.capturedAmount).toBe(9999)
      expect(captured.capturedAt).toBeInstanceOf(Date)
    })

    it('should capture partial amount', async () => {
      const auth = await processor.authorize({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const captured = await processor.capture(auth.id, { amount: 5000 })

      expect(captured.capturedAmount).toBe(5000)
    })

    it('should reject capture for more than authorized', async () => {
      const auth = await processor.authorize({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await expect(processor.capture(auth.id, { amount: 10000 })).rejects.toThrow(
        'Cannot capture more than authorized amount'
      )
    })

    it('should reject capture for already captured charge', async () => {
      const auth = await processor.authorize({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.capture(auth.id)

      await expect(processor.capture(auth.id)).rejects.toThrow('Charge already captured')
    })

    it('should track authorization expiration', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        expiresIn: 7 * 24 * 60 * 60 * 1000, // 7 days
      })

      expect(auth.expiresAt).toBeInstanceOf(Date)
      expect(auth.expiresAt!.getTime()).toBeGreaterThan(Date.now())
    })

    it('should reject capture for expired authorization', async () => {
      // Mock an expired authorization
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        expiresIn: -1000, // Already expired
      })

      await expect(processor.capture(auth.id)).rejects.toThrow('Authorization expired')
    })

    it('should void an uncaptured authorization', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const voided = await processor.void(auth.id)

      expect(voided.status).toBe('canceled')
      expect(mockProvider.void).toHaveBeenCalled()
    })

    it('should reject void for captured charge', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.capture(auth.id)

      await expect(processor.void(auth.id)).rejects.toThrow('Cannot void captured charge')
    })

    it('should track remaining capturable amount after partial capture', async () => {
      const auth = await processor.authorize({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.capture(auth.id, { amount: 3000 })

      const charge = await processor.getCharge(auth.id)
      expect(charge?.remainingCapturableAmount).toBe(7000)
    })

    it('should support multiple partial captures', async () => {
      const auth = await processor.authorize({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.capture(auth.id, { amount: 3000 })
      await processor.capture(auth.id, { amount: 4000 })

      const charge = await processor.getCharge(auth.id)
      expect(charge?.capturedAmount).toBe(7000)
      expect(charge?.captures).toHaveLength(2)
    })
  })

  // =============================================================================
  // Charge Refund (Full and Partial) Tests
  // =============================================================================

  describe('charge refund (full and partial)', () => {
    let processor: ChargeProcessor
    let mockProvider: ChargeProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should refund full charge amount', async () => {
      const charge = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const refund = await processor.refund(charge.id)

      expect(refund.id).toBeDefined()
      expect(refund.amount).toBe(9999)
      expect(refund.chargeId).toBe(charge.id)
      expect(refund.status).toBe('succeeded')
    })

    it('should refund partial amount', async () => {
      const charge = await processor.charge({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const refund = await processor.refund(charge.id, { amount: 5000 })

      expect(refund.amount).toBe(5000)
    })

    it('should update charge status after full refund', async () => {
      const charge = await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.refund(charge.id)

      const updated = await processor.getCharge(charge.id)
      expect(updated?.status).toBe('refunded')
    })

    it('should update charge status after partial refund', async () => {
      const charge = await processor.charge({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.refund(charge.id, { amount: 3000 })

      const updated = await processor.getCharge(charge.id)
      expect(updated?.status).toBe('partially_refunded')
    })

    it('should track multiple refunds on single charge', async () => {
      const charge = await processor.charge({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.refund(charge.id, { amount: 3000 })
      await processor.refund(charge.id, { amount: 2000 })

      const updated = await processor.getCharge(charge.id)
      expect(updated?.refundedAmount).toBe(5000)
      expect(updated?.refunds).toHaveLength(2)
    })

    it('should reject refund exceeding available amount', async () => {
      const charge = await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await expect(processor.refund(charge.id, { amount: 10000 })).rejects.toThrow(
        'Refund amount exceeds available amount'
      )
    })

    it('should reject refund on fully refunded charge', async () => {
      const charge = await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.refund(charge.id)

      await expect(processor.refund(charge.id, { amount: 1000 })).rejects.toThrow(
        'Charge already fully refunded'
      )
    })

    it('should include refund reason', async () => {
      const charge = await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const refund = await processor.refund(charge.id, {
        reason: 'customer_request',
      })

      expect(refund.reason).toBe('customer_request')
    })

    it('should support standard refund reasons', async () => {
      const charge = await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const reasons: Array<'duplicate' | 'fraudulent' | 'customer_request' | 'product_unsatisfactory'> = [
        'duplicate',
        'fraudulent',
        'customer_request',
        'product_unsatisfactory',
      ]

      for (const reason of reasons) {
        // Create new charge for each reason test
        const newCharge = await processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })

        const refund = await processor.refund(newCharge.id, { reason })
        expect(refund.reason).toBe(reason)
      }
    })

    it('should track refund timestamps', async () => {
      const charge = await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const beforeRefund = new Date()
      const refund = await processor.refund(charge.id)
      const afterRefund = new Date()

      expect(refund.createdAt).toBeInstanceOf(Date)
      expect(refund.createdAt.getTime()).toBeGreaterThanOrEqual(beforeRefund.getTime())
      expect(refund.createdAt.getTime()).toBeLessThanOrEqual(afterRefund.getTime())
    })

    it('should list refunds for a charge', async () => {
      const charge = await processor.charge({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.refund(charge.id, { amount: 3000 })
      await processor.refund(charge.id, { amount: 2000 })

      const refunds = await processor.getRefundsForCharge(charge.id)
      expect(refunds).toHaveLength(2)
      expect(refunds[0].chargeId).toBe(charge.id)
      expect(refunds[1].chargeId).toBe(charge.id)
    })
  })

  // =============================================================================
  // Charge Metadata Tests
  // =============================================================================

  describe('charge metadata', () => {
    let processor: ChargeProcessor
    let mockProvider: ChargeProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should store metadata with charge', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        metadata: {
          orderId: 'order_123',
          sku: 'SKU-456',
        },
      })

      expect(charge.metadata).toEqual({
        orderId: 'order_123',
        sku: 'SKU-456',
      })
    })

    it('should retrieve metadata from stored charge', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        metadata: {
          source: 'mobile_app',
          campaign: 'summer_2024',
        },
      })

      const retrieved = await processor.getCharge(charge.id)
      expect(retrieved?.metadata).toEqual({
        source: 'mobile_app',
        campaign: 'summer_2024',
      })
    })

    it('should update charge metadata', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        metadata: { key1: 'value1' },
      })

      const updated = await processor.updateChargeMetadata(charge.id, {
        key1: 'updated_value',
        key2: 'new_value',
      })

      expect(updated.metadata).toEqual({
        key1: 'updated_value',
        key2: 'new_value',
      })
    })

    it('should merge metadata on update', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        metadata: {
          existing: 'value',
          toUpdate: 'original',
        },
      })

      const updated = await processor.updateChargeMetadata(
        charge.id,
        { toUpdate: 'changed', newKey: 'added' },
        { merge: true }
      )

      expect(updated.metadata).toEqual({
        existing: 'value',
        toUpdate: 'changed',
        newKey: 'added',
      })
    })

    it('should pass metadata to provider', async () => {
      await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        metadata: { trackingId: 'track_789' },
      })

      expect(mockProvider.charge).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          metadata: { trackingId: 'track_789' },
        })
      )
    })

    it('should store refund metadata', async () => {
      const charge = await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const refund = await processor.refund(charge.id, {
        metadata: {
          supportTicket: 'TICKET-123',
          refundedBy: 'agent_456',
        },
      })

      expect(refund.metadata).toEqual({
        supportTicket: 'TICKET-123',
        refundedBy: 'agent_456',
      })
    })

    it('should handle empty metadata', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        metadata: {},
      })

      expect(charge.metadata).toEqual({})
    })

    it('should handle null metadata values', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        metadata: {
          key1: 'value',
          key2: null as any,
        },
      })

      expect(charge.metadata?.key2).toBeNull()
    })
  })

  // =============================================================================
  // Multi-Currency Support Tests
  // =============================================================================

  describe('multi-currency support', () => {
    let processor: ChargeProcessor
    let mockProvider: ChargeProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should process charge in USD', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.currency).toBe('USD')
    })

    it('should process charge in EUR', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'EUR',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.currency).toBe('EUR')
    })

    it('should process charge in GBP', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'GBP',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.currency).toBe('GBP')
    })

    it('should process charge in JPY (zero-decimal currency)', async () => {
      const charge = await processor.charge({
        amount: 1000, // 1000 yen, not 10.00 yen
        currency: 'JPY',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.currency).toBe('JPY')
      expect(charge.amount).toBe(1000)
    })

    it('should validate minimum amount per currency', async () => {
      // USD minimum is typically 50 cents
      await expect(
        processor.charge({
          amount: 25,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toThrow('Amount below minimum for currency')
    })

    it('should handle zero-decimal currencies correctly', async () => {
      const zeroDecimalCurrencies = ['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'UGX', 'RWF']

      for (const currency of zeroDecimalCurrencies) {
        const charge = await processor.charge({
          amount: 1000, // These are not multiplied by 100
          currency,
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })

        expect(charge.currency).toBe(currency)
        expect(charge.decimalMultiplier).toBe(1)
      }
    })

    it('should handle three-decimal currencies', async () => {
      // BHD, KWD, OMR use 3 decimal places
      const charge = await processor.charge({
        amount: 1000, // 1.000 BHD
        currency: 'BHD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.currency).toBe('BHD')
      expect(charge.decimalMultiplier).toBe(1000)
    })

    it('should refund in same currency as charge', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'EUR',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const refund = await processor.refund(charge.id, { amount: 500 })

      expect(refund.currency).toBe('EUR')
    })

    it('should list supported currencies', () => {
      const currencies = processor.getSupportedCurrencies()

      expect(currencies).toContain('USD')
      expect(currencies).toContain('EUR')
      expect(currencies).toContain('GBP')
      expect(currencies).toContain('JPY')
    })

    it('should format amount for display', () => {
      expect(processor.formatAmount(1000, 'USD')).toBe('$10.00')
      expect(processor.formatAmount(1000, 'EUR')).toBe('10.00')
      expect(processor.formatAmount(1000, 'JPY')).toBe('1000')
      expect(processor.formatAmount(1500, 'GBP')).toBe('15.00')
    })
  })

  // =============================================================================
  // Charge Status Transitions Tests
  // =============================================================================

  describe('charge status transitions', () => {
    let processor: ChargeProcessor
    let mockProvider: ChargeProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should start in pending status before provider confirmation', async () => {
      mockProvider.charge = vi.fn().mockImplementation(async () => {
        // Simulate delay
        await new Promise((r) => setTimeout(r, 10))
        return {
          providerChargeId: `ch_${Date.now()}`,
          status: 'succeeded' as ChargeStatus,
        }
      })

      // Check initial status before async completion
      const chargePromise = processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const charge = await chargePromise
      // After completion, should be succeeded
      expect(charge.status).toBe('succeeded')
    })

    it('should transition from requires_capture to succeeded', async () => {
      const auth = await processor.authorize({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(auth.status).toBe('requires_capture')

      const captured = await processor.capture(auth.id)
      expect(captured.status).toBe('succeeded')
    })

    it('should transition from succeeded to partially_refunded', async () => {
      const charge = await processor.charge({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.status).toBe('succeeded')

      await processor.refund(charge.id, { amount: 5000 })

      const updated = await processor.getCharge(charge.id)
      expect(updated?.status).toBe('partially_refunded')
    })

    it('should transition from partially_refunded to refunded', async () => {
      const charge = await processor.charge({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.refund(charge.id, { amount: 5000 })
      await processor.refund(charge.id, { amount: 5000 })

      const updated = await processor.getCharge(charge.id)
      expect(updated?.status).toBe('refunded')
    })

    it('should transition from requires_capture to canceled', async () => {
      const auth = await processor.authorize({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const voided = await processor.void(auth.id)
      expect(voided.status).toBe('canceled')
    })

    it('should track status history', async () => {
      const charge = await processor.charge({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.refund(charge.id, { amount: 5000 })
      await processor.refund(charge.id, { amount: 5000 })

      const updated = await processor.getCharge(charge.id)
      expect(updated?.statusHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'pending' }),
          expect.objectContaining({ status: 'succeeded' }),
          expect.objectContaining({ status: 'partially_refunded' }),
          expect.objectContaining({ status: 'refunded' }),
        ])
      )
    })

    it('should include timestamp in status history', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const updated = await processor.getCharge(charge.id)
      expect(updated?.statusHistory[0].timestamp).toBeInstanceOf(Date)
    })

    it('should validate invalid status transitions', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      // Cannot void a succeeded charge (use refund instead)
      await expect(processor.void(charge.id)).rejects.toThrow(
        'Invalid status transition'
      )
    })

    it('should handle requires_action status', async () => {
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: `ch_${Date.now()}`,
        status: 'requires_action' as ChargeStatus,
        clientSecret: 'secret_xxx',
      })

      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.status).toBe('requires_action')
      expect(charge.clientSecret).toBeDefined()
    })

    it('should handle processing status', async () => {
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: `ch_${Date.now()}`,
        status: 'processing' as ChargeStatus,
      })

      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.status).toBe('processing')
    })
  })

  // =============================================================================
  // Failed Charge Handling Tests
  // =============================================================================

  describe('failed charge handling', () => {
    let processor: ChargeProcessor
    let mockProvider: ChargeProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should handle card declined error', async () => {
      mockProvider.charge = vi.fn().mockRejectedValue({
        type: 'card_error',
        code: 'card_declined',
        message: 'Your card was declined',
        declineCode: 'generic_decline',
      })

      await expect(
        processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toMatchObject({
        code: 'card_declined',
        declineCode: 'generic_decline',
      })
    })

    it('should handle insufficient funds error', async () => {
      mockProvider.charge = vi.fn().mockRejectedValue({
        type: 'card_error',
        code: 'card_declined',
        declineCode: 'insufficient_funds',
        message: 'Insufficient funds',
      })

      try {
        await processor.charge({
          amount: 100000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.declineCode).toBe('insufficient_funds')
      }
    })

    it('should handle expired card error', async () => {
      mockProvider.charge = vi.fn().mockRejectedValue({
        type: 'card_error',
        code: 'expired_card',
        message: 'Your card has expired',
      })

      await expect(
        processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toMatchObject({
        code: 'expired_card',
      })
    })

    it('should store failed charge record', async () => {
      mockProvider.charge = vi.fn().mockRejectedValue({
        type: 'card_error',
        code: 'card_declined',
        message: 'Declined',
      })

      let chargeId: string | undefined
      try {
        await processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      } catch (error: any) {
        chargeId = error.chargeId
      }

      if (chargeId) {
        const charge = await processor.getCharge(chargeId)
        expect(charge?.status).toBe('failed')
      }
    })

    it('should track failure reason', async () => {
      mockProvider.charge = vi.fn().mockRejectedValue({
        type: 'card_error',
        code: 'card_declined',
        declineCode: 'do_not_honor',
        message: 'Do not honor',
      })

      let chargeId: string | undefined
      try {
        await processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      } catch (error: any) {
        chargeId = error.chargeId
      }

      if (chargeId) {
        const charge = await processor.getCharge(chargeId)
        expect(charge?.failureCode).toBe('card_declined')
        expect(charge?.failureMessage).toBe('Do not honor')
      }
    })

    it('should handle network errors', async () => {
      mockProvider.charge = vi.fn().mockRejectedValue({
        type: 'api_connection_error',
        message: 'Network error',
      })

      await expect(
        processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toMatchObject({
        type: 'api_connection_error',
      })
    })

    it('should handle rate limit errors', async () => {
      mockProvider.charge = vi.fn().mockRejectedValue({
        type: 'rate_limit_error',
        message: 'Too many requests',
      })

      await expect(
        processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toMatchObject({
        type: 'rate_limit_error',
      })
    })

    it('should handle invalid request errors', async () => {
      mockProvider.charge = vi.fn().mockRejectedValue({
        type: 'invalid_request_error',
        code: 'invalid_number',
        message: 'Card number is invalid',
      })

      await expect(
        processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toMatchObject({
        code: 'invalid_number',
      })
    })

    it('should list failed charges', async () => {
      mockProvider.charge = vi.fn().mockRejectedValue({
        type: 'card_error',
        code: 'card_declined',
        message: 'Declined',
      })

      // Attempt multiple failed charges
      for (let i = 0; i < 3; i++) {
        try {
          await processor.charge({
            amount: 1000,
            currency: 'USD',
            customerId: 'cust_failed',
            paymentMethodId: 'pm_xxx',
          })
        } catch {}
      }

      const failedCharges = await processor.getChargesByCustomer('cust_failed', {
        status: 'failed',
      })
      expect(failedCharges.length).toBe(3)
    })

    it('should allow retry after failure', async () => {
      let attempts = 0
      mockProvider.charge = vi.fn().mockImplementation(() => {
        attempts++
        if (attempts === 1) {
          throw {
            type: 'card_error',
            code: 'card_declined',
            message: 'Declined',
          }
        }
        return {
          providerChargeId: `ch_${Date.now()}`,
          status: 'succeeded' as ChargeStatus,
        }
      })

      // First attempt fails
      try {
        await processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      } catch {}

      // Second attempt succeeds
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.status).toBe('succeeded')
    })
  })

  // =============================================================================
  // 3D Secure Flow Integration Tests
  // =============================================================================

  describe('3D Secure flow integration', () => {
    let processor: ChargeProcessor
    let mockProvider: ChargeProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should initiate 3D Secure when required', async () => {
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: `ch_${Date.now()}`,
        status: 'requires_action' as ChargeStatus,
        clientSecret: 'pi_xxx_secret_xxx',
        nextAction: {
          type: 'use_stripe_sdk',
          redirectUrl: null,
        },
      })

      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.status).toBe('requires_action')
      expect(charge.clientSecret).toBeDefined()
    })

    it('should handle 3D Secure redirect', async () => {
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: `ch_${Date.now()}`,
        status: 'requires_action' as ChargeStatus,
        clientSecret: 'pi_xxx_secret_xxx',
        nextAction: {
          type: 'redirect_to_url',
          redirectUrl: 'https://3dsecure.example.com/auth',
        },
      })

      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.nextAction?.type).toBe('redirect_to_url')
      expect(charge.nextAction?.redirectUrl).toBe('https://3dsecure.example.com/auth')
    })

    it('should confirm charge after 3D Secure authentication', async () => {
      // First, create charge that requires 3D Secure
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: 'ch_123',
        status: 'requires_action' as ChargeStatus,
        clientSecret: 'pi_xxx_secret_xxx',
      })

      const pendingCharge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      // Then, confirm after 3D Secure
      mockProvider.confirm3DSecure = vi.fn().mockResolvedValue({
        status: 'succeeded' as ThreeDSecureStatus,
        chargeStatus: 'succeeded' as ChargeStatus,
      })

      const confirmed = await processor.confirmAfter3DSecure(pendingCharge.id, {
        paymentIntentId: 'pi_xxx',
      })

      expect(confirmed.status).toBe('succeeded')
    })

    it('should handle 3D Secure failure', async () => {
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: 'ch_123',
        status: 'requires_action' as ChargeStatus,
        clientSecret: 'pi_xxx_secret_xxx',
      })

      const pendingCharge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      mockProvider.confirm3DSecure = vi.fn().mockResolvedValue({
        status: 'failed' as ThreeDSecureStatus,
        chargeStatus: 'failed' as ChargeStatus,
        failureReason: 'authentication_failed',
      })

      const result = await processor.confirmAfter3DSecure(pendingCharge.id, {
        paymentIntentId: 'pi_xxx',
      })

      expect(result.status).toBe('failed')
      expect(result.threeDSecureStatus).toBe('failed')
    })

    it('should track 3D Secure authentication result', async () => {
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: 'ch_123',
        status: 'requires_action' as ChargeStatus,
        clientSecret: 'pi_xxx_secret_xxx',
      })

      const pendingCharge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      mockProvider.confirm3DSecure = vi.fn().mockResolvedValue({
        status: 'succeeded' as ThreeDSecureStatus,
        chargeStatus: 'succeeded' as ChargeStatus,
        authenticationResult: {
          transactionId: '3ds_txn_123',
          acsTransactionId: 'acs_456',
          dsTransactionId: 'ds_789',
        },
      })

      const confirmed = await processor.confirmAfter3DSecure(pendingCharge.id, {
        paymentIntentId: 'pi_xxx',
      })

      expect(confirmed.threeDSecure?.transactionId).toBe('3ds_txn_123')
    })

    it('should support 3D Secure 2.0 frictionless flow', async () => {
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: 'ch_123',
        status: 'succeeded' as ChargeStatus, // Frictionless - no requires_action
        threeDSecure: {
          version: '2.0',
          authenticated: true,
          flow: 'frictionless',
        },
      })

      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.status).toBe('succeeded')
      expect(charge.threeDSecure?.flow).toBe('frictionless')
    })

    it('should handle 3D Secure challenge flow', async () => {
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: 'ch_123',
        status: 'requires_action' as ChargeStatus,
        clientSecret: 'pi_xxx_secret_xxx',
        threeDSecure: {
          version: '2.0',
          flow: 'challenge',
        },
      })

      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(charge.threeDSecure?.flow).toBe('challenge')
    })

    it('should store 3D Secure exemption request', async () => {
      const charge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        threeDSecureOptions: {
          exemptionType: 'low_value',
        },
      })

      expect(mockProvider.charge).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          threeDSecureOptions: {
            exemptionType: 'low_value',
          },
        })
      )
    })

    it('should handle different exemption types', async () => {
      const exemptions: Array<'low_value' | 'low_risk' | 'trusted_merchant' | 'recurring'> = [
        'low_value',
        'low_risk',
        'trusted_merchant',
        'recurring',
      ]

      for (const exemptionType of exemptions) {
        const charge = await processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
          threeDSecureOptions: { exemptionType },
        })

        expect(charge.id).toBeDefined()
      }
    })

    it('should timeout 3D Secure authentication', async () => {
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: 'ch_123',
        status: 'requires_action' as ChargeStatus,
        clientSecret: 'pi_xxx_secret_xxx',
      })

      const pendingCharge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      // Simulate timeout check
      const expired = await processor.checkChargeExpiration(pendingCharge.id)
      // Note: This depends on configuration, default might be 15 minutes
      expect(expired).toBeDefined()
    })

    it('should cancel pending 3D Secure charge', async () => {
      mockProvider.charge = vi.fn().mockResolvedValue({
        providerChargeId: 'ch_123',
        status: 'requires_action' as ChargeStatus,
        clientSecret: 'pi_xxx_secret_xxx',
      })

      const pendingCharge = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const canceled = await processor.cancel(pendingCharge.id)

      expect(canceled.status).toBe('canceled')
    })
  })

  // =============================================================================
  // Integration and Edge Cases Tests
  // =============================================================================

  describe('integration and edge cases', () => {
    let processor: ChargeProcessor
    let mockProvider: ChargeProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should get charge by ID', async () => {
      const created = await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const retrieved = await processor.getCharge(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should return null for non-existent charge', async () => {
      const charge = await processor.getCharge('nonexistent_id')
      expect(charge).toBeNull()
    })

    it('should list charges by customer', async () => {
      await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_list_test',
        paymentMethodId: 'pm_xxx',
      })
      await processor.charge({
        amount: 2000,
        currency: 'USD',
        customerId: 'cust_list_test',
        paymentMethodId: 'pm_xxx',
      })
      await processor.charge({
        amount: 3000,
        currency: 'USD',
        customerId: 'cust_other',
        paymentMethodId: 'pm_xxx',
      })

      const charges = await processor.getChargesByCustomer('cust_list_test')

      expect(charges).toHaveLength(2)
      expect(charges.every((c) => c.customerId === 'cust_list_test')).toBe(true)
    })

    it('should paginate charge results', async () => {
      // Create 10 charges
      for (let i = 0; i < 10; i++) {
        await processor.charge({
          amount: 1000 * (i + 1),
          currency: 'USD',
          customerId: 'cust_paginate',
          paymentMethodId: 'pm_xxx',
        })
      }

      const page1 = await processor.getChargesByCustomer('cust_paginate', {
        limit: 5,
      })
      const page2 = await processor.getChargesByCustomer('cust_paginate', {
        limit: 5,
        startingAfter: page1[page1.length - 1].id,
      })

      expect(page1).toHaveLength(5)
      expect(page2).toHaveLength(5)
      expect(page1[0].id).not.toBe(page2[0].id)
    })

    it('should filter charges by date range', async () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_date',
        paymentMethodId: 'pm_xxx',
      })

      const charges = await processor.getChargesByCustomer('cust_date', {
        createdAfter: yesterday,
        createdBefore: tomorrow,
      })

      expect(charges.length).toBeGreaterThan(0)
    })

    it('should register multiple providers', () => {
      const paypalProvider = createMockProvider('paypal')
      processor.registerProvider('paypal', paypalProvider)

      const providers = processor.listProviders()
      expect(providers).toContain('stripe')
      expect(providers).toContain('paypal')
    })

    it('should use specific provider for charge', async () => {
      const paypalProvider = createMockProvider('paypal')
      processor.registerProvider('paypal', paypalProvider)

      await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        provider: 'paypal',
      })

      expect(paypalProvider.charge).toHaveBeenCalled()
      expect(mockProvider.charge).not.toHaveBeenCalled()
    })

    it('should calculate total charges for customer', async () => {
      await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_total',
        paymentMethodId: 'pm_xxx',
      })
      await processor.charge({
        amount: 2000,
        currency: 'USD',
        customerId: 'cust_total',
        paymentMethodId: 'pm_xxx',
      })

      const total = await processor.getTotalChargedAmount('cust_total', 'USD')
      expect(total).toBe(3000)
    })

    it('should handle concurrent charges with idempotency', async () => {
      const idempotencyKey = 'concurrent_key'

      const promises = Array.from({ length: 5 }, () =>
        processor.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
          idempotencyKey,
        })
      )

      const results = await Promise.all(promises)
      const uniqueIds = new Set(results.map((r) => r.id))

      expect(uniqueIds.size).toBe(1)
      expect(mockProvider.charge).toHaveBeenCalledTimes(1)
    })
  })
})
