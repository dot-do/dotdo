/**
 * payments.do - Platform Billing for .do
 *
 * "Payments made simple"
 *
 * Provides:
 *   - Stripe Connect payments via linked accounts
 *   - Platform fee collection
 *   - Usage-based billing and metering
 *   - Subscription management
 *   - Invoice generation
 */

export { PaymentsDO } from './PaymentsDO'
export type { PaymentsEnv, Charge, Subscription, UsageRecord } from './PaymentsDO'
export * as paymentsSchema from './schema'
