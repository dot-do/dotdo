/**
 * @dotdo/finance - Financial operations for SaaS billing and payments
 *
 * Provides a unified interface for financial operations with support for
 * multiple payment providers (currently Stripe).
 *
 * @example
 * ```typescript
 * import { createStripeClient } from '@dotdo/finance'
 *
 * const finance = createStripeClient({ apiKey: process.env.STRIPE_SECRET_KEY })
 *
 * // Create a customer
 * const customer = await finance.customers.create({
 *   email: 'alice@example.com',
 *   name: 'Alice Smith',
 * })
 *
 * // Create a subscription
 * const subscription = await finance.subscriptions.create({
 *   customerId: customer.id,
 *   priceId: 'price_xxx',
 * })
 *
 * // Get SaaS metrics
 * const metrics = await finance.metrics.getSaaSMetrics()
 * console.log(`MRR: $${metrics.mrr / 100}`)
 * ```
 */

// Types
export type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  Subscription,
  SubscriptionStatus,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  Invoice,
  InvoiceStatus,
  CreateInvoiceInput,
  Payment,
  PaymentStatus,
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

// Client interface and factory
export type { FinancialClient } from './client'
export { createStripeClient } from './client'

// Providers
export { StripeProvider } from './providers'
