/**
 * @dotdo/finance - Financial client interface
 */

import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  Subscription,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  Invoice,
  CreateInvoiceInput,
  Payment,
  CreatePaymentInput,
  SaaSMetrics,
  MRRBreakdown,
  ListOptions,
  PaginatedList,
  WebhookEvent,
  WebhookEventType,
  WebhookHandler,
  StripeConfig,
} from './types'
import { StripeProvider } from './providers/stripe-provider'

/**
 * Financial client interface for billing and payment operations
 */
export interface FinancialClient {
  // Customer operations
  customers: {
    create(input: CreateCustomerInput): Promise<Customer>
    get(id: string): Promise<Customer | null>
    update(id: string, input: UpdateCustomerInput): Promise<Customer>
    delete(id: string): Promise<void>
    list(options?: ListOptions): Promise<PaginatedList<Customer>>
  }

  // Subscription operations
  subscriptions: {
    create(input: CreateSubscriptionInput): Promise<Subscription>
    get(id: string): Promise<Subscription | null>
    update(id: string, input: UpdateSubscriptionInput): Promise<Subscription>
    cancel(id: string, cancelAtPeriodEnd?: boolean): Promise<Subscription>
    list(options?: ListOptions & { customerId?: string }): Promise<PaginatedList<Subscription>>
  }

  // Invoice operations
  invoices: {
    create(input: CreateInvoiceInput): Promise<Invoice>
    get(id: string): Promise<Invoice | null>
    list(options?: ListOptions & { customerId?: string; subscriptionId?: string }): Promise<PaginatedList<Invoice>>
    pay(id: string): Promise<Invoice>
    finalize(id: string): Promise<Invoice>
    void(id: string): Promise<Invoice>
  }

  // Payment operations
  payments: {
    create(input: CreatePaymentInput): Promise<Payment>
    get(id: string): Promise<Payment | null>
    list(options?: ListOptions & { customerId?: string }): Promise<PaginatedList<Payment>>
    refund(id: string, amount?: number): Promise<Payment>
  }

  // SaaS metrics
  metrics: {
    getMRR(): Promise<number>
    getARR(): Promise<number>
    getSaaSMetrics(): Promise<SaaSMetrics>
    getMRRBreakdown(periodStart: Date, periodEnd: Date): Promise<MRRBreakdown>
  }

  // Webhook handling
  webhooks: {
    handleWebhook(payload: string, signature: string): Promise<WebhookEvent>
    on(eventType: WebhookEventType, handler: WebhookHandler): void
    off(eventType: WebhookEventType, handler: WebhookHandler): void
  }
}

/**
 * Create a Stripe-backed financial client
 */
export function createStripeClient(config: StripeConfig): FinancialClient {
  return new StripeProvider(config)
}
