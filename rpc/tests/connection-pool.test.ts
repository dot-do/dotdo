/**
 * Connection Pool Tests - TDD
 *
 * Tests for capnweb RPC client connection reuse with:
 * 1. Single WebSocket per DO
 * 2. Connection pooling with LRU eviction
 * 3. Automatic reconnection on disconnect
 * 4. Request pipelining (multiple calls, single roundtrip)
 *
 * These tests use a mock WebSocket to verify connection pooling behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConnectionPool,
  type ConnectionPoolOptions,
  type PooledConnection,
  type WebSocketFactory,
} from '../connection-pool'

// Mock WebSocket for testing
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url: string
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private messageHandlers: ((event: MessageEvent) => void)[] = []
  private closeHandlers: ((event: CloseEvent) => void)[] = []
  private openHandlers: ((event: Event) => void)[] = []
  private errorHandlers: ((event: Event) => void)[] = []
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null

  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    // Simulate async connection
    this.connectTimeoutId = setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN
        const event = new Event('open')
        this.onopen?.(event)
        this.openHandlers.forEach((h) => h(event))
      }
    }, 5)
  }

  addEventListener(type: string, handler: (event: Event) => void): void {
    if (type === 'open') this.openHandlers.push(handler as (event: Event) => void)
    if (type === 'close') this.closeHandlers.push(handler as (event: CloseEvent) => void)
    if (type === 'message') this.messageHandlers.push(handler as (event: MessageEvent) => void)
    if (type === 'error') this.errorHandlers.push(handler as (event: Event) => void)
  }

  removeEventListener(type: string, handler: (event: Event) => void): void {
    if (type === 'open') this.openHandlers = this.openHandlers.filter((h) => h !== handler)
    if (type === 'close') this.closeHandlers = this.closeHandlers.filter((h) => h !== handler)
    if (type === 'message') this.messageHandlers = this.messageHandlers.filter((h) => h !== handler)
    if (type === 'error') this.errorHandlers = this.errorHandlers.filter((h) => h !== handler)
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string): void {
    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId)
      this.connectTimeoutId = null
    }
    this.readyState = MockWebSocket.CLOSED
    const event = new CloseEvent('close', { code, reason })
    this.onclose?.(event)
    this.closeHandlers.forEach((h) => h(event))
  }

  // Test helper to simulate receiving a message
  simulateMessage(data: string): void {
    const event = new MessageEvent('message', { data })
    this.onmessage?.(event)
    this.messageHandlers.forEach((h) => h(event))
  }

  // Test helper to simulate an error
  simulateError(): void {
    const event = new Event('error')
    this.onerror?.(event)
    this.errorHandlers.forEach((h) => h(event))
  }

  // Test helper to force immediate open
  forceOpen(): void {
    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId)
      this.connectTimeoutId = null
    }
    this.readyState = MockWebSocket.OPEN
    const event = new Event('open')
    this.onopen?.(event)
    this.openHandlers.forEach((h) => h(event))
  }
}

describe('ConnectionPool', () => {
  let pool: ConnectionPool | undefined
  let createdSockets: MockWebSocket[] = []
  let mockWebSocketFactory: WebSocketFactory

  // Helper to create a fresh factory that tracks sockets in a new array
  function createMockFactory(): { factory: WebSocketFactory; sockets: MockWebSocket[] } {
    const sockets: MockWebSocket[] = []
    const factory: WebSocketFactory = (url: string) => {
      const ws = new MockWebSocket(url)
      sockets.push(ws)
      createdSockets.push(ws) // Also add to global array for cleanup
      return ws as unknown as WebSocket
    }
    return { factory, sockets }
  }

  beforeEach(() => {
    createdSockets = []
    // Create a mock WebSocket factory
    mockWebSocketFactory = (url: string) => {
      const ws = new MockWebSocket(url)
      createdSockets.push(ws)
      return ws as unknown as WebSocket
    }
  })

  afterEach(async () => {
    // Close pool first
    if (pool) {
      await pool.close()
      pool = undefined
    }

    // Force close any remaining sockets
    for (const socket of createdSockets) {
      if (socket.readyState !== MockWebSocket.CLOSED) {
        socket.close()
      }
    }
    createdSockets = []

    vi.clearAllMocks()
  })

  describe('Single WebSocket per DO', () => {
    it('should create only one connection per unique DO URL', async () => {
      pool = new ConnectionPool({ maxConnections: 10, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      const url = 'wss://do1.example.com'

      // Get connection - wait for mock to connect
      const connPromise1 = pool.getConnection(url)

      // Force open the socket
      await new Promise((r) => setTimeout(r, 10))

      const conn1 = await connPromise1
      const conn2 = await pool.getConnection(url)

      // Should be the same connection instance
      expect(conn1).toBe(conn2)
      // Only one WebSocket should have been created
      expect(createdSockets.length).toBe(1)
    })

    it('should create separate connections for different DOs', async () => {
      pool = new ConnectionPool({ maxConnections: 10, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      // Start connections
      const connPromise1 = pool.getConnection('wss://do1.example.com')
      const connPromise2 = pool.getConnection('wss://do2.example.com')

      // Wait for connections
      await new Promise((r) => setTimeout(r, 10))

      const conn1 = await connPromise1
      const conn2 = await connPromise2

      // Should be different connection instances
      expect(conn1).not.toBe(conn2)
      // Two WebSockets should have been created
      expect(createdSockets.length).toBe(2)
    })

    it('should reuse connection when called concurrently for same DO', async () => {
      pool = new ConnectionPool({ maxConnections: 10, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      const url = 'wss://do1.example.com'

      // Get connections concurrently
      const [conn1, conn2, conn3] = await Promise.all([
        pool.getConnection(url),
        pool.getConnection(url),
        pool.getConnection(url),
      ])

      // All should be the same connection
      expect(conn1).toBe(conn2)
      expect(conn2).toBe(conn3)
      // Only one WebSocket should have been created
      expect(createdSockets.length).toBe(1)
    })
  })

  describe('Connection Pooling with LRU Eviction', () => {
    it('should evict least recently used connections when pool is full', async () => {
      pool = new ConnectionPool({ maxConnections: 2, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      // Create 2 connections (at max)
      await pool.getConnection('wss://do1.example.com')
      await pool.getConnection('wss://do2.example.com')

      // Access conn1 again to make it most recently used
      await pool.getConnection('wss://do1.example.com')

      // Create a third connection - should evict do2 (LRU)
      await pool.getConnection('wss://do3.example.com')

      // do1 should still be available (reused)
      expect(pool.has('wss://do1.example.com')).toBe(true)
      // do2 should have been evicted
      expect(pool.has('wss://do2.example.com')).toBe(false)
      // do3 should exist
      expect(pool.has('wss://do3.example.com')).toBe(true)
    })

    it('should respect maxConnections limit', async () => {
      pool = new ConnectionPool({ maxConnections: 3, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      // Create connections up to the limit
      await pool.getConnection('wss://do1.example.com')
      await pool.getConnection('wss://do2.example.com')
      await pool.getConnection('wss://do3.example.com')

      expect(pool.size()).toBe(3)

      // Creating another should evict one
      await pool.getConnection('wss://do4.example.com')

      // Size should still be at max
      expect(pool.size()).toBeLessThanOrEqual(3)
    })

    it('should update LRU order on access', async () => {
      pool = new ConnectionPool({ maxConnections: 2, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      // Create two connections
      await pool.getConnection('wss://do1.example.com')
      await pool.getConnection('wss://do2.example.com')

      // Access do1 to make it most recently used
      await pool.getConnection('wss://do1.example.com')

      // Add a new connection - do2 should be evicted (LRU)
      await pool.getConnection('wss://do3.example.com')

      // Verify do1 is still cached
      expect(pool.has('wss://do1.example.com')).toBe(true)
      // do2 should have been evicted
      expect(pool.has('wss://do2.example.com')).toBe(false)
    })

    it('should support TTL-based expiration', async () => {
      pool = new ConnectionPool({ maxConnections: 10, ttlMs: 50, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      await pool.getConnection('wss://do1.example.com')
      expect(pool.has('wss://do1.example.com')).toBe(true)

      // Wait for TTL to expire and cleanup to run
      await new Promise((r) => setTimeout(r, 100))

      // Should be expired
      expect(pool.has('wss://do1.example.com')).toBe(false)
    })
  })

  describe('Automatic Reconnection', () => {
    it('should automatically reconnect when connection is lost', async () => {
      pool = new ConnectionPool({
        maxConnections: 10,
        autoReconnect: true,
        reconnectDelayMs: 5,
        maxReconnectAttempts: 3,
        webSocketFactory: mockWebSocketFactory,
      })

      const url = 'wss://do1.example.com'
      await pool.getConnection(url)

      expect(createdSockets.length).toBe(1)

      // Simulate connection close
      createdSockets[0].close(1006, 'Connection lost')

      // Wait for reconnect
      await new Promise((r) => setTimeout(r, 30))

      // A new WebSocket should have been created for reconnection
      expect(createdSockets.length).toBeGreaterThanOrEqual(2)
    })

    it('should not reconnect when autoReconnect is false', async () => {
      // Use a fresh factory with its own socket tracking
      const { factory, sockets } = createMockFactory()

      pool = new ConnectionPool({
        maxConnections: 10,
        autoReconnect: false,
        webSocketFactory: factory,
      })

      const url = 'wss://do1.example.com'
      await pool.getConnection(url)

      // One socket should have been created for this test
      expect(sockets.length).toBe(1)

      // Simulate connection close
      sockets[0].close(1006, 'Connection lost')

      // Wait a bit
      await new Promise((r) => setTimeout(r, 30))

      // Connection should be removed from pool
      expect(pool.has(url)).toBe(false)
      // No new WebSocket should have been created
      expect(sockets.length).toBe(1)
    })
  })

  describe('Request Pipelining', () => {
    it('should batch multiple calls into a single message', async () => {
      pool = new ConnectionPool({ maxConnections: 10, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      const url = 'wss://do1.example.com'
      const conn = await pool.getConnection(url)

      // Start pipelining
      conn.startPipeline()

      // Queue multiple calls
      const call1 = conn.call('method1', ['arg1'])
      const call2 = conn.call('method2', ['arg2', 'arg3'])
      const call3 = conn.call('method3', [])

      // Flush the pipeline
      conn.flushPipeline()

      // Should have sent only one message containing all calls
      expect(createdSockets[0].sentMessages.length).toBe(1)

      const sentMessage = JSON.parse(createdSockets[0].sentMessages[0])
      expect(sentMessage.batch).toHaveLength(3)
      expect(sentMessage.batch[0].method).toBe('method1')
      expect(sentMessage.batch[1].method).toBe('method2')
      expect(sentMessage.batch[2].method).toBe('method3')

      // Simulate batch response
      createdSockets[0].simulateMessage(
        JSON.stringify({
          batchId: sentMessage.batchId,
          results: [
            { id: sentMessage.batch[0].id, result: 'result1' },
            { id: sentMessage.batch[1].id, result: 'result2' },
            { id: sentMessage.batch[2].id, result: 'result3' },
          ],
        })
      )

      // All calls should resolve
      const [result1, result2, result3] = await Promise.all([call1, call2, call3])
      expect(result1).toBe('result1')
      expect(result2).toBe('result2')
      expect(result3).toBe('result3')
    })

    it('should send immediately when not in pipeline mode', async () => {
      pool = new ConnectionPool({ maxConnections: 10, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      const url = 'wss://do1.example.com'
      const conn = await pool.getConnection(url)

      // Make individual calls (not pipelined)
      const call1Promise = conn.call('method1', ['arg1'])
      const call2Promise = conn.call('method2', ['arg2'])

      // Each call should have sent a separate message
      expect(createdSockets[0].sentMessages.length).toBe(2)

      // Simulate responses
      const msg1 = JSON.parse(createdSockets[0].sentMessages[0])
      const msg2 = JSON.parse(createdSockets[0].sentMessages[1])

      createdSockets[0].simulateMessage(
        JSON.stringify({ id: msg1.id, result: 'result1' })
      )
      createdSockets[0].simulateMessage(
        JSON.stringify({ id: msg2.id, result: 'result2' })
      )

      const [result1, result2] = await Promise.all([call1Promise, call2Promise])
      expect(result1).toBe('result1')
      expect(result2).toBe('result2')
    })

    it('should handle pipeline with mixed success and error responses', async () => {
      pool = new ConnectionPool({ maxConnections: 10, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      const url = 'wss://do1.example.com'
      const conn = await pool.getConnection(url)

      conn.startPipeline()
      const call1 = conn.call('method1', [])
      const call2 = conn.call('methodThatFails', [])
      const call3 = conn.call('method3', [])
      conn.flushPipeline()

      const sentMessage = JSON.parse(createdSockets[0].sentMessages[0])

      // Simulate mixed response
      createdSockets[0].simulateMessage(
        JSON.stringify({
          batchId: sentMessage.batchId,
          results: [
            { id: sentMessage.batch[0].id, result: 'success1' },
            { id: sentMessage.batch[1].id, error: { code: 'ERROR', message: 'Something failed' } },
            { id: sentMessage.batch[2].id, result: 'success3' },
          ],
        })
      )

      await expect(call1).resolves.toBe('success1')
      await expect(call2).rejects.toThrow('Something failed')
      await expect(call3).resolves.toBe('success3')
    })
  })

  describe('Connection State Management', () => {
    it('should track connection statistics', async () => {
      pool = new ConnectionPool({ maxConnections: 10, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      const url = 'wss://do1.example.com'
      const conn = await pool.getConnection(url)

      // Make a call
      const callPromise = conn.call('testMethod', [])
      const msg = JSON.parse(createdSockets[0].sentMessages[0])
      createdSockets[0].simulateMessage(JSON.stringify({ id: msg.id, result: 'ok' }))
      await callPromise

      const stats = conn.getStats()
      expect(stats.messagesSent).toBeGreaterThan(0)
      expect(stats.messagesReceived).toBeGreaterThan(0)
      expect(stats.connected).toBe(true)
    })

    it('should report pool statistics', async () => {
      pool = new ConnectionPool({ maxConnections: 10, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      await pool.getConnection('wss://do1.example.com')
      await pool.getConnection('wss://do2.example.com')

      const stats = pool.getStats()
      expect(stats.activeConnections).toBe(2)
      expect(stats.totalConnectionsCreated).toBe(2)
      expect(stats.maxConnections).toBe(10)
    })

    it('should properly close all connections on pool close', async () => {
      pool = new ConnectionPool({ maxConnections: 10, autoReconnect: false, webSocketFactory: mockWebSocketFactory })

      await pool.getConnection('wss://do1.example.com')
      await pool.getConnection('wss://do2.example.com')

      await pool.close()

      // All sockets should be closed
      expect(createdSockets[0].readyState).toBe(MockWebSocket.CLOSED)
      expect(createdSockets[1].readyState).toBe(MockWebSocket.CLOSED)

      // Pool should be empty
      expect(pool.size()).toBe(0)
    })
  })

  describe('WebSocket Hibernation Compatibility', () => {
    it('should support hibernation-aware ping/pong configuration', async () => {
      pool = new ConnectionPool({
        maxConnections: 10,
        keepAliveIntervalMs: 30000,
        hibernationAware: true,
        autoReconnect: false,
        webSocketFactory: mockWebSocketFactory,
      })

      const url = 'wss://do1.example.com'
      const conn = await pool.getConnection(url)

      // Connection should have keepalive configured
      expect(conn.getConfig().keepAliveIntervalMs).toBe(30000)
      expect(conn.getConfig().hibernationAware).toBe(true)
    })

    it('should handle reconnection when socket is stale', async () => {
      pool = new ConnectionPool({
        maxConnections: 10,
        hibernationAware: true,
        autoReconnect: true,
        reconnectDelayMs: 5,
        maxReconnectAttempts: 3,
        webSocketFactory: mockWebSocketFactory,
      })

      const url = 'wss://do1.example.com'
      const conn = await pool.getConnection(url)

      // Simulate hibernation (connection goes stale by closing)
      createdSockets[0].close(1006, 'Hibernation')

      // Wait for reconnect to trigger
      await new Promise((r) => setTimeout(r, 30))

      // Should have created a new socket on reconnect attempt
      expect(createdSockets.length).toBeGreaterThanOrEqual(2)
    })
  })
})
