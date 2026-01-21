/**
 * DO Package Branded Types Tests - TDD for do-eoxd
 *
 * These tests verify that the DO package's types use branded types consistently.
 * Specifically testing TypedEvent and related workflow context types.
 *
 * @module do/tests/branded-types.test
 */

import { describe, it, expect } from 'vitest'
import type { TypedEvent, TypedEventHandler } from '../types'
import {
  type EventId,
  type ThingId,
  type CorrelationId,
  toEventId,
  toThingId,
  toCorrelationId,
  isEventId
} from '../../db'

// ============================================================================
// TypedEvent Branded Type Tests
// ============================================================================

describe('TypedEvent Branded Types', () => {
  describe('$id field', () => {
    it('TypedEvent.$id should be typed as EventId', () => {
      // Compile-time type check: TypedEvent.$id should accept EventId
      const eventId: EventId = toEventId('evt-test-123')
      const event: TypedEvent = {
        $id: eventId,
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: {},
        source: 'test-source'
      }

      expect(event.$id).toBe(eventId)
    })

    it('TypedEvent.$id should be assignable to EventId', () => {
      // Create a valid TypedEvent
      const event: TypedEvent = {
        $id: toEventId('evt-test-456'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: {},
        source: 'test-source'
      }

      // The $id should be assignable to EventId
      const extractedId: EventId = event.$id
      expect(extractedId).toBe('evt-test-456')
    })
  })

  describe('source field', () => {
    it('TypedEvent.source should accept ThingId', () => {
      const thingId: ThingId = toThingId('thing-123-abc')
      const event: TypedEvent = {
        $id: toEventId('evt-test-789'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: {},
        source: thingId
      }

      expect(event.source).toBe(thingId)
    })

    it('TypedEvent.source should accept plain string for backward compatibility', () => {
      const event: TypedEvent = {
        $id: toEventId('evt-test-abc'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: {},
        source: 'plain-string-source'
      }

      expect(event.source).toBe('plain-string-source')
    })
  })

  describe('correlationId field', () => {
    it('TypedEvent.correlationId should accept CorrelationId', () => {
      const corrId: CorrelationId = toCorrelationId('corr-123')
      const event: TypedEvent = {
        $id: toEventId('evt-test-def'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: {},
        source: 'test-source',
        correlationId: corrId
      }

      expect(event.correlationId).toBe(corrId)
    })

    it('TypedEvent.correlationId should be optional', () => {
      const event: TypedEvent = {
        $id: toEventId('evt-test-ghi'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: {},
        source: 'test-source'
        // correlationId omitted intentionally
      }

      expect(event.correlationId).toBeUndefined()
    })
  })

  describe('TypedEventHandler', () => {
    it('should accept handler function with TypedEvent parameter', () => {
      const handler: TypedEventHandler<{ message: string }> = async (event) => {
        // Type check: event.$id should be EventId
        const _idCheck: EventId = event.$id
        // Type check: payload should be typed
        const _payloadCheck: { message: string } = event.payload
        expect(event.payload.message).toBeDefined()
      }

      // Handler should be callable
      expect(typeof handler).toBe('function')
    })

    it('should work with synchronous handlers', () => {
      const handler: TypedEventHandler<{ count: number }> = (event) => {
        expect(event.payload.count).toBeDefined()
        // No return needed for void
      }

      expect(typeof handler).toBe('function')
    })
  })
})

// ============================================================================
// Compile-Time Type Safety Tests
// ============================================================================

describe('DO Package Compile-Time Type Safety', () => {
  it('TypedEvent should enforce branded EventId for $id', () => {
    // This test verifies the compile-time type constraint
    // At compile time, assigning a plain string to $id should cause an error
    // (We can't actually test compile errors at runtime, but we document the expectation)

    const validEvent: TypedEvent = {
      $id: toEventId('evt-valid-123'),
      $timestamp: Date.now(),
      type: 'Test.valid',
      payload: null,
      source: 'test'
    }

    // Verify the EventId brand is preserved
    expect(isEventId(validEvent.$id)).toBe(true)
  })

  it('should allow generic payload types', () => {
    interface CustomPayload {
      userId: string
      action: string
      metadata: Record<string, unknown>
    }

    const event: TypedEvent<CustomPayload> = {
      $id: toEventId('evt-custom-123'),
      $timestamp: Date.now(),
      type: 'User.action',
      payload: {
        userId: 'user-123',
        action: 'login',
        metadata: { browser: 'chrome' }
      },
      source: toThingId('user-123-abc')
    }

    // TypeScript should infer the payload type correctly
    expect(event.payload.userId).toBe('user-123')
    expect(event.payload.action).toBe('login')
    expect(event.payload.metadata.browser).toBe('chrome')
  })
})
