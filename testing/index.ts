/**
 * @dotdo/testing - Test utilities and assertion helpers
 *
 * This module provides custom Vitest matchers for validating dotdo entities
 * and test isolation utilities to prevent shared state leaks.
 *
 * @example
 * ```typescript
 * import { setupEntityAssertions, createIsolationHooks } from '@dotdo/testing'
 * import { beforeEach, afterEach } from 'vitest'
 *
 * // Setup entity assertions once (in vitest setup file or at start of test file)
 * setupEntityAssertions()
 *
 * // Setup isolation hooks to verify no state leaks
 * const { setupIsolation, verifyIsolation } = createIsolationHooks()
 * beforeEach(setupIsolation)
 * afterEach(verifyIsolation)
 *
 * // Use in tests
 * describe('My tests', () => {
 *   it('validates things', () => {
 *     const thing = await store.create({ $type: 'Customer', name: 'Alice' })
 *     expect(thing).toBeValidThing()
 *     expect(thing).toHaveThingType('Customer')
 *   })
 *
 *   it('validates events', () => {
 *     const event = await events.emit({ type: 'user.created', payload: { id: '123' } })
 *     expect(event).toBeValidEvent()
 *     expect(event).toHaveEventType('user.created')
 *   })
 *
 *   it('validates relationships', () => {
 *     const rels = await relationships.find({ subject: thing1.$id })
 *     expect(rels).toContainRelationship(thing1.$id, 'owns', thing2.$id)
 *   })
 * })
 * ```
 *
 * @module testing
 */

// ============================================================================
// Entity Assertions
// ============================================================================

export {
  setupEntityAssertions,
  entityMatchers,
  validateThing,
  validateRelationship,
  validateEvent,
  validateEntity,
  findRelationship
} from './assertions'

// Re-export assertion types
export type { Thing, BaseThing, Relationship, Event } from './assertions'

// ============================================================================
// Test Isolation
// ============================================================================

export {
  // Core isolation functions
  takeGlobalStateSnapshot,
  verifyIsolation,
  resetGlobalState,

  // Hooks for Vitest integration
  createIsolationHooks,

  // Utility functions
  generateIsolatedTestId,
  withIsolation,
  trackStateChanges,
} from './isolation'

// Re-export isolation types
export type {
  GlobalStateSnapshot,
  IsolationConfig,
  IsolationViolation,
} from './isolation'
