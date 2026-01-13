/**
 * Subscription Lifecycle Tests
 *
 * Tests for SubscriptionManager - manages the complete subscription lifecycle.
 * Handles create, update, cancel, pause/resume, trials, proration, and renewals.
 *
 * TDD Red-Green-Refactor methodology:
 * 1. RED: These tests are written first (failing)
 * 2. GREEN: Implement minimal code to pass
 * 3. REFACTOR: Clean up while keeping tests green
 *
 * @module lib/payments/tests/subscriptions.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import the implementation under test (will fail until implemented)
import {
  createSubscriptionManager,
  type SubscriptionManager,
  type Subscription,
  type SubscriptionStatus,
  type SubscriptionPlan,
  type SubscriptionItem,
  type CreateSubscriptionParams,
  type UpdateSubscriptionParams,
  type CancelSubscriptionParams,
  type PauseSubscriptionParams,
  type ProrationResult,
  type RenewalResult,
  type SubscriptionManagerConfig,
} from '../subscriptions'

// ============================================================================
// Test Fixtures
// ============================================================================

const basePlan: SubscriptionPlan = {
  id: 'plan_pro',
  name: 'Pro Plan',
  price: 4900, // $49.00 in cents
  currency: 'usd',
  interval: 'month',
  intervalCount: 1,
}

const enterprisePlan: SubscriptionPlan = {
  id: 'plan_enterprise',
  name: 'Enterprise Plan',
  price: 29900, // $299.00 in cents
  currency: 'usd',
  interval: 'month',
  intervalCount: 1,
}

const freePlan: SubscriptionPlan = {
  id: 'plan_free',
  name: 'Free Plan',
  price: 0,
  currency: 'usd',
  interval: 'month',
  intervalCount: 1,
}

const yearlyPlan: SubscriptionPlan = {
  id: 'plan_yearly',
  name: 'Yearly Plan',
  price: 49900, // $499.00 in cents
  currency: 'usd',
  interval: 'year',
  intervalCount: 1,
}

const plans: Record<string, SubscriptionPlan> = {
  [basePlan.id]: basePlan,
  [enterprisePlan.id]: enterprisePlan,
  [freePlan.id]: freePlan,
  [yearlyPlan.id]: yearlyPlan,
}

// ============================================================================
// createSubscriptionManager() Tests
// ============================================================================

describe('createSubscriptionManager()', () => {
  it('returns a SubscriptionManager object', () => {
    const manager = createSubscriptionManager({ plans })

    expect(manager).toBeDefined()
    expect(typeof manager.create).toBe('function')
    expect(typeof manager.update).toBe('function')
    expect(typeof manager.cancel).toBe('function')
    expect(typeof manager.pause).toBe('function')
    expect(typeof manager.resume).toBe('function')
    expect(typeof manager.retrieve).toBe('function')
  })

  it('accepts plans configuration', () => {
    const manager = createSubscriptionManager({ plans })
    const config = manager.config()

    expect(config.plans).toBeDefined()
    expect(Object.keys(config.plans)).toHaveLength(4)
  })

  it('accepts optional event emitter', () => {
    const onEvent = vi.fn()
    const manager = createSubscriptionManager({ plans, onEvent })

    expect(manager.config().hasEventEmitter).toBe(true)
  })
})

// ============================================================================
// create() Method Tests - Basic Subscription Creation
// ============================================================================

describe('create() - basic subscription creation', () => {
  let manager: SubscriptionManager

  beforeEach(() => {
    manager = createSubscriptionManager({ plans })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates a subscription with a plan', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    expect(subscription).toBeDefined()
    expect(subscription.id).toMatch(/^sub_/)
    expect(subscription.customerId).toBe('cus_123')
    expect(subscription.planId).toBe(basePlan.id)
  })

  it('sets status to active for non-trial subscriptions', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    expect(subscription.status).toBe('active')
  })

  it('sets billing period dates', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    expect(subscription.currentPeriodStart).toBeInstanceOf(Date)
    expect(subscription.currentPeriodEnd).toBeInstanceOf(Date)
    expect(subscription.currentPeriodEnd.getTime()).toBeGreaterThan(
      subscription.currentPeriodStart.getTime()
    )
  })

  it('calculates period end based on plan interval', async () => {
    const monthlySubscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    // Monthly plan - period should be ~30 days
    const monthlyDiff = monthlySubscription.currentPeriodEnd.getTime() -
      monthlySubscription.currentPeriodStart.getTime()
    const monthlyDays = monthlyDiff / (1000 * 60 * 60 * 24)
    expect(monthlyDays).toBeGreaterThanOrEqual(28)
    expect(monthlyDays).toBeLessThanOrEqual(31)

    const yearlySubscription = await manager.create({
      customerId: 'cus_456',
      planId: yearlyPlan.id,
    })

    // Yearly plan - period should be ~365 days
    const yearlyDiff = yearlySubscription.currentPeriodEnd.getTime() -
      yearlySubscription.currentPeriodStart.getTime()
    const yearlyDays = yearlyDiff / (1000 * 60 * 60 * 24)
    expect(yearlyDays).toBeGreaterThanOrEqual(364)
    expect(yearlyDays).toBeLessThanOrEqual(366)
  })

  it('generates unique subscription IDs', async () => {
    const sub1 = await manager.create({ customerId: 'cus_1', planId: basePlan.id })
    const sub2 = await manager.create({ customerId: 'cus_2', planId: basePlan.id })

    expect(sub1.id).not.toBe(sub2.id)
  })

  it('stores subscription items with price', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    expect(subscription.items).toBeDefined()
    expect(subscription.items).toHaveLength(1)
    expect(subscription.items[0].price).toBe(basePlan.price)
    expect(subscription.items[0].quantity).toBe(1)
  })

  it('supports multiple subscription items', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      items: [
        { planId: basePlan.id, quantity: 2 },
        { planId: enterprisePlan.id, quantity: 1 },
      ],
    })

    expect(subscription.items).toHaveLength(2)
    expect(subscription.items[0].quantity).toBe(2)
    expect(subscription.items[1].quantity).toBe(1)
  })

  it('throws error for invalid plan', async () => {
    await expect(
      manager.create({
        customerId: 'cus_123',
        planId: 'invalid_plan',
      })
    ).rejects.toThrow(/invalid plan/i)
  })

  it('accepts optional metadata', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      metadata: { source: 'website', campaign: 'spring2026' },
    })

    expect(subscription.metadata).toEqual({
      source: 'website',
      campaign: 'spring2026',
    })
  })
})

// ============================================================================
// update() Method Tests - Plan Changes (Upgrade/Downgrade)
// ============================================================================

describe('update() - plan changes', () => {
  let manager: SubscriptionManager
  let subscription: Subscription

  beforeEach(async () => {
    manager = createSubscriptionManager({ plans })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))

    subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('upgrades subscription to higher plan', async () => {
    const updated = await manager.update(subscription.id, {
      planId: enterprisePlan.id,
    })

    expect(updated.planId).toBe(enterprisePlan.id)
    expect(updated.items[0].price).toBe(enterprisePlan.price)
  })

  it('downgrades subscription to lower plan', async () => {
    // First upgrade to enterprise
    await manager.update(subscription.id, { planId: enterprisePlan.id })

    // Then downgrade to pro
    const downgraded = await manager.update(subscription.id, {
      planId: basePlan.id,
    })

    expect(downgraded.planId).toBe(basePlan.id)
  })

  it('applies upgrade immediately by default', async () => {
    const updated = await manager.update(subscription.id, {
      planId: enterprisePlan.id,
    })

    expect(updated.planId).toBe(enterprisePlan.id)
    expect(updated.status).toBe('active')
  })

  it('schedules downgrade for end of period by default', async () => {
    // First upgrade to enterprise
    await manager.update(subscription.id, { planId: enterprisePlan.id })

    // Then request downgrade
    const updated = await manager.update(subscription.id, {
      planId: basePlan.id,
    })

    // Current plan should still be enterprise
    expect(updated.planId).toBe(enterprisePlan.id)
    // But scheduled change should be set
    expect(updated.scheduledPlanChange).toBeDefined()
    expect(updated.scheduledPlanChange?.planId).toBe(basePlan.id)
    expect(updated.scheduledPlanChange?.effectiveDate).toEqual(
      updated.currentPeriodEnd
    )
  })

  it('allows forcing immediate downgrade', async () => {
    // First upgrade to enterprise
    await manager.update(subscription.id, { planId: enterprisePlan.id })

    // Force immediate downgrade
    const updated = await manager.update(subscription.id, {
      planId: basePlan.id,
      prorationBehavior: 'create_prorations',
    })

    expect(updated.planId).toBe(basePlan.id)
    expect(updated.scheduledPlanChange).toBeUndefined()
  })

  it('updates subscription quantity', async () => {
    const updated = await manager.update(subscription.id, {
      items: [{ planId: basePlan.id, quantity: 5 }],
    })

    expect(updated.items[0].quantity).toBe(5)
  })

  it('throws error for non-existent subscription', async () => {
    await expect(
      manager.update('sub_nonexistent', { planId: enterprisePlan.id })
    ).rejects.toThrow(/subscription not found/i)
  })

  it('throws error for invalid target plan', async () => {
    await expect(
      manager.update(subscription.id, { planId: 'invalid_plan' })
    ).rejects.toThrow(/invalid plan/i)
  })
})

// ============================================================================
// cancel() Method Tests - Subscription Cancellation
// ============================================================================

describe('cancel() - subscription cancellation', () => {
  let manager: SubscriptionManager
  let subscription: Subscription

  beforeEach(async () => {
    manager = createSubscriptionManager({ plans })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))

    subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels subscription at end of period by default', async () => {
    const cancelled = await manager.cancel(subscription.id)

    expect(cancelled.cancelAtPeriodEnd).toBe(true)
    expect(cancelled.status).toBe('active') // Still active until period end
    expect(cancelled.canceledAt).toBeInstanceOf(Date)
  })

  it('cancels subscription immediately when specified', async () => {
    const cancelled = await manager.cancel(subscription.id, {
      cancelAtPeriodEnd: false,
    })

    expect(cancelled.cancelAtPeriodEnd).toBe(false)
    expect(cancelled.status).toBe('canceled')
    expect(cancelled.canceledAt).toBeInstanceOf(Date)
    expect(cancelled.endedAt).toBeInstanceOf(Date)
  })

  it('sets canceledAt timestamp', async () => {
    const before = new Date()
    const cancelled = await manager.cancel(subscription.id)

    expect(cancelled.canceledAt).toBeDefined()
    expect(cancelled.canceledAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })

  it('stores cancellation reason', async () => {
    const cancelled = await manager.cancel(subscription.id, {
      reason: 'customer_request',
      comment: 'Too expensive',
    })

    expect(cancelled.cancellationDetails).toBeDefined()
    expect(cancelled.cancellationDetails?.reason).toBe('customer_request')
    expect(cancelled.cancellationDetails?.comment).toBe('Too expensive')
  })

  it('accepts feedback on cancellation', async () => {
    const cancelled = await manager.cancel(subscription.id, {
      feedback: 'missing_features',
    })

    expect(cancelled.cancellationDetails?.feedback).toBe('missing_features')
  })

  it('transitions to canceled status on immediate cancel', async () => {
    const cancelled = await manager.cancel(subscription.id, {
      cancelAtPeriodEnd: false,
    })

    expect(cancelled.status).toBe('canceled')
  })

  it('throws error for already canceled subscription', async () => {
    await manager.cancel(subscription.id, { cancelAtPeriodEnd: false })

    await expect(
      manager.cancel(subscription.id)
    ).rejects.toThrow(/already canceled/i)
  })

  it('allows reactivation before period end', async () => {
    // Cancel at period end
    await manager.cancel(subscription.id, { cancelAtPeriodEnd: true })

    // Reactivate
    const reactivated = await manager.update(subscription.id, {
      cancelAtPeriodEnd: false,
    })

    expect(reactivated.cancelAtPeriodEnd).toBe(false)
    expect(reactivated.canceledAt).toBeNull()
  })
})

// ============================================================================
// pause() and resume() Method Tests
// ============================================================================

describe('pause() and resume()', () => {
  let manager: SubscriptionManager
  let subscription: Subscription

  beforeEach(async () => {
    manager = createSubscriptionManager({ plans })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))

    subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pauses an active subscription', async () => {
    const paused = await manager.pause(subscription.id)

    expect(paused.status).toBe('paused')
    expect(paused.pauseCollection).toBeDefined()
  })

  it('sets pause behavior to mark_uncollectible by default', async () => {
    const paused = await manager.pause(subscription.id)

    expect(paused.pauseCollection?.behavior).toBe('mark_uncollectible')
  })

  it('accepts void behavior for pause', async () => {
    const paused = await manager.pause(subscription.id, {
      behavior: 'void',
    })

    expect(paused.pauseCollection?.behavior).toBe('void')
  })

  it('accepts keep_as_draft behavior for pause', async () => {
    const paused = await manager.pause(subscription.id, {
      behavior: 'keep_as_draft',
    })

    expect(paused.pauseCollection?.behavior).toBe('keep_as_draft')
  })

  it('sets resumesAt date when specified', async () => {
    const resumeDate = new Date('2026-02-15T10:00:00Z')
    const paused = await manager.pause(subscription.id, {
      resumesAt: resumeDate,
    })

    expect(paused.pauseCollection?.resumesAt).toEqual(resumeDate)
  })

  it('resumes a paused subscription', async () => {
    await manager.pause(subscription.id)
    const resumed = await manager.resume(subscription.id)

    expect(resumed.status).toBe('active')
    expect(resumed.pauseCollection).toBeNull()
  })

  it('optionally resets billing cycle anchor on resume', async () => {
    await manager.pause(subscription.id)
    const resumed = await manager.resume(subscription.id, {
      billingCycleAnchor: 'now',
    })

    const now = new Date()
    expect(resumed.currentPeriodStart.getTime()).toBe(now.getTime())
  })

  it('throws error when pausing already paused subscription', async () => {
    await manager.pause(subscription.id)

    await expect(
      manager.pause(subscription.id)
    ).rejects.toThrow(/already paused/i)
  })

  it('throws error when resuming non-paused subscription', async () => {
    await expect(
      manager.resume(subscription.id)
    ).rejects.toThrow(/not paused/i)
  })

  it('cannot pause canceled subscription', async () => {
    await manager.cancel(subscription.id, { cancelAtPeriodEnd: false })

    await expect(
      manager.pause(subscription.id)
    ).rejects.toThrow(/cannot pause/i)
  })
})

// ============================================================================
// Trial Period Tests
// ============================================================================

describe('trial periods', () => {
  let manager: SubscriptionManager

  beforeEach(() => {
    manager = createSubscriptionManager({ plans })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates subscription with trial period days', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialPeriodDays: 14,
    })

    expect(subscription.status).toBe('trialing')
    expect(subscription.trialStart).toBeInstanceOf(Date)
    expect(subscription.trialEnd).toBeInstanceOf(Date)
  })

  it('calculates trial end date correctly', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialPeriodDays: 14,
    })

    const now = new Date()
    const expectedTrialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

    expect(subscription.trialEnd!.getTime()).toBe(expectedTrialEnd.getTime())
  })

  it('creates subscription with explicit trial end date', async () => {
    const trialEnd = new Date('2026-01-27T10:00:00Z')
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialEnd,
    })

    expect(subscription.status).toBe('trialing')
    expect(subscription.trialEnd).toEqual(trialEnd)
  })

  it('sets trial end to now to end trial immediately', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialPeriodDays: 14,
    })

    const updated = await manager.update(subscription.id, {
      trialEnd: 'now',
    })

    expect(updated.status).toBe('active')
    expect(updated.trialEnd).toBeDefined()
    expect(updated.trialEnd!.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('extends trial period', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialPeriodDays: 14,
    })

    const newTrialEnd = new Date('2026-02-15T10:00:00Z')
    const updated = await manager.update(subscription.id, {
      trialEnd: newTrialEnd,
    })

    expect(updated.trialEnd).toEqual(newTrialEnd)
    expect(updated.status).toBe('trialing')
  })

  it('transitions from trial to active after trial ends', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialPeriodDays: 14,
    })

    // Advance time past trial end
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    // Trigger renewal check
    const result = await manager.processTrialEnd(subscription.id)

    expect(result.subscription.status).toBe('active')
    expect(result.converted).toBe(true)
  })

  it('transitions from trial to canceled if cancel_at_period_end is set', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialPeriodDays: 14,
    })

    await manager.cancel(subscription.id, { cancelAtPeriodEnd: true })

    // Advance time past trial end
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const result = await manager.processTrialEnd(subscription.id)

    expect(result.subscription.status).toBe('canceled')
    expect(result.converted).toBe(false)
  })

  it('does not charge during trial period', async () => {
    const onEvent = vi.fn()
    const manager = createSubscriptionManager({ plans, onEvent })

    await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialPeriodDays: 14,
    })

    // Should not emit invoice.created event during trial
    const invoiceEvents = onEvent.mock.calls.filter(
      ([event]) => event === 'invoice.created'
    )
    expect(invoiceEvents).toHaveLength(0)
  })
})

// ============================================================================
// Proration Calculation Tests
// ============================================================================

describe('proration calculation', () => {
  let manager: SubscriptionManager
  let subscription: Subscription

  beforeEach(async () => {
    manager = createSubscriptionManager({ plans })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))

    subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calculates proration for mid-cycle upgrade', async () => {
    // Advance 15 days into the billing cycle
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const proration = await manager.calculateProration(subscription.id, {
      newPlanId: enterprisePlan.id,
    })

    expect(proration).toBeDefined()
    expect(proration.creditAmount).toBeGreaterThan(0) // Credit for unused pro time
    expect(proration.chargeAmount).toBeGreaterThan(0) // Charge for enterprise time
    expect(proration.netAmount).toBeDefined()
  })

  it('returns credit for unused time on old plan', async () => {
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const proration = await manager.calculateProration(subscription.id, {
      newPlanId: enterprisePlan.id,
    })

    // ~15 days left in month, should get ~half credit
    // Pro plan is $49, so credit should be ~$24.50
    expect(proration.creditAmount).toBeGreaterThan(2000)
    expect(proration.creditAmount).toBeLessThan(3000)
  })

  it('calculates charge for remaining time on new plan', async () => {
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const proration = await manager.calculateProration(subscription.id, {
      newPlanId: enterprisePlan.id,
    })

    // ~15 days left in month, enterprise is $299
    // Charge should be ~$149.50
    expect(proration.chargeAmount).toBeGreaterThan(14000)
    expect(proration.chargeAmount).toBeLessThan(16000)
  })

  it('calculates net amount (charge - credit)', async () => {
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const proration = await manager.calculateProration(subscription.id, {
      newPlanId: enterprisePlan.id,
    })

    expect(proration.netAmount).toBe(proration.chargeAmount - proration.creditAmount)
  })

  it('returns negative net for downgrades', async () => {
    // First upgrade to enterprise
    await manager.update(subscription.id, { planId: enterprisePlan.id })

    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const proration = await manager.calculateProration(subscription.id, {
      newPlanId: basePlan.id,
    })

    // Enterprise ($299) -> Pro ($49), should be negative (credit)
    expect(proration.netAmount).toBeLessThan(0)
  })

  it('includes proration items in result', async () => {
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const proration = await manager.calculateProration(subscription.id, {
      newPlanId: enterprisePlan.id,
    })

    expect(proration.items).toBeDefined()
    expect(proration.items).toHaveLength(2)
    expect(proration.items[0].type).toBe('credit')
    expect(proration.items[1].type).toBe('charge')
  })

  it('respects proration_behavior none', async () => {
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const updated = await manager.update(subscription.id, {
      planId: enterprisePlan.id,
      prorationBehavior: 'none',
    })

    // Should not generate proration invoice
    expect(updated.latestProration).toBeUndefined()
  })

  it('respects proration_behavior always_invoice', async () => {
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const onEvent = vi.fn()
    const manager = createSubscriptionManager({ plans, onEvent })

    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    await manager.update(subscription.id, {
      planId: enterprisePlan.id,
      prorationBehavior: 'always_invoice',
    })

    const invoiceEvents = onEvent.mock.calls.filter(
      ([event]) => event === 'invoice.created'
    )
    expect(invoiceEvents).toHaveLength(1)
  })
})

// ============================================================================
// Subscription Status Transitions
// ============================================================================

describe('subscription status transitions', () => {
  let manager: SubscriptionManager
  let subscription: Subscription

  beforeEach(async () => {
    manager = createSubscriptionManager({ plans })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))

    subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('supports trialing status', async () => {
    const sub = await manager.create({
      customerId: 'cus_trial',
      planId: basePlan.id,
      trialPeriodDays: 14,
    })

    expect(sub.status).toBe('trialing')
  })

  it('supports active status', async () => {
    expect(subscription.status).toBe('active')
  })

  it('supports paused status', async () => {
    const paused = await manager.pause(subscription.id)
    expect(paused.status).toBe('paused')
  })

  it('supports past_due status', async () => {
    // Simulate failed payment
    const updated = await manager.handlePaymentFailed(subscription.id, {
      invoiceId: 'inv_123',
      attemptCount: 1,
    })

    expect(updated.status).toBe('past_due')
  })

  it('supports canceled status', async () => {
    const cancelled = await manager.cancel(subscription.id, {
      cancelAtPeriodEnd: false,
    })

    expect(cancelled.status).toBe('canceled')
  })

  it('supports unpaid status after multiple failed payments', async () => {
    // Simulate multiple failed payments (exhausted retries)
    const updated = await manager.handlePaymentFailed(subscription.id, {
      invoiceId: 'inv_123',
      attemptCount: 4,
      retriesExhausted: true,
    })

    expect(updated.status).toBe('unpaid')
  })

  it('transitions active -> past_due on payment failure', async () => {
    expect(subscription.status).toBe('active')

    const updated = await manager.handlePaymentFailed(subscription.id, {
      invoiceId: 'inv_123',
      attemptCount: 1,
    })

    expect(updated.status).toBe('past_due')
  })

  it('transitions past_due -> active on successful payment', async () => {
    await manager.handlePaymentFailed(subscription.id, {
      invoiceId: 'inv_123',
      attemptCount: 1,
    })

    const updated = await manager.handlePaymentSucceeded(subscription.id, {
      invoiceId: 'inv_123',
    })

    expect(updated.status).toBe('active')
  })

  it('transitions trialing -> active at trial end', async () => {
    const trialSub = await manager.create({
      customerId: 'cus_trial',
      planId: basePlan.id,
      trialPeriodDays: 14,
    })

    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const result = await manager.processTrialEnd(trialSub.id)

    expect(result.subscription.status).toBe('active')
  })

  it('cannot transition from canceled to active', async () => {
    await manager.cancel(subscription.id, { cancelAtPeriodEnd: false })

    await expect(
      manager.update(subscription.id, { planId: enterprisePlan.id })
    ).rejects.toThrow(/cannot update canceled/i)
  })
})

// ============================================================================
// Renewal Processing Tests
// ============================================================================

describe('renewal processing', () => {
  let manager: SubscriptionManager
  let subscription: Subscription

  beforeEach(async () => {
    manager = createSubscriptionManager({ plans })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))

    subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renews subscription at period end', async () => {
    // Advance to period end
    vi.setSystemTime(new Date('2026-02-13T10:00:00Z'))

    const result = await manager.processRenewal(subscription.id)

    expect(result.renewed).toBe(true)
    expect(result.subscription.currentPeriodStart.getTime()).toBeGreaterThan(
      subscription.currentPeriodStart.getTime()
    )
  })

  it('updates billing period dates on renewal', async () => {
    vi.setSystemTime(new Date('2026-02-13T10:00:00Z'))

    const result = await manager.processRenewal(subscription.id)

    // New period should start around Feb 13
    expect(result.subscription.currentPeriodStart.getMonth()).toBe(1) // February
    expect(result.subscription.currentPeriodEnd.getMonth()).toBe(2) // March
  })

  it('generates invoice on renewal', async () => {
    const onEvent = vi.fn()
    const manager = createSubscriptionManager({ plans, onEvent })

    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    vi.setSystemTime(new Date('2026-02-13T10:00:00Z'))
    await manager.processRenewal(subscription.id)

    const invoiceEvents = onEvent.mock.calls.filter(
      ([event]) => event === 'invoice.created'
    )
    expect(invoiceEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('ends subscription if cancelAtPeriodEnd is true', async () => {
    await manager.cancel(subscription.id, { cancelAtPeriodEnd: true })

    vi.setSystemTime(new Date('2026-02-13T10:00:00Z'))

    const result = await manager.processRenewal(subscription.id)

    expect(result.renewed).toBe(false)
    expect(result.subscription.status).toBe('canceled')
    expect(result.subscription.endedAt).toBeInstanceOf(Date)
  })

  it('applies scheduled plan change on renewal', async () => {
    // First upgrade to enterprise
    await manager.update(subscription.id, { planId: enterprisePlan.id })

    // Schedule downgrade
    await manager.update(subscription.id, {
      planId: basePlan.id,
      prorationBehavior: 'none', // Will schedule for period end
    })

    const current = await manager.retrieve(subscription.id)
    expect(current.scheduledPlanChange?.planId).toBe(basePlan.id)

    // Process renewal
    vi.setSystemTime(new Date('2026-02-13T10:00:00Z'))
    const result = await manager.processRenewal(subscription.id)

    expect(result.subscription.planId).toBe(basePlan.id)
    expect(result.subscription.scheduledPlanChange).toBeUndefined()
  })

  it('does not renew paused subscription', async () => {
    await manager.pause(subscription.id)

    vi.setSystemTime(new Date('2026-02-13T10:00:00Z'))

    const result = await manager.processRenewal(subscription.id)

    expect(result.renewed).toBe(false)
    expect(result.subscription.status).toBe('paused')
  })

  it('does not renew if payment fails', async () => {
    vi.setSystemTime(new Date('2026-02-13T10:00:00Z'))

    // Simulate payment failure during renewal
    const result = await manager.processRenewal(subscription.id, {
      simulatePaymentFailure: true,
    })

    expect(result.renewed).toBe(false)
    expect(result.subscription.status).toBe('past_due')
    expect(result.failureReason).toBe('payment_failed')
  })

  it('includes renewal invoice in result', async () => {
    vi.setSystemTime(new Date('2026-02-13T10:00:00Z'))

    const result = await manager.processRenewal(subscription.id)

    expect(result.invoice).toBeDefined()
    expect(result.invoice?.amount).toBe(basePlan.price)
  })
})

// ============================================================================
// Event Emission Tests
// ============================================================================

describe('event emission', () => {
  it('emits subscription.created on create', async () => {
    const onEvent = vi.fn()
    const manager = createSubscriptionManager({ plans, onEvent })

    await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    expect(onEvent).toHaveBeenCalledWith(
      'subscription.created',
      expect.objectContaining({
        customerId: 'cus_123',
        planId: basePlan.id,
      })
    )
  })

  it('emits subscription.updated on plan change', async () => {
    const onEvent = vi.fn()
    const manager = createSubscriptionManager({ plans, onEvent })

    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    await manager.update(subscription.id, { planId: enterprisePlan.id })

    expect(onEvent).toHaveBeenCalledWith(
      'subscription.updated',
      expect.objectContaining({
        previousPlanId: basePlan.id,
        newPlanId: enterprisePlan.id,
      })
    )
  })

  it('emits subscription.canceled on cancel', async () => {
    const onEvent = vi.fn()
    const manager = createSubscriptionManager({ plans, onEvent })

    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    await manager.cancel(subscription.id)

    expect(onEvent).toHaveBeenCalledWith(
      'subscription.canceled',
      expect.objectContaining({
        subscriptionId: subscription.id,
      })
    )
  })

  it('emits subscription.paused on pause', async () => {
    const onEvent = vi.fn()
    const manager = createSubscriptionManager({ plans, onEvent })

    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    await manager.pause(subscription.id)

    expect(onEvent).toHaveBeenCalledWith(
      'subscription.paused',
      expect.objectContaining({
        subscriptionId: subscription.id,
      })
    )
  })

  it('emits subscription.resumed on resume', async () => {
    const onEvent = vi.fn()
    const manager = createSubscriptionManager({ plans, onEvent })

    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    await manager.pause(subscription.id)
    await manager.resume(subscription.id)

    expect(onEvent).toHaveBeenCalledWith(
      'subscription.resumed',
      expect.objectContaining({
        subscriptionId: subscription.id,
      })
    )
  })

  it('emits subscription.trial_will_end before trial ends', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))

    const onEvent = vi.fn()
    const manager = createSubscriptionManager({ plans, onEvent })

    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialPeriodDays: 7,
    })

    // Advance to 3 days before trial end
    vi.setSystemTime(new Date('2026-01-17T10:00:00Z'))
    await manager.checkTrialEnding(subscription.id)

    expect(onEvent).toHaveBeenCalledWith(
      'subscription.trial_will_end',
      expect.objectContaining({
        subscriptionId: subscription.id,
        daysRemaining: 3,
      })
    )

    vi.useRealTimers()
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('type safety', () => {
  it('SubscriptionStatus is union of valid statuses', () => {
    const statuses: SubscriptionStatus[] = [
      'trialing',
      'active',
      'paused',
      'past_due',
      'unpaid',
      'canceled',
    ]

    expect(statuses).toHaveLength(6)
  })

  it('Subscription has required properties', async () => {
    const manager = createSubscriptionManager({ plans })
    const subscription: Subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    expect('id' in subscription).toBe(true)
    expect('customerId' in subscription).toBe(true)
    expect('planId' in subscription).toBe(true)
    expect('status' in subscription).toBe(true)
    expect('currentPeriodStart' in subscription).toBe(true)
    expect('currentPeriodEnd' in subscription).toBe(true)
    expect('items' in subscription).toBe(true)
  })

  it('SubscriptionPlan has required properties', () => {
    const plan: SubscriptionPlan = basePlan

    expect('id' in plan).toBe(true)
    expect('name' in plan).toBe(true)
    expect('price' in plan).toBe(true)
    expect('currency' in plan).toBe(true)
    expect('interval' in plan).toBe(true)
  })

  it('ProrationResult has required properties', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'))

    const manager = createSubscriptionManager({ plans })
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    const proration: ProrationResult = await manager.calculateProration(
      subscription.id,
      { newPlanId: enterprisePlan.id }
    )

    expect('creditAmount' in proration).toBe(true)
    expect('chargeAmount' in proration).toBe(true)
    expect('netAmount' in proration).toBe(true)
    expect('items' in proration).toBe(true)

    vi.useRealTimers()
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  let manager: SubscriptionManager

  beforeEach(() => {
    manager = createSubscriptionManager({ plans })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('handles free plan subscription', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: freePlan.id,
    })

    expect(subscription.status).toBe('active')
    expect(subscription.items[0].price).toBe(0)
  })

  it('handles concurrent updates to same subscription', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
    })

    // Simulate concurrent updates
    const updatePromises = [
      manager.update(subscription.id, { metadata: { key: 'value1' } }),
      manager.update(subscription.id, { metadata: { key: 'value2' } }),
    ]

    // Both should complete without error (last write wins or conflict error)
    await expect(Promise.allSettled(updatePromises)).resolves.toBeDefined()
  })

  it('handles subscription with zero-day trial', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialPeriodDays: 0,
    })

    // Zero-day trial should be same as no trial
    expect(subscription.status).toBe('active')
    expect(subscription.trialEnd).toBeUndefined()
  })

  it('handles subscription with trial end in past', async () => {
    const pastDate = new Date('2026-01-01T10:00:00Z')

    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: basePlan.id,
      trialEnd: pastDate,
    })

    // Trial end in past should result in active status
    expect(subscription.status).toBe('active')
  })

  it('handles yearly to monthly plan change', async () => {
    const subscription = await manager.create({
      customerId: 'cus_123',
      planId: yearlyPlan.id,
    })

    const updated = await manager.update(subscription.id, {
      planId: basePlan.id,
    })

    // Should handle the different intervals correctly
    expect(updated.planId).toBe(basePlan.id)
  })

  it('handles multiple customers with subscriptions', async () => {
    const sub1 = await manager.create({
      customerId: 'cus_1',
      planId: basePlan.id,
    })

    const sub2 = await manager.create({
      customerId: 'cus_2',
      planId: enterprisePlan.id,
    })

    expect(sub1.customerId).not.toBe(sub2.customerId)
    expect(sub1.id).not.toBe(sub2.id)

    const retrieved1 = await manager.retrieve(sub1.id)
    const retrieved2 = await manager.retrieve(sub2.id)

    expect(retrieved1.planId).toBe(basePlan.id)
    expect(retrieved2.planId).toBe(enterprisePlan.id)
  })

  it('handles retrieve of non-existent subscription', async () => {
    await expect(
      manager.retrieve('sub_nonexistent')
    ).rejects.toThrow(/not found/i)
  })
})
