/**
 * Payment Method Tokenization Tests - TDD RED Phase
 *
 * Comprehensive tests for PCI-compliant payment method tokenization:
 * - Card tokenization (PAN -> token)
 * - Token storage with encrypted vault
 * - Token retrieval for charging
 * - Token expiration handling
 * - Multi-provider tokens (Stripe, Braintree)
 * - Token validation
 * - PCI compliance patterns (no raw card storage)
 * - Tokenization via iframe/JS SDK pattern
 *
 * These tests define the expected behavior for a secure, provider-agnostic
 * tokenization system that ensures PCI DSS compliance by never storing
 * raw card data (PAN, CVV) on our servers.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createTokenizationService,
  type TokenizationService,
  type Token,
  type TokenMetadata,
  type TokenizationProvider,
  type CardData,
  type BankAccountData,
  type TokenizationConfig,
  type TokenValidationResult,
  type TokenUsage,
  type ClientTokenRequest,
  type ClientToken,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestService(config?: Partial<TokenizationConfig>): TokenizationService {
  return createTokenizationService({
    encryptionKey: 'test-encryption-key-32-bytes-ok!', // 32 bytes for AES-256
    ...config,
  })
}

function createMockProvider(name: string): TokenizationProvider {
  return {
    name,
    tokenize: vi.fn().mockResolvedValue({
      providerToken: `tok_${name}_${Date.now()}`,
      fingerprint: `fp_${Date.now()}`,
      last4: '4242',
      brand: 'visa',
      expMonth: 12,
      expYear: 2030,
    }),
    detokenize: vi.fn().mockResolvedValue({
      last4: '4242',
      brand: 'visa',
      expMonth: 12,
      expYear: 2030,
    }),
    deleteToken: vi.fn().mockResolvedValue(true),
    validateToken: vi.fn().mockResolvedValue({ valid: true }),
    createClientToken: vi.fn().mockResolvedValue({
      clientToken: `client_tok_${Date.now()}`,
      expiresAt: new Date(Date.now() + 3600000),
    }),
  }
}

function createTestCardData(): CardData {
  return {
    number: '4242424242424242',
    expMonth: 12,
    expYear: 2030,
    cvc: '123',
    holderName: 'Test User',
    billingAddress: {
      line1: '123 Test St',
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94107',
      country: 'US',
    },
  }
}

function createTestBankAccountData(): BankAccountData {
  return {
    accountNumber: '000123456789',
    routingNumber: '110000000',
    accountHolderName: 'Test User',
    accountHolderType: 'individual',
    accountType: 'checking',
  }
}

// =============================================================================
// Card Tokenization Tests (PAN -> Token)
// =============================================================================

describe('TokenizationService', () => {
  describe('Card Tokenization (PAN -> Token)', () => {
    let service: TokenizationService
    let mockProvider: TokenizationProvider

    beforeEach(() => {
      service = createTestService()
      mockProvider = createMockProvider('stripe')
      service.registerProvider('stripe', mockProvider)
    })

    it('should tokenize a card and return a token', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      expect(token.id).toBeDefined()
      expect(token.id).toMatch(/^tok_/)
      expect(token.type).toBe('card')
      expect(token.customerId).toBe('cust_123')
      expect(token.metadata.last4).toBe('4242')
      expect(token.metadata.brand).toBe('visa')
      expect(token.metadata.expMonth).toBe(12)
      expect(token.metadata.expYear).toBe(2030)
      expect(mockProvider.tokenize).toHaveBeenCalled()
    })

    it('should never store raw PAN in the token', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Token should not contain raw card number
      expect(JSON.stringify(token)).not.toContain('4242424242424242')
      // Should only have last4
      expect(token.metadata.last4).toBe('4242')
    })

    it('should never store CVV/CVC in the token or storage', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // CVV should never be stored
      expect(JSON.stringify(token)).not.toContain('123')
      expect(token.metadata).not.toHaveProperty('cvc')
      expect(token.metadata).not.toHaveProperty('cvv')
    })

    it('should store fingerprint for duplicate detection', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      expect(token.fingerprint).toBeDefined()
      expect(token.fingerprint).toMatch(/^fp_/)
    })

    it('should detect duplicate cards using fingerprint', async () => {
      const cardData = createTestCardData()

      const token1 = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      const token2 = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Same card should produce same fingerprint
      expect(token1.fingerprint).toBe(token2.fingerprint)
      // But different token IDs
      expect(token1.id).not.toBe(token2.id)
    })

    it('should validate card number with Luhn algorithm before tokenization', async () => {
      const invalidCard: CardData = {
        ...createTestCardData(),
        number: '4242424242424241', // Invalid Luhn checksum
      }

      await expect(
        service.tokenize({
          type: 'card',
          data: invalidCard,
          customerId: 'cust_123',
        })
      ).rejects.toThrow(/invalid card number|luhn/i)
    })

    it('should reject expired cards', async () => {
      const expiredCard: CardData = {
        ...createTestCardData(),
        expMonth: 1,
        expYear: 2020,
      }

      await expect(
        service.tokenize({
          type: 'card',
          data: expiredCard,
          customerId: 'cust_123',
        })
      ).rejects.toThrow(/expired/i)
    })

    it('should store billing address metadata', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      expect(token.metadata.billingAddress).toEqual({
        line1: '123 Test St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94107',
        country: 'US',
      })
    })

    it('should support different card brands', async () => {
      const testCases = [
        { number: '4242424242424242', brand: 'visa' },
        { number: '5555555555554444', brand: 'mastercard' },
        { number: '378282246310005', brand: 'amex' },
        { number: '6011111111111117', brand: 'discover' },
      ]

      for (const { number, brand } of testCases) {
        mockProvider.tokenize = vi.fn().mockResolvedValue({
          providerToken: `tok_${Date.now()}`,
          fingerprint: `fp_${Date.now()}`,
          last4: number.slice(-4),
          brand,
          expMonth: 12,
          expYear: 2030,
        })

        const token = await service.tokenize({
          type: 'card',
          data: { ...createTestCardData(), number },
          customerId: 'cust_123',
        })

        expect(token.metadata.brand).toBe(brand)
      }
    })
  })

  // =============================================================================
  // Token Storage with Encrypted Vault
  // =============================================================================

  describe('Token Storage with Encrypted Vault', () => {
    let service: TokenizationService
    let mockProvider: TokenizationProvider

    beforeEach(() => {
      service = createTestService()
      mockProvider = createMockProvider('stripe')
      service.registerProvider('stripe', mockProvider)
    })

    it('should encrypt provider token at rest', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Get raw storage to verify encryption
      const stored = await service.getStoredToken(token.id)

      // Provider token should be encrypted
      expect(stored.encryptedProviderToken).toBeDefined()
      expect(stored.encryptedProviderToken).not.toContain('tok_stripe')
      expect(stored.iv).toBeDefined()
    })

    it('should use unique IV per token', async () => {
      const cardData = createTestCardData()

      const token1 = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      const token2 = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_456',
      })

      const stored1 = await service.getStoredToken(token1.id)
      const stored2 = await service.getStoredToken(token2.id)

      expect(stored1.iv).not.toBe(stored2.iv)
    })

    it('should detect tampering with stored tokens', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Tamper with the stored token
      await service._tamperStoredToken(token.id, 'corrupted-data')

      await expect(service.getProviderToken(token.id)).rejects.toThrow(
        /tampered|integrity|authentication/i
      )
    })

    it('should support key rotation', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Rotate encryption key
      await service.rotateEncryptionKey('new-encryption-key-32-bytes-ok!')

      // Should still be able to retrieve token (re-encrypted with new key)
      const retrieved = await service.getToken(token.id)
      expect(retrieved.id).toBe(token.id)
    })

    it('should store token creation and update timestamps', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      expect(token.createdAt).toBeInstanceOf(Date)
      expect(token.updatedAt).toBeInstanceOf(Date)
    })

    it('should store provider reference securely', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
        provider: 'stripe',
      })

      expect(token.provider).toBe('stripe')
      // Provider-specific token ID should be encrypted
      const stored = await service.getStoredToken(token.id)
      expect(stored.encryptedProviderToken).toBeDefined()
    })
  })

  // =============================================================================
  // Token Retrieval for Charging
  // =============================================================================

  describe('Token Retrieval for Charging', () => {
    let service: TokenizationService
    let mockProvider: TokenizationProvider

    beforeEach(() => {
      service = createTestService()
      mockProvider = createMockProvider('stripe')
      service.registerProvider('stripe', mockProvider)
    })

    it('should retrieve token by ID', async () => {
      const cardData = createTestCardData()

      const created = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      const retrieved = await service.getToken(created.id)

      expect(retrieved.id).toBe(created.id)
      expect(retrieved.type).toBe('card')
      expect(retrieved.customerId).toBe('cust_123')
      expect(retrieved.metadata.last4).toBe('4242')
    })

    it('should retrieve provider token for charging', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      const providerToken = await service.getProviderToken(token.id)

      expect(providerToken).toMatch(/^tok_stripe_/)
    })

    it('should list all tokens for a customer', async () => {
      const cardData = createTestCardData()

      await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      await service.tokenize({
        type: 'card',
        data: { ...cardData, number: '5555555555554444' },
        customerId: 'cust_123',
      })

      await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_456', // Different customer
      })

      const tokens = await service.listTokens('cust_123')

      expect(tokens).toHaveLength(2)
      expect(tokens.every((t) => t.customerId === 'cust_123')).toBe(true)
    })

    it('should mark token as default for customer', async () => {
      const cardData = createTestCardData()

      const token1 = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      const token2 = await service.tokenize({
        type: 'card',
        data: { ...cardData, number: '5555555555554444' },
        customerId: 'cust_123',
      })

      await service.setDefaultToken('cust_123', token2.id)

      const defaultToken = await service.getDefaultToken('cust_123')
      expect(defaultToken?.id).toBe(token2.id)

      // Previous default should no longer be default
      const token1Updated = await service.getToken(token1.id)
      expect(token1Updated.isDefault).toBe(false)
    })

    it('should throw when token not found', async () => {
      await expect(service.getToken('tok_nonexistent')).rejects.toThrow(/not found/i)
    })

    it('should record token usage for audit', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Simulate using the token for a charge
      await service.recordTokenUsage(token.id, {
        action: 'charge',
        amount: 9999,
        currency: 'USD',
        chargeId: 'ch_123',
      })

      const usage = await service.getTokenUsage(token.id)
      expect(usage).toHaveLength(1)
      expect(usage[0].action).toBe('charge')
      expect(usage[0].amount).toBe(9999)
    })
  })

  // =============================================================================
  // Token Expiration Handling
  // =============================================================================

  describe('Token Expiration Handling', () => {
    let service: TokenizationService
    let mockProvider: TokenizationProvider

    beforeEach(() => {
      vi.useFakeTimers()
      service = createTestService()
      mockProvider = createMockProvider('stripe')
      service.registerProvider('stripe', mockProvider)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should set token expiration based on card expiry', async () => {
      const cardData: CardData = {
        ...createTestCardData(),
        expMonth: 6,
        expYear: 2025,
      }

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Token should expire at end of card's expiry month
      expect(token.expiresAt).toBeInstanceOf(Date)
      expect(token.expiresAt?.getMonth()).toBe(5) // June (0-indexed)
      expect(token.expiresAt?.getFullYear()).toBe(2025)
    })

    it('should flag expired tokens as unusable', async () => {
      vi.setSystemTime(new Date('2024-01-01'))

      const cardData: CardData = {
        ...createTestCardData(),
        expMonth: 6,
        expYear: 2024,
      }

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Advance time past expiration
      vi.setSystemTime(new Date('2024-07-15'))

      const retrieved = await service.getToken(token.id)
      expect(retrieved.isExpired).toBe(true)
      expect(retrieved.status).toBe('expired')
    })

    it('should reject charging with expired token', async () => {
      vi.setSystemTime(new Date('2024-01-01'))

      const cardData: CardData = {
        ...createTestCardData(),
        expMonth: 6,
        expYear: 2024,
      }

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Advance time past expiration
      vi.setSystemTime(new Date('2024-07-15'))

      await expect(service.getProviderToken(token.id)).rejects.toThrow(/expired/i)
    })

    it('should support configurable token TTL (independent of card expiry)', async () => {
      vi.setSystemTime(new Date('2024-01-01'))

      const serviceWithTTL = createTestService({
        tokenTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
      })
      serviceWithTTL.registerProvider('stripe', mockProvider)

      const cardData = createTestCardData()

      const token = await serviceWithTTL.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Token should expire in 30 days, regardless of card expiry
      expect(token.expiresAt).toEqual(new Date('2024-01-31'))
    })

    it('should notify before token expiration', async () => {
      vi.setSystemTime(new Date('2024-01-01'))

      const onExpiringSoon = vi.fn()
      const serviceWithNotify = createTestService({
        onTokenExpiringSoon: onExpiringSoon,
        expirationWarningDays: 30,
      })
      serviceWithNotify.registerProvider('stripe', mockProvider)

      const cardData: CardData = {
        ...createTestCardData(),
        expMonth: 2,
        expYear: 2024,
      }

      await serviceWithNotify.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Check expiring tokens (simulates cron job)
      await serviceWithNotify.checkExpiringTokens()

      expect(onExpiringSoon).toHaveBeenCalled()
    })

    it('should support token renewal/update', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Update with new expiry
      const updated = await service.updateTokenExpiry(token.id, {
        expMonth: 12,
        expYear: 2035,
      })

      expect(updated.metadata.expMonth).toBe(12)
      expect(updated.metadata.expYear).toBe(2035)
    })

    it('should clean up expired tokens (retention policy)', async () => {
      vi.setSystemTime(new Date('2024-01-01'))

      const serviceWithRetention = createTestService({
        expiredTokenRetentionDays: 90,
      })
      serviceWithRetention.registerProvider('stripe', mockProvider)

      const cardData: CardData = {
        ...createTestCardData(),
        expMonth: 1,
        expYear: 2024,
      }

      const token = await serviceWithRetention.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Advance past expiration + retention period
      vi.setSystemTime(new Date('2024-05-01'))

      await serviceWithRetention.cleanupExpiredTokens()

      await expect(serviceWithRetention.getToken(token.id)).rejects.toThrow(/not found/i)
    })
  })

  // =============================================================================
  // Multi-Provider Tokens (Stripe, Braintree)
  // =============================================================================

  describe('Multi-Provider Tokens', () => {
    let service: TokenizationService
    let stripeProvider: TokenizationProvider
    let braintreeProvider: TokenizationProvider

    beforeEach(() => {
      service = createTestService()
      stripeProvider = createMockProvider('stripe')
      braintreeProvider = createMockProvider('braintree')
      service.registerProvider('stripe', stripeProvider)
      service.registerProvider('braintree', braintreeProvider)
    })

    it('should tokenize with specific provider', async () => {
      const cardData = createTestCardData()

      const stripeToken = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
        provider: 'stripe',
      })

      const braintreeToken = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
        provider: 'braintree',
      })

      expect(stripeToken.provider).toBe('stripe')
      expect(braintreeToken.provider).toBe('braintree')
      expect(stripeProvider.tokenize).toHaveBeenCalled()
      expect(braintreeProvider.tokenize).toHaveBeenCalled()
    })

    it('should use default provider when not specified', async () => {
      service.setDefaultProvider('braintree')

      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      expect(token.provider).toBe('braintree')
      expect(braintreeProvider.tokenize).toHaveBeenCalled()
    })

    it('should migrate tokens between providers', async () => {
      const cardData = createTestCardData()

      // Create token with Stripe
      const stripeToken = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
        provider: 'stripe',
      })

      // Migrate to Braintree (requires re-tokenizing with same card via vault)
      const migratedToken = await service.migrateToken(stripeToken.id, 'braintree')

      expect(migratedToken.provider).toBe('braintree')
      expect(migratedToken.customerId).toBe('cust_123')
      expect(migratedToken.metadata.last4).toBe('4242')
    })

    it('should maintain provider-specific metadata', async () => {
      stripeProvider.tokenize = vi.fn().mockResolvedValue({
        providerToken: 'tok_stripe_xxx',
        fingerprint: 'fp_stripe_xxx',
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2030,
        providerMetadata: {
          stripeCustomerId: 'cus_stripe_123',
          funding: 'credit',
        },
      })

      braintreeProvider.tokenize = vi.fn().mockResolvedValue({
        providerToken: 'tok_braintree_xxx',
        fingerprint: 'fp_braintree_xxx',
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2030,
        providerMetadata: {
          braintreeCustomerId: 'cus_braintree_123',
          cardType: 'credit',
        },
      })

      const cardData = createTestCardData()

      const stripeToken = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
        provider: 'stripe',
      })

      const braintreeToken = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
        provider: 'braintree',
      })

      expect(stripeToken.providerMetadata?.stripeCustomerId).toBe('cus_stripe_123')
      expect(braintreeToken.providerMetadata?.braintreeCustomerId).toBe('cus_braintree_123')
    })

    it('should list providers', () => {
      const providers = service.listProviders()

      expect(providers).toContain('stripe')
      expect(providers).toContain('braintree')
    })

    it('should throw when provider not found', async () => {
      const cardData = createTestCardData()

      await expect(
        service.tokenize({
          type: 'card',
          data: cardData,
          customerId: 'cust_123',
          provider: 'nonexistent',
        })
      ).rejects.toThrow(/provider not found/i)
    })

    it('should handle provider-specific errors gracefully', async () => {
      stripeProvider.tokenize = vi.fn().mockRejectedValue(new Error('Stripe API error: Card declined'))

      const cardData = createTestCardData()

      await expect(
        service.tokenize({
          type: 'card',
          data: cardData,
          customerId: 'cust_123',
          provider: 'stripe',
        })
      ).rejects.toThrow(/card declined/i)
    })
  })

  // =============================================================================
  // Token Validation
  // =============================================================================

  describe('Token Validation', () => {
    let service: TokenizationService
    let mockProvider: TokenizationProvider

    beforeEach(() => {
      service = createTestService()
      mockProvider = createMockProvider('stripe')
      service.registerProvider('stripe', mockProvider)
    })

    it('should validate token exists and is active', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      const validation = await service.validateToken(token.id)

      expect(validation.valid).toBe(true)
      expect(validation.exists).toBe(true)
      expect(validation.isActive).toBe(true)
      expect(validation.isExpired).toBe(false)
    })

    it('should validate token with provider', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      const validation = await service.validateToken(token.id, { checkProvider: true })

      expect(validation.valid).toBe(true)
      expect(validation.providerValid).toBe(true)
      expect(mockProvider.validateToken).toHaveBeenCalled()
    })

    it('should return invalid for non-existent token', async () => {
      const validation = await service.validateToken('tok_nonexistent')

      expect(validation.valid).toBe(false)
      expect(validation.exists).toBe(false)
      expect(validation.error).toMatch(/not found/i)
    })

    it('should return invalid for expired token', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01'))

      const cardData: CardData = {
        ...createTestCardData(),
        expMonth: 6,
        expYear: 2024,
      }

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      vi.setSystemTime(new Date('2024-07-15'))

      const validation = await service.validateToken(token.id)

      expect(validation.valid).toBe(false)
      expect(validation.isExpired).toBe(true)
      expect(validation.error).toMatch(/expired/i)

      vi.useRealTimers()
    })

    it('should return invalid when provider validation fails', async () => {
      mockProvider.validateToken = vi.fn().mockResolvedValue({
        valid: false,
        error: 'Card has been reported lost',
      })

      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      const validation = await service.validateToken(token.id, { checkProvider: true })

      expect(validation.valid).toBe(false)
      expect(validation.providerValid).toBe(false)
      expect(validation.error).toMatch(/lost/i)
    })

    it('should validate token belongs to customer', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      const validForCustomer = await service.validateToken(token.id, { customerId: 'cust_123' })
      const invalidForCustomer = await service.validateToken(token.id, { customerId: 'cust_456' })

      expect(validForCustomer.valid).toBe(true)
      expect(invalidForCustomer.valid).toBe(false)
      expect(invalidForCustomer.error).toMatch(/customer mismatch/i)
    })

    it('should validate token format', () => {
      expect(service.isValidTokenFormat('tok_abc123')).toBe(true)
      expect(service.isValidTokenFormat('invalid')).toBe(false)
      expect(service.isValidTokenFormat('')).toBe(false)
      expect(service.isValidTokenFormat(null as unknown as string)).toBe(false)
    })
  })

  // =============================================================================
  // PCI Compliance Patterns (No Raw Card Storage)
  // =============================================================================

  describe('PCI Compliance Patterns', () => {
    let service: TokenizationService
    let mockProvider: TokenizationProvider

    beforeEach(() => {
      service = createTestService()
      mockProvider = createMockProvider('stripe')
      service.registerProvider('stripe', mockProvider)
    })

    it('should never log raw card numbers', async () => {
      const consoleSpy = vi.spyOn(console, 'log')
      const consoleWarnSpy = vi.spyOn(console, 'warn')
      const consoleErrorSpy = vi.spyOn(console, 'error')

      const cardData = createTestCardData()

      await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Check no console output contains the full card number
      const allLogs = [
        ...consoleSpy.mock.calls.flat(),
        ...consoleWarnSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ]

      for (const log of allLogs) {
        expect(String(log)).not.toContain('4242424242424242')
      }

      consoleSpy.mockRestore()
      consoleWarnSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })

    it('should mask card numbers in error messages', async () => {
      mockProvider.tokenize = vi.fn().mockRejectedValue(
        new Error('API error for card 4242424242424242')
      )

      const cardData = createTestCardData()

      try {
        await service.tokenize({
          type: 'card',
          data: cardData,
          customerId: 'cust_123',
        })
      } catch (error) {
        // Error message should not contain full card number
        expect((error as Error).message).not.toContain('4242424242424242')
        // Should contain masked version
        expect((error as Error).message).toMatch(/\*{4,}4242|\*{12}4242/)
      }
    })

    it('should sanitize card data before storage', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Get raw storage
      const stored = await service.getStoredToken(token.id)

      // Raw storage should not contain sensitive data
      expect(JSON.stringify(stored)).not.toContain('4242424242424242')
      expect(JSON.stringify(stored)).not.toContain('123') // CVV
      expect(JSON.stringify(stored)).not.toContain('"number"')
      expect(JSON.stringify(stored)).not.toContain('"cvc"')
      expect(JSON.stringify(stored)).not.toContain('"cvv"')
    })

    it('should provide audit trail for token access', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      // Access the token
      await service.getToken(token.id)
      await service.getProviderToken(token.id)

      const auditLog = await service.getAuditLog(token.id)

      expect(auditLog).toHaveLength(3) // create, get, getProviderToken
      expect(auditLog[0].action).toBe('create')
      expect(auditLog[1].action).toBe('read')
      expect(auditLog[2].action).toBe('read_provider_token')
    })

    it('should support token deletion (right to erasure)', async () => {
      const cardData = createTestCardData()

      const token = await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      await service.deleteToken(token.id)

      await expect(service.getToken(token.id)).rejects.toThrow(/not found/i)
      expect(mockProvider.deleteToken).toHaveBeenCalled()
    })

    it('should support customer data export (GDPR)', async () => {
      const cardData = createTestCardData()

      await service.tokenize({
        type: 'card',
        data: cardData,
        customerId: 'cust_123',
      })

      await service.tokenize({
        type: 'card',
        data: { ...cardData, number: '5555555555554444' },
        customerId: 'cust_123',
      })

      const exportData = await service.exportCustomerData('cust_123')

      expect(exportData.tokens).toHaveLength(2)
      // Export should not contain sensitive data
      expect(JSON.stringify(exportData)).not.toContain('4242424242424242')
      expect(JSON.stringify(exportData)).not.toContain('5555555555554444')
      // But should contain masked data
      expect(exportData.tokens[0].metadata.last4).toBeDefined()
    })

    it('should enforce minimum TLS version for provider communication', () => {
      const config = service.getSecurityConfig()

      expect(config.minTLSVersion).toBe('TLSv1.2')
    })

    it('should use secure random for token generation', async () => {
      const cardData = createTestCardData()

      const tokens: string[] = []
      for (let i = 0; i < 100; i++) {
        const token = await service.tokenize({
          type: 'card',
          data: cardData,
          customerId: `cust_${i}`,
        })
        tokens.push(token.id)
      }

      // All tokens should be unique
      const uniqueTokens = new Set(tokens)
      expect(uniqueTokens.size).toBe(100)

      // Tokens should have sufficient entropy
      for (const id of tokens) {
        expect(id.length).toBeGreaterThanOrEqual(20)
      }
    })
  })

  // =============================================================================
  // Tokenization via Iframe/JS SDK Pattern
  // =============================================================================

  describe('Tokenization via Iframe/JS SDK Pattern', () => {
    let service: TokenizationService
    let mockProvider: TokenizationProvider

    beforeEach(() => {
      service = createTestService()
      mockProvider = createMockProvider('stripe')
      service.registerProvider('stripe', mockProvider)
    })

    it('should generate client token for JS SDK initialization', async () => {
      const clientToken = await service.createClientToken({
        customerId: 'cust_123',
        provider: 'stripe',
      })

      expect(clientToken.token).toBeDefined()
      expect(clientToken.expiresAt).toBeInstanceOf(Date)
      expect(clientToken.provider).toBe('stripe')
      expect(mockProvider.createClientToken).toHaveBeenCalled()
    })

    it('should set client token expiration', async () => {
      const clientToken = await service.createClientToken({
        customerId: 'cust_123',
        provider: 'stripe',
        ttl: 3600, // 1 hour
      })

      const expiresIn = clientToken.expiresAt.getTime() - Date.now()
      expect(expiresIn).toBeGreaterThan(3500 * 1000)
      expect(expiresIn).toBeLessThanOrEqual(3600 * 1000)
    })

    it('should exchange nonce from JS SDK for permanent token', async () => {
      // Simulates the flow:
      // 1. Client gets nonce from JS SDK (handled client-side)
      // 2. Client sends nonce to server
      // 3. Server exchanges nonce for permanent token

      const nonce = 'nonce_from_js_sdk_xxx'

      mockProvider.exchangeNonce = vi.fn().mockResolvedValue({
        providerToken: 'tok_permanent_xxx',
        fingerprint: 'fp_xxx',
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2030,
      })

      const token = await service.exchangeNonce({
        nonce,
        customerId: 'cust_123',
        provider: 'stripe',
      })

      expect(token.id).toBeDefined()
      expect(token.type).toBe('card')
      expect(token.metadata.last4).toBe('4242')
      expect((mockProvider as any).exchangeNonce).toHaveBeenCalledWith(nonce)
    })

    it('should validate nonce format', async () => {
      await expect(
        service.exchangeNonce({
          nonce: '', // Invalid empty nonce
          customerId: 'cust_123',
          provider: 'stripe',
        })
      ).rejects.toThrow(/invalid nonce/i)
    })

    it('should reject expired nonce', async () => {
      mockProvider.exchangeNonce = vi.fn().mockRejectedValue(new Error('Nonce has expired'))

      await expect(
        service.exchangeNonce({
          nonce: 'expired_nonce_xxx',
          customerId: 'cust_123',
          provider: 'stripe',
        })
      ).rejects.toThrow(/expired/i)
    })

    it('should generate setup intent for saving cards without charging', async () => {
      mockProvider.createSetupIntent = vi.fn().mockResolvedValue({
        clientSecret: 'seti_xxx_secret_xxx',
        id: 'seti_xxx',
      })

      const setupIntent = await service.createSetupIntent({
        customerId: 'cust_123',
        provider: 'stripe',
        usage: 'off_session', // For recurring charges
      })

      expect(setupIntent.clientSecret).toBeDefined()
      expect(setupIntent.id).toBeDefined()
      expect((mockProvider as any).createSetupIntent).toHaveBeenCalled()
    })

    it('should confirm setup intent and create token', async () => {
      mockProvider.confirmSetupIntent = vi.fn().mockResolvedValue({
        providerToken: 'pm_xxx',
        fingerprint: 'fp_xxx',
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2030,
      })

      const token = await service.confirmSetupIntent({
        setupIntentId: 'seti_xxx',
        customerId: 'cust_123',
        provider: 'stripe',
      })

      expect(token.id).toBeDefined()
      expect(token.type).toBe('card')
      expect((mockProvider as any).confirmSetupIntent).toHaveBeenCalled()
    })

    it('should generate iframe URL for hosted tokenization', async () => {
      const iframeConfig = await service.getIframeConfig({
        customerId: 'cust_123',
        provider: 'stripe',
        returnUrl: 'https://example.com/complete',
      })

      expect(iframeConfig.url).toBeDefined()
      expect(iframeConfig.url).toContain('https://')
      expect(iframeConfig.sessionId).toBeDefined()
    })

    it('should support 3D Secure authentication flow', async () => {
      mockProvider.create3DSChallenge = vi.fn().mockResolvedValue({
        redirectUrl: 'https://bank.com/3ds-challenge',
        transactionId: '3ds_xxx',
      })

      const challenge = await service.create3DSChallenge({
        tokenId: 'tok_xxx',
        amount: 9999,
        currency: 'USD',
        returnUrl: 'https://example.com/3ds-complete',
      })

      expect(challenge.redirectUrl).toContain('https://bank.com')
      expect(challenge.transactionId).toBeDefined()
    })

    it('should handle 3DS authentication result', async () => {
      mockProvider.handle3DSResult = vi.fn().mockResolvedValue({
        authenticated: true,
        authenticationValue: 'xxx',
        eci: '05',
      })

      const result = await service.handle3DSResult({
        transactionId: '3ds_xxx',
        provider: 'stripe',
      })

      expect(result.authenticated).toBe(true)
      expect(result.eci).toBeDefined()
    })
  })

  // =============================================================================
  // Bank Account Tokenization (ACH)
  // =============================================================================

  describe('Bank Account Tokenization (ACH)', () => {
    let service: TokenizationService
    let mockProvider: TokenizationProvider

    beforeEach(() => {
      service = createTestService()
      mockProvider = createMockProvider('stripe')
      service.registerProvider('stripe', mockProvider)
    })

    it('should tokenize bank account', async () => {
      const bankData = createTestBankAccountData()

      mockProvider.tokenize = vi.fn().mockResolvedValue({
        providerToken: 'ba_xxx',
        fingerprint: 'fp_bank_xxx',
        last4: '6789',
        bankName: 'Test Bank',
        accountHolderType: 'individual',
      })

      const token = await service.tokenize({
        type: 'bank_account',
        data: bankData,
        customerId: 'cust_123',
      })

      expect(token.type).toBe('bank_account')
      expect(token.metadata.last4).toBe('6789')
      expect(token.metadata.bankName).toBe('Test Bank')
    })

    it('should never store raw account number', async () => {
      const bankData = createTestBankAccountData()

      mockProvider.tokenize = vi.fn().mockResolvedValue({
        providerToken: 'ba_xxx',
        fingerprint: 'fp_bank_xxx',
        last4: '6789',
        bankName: 'Test Bank',
      })

      const token = await service.tokenize({
        type: 'bank_account',
        data: bankData,
        customerId: 'cust_123',
      })

      expect(JSON.stringify(token)).not.toContain('000123456789')
    })

    it('should validate routing number', async () => {
      const invalidBankData: BankAccountData = {
        ...createTestBankAccountData(),
        routingNumber: '123', // Invalid - should be 9 digits
      }

      await expect(
        service.tokenize({
          type: 'bank_account',
          data: invalidBankData,
          customerId: 'cust_123',
        })
      ).rejects.toThrow(/routing number/i)
    })

    it('should support micro-deposit verification', async () => {
      const bankData = createTestBankAccountData()

      mockProvider.tokenize = vi.fn().mockResolvedValue({
        providerToken: 'ba_xxx',
        fingerprint: 'fp_bank_xxx',
        last4: '6789',
        bankName: 'Test Bank',
        status: 'pending_verification',
      })

      const token = await service.tokenize({
        type: 'bank_account',
        data: bankData,
        customerId: 'cust_123',
      })

      expect(token.status).toBe('pending_verification')

      // Verify with micro-deposits
      mockProvider.verifyMicroDeposits = vi.fn().mockResolvedValue({
        verified: true,
      })

      const verified = await service.verifyBankAccount(token.id, {
        amounts: [32, 45], // Micro-deposit amounts in cents
      })

      expect(verified.status).toBe('verified')
    })

    it('should support instant verification via Plaid', async () => {
      mockProvider.verifyWithPlaid = vi.fn().mockResolvedValue({
        providerToken: 'ba_xxx',
        fingerprint: 'fp_bank_xxx',
        last4: '6789',
        bankName: 'Test Bank',
        status: 'verified',
      })

      const token = await service.tokenizeWithPlaid({
        plaidPublicToken: 'public-sandbox-xxx',
        plaidAccountId: 'account_xxx',
        customerId: 'cust_123',
      })

      expect(token.status).toBe('verified')
      expect(token.type).toBe('bank_account')
    })
  })

  // =============================================================================
  // Digital Wallet Tokenization
  // =============================================================================

  describe('Digital Wallet Tokenization', () => {
    let service: TokenizationService
    let mockProvider: TokenizationProvider

    beforeEach(() => {
      service = createTestService()
      mockProvider = createMockProvider('stripe')
      service.registerProvider('stripe', mockProvider)
    })

    it('should tokenize Apple Pay payment', async () => {
      mockProvider.tokenize = vi.fn().mockResolvedValue({
        providerToken: 'tok_apple_pay_xxx',
        fingerprint: 'fp_wallet_xxx',
        last4: '4242',
        brand: 'visa',
        walletType: 'apple_pay',
      })

      const token = await service.tokenize({
        type: 'wallet',
        data: {
          walletType: 'apple_pay',
          paymentData: 'encrypted_apple_pay_data_xxx',
        },
        customerId: 'cust_123',
      })

      expect(token.type).toBe('wallet')
      expect(token.metadata.walletType).toBe('apple_pay')
    })

    it('should tokenize Google Pay payment', async () => {
      mockProvider.tokenize = vi.fn().mockResolvedValue({
        providerToken: 'tok_google_pay_xxx',
        fingerprint: 'fp_wallet_xxx',
        last4: '4242',
        brand: 'visa',
        walletType: 'google_pay',
      })

      const token = await service.tokenize({
        type: 'wallet',
        data: {
          walletType: 'google_pay',
          paymentData: 'encrypted_google_pay_data_xxx',
        },
        customerId: 'cust_123',
      })

      expect(token.type).toBe('wallet')
      expect(token.metadata.walletType).toBe('google_pay')
    })

    it('should store wallet-specific metadata', async () => {
      mockProvider.tokenize = vi.fn().mockResolvedValue({
        providerToken: 'tok_apple_pay_xxx',
        fingerprint: 'fp_wallet_xxx',
        last4: '4242',
        brand: 'visa',
        walletType: 'apple_pay',
        deviceAccountNumber: 'xxx', // Apple Pay specific
        dpan: 'device_pan_xxx', // Device PAN
      })

      const token = await service.tokenize({
        type: 'wallet',
        data: {
          walletType: 'apple_pay',
          paymentData: 'encrypted_apple_pay_data_xxx',
        },
        customerId: 'cust_123',
      })

      expect(token.metadata.walletType).toBe('apple_pay')
      // Device-specific data should be present but masked
      expect(token.metadata.hasDevicePAN).toBe(true)
    })
  })
})
