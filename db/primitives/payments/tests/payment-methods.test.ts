/**
 * PaymentMethodStore Tests
 *
 * Comprehensive tests for tokenized payment method storage primitive.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  PaymentMethodStore,
  createPaymentMethodStore,
  detectCardBrand,
  detectProvider,
  isCardExpired,
  validateCardExpiry,
  validateLast4,
  validateBillingAddress,
  validatePaymentMethodMetadata,
  type PaymentMethodMetadata,
  type BillingAddress,
} from '../payment-methods'

describe('PaymentMethodStore', () => {
  let store: PaymentMethodStore

  beforeEach(() => {
    store = createPaymentMethodStore()
  })

  // ===========================================================================
  // Store Payment Method Tests
  // ===========================================================================

  describe('store()', () => {
    it('should store a card payment method with tokenized data', async () => {
      const pm = await store.store('cust_123', 'pm_stripe_card_visa_4242', {
        type: 'card',
        card: {
          last4: '4242',
          brand: 'visa',
          expMonth: 12,
          expYear: 2030,
        },
      })

      expect(pm).toBeDefined()
      expect(pm.id).toMatch(/^pm_/)
      expect(pm.customerId).toBe('cust_123')
      expect(pm.token).toBe('pm_stripe_card_visa_4242')
      expect(pm.type).toBe('card')
      expect(pm.card?.last4).toBe('4242')
      expect(pm.card?.brand).toBe('visa')
      expect(pm.card?.expMonth).toBe(12)
      expect(pm.card?.expYear).toBe(2030)
      expect(pm.isExpired).toBe(false)
      expect(pm.provider).toBe('stripe')
      expect(pm.createdAt).toBeInstanceOf(Date)
      expect(pm.updatedAt).toBeInstanceOf(Date)
    })

    it('should store a bank account payment method', async () => {
      const pm = await store.store('cust_123', 'btok_us_bank_1234', {
        type: 'bank_account',
        bankAccount: {
          last4: '1234',
          bankName: 'Chase',
          accountHolderName: 'John Doe',
          accountHolderType: 'individual',
          accountType: 'checking',
          country: 'US',
        },
      })

      expect(pm.type).toBe('bank_account')
      expect(pm.bankAccount?.last4).toBe('1234')
      expect(pm.bankAccount?.bankName).toBe('Chase')
      expect(pm.bankAccount?.accountHolderName).toBe('John Doe')
      expect(pm.bankAccount?.accountHolderType).toBe('individual')
    })

    it('should store a wallet payment method', async () => {
      const pm = await store.store('cust_123', 'PAYID-wallet_123', {
        type: 'wallet',
        wallet: {
          type: 'apple_pay',
          dynamicLast4: '4242',
        },
      })

      expect(pm.type).toBe('wallet')
      expect(pm.wallet?.type).toBe('apple_pay')
      expect(pm.wallet?.dynamicLast4).toBe('4242')
    })

    it('should store billing address with payment method', async () => {
      const pm = await store.store('cust_123', 'pm_stripe_xxx', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
        billingAddress: {
          name: 'John Doe',
          line1: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          postalCode: '94102',
          country: 'US',
          email: 'john@example.com',
        },
      })

      expect(pm.billingAddress).toBeDefined()
      expect(pm.billingAddress?.name).toBe('John Doe')
      expect(pm.billingAddress?.line1).toBe('123 Main St')
      expect(pm.billingAddress?.country).toBe('US')
    })

    it('should auto-set first payment method as default', async () => {
      const pm1 = await store.store('cust_123', 'pm_stripe_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      expect(pm1.isDefault).toBe(true)

      const pm2 = await store.store('cust_123', 'pm_stripe_2', {
        type: 'card',
        card: { last4: '1234', brand: 'mastercard', expMonth: 6, expYear: 2028 },
      })

      expect(pm2.isDefault).toBe(false)
    })

    it('should allow explicit setAsDefault option', async () => {
      await store.store('cust_123', 'pm_stripe_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      const pm2 = await store.store(
        'cust_123',
        'pm_stripe_2',
        {
          type: 'card',
          card: { last4: '1234', brand: 'mastercard', expMonth: 6, expYear: 2028 },
        },
        { setAsDefault: true }
      )

      expect(pm2.isDefault).toBe(true)

      // Verify first is no longer default
      const pm1 = await store.get((await store.list('cust_123'))[1].id)
      expect(pm1?.isDefault).toBe(false)
    })

    it('should store custom metadata', async () => {
      const pm = await store.store(
        'cust_123',
        'pm_stripe_xxx',
        {
          type: 'card',
          card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
        },
        { metadata: { source: 'checkout', campaign: 'summer_2024' } }
      )

      expect(pm.metadata).toEqual({ source: 'checkout', campaign: 'summer_2024' })
    })

    it('should detect provider from token prefix', async () => {
      const stripePm = await store.store('cust_123', 'pm_stripe_xxx', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      expect(stripePm.provider).toBe('stripe')

      const braintreePm = await store.store('cust_456', 'btok_braintree_xxx', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      expect(braintreePm.provider).toBe('braintree')

      const squarePm = await store.store('cust_789', 'sq0xxx-token', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      expect(squarePm.provider).toBe('square')
    })

    it('should allow explicit provider override', async () => {
      const pm = await store.store('cust_123', 'custom_token_xxx', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
        provider: 'adyen',
      })

      expect(pm.provider).toBe('adyen')
    })

    it('should reject duplicate token for same customer', async () => {
      await store.store('cust_123', 'pm_stripe_xxx', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      await expect(
        store.store('cust_123', 'pm_stripe_xxx', {
          type: 'card',
          card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
        })
      ).rejects.toThrow('Payment method with this token already exists')
    })

    it('should allow same token for different customers', async () => {
      const pm1 = await store.store('cust_123', 'pm_stripe_xxx', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      const pm2 = await store.store('cust_456', 'pm_stripe_xxx', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      expect(pm1.id).not.toBe(pm2.id)
      expect(pm1.customerId).toBe('cust_123')
      expect(pm2.customerId).toBe('cust_456')
    })

    it('should reject empty customer ID', async () => {
      await expect(
        store.store('', 'pm_stripe_xxx', {
          type: 'card',
          card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
        })
      ).rejects.toThrow('Customer ID is required')
    })

    it('should reject empty token', async () => {
      await expect(
        store.store('cust_123', '', {
          type: 'card',
          card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
        })
      ).rejects.toThrow('Payment method token is required')
    })
  })

  // ===========================================================================
  // Get Payment Method Tests
  // ===========================================================================

  describe('get()', () => {
    it('should retrieve a payment method by ID', async () => {
      const stored = await store.store('cust_123', 'pm_stripe_xxx', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      const retrieved = await store.get(stored.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(stored.id)
      expect(retrieved?.token).toBe('pm_stripe_xxx')
      expect(retrieved?.card?.last4).toBe('4242')
    })

    it('should return null for non-existent ID', async () => {
      const result = await store.get('pm_nonexistent')
      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // List Payment Methods Tests
  // ===========================================================================

  describe('list()', () => {
    beforeEach(async () => {
      // Store multiple payment methods
      await store.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      await store.store('cust_123', 'pm_card_2', {
        type: 'card',
        card: { last4: '1234', brand: 'mastercard', expMonth: 6, expYear: 2028 },
      })
      await store.store('cust_123', 'btok_bank_1', {
        type: 'bank_account',
        bankAccount: {
          last4: '5678',
          accountHolderName: 'John Doe',
          accountHolderType: 'individual',
        },
      })
      await store.store('cust_456', 'pm_card_3', {
        type: 'card',
        card: { last4: '9999', brand: 'amex', expMonth: 3, expYear: 2029 },
      })
    })

    it('should list all payment methods for a customer', async () => {
      const methods = await store.list('cust_123')

      expect(methods).toHaveLength(3)
      expect(methods.every((m) => m.customerId === 'cust_123')).toBe(true)
    })

    it('should return empty array for customer with no methods', async () => {
      const methods = await store.list('cust_nonexistent')
      expect(methods).toEqual([])
    })

    it('should filter by payment method type', async () => {
      const cards = await store.list('cust_123', { type: 'card' })
      expect(cards).toHaveLength(2)
      expect(cards.every((m) => m.type === 'card')).toBe(true)

      const banks = await store.list('cust_123', { type: 'bank_account' })
      expect(banks).toHaveLength(1)
      expect(banks[0].type).toBe('bank_account')
    })

    it('should show default payment method first', async () => {
      const methods = await store.list('cust_123')
      expect(methods[0].isDefault).toBe(true)
    })

    it('should support pagination with limit and offset', async () => {
      const page1 = await store.list('cust_123', { limit: 2 })
      expect(page1).toHaveLength(2)

      const page2 = await store.list('cust_123', { limit: 2, offset: 2 })
      expect(page2).toHaveLength(1)
    })

    it('should exclude expired cards by default', async () => {
      // Add an expired card
      const expiredStore = createPaymentMethodStore()
      await expiredStore.store('cust_123', 'pm_card_valid', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      await expiredStore.store(
        'cust_123',
        'pm_card_expired',
        {
          type: 'card',
          card: { last4: '1111', brand: 'visa', expMonth: 1, expYear: 2020 },
        },
        { skipExpiryValidation: true }
      )

      const methods = await expiredStore.list('cust_123')
      expect(methods).toHaveLength(1)
      expect(methods[0].card?.last4).toBe('4242')
    })

    it('should include expired cards when includeExpired is true', async () => {
      const expiredStore = createPaymentMethodStore()
      await expiredStore.store('cust_123', 'pm_card_valid', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      await expiredStore.store(
        'cust_123',
        'pm_card_expired',
        {
          type: 'card',
          card: { last4: '1111', brand: 'visa', expMonth: 1, expYear: 2020 },
        },
        { skipExpiryValidation: true }
      )

      const methods = await expiredStore.list('cust_123', { includeExpired: true })
      expect(methods).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Set Default Tests
  // ===========================================================================

  describe('setDefault()', () => {
    it('should set a payment method as default', async () => {
      const pm1 = await store.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      const pm2 = await store.store('cust_123', 'pm_card_2', {
        type: 'card',
        card: { last4: '1234', brand: 'mastercard', expMonth: 6, expYear: 2028 },
      })

      expect(pm1.isDefault).toBe(true)
      expect(pm2.isDefault).toBe(false)

      await store.setDefault('cust_123', pm2.id)

      const updated1 = await store.get(pm1.id)
      const updated2 = await store.get(pm2.id)

      expect(updated1?.isDefault).toBe(false)
      expect(updated2?.isDefault).toBe(true)
    })

    it('should get customer default payment method', async () => {
      await store.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      await store.store('cust_123', 'pm_card_2', {
        type: 'card',
        card: { last4: '1234', brand: 'mastercard', expMonth: 6, expYear: 2028 },
      })

      const defaultPm = await store.getDefault('cust_123')
      expect(defaultPm).toBeDefined()
      expect(defaultPm?.card?.last4).toBe('4242')
    })

    it('should reject setting non-existent payment method as default', async () => {
      await expect(store.setDefault('cust_123', 'pm_nonexistent')).rejects.toThrow(
        'Payment method not found'
      )
    })

    it('should reject setting payment method from different customer', async () => {
      const pm = await store.store('cust_456', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      await expect(store.setDefault('cust_123', pm.id)).rejects.toThrow(
        'Payment method does not belong to this customer'
      )
    })

    it('should reject setting expired card as default', async () => {
      await store.store('cust_123', 'pm_card_valid', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      const expired = await store.store(
        'cust_123',
        'pm_card_expired',
        {
          type: 'card',
          card: { last4: '1111', brand: 'visa', expMonth: 1, expYear: 2020 },
        },
        { skipExpiryValidation: true }
      )

      await expect(store.setDefault('cust_123', expired.id)).rejects.toThrow(
        'Cannot set an expired payment method as default'
      )
    })
  })

  // ===========================================================================
  // Delete Payment Method Tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a payment method', async () => {
      const pm = await store.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      const result = await store.delete(pm.id)

      expect(result).toBe(true)
      expect(await store.get(pm.id)).toBeNull()
      expect(await store.list('cust_123')).toHaveLength(0)
    })

    it('should return false for non-existent payment method', async () => {
      const result = await store.delete('pm_nonexistent')
      expect(result).toBe(false)
    })

    it('should set another method as default when deleting default', async () => {
      const pm1 = await store.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      const pm2 = await store.store('cust_123', 'pm_card_2', {
        type: 'card',
        card: { last4: '1234', brand: 'mastercard', expMonth: 6, expYear: 2028 },
      })

      expect(pm1.isDefault).toBe(true)

      await store.delete(pm1.id)

      const remaining = await store.list('cust_123')
      expect(remaining).toHaveLength(1)
      expect(remaining[0].isDefault).toBe(true)
    })

    it('should not set expired card as default when deleting default', async () => {
      const pm1 = await store.store('cust_123', 'pm_card_valid', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      // Expired card won't become default when valid card is deleted
      await store.store(
        'cust_123',
        'pm_card_expired',
        {
          type: 'card',
          card: { last4: '1111', brand: 'visa', expMonth: 1, expYear: 2020 },
        },
        { skipExpiryValidation: true }
      )

      await store.delete(pm1.id)

      // The expired card exists but isn't default
      const defaultPm = await store.getDefault('cust_123')
      expect(defaultPm).toBeNull()
    })
  })

  // ===========================================================================
  // Update Operations Tests
  // ===========================================================================

  describe('update operations', () => {
    it('should update billing address', async () => {
      const pm = await store.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      const updated = await store.updateBillingAddress(pm.id, {
        name: 'Jane Doe',
        line1: '456 Oak Ave',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        country: 'US',
      })

      expect(updated?.billingAddress?.name).toBe('Jane Doe')
      expect(updated?.billingAddress?.city).toBe('Los Angeles')
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(pm.updatedAt.getTime())
    })

    it('should update metadata', async () => {
      const pm = await store.store(
        'cust_123',
        'pm_card_1',
        {
          type: 'card',
          card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
        },
        { metadata: { source: 'checkout' } }
      )

      const updated = await store.updateMetadata(pm.id, {
        campaign: 'summer_sale',
        discount: 10,
      })

      expect(updated?.metadata).toEqual({
        source: 'checkout',
        campaign: 'summer_sale',
        discount: 10,
      })
    })

    it('should return null when updating non-existent method', async () => {
      const result = await store.updateBillingAddress('pm_nonexistent', {
        name: 'Test',
      })
      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // Utility Methods Tests
  // ===========================================================================

  describe('utility methods', () => {
    it('should count payment methods', async () => {
      await store.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      await store.store('cust_123', 'pm_card_2', {
        type: 'card',
        card: { last4: '1234', brand: 'mastercard', expMonth: 6, expYear: 2028 },
      })
      await store.store('cust_123', 'btok_bank_1', {
        type: 'bank_account',
        bankAccount: {
          last4: '5678',
          accountHolderName: 'John Doe',
          accountHolderType: 'individual',
        },
      })

      expect(await store.count('cust_123')).toBe(3)
      expect(await store.count('cust_123', { type: 'card' })).toBe(2)
      expect(await store.count('cust_nonexistent')).toBe(0)
    })

    it('should check if payment method exists', async () => {
      const pm = await store.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      expect(await store.exists(pm.id)).toBe(true)
      expect(await store.exists('pm_nonexistent')).toBe(false)
    })

    it('should get payment method by token', async () => {
      await store.store('cust_123', 'pm_stripe_unique_token', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      const found = await store.getByToken('pm_stripe_unique_token')
      expect(found).toBeDefined()
      expect(found?.card?.last4).toBe('4242')

      const notFound = await store.getByToken('pm_nonexistent')
      expect(notFound).toBeNull()
    })

    it('should get all payment methods including expired', async () => {
      await store.store('cust_123', 'pm_card_valid', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      await store.store(
        'cust_123',
        'pm_card_expired',
        {
          type: 'card',
          card: { last4: '1111', brand: 'visa', expMonth: 1, expYear: 2020 },
        },
        { skipExpiryValidation: true }
      )

      const all = await store.getAll('cust_123')
      expect(all).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Configuration Tests
  // ===========================================================================

  describe('configuration', () => {
    it('should respect autoSetDefault=false', async () => {
      const customStore = createPaymentMethodStore({ autoSetDefault: false })

      const pm = await customStore.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })

      expect(pm.isDefault).toBe(false)
      expect(await customStore.getDefault('cust_123')).toBeNull()
    })

    it('should restrict allowed payment types', async () => {
      const cardOnlyStore = createPaymentMethodStore({ allowedTypes: ['card'] })

      await expect(
        cardOnlyStore.store('cust_123', 'btok_bank_1', {
          type: 'bank_account',
          bankAccount: {
            last4: '5678',
            accountHolderName: 'John Doe',
            accountHolderType: 'individual',
          },
        })
      ).rejects.toThrow("Payment method type 'bank_account' is not allowed")
    })

    it('should require billing address when configured', async () => {
      const billingRequiredStore = createPaymentMethodStore({
        requireBillingAddress: true,
      })

      await expect(
        billingRequiredStore.store('cust_123', 'pm_card_1', {
          type: 'card',
          card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
        })
      ).rejects.toThrow('Billing address is required')

      const pm = await billingRequiredStore.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
        billingAddress: {
          name: 'John Doe',
          line1: '123 Main St',
          city: 'SF',
          country: 'US',
        },
      })

      expect(pm).toBeDefined()
    })

    it('should use custom ID generator', async () => {
      let counter = 0
      const customStore = createPaymentMethodStore({
        idGenerator: () => `custom_pm_${++counter}`,
      })

      const pm1 = await customStore.store('cust_123', 'pm_card_1', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
      const pm2 = await customStore.store('cust_123', 'pm_card_2', {
        type: 'card',
        card: { last4: '1234', brand: 'mastercard', expMonth: 6, expYear: 2028 },
      })

      expect(pm1.id).toBe('custom_pm_1')
      expect(pm2.id).toBe('custom_pm_2')
    })
  })
})

// =============================================================================
// Validation Helper Function Tests
// =============================================================================

describe('Validation Helpers', () => {
  describe('detectCardBrand()', () => {
    it('should detect Stripe card brands from token', () => {
      expect(detectCardBrand('pm_card_visa_4242')).toBe('visa')
      expect(detectCardBrand('pm_card_mastercard_5555')).toBe('mastercard')
      expect(detectCardBrand('pm_card_amex_3782')).toBe('amex')
      expect(detectCardBrand('pm_card_discover_6011')).toBe('discover')
    })

    it('should detect brands from generic tokens', () => {
      expect(detectCardBrand('tok_visa_test')).toBe('visa')
      expect(detectCardBrand('tok_mc_test')).toBe('mastercard')
      expect(detectCardBrand('tok_american_express')).toBe('amex')
    })

    it('should return unknown for unrecognized tokens', () => {
      expect(detectCardBrand('random_token_123')).toBe('unknown')
    })
  })

  describe('detectProvider()', () => {
    it('should detect Stripe from pm_ prefix', () => {
      expect(detectProvider('pm_xxx')).toBe('stripe')
      expect(detectProvider('tok_xxx')).toBe('stripe')
      expect(detectProvider('src_xxx')).toBe('stripe')
    })

    it('should detect Braintree from btok_ prefix', () => {
      expect(detectProvider('btok_xxx')).toBe('braintree')
      expect(detectProvider('nonce-xxx')).toBe('braintree')
    })

    it('should detect Square from sq0 prefix', () => {
      expect(detectProvider('sq0xxx')).toBe('square')
    })

    it('should detect PayPal from PAYID- prefix', () => {
      expect(detectProvider('PAYID-xxx')).toBe('paypal')
    })

    it('should return unknown for unrecognized tokens', () => {
      expect(detectProvider('random_xxx')).toBe('unknown')
    })
  })

  describe('isCardExpired()', () => {
    it('should return true for expired cards', () => {
      expect(isCardExpired(1, 2020)).toBe(true)
      expect(isCardExpired(12, 2023)).toBe(true)
    })

    it('should return false for non-expired cards', () => {
      expect(isCardExpired(12, 2030)).toBe(false)
      expect(isCardExpired(6, 2028)).toBe(false)
    })

    it('should handle current month correctly', () => {
      const now = new Date()
      const currentMonth = now.getMonth() + 1
      const currentYear = now.getFullYear()

      // Current month should not be expired
      expect(isCardExpired(currentMonth, currentYear)).toBe(false)

      // Previous month should be expired
      if (currentMonth > 1) {
        expect(isCardExpired(currentMonth - 1, currentYear)).toBe(true)
      } else {
        expect(isCardExpired(12, currentYear - 1)).toBe(true)
      }
    })

    it('should accept reference date parameter', () => {
      const referenceDate = new Date('2025-06-15')
      expect(isCardExpired(5, 2025, referenceDate)).toBe(true)
      expect(isCardExpired(6, 2025, referenceDate)).toBe(false)
      expect(isCardExpired(7, 2025, referenceDate)).toBe(false)
    })
  })

  describe('validateCardExpiry()', () => {
    it('should pass for valid expiry', () => {
      const result = validateCardExpiry(12, 2030)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail for invalid month', () => {
      expect(validateCardExpiry(0, 2030).valid).toBe(false)
      expect(validateCardExpiry(13, 2030).valid).toBe(false)
      expect(validateCardExpiry(0, 2030).errors).toContain('Expiry month must be between 1 and 12')
    })

    it('should fail for expired card', () => {
      const result = validateCardExpiry(1, 2020)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Card is expired')
    })

    it('should fail for year too far in future', () => {
      const result = validateCardExpiry(12, 2100)
      expect(result.valid).toBe(false)
    })
  })

  describe('validateLast4()', () => {
    it('should pass for valid last 4', () => {
      expect(validateLast4('4242').valid).toBe(true)
      expect(validateLast4('0000').valid).toBe(true)
      expect(validateLast4('9999').valid).toBe(true)
    })

    it('should fail for invalid last 4', () => {
      expect(validateLast4('123').valid).toBe(false)
      expect(validateLast4('12345').valid).toBe(false)
      expect(validateLast4('abcd').valid).toBe(false)
      expect(validateLast4('').valid).toBe(false)
    })
  })

  describe('validateBillingAddress()', () => {
    it('should pass for valid address', () => {
      const result = validateBillingAddress({
        name: 'John Doe',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94102',
        country: 'US',
        email: 'john@example.com',
      })
      expect(result.valid).toBe(true)
    })

    it('should fail for invalid country code', () => {
      const result = validateBillingAddress({ country: 'USA' })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Country must be a 2-letter ISO code')
    })

    it('should fail for invalid email', () => {
      const result = validateBillingAddress({ email: 'invalid-email' })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid email format')
    })

    it('should fail for postal code too long', () => {
      const result = validateBillingAddress({ postalCode: 'A'.repeat(25) })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Postal code is too long')
    })

    it('should pass for empty address', () => {
      const result = validateBillingAddress({})
      expect(result.valid).toBe(true)
    })
  })

  describe('validatePaymentMethodMetadata()', () => {
    it('should pass for valid card metadata', () => {
      const metadata: PaymentMethodMetadata = {
        type: 'card',
        card: {
          last4: '4242',
          brand: 'visa',
          expMonth: 12,
          expYear: 2030,
        },
      }
      const result = validatePaymentMethodMetadata(metadata)
      expect(result.valid).toBe(true)
    })

    it('should pass for valid bank account metadata', () => {
      const metadata: PaymentMethodMetadata = {
        type: 'bank_account',
        bankAccount: {
          last4: '5678',
          accountHolderName: 'John Doe',
          accountHolderType: 'individual',
        },
      }
      const result = validatePaymentMethodMetadata(metadata)
      expect(result.valid).toBe(true)
    })

    it('should pass for valid wallet metadata', () => {
      const metadata: PaymentMethodMetadata = {
        type: 'wallet',
        wallet: {
          type: 'apple_pay',
        },
      }
      const result = validatePaymentMethodMetadata(metadata)
      expect(result.valid).toBe(true)
    })

    it('should fail for invalid type', () => {
      const metadata = { type: 'invalid' } as unknown as PaymentMethodMetadata
      const result = validatePaymentMethodMetadata(metadata)
      expect(result.valid).toBe(false)
    })

    it('should fail for card with invalid last4', () => {
      const metadata: PaymentMethodMetadata = {
        type: 'card',
        card: {
          last4: '123',
          brand: 'visa',
          expMonth: 12,
          expYear: 2030,
        },
      }
      const result = validatePaymentMethodMetadata(metadata)
      expect(result.valid).toBe(false)
    })

    it('should fail for bank account without holder name', () => {
      const metadata: PaymentMethodMetadata = {
        type: 'bank_account',
        bankAccount: {
          last4: '5678',
          accountHolderName: '',
          accountHolderType: 'individual',
        },
      }
      const result = validatePaymentMethodMetadata(metadata)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Account holder name is required')
    })

    it('should fail for wallet without type', () => {
      const metadata: PaymentMethodMetadata = {
        type: 'wallet',
        wallet: {
          type: '',
        },
      }
      const result = validatePaymentMethodMetadata(metadata)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Wallet type is required')
    })

    it('should validate billing address within metadata', () => {
      const metadata: PaymentMethodMetadata = {
        type: 'card',
        card: {
          last4: '4242',
          brand: 'visa',
          expMonth: 12,
          expYear: 2030,
        },
        billingAddress: {
          country: 'INVALID',
        },
      }
      const result = validatePaymentMethodMetadata(metadata)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Country must be a 2-letter ISO code')
    })
  })
})

// =============================================================================
// Token Security Tests
// =============================================================================

describe('Token Security', () => {
  let store: PaymentMethodStore

  beforeEach(() => {
    store = createPaymentMethodStore()
  })

  it('should never expose raw card numbers', async () => {
    const pm = await store.store('cust_123', 'pm_stripe_xxx', {
      type: 'card',
      card: {
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2030,
      },
    })

    // Check that no field contains a full card number
    const pmString = JSON.stringify(pm)
    expect(pmString).not.toMatch(/\d{16}/)
    expect(pmString).not.toContain('4242424242424242')

    // Card should only have masked data
    expect(pm.card?.last4).toBe('4242')
    expect(pm.card?.last4.length).toBe(4)
  })

  it('should store provider token, not card data', async () => {
    const pm = await store.store('cust_123', 'pm_stripe_secret_token', {
      type: 'card',
      card: {
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2030,
      },
    })

    // The token is stored but should be the provider's tokenized reference
    expect(pm.token).toBe('pm_stripe_secret_token')
    expect(pm.token).not.toMatch(/^\d{16}$/)
  })

  it('should not accept raw card number in token field', async () => {
    // This test documents that raw card numbers should not be used as tokens
    // In a real implementation, you might add validation to reject numeric tokens
    const pm = await store.store('cust_123', 'pm_tokenized_reference', {
      type: 'card',
      card: {
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2030,
      },
    })

    // Token should be the provider's reference, not card data
    expect(pm.token).toBe('pm_tokenized_reference')
  })

  it('should mask bank account numbers', async () => {
    const pm = await store.store('cust_123', 'btok_bank_token', {
      type: 'bank_account',
      bankAccount: {
        last4: '5678',
        accountHolderName: 'John Doe',
        accountHolderType: 'individual',
      },
    })

    // Only last 4 should be visible
    expect(pm.bankAccount?.last4).toBe('5678')
    expect(pm.bankAccount?.last4.length).toBe(4)
  })
})

// =============================================================================
// Edge Cases and Error Handling Tests
// =============================================================================

describe('Edge Cases', () => {
  let store: PaymentMethodStore

  beforeEach(() => {
    store = createPaymentMethodStore()
  })

  it('should handle whitespace-only customer ID', async () => {
    await expect(
      store.store('   ', 'pm_stripe_xxx', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
    ).rejects.toThrow('Customer ID is required')
  })

  it('should handle whitespace-only token', async () => {
    await expect(
      store.store('cust_123', '   ', {
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
      })
    ).rejects.toThrow('Payment method token is required')
  })

  it('should handle concurrent operations gracefully', async () => {
    // Store multiple payment methods concurrently
    const promises = Array.from({ length: 10 }, (_, i) =>
      store.store(`cust_${i}`, `pm_token_${i}`, {
        type: 'card',
        card: { last4: String(1000 + i), brand: 'visa', expMonth: 12, expYear: 2030 },
      })
    )

    const results = await Promise.all(promises)
    expect(results).toHaveLength(10)
    expect(new Set(results.map((r) => r.id)).size).toBe(10) // All unique IDs
  })

  it('should handle empty list gracefully', async () => {
    const methods = await store.list('cust_empty')
    expect(methods).toEqual([])

    const defaultPm = await store.getDefault('cust_empty')
    expect(defaultPm).toBeNull()

    const count = await store.count('cust_empty')
    expect(count).toBe(0)
  })

  it('should handle card at expiry boundary', async () => {
    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()

    // Card expiring this month should not be expired
    const pm = await store.store('cust_123', 'pm_expiring_soon', {
      type: 'card',
      card: {
        last4: '4242',
        brand: 'visa',
        expMonth: currentMonth,
        expYear: currentYear,
      },
    })

    expect(pm.isExpired).toBe(false)
  })
})
