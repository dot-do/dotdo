/**
 * payments.do - Database Schema
 *
 * Tables for payment processing:
 *   - charges: One-time payments
 *   - subscriptions: Recurring billing
 *   - usageRecords: Metered usage
 *   - customers: Customer records per connected account
 *   - invoices: Invoice records
 */

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ============================================================================
// CHARGES - One-time payments
// ============================================================================

export const charges = sqliteTable('charges', {
  id: text('id').primaryKey(),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  stripeChargeId: text('stripe_charge_id'),

  // Connected account (from id.org.ai linked accounts)
  connectedAccountId: text('connected_account_id').notNull(),

  // Customer
  customerId: text('customer_id'),

  // Amount
  amount: integer('amount').notNull(), // in cents
  currency: text('currency').notNull().default('usd'),
  platformFee: integer('platform_fee').default(0),

  // Status
  status: text('status', {
    enum: ['pending', 'succeeded', 'failed', 'refunded'],
  }).notNull().default('pending'),

  // Metadata
  description: text('description'),
  metadata: text('metadata', { mode: 'json' }),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('charges_connected_account_idx').on(table.connectedAccountId),
  index('charges_customer_idx').on(table.customerId),
  index('charges_status_idx').on(table.status),
  index('charges_stripe_payment_intent_idx').on(table.stripePaymentIntentId),
  index('charges_created_at_idx').on(table.createdAt),
])

// ============================================================================
// SUBSCRIPTIONS - Recurring billing
// ============================================================================

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),

  // Connected account
  connectedAccountId: text('connected_account_id').notNull(),

  // Customer
  customerId: text('customer_id').notNull(),

  // Plan
  priceId: text('price_id').notNull(),

  // Status
  status: text('status', {
    enum: ['active', 'past_due', 'canceled', 'trialing', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'],
  }).notNull().default('active'),

  // Billing period
  currentPeriodStart: integer('current_period_start', { mode: 'timestamp' }),
  currentPeriodEnd: integer('current_period_end', { mode: 'timestamp' }),
  cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).default(false),

  // Trial
  trialStart: integer('trial_start', { mode: 'timestamp' }),
  trialEnd: integer('trial_end', { mode: 'timestamp' }),

  // Metadata
  metadata: text('metadata', { mode: 'json' }),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  canceledAt: integer('canceled_at', { mode: 'timestamp' }),
}, (table) => [
  index('subscriptions_connected_account_idx').on(table.connectedAccountId),
  index('subscriptions_customer_idx').on(table.customerId),
  index('subscriptions_status_idx').on(table.status),
  index('subscriptions_stripe_id_idx').on(table.stripeSubscriptionId),
])

// ============================================================================
// USAGE RECORDS - Metered billing
// ============================================================================

export const usageRecords = sqliteTable('usage_records', {
  id: text('id').primaryKey(),
  subscriptionItemId: text('subscription_item_id').notNull(),
  connectedAccountId: text('connected_account_id').notNull(),

  // Usage
  quantity: integer('quantity').notNull(),
  action: text('action', {
    enum: ['increment', 'set'],
  }).notNull().default('increment'),

  // Timestamp for the usage
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),

  // Record timestamp
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('usage_records_subscription_item_idx').on(table.subscriptionItemId),
  index('usage_records_connected_account_idx').on(table.connectedAccountId),
  index('usage_records_timestamp_idx').on(table.timestamp),
])

// ============================================================================
// CUSTOMERS - Per connected account
// ============================================================================

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  stripeCustomerId: text('stripe_customer_id').notNull(),

  // Connected account
  connectedAccountId: text('connected_account_id').notNull(),

  // Customer info
  email: text('email').notNull(),
  name: text('name'),

  // Metadata
  metadata: text('metadata', { mode: 'json' }),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('customers_connected_account_idx').on(table.connectedAccountId),
  index('customers_email_idx').on(table.email),
  uniqueIndex('customers_account_email_idx').on(table.connectedAccountId, table.email),
  index('customers_stripe_id_idx').on(table.stripeCustomerId),
])

// ============================================================================
// INVOICES - Invoice records
// ============================================================================

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  stripeInvoiceId: text('stripe_invoice_id').notNull().unique(),

  // Connected account
  connectedAccountId: text('connected_account_id').notNull(),

  // References
  subscriptionId: text('subscription_id'),
  customerId: text('customer_id').notNull(),

  // Amount
  amount: integer('amount').notNull(), // in cents
  currency: text('currency').notNull().default('usd'),

  // Status
  status: text('status', {
    enum: ['draft', 'open', 'paid', 'uncollectible', 'void'],
  }).notNull().default('draft'),

  // Timestamps
  paidAt: integer('paid_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('invoices_connected_account_idx').on(table.connectedAccountId),
  index('invoices_subscription_idx').on(table.subscriptionId),
  index('invoices_customer_idx').on(table.customerId),
  index('invoices_status_idx').on(table.status),
])

// ============================================================================
// PRODUCTS & PRICES (optional - can use Stripe directly)
// ============================================================================

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  stripeProductId: text('stripe_product_id'),

  // Connected account
  connectedAccountId: text('connected_account_id').notNull(),

  // Product info
  name: text('name').notNull(),
  description: text('description'),
  active: integer('active', { mode: 'boolean' }).default(true),

  // Metadata
  metadata: text('metadata', { mode: 'json' }),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('products_connected_account_idx').on(table.connectedAccountId),
  index('products_active_idx').on(table.active),
])

export const prices = sqliteTable('prices', {
  id: text('id').primaryKey(),
  stripePriceId: text('stripe_price_id'),

  // Connected account
  connectedAccountId: text('connected_account_id').notNull(),

  // Product
  productId: text('product_id').notNull(),

  // Pricing
  type: text('type', {
    enum: ['one_time', 'recurring'],
  }).notNull(),
  currency: text('currency').notNull().default('usd'),
  unitAmount: integer('unit_amount'), // in cents

  // Recurring details
  billingScheme: text('billing_scheme', {
    enum: ['per_unit', 'tiered'],
  }),
  recurringInterval: text('recurring_interval', {
    enum: ['day', 'week', 'month', 'year'],
  }),
  recurringIntervalCount: integer('recurring_interval_count'),

  // Metered
  usageType: text('usage_type', {
    enum: ['licensed', 'metered'],
  }),

  // Status
  active: integer('active', { mode: 'boolean' }).default(true),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('prices_connected_account_idx').on(table.connectedAccountId),
  index('prices_product_idx').on(table.productId),
  index('prices_active_idx').on(table.active),
])
