---
title: "$ Data API Design"
description: Documentation for plans
---

# $ Data API Design

> Business-as-Code data primitives for the solo founder building a one-person unicorn.

**Date:** 2026-01-11
**Status:** Approved
**Author:** Claude + Nathan

## Overview

The `$` magic proxy provides a unified, founder-native interface for all data operations. Rather than exposing technical primitives (metrics databases, event stores, stream processors), we expose **business concepts** that a solo founder thinks about daily.

## Design Principles

1. **Founder-native vocabulary** - "track", "measure", "experiment", "goal" not "metrics", "events", "A/B framework"
2. **Every hat** - The ICP wears product, engineering, marketing, sales, and ops hats simultaneously
3. **Progressive complexity** - Simple operations are one-liners, complex ones are still readable
4. **Integrated, not isolated** - All data APIs work with `$.on`, `$.every`, `$.do`, and entity proxies

## Namespace Summary

| Namespace | Founder Thinks | Technical Primitive |
|-----------|---------------|---------------------|
| `$.track` | "What are users doing?" | Events, behaviors, actions |
| `$.measure` | "How are we performing?" | Time-series, KPIs |
| `$.experiment` | "Is this working?" | A/B tests, variants |
| `$.goal` | "Are we on track?" | OKRs, targets |
| `$.stream` | "React to what's happening" | Real-time processing |
| `$.view` | "Current state of things" | Materialized snapshots |

## Detailed API Design

### 1. `$.track` - What Are Users Doing?

Track discrete events, actions, and behaviors.

```typescript
// =============================================================================
// WRITE: Track events
// =============================================================================

// Basic event tracking
$.track.Signup({ userId: 'u123', plan: 'pro', source: 'google' })
$.track.Purchase({ amount: 99, sku: 'widget-1', customerId: 'c456' })
$.track.PageView({ path: '/pricing', referrer: 'twitter.com' })

// With experiment attribution (automatic)
$.track.Signup({ userId }, { experiment: 'onboarding-v2' })

// Batch tracking
$.track.batch([
  { event: 'PageView', data: { path: '/home' } },
  { event: 'PageView', data: { path: '/pricing' } },
])

// =============================================================================
// READ: Query tracked events
// =============================================================================

// Counts
await $.track.Signup.count()                        // Total ever
await $.track.Signup.count().since('7d')            // Last 7 days
await $.track.Signup.count().since('7d').by('plan') // Grouped

// Filters
await $.track.Purchase
  .where({ amount: { gte: 100 } })
  .count()
  .since('month')

// Funnels
await $.track.funnel([
  $.step('PageView').where({ path: '/pricing' }),
  $.step('Signup'),
  $.step('Purchase'),
]).within('7d').by('source')

// Cohorts
await $.track.cohort({
  anchor: 'Signup',
  activity: 'Purchase',
  periods: 8,
  granularity: 'week',
}).by('plan')

// Raw events
await $.track.Signup.events().since('1h').limit(100)

// =============================================================================
// SUBSCRIBE: Real-time
// =============================================================================

$.track.Signup.subscribe(event => {
  console.log('New signup:', event)
})

$.track.Purchase.subscribe(
  event => slackNotify(`$${event.amount} purchase!`),
  { where: { amount: { gte: 1000 } } }
)
```

**Implementation:** TemporalStore for event log, SchemaEvolution for event schemas, TypedColumnStore for aggregations.

---

### 2. `$.measure` - How Are We Performing?

Measure quantities over time - revenue, health, performance.

```typescript
// =============================================================================
// WRITE: Record measurements
// =============================================================================

// Business metrics
$.measure.revenue(1000, { plan: 'pro', region: 'us' })
$.measure.mrr(50000)
$.measure.nps(42)
$.measure.churn(0.05)

// Operational metrics
$.measure.latency(23, { endpoint: '/api/users' })
$.measure.cpu(85, { host: 'web-01' })
$.measure.errors(1, { type: 'timeout' })

// Gauges (current value) vs Counters (increments)
$.measure.activeUsers.set(1234)      // Gauge
$.measure.requests.increment()        // Counter
$.measure.requests.increment(10)      // Counter with value

// =============================================================================
// READ: Query measurements
// =============================================================================

// Current/Latest
await $.measure.mrr.current()
await $.measure.cpu.current({ host: 'web-01' })

// Aggregations over time
await $.measure.revenue.sum().since('quarter')
await $.measure.revenue.sum().since('year').by('month')
await $.measure.latency.avg().since('1h')
await $.measure.latency.percentile(99).since('1h')

// Trends
await $.measure.mrr.trend().since('6mo')  // Returns slope, direction

// Comparisons
await $.measure.revenue.sum().since('week').vs('prev')  // WoW comparison

// =============================================================================
// ROLLUPS: Pre-computed aggregations
// =============================================================================

$.measure.revenue.rollup({
  granularity: ['hour', 'day', 'month'],
  aggregates: ['sum', 'count', 'avg'],
  retention: { raw: '7d', hour: '90d', day: '2y' },
})

// =============================================================================
// SUBSCRIBE: Real-time
// =============================================================================

$.measure.revenue.window('5m').subscribe(stats => {
  dashboard.update({ revenue5m: stats.sum })
})

// Alerts
$.measure.cpu.alert({
  condition: value => value > 90,
  for: '5m',
  notify: async () => await $.Slack('ops').post('High CPU!')
})
```

**Implementation:** TypedColumnStore with Gorilla codec for floats, Delta for timestamps, RLE for repeated values.

---

### 3. `$.experiment` - Is This Working?

Run experiments, test hypotheses, learn fast.

```typescript
// =============================================================================
// DEFINE: Set up experiments
// =============================================================================

$.experiment.define('pricing-page-v2', {
  variants: ['control', 'value-based', 'usage-based'],
  weights: [0.34, 0.33, 0.33],  // Optional, defaults to equal

  // What are we optimizing?
  goal: $.track.ratio('Purchase', 'PageView:/pricing'),

  // Who's in the experiment?
  audience: user => user.createdAt > '2024-01-01',

  // When does it end?
  duration: '14d',
  minSampleSize: 1000,
})

$.experiment.define('onboarding-flow', {
  variants: ['wizard', 'video', 'self-serve'],
  goal: $.track.ratio('Activate', 'Signup'),
  audience: user => user.plan === 'free',
})

// =============================================================================
// ASSIGN: Get variant for user
// =============================================================================

const variant = await $.experiment('pricing-page-v2').assign(userId)
// => 'value-based'

// Assignment is deterministic (same user always gets same variant)
// Uses MurmurHash for consistent hashing

// =============================================================================
// TRACK: Events are auto-attributed
// =============================================================================

// When you track with experiment context, attribution is automatic
$.track.Purchase({ userId, amount }, {
  experiment: 'pricing-page-v2'
})

// Or set experiment context for a session
$.experiment('pricing-page-v2').activate(userId)
// All subsequent $.track calls for this user include experiment

// =============================================================================
// RESULTS: Check how it's going
// =============================================================================

const results = await $.experiment('pricing-page-v2').results()
// {
//   status: 'running',
//   variants: {
//     'control':     { users: 1234, conversions: 98,  rate: 0.079 },
//     'value-based': { users: 1201, conversions: 142, rate: 0.118, lift: '+49%', pValue: 0.02 },
//     'usage-based': { users: 1189, conversions: 107, rate: 0.090, lift: '+14%', pValue: 0.21 },
//   },
//   winner: 'value-based',
//   confidence: 0.98,
//   canCall: true,  // Statistically significant
// }

// =============================================================================
// LIFECYCLE: Manage experiments
// =============================================================================

await $.experiment('pricing-page-v2').start()
await $.experiment('pricing-page-v2').pause()
await $.experiment('pricing-page-v2').stop()

// Graduate winner to 100%
await $.experiment('pricing-page-v2').graduate('value-based')

// List all experiments
const experiments = await $.experiment.list()
const active = await $.experiment.list({ status: 'running' })
```

**Implementation:** KeyedRouter for consistent variant assignment, ExactlyOnceContext for attribution, TemporalStore for experiment state.

---

### 4. `$.goal` - Are We On Track?

Define and track OKRs, targets, north star metrics.

```typescript
// =============================================================================
// DEFINE: Set goals
// =============================================================================

$.goal.define('Q1-revenue', {
  target: $.measure.revenue.sum().reach(100_000),
  by: '2024-03-31',
  owner: 'founder',
})

$.goal.define('activation-rate', {
  target: $.track.ratio('Activate', 'Signup').reach(0.4),
  // No deadline = evergreen goal
})

$.goal.define('pmf', {
  target: $.measure.nps.reach(50),
  by: '2024-06-30',
})

// Compound goals
$.goal.define('growth', {
  targets: [
    $.measure.mrr.reach(50_000),
    $.track.Signup.count().reach(1000),
    $.measure.churn.reach(0.02, { direction: 'below' }),
  ],
  by: '2024-Q2',
})

// =============================================================================
// PROGRESS: Check status
// =============================================================================

const progress = await $.goal('Q1-revenue').progress()
// {
//   current: 72000,
//   target: 100000,
//   percent: 72,
//   remaining: 28000,
//   daysLeft: 45,
//   onTrack: true,          // Projected to hit target
//   projectedValue: 108000, // At current rate
// }

// All goals
const goals = await $.goal.all().progress()

// =============================================================================
// ALERTS: Get notified
// =============================================================================

$.goal('Q1-revenue').alert({
  when: 'off-track',  // 'achieved', 'off-track', 'at-risk'
  notify: async (goal) => {
    await $.Slack('founders').post(`Goal at risk: ${goal.name}`)
  }
})

// =============================================================================
// HISTORY: Track over time
// =============================================================================

const history = await $.goal('activation-rate').history()
// [
//   { date: '2024-01-01', value: 0.25 },
//   { date: '2024-01-08', value: 0.28 },
//   { date: '2024-01-15', value: 0.32 },
//   ...
// ]
```

**Implementation:** TemporalStore for goal definitions and history, WindowManager for progress calculations.

---

### 5. `$.stream` - React to What's Happening

Real-time stream processing for reactive business logic.

```typescript
// =============================================================================
// SOURCE: Where data comes from
// =============================================================================

// From domain events (integrates with $.on)
$.stream.from.Order.created
$.stream.from.Customer.signup
$.stream.from['*'].created  // All 'created' events

// From tracked events
$.stream.from.track.Purchase
$.stream.from.track.PageView

// From measurements
$.stream.from.measure.revenue

// =============================================================================
// TRANSFORM: Process the stream
// =============================================================================

$.stream.from.Order.created
  .filter(order => order.total > 100)
  .map(order => ({
    customerId: order.customerId,
    amount: order.total,
    isHighValue: order.total > 1000,
  }))
  .enrich(async (order, $) => ({
    ...order,
    customer: await $.Customer(order.customerId).get(),
  }))

// =============================================================================
// WINDOW: Aggregate over time
// =============================================================================

$.stream.from.Order.created
  .keyBy('region')
  .window.tumbling('1h')
  .aggregate({
    orderCount: $.count(),
    revenue: $.sum('total'),
    avgOrder: $.avg('total'),
  })
  .to.measure.hourlyRevenue

// Window types
.window.tumbling('5m')           // Fixed non-overlapping
.window.sliding('1h', '5m')      // Overlapping
.window.session('30m')           // Gap-based sessions

// =============================================================================
// JOIN: Combine streams
// =============================================================================

const orders = $.stream.from.Order.created.keyBy('orderId')
const payments = $.stream.from.Payment.completed.keyBy('orderId')

orders.join(payments)
  .within('10m')
  .on((order, payment) => ({
    orderId: order.id,
    amount: order.total,
    paid: true,
    paymentMethod: payment.method,
  }))

// =============================================================================
// SINK: Where data goes
// =============================================================================

stream
  .to.track.ProcessedOrder        // Track as event
  .to.measure.processedRevenue    // Record measurement
  .to.view.orderSummary           // Update view
  .to.Customer(id).notify         // Trigger action
```

**Implementation:** WindowManager for windowing, WatermarkService for event-time, ExactlyOnceContext for exactly-once delivery, KeyedRouter for partitioning.

---

### 6. `$.view` - Current State of Things

Materialized views for fast reads of derived data.

```typescript
// =============================================================================
// DEFINE: Create views
// =============================================================================

$.view.define('leaderboard', {
  from: $.track.Purchase,
  groupBy: 'userId',
  compute: {
    totalSpent: $.sum('amount'),
    orderCount: $.count(),
    lastOrder: $.max('timestamp'),
  },
  orderBy: { totalSpent: 'desc' },
  limit: 100,
})

$.view.define('activeUsers', {
  from: $.track.PageView,
  where: event => event.timestamp > Date.now() - 30 * 60 * 1000,
  groupBy: 'userId',
  compute: {
    pageCount: $.count(),
    lastSeen: $.max('timestamp'),
  },
})

// Incremental maintenance
$.view.define('revenueByProduct', {
  from: $.stream.from.Order.created,
  groupBy: 'productId',
  compute: {
    revenue: $.sum('total'),
    units: $.sum('quantity'),
  },
  incremental: true,  // Updates on each event, not recomputed
})

// =============================================================================
// QUERY: Read views
// =============================================================================

// Full view
const leaderboard = await $.view.leaderboard.get()

// Filtered
const topSpenders = await $.view.leaderboard
  .where({ totalSpent: { gte: 1000 } })
  .limit(10)
  .get()

// Single key
const myStats = await $.view.leaderboard.get(userId)

// =============================================================================
// SUBSCRIBE: Real-time updates
// =============================================================================

$.view.leaderboard.subscribe(changes => {
  dashboard.updateLeaderboard(changes)
})

$.view.activeUsers.subscribe({
  onInsert: user => console.log('User became active:', user),
  onUpdate: (before, after) => console.log('User activity:', after),
  onDelete: user => console.log('User went inactive:', user),
})

// =============================================================================
// REFRESH: Manual control
// =============================================================================

await $.view.leaderboard.refresh()         // Full rebuild
await $.view.revenueByProduct.refresh({
  incremental: true,
  since: '1h',
})
```

**Implementation:** TypedColumnStore for columnar storage, ExactlyOnceContext for incremental updates, WindowManager for time-based views.

---

### 7. Entity Event Sourcing

Event sourcing on specific entities via the existing `$` entity proxy pattern.

```typescript
// =============================================================================
// APPEND: Record what happened
// =============================================================================

await $.Order(orderId).append('created', {
  customerId: 'c123',
  items: [{ sku: 'widget-1', qty: 2 }],
  total: 199,
})

await $.Order(orderId).append('paid', {
  paymentId: 'pay_456',
  method: 'card',
})

await $.Order(orderId).append('shipped', {
  trackingNumber: 'TRK123',
  carrier: 'fedex',
})

// =============================================================================
// STATE: Reconstruct current state
// =============================================================================

// Define how events reduce to state
$.aggregate('Order', {
  initial: () => ({
    items: [],
    status: 'pending',
    total: 0,
  }),

  reduce: {
    'Order.created': (state, event) => ({
      ...state,
      customerId: event.customerId,
      items: event.items,
      total: event.total,
      status: 'created',
    }),
    'Order.paid': (state, event) => ({
      ...state,
      status: 'paid',
      paymentId: event.paymentId,
    }),
    'Order.shipped': (state, event) => ({
      ...state,
      status: 'shipped',
      trackingNumber: event.trackingNumber,
    }),
  },

  // Snapshot every 100 events for performance
  snapshots: { every: 100 },
})

// Get current state
const order = await $.Order(orderId).state()
// { status: 'shipped', items: [...], total: 199, trackingNumber: 'TRK123', ... }

// =============================================================================
// EVENTS: Access history
// =============================================================================

const events = await $.Order(orderId).events()
// [
//   { type: 'Order.created', data: {...}, version: 1, timestamp: ... },
//   { type: 'Order.paid', data: {...}, version: 2, timestamp: ... },
//   { type: 'Order.shipped', data: {...}, version: 3, timestamp: ... },
// ]

// Time-travel
const stateYesterday = await $.Order(orderId).stateAt('2024-01-10')

// =============================================================================
// PROJECTIONS: Read models across entities
// =============================================================================

$.projection('OrdersByCustomer', {
  from: ['Order.*'],

  handle: {
    'Order.created': async (event, { upsert }) => {
      await upsert(`customer:${event.customerId}:orders`, (orders = []) => [
        ...orders,
        { orderId: event.orderId, status: 'created', createdAt: event.timestamp },
      ])
    },
    'Order.shipped': async (event, { upsert }) => {
      await upsert(`customer:${event.customerId}:orders`, orders =>
        orders.map(o => o.orderId === event.orderId
          ? { ...o, status: 'shipped' }
          : o
        )
      )
    },
  },
})

// Query projection
const customerOrders = await $.projection('OrdersByCustomer')
  .get(`customer:${customerId}:orders`)
```

**Implementation:** TemporalStore for event log and snapshots, SchemaEvolution for event schemas.

---

## Integration Patterns

### With `$.on` - Event Handlers

```typescript
$.on.Customer.signup(async (event) => {
  // Track the event
  $.track.Signup(event)

  // Record measurement
  $.measure.signups(1, { plan: event.plan })

  // Assign to experiment
  const variant = await $.experiment('onboarding-v2').assign(event.userId)

  // Trigger action based on variant
  await $.Customer(event.userId).startOnboarding(variant)
})
```

### With `$.every` - Scheduled Jobs

```typescript
$.every.hour(async () => {
  // Refresh views
  await $.view.leaderboard.refresh()

  // Roll up measurements
  await $.measure.revenue.rollup({ from: 'minute', to: 'hour' })
})

$.every.day.at('9am')(async () => {
  // Check goals
  const goals = await $.goal.all().progress()
  const atRisk = goals.filter(g => !g.onTrack)

  if (atRisk.length > 0) {
    await $.Slack('founders').post(`Goals at risk: ${atRisk.map(g => g.name)}`)
  }

  // Summarize experiments
  const experiments = await $.experiment.list({ status: 'running' })
  for (const exp of experiments) {
    const results = await $.experiment(exp.name).results()
    if (results.canCall) {
      await $.Slack('product').post(`Experiment ${exp.name} ready to call!`)
    }
  }
})
```

### With `$.do` - Durable Transactions

```typescript
await $.do(async () => {
  // All of these are atomic
  await $.Order(orderId).append('completed', data)
  await $.Inventory(sku).decrement(quantity)
  $.track.OrderCompleted({ orderId, amount })
  $.measure.revenue(amount, { product: sku })
})
```

---

## Primitives Mapping

| API | Primary Primitive | Secondary Primitives |
|-----|------------------|---------------------|
| `$.track` | TemporalStore | SchemaEvolution, TypedColumnStore |
| `$.measure` | TypedColumnStore | Gorilla/Delta codecs, WindowManager |
| `$.experiment` | KeyedRouter | ExactlyOnceContext, TemporalStore |
| `$.goal` | TemporalStore | WindowManager |
| `$.stream` | WindowManager | WatermarkService, KeyedRouter, ExactlyOnceContext |
| `$.view` | TypedColumnStore | ExactlyOnceContext, WindowManager |
| Entity events | TemporalStore | SchemaEvolution |

---

## Implementation Phases

### Phase 1: Core Write APIs
- `$.track` event ingestion
- `$.measure` metric recording
- Entity `.append()` for event sourcing

### Phase 2: Core Read APIs
- `$.track` queries (count, funnel)
- `$.measure` queries (sum, avg, percentile)
- Entity `.state()` reconstruction

### Phase 3: Real-time
- `$.stream` processing
- `$.view` materialization
- Subscriptions for all APIs

### Phase 4: Business Intelligence
- `$.experiment` full lifecycle
- `$.goal` tracking and alerts
- Dashboard integrations

---

## Open Questions

1. **Persistence layer** - Where does data live? DO storage, R2, D1, external?
2. **Multi-tenancy** - How do namespaces work for SaaS?
3. **Export** - How to get data out (S3, BigQuery, etc.)?
4. **Quotas/Limits** - Rate limiting, storage limits per tenant?

---

## Appendix: Example Startup

```typescript
import { Startup } from 'dotdo'

export class MyStartup extends Startup {
  async launch() {
    // Define success metrics
    $.goal.define('pmf', { target: $.measure.nps.reach(50) })
    $.goal.define('revenue', { target: $.measure.mrr.reach(100_000), by: '2024-Q2' })

    // Set up experiments
    $.experiment.define('pricing', {
      variants: ['monthly', 'annual', 'usage'],
      goal: $.track.ratio('Purchase', 'Signup'),
    })

    // Define views
    $.view.define('topCustomers', {
      from: $.track.Purchase,
      groupBy: 'customerId',
      compute: { ltv: $.sum('amount') },
      orderBy: { ltv: 'desc' },
      limit: 100,
    })

    // React to events
    $.on.Customer.signup(async (event) => {
      $.track.Signup(event)
      $.measure.signups(1)

      const variant = await $.experiment('pricing').assign(event.userId)
      await $.Customer(event.userId).showPricing(variant)
    })

    $.on.Customer.purchase(async (event) => {
      $.track.Purchase(event)
      $.measure.revenue(event.amount)

      await $.Customer(event.userId).append('purchased', event)
    })

    // Daily founder standup
    $.every.day.at('9am')(async () => {
      const goals = await $.goal.all().progress()
      const experiments = await $.experiment.list({ status: 'running' })

      await mark`
        Summarize our progress:
        Goals: ${JSON.stringify(goals)}
        Experiments: ${JSON.stringify(experiments)}
      `
    })
  }
}
```
