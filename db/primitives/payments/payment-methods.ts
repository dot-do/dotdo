/**
 * PaymentMethodStore - Tokenized payment method storage
 *
 * PCI-compliant payment method storage with:
 * - Tokenized storage (Stripe pm_xxx, Braintree tokens)
 * - Masked card details (last 4, brand, expiry)
 * - No raw card data storage
 * - Billing address support
 * - Default payment method management
 *
 * @example
 * ```typescript
 * import { createPaymentMethodStore } from './payment-methods'
 *
 * const store = createPaymentMethodStore()
 *
 * // Store a tokenized card
 * const pm = await store.store('cust_123', 'pm_stripe_xxx', {
 *   type: 'card',
 *   card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2025 },
 * })
 *
 * // Set as default
 * await store.setDefault('cust_123', pm.id)
 *
 * // List customer's payment methods
 * const methods = await store.list('cust_123')
 * ```
 *
 * @module db/primitives/payments/payment-methods
 */

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Payment method type
 */
export type PaymentMethodType = 'card' | 'bank_account' | 'wallet'

/**
 * Card brand
 */
export type CardBrand =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'discover'
  | 'diners'
  | 'jcb'
  | 'unionpay'
  | 'unknown'

/**
 * Wallet type
 */
export type WalletType = 'apple_pay' | 'google_pay' | 'paypal' | 'venmo' | string

/**
 * Bank account type
 */
export type BankAccountType = 'checking' | 'savings'

/**
 * Bank account holder type
 */
export type AccountHolderType = 'individual' | 'company'

/**
 * Masked card details - never stores full card number
 */
export interface CardDetails {
  last4: string
  brand: CardBrand
  expMonth: number
  expYear: number
  fingerprint?: string
  funding?: 'credit' | 'debit' | 'prepaid' | 'unknown'
  country?: string
}

/**
 * Bank account details - masked
 */
export interface BankAccountDetails {
  last4: string
  bankName?: string
  routingNumber?: string // May be partially masked
  accountHolderName: string
  accountHolderType: AccountHolderType
  accountType?: BankAccountType
  country?: string
}

/**
 * Wallet details
 */
export interface WalletDetails {
  type: WalletType
  email?: string
  dynamicLast4?: string // For Apple Pay, Google Pay
}

/**
 * Billing address
 */
export interface BillingAddress {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  phone?: string
  email?: string
}

/**
 * Payment method metadata for storage
 */
export interface PaymentMethodMetadata {
  type: PaymentMethodType
  card?: CardDetails
  bankAccount?: BankAccountDetails
  wallet?: WalletDetails
  billingAddress?: BillingAddress
  provider?: string
  fingerprint?: string
  [key: string]: unknown
}

/**
 * Stored payment method
 */
export interface PaymentMethod {
  id: string
  customerId: string
  token: string
  type: PaymentMethodType
  card?: CardDetails
  bankAccount?: BankAccountDetails
  wallet?: WalletDetails
  billingAddress?: BillingAddress
  isDefault: boolean
  isExpired: boolean
  provider: string
  createdAt: Date
  updatedAt: Date
  metadata?: Record<string, unknown>
}

/**
 * Store payment method options
 */
export interface StoreOptions {
  setAsDefault?: boolean
  metadata?: Record<string, unknown>
  /** Skip expiry validation - use for data migration/historical records */
  skipExpiryValidation?: boolean
}

/**
 * List payment methods options
 */
export interface ListOptions {
  type?: PaymentMethodType
  includeExpired?: boolean
  limit?: number
  offset?: number
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Payment method store configuration
 */
export interface PaymentMethodStoreConfig {
  /** Auto-set first payment method as default (default: true) */
  autoSetDefault?: boolean
  /** Allowed payment method types (default: all) */
  allowedTypes?: PaymentMethodType[]
  /** Require billing address (default: false) */
  requireBillingAddress?: boolean
  /** Custom ID generator */
  idGenerator?: () => string
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique payment method ID
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `pm_${timestamp}${random}`
}

/**
 * Detect card brand from last4 or token prefix
 */
export function detectCardBrand(token: string): CardBrand {
  // Stripe token prefixes
  if (token.startsWith('pm_card_visa')) return 'visa'
  if (token.startsWith('pm_card_mastercard')) return 'mastercard'
  if (token.startsWith('pm_card_amex')) return 'amex'
  if (token.startsWith('pm_card_discover')) return 'discover'

  // Generic detection based on token patterns
  if (token.includes('visa')) return 'visa'
  if (token.includes('mastercard') || token.includes('mc')) return 'mastercard'
  if (token.includes('amex') || token.includes('american')) return 'amex'
  if (token.includes('discover')) return 'discover'
  if (token.includes('diners')) return 'diners'
  if (token.includes('jcb')) return 'jcb'
  if (token.includes('unionpay')) return 'unionpay'

  return 'unknown'
}

/**
 * Detect provider from token
 */
export function detectProvider(token: string): string {
  if (token.startsWith('pm_')) return 'stripe'
  if (token.startsWith('tok_')) return 'stripe'
  if (token.startsWith('src_')) return 'stripe'
  if (token.startsWith('btok_')) return 'braintree'
  if (token.startsWith('nonce-')) return 'braintree'
  if (token.startsWith('sq0')) return 'square'
  if (token.startsWith('PAYID-')) return 'paypal'

  return 'unknown'
}

/**
 * Check if a card is expired
 */
export function isCardExpired(expMonth: number, expYear: number, referenceDate?: Date): boolean {
  const now = referenceDate ?? new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1 // getMonth() is 0-indexed

  if (expYear < currentYear) return true
  if (expYear === currentYear && expMonth < currentMonth) return true
  return false
}

/**
 * Validate card expiry
 */
export function validateCardExpiry(expMonth: number, expYear: number): ValidationResult {
  const errors: string[] = []

  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) {
    errors.push('Expiry month must be between 1 and 12')
  }

  const currentYear = new Date().getFullYear()

  // Check for invalid year format first
  if (!Number.isInteger(expYear)) {
    errors.push(`Expiry year must be a valid integer`)
    return { valid: false, errors }
  }

  // Check for unreasonably far future year
  if (expYear > currentYear + 20) {
    errors.push(`Expiry year must be between ${currentYear} and ${currentYear + 20}`)
  }

  // Check if card is expired (years in past are expired, not invalid format)
  if (errors.length === 0 && isCardExpired(expMonth, expYear)) {
    errors.push('Card is expired')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate last 4 digits
 */
export function validateLast4(last4: string): ValidationResult {
  const errors: string[] = []

  if (typeof last4 !== 'string') {
    errors.push('Last 4 digits must be a string')
  } else if (!/^\d{4}$/.test(last4)) {
    errors.push('Last 4 digits must be exactly 4 numeric characters')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate billing address
 */
export function validateBillingAddress(address: BillingAddress): ValidationResult {
  const errors: string[] = []

  if (address.country && !/^[A-Z]{2}$/.test(address.country)) {
    errors.push('Country must be a 2-letter ISO code')
  }

  if (address.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) {
    errors.push('Invalid email format')
  }

  if (address.postalCode && address.postalCode.length > 20) {
    errors.push('Postal code is too long')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate payment method metadata options
 */
export interface ValidateMetadataOptions {
  /** Skip expiry validation - allows storing expired cards */
  skipExpiryValidation?: boolean
}

/**
 * Validate payment method metadata
 */
export function validatePaymentMethodMetadata(
  metadata: PaymentMethodMetadata,
  options: ValidateMetadataOptions = {}
): ValidationResult {
  const errors: string[] = []
  const validTypes: PaymentMethodType[] = ['card', 'bank_account', 'wallet']

  if (!validTypes.includes(metadata.type)) {
    errors.push(`Invalid payment method type: ${metadata.type}. Must be one of: ${validTypes.join(', ')}`)
  }

  if (metadata.type === 'card' && metadata.card) {
    const last4Result = validateLast4(metadata.card.last4)
    errors.push(...last4Result.errors)

    if (!options.skipExpiryValidation) {
      const expiryResult = validateCardExpiry(metadata.card.expMonth, metadata.card.expYear)
      errors.push(...expiryResult.errors)
    }
  }

  if (metadata.type === 'bank_account' && metadata.bankAccount) {
    const last4Result = validateLast4(metadata.bankAccount.last4)
    errors.push(...last4Result.errors)

    if (!metadata.bankAccount.accountHolderName || metadata.bankAccount.accountHolderName.trim() === '') {
      errors.push('Account holder name is required')
    }

    const validHolderTypes: AccountHolderType[] = ['individual', 'company']
    if (!validHolderTypes.includes(metadata.bankAccount.accountHolderType)) {
      errors.push(`Invalid account holder type: ${metadata.bankAccount.accountHolderType}`)
    }
  }

  if (metadata.type === 'wallet' && metadata.wallet) {
    if (!metadata.wallet.type || metadata.wallet.type.trim() === '') {
      errors.push('Wallet type is required')
    }
  }

  if (metadata.billingAddress) {
    const addressResult = validateBillingAddress(metadata.billingAddress)
    errors.push(...addressResult.errors)
  }

  return { valid: errors.length === 0, errors }
}

// =============================================================================
// PaymentMethodStore Implementation
// =============================================================================

/**
 * Internal storage record
 */
interface StoredPaymentMethod {
  id: string
  customerId: string
  token: string
  type: PaymentMethodType
  card?: CardDetails
  bankAccount?: BankAccountDetails
  wallet?: WalletDetails
  billingAddress?: BillingAddress
  isDefault: boolean
  provider: string
  createdAt: Date
  updatedAt: Date
  metadata?: Record<string, unknown>
}

/**
 * PaymentMethodStore - Tokenized payment method storage
 */
export class PaymentMethodStore {
  private methods: Map<string, StoredPaymentMethod> = new Map()
  private customerMethods: Map<string, Set<string>> = new Map()
  private customerDefaults: Map<string, string> = new Map()
  private config: Required<PaymentMethodStoreConfig>

  constructor(config: PaymentMethodStoreConfig = {}) {
    this.config = {
      autoSetDefault: config.autoSetDefault ?? true,
      allowedTypes: config.allowedTypes ?? ['card', 'bank_account', 'wallet'],
      requireBillingAddress: config.requireBillingAddress ?? false,
      idGenerator: config.idGenerator ?? generateId,
    }
  }

  /**
   * Store a tokenized payment method
   */
  async store(
    customerId: string,
    token: string,
    metadata: PaymentMethodMetadata,
    options: StoreOptions = {}
  ): Promise<PaymentMethod> {
    // Validate customer ID
    if (!customerId || customerId.trim() === '') {
      throw new Error('Customer ID is required')
    }

    // Validate token
    if (!token || token.trim() === '') {
      throw new Error('Payment method token is required')
    }

    // Check if this token already exists for this customer
    const customerMethodIds = this.customerMethods.get(customerId)
    if (customerMethodIds) {
      for (const id of customerMethodIds) {
        const existing = this.methods.get(id)
        if (existing && existing.token === token) {
          throw new Error('Payment method with this token already exists for this customer')
        }
      }
    }

    // Validate payment method type
    if (!this.config.allowedTypes.includes(metadata.type)) {
      throw new Error(
        `Payment method type '${metadata.type}' is not allowed. Allowed types: ${this.config.allowedTypes.join(', ')}`
      )
    }

    // Validate metadata
    const validationResult = validatePaymentMethodMetadata(metadata, {
      skipExpiryValidation: options.skipExpiryValidation,
    })
    if (!validationResult.valid) {
      throw new Error(`Invalid payment method: ${validationResult.errors.join(', ')}`)
    }

    // Check billing address requirement
    if (this.config.requireBillingAddress && !metadata.billingAddress) {
      throw new Error('Billing address is required')
    }

    // Detect provider if not specified
    const provider = metadata.provider ?? detectProvider(token)

    const now = new Date()
    const id = this.config.idGenerator()

    const stored: StoredPaymentMethod = {
      id,
      customerId,
      token,
      type: metadata.type,
      card: metadata.card,
      bankAccount: metadata.bankAccount,
      wallet: metadata.wallet,
      billingAddress: metadata.billingAddress,
      isDefault: false,
      provider,
      createdAt: now,
      updatedAt: now,
      metadata: options.metadata,
    }

    // Store the payment method
    this.methods.set(id, stored)

    // Track customer -> payment methods relationship
    if (!this.customerMethods.has(customerId)) {
      this.customerMethods.set(customerId, new Set())
    }
    this.customerMethods.get(customerId)!.add(id)

    // Handle default setting
    const shouldSetDefault =
      options.setAsDefault ??
      (this.config.autoSetDefault && !this.customerDefaults.has(customerId))

    if (shouldSetDefault) {
      await this.setDefault(customerId, id)
      stored.isDefault = true
    }

    return this.toPaymentMethod(stored)
  }

  /**
   * Get a payment method by ID
   */
  async get(paymentMethodId: string): Promise<PaymentMethod | null> {
    const stored = this.methods.get(paymentMethodId)
    if (!stored) return null
    return this.toPaymentMethod(stored)
  }

  /**
   * List customer's payment methods
   */
  async list(customerId: string, options: ListOptions = {}): Promise<PaymentMethod[]> {
    const methodIds = this.customerMethods.get(customerId)
    if (!methodIds) return []

    let methods: PaymentMethod[] = []

    for (const id of methodIds) {
      const stored = this.methods.get(id)
      if (!stored) continue

      const pm = this.toPaymentMethod(stored)

      // Filter by type
      if (options.type && pm.type !== options.type) continue

      // Filter expired unless includeExpired
      if (!options.includeExpired && pm.isExpired) continue

      methods.push(pm)
    }

    // Sort by creation date (newest first), but default first
    methods.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1
      if (!a.isDefault && b.isDefault) return 1
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

    // Apply pagination
    const offset = options.offset ?? 0
    const limit = options.limit ?? methods.length

    return methods.slice(offset, offset + limit)
  }

  /**
   * Set default payment method for a customer
   */
  async setDefault(customerId: string, paymentMethodId: string): Promise<void> {
    const stored = this.methods.get(paymentMethodId)

    if (!stored) {
      throw new Error('Payment method not found')
    }

    if (stored.customerId !== customerId) {
      throw new Error('Payment method does not belong to this customer')
    }

    // Check if the payment method is expired (cards only)
    const pm = this.toPaymentMethod(stored)
    if (pm.isExpired) {
      throw new Error('Cannot set an expired payment method as default')
    }

    // Clear old default
    const oldDefaultId = this.customerDefaults.get(customerId)
    if (oldDefaultId) {
      const oldDefault = this.methods.get(oldDefaultId)
      if (oldDefault) {
        oldDefault.isDefault = false
        oldDefault.updatedAt = new Date()
      }
    }

    // Set new default
    stored.isDefault = true
    stored.updatedAt = new Date()
    this.customerDefaults.set(customerId, paymentMethodId)
  }

  /**
   * Get customer's default payment method
   */
  async getDefault(customerId: string): Promise<PaymentMethod | null> {
    const defaultId = this.customerDefaults.get(customerId)
    if (!defaultId) return null

    return this.get(defaultId)
  }

  /**
   * Delete a payment method
   */
  async delete(paymentMethodId: string): Promise<boolean> {
    const stored = this.methods.get(paymentMethodId)
    if (!stored) return false

    const { customerId, isDefault } = stored

    // Remove from methods map
    this.methods.delete(paymentMethodId)

    // Remove from customer's method set
    const customerMethodIds = this.customerMethods.get(customerId)
    if (customerMethodIds) {
      customerMethodIds.delete(paymentMethodId)
      if (customerMethodIds.size === 0) {
        this.customerMethods.delete(customerId)
      }
    }

    // If this was the default, clear default or set a new one
    if (isDefault) {
      this.customerDefaults.delete(customerId)

      // Optionally set another valid method as default
      if (this.config.autoSetDefault && customerMethodIds && customerMethodIds.size > 0) {
        // Find first non-expired method
        for (const id of customerMethodIds) {
          const method = this.methods.get(id)
          if (method) {
            const pm = this.toPaymentMethod(method)
            if (!pm.isExpired) {
              await this.setDefault(customerId, id)
              break
            }
          }
        }
      }
    }

    return true
  }

  /**
   * Update a payment method's billing address
   */
  async updateBillingAddress(
    paymentMethodId: string,
    billingAddress: BillingAddress
  ): Promise<PaymentMethod | null> {
    const stored = this.methods.get(paymentMethodId)
    if (!stored) return null

    // Validate billing address
    const validationResult = validateBillingAddress(billingAddress)
    if (!validationResult.valid) {
      throw new Error(`Invalid billing address: ${validationResult.errors.join(', ')}`)
    }

    stored.billingAddress = billingAddress
    stored.updatedAt = new Date()

    return this.toPaymentMethod(stored)
  }

  /**
   * Update payment method metadata
   */
  async updateMetadata(
    paymentMethodId: string,
    metadata: Record<string, unknown>
  ): Promise<PaymentMethod | null> {
    const stored = this.methods.get(paymentMethodId)
    if (!stored) return null

    stored.metadata = { ...stored.metadata, ...metadata }
    stored.updatedAt = new Date()

    return this.toPaymentMethod(stored)
  }

  /**
   * Get all payment methods for a customer (including expired)
   */
  async getAll(customerId: string): Promise<PaymentMethod[]> {
    return this.list(customerId, { includeExpired: true })
  }

  /**
   * Count payment methods for a customer
   */
  async count(customerId: string, options: ListOptions = {}): Promise<number> {
    const methods = await this.list(customerId, { ...options, limit: undefined, offset: undefined })
    return methods.length
  }

  /**
   * Check if a payment method exists
   */
  async exists(paymentMethodId: string): Promise<boolean> {
    return this.methods.has(paymentMethodId)
  }

  /**
   * Get payment methods by token
   */
  async getByToken(token: string): Promise<PaymentMethod | null> {
    for (const stored of this.methods.values()) {
      if (stored.token === token) {
        return this.toPaymentMethod(stored)
      }
    }
    return null
  }

  /**
   * Convert stored record to PaymentMethod
   */
  private toPaymentMethod(stored: StoredPaymentMethod): PaymentMethod {
    let isExpired = false

    if (stored.type === 'card' && stored.card) {
      isExpired = isCardExpired(stored.card.expMonth, stored.card.expYear)
    }

    return {
      id: stored.id,
      customerId: stored.customerId,
      token: stored.token,
      type: stored.type,
      card: stored.card,
      bankAccount: stored.bankAccount,
      wallet: stored.wallet,
      billingAddress: stored.billingAddress,
      isDefault: stored.isDefault,
      isExpired,
      provider: stored.provider,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      metadata: stored.metadata,
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new PaymentMethodStore instance
 */
export function createPaymentMethodStore(
  config: PaymentMethodStoreConfig = {}
): PaymentMethodStore {
  return new PaymentMethodStore(config)
}
