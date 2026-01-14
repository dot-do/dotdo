/**
 * @dotdo/flags - Feature Flags Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for LaunchDarkly SDK backed by Durable Objects
 * with edge-native performance and zero cold start impact.
 *
 * Features:
 * - API-compatible with LaunchDarkly Node SDK
 * - Boolean, string, number, JSON flag types
 * - User targeting with attributes
 * - Percentage rollouts
 * - Rule-based targeting (equals, contains, regex, semver)
 * - A/B experiments with variants
 * - Flag dependencies (prerequisites)
 * - Primitives integration (TemporalStore, WindowManager)
 *
 * @example Basic Usage
 * ```typescript
 * import { createClient, type LDUser } from '@dotdo/flags'
 *
 * const client = createClient('sdk-key-123')
 *
 * const user: LDUser = {
 *   key: 'user-123',
 *   email: 'alice@example.com',
 *   custom: { plan: 'premium' },
 * }
 *
 * // Boolean flag
 * const enabled = await client.variation('feature-enabled', user, false)
 *
 * // String flag
 * const color = await client.stringVariation('button-color', user, 'gray')
 *
 * // JSON flag
 * const config = await client.jsonVariation('app-config', user, { theme: 'light' })
 * ```
 *
 * @example User Targeting
 * ```typescript
 * import { createTestClient } from '@dotdo/flags'
 *
 * const client = createTestClient({
 *   flags: {
 *     'enterprise-feature': {
 *       value: false,
 *       rules: [
 *         {
 *           clauses: [
 *             { attribute: 'plan', op: 'in', values: ['enterprise', 'business'] },
 *           ],
 *           variation: 0,
 *         },
 *       ],
 *       variations: [true, false],
 *     },
 *   },
 * })
 *
 * // Premium users get the feature
 * const premiumUser = { key: 'u1', custom: { plan: 'enterprise' } }
 * const result = await client.variation('enterprise-feature', premiumUser, false)
 * // result === true
 * ```
 *
 * @example Percentage Rollouts
 * ```typescript
 * const client = createTestClient({
 *   flags: {
 *     'gradual-rollout': {
 *       value: false,
 *       fallthrough: {
 *         rollout: {
 *           variations: [
 *             { variation: 0, weight: 20000 }, // 20% get true
 *             { variation: 1, weight: 80000 }, // 80% get false
 *           ],
 *         },
 *       },
 *       variations: [true, false],
 *     },
 *   },
 * })
 *
 * // Same user always gets same result (deterministic)
 * const user = { key: 'user-123' }
 * const result = await client.variation('gradual-rollout', user, false)
 * ```
 *
 * @example A/B Experiments
 * ```typescript
 * const client = createTestClient({
 *   flags: {
 *     'checkout-experiment': {
 *       value: 'control',
 *       trackEvents: true,
 *       fallthrough: {
 *         rollout: {
 *           kind: 'experiment',
 *           variations: [
 *             { variation: 0, weight: 50000 },
 *             { variation: 1, weight: 50000 },
 *           ],
 *         },
 *       },
 *       variations: ['control', 'variant-a'],
 *     },
 *   },
 * })
 *
 * const user = { key: 'user-123' }
 * const detail = await client.variationDetail('checkout-experiment', user, 'control')
 *
 * if (detail.reason.inExperiment) {
 *   console.log(`User is in experiment with variant: ${detail.value}`)
 * }
 * ```
 *
 * @example With History and Analytics
 * ```typescript
 * const client = createTestClient({
 *   flags: { 'feature': { value: true } },
 *   enableHistory: true,
 *   enableAnalytics: true,
 * })
 *
 * // Evaluate flag
 * await client.variation('feature', { key: 'user-123' }, false)
 *
 * // Get history
 * const history = await client.getEvaluationHistory('feature', 'user-123')
 *
 * // Get stats
 * const stats = await client.getEvaluationStats('feature')
 * console.log(`Total evaluations: ${stats.totalEvaluations}`)
 * ```
 *
 * @see https://docs.launchdarkly.com/sdk/server-side/node-js
 */

// =============================================================================
// Core Client
// =============================================================================

export {
  // Client class
  LDClient,

  // Factory functions
  createClient,
  createTestClient,

  // Global state
  setGlobalClient,
  getGlobalClient,
  _clear,
} from './client'

// =============================================================================
// Evaluation Engine
// =============================================================================

export {
  // Core evaluation
  evaluateFlag,
  evaluateFlagSafe,

  // Context helpers
  normalizeContext,
  getContextKey,
  getContextAttribute,

  // Bucketing
  getBucketValue,
  selectVariation,

  // Types
  type EvaluationContext,
} from './evaluation'

// =============================================================================
// Targeting Rules
// =============================================================================

export {
  // Clause evaluation
  evaluateClause,

  // Rule helpers
  createRule,
  createRuleWithClauses,
  createRolloutRule,
} from './targeting'

// =============================================================================
// Experiments
// =============================================================================

export {
  // Assignment
  assignExperimentVariant,

  // Events
  createExposureEvent,
  createConversionEvent,
  type ExperimentExposureEvent,
  type ExperimentConversionEvent,

  // Metrics
  createVariantMetrics,
  createExperimentMetrics,
  recordExposure,
  recordConversion,
  type VariantMetrics,
  type ExperimentMetrics,

  // Analysis
  calculateExperimentStats,
  isStatisticallySignificant,
  type VariantStats,

  // Helpers
  isExperimentFlag,
  createExperimentFromFlag,
} from './experiments'

// =============================================================================
// Types
// =============================================================================

export type {
  // Flag values
  LDFlagValue,
  LDFlagSet,

  // User and context
  LDUser,
  LDUserBuiltIn,
  LDContext,
  LDSingleKindContext,
  LDMultiKindContext,

  // Evaluation
  LDEvaluationDetail,
  LDEvaluationReason,
  LDEvaluationReasonKind,
  LDErrorKind,

  // Flag definitions
  FeatureFlag,
  FlagVariation,
  FlagRule,
  Clause,
  ClauseOperator,
  Target,
  Prerequisite,
  VariationOrRollout,
  RolloutConfig,
  WeightedVariation,
  ClientSideAvailability,

  // Experiments
  Experiment,
  ExperimentVariant,
  ExperimentResult,

  // Events
  FeatureEvent,
  CustomEvent,
  IdentifyEvent,
  SummaryEvent,
  FeatureSummary,
  FeatureCounter,
  LDEvent,

  // Client options
  LDOptions,
  LDAllFlagsStateOptions,
  LDFlagsState,
  FlagMetadata,

  // Client events
  LDClientEvent,
  LDEventCallback,
  UpdateEvent,
  ErrorEvent,

  // Analytics
  EvaluationStats,
  EvaluationRecord,

  // Testing
  TestClientOptions,
} from './types'

// =============================================================================
// Default Export
// =============================================================================

export { LDClient as default } from './client'
