import { describe, it, expect } from 'vitest'
import { createWorkflowProxy, collectExpressions, analyzeExpressions, isPipelinePromise } from '../../workflows/pipeline-promise'

describe('OnboardingWorkflow Example', () => {
  it('captures all operations without execution', () => {
    const $ = createWorkflowProxy()

    // Inline the workflow logic for testing
    const customer = { id: 'cust-123', email: 'test@example.com', name: 'Test', plan: 'pro' as const }

    const crm = $.CRM(customer).createAccount()
    const billing = $.Billing(customer).setupSubscription()
    const support = $.Support(customer).createTicketQueue()
    const analytics = $.Analytics(customer).initializeTracking()

    $.Email(customer).sendWelcome({
      crmId: crm.id,
      billingPortal: billing.portalUrl,
      supportEmail: support.email,
      dashboardUrl: analytics.dashboardUrl,
    })

    const result = {
      customerId: customer.id,
      crmAccountId: crm.id,
      status: 'onboarded',
    }

    // Verify PipelinePromises are captured
    expect(isPipelinePromise(result.crmAccountId)).toBe(true)
    expect(result.crmAccountId.__expr.type).toBe('property')
  })

  it('identifies parallel operations', () => {
    const $ = createWorkflowProxy()
    const customer = { id: 'cust-123' }

    const crm = $.CRM(customer).createAccount()
    const billing = $.Billing(customer).setupSubscription()
    const support = $.Support(customer).createTicketQueue()
    const analytics = $.Analytics(customer).initializeTracking()

    const { independent, dependent } = analyzeExpressions([crm, billing, support, analytics])

    // All four should be independent (can run in parallel)
    expect(independent.length).toBe(4)
    expect(dependent.length).toBe(0)
  })

  it('identifies dependent operations', () => {
    const $ = createWorkflowProxy()
    const customer = { id: 'cust-123' }

    const crm = $.CRM(customer).createAccount()
    const email = $.Email(customer).sendWelcome({ crmId: crm.id })

    const { independent, dependent } = analyzeExpressions([crm, email])

    // email depends on crm (uses crm.id)
    expect(independent.length).toBe(1)
    expect(dependent.length).toBe(1)
  })
})
