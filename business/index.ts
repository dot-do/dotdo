/**
 * @dotdo/business - Business-as-Code
 *
 * The Business class extends DO with everything needed to run a business:
 * - Products & Services with analytics
 * - Financial operations (Stripe)
 * - Experiments & Feature Flags
 * - Goals/OKRs with automatic metric tracking
 * - Elegant aggregation syntax
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { Business } from '@dotdo/business'
 *
 * export class MyBusiness extends Business {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env, {
 *       finance: { stripeApiKey: env.STRIPE_API_KEY },
 *       analytics: { enabled: true }
 *     })
 *   }
 * }
 *
 * // Usage in the DO
 *
 * // 1. Define OKRs with automatic metric tracking
 * const $ = this.metrics
 * await this.goals
 *   .objective('Double Revenue')
 *   .keyResult('$200K MRR', { target: 200000, metric: $.mrr })
 *   .keyResult('2000 customers', { target: 2000, metric: $.customers.paying })
 *   .period('Q2-2024')
 *   .save()
 *
 * // 2. Track progress automatically from bound metrics
 * const progress = await this.goals.progress('Double Revenue')
 * // { overall: 0.65, status: 'on-track', keyResults: [...] }
 *
 * // 3. Query with elegant aggregation syntax
 * const revenue = await this.aggregate
 *   .sum('amount')
 *   .from('purchases')
 *   .by('day')
 *   .last(30, 'days')
 *
 * // 4. Or use template literal syntax
 * const sales = await this.query`
 *   sum(amount) from purchases
 *   where status = 'completed'
 *   by product
 *   last 7 days
 * `
 *
 * // 5. Run experiments
 * const variant = await this.experiments.assign('pricing-test', userId)
 * if (variant.key === 'high-price') {
 *   // Show higher prices
 * }
 *
 * // 6. Use feature flags
 * if (await this.flags.isEnabled('new-checkout', userId)) {
 *   // Show new checkout
 * }
 *
 * // 7. Get AI recommendations for at-risk OKRs
 * const recommendations = await this.goals.recommendations()
 * // [{ objective: 'Double Revenue', risk: 'MRR growth slowing', suggestions: [...] }]
 * ```
 */

// =============================================================================
// Core
// =============================================================================

export { Business, GoalsAPI, AggregateBuilder, type MetricRef } from './business'

// =============================================================================
// Types
// =============================================================================

export type {
  // Config
  BusinessConfig,

  // Entities
  Product,
  Service,
  ServicePricing,

  // Experiments
  Experiment,
  Variant,
  ExperimentAssignment,

  // Feature Flags
  FeatureFlag,

  // OKRs
  Objective,
  KeyResult,
  OKRPeriod,

  // Metrics
  BusinessMetrics,
  BusinessEvent,
  BusinessEventType,
  DateRange
} from './types'

// =============================================================================
// Re-export Finance
// =============================================================================

export * from '@dotdo/business-finance'
