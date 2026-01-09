/**
 * RPC Client SDK Tests (@dotdo/client)
 *
 * RED TDD tests for the RPC client SDK. These tests define the expected
 * behavior for a client that communicates with Durable Objects via
 * WebSocket (preferred) with HTTP fallback.
 *
 * Key features being tested:
 * - WebSocket connection preference with HTTP fallback
 * - Automatic reconnection with exponential backoff
 * - Promise pipelining (Cap'n Proto style)
 * - Type-safe method calls via Proxy
 * - Request batching for efficiency
 * - Real-time event subscriptions
 * - Offline queue for resilience
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Future imports - Implementation does not exist yet
// =============================================================================

// import {
//   createClient,
//   DOClient,
//   ClientConfig,
//   ConnectionState,
//   SubscriptionHandle,
//   BatchOptions,
//   PipelineResult,
// } from '@dotdo/client'

// =============================================================================
// Mock WebSocket for testing
// =============================================================================

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  url: string
  readyState = MockWebSocket.CONNECTING

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code?: number; reason?: string; wasClean?: boolean }) => void) | null = null
  onerror: ((error: Event) => void) | null = null

  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason, wasClean: true })
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason, wasClean: false })
  }

  simulateError(error: Event) {
    this.onerror?.(error)
  }

  // Get sent messages as parsed objects
  getSentJSON<T = unknown>(): T[] {
    return this.sentMessages.map(m => JSON.parse(m))
  }
}

// =============================================================================
// Mock fetch for HTTP fallback testing
// =============================================================================

function createMockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(handler)
}

// =============================================================================
// Test Suite
// =============================================================================

describe('RPC Client SDK (@dotdo/client)', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    originalWebSocket = globalThis.WebSocket
    originalFetch = globalThis.fetch
    // @ts-expect-error - mock WebSocket
    globalThis.WebSocket = MockWebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Connection Strategy Tests
  // ===========================================================================

  describe('connection strategy', () => {
    it('attempts WebSocket connection first', async () => {
      // const client = createClient('https://my-do.example.com/do/123')
      //
      // // Should immediately attempt WebSocket connection
      // expect(MockWebSocket.instances).toHaveLength(1)
      // expect(MockWebSocket.instances[0].url).toBe('wss://my-do.example.com/do/123/rpc')

      expect.fail('Not implemented: createClient should attempt WebSocket first')
    })

    it('converts https:// to wss:// for WebSocket URL', async () => {
      // const client = createClient('https://my-do.example.com/do/123')
      //
      // expect(MockWebSocket.instances[0].url).toMatch(/^wss:\/\//)

      expect.fail('Not implemented: should convert https to wss')
    })

    it('converts http:// to ws:// for WebSocket URL', async () => {
      // const client = createClient('http://localhost:8787/do/123')
      //
      // expect(MockWebSocket.instances[0].url).toMatch(/^ws:\/\//)

      expect.fail('Not implemented: should convert http to ws')
    })

    it('falls back to HTTP when WebSocket fails to connect', async () => {
      // const mockFetch = createMockFetch(async () => {
      //   return new Response(JSON.stringify({ id: '1', result: 'ok' }), {
      //     status: 200,
      //     headers: { 'Content-Type': 'application/json' },
      //   })
      // })
      // globalThis.fetch = mockFetch
      //
      // const client = createClient('https://my-do.example.com/do/123')
      //
      // // Simulate WebSocket connection failure
      // MockWebSocket.instances[0].simulateError(new Event('error'))
      // MockWebSocket.instances[0].simulateClose(1006, 'Connection failed')
      //
      // // Make a call - should use HTTP
      // const result = await client.greet('World')
      //
      // expect(mockFetch).toHaveBeenCalled()
      // expect(result).toBe('ok')

      expect.fail('Not implemented: should fall back to HTTP when WebSocket unavailable')
    })

    it('falls back to HTTP when WebSocket is not supported', async () => {
      // // Simulate environment without WebSocket
      // // @ts-expect-error - removing WebSocket
      // globalThis.WebSocket = undefined
      //
      // const mockFetch = createMockFetch(async () => {
      //   return new Response(JSON.stringify({ id: '1', result: 'test' }))
      // })
      // globalThis.fetch = mockFetch
      //
      // const client = createClient('https://my-do.example.com/do/123')
      // const result = await client.ping()
      //
      // expect(mockFetch).toHaveBeenCalled()

      expect.fail('Not implemented: should detect missing WebSocket support')
    })

    it('emits connection state changes', async () => {
      // const client = createClient('https://my-do.example.com/do/123')
      // const states: string[] = []
      //
      // client.on('connectionStateChange', (state) => {
      //   states.push(state)
      // })
      //
      // // Initial state
      // expect(states).toContain('connecting')
      //
      // // WebSocket opens
      // MockWebSocket.instances[0].simulateOpen()
      // expect(states).toContain('connected')
      //
      // // WebSocket closes
      // MockWebSocket.instances[0].simulateClose()
      // expect(states).toContain('reconnecting')

      expect.fail('Not implemented: should emit connection state changes')
    })

    it('provides current connection state', async () => {
      // const client = createClient('https://my-do.example.com/do/123')
      //
      // expect(client.connectionState).toBe('connecting')
      //
      // MockWebSocket.instances[0].simulateOpen()
      // expect(client.connectionState).toBe('connected')

      expect.fail('Not implemented: should expose connectionState property')
    })
  })

  // ===========================================================================
  // Automatic Reconnection Tests
  // ===========================================================================

  describe('automatic reconnection', () => {
    it('reconnects automatically on disconnect', async () => {
      // const client = createClient('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      // expect(MockWebSocket.instances).toHaveLength(1)
      //
      // // Simulate disconnect
      // MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')
      //
      // // Should schedule reconnection
      // vi.advanceTimersByTime(1000) // First reconnect delay
      // expect(MockWebSocket.instances).toHaveLength(2)

      expect.fail('Not implemented: should reconnect automatically')
    })

    it('uses exponential backoff for reconnection', async () => {
      // const client = createClient('https://my-do.example.com/do/123')
      //
      // // First connection
      // MockWebSocket.instances[0].simulateClose(1006)
      // vi.advanceTimersByTime(1000) // 1s
      // expect(MockWebSocket.instances).toHaveLength(2)
      //
      // // Second connection fails
      // MockWebSocket.instances[1].simulateClose(1006)
      // vi.advanceTimersByTime(1000) // Not yet
      // expect(MockWebSocket.instances).toHaveLength(2)
      // vi.advanceTimersByTime(1000) // 2s total
      // expect(MockWebSocket.instances).toHaveLength(3)
      //
      // // Third connection fails
      // MockWebSocket.instances[2].simulateClose(1006)
      // vi.advanceTimersByTime(3000) // Not yet
      // expect(MockWebSocket.instances).toHaveLength(3)
      // vi.advanceTimersByTime(1000) // 4s total
      // expect(MockWebSocket.instances).toHaveLength(4)

      expect.fail('Not implemented: should use exponential backoff')
    })

    it('caps reconnection delay at 30 seconds', async () => {
      // const client = createClient('https://my-do.example.com/do/123')
      //
      // // Simulate many failed reconnections
      // for (let i = 0; i < 10; i++) {
      //   MockWebSocket.instances[i].simulateClose(1006)
      //   vi.advanceTimersByTime(30000) // Max delay
      // }
      //
      // // All reconnections should have happened
      // expect(MockWebSocket.instances.length).toBeGreaterThan(10)

      expect.fail('Not implemented: should cap backoff at 30 seconds')
    })

    it('resets backoff after successful connection', async () => {
      // const client = createClient('https://my-do.example.com/do/123')
      //
      // // First failure
      // MockWebSocket.instances[0].simulateClose(1006)
      // vi.advanceTimersByTime(1000)
      //
      // // Second failure
      // MockWebSocket.instances[1].simulateClose(1006)
      // vi.advanceTimersByTime(2000)
      //
      // // Successful connection
      // MockWebSocket.instances[2].simulateOpen()
      //
      // // Another failure - should use 1s delay again
      // MockWebSocket.instances[2].simulateClose(1006)
      // vi.advanceTimersByTime(1000)
      // expect(MockWebSocket.instances).toHaveLength(4) // Reset to 1s delay

      expect.fail('Not implemented: should reset backoff after success')
    })

    it('stops reconnecting when explicitly disconnected', async () => {
      // const client = createClient('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      // client.disconnect()
      //
      // vi.advanceTimersByTime(30000)
      // expect(MockWebSocket.instances).toHaveLength(1) // No reconnection attempts

      expect.fail('Not implemented: should respect explicit disconnect')
    })

    it('adds jitter to prevent thundering herd', async () => {
      // const client1 = createClient('https://my-do.example.com/do/123')
      // const client2 = createClient('https://my-do.example.com/do/456')
      //
      // MockWebSocket.instances[0].simulateClose(1006)
      // MockWebSocket.instances[1].simulateClose(1006)
      //
      // // Reconnection delays should have some randomness
      // // This is hard to test directly, but we can check that
      // // the client config accepts jitter options

      expect.fail('Not implemented: should support jitter in backoff')
    })
  })

  // ===========================================================================
  // Method Call Tests
  // ===========================================================================

  describe('method calls', () => {
    it('calls remote methods via proxy', async () => {
      // const client = createClient<{
      //   greet(name: string): string
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const resultPromise = client.greet('World')
      //
      // // Check the message was sent
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // expect(sent).toHaveLength(1)
      // expect(sent[0]).toMatchObject({
      //   method: 'greet',
      //   params: ['World'],
      // })
      //
      // // Simulate response
      // MockWebSocket.instances[0].simulateMessage({
      //   id: sent[0].id,
      //   result: 'Hello, World!',
      // })
      //
      // const result = await resultPromise
      // expect(result).toBe('Hello, World!')

      expect.fail('Not implemented: should call methods via proxy')
    })

    it('supports object parameters', async () => {
      // const client = createClient<{
      //   createUser(data: { name: string; email: string }): { id: string }
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const resultPromise = client.createUser({ name: 'Alice', email: 'alice@example.com' })
      //
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // expect(sent[0]).toMatchObject({
      //   method: 'createUser',
      //   params: [{ name: 'Alice', email: 'alice@example.com' }],
      // })
      //
      // MockWebSocket.instances[0].simulateMessage({
      //   id: sent[0].id,
      //   result: { id: 'user-123' },
      // })
      //
      // const result = await resultPromise
      // expect(result).toEqual({ id: 'user-123' })

      expect.fail('Not implemented: should support object parameters')
    })

    it('handles method errors', async () => {
      // const client = createClient<{
      //   dangerousMethod(): void
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const resultPromise = client.dangerousMethod()
      //
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // MockWebSocket.instances[0].simulateMessage({
      //   id: sent[0].id,
      //   error: { code: 'FORBIDDEN', message: 'Access denied' },
      // })
      //
      // await expect(resultPromise).rejects.toMatchObject({
      //   code: 'FORBIDDEN',
      //   message: 'Access denied',
      // })

      expect.fail('Not implemented: should handle method errors')
    })

    it('times out long-running calls', async () => {
      // const client = createClient<{
      //   slowMethod(): void
      // }>('https://my-do.example.com/do/123', { timeout: 5000 })
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const resultPromise = client.slowMethod()
      //
      // vi.advanceTimersByTime(5000)
      //
      // await expect(resultPromise).rejects.toMatchObject({
      //   code: 'TIMEOUT',
      // })

      expect.fail('Not implemented: should timeout calls')
    })

    it('queues calls while connecting', async () => {
      // const client = createClient<{
      //   ping(): string
      // }>('https://my-do.example.com/do/123')
      //
      // // Don't open WebSocket yet
      // const resultPromise = client.ping()
      //
      // // Call is queued, not sent
      // expect(MockWebSocket.instances[0].sentMessages).toHaveLength(0)
      //
      // // Open connection
      // MockWebSocket.instances[0].simulateOpen()
      //
      // // Now the call is sent
      // expect(MockWebSocket.instances[0].sentMessages).toHaveLength(1)
      //
      // // Complete the call
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // MockWebSocket.instances[0].simulateMessage({
      //   id: sent[0].id,
      //   result: 'pong',
      // })
      //
      // await expect(resultPromise).resolves.toBe('pong')

      expect.fail('Not implemented: should queue calls while connecting')
    })

    it('uses HTTP fallback for calls when WebSocket unavailable', async () => {
      // const mockFetch = createMockFetch(async (url, init) => {
      //   const body = JSON.parse(init?.body as string)
      //   return new Response(JSON.stringify({
      //     id: body.id,
      //     result: 'http-result',
      //   }))
      // })
      // globalThis.fetch = mockFetch
      //
      // const client = createClient<{
      //   getData(): string
      // }>('https://my-do.example.com/do/123')
      //
      // // Fail WebSocket
      // MockWebSocket.instances[0].simulateError(new Event('error'))
      // MockWebSocket.instances[0].simulateClose(1006)
      //
      // const result = await client.getData()
      // expect(result).toBe('http-result')
      // expect(mockFetch).toHaveBeenCalled()

      expect.fail('Not implemented: should use HTTP fallback')
    })
  })

  // ===========================================================================
  // Promise Pipelining Tests (Cap'n Proto style)
  // ===========================================================================

  describe('promise pipelining', () => {
    it('chains method calls fluently', async () => {
      // interface User {
      //   getPosts(): Post[]
      // }
      // interface Post {
      //   title: string
      // }
      //
      // const client = createClient<{
      //   getUser(id: string): User
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // // Single network round-trip for chained call
      // const postsPromise = client.getUser('123').getPosts()
      //
      // // Should send a pipelined request
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // expect(sent).toHaveLength(1)
      // expect(sent[0]).toMatchObject({
      //   pipeline: [
      //     { method: 'getUser', params: ['123'] },
      //     { method: 'getPosts', params: [] },
      //   ],
      // })
      //
      // MockWebSocket.instances[0].simulateMessage({
      //   id: sent[0].id,
      //   result: [{ title: 'First Post' }, { title: 'Second Post' }],
      // })
      //
      // const posts = await postsPromise
      // expect(posts).toEqual([{ title: 'First Post' }, { title: 'Second Post' }])

      expect.fail('Not implemented: should support promise pipelining')
    })

    it('supports deep pipeline chains', async () => {
      // interface Company {
      //   getDepartment(name: string): Department
      // }
      // interface Department {
      //   getManager(): Employee
      // }
      // interface Employee {
      //   getEmail(): string
      // }
      //
      // const client = createClient<{
      //   getCompany(id: string): Company
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const emailPromise = client
      //   .getCompany('acme')
      //   .getDepartment('engineering')
      //   .getManager()
      //   .getEmail()
      //
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // expect(sent[0].pipeline).toHaveLength(4)

      expect.fail('Not implemented: should support deep pipelines')
    })

    it('allows branching from pipeline results', async () => {
      // interface User {
      //   getName(): string
      //   getEmail(): string
      // }
      //
      // const client = createClient<{
      //   getUser(id: string): User
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const user = client.getUser('123')
      // const namePromise = user.getName()
      // const emailPromise = user.getEmail()
      //
      // // Both should reference the same base call
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // expect(sent).toHaveLength(2) // Or could be optimized to 1 with multiple endpoints

      expect.fail('Not implemented: should support branching pipelines')
    })

    it('handles pipeline errors gracefully', async () => {
      // const client = createClient<{
      //   getUser(id: string): { getPosts(): unknown[] }
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const postsPromise = client.getUser('nonexistent').getPosts()
      //
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // MockWebSocket.instances[0].simulateMessage({
      //   id: sent[0].id,
      //   error: {
      //     code: 'NOT_FOUND',
      //     message: 'User not found',
      //     stage: 0, // Error occurred at first pipeline stage
      //   },
      // })
      //
      // await expect(postsPromise).rejects.toMatchObject({
      //   code: 'NOT_FOUND',
      //   message: 'User not found',
      // })

      expect.fail('Not implemented: should handle pipeline errors')
    })
  })

  // ===========================================================================
  // Request Batching Tests
  // ===========================================================================

  describe('request batching', () => {
    it('batches multiple concurrent calls into single request', async () => {
      // const client = createClient<{
      //   getUser(id: string): { name: string }
      //   getPost(id: string): { title: string }
      //   getComment(id: string): { text: string }
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // // Make multiple calls concurrently
      // const promises = [
      //   client.getUser('1'),
      //   client.getPost('2'),
      //   client.getComment('3'),
      // ]
      //
      // // Should batch into single message
      // await vi.advanceTimersByTimeAsync(0) // Let microtask queue flush
      //
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // expect(sent).toHaveLength(1)
      // expect(sent[0].batch).toHaveLength(3)
      //
      // // Respond with batched results
      // MockWebSocket.instances[0].simulateMessage({
      //   id: sent[0].id,
      //   batch: [
      //     { id: sent[0].batch[0].id, result: { name: 'Alice' } },
      //     { id: sent[0].batch[1].id, result: { title: 'Hello' } },
      //     { id: sent[0].batch[2].id, result: { text: 'Nice post!' } },
      //   ],
      // })
      //
      // const results = await Promise.all(promises)
      // expect(results).toEqual([
      //   { name: 'Alice' },
      //   { title: 'Hello' },
      //   { text: 'Nice post!' },
      // ])

      expect.fail('Not implemented: should batch concurrent calls')
    })

    it('respects batch window configuration', async () => {
      // const client = createClient<{
      //   ping(): string
      // }>('https://my-do.example.com/do/123', {
      //   batchWindow: 50, // 50ms batch window
      // })
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // // First call
      // client.ping()
      //
      // // After 30ms, second call (within window)
      // vi.advanceTimersByTime(30)
      // client.ping()
      //
      // // After 60ms total, window closes
      // vi.advanceTimersByTime(30)
      //
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // expect(sent).toHaveLength(1)
      // expect(sent[0].batch).toHaveLength(2)

      expect.fail('Not implemented: should respect batch window')
    })

    it('sends immediately when batch size limit reached', async () => {
      // const client = createClient<{
      //   ping(): string
      // }>('https://my-do.example.com/do/123', {
      //   maxBatchSize: 3,
      // })
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // // Make 3 calls (hits limit)
      // client.ping()
      // client.ping()
      // client.ping()
      //
      // // Should send immediately without waiting for batch window
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // expect(sent).toHaveLength(1)
      // expect(sent[0].batch).toHaveLength(3)

      expect.fail('Not implemented: should respect max batch size')
    })

    it('handles partial batch failures', async () => {
      // const client = createClient<{
      //   safeMethod(): string
      //   dangerousMethod(): string
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const safe = client.safeMethod()
      // const dangerous = client.dangerousMethod()
      //
      // await vi.advanceTimersByTimeAsync(0)
      //
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // MockWebSocket.instances[0].simulateMessage({
      //   id: sent[0].id,
      //   batch: [
      //     { id: sent[0].batch[0].id, result: 'ok' },
      //     { id: sent[0].batch[1].id, error: { code: 'FAILED', message: 'Oops' } },
      //   ],
      // })
      //
      // await expect(safe).resolves.toBe('ok')
      // await expect(dangerous).rejects.toMatchObject({ code: 'FAILED' })

      expect.fail('Not implemented: should handle partial batch failures')
    })

    it('can disable batching', async () => {
      // const client = createClient<{
      //   ping(): string
      // }>('https://my-do.example.com/do/123', {
      //   batching: false,
      // })
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // client.ping()
      // client.ping()
      //
      // await vi.advanceTimersByTimeAsync(0)
      //
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // expect(sent).toHaveLength(2) // Individual messages, not batched

      expect.fail('Not implemented: should allow disabling batching')
    })
  })

  // ===========================================================================
  // Subscription Tests
  // ===========================================================================

  describe('subscriptions', () => {
    it('subscribes to real-time events', async () => {
      // const client = createClient<{}>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const events: unknown[] = []
      // const subscription = client.subscribe('task.updated', (event) => {
      //   events.push(event)
      // })
      //
      // // Should send subscribe message
      // const sent = MockWebSocket.instances[0].getSentJSON()
      // expect(sent).toContainEqual({
      //   type: 'subscribe',
      //   channel: 'task.updated',
      // })
      //
      // // Receive events
      // MockWebSocket.instances[0].simulateMessage({
      //   type: 'event',
      //   channel: 'task.updated',
      //   data: { id: '1', title: 'Updated' },
      // })
      //
      // expect(events).toHaveLength(1)
      // expect(events[0]).toEqual({ id: '1', title: 'Updated' })
      //
      // subscription.unsubscribe()

      expect.fail('Not implemented: should support subscriptions')
    })

    it('re-subscribes after reconnection', async () => {
      // const client = createClient<{}>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const subscription = client.subscribe('events', () => {})
      //
      // // Disconnect
      // MockWebSocket.instances[0].simulateClose(1006)
      // vi.advanceTimersByTime(1000)
      //
      // // New connection
      // MockWebSocket.instances[1].simulateOpen()
      //
      // // Should automatically re-subscribe
      // const sent = MockWebSocket.instances[1].getSentJSON()
      // expect(sent).toContainEqual({
      //   type: 'subscribe',
      //   channel: 'events',
      // })
      //
      // subscription.unsubscribe()

      expect.fail('Not implemented: should re-subscribe after reconnection')
    })

    it('handles multiple subscriptions to same channel', async () => {
      // const client = createClient<{}>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const events1: unknown[] = []
      // const events2: unknown[] = []
      //
      // const sub1 = client.subscribe('events', (e) => events1.push(e))
      // const sub2 = client.subscribe('events', (e) => events2.push(e))
      //
      // MockWebSocket.instances[0].simulateMessage({
      //   type: 'event',
      //   channel: 'events',
      //   data: { value: 1 },
      // })
      //
      // expect(events1).toHaveLength(1)
      // expect(events2).toHaveLength(1)
      //
      // sub1.unsubscribe()
      //
      // MockWebSocket.instances[0].simulateMessage({
      //   type: 'event',
      //   channel: 'events',
      //   data: { value: 2 },
      // })
      //
      // expect(events1).toHaveLength(1) // No new event
      // expect(events2).toHaveLength(2) // Received new event
      //
      // sub2.unsubscribe()

      expect.fail('Not implemented: should handle multiple subscriptions')
    })

    it('sends unsubscribe message when all listeners removed', async () => {
      // const client = createClient<{}>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const sub1 = client.subscribe('events', () => {})
      // const sub2 = client.subscribe('events', () => {})
      //
      // MockWebSocket.instances[0].sentMessages = []
      //
      // sub1.unsubscribe()
      // // Should not unsubscribe yet (still have sub2)
      // expect(MockWebSocket.instances[0].getSentJSON()).not.toContainEqual({
      //   type: 'unsubscribe',
      //   channel: 'events',
      // })
      //
      // sub2.unsubscribe()
      // // Now should unsubscribe
      // expect(MockWebSocket.instances[0].getSentJSON()).toContainEqual({
      //   type: 'unsubscribe',
      //   channel: 'events',
      // })

      expect.fail('Not implemented: should unsubscribe when all listeners gone')
    })

    it('supports typed event subscriptions', async () => {
      // interface TaskEvents {
      //   'task.created': { id: string; title: string }
      //   'task.updated': { id: string; changes: Record<string, unknown> }
      //   'task.deleted': { id: string }
      // }
      //
      // const client = createClient<{}, TaskEvents>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // // TypeScript should ensure correct event types
      // client.subscribe('task.created', (event) => {
      //   // event should be typed as { id: string; title: string }
      //   console.log(event.title)
      // })

      expect.fail('Not implemented: should support typed events')
    })
  })

  // ===========================================================================
  // Offline Queue Tests
  // ===========================================================================

  describe('offline queue', () => {
    it('queues calls when offline', async () => {
      // const client = createClient<{
      //   saveData(data: unknown): boolean
      // }>('https://my-do.example.com/do/123')
      //
      // // Don't open connection
      //
      // const result = client.saveData({ important: true })
      //
      // // Should be queued
      // expect(MockWebSocket.instances[0].sentMessages).toHaveLength(0)
      //
      // // Come online
      // MockWebSocket.instances[0].simulateOpen()
      //
      // // Should send queued call
      // expect(MockWebSocket.instances[0].sentMessages).toHaveLength(1)

      expect.fail('Not implemented: should queue calls when offline')
    })

    it('preserves queue across reconnections', async () => {
      // const client = createClient<{
      //   saveData(data: unknown): boolean
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // // Queue a call
      // const resultPromise = client.saveData({ data: 1 })
      //
      // // Disconnect before response
      // MockWebSocket.instances[0].simulateClose(1006)
      // vi.advanceTimersByTime(1000)
      //
      // // Reconnect
      // MockWebSocket.instances[1].simulateOpen()
      //
      // // Queued call should be re-sent
      // expect(MockWebSocket.instances[1].sentMessages).toHaveLength(1)
      //
      // const sent = MockWebSocket.instances[1].getSentJSON()
      // MockWebSocket.instances[1].simulateMessage({
      //   id: sent[0].id,
      //   result: true,
      // })
      //
      // await expect(resultPromise).resolves.toBe(true)

      expect.fail('Not implemented: should preserve queue across reconnections')
    })

    it('respects queue size limit', async () => {
      // const client = createClient<{
      //   log(message: string): void
      // }>('https://my-do.example.com/do/123', {
      //   offlineQueueLimit: 10,
      // })
      //
      // // Queue many calls while offline
      // for (let i = 0; i < 20; i++) {
      //   client.log(`message ${i}`)
      // }
      //
      // // Only last 10 should be in queue
      // MockWebSocket.instances[0].simulateOpen()
      // expect(MockWebSocket.instances[0].sentMessages.length).toBeLessThanOrEqual(10)

      expect.fail('Not implemented: should respect queue limit')
    })

    it('provides queue status', async () => {
      // const client = createClient<{
      //   saveData(data: unknown): void
      // }>('https://my-do.example.com/do/123')
      //
      // expect(client.queuedCallCount).toBe(0)
      //
      // client.saveData({ a: 1 })
      // client.saveData({ a: 2 })
      //
      // expect(client.queuedCallCount).toBe(2)
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // expect(client.queuedCallCount).toBe(0)

      expect.fail('Not implemented: should expose queue status')
    })

    it('allows clearing the queue', async () => {
      // const client = createClient<{
      //   saveData(data: unknown): void
      // }>('https://my-do.example.com/do/123')
      //
      // client.saveData({ a: 1 })
      // client.saveData({ a: 2 })
      //
      // expect(client.queuedCallCount).toBe(2)
      //
      // client.clearQueue()
      //
      // expect(client.queuedCallCount).toBe(0)
      //
      // MockWebSocket.instances[0].simulateOpen()
      // expect(MockWebSocket.instances[0].sentMessages).toHaveLength(0)

      expect.fail('Not implemented: should allow clearing queue')
    })

    it('emits queue events', async () => {
      // const client = createClient<{
      //   saveData(data: unknown): void
      // }>('https://my-do.example.com/do/123')
      //
      // const queueEvents: { type: string; count: number }[] = []
      // client.on('queueChange', (count) => {
      //   queueEvents.push({ type: 'change', count })
      // })
      //
      // client.saveData({ a: 1 })
      // expect(queueEvents).toContainEqual({ type: 'change', count: 1 })
      //
      // MockWebSocket.instances[0].simulateOpen()
      // expect(queueEvents).toContainEqual({ type: 'change', count: 0 })

      expect.fail('Not implemented: should emit queue events')
    })
  })

  // ===========================================================================
  // Type Safety Tests
  // ===========================================================================

  describe('type safety', () => {
    it('provides type-safe method calls', async () => {
      // interface MyDOMethods {
      //   createUser(name: string, email: string): { id: string; name: string }
      //   deleteUser(id: string): boolean
      //   listUsers(): { id: string; name: string }[]
      // }
      //
      // const client = createClient<MyDOMethods>('https://my-do.example.com/do/123')
      //
      // // TypeScript should enforce correct types:
      // // client.createUser('Alice', 'alice@example.com') // OK
      // // client.createUser(123, 'email') // Type error - first param must be string
      // // client.unknownMethod() // Type error - method doesn't exist

      expect.fail('Not implemented: should provide type safety')
    })

    it('infers return types correctly', async () => {
      // interface Methods {
      //   getNumber(): number
      //   getString(): string
      //   getObject(): { a: number; b: string }
      // }
      //
      // const client = createClient<Methods>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // // These should have correct inferred types
      // const numPromise: Promise<number> = client.getNumber()
      // const strPromise: Promise<string> = client.getString()
      // const objPromise: Promise<{ a: number; b: string }> = client.getObject()

      expect.fail('Not implemented: should infer return types')
    })
  })

  // ===========================================================================
  // Configuration Tests
  // ===========================================================================

  describe('configuration', () => {
    it('accepts custom configuration', async () => {
      // const client = createClient<{}>('https://my-do.example.com/do/123', {
      //   timeout: 30000,
      //   batchWindow: 100,
      //   maxBatchSize: 50,
      //   offlineQueueLimit: 1000,
      //   reconnect: {
      //     maxAttempts: 10,
      //     baseDelay: 500,
      //     maxDelay: 60000,
      //     jitter: 0.5,
      //   },
      // })
      //
      // expect(client).toBeDefined()

      expect.fail('Not implemented: should accept configuration')
    })

    it('allows runtime configuration updates', async () => {
      // const client = createClient<{}>('https://my-do.example.com/do/123')
      //
      // client.configure({ timeout: 5000 })
      //
      // expect(client.config.timeout).toBe(5000)

      expect.fail('Not implemented: should allow runtime config updates')
    })
  })

  // ===========================================================================
  // Cleanup Tests
  // ===========================================================================

  describe('cleanup', () => {
    it('disconnects cleanly', async () => {
      // const client = createClient<{}>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // client.disconnect()
      //
      // expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED)

      expect.fail('Not implemented: should disconnect cleanly')
    })

    it('cancels pending calls on disconnect', async () => {
      // const client = createClient<{
      //   slowMethod(): string
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const resultPromise = client.slowMethod()
      //
      // client.disconnect()
      //
      // await expect(resultPromise).rejects.toMatchObject({
      //   code: 'CLIENT_DISCONNECTED',
      // })

      expect.fail('Not implemented: should cancel pending calls')
    })

    it('removes all event listeners on disconnect', async () => {
      // const client = createClient<{}>('https://my-do.example.com/do/123')
      //
      // let callCount = 0
      // client.on('connectionStateChange', () => callCount++)
      //
      // MockWebSocket.instances[0].simulateOpen()
      // expect(callCount).toBeGreaterThan(0)
      //
      // const prevCount = callCount
      // client.disconnect()
      //
      // // Simulate more state changes (shouldn't trigger listener)
      // // (This is testing internal cleanup, harder to verify externally)

      expect.fail('Not implemented: should clean up listeners')
    })
  })

  // ===========================================================================
  // HTTP Fallback Specific Tests
  // ===========================================================================

  describe('HTTP fallback', () => {
    it('sends correct RPC format over HTTP', async () => {
      // let capturedRequest: { url: string; body: unknown } | null = null
      // const mockFetch = createMockFetch(async (url, init) => {
      //   capturedRequest = {
      //     url,
      //     body: JSON.parse(init?.body as string),
      //   }
      //   return new Response(JSON.stringify({ id: '1', result: 'ok' }))
      // })
      // globalThis.fetch = mockFetch
      //
      // const client = createClient<{
      //   myMethod(arg: string): string
      // }>('https://my-do.example.com/do/123')
      //
      // // Force HTTP mode
      // MockWebSocket.instances[0].simulateError(new Event('error'))
      // MockWebSocket.instances[0].simulateClose(1006)
      //
      // await client.myMethod('test')
      //
      // expect(capturedRequest?.url).toBe('https://my-do.example.com/do/123/rpc')
      // expect(capturedRequest?.body).toMatchObject({
      //   method: 'myMethod',
      //   params: ['test'],
      // })

      expect.fail('Not implemented: should send correct HTTP format')
    })

    it('includes authentication in HTTP requests', async () => {
      // let capturedHeaders: Headers | undefined
      // const mockFetch = createMockFetch(async (url, init) => {
      //   capturedHeaders = new Headers(init?.headers)
      //   return new Response(JSON.stringify({ id: '1', result: 'ok' }))
      // })
      // globalThis.fetch = mockFetch
      //
      // const client = createClient<{
      //   secureMethod(): string
      // }>('https://my-do.example.com/do/123', {
      //   auth: { token: 'secret-token' },
      // })
      //
      // // Force HTTP mode
      // MockWebSocket.instances[0].simulateError(new Event('error'))
      // MockWebSocket.instances[0].simulateClose(1006)
      //
      // await client.secureMethod()
      //
      // expect(capturedHeaders?.get('Authorization')).toBe('Bearer secret-token')

      expect.fail('Not implemented: should include auth in HTTP')
    })

    it('retries HTTP requests on failure', async () => {
      // let attempts = 0
      // const mockFetch = createMockFetch(async () => {
      //   attempts++
      //   if (attempts < 3) {
      //     return new Response('Service Unavailable', { status: 503 })
      //   }
      //   return new Response(JSON.stringify({ id: '1', result: 'ok' }))
      // })
      // globalThis.fetch = mockFetch
      //
      // const client = createClient<{
      //   reliableMethod(): string
      // }>('https://my-do.example.com/do/123')
      //
      // // Force HTTP mode
      // MockWebSocket.instances[0].simulateError(new Event('error'))
      // MockWebSocket.instances[0].simulateClose(1006)
      //
      // const result = await client.reliableMethod()
      //
      // expect(attempts).toBe(3)
      // expect(result).toBe('ok')

      expect.fail('Not implemented: should retry HTTP requests')
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles rapid connect/disconnect cycles', async () => {
      // const client = createClient<{}>('https://my-do.example.com/do/123')
      //
      // for (let i = 0; i < 10; i++) {
      //   MockWebSocket.instances[i].simulateOpen()
      //   MockWebSocket.instances[i].simulateClose()
      //   vi.advanceTimersByTime(100)
      // }
      //
      // // Should not throw or enter bad state
      // expect(client.connectionState).toBeDefined()

      expect.fail('Not implemented: should handle rapid cycles')
    })

    it('handles concurrent calls during reconnection', async () => {
      // const client = createClient<{
      //   ping(): string
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // // Start calls
      // const promises = [client.ping(), client.ping(), client.ping()]
      //
      // // Disconnect mid-flight
      // MockWebSocket.instances[0].simulateClose(1006)
      // vi.advanceTimersByTime(1000)
      //
      // // Reconnect
      // MockWebSocket.instances[1].simulateOpen()
      //
      // // Answer all pending calls
      // const sent = MockWebSocket.instances[1].getSentJSON()
      // for (const msg of sent) {
      //   MockWebSocket.instances[1].simulateMessage({
      //     id: msg.id,
      //     result: 'pong',
      //   })
      // }
      //
      // const results = await Promise.all(promises)
      // expect(results).toEqual(['pong', 'pong', 'pong'])

      expect.fail('Not implemented: should handle calls during reconnection')
    })

    it('handles malformed server responses', async () => {
      // const client = createClient<{
      //   getData(): string
      // }>('https://my-do.example.com/do/123')
      //
      // MockWebSocket.instances[0].simulateOpen()
      //
      // const resultPromise = client.getData()
      //
      // // Send malformed response
      // MockWebSocket.instances[0].onmessage?.({ data: 'not json' })
      //
      // // Should not crash, may emit error event

      expect.fail('Not implemented: should handle malformed responses')
    })

    it('handles server closing with reason', async () => {
      // const client = createClient<{}>('https://my-do.example.com/do/123')
      //
      // const closeReasons: string[] = []
      // client.on('close', (reason) => closeReasons.push(reason))
      //
      // MockWebSocket.instances[0].simulateOpen()
      // MockWebSocket.instances[0].simulateClose(4000, 'DO hibernating')
      //
      // expect(closeReasons).toContain('DO hibernating')

      expect.fail('Not implemented: should handle close reasons')
    })
  })
})
