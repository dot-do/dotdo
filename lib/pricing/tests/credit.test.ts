import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CreditPricing } from '../types'
import {
  CreditAccount,
  createCreditAccount,
  CreditPurchase,
  CreditUsageResult,
} from '../credit'

// ============================================================================
// CreditAccount Tests
// ============================================================================

describe('CreditAccount', () => {
  const defaultPricing: CreditPricing = {
    model: 'credit',
    price: 99,
    amount: 100,
    expiration: 365, // 1 year in days
  }

  describe('createCreditAccount', () => {
    it('should create an account with zero balance', () => {
      const account = createCreditAccount(defaultPricing)

      expect(account.getBalance()).toBe(0)
    })

    it('should store the pricing configuration', () => {
      const account = createCreditAccount(defaultPricing)

      expect(account.getPricing()).toEqual(defaultPricing)
    })
  })

  describe('purchaseCredits', () => {
    it('should add credits to the balance', () => {
      const account = createCreditAccount(defaultPricing)

      account.purchaseCredits()

      expect(account.getBalance()).toBe(100)
    })

    it('should stack multiple purchases', () => {
      const account = createCreditAccount(defaultPricing)

      account.purchaseCredits()
      account.purchaseCredits()

      expect(account.getBalance()).toBe(200)
    })

    it('should return purchase details', () => {
      const account = createCreditAccount(defaultPricing)

      const purchase = account.purchaseCredits()

      expect(purchase.amount).toBe(100)
      expect(purchase.price).toBe(99)
      expect(purchase.purchasedAt).toBeInstanceOf(Date)
    })

    it('should set expiration date when expiration is configured', () => {
      const account = createCreditAccount(defaultPricing)

      const purchase = account.purchaseCredits()

      expect(purchase.expiresAt).toBeInstanceOf(Date)
      const expectedExpiry = new Date(purchase.purchasedAt)
      expectedExpiry.setDate(expectedExpiry.getDate() + 365)
      expect(purchase.expiresAt?.getDate()).toBe(expectedExpiry.getDate())
    })

    it('should not set expiration when expiration is null', () => {
      const noExpiryPricing: CreditPricing = {
        model: 'credit',
        price: 99,
        amount: 100,
        expiration: null,
      }
      const account = createCreditAccount(noExpiryPricing)

      const purchase = account.purchaseCredits()

      expect(purchase.expiresAt).toBeNull()
    })
  })

  describe('useCredits', () => {
    it('should deduct credits from the balance', () => {
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits()

      const result = account.useCredits(10)

      expect(result.success).toBe(true)
      expect(result.creditsUsed).toBe(10)
      expect(account.getBalance()).toBe(90)
    })

    it('should fail when insufficient balance', () => {
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits() // 100 credits

      const result = account.useCredits(150)

      expect(result.success).toBe(false)
      expect(result.creditsUsed).toBe(0)
      expect(result.error).toBe('insufficient_balance')
      expect(account.getBalance()).toBe(100)
    })

    it('should use exact remaining balance', () => {
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits()

      const result = account.useCredits(100)

      expect(result.success).toBe(true)
      expect(account.getBalance()).toBe(0)
    })

    it('should fail for negative amounts', () => {
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits()

      const result = account.useCredits(-10)

      expect(result.success).toBe(false)
      expect(result.error).toBe('invalid_amount')
    })

    it('should fail for zero amount', () => {
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits()

      const result = account.useCredits(0)

      expect(result.success).toBe(false)
      expect(result.error).toBe('invalid_amount')
    })
  })

  describe('expiration handling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('should expire credits after expiration period', () => {
      vi.setSystemTime(new Date('2025-01-01'))
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits()

      expect(account.getBalance()).toBe(100)

      // Move forward 366 days (past expiration)
      vi.setSystemTime(new Date('2026-01-02'))

      expect(account.getBalance()).toBe(0)

      vi.useRealTimers()
    })

    it('should not expire credits within expiration period', () => {
      vi.setSystemTime(new Date('2025-01-01'))
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits()

      // Move forward 364 days (within expiration)
      vi.setSystemTime(new Date('2025-12-31'))

      expect(account.getBalance()).toBe(100)

      vi.useRealTimers()
    })

    it('should handle FIFO expiration for multiple purchases', () => {
      vi.setSystemTime(new Date('2025-01-01'))
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits() // Expires 2026-01-01

      vi.setSystemTime(new Date('2025-06-01'))
      account.purchaseCredits() // Expires 2026-06-01

      expect(account.getBalance()).toBe(200)

      // After first batch expires
      vi.setSystemTime(new Date('2026-01-15'))

      expect(account.getBalance()).toBe(100)

      vi.useRealTimers()
    })

    it('should never expire when expiration is null', () => {
      vi.setSystemTime(new Date('2025-01-01'))
      const noExpiryPricing: CreditPricing = {
        model: 'credit',
        price: 99,
        amount: 100,
        expiration: null,
      }
      const account = createCreditAccount(noExpiryPricing)
      account.purchaseCredits()

      // Move forward 10 years
      vi.setSystemTime(new Date('2035-01-01'))

      expect(account.getBalance()).toBe(100)

      vi.useRealTimers()
    })

    it('should use oldest credits first (FIFO)', () => {
      vi.setSystemTime(new Date('2025-01-01'))
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits() // 100 credits, expires 2026-01-01

      vi.setSystemTime(new Date('2025-06-01'))
      account.purchaseCredits() // 100 more credits, expires 2026-06-01

      // Use 50 credits - should come from first purchase
      account.useCredits(50)

      // After first batch expires, should have 100 from second batch
      vi.setSystemTime(new Date('2026-01-15'))
      expect(account.getBalance()).toBe(100)

      vi.useRealTimers()
    })
  })

  describe('automatic top-up', () => {
    it('should trigger top-up when balance falls below threshold', () => {
      const topUpPricing: CreditPricing = {
        model: 'credit',
        price: 99,
        amount: 100,
        topUp: {
          enabled: true,
          threshold: 20,
          amount: 50,
        },
      }
      const onTopUp = vi.fn()
      const account = createCreditAccount(topUpPricing, { onTopUp })
      account.purchaseCredits()

      // Use 85 credits, leaving 15 (below threshold of 20)
      account.useCredits(85)

      expect(onTopUp).toHaveBeenCalledTimes(1)
      expect(onTopUp).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 50,
          reason: 'threshold',
        })
      )
    })

    it('should add top-up credits automatically', () => {
      const topUpPricing: CreditPricing = {
        model: 'credit',
        price: 99,
        amount: 100,
        topUp: {
          enabled: true,
          threshold: 20,
          amount: 50,
        },
      }
      const account = createCreditAccount(topUpPricing, { onTopUp: () => {} })
      account.purchaseCredits()

      // Use 85 credits, should trigger top-up of 50
      account.useCredits(85)

      // 100 - 85 + 50 = 65
      expect(account.getBalance()).toBe(65)
    })

    it('should not trigger top-up when disabled', () => {
      const noTopUpPricing: CreditPricing = {
        model: 'credit',
        price: 99,
        amount: 100,
        topUp: {
          enabled: false,
          threshold: 20,
          amount: 50,
        },
      }
      const onTopUp = vi.fn()
      const account = createCreditAccount(noTopUpPricing, { onTopUp })
      account.purchaseCredits()

      account.useCredits(85)

      expect(onTopUp).not.toHaveBeenCalled()
      expect(account.getBalance()).toBe(15)
    })

    it('should not trigger top-up when balance stays above threshold', () => {
      const topUpPricing: CreditPricing = {
        model: 'credit',
        price: 99,
        amount: 100,
        topUp: {
          enabled: true,
          threshold: 20,
          amount: 50,
        },
      }
      const onTopUp = vi.fn()
      const account = createCreditAccount(topUpPricing, { onTopUp })
      account.purchaseCredits()

      // Use 50 credits, leaving 50 (above threshold of 20)
      account.useCredits(50)

      expect(onTopUp).not.toHaveBeenCalled()
    })

    it('should not trigger multiple top-ups for single usage', () => {
      const topUpPricing: CreditPricing = {
        model: 'credit',
        price: 99,
        amount: 100,
        topUp: {
          enabled: true,
          threshold: 20,
          amount: 50,
        },
      }
      const onTopUp = vi.fn()
      const account = createCreditAccount(topUpPricing, { onTopUp })
      account.purchaseCredits()

      account.useCredits(85) // Falls to 15, triggers top-up to 65
      account.useCredits(50) // Falls to 15 again, triggers another top-up

      expect(onTopUp).toHaveBeenCalledTimes(2)
    })
  })

  describe('getPurchaseHistory', () => {
    it('should return empty array when no purchases', () => {
      const account = createCreditAccount(defaultPricing)

      expect(account.getPurchaseHistory()).toEqual([])
    })

    it('should track all purchases', () => {
      const account = createCreditAccount(defaultPricing)

      account.purchaseCredits()
      account.purchaseCredits()
      account.purchaseCredits()

      expect(account.getPurchaseHistory()).toHaveLength(3)
    })
  })

  describe('getExpiredCredits', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('should return total expired credits', () => {
      vi.setSystemTime(new Date('2025-01-01'))
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits()

      vi.setSystemTime(new Date('2026-01-15'))

      expect(account.getExpiredCredits()).toBe(100)

      vi.useRealTimers()
    })

    it('should return zero when no credits expired', () => {
      vi.setSystemTime(new Date('2025-01-01'))
      const account = createCreditAccount(defaultPricing)
      account.purchaseCredits()

      expect(account.getExpiredCredits()).toBe(0)

      vi.useRealTimers()
    })
  })
})
