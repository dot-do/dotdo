/**
 * ACID Test Suite - Phase 5: Pipeline Testing Module
 *
 * Re-exports all pipeline verification helpers for E2E testing.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
  EventVerificationResult,
  E2ELatencyResult,
  PipelineSyncResult,
  PipelineStats,
  IcebergVerificationResult,
} from './helpers'

// ============================================================================
// EVENT VERIFICATION
// ============================================================================

export {
  verifyEventInPipeline,
  waitForEvents,
} from './helpers'

// ============================================================================
// LATENCY MEASUREMENT
// ============================================================================

export {
  measureE2ELatency,
  measurePipelineLatency,
} from './helpers'

// ============================================================================
// PIPELINE SYNC
// ============================================================================

export {
  waitForPipelineSync,
  getPipelineStats,
} from './helpers'

// ============================================================================
// ICEBERG VERIFICATION
// ============================================================================

export {
  verifyIcebergPartition,
  getCurrentPartition,
  waitForPartitionData,
} from './helpers'

// ============================================================================
// SLA VERIFICATION
// ============================================================================

export {
  verifySLACompliance,
} from './helpers'

// ============================================================================
// UTILITIES
// ============================================================================

export {
  generateCorrelationId,
  createTimedOperation,
} from './helpers'

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export { default as pipelineHelpers } from './helpers'
