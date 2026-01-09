/**
 * Analytics Stream Integration Tests
 *
 * TDD RED Phase: These tests define the expected behavior for
 * AnalyticsStreamClient - a client that streams analytics events
 * to Cloudflare Pipelines via StreamBridge.
 *
 * Test Coverage:
 * - Stream emission (events emitted to StreamBridge)
 * - Batching (batch size, auto-flush interval)
 * - Transforms (beforeSend filtering/enrichment)
 *
 * @module @dotdo/compat/analytics/stream-integration.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockPipeline, type MockPipeline } from '../../tests/mocks/pipeline'

// ============================================================================
// TYPES FOR THE IMPLEMENTATION (NOT YET IMPLEMENTED)
// ============================================================================

/**
 * Analytics stream event (to be emitted to pipeline)
 */
interface AnalyticsStreamEvent {
  operation: 'insert'
  table: 'analytics_events'
  data: {
    type: string
    event?: string
    userId?: string
    anonymousId?: string
    properties?: Record<string, unknown>
    traits?: Record<string, unknown>
    timestamp: string
    messageId: string
  }
  timestamp: number
  metadata?: Record<string, unknown>
}

/**
 * BeforeSend callback for transforms
 */
type BeforeSendCallback = (event: AnalyticsStreamEvent) => AnalyticsStreamEvent | null

/**
 * Analytics stream client configuration
 */
interface AnalyticsStreamConfig {
  /** Pipeline binding for streaming */
  pipeline: any
  /** Batch size before auto-flush (default: 100) */
  batchSize?: number
  /** Auto-flush interval in ms (default: 5000) */
  flushInterval?: number
  /** Transform callback before sending */
  beforeSend?: BeforeSendCallback
  /** Default metadata to include with all events */
  defaultMetadata?: Record<string, unknown>
}

/**
 * Analytics stream client interface (to be implemented)
 */
interface AnalyticsStreamClient {
  track(event: { event: string; userId?: string; anonymousId?: string; properties?: Record<string, unknown> }): void
  identify(event: { userId: string; traits?: Record<string, unknown> }): void
  page(event?: { name?: string; category?: string; properties?: Record<string, unknown>; anonymousId?: string }): void
  flush(): Promise<void>
  destroy(): void
  getBufferSize(): number
}

// ============================================================================
// IMPORT IMPLEMENTATION
// ============================================================================

import { createAnalyticsStreamClient } from './stream-integration'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('AnalyticsStreamClient', () => {
  let mockPipeline: MockPipeline
  let client: AnalyticsStreamClient

  beforeEach(() => {
    vi.useFakeTimers()
    mockPipeline = createMockPipeline()
  })

  afterEach(() => {
    if (client) {
      try {
        client.destroy()
      } catch {
        // Ignore errors during cleanup
      }
    }
    vi.useRealTimers()
  })

  // ============================================================================
  // STREAM EMISSION TESTS
  // ============================================================================

  describe('stream emission', () => {
    it('should emit track events to StreamBridge with operation type "insert"', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1, // Immediate flush
      })

      client.track({
        event: 'Button Clicked',
        userId: 'user-123',
        properties: { buttonId: 'submit-btn' },
      })

      await client.flush()

      expect(mockPipeline.send).toHaveBeenCalled()
      const events = mockPipeline.events
      expect(events).toHaveLength(1)
      expect(events[0].operation).toBe('insert')
    })

    it('should emit events to the "analytics_events" table', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
      })

      client.track({
        event: 'Purchase Completed',
        userId: 'user-456',
      })

      await client.flush()

      const events = mockPipeline.events
      expect(events[0].table).toBe('analytics_events')
    })

    it('should include event type in data payload', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
      })

      client.track({
        event: 'Page Viewed',
        anonymousId: 'anon-789',
      })

      await client.flush()

      const events = mockPipeline.events
      expect(events[0].data.type).toBe('track')
      expect(events[0].data.event).toBe('Page Viewed')
    })

    it('should include userId in data payload', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
      })

      client.identify({
        userId: 'user-abc',
        traits: { email: 'test@example.com' },
      })

      await client.flush()

      const events = mockPipeline.events
      expect(events[0].data.type).toBe('identify')
      expect(events[0].data.userId).toBe('user-abc')
      expect(events[0].data.traits).toEqual({ email: 'test@example.com' })
    })

    it('should include anonymousId in data payload', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
      })

      client.page({
        name: 'Home',
        anonymousId: 'anon-xyz',
      })

      await client.flush()

      const events = mockPipeline.events
      expect(events[0].data.type).toBe('page')
      expect(events[0].data.anonymousId).toBe('anon-xyz')
    })

    it('should include timestamp in stream event', async () => {
      const now = new Date('2026-01-09T12:00:00.000Z')
      vi.setSystemTime(now)

      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
      })

      client.track({
        event: 'Test Event',
        userId: 'user-123',
      })

      await client.flush()

      const events = mockPipeline.events
      expect(events[0].timestamp).toBe(now.getTime())
      expect(events[0].data.timestamp).toBeDefined()
    })

    it('should auto-generate messageId for each event', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 2,
      })

      client.track({ event: 'Event 1', userId: 'u1' })
      client.track({ event: 'Event 2', userId: 'u2' })

      await client.flush()

      const events = mockPipeline.events
      expect(events[0].data.messageId).toBeDefined()
      expect(events[1].data.messageId).toBeDefined()
      expect(events[0].data.messageId).not.toBe(events[1].data.messageId)
    })

    it('should include properties in data payload', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
      })

      client.track({
        event: 'Product Added',
        userId: 'user-123',
        properties: {
          productId: 'prod-456',
          price: 29.99,
          quantity: 2,
        },
      })

      await client.flush()

      const events = mockPipeline.events
      expect(events[0].data.properties).toEqual({
        productId: 'prod-456',
        price: 29.99,
        quantity: 2,
      })
    })

    it('should include default metadata in stream events', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
        defaultMetadata: {
          source: 'web-app',
          version: '1.0.0',
        },
      })

      client.track({
        event: 'Test Event',
        userId: 'user-123',
      })

      await client.flush()

      const events = mockPipeline.events
      expect(events[0].metadata).toEqual({
        source: 'web-app',
        version: '1.0.0',
      })
    })
  })

  // ============================================================================
  // BATCHING TESTS
  // ============================================================================

  describe('batching', () => {
    it('should buffer events until batch size is reached', () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 5,
      })

      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })
      client.track({ event: 'E3', userId: 'u3' })

      expect(mockPipeline.send).not.toHaveBeenCalled()
      expect(client.getBufferSize()).toBe(3)
    })

    it('should auto-flush when batch size is reached', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 3,
      })

      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })
      expect(mockPipeline.send).not.toHaveBeenCalled()

      client.track({ event: 'E3', userId: 'u3' })

      // Wait for async flush
      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events).toHaveLength(3)
    })

    it('should respect custom batch size', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 10,
      })

      for (let i = 0; i < 9; i++) {
        client.track({ event: `Event ${i}`, userId: `user-${i}` })
      }
      expect(mockPipeline.send).not.toHaveBeenCalled()

      client.track({ event: 'Event 9', userId: 'user-9' })

      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events).toHaveLength(10)
    })

    it('should auto-flush at configured interval', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1000, // High batch size
        flushInterval: 5000, // 5 second interval
      })

      client.track({ event: 'Test Event', userId: 'user-123' })
      expect(mockPipeline.send).not.toHaveBeenCalled()

      // Advance time to just before interval
      await vi.advanceTimersByTimeAsync(4999)
      expect(mockPipeline.send).not.toHaveBeenCalled()

      // Advance past interval
      await vi.advanceTimersByTimeAsync(1)
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should use default flush interval of 5000ms', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1000,
        // No flushInterval specified - should default to 5000
      })

      client.track({ event: 'Test Event', userId: 'user-123' })

      await vi.advanceTimersByTimeAsync(4999)
      expect(mockPipeline.send).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should use default batch size of 100', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        // No batchSize specified - should default to 100
        flushInterval: 60000, // High interval
      })

      for (let i = 0; i < 99; i++) {
        client.track({ event: `Event ${i}`, userId: `user-${i}` })
      }
      expect(mockPipeline.send).not.toHaveBeenCalled()

      client.track({ event: 'Event 99', userId: 'user-99' })

      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events).toHaveLength(100)
    })

    it('should clear buffer after flush', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 2,
      })

      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })

      await vi.advanceTimersByTimeAsync(10)

      expect(client.getBufferSize()).toBe(0)
    })

    it('should not send if buffer is empty on flush', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 10,
      })

      await client.flush()

      expect(mockPipeline.send).not.toHaveBeenCalled()
    })

    it('should send all buffered events on manual flush', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1000, // High batch size
        flushInterval: 60000, // High interval
      })

      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })
      client.track({ event: 'E3', userId: 'u3' })

      await client.flush()

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events).toHaveLength(3)
    })

    it('should stop auto-flush timer on destroy', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1000,
        flushInterval: 5000,
      })

      client.track({ event: 'Test Event', userId: 'user-123' })
      client.destroy()

      // Advance past interval
      await vi.advanceTimersByTimeAsync(10000)

      // Should only have been called once (on destroy), not again by timer
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should flush remaining events on destroy', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1000,
        flushInterval: 60000,
      })

      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })

      client.destroy()

      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalled()
      expect(mockPipeline.events).toHaveLength(2)
    })
  })

  // ============================================================================
  // TRANSFORM TESTS
  // ============================================================================

  describe('transforms', () => {
    it('should apply beforeSend callback to each event', async () => {
      const beforeSend = vi.fn((event: AnalyticsStreamEvent) => ({
        ...event,
        metadata: { ...event.metadata, transformed: true },
      }))

      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
        beforeSend,
      })

      client.track({ event: 'Test Event', userId: 'user-123' })

      await client.flush()

      expect(beforeSend).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events[0].metadata?.transformed).toBe(true)
    })

    it('should filter events when beforeSend returns null', async () => {
      const beforeSend = vi.fn((event: AnalyticsStreamEvent) => {
        // Filter out identify events
        if (event.data.type === 'identify') {
          return null
        }
        return event
      })

      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 10,
        beforeSend,
      })

      client.track({ event: 'Track Event', userId: 'u1' })
      client.identify({ userId: 'u1', traits: { name: 'Test' } })
      client.track({ event: 'Another Track', userId: 'u2' })

      await client.flush()

      expect(beforeSend).toHaveBeenCalledTimes(3)
      expect(mockPipeline.events).toHaveLength(2)
      expect(mockPipeline.events.every((e: any) => e.data.type === 'track')).toBe(true)
    })

    it('should allow beforeSend to enrich events with additional data', async () => {
      const beforeSend = vi.fn((event: AnalyticsStreamEvent) => ({
        ...event,
        data: {
          ...event.data,
          properties: {
            ...event.data.properties,
            enrichedField: 'enriched-value',
            processedAt: '2026-01-09T12:00:00.000Z',
          },
        },
      }))

      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
        beforeSend,
      })

      client.track({
        event: 'Test Event',
        userId: 'user-123',
        properties: { originalField: 'original-value' },
      })

      await client.flush()

      const event = mockPipeline.events[0]
      expect(event.data.properties.originalField).toBe('original-value')
      expect(event.data.properties.enrichedField).toBe('enriched-value')
      expect(event.data.properties.processedAt).toBe('2026-01-09T12:00:00.000Z')
    })

    it('should allow beforeSend to filter based on event properties', async () => {
      const beforeSend = vi.fn((event: AnalyticsStreamEvent) => {
        // Only allow events with price > 10
        const price = event.data.properties?.price as number | undefined
        if (price !== undefined && price <= 10) {
          return null
        }
        return event
      })

      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 10,
        beforeSend,
      })

      client.track({ event: 'Purchase', userId: 'u1', properties: { price: 5 } })
      client.track({ event: 'Purchase', userId: 'u2', properties: { price: 15 } })
      client.track({ event: 'Purchase', userId: 'u3', properties: { price: 8 } })
      client.track({ event: 'Purchase', userId: 'u4', properties: { price: 25 } })

      await client.flush()

      expect(mockPipeline.events).toHaveLength(2)
      expect(mockPipeline.events[0].data.properties.price).toBe(15)
      expect(mockPipeline.events[1].data.properties.price).toBe(25)
    })

    it('should not send to pipeline if all events are filtered', async () => {
      const beforeSend = vi.fn(() => null) // Filter all events

      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 10,
        beforeSend,
      })

      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })

      await client.flush()

      // Should not call send if all events were filtered
      expect(mockPipeline.send).not.toHaveBeenCalled()
    })

    it('should pass original event data to beforeSend', async () => {
      const beforeSend = vi.fn((event: AnalyticsStreamEvent) => event)

      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
        beforeSend,
      })

      client.track({
        event: 'Test Event',
        userId: 'user-123',
        properties: { key: 'value' },
      })

      await client.flush()

      const passedEvent = beforeSend.mock.calls[0][0]
      expect(passedEvent.operation).toBe('insert')
      expect(passedEvent.table).toBe('analytics_events')
      expect(passedEvent.data.type).toBe('track')
      expect(passedEvent.data.event).toBe('Test Event')
      expect(passedEvent.data.userId).toBe('user-123')
      expect(passedEvent.data.properties).toEqual({ key: 'value' })
    })

    it('should allow beforeSend to modify metadata', async () => {
      const beforeSend = vi.fn((event: AnalyticsStreamEvent) => ({
        ...event,
        metadata: {
          ...event.metadata,
          processedBy: 'analytics-worker',
          region: 'us-east-1',
        },
      }))

      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 1,
        defaultMetadata: { source: 'web' },
        beforeSend,
      })

      client.track({ event: 'Test', userId: 'u1' })

      await client.flush()

      expect(mockPipeline.events[0].metadata).toEqual({
        source: 'web',
        processedBy: 'analytics-worker',
        region: 'us-east-1',
      })
    })

    it('should handle async-like behavior in beforeSend gracefully', async () => {
      // Note: beforeSend is synchronous, but should handle heavy computation
      let processedCount = 0
      const beforeSend = vi.fn((event: AnalyticsStreamEvent) => {
        processedCount++
        // Simulate some computation
        const result = { ...event }
        result.metadata = { ...result.metadata, order: processedCount }
        return result
      })

      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 5,
        beforeSend,
      })

      for (let i = 0; i < 5; i++) {
        client.track({ event: `Event ${i}`, userId: `user-${i}` })
      }

      await client.flush()

      expect(processedCount).toBe(5)
      expect(mockPipeline.events[0].metadata?.order).toBe(1)
      expect(mockPipeline.events[4].metadata?.order).toBe(5)
    })
  })

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('integration', () => {
    it('should work with realistic analytics workflow', async () => {
      const beforeSend = vi.fn((event: AnalyticsStreamEvent) => ({
        ...event,
        metadata: {
          ...event.metadata,
          environment: 'production',
          sdk: 'dotdo-analytics',
        },
      }))

      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 100,
        flushInterval: 10000,
        beforeSend,
        defaultMetadata: { appVersion: '2.0.0' },
      })

      // User visits the site
      client.page({
        name: 'Landing Page',
        category: 'Marketing',
        anonymousId: 'anon-123',
      })

      // User signs up
      client.identify({
        userId: 'user-456',
        traits: {
          email: 'user@example.com',
          plan: 'free',
        },
      })

      // User performs actions
      client.track({
        event: 'Feature Used',
        userId: 'user-456',
        properties: {
          featureName: 'Dashboard',
          duration: 30000,
        },
      })

      // Flush on page unload
      await client.flush()

      expect(mockPipeline.events).toHaveLength(3)

      // Verify all events have correct structure
      for (const event of mockPipeline.events) {
        expect(event.operation).toBe('insert')
        expect(event.table).toBe('analytics_events')
        expect(event.data.messageId).toBeDefined()
        expect(event.data.timestamp).toBeDefined()
        expect(event.metadata?.environment).toBe('production')
        expect(event.metadata?.appVersion).toBe('2.0.0')
      }
    })

    it('should handle high-volume event streaming', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 50,
        flushInterval: 1000,
      })

      // Simulate high-volume event stream
      for (let i = 0; i < 150; i++) {
        client.track({
          event: 'High Volume Event',
          userId: `user-${i % 10}`,
          properties: {
            index: i,
            timestamp: Date.now(),
          },
        })
      }

      // Should have auto-flushed 3 times (50 + 50 + 50)
      await vi.advanceTimersByTimeAsync(100)

      expect(mockPipeline.send).toHaveBeenCalledTimes(3)
      expect(mockPipeline.events).toHaveLength(150)
    })
  })

  // ============================================================================
  // MULTI-DESTINATION TESTS
  // ============================================================================

  describe('multiple destinations', () => {
    let primaryPipeline: MockPipeline
    let secondaryPipeline: MockPipeline

    beforeEach(() => {
      primaryPipeline = createMockPipeline()
      secondaryPipeline = createMockPipeline()
    })

    it('should send events to multiple destinations', async () => {
      client = createAnalyticsStreamClient({
        destinations: [
          { id: 'primary', pipeline: primaryPipeline },
          { id: 'secondary', pipeline: secondaryPipeline },
        ],
        batchSize: 1,
      })

      client.track({ event: 'Test Event', userId: 'user-123' })
      await client.flush()

      expect(primaryPipeline.send).toHaveBeenCalled()
      expect(secondaryPipeline.send).toHaveBeenCalled()
      expect(primaryPipeline.events).toHaveLength(1)
      expect(secondaryPipeline.events).toHaveLength(1)
    })

    it('should filter events by type for specific destinations', async () => {
      client = createAnalyticsStreamClient({
        destinations: [
          { id: 'all', pipeline: primaryPipeline, filter: 'all' },
          { id: 'track-only', pipeline: secondaryPipeline, filter: 'track' },
        ],
        batchSize: 10,
      })

      client.track({ event: 'Track Event', userId: 'u1' })
      client.identify({ userId: 'u1' })
      client.page({ name: 'Home' })
      await client.flush()

      // Primary gets all events
      expect(primaryPipeline.events).toHaveLength(3)
      // Secondary only gets track events
      expect(secondaryPipeline.events).toHaveLength(1)
      expect(secondaryPipeline.events[0].data.type).toBe('track')
    })

    it('should support array of event types for filtering', async () => {
      client = createAnalyticsStreamClient({
        destinations: [
          { id: 'identity', pipeline: primaryPipeline, filter: ['identify', 'page'] },
        ],
        batchSize: 10,
      })

      client.track({ event: 'Track Event', userId: 'u1' })
      client.identify({ userId: 'u1' })
      client.page({ name: 'Home' })
      await client.flush()

      // Only identify and page events
      expect(primaryPipeline.events).toHaveLength(2)
      expect(primaryPipeline.events[0].data.type).toBe('identify')
      expect(primaryPipeline.events[1].data.type).toBe('page')
    })

    it('should apply destination-specific transforms', async () => {
      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'primary',
            pipeline: primaryPipeline,
            transform: (event) => ({
              ...event,
              metadata: { ...event.metadata, destination: 'primary' },
            }),
          },
          {
            id: 'secondary',
            pipeline: secondaryPipeline,
            transform: (event) => ({
              ...event,
              metadata: { ...event.metadata, destination: 'secondary' },
            }),
          },
        ],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })
      await client.flush()

      expect(primaryPipeline.events[0].metadata?.destination).toBe('primary')
      expect(secondaryPipeline.events[0].metadata?.destination).toBe('secondary')
    })

    it('should skip disabled destinations', async () => {
      client = createAnalyticsStreamClient({
        destinations: [
          { id: 'enabled', pipeline: primaryPipeline, enabled: true },
          { id: 'disabled', pipeline: secondaryPipeline, enabled: false },
        ],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })
      await client.flush()

      expect(primaryPipeline.send).toHaveBeenCalled()
      expect(secondaryPipeline.send).not.toHaveBeenCalled()
    })

    it('should throw error if no pipeline or destinations provided', () => {
      expect(() => {
        createAnalyticsStreamClient({
          batchSize: 1,
        } as any)
      }).toThrow('Either pipeline or destinations must be provided')
    })
  })

  // ============================================================================
  // FORMAT ADAPTER TESTS
  // ============================================================================

  describe('format adapters', () => {
    it('should use JSON format by default', async () => {
      client = createAnalyticsStreamClient({
        destinations: [{ id: 'json', pipeline: mockPipeline, format: 'json' }],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })
      await client.flush()

      // JSON format returns events as-is
      expect(mockPipeline.events[0]).toHaveProperty('operation')
      expect(mockPipeline.events[0]).toHaveProperty('table')
      expect(mockPipeline.events[0]).toHaveProperty('data')
    })

    it('should encode events as NDJSON when configured', async () => {
      client = createAnalyticsStreamClient({
        destinations: [{ id: 'ndjson', pipeline: mockPipeline, format: 'ndjson' }],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })
      await client.flush()

      // NDJSON format returns stringified events
      expect(typeof mockPipeline.events[0]).toBe('string')
      const parsed = JSON.parse(mockPipeline.events[0])
      expect(parsed.operation).toBe('insert')
    })

    it('should encode events as Protobuf when configured', async () => {
      client = createAnalyticsStreamClient({
        destinations: [{ id: 'proto', pipeline: mockPipeline, format: 'protobuf' }],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })
      await client.flush()

      // Protobuf format returns encoded objects
      expect(mockPipeline.events[0]).toHaveProperty('_proto', true)
      expect(mockPipeline.events[0]).toHaveProperty('_encoded')
    })

    it('should use different formats for different destinations', async () => {
      const jsonPipeline = createMockPipeline()
      const ndjsonPipeline = createMockPipeline()

      client = createAnalyticsStreamClient({
        destinations: [
          { id: 'json', pipeline: jsonPipeline, format: 'json' },
          { id: 'ndjson', pipeline: ndjsonPipeline, format: 'ndjson' },
        ],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })
      await client.flush()

      // JSON format
      expect(jsonPipeline.events[0]).toHaveProperty('operation')
      // NDJSON format
      expect(typeof ndjsonPipeline.events[0]).toBe('string')
    })
  })

  // ============================================================================
  // RETRY LOGIC TESTS
  // ============================================================================

  describe('retry logic', () => {
    it('should retry failed sends with exponential backoff', async () => {
      let attempts = 0
      const failingPipeline = {
        send: vi.fn(async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Network error')
          }
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'failing',
            pipeline: failingPipeline,
            retry: { maxAttempts: 3, initialDelayMs: 100, backoffMultiplier: 2 },
          },
        ],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })

      // Start flush and advance through retries
      const flushPromise = client.flush()
      await vi.advanceTimersByTimeAsync(100) // First retry delay
      await vi.advanceTimersByTimeAsync(200) // Second retry delay
      await flushPromise

      expect(failingPipeline.send).toHaveBeenCalledTimes(3)
    })

    it('should add to dead letter queue after all retries exhausted', async () => {
      const alwaysFailingPipeline = {
        send: vi.fn(async () => {
          throw new Error('Permanent failure')
        }),
      }

      const deadLetterCallback = vi.fn()

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'failing',
            pipeline: alwaysFailingPipeline,
            retry: { maxAttempts: 2, initialDelayMs: 10 },
          },
        ],
        batchSize: 1,
        onDeadLetter: deadLetterCallback,
      })

      client.track({ event: 'Test', userId: 'u1' })

      const flushPromise = client.flush()
      await vi.advanceTimersByTimeAsync(100)
      await flushPromise

      expect(deadLetterCallback).toHaveBeenCalled()
      const dlq = client.getDeadLetterQueue()
      expect(dlq).toHaveLength(1)
      expect(dlq[0].error).toBe('Permanent failure')
      expect(dlq[0].destinationId).toBe('failing')
    })

    it('should respect max delay in exponential backoff', async () => {
      const delays: number[] = []
      const originalSetTimeout = globalThis.setTimeout

      // Mock setTimeout to capture delays
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, delay?: number) => {
        if (delay && delay > 0) {
          delays.push(delay)
        }
        return originalSetTimeout(fn, delay)
      })

      const alwaysFailingPipeline = {
        send: vi.fn(async () => {
          throw new Error('Fail')
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'failing',
            pipeline: alwaysFailingPipeline,
            retry: {
              maxAttempts: 5,
              initialDelayMs: 1000,
              maxDelayMs: 3000,
              backoffMultiplier: 2,
            },
          },
        ],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })

      const flushPromise = client.flush()
      // Advance through all retries
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(3000)
      }
      await flushPromise

      // Check that delays are capped at maxDelayMs
      const retryDelays = delays.filter((d) => d >= 1000)
      expect(retryDelays.every((d) => d <= 3000)).toBe(true)
    })
  })

  // ============================================================================
  // DEAD LETTER QUEUE TESTS
  // ============================================================================

  describe('dead letter queue', () => {
    it('should store failed events in dead letter queue', async () => {
      const failingPipeline = {
        send: vi.fn(async () => {
          throw new Error('Send failed')
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'failing',
            pipeline: failingPipeline,
            retry: { maxAttempts: 1 },
          },
        ],
        batchSize: 2,
      })

      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })
      await client.flush()

      const dlq = client.getDeadLetterQueue()
      expect(dlq).toHaveLength(2)
    })

    it('should limit dead letter queue size', async () => {
      const failingPipeline = {
        send: vi.fn(async () => {
          throw new Error('Fail')
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'failing',
            pipeline: failingPipeline,
            retry: { maxAttempts: 1 },
          },
        ],
        batchSize: 1,
        deadLetterQueueSize: 3,
      })

      // Send 5 events - should only keep last 3 in DLQ
      for (let i = 0; i < 5; i++) {
        client.track({ event: `Event ${i}`, userId: `u${i}` })
        await client.flush()
      }

      const dlq = client.getDeadLetterQueue()
      expect(dlq).toHaveLength(3)
      // First 2 events should have been evicted
      expect(dlq[0].event.data.event).toBe('Event 2')
      expect(dlq[1].event.data.event).toBe('Event 3')
      expect(dlq[2].event.data.event).toBe('Event 4')
    })

    it('should clear dead letter queue', async () => {
      const failingPipeline = {
        send: vi.fn(async () => {
          throw new Error('Fail')
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'failing',
            pipeline: failingPipeline,
            retry: { maxAttempts: 1 },
          },
        ],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })
      await client.flush()

      expect(client.getDeadLetterQueue()).toHaveLength(1)

      client.clearDeadLetterQueue()

      expect(client.getDeadLetterQueue()).toHaveLength(0)
    })

    it('should retry dead letter queue events', async () => {
      let shouldFail = true
      const sometimesFailingPipeline = {
        send: vi.fn(async () => {
          if (shouldFail) {
            throw new Error('Fail')
          }
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'sometimes-failing',
            pipeline: sometimesFailingPipeline,
            retry: { maxAttempts: 1 },
          },
        ],
        batchSize: 2,
      })

      // First attempt fails
      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })
      await client.flush()

      expect(client.getDeadLetterQueue()).toHaveLength(2)

      // Now make pipeline succeed
      shouldFail = false

      const result = await client.retryDeadLetterQueue()

      expect(result.succeeded).toBe(2)
      expect(result.failed).toBe(0)
      expect(client.getDeadLetterQueue()).toHaveLength(0)
    })

    it('should call onDeadLetter callback when events fail', async () => {
      const onDeadLetter = vi.fn()
      const failingPipeline = {
        send: vi.fn(async () => {
          throw new Error('Callback test')
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'failing',
            pipeline: failingPipeline,
            retry: { maxAttempts: 1 },
          },
        ],
        batchSize: 1,
        onDeadLetter,
      })

      client.track({ event: 'Test', userId: 'u1' })
      await client.flush()

      expect(onDeadLetter).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationId: 'failing',
          error: 'Callback test',
          attempts: 1,
        })
      )
    })
  })

  // ============================================================================
  // METRICS TESTS
  // ============================================================================

  describe('metrics', () => {
    it('should track sent event count', async () => {
      client = createAnalyticsStreamClient({
        pipeline: mockPipeline,
        batchSize: 2,
      })

      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })
      await client.flush()

      const metrics = client.getMetrics()
      expect(metrics.sent).toBe(2)
    })

    it('should track failed event count', async () => {
      const failingPipeline = {
        send: vi.fn(async () => {
          throw new Error('Fail')
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'failing',
            pipeline: failingPipeline,
            retry: { maxAttempts: 1 },
          },
        ],
        batchSize: 2,
      })

      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })
      await client.flush()

      const metrics = client.getMetrics()
      expect(metrics.failed).toBe(2)
    })

    it('should track retry count', async () => {
      let attempts = 0
      const retryPipeline = {
        send: vi.fn(async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Retry')
          }
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'retry',
            pipeline: retryPipeline,
            retry: { maxAttempts: 3, initialDelayMs: 10 },
          },
        ],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })

      const flushPromise = client.flush()
      await vi.advanceTimersByTimeAsync(100)
      await flushPromise

      const metrics = client.getMetrics()
      expect(metrics.retried).toBe(2) // 2 retries before success
    })

    it('should track metrics per destination', async () => {
      const primaryPipeline = createMockPipeline()
      const failingPipeline = {
        send: vi.fn(async () => {
          throw new Error('Fail')
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          { id: 'primary', pipeline: primaryPipeline },
          { id: 'failing', pipeline: failingPipeline, retry: { maxAttempts: 1 } },
        ],
        batchSize: 1,
      })

      client.track({ event: 'Test', userId: 'u1' })
      await client.flush()

      const metrics = client.getMetrics()
      expect(metrics.byDestination['primary'].sent).toBe(1)
      expect(metrics.byDestination['primary'].failed).toBe(0)
      expect(metrics.byDestination['failing'].sent).toBe(0)
      expect(metrics.byDestination['failing'].failed).toBe(1)
    })

    it('should track dead letter queue count in metrics', async () => {
      const failingPipeline = {
        send: vi.fn(async () => {
          throw new Error('Fail')
        }),
      }

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'failing',
            pipeline: failingPipeline,
            retry: { maxAttempts: 1 },
          },
        ],
        batchSize: 2,
      })

      client.track({ event: 'E1', userId: 'u1' })
      client.track({ event: 'E2', userId: 'u2' })
      await client.flush()

      const metrics = client.getMetrics()
      expect(metrics.deadLetterCount).toBe(2)

      client.clearDeadLetterQueue()
      const clearedMetrics = client.getMetrics()
      expect(clearedMetrics.deadLetterCount).toBe(0)
    })
  })

  // ============================================================================
  // COMBINED FEATURES INTEGRATION TESTS
  // ============================================================================

  describe('combined features integration', () => {
    it('should work with multiple destinations, filters, formats, and retry', async () => {
      const primaryPipeline = createMockPipeline()
      const trackingPipeline = createMockPipeline()
      const identityPipeline = createMockPipeline()

      client = createAnalyticsStreamClient({
        destinations: [
          {
            id: 'primary',
            pipeline: primaryPipeline,
            filter: 'all',
            format: 'json',
          },
          {
            id: 'tracking',
            pipeline: trackingPipeline,
            filter: 'track',
            format: 'ndjson',
          },
          {
            id: 'identity',
            pipeline: identityPipeline,
            filter: ['identify', 'page'],
            format: 'json',
          },
        ],
        batchSize: 10,
        beforeSend: (event) => ({
          ...event,
          metadata: { ...event.metadata, processed: true },
        }),
      })

      // Send various events
      client.track({ event: 'Click', userId: 'u1' })
      client.identify({ userId: 'u1' })
      client.page({ name: 'Home' })
      client.track({ event: 'Purchase', userId: 'u1', properties: { amount: 100 } })

      await client.flush()

      // Primary gets all 4 events (JSON format)
      expect(primaryPipeline.events).toHaveLength(4)
      expect(primaryPipeline.events[0]).toHaveProperty('operation')

      // Tracking gets only 2 track events (NDJSON format)
      expect(trackingPipeline.events).toHaveLength(2)
      expect(typeof trackingPipeline.events[0]).toBe('string')

      // Identity gets identify and page events (JSON format)
      expect(identityPipeline.events).toHaveLength(2)
      expect(identityPipeline.events[0].data.type).toBe('identify')
      expect(identityPipeline.events[1].data.type).toBe('page')

      // Check global transform was applied
      expect(primaryPipeline.events[0].metadata?.processed).toBe(true)

      // Check metrics
      const metrics = client.getMetrics()
      expect(metrics.sent).toBe(8) // 4 + 2 + 2 events across destinations
      expect(metrics.byDestination['primary'].sent).toBe(4)
      expect(metrics.byDestination['tracking'].sent).toBe(2)
      expect(metrics.byDestination['identity'].sent).toBe(2)
    })
  })
})
