/**
 * @dotdo/testing - Test utilities and assertion helpers
 *
 * This module provides custom Vitest matchers for validating dotdo entities.
 *
 * @example
 * ```typescript
 * import { setupEntityAssertions } from '@dotdo/testing'
 *
 * // Setup once (in vitest setup file or at start of test file)
 * setupEntityAssertions()
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

export {
  setupEntityAssertions,
  entityMatchers,
  validateThing,
  validateRelationship,
  validateEvent,
  validateEntity,
  findRelationship
} from './assertions'

// Re-export types
export type { Thing, BaseThing, Relationship, Event } from './assertions'
