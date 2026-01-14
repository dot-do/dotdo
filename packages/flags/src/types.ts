/**
 * @dotdo/flags - Type Definitions
 *
 * LaunchDarkly-compatible type definitions for feature flags.
 */

// =============================================================================
// Flag Value Types
// =============================================================================

/**
 * Possible types for a flag value
 */
export type LDFlagValue = boolean | string | number | LDFlagValue[] | { [key: string]: LDFlagValue }

/**
 * A set of flag key-value pairs
 */
export type LDFlagSet = Record<string, LDFlagValue>

// =============================================================================
// User and Context Types
// =============================================================================

/**
 * Built-in user attributes
 */
export interface LDUserBuiltIn {
  key: string
  secondary?: string
  ip?: string
  country?: string
  email?: string
  firstName?: string
  lastName?: string
  avatar?: string
  name?: string
  anonymous?: boolean
}

/**
 * User object for flag evaluation
 */
export interface LDUser extends LDUserBuiltIn {
  custom?: Record<string, LDFlagValue>
  privateAttributeNames?: string[]
}

/**
 * Single-kind context
 */
export interface LDSingleKindContext {
  kind: string
  key: string
  name?: string
  anonymous?: boolean
  [attribute: string]: LDFlagValue | undefined
}

/**
 * Multi-kind context with multiple context kinds
 */
export interface LDMultiKindContext {
  kind: 'multi'
  [contextKind: string]: LDSingleKindContext | 'multi'
}

/**
 * Context for flag evaluation (single or multi-kind)
 */
export type LDContext = LDUser | LDSingleKindContext | LDMultiKindContext

// =============================================================================
// Evaluation Types
// =============================================================================

/**
 * Reason kinds for evaluation results
 */
export type LDEvaluationReasonKind =
  | 'OFF'
  | 'FALLTHROUGH'
  | 'TARGET_MATCH'
  | 'RULE_MATCH'
  | 'PREREQUISITE_FAILED'
  | 'ERROR'

/**
 * Error kinds for evaluation errors
 */
export type LDErrorKind =
  | 'CLIENT_NOT_READY'
  | 'FLAG_NOT_FOUND'
  | 'MALFORMED_FLAG'
  | 'USER_NOT_SPECIFIED'
  | 'WRONG_TYPE'
  | 'EXCEPTION'

/**
 * Reason for a flag evaluation result
 */
export interface LDEvaluationReason {
  kind: LDEvaluationReasonKind
  ruleIndex?: number
  ruleId?: string
  prerequisiteKey?: string
  errorKind?: LDErrorKind
  inExperiment?: boolean
}

/**
 * Detailed evaluation result
 */
export interface LDEvaluationDetail<T = LDFlagValue> {
  value: T
  variationIndex: number | null
  reason: LDEvaluationReason
}

// =============================================================================
// Flag Definition Types
// =============================================================================

/**
 * Targeting clause operators
 */
export type ClauseOperator =
  | 'in'
  | 'endsWith'
  | 'startsWith'
  | 'matches'
  | 'contains'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'before'
  | 'after'
  | 'semVerEqual'
  | 'semVerLessThan'
  | 'semVerGreaterThan'
  | 'segmentMatch'

/**
 * A clause in a targeting rule
 */
export interface Clause {
  attribute: string
  op: ClauseOperator
  values: LDFlagValue[]
  negate?: boolean
  contextKind?: string
}

/**
 * A weighted variation in a rollout
 */
export interface WeightedVariation {
  variation: number
  weight: number
  untracked?: boolean
}

/**
 * Rollout configuration
 */
export interface RolloutConfig {
  kind?: 'rollout' | 'experiment'
  variations: WeightedVariation[]
  bucketBy?: string
  contextKind?: string
  seed?: number
}

/**
 * Variation or rollout for a rule/fallthrough
 */
export interface VariationOrRollout {
  variation?: number
  rollout?: RolloutConfig
}

/**
 * A targeting rule
 */
export interface FlagRule extends VariationOrRollout {
  id?: string
  clauses: Clause[]
  trackEvents?: boolean
}

/**
 * Target list for specific users
 */
export interface Target {
  values: string[]
  variation: number
  contextKind?: string
}

/**
 * Prerequisite flag requirement
 */
export interface Prerequisite {
  key: string
  variation: number
}

/**
 * Client-side availability configuration
 */
export interface ClientSideAvailability {
  usingEnvironmentId?: boolean
  usingMobileKey?: boolean
}

/**
 * Variation definition
 */
export type FlagVariation = LDFlagValue

/**
 * Complete feature flag definition
 */
export interface FeatureFlag {
  key?: string
  version?: number
  on?: boolean
  prerequisites?: Prerequisite[]
  targets?: Target[]
  contextTargets?: Target[]
  rules?: FlagRule[]
  fallthrough?: VariationOrRollout
  offVariation?: number
  variations?: FlagVariation[]
  value?: LDFlagValue // Simplified single-value flag
  clientSideAvailability?: ClientSideAvailability
  salt?: string
  trackEvents?: boolean
  trackEventsFallthrough?: boolean
  debugEventsUntilDate?: number
}

// =============================================================================
// Client Options Types
// =============================================================================

/**
 * Options for creating an LDClient
 */
export interface LDOptions {
  baseUri?: string
  streamUri?: string
  eventsUri?: string
  timeout?: number
  flushInterval?: number
  capacity?: number
  stream?: boolean
  offline?: boolean
  allAttributesPrivate?: boolean
  privateAttributes?: string[]
  sendEvents?: boolean
  diagnosticOptOut?: boolean
  wrapperName?: string
  wrapperVersion?: string
  application?: {
    id?: string
    version?: string
  }
}

/**
 * Options for allFlagsState
 */
export interface LDAllFlagsStateOptions {
  clientSideOnly?: boolean
  withReasons?: boolean
  detailsOnlyForTrackedFlags?: boolean
}

// =============================================================================
// All Flags State Types
// =============================================================================

/**
 * Flag metadata in allFlagsState
 */
export interface FlagMetadata {
  version?: number
  variation?: number
  reason?: LDEvaluationReason
  trackEvents?: boolean
  trackReason?: boolean
  debugEventsUntilDate?: number
}

/**
 * All flags state result
 */
export interface LDFlagsState {
  valid: boolean
  toJSON(): LDFlagSet & { $flagsState?: Record<string, FlagMetadata>; $valid?: boolean }
  getFlagValue(key: string): LDFlagValue | undefined
  getFlagReason(key: string): LDEvaluationReason | undefined
}

// =============================================================================
// Test Client Options
// =============================================================================

/**
 * Options for creating a test client
 */
export interface TestClientOptions {
  flags?: Record<string, Partial<FeatureFlag>>
}

// =============================================================================
// Client Event Types
// =============================================================================

/**
 * Event types emitted by the client
 */
export type LDClientEvent = 'ready' | 'update' | 'event' | 'error'

/**
 * Update event payload
 */
export interface UpdateEvent {
  key: string
}

/**
 * Error event payload
 */
export interface ErrorEvent {
  message: string
  code?: string
}

/**
 * Event callback signatures
 */
export type LDEventCallback<T = unknown> = (event: T) => void

// =============================================================================
// Event Types
// =============================================================================

/**
 * Base event properties
 */
export interface BaseEvent {
  creationDate: number
  user?: LDUser
  context?: LDContext
}

/**
 * Feature event (flag evaluation)
 */
export interface FeatureEvent extends BaseEvent {
  kind: 'feature'
  key: string
  value: LDFlagValue
  default: LDFlagValue
  variation?: number
  version?: number
  reason?: LDEvaluationReason
  prereqOf?: string
  trackEvents?: boolean
  debugEventsUntilDate?: number
}

/**
 * Custom event (track call)
 */
export interface CustomEvent extends BaseEvent {
  kind: 'custom'
  key: string
  data?: Record<string, LDFlagValue>
  metricValue?: number
}

/**
 * Identify event
 */
export interface IdentifyEvent extends BaseEvent {
  kind: 'identify'
}

/**
 * Flag store interface
 */
export interface FlagStore {
  get(key: string): FeatureFlag | undefined
  set(key: string, flag: FeatureFlag): void
  delete(key: string): void
  all(): Map<string, FeatureFlag>
}
