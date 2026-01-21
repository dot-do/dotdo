# @dotdo/experiments

A/B testing and feature experimentation for Durable Objects.

## Installation

```bash
npm install @dotdo/experiments
```

## Overview

`@dotdo/experiments` provides comprehensive experimentation capabilities for dotdo:

- **Feature Flags** - Gradual rollouts with user targeting rules
- **A/B Testing** - Experiment assignment with consistent bucketing
- **Statistical Analysis** - Significance testing, power calculations, and Bayesian methods
- **DO Storage** - Persistent tracking backend for Durable Objects

Built on top of `ai-experiments` primitives with DO-specific storage backends.

## Basic Usage

### Feature Flags

```typescript
import { createFlagManager } from '@dotdo/experiments'

// In your Durable Object
const flags = createFlagManager(this.state.storage)

// Create a flag with targeting rules
await flags.create({
  key: 'new-checkout',
  name: 'New Checkout Flow',
  enabled: true,
  type: 'boolean',
  defaultValue: false,
  rules: [
    {
      id: 'beta-users',
      conditions: [{ attribute: 'plan', operator: 'equals', value: 'beta' }],
      value: true,
      priority: 1,
    },
    {
      id: 'percentage-rollout',
      conditions: [],
      value: true,
      percentage: 10, // 10% of users
      priority: 2,
    },
  ],
})

// Evaluate flag for a user
const result = await flags.evaluate('new-checkout', {
  userId: 'user-123',
  attributes: { plan: 'beta' },
})

if (result.value) {
  // Show new checkout
}
```

### A/B Testing

```typescript
import { createAssignmentManager } from '@dotdo/experiments'

const manager = createAssignmentManager(this.state.storage)

// Define an experiment
const experiment = {
  id: 'signup-test',
  name: 'Signup Flow Test',
  active: true,
  variants: [
    { id: 'control', name: 'Original', weight: 50, isControl: true },
    { id: 'treatment', name: 'New Flow', weight: 50 },
  ],
}

// Assign user to a variant (sticky assignment)
const variant = await manager.assignVariant('user-123', experiment)
console.log(`User assigned to: ${variant.name}`)

// Check existing assignment
const existing = await manager.getAssignment('user-123', 'signup-test')
```

### Statistical Significance

```typescript
import { calculateSignificance } from '@dotdo/experiments'

const result = calculateSignificance({
  control: { conversions: 150, trials: 1000 },
  treatment: { conversions: 180, trials: 1000 },
})

console.log(`Significant: ${result.isSignificant}`)
console.log(`p-value: ${result.pValue}`)
console.log(`Effect size: ${(result.effectSize * 100).toFixed(1)}% improvement`)

if (result.isSignificant) {
  console.log('Treatment wins!')
}
```

### Results Tracking

```typescript
import { createResultsStore, createDOBackend } from '@dotdo/experiments'

// Track experiment results
const store = createResultsStore(this.state.storage)

// Record events
await store.recordExposure('signup-test', 'treatment')
await store.recordConversion('signup-test', 'treatment', 'user-123')
await store.recordMetric('signup-test', 'treatment', 45.2) // Revenue

// Get aggregated stats
const stats = await store.getStats('signup-test')
console.log(`Treatment conversion rate: ${stats.treatment.conversionRate}`)
```

## API Reference

### Feature Flags

#### `createFlagManager(storage, options?)`

Creates a feature flag manager.

- `storage` - DO storage instance
- `options.prefix` - Key prefix for flags (default: `'flag:'`)

**Methods:**

- `create(flag)` - Create or update a feature flag
- `get(key)` - Get a flag definition
- `list()` - List all flags
- `delete(key)` - Delete a flag
- `enable(key)` - Enable a flag
- `disable(key)` - Disable a flag
- `evaluate(key, context?)` - Evaluate a flag for a user context
- `evaluateAll(context?)` - Batch evaluate all flags

#### `FeatureFlag(storage, key, context?)`

Convenience function for simple boolean flag evaluation.

### Experiment Assignment

#### `createAssignmentManager(storage, options?)`

Creates an experiment assignment manager.

- `storage` - DO storage instance
- `options.prefix` - Key prefix (default: `'exp:assignment:'`)

**Methods:**

- `assignVariant(userId, experiment, context?)` - Assign user to variant (sticky)
- `getAssignment(userId, experimentId)` - Get existing assignment
- `forceAssign(userId, experimentId, variantId, context?)` - Override assignment
- `removeAssignment(userId, experimentId)` - Remove assignment
- `getExperimentAssignments(experimentId)` - Get all assignments for experiment
- `getUserAssignments(userId)` - Get all assignments for user
- `clearExperimentAssignments(experimentId)` - Clear all assignments

#### `assignVariant(userId, experimentId, variants)`

One-off variant assignment without persistence.

### Statistical Analysis

#### `calculateSignificance(input)`

Two-proportion z-test for conversion rate experiments.

```typescript
calculateSignificance({
  control: { conversions: number; trials: number },
  treatment: { conversions: number; trials: number },
  confidenceLevel?: number, // Default: 0.95
})
```

**Returns:** `SignificanceResult` with `isSignificant`, `pValue`, `effectSize`, etc.

#### `calculateMetricSignificance(input)`

T-test for continuous metrics.

```typescript
calculateMetricSignificance({
  control: { mean: number; stdDev: number; n: number },
  treatment: { mean: number; stdDev: number; n: number },
  confidenceLevel?: number,
})
```

#### `calculateSampleSize(baselineRate, mde, power?, confidence?)`

Calculate required sample size per variant.

#### `calculatePower(p1, p2, n1, n2, confidence?)`

Calculate statistical power given sample sizes.

#### `checkEarlyStopping(input)`

Sequential analysis for early stopping decisions.

#### `bayesianProbability(input)`

Bayesian probability that treatment beats control using Beta-Binomial conjugate prior.

### Storage Backend

#### `createDOBackend(storage, options?)`

Create a DO-backed tracking backend.

- `options.prefix` - Event key prefix (default: `'exp:event:'`)
- `options.maxEvents` - Max events to keep (default: `10000`)
- `options.batchSize` - Batch size before auto-flush (default: `100`)

**Methods:**

- `track(event)` - Track an event
- `flush()` - Flush pending events
- `getEvents(experimentId?)` - Query events
- `clear()` - Clear all events

#### `createResultsStore(storage, options?)`

Create an experiment results store for aggregated stats.

**Methods:**

- `recordExposure(experimentId, variantId)` - Record exposure
- `recordConversion(experimentId, variantId, userId?)` - Record conversion
- `recordMetric(experimentId, variantId, value)` - Record metric value
- `getStats(experimentId)` - Get computed stats per variant
- `clear(experimentId)` - Clear results

## Types

Key types exported from the package:

- `FeatureFlagDefinition` - Flag configuration
- `FeatureFlagRule` - Targeting rule
- `FeatureFlagCondition` - Rule condition
- `EvaluationContext` - User context for evaluation
- `EvaluationResult<T>` - Flag evaluation result
- `ExperimentDefinition` - Experiment configuration
- `ExperimentVariantDefinition` - Variant configuration
- `Assignment` - User-variant assignment
- `ExperimentEvent` - Tracking event
- `VariantStats` - Aggregated variant statistics
- `SignificanceResult` - Statistical analysis result
- `ExperimentStorage` - Storage interface

## License

MIT
