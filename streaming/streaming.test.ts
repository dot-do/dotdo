/**
 * Streaming Infrastructure Tests (RED Phase)
 *
 * Tests for:
 * 1. WebSocket Hub - connection management and broadcasting
 * 2. SSE Streaming - Server-Sent Events
 * 3. BackpressureController - flow control modes
 * 4. RateLimiter - token bucket algorithm
 * 5. SubscriptionManager - topic-based pub/sub
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import the modules we're testing (these don't exist yet - RED phase)
import {
  WebSocketHub,
  SSEStream,
  createSSEStream,
  BackpressureController,
  RateLimiter,
  SubscriptionManager,
  matchesTopic,
} from './index'

// ============================================================================
// 1. WebSocket Hub Tests
// ============================================================================

describe('WebSocketHub', () => {
  let hub: WebSocketHub

  beforeEach(() => {
    hub = new WebSocketHub()
  })

  describe('connection management', () => {
    it('connect(ws) adds websocket to hub', () => {
      const ws = createMockWebSocket()

      hub.connect(ws)

      expect(hub.connections.has(ws)).toBe(true)
      expect(hub.connectionCount).toBe(1)
    })

    it('connect(ws) with metadata stores metadata', () => {
      const ws = createMockWebSocket()
      const metadata = { userId: 'user-123', role: 'admin' }

      hub.connect(ws, metadata)

      expect(hub.getMetadata(ws)).toEqual(metadata)
    })

    it('disconnect(ws) removes websocket from hub', () => {
      const ws = createMockWebSocket()
      hub.connect(ws)

      hub.disconnect(ws)

      expect(hub.connections.has(ws)).toBe(false)
      expect(hub.connectionCount).toBe(0)
    })

    it('disconnect(ws) cleans up room memberships', () => {
      const ws = createMockWebSocket()
      hub.connect(ws)
      hub.room.join(ws, 'room-1')
      hub.room.join(ws, 'room-2')

      hub.disconnect(ws)

      expect(hub.room.members('room-1')).not.toContain(ws)
      expect(hub.room.members('room-2')).not.toContain(ws)
    })

    it('disconnect(ws) for non-existent connection is no-op', () => {
      const ws = createMockWebSocket()

      // Should not throw
      expect(() => hub.disconnect(ws)).not.toThrow()
    })

    it('tracks multiple connections independently', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      hub.connect(ws1)
      hub.connect(ws2)
      hub.connect(ws3)

      expect(hub.connectionCount).toBe(3)

      hub.disconnect(ws2)

      expect(hub.connectionCount).toBe(2)
      expect(hub.connections.has(ws1)).toBe(true)
      expect(hub.connections.has(ws2)).toBe(false)
      expect(hub.connections.has(ws3)).toBe(true)
    })
  })

  describe('broadcasting', () => {
    it('broadcast(message) sends to all connected clients', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      hub.connect(ws1)
      hub.connect(ws2)
      hub.connect(ws3)

      hub.broadcast({ type: 'notification', data: 'hello' })

      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'notification', data: 'hello' }))
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'notification', data: 'hello' }))
      expect(ws3.send).toHaveBeenCalledWith(JSON.stringify({ type: 'notification', data: 'hello' }))
    })

    it('broadcast(message) skips closed connections', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket({ readyState: WebSocket.CLOSED })
      const ws3 = createMockWebSocket()

      hub.connect(ws1)
      hub.connect(ws2)
      hub.connect(ws3)

      hub.broadcast({ type: 'test' })

      expect(ws1.send).toHaveBeenCalled()
      expect(ws2.send).not.toHaveBeenCalled()
      expect(ws3.send).toHaveBeenCalled()
    })

    it('broadcast(message, filter) only sends to filtered connections', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      hub.connect(ws1, { role: 'admin' })
      hub.connect(ws2, { role: 'user' })

      hub.broadcast({ type: 'admin-only' }, (ws, meta) => meta?.role === 'admin')

      expect(ws1.send).toHaveBeenCalled()
      expect(ws2.send).not.toHaveBeenCalled()
    })

    it('broadcast returns count of messages sent', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      hub.connect(ws1)
      hub.connect(ws2)

      const count = hub.broadcast({ type: 'test' })

      expect(count).toBe(2)
    })

    it('broadcast with string message sends as-is', () => {
      const ws = createMockWebSocket()
      hub.connect(ws)

      hub.broadcast('raw string message')

      expect(ws.send).toHaveBeenCalledWith('raw string message')
    })
  })

  describe('rooms', () => {
    it('room.join(ws, roomId) adds websocket to room', () => {
      const ws = createMockWebSocket()
      hub.connect(ws)

      hub.room.join(ws, 'chat-room')

      expect(hub.room.members('chat-room')).toContain(ws)
    })

    it('room.join fails for unconnected websocket', () => {
      const ws = createMockWebSocket()

      expect(() => hub.room.join(ws, 'room')).toThrow('WebSocket not connected')
    })

    it('room.leave(ws, roomId) removes websocket from room', () => {
      const ws = createMockWebSocket()
      hub.connect(ws)
      hub.room.join(ws, 'room-1')

      hub.room.leave(ws, 'room-1')

      expect(hub.room.members('room-1')).not.toContain(ws)
    })

    it('room.broadcast(roomId, message) sends to all room members', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      hub.connect(ws1)
      hub.connect(ws2)
      hub.connect(ws3)

      hub.room.join(ws1, 'vip-room')
      hub.room.join(ws2, 'vip-room')
      // ws3 is not in the room

      hub.room.broadcast('vip-room', { type: 'vip-message' })

      expect(ws1.send).toHaveBeenCalled()
      expect(ws2.send).toHaveBeenCalled()
      expect(ws3.send).not.toHaveBeenCalled()
    })

    it('room.members(roomId) returns all members of a room', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      hub.connect(ws1)
      hub.connect(ws2)

      hub.room.join(ws1, 'room-a')
      hub.room.join(ws2, 'room-a')

      const members = hub.room.members('room-a')

      expect(members).toHaveLength(2)
      expect(members).toContain(ws1)
      expect(members).toContain(ws2)
    })

    it('room.rooms(ws) returns all rooms a websocket is in', () => {
      const ws = createMockWebSocket()
      hub.connect(ws)

      hub.room.join(ws, 'room-1')
      hub.room.join(ws, 'room-2')
      hub.room.join(ws, 'room-3')

      const rooms = hub.room.rooms(ws)

      expect(rooms).toHaveLength(3)
      expect(rooms).toContain('room-1')
      expect(rooms).toContain('room-2')
      expect(rooms).toContain('room-3')
    })

    it('room.count(roomId) returns member count', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      hub.connect(ws1)
      hub.connect(ws2)

      hub.room.join(ws1, 'counted-room')
      hub.room.join(ws2, 'counted-room')

      expect(hub.room.count('counted-room')).toBe(2)
    })

    it('room.count for non-existent room returns 0', () => {
      expect(hub.room.count('non-existent')).toBe(0)
    })
  })
})

// ============================================================================
// 2. SSE Streaming Tests
// ============================================================================

describe('SSE Streaming', () => {
  describe('createSSEStream()', () => {
    it('returns a Response with correct content-type', () => {
      const { response } = createSSEStream()

      expect(response).toBeInstanceOf(Response)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    })

    it('returns a Response with cache-control: no-cache', () => {
      const { response } = createSSEStream()

      expect(response.headers.get('Cache-Control')).toBe('no-cache')
    })

    it('returns a Response with connection: keep-alive', () => {
      const { response } = createSSEStream()

      expect(response.headers.get('Connection')).toBe('keep-alive')
    })

    it('returns stream controller for sending events', () => {
      const { response, stream } = createSSEStream()

      expect(stream).toBeDefined()
      expect(typeof stream.send).toBe('function')
      expect(typeof stream.close).toBe('function')
    })
  })

  describe('SSEStream', () => {
    it('stream.send(event) writes to stream in SSE format', async () => {
      const { response, stream } = createSSEStream()
      const reader = response.body!.getReader()

      stream.send({ data: 'hello world' })

      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('data: hello world')
      expect(text).toEndWith('\n\n')
    })

    it('stream.send with event type formats correctly', async () => {
      const { response, stream } = createSSEStream()
      const reader = response.body!.getReader()

      stream.send({ event: 'message', data: 'content' })

      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('event: message')
      expect(text).toContain('data: content')
    })

    it('stream.send with id formats correctly', async () => {
      const { response, stream } = createSSEStream()
      const reader = response.body!.getReader()

      stream.send({ id: '123', data: 'content' })

      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('id: 123')
      expect(text).toContain('data: content')
    })

    it('stream.send with retry formats correctly', async () => {
      const { response, stream } = createSSEStream()
      const reader = response.body!.getReader()

      stream.send({ retry: 5000, data: 'content' })

      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('retry: 5000')
    })

    it('stream.send with object data JSON stringifies', async () => {
      const { response, stream } = createSSEStream()
      const reader = response.body!.getReader()

      stream.send({ data: { foo: 'bar', count: 42 } })

      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('data: {"foo":"bar","count":42}')
    })

    it('stream.send with multiline data splits correctly', async () => {
      const { response, stream } = createSSEStream()
      const reader = response.body!.getReader()

      stream.send({ data: 'line1\nline2\nline3' })

      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('data: line1')
      expect(text).toContain('data: line2')
      expect(text).toContain('data: line3')
    })

    it('stream.close() ends the stream', async () => {
      const { response, stream } = createSSEStream()
      const reader = response.body!.getReader()

      stream.close()

      const { done } = await reader.read()
      expect(done).toBe(true)
    })

    it('stream.send after close throws error', () => {
      const { stream } = createSSEStream()

      stream.close()

      expect(() => stream.send({ data: 'test' })).toThrow('Stream is closed')
    })

    it('stream.comment sends SSE comment', async () => {
      const { response, stream } = createSSEStream()
      const reader = response.body!.getReader()

      stream.comment('keep-alive ping')

      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toBe(': keep-alive ping\n\n')
    })
  })
})

// ============================================================================
// 3. BackpressureController Tests
// ============================================================================

describe('BackpressureController', () => {
  describe('mode: pause', () => {
    it('accepts messages below highWaterMark', () => {
      const controller = new BackpressureController({
        mode: 'pause',
        highWaterMark: 100,
        lowWaterMark: 50,
      })

      const result = controller.push({ data: 'test' })

      expect(result.accepted).toBe(true)
      expect(controller.isPaused).toBe(false)
    })

    it('pauses when buffer reaches highWaterMark', () => {
      const controller = new BackpressureController({
        mode: 'pause',
        highWaterMark: 3,
        lowWaterMark: 1,
      })

      controller.push({ data: '1' })
      controller.push({ data: '2' })
      controller.push({ data: '3' })

      expect(controller.isPaused).toBe(true)
    })

    it('rejects messages while paused', () => {
      const controller = new BackpressureController({
        mode: 'pause',
        highWaterMark: 2,
        lowWaterMark: 1,
      })

      controller.push({ data: '1' })
      controller.push({ data: '2' })

      const result = controller.push({ data: '3' })

      expect(result.accepted).toBe(false)
      expect(result.reason).toBe('paused')
    })

    it('resumes when buffer drains below lowWaterMark', () => {
      const controller = new BackpressureController({
        mode: 'pause',
        highWaterMark: 3,
        lowWaterMark: 1,
      })

      controller.push({ data: '1' })
      controller.push({ data: '2' })
      controller.push({ data: '3' })

      expect(controller.isPaused).toBe(true)

      // Drain messages
      controller.drain()
      controller.drain()
      controller.drain()

      expect(controller.isPaused).toBe(false)
    })

    it('emits pause event when pausing', () => {
      const onPause = vi.fn()
      const controller = new BackpressureController({
        mode: 'pause',
        highWaterMark: 2,
        lowWaterMark: 1,
        onPause,
      })

      controller.push({ data: '1' })
      controller.push({ data: '2' })

      expect(onPause).toHaveBeenCalled()
    })

    it('emits resume event when resuming', () => {
      const onResume = vi.fn()
      const controller = new BackpressureController({
        mode: 'pause',
        highWaterMark: 2,
        lowWaterMark: 1,
        onResume,
      })

      controller.push({ data: '1' })
      controller.push({ data: '2' })
      controller.drain()
      controller.drain()

      expect(onResume).toHaveBeenCalled()
    })
  })

  describe('mode: drop', () => {
    it('drops oldest messages when buffer is full', () => {
      const controller = new BackpressureController({
        mode: 'drop',
        highWaterMark: 3,
      })

      controller.push({ data: 'first' })
      controller.push({ data: 'second' })
      controller.push({ data: 'third' })
      controller.push({ data: 'fourth' })

      expect(controller.bufferSize).toBe(3)

      const drained = controller.drain()
      expect(drained?.data).toBe('second') // 'first' was dropped
    })

    it('always accepts new messages in drop mode', () => {
      const controller = new BackpressureController({
        mode: 'drop',
        highWaterMark: 2,
      })

      controller.push({ data: '1' })
      controller.push({ data: '2' })

      const result = controller.push({ data: '3' })

      expect(result.accepted).toBe(true)
      expect(result.dropped).toBe(true)
    })

    it('reports what was dropped', () => {
      const controller = new BackpressureController({
        mode: 'drop',
        highWaterMark: 2,
      })

      controller.push({ data: 'keep1' })
      controller.push({ data: 'keep2' })

      const result = controller.push({ data: 'new' })

      expect(result.droppedMessage?.data).toBe('keep1')
    })
  })

  describe('mode: buffer', () => {
    it('buffers messages up to limit', () => {
      const controller = new BackpressureController({
        mode: 'buffer',
        highWaterMark: 100,
        bufferLimit: 1000,
      })

      for (let i = 0; i < 500; i++) {
        controller.push({ data: `msg-${i}` })
      }

      expect(controller.bufferSize).toBe(500)
    })

    it('rejects when buffer limit exceeded', () => {
      const controller = new BackpressureController({
        mode: 'buffer',
        highWaterMark: 10,
        bufferLimit: 20,
      })

      for (let i = 0; i < 20; i++) {
        controller.push({ data: `msg-${i}` })
      }

      const result = controller.push({ data: 'overflow' })

      expect(result.accepted).toBe(false)
      expect(result.reason).toBe('buffer_full')
    })

    it('warns when approaching buffer limit', () => {
      const onWarning = vi.fn()
      const controller = new BackpressureController({
        mode: 'buffer',
        highWaterMark: 10,
        bufferLimit: 100,
        warningThreshold: 0.8,
        onWarning,
      })

      for (let i = 0; i < 81; i++) {
        controller.push({ data: `msg-${i}` })
      }

      expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({
        bufferSize: 81,
        bufferLimit: 100,
        utilizationPercent: 81,
      }))
    })
  })

  describe('drain()', () => {
    it('returns oldest message from buffer', () => {
      const controller = new BackpressureController({ mode: 'pause', highWaterMark: 10 })

      controller.push({ data: 'first' })
      controller.push({ data: 'second' })

      const msg = controller.drain()

      expect(msg?.data).toBe('first')
    })

    it('returns undefined when buffer is empty', () => {
      const controller = new BackpressureController({ mode: 'pause', highWaterMark: 10 })

      const msg = controller.drain()

      expect(msg).toBeUndefined()
    })

    it('decrements buffer size', () => {
      const controller = new BackpressureController({ mode: 'pause', highWaterMark: 10 })

      controller.push({ data: '1' })
      controller.push({ data: '2' })

      expect(controller.bufferSize).toBe(2)

      controller.drain()

      expect(controller.bufferSize).toBe(1)
    })
  })

  describe('clear()', () => {
    it('clears all buffered messages', () => {
      const controller = new BackpressureController({ mode: 'pause', highWaterMark: 10 })

      controller.push({ data: '1' })
      controller.push({ data: '2' })
      controller.push({ data: '3' })

      controller.clear()

      expect(controller.bufferSize).toBe(0)
    })

    it('resets paused state', () => {
      const controller = new BackpressureController({
        mode: 'pause',
        highWaterMark: 2,
        lowWaterMark: 1,
      })

      controller.push({ data: '1' })
      controller.push({ data: '2' })

      expect(controller.isPaused).toBe(true)

      controller.clear()

      expect(controller.isPaused).toBe(false)
    })
  })
})

// ============================================================================
// 4. RateLimiter (Token Bucket) Tests
// ============================================================================

describe('RateLimiter (Token Bucket)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('tryAcquire()', () => {
    it('returns true when tokens available', () => {
      const limiter = new RateLimiter({
        bucketSize: 10,
        refillRate: 1, // 1 token per second
      })

      const result = limiter.tryAcquire()

      expect(result).toBe(true)
    })

    it('returns false when no tokens available', () => {
      const limiter = new RateLimiter({
        bucketSize: 2,
        refillRate: 1,
      })

      limiter.tryAcquire()
      limiter.tryAcquire()

      const result = limiter.tryAcquire()

      expect(result).toBe(false)
    })

    it('consumes specified number of tokens', () => {
      const limiter = new RateLimiter({
        bucketSize: 10,
        refillRate: 1,
      })

      limiter.tryAcquire(5)

      expect(limiter.availableTokens).toBe(5)
    })

    it('returns false if requesting more tokens than available', () => {
      const limiter = new RateLimiter({
        bucketSize: 5,
        refillRate: 1,
      })

      const result = limiter.tryAcquire(10)

      expect(result).toBe(false)
      expect(limiter.availableTokens).toBe(5) // unchanged
    })
  })

  describe('refill behavior', () => {
    it('refills at configured rate', () => {
      const limiter = new RateLimiter({
        bucketSize: 10,
        refillRate: 2, // 2 tokens per second
      })

      // Consume all tokens
      limiter.tryAcquire(10)
      expect(limiter.availableTokens).toBe(0)

      // Advance time by 3 seconds
      vi.advanceTimersByTime(3000)

      // Should have 6 tokens now (2 per second * 3 seconds)
      expect(limiter.availableTokens).toBe(6)
    })

    it('does not exceed bucket size on refill', () => {
      const limiter = new RateLimiter({
        bucketSize: 10,
        refillRate: 5, // 5 tokens per second
      })

      // Consume 2 tokens
      limiter.tryAcquire(2)
      expect(limiter.availableTokens).toBe(8)

      // Advance time by 10 seconds (would add 50 tokens)
      vi.advanceTimersByTime(10000)

      // Should cap at bucket size
      expect(limiter.availableTokens).toBe(10)
    })

    it('supports fractional refill rates', () => {
      const limiter = new RateLimiter({
        bucketSize: 100,
        refillRate: 0.5, // 0.5 tokens per second
      })

      limiter.tryAcquire(100)

      vi.advanceTimersByTime(10000) // 10 seconds

      expect(limiter.availableTokens).toBe(5)
    })
  })

  describe('bursting', () => {
    it('allows burst up to bucket size', () => {
      const limiter = new RateLimiter({
        bucketSize: 100,
        refillRate: 10,
      })

      // Should be able to consume all tokens at once
      const results: boolean[] = []
      for (let i = 0; i < 100; i++) {
        results.push(limiter.tryAcquire())
      }

      expect(results.filter(Boolean)).toHaveLength(100)
      expect(limiter.availableTokens).toBe(0)
    })

    it('denies requests after burst exhausted', () => {
      const limiter = new RateLimiter({
        bucketSize: 5,
        refillRate: 1,
      })

      // Exhaust the bucket
      for (let i = 0; i < 5; i++) {
        limiter.tryAcquire()
      }

      // Should be denied
      expect(limiter.tryAcquire()).toBe(false)
    })
  })

  describe('per-client limiting', () => {
    it('creates separate buckets per client', () => {
      const limiter = new RateLimiter({
        bucketSize: 5,
        refillRate: 1,
        perClient: true,
      })

      // Client A exhausts their bucket
      for (let i = 0; i < 5; i++) {
        limiter.tryAcquire(1, 'client-a')
      }

      // Client A should be denied
      expect(limiter.tryAcquire(1, 'client-a')).toBe(false)

      // Client B should still have tokens
      expect(limiter.tryAcquire(1, 'client-b')).toBe(true)
    })

    it('refills per-client buckets independently', () => {
      const limiter = new RateLimiter({
        bucketSize: 10,
        refillRate: 2,
        perClient: true,
      })

      // Both clients exhaust their buckets
      limiter.tryAcquire(10, 'client-a')
      limiter.tryAcquire(10, 'client-b')

      // Advance time
      vi.advanceTimersByTime(2000)

      // Both should have refilled
      expect(limiter.availableTokens('client-a')).toBe(4)
      expect(limiter.availableTokens('client-b')).toBe(4)
    })

    it('getStatus returns per-client info', () => {
      const limiter = new RateLimiter({
        bucketSize: 10,
        refillRate: 1,
        perClient: true,
      })

      limiter.tryAcquire(3, 'client-a')
      limiter.tryAcquire(7, 'client-b')

      const statusA = limiter.getStatus('client-a')
      const statusB = limiter.getStatus('client-b')

      expect(statusA.availableTokens).toBe(7)
      expect(statusB.availableTokens).toBe(3)
    })
  })

  describe('waitForToken()', () => {
    it('resolves immediately when tokens available', async () => {
      const limiter = new RateLimiter({
        bucketSize: 10,
        refillRate: 1,
      })

      const start = Date.now()
      await limiter.waitForToken()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(10)
    })

    it('waits until token becomes available', async () => {
      const limiter = new RateLimiter({
        bucketSize: 1,
        refillRate: 1,
      })

      limiter.tryAcquire() // exhaust tokens

      const promise = limiter.waitForToken()

      // Advance time
      vi.advanceTimersByTime(1000)

      await promise

      expect(limiter.availableTokens).toBe(0) // consumed after waiting
    })

    it('respects timeout', async () => {
      const limiter = new RateLimiter({
        bucketSize: 1,
        refillRate: 0.1, // very slow refill
      })

      limiter.tryAcquire()

      await expect(
        limiter.waitForToken({ timeout: 100 })
      ).rejects.toThrow('Timeout waiting for token')
    })
  })

  describe('reset()', () => {
    it('resets bucket to full', () => {
      const limiter = new RateLimiter({
        bucketSize: 10,
        refillRate: 1,
      })

      limiter.tryAcquire(10)
      expect(limiter.availableTokens).toBe(0)

      limiter.reset()

      expect(limiter.availableTokens).toBe(10)
    })

    it('resets specific client bucket', () => {
      const limiter = new RateLimiter({
        bucketSize: 10,
        refillRate: 1,
        perClient: true,
      })

      limiter.tryAcquire(10, 'client-a')
      limiter.tryAcquire(10, 'client-b')

      limiter.reset('client-a')

      expect(limiter.availableTokens('client-a')).toBe(10)
      expect(limiter.availableTokens('client-b')).toBe(0)
    })
  })
})

// ============================================================================
// 5. SubscriptionManager Tests
// ============================================================================

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager

  beforeEach(() => {
    manager = new SubscriptionManager()
  })

  describe('subscribe()', () => {
    it('subscribes websocket to topic', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, 'orders.created')

      expect(manager.isSubscribed(ws, 'orders.created')).toBe(true)
    })

    it('allows multiple subscriptions per websocket', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, 'orders.created')
      manager.subscribe(ws, 'orders.updated')
      manager.subscribe(ws, 'payments.received')

      expect(manager.getSubscriptions(ws)).toHaveLength(3)
    })

    it('allows multiple websockets per topic', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      manager.subscribe(ws1, 'events')
      manager.subscribe(ws2, 'events')
      manager.subscribe(ws3, 'events')

      expect(manager.getSubscribers('events')).toHaveLength(3)
    })

    it('is idempotent (duplicate subscription is no-op)', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, 'topic')
      manager.subscribe(ws, 'topic')
      manager.subscribe(ws, 'topic')

      expect(manager.getSubscriptions(ws)).toHaveLength(1)
    })
  })

  describe('unsubscribe()', () => {
    it('removes subscription', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, 'orders.created')
      manager.unsubscribe(ws, 'orders.created')

      expect(manager.isSubscribed(ws, 'orders.created')).toBe(false)
    })

    it('is no-op for non-existent subscription', () => {
      const ws = createMockWebSocket()

      expect(() => manager.unsubscribe(ws, 'non-existent')).not.toThrow()
    })

    it('removes only specified subscription', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, 'topic-1')
      manager.subscribe(ws, 'topic-2')
      manager.unsubscribe(ws, 'topic-1')

      expect(manager.isSubscribed(ws, 'topic-1')).toBe(false)
      expect(manager.isSubscribed(ws, 'topic-2')).toBe(true)
    })
  })

  describe('unsubscribeAll()', () => {
    it('removes all subscriptions for a websocket', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, 'topic-1')
      manager.subscribe(ws, 'topic-2')
      manager.subscribe(ws, 'topic-3')

      manager.unsubscribeAll(ws)

      expect(manager.getSubscriptions(ws)).toHaveLength(0)
    })
  })

  describe('publish()', () => {
    it('notifies all subscribers of exact topic', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      manager.subscribe(ws1, 'orders.created')
      manager.subscribe(ws2, 'orders.created')
      // ws3 is not subscribed

      manager.publish('orders.created', { orderId: '123' })

      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ orderId: '123' }))
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ orderId: '123' }))
      expect(ws3.send).not.toHaveBeenCalled()
    })

    it('returns count of notified subscribers', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      manager.subscribe(ws1, 'events')
      manager.subscribe(ws2, 'events')

      const count = manager.publish('events', { data: 'test' })

      expect(count).toBe(2)
    })

    it('skips closed websockets', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket({ readyState: WebSocket.CLOSED })

      manager.subscribe(ws1, 'topic')
      manager.subscribe(ws2, 'topic')

      const count = manager.publish('topic', { data: 'test' })

      expect(count).toBe(1)
      expect(ws1.send).toHaveBeenCalled()
      expect(ws2.send).not.toHaveBeenCalled()
    })
  })

  describe('topic patterns', () => {
    it('wildcard * matches single segment', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, 'orders.*')

      manager.publish('orders.created', { data: '1' })
      manager.publish('orders.updated', { data: '2' })
      manager.publish('orders.deleted', { data: '3' })

      expect(ws.send).toHaveBeenCalledTimes(3)
    })

    it('wildcard * does not match multiple segments', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, 'orders.*')

      manager.publish('orders.items.added', { data: 'test' })

      expect(ws.send).not.toHaveBeenCalled()
    })

    it('wildcard ** matches multiple segments', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, 'orders.**')

      manager.publish('orders.created', { data: '1' })
      manager.publish('orders.items.added', { data: '2' })
      manager.publish('orders.items.quantity.updated', { data: '3' })

      expect(ws.send).toHaveBeenCalledTimes(3)
    })

    it('pattern at start matches correctly', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, '*.created')

      manager.publish('orders.created', { data: '1' })
      manager.publish('products.created', { data: '2' })
      manager.publish('orders.updated', { data: '3' }) // should not match

      expect(ws.send).toHaveBeenCalledTimes(2)
    })

    it('exact match takes precedence over patterns', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      manager.subscribe(ws1, 'orders.created')
      manager.subscribe(ws2, 'orders.*')

      manager.publish('orders.created', { data: 'test' })

      expect(ws1.send).toHaveBeenCalled()
      expect(ws2.send).toHaveBeenCalled()
    })
  })

  describe('matchesTopic()', () => {
    it('exact match returns true', () => {
      expect(matchesTopic('orders.created', 'orders.created')).toBe(true)
    })

    it('exact mismatch returns false', () => {
      expect(matchesTopic('orders.created', 'orders.updated')).toBe(false)
    })

    it('single wildcard matches single segment', () => {
      expect(matchesTopic('orders.created', 'orders.*')).toBe(true)
      expect(matchesTopic('orders.updated', 'orders.*')).toBe(true)
      expect(matchesTopic('products.created', 'orders.*')).toBe(false)
    })

    it('single wildcard does not match multiple segments', () => {
      expect(matchesTopic('orders.items.added', 'orders.*')).toBe(false)
    })

    it('double wildcard matches multiple segments', () => {
      expect(matchesTopic('orders.items.added', 'orders.**')).toBe(true)
      expect(matchesTopic('orders.items.quantity.updated', 'orders.**')).toBe(true)
    })

    it('double wildcard matches single segment too', () => {
      expect(matchesTopic('orders.created', 'orders.**')).toBe(true)
    })

    it('wildcard at start works', () => {
      expect(matchesTopic('orders.created', '*.created')).toBe(true)
      expect(matchesTopic('products.created', '*.created')).toBe(true)
      expect(matchesTopic('orders.updated', '*.created')).toBe(false)
    })

    it('multiple wildcards in pattern', () => {
      expect(matchesTopic('us.orders.created', '*.orders.*')).toBe(true)
      expect(matchesTopic('eu.orders.updated', '*.orders.*')).toBe(true)
    })

    it('handles empty topic gracefully', () => {
      expect(matchesTopic('', 'orders.*')).toBe(false)
      expect(matchesTopic('orders.created', '')).toBe(false)
    })
  })

  describe('getTopicStats()', () => {
    it('returns subscriber count per topic', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      manager.subscribe(ws1, 'orders')
      manager.subscribe(ws2, 'orders')
      manager.subscribe(ws3, 'payments')

      const stats = manager.getTopicStats()

      expect(stats.get('orders')).toBe(2)
      expect(stats.get('payments')).toBe(1)
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

interface MockWebSocketOptions {
  readyState?: number
}

function createMockWebSocket(options: MockWebSocketOptions = {}): WebSocket {
  const { readyState = WebSocket.OPEN } = options

  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState,
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    binaryType: 'blob',
    bufferedAmount: 0,
    extensions: '',
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    protocol: '',
    url: 'ws://test',
  } as unknown as WebSocket
}
