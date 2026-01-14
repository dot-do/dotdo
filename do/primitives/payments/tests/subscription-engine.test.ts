/**
 * Subscription Engine Tests
 *
 * Comprehensive tests for subscription lifecycle management:
 * - Plan management
 * - Subscription CRUD (create, read, update, delete/cancel)
 * - Status transitions (trialing, active, past_due, paused, canceled)
 * - Trial period handling
 * - Proration on plan/quantity changes
 * - Grace period for failed payments
 * - Invoice generation on renewal
 * - Usage aggregation for metered billing
 * - Dunning sequence for failed payments
 * - DO alarm scheduling for renewals
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createSubscriptionEngine,
  SubscriptionEngine,
  type Plan,
  type Subscription,
  type Invoice,
  type PaymentIntent,
  type SubscriptionEngineOptions,
  type AlarmSchedule,
  type SubscriptionEvent,
  type SubscriptionStatus,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestEngine(options?: SubscriptionEngineOptions): SubscriptionEngine {
  return createSubscriptionEngine(options)
}

function createTestPlan(
  engine: SubscriptionEngine,
  overrides?: Partial<Omit<Plan, 'id' | 'createdAt' | 'updatedAt'>>
): Plan {
  return engine.createPlan({
    name: 'Pro Plan',
    amount: 2999, // $29.99
    currency: 'USD',
    billingCycle: 'monthly',
    ...overrides,
  })
}

function createMeteredPlan(
  engine: SubscriptionEngine,
  overrides?: Partial<Omit<Plan, 'id' | 'createdAt' | 'updatedAt'>>
): Plan {
  return engine.createPlan({
    name: 'Usage Plan',
    amount: 999, // $9.99 base
    currency: 'USD',
    billingCycle: 'monthly',
    usageType: 'metered',
    unitAmount: 10, // $0.10 per unit
    includedUnits: 100,
    ...overrides,
  })
}

// =============================================================================
// Plan Management Tests
// =============================================================================

describe('SubscriptionEngine', () => {
  describe('plan management', () => {
    let engine: SubscriptionEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should create a plan', () => {
      const plan = createTestPlan(engine)

      expect(plan.id).toBeDefined()
      expect(plan.id).toMatch(/^plan_/)
      expect(plan.name).toBe('Pro Plan')
      expect(plan.amount).toBe(2999)
      expect(plan.currency).toBe('USD')
      expect(plan.billingCycle).toBe('monthly')
      expect(plan.createdAt).toBeInstanceOf(Date)
      expect(plan.updatedAt).toBeInstanceOf(Date)
    })

    it('should create a plan with trial days', () => {
      const plan = createTestPlan(engine, { trialDays: 14 })

      expect(plan.trialDays).toBe(14)
    })

    it('should create a metered plan', () => {
      const plan = createMeteredPlan(engine)

      expect(plan.usageType).toBe('metered')
      expect(plan.unitAmount).toBe(10)
      expect(plan.includedUnits).toBe(100)
    })

    it('should get a plan by ID', () => {
      const created = createTestPlan(engine)

      const retrieved = engine.getPlan(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should return null for non-existent plan', () => {
      const result = engine.getPlan('nonexistent')
      expect(result).toBeNull()
    })

    it('should list all plans', () => {
      createTestPlan(engine, { name: 'Basic' })
      createTestPlan(engine, { name: 'Pro' })
      createTestPlan(engine, { name: 'Enterprise' })

      const plans = engine.listPlans()

      expect(plans).toHaveLength(3)
      expect(plans.map((p) => p.name)).toContain('Basic')
      expect(plans.map((p) => p.name)).toContain('Pro')
      expect(plans.map((p) => p.name)).toContain('Enterprise')
    })

    it('should update a plan', () => {
      const plan = createTestPlan(engine)

      const updated = engine.updatePlan(plan.id, {
        name: 'Pro Plus',
        amount: 3999,
      })

      expect(updated.name).toBe('Pro Plus')
      expect(updated.amount).toBe(3999)
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(plan.updatedAt.getTime())
    })

    it('should throw when updating non-existent plan', () => {
      expect(() => engine.updatePlan('nonexistent', { name: 'New' })).toThrow('Plan not found')
    })
  })

  // =============================================================================
  // Subscription Creation Tests
  // =============================================================================

  describe('subscription creation', () => {
    let engine: SubscriptionEngine
    let plan: Plan

    beforeEach(() => {
      engine = createTestEngine()
      plan = createTestPlan(engine)
    })

    it('should create a subscription', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      expect(subscription.id).toBeDefined()
      expect(subscription.id).toMatch(/^sub_/)
      expect(subscription.customerId).toBe('cust_123')
      expect(subscription.planId).toBe(plan.id)
      expect(subscription.status).toBe('active')
      expect(subscription.quantity).toBe(1)
      expect(subscription.currentPeriodStart).toBeInstanceOf(Date)
      expect(subscription.currentPeriodEnd).toBeInstanceOf(Date)
      expect(subscription.cancelAtPeriodEnd).toBe(false)
    })

    it('should create a subscription with quantity', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
        quantity: 5,
      })

      expect(subscription.quantity).toBe(5)
    })

    it('should create a subscription with metadata', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
        metadata: { source: 'api', campaign: 'launch' },
      })

      expect(subscription.metadata).toEqual({ source: 'api', campaign: 'launch' })
    })

    it('should throw when creating subscription with non-existent plan', async () => {
      await expect(
        engine.create({
          customerId: 'cust_123',
          planId: 'nonexistent',
        })
      ).rejects.toThrow('Plan not found')
    })

    it('should get a subscription by ID', async () => {
      const created = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const retrieved = engine.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should return null for non-existent subscription', () => {
      const result = engine.get('nonexistent')
      expect(result).toBeNull()
    })

    it('should list subscriptions by customer', async () => {
      await engine.create({ customerId: 'cust_a', planId: plan.id })
      await engine.create({ customerId: 'cust_a', planId: plan.id })
      await engine.create({ customerId: 'cust_b', planId: plan.id })

      const customerASubs = engine.listByCustomer('cust_a')
      const customerBSubs = engine.listByCustomer('cust_b')

      expect(customerASubs).toHaveLength(2)
      expect(customerBSubs).toHaveLength(1)
    })
  })

  // =============================================================================
  // Trial Period Tests
  // =============================================================================

  describe('trial periods', () => {
    let engine: SubscriptionEngine
    let planWithTrial: Plan

    beforeEach(() => {
      engine = createTestEngine()
      planWithTrial = createTestPlan(engine, { trialDays: 14 })
    })

    it('should create subscription with trial from plan', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: planWithTrial.id,
      })

      expect(subscription.status).toBe('trialing')
      expect(subscription.trialStart).toBeInstanceOf(Date)
      expect(subscription.trialEnd).toBeInstanceOf(Date)

      const trialDays = Math.round(
        (subscription.trialEnd!.getTime() - subscription.trialStart!.getTime()) / (1000 * 60 * 60 * 24)
      )
      expect(trialDays).toBe(14)
    })

    it('should create subscription with custom trial days', async () => {
      const planNoTrial = createTestPlan(engine)

      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: planNoTrial.id,
        trialDays: 7,
      })

      expect(subscription.status).toBe('trialing')
      const trialDays = Math.round(
        (subscription.trialEnd!.getTime() - subscription.trialStart!.getTime()) / (1000 * 60 * 60 * 24)
      )
      expect(trialDays).toBe(7)
    })

    it('should create subscription with specific trial end date', async () => {
      const planNoTrial = createTestPlan(engine)
      const trialEnd = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000) // 21 days

      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: planNoTrial.id,
        trialEnd,
      })

      expect(subscription.status).toBe('trialing')
      expect(subscription.trialEnd?.getTime()).toBeCloseTo(trialEnd.getTime(), -3)
    })

    it('should schedule trial_end alarm', async () => {
      const scheduledAlarms: AlarmSchedule[] = []
      const engineWithAlarms = createTestEngine({
        onAlarmScheduled: (alarm) => {
          scheduledAlarms.push(alarm)
        },
      })
      const plan = createTestPlan(engineWithAlarms, { trialDays: 7 })

      await engineWithAlarms.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      expect(scheduledAlarms.some((a) => a.type === 'trial_end')).toBe(true)
    })

    it('should convert trial to active on endTrial', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: planWithTrial.id,
      })

      expect(subscription.status).toBe('trialing')

      const updated = await engine.endTrial(subscription.id)

      expect(updated.status).toBe('active')
      expect(updated.trialEnd).toBeInstanceOf(Date)
    })

    it('should throw when ending trial on non-trialing subscription', async () => {
      const plan = createTestPlan(engine)
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      await expect(engine.endTrial(subscription.id)).rejects.toThrow('not in trial')
    })

    it('should generate invoice on trial end', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: planWithTrial.id,
      })

      await engine.endTrial(subscription.id)

      const invoices = engine.listInvoices(subscription.id)
      expect(invoices.length).toBeGreaterThanOrEqual(1)
      expect(invoices[0].status).toBe('paid') // Default payment succeeds
    })
  })

  // =============================================================================
  // Subscription Update Tests
  // =============================================================================

  describe('subscription updates', () => {
    let engine: SubscriptionEngine
    let basicPlan: Plan
    let proPlan: Plan

    beforeEach(() => {
      engine = createTestEngine()
      basicPlan = createTestPlan(engine, { name: 'Basic', amount: 999 })
      proPlan = createTestPlan(engine, { name: 'Pro', amount: 2999 })
    })

    it('should update subscription quantity', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: basicPlan.id,
        quantity: 1,
      })

      const updated = await engine.update(subscription.id, { quantity: 5 })

      expect(updated.quantity).toBe(5)
    })

    it('should update subscription plan', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: basicPlan.id,
      })

      const updated = await engine.update(subscription.id, { planId: proPlan.id })

      expect(updated.planId).toBe(proPlan.id)
    })

    it('should update subscription metadata', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: basicPlan.id,
        metadata: { key1: 'value1' },
      })

      const updated = await engine.update(subscription.id, {
        metadata: { key2: 'value2' },
      })

      expect(updated.metadata).toEqual({ key1: 'value1', key2: 'value2' })
    })

    it('should throw when updating non-existent subscription', async () => {
      await expect(engine.update('nonexistent', { quantity: 2 })).rejects.toThrow('not found')
    })

    it('should throw when updating canceled subscription', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: basicPlan.id,
      })

      await engine.cancel(subscription.id, { cancelBehavior: 'immediately' })

      await expect(engine.update(subscription.id, { quantity: 2 })).rejects.toThrow('canceled')
    })
  })

  // =============================================================================
  // Proration Tests
  // =============================================================================

  describe('proration', () => {
    let engine: SubscriptionEngine
    let basicPlan: Plan
    let proPlan: Plan

    beforeEach(() => {
      engine = createTestEngine()
      basicPlan = createTestPlan(engine, { name: 'Basic', amount: 1000 })
      proPlan = createTestPlan(engine, { name: 'Pro', amount: 3000 })
    })

    it('should calculate proration for plan upgrade', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: basicPlan.id,
      })

      const prorations = engine.calculateProration(subscription, proPlan.id)

      expect(prorations.length).toBeGreaterThan(0)
      expect(prorations.some((p) => p.type === 'credit')).toBe(true) // Credit for unused basic
      expect(prorations.some((p) => p.type === 'debit')).toBe(true) // Charge for remaining pro
    })

    it('should calculate proration for plan downgrade', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: proPlan.id,
      })

      const prorations = engine.calculateProration(subscription, basicPlan.id)

      expect(prorations.length).toBeGreaterThan(0)
      // Credit for unused pro should be larger than debit for remaining basic
      const creditAmount = prorations.find((p) => p.type === 'credit')?.amount ?? 0
      const debitAmount = prorations.find((p) => p.type === 'debit')?.amount ?? 0
      expect(creditAmount).toBeGreaterThan(debitAmount)
    })

    it('should calculate proration for quantity increase', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: basicPlan.id,
        quantity: 1,
      })

      const prorations = engine.calculateQuantityProration(subscription, 5)

      expect(prorations.length).toBe(1)
      expect(prorations[0].type).toBe('debit')
      expect(prorations[0].description).toContain('4 seats')
    })

    it('should calculate proration for quantity decrease', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: basicPlan.id,
        quantity: 5,
      })

      const prorations = engine.calculateQuantityProration(subscription, 2)

      expect(prorations.length).toBe(1)
      expect(prorations[0].type).toBe('credit')
      expect(prorations[0].description).toContain('3 seats')
    })

    it('should create proration invoice on plan change with create_prorations behavior', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: basicPlan.id,
      })

      await engine.update(subscription.id, {
        planId: proPlan.id,
        prorationBehavior: 'create_prorations',
      })

      const invoices = engine.listInvoices(subscription.id)
      const prorationInvoice = invoices.find((i) =>
        i.lineItems.some((li) => li.type === 'proration')
      )
      expect(prorationInvoice).toBeDefined()
    })

    it('should not create proration invoice with none behavior', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: basicPlan.id,
      })

      const initialInvoiceCount = engine.listInvoices(subscription.id).length

      await engine.update(subscription.id, {
        planId: proPlan.id,
        prorationBehavior: 'none',
      })

      const finalInvoiceCount = engine.listInvoices(subscription.id).length
      expect(finalInvoiceCount).toBe(initialInvoiceCount)
    })
  })

  // =============================================================================
  // Cancellation Tests
  // =============================================================================

  describe('subscription cancellation', () => {
    let engine: SubscriptionEngine
    let plan: Plan

    beforeEach(() => {
      engine = createTestEngine()
      plan = createTestPlan(engine)
    })

    it('should cancel subscription immediately', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const canceled = await engine.cancel(subscription.id, { cancelBehavior: 'immediately' })

      expect(canceled.status).toBe('canceled')
      expect(canceled.canceledAt).toBeInstanceOf(Date)
      expect(canceled.cancelAtPeriodEnd).toBe(false)
    })

    it('should cancel subscription at period end', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const canceled = await engine.cancel(subscription.id, { cancelBehavior: 'at_period_end' })

      expect(canceled.status).toBe('active') // Still active until period end
      expect(canceled.cancelAtPeriodEnd).toBe(true)
      expect(canceled.canceledAt).toBeUndefined()
    })

    it('should default to cancel at period end', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const canceled = await engine.cancel(subscription.id)

      expect(canceled.cancelAtPeriodEnd).toBe(true)
    })

    it('should throw when canceling already canceled subscription', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      await engine.cancel(subscription.id, { cancelBehavior: 'immediately' })

      await expect(engine.cancel(subscription.id)).rejects.toThrow('already canceled')
    })

    it('should cancel alarms on immediate cancellation', async () => {
      const canceledAlarms: string[] = []
      const engineWithAlarms = createTestEngine({
        onAlarmCanceled: (subId) => {
          canceledAlarms.push(subId)
        },
      })
      const testPlan = createTestPlan(engineWithAlarms)

      const subscription = await engineWithAlarms.create({
        customerId: 'cust_123',
        planId: testPlan.id,
      })

      await engineWithAlarms.cancel(subscription.id, { cancelBehavior: 'immediately' })

      expect(canceledAlarms).toContain(subscription.id)
    })
  })

  // =============================================================================
  // Pause/Resume Tests
  // =============================================================================

  describe('pause and resume', () => {
    let engine: SubscriptionEngine
    let plan: Plan

    beforeEach(() => {
      engine = createTestEngine()
      plan = createTestPlan(engine)
    })

    it('should pause an active subscription', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const paused = await engine.pause(subscription.id)

      expect(paused.status).toBe('paused')
      expect(paused.pausedAt).toBeInstanceOf(Date)
    })

    it('should throw when pausing non-active subscription', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      await engine.cancel(subscription.id, { cancelBehavior: 'immediately' })

      await expect(engine.pause(subscription.id)).rejects.toThrow('only pause active')
    })

    it('should resume a paused subscription', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      await engine.pause(subscription.id)
      const resumed = await engine.resume(subscription.id)

      expect(resumed.status).toBe('active')
      expect(resumed.pausedAt).toBeUndefined()
    })

    it('should throw when resuming non-paused subscription', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      await expect(engine.resume(subscription.id)).rejects.toThrow('only resume paused')
    })

    it('should extend billing period by paused duration', async () => {
      vi.useFakeTimers()
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const originalPeriodEnd = subscription.currentPeriodEnd.getTime()

      await engine.pause(subscription.id)

      // Advance time by 7 days
      vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000)

      const resumed = await engine.resume(subscription.id)

      // Period end should be extended by ~7 days
      expect(resumed.currentPeriodEnd.getTime()).toBeGreaterThan(originalPeriodEnd)

      vi.useRealTimers()
    })
  })

  // =============================================================================
  // Invoice Generation Tests
  // =============================================================================

  describe('invoice generation', () => {
    let engine: SubscriptionEngine
    let plan: Plan

    beforeEach(() => {
      engine = createTestEngine()
      plan = createTestPlan(engine, { amount: 2999 })
    })

    it('should generate invoice for subscription', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const invoices = engine.listInvoices(subscription.id)

      expect(invoices.length).toBeGreaterThanOrEqual(1)
      const invoice = invoices[0]
      expect(invoice.subscriptionId).toBe(subscription.id)
      expect(invoice.customerId).toBe('cust_123')
      expect(invoice.currency).toBe('USD')
      expect(invoice.total).toBe(2999)
    })

    it('should generate invoice with correct line items', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
        quantity: 3,
      })

      const invoices = engine.listInvoices(subscription.id)
      const invoice = invoices[0]

      expect(invoice.lineItems).toHaveLength(1)
      expect(invoice.lineItems[0].quantity).toBe(3)
      expect(invoice.lineItems[0].unitAmount).toBe(2999)
      expect(invoice.lineItems[0].amount).toBe(8997) // 2999 * 3
    })

    it('should get invoice by ID', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const invoices = engine.listInvoices(subscription.id)
      const retrieved = engine.getInvoice(invoices[0].id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(invoices[0].id)
    })

    it('should return null for non-existent invoice', () => {
      const result = engine.getInvoice('nonexistent')
      expect(result).toBeNull()
    })

    it('should mark invoice as paid', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const invoices = engine.listInvoices(subscription.id)
      // Simulate unpaid invoice for testing
      const invoice = invoices[0]
      invoice.status = 'open'
      invoice.amountPaid = 0
      invoice.amountDue = invoice.total

      const paid = await engine.markInvoicePaid(invoice.id)

      expect(paid.status).toBe('paid')
      expect(paid.amountPaid).toBe(paid.total)
      expect(paid.amountDue).toBe(0)
      expect(paid.paidAt).toBeInstanceOf(Date)
    })
  })

  // =============================================================================
  // Usage-Based Billing Tests
  // =============================================================================

  describe('usage-based billing', () => {
    let engine: SubscriptionEngine
    let meteredPlan: Plan

    beforeEach(() => {
      engine = createTestEngine()
      meteredPlan = createMeteredPlan(engine)
    })

    it('should record usage', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: meteredPlan.id,
      })

      const record = await engine.recordUsage({
        subscriptionId: subscription.id,
        quantity: 50,
      })

      expect(record.id).toBeDefined()
      expect(record.subscriptionId).toBe(subscription.id)
      expect(record.quantity).toBe(50)
      expect(record.action).toBe('increment')
      expect(record.timestamp).toBeInstanceOf(Date)
    })

    it('should record usage with set action', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: meteredPlan.id,
      })

      const record = await engine.recordUsage({
        subscriptionId: subscription.id,
        quantity: 100,
        action: 'set',
      })

      expect(record.action).toBe('set')
    })

    it('should throw when recording usage on non-metered plan', async () => {
      const licensedPlan = createTestPlan(engine)
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: licensedPlan.id,
      })

      await expect(
        engine.recordUsage({
          subscriptionId: subscription.id,
          quantity: 50,
        })
      ).rejects.toThrow('does not support usage')
    })

    it('should get usage records', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: meteredPlan.id,
      })

      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 10 })
      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 20 })
      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 30 })

      const records = engine.getUsageRecords(subscription.id)

      expect(records).toHaveLength(3)
    })

    it('should calculate total usage with increment', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: meteredPlan.id,
      })

      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 10 })
      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 20 })
      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 30 })

      const total = engine.getUsageTotal(subscription.id)

      expect(total).toBe(60)
    })

    it('should calculate total usage with set action', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: meteredPlan.id,
      })

      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 10 })
      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 100, action: 'set' })
      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 20 })

      const total = engine.getUsageTotal(subscription.id)

      expect(total).toBe(120) // set to 100, then +20
    })

    it('should include usage charges in invoice', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: meteredPlan.id,
      })

      // Record usage beyond included units (100)
      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 150 })

      // Generate a new invoice
      const invoice = await engine.generateInvoice(subscription.id)

      // Should have base charge + usage charge
      expect(invoice.lineItems.length).toBeGreaterThanOrEqual(2)

      const usageLineItem = invoice.lineItems.find((li) => li.type === 'usage')
      expect(usageLineItem).toBeDefined()
      expect(usageLineItem?.amount).toBe(500) // 50 units over * $0.10
    })

    it('should not charge for usage within included units', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: meteredPlan.id,
      })

      // Record usage within included units
      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 50 })

      // Generate a new invoice
      const invoice = await engine.generateInvoice(subscription.id)

      const usageLineItem = invoice.lineItems.find((li) => li.type === 'usage')
      expect(usageLineItem).toBeUndefined()
    })

    it('should clear usage records after period', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: meteredPlan.id,
      })

      await engine.recordUsage({ subscriptionId: subscription.id, quantity: 100 })

      // Clear records before a future date (records created before this date will be removed)
      const futureDate = new Date(Date.now() + 1000) // 1 second in the future
      engine.clearUsageRecords(subscription.id, futureDate)

      const records = engine.getUsageRecords(subscription.id)
      expect(records).toHaveLength(0)
    })
  })

  // =============================================================================
  // Grace Period & Dunning Tests
  // =============================================================================

  describe('grace period and dunning', () => {
    let engine: SubscriptionEngine
    let plan: Plan

    beforeEach(() => {
      engine = createTestEngine({
        gracePeriodDays: 7,
        dunningSteps: [
          { dayAfterDue: 1, action: 'retry', notificationTemplate: 'retry1' },
          { dayAfterDue: 3, action: 'notify', notificationTemplate: 'warning' },
          { dayAfterDue: 7, action: 'cancel', notificationTemplate: 'canceled' },
        ],
        onPaymentAttempt: async (intent) => {
          // Simulate failed payment
          return { ...intent, status: 'failed', updatedAt: new Date() }
        },
      })
      plan = createTestPlan(engine)
    })

    it('should enter past_due status on payment failure', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      // The subscription should be past_due because payment failed
      const retrieved = engine.get(subscription.id)
      expect(retrieved?.status).toBe('past_due')
    })

    it('should set grace period end date', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const retrieved = engine.get(subscription.id)
      expect(retrieved?.gracePeriodEnd).toBeInstanceOf(Date)
    })

    it('should process dunning steps', async () => {
      const events: SubscriptionEvent[] = []
      const engineWithEvents = createTestEngine({
        gracePeriodDays: 7,
        dunningSteps: [
          { dayAfterDue: 1, action: 'retry' },
          { dayAfterDue: 3, action: 'notify' },
        ],
        onPaymentAttempt: async (intent) => ({ ...intent, status: 'failed', updatedAt: new Date() }),
        onEvent: (event) => {
          events.push(event)
        },
      })
      const testPlan = createTestPlan(engineWithEvents)

      const subscription = await engineWithEvents.create({
        customerId: 'cust_123',
        planId: testPlan.id,
      })

      const invoices = engineWithEvents.listInvoices(subscription.id)

      // Process first dunning step
      await engineWithEvents.processDunningStep(subscription.id, 0, invoices[0].id)

      const dunningEvents = events.filter((e) => e.type === 'subscription.dunning_step')
      expect(dunningEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('should cancel subscription after dunning exhausted', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const invoices = engine.listInvoices(subscription.id)

      // Process all dunning steps including cancel
      await engine.processDunningStep(subscription.id, 0, invoices[0].id) // retry
      await engine.processDunningStep(subscription.id, 1, invoices[0].id) // notify
      await engine.processDunningStep(subscription.id, 2, invoices[0].id) // cancel

      const canceled = engine.get(subscription.id)
      expect(canceled?.status).toBe('canceled')
    })

    it('should clear past_due status on successful payment', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      expect(engine.get(subscription.id)?.status).toBe('past_due')

      // Mark invoice as paid manually
      const invoices = engine.listInvoices(subscription.id)
      await engine.markInvoicePaid(invoices[0].id)

      const updated = engine.get(subscription.id)
      expect(updated?.status).toBe('active')
      expect(updated?.gracePeriodEnd).toBeUndefined()
    })
  })

  // =============================================================================
  // Renewal Tests
  // =============================================================================

  describe('renewal', () => {
    let engine: SubscriptionEngine
    let plan: Plan

    beforeEach(() => {
      engine = createTestEngine()
      plan = createTestPlan(engine, { billingCycle: 'monthly' })
    })

    it('should process renewal and advance billing period', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const originalPeriodEnd = subscription.currentPeriodEnd

      await engine.processRenewal(subscription.id)

      const renewed = engine.get(subscription.id)
      expect(renewed?.currentPeriodStart.getTime()).toBe(originalPeriodEnd.getTime())
      expect(renewed?.currentPeriodEnd.getTime()).toBeGreaterThan(originalPeriodEnd.getTime())
    })

    it('should generate invoice on renewal', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const initialInvoiceCount = engine.listInvoices(subscription.id).length

      await engine.processRenewal(subscription.id)

      const finalInvoiceCount = engine.listInvoices(subscription.id).length
      expect(finalInvoiceCount).toBeGreaterThan(initialInvoiceCount)
    })

    it('should cancel subscription on renewal if cancelAtPeriodEnd is set', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      await engine.cancel(subscription.id, { cancelBehavior: 'at_period_end' })
      await engine.processRenewal(subscription.id)

      const canceled = engine.get(subscription.id)
      expect(canceled?.status).toBe('canceled')
    })

    it('should skip renewal for paused subscription', async () => {
      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      await engine.pause(subscription.id)
      const pausedPeriodEnd = engine.get(subscription.id)?.currentPeriodEnd

      await engine.processRenewal(subscription.id)

      const afterRenewal = engine.get(subscription.id)
      // Period should not have advanced
      expect(afterRenewal?.currentPeriodEnd.getTime()).toBe(pausedPeriodEnd?.getTime())
    })
  })

  // =============================================================================
  // Alarm Scheduling Tests
  // =============================================================================

  describe('alarm scheduling', () => {
    it('should schedule alarm on subscription creation', async () => {
      const scheduledAlarms: AlarmSchedule[] = []
      const engine = createTestEngine({
        onAlarmScheduled: (alarm) => {
          scheduledAlarms.push(alarm)
        },
      })
      const plan = createTestPlan(engine)

      await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const renewalAlarm = scheduledAlarms.find((a) => a.type === 'renewal')
      expect(renewalAlarm).toBeDefined()
    })

    it('should get scheduled alarms for subscription', async () => {
      const engine = createTestEngine()
      const plan = createTestPlan(engine)

      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const alarms = engine.getScheduledAlarms(subscription.id)
      expect(alarms.some((a) => a.type === 'renewal')).toBe(true)
    })

    it('should process alarm', async () => {
      const engine = createTestEngine()
      const plan = createTestPlan(engine)

      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      const originalPeriodEnd = subscription.currentPeriodEnd

      await engine.processAlarm(subscription.id, 'renewal')

      const renewed = engine.get(subscription.id)
      expect(renewed?.currentPeriodStart.getTime()).toBe(originalPeriodEnd.getTime())
    })
  })

  // =============================================================================
  // Event Emission Tests
  // =============================================================================

  describe('event emission', () => {
    it('should emit subscription.created event', async () => {
      const events: SubscriptionEvent[] = []
      const engine = createTestEngine({
        onEvent: (event) => {
          events.push(event)
        },
      })
      const plan = createTestPlan(engine)

      await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      expect(events.some((e) => e.type === 'subscription.created')).toBe(true)
    })

    it('should emit subscription.updated event', async () => {
      const events: SubscriptionEvent[] = []
      const engine = createTestEngine({
        onEvent: (event) => {
          events.push(event)
        },
      })
      const plan = createTestPlan(engine)

      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      await engine.update(subscription.id, { quantity: 5 })

      expect(events.some((e) => e.type === 'subscription.updated')).toBe(true)
    })

    it('should emit subscription.canceled event', async () => {
      const events: SubscriptionEvent[] = []
      const engine = createTestEngine({
        onEvent: (event) => {
          events.push(event)
        },
      })
      const plan = createTestPlan(engine)

      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      await engine.cancel(subscription.id, { cancelBehavior: 'immediately' })

      expect(events.some((e) => e.type === 'subscription.canceled')).toBe(true)
    })

    it('should emit invoice events', async () => {
      const events: SubscriptionEvent[] = []
      const engine = createTestEngine({
        onEvent: (event) => {
          events.push(event)
        },
      })
      const plan = createTestPlan(engine)

      await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      expect(events.some((e) => e.type === 'invoice.created')).toBe(true)
      expect(events.some((e) => e.type === 'invoice.paid')).toBe(true)
    })

    it('should call onStatusChanged callback', async () => {
      const statusChanges: { subscription: Subscription; previousStatus: SubscriptionStatus }[] = []
      const engine = createTestEngine({
        onStatusChanged: (subscription, previousStatus) => {
          statusChanges.push({ subscription, previousStatus })
        },
      })
      const plan = createTestPlan(engine)

      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
      })

      await engine.pause(subscription.id)

      expect(statusChanges.some((c) => c.previousStatus === 'active' && c.subscription.status === 'paused')).toBe(true)
    })
  })

  // =============================================================================
  // Statistics Tests
  // =============================================================================

  describe('statistics', () => {
    it('should calculate subscription statistics', async () => {
      const engine = createTestEngine()
      const monthlyPlan = createTestPlan(engine, { billingCycle: 'monthly', amount: 1000 })
      const yearlyPlan = createTestPlan(engine, { billingCycle: 'yearly', amount: 10000 })

      // Create various subscriptions
      await engine.create({ customerId: 'cust_1', planId: monthlyPlan.id }) // active
      await engine.create({ customerId: 'cust_2', planId: monthlyPlan.id, quantity: 2 }) // active
      await engine.create({ customerId: 'cust_3', planId: yearlyPlan.id }) // active

      const sub4 = await engine.create({ customerId: 'cust_4', planId: monthlyPlan.id })
      await engine.pause(sub4.id) // paused

      const sub5 = await engine.create({ customerId: 'cust_5', planId: monthlyPlan.id })
      await engine.cancel(sub5.id, { cancelBehavior: 'immediately' }) // canceled

      const stats = engine.getStats()

      expect(stats.total).toBe(5)
      expect(stats.active).toBe(3)
      expect(stats.paused).toBe(1)
      expect(stats.canceled).toBe(1)
      // MRR: 1000 + 2000 + (10000/12) = ~3833
      expect(stats.mrr).toBeGreaterThan(3000)
    })

    it('should calculate MRR correctly for different billing cycles', async () => {
      const engine = createTestEngine()
      const monthlyPlan = createTestPlan(engine, { billingCycle: 'monthly', amount: 1000 })
      const yearlyPlan = createTestPlan(engine, { billingCycle: 'yearly', amount: 12000 })

      await engine.create({ customerId: 'cust_1', planId: monthlyPlan.id })
      await engine.create({ customerId: 'cust_2', planId: yearlyPlan.id })

      const stats = engine.getStats()

      // Monthly: 1000 + (12000/12) = 2000
      expect(stats.mrr).toBe(2000)
    })
  })

  // =============================================================================
  // Edge Cases Tests
  // =============================================================================

  describe('edge cases', () => {
    it('should handle subscription with custom start date', async () => {
      const engine = createTestEngine()
      const plan = createTestPlan(engine)
      const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
        startDate: futureStart,
      })

      expect(subscription.currentPeriodStart.getTime()).toBeCloseTo(futureStart.getTime(), -3)
    })

    it('should handle collection method send_invoice', async () => {
      const engine = createTestEngine()
      const plan = createTestPlan(engine)

      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
        collectionMethod: 'send_invoice',
      })

      expect(subscription.collectionMethod).toBe('send_invoice')
      // Should not auto-charge
      const invoices = engine.listInvoices(subscription.id)
      expect(invoices.length).toBe(0) // No immediate invoice for send_invoice
    })

    it('should handle multiple subscriptions for same customer', async () => {
      const engine = createTestEngine()
      const plan1 = createTestPlan(engine, { name: 'Plan A' })
      const plan2 = createTestPlan(engine, { name: 'Plan B' })

      await engine.create({ customerId: 'cust_123', planId: plan1.id })
      await engine.create({ customerId: 'cust_123', planId: plan2.id })

      const subs = engine.listByCustomer('cust_123')
      expect(subs).toHaveLength(2)
    })

    it('should handle zero quantity gracefully', async () => {
      const engine = createTestEngine()
      const plan = createTestPlan(engine)

      const subscription = await engine.create({
        customerId: 'cust_123',
        planId: plan.id,
        quantity: 1,
      })

      // Update to zero quantity
      const updated = await engine.update(subscription.id, { quantity: 0 })

      expect(updated.quantity).toBe(0)
    })

    it('should throw for non-existent subscription operations', async () => {
      const engine = createTestEngine()

      await expect(engine.pause('nonexistent')).rejects.toThrow('not found')
      await expect(engine.resume('nonexistent')).rejects.toThrow('not found')
      await expect(engine.cancel('nonexistent')).rejects.toThrow('not found')
    })
  })
})
