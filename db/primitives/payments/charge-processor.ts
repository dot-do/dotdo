/**
 * ChargeProcessor - Charge processing with provider integration and idempotency
 *
 * Provides comprehensive charge processing:
 * - charge() - Create and process charge
 * - authorize() - Auth-only (capture later)
 * - capture() - Capture authorized charge
 * - void() - Void uncaptured authorization
 * - refund() - Full or partial refund
 * - Provider registration for multi-provider support
 * - 3D Secure flow integration
 *
 * @module db/primitives/payments/charge-processor
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Charge status
 */
export type ChargeStatus =
  | 'pending'
  | 'processing'
  | 'requires_capture'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'refunded'
  | 'partially_refunded'

/**
 * Refund status
 */
export type RefundStatus = 'pending' | 'succeeded' | 'failed'

/**
 * Refund reason
 */
export type RefundReason =
  | 'duplicate'
  | 'fraudulent'
  | 'requested_by_customer'
  | 'other'

/**
 * 3D Secure status
 */
export type ThreeDSecureStatus =
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'not_required'

/**
 * 3D Secure exemption type
 */
export type ThreeDSecureExemption =
  | 'low_value'
  | 'trusted_beneficiary'
  | 'transaction_risk_analysis'
  | 'secure_corporate_payment'
  | 'none'

/**
 * Refund record
 */
export interface Refund {
  id: string
  chargeId: string
  amount: number
  currency: string
  status: RefundStatus
  reason?: RefundReason
  metadata?: Record<string, unknown>
  providerRefundId?: string
  createdAt: Date
}

/**
 * Status history entry
 */
export interface StatusHistoryEntry {
  status: ChargeStatus
  timestamp: Date
  reason?: string
}

/**
 * 3D Secure details
 */
export interface ThreeDSecureDetails {
  status: ThreeDSecureStatus
  redirectUrl?: string
  clientSecret?: string
  transactionId?: string
  exemption?: ThreeDSecureExemption
  authenticationValue?: string
  eci?: string
}

/**
 * Charge record
 */
export interface Charge {
  id: string
  amount: number
  currency: string
  status: ChargeStatus
  customerId: string
  paymentMethodId: string
  description?: string
  metadata?: Record<string, unknown>
  idempotencyKey?: string
  provider?: string
  providerChargeId?: string
  authorizedAmount?: number
  capturedAmount?: number
  capturableAmount?: number
  refundedAmount?: number
  refunds?: Refund[]
  authorizationExpiresAt?: Date
  threeDSecure?: ThreeDSecureDetails
  failureCode?: string
  failureMessage?: string
  statusHistory?: StatusHistoryEntry[]
  createdAt: Date
  updatedAt: Date
  capturedAt?: Date
}

/**
 * Charge create options
 */
export interface ChargeCreateOptions {
  amount: number
  currency: string
  customerId: string
  paymentMethodId: string
  description?: string
  metadata?: Record<string, unknown>
  idempotencyKey?: string
  provider?: string
  capture?: boolean
  threeDSecure?: {
    returnUrl?: string
    exemption?: ThreeDSecureExemption
  }
}

/**
 * Charge authorize options
 */
export interface ChargeAuthorizeOptions {
  amount: number
  currency: string
  customerId: string
  paymentMethodId: string
  description?: string
  metadata?: Record<string, unknown>
  idempotencyKey?: string
  provider?: string
  threeDSecure?: {
    returnUrl?: string
    exemption?: ThreeDSecureExemption
  }
}

/**
 * Charge capture options
 */
export interface ChargeCaptureOptions {
  amount?: number
}

/**
 * Charge refund options
 */
export interface ChargeRefundOptions {
  amount?: number
  reason?: RefundReason
  metadata?: Record<string, unknown>
}

/**
 * Provider charge result
 */
export interface ProviderChargeResult {
  providerChargeId: string
  status: ChargeStatus
  failureCode?: string
  failureMessage?: string
  threeDSecure?: ThreeDSecureDetails
}

/**
 * Provider refund result
 */
export interface ProviderRefundResult {
  providerRefundId: string
  status: RefundStatus
}

/**
 * Provider 3D Secure session result
 */
export interface Provider3DSecureResult {
  clientSecret: string
  redirectUrl: string
  status: ThreeDSecureStatus
  transactionId?: string
}

/**
 * Provider 3D Secure confirmation result
 */
export interface Provider3DSecureConfirmResult {
  status: ThreeDSecureStatus
  chargeStatus: ChargeStatus
  authenticationValue?: string
  eci?: string
}

/**
 * Charge provider interface
 */
export interface ChargeProvider {
  name: string
  charge(options: ChargeCreateOptions): Promise<ProviderChargeResult>
  authorize(options: ChargeAuthorizeOptions): Promise<ProviderChargeResult>
  capture(chargeId: string, options?: ChargeCaptureOptions): Promise<{ status: ChargeStatus }>
  refund(chargeId: string, options?: ChargeRefundOptions): Promise<ProviderRefundResult>
  void(chargeId: string): Promise<{ status: ChargeStatus }>
  create3DSecureSession(options: {
    chargeId: string
    amount: number
    currency: string
    returnUrl: string
    exemption?: ThreeDSecureExemption
  }): Promise<Provider3DSecureResult>
  confirm3DSecure(transactionId: string): Promise<Provider3DSecureConfirmResult>
}

/**
 * Charge event types
 */
export type ChargeEventType =
  | 'charge.created'
  | 'charge.captured'
  | 'charge.succeeded'
  | 'charge.failed'
  | 'charge.refunded'
  | 'charge.updated'
  | 'charge.voided'
  | 'charge.requires_action'

/**
 * Charge event payload
 */
export interface ChargeEvent {
  type: ChargeEventType
  charge?: Charge
  refund?: Refund
  data?: Record<string, unknown>
}

/**
 * Charge event handler
 */
export type ChargeEventHandler = (event: ChargeEvent) => void | Promise<void>

/**
 * Unsubscribe function
 */
export type Unsubscribe = () => void

/**
 * List options
 */
export interface ListChargesOptions {
  limit?: number
  startingAfter?: string
  createdAfter?: Date
  createdBefore?: Date
  status?: ChargeStatus
}

/**
 * ChargeProcessor interface
 */
export interface ChargeProcessor {
  // Provider management
  registerProvider(name: string, provider: ChargeProvider): void
  setDefaultProvider(name: string): void
  listSupportedCurrencies(): string[]
  getSupportedCurrencies(): string[]
  listProviders(): string[]
  formatAmount(amount: number, currency: string): string

  // Charge operations
  charge(options: ChargeCreateOptions): Promise<Charge>
  authorize(options: ChargeAuthorizeOptions): Promise<Charge>
  capture(chargeId: string, options?: ChargeCaptureOptions): Promise<Charge>
  void(chargeId: string): Promise<Charge>

  // Refund operations
  refund(chargeId: string, options?: ChargeRefundOptions): Promise<Refund>
  listRefunds(chargeId: string): Promise<Refund[]>
  getRefundsForCharge(chargeId: string): Promise<Refund[]>

  // Query operations
  get(chargeId: string): Promise<Charge | null>
  getCharge(chargeId: string): Promise<Charge | null>
  list(customerId: string, options?: ListChargesOptions): Promise<Charge[]>
  getChargesByCustomer(customerId: string, options?: ListChargesOptions): Promise<Charge[]>
  getByIdempotencyKey(key: string): Promise<Charge | null>
  getChargeByIdempotencyKey(key: string): Promise<Charge | null>
  getTotalCharges(customerId: string): Promise<number>
  getTotalChargedAmount(customerId: string, currency?: string): Promise<number>

  // Metadata
  updateChargeMetadata(chargeId: string, metadata: Record<string, unknown>): Promise<Charge>

  // 3D Secure
  initiate3DSecure(chargeId: string, returnUrl: string): Promise<ThreeDSecureDetails>
  confirm3DSecure(chargeId: string, transactionId: string): Promise<Charge>
  confirmAfter3DSecure(chargeId: string, transactionId: string): Promise<Charge>
  cancel3DSecure(chargeId: string): Promise<Charge>

  // Event handling
  on(event: ChargeEventType | string, handler: ChargeEventHandler): Unsubscribe
}

// =============================================================================
// Constants
// =============================================================================

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const AUTH_EXPIRY_DAYS = 7

// Valid ISO 4217 currency codes (common ones)
const VALID_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'MXN',
  'BRL', 'KRW', 'SGD', 'HKD', 'NOK', 'SEK', 'DKK', 'NZD', 'ZAR', 'RUB',
  'PLN', 'THB', 'MYR', 'IDR', 'PHP', 'CZK', 'ILS', 'CLP', 'AED', 'SAR',
  'TWD', 'TRY', 'ARS', 'COP', 'PKR', 'EGP', 'NGN', 'VND', 'BDT', 'UAH',
])

// Zero-decimal currencies
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'BIF', 'DJF', 'GNF', 'KMF', 'MGA', 'PYG', 'RWF', 'UGX', 'VUV', 'XAF', 'XOF', 'XPF'])

// Three-decimal currencies
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])

// Minimum charge amounts (in smallest unit)
const MIN_CHARGE_AMOUNTS: Record<string, number> = {
  USD: 50, // $0.50
  EUR: 50, // €0.50
  GBP: 30, // £0.30
  JPY: 50, // ¥50
  CAD: 50, // $0.50
  AUD: 50, // $0.50
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function isValidCurrency(currency: string): boolean {
  return VALID_CURRENCIES.has(currency.toUpperCase())
}

function getDecimalPlaces(currency: string): number {
  const upper = currency.toUpperCase()
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) return 0
  if (THREE_DECIMAL_CURRENCIES.has(upper)) return 3
  return 2
}

function getMinimumAmount(currency: string): number {
  return MIN_CHARGE_AMOUNTS[currency.toUpperCase()] ?? 1
}

// =============================================================================
// Idempotency Cache Entry
// =============================================================================

interface IdempotencyCacheEntry {
  charge: Charge
  params: ChargeCreateOptions | ChargeAuthorizeOptions
  expiresAt: number
}

// =============================================================================
// Implementation
// =============================================================================

class ChargeProcessorImpl implements ChargeProcessor {
  private charges: Map<string, Charge> = new Map()
  private idempotencyCache: Map<string, IdempotencyCacheEntry> = new Map()
  private eventHandlers: Map<string, ChargeEventHandler[]> = new Map()
  private providers: Map<string, ChargeProvider> = new Map()
  private defaultProvider: string | null = null

  // =============================================================================
  // Provider Management
  // =============================================================================

  registerProvider(name: string, provider: ChargeProvider): void {
    this.providers.set(name, provider)
    if (this.providers.size === 1) {
      this.defaultProvider = name
    }
  }

  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider ${name} not registered`)
    }
    this.defaultProvider = name
  }

  listSupportedCurrencies(): string[] {
    return Array.from(VALID_CURRENCIES)
  }

  getSupportedCurrencies(): string[] {
    return this.listSupportedCurrencies()
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys())
  }

  formatAmount(amount: number, currency: string): string {
    const decimals = getDecimalPlaces(currency)
    const divisor = Math.pow(10, decimals)
    const value = amount / divisor

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  }

  // =============================================================================
  // Validation
  // =============================================================================

  private validateChargeParams(options: ChargeCreateOptions | ChargeAuthorizeOptions): void {
    if (options.amount <= 0) {
      throw new Error('Amount must be positive')
    }

    if (!options.currency) {
      throw new Error('Currency is required')
    }

    if (!isValidCurrency(options.currency)) {
      throw new Error('Invalid currency code')
    }

    const minAmount = getMinimumAmount(options.currency)
    if (options.amount < minAmount) {
      throw new Error(`Amount must be at least ${minAmount} for ${options.currency.toUpperCase()}`)
    }
  }

  // =============================================================================
  // Charge Operations
  // =============================================================================

  async charge(options: ChargeCreateOptions): Promise<Charge> {
    // Validate
    this.validateChargeParams(options)

    // Normalize currency
    const currency = options.currency.toUpperCase()

    // Check idempotency
    if (options.idempotencyKey) {
      const cached = this.idempotencyCache.get(options.idempotencyKey)
      if (cached && Date.now() < cached.expiresAt) {
        // Verify same params
        if (cached.params.amount !== options.amount || cached.params.currency.toUpperCase() !== currency) {
          throw new Error('Idempotency key already used with different parameters')
        }
        return cached.charge
      }
      if (cached) {
        this.idempotencyCache.delete(options.idempotencyKey)
      }
    }

    const now = new Date()
    const providerName = options.provider ?? this.defaultProvider
    const provider = providerName ? this.providers.get(providerName) : null

    let providerResult: ProviderChargeResult | null = null
    let status: ChargeStatus = options.capture !== false ? 'succeeded' : 'requires_capture'

    // Call provider if available
    if (provider) {
      try {
        providerResult = await provider.charge({ ...options, currency })
        status = providerResult.status
      } catch (e) {
        status = 'failed'
      }
    }

    const charge: Charge = {
      id: generateId('ch'),
      amount: options.amount,
      currency,
      status,
      customerId: options.customerId,
      paymentMethodId: options.paymentMethodId,
      description: options.description,
      metadata: options.metadata,
      idempotencyKey: options.idempotencyKey,
      provider: providerName ?? undefined,
      providerChargeId: providerResult?.providerChargeId,
      authorizedAmount: options.amount,
      capturedAmount: status === 'succeeded' ? options.amount : 0,
      capturableAmount: status === 'requires_capture' ? options.amount : 0,
      refundedAmount: 0,
      refunds: [],
      threeDSecure: providerResult?.threeDSecure,
      failureCode: providerResult?.failureCode,
      failureMessage: providerResult?.failureMessage,
      statusHistory: [{ status, timestamp: now }],
      createdAt: now,
      updatedAt: now,
      capturedAt: status === 'succeeded' ? now : undefined,
    }

    // Store charge
    this.charges.set(charge.id, charge)

    // Store idempotency
    if (options.idempotencyKey) {
      this.idempotencyCache.set(options.idempotencyKey, {
        charge,
        params: options,
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
      })
    }

    // Emit events
    this.emit('charge.created', { type: 'charge.created', charge })
    if (status === 'succeeded') {
      this.emit('charge.succeeded', { type: 'charge.succeeded', charge })
    } else if (status === 'requires_action') {
      this.emit('charge.requires_action', { type: 'charge.requires_action', charge })
    }

    return charge
  }

  async authorize(options: ChargeAuthorizeOptions): Promise<Charge> {
    // Validate
    this.validateChargeParams(options)

    // Normalize currency
    const currency = options.currency.toUpperCase()

    // Check idempotency
    if (options.idempotencyKey) {
      const cached = this.idempotencyCache.get(options.idempotencyKey)
      if (cached && Date.now() < cached.expiresAt) {
        if (cached.params.amount !== options.amount || cached.params.currency.toUpperCase() !== currency) {
          throw new Error('Idempotency key already used with different parameters')
        }
        return cached.charge
      }
      if (cached) {
        this.idempotencyCache.delete(options.idempotencyKey)
      }
    }

    const now = new Date()
    const providerName = options.provider ?? this.defaultProvider
    const provider = providerName ? this.providers.get(providerName) : null

    let providerResult: ProviderChargeResult | null = null
    let status: ChargeStatus = 'requires_capture'

    if (provider) {
      try {
        providerResult = await provider.authorize({ ...options, currency })
        status = providerResult.status
      } catch (e) {
        status = 'failed'
      }
    }

    const authExpiry = new Date(now)
    authExpiry.setDate(authExpiry.getDate() + AUTH_EXPIRY_DAYS)

    const charge: Charge = {
      id: generateId('ch'),
      amount: options.amount,
      currency,
      status,
      customerId: options.customerId,
      paymentMethodId: options.paymentMethodId,
      description: options.description,
      metadata: options.metadata,
      idempotencyKey: options.idempotencyKey,
      provider: providerName ?? undefined,
      providerChargeId: providerResult?.providerChargeId,
      authorizedAmount: options.amount,
      capturedAmount: 0,
      capturableAmount: options.amount,
      refundedAmount: 0,
      refunds: [],
      authorizationExpiresAt: authExpiry,
      threeDSecure: providerResult?.threeDSecure,
      failureCode: providerResult?.failureCode,
      failureMessage: providerResult?.failureMessage,
      statusHistory: [{ status, timestamp: now }],
      createdAt: now,
      updatedAt: now,
    }

    this.charges.set(charge.id, charge)

    if (options.idempotencyKey) {
      this.idempotencyCache.set(options.idempotencyKey, {
        charge,
        params: options,
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
      })
    }

    this.emit('charge.created', { type: 'charge.created', charge })

    return charge
  }

  async capture(chargeId: string, options?: ChargeCaptureOptions): Promise<Charge> {
    const charge = this.charges.get(chargeId)
    if (!charge) {
      throw new Error('Charge not found')
    }

    if (charge.status === 'succeeded') {
      throw new Error('Charge already captured')
    }

    if (charge.status !== 'requires_capture') {
      throw new Error(`Cannot capture charge in ${charge.status} status`)
    }

    // Check authorization expiry
    if (charge.authorizationExpiresAt && new Date() > charge.authorizationExpiresAt) {
      throw new Error('Authorization has expired')
    }

    const captureAmount = options?.amount ?? charge.capturableAmount ?? charge.amount
    const alreadyCaptured = charge.capturedAmount ?? 0

    if (captureAmount > (charge.capturableAmount ?? charge.amount - alreadyCaptured)) {
      throw new Error('Cannot capture more than authorized amount')
    }

    // Call provider if available
    const provider = charge.provider ? this.providers.get(charge.provider) : null
    if (provider && charge.providerChargeId) {
      await provider.capture(charge.providerChargeId, { amount: captureAmount })
    }

    const now = new Date()
    const newCapturedAmount = alreadyCaptured + captureAmount
    const newCapturableAmount = (charge.authorizedAmount ?? charge.amount) - newCapturedAmount

    // Update charge
    charge.capturedAmount = newCapturedAmount
    charge.capturableAmount = newCapturableAmount
    charge.status = newCapturableAmount > 0 ? 'requires_capture' : 'succeeded'
    charge.capturedAt = now
    charge.updatedAt = now
    charge.statusHistory = [...(charge.statusHistory ?? []), { status: charge.status, timestamp: now }]

    this.emit('charge.captured', { type: 'charge.captured', charge })
    if (charge.status === 'succeeded') {
      this.emit('charge.succeeded', { type: 'charge.succeeded', charge })
    }

    return charge
  }

  async void(chargeId: string): Promise<Charge> {
    const charge = this.charges.get(chargeId)
    if (!charge) {
      throw new Error('Charge not found')
    }

    if (charge.status === 'succeeded') {
      throw new Error('Cannot void captured charge')
    }

    if (charge.status !== 'requires_capture') {
      throw new Error(`Cannot void charge in ${charge.status} status`)
    }

    // Call provider
    const provider = charge.provider ? this.providers.get(charge.provider) : null
    if (provider && charge.providerChargeId) {
      await provider.void(charge.providerChargeId)
    }

    const now = new Date()
    charge.status = 'canceled'
    charge.capturableAmount = 0
    charge.updatedAt = now
    charge.statusHistory = [...(charge.statusHistory ?? []), { status: 'canceled', timestamp: now }]

    this.emit('charge.voided', { type: 'charge.voided', charge })

    return charge
  }

  // =============================================================================
  // Refund Operations
  // =============================================================================

  async refund(chargeId: string, options?: ChargeRefundOptions): Promise<Refund> {
    const charge = this.charges.get(chargeId)
    if (!charge) {
      throw new Error('Charge not found')
    }

    if (charge.status !== 'succeeded' && charge.status !== 'partially_refunded') {
      throw new Error('Cannot refund uncaptured charge')
    }

    const refundedSoFar = charge.refundedAmount ?? 0
    const availableForRefund = (charge.capturedAmount ?? charge.amount) - refundedSoFar
    const refundAmount = options?.amount ?? availableForRefund

    if (refundAmount <= 0) {
      throw new Error('Charge already fully refunded')
    }

    if (refundAmount > availableForRefund) {
      throw new Error('Refund amount exceeds available amount')
    }

    // Call provider
    const provider = charge.provider ? this.providers.get(charge.provider) : null
    let providerRefundId: string | undefined

    if (provider && charge.providerChargeId) {
      const result = await provider.refund(charge.providerChargeId, { amount: refundAmount, reason: options?.reason })
      providerRefundId = result.providerRefundId
    }

    const now = new Date()
    const refund: Refund = {
      id: generateId('re'),
      chargeId: charge.id,
      amount: refundAmount,
      currency: charge.currency,
      status: 'succeeded',
      reason: options?.reason,
      metadata: options?.metadata,
      providerRefundId,
      createdAt: now,
    }

    // Update charge
    charge.refundedAmount = refundedSoFar + refundAmount
    charge.refunds = [...(charge.refunds ?? []), refund]
    charge.status = charge.refundedAmount >= (charge.capturedAmount ?? charge.amount) ? 'refunded' : 'partially_refunded'
    charge.updatedAt = now
    charge.statusHistory = [...(charge.statusHistory ?? []), { status: charge.status, timestamp: now }]

    this.emit('charge.refunded', { type: 'charge.refunded', charge, refund })

    return refund
  }

  async listRefunds(chargeId: string): Promise<Refund[]> {
    const charge = this.charges.get(chargeId)
    if (!charge) {
      throw new Error('Charge not found')
    }
    return charge.refunds ?? []
  }

  async getRefundsForCharge(chargeId: string): Promise<Refund[]> {
    return this.listRefunds(chargeId)
  }

  // =============================================================================
  // Query Operations
  // =============================================================================

  async get(chargeId: string): Promise<Charge | null> {
    return this.charges.get(chargeId) ?? null
  }

  async getCharge(chargeId: string): Promise<Charge | null> {
    return this.get(chargeId)
  }

  async list(customerId: string, options?: ListChargesOptions): Promise<Charge[]> {
    let charges = Array.from(this.charges.values())
      .filter((c) => c.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    // Apply filters
    if (options?.status) {
      charges = charges.filter((c) => c.status === options.status)
    }
    if (options?.createdAfter) {
      charges = charges.filter((c) => c.createdAt >= options.createdAfter!)
    }
    if (options?.createdBefore) {
      charges = charges.filter((c) => c.createdAt <= options.createdBefore!)
    }

    // Pagination
    if (options?.startingAfter) {
      const idx = charges.findIndex((c) => c.id === options.startingAfter)
      if (idx !== -1) {
        charges = charges.slice(idx + 1)
      }
    }
    if (options?.limit) {
      charges = charges.slice(0, options.limit)
    }

    return charges
  }

  async getChargesByCustomer(customerId: string, options?: ListChargesOptions): Promise<Charge[]> {
    return this.list(customerId, options)
  }

  async getByIdempotencyKey(key: string): Promise<Charge | null> {
    const entry = this.idempotencyCache.get(key)
    if (entry && Date.now() < entry.expiresAt) {
      return entry.charge
    }
    return null
  }

  async getChargeByIdempotencyKey(key: string): Promise<Charge | null> {
    return this.getByIdempotencyKey(key)
  }

  async getTotalCharges(customerId: string): Promise<number> {
    const charges = Array.from(this.charges.values()).filter(
      (c) => c.customerId === customerId && c.status === 'succeeded'
    )
    return charges.reduce((sum, c) => sum + (c.capturedAmount ?? c.amount), 0)
  }

  async getTotalChargedAmount(customerId: string, currency?: string): Promise<number> {
    const charges = Array.from(this.charges.values()).filter(
      (c) =>
        c.customerId === customerId &&
        c.status === 'succeeded' &&
        (!currency || c.currency === currency.toUpperCase())
    )
    return charges.reduce((sum, c) => sum + (c.capturedAmount ?? c.amount), 0)
  }

  // =============================================================================
  // Metadata Operations
  // =============================================================================

  async updateChargeMetadata(chargeId: string, metadata: Record<string, unknown>): Promise<Charge> {
    const charge = this.charges.get(chargeId)
    if (!charge) {
      throw new Error('Charge not found')
    }

    charge.metadata = { ...(charge.metadata ?? {}), ...metadata }
    charge.updatedAt = new Date()

    return charge
  }

  // =============================================================================
  // 3D Secure
  // =============================================================================

  async initiate3DSecure(chargeId: string, returnUrl: string): Promise<ThreeDSecureDetails> {
    const charge = this.charges.get(chargeId)
    if (!charge) {
      throw new Error('Charge not found')
    }

    const provider = charge.provider ? this.providers.get(charge.provider) : null
    if (!provider) {
      throw new Error('No provider configured')
    }

    const result = await provider.create3DSecureSession({
      chargeId: charge.providerChargeId ?? charge.id,
      amount: charge.amount,
      currency: charge.currency,
      returnUrl,
    })

    const now = new Date()
    charge.threeDSecure = {
      status: result.status,
      redirectUrl: result.redirectUrl,
      clientSecret: result.clientSecret,
      transactionId: result.transactionId,
    }
    charge.status = 'requires_action'
    charge.updatedAt = now
    charge.statusHistory = [...(charge.statusHistory ?? []), { status: 'requires_action', timestamp: now }]

    this.emit('charge.requires_action', { type: 'charge.requires_action', charge })

    return charge.threeDSecure
  }

  async confirm3DSecure(chargeId: string, transactionId: string): Promise<Charge> {
    const charge = this.charges.get(chargeId)
    if (!charge) {
      throw new Error('Charge not found')
    }

    const provider = charge.provider ? this.providers.get(charge.provider) : null
    if (!provider) {
      throw new Error('No provider configured')
    }

    const result = await provider.confirm3DSecure(transactionId)

    const now = new Date()
    if (charge.threeDSecure) {
      charge.threeDSecure.status = result.status
      charge.threeDSecure.authenticationValue = result.authenticationValue
      charge.threeDSecure.eci = result.eci
    }

    charge.status = result.chargeStatus
    charge.updatedAt = now
    charge.statusHistory = [...(charge.statusHistory ?? []), { status: result.chargeStatus, timestamp: now }]

    if (result.chargeStatus === 'succeeded') {
      charge.capturedAt = now
      charge.capturedAmount = charge.amount
      this.emit('charge.succeeded', { type: 'charge.succeeded', charge })
    } else if (result.chargeStatus === 'failed') {
      this.emit('charge.failed', { type: 'charge.failed', charge })
    }

    return charge
  }

  async confirmAfter3DSecure(chargeId: string, transactionId: string): Promise<Charge> {
    return this.confirm3DSecure(chargeId, transactionId)
  }

  async cancel3DSecure(chargeId: string): Promise<Charge> {
    const charge = this.charges.get(chargeId)
    if (!charge) {
      throw new Error('Charge not found')
    }

    const now = new Date()
    if (charge.threeDSecure) {
      charge.threeDSecure.status = 'canceled'
    }
    charge.status = 'canceled'
    charge.updatedAt = now
    charge.statusHistory = [...(charge.statusHistory ?? []), { status: 'canceled', timestamp: now }]

    return charge
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  on(event: ChargeEventType | string, handler: ChargeEventHandler): Unsubscribe {
    let handlers = this.eventHandlers.get(event)
    if (!handlers) {
      handlers = []
      this.eventHandlers.set(event, handlers)
    }
    handlers.push(handler)

    return () => {
      const currentHandlers = this.eventHandlers.get(event)
      if (currentHandlers) {
        const idx = currentHandlers.indexOf(handler)
        if (idx !== -1) {
          currentHandlers.splice(idx, 1)
        }
      }
    }
  }

  private emit(event: string, payload: ChargeEvent): void {
    const handlers = this.eventHandlers.get(event) ?? []
    for (const handler of handlers) {
      try {
        handler(payload)
      } catch {
        // Ignore handler errors
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createChargeProcessor(): ChargeProcessor {
  return new ChargeProcessorImpl()
}
