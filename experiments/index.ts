/**
 * @dotdo/experiments - A/B Testing and Feature Flags for Durable Objects
 *
 * This package provides comprehensive experimentation capabilities for dotdo:
 * - A/B testing with statistical significance
 * - Feature flags with user targeting
 * - Multi-armed bandit algorithms (Thompson Sampling, UCB, Epsilon-Greedy)
 * - Experiment bucketing and assignment persistence
 * - Integration with DO SQLite storage
 *
 * Built on top of `ai-experiments` primitives with DO-specific storage backends.
 *
 * @module @dotdo/experiments
 *
 * @example
 * ```typescript
 * import {
 *   createAssignmentManager,
 *   createFlagManager,
 *   calculateSignificance
 * } from '@dotdo/experiments'
 *
 * // Assign users to experiments
 * const manager = createAssignmentManager(storage)
 * const variant = await manager.assignVariant('user-123', experiment)
 *
 * // Calculate statistical significance
 * const significance = calculateSignificance({
 *   control: { conversions: 150, trials: 1000 },
 *   treatment: { conversions: 180, trials: 1000 },
 * })
 *
 * if (significance.isSignificant) {
 *   console.log(`Treatment wins! p-value: ${significance.pValue}`)
 * }
 * ```
 */

// Export DO-specific functionality
export * from './storage'
export * from './assignment'
export * from './flags'
export * from './stats'
export * from './types'

// Note: For full ai-experiments primitives (Experiment, decide, cartesian, etc.),
// import directly from 'ai-experiments' package in primitives.
