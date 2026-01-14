/**
 * Customer Success Role Definition
 *
 * The Customer Success role focuses on ensuring customers achieve their desired
 * outcomes and maximize value from the product. This role is responsible for
 * customer onboarding, retention, and expansion.
 *
 * @see dotdo-z44al - TDD: Customer Success role
 * @module roles/customerSuccess
 */

import { defineRole } from './define'

/**
 * Customer Success role
 *
 * OKRs:
 * - NetRetention: Maintain and grow revenue from existing customers
 * - ExpansionRevenue: Increase revenue through upsells and cross-sells
 * - ChurnPrevention: Reduce customer churn through proactive engagement
 *
 * Capabilities:
 * - onboard: Guide new customers through initial setup and value realization
 * - retain: Engage at-risk customers and address concerns before churn
 * - expand: Identify and execute expansion opportunities
 *
 * @example
 * ```typescript
 * import { customerSuccess } from './roles/customerSuccess'
 *
 * // Onboard a new customer
 * await customerSuccess`onboard ${customer} for enterprise plan`
 *
 * // Identify expansion opportunities
 * await customerSuccess`analyze ${account} for expansion potential`
 *
 * // Proactive retention
 * await customerSuccess`create retention plan for ${atRiskCustomer}`
 * ```
 */
export const customerSuccess = defineRole({
  name: 'customerSuccess',
  okrs: ['NetRetention', 'ExpansionRevenue', 'ChurnPrevention'],
  capabilities: ['onboard', 'retain', 'expand'],
})
