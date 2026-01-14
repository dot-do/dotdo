/**
 * ACID Test Suite - Phase 5: E2E Pipeline Testing
 *
 * End-to-end testing infrastructure for the dotdo pipeline:
 * - Events -> Pipeline emission -> R2 Iceberg sink
 * - Smoke tests for deployment verification
 * - CI/CD integration
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

// ============================================================================
// Configuration
// ============================================================================

export {
  // Types
  type TestEnvironment,
  type EnvironmentEndpoint,
  type TimeoutConfig,
  type RetryConfig,
  type CleanupConfig,
  type PipelineSLAConfig,
  type E2EConfig,

  // Environment detection
  detectEnvironment,
  getPreviewUrl,

  // Defaults
  DEFAULT_ENDPOINTS,
  DEFAULT_TIMEOUTS,
  DEFAULT_RETRIES,
  DEFAULT_CLEANUP,
  DEFAULT_PIPELINE_SLA,
  DEFAULT_SMOKE_CONFIG,

  // Configuration management
  createE2EConfig,
  getE2EConfig,
  configureE2E,
  resetE2EConfig,

  // Helpers
  isE2EEnabled,
  getBaseUrl,
  isReadOnly,
  requiresAuth,
  hasCloudflareCredentials,
  getTimeout,
  generateTestResourceName,
  isTestResource,
  calculateRetryDelay,

  // Default export
  config,
} from './config'

// ============================================================================
// Context
// ============================================================================

export {
  // Types
  type PipelineEvent,
  type IcebergPartition,
  type PartitionInfo,
  type DOStub,
  type CloudflareAPIClient,
  type E2ETestContext,

  // Factory functions
  createE2EContext,
  createE2EContextWithConfig,

  // Test helpers
  withRetry,
  skipIfNoE2E,
  skipIfReadOnly,
  skipIfNoCredentials,
} from './context'

// ============================================================================
// Fixtures
// ============================================================================

export {
  // Thing fixtures
  type ThingFixture,
  createThingFixture,
  createThingFixtures,

  // Event fixtures
  EVENT_TYPES,
  type EventType,
  createEventFixture,
  createThingCreatedEvent,
  createThingUpdatedEvent,
  createThingDeletedEvent,
  createLifecycleEvent,
  createEventFixtures,

  // High volume fixtures
  generateHighVolumeEvents,
  createLargePayloadEvent,

  // Schema validation
  EVENT_SCHEMA,
  validateEventSchema,

  // Cleanup utilities
  ResourceTracker,

  // Data generators
  generateTestOperations,
  generateCrossDOOperations,
} from './fixtures/e2e'

// ============================================================================
// Pipeline Verification
// ============================================================================

export {
  // Types
  type EventVerificationResult,
  type E2ELatencyResult,
  type PipelineSyncResult,
  type PipelineStats,
  type IcebergVerificationResult,

  // Event verification
  verifyEventInPipeline,
  waitForEvents,

  // Latency measurement
  measureE2ELatency,
  measurePipelineLatency,

  // Pipeline sync
  waitForPipelineSync,
  getPipelineStats,

  // Iceberg verification
  verifyIcebergPartition,
  getCurrentPartition,
  waitForPartitionData,

  // SLA verification
  verifySLACompliance,

  // Utilities
  generateCorrelationId,
  createTimedOperation,

  // Default export
  pipelineHelpers,
} from './pipeline'

// ============================================================================
// Smoke Test Helpers
// ============================================================================

export {
  // Types
  type BindingStatus,
  type HealthCheckResult,
  type TestThing,
  type CloneIntegrityResult,
  type CleanupResult,

  // Health check
  healthCheck,
  verifyBindings,

  // CRUD helpers
  createTestThing,
  readThing,
  updateThing,
  deleteThing,
  thingExists,

  // Clone verification
  verifyCloneIntegrity,
  verifyQuickClone,

  // Cleanup
  cleanupTestResources,
  verifyCleanup,

  // Smoke test utilities
  quickSmokeTest,
  assertSmokeTestPassed,

  // Default export
  smokeHelpers,
} from './smoke'

// ============================================================================
// Smoke Test Configuration
// ============================================================================

export {
  // Types
  type SmokeTestConfig,

  // Presets
  DEFAULT_SMOKE_CONFIG as SMOKE_TEST_DEFAULT_CONFIG,
  STRICT_SMOKE_CONFIG,
  MINIMAL_SMOKE_CONFIG,
  SMOKE_PRESETS,

  // Configuration management
  getSmokeConfig,
  configureSmokeTests,
  resetSmokeConfig,
  useStrictSmokeConfig,
  useMinimalSmokeConfig,

  // E2E config factory
  createSmokeE2EConfig,
  getVitestSmokeOptions,

  // Presets
  getSmokePreset,
  applySmokePreset,

  // Default export
  smokeConfig,
} from './smoke.config'
