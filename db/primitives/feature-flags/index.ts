/**
 * Feature Flags Primitive
 *
 * Feature flag system with targeting rules, gradual rollouts, A/B testing.
 * Percentage-based, user attribute targeting.
 *
 * Components:
 * - FlagEvaluator - Fast flag evaluation with caching
 * - FlagDefinition - Feature flag definition with variants
 * - TargetingRule - Targeting rules based on user attributes
 * - EvaluationContext - User context for evaluation
 * - FlagStore - Flag storage with versioning and audit trail
 * - PercentageBucketing - Consistent hashing for rollouts
 * - RuleEvaluator - Targeting rule evaluation
 * - FlagAnalytics - Exposure tracking and evaluation metrics
 *
 * A/B Testing Components:
 * - ExperimentStore - Experiment definition and management
 * - ExperimentTracker - Variant assignment logging
 * - ConversionTracker - Conversion event tracking
 * - Statistics - Statistical significance helpers
 *
 * Unlocks:
 * - LaunchDarkly compat integration
 * - Statsig compat integration
 * - PostHog compat integration
 */
export * from './evaluator'
export * from './flag-store'
export * from './percentage-bucketing'
export * from './rule-evaluator'
export * from './analytics'
export * from './experiment'
export * from './experiment-tracker'
export * from './conversion-tracker'
export * from './statistics'
export * from './experiment-tracking'
