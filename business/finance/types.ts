/**
 * @dotdo/finance - Financial types for SaaS billing and payments
 */

// Core entity types
export interface Customer {
  id: string
  email: string
  name?: string
  metadata?: Record<string, string>
  createdAt: Date
  updatedAt: Date
}

export interface CreateCustomerInput {
  email: string
  name?: string
  metadata?: Record<string, string>
}

export interface UpdateCustomerInput {
  email?: string
  name?: string
  metadata?: Record<string, string>
}

export interface Subscription {
  id: string
  customerId: string
  status: SubscriptionStatus
  priceId: string
  productId: string
  quantity: number
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  canceledAt?: Date
  endedAt?: Date
  trialStart?: Date
  trialEnd?: Date
  metadata?: Record<string, string>
  createdAt: Date
  updatedAt: Date
}

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'paused'

export interface CreateSubscriptionInput {
  customerId: string
  priceId: string
  quantity?: number
  trialPeriodDays?: number
  metadata?: Record<string, string>
}

export interface UpdateSubscriptionInput {
  priceId?: string
  quantity?: number
  cancelAtPeriodEnd?: boolean
  metadata?: Record<string, string>
}

export interface Invoice {
  id: string
  customerId: string
  subscriptionId?: string
  status: InvoiceStatus
  currency: string
  amountDue: number
  amountPaid: number
  amountRemaining: number
  subtotal: number
  tax?: number
  total: number
  hostedInvoiceUrl?: string
  invoicePdf?: string
  dueDate?: Date
  paidAt?: Date
  periodStart?: Date
  periodEnd?: Date
  metadata?: Record<string, string>
  createdAt: Date
}

export type InvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'uncollectible'
  | 'void'

export interface CreateInvoiceInput {
  customerId: string
  autoAdvance?: boolean
  collectionMethod?: 'charge_automatically' | 'send_invoice'
  daysUntilDue?: number
  metadata?: Record<string, string>
}

export interface Payment {
  id: string
  customerId?: string
  invoiceId?: string
  amount: number
  currency: string
  status: PaymentStatus
  paymentMethod?: string
  receiptUrl?: string
  failureMessage?: string
  metadata?: Record<string, string>
  createdAt: Date
}

export type PaymentStatus =
  | 'succeeded'
  | 'pending'
  | 'failed'
  | 'canceled'
  | 'requires_action'
  | 'requires_payment_method'

export interface CreatePaymentInput {
  amount: number
  currency: string
  customerId?: string
  paymentMethod?: string
  confirm?: boolean
  metadata?: Record<string, string>
}

// SaaS Metrics
export interface SaaSMetrics {
  mrr: number
  arr: number
  activeSubscriptions: number
  totalCustomers: number
  churnRate?: number
  averageRevenuePerUser?: number
  lifetimeValue?: number
  netRevenue?: number
  currency: string
  calculatedAt: Date
}

export interface MRRBreakdown {
  total: number
  newBusiness: number
  expansion: number
  contraction: number
  churn: number
  reactivation: number
  currency: string
  periodStart: Date
  periodEnd: Date
}

// List options and pagination
export interface ListOptions {
  limit?: number
  startingAfter?: string
  endingBefore?: string
}

export interface PaginatedList<T> {
  data: T[]
  hasMore: boolean
  totalCount?: number
}

// Webhook types
export interface WebhookEvent {
  id: string
  type: WebhookEventType
  data: unknown
  createdAt: Date
  livemode: boolean
}

export type WebhookEventType =
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.deleted'
  | 'subscription.trial_will_end'
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'invoice.finalized'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded'

export type WebhookHandler = (event: WebhookEvent) => Promise<void> | void

// Provider configuration
export interface StripeConfig {
  apiKey: string
  webhookSecret?: string
}
