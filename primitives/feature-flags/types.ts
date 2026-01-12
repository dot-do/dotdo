/**
 * Feature Flags Types
 * Comprehensive type definitions for the feature flag system
 */

/**
 * Possible values a flag can return
 */
export type FlagValue = boolean | string | number | object

/**
 * Variant definition for multi-variant experiments
 */
export interface Variant {
  /** Unique key for the variant */
  key: string
  /** The value returned when this variant is selected */
  value: FlagValue
  /** Weight for random distribution (0-100) */
  weight: number
}

/**
 * Operators for targeting rules
 */
export type TargetingOperator =
  | 'eq' // equals
  | 'neq' // not equals
  | 'gt' // greater than
  | 'gte' // greater than or equal
  | 'lt' // less than
  | 'lte' // less than or equal
  | 'in' // in array
  | 'nin' // not in array
  | 'contains' // string contains
  | 'startsWith' // string starts with
  | 'endsWith' // string ends with
  | 'matches' // regex match
  | 'semverGt' // semver greater than
  | 'semverLt' // semver less than
  | 'semverEq' // semver equals

/**
 * Single targeting condition
 */
export interface TargetingRule {
  /** Attribute name to evaluate (supports dot notation) */
  attribute: string
  /** Comparison operator */
  operator: TargetingOperator
  /** Value(s) to compare against */
  values: unknown[]
}

/**
 * Schedule for time-based flag activation
 */
export interface Schedule {
  /** Start time (ISO 8601) */
  start?: string
  /** End time (ISO 8601) */
  end?: string
  /** Timezone for evaluation */
  timezone?: string
}

/**
 * Rollout configuration for gradual releases
 */
export interface RolloutConfig {
  /** Percentage of users to include (0-100) */
  percentage: number
  /** Cohort/segment to target */
  cohort?: string
  /** Time-based schedule */
  schedule?: Schedule
  /** Sticky bucketing key (default: userId) */
  bucketBy?: string
}

/**
 * Flag rule combining conditions with result
 */
export interface FlagRule {
  /** Rule identifier */
  id?: string
  /** Conditions that must all match (AND) */
  conditions: TargetingRule[]
  /** Alternative condition groups (OR between groups) */
  conditionGroups?: TargetingRule[][]
  /** Percentage rollout for matched users */
  percentage?: number
  /** Variant to serve if rule matches */
  variant?: string
  /** Direct value to return if no variant */
  value?: FlagValue
  /** Priority (lower = higher priority) */
  priority?: number
  /** Whether rule is enabled */
  enabled?: boolean
}

/**
 * Complete feature flag definition
 */
export interface FeatureFlag {
  /** Unique flag key */
  key: string
  /** Human-readable name */
  name?: string
  /** Description of the flag's purpose */
  description?: string
  /** Whether flag is globally enabled */
  enabled: boolean
  /** Rules for conditional evaluation (evaluated in order) */
  rules?: FlagRule[]
  /** Available variants for experiments */
  variants?: Variant[]
  /** Default value when no rules match */
  defaultValue: FlagValue
  /** Global rollout configuration */
  rollout?: RolloutConfig
  /** Flag type hint */
  type?: 'boolean' | 'string' | 'number' | 'json'
  /** Tags for organization */
  tags?: string[]
  /** Creation timestamp */
  createdAt?: string
  /** Last modified timestamp */
  updatedAt?: string
}

/**
 * Context for flag evaluation
 */
export interface EvaluationContext {
  /** Unique user identifier */
  userId?: string
  /** Session identifier */
  sessionId?: string
  /** User attributes for targeting */
  attributes?: Record<string, unknown>
  /** Current timestamp (ISO 8601, defaults to now) */
  timestamp?: string
  /** Custom properties */
  [key: string]: unknown
}

/**
 * Result of flag evaluation with metadata
 */
export interface EvaluationResult<T extends FlagValue = FlagValue> {
  /** The evaluated value */
  value: T
  /** Which variant was selected (if applicable) */
  variant?: string
  /** Which rule matched (if applicable) */
  ruleId?: string
  /** Whether the flag was found */
  flagFound: boolean
  /** Reason for the evaluation result */
  reason:
    | 'FLAG_DISABLED'
    | 'RULE_MATCH'
    | 'PERCENTAGE_ROLLOUT'
    | 'VARIANT_SELECTED'
    | 'DEFAULT_VALUE'
    | 'OVERRIDE'
    | 'SCHEDULED'
    | 'FLAG_NOT_FOUND'
    | 'ERROR'
  /** Error message if evaluation failed */
  error?: string
}

/**
 * Override for specific users/sessions
 */
export interface FlagOverride {
  /** Flag key to override */
  flagKey: string
  /** User ID for user-specific override */
  userId?: string
  /** Session ID for session-specific override */
  sessionId?: string
  /** The override value */
  value: FlagValue
  /** Expiration time (ISO 8601) */
  expiresAt?: string
}

/**
 * Cohort definition for targeting
 */
export interface Cohort {
  /** Unique cohort identifier */
  id: string
  /** Human-readable name */
  name: string
  /** Rules that define cohort membership */
  rules: TargetingRule[]
  /** Static list of user IDs */
  userIds?: string[]
}

/**
 * Configuration for the feature flag client
 */
export interface FeatureFlagConfig {
  /** Function to fetch flags */
  flagSource?: () => Promise<FeatureFlag[]> | FeatureFlag[]
  /** Initial flags */
  flags?: FeatureFlag[]
  /** Initial overrides */
  overrides?: FlagOverride[]
  /** Cohort definitions */
  cohorts?: Cohort[]
  /** Default evaluation context */
  defaultContext?: EvaluationContext
  /** Cache TTL in milliseconds */
  cacheTtl?: number
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Event emitted during flag evaluation
 */
export interface FlagEvaluationEvent {
  flagKey: string
  context: EvaluationContext
  result: EvaluationResult
  timestamp: string
}

/**
 * Listener for flag events
 */
export type FlagEventListener = (event: FlagEvaluationEvent) => void
