/**
 * ACID Test Suite - Phase 5: E2E Pipeline Testing
 *
 * Index file re-exporting all Phase 5 test utilities and fixtures.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

// Re-export fixtures
export * from '../fixtures/phase5'

// Re-export from E2E infrastructure
export {
  // Configuration
  type TestEnvironment,
  type E2EConfig,
  getE2EConfig,
  configureE2E,
  detectEnvironment,
  isE2EEnabled,
  getBaseUrl,
  generateTestResourceName,
} from '../../e2e/config'

export {
  // Context
  type E2ETestContext,
  type PipelineEvent,
  type IcebergPartition,
  createE2EContext,
  skipIfNoE2E,
  skipIfReadOnly,
  skipIfNoCredentials,
  withRetry,
} from '../../e2e/context'

export {
  // Pipeline helpers
  type EventVerificationResult,
  type E2ELatencyResult,
  type PipelineSyncResult,
  type PipelineStats,
  verifyEventInPipeline,
  waitForEvents,
  measureE2ELatency,
  measurePipelineLatency,
  waitForPipelineSync,
  getPipelineStats,
  verifyIcebergPartition,
  waitForPartitionData,
  verifySLACompliance,
  generateCorrelationId,
} from '../../e2e/pipeline/helpers'

export {
  // Smoke test helpers
  type HealthCheckResult,
  type TestThing,
  type CloneIntegrityResult,
  healthCheck,
  verifyBindings,
  createTestThing,
  verifyCloneIntegrity,
  quickSmokeTest,
} from '../../e2e/smoke/helpers'
