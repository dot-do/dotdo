// SaaS Billing Cycle Example - Type definitions

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled'
  | 'ended'

export interface Subscription {
  $type: 'Subscription'
  customerId: string
  planId: string
  status: SubscriptionStatus
  trialEndsAt?: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelledAt?: string
  cancelAtPeriodEnd: boolean
  cancelReason?: string
}

export interface Plan {
  id: string
  name: string
  price: number // in cents
  interval: 'month' | 'year'
  limits: PlanLimits
  metered?: MeteredPricing
}

export interface PlanLimits {
  apiCalls: number
  storage: number // in GB
  seats: number
}

export interface MeteredPricing {
  apiCalls: number // cost per 1000 calls in cents
  storage: number // cost per GB in cents
}

export interface Usage {
  $type: 'Usage'
  subscriptionId: string
  periodStart: string
  periodEnd: string
  metrics: UsageMetrics
}

export interface UsageMetrics {
  apiCalls: number
  storage: number
  seats: number
}

export interface UsageSummary {
  usage: {
    [metric: string]: {
      used: number
      limit: number
      overage: number
    }
  }
  overageCharges: {
    [metric: string]: number
    total: number
  }
}

export type InvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'uncollectible'
  | 'void'

export interface Invoice {
  $type: 'Invoice'
  subscriptionId: string
  customerId: string
  status: InvoiceStatus
  lineItems: InvoiceLineItem[]
  subtotal: number
  tax: number
  total: number
  periodStart: string
  periodEnd: string
  dueDate: string
  paidAt?: string
  paymentId?: string
}

export interface InvoiceLineItem {
  description: string
  amount: number
  type: 'subscription' | 'usage' | 'credit' | 'proration'
  quantity?: number
  unitPrice?: number
}

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'

export interface Payment {
  $type: 'Payment'
  invoiceId: string
  customerId: string
  amount: number
  status: PaymentStatus
  paymentMethodId?: string
  transactionId?: string
  errorMessage?: string
  attempts: number
  lastAttemptAt?: string
  nextRetryAt?: string
}

export interface PaymentMethod {
  $type: 'PaymentMethod'
  customerId: string
  type: 'card' | 'bank'
  last4: string
  brand?: string
  expiryMonth?: number
  expiryYear?: number
  isDefault: boolean
}

export interface Customer {
  $type: 'Customer'
  email: string
  name: string
  defaultPaymentMethodId?: string
}

// Dunning schedule: days after initial failure to retry
export const DUNNING_SCHEDULE = [3, 7, 14] // 3 days, 7 days, 14 days
