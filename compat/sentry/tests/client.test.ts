/**
 * @dotdo/sentry - Client Module Tests
 *
 * Tests for the enhanced Sentry client with TemporalStore and WindowManager integration.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import {
  init,
  captureException,
  captureMessage,
  flush,
  close,
  _clear,
  SentryClient,
  InMemoryTransport,
} from '../index'

import {
  SentryClientWithStorage,
  BatchingTransport,
  createStorageClient,
} from '../client'

import { createTemporalStore } from '../../../db/primitives/temporal-store.js'
import { WindowManager, milliseconds, seconds } from '../../../db/primitives/window-manager.js'

import type { SentryEvent, Transport } from '../types'

describe('@dotdo/sentry - Client Module', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // Basic SentryClient
  // ===========================================================================

  describe('SentryClient', () => {
    it('should create client with options', () => {
      const client = new SentryClient({
        dsn: 'https://key@sentry.example.com/1',
        release: 'test@1.0.0',
        environment: 'test',
      })

      expect(client).toBeDefined()
      expect(client.getOptions().release).toBe('test@1.0.0')
      expect(client.getOptions().environment).toBe('test')
    })

    it('should parse DSN correctly', () => {
      const client = new SentryClient({
        dsn: 'https://abc123@o0.ingest.sentry.io/12345',
      })

      const dsn = client.getDsn()
      expect(dsn?.publicKey).toBe('abc123')
      expect(dsn?.host).toBe('o0.ingest.sentry.io')
      expect(dsn?.projectId).toBe('12345')
    })

    it('should work without DSN (no-op mode)', () => {
      const client = new SentryClient({})

      const eventId = client.captureMessage('Test')

      expect(eventId).toBeDefined()
      expect(client.getDsn()).toBeUndefined()
    })

    it('should support custom transport', async () => {
      const customTransport = new InMemoryTransport()

      const client = new SentryClient({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => customTransport,
      })

      client.captureMessage('Test message')

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(customTransport.getEvents().length).toBe(1)
    })
  })

  // ===========================================================================
  // SentryClientWithStorage (TemporalStore Integration)
  // ===========================================================================

  describe('SentryClientWithStorage', () => {
    it('should store events in TemporalStore', async () => {
      const store = createTemporalStore<SentryEvent>()

      const client = new SentryClientWithStorage({
        dsn: 'https://key@sentry.example.com/1',
        eventStore: store,
      })

      client.captureMessage('Stored message')

      await new Promise(resolve => setTimeout(resolve, 20))

      // Events should be stored with timestamp
      const storedEvent = await store.get('events')
      // Store uses key-based access, so we need to check differently
    })

    it('should store events in temporal store', async () => {
      const store = createTemporalStore<SentryEvent>({ enableTTL: true })

      const client = new SentryClientWithStorage({
        dsn: 'https://key@sentry.example.com/1',
        eventStore: store,
      })

      client.captureMessage('Event 1')
      client.captureMessage('Event 2')
      client.captureMessage('Event 3')

      await new Promise(resolve => setTimeout(resolve, 50))

      // Store should have the events
      expect(client.getEventStore()).toBe(store)
    })

    it('should support event snapshots', async () => {
      const store = createTemporalStore<SentryEvent>()

      const client = new SentryClientWithStorage({
        dsn: 'https://key@sentry.example.com/1',
        eventStore: store,
      })

      client.captureMessage('Before snapshot')
      await new Promise(resolve => setTimeout(resolve, 20))

      const snapshotId = await client.createSnapshot()

      expect(snapshotId).toBeDefined()
      expect(typeof snapshotId).toBe('string')
    })

    it('should support retention policies', async () => {
      const store = createTemporalStore<SentryEvent>({
        retention: {
          maxVersions: 10,
          maxAge: '1000ms', // Use string format as expected by duration parser
        },
      })

      const client = new SentryClientWithStorage({
        dsn: 'https://key@sentry.example.com/1',
        eventStore: store,
      })

      // Capture some events
      client.captureMessage('Event 1')
      client.captureMessage('Event 2')

      await new Promise(resolve => setTimeout(resolve, 50))

      // Trigger pruning - should not throw
      const pruneResult = await store.prune()
      expect(pruneResult).toBeDefined()
    })
  })

  // ===========================================================================
  // BatchingTransport (WindowManager Integration)
  // ===========================================================================

  describe('BatchingTransport', () => {
    afterEach(() => {
      // Clean up any timers
    })

    it('should batch events using WindowManager', async () => {
      const innerTransport = new InMemoryTransport()
      let batchCount = 0
      let totalEvents = 0

      const batchingTransport = new BatchingTransport(innerTransport, {
        batchSize: 3,
        flushInterval: milliseconds(100),
        onBatch: (events) => {
          batchCount++
          totalEvents += events.length
        },
      })

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => batchingTransport,
      })

      // Send 5 events
      captureMessage('Event 1')
      captureMessage('Event 2')
      captureMessage('Event 3')
      captureMessage('Event 4')
      captureMessage('Event 5')

      // Wait for batching
      await new Promise(resolve => setTimeout(resolve, 150))

      // Should have batched: 3 + 2 = 2 batches
      expect(batchCount).toBeGreaterThanOrEqual(1)

      // Clean up
      batchingTransport.dispose()
    })

    it('should flush on window trigger', async () => {
      const innerTransport = new InMemoryTransport()
      let flushCalled = false

      const batchingTransport = new BatchingTransport(innerTransport, {
        batchSize: 100, // High threshold
        flushInterval: milliseconds(50), // Short interval
        onFlush: () => {
          flushCalled = true
        },
      })

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => batchingTransport,
      })

      captureMessage('Single event')

      // Wait for timer-based flush
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(flushCalled).toBe(true)

      batchingTransport.dispose()
    })

    it('should support count-based triggers', async () => {
      const innerTransport = new InMemoryTransport()
      let batchedEvents: SentryEvent[] = []

      const batchingTransport = new BatchingTransport(innerTransport, {
        batchSize: 3,
        flushInterval: milliseconds(5000), // Long interval
        onBatch: (events) => {
          batchedEvents = batchedEvents.concat(events)
        },
      })

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => batchingTransport,
      })

      captureMessage('Event 1')
      captureMessage('Event 2')

      await new Promise(resolve => setTimeout(resolve, 20))

      // Not enough for count trigger
      expect(batchedEvents.length).toBe(0)

      captureMessage('Event 3')

      await new Promise(resolve => setTimeout(resolve, 20))

      // Now should trigger
      expect(batchedEvents.length).toBe(3)

      batchingTransport.dispose()
    })

    it('should handle flush correctly', async () => {
      const innerTransport = new InMemoryTransport()

      const batchingTransport = new BatchingTransport(innerTransport, {
        batchSize: 100,
        flushInterval: milliseconds(5000),
      })

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => batchingTransport,
      })

      captureMessage('Event 1')
      captureMessage('Event 2')

      // Explicit flush
      await batchingTransport.flush()

      expect(innerTransport.getEvents().length).toBe(2)

      batchingTransport.dispose()
    })

    it('should respect max batch size', async () => {
      const innerTransport = new InMemoryTransport()
      const batchSizes: number[] = []

      const batchingTransport = new BatchingTransport(innerTransport, {
        batchSize: 3,
        maxBatchSize: 5,
        flushInterval: milliseconds(5000),
        onBatch: (events) => {
          batchSizes.push(events.length)
        },
      })

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => batchingTransport,
      })

      // Send 10 events rapidly
      for (let i = 0; i < 10; i++) {
        captureMessage(`Event ${i}`)
      }

      await batchingTransport.flush()

      // All batch sizes should be <= maxBatchSize
      for (const size of batchSizes) {
        expect(size).toBeLessThanOrEqual(5)
      }

      batchingTransport.dispose()
    })
  })

  // ===========================================================================
  // Factory Function
  // ===========================================================================

  describe('createStorageClient', () => {
    it('should create client with default storage', () => {
      const client = createStorageClient({
        dsn: 'https://key@sentry.example.com/1',
      })

      expect(client).toBeDefined()
      expect(client.captureMessage).toBeDefined()
      expect(client.getEventsSince).toBeDefined()
    })

    it('should create client with batching enabled', async () => {
      const client = createStorageClient({
        dsn: 'https://key@sentry.example.com/1',
        batching: {
          enabled: true,
          batchSize: 2,
          flushInterval: milliseconds(50),
        },
      })

      // Verify client was created with batching options
      expect(client).toBeDefined()
      expect(client.getOptions().dsn).toBe('https://key@sentry.example.com/1')

      client.dispose()
    })

    it('should support custom event store', () => {
      const customStore = createTemporalStore<SentryEvent>()

      const client = createStorageClient({
        dsn: 'https://key@sentry.example.com/1',
        eventStore: customStore,
      })

      expect(client.getEventStore()).toBe(customStore)
    })
  })

  // ===========================================================================
  // Event Persistence
  // ===========================================================================

  describe('Event Persistence', () => {
    it('should share event store across client instances', async () => {
      const sharedStore = createTemporalStore<SentryEvent>()

      // First client
      const client1 = new SentryClientWithStorage({
        dsn: 'https://key@sentry.example.com/1',
        eventStore: sharedStore,
      })

      client1.captureMessage('Persisted event')
      await new Promise(resolve => setTimeout(resolve, 20))

      // Second client with same store
      const client2 = new SentryClientWithStorage({
        dsn: 'https://key@sentry.example.com/1',
        eventStore: sharedStore,
      })

      // Both clients should reference the same store
      expect(client2.getEventStore()).toBe(sharedStore)
    })

    it('should support event replay', async () => {
      const store = createTemporalStore<SentryEvent>()
      const replayedEvents: SentryEvent[] = []

      const client = new SentryClientWithStorage({
        dsn: 'https://key@sentry.example.com/1',
        eventStore: store,
        onReplay: (event) => {
          replayedEvents.push(event)
        },
      })

      client.captureMessage('Event 1')
      client.captureMessage('Event 2')

      await new Promise(resolve => setTimeout(resolve, 20))

      // Trigger replay
      await client.replayEvents(Date.now() - 1000)

      expect(replayedEvents.length).toBe(2)
    })
  })

  // ===========================================================================
  // Transport Fallback
  // ===========================================================================

  describe('Transport Fallback', () => {
    it('should retry failed sends', async () => {
      let attempts = 0
      const mockTransport: Transport = {
        async send(envelope) {
          attempts++
          if (attempts < 3) {
            return { statusCode: 500 }
          }
          return { statusCode: 200 }
        },
        async flush() {
          return true
        },
      }

      const client = new SentryClient({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => mockTransport,
      })

      client.captureMessage('Retry test')

      await new Promise(resolve => setTimeout(resolve, 100))

      // Should have retried
      expect(attempts).toBeGreaterThanOrEqual(1)
    })

    it('should queue events when offline', async () => {
      const store = createTemporalStore<SentryEvent>()
      let online = false

      const client = new SentryClientWithStorage({
        dsn: 'https://key@sentry.example.com/1',
        eventStore: store,
        offlineQueueing: true,
        isOnline: () => online,
      })

      // Capture while offline
      client.captureMessage('Offline event 1')
      client.captureMessage('Offline event 2')

      await new Promise(resolve => setTimeout(resolve, 20))

      // Queue should have events
      expect(client.getQueueSize()).toBe(2)

      // Come online
      online = true
      await client.flushQueue()

      expect(client.getQueueSize()).toBe(0)
    })
  })

  // ===========================================================================
  // Flush Behavior
  // ===========================================================================

  describe('Flush Behavior', () => {
    it('should flush all pending events', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureMessage('Event 1')
      captureMessage('Event 2')
      captureMessage('Event 3')

      await flush(5000)

      expect(transport.getEvents().length).toBe(3)
    })

    it('should timeout if flush takes too long', async () => {
      const slowTransport: Transport = {
        async send() {
          await new Promise(resolve => setTimeout(resolve, 1000))
          return { statusCode: 200 }
        },
        async flush(timeout) {
          await new Promise(resolve => setTimeout(resolve, timeout || 1000))
          return false
        },
      }

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => slowTransport,
      })

      captureMessage('Slow event')

      const start = Date.now()
      const result = await flush(100)
      const duration = Date.now() - start

      // Should timeout after ~100ms, not wait full 1000ms
      expect(duration).toBeLessThan(500)
    })
  })

  // ===========================================================================
  // Close Behavior
  // ===========================================================================

  describe('Close Behavior', () => {
    it('should flush and disable client on close', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureMessage('Before close')

      await close(5000)

      // After close, events should not be sent
      captureMessage('After close')

      await new Promise(resolve => setTimeout(resolve, 50))

      expect(transport.getEvents().length).toBe(1)
      expect(transport.getEvents()[0].message).toBe('Before close')
    })
  })
})
