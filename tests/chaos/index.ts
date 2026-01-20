/**
 * Chaos Engineering Module for dotdo Framework
 *
 * Provides utilities for testing system resilience under failure conditions.
 *
 * @example
 * ```typescript
 * import { ChaosProxy, runRequestStorm, RetryTester } from '../tests/chaos'
 *
 * const chaos = new ChaosProxy()
 * chaos.injectLatency(10, 100)
 * chaos.injectFailure(0.2)
 *
 * await chaos.wrap(async () => {
 *   return myOperation()
 * })
 * ```
 *
 * @module tests/chaos
 * @see do-fhng.9
 */

export {
  ChaosProxy,
  createChaoticMockState,
  runRequestStorm,
  RetryTester,
  createTimeoutOperation,
  CorruptionInjector,
  type LatencyConfig,
  type FailureConfig,
  type StorageChaosConfig,
  type ChaosStats,
} from './ChaosProxy'
