/**
 * @dotdo/testing - Test utilities, fixtures, and assertion helpers
 *
 * This module provides:
 * - Custom Vitest matchers for validating dotdo entities
 * - Test data factories for generating Things, Events, Relationships, Users, Sessions
 * - DB-compatible factories matching @dotdo/db types
 * - Auth test data factories (API keys, tokens)
 * - Pre-built fixtures for common testing scenarios
 *
 * @example
 * ```typescript
 * import {
 *   setupEntityAssertions,
 *   Factory,
 *   DbFactory,
 *   Fixtures,
 *   Fake
 * } from '@dotdo/testing'
 *
 * // Setup assertions (in vitest setup file or at start of test file)
 * setupEntityAssertions()
 *
 * describe('My tests', () => {
 *   beforeEach(() => {
 *     Factory.reset()
 *     DbFactory.reset()
 *   })
 *
 *   it('creates test data with factories', () => {
 *     // Create DB-compatible entities
 *     const customer = DbFactory.thing({ $type: 'Customer', name: 'Alice' })
 *     const event = DbFactory.event({ type: 'user.signup', payload: { email: 'alice@test.com' } })
 *
 *     // Or use pre-built fixtures
 *     const order = Fixtures.order({ total: 99.99 })
 *     const adminKey = Fixtures.adminApiKey()
 *   })
 *
 *   it('validates entities', () => {
 *     const thing = await store.create({ $type: 'Customer', name: 'Alice' })
 *     expect(thing).toBeValidThing()
 *     expect(thing).toHaveThingType('Customer')
 *   })
 *
 *   it('generates fake data', () => {
 *     const email = Fake.email()
 *     const name = Fake.name()
 *     const uuid = Fake.uuid()
 *   })
 * })
 * ```
 *
 * @module testing
 */

// Assertion helpers
export {
  setupEntityAssertions,
  entityMatchers,
  validateThing,
  validateRelationship,
  validateEvent,
  validateEntity,
  findRelationship
} from './assertions'

// Factory functions
export {
  Factory,
  DbFactory,
  Fake,
  Sequence,
  Fixtures,
  FactoryBuilder,
  buildThing,
  buildRelationship,
  buildUser,
  buildSession,
  buildEvent,
  buildDbThing,
  buildDbRelationship,
  buildDbEvent,
  buildApiKey,
} from './factory'

// Re-export types from assertions
export type { Thing, BaseThing, Relationship, Event } from './assertions'

// Re-export types from factory
export type {
  GraphThing,
  GraphRelationship,
  User,
  Session,
  SessionMetadata,
  DbThing,
  DbRelationship,
  DbEvent,
  ApiKey,
  TokenPayload,
} from './factory'
