# @dotdo/business

Business-as-Code implementation for dotdo. The Business class extends DO (Durable Object) with everything needed to run a business: analytics, financial operations, experiments, feature flags, and OKRs with automatic metric tracking.

## Installation

```bash
npm install @dotdo/business
```

## Basic Usage

```typescript
import { Business } from '@dotdo/business'

export class MyBusiness extends Business {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      finance: { stripeApiKey: env.STRIPE_API_KEY },
      analytics: { enabled: true }
    })
  }
}
```

### OKRs with Automatic Metric Tracking

```typescript
// Define OKRs with bound metrics
const $ = this.metrics
await this.goals
  .objective('Double Revenue')
  .keyResult('$200K MRR', { target: 200000, metric: $.mrr })
  .keyResult('2000 customers', { target: 2000, metric: $.customers.paying })
  .period('Q2-2024')
  .save()

// Track progress automatically
const progress = await this.goals.progress('Double Revenue')
// { overall: 0.65, status: 'on-track', keyResults: [...] }
```

### Aggregations with Fluent API

```typescript
// Query with elegant aggregation syntax
const revenue = await this.aggregate
  .sum('amount')
  .from('purchases')
  .where({ status: 'completed' })
  .by('day')
  .last(30, 'days')

// Or use template literal syntax
const sales = await this.agg`
  sum(amount) from purchases
  where status = 'completed'
  by product
  last 7 days
`
```

### Experiments

```typescript
// Create an experiment
await this.experiments.create({
  key: 'pricing-test',
  name: 'Pricing Test',
  variants: [
    { key: 'control', name: 'Control', weight: 50, isControl: true },
    { key: 'high-price', name: 'High Price', weight: 50 }
  ],
  targetMetric: 'conversion_rate'
})

// Assign users to variants
const variant = await this.experiments.assign('pricing-test', userId)
if (variant.key === 'high-price') {
  // Show higher prices
}
```

### Feature Flags

```typescript
// Create a feature flag
await this.flags.create({
  key: 'new-checkout',
  name: 'New Checkout Flow',
  enabled: true,
  rolloutPercentage: 25  // 25% of users
})

// Check if enabled for a user
if (await this.flags.isEnabled('new-checkout', userId)) {
  // Show new checkout
}
```

### Financial Operations

```typescript
// Create a customer and subscription
const customer = await this.finance.customers.create({
  email: 'alice@example.com',
  name: 'Alice'
})

const subscription = await this.finance.subscriptions.create({
  customerId: customer.id,
  priceId: 'price_xxx'
})

// Get SaaS metrics
const metrics = await this.finance.metrics.getSaaSMetrics()
console.log(`MRR: $${metrics.mrr / 100}`)
```

## API Overview

### Business Class

The main class that extends `DO` with business capabilities.

| Property | Description |
|----------|-------------|
| `goals` | OKR management with fluent builder API |
| `aggregate` | Fluent query builder for analytics |
| `agg` | Template literal aggregation queries |
| `metrics` | Chainable metric references for OKRs |
| `experiments` | A/B testing and experiment management |
| `flags` | Feature flag management with rollouts |
| `finance` | Financial operations (Stripe) |
| `analytics` | Analytics tracking (ClickHouse) |

### Goals API

```typescript
goals.objective(name)           // Start building an objective
goals.createObjective(data)     // Create from data
goals.list(period?)             // List objectives
goals.progress(nameOrId)        // Get progress for objective
goals.updateObjective(id, data) // Update an objective
goals.recommendations()         // AI recommendations for at-risk OKRs
```

### Aggregate Builder

```typescript
aggregate.sum(field)            // Sum aggregation
aggregate.count(field?)         // Count aggregation
aggregate.avg(field)            // Average aggregation
aggregate.min(field)            // Minimum aggregation
aggregate.max(field)            // Maximum aggregation
aggregate.distinct(field)       // Count distinct values
aggregate.from(collection)      // Specify collection
aggregate.where(conditions)     // Filter conditions
aggregate.by(field)             // Group by field
aggregate.last(n, unit)         // Time range filter
aggregate.all()                 // Execute and return all
aggregate.value()               // Execute and return single value
```

### Experiments API

```typescript
experiments.create(data)                    // Create experiment
experiments.get(key)                        // Get by key
experiments.list()                          // List all experiments
experiments.assign(key, userId)             // Assign user to variant
experiments.getVariant(key, userId)         // Get assigned variant
experiments.updateStatus(key, status)       // Update status
experiments.results(key)                    // Get experiment results
```

### Flags API

```typescript
flags.create(data)                          // Create feature flag
flags.get(key)                              // Get by key
flags.list()                                // List all flags
flags.isEnabled(key, userId?)               // Check if enabled
flags.update(key, data)                     // Update flag
flags.delete(key)                           // Delete flag
```

### Configuration

```typescript
interface BusinessConfig {
  backend?: 'db4' | 'sqlite' | 'postgres'
  analytics?: {
    enabled?: boolean
    profile?: 'minimal' | 'standard' | 'full'
    r2?: R2Bucket
  }
  finance?: {
    enabled?: boolean
    stripeApiKey?: string
    webhookSecret?: string
  }
  experiments?: {
    enabled?: boolean
    autoAssign?: boolean
  }
  okrs?: {
    enabled?: boolean
    aiRecommendations?: boolean
  }
}
```

## Types

Key types exported from the package:

- `BusinessConfig` - Configuration options
- `Product`, `Service`, `ServicePricing` - Product/service entities
- `Experiment`, `Variant`, `ExperimentAssignment` - Experiment types
- `FeatureFlag` - Feature flag type
- `Objective`, `KeyResult`, `OKRPeriod` - OKR types
- `BusinessMetrics`, `BusinessEvent`, `BusinessEventType` - Metrics types

## License

MIT
