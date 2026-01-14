/**
 * PaymentProcessor - Unified payment and billing abstraction
 *
 * Provider-agnostic payment processing with support for:
 * - One-time payments (charge)
 * - Two-step payments (authorize + capture)
 * - Refunds and voids
 * - Payment methods (cards, bank accounts, wallets)
 * - Subscriptions with trials, pausing, cancellation
 * - Invoice generation and management
 *
 * @module db/primitives/payment-processor
 */

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Payment status
 */
export type PaymentStatus =
  | 'pending'
  | 'requires_capture'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'refunded'
  | 'partially_refunded'

/**
 * Subscription status
 */
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'paused'
  | 'canceled'
  | 'incomplete'

/**
 * Invoice status
 */
export type InvoiceStatus = 'draft' | 'open' | 'sent' | 'paid' | 'void' | 'uncollectible'

/**
 * Payment method type
 */
export type PaymentMethodType = 'card' | 'bank_account' | 'wallet'

/**
 * Billing cycle
 */
export type BillingCycle = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

/**
 * Refund reason
 */
export type RefundReason =
  | 'duplicate'
  | 'fraudulent'
  | 'customer_request'
  | 'product_unsatisfactory'
  | string

/**
 * Wallet type
 */
export type WalletType = 'apple_pay' | 'google_pay' | 'paypal' | 'venmo' | string

/**
 * Discount type
 */
export type DiscountType = 'percentage' | 'fixed'

// =============================================================================
// Core Entity Interfaces
// =============================================================================

/**
 * Payment record
 */
export interface Payment {
  id: string
  amount: number
  currency: string
  status: PaymentStatus
  customerId: string
  paymentMethodId?: string
  description?: string
  metadata?: Record<string, unknown>
  provider: string
  providerChargeId?: string
  createdAt: Date
  updatedAt: Date
  capturedAt?: Date
  capturedAmount?: number
  refundedAmount?: number
  refunds?: Refund[]
  expiresAt?: Date
}

/**
 * Refund record
 */
export interface Refund {
  id: string
  paymentId: string
  amount: number
  status: 'pending' | 'succeeded' | 'failed'
  reason?: RefundReason
  metadata?: Record<string, unknown>
  provider: string
  providerRefundId?: string
  createdAt: Date
}

/**
 * Card details (masked)
 */
export interface CardDetails {
  last4?: string
  brand?: string
  expMonth?: number
  expYear?: number
  number?: string // Never stored
}

/**
 * Bank account details
 */
export interface BankAccountDetails {
  last4?: string
  bankName?: string
  accountHolderName?: string
  accountHolderType?: 'individual' | 'company'
}

/**
 * Wallet details
 */
export interface WalletDetails {
  type: WalletType
  email?: string
}

/**
 * Payment method
 */
export interface PaymentMethod {
  id: string
  customerId: string
  type: PaymentMethodType
  card?: CardDetails
  bankAccount?: BankAccountDetails
  wallet?: WalletDetails
  isDefault?: boolean
  provider: string
  providerPaymentMethodId?: string
  createdAt: Date
}

/**
 * Subscription record
 */
export interface Subscription {
  id: string
  customerId: string
  priceId: string
  status: SubscriptionStatus
  billingCycle: BillingCycle
  quantity?: number
  currentPeriodStart?: Date
  currentPeriodEnd?: Date
  trialStart?: Date
  trialEnd?: Date
  cancelAtPeriodEnd?: boolean
  canceledAt?: Date | null
  pausedAt?: Date | null
  metadata?: Record<string, unknown>
  provider: string
  providerSubscriptionId?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Invoice line item
 */
export interface InvoiceLineItem {
  id?: string
  description: string
  amount: number
  quantity?: number
}

/**
 * Invoice discount
 */
export interface InvoiceDiscount {
  type: DiscountType
  value: number
  amount?: number
}

/**
 * Invoice record
 */
export interface Invoice {
  id: string
  customerId: string
  currency: string
  lineItems: InvoiceLineItem[]
  subtotal: number
  discount?: InvoiceDiscount
  tax?: number
  total: number
  status: InvoiceStatus
  invoiceNumber?: string
  dueDate?: Date
  notes?: string
  paymentId?: string
  sentAt?: Date
  paidAt?: Date
  metadata?: Record<string, unknown>
  provider: string
  providerInvoiceId?: string
  createdAt: Date
  updatedAt: Date
}

// =============================================================================
// Option Interfaces
// =============================================================================

/**
 * Charge options
 */
export interface ChargeOptions {
  amount: number
  currency: string
  customerId: string
  paymentMethodId: string
  description?: string
  metadata?: Record<string, unknown>
  provider?: string
  idempotencyKey?: string
}

/**
 * Authorize options
 */
export interface AuthorizeOptions {
  amount: number
  currency: string
  customerId: string
  paymentMethodId: string
  description?: string
  metadata?: Record<string, unknown>
  provider?: string
  idempotencyKey?: string
  expiresIn?: number
}

/**
 * Capture options
 */
export interface CaptureOptions {
  amount?: number
}

/**
 * Refund options
 */
export interface RefundOptions {
  amount?: number
  reason?: RefundReason
  metadata?: Record<string, unknown>
}

/**
 * Create payment method options
 */
export interface CreatePaymentMethodOptions {
  customerId: string
  type: PaymentMethodType
  card?: {
    token: string
    last4?: string
    brand?: string
    expMonth?: number
    expYear?: number
  }
  bankAccount?: {
    accountNumber: string
    routingNumber: string
    accountHolderName: string
    accountHolderType: 'individual' | 'company'
  }
  wallet?: {
    type: WalletType
    token: string
  }
  provider?: string
}

/**
 * Create subscription options
 */
export interface CreateSubscriptionOptions {
  customerId: string
  priceId: string
  billingCycle: BillingCycle
  trialDays?: number
  quantity?: number
  metadata?: Record<string, unknown>
  provider?: string
}

/**
 * Update subscription options
 */
export interface UpdateSubscriptionOptions {
  priceId?: string
  billingCycle?: BillingCycle
  quantity?: number
  metadata?: Record<string, unknown>
}

/**
 * Cancel subscription options
 */
export interface CancelSubscriptionOptions {
  atPeriodEnd?: boolean
  reason?: string
}

/**
 * Create invoice options
 */
export interface CreateInvoiceOptions {
  customerId: string
  currency?: string
  lineItems: InvoiceLineItem[]
  discount?: { type: DiscountType; value: number }
  dueDate?: Date
  notes?: string
  metadata?: Record<string, unknown>
  provider?: string
}

/**
 * Mark invoice paid options
 */
export interface MarkInvoicePaidOptions {
  paymentId?: string
}

/**
 * Webhook event
 */
export interface WebhookEvent {
  type: string
  data: Record<string, unknown>
  provider: string
}

// =============================================================================
// Provider Interface
// =============================================================================

/**
 * Payment provider adapter interface
 */
export interface PaymentProvider {
  name: string

  // Payments
  charge(
    payment: Payment,
    options: ChargeOptions
  ): Promise<{ id: string; status: PaymentStatus; providerChargeId: string }>
  authorize(
    payment: Payment,
    options: AuthorizeOptions
  ): Promise<{ id: string; status: PaymentStatus; providerChargeId: string }>
  capture(payment: Payment, options: CaptureOptions): Promise<{ status: PaymentStatus }>
  refund(
    payment: Payment,
    refund: Refund,
    options: RefundOptions
  ): Promise<{ id: string; status: string; providerRefundId: string }>
  void(payment: Payment): Promise<{ status: string }>

  // Payment Methods
  createPaymentMethod(
    paymentMethod: PaymentMethod,
    options: CreatePaymentMethodOptions
  ): Promise<{ id: string; providerPaymentMethodId: string }>
  deletePaymentMethod(paymentMethod: PaymentMethod): Promise<boolean>

  // Subscriptions
  createSubscription(
    subscription: Subscription,
    options: CreateSubscriptionOptions
  ): Promise<{ id: string; status: SubscriptionStatus; providerSubscriptionId: string }>
  updateSubscription(
    subscription: Subscription,
    options: UpdateSubscriptionOptions
  ): Promise<{ status: SubscriptionStatus }>
  cancelSubscription(
    subscription: Subscription,
    options: CancelSubscriptionOptions
  ): Promise<{ status: SubscriptionStatus }>
  pauseSubscription(subscription: Subscription): Promise<{ status: SubscriptionStatus }>
  resumeSubscription(subscription: Subscription): Promise<{ status: SubscriptionStatus }>

  // Invoices
  createInvoice(
    invoice: Invoice,
    options: CreateInvoiceOptions
  ): Promise<{ id: string; status: InvoiceStatus; providerInvoiceId: string }>
  sendInvoice(invoice: Invoice): Promise<{ status: InvoiceStatus }>
  markInvoicePaid(invoice: Invoice, options: MarkInvoicePaidOptions): Promise<{ status: InvoiceStatus }>
}

// =============================================================================
// PaymentProcessor Interface
// =============================================================================

/**
 * Payment methods manager interface
 */
export interface PaymentMethodsManager {
  create(options: CreatePaymentMethodOptions): Promise<PaymentMethod>
  get(id: string): Promise<PaymentMethod | null>
  list(customerId: string): Promise<PaymentMethod[]>
  delete(id: string): Promise<void>
  setDefault(customerId: string, paymentMethodId: string): Promise<void>
  getDefault(customerId: string): Promise<PaymentMethod | null>
}

/**
 * Subscriptions manager interface
 */
export interface SubscriptionsManager {
  create(options: CreateSubscriptionOptions): Promise<Subscription>
  get(id: string): Promise<Subscription | null>
  list(customerId: string): Promise<Subscription[]>
  update(id: string, options: UpdateSubscriptionOptions): Promise<Subscription>
  cancel(id: string, options?: CancelSubscriptionOptions): Promise<Subscription>
  pause(id: string): Promise<Subscription>
  resume(id: string): Promise<Subscription>
}

/**
 * Invoices manager interface
 */
export interface InvoicesManager {
  create(options: CreateInvoiceOptions): Promise<Invoice>
  get(id: string): Promise<Invoice | null>
  list(customerId: string): Promise<Invoice[]>
  send(id: string): Promise<Invoice>
  markPaid(id: string, options?: MarkInvoicePaidOptions): Promise<Invoice>
  void(id: string): Promise<Invoice>
  finalize(id: string): Promise<Invoice>
}

/**
 * Webhook handler type
 */
export type WebhookHandler = (data: Record<string, unknown>) => void | Promise<void>

/**
 * PaymentProcessor interface
 */
export interface PaymentProcessor {
  // Provider management
  registerProvider(name: string, provider: PaymentProvider): void
  unregisterProvider(name: string): void
  getProvider(name: string): PaymentProvider
  getDefaultProvider(): PaymentProvider
  setDefaultProvider(name: string): void
  listProviders(): string[]

  // Payments
  charge(options: ChargeOptions): Promise<Payment>
  authorize(options: AuthorizeOptions): Promise<Payment>
  capture(paymentId: string, options?: CaptureOptions): Promise<Payment>
  refund(paymentId: string, options?: RefundOptions): Promise<Refund>
  void(paymentId: string): Promise<Payment>
  getPayment(id: string): Promise<Payment | null>
  getPaymentsByCustomer(customerId: string): Promise<Payment[]>

  // Sub-managers
  paymentMethods: PaymentMethodsManager
  subscriptions: SubscriptionsManager
  invoices: InvoicesManager

  // Webhooks
  onWebhook(event: string, handler: WebhookHandler): void
  getWebhookHandlers(event: string): WebhookHandler[]
  processWebhook(event: WebhookEvent): Promise<void>
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function calculateBillingPeriod(cycle: BillingCycle): { start: Date; end: Date } {
  const start = new Date()
  const end = new Date()

  switch (cycle) {
    case 'daily':
      end.setDate(end.getDate() + 1)
      break
    case 'weekly':
      end.setDate(end.getDate() + 7)
      break
    case 'monthly':
      end.setMonth(end.getMonth() + 1)
      break
    case 'quarterly':
      end.setMonth(end.getMonth() + 3)
      break
    case 'yearly':
      end.setFullYear(end.getFullYear() + 1)
      break
  }

  return { start, end }
}

// =============================================================================
// Implementation
// =============================================================================

class PaymentProcessorImpl implements PaymentProcessor {
  private providers: Map<string, PaymentProvider> = new Map()
  private defaultProviderName: string | null = null

  // Storage
  private payments: Map<string, Payment> = new Map()
  private paymentMethodsStore: Map<string, PaymentMethod> = new Map()
  private subscriptionsStore: Map<string, Subscription> = new Map()
  private invoicesStore: Map<string, Invoice> = new Map()
  private customerDefaultPaymentMethods: Map<string, string> = new Map()

  // Idempotency
  private idempotencyCache: Map<string, Payment> = new Map()

  // Webhooks
  private webhookHandlers: Map<string, WebhookHandler[]> = new Map()

  // Invoice numbering
  private invoiceCounter = 0

  // =============================================================================
  // Provider Management
  // =============================================================================

  registerProvider(name: string, provider: PaymentProvider): void {
    this.providers.set(name, provider)
    if (!this.defaultProviderName) {
      this.defaultProviderName = name
    }
  }

  unregisterProvider(name: string): void {
    this.providers.delete(name)
    if (this.defaultProviderName === name) {
      this.defaultProviderName = this.providers.keys().next().value ?? null
    }
  }

  getProvider(name: string): PaymentProvider {
    const provider = this.providers.get(name)
    if (!provider) {
      throw new Error(`Provider not found: ${name}`)
    }
    return provider
  }

  getDefaultProvider(): PaymentProvider {
    if (!this.defaultProviderName) {
      throw new Error('No payment provider registered')
    }
    return this.getProvider(this.defaultProviderName)
  }

  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider not found: ${name}`)
    }
    this.defaultProviderName = name
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys())
  }

  // =============================================================================
  // Payments
  // =============================================================================

  async charge(options: ChargeOptions): Promise<Payment> {
    // Validate
    if (options.amount <= 0) {
      throw new Error('Amount must be positive')
    }

    // Check idempotency
    if (options.idempotencyKey && this.idempotencyCache.has(options.idempotencyKey)) {
      return this.idempotencyCache.get(options.idempotencyKey)!
    }

    const providerName = options.provider ?? this.defaultProviderName
    if (!providerName) {
      throw new Error('No payment provider registered')
    }
    const provider = this.getProvider(providerName)

    const now = new Date()
    const payment: Payment = {
      id: generateId('pay'),
      amount: options.amount,
      currency: options.currency,
      status: 'pending',
      customerId: options.customerId,
      paymentMethodId: options.paymentMethodId,
      description: options.description,
      metadata: options.metadata,
      provider: providerName,
      createdAt: now,
      updatedAt: now,
      refundedAmount: 0,
      refunds: [],
    }

    // Call provider
    const result = await provider.charge(payment, options)
    payment.status = result.status
    payment.providerChargeId = result.providerChargeId
    payment.updatedAt = new Date()

    // Store
    this.payments.set(payment.id, payment)

    // Cache for idempotency
    if (options.idempotencyKey) {
      this.idempotencyCache.set(options.idempotencyKey, payment)
    }

    return payment
  }

  async authorize(options: AuthorizeOptions): Promise<Payment> {
    if (options.amount <= 0) {
      throw new Error('Amount must be positive')
    }

    // Check idempotency
    if (options.idempotencyKey && this.idempotencyCache.has(options.idempotencyKey)) {
      return this.idempotencyCache.get(options.idempotencyKey)!
    }

    const providerName = options.provider ?? this.defaultProviderName
    if (!providerName) {
      throw new Error('No payment provider registered')
    }
    const provider = this.getProvider(providerName)

    const now = new Date()
    const payment: Payment = {
      id: generateId('pay'),
      amount: options.amount,
      currency: options.currency,
      status: 'pending',
      customerId: options.customerId,
      paymentMethodId: options.paymentMethodId,
      description: options.description,
      metadata: options.metadata,
      provider: providerName,
      createdAt: now,
      updatedAt: now,
      refundedAmount: 0,
      refunds: [],
    }

    if (options.expiresIn) {
      payment.expiresAt = new Date(now.getTime() + options.expiresIn)
    }

    // Call provider
    const result = await provider.authorize(payment, options)
    payment.status = result.status
    payment.providerChargeId = result.providerChargeId
    payment.updatedAt = new Date()

    // Store
    this.payments.set(payment.id, payment)

    // Cache for idempotency
    if (options.idempotencyKey) {
      this.idempotencyCache.set(options.idempotencyKey, payment)
    }

    return payment
  }

  async capture(paymentId: string, options?: CaptureOptions): Promise<Payment> {
    const payment = this.payments.get(paymentId)
    if (!payment) {
      throw new Error('Payment not found')
    }

    if (payment.status === 'succeeded') {
      throw new Error('Payment already captured')
    }

    const captureAmount = options?.amount ?? payment.amount
    if (captureAmount > payment.amount) {
      throw new Error('Cannot capture more than authorized amount')
    }

    const provider = this.getProvider(payment.provider)

    // Call provider
    const result = await provider.capture(payment, { amount: captureAmount })
    payment.status = result.status
    payment.capturedAt = new Date()
    payment.capturedAmount = captureAmount
    payment.updatedAt = new Date()

    return payment
  }

  async refund(paymentId: string, options?: RefundOptions): Promise<Refund> {
    const payment = this.payments.get(paymentId)
    if (!payment) {
      throw new Error('Payment not found')
    }

    const refundedSoFar = payment.refundedAmount ?? 0
    const availableForRefund = payment.amount - refundedSoFar

    if (availableForRefund <= 0) {
      throw new Error('Payment already fully refunded')
    }

    const refundAmount = options?.amount ?? availableForRefund
    if (refundAmount > availableForRefund) {
      throw new Error('Refund amount exceeds available amount')
    }

    const provider = this.getProvider(payment.provider)

    const refund: Refund = {
      id: generateId('re'),
      paymentId: payment.id,
      amount: refundAmount,
      status: 'pending',
      reason: options?.reason,
      metadata: options?.metadata,
      provider: payment.provider,
      createdAt: new Date(),
    }

    // Call provider
    const result = await provider.refund(payment, refund, options ?? {})
    refund.status = result.status as 'pending' | 'succeeded' | 'failed'
    refund.providerRefundId = result.providerRefundId

    // Update payment
    payment.refundedAmount = refundedSoFar + refundAmount
    payment.refunds = [...(payment.refunds ?? []), refund]
    payment.status =
      payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded'
    payment.updatedAt = new Date()

    return refund
  }

  async void(paymentId: string): Promise<Payment> {
    const payment = this.payments.get(paymentId)
    if (!payment) {
      throw new Error('Payment not found')
    }

    if (payment.status === 'succeeded') {
      throw new Error('Cannot void captured payment')
    }

    if (payment.status === 'canceled') {
      throw new Error('Payment already canceled')
    }

    const provider = this.getProvider(payment.provider)

    // Call provider
    const result = await provider.void(payment)
    payment.status = result.status as PaymentStatus
    payment.updatedAt = new Date()

    return payment
  }

  async getPayment(id: string): Promise<Payment | null> {
    return this.payments.get(id) ?? null
  }

  async getPaymentsByCustomer(customerId: string): Promise<Payment[]> {
    return Array.from(this.payments.values()).filter((p) => p.customerId === customerId)
  }

  // =============================================================================
  // Payment Methods Manager
  // =============================================================================

  paymentMethods: PaymentMethodsManager = {
    create: async (options: CreatePaymentMethodOptions): Promise<PaymentMethod> => {
      const providerName = options.provider ?? this.defaultProviderName
      if (!providerName) {
        throw new Error('No payment provider registered')
      }
      const provider = this.getProvider(providerName)

      const paymentMethod: PaymentMethod = {
        id: generateId('pm'),
        customerId: options.customerId,
        type: options.type,
        provider: providerName,
        createdAt: new Date(),
      }

      // Process card data
      if (options.type === 'card' && options.card) {
        paymentMethod.card = {
          last4: options.card.last4 ?? '4242', // Mock last4 for tests
          brand: options.card.brand ?? 'visa',
          expMonth: options.card.expMonth,
          expYear: options.card.expYear,
        }
      }

      // Process bank account data
      if (options.type === 'bank_account' && options.bankAccount) {
        paymentMethod.bankAccount = {
          last4: options.bankAccount.accountNumber.slice(-4),
          accountHolderName: options.bankAccount.accountHolderName,
          accountHolderType: options.bankAccount.accountHolderType,
        }
      }

      // Process wallet data
      if (options.type === 'wallet' && options.wallet) {
        paymentMethod.wallet = {
          type: options.wallet.type,
        }
      }

      // Call provider
      const result = await provider.createPaymentMethod(paymentMethod, options)
      paymentMethod.providerPaymentMethodId = result.providerPaymentMethodId

      // Store
      this.paymentMethodsStore.set(paymentMethod.id, paymentMethod)

      // Set as default if first for customer
      const existing = Array.from(this.paymentMethodsStore.values()).filter(
        (pm) => pm.customerId === options.customerId && pm.id !== paymentMethod.id
      )
      if (existing.length === 0) {
        this.customerDefaultPaymentMethods.set(options.customerId, paymentMethod.id)
        paymentMethod.isDefault = true
      }

      return paymentMethod
    },

    get: async (id: string): Promise<PaymentMethod | null> => {
      return this.paymentMethodsStore.get(id) ?? null
    },

    list: async (customerId: string): Promise<PaymentMethod[]> => {
      return Array.from(this.paymentMethodsStore.values()).filter(
        (pm) => pm.customerId === customerId
      )
    },

    delete: async (id: string): Promise<void> => {
      const paymentMethod = this.paymentMethodsStore.get(id)
      if (!paymentMethod) return

      const provider = this.getProvider(paymentMethod.provider)
      await provider.deletePaymentMethod(paymentMethod)

      this.paymentMethodsStore.delete(id)

      // Update default if needed
      if (this.customerDefaultPaymentMethods.get(paymentMethod.customerId) === id) {
        this.customerDefaultPaymentMethods.delete(paymentMethod.customerId)
      }
    },

    setDefault: async (customerId: string, paymentMethodId: string): Promise<void> => {
      const paymentMethod = this.paymentMethodsStore.get(paymentMethodId)
      if (!paymentMethod || paymentMethod.customerId !== customerId) {
        throw new Error('Payment method not found')
      }

      // Clear old default
      const oldDefaultId = this.customerDefaultPaymentMethods.get(customerId)
      if (oldDefaultId) {
        const oldDefault = this.paymentMethodsStore.get(oldDefaultId)
        if (oldDefault) {
          oldDefault.isDefault = false
        }
      }

      // Set new default
      paymentMethod.isDefault = true
      this.customerDefaultPaymentMethods.set(customerId, paymentMethodId)
    },

    getDefault: async (customerId: string): Promise<PaymentMethod | null> => {
      const defaultId = this.customerDefaultPaymentMethods.get(customerId)
      if (!defaultId) return null
      return this.paymentMethodsStore.get(defaultId) ?? null
    },
  }

  // =============================================================================
  // Subscriptions Manager
  // =============================================================================

  subscriptions: SubscriptionsManager = {
    create: async (options: CreateSubscriptionOptions): Promise<Subscription> => {
      const providerName = options.provider ?? this.defaultProviderName
      if (!providerName) {
        throw new Error('No payment provider registered')
      }
      const provider = this.getProvider(providerName)

      const now = new Date()
      const { start, end } = calculateBillingPeriod(options.billingCycle)

      const subscription: Subscription = {
        id: generateId('sub'),
        customerId: options.customerId,
        priceId: options.priceId,
        status: 'active',
        billingCycle: options.billingCycle,
        quantity: options.quantity ?? 1,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        metadata: options.metadata,
        provider: providerName,
        createdAt: now,
        updatedAt: now,
        canceledAt: null,
        pausedAt: null,
      }

      // Handle trial
      if (options.trialDays && options.trialDays > 0) {
        subscription.status = 'trialing'
        subscription.trialStart = now
        subscription.trialEnd = new Date(now.getTime() + options.trialDays * 24 * 60 * 60 * 1000)
      }

      // Call provider
      const result = await provider.createSubscription(subscription, options)
      subscription.providerSubscriptionId = result.providerSubscriptionId

      // Store
      this.subscriptionsStore.set(subscription.id, subscription)

      return subscription
    },

    get: async (id: string): Promise<Subscription | null> => {
      return this.subscriptionsStore.get(id) ?? null
    },

    list: async (customerId: string): Promise<Subscription[]> => {
      return Array.from(this.subscriptionsStore.values()).filter(
        (s) => s.customerId === customerId
      )
    },

    update: async (id: string, options: UpdateSubscriptionOptions): Promise<Subscription> => {
      const subscription = this.subscriptionsStore.get(id)
      if (!subscription) {
        throw new Error('Subscription not found')
      }

      const provider = this.getProvider(subscription.provider)

      // Update fields
      if (options.priceId) {
        subscription.priceId = options.priceId
      }
      if (options.billingCycle) {
        subscription.billingCycle = options.billingCycle
      }
      if (options.quantity !== undefined) {
        subscription.quantity = options.quantity
      }
      if (options.metadata) {
        subscription.metadata = { ...subscription.metadata, ...options.metadata }
      }
      subscription.updatedAt = new Date()

      // Call provider
      await provider.updateSubscription(subscription, options)

      return subscription
    },

    cancel: async (id: string, options?: CancelSubscriptionOptions): Promise<Subscription> => {
      const subscription = this.subscriptionsStore.get(id)
      if (!subscription) {
        throw new Error('Subscription not found')
      }

      const provider = this.getProvider(subscription.provider)

      if (options?.atPeriodEnd) {
        subscription.cancelAtPeriodEnd = true
      } else {
        subscription.status = 'canceled'
        subscription.canceledAt = new Date()
      }
      subscription.updatedAt = new Date()

      // Call provider
      await provider.cancelSubscription(subscription, options ?? {})

      return subscription
    },

    pause: async (id: string): Promise<Subscription> => {
      const subscription = this.subscriptionsStore.get(id)
      if (!subscription) {
        throw new Error('Subscription not found')
      }

      const provider = this.getProvider(subscription.provider)

      subscription.status = 'paused'
      subscription.pausedAt = new Date()
      subscription.updatedAt = new Date()

      // Call provider
      await provider.pauseSubscription(subscription)

      return subscription
    },

    resume: async (id: string): Promise<Subscription> => {
      const subscription = this.subscriptionsStore.get(id)
      if (!subscription) {
        throw new Error('Subscription not found')
      }

      const provider = this.getProvider(subscription.provider)

      subscription.status = 'active'
      subscription.pausedAt = null
      subscription.updatedAt = new Date()

      // Call provider
      await provider.resumeSubscription(subscription)

      return subscription
    },
  }

  // =============================================================================
  // Invoices Manager
  // =============================================================================

  invoices: InvoicesManager = {
    create: async (options: CreateInvoiceOptions): Promise<Invoice> => {
      const providerName = options.provider ?? this.defaultProviderName
      if (!providerName) {
        throw new Error('No payment provider registered')
      }
      const provider = this.getProvider(providerName)

      const now = new Date()

      // Calculate totals
      const lineItems = options.lineItems.map((item) => ({
        ...item,
        id: generateId('li'),
        quantity: item.quantity ?? 1,
      }))

      const subtotal = lineItems.reduce(
        (sum, item) => sum + item.amount * (item.quantity ?? 1),
        0
      )

      let discountAmount = 0
      let discount: InvoiceDiscount | undefined
      if (options.discount) {
        if (options.discount.type === 'percentage') {
          discountAmount = Math.floor(subtotal * (options.discount.value / 100))
        } else {
          discountAmount = options.discount.value
        }
        discount = {
          type: options.discount.type,
          value: options.discount.value,
          amount: discountAmount,
        }
      }

      const total = subtotal - discountAmount

      const invoice: Invoice = {
        id: generateId('inv'),
        customerId: options.customerId,
        currency: options.currency ?? 'USD',
        lineItems,
        subtotal,
        discount,
        total,
        status: 'draft',
        dueDate: options.dueDate,
        notes: options.notes,
        metadata: options.metadata,
        provider: providerName,
        createdAt: now,
        updatedAt: now,
      }

      // Call provider
      const result = await provider.createInvoice(invoice, options)
      invoice.providerInvoiceId = result.providerInvoiceId

      // Store
      this.invoicesStore.set(invoice.id, invoice)

      return invoice
    },

    get: async (id: string): Promise<Invoice | null> => {
      return this.invoicesStore.get(id) ?? null
    },

    list: async (customerId: string): Promise<Invoice[]> => {
      return Array.from(this.invoicesStore.values()).filter((i) => i.customerId === customerId)
    },

    send: async (id: string): Promise<Invoice> => {
      const invoice = this.invoicesStore.get(id)
      if (!invoice) {
        throw new Error('Invoice not found')
      }

      const provider = this.getProvider(invoice.provider)

      invoice.status = 'sent'
      invoice.sentAt = new Date()
      invoice.updatedAt = new Date()

      // Call provider
      await provider.sendInvoice(invoice)

      return invoice
    },

    markPaid: async (id: string, options?: MarkInvoicePaidOptions): Promise<Invoice> => {
      const invoice = this.invoicesStore.get(id)
      if (!invoice) {
        throw new Error('Invoice not found')
      }

      const provider = this.getProvider(invoice.provider)

      invoice.status = 'paid'
      invoice.paidAt = new Date()
      invoice.paymentId = options?.paymentId
      invoice.updatedAt = new Date()

      // Call provider
      await provider.markInvoicePaid(invoice, options ?? {})

      return invoice
    },

    void: async (id: string): Promise<Invoice> => {
      const invoice = this.invoicesStore.get(id)
      if (!invoice) {
        throw new Error('Invoice not found')
      }

      invoice.status = 'void'
      invoice.updatedAt = new Date()

      return invoice
    },

    finalize: async (id: string): Promise<Invoice> => {
      const invoice = this.invoicesStore.get(id)
      if (!invoice) {
        throw new Error('Invoice not found')
      }

      invoice.status = 'open'
      this.invoiceCounter++
      invoice.invoiceNumber = `INV-${String(this.invoiceCounter).padStart(6, '0')}`
      invoice.updatedAt = new Date()

      return invoice
    },
  }

  // =============================================================================
  // Webhook Handling
  // =============================================================================

  onWebhook(event: string, handler: WebhookHandler): void {
    let handlers = this.webhookHandlers.get(event)
    if (!handlers) {
      handlers = []
      this.webhookHandlers.set(event, handlers)
    }
    handlers.push(handler)
  }

  getWebhookHandlers(event: string): WebhookHandler[] {
    return this.webhookHandlers.get(event) ?? []
  }

  async processWebhook(event: WebhookEvent): Promise<void> {
    const handlers = this.webhookHandlers.get(event.type) ?? []
    for (const handler of handlers) {
      await handler(event.data)
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new PaymentProcessor instance
 */
export function createPaymentProcessor(): PaymentProcessor {
  return new PaymentProcessorImpl()
}
