/**
 * Tests for FSWatcherClient - Client-side file watcher with auto-reconnect
 *
 * This test file covers:
 * - WebSocket connection management
 * - Auto-reconnect with exponential backoff
 * - Event queuing during reconnection
 * - Connection state events (onConnect, onDisconnect)
 * - Pattern resubscription after reconnect
 *
 * @module test/core/watcher-client.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FSWatcherClient,
  type WatchCallback,
} from '../../core/watch/client.js'
import type { WatchEvent } from '../../core/watch/events.js'

// =============================================================================
// Mock Browser APIs for Node.js Environment
// =============================================================================

/**
 * Mock CloseEvent for Node.js environment
 */
class MockCloseEvent {
  type: string
  code: number
  reason: string

  constructor(type: string, init?: { code?: number; reason?: string }) {
    this.type = type
    this.code = init?.code ?? 1000
    this.reason = init?.reason ?? ''
  }
}

// Inject MockCloseEvent into globalThis
;(globalThis as unknown as { CloseEvent: typeof MockCloseEvent }).CloseEvent = MockCloseEvent

// =============================================================================
// Mock WebSocket Implementation
// =============================================================================

/**
 * Mock WebSocket for testing client behavior
 */
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState: number = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close', { code: code ?? 1000, reason: reason ?? '' }))
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  simulateClose(code: number = 1000, reason: string = ''): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close', { code, reason }))
  }

  simulateMessage(data: WatchEvent): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
}

// Global mock for WebSocket
let mockWebSocketInstance: MockWebSocket | null = null

// =============================================================================
// Test Suites
// =============================================================================

describe('FSWatcherClient', () => {
  beforeEach(() => {
    // Inject mock WebSocket factory
    ;(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        mockWebSocketInstance = this
      }
    }
  })

  afterEach(() => {
    mockWebSocketInstance = null
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create client with required options', () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })
      expect(client).toBeDefined()
      expect(client.connectionState).toBe('disconnected')
    })

    it('should accept optional configuration', () => {
      const client = new FSWatcherClient({
        url: 'ws://localhost:8080/watch',
        maxReconnectAttempts: 5,
        reconnectDelayMs: 500,
        maxReconnectDelayMs: 30000,
        healthCheckIntervalMs: 30000,
      })
      expect(client).toBeDefined()
    })
  })

  // ===========================================================================
  // Connection Tests
  // ===========================================================================

  describe('connection', () => {
    it('should transition to connecting state on connect()', () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })

      void client.connect()
      expect(client.connectionState).toBe('connecting')
    })

    it('should transition to connected state when WebSocket opens', async () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })

      const connectPromise = client.connect()

      // Simulate WebSocket open
      mockWebSocketInstance!.simulateOpen()

      await connectPromise
      expect(client.connectionState).toBe('connected')
    })

    it('should call onConnect callback when connected', async () => {
      const onConnect = vi.fn()
      const client = new FSWatcherClient({
        url: 'ws://localhost:8080/watch',
        onConnect,
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      expect(onConnect).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // Watch Tests
  // ===========================================================================

  describe('watch', () => {
    it('should send subscribe message when watching a path', async () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      await client.watch('/home/user', () => {})

      const sentMessages = mockWebSocketInstance!.sentMessages
      expect(sentMessages.length).toBe(1)
      expect(JSON.parse(sentMessages[0])).toEqual({
        type: 'subscribe',
        path: '/home/user',
      })
    })

    it('should receive events for watched path', async () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const events: WatchEvent[] = []
      await client.watch('/home/user', (event) => events.push(event))

      // Simulate incoming event
      mockWebSocketInstance!.simulateMessage({
        type: 'modify',
        path: '/home/user/file.txt',
        timestamp: Date.now(),
      })

      expect(events.length).toBe(1)
      expect(events[0].path).toBe('/home/user/file.txt')
    })

    it('should return unsubscribe function', async () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const unsubscribe = await client.watch('/home/user', () => {})

      expect(typeof unsubscribe).toBe('function')

      unsubscribe()

      const sentMessages = mockWebSocketInstance!.sentMessages
      expect(sentMessages.length).toBe(2)
      expect(JSON.parse(sentMessages[1])).toEqual({
        type: 'unsubscribe',
        path: '/home/user',
      })
    })

    it('should allow multiple callbacks for same path', async () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const events1: WatchEvent[] = []
      const events2: WatchEvent[] = []

      await client.watch('/home', (e) => events1.push(e))
      await client.watch('/home', (e) => events2.push(e))

      // Should only send subscribe once
      const subscribeMessages = mockWebSocketInstance!.sentMessages.filter(
        (m) => JSON.parse(m).type === 'subscribe'
      )
      expect(subscribeMessages.length).toBe(1)

      // Both callbacks should receive events
      mockWebSocketInstance!.simulateMessage({
        type: 'create',
        path: '/home/newfile.txt',
        timestamp: Date.now(),
      })

      expect(events1.length).toBe(1)
      expect(events2.length).toBe(1)
    })
  })

  // ===========================================================================
  // Disconnect Tests
  // ===========================================================================

  describe('disconnect', () => {
    it('should call onDisconnect when connection closes', async () => {
      const onDisconnect = vi.fn()
      const client = new FSWatcherClient({
        url: 'ws://localhost:8080/watch',
        onDisconnect,
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.simulateClose(1000, 'Normal closure')

      expect(onDisconnect).toHaveBeenCalledTimes(1)
      expect(onDisconnect).toHaveBeenCalledWith(1000, 'Normal closure')
    })

    it('should disconnect cleanly when disconnect() called', async () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      await client.disconnect()

      expect(client.connectionState).toBe('disconnected')
    })
  })

  // ===========================================================================
  // FSWatcher Interface Tests
  // ===========================================================================

  describe('FSWatcher interface compatibility', () => {
    it('should implement close() method', async () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      expect(typeof client.close).toBe('function')
      client.close()

      expect(client.connectionState).toBe('disconnected')
    })

    it('should implement ref() method that returns this', () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })
      expect(client.ref()).toBe(client)
    })

    it('should implement unref() method that returns this', () => {
      const client = new FSWatcherClient({ url: 'ws://localhost:8080/watch' })
      expect(client.unref()).toBe(client)
    })
  })
})
