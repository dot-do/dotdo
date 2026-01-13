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
 *
 * Unlocks:
 * - LaunchDarkly compat integration
 * - Statsig compat integration
 * - PostHog compat integration
 */
export * from './evaluator'
