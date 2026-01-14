/**
 * Subscription Lifecycle Tests - TDD RED Phase
 *
 * Focused failing tests for subscription lifecycle management:
 * 1. Create subscription with plan
 * 2. Update subscription (plan change)
 * 3. Proration calculation
 * 4. Cancel subscription (immediate, end-of-period)
 * 5. Trial periods (start, convert, expire)
 * 6. Grace periods for failed payments
 * 7. Subscription status transitions
 *
 * These tests define the expected API for a SubscriptionManager that wraps
 * the underlying SubscriptionEngine with a more user-friendly interface.
 *
 * @module db/primitives/payments/tests/subscription
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createSubscriptionManager,
  type SubscriptionManager,
  type Subscription,
  type Plan,
  type SubscriptionStatus,
  type ProrationBehavior,
  type TrialConfig,
  type GracePeriodConfig,
  type CancellationOptions,
  type PlanChangeResult,
  type ProrationItem,
  type SubscriptionEvent,
  type AccessCheckResult,
} from '../index'

// =============================================================================
// Test Utilities
// =============================================================================

function createTestPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: `plan_${Math.random().toString(36).slice(2)}`,
    name: 'Pro Plan',
    amount: 4999, // $49.99
    currency: 'USD',
    interval: 'month',
    intervalCount: 1,
    active: true,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createTestCustomer() {
  return {
    id: `cust_${Math.random().toString(36).slice(2)}`,
    email: 'customer@example.com',
    name: 'Test Customer',
    paymentMethodId: `pm_${Math.random().toString(36).slice(2)}`,
  }
}

// =============================================================================
// 1. Create Subscription with Plan
// =============================================================================

describe('Subscription Lifecycle', () => {
  describe('1. Create Subscription with Plan', () => {
    let manager: SubscriptionManager

    beforeEach(() => {
      manager = createSubscriptionManager()
    })

    it('should create a basic subscription', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      // Register the plan first
      await manager.registerPlan(plan)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      expect(subscription).toBeDefined()
      expect(subscription.id).toMatch(/^sub_/)
      expect(subscription.customerId).toBe(customer.id)
      expect(subscription.planId).toBe(plan.id)
      expect(subscription.status).toBe('active')
    })

    it('should set correct billing period dates', async () => {
      const plan = createTestPlan({ interval: 'month' })
      const customer = createTestCustomer()

      await manager.registerPlan(plan)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      expect(subscription.currentPeriodStart).toBeInstanceOf(Date)
      expect(subscription.currentPeriodEnd).toBeInstanceOf(Date)

      // Period should be approximately one month
      const periodMs = subscription.currentPeriodEnd!.getTime() - subscription.currentPeriodStart!.getTime()
      const daysInPeriod = periodMs / (1000 * 60 * 60 * 24)
      expect(daysInPeriod).toBeGreaterThanOrEqual(28)
      expect(daysInPeriod).toBeLessThanOrEqual(31)
    })

    it('should create subscription with specified quantity', async () => {
      const plan = createTestPlan({ amount: 1000 }) // $10 per seat
      const customer = createTestCustomer()

      await manager.registerPlan(plan)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        quantity: 5,
      })

      expect(subscription.quantity).toBe(5)
      expect(subscription.totalAmount).toBe(5000) // 5 * $10
    })

    it('should reject subscription for non-existent plan', async () => {
      const customer = createTestCustomer()

      await expect(
        manager.createSubscription({
          customerId: customer.id,
          planId: 'plan_nonexistent',
          paymentMethodId: customer.paymentMethodId,
        })
      ).rejects.toThrow('Plan not found')
    })

    it('should reject subscription without payment method', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      await manager.registerPlan(plan)

      await expect(
        manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          // No payment method
        })
      ).rejects.toThrow('Payment method required')
    })

    it('should store custom metadata', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()

      await manager.registerPlan(plan)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        metadata: {
          source: 'web_signup',
          campaign: 'summer_2024',
        },
      })

      expect(subscription.metadata).toEqual({
        source: 'web_signup',
        campaign: 'summer_2024',
      })
    })

    it('should create subscription starting on a future date', async () => {
      const plan = createTestPlan()
      const customer = createTestCustomer()
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 7)

      await manager.registerPlan(plan)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        startDate: futureDate,
      })

      expect(subscription.status).toBe('scheduled')
      expect(subscription.startDate).toEqual(futureDate)
    })
  })

  // =============================================================================
  // 2. Update Subscription (Plan Change)
  // =============================================================================

  describe('2. Update Subscription (Plan Change)', () => {
    let manager: SubscriptionManager
    let basicPlan: Plan
    let proPlan: Plan
    let customer: ReturnType<typeof createTestCustomer>

    beforeEach(async () => {
      manager = createSubscriptionManager()
      basicPlan = createTestPlan({ id: 'plan_basic', name: 'Basic', amount: 999 })
      proPlan = createTestPlan({ id: 'plan_pro', name: 'Pro', amount: 4999 })
      customer = createTestCustomer()

      await manager.registerPlan(basicPlan)
      await manager.registerPlan(proPlan)
    })

    it('should upgrade plan immediately', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: proPlan.id,
        effective: 'immediately',
      })

      expect(result.subscription.planId).toBe(proPlan.id)
      expect(result.effectiveDate).toBeInstanceOf(Date)
      expect(result.effectiveDate!.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('should downgrade plan at period end', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: proPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: basicPlan.id,
        effective: 'period_end',
      })

      // Current plan should still be Pro
      expect(result.subscription.planId).toBe(proPlan.id)
      expect(result.subscription.scheduledChange).toEqual({
        planId: basicPlan.id,
        effectiveAt: subscription.currentPeriodEnd,
      })
    })

    it('should update subscription quantity', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
        quantity: 5,
      })

      const updated = await manager.updateQuantity(subscription.id, {
        quantity: 10,
      })

      expect(updated.subscription.quantity).toBe(10)
    })

    it('should cancel scheduled plan change', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: proPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.changePlan(subscription.id, {
        newPlanId: basicPlan.id,
        effective: 'period_end',
      })

      const result = await manager.cancelScheduledChange(subscription.id)

      expect(result.subscription.scheduledChange).toBeNull()
      expect(result.subscription.planId).toBe(proPlan.id)
    })

    it('should reject change for canceled subscription', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.cancelSubscription(subscription.id, { immediate: true })

      await expect(
        manager.changePlan(subscription.id, { newPlanId: proPlan.id })
      ).rejects.toThrow('Cannot modify canceled subscription')
    })
  })

  // =============================================================================
  // 3. Proration Calculation
  // =============================================================================

  describe('3. Proration Calculation', () => {
    let manager: SubscriptionManager
    let basicPlan: Plan
    let proPlan: Plan
    let customer: ReturnType<typeof createTestCustomer>

    beforeEach(async () => {
      manager = createSubscriptionManager()
      basicPlan = createTestPlan({ id: 'plan_basic', name: 'Basic', amount: 3000 }) // $30/month
      proPlan = createTestPlan({ id: 'plan_pro', name: 'Pro', amount: 6000 }) // $60/month
      customer = createTestCustomer()

      await manager.registerPlan(basicPlan)
      await manager.registerPlan(proPlan)
    })

    it('should calculate proration on upgrade', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: proPlan.id,
        prorationBehavior: 'create_prorations',
      })

      expect(result.prorationItems).toBeDefined()
      expect(result.prorationItems!.length).toBeGreaterThan(0)

      // Should have a credit for unused Basic time
      const credit = result.prorationItems!.find((i) => i.type === 'credit')
      expect(credit).toBeDefined()
      expect(credit!.amount).toBeGreaterThan(0)

      // Should have a charge for Pro time remaining
      const charge = result.prorationItems!.find((i) => i.type === 'charge')
      expect(charge).toBeDefined()
      expect(charge!.amount).toBeGreaterThan(0)
    })

    it('should calculate proration on downgrade', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: proPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: basicPlan.id,
        prorationBehavior: 'create_prorations',
      })

      // Net should be a credit (downgrade = less money)
      const netAmount = result.prorationItems!.reduce((sum, item) => {
        return sum + (item.type === 'credit' ? -item.amount : item.amount)
      }, 0)

      expect(netAmount).toBeLessThan(0) // Net credit
    })

    it('should calculate proration on quantity increase', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
        quantity: 5,
      })

      const result = await manager.updateQuantity(subscription.id, {
        quantity: 10,
        prorationBehavior: 'create_prorations',
      })

      expect(result.prorationItems).toBeDefined()

      // Should charge for 5 additional seats prorated
      const charge = result.prorationItems!.find((i) => i.type === 'charge')
      expect(charge).toBeDefined()
      expect(charge!.description).toContain('5 seats')
    })

    it('should preview proration without applying', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const preview = await manager.previewPlanChange(subscription.id, {
        newPlanId: proPlan.id,
        prorationBehavior: 'create_prorations',
      })

      expect(preview.prorationItems).toBeDefined()
      expect(preview.totalDue).toBeDefined()

      // Verify subscription wasn't actually changed
      const unchanged = await manager.getSubscription(subscription.id)
      expect(unchanged!.planId).toBe(basicPlan.id)
    })

    it('should skip proration when behavior is none', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: proPlan.id,
        prorationBehavior: 'none',
      })

      expect(result.prorationItems).toEqual([])
    })

    it('should immediately invoice prorations when behavior is always_invoice', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: basicPlan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const result = await manager.changePlan(subscription.id, {
        newPlanId: proPlan.id,
        prorationBehavior: 'always_invoice',
      })

      expect(result.invoice).toBeDefined()
      expect(result.invoice!.status).toBe('paid')
    })
  })

  // =============================================================================
  // 4. Cancel Subscription (Immediate and End-of-Period)
  // =============================================================================

  describe('4. Cancel Subscription', () => {
    let manager: SubscriptionManager
    let plan: Plan
    let customer: ReturnType<typeof createTestCustomer>

    beforeEach(async () => {
      manager = createSubscriptionManager()
      plan = createTestPlan({ amount: 3000 })
      customer = createTestCustomer()

      await manager.registerPlan(plan)
    })

    describe('Cancel at Period End', () => {
      it('should schedule cancellation at period end', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
        })

        const canceled = await manager.cancelSubscription(subscription.id, {
          immediate: false,
        })

        expect(canceled.status).toBe('active') // Still active
        expect(canceled.cancelAtPeriodEnd).toBe(true)
        expect(canceled.cancelAt).toEqual(subscription.currentPeriodEnd)
      })

      it('should continue access until period end', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
        })

        await manager.cancelSubscription(subscription.id, { immediate: false })

        const access = await manager.checkAccess(subscription.id)
        expect(access.hasAccess).toBe(true)
        expect(access.accessUntil).toEqual(subscription.currentPeriodEnd)
      })

      it('should allow reactivation before period end', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
        })

        await manager.cancelSubscription(subscription.id, { immediate: false })

        const reactivated = await manager.reactivateSubscription(subscription.id)

        expect(reactivated.cancelAtPeriodEnd).toBe(false)
        expect(reactivated.cancelAt).toBeNull()
        expect(reactivated.status).toBe('active')
      })

      it('should store cancellation reason and feedback', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
        })

        const canceled = await manager.cancelSubscription(subscription.id, {
          immediate: false,
          reason: 'too_expensive',
          feedback: 'The pricing does not fit my budget',
        })

        expect(canceled.cancellationDetails).toEqual({
          reason: 'too_expensive',
          feedback: 'The pricing does not fit my budget',
          canceledAt: expect.any(Date),
          canceledBy: 'customer',
        })
      })
    })

    describe('Cancel Immediately', () => {
      it('should cancel subscription immediately', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
        })

        const canceled = await manager.cancelSubscription(subscription.id, {
          immediate: true,
        })

        expect(canceled.status).toBe('canceled')
        expect(canceled.canceledAt).toBeInstanceOf(Date)
      })

      it('should revoke access immediately', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
        })

        await manager.cancelSubscription(subscription.id, { immediate: true })

        const access = await manager.checkAccess(subscription.id)
        expect(access.hasAccess).toBe(false)
      })

      it('should issue prorated refund when requested', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
        })

        const canceled = await manager.cancelSubscription(subscription.id, {
          immediate: true,
          refund: 'prorate',
        })

        expect(canceled.refund).toBeDefined()
        expect(canceled.refund!.amount).toBeGreaterThan(0)
        expect(canceled.refund!.amount).toBeLessThanOrEqual(3000)
      })

      it('should issue full refund when requested', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
        })

        const canceled = await manager.cancelSubscription(subscription.id, {
          immediate: true,
          refund: 'full',
        })

        expect(canceled.refund!.amount).toBe(3000)
      })

      it('should not refund when refund is none', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
        })

        const canceled = await manager.cancelSubscription(subscription.id, {
          immediate: true,
          refund: 'none',
        })

        expect(canceled.refund).toBeUndefined()
      })
    })

    it('should not allow canceling already canceled subscription', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.cancelSubscription(subscription.id, { immediate: true })

      await expect(
        manager.cancelSubscription(subscription.id, { immediate: true })
      ).rejects.toThrow('Subscription already canceled')
    })
  })

  // =============================================================================
  // 5. Trial Periods (Start, Convert, Expire)
  // =============================================================================

  describe('5. Trial Periods', () => {
    let manager: SubscriptionManager
    let plan: Plan
    let customer: ReturnType<typeof createTestCustomer>

    beforeEach(async () => {
      manager = createSubscriptionManager()
      plan = createTestPlan({ amount: 4999 })
      customer = createTestCustomer()

      await manager.registerPlan(plan)
    })

    describe('Trial Start', () => {
      it('should create subscription with trial period', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
          trialDays: 14,
        })

        expect(subscription.status).toBe('trialing')
        expect(subscription.trialStart).toBeInstanceOf(Date)
        expect(subscription.trialEnd).toBeInstanceOf(Date)

        const trialDuration = subscription.trialEnd!.getTime() - subscription.trialStart!.getTime()
        const trialDays = trialDuration / (1000 * 60 * 60 * 24)
        expect(trialDays).toBeCloseTo(14, 0)
      })

      it('should set specific trial end date', async () => {
        const trialEndDate = new Date()
        trialEndDate.setDate(trialEndDate.getDate() + 30)

        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
          trialEnd: trialEndDate,
        })

        expect(subscription.trialEnd!.getTime()).toBeCloseTo(trialEndDate.getTime(), -2)
      })

      it('should allow trial without payment method', async () => {
        const subscription = await manager.createSubscription({
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

      it('should grant access during trial', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
          trialDays: 14,
        })

        const access = await manager.checkAccess(subscription.id)
        expect(access.hasAccess).toBe(true)
        expect(access.inTrial).toBe(true)
      })

      it('should not charge during trial', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
          trialDays: 14,
        })

        const invoices = await manager.listInvoices(subscription.id)
        expect(invoices).toHaveLength(0)
      })
    })

    describe('Trial Convert', () => {
      it('should convert trial to paid on trial end', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
          trialDays: 14,
        })

        // Simulate trial end processing
        await manager.processTrialEnd(subscription.id)

        const updated = await manager.getSubscription(subscription.id)
        expect(updated!.status).toBe('active')
      })

      it('should generate first invoice at trial end', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
          trialDays: 14,
        })

        await manager.processTrialEnd(subscription.id)

        const invoices = await manager.listInvoices(subscription.id)
        expect(invoices).toHaveLength(1)
        expect(invoices[0].amount).toBe(4999)
      })

      it('should extend trial period', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
          trialDays: 14,
        })

        const originalTrialEnd = subscription.trialEnd!

        const extended = await manager.extendTrial(subscription.id, {
          additionalDays: 7,
        })

        const expectedEnd = new Date(originalTrialEnd.getTime() + 7 * 24 * 60 * 60 * 1000)
        expect(extended.trialEnd!.getTime()).toBeCloseTo(expectedEnd.getTime(), -2)
      })

      it('should end trial early and convert', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
          trialDays: 14,
        })

        const converted = await manager.endTrialEarly(subscription.id)

        expect(converted.status).toBe('active')
        expect(converted.trialEnd!.getTime()).toBeLessThanOrEqual(Date.now())
      })
    })

    describe('Trial Expire', () => {
      it('should cancel if payment fails at trial end', async () => {
        // Create trial without valid payment method behavior
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: 'pm_will_fail',
          trialDays: 14,
          trialConfig: {
            onPaymentFailure: 'cancel',
          },
        })

        // Mock payment failure
        manager.mockPaymentFailure('pm_will_fail')

        await manager.processTrialEnd(subscription.id)

        const updated = await manager.getSubscription(subscription.id)
        expect(updated!.status).toBe('canceled')
        expect(updated!.cancellationDetails!.reason).toBe('trial_payment_failed')
      })

      it('should require payment method before trial ends', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          trialDays: 14,
          trialConfig: {
            requirePaymentMethod: false,
          },
        })

        // Try to convert without adding payment method
        await expect(manager.processTrialEnd(subscription.id)).rejects.toThrow(
          'Payment method required to convert trial'
        )
      })

      it('should cancel trial without converting to paid', async () => {
        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
          trialDays: 14,
          trialConfig: {
            convertToPaid: false,
          },
        })

        await manager.processTrialEnd(subscription.id)

        const updated = await manager.getSubscription(subscription.id)
        expect(updated!.status).toBe('canceled')
      })

      it('should emit trial_ending warning event', async () => {
        const eventHandler = vi.fn()
        manager.on('subscription.trial_will_end', eventHandler)

        const subscription = await manager.createSubscription({
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: customer.paymentMethodId,
          trialDays: 14,
        })

        // Check trial ending (typically called 3 days before)
        await manager.checkTrialEnding(subscription.id, { warningDays: 3 })

        expect(eventHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            subscriptionId: subscription.id,
            daysRemaining: expect.any(Number),
          })
        )
      })
    })
  })

  // =============================================================================
  // 6. Grace Periods for Failed Payments
  // =============================================================================

  describe('6. Grace Periods for Failed Payments', () => {
    let manager: SubscriptionManager
    let plan: Plan
    let customer: ReturnType<typeof createTestCustomer>

    beforeEach(async () => {
      manager = createSubscriptionManager({
        gracePeriodDays: 7,
      })
      plan = createTestPlan()
      customer = createTestCustomer()

      await manager.registerPlan(plan)
    })

    it('should enter grace period on payment failure', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
        failureMessage: 'Card was declined',
      })

      const updated = await manager.getSubscription(subscription.id)
      expect(updated!.status).toBe('past_due')
      expect(updated!.gracePeriodEnd).toBeInstanceOf(Date)

      // Grace period should be 7 days from now
      const graceDays =
        (updated!.gracePeriodEnd!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      expect(graceDays).toBeCloseTo(7, 0)
    })

    it('should maintain access during grace period', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      const access = await manager.checkAccess(subscription.id)
      expect(access.hasAccess).toBe(true)
      expect(access.inGracePeriod).toBe(true)
    })

    it('should recover from grace period on successful payment', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      await manager.handlePaymentSucceeded(subscription.id, {
        paymentId: 'pay_success_456',
        amount: plan.amount,
      })

      const updated = await manager.getSubscription(subscription.id)
      expect(updated!.status).toBe('active')
      expect(updated!.gracePeriodEnd).toBeUndefined()
    })

    it('should cancel subscription when grace period expires', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      // Simulate grace period expiry
      await manager.processGracePeriodEnd(subscription.id)

      const updated = await manager.getSubscription(subscription.id)
      expect(updated!.status).toBe('canceled')
      expect(updated!.cancellationDetails!.reason).toBe('grace_period_expired')
    })

    it('should retry payment during grace period', async () => {
      const retryHandler = vi.fn()
      manager.on('payment.retry', retryHandler)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          retrySchedule: [1, 3, 7], // retry on days 1, 3, 7
        },
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      // Process scheduled retry
      await manager.processScheduledRetries()

      expect(retryHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
        })
      )
    })

    it('should track retry attempts', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      // First failure
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_1',
        failureCode: 'card_declined',
      })

      let updated = await manager.getSubscription(subscription.id)
      expect(updated!.retryCount).toBe(1)

      // Second failure
      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_2',
        failureCode: 'card_declined',
      })

      updated = await manager.getSubscription(subscription.id)
      expect(updated!.retryCount).toBe(2)
    })

    it('should send dunning emails', async () => {
      const emailHandler = vi.fn()
      manager.on('dunning.email_sent', emailHandler)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        dunning: {
          sendEmails: true,
        },
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      expect(emailHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          emailType: 'payment_failed',
        })
      )
    })

    it('should configure custom grace period duration', async () => {
      const customManager = createSubscriptionManager({
        gracePeriodDays: 14,
      })

      await customManager.registerPlan(plan)

      const subscription = await customManager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await customManager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed_123',
        failureCode: 'card_declined',
      })

      const updated = await customManager.getSubscription(subscription.id)
      const graceDays =
        (updated!.gracePeriodEnd!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      expect(graceDays).toBeCloseTo(14, 0)
    })
  })

  // =============================================================================
  // 7. Subscription Status Transitions
  // =============================================================================

  describe('7. Subscription Status Transitions', () => {
    let manager: SubscriptionManager
    let plan: Plan
    let customer: ReturnType<typeof createTestCustomer>

    beforeEach(async () => {
      manager = createSubscriptionManager()
      plan = createTestPlan()
      customer = createTestCustomer()

      await manager.registerPlan(plan)
    })

    it('should transition: none -> active (create without trial)', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      expect(subscription.status).toBe('active')
    })

    it('should transition: none -> trialing (create with trial)', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      expect(subscription.status).toBe('trialing')
    })

    it('should transition: trialing -> active (trial converts)', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      await manager.processTrialEnd(subscription.id)

      const updated = await manager.getSubscription(subscription.id)
      expect(updated!.status).toBe('active')
    })

    it('should transition: active -> past_due (payment fails)', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed',
        failureCode: 'card_declined',
      })

      const updated = await manager.getSubscription(subscription.id)
      expect(updated!.status).toBe('past_due')
    })

    it('should transition: past_due -> active (payment succeeds)', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed',
        failureCode: 'card_declined',
      })

      await manager.handlePaymentSucceeded(subscription.id, {
        paymentId: 'pay_success',
        amount: plan.amount,
      })

      const updated = await manager.getSubscription(subscription.id)
      expect(updated!.status).toBe('active')
    })

    it('should transition: past_due -> canceled (grace period expires)', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed',
        failureCode: 'card_declined',
      })

      await manager.processGracePeriodEnd(subscription.id)

      const updated = await manager.getSubscription(subscription.id)
      expect(updated!.status).toBe('canceled')
    })

    it('should transition: active -> paused', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const paused = await manager.pauseSubscription(subscription.id)

      expect(paused.status).toBe('paused')
    })

    it('should transition: paused -> active (resume)', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.pauseSubscription(subscription.id)
      const resumed = await manager.resumeSubscription(subscription.id)

      expect(resumed.status).toBe('active')
    })

    it('should transition: active -> canceled (immediate cancel)', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      const canceled = await manager.cancelSubscription(subscription.id, {
        immediate: true,
      })

      expect(canceled.status).toBe('canceled')
    })

    it('should track status history', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
        trialDays: 14,
      })

      await manager.processTrialEnd(subscription.id)

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed',
        failureCode: 'card_declined',
      })

      await manager.handlePaymentSucceeded(subscription.id, {
        paymentId: 'pay_success',
        amount: plan.amount,
      })

      const updated = await manager.getSubscription(subscription.id)
      expect(updated!.statusHistory).toEqual([
        { status: 'trialing', timestamp: expect.any(Date) },
        { status: 'active', timestamp: expect.any(Date) },
        { status: 'past_due', timestamp: expect.any(Date) },
        { status: 'active', timestamp: expect.any(Date) },
      ])
    })

    it('should emit status change events', async () => {
      const eventHandler = vi.fn()
      manager.on('subscription.status_changed', eventHandler)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.handlePaymentFailed(subscription.id, {
        paymentId: 'pay_failed',
        failureCode: 'card_declined',
      })

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          previousStatus: 'active',
          newStatus: 'past_due',
          timestamp: expect.any(Date),
        })
      )
    })

    it('should prevent invalid status transitions', async () => {
      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.cancelSubscription(subscription.id, { immediate: true })

      // Cannot pause a canceled subscription
      await expect(manager.pauseSubscription(subscription.id)).rejects.toThrow(
        'Cannot pause canceled subscription'
      )

      // Cannot transition canceled back to active
      await expect(manager.reactivateSubscription(subscription.id)).rejects.toThrow(
        'Cannot reactivate canceled subscription'
      )
    })
  })

  // =============================================================================
  // Event Emission Tests
  // =============================================================================

  describe('Event Emission', () => {
    let manager: SubscriptionManager
    let plan: Plan
    let customer: ReturnType<typeof createTestCustomer>

    beforeEach(async () => {
      manager = createSubscriptionManager()
      plan = createTestPlan()
      customer = createTestCustomer()

      await manager.registerPlan(plan)
    })

    it('should emit subscription.created event', async () => {
      const handler = vi.fn()
      manager.on('subscription.created', handler)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          customerId: customer.id,
        })
      )
    })

    it('should emit subscription.updated event', async () => {
      const handler = vi.fn()
      manager.on('subscription.updated', handler)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.updateMetadata(subscription.id, { key: 'value' })

      expect(handler).toHaveBeenCalled()
    })

    it('should emit subscription.canceled event', async () => {
      const handler = vi.fn()
      manager.on('subscription.canceled', handler)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.cancelSubscription(subscription.id, { immediate: true })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          cancellationType: 'immediate',
        })
      )
    })

    it('should emit subscription.renewed event', async () => {
      const handler = vi.fn()
      manager.on('subscription.renewed', handler)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.processRenewal(subscription.id)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
          previousPeriodEnd: expect.any(Date),
          newPeriodEnd: expect.any(Date),
        })
      )
    })

    it('should emit subscription.paused event', async () => {
      const handler = vi.fn()
      manager.on('subscription.paused', handler)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.pauseSubscription(subscription.id)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
        })
      )
    })

    it('should emit subscription.resumed event', async () => {
      const handler = vi.fn()
      manager.on('subscription.resumed', handler)

      const subscription = await manager.createSubscription({
        customerId: customer.id,
        planId: plan.id,
        paymentMethodId: customer.paymentMethodId,
      })

      await manager.pauseSubscription(subscription.id)
      await manager.resumeSubscription(subscription.id)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subscription.id,
        })
      )
    })
  })
})
