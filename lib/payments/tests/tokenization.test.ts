import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Payment Method Tokenization Tests (TDD RED Phase)
 *
 * These tests define the contract for PCI-DSS compliant payment method tokenization.
 * They are expected to FAIL until lib/payments/tokenization.ts is implemented.
 *
 * Implementation requirements:
 * - Create lib/payments/tokenization.ts with tokenization functions
 * - PCI-compliant tokenization (no raw card data storage)
 * - Support for credit cards and bank accounts (ACH)
 * - Token storage, retrieval, expiration, and refresh
 * - Customer-token association with multi-token support
 * - Default payment method selection
 * - Token metadata (last4, brand, exp_month/year)
 *
 * @see dotdo-hiaxt - [RED] Payment method tokenization tests
 */

// Import the module under test (will fail until implemented)
import {
  tokenizeCard,
  tokenizeBankAccount,
  storeToken,
  retrieveToken,
  refreshToken,
  getCustomerTokens,
  setDefaultPaymentMethod,
  getDefaultPaymentMethod,
  deleteToken,
  isTokenExpired,
  createTokenizer,
  type TokenizedCard,
  type TokenizedBankAccount,
  type StoredToken,
  type TokenizerConfig,
  type TokenMetadata,
} from '../tokenization'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Test credit card data (PCI-compliant: only masked data after tokenization)
 */
const TEST_CARD = {
  number: '4242424242424242', // Visa test card
  expMonth: 12,
  expYear: 2027,
  cvc: '123',
  holderName: 'Test User',
}

const TEST_AMEX_CARD = {
  number: '378282246310005', // Amex test card
  expMonth: 6,
  expYear: 2028,
  cvc: '1234',
  holderName: 'Amex Holder',
}

const TEST_MASTERCARD = {
  number: '5555555555554444', // Mastercard test card
  expMonth: 3,
  expYear: 2026,
  cvc: '456',
  holderName: 'MC Holder',
}

/**
 * Test bank account data (ACH)
 */
const TEST_BANK_ACCOUNT = {
  accountNumber: '000123456789',
  routingNumber: '110000000',
  accountType: 'checking' as const,
  accountHolderName: 'Test User',
  accountHolderType: 'individual' as const,
}

const TEST_BUSINESS_BANK_ACCOUNT = {
  accountNumber: '000987654321',
  routingNumber: '021000021',
  accountType: 'checking' as const,
  accountHolderName: 'Acme Corp',
  accountHolderType: 'company' as const,
}

// ============================================================================
// 1. Tokenize Credit Card (PCI-DSS Compliant)
// ============================================================================

describe('tokenizeCard', () => {
  describe('PCI-DSS compliant tokenization', () => {
    it('should tokenize a valid Visa card', async () => {
      const result = await tokenizeCard(TEST_CARD)

      expect(result.token).toBeDefined()
      expect(result.token).toMatch(/^tok_/)
    })

    it('should return masked card details (last4)', async () => {
      const result = await tokenizeCard(TEST_CARD)

      expect(result.last4).toBe('4242')
      expect(result.number).toBeUndefined() // Raw number must NOT be present
    })

    it('should detect and return card brand', async () => {
      const visa = await tokenizeCard(TEST_CARD)
      expect(visa.brand).toBe('visa')

      const amex = await tokenizeCard(TEST_AMEX_CARD)
      expect(amex.brand).toBe('amex')

      const mc = await tokenizeCard(TEST_MASTERCARD)
      expect(mc.brand).toBe('mastercard')
    })

    it('should include expiration month and year', async () => {
      const result = await tokenizeCard(TEST_CARD)

      expect(result.expMonth).toBe(12)
      expect(result.expYear).toBe(2027)
    })

    it('should never include raw card number in response', async () => {
      const result = await tokenizeCard(TEST_CARD)

      expect(result).not.toHaveProperty('number')
      expect(result).not.toHaveProperty('cvc')
      expect(JSON.stringify(result)).not.toContain('4242424242424242')
      expect(JSON.stringify(result)).not.toContain('123')
    })

    it('should generate unique tokens for each tokenization', async () => {
      const result1 = await tokenizeCard(TEST_CARD)
      const result2 = await tokenizeCard(TEST_CARD)

      expect(result1.token).not.toBe(result2.token)
    })

    it('should include fingerprint for duplicate detection', async () => {
      const result1 = await tokenizeCard(TEST_CARD)
      const result2 = await tokenizeCard(TEST_CARD)

      // Same card should produce same fingerprint
      expect(result1.fingerprint).toBeDefined()
      expect(result1.fingerprint).toBe(result2.fingerprint)
    })

    it('should include funding type (credit/debit/prepaid)', async () => {
      const result = await tokenizeCard(TEST_CARD)

      expect(['credit', 'debit', 'prepaid', 'unknown']).toContain(result.funding)
    })
  })

  describe('validation', () => {
    it('should reject invalid card number', async () => {
      await expect(
        tokenizeCard({ ...TEST_CARD, number: '1234567890123456' })
      ).rejects.toThrow('Invalid card number')
    })

    it('should reject expired card', async () => {
      await expect(
        tokenizeCard({ ...TEST_CARD, expMonth: 1, expYear: 2020 })
      ).rejects.toThrow('Card is expired')
    })

    it('should reject invalid expiration month', async () => {
      await expect(
        tokenizeCard({ ...TEST_CARD, expMonth: 13 })
      ).rejects.toThrow('Invalid expiration month')
    })

    it('should reject invalid CVC', async () => {
      await expect(
        tokenizeCard({ ...TEST_CARD, cvc: '12' })
      ).rejects.toThrow('Invalid CVC')
    })

    it('should require cardholder name', async () => {
      await expect(
        tokenizeCard({ ...TEST_CARD, holderName: '' })
      ).rejects.toThrow('Cardholder name is required')
    })
  })
})

// ============================================================================
// 2. Tokenize Bank Account (ACH)
// ============================================================================

describe('tokenizeBankAccount', () => {
  describe('ACH tokenization', () => {
    it('should tokenize a valid bank account', async () => {
      const result = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

      expect(result.token).toBeDefined()
      expect(result.token).toMatch(/^ba_/)
    })

    it('should return masked account number (last4)', async () => {
      const result = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

      expect(result.last4).toBe('6789')
      expect(result).not.toHaveProperty('accountNumber')
    })

    it('should include routing number', async () => {
      const result = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

      expect(result.routingNumber).toBe('110000000')
    })

    it('should include account holder details', async () => {
      const result = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

      expect(result.accountHolderName).toBe('Test User')
      expect(result.accountHolderType).toBe('individual')
    })

    it('should include account type', async () => {
      const result = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

      expect(result.accountType).toBe('checking')
    })

    it('should support company accounts', async () => {
      const result = await tokenizeBankAccount(TEST_BUSINESS_BANK_ACCOUNT)

      expect(result.accountHolderType).toBe('company')
      expect(result.accountHolderName).toBe('Acme Corp')
    })

    it('should never include raw account number in response', async () => {
      const result = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

      expect(result).not.toHaveProperty('accountNumber')
      expect(JSON.stringify(result)).not.toContain('000123456789')
    })

    it('should generate unique tokens for each tokenization', async () => {
      const result1 = await tokenizeBankAccount(TEST_BANK_ACCOUNT)
      const result2 = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

      expect(result1.token).not.toBe(result2.token)
    })

    it('should include bank name when detectable', async () => {
      const result = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

      // Bank name is optional but should be present when detectable
      if (result.bankName) {
        expect(typeof result.bankName).toBe('string')
      }
    })
  })

  describe('validation', () => {
    it('should reject invalid routing number', async () => {
      await expect(
        tokenizeBankAccount({ ...TEST_BANK_ACCOUNT, routingNumber: '12345' })
      ).rejects.toThrow('Invalid routing number')
    })

    it('should reject invalid account number', async () => {
      await expect(
        tokenizeBankAccount({ ...TEST_BANK_ACCOUNT, accountNumber: '123' })
      ).rejects.toThrow('Invalid account number')
    })

    it('should require account holder name', async () => {
      await expect(
        tokenizeBankAccount({ ...TEST_BANK_ACCOUNT, accountHolderName: '' })
      ).rejects.toThrow('Account holder name is required')
    })

    it('should require valid account holder type', async () => {
      await expect(
        tokenizeBankAccount({
          ...TEST_BANK_ACCOUNT,
          accountHolderType: 'invalid' as any,
        })
      ).rejects.toThrow('Invalid account holder type')
    })
  })
})

// ============================================================================
// 3. Token Storage and Retrieval
// ============================================================================

describe('storeToken', () => {
  it('should store a tokenized card', async () => {
    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized)

    expect(stored.id).toBeDefined()
    expect(stored.customerId).toBe('cust_123')
    expect(stored.token).toBe(tokenized.token)
  })

  it('should store a tokenized bank account', async () => {
    const tokenized = await tokenizeBankAccount(TEST_BANK_ACCOUNT)
    const stored = await storeToken('cust_123', tokenized)

    expect(stored.id).toBeDefined()
    expect(stored.type).toBe('bank_account')
  })

  it('should include creation timestamp', async () => {
    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized)

    expect(stored.createdAt).toBeInstanceOf(Date)
  })

  it('should reject duplicate tokens for same customer', async () => {
    const tokenized = await tokenizeCard(TEST_CARD)
    await storeToken('cust_123', tokenized)

    // Same token should fail
    await expect(
      storeToken('cust_123', tokenized)
    ).rejects.toThrow('Token already exists')
  })

  it('should allow same card for different customers', async () => {
    const tokenized1 = await tokenizeCard(TEST_CARD)
    const tokenized2 = await tokenizeCard(TEST_CARD)

    const stored1 = await storeToken('cust_123', tokenized1)
    const stored2 = await storeToken('cust_456', tokenized2)

    expect(stored1.customerId).toBe('cust_123')
    expect(stored2.customerId).toBe('cust_456')
  })
})

describe('retrieveToken', () => {
  it('should retrieve a stored token by ID', async () => {
    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized)

    const retrieved = await retrieveToken(stored.id)

    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(stored.id)
    expect(retrieved?.token).toBe(stored.token)
  })

  it('should return null for non-existent token', async () => {
    const retrieved = await retrieveToken('pm_nonexistent')

    expect(retrieved).toBeNull()
  })

  it('should include all metadata', async () => {
    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized)

    const retrieved = await retrieveToken(stored.id)

    expect(retrieved?.metadata?.last4).toBe('4242')
    expect(retrieved?.metadata?.brand).toBe('visa')
    expect(retrieved?.metadata?.expMonth).toBe(12)
    expect(retrieved?.metadata?.expYear).toBe(2027)
  })
})

// ============================================================================
// 4. Token Expiration and Refresh
// ============================================================================

describe('isTokenExpired', () => {
  it('should return false for valid token', async () => {
    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized)

    const expired = await isTokenExpired(stored.id)

    expect(expired).toBe(false)
  })

  it('should return true for expired card token', async () => {
    const expiredCard = { ...TEST_CARD, expMonth: 1, expYear: 2020 }

    // Bypass validation for testing expired storage
    const tokenized = await tokenizeCard({ ...TEST_CARD }, { skipValidation: true })
    // Manually set expiration to past
    const stored = await storeToken('cust_123', {
      ...tokenized,
      expMonth: 1,
      expYear: 2020,
    })

    const expired = await isTokenExpired(stored.id)

    expect(expired).toBe(true)
  })

  it('should return true for token older than configured TTL', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01'))

    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized, {
      ttlDays: 30,
    })

    // Move forward 31 days
    vi.setSystemTime(new Date('2025-02-01'))

    const expired = await isTokenExpired(stored.id)

    expect(expired).toBe(true)

    vi.useRealTimers()
  })

  it('should return false for token within TTL', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01'))

    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized, {
      ttlDays: 30,
    })

    // Move forward 15 days (within TTL)
    vi.setSystemTime(new Date('2025-01-16'))

    const expired = await isTokenExpired(stored.id)

    expect(expired).toBe(false)

    vi.useRealTimers()
  })
})

describe('refreshToken', () => {
  it('should refresh a valid token', async () => {
    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized)

    const refreshed = await refreshToken(stored.id)

    expect(refreshed.token).toBeDefined()
    expect(refreshed.token).not.toBe(stored.token) // New token generated
  })

  it('should maintain same metadata after refresh', async () => {
    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized)

    const refreshed = await refreshToken(stored.id)

    expect(refreshed.metadata?.last4).toBe(stored.metadata?.last4)
    expect(refreshed.metadata?.brand).toBe(stored.metadata?.brand)
  })

  it('should update the updatedAt timestamp', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01'))

    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized)

    vi.setSystemTime(new Date('2025-01-15'))
    const refreshed = await refreshToken(stored.id)

    expect(refreshed.updatedAt.getTime()).toBeGreaterThan(stored.createdAt.getTime())

    vi.useRealTimers()
  })

  it('should reject refresh of expired card', async () => {
    const tokenized = await tokenizeCard(TEST_CARD, { skipValidation: true })
    const stored = await storeToken('cust_123', {
      ...tokenized,
      expMonth: 1,
      expYear: 2020,
    })

    await expect(refreshToken(stored.id)).rejects.toThrow('Cannot refresh expired payment method')
  })

  it('should throw for non-existent token', async () => {
    await expect(refreshToken('pm_nonexistent')).rejects.toThrow('Token not found')
  })

  it('should extend TTL after refresh', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01'))

    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized, { ttlDays: 30 })

    // Move to day 25 (5 days before expiry)
    vi.setSystemTime(new Date('2025-01-26'))

    const refreshed = await refreshToken(stored.id)

    // Move to day 40 from original (would be expired without refresh)
    vi.setSystemTime(new Date('2025-02-10'))

    const expired = await isTokenExpired(refreshed.id)
    expect(expired).toBe(false) // TTL was extended

    vi.useRealTimers()
  })
})

// ============================================================================
// 5. Customer-Token Association
// ============================================================================

describe('getCustomerTokens', () => {
  it('should return all tokens for a customer', async () => {
    const card = await tokenizeCard(TEST_CARD)
    const bank = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

    await storeToken('cust_123', card)
    await storeToken('cust_123', bank)

    const tokens = await getCustomerTokens('cust_123')

    expect(tokens).toHaveLength(2)
  })

  it('should return empty array for customer with no tokens', async () => {
    const tokens = await getCustomerTokens('cust_no_tokens')

    expect(tokens).toEqual([])
  })

  it('should not return other customers tokens', async () => {
    const card1 = await tokenizeCard(TEST_CARD)
    const card2 = await tokenizeCard(TEST_AMEX_CARD)

    await storeToken('cust_123', card1)
    await storeToken('cust_456', card2)

    const tokens = await getCustomerTokens('cust_123')

    expect(tokens).toHaveLength(1)
    expect(tokens[0].metadata?.last4).toBe('4242')
  })

  it('should filter by payment method type', async () => {
    const card = await tokenizeCard(TEST_CARD)
    const bank = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

    await storeToken('cust_123', card)
    await storeToken('cust_123', bank)

    const cardTokens = await getCustomerTokens('cust_123', { type: 'card' })
    const bankTokens = await getCustomerTokens('cust_123', { type: 'bank_account' })

    expect(cardTokens).toHaveLength(1)
    expect(bankTokens).toHaveLength(1)
  })

  it('should exclude expired tokens by default', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01'))

    const validCard = await tokenizeCard(TEST_CARD)
    await storeToken('cust_123', validCard, { ttlDays: 30 })

    const expiringCard = await tokenizeCard(TEST_AMEX_CARD)
    await storeToken('cust_123', expiringCard, { ttlDays: 10 })

    // Move past short TTL but before long TTL
    vi.setSystemTime(new Date('2025-01-15'))

    const tokens = await getCustomerTokens('cust_123')
    expect(tokens).toHaveLength(1)

    const allTokens = await getCustomerTokens('cust_123', { includeExpired: true })
    expect(allTokens).toHaveLength(2)

    vi.useRealTimers()
  })
})

// ============================================================================
// 6. Multi-Token Per Customer
// ============================================================================

describe('multi-token per customer', () => {
  it('should allow storing multiple cards for same customer', async () => {
    const visa = await tokenizeCard(TEST_CARD)
    const amex = await tokenizeCard(TEST_AMEX_CARD)
    const mc = await tokenizeCard(TEST_MASTERCARD)

    await storeToken('cust_123', visa)
    await storeToken('cust_123', amex)
    await storeToken('cust_123', mc)

    const tokens = await getCustomerTokens('cust_123')

    expect(tokens).toHaveLength(3)
  })

  it('should allow mixing card and bank account tokens', async () => {
    const card = await tokenizeCard(TEST_CARD)
    const bank = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

    await storeToken('cust_123', card)
    await storeToken('cust_123', bank)

    const tokens = await getCustomerTokens('cust_123')

    expect(tokens).toHaveLength(2)
    expect(tokens.some(t => t.type === 'card')).toBe(true)
    expect(tokens.some(t => t.type === 'bank_account')).toBe(true)
  })

  it('should reject duplicate card by fingerprint', async () => {
    const card1 = await tokenizeCard(TEST_CARD)
    const card2 = await tokenizeCard(TEST_CARD) // Same card

    await storeToken('cust_123', card1)

    // Second tokenization of same card should fail for same customer
    await expect(
      storeToken('cust_123', card2, { rejectDuplicates: true })
    ).rejects.toThrow('Payment method already exists')
  })

  it('should allow duplicate card when explicitly permitted', async () => {
    const card1 = await tokenizeCard(TEST_CARD)
    const card2 = await tokenizeCard(TEST_CARD)

    await storeToken('cust_123', card1)
    const stored2 = await storeToken('cust_123', card2, { rejectDuplicates: false })

    expect(stored2.id).toBeDefined()
  })
})

// ============================================================================
// 7. Default Payment Method Selection
// ============================================================================

describe('setDefaultPaymentMethod', () => {
  it('should set a payment method as default', async () => {
    const card = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', card)

    await setDefaultPaymentMethod('cust_123', stored.id)

    const defaultPm = await getDefaultPaymentMethod('cust_123')
    expect(defaultPm?.id).toBe(stored.id)
  })

  it('should unset previous default when setting new one', async () => {
    const card1 = await tokenizeCard(TEST_CARD)
    const card2 = await tokenizeCard(TEST_AMEX_CARD)

    const stored1 = await storeToken('cust_123', card1)
    const stored2 = await storeToken('cust_123', card2)

    await setDefaultPaymentMethod('cust_123', stored1.id)
    await setDefaultPaymentMethod('cust_123', stored2.id)

    const defaultPm = await getDefaultPaymentMethod('cust_123')
    expect(defaultPm?.id).toBe(stored2.id)

    const token1 = await retrieveToken(stored1.id)
    expect(token1?.isDefault).toBe(false)
  })

  it('should reject setting expired card as default', async () => {
    const tokenized = await tokenizeCard(TEST_CARD, { skipValidation: true })
    const stored = await storeToken('cust_123', {
      ...tokenized,
      expMonth: 1,
      expYear: 2020,
    })

    await expect(
      setDefaultPaymentMethod('cust_123', stored.id)
    ).rejects.toThrow('Cannot set expired payment method as default')
  })

  it('should reject setting another customers payment method as default', async () => {
    const card = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', card)

    await expect(
      setDefaultPaymentMethod('cust_456', stored.id)
    ).rejects.toThrow('Payment method does not belong to customer')
  })

  it('should reject setting non-existent payment method as default', async () => {
    await expect(
      setDefaultPaymentMethod('cust_123', 'pm_nonexistent')
    ).rejects.toThrow('Payment method not found')
  })
})

describe('getDefaultPaymentMethod', () => {
  it('should return default payment method', async () => {
    const card = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', card)
    await setDefaultPaymentMethod('cust_123', stored.id)

    const defaultPm = await getDefaultPaymentMethod('cust_123')

    expect(defaultPm).not.toBeNull()
    expect(defaultPm?.isDefault).toBe(true)
  })

  it('should return null when no default set', async () => {
    const defaultPm = await getDefaultPaymentMethod('cust_no_default')

    expect(defaultPm).toBeNull()
  })

  it('should auto-set first payment method as default', async () => {
    const tokenizer = createTokenizer({ autoSetDefault: true })

    const card = await tokenizeCard(TEST_CARD)
    await tokenizer.storeToken('cust_auto', card)

    const defaultPm = await tokenizer.getDefaultPaymentMethod('cust_auto')

    expect(defaultPm).not.toBeNull()
    expect(defaultPm?.isDefault).toBe(true)
  })

  it('should not auto-set default when disabled', async () => {
    const tokenizer = createTokenizer({ autoSetDefault: false })

    const card = await tokenizeCard(TEST_CARD)
    await tokenizer.storeToken('cust_no_auto', card)

    const defaultPm = await tokenizer.getDefaultPaymentMethod('cust_no_auto')

    expect(defaultPm).toBeNull()
  })
})

// ============================================================================
// 8. Token Metadata (last4, brand, exp_month/year)
// ============================================================================

describe('token metadata', () => {
  describe('card metadata', () => {
    it('should include last4 digits', async () => {
      const tokenized = await tokenizeCard(TEST_CARD)
      const stored = await storeToken('cust_123', tokenized)

      expect(stored.metadata?.last4).toBe('4242')
    })

    it('should include card brand', async () => {
      const visa = await tokenizeCard(TEST_CARD)
      const amex = await tokenizeCard(TEST_AMEX_CARD)
      const mc = await tokenizeCard(TEST_MASTERCARD)

      const storedVisa = await storeToken('cust_v', visa)
      const storedAmex = await storeToken('cust_a', amex)
      const storedMc = await storeToken('cust_m', mc)

      expect(storedVisa.metadata?.brand).toBe('visa')
      expect(storedAmex.metadata?.brand).toBe('amex')
      expect(storedMc.metadata?.brand).toBe('mastercard')
    })

    it('should include expiration month', async () => {
      const tokenized = await tokenizeCard(TEST_CARD)
      const stored = await storeToken('cust_123', tokenized)

      expect(stored.metadata?.expMonth).toBe(12)
    })

    it('should include expiration year', async () => {
      const tokenized = await tokenizeCard(TEST_CARD)
      const stored = await storeToken('cust_123', tokenized)

      expect(stored.metadata?.expYear).toBe(2027)
    })

    it('should include funding type when available', async () => {
      const tokenized = await tokenizeCard(TEST_CARD)
      const stored = await storeToken('cust_123', tokenized)

      expect(['credit', 'debit', 'prepaid', 'unknown']).toContain(stored.metadata?.funding)
    })

    it('should include fingerprint for deduplication', async () => {
      const tokenized = await tokenizeCard(TEST_CARD)
      const stored = await storeToken('cust_123', tokenized)

      expect(stored.metadata?.fingerprint).toBeDefined()
      expect(typeof stored.metadata?.fingerprint).toBe('string')
    })
  })

  describe('bank account metadata', () => {
    it('should include last4 of account number', async () => {
      const tokenized = await tokenizeBankAccount(TEST_BANK_ACCOUNT)
      const stored = await storeToken('cust_123', tokenized)

      expect(stored.metadata?.last4).toBe('6789')
    })

    it('should include account type', async () => {
      const tokenized = await tokenizeBankAccount(TEST_BANK_ACCOUNT)
      const stored = await storeToken('cust_123', tokenized)

      expect(stored.metadata?.accountType).toBe('checking')
    })

    it('should include account holder type', async () => {
      const tokenized = await tokenizeBankAccount(TEST_BANK_ACCOUNT)
      const stored = await storeToken('cust_123', tokenized)

      expect(stored.metadata?.accountHolderType).toBe('individual')
    })

    it('should include bank name when available', async () => {
      const tokenized = await tokenizeBankAccount(TEST_BANK_ACCOUNT)
      const stored = await storeToken('cust_123', tokenized)

      // Bank name is optional but should be string if present
      if (stored.metadata?.bankName) {
        expect(typeof stored.metadata.bankName).toBe('string')
      }
    })
  })
})

// ============================================================================
// Delete Token
// ============================================================================

describe('deleteToken', () => {
  it('should delete a stored token', async () => {
    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized)

    const deleted = await deleteToken(stored.id)

    expect(deleted).toBe(true)
    expect(await retrieveToken(stored.id)).toBeNull()
  })

  it('should return false for non-existent token', async () => {
    const deleted = await deleteToken('pm_nonexistent')

    expect(deleted).toBe(false)
  })

  it('should clear default if deleted token was default', async () => {
    const tokenized = await tokenizeCard(TEST_CARD)
    const stored = await storeToken('cust_123', tokenized)
    await setDefaultPaymentMethod('cust_123', stored.id)

    await deleteToken(stored.id)

    const defaultPm = await getDefaultPaymentMethod('cust_123')
    expect(defaultPm).toBeNull()
  })

  it('should auto-set new default after deletion when enabled', async () => {
    const tokenizer = createTokenizer({ autoSetDefault: true })

    const card1 = await tokenizeCard(TEST_CARD)
    const card2 = await tokenizeCard(TEST_AMEX_CARD)

    const stored1 = await tokenizer.storeToken('cust_123', card1)
    const stored2 = await tokenizer.storeToken('cust_123', card2)

    await tokenizer.setDefaultPaymentMethod('cust_123', stored1.id)
    await tokenizer.deleteToken(stored1.id)

    const defaultPm = await tokenizer.getDefaultPaymentMethod('cust_123')
    expect(defaultPm?.id).toBe(stored2.id)
  })
})

// ============================================================================
// Tokenizer Factory and Configuration
// ============================================================================

describe('createTokenizer', () => {
  it('should create tokenizer with default config', () => {
    const tokenizer = createTokenizer()

    expect(tokenizer).toBeDefined()
    expect(tokenizer.tokenizeCard).toBeDefined()
    expect(tokenizer.tokenizeBankAccount).toBeDefined()
    expect(tokenizer.storeToken).toBeDefined()
  })

  it('should accept custom configuration', () => {
    const config: TokenizerConfig = {
      autoSetDefault: false,
      defaultTtlDays: 90,
      allowedTypes: ['card'],
    }

    const tokenizer = createTokenizer(config)

    expect(tokenizer).toBeDefined()
  })

  it('should reject disallowed payment method types', async () => {
    const tokenizer = createTokenizer({ allowedTypes: ['card'] })

    const bank = await tokenizeBankAccount(TEST_BANK_ACCOUNT)

    await expect(
      tokenizer.storeToken('cust_123', bank)
    ).rejects.toThrow('Payment method type not allowed')
  })

  it('should use custom TTL', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01'))

    const tokenizer = createTokenizer({ defaultTtlDays: 60 })

    const card = await tokenizeCard(TEST_CARD)
    const stored = await tokenizer.storeToken('cust_123', card)

    // At day 59, should not be expired
    vi.setSystemTime(new Date('2025-03-01'))
    expect(await tokenizer.isTokenExpired(stored.id)).toBe(false)

    // At day 61, should be expired
    vi.setSystemTime(new Date('2025-03-03'))
    expect(await tokenizer.isTokenExpired(stored.id)).toBe(true)

    vi.useRealTimers()
  })

  it('should support custom ID generator', async () => {
    let counter = 0
    const tokenizer = createTokenizer({
      idGenerator: () => `custom_pm_${++counter}`,
    })

    const card = await tokenizeCard(TEST_CARD)
    const stored = await tokenizer.storeToken('cust_123', card)

    expect(stored.id).toBe('custom_pm_1')
  })
})

// ============================================================================
// Type Exports
// ============================================================================

describe('type exports', () => {
  it('should export TokenizedCard type', () => {
    const card: TokenizedCard = {
      token: 'tok_123',
      last4: '4242',
      brand: 'visa',
      expMonth: 12,
      expYear: 2027,
      fingerprint: 'fp_123',
      funding: 'credit',
    }

    expect(card.token).toBe('tok_123')
    expect(card.last4).toBe('4242')
  })

  it('should export TokenizedBankAccount type', () => {
    const bank: TokenizedBankAccount = {
      token: 'ba_123',
      last4: '6789',
      routingNumber: '110000000',
      accountHolderName: 'Test User',
      accountHolderType: 'individual',
      accountType: 'checking',
    }

    expect(bank.token).toBe('ba_123')
    expect(bank.accountType).toBe('checking')
  })

  it('should export StoredToken type', () => {
    const stored: StoredToken = {
      id: 'pm_123',
      customerId: 'cust_123',
      token: 'tok_123',
      type: 'card',
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2027,
      },
    }

    expect(stored.id).toBe('pm_123')
    expect(stored.type).toBe('card')
  })

  it('should export TokenMetadata type', () => {
    const metadata: TokenMetadata = {
      last4: '4242',
      brand: 'visa',
      expMonth: 12,
      expYear: 2027,
      fingerprint: 'fp_123',
    }

    expect(metadata.last4).toBe('4242')
  })

  it('should export TokenizerConfig type', () => {
    const config: TokenizerConfig = {
      autoSetDefault: true,
      defaultTtlDays: 30,
      allowedTypes: ['card', 'bank_account'],
      idGenerator: () => 'custom_id',
    }

    expect(config.autoSetDefault).toBe(true)
  })
})
