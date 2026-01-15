/**
 * Coalescing Buffer Cleanup Tests
 *
 * Wave 5: Performance & Scalability - Task 2 (do-c1e7, do-wqec)
 *
 * Tests for stale coalescing buffer cleanup to prevent memory leaks.
 *
 * @module streaming/tests/coalescing-buffer-cleanup.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Install WebSocket mock for test environment
import { installWebSocketMock } from './utils/websocket-mock'
installWebSocketMock()

import { EventStreamDO } from '../event-stream-do'

describe('Coalescing Buffer Cleanup', () => {
  let eventStream: EventStreamDO
  let mockState: any

  beforeEach(() => {
    vi.useFakeTimers()

    mockState = {
      storage: {
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue(new Map()),
      },
      id: { toString: () => 'test-id' },
      waitUntil: vi.fn(),
    }

    eventStream = new EventStreamDO(mockState, {}, {
      coalescing: {
        enabled: true,
        maxDelayMs: 100,
        maxBatchSize: 10,
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cleanupStaleBuffers removes buffers older than threshold', async () => {
    // Get access to private members for testing
    const buffers = (eventStream as any).coalescingBuffers
    const timers = (eventStream as any).coalescingTimers

    // Add a stale buffer (6 minutes old)
    const staleTime = Date.now() - 6 * 60 * 1000
    buffers.set('stale-topic', {
      events: [{ id: 'event-1', type: 'test', topic: 'stale-topic', payload: {}, timestamp: staleTime }],
      topic: 'stale-topic',
      scheduledAt: staleTime,
      lastActivity: staleTime,
    })

    // Add a fresh buffer
    buffers.set('fresh-topic', {
      events: [{ id: 'event-2', type: 'test', topic: 'fresh-topic', payload: {}, timestamp: Date.now() }],
      topic: 'fresh-topic',
      scheduledAt: Date.now(),
      lastActivity: Date.now(),
    })

    // Add timers for both
    timers.set('stale-topic', setTimeout(() => {}, 1000))
    timers.set('fresh-topic', setTimeout(() => {}, 1000))

    expect(buffers.size).toBe(2)
    expect(timers.size).toBe(2)

    // Run cleanup with 5 minute threshold
    const cleanedCount = eventStream.cleanupStaleBuffers(5 * 60 * 1000)

    // Should have cleaned up only the stale buffer
    expect(cleanedCount).toBe(1)
    expect(buffers.size).toBe(1)
    expect(buffers.has('stale-topic')).toBe(false)
    expect(buffers.has('fresh-topic')).toBe(true)

    // Timer for stale topic should be cleared
    expect(timers.has('stale-topic')).toBe(false)
    expect(timers.has('fresh-topic')).toBe(true)
  })

  it('cleanupStaleBuffers uses default 5 minute threshold', async () => {
    const buffers = (eventStream as any).coalescingBuffers

    // Add a buffer that's 4 minutes old (should NOT be cleaned)
    const fourMinutesAgo = Date.now() - 4 * 60 * 1000
    buffers.set('recent-topic', {
      events: [],
      topic: 'recent-topic',
      scheduledAt: fourMinutesAgo,
      lastActivity: fourMinutesAgo,
    })

    // Add a buffer that's 6 minutes old (should be cleaned)
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000
    buffers.set('old-topic', {
      events: [],
      topic: 'old-topic',
      scheduledAt: sixMinutesAgo,
      lastActivity: sixMinutesAgo,
    })

    // Cleanup with default threshold
    const cleanedCount = eventStream.cleanupStaleBuffers()

    expect(cleanedCount).toBe(1)
    expect(buffers.has('recent-topic')).toBe(true)
    expect(buffers.has('old-topic')).toBe(false)
  })

  it('cleanupStaleBuffers clears associated timers', async () => {
    const buffers = (eventStream as any).coalescingBuffers
    const timers = (eventStream as any).coalescingTimers

    // Add a stale buffer with timer
    const staleTime = Date.now() - 10 * 60 * 1000
    buffers.set('stale-with-timer', {
      events: [],
      topic: 'stale-with-timer',
      scheduledAt: staleTime,
      lastActivity: staleTime,
    })

    const mockTimer = setTimeout(() => {}, 1000)
    timers.set('stale-with-timer', mockTimer)

    eventStream.cleanupStaleBuffers(5 * 60 * 1000)

    expect(timers.has('stale-with-timer')).toBe(false)
  })

  it('cleanupStaleBuffers returns 0 when no stale buffers exist', async () => {
    const buffers = (eventStream as any).coalescingBuffers

    // Add only fresh buffers
    buffers.set('fresh-1', {
      events: [],
      topic: 'fresh-1',
      scheduledAt: Date.now(),
      lastActivity: Date.now(),
    })
    buffers.set('fresh-2', {
      events: [],
      topic: 'fresh-2',
      scheduledAt: Date.now(),
      lastActivity: Date.now(),
    })

    const cleanedCount = eventStream.cleanupStaleBuffers(5 * 60 * 1000)

    expect(cleanedCount).toBe(0)
    expect(buffers.size).toBe(2)
  })

  it('cleanupStaleBuffers handles empty buffer map', () => {
    const cleanedCount = eventStream.cleanupStaleBuffers()
    expect(cleanedCount).toBe(0)
  })

  it('runCleanup calls cleanupStaleBuffers', async () => {
    const buffers = (eventStream as any).coalescingBuffers

    // Add a stale buffer
    const staleTime = Date.now() - 10 * 60 * 1000
    buffers.set('stale-topic', {
      events: [],
      topic: 'stale-topic',
      scheduledAt: staleTime,
      lastActivity: staleTime,
    })

    // Run the cleanup method
    await eventStream.runCleanup()

    // Buffer should be cleaned up
    expect(buffers.has('stale-topic')).toBe(false)
  })

  it('coalesceEvent updates lastActivity on existing buffer', async () => {
    const buffers = (eventStream as any).coalescingBuffers

    // Manually set up initial buffer with old lastActivity
    const oldTime = Date.now() - 60 * 1000
    buffers.set('test-topic', {
      events: [],
      topic: 'test-topic',
      scheduledAt: oldTime,
      lastActivity: oldTime,
    })

    // Advance time
    vi.advanceTimersByTime(1000)

    // Call coalesceEvent (need to access private method for testing)
    const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)
    coalesceEvent('test-topic', {
      id: 'new-event',
      type: 'test',
      topic: 'test-topic',
      payload: {},
      timestamp: Date.now(),
    })

    const buffer = buffers.get('test-topic')
    expect(buffer.lastActivity).toBeGreaterThan(oldTime)
    expect(buffer.events).toHaveLength(1)
  })

  it('new buffer gets lastActivity set on creation', async () => {
    const buffers = (eventStream as any).coalescingBuffers

    // Call coalesceEvent to create a new buffer
    const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)
    coalesceEvent('new-topic', {
      id: 'first-event',
      type: 'test',
      topic: 'new-topic',
      payload: {},
      timestamp: Date.now(),
    })

    const buffer = buffers.get('new-topic')
    expect(buffer).toBeDefined()
    expect(buffer.lastActivity).toBeDefined()
    expect(buffer.lastActivity).toBeCloseTo(Date.now(), -2) // Within 100ms
  })

  it('cleanupStaleBuffers logs warning for buffers with unflushed events', async () => {
    const buffers = (eventStream as any).coalescingBuffers
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Add stale buffer with unflushed events
    const staleTime = Date.now() - 10 * 60 * 1000
    buffers.set('stale-with-events', {
      events: [
        { id: 'event-1', type: 'test', topic: 'stale-with-events', payload: {}, timestamp: staleTime },
        { id: 'event-2', type: 'test', topic: 'stale-with-events', payload: {}, timestamp: staleTime },
      ],
      topic: 'stale-with-events',
      scheduledAt: staleTime,
      lastActivity: staleTime,
    })

    eventStream.cleanupStaleBuffers(5 * 60 * 1000)

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cleaned up stale buffer for topic "stale-with-events" with 2 unflushed events')
    )

    consoleWarnSpy.mockRestore()
  })

  it('cleanupStaleBuffers does not log for empty stale buffers', async () => {
    const buffers = (eventStream as any).coalescingBuffers
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Add stale buffer with no events
    const staleTime = Date.now() - 10 * 60 * 1000
    buffers.set('stale-empty', {
      events: [],
      topic: 'stale-empty',
      scheduledAt: staleTime,
      lastActivity: staleTime,
    })

    eventStream.cleanupStaleBuffers(5 * 60 * 1000)

    expect(consoleWarnSpy).not.toHaveBeenCalled()

    consoleWarnSpy.mockRestore()
  })
})

describe('getCoalescingStats includes buffer activity', () => {
  let eventStream: EventStreamDO
  let mockState: any

  beforeEach(() => {
    mockState = {
      storage: {
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue(new Map()),
      },
      id: { toString: () => 'test-id' },
      waitUntil: vi.fn(),
    }

    eventStream = new EventStreamDO(mockState, {}, {
      coalescing: {
        enabled: true,
        maxDelayMs: 100,
        maxBatchSize: 10,
      },
    })
  })

  it('getCoalescingStats returns correct counts', () => {
    const buffers = (eventStream as any).coalescingBuffers

    // Add buffers with different event counts
    buffers.set('topic-1', {
      events: [{ id: '1' }, { id: '2' }, { id: '3' }],
      topic: 'topic-1',
      scheduledAt: Date.now(),
      lastActivity: Date.now(),
    })
    buffers.set('topic-2', {
      events: [{ id: '4' }, { id: '5' }],
      topic: 'topic-2',
      scheduledAt: Date.now(),
      lastActivity: Date.now(),
    })

    const stats = eventStream.getCoalescingStats()

    expect(stats.pendingTopics).toBe(2)
    expect(stats.pendingEvents).toBe(5)
  })
})
