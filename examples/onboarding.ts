/**
 * OnboardingWorkflow Example
 *
 * Demonstrates:
 * - Parallel operations (no Promise.all needed)
 * - Property access on unresolved values (crm.id, billing.portalUrl)
 * - No async/await required
 */

import { Workflow } from '../workflows/workflow'

// Domain types for the example
interface Customer {
  id: string
  email: string
  name: string
  plan: 'free' | 'pro' | 'enterprise'
}

interface CRMAccount {
  id: string
  customerId: string
  createdAt: Date
}

interface BillingSubscription {
  id: string
  portalUrl: string
  trialEnds: Date
}

interface SupportQueue {
  email: string
  ticketPrefix: string
}

interface AnalyticsProfile {
  trackingId: string
  dashboardUrl: string
}

/**
 * Customer Onboarding Workflow
 *
 * This workflow runs when a new customer signs up.
 * All four initial operations execute in PARALLEL automatically.
 */
export const OnboardingWorkflow = Workflow('customer-onboarding', ($, customer: Customer) => {
  // These four operations run in PARALLEL - no await, no Promise.all
  const crm = $.CRM(customer).createAccount()
  const billing = $.Billing(customer).setupSubscription()
  const support = $.Support(customer).createTicketQueue()
  const analytics = $.Analytics(customer).initializeTracking()

  // This operation DEPENDS on the above (uses their properties)
  // Engine automatically sequences this after the parallel operations complete
  $.Email(customer).sendWelcome({
    crmId: crm.id, // Property access on unresolved value
    billingPortal: billing.portalUrl, // Works without await!
    supportEmail: support.email,
    dashboardUrl: analytics.dashboardUrl,
  })

  // Conditional based on plan type
  $.when(customer.plan === 'enterprise', {
    then: () => $.Sales(customer).assignAccountManager(),
    else: () => $.Automation(customer).startDripCampaign(),
  })

  // Return value uses unresolved properties
  return {
    customerId: customer.id,
    crmAccountId: crm.id,
    billingSubscriptionId: billing.id,
    supportEmail: support.email,
    trackingId: analytics.trackingId,
    status: 'onboarded',
  }
})
