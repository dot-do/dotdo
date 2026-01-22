/**
 * Custom Vitest assertion helpers for dotdo entities
 *
 * Provides type-safe assertion matchers for validating:
 * - Thing entities (BaseThing structure)
 * - Relationship triples (subject-predicate-object)
 * - Event structures (event log entries)
 *
 * Usage:
 *   import { setupEntityAssertions } from '@dotdo/testing/assertions'
 *   setupEntityAssertions()
 *
 *   // Then in tests:
 *   expect(thing).toBeValidThing()
 *   expect(event).toBeValidEvent()
 *   expect(thing).toHaveThingType('Customer')
 *   expect(relationships).toContainRelationship(thing1.$id, 'owns', thing2.$id)
 *
 * @module testing/assertions
 */

import { expect } from 'vitest'
import type { Thing, BaseThing } from '../db/things'
import type { Relationship } from '../db/relationships'
import type { Event } from '../db/events'

/**
 * Result type for assertion matchers
 */
interface MatcherResult {
  pass: boolean
  message: () => string
  actual?: unknown
  expected?: unknown
}

/**
 * Validates that an object has all required Thing system fields
 * Returns detailed error information if validation fails
 */
export function validateThing(entity: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!entity || typeof entity !== 'object') {
    return { valid: false, errors: ['Expected an object, received ' + typeof entity] }
  }

  const obj = entity as Record<string, unknown>

  // Check required fields
  if (typeof obj.$id !== 'string') {
    errors.push(`$id must be a string, got ${typeof obj.$id}`)
  } else if (obj.$id.length === 0) {
    errors.push('$id must not be empty')
  }

  if (typeof obj.$type !== 'string') {
    errors.push(`$type must be a string, got ${typeof obj.$type}`)
  } else if (obj.$type.length === 0) {
    errors.push('$type must not be empty')
  }

  if (typeof obj.$createdAt !== 'number') {
    errors.push(`$createdAt must be a number (timestamp), got ${typeof obj.$createdAt}`)
  } else if (obj.$createdAt <= 0) {
    errors.push('$createdAt must be a positive timestamp')
  }

  if (typeof obj.$updatedAt !== 'number') {
    errors.push(`$updatedAt must be a number (timestamp), got ${typeof obj.$updatedAt}`)
  } else if (obj.$updatedAt <= 0) {
    errors.push('$updatedAt must be a positive timestamp')
  }

  // Validate $updatedAt >= $createdAt
  if (
    typeof obj.$createdAt === 'number' &&
    typeof obj.$updatedAt === 'number' &&
    obj.$updatedAt < obj.$createdAt
  ) {
    errors.push('$updatedAt must be >= $createdAt')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validates that an object has all required Relationship fields
 * Returns detailed error information if validation fails
 */
export function validateRelationship(entity: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!entity || typeof entity !== 'object') {
    return { valid: false, errors: ['Expected an object, received ' + typeof entity] }
  }

  const obj = entity as Record<string, unknown>

  // Check required fields
  if (typeof obj.subject !== 'string') {
    errors.push(`subject must be a string, got ${typeof obj.subject}`)
  } else if (obj.subject.length === 0) {
    errors.push('subject must not be empty')
  }

  if (typeof obj.predicate !== 'string') {
    errors.push(`predicate must be a string, got ${typeof obj.predicate}`)
  } else if (obj.predicate.length === 0) {
    errors.push('predicate must not be empty')
  }

  if (typeof obj.object !== 'string') {
    errors.push(`object must be a string, got ${typeof obj.object}`)
  } else if (obj.object.length === 0) {
    errors.push('object must not be empty')
  }

  if (typeof obj.$createdAt !== 'number') {
    errors.push(`$createdAt must be a number (timestamp), got ${typeof obj.$createdAt}`)
  } else if (obj.$createdAt <= 0) {
    errors.push('$createdAt must be a positive timestamp')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validates that an object has all required Event fields
 * Returns detailed error information if validation fails
 */
export function validateEvent(entity: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!entity || typeof entity !== 'object') {
    return { valid: false, errors: ['Expected an object, received ' + typeof entity] }
  }

  const obj = entity as Record<string, unknown>

  // Check required fields
  if (typeof obj.$id !== 'string') {
    errors.push(`$id must be a string, got ${typeof obj.$id}`)
  } else if (obj.$id.length === 0) {
    errors.push('$id must not be empty')
  }

  if (typeof obj.type !== 'string') {
    errors.push(`type must be a string, got ${typeof obj.type}`)
  } else if (obj.type.length === 0) {
    errors.push('type must not be empty')
  }

  // payload is required but can be any type (including null/undefined for some events)
  if (!('payload' in obj)) {
    errors.push('payload field is required')
  }

  if (typeof obj.$timestamp !== 'number') {
    errors.push(`$timestamp must be a number (timestamp), got ${typeof obj.$timestamp}`)
  } else if (obj.$timestamp <= 0) {
    errors.push('$timestamp must be a positive timestamp')
  }

  // Optional fields validation (if present)
  if ('source' in obj && obj.source !== undefined && typeof obj.source !== 'string') {
    errors.push(`source must be a string if provided, got ${typeof obj.source}`)
  }

  if ('correlationId' in obj && obj.correlationId !== undefined && typeof obj.correlationId !== 'string') {
    errors.push(`correlationId must be a string if provided, got ${typeof obj.correlationId}`)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validates that an entity (Thing or Relationship) has correct structure
 * Automatically detects entity type based on field presence
 */
export function validateEntity(entity: unknown): { valid: boolean; errors: string[]; entityType: 'Thing' | 'Relationship' | 'Event' | 'unknown' } {
  if (!entity || typeof entity !== 'object') {
    return { valid: false, errors: ['Expected an object, received ' + typeof entity], entityType: 'unknown' }
  }

  const obj = entity as Record<string, unknown>

  // Detect entity type based on unique fields
  if ('$type' in obj && '$id' in obj && '$createdAt' in obj && '$updatedAt' in obj) {
    const result = validateThing(entity)
    return { ...result, entityType: 'Thing' }
  }

  if ('subject' in obj && 'predicate' in obj && 'object' in obj) {
    const result = validateRelationship(entity)
    return { ...result, entityType: 'Relationship' }
  }

  if ('type' in obj && 'payload' in obj && '$timestamp' in obj) {
    const result = validateEvent(entity)
    return { ...result, entityType: 'Event' }
  }

  return {
    valid: false,
    errors: ['Unable to determine entity type. Expected Thing (with $id, $type, $createdAt, $updatedAt), Relationship (with subject, predicate, object), or Event (with $id, type, payload, $timestamp)'],
    entityType: 'unknown'
  }
}

/**
 * Check if a relationship exists in an array of relationships
 */
export function findRelationship(
  relationships: Relationship[],
  subject: string,
  predicate: string,
  object: string
): Relationship | undefined {
  return relationships.find(
    r => r.subject === subject && r.predicate === predicate && r.object === object
  )
}

/**
 * Custom matchers for Vitest
 * Extend expect with entity-specific assertions
 */
export const entityMatchers = {
  /**
   * Assert that an entity is a valid Thing
   */
  toBeValidThing(received: unknown): MatcherResult {
    const { valid, errors } = validateThing(received)

    return {
      pass: valid,
      message: () =>
        valid
          ? `Expected object NOT to be a valid Thing, but it has all required fields`
          : `Expected object to be a valid Thing:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      actual: received,
      expected: 'Valid Thing with $id, $type, $createdAt, $updatedAt'
    }
  },

  /**
   * Assert that an entity is a valid Relationship
   */
  toBeValidRelationship(received: unknown): MatcherResult {
    const { valid, errors } = validateRelationship(received)

    return {
      pass: valid,
      message: () =>
        valid
          ? `Expected object NOT to be a valid Relationship, but it has all required fields`
          : `Expected object to be a valid Relationship:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      actual: received,
      expected: 'Valid Relationship with subject, predicate, object, $createdAt'
    }
  },

  /**
   * Assert that an entity is a valid Event
   */
  toBeValidEvent(received: unknown): MatcherResult {
    const { valid, errors } = validateEvent(received)

    return {
      pass: valid,
      message: () =>
        valid
          ? `Expected object NOT to be a valid Event, but it has all required fields`
          : `Expected object to be a valid Event:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      actual: received,
      expected: 'Valid Event with $id, type, payload, $timestamp'
    }
  },

  /**
   * Assert that an entity is a valid Thing, Relationship, or Event
   * Auto-detects entity type
   */
  toBeValidEntity(received: unknown): MatcherResult {
    const { valid, errors, entityType } = validateEntity(received)

    return {
      pass: valid,
      message: () =>
        valid
          ? `Expected object NOT to be a valid ${entityType}, but it has all required fields`
          : `Expected object to be a valid entity:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      actual: received,
      expected: 'Valid Thing, Relationship, or Event'
    }
  },

  /**
   * Assert that a Thing has a specific $type
   */
  toHaveThingType(received: unknown, expectedType: string): MatcherResult {
    const thingValidation = validateThing(received)

    if (!thingValidation.valid) {
      return {
        pass: false,
        message: () => `Expected a valid Thing, but validation failed:\n${thingValidation.errors.map(e => `  - ${e}`).join('\n')}`,
        actual: received,
        expected: `Thing with $type "${expectedType}"`
      }
    }

    const thing = received as Thing
    const pass = thing.$type === expectedType

    return {
      pass,
      message: () =>
        pass
          ? `Expected Thing NOT to have type "${expectedType}"`
          : `Expected Thing to have type "${expectedType}", but got "${thing.$type}"`,
      actual: thing.$type,
      expected: expectedType
    }
  },

  /**
   * Assert that an array contains a specific relationship
   */
  toContainRelationship(
    received: unknown,
    subject: string,
    predicate: string,
    object: string
  ): MatcherResult {
    if (!Array.isArray(received)) {
      return {
        pass: false,
        message: () => `Expected an array of relationships, got ${typeof received}`,
        actual: received,
        expected: 'Array of Relationships'
      }
    }

    // Validate all items are relationships
    for (const item of received) {
      const { valid } = validateRelationship(item)
      if (!valid) {
        return {
          pass: false,
          message: () => `Array contains invalid relationship: ${JSON.stringify(item)}`,
          actual: received,
          expected: 'Array of valid Relationships'
        }
      }
    }

    const found = findRelationship(received as Relationship[], subject, predicate, object)
    const pass = found !== undefined

    return {
      pass,
      message: () =>
        pass
          ? `Expected array NOT to contain relationship (${subject} -[${predicate}]-> ${object})`
          : `Expected array to contain relationship (${subject} -[${predicate}]-> ${object})\nFound relationships:\n${received.map((r: Relationship) => `  (${r.subject} -[${r.predicate}]-> ${r.object})`).join('\n') || '  (none)'}`,
      actual: received,
      expected: { subject, predicate, object }
    }
  },

  /**
   * Assert that an Event has a specific type
   */
  toHaveEventType(received: unknown, expectedType: string): MatcherResult {
    const eventValidation = validateEvent(received)

    if (!eventValidation.valid) {
      return {
        pass: false,
        message: () => `Expected a valid Event, but validation failed:\n${eventValidation.errors.map(e => `  - ${e}`).join('\n')}`,
        actual: received,
        expected: `Event with type "${expectedType}"`
      }
    }

    const event = received as Event
    const pass = event.type === expectedType

    return {
      pass,
      message: () =>
        pass
          ? `Expected Event NOT to have type "${expectedType}"`
          : `Expected Event to have type "${expectedType}", but got "${event.type}"`,
      actual: event.type,
      expected: expectedType
    }
  },

  /**
   * Assert that an Event has a specific payload
   */
  toHaveEventPayload(received: unknown, expectedPayload: unknown): MatcherResult {
    const eventValidation = validateEvent(received)

    if (!eventValidation.valid) {
      return {
        pass: false,
        message: () => `Expected a valid Event, but validation failed:\n${eventValidation.errors.map(e => `  - ${e}`).join('\n')}`,
        actual: received,
        expected: `Event with payload`
      }
    }

    const event = received as Event
    const pass = JSON.stringify(event.payload) === JSON.stringify(expectedPayload)

    return {
      pass,
      message: () =>
        pass
          ? `Expected Event NOT to have specified payload`
          : `Expected Event to have payload ${JSON.stringify(expectedPayload)}, but got ${JSON.stringify(event.payload)}`,
      actual: event.payload,
      expected: expectedPayload
    }
  }
}

/**
 * Setup custom entity assertions by extending Vitest's expect
 * Call this in your test setup file or at the start of test files
 */
export function setupEntityAssertions(): void {
  expect.extend(entityMatchers)
}

// Type declarations for custom matchers
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Assertion<T = any> {
    toBeValidThing(): void
    toBeValidRelationship(): void
    toBeValidEvent(): void
    toBeValidEntity(): void
    toHaveThingType(type: string): void
    toHaveEventType(type: string): void
    toHaveEventPayload(payload: unknown): void
    toContainRelationship(subject: string, predicate: string, object: string): void
  }
  interface AsymmetricMatchersContaining {
    toBeValidThing(): void
    toBeValidRelationship(): void
    toBeValidEvent(): void
    toBeValidEntity(): void
    toHaveThingType(type: string): void
    toHaveEventType(type: string): void
    toHaveEventPayload(payload: unknown): void
    toContainRelationship(subject: string, predicate: string, object: string): void
  }
}

// Re-export types for convenience
export type { Thing, BaseThing } from '../db/things'
export type { Relationship } from '../db/relationships'
export type { Event } from '../db/events'
