/**
 * ACID Testing Utilities
 *
 * Provides test fixtures, factory functions, base classes, custom matchers,
 * and utilities for ACID (Atomicity, Consistency, Isolation, Durability)
 * testing of Durable Objects.
 *
 * ## Modules
 *
 * - **fixtures**: Test data fixtures and factory functions
 * - **context**: Test configuration and runtime context
 * - **base**: Abstract base classes for test organization
 * - **matchers**: Custom Vitest matchers for ACID assertions
 *
 * @example
 * ```ts
 * import {
 *   // Fixtures
 *   FIXTURES,
 *   createTestDOWithFixtures,
 *   createThingFixture,
 *
 *   // Context
 *   createACIDTestContext,
 *
 *   // Base classes
 *   ACIDTestBase,
 *   LifecycleTestBase,
 *
 *   // Matchers
 *   acidMatchers,
 * } from 'dotdo/testing/acid'
 *
 * // Extend Vitest with ACID matchers
 * expect.extend(acidMatchers)
 *
 * describe('DO ACID tests', () => {
 *   let ctx: ACIDTestContext
 *
 *   beforeEach(() => {
 *     ctx = createACIDTestContext({ isolation: 'full' })
 *   })
 *
 *   afterEach(() => {
 *     ctx.cleanup()
 *   })
 *
 *   it('should handle versioned data', async () => {
 *     const { instance } = await ctx.createDO(MyDO)
 *     // ... test
 *   })
 * })
 * ```
 *
 * @module testing/acid
 */

// =============================================================================
// FIXTURES - Test data and factory functions
// =============================================================================

export {
  // Main fixtures object
  FIXTURES,

  // Type definitions
  type ThingFixture,
  type RelationshipFixture,
  type BranchFixture,
  type ActionFixture,
  type EventFixture,
  type FixtureName,
  type FixtureType,

  // Factory function types
  type CreateTestDOOptions,
  type TestDOWithFixturesResult,

  // Factory functions
  createTestDOWithFixtures,
  createThingFixture,
  createThingFixtures,
  createVersionedThingFixtures,
  createRelationshipFixtures,
  createActionFixtures,
  createEventFixtures,
} from './fixtures'

// =============================================================================
// CONTEXT - Test configuration and runtime context
// =============================================================================

export {
  // Types
  type IsolationLevel,
  type NetworkConfig,
  type ACIDTestConfig,
  type CreateDOOptions,
  type ACIDTestContext,
  type DOTestInstance,

  // Functions
  createACIDTestContext,
  defaultACIDTestConfig,
} from './context'

// =============================================================================
// BASE CLASSES - Abstract base classes for tests
// =============================================================================

export {
  // Base classes
  ACIDTestBase,
  LifecycleTestBase,
  CrossDOTestBase,

  // Helper functions
  runACIDTest,
} from './base'

// =============================================================================
// MATCHERS - Custom Vitest matchers
// =============================================================================

export { acidMatchers } from './matchers'
export { default as matchers } from './matchers'

// =============================================================================
// PHASE 1 FIXTURES - Core Lifecycle Operations test data
// =============================================================================

export {
  // Main Phase 1 fixtures object
  PHASE1_FIXTURES,

  // Individual fixture exports
  thingsWithVersions,
  thingsMultipleBranches,
  branches,
  conflictScenario,
  emptyState,
  promotionScenario,
  largeDataset,
  edgeCases,
} from './fixtures/phase1'
