/**
 * Subscription Lifecycle Tests - TDD RED Phase
 *
 * Comprehensive failing tests for subscription management:
 * - Create subscription with plan
 * - Subscription status transitions (active, past_due, canceled)
 * - Plan change (upgrade/downgrade) with proration
 * - Cancel at period end
 * - Cancel immediately with refund
 * - Pause and resume
 * - Trial period handling
 * - Billing cycle anchoring
 * - Dunning and retry logic
 *
 * These tests should FAIL because the implementation doesn't exist yet.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createSubscriptionManager,
  type SubscriptionManager,
  type Subscription,
  type Plan,
  type SubscriptionStatus,
  type BillingCycleAnchor,
  type ProrationBehavior,
  type DunningConfig,
  type PaymentRetrySchedule,
  type SubscriptionItem,
  type UsageRecord,
  type TrialConfig,
  type PauseConfig,
  type CancellationDetails,
  type PlanChangeResult,
  type InvoicePreview,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestManager(): SubscriptionManager {
  return createSubscriptionManager()
}

function createTestPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: `plan_${Date.now()}`,
    name: 'Pro Plan',
    amount: 4999, // $49.99
    currency: 'USD',
    interval: 'month',
    intervalCount: 1,
    active: true,
    metadata: {},
    ...overrides,
  }
}

function createTestCustomer() {
  return {
    id: `cust_${Date.now()}`,
    email: 'test@example.com',
    paymentMethodId: `pm_${Date.now()}`,
  }
}

// =============================================================================
// Subscription Creation Tests
// =============================================================================

describe('SubscriptionManager', () => {
  describe('create subscription with plan', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should create a subscription with a valid plan', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      expect(subscription.id).toBeDefined()
      expect(subscription.customerId).toBe(customer.id)
      expect(subscription.planId).toBe(plan.id)
      expect(subscription.status).toBe('active')
      expect(subscription.currentPeriodStart).toBeInstanceOf(Date)
      expect(subscription.currentPeriodEnd).toBeInstanceOf(Date)
    })

    it('should create a subscription with multiple items', async () => {
      const basePlan = createTestPlan({ id: 'plan_base', amount: 2999 })
      const addonPlan = createTestPlan({ id: 'plan_addon', amount: 999 })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        items: [
          { planId: basePlan.id, quantity: 1 },
          { planId: addonPlan.id, quantity: 3 },
        ],
        paymentMethodId: customer.paymentMethodId,
      })

      expect(subscription.items).toHaveLength(2)
      expect(subscription.items[0].quantity).toBe(1)
      expect(subscription.items[1].quantity).toBe(3)
    })

    it('should calculate correct subscription amount', async () => {
      const plan = createTestPlan({ amount: 4999 })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        quantity: 5,
        paymentMethodId: customer.paymentMethodId,
      })

      expect(subscription.quantity).toBe(5)
      // 4999 * 5 = 24995 cents ($249.95)
      expect(subscription.currentAmount).toBe(24995)
    })

    it('should set default billing cycle anchor to subscription start', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      expect(subscription.billingCycleAnchor).toBeInstanceOf(Date)
      // Should be close to now (within a few seconds)
      expect(subscription.billingCycleAnchor.getTime()).toBeCloseTo(Date.now(), -3)
    })

    it('should support custom billing cycle anchor', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const anchorDate = new Date('2024-01-15T00:00:00Z')

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        billingCycleAnchor: anchorDate,
      })

      expect(subscription.billingCycleAnchor).toEqual(anchorDate)
    })

    it('should validate plan exists', async () => {
      const customer = createTestCustomer()

      await expect(
        manager.create({
          customerId: customer.id,
          planId: 'nonexistent_plan',
          paymentMethodId: customer.paymentMethodId,
        })
      ).rejects.toThrow('Plan not found')
    })

    it('should validate payment method exists', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      await expect(
        manager.create({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: 'invalid_pm',
        })
      ).rejects.toThrow('Invalid payment method')
    })

    it('should store metadata on subscription', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        metadata: { campaign: 'summer_sale', referral: 'user_123' },
      })

      expect(subscription.metadata).toEqual({
        campaign: 'summer_sale',
        referral: 'user_123',
      })
    })
  })

  // =============================================================================
  // Status Transition Tests
  // =============================================================================

  describe('subscription status transitions', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should transition from active to past_due on failed payment', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      expect(subscription.status).toBe('active')

      // Simulate payment failure
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
        failureMessage: 'Your card was declined',
      })

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('past_due')
    })

    it('should transition from past_due to active on successful payment', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      // Put into past_due state
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      // Successful retry
      await manager.handlePaymentSucceeded(subscription.id, {
        paymentId: 'pay_success_456',
        amount: 4999,
      })

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('active')
    })

    it('should transition to canceled after max retry attempts', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          maxRetries: 3,
          retrySchedule: [1, 3, 7], // days
          cancelAfterMaxRetries: true,
        },
      })

      // Exhaust all retries
      for (let i = 0; i <= 3; i++) {
        await manager.handlePaymentFailed(subscription.id, {
          paymentId: `pay_failed_${i}`,
          failureCode: 'card_declined',
        })
      }

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('canceled')
      expect(updated?.cancellationDetails?.reason).toBe('payment_failed')
    })

    it('should transition from trialing to active when trial ends', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      expect(subscription.status).toBe('trialing')

      // Simulate trial end
      await manager.processTrialEnd(subscription.id)

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('active')
    })

    it('should transition from trialing to canceled if payment fails at trial end', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
        trialConfig: {
          endBehavior: 'cancel_if_payment_fails',
        },
      })

      // Simulate trial end with payment failure
      await manager.processTrialEnd(subscription.id, {
        paymentFailed: true,
        failureCode: 'card_declined',
      })

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('canceled')
    })

    it('should track status history', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      const updated = await manager.get(subscription.id)
      expect(updated?.statusHistory).toBeDefined()
      expect(updated?.statusHistory).toHaveLength(2)
      expect(updated?.statusHistory[0].status).toBe('active')
      expect(updated?.statusHistory[1].status).toBe('past_due')
    })

    it('should emit status change events', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const eventHandler = vi.fn()

      manager.on('subscription.status_changed', eventHandler)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          previousStatus: 'active',
          newStatus: 'past_due',
        })
      )
    })
  })

  // =============================================================================
  // Plan Change Tests (Upgrade/Downgrade with Proration)
  // =============================================================================

  describe('plan changes with proration', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should upgrade plan and prorate immediately', async () => {
      const basicPlan = createTestPlan({ id: 'plan_basic', amount: 999, name: 'Basic' })
      const proPlan = createTestPlan({ id: 'plan_pro', amount: 4999, name: 'Pro' })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: proPlan.id,
        prorationBehavior: 'create_prorations',
      })

      expect(result.subscription.planId).toBe(proPlan.id)
      expect(result.prorationItems).toBeDefined()
      expect(result.prorationItems).toHaveLength(2) // credit + debit
      expect(result.amountDue).toBeGreaterThan(0) // upgrade = pay more
    })

    it('should downgrade plan and credit remaining', async () => {
      const proPlan = createTestPlan({ id: 'plan_pro', amount: 4999, name: 'Pro' })
      const basicPlan = createTestPlan({ id: 'plan_basic', amount: 999, name: 'Basic' })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: proPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: basicPlan.id,
        prorationBehavior: 'create_prorations',
      })

      expect(result.subscription.planId).toBe(basicPlan.id)
      expect(result.creditApplied).toBeGreaterThan(0) // downgrade = credit
    })

    it('should change plan at period end without proration', async () => {
      const basicPlan = createTestPlan({ id: 'plan_basic', amount: 999 })
      const proPlan = createTestPlan({ id: 'plan_pro', amount: 4999 })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: proPlan.id,
        prorationBehavior: 'none',
        effectiveDate: 'period_end',
      })

      // Current plan should still be basic
      expect(result.subscription.planId).toBe(basicPlan.id)
      expect(result.subscription.scheduledPlanChange).toEqual({
        planId: proPlan.id,
        effectiveAt: subscription.currentPeriodEnd,
      })
      expect(result.prorationItems).toHaveLength(0)
    })

    it('should calculate proration for partial period', async () => {
      const basicPlan = createTestPlan({ id: 'plan_basic', amount: 3000 }) // $30/month
      const proPlan = createTestPlan({ id: 'plan_pro', amount: 6000 }) // $60/month
      const customer = createTestCustomer()

      // Create subscription that started 15 days ago
      const fifteenDaysAgo = new Date()
      fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
        billingCycleAnchor: fifteenDaysAgo,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: proPlan.id,
        prorationBehavior: 'create_prorations',
      })

      // Should credit ~$15 for unused basic, charge ~$30 for remaining pro
      // Net should be ~$15 charge
      expect(result.prorationItems).toBeDefined()
      const credit = result.prorationItems.find((i) => i.amount < 0)
      const charge = result.prorationItems.find((i) => i.amount > 0)
      expect(credit).toBeDefined()
      expect(charge).toBeDefined()
    })

    it('should preview plan change without applying', async () => {
      const basicPlan = createTestPlan({ id: 'plan_basic', amount: 999 })
      const proPlan = createTestPlan({ id: 'plan_pro', amount: 4999 })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const preview = await manager.previewPlanChange(subscription.id, {
        newPlanId: proPlan.id,
        prorationBehavior: 'create_prorations',
      })

      expect(preview.currentPlanId).toBe(basicPlan.id)
      expect(preview.newPlanId).toBe(proPlan.id)
      expect(preview.prorationItems).toBeDefined()
      expect(preview.amountDue).toBeDefined()

      // Verify subscription not changed
      const unchanged = await manager.get(subscription.id)
      expect(unchanged?.planId).toBe(basicPlan.id)
    })

    it('should handle quantity changes with proration', async () => {
      const plan = createTestPlan({ amount: 1000 }) // $10/seat/month
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        quantity: 5,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.updateQuantity(subscription.id, {
        quantity: 10,
        prorationBehavior: 'create_prorations',
      })

      expect(result.subscription.quantity).toBe(10)
      expect(result.prorationItems).toBeDefined()
      expect(result.amountDue).toBeGreaterThan(0) // more seats = more money
    })

    it('should apply proration behavior: always_invoice', async () => {
      const basicPlan = createTestPlan({ id: 'plan_basic', amount: 999 })
      const proPlan = createTestPlan({ id: 'plan_pro', amount: 4999 })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: proPlan.id,
        prorationBehavior: 'always_invoice',
      })

      expect(result.invoiceId).toBeDefined()
      expect(result.invoiceStatus).toBe('paid')
    })
  })

  // =============================================================================
  // Cancellation Tests
  // =============================================================================

  describe('cancel at period end', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should schedule cancellation at period end', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const canceled = await manager.cancel(subscription.id, {
        atPeriodEnd: true,
      })

      expect(canceled.status).toBe('active') // Still active until period end
      expect(canceled.cancelAtPeriodEnd).toBe(true)
      expect(canceled.cancelAt).toEqual(subscription.currentPeriodEnd)
    })

    it('should allow continuing access until period end', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.cancel(subscription.id, { atPeriodEnd: true })

      const access = await manager.checkAccess(subscription.id)
      expect(access.hasAccess).toBe(true)
      expect(access.expiresAt).toEqual(subscription.currentPeriodEnd)
    })

    it('should actually cancel when period ends', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.cancel(subscription.id, { atPeriodEnd: true })

      // Simulate period end processing
      await manager.processPeriodEnd(subscription.id)

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('canceled')
      expect(updated?.canceledAt).toBeInstanceOf(Date)
    })

    it('should allow reactivation before period end', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.cancel(subscription.id, { atPeriodEnd: true })
      const reactivated = await manager.reactivate(subscription.id)

      expect(reactivated.status).toBe('active')
      expect(reactivated.cancelAtPeriodEnd).toBe(false)
      expect(reactivated.cancelAt).toBeNull()
    })

    it('should store cancellation reason', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.cancel(subscription.id, {
        atPeriodEnd: true,
        reason: 'too_expensive',
        feedback: 'The pricing is out of my budget',
      })

      const updated = await manager.get(subscription.id)
      expect(updated?.cancellationDetails?.reason).toBe('too_expensive')
      expect(updated?.cancellationDetails?.feedback).toBe('The pricing is out of my budget')
    })
  })

  describe('cancel immediately with refund', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should cancel immediately', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const canceled = await manager.cancel(subscription.id, {
        atPeriodEnd: false,
      })

      expect(canceled.status).toBe('canceled')
      expect(canceled.canceledAt).toBeInstanceOf(Date)
      expect(canceled.cancelAtPeriodEnd).toBe(false)
    })

    it('should issue prorated refund on immediate cancel', async () => {
      const plan = createTestPlan({ amount: 3000 }) // $30/month
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const canceled = await manager.cancel(subscription.id, {
        atPeriodEnd: false,
        refund: 'prorate',
      })

      expect(canceled.refundAmount).toBeGreaterThan(0)
      expect(canceled.refundAmount).toBeLessThanOrEqual(3000)
    })

    it('should issue full refund when requested', async () => {
      const plan = createTestPlan({ amount: 3000 })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const canceled = await manager.cancel(subscription.id, {
        atPeriodEnd: false,
        refund: 'full',
      })

      expect(canceled.refundAmount).toBe(3000)
    })

    it('should not refund when refund: none', async () => {
      const plan = createTestPlan({ amount: 3000 })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const canceled = await manager.cancel(subscription.id, {
        atPeriodEnd: false,
        refund: 'none',
      })

      expect(canceled.refundAmount).toBe(0)
    })

    it('should create refund record', async () => {
      const plan = createTestPlan({ amount: 3000 })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const canceled = await manager.cancel(subscription.id, {
        atPeriodEnd: false,
        refund: 'prorate',
      })

      expect(canceled.refundId).toBeDefined()
      const refund = await manager.getRefund(canceled.refundId!)
      expect(refund).toBeDefined()
      expect(refund?.subscriptionId).toBe(subscription.id)
    })

    it('should revoke access immediately', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.cancel(subscription.id, { atPeriodEnd: false })

      const access = await manager.checkAccess(subscription.id)
      expect(access.hasAccess).toBe(false)
    })
  })

  // =============================================================================
  // Pause and Resume Tests
  // =============================================================================

  describe('pause and resume', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should pause a subscription', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const paused = await manager.pause(subscription.id)

      expect(paused.status).toBe('paused')
      expect(paused.pausedAt).toBeInstanceOf(Date)
    })

    it('should pause with specific resume date', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const resumeDate = new Date()
      resumeDate.setDate(resumeDate.getDate() + 30)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const paused = await manager.pause(subscription.id, {
        resumeAt: resumeDate,
      })

      expect(paused.resumeAt).toEqual(resumeDate)
    })

    it('should pause for specific duration', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const paused = await manager.pause(subscription.id, {
        pauseDays: 30,
      })

      const expectedResume = new Date()
      expectedResume.setDate(expectedResume.getDate() + 30)
      expect(paused.resumeAt?.getDate()).toBe(expectedResume.getDate())
    })

    it('should enforce maximum pause duration', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        pauseConfig: {
          maxPauseDays: 90,
        },
      })

      await expect(
        manager.pause(subscription.id, {
          pauseDays: 120,
        })
      ).rejects.toThrow('Pause duration exceeds maximum')
    })

    it('should limit number of pauses per period', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        pauseConfig: {
          maxPausesPerYear: 2,
        },
      })

      // First pause
      await manager.pause(subscription.id, { pauseDays: 7 })
      await manager.resume(subscription.id)

      // Second pause
      await manager.pause(subscription.id, { pauseDays: 7 })
      await manager.resume(subscription.id)

      // Third pause should fail
      await expect(manager.pause(subscription.id)).rejects.toThrow(
        'Maximum pauses exceeded for this period'
      )
    })

    it('should resume a paused subscription', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.pause(subscription.id)
      const resumed = await manager.resume(subscription.id)

      expect(resumed.status).toBe('active')
      expect(resumed.pausedAt).toBeNull()
      expect(resumed.resumeAt).toBeNull()
    })

    it('should extend billing cycle after pause', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const originalPeriodEnd = subscription.currentPeriodEnd

      await manager.pause(subscription.id, { pauseDays: 10 })
      await manager.resume(subscription.id)

      const resumed = await manager.get(subscription.id)
      // Period end should be extended by pause duration
      const expectedExtension = 10 * 24 * 60 * 60 * 1000
      expect(resumed?.currentPeriodEnd?.getTime()).toBeCloseTo(
        originalPeriodEnd!.getTime() + expectedExtension,
        -3
      )
    })

    it('should not charge during pause', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.pause(subscription.id)

      // Simulate billing attempt
      const billingResult = await manager.attemptBilling(subscription.id)

      expect(billingResult.skipped).toBe(true)
      expect(billingResult.reason).toBe('subscription_paused')
    })

    it('should revoke access during pause', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.pause(subscription.id)

      const access = await manager.checkAccess(subscription.id)
      expect(access.hasAccess).toBe(false)
      expect(access.reason).toBe('paused')
    })

    it('should auto-resume when resume date is reached', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const resumeDate = new Date()
      resumeDate.setDate(resumeDate.getDate() + 7)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.pause(subscription.id, { resumeAt: resumeDate })

      // Simulate time passing and scheduler running
      await manager.processScheduledResumes(resumeDate)

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('active')
    })
  })

  // =============================================================================
  // Trial Period Tests
  // =============================================================================

  describe('trial period handling', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should create subscription with trial period', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      expect(subscription.status).toBe('trialing')
      expect(subscription.trialStart).toBeInstanceOf(Date)
      expect(subscription.trialEnd).toBeInstanceOf(Date)

      const trialDuration = subscription.trialEnd!.getTime() - subscription.trialStart!.getTime()
      expect(trialDuration).toBeCloseTo(14 * 24 * 60 * 60 * 1000, -3)
    })

    it('should set specific trial end date', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const trialEndDate = new Date('2024-02-01T00:00:00Z')

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialEnd: trialEndDate,
      })

      expect(subscription.trialEnd).toEqual(trialEndDate)
    })

    it('should not charge during trial', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      const billingResult = await manager.attemptBilling(subscription.id)

      expect(billingResult.skipped).toBe(true)
      expect(billingResult.reason).toBe('in_trial')
    })

    it('should allow access during trial', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      const access = await manager.checkAccess(subscription.id)
      expect(access.hasAccess).toBe(true)
      expect(access.inTrial).toBe(true)
    })

    it('should convert to paid at trial end', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      // Process trial end
      await manager.processTrialEnd(subscription.id)

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('active')
      expect(updated?.currentPeriodStart).toEqual(subscription.trialEnd)
    })

    it('should extend trial period', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      const originalTrialEnd = subscription.trialEnd

      const extended = await manager.extendTrial(subscription.id, { additionalDays: 7 })

      const expectedTrialEnd = new Date(originalTrialEnd!.getTime() + 7 * 24 * 60 * 60 * 1000)
      expect(extended.trialEnd).toEqual(expectedTrialEnd)
    })

    it('should end trial early', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      const ended = await manager.endTrialEarly(subscription.id)

      expect(ended.status).toBe('active')
      expect(ended.trialEnd).toBeInstanceOf(Date)
      expect(ended.trialEnd!.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('should require payment method before trial ends', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        // No payment method
        trialDays: 14,
        trialConfig: {
          requirePaymentMethod: false,
        },
      })

      expect(subscription.status).toBe('trialing')

      // Try to convert to paid without payment method
      await expect(manager.processTrialEnd(subscription.id)).rejects.toThrow(
        'Payment method required'
      )
    })

    it('should handle trial without payment method upfront', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        trialDays: 14,
        trialConfig: {
          requirePaymentMethod: false,
        },
      })

      expect(subscription.status).toBe('trialing')
      expect(subscription.paymentMethodId).toBeUndefined()
    })

    it('should support free trial without future billing', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        trialDays: 30,
        trialConfig: {
          convertToPaid: false,
        },
      })

      // Process trial end
      await manager.processTrialEnd(subscription.id)

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('canceled') // Ends after trial
    })
  })

  // =============================================================================
  // Billing Cycle Anchoring Tests
  // =============================================================================

  describe('billing cycle anchoring', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should anchor billing to specific day of month', async () => {
      const plan = createTestPlan({ interval: 'month' })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        billingCycleAnchor: new Date('2024-01-15'), // 15th of month
      })

      expect(subscription.currentPeriodEnd?.getDate()).toBe(15)
    })

    it('should handle anchor on 31st for short months', async () => {
      const plan = createTestPlan({ interval: 'month' })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        billingCycleAnchor: new Date('2024-01-31'),
      })

      // In February, should anchor to last day (28/29)
      await manager.renewSubscription(subscription.id)

      const renewed = await manager.get(subscription.id)
      // February period should end on 28/29
      expect(renewed?.currentPeriodEnd?.getMonth()).toBe(1) // February
      expect(renewed?.currentPeriodEnd?.getDate()).toBeLessThanOrEqual(29)
    })

    it('should align to natural month boundaries', async () => {
      const plan = createTestPlan({ interval: 'month' })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        billingCycleAnchor: new Date('2024-01-01'),
      })

      expect(subscription.currentPeriodStart?.getDate()).toBe(1)
      expect(subscription.currentPeriodEnd?.getDate()).toBe(1)
      expect(subscription.currentPeriodEnd?.getMonth()).toBe(subscription.currentPeriodStart!.getMonth() + 1)
    })

    it('should support yearly billing anchoring', async () => {
      const plan = createTestPlan({ interval: 'year' })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        billingCycleAnchor: new Date('2024-03-15'),
      })

      const periodEnd = subscription.currentPeriodEnd!
      expect(periodEnd.getFullYear()).toBe(2025)
      expect(periodEnd.getMonth()).toBe(2) // March
      expect(periodEnd.getDate()).toBe(15)
    })

    it('should prorate first period when anchor differs from start', async () => {
      const plan = createTestPlan({ amount: 3000, interval: 'month' })
      const customer = createTestCustomer()
      const now = new Date('2024-01-10')

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        startDate: now,
        billingCycleAnchor: new Date('2024-01-01'), // Anchor to 1st
        prorateBillingCycleAnchor: true,
      })

      // First invoice should be prorated for ~21 days (Jan 10 - Feb 1)
      const firstInvoice = await manager.getLatestInvoice(subscription.id)
      expect(firstInvoice?.amount).toBeLessThan(3000)
    })

    it('should maintain anchor across renewals', async () => {
      const plan = createTestPlan({ interval: 'month' })
      const customer = createTestCustomer()
      const anchorDate = new Date('2024-01-15')

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        billingCycleAnchor: anchorDate,
      })

      // Renew multiple times
      await manager.renewSubscription(subscription.id)
      await manager.renewSubscription(subscription.id)
      await manager.renewSubscription(subscription.id)

      const renewed = await manager.get(subscription.id)
      expect(renewed?.currentPeriodEnd?.getDate()).toBe(15)
    })

    it('should update billing anchor', async () => {
      const plan = createTestPlan({ interval: 'month' })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        billingCycleAnchor: new Date('2024-01-01'),
      })

      const updated = await manager.updateBillingAnchor(subscription.id, {
        newAnchor: new Date('2024-01-15'),
        prorationBehavior: 'create_prorations',
      })

      expect(updated.billingCycleAnchor?.getDate()).toBe(15)
    })
  })

  // =============================================================================
  // Dunning and Retry Logic Tests
  // =============================================================================

  describe('dunning and retry logic', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should configure custom retry schedule', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          retrySchedule: [1, 3, 5, 7], // retry on days 1, 3, 5, 7
          maxRetries: 4,
        },
      })

      expect(subscription.dunningConfig?.retrySchedule).toEqual([1, 3, 5, 7])
      expect(subscription.dunningConfig?.maxRetries).toBe(4)
    })

    it('should schedule first retry after initial failure', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          retrySchedule: [1, 3, 7],
        },
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      const updated = await manager.get(subscription.id)
      expect(updated?.nextRetryAt).toBeInstanceOf(Date)
      // Should be ~1 day from now
      const expectedRetry = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000)
      expect(updated?.nextRetryAt?.getDate()).toBe(expectedRetry.getDate())
    })

    it('should increment retry count on each failure', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          retrySchedule: [1, 3, 7],
          maxRetries: 3,
        },
      })

      // First failure
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_1',
        failureCode: 'card_declined',
      })

      let updated = await manager.get(subscription.id)
      expect(updated?.retryCount).toBe(1)

      // Second failure
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_2',
        failureCode: 'card_declined',
      })

      updated = await manager.get(subscription.id)
      expect(updated?.retryCount).toBe(2)
    })

    it('should send dunning emails at each retry', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const emailHandler = vi.fn()

      manager.on('dunning.email_sent', emailHandler)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          retrySchedule: [1, 3, 7],
          sendDunningEmails: true,
        },
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      expect(emailHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          customerId: customer.id,
          emailType: 'payment_failed',
          retryNumber: 1,
        })
      )
    })

    it('should use smart retry based on failure code', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          smartRetry: true,
        },
      })

      // Insufficient funds - should retry sooner
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_1',
        failureCode: 'insufficient_funds',
      })

      let updated = await manager.get(subscription.id)
      const insufficientFundsRetry = updated?.nextRetryAt

      // Reset
      await manager.handlePaymentSucceeded(subscription.id, {
        paymentId: 'pay_success',
        amount: 4999,
      })

      // Card declined - might have different retry timing
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_2',
        failureCode: 'do_not_honor',
      })

      updated = await manager.get(subscription.id)
      const doNotHonorRetry = updated?.nextRetryAt

      // Different failure codes may have different retry strategies
      expect(insufficientFundsRetry).toBeDefined()
      expect(doNotHonorRetry).toBeDefined()
    })

    it('should cancel subscription after max retries', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          retrySchedule: [1, 3],
          maxRetries: 2,
          cancelAfterMaxRetries: true,
        },
      })

      // Exhaust all retries
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_1',
        failureCode: 'card_declined',
      })
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_2',
        failureCode: 'card_declined',
      })
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_3',
        failureCode: 'card_declined',
      })

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('canceled')
      expect(updated?.cancellationDetails?.reason).toBe('payment_failed')
    })

    it('should mark as unpaid instead of canceling', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          retrySchedule: [1, 3],
          maxRetries: 2,
          cancelAfterMaxRetries: false,
          markUnpaidAfterMaxRetries: true,
        },
      })

      // Exhaust all retries
      for (let i = 0; i <= 2; i++) {
        await manager.handlePaymentFailed(subscription.id, {
          paymentId: `pay_${i}`,
          failureCode: 'card_declined',
        })
      }

      const updated = await manager.get(subscription.id)
      expect(updated?.status).toBe('unpaid')
    })

    it('should reset retry count on successful payment', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          retrySchedule: [1, 3, 7],
        },
      })

      // Some failures
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_1',
        failureCode: 'card_declined',
      })
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_2',
        failureCode: 'card_declined',
      })

      let updated = await manager.get(subscription.id)
      expect(updated?.retryCount).toBe(2)

      // Success!
      await manager.handlePaymentSucceeded(subscription.id, {
        paymentId: 'pay_success',
        amount: 4999,
      })

      updated = await manager.get(subscription.id)
      expect(updated?.retryCount).toBe(0)
      expect(updated?.nextRetryAt).toBeNull()
    })

    it('should process scheduled retries', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const paymentHandler = vi.fn().mockResolvedValue({ success: false })

      manager.on('payment.retry', paymentHandler)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          retrySchedule: [1],
        },
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_1',
        failureCode: 'card_declined',
      })

      // Simulate scheduler running
      const retryDate = new Date()
      retryDate.setDate(retryDate.getDate() + 1)

      await manager.processScheduledRetries(retryDate)

      expect(paymentHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
        })
      )
    })

    it('should track dunning history', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          retrySchedule: [1, 3, 7],
        },
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_1',
        failureCode: 'card_declined',
        failureMessage: 'Card declined',
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_2',
        failureCode: 'insufficient_funds',
        failureMessage: 'Insufficient funds',
      })

      const dunningHistory = await manager.getDunningHistory(subscription.id)

      expect(dunningHistory).toHaveLength(2)
      expect(dunningHistory[0].failureCode).toBe('card_declined')
      expect(dunningHistory[1].failureCode).toBe('insufficient_funds')
    })
  })

  // =============================================================================
  // Usage-Based Billing Tests
  // =============================================================================

  describe('usage-based billing', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should track usage for metered subscription', async () => {
      const meteredPlan = createTestPlan({
        id: 'plan_metered',
        billingScheme: 'metered',
        usageType: 'metered',
      })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: meteredPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.recordUsage(subscription.id, {
        quantity: 100,
        timestamp: new Date(),
        action: 'increment',
      })

      const usage = await manager.getUsage(subscription.id)
      expect(usage.totalQuantity).toBe(100)
    })

    it('should aggregate usage for billing period', async () => {
      const meteredPlan = createTestPlan({
        billingScheme: 'metered',
        usageType: 'metered',
        unitAmount: 10, // $0.10 per unit
      })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: meteredPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.recordUsage(subscription.id, { quantity: 50 })
      await manager.recordUsage(subscription.id, { quantity: 75 })
      await manager.recordUsage(subscription.id, { quantity: 25 })

      const usage = await manager.getUsage(subscription.id)
      expect(usage.totalQuantity).toBe(150)
      expect(usage.estimatedAmount).toBe(1500) // 150 * $0.10 = $15.00
    })

    it('should bill for usage at period end', async () => {
      const meteredPlan = createTestPlan({
        billingScheme: 'metered',
        unitAmount: 10,
      })
      const customer = createTestCustomer()

      const subscription = await manager.create({
        customerId: customer.id,
        planId: meteredPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.recordUsage(subscription.id, { quantity: 100 })

      // Process billing
      const invoice = await manager.billUsage(subscription.id)

      expect(invoice.amount).toBe(1000) // 100 * $0.10
      expect(invoice.lineItems).toContainEqual(
        expect.objectContaining({
          type: 'usage',
          quantity: 100,
        })
      )
    })
  })

  // =============================================================================
  // Webhook and Event Tests
  // =============================================================================

  describe('subscription events', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should emit subscription.created event', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const eventHandler = vi.fn()

      manager.on('subscription.created', eventHandler)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          customerId: customer.id,
        })
      )
    })

    it('should emit subscription.updated event', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const eventHandler = vi.fn()

      manager.on('subscription.updated', eventHandler)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.update(subscription.id, { metadata: { updated: true } })

      expect(eventHandler).toHaveBeenCalled()
    })

    it('should emit subscription.canceled event', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const eventHandler = vi.fn()

      manager.on('subscription.canceled', eventHandler)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.cancel(subscription.id, { atPeriodEnd: false })

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          cancellationType: 'immediate',
        })
      )
    })

    it('should emit subscription.trial_ending event', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const eventHandler = vi.fn()

      manager.on('subscription.trial_ending', eventHandler)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      // Simulate trial ending notification (typically 3 days before)
      await manager.checkTrialEnding(subscription.id, { warningDays: 3 })

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          trialEndsAt: subscription.trialEnd,
        })
      )
    })

    it('should emit subscription.renewed event', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const eventHandler = vi.fn()

      manager.on('subscription.renewed', eventHandler)

      const subscription = await manager.create({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.renewSubscription(subscription.id)

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          previousPeriodEnd: expect.any(Date),
          newPeriodEnd: expect.any(Date),
        })
      )
    })
  })
})
