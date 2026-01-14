/**
 * @dotdo/flags - Feature Flags for Cloudflare Workers
 *
 * LaunchDarkly-compatible feature flags SDK with edge-native performance.
 *
 * Features:
 * - API-compatible with LaunchDarkly Node SDK
 * - Boolean, string, number, JSON flag types
 * - User targeting with attributes
 * - Percentage rollouts
 * - Rule-based targeting (equals, contains, regex, semver)
 * - A/B experiments with variants
 * - Flag dependencies (prerequisites)
 * - In-memory storage backend
 *
 * @example Basic Usage
 * ```typescript
 * import { createTestClient, type LDUser } from '@dotdo/flags'
 *
 * const client = createTestClient({
 *   flags: {
 *     'feature-enabled': { value: true },
 *     'button-color': { value: 'blue' },
 *   },
 * })
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
 * ```
 *
 * @example User Targeting
 * ```typescript
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
 */

// Initialize the clause evaluator to break circular dependency
import { setClauseEvaluator } from './evaluation'
import { evaluateClause } from './targeting'
setClauseEvaluator(evaluateClause)

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
} from './targeting'

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

  // Events
  FeatureEvent,
  CustomEvent,
  IdentifyEvent,

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

  // Testing
  TestClientOptions,

  // Store
  FlagStore,
} from './types'

// =============================================================================
// Default Export
// =============================================================================

export { LDClient as default } from './client'
