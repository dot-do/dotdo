/**
 * ACID Test Suite - Phase 5: Smoke Test Module
 *
 * Re-exports all smoke test helpers for deployment verification.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
  BindingStatus,
  HealthCheckResult,
  TestThing,
  CloneIntegrityResult,
  CleanupResult,
} from './helpers'

// ============================================================================
// HEALTH CHECK
// ============================================================================

export {
  healthCheck,
  verifyBindings,
} from './helpers'

// ============================================================================
// CRUD HELPERS
// ============================================================================

export {
  createTestThing,
  readThing,
  updateThing,
  deleteThing,
  thingExists,
} from './helpers'

// ============================================================================
// CLONE VERIFICATION
// ============================================================================

export {
  verifyCloneIntegrity,
  verifyQuickClone,
} from './helpers'

// ============================================================================
// CLEANUP
// ============================================================================

export {
  cleanupTestResources,
  verifyCleanup,
} from './helpers'

// ============================================================================
// SMOKE TEST UTILITIES
// ============================================================================

export {
  quickSmokeTest,
  assertSmokeTestPassed,
} from './helpers'

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export { default as smokeHelpers } from './helpers'
