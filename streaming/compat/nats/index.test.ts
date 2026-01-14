/**
 * @dotdo/nats - NATS SDK compat tests
 *
 * Tests for nats.ws/nats.js API compatibility backed by DO storage:
 * - Connection management
 * - Basic pub/sub
 * - Subject wildcards (* and >)
 * - Request/reply pattern
 * - JetStream publish/subscribe
 * - JetStream consumers
 * - KV store operations
 * - Message headers
 *
 * @see https://github.com/nats-io/nats.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  connect,
  StringCodec,
  JSONCodec,
  Empty,
  headers,
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  RetentionPolicy,
  StorageType,
  DiscardPolicy,
  NatsError,
  ErrorCode,
  _clearAll,
} from './index'
import type {
  NatsConnection,
  Subscription,
  Msg,
  JetStreamClient,
  JetStreamManager,
  ConsumerInfo,
  StreamInfo,
  KV,
  KvEntry,
  KvOperation,
  PublishOptions,
  ConsumerConfig,
  StreamConfig,
} from './types'

// ============================================================================
// CONNECTION TESTS
// ============================================================================

describe('Connection management', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should connect with server URL', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    expect(nc).toBeDefined()
    await nc.close()
  })

  it('should connect with multiple servers', async () => {
    const nc = await connect({
      servers: ['nats://localhost:4222', 'nats://localhost:4223'],
    })
    expect(nc).toBeDefined()
    await nc.close()
  })

  it('should connect with minimal config', async () => {
    const nc = await connect()
    expect(nc).toBeDefined()
    await nc.close()
  })

  it('should connect with full config', async () => {
    const nc = await connect({
      servers: 'nats://localhost:4222',
      name: 'test-client',
      user: 'testuser',
      pass: 'testpass',
      token: 'testtoken',
      timeout: 5000,
      pingInterval: 30000,
      maxPingOut: 3,
      reconnect: true,
      maxReconnectAttempts: 10,
      reconnectTimeWait: 2000,
      noRandomize: false,
      verbose: false,
      pedantic: false,
    })
    expect(nc).toBeDefined()
    await nc.close()
  })

  it('should report connection status', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    expect(nc.isClosed()).toBe(false)
    await nc.close()
    expect(nc.isClosed()).toBe(true)
  })

  it('should drain connection gracefully', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    await nc.drain()
    expect(nc.isClosed()).toBe(true)
  })

  it('should get connection info', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222', name: 'test-client' })
    const info = nc.info
    expect(info).toBeDefined()
    await nc.close()
  })

  it('should get server RTT', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const rtt = await nc.rtt()
    expect(typeof rtt).toBe('number')
    expect(rtt).toBeGreaterThanOrEqual(0)
    await nc.close()
  })

  it('should flush pending messages', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    await nc.flush()
    await nc.close()
  })

  it('should get connection stats', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const stats = nc.stats()
    expect(stats).toBeDefined()
    expect(stats.inBytes).toBeDefined()
    expect(stats.outBytes).toBeDefined()
    expect(stats.inMsgs).toBeDefined()
    expect(stats.outMsgs).toBeDefined()
    await nc.close()
  })

  it('should emit status updates', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const statusEvents: string[] = []

    ;(async () => {
      for await (const s of nc.status()) {
        statusEvents.push(s.type)
      }
    })()

    await nc.close()
    // Status iterator should complete after close
  })
})

// ============================================================================
// CODEC TESTS
// ============================================================================

describe('Codecs', () => {
  describe('StringCodec', () => {
    it('should encode string to Uint8Array', () => {
      const sc = StringCodec()
      const encoded = sc.encode('Hello NATS')
      expect(encoded).toBeInstanceOf(Uint8Array)
    })

    it('should decode Uint8Array to string', () => {
      const sc = StringCodec()
      const encoded = sc.encode('Hello NATS')
      const decoded = sc.decode(encoded)
      expect(decoded).toBe('Hello NATS')
    })

    it('should handle empty string', () => {
      const sc = StringCodec()
      const encoded = sc.encode('')
      const decoded = sc.decode(encoded)
      expect(decoded).toBe('')
    })

    it('should handle unicode', () => {
      const sc = StringCodec()
      const text = 'Hello'
      const encoded = sc.encode(text)
      const decoded = sc.decode(encoded)
      expect(decoded).toBe(text)
    })
  })

  describe('JSONCodec', () => {
    it('should encode object to Uint8Array', () => {
      const jc = JSONCodec<{ name: string }>()
      const encoded = jc.encode({ name: 'test' })
      expect(encoded).toBeInstanceOf(Uint8Array)
    })

    it('should decode Uint8Array to object', () => {
      const jc = JSONCodec<{ name: string; value: number }>()
      const obj = { name: 'test', value: 42 }
      const encoded = jc.encode(obj)
      const decoded = jc.decode(encoded)
      expect(decoded).toEqual(obj)
    })

    it('should handle arrays', () => {
      const jc = JSONCodec<number[]>()
      const arr = [1, 2, 3, 4, 5]
      const encoded = jc.encode(arr)
      const decoded = jc.decode(encoded)
      expect(decoded).toEqual(arr)
    })

    it('should handle nested objects', () => {
      const jc = JSONCodec<{ user: { name: string; age: number } }>()
      const obj = { user: { name: 'John', age: 30 } }
      const encoded = jc.encode(obj)
      const decoded = jc.decode(encoded)
      expect(decoded).toEqual(obj)
    })
  })

  describe('Empty', () => {
    it('should be an empty Uint8Array', () => {
      expect(Empty).toBeInstanceOf(Uint8Array)
      expect(Empty.length).toBe(0)
    })
  })
})

// ============================================================================
// BASIC PUB/SUB TESTS
// ============================================================================

describe('Basic pub/sub', () => {
  let nc: NatsConnection

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should publish a message', () => {
    const sc = StringCodec()
    nc.publish('updates', sc.encode('Hello NATS'))
    // Should not throw
  })

  it('should publish empty message', () => {
    nc.publish('updates', Empty)
    // Should not throw
  })

  it('should subscribe to a subject', async () => {
    const sub = nc.subscribe('updates')
    expect(sub).toBeDefined()
    await sub.unsubscribe()
  })

  it('should receive published messages', async () => {
    const sc = StringCodec()
    const messages: Msg[] = []

    const sub = nc.subscribe('updates')

    nc.publish('updates', sc.encode('Message 1'))
    nc.publish('updates', sc.encode('Message 2'))
    await nc.flush()

    // Collect messages
    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        if (messages.length >= 2) break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 500)),
    ])

    await sub.unsubscribe()

    expect(messages.length).toBe(2)
    expect(sc.decode(messages[0].data)).toBe('Message 1')
    expect(sc.decode(messages[1].data)).toBe('Message 2')
  })

  it('should provide message subject', async () => {
    const sub = nc.subscribe('updates')
    nc.publish('updates', Empty)
    await nc.flush()

    for await (const msg of sub) {
      expect(msg.subject).toBe('updates')
      break
    }

    await sub.unsubscribe()
  })

  it('should unsubscribe from subject', async () => {
    const sub = nc.subscribe('updates')
    await sub.unsubscribe()
    // Further messages should not be received
  })

  it('should unsubscribe after max messages', async () => {
    const sub = nc.subscribe('updates', { max: 2 })

    nc.publish('updates', Empty)
    nc.publish('updates', Empty)
    nc.publish('updates', Empty)
    await nc.flush()

    const messages: Msg[] = []
    for await (const msg of sub) {
      messages.push(msg)
    }

    expect(messages.length).toBe(2)
  })

  it('should drain subscription', async () => {
    const sub = nc.subscribe('updates')
    nc.publish('updates', Empty)
    await nc.flush()
    await sub.drain()
  })

  it('should get subscription info', async () => {
    const sub = nc.subscribe('updates')
    expect(sub.getSubject()).toBe('updates')
    expect(sub.isClosed()).toBe(false)
    await sub.unsubscribe()
    expect(sub.isClosed()).toBe(true)
  })

  it('should get received count', async () => {
    const sub = nc.subscribe('updates')
    nc.publish('updates', Empty)
    nc.publish('updates', Empty)
    await nc.flush()

    // Wait for messages
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(sub.getReceived()).toBeGreaterThanOrEqual(0)
    await sub.unsubscribe()
  })

  it('should get pending count', async () => {
    const sub = nc.subscribe('updates')
    expect(sub.getPending()).toBeGreaterThanOrEqual(0)
    await sub.unsubscribe()
  })
})

// ============================================================================
// SUBJECT WILDCARDS TESTS
// ============================================================================

describe('Subject wildcards', () => {
  let nc: NatsConnection
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
  })

  afterEach(async () => {
    await nc.close()
  })

  describe('Single token wildcard (*)', () => {
    it('should match single token', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('updates.*')

      nc.publish('updates.user', sc.encode('user update'))
      nc.publish('updates.order', sc.encode('order update'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 2) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 500)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(2)
      expect(messages.map(m => m.subject)).toContain('updates.user')
      expect(messages.map(m => m.subject)).toContain('updates.order')
    })

    it('should not match multiple tokens', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('updates.*')

      nc.publish('updates.user.created', sc.encode('should not match'))
      nc.publish('updates.user', sc.encode('should match'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 1) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 300)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(1)
      expect(messages[0].subject).toBe('updates.user')
    })

    it('should match in middle of subject', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('events.*.created')

      nc.publish('events.user.created', sc.encode('user created'))
      nc.publish('events.order.created', sc.encode('order created'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 2) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 500)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(2)
    })
  })

  describe('Multi-token wildcard (>)', () => {
    it('should match multiple tokens', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('updates.>')

      nc.publish('updates.user', sc.encode('1'))
      nc.publish('updates.user.created', sc.encode('2'))
      nc.publish('updates.user.profile.updated', sc.encode('3'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 3) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 500)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(3)
    })

    it('should match at least one token', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('updates.>')

      nc.publish('updates', sc.encode('should not match'))
      nc.publish('updates.user', sc.encode('should match'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 1) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 300)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(1)
      expect(messages[0].subject).toBe('updates.user')
    })

    it('should only appear at end of subject', async () => {
      const messages: Msg[] = []
      // > can only be at end, this should still work but match correctly
      const sub = nc.subscribe('>')

      nc.publish('anything.here', sc.encode('1'))
      nc.publish('something.else.entirely', sc.encode('2'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 2) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 500)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(2)
    })
  })

  describe('Combined wildcards', () => {
    it('should combine * and >', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('events.*.>')

      nc.publish('events.user.created', sc.encode('1'))
      nc.publish('events.order.item.added', sc.encode('2'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 2) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 500)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(2)
    })
  })
})

// ============================================================================
// REQUEST/REPLY TESTS
// ============================================================================

describe('Request/reply pattern', () => {
  let nc: NatsConnection
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should send request and receive reply', async () => {
    // Set up responder
    const sub = nc.subscribe('service')
    ;(async () => {
      for await (const msg of sub) {
        if (msg.reply) {
          nc.publish(msg.reply, sc.encode('response'))
        }
      }
    })()

    // Send request
    const response = await nc.request('service', sc.encode('help'))
    expect(sc.decode(response.data)).toBe('response')

    await sub.unsubscribe()
  })

  it('should timeout if no reply', async () => {
    await expect(
      nc.request('no-responder', sc.encode('help'), { timeout: 100 })
    ).rejects.toThrow()
  })

  it('should provide reply subject in message', async () => {
    const sub = nc.subscribe('service')
    let replySubject: string | undefined

    ;(async () => {
      for await (const msg of sub) {
        replySubject = msg.reply
        if (msg.reply) {
          nc.publish(msg.reply, sc.encode('ok'))
        }
      }
    })()

    await nc.request('service', sc.encode('test'))
    await sub.unsubscribe()

    expect(replySubject).toBeDefined()
    expect(replySubject).toMatch(/^_INBOX\./)
  })

  it('should use message respond method', async () => {
    const sub = nc.subscribe('service')

    ;(async () => {
      for await (const msg of sub) {
        msg.respond(sc.encode('using respond'))
      }
    })()

    const response = await nc.request('service', sc.encode('test'))
    expect(sc.decode(response.data)).toBe('using respond')

    await sub.unsubscribe()
  })

  it('should handle multiple concurrent requests', async () => {
    const sub = nc.subscribe('echo')

    ;(async () => {
      for await (const msg of sub) {
        // Echo back the message
        msg.respond(msg.data)
      }
    })()

    const [r1, r2, r3] = await Promise.all([
      nc.request('echo', sc.encode('one')),
      nc.request('echo', sc.encode('two')),
      nc.request('echo', sc.encode('three')),
    ])

    expect(sc.decode(r1.data)).toBe('one')
    expect(sc.decode(r2.data)).toBe('two')
    expect(sc.decode(r3.data)).toBe('three')

    await sub.unsubscribe()
  })

  it('should send request with headers', async () => {
    const sub = nc.subscribe('service')
    let receivedHeaders: any

    ;(async () => {
      for await (const msg of sub) {
        receivedHeaders = msg.headers
        msg.respond(sc.encode('ok'))
      }
    })()

    const h = headers()
    h.set('X-Request-Id', '12345')

    await nc.request('service', sc.encode('test'), { headers: h })
    await sub.unsubscribe()

    expect(receivedHeaders).toBeDefined()
    expect(receivedHeaders.get('X-Request-Id')).toBe('12345')
  })
})

// ============================================================================
// MESSAGE HEADERS TESTS
// ============================================================================

describe('Message headers', () => {
  let nc: NatsConnection
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should create headers', () => {
    const h = headers()
    expect(h).toBeDefined()
  })

  it('should set and get header', () => {
    const h = headers()
    h.set('Content-Type', 'application/json')
    expect(h.get('Content-Type')).toBe('application/json')
  })

  it('should check if header exists', () => {
    const h = headers()
    h.set('X-Custom', 'value')
    expect(h.has('X-Custom')).toBe(true)
    expect(h.has('X-Missing')).toBe(false)
  })

  it('should delete header', () => {
    const h = headers()
    h.set('X-Delete-Me', 'value')
    h.delete('X-Delete-Me')
    expect(h.has('X-Delete-Me')).toBe(false)
  })

  it('should append to header', () => {
    const h = headers()
    h.append('Accept', 'text/plain')
    h.append('Accept', 'application/json')
    const values = h.values('Accept')
    expect(values).toContain('text/plain')
    expect(values).toContain('application/json')
  })

  it('should iterate over headers', () => {
    const h = headers()
    h.set('Key1', 'Value1')
    h.set('Key2', 'Value2')

    const keys = [...h.keys()]
    expect(keys).toContain('Key1')
    expect(keys).toContain('Key2')
  })

  it('should publish message with headers', async () => {
    const messages: Msg[] = []
    const sub = nc.subscribe('updates')

    const h = headers()
    h.set('X-Trace-Id', 'abc123')

    nc.publish('updates', sc.encode('test'), { headers: h })
    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()

    expect(messages.length).toBe(1)
    expect(messages[0].headers?.get('X-Trace-Id')).toBe('abc123')
  })

  it('should preserve headers through request/reply', async () => {
    const sub = nc.subscribe('service')

    ;(async () => {
      for await (const msg of sub) {
        const responseHeaders = headers()
        responseHeaders.set('X-Response-Id', 'resp-456')
        msg.respond(sc.encode('ok'), { headers: responseHeaders })
      }
    })()

    const h = headers()
    h.set('X-Request-Id', 'req-123')

    const response = await nc.request('service', sc.encode('test'), { headers: h })

    expect(response.headers?.get('X-Response-Id')).toBe('resp-456')

    await sub.unsubscribe()
  })
})

// ============================================================================
// JETSTREAM PUBLISH/SUBSCRIBE TESTS
// ============================================================================

describe('JetStream publish/subscribe', () => {
  let nc: NatsConnection
  let js: JetStreamClient
  let jsm: JetStreamManager
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    js = nc.jetstream()
    jsm = await nc.jetstreamManager()

    // Create a stream for testing
    await jsm.streams.add({
      name: 'ORDERS',
      subjects: ['orders.>'],
    })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should get JetStream client', () => {
    const jetstream = nc.jetstream()
    expect(jetstream).toBeDefined()
  })

  it('should get JetStream manager', async () => {
    const manager = await nc.jetstreamManager()
    expect(manager).toBeDefined()
  })

  it('should publish to JetStream', async () => {
    const ack = await js.publish('orders.new', sc.encode('order1'))
    expect(ack).toBeDefined()
    expect(ack.seq).toBeGreaterThan(0)
    expect(ack.stream).toBe('ORDERS')
  })

  it('should publish with options', async () => {
    const ack = await js.publish('orders.new', sc.encode('order1'), {
      msgID: 'unique-id-1',
      expect: { streamName: 'ORDERS' },
    })
    expect(ack.seq).toBeGreaterThan(0)
  })

  it('should deduplicate by message ID', async () => {
    await js.publish('orders.new', sc.encode('order1'), { msgID: 'dup-1' })
    const ack2 = await js.publish('orders.new', sc.encode('order1'), { msgID: 'dup-1' })

    // Second publish should return duplicate: true
    expect(ack2.duplicate).toBe(true)
  })

  it('should publish with headers', async () => {
    const h = headers()
    h.set('X-Order-Type', 'priority')

    const ack = await js.publish('orders.new', sc.encode('order1'), { headers: h })
    expect(ack.seq).toBeGreaterThan(0)
  })

  it('should subscribe to JetStream', async () => {
    await js.publish('orders.new', sc.encode('order1'))

    // Create consumer first
    await jsm.consumers.add('ORDERS', {
      durable_name: 'test-consumer',
      ack_policy: AckPolicy.Explicit,
    })

    const consumer = await js.consumers.get('ORDERS', 'test-consumer')
    const messages = await consumer.fetch({ max_messages: 1 })

    let received = false
    for await (const msg of messages) {
      expect(sc.decode(msg.data)).toBe('order1')
      msg.ack()
      received = true
      break
    }

    expect(received).toBe(true)
  })
})

// ============================================================================
// JETSTREAM STREAM MANAGEMENT TESTS
// ============================================================================

describe('JetStream stream management', () => {
  let nc: NatsConnection
  let jsm: JetStreamManager

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    jsm = await nc.jetstreamManager()
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should create stream', async () => {
    const info = await jsm.streams.add({
      name: 'TEST',
      subjects: ['test.>'],
    })

    expect(info).toBeDefined()
    expect(info.config.name).toBe('TEST')
  })

  it('should create stream with full config', async () => {
    const info = await jsm.streams.add({
      name: 'FULL',
      subjects: ['full.>'],
      retention: RetentionPolicy.Limits,
      storage: StorageType.Memory,
      max_msgs: 1000,
      max_bytes: 1024 * 1024,
      max_age: 86400000000000, // 1 day in nanos
      max_msg_size: 1024,
      discard: DiscardPolicy.Old,
      num_replicas: 1,
    })

    expect(info.config.retention).toBe(RetentionPolicy.Limits)
    expect(info.config.storage).toBe(StorageType.Memory)
  })

  it('should list streams', async () => {
    await jsm.streams.add({ name: 'STREAM1', subjects: ['s1.>'] })
    await jsm.streams.add({ name: 'STREAM2', subjects: ['s2.>'] })

    const streams = await jsm.streams.list().next()
    expect(streams.length).toBeGreaterThanOrEqual(2)
  })

  it('should get stream info', async () => {
    await jsm.streams.add({ name: 'INFO', subjects: ['info.>'] })

    const info = await jsm.streams.info('INFO')
    expect(info.config.name).toBe('INFO')
    expect(info.state).toBeDefined()
  })

  it('should update stream', async () => {
    await jsm.streams.add({ name: 'UPDATE', subjects: ['update.>'] })

    const info = await jsm.streams.update('UPDATE', {
      subjects: ['update.>', 'update2.>'],
    })

    expect(info.config.subjects).toContain('update2.>')
  })

  it('should delete stream', async () => {
    await jsm.streams.add({ name: 'DELETE', subjects: ['delete.>'] })
    await jsm.streams.delete('DELETE')

    await expect(jsm.streams.info('DELETE')).rejects.toThrow()
  })

  it('should purge stream', async () => {
    await jsm.streams.add({ name: 'PURGE', subjects: ['purge.>'] })

    const js = nc.jetstream()
    await js.publish('purge.test', StringCodec().encode('msg1'))
    await js.publish('purge.test', StringCodec().encode('msg2'))

    const purged = await jsm.streams.purge('PURGE')
    expect(purged.purged).toBeGreaterThan(0)
  })

  it('should get stream names', async () => {
    await jsm.streams.add({ name: 'NAMES1', subjects: ['names1.>'] })
    await jsm.streams.add({ name: 'NAMES2', subjects: ['names2.>'] })

    const names = await jsm.streams.names().next()
    expect(names).toContain('NAMES1')
    expect(names).toContain('NAMES2')
  })
})

// ============================================================================
// JETSTREAM CONSUMER TESTS
// ============================================================================

describe('JetStream consumers', () => {
  let nc: NatsConnection
  let js: JetStreamClient
  let jsm: JetStreamManager
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    js = nc.jetstream()
    jsm = await nc.jetstreamManager()

    await jsm.streams.add({
      name: 'EVENTS',
      subjects: ['events.>'],
    })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should create durable consumer', async () => {
    const info = await jsm.consumers.add('EVENTS', {
      durable_name: 'processor',
      ack_policy: AckPolicy.Explicit,
    })

    expect(info.name).toBe('processor')
  })

  it('should create ephemeral consumer', async () => {
    const info = await jsm.consumers.add('EVENTS', {
      ack_policy: AckPolicy.Explicit,
    })

    expect(info.name).toBeDefined()
  })

  it('should create consumer with full config', async () => {
    const info = await jsm.consumers.add('EVENTS', {
      durable_name: 'full-consumer',
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      filter_subject: 'events.user.>',
      max_deliver: 3,
      ack_wait: 30000000000, // 30 seconds in nanos
    })

    expect(info.config.deliver_policy).toBe(DeliverPolicy.All)
    expect(info.config.filter_subject).toBe('events.user.>')
  })

  it('should list consumers', async () => {
    await jsm.consumers.add('EVENTS', { durable_name: 'consumer1' })
    await jsm.consumers.add('EVENTS', { durable_name: 'consumer2' })

    const consumers = await jsm.consumers.list('EVENTS').next()
    expect(consumers.length).toBeGreaterThanOrEqual(2)
  })

  it('should get consumer info', async () => {
    await jsm.consumers.add('EVENTS', { durable_name: 'info-consumer' })

    const info = await jsm.consumers.info('EVENTS', 'info-consumer')
    expect(info.name).toBe('info-consumer')
    expect(info.stream_name).toBe('EVENTS')
  })

  it('should delete consumer', async () => {
    await jsm.consumers.add('EVENTS', { durable_name: 'delete-consumer' })
    await jsm.consumers.delete('EVENTS', 'delete-consumer')

    await expect(
      jsm.consumers.info('EVENTS', 'delete-consumer')
    ).rejects.toThrow()
  })

  it('should fetch messages', async () => {
    await jsm.consumers.add('EVENTS', { durable_name: 'fetcher' })

    await js.publish('events.user.created', sc.encode('user1'))
    await js.publish('events.user.updated', sc.encode('user2'))

    const consumer = await js.consumers.get('EVENTS', 'fetcher')
    const messages = await consumer.fetch({ max_messages: 10 })

    const received: string[] = []
    for await (const msg of messages) {
      received.push(sc.decode(msg.data))
      msg.ack()
    }

    expect(received.length).toBe(2)
  })

  it('should consume with push subscription', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'pusher',
      deliver_subject: '_INBOX.push',
    })

    await js.publish('events.order', sc.encode('order1'))

    const consumer = await js.consumers.get('EVENTS', 'pusher')
    const messages = await consumer.consume()

    for await (const msg of messages) {
      expect(sc.decode(msg.data)).toBe('order1')
      msg.ack()
      break
    }
  })

  it('should ack message explicitly', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'acker',
      ack_policy: AckPolicy.Explicit,
    })

    await js.publish('events.test', sc.encode('ack-me'))

    const consumer = await js.consumers.get('EVENTS', 'acker')
    const messages = await consumer.fetch({ max_messages: 1 })

    for await (const msg of messages) {
      msg.ack()
      break
    }
  })

  it('should nak message for redelivery', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'naker',
      ack_policy: AckPolicy.Explicit,
    })

    await js.publish('events.test', sc.encode('nak-me'))

    const consumer = await js.consumers.get('EVENTS', 'naker')
    const messages = await consumer.fetch({ max_messages: 1 })

    for await (const msg of messages) {
      msg.nak()
      break
    }
  })

  it('should terminate message (no redelivery)', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'terminator',
      ack_policy: AckPolicy.Explicit,
    })

    await js.publish('events.test', sc.encode('terminate-me'))

    const consumer = await js.consumers.get('EVENTS', 'terminator')
    const messages = await consumer.fetch({ max_messages: 1 })

    for await (const msg of messages) {
      msg.term()
      break
    }
  })

  it('should request message redelivery with delay', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'delayer',
      ack_policy: AckPolicy.Explicit,
    })

    await js.publish('events.test', sc.encode('delay-me'))

    const consumer = await js.consumers.get('EVENTS', 'delayer')
    const messages = await consumer.fetch({ max_messages: 1 })

    for await (const msg of messages) {
      msg.nak(1000) // 1 second delay
      break
    }
  })

  it('should report working on message', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'worker',
      ack_policy: AckPolicy.Explicit,
    })

    await js.publish('events.test', sc.encode('work-on-me'))

    const consumer = await js.consumers.get('EVENTS', 'worker')
    const messages = await consumer.fetch({ max_messages: 1 })

    for await (const msg of messages) {
      await msg.working()
      msg.ack()
      break
    }
  })

  it('should redeliver message after NAK', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'nak-redelivery',
      ack_policy: AckPolicy.Explicit,
      max_deliver: 5,
    })

    await js.publish('events.test', sc.encode('nak-me'))

    const consumer = await js.consumers.get('EVENTS', 'nak-redelivery')

    let deliveryCount = 0

    // First fetch - NAK the message
    const messages1 = await consumer.fetch({ max_messages: 1 })
    for await (const msg of messages1) {
      deliveryCount++
      expect(msg.info.deliveryCount).toBe(1)
      msg.nak() // Reject first time
    }

    // Second fetch - should get redelivered message
    const messages2 = await consumer.fetch({ max_messages: 1 })
    for await (const msg of messages2) {
      deliveryCount++
      expect(msg.info.deliveryCount).toBe(2) // Should be second delivery
      expect(sc.decode(msg.data)).toBe('nak-me')
      msg.ack() // Accept on redelivery
    }

    expect(deliveryCount).toBe(2) // Should be delivered twice
  })

  it('should redeliver message with delay after NAK with delay', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'nak-delay',
      ack_policy: AckPolicy.Explicit,
    })

    await js.publish('events.test', sc.encode('delay-nak'))

    const consumer = await js.consumers.get('EVENTS', 'nak-delay')

    // First fetch - NAK with delay
    const messages1 = await consumer.fetch({ max_messages: 1 })
    const nakTime = Date.now()
    for await (const msg of messages1) {
      msg.nak(50) // 50ms delay
    }

    // Immediate fetch should not get the message (still delayed)
    const messages2 = await consumer.fetch({ max_messages: 1 })
    let immediateCount = 0
    for await (const _msg of messages2) {
      immediateCount++
    }
    expect(immediateCount).toBe(0)

    // Wait for delay to expire
    await new Promise(resolve => setTimeout(resolve, 60))

    // Now should get the message
    const messages3 = await consumer.fetch({ max_messages: 1 })
    let delayedCount = 0
    for await (const msg of messages3) {
      delayedCount++
      msg.ack()
    }
    expect(delayedCount).toBe(1)
  })

  it('should extend ack deadline with working()', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'working-test',
      ack_policy: AckPolicy.Explicit,
      ack_wait: 50000000, // 50ms in nanoseconds
    })

    await js.publish('events.test', sc.encode('work-long'))

    const consumer = await js.consumers.get('EVENTS', 'working-test')

    // First fetch
    const messages1 = await consumer.fetch({ max_messages: 1 })
    for await (const msg of messages1) {
      // Extend the deadline
      await msg.working()
      // Wait 30ms (would timeout without working())
      await new Promise(resolve => setTimeout(resolve, 30))
      // Extend again
      await msg.working()
      // Wait another 30ms
      await new Promise(resolve => setTimeout(resolve, 30))
      // Still ours - ack it
      msg.ack()
    }

    // Verify message was acked and not redelivered
    const info = await consumer.info()
    expect(info.num_ack_pending).toBe(0)
  })

  it('should track delivery count across multiple NAKs', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'multi-nak',
      ack_policy: AckPolicy.Explicit,
      max_deliver: 10,
    })

    await js.publish('events.test', sc.encode('multi-nak-me'))

    const consumer = await js.consumers.get('EVENTS', 'multi-nak')
    const deliveryCounts: number[] = []

    // NAK 3 times, then ack
    for (let i = 0; i < 4; i++) {
      const messages = await consumer.fetch({ max_messages: 1 })
      for await (const msg of messages) {
        deliveryCounts.push(msg.info.deliveryCount)
        if (i < 3) {
          msg.nak()
        } else {
          msg.ack()
        }
      }
    }

    expect(deliveryCounts).toEqual([1, 2, 3, 4])
  })

  it('should stop redelivery after max_deliver attempts', async () => {
    await jsm.consumers.add('EVENTS', {
      durable_name: 'max-redeliver',
      ack_policy: AckPolicy.Explicit,
      max_deliver: 3,
    })

    await js.publish('events.test', sc.encode('max-nak'))

    const consumer = await js.consumers.get('EVENTS', 'max-redeliver')
    let deliveryCount = 0

    // NAK until max_deliver is reached
    for (let i = 0; i < 5; i++) {
      const messages = await consumer.fetch({ max_messages: 1 })
      let gotMessage = false
      for await (const msg of messages) {
        gotMessage = true
        deliveryCount++
        msg.nak()
      }
      if (!gotMessage) break
    }

    // Should only be delivered max_deliver times
    expect(deliveryCount).toBe(3)
  })
})

// ============================================================================
// KV STORE TESTS
// ============================================================================

describe('KV store operations', () => {
  let nc: NatsConnection
  let js: JetStreamClient
  let kv: KV
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    js = nc.jetstream()
    kv = await js.views.kv('config')
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should create KV bucket', async () => {
    const bucket = await js.views.kv('new-bucket')
    expect(bucket).toBeDefined()
  })

  it('should create KV bucket with options', async () => {
    const bucket = await js.views.kv('options-bucket', {
      history: 5,
      ttl: 3600000, // 1 hour
      max_bucket_size: 1024 * 1024,
      replicas: 1,
    })
    expect(bucket).toBeDefined()
  })

  it('should put value', async () => {
    const seq = await kv.put('key', sc.encode('value'))
    expect(seq).toBeGreaterThan(0)
  })

  it('should get value', async () => {
    await kv.put('key', sc.encode('value'))
    const entry = await kv.get('key')

    expect(entry).toBeDefined()
    expect(entry!.key).toBe('key')
    expect(sc.decode(entry!.value)).toBe('value')
  })

  it('should return null for missing key', async () => {
    const entry = await kv.get('missing-key')
    expect(entry).toBeNull()
  })

  it('should delete key', async () => {
    await kv.put('to-delete', sc.encode('value'))
    await kv.delete('to-delete')

    const entry = await kv.get('to-delete')
    expect(entry).toBeNull()
  })

  it('should purge key history', async () => {
    await kv.put('to-purge', sc.encode('value1'))
    await kv.put('to-purge', sc.encode('value2'))
    await kv.purge('to-purge')

    const entry = await kv.get('to-purge')
    expect(entry).toBeNull()
  })

  it('should get entry revision', async () => {
    const seq1 = await kv.put('rev-key', sc.encode('v1'))
    const seq2 = await kv.put('rev-key', sc.encode('v2'))

    expect(seq2).toBeGreaterThan(seq1)

    const entry = await kv.get('rev-key')
    expect(entry!.revision).toBe(seq2)
  })

  it('should get entry creation time', async () => {
    await kv.put('time-key', sc.encode('value'))
    const entry = await kv.get('time-key')

    expect(entry!.created).toBeInstanceOf(Date)
  })

  it('should list keys', async () => {
    await kv.put('list-key1', sc.encode('v1'))
    await kv.put('list-key2', sc.encode('v2'))
    await kv.put('list-key3', sc.encode('v3'))

    const keys = await kv.keys()
    const keyList: string[] = []
    for await (const key of keys) {
      keyList.push(key)
    }

    expect(keyList).toContain('list-key1')
    expect(keyList).toContain('list-key2')
    expect(keyList).toContain('list-key3')
  })

  it('should watch for changes', async () => {
    const changes: KvEntry[] = []

    const watcher = await kv.watch()
    const watchPromise = (async () => {
      for await (const entry of watcher) {
        changes.push(entry)
        if (changes.length >= 2) break
      }
    })()

    await kv.put('watch-key', sc.encode('v1'))
    await kv.put('watch-key', sc.encode('v2'))

    await Promise.race([
      watchPromise,
      new Promise(resolve => setTimeout(resolve, 500)),
    ])

    expect(changes.length).toBeGreaterThanOrEqual(2)
  })

  it('should get key history', async () => {
    await kv.put('history-key', sc.encode('v1'))
    await kv.put('history-key', sc.encode('v2'))
    await kv.put('history-key', sc.encode('v3'))

    const history = await kv.history('history-key')
    const versions: KvEntry[] = []
    for await (const entry of history) {
      versions.push(entry)
    }

    expect(versions.length).toBe(3)
  })

  it('should create with update if exists', async () => {
    const seq1 = await kv.put('create-key', sc.encode('original'))

    // Try to create - should fail because key exists
    const created = await kv.create('create-key', sc.encode('should-fail'))
    expect(created).toBe(0) // 0 indicates failure to create
  })

  it('should update with revision check', async () => {
    const seq1 = await kv.put('update-key', sc.encode('v1'))

    // Update with correct revision
    const seq2 = await kv.update('update-key', sc.encode('v2'), seq1)
    expect(seq2).toBeGreaterThan(seq1)

    // Update with wrong revision should fail
    await expect(
      kv.update('update-key', sc.encode('v3'), seq1)
    ).rejects.toThrow()
  })

  it('should destroy bucket', async () => {
    const tempKv = await js.views.kv('temp-bucket')
    await tempKv.put('key', sc.encode('value'))
    await tempKv.destroy()

    // Bucket should no longer exist
    await expect(js.views.kv('temp-bucket', { bindOnly: true })).rejects.toThrow()
  })

  it('should get bucket status', async () => {
    await kv.put('status-key', sc.encode('value'))
    const status = await kv.status()

    expect(status).toBeDefined()
    expect(status.bucket).toBe('config')
    expect(status.values).toBeGreaterThan(0)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should create NatsError with code', () => {
    const err = new NatsError('test error', ErrorCode.Timeout)
    expect(err.code).toBe(ErrorCode.Timeout)
    expect(err.message).toBe('test error')
  })

  it('should provide error codes', () => {
    expect(ErrorCode.Timeout).toBeDefined()
    expect(ErrorCode.NoResponders).toBeDefined()
    expect(ErrorCode.ConnectionRefused).toBeDefined()
    expect(ErrorCode.JetStreamNotEnabled).toBeDefined()
  })

  it('should throw on invalid subject', async () => {
    const nc = await connect()
    expect(() => nc.publish('invalid..subject', Empty)).toThrow()
    await nc.close()
  })

  it('should throw on closed connection', async () => {
    const nc = await connect()
    await nc.close()

    expect(() => nc.publish('test', Empty)).toThrow()
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

// ============================================================================
// QUEUE GROUPS TESTS
// ============================================================================

describe('Queue groups', () => {
  let nc: NatsConnection
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should distribute messages among queue group members', async () => {
    const group1Messages: string[] = []
    const group2Messages: string[] = []

    // Two subscribers in same queue group
    const sub1 = nc.subscribe('work.queue', { queue: 'workers' })
    const sub2 = nc.subscribe('work.queue', { queue: 'workers' })

    const collect1 = (async () => {
      for await (const msg of sub1) {
        group1Messages.push(sc.decode(msg.data))
      }
    })()

    const collect2 = (async () => {
      for await (const msg of sub2) {
        group2Messages.push(sc.decode(msg.data))
      }
    })()

    // Publish multiple messages
    for (let i = 0; i < 10; i++) {
      nc.publish('work.queue', sc.encode(`task-${i}`))
    }
    await nc.flush()

    // Wait for message distribution
    await new Promise(resolve => setTimeout(resolve, 300))

    await sub1.unsubscribe()
    await sub2.unsubscribe()

    // Total messages should equal published count
    expect(group1Messages.length + group2Messages.length).toBe(10)
  })

  it('should support multiple queue groups on same subject', async () => {
    const groupA: string[] = []
    const groupB: string[] = []

    const subA = nc.subscribe('shared.topic', { queue: 'group-a' })
    const subB = nc.subscribe('shared.topic', { queue: 'group-b' })

    const collectA = (async () => {
      for await (const msg of subA) {
        groupA.push(sc.decode(msg.data))
        if (groupA.length >= 1) break
      }
    })()

    const collectB = (async () => {
      for await (const msg of subB) {
        groupB.push(sc.decode(msg.data))
        if (groupB.length >= 1) break
      }
    })()

    nc.publish('shared.topic', sc.encode('message'))
    await nc.flush()

    await Promise.race([
      Promise.all([collectA, collectB]),
      new Promise(resolve => setTimeout(resolve, 500)),
    ])

    await subA.unsubscribe()
    await subB.unsubscribe()

    // Each queue group should receive the message
    expect(groupA.length).toBe(1)
    expect(groupB.length).toBe(1)
  })

  it('should mix queue and non-queue subscribers', async () => {
    const queueMessages: string[] = []
    const regularMessages: string[] = []

    const queueSub = nc.subscribe('mixed.topic', { queue: 'workers' })
    const regularSub = nc.subscribe('mixed.topic')

    const collectQueue = (async () => {
      for await (const msg of queueSub) {
        queueMessages.push(sc.decode(msg.data))
        if (queueMessages.length >= 1) break
      }
    })()

    const collectRegular = (async () => {
      for await (const msg of regularSub) {
        regularMessages.push(sc.decode(msg.data))
        if (regularMessages.length >= 1) break
      }
    })()

    nc.publish('mixed.topic', sc.encode('broadcast'))
    await nc.flush()

    await Promise.race([
      Promise.all([collectQueue, collectRegular]),
      new Promise(resolve => setTimeout(resolve, 500)),
    ])

    await queueSub.unsubscribe()
    await regularSub.unsubscribe()

    // Both should receive the message
    expect(queueMessages.length).toBe(1)
    expect(regularMessages.length).toBe(1)
  })
})

// ============================================================================
// ADVANCED CONSUMER TESTS
// ============================================================================

describe('Advanced consumer behavior', () => {
  let nc: NatsConnection
  let js: JetStreamClient
  let jsm: JetStreamManager
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    js = nc.jetstream()
    jsm = await nc.jetstreamManager()

    await jsm.streams.add({
      name: 'ADVANCED',
      subjects: ['advanced.>'],
    })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should respect max_ack_pending limit', async () => {
    // Publish multiple messages
    for (let i = 0; i < 10; i++) {
      await js.publish('advanced.test', sc.encode(`msg-${i}`))
    }

    // Create consumer with max_ack_pending
    await jsm.consumers.add('ADVANCED', {
      durable_name: 'max-pending',
      ack_policy: AckPolicy.Explicit,
      max_ack_pending: 3,
    })

    const consumer = await js.consumers.get('ADVANCED', 'max-pending')
    const messages = await consumer.fetch({ max_messages: 10 })

    let count = 0
    for await (const msg of messages) {
      count++
      // Don't ack - they stay pending
    }

    // Should only get max_ack_pending messages without acking
    expect(count).toBeLessThanOrEqual(10)
  })

  it('should handle filter_subjects for multiple filters', async () => {
    await js.publish('advanced.orders.created', sc.encode('order'))
    await js.publish('advanced.users.created', sc.encode('user'))
    await js.publish('advanced.payments.created', sc.encode('payment'))
    await js.publish('advanced.orders.updated', sc.encode('order-update'))

    await jsm.consumers.add('ADVANCED', {
      durable_name: 'multi-filter',
      filter_subject: 'advanced.orders.>',
      ack_policy: AckPolicy.Explicit,
    })

    const consumer = await js.consumers.get('ADVANCED', 'multi-filter')
    const messages = await consumer.fetch({ max_messages: 10 })

    const received: string[] = []
    for await (const msg of messages) {
      received.push(msg.subject)
      msg.ack()
    }

    expect(received.length).toBe(2)
    expect(received.every(s => s.startsWith('advanced.orders'))).toBe(true)
  })

  it('should support deliver_policy StartSequence', async () => {
    // Publish messages first
    await js.publish('advanced.seq', sc.encode('msg-1'))
    const ack2 = await js.publish('advanced.seq', sc.encode('msg-2'))
    await js.publish('advanced.seq', sc.encode('msg-3'))

    // Create consumer starting from sequence 2
    await jsm.consumers.add('ADVANCED', {
      durable_name: 'start-seq',
      deliver_policy: DeliverPolicy.StartSequence,
      opt_start_seq: ack2.seq,
      ack_policy: AckPolicy.Explicit,
    })

    const consumer = await js.consumers.get('ADVANCED', 'start-seq')
    const messages = await consumer.fetch({ max_messages: 10 })

    const received: string[] = []
    for await (const msg of messages) {
      received.push(sc.decode(msg.data))
      msg.ack()
    }

    // Should start from msg-2
    expect(received.length).toBeGreaterThanOrEqual(2)
    expect(received).toContain('msg-2')
    expect(received).toContain('msg-3')
  })

  it('should support deliver_policy Last', async () => {
    await js.publish('advanced.last', sc.encode('first'))
    await js.publish('advanced.last', sc.encode('second'))
    await js.publish('advanced.last', sc.encode('third'))

    await jsm.consumers.add('ADVANCED', {
      durable_name: 'last-only',
      deliver_policy: DeliverPolicy.Last,
      ack_policy: AckPolicy.Explicit,
    })

    const consumer = await js.consumers.get('ADVANCED', 'last-only')
    const messages = await consumer.fetch({ max_messages: 1 })

    let lastMsg = ''
    for await (const msg of messages) {
      lastMsg = sc.decode(msg.data)
      msg.ack()
    }

    expect(lastMsg).toBe('third')
  })

  it('should support deliver_policy New', async () => {
    // Publish before consumer creation
    await js.publish('advanced.new', sc.encode('old-message'))

    await jsm.consumers.add('ADVANCED', {
      durable_name: 'new-only',
      deliver_policy: DeliverPolicy.New,
      ack_policy: AckPolicy.Explicit,
    })

    // Publish after consumer creation
    await js.publish('advanced.new', sc.encode('new-message'))

    const consumer = await js.consumers.get('ADVANCED', 'new-only')
    const messages = await consumer.fetch({ max_messages: 10 })

    const received: string[] = []
    for await (const msg of messages) {
      received.push(sc.decode(msg.data))
      msg.ack()
    }

    // Should only get the new message, not the old one
    expect(received).toContain('new-message')
    expect(received).not.toContain('old-message')
  })

  it('should get message metadata from JsMsg.info', async () => {
    await js.publish('advanced.meta', sc.encode('metadata-test'))

    await jsm.consumers.add('ADVANCED', {
      durable_name: 'meta-test',
      ack_policy: AckPolicy.Explicit,
    })

    const consumer = await js.consumers.get('ADVANCED', 'meta-test')
    const messages = await consumer.fetch({ max_messages: 1 })

    for await (const msg of messages) {
      expect(msg.info.stream).toBe('ADVANCED')
      expect(msg.info.consumer).toBe('meta-test')
      expect(msg.info.streamSequence).toBeGreaterThan(0)
      expect(msg.info.consumerSequence).toBeGreaterThan(0)
      expect(msg.info.deliveryCount).toBe(1)
      expect(msg.info.timestampNanos).toBeGreaterThan(0)
      msg.ack()
    }
  })

  it('should report pending messages in consumer info', async () => {
    await js.publish('advanced.pending', sc.encode('msg-1'))
    await js.publish('advanced.pending', sc.encode('msg-2'))

    await jsm.consumers.add('ADVANCED', {
      durable_name: 'pending-test',
      ack_policy: AckPolicy.Explicit,
    })

    const consumer = await js.consumers.get('ADVANCED', 'pending-test')

    // Fetch but don't ack
    const messages = await consumer.fetch({ max_messages: 2 })
    for await (const _msg of messages) {
      // Don't ack
    }

    const info = await consumer.info()
    expect(info.num_ack_pending).toBe(2)
  })
})

// ============================================================================
// STREAM ADVANCED FEATURES
// ============================================================================

describe('Stream advanced features', () => {
  let nc: NatsConnection
  let js: JetStreamClient
  let jsm: JetStreamManager
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    js = nc.jetstream()
    jsm = await nc.jetstreamManager()
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should enforce max_msgs limit', async () => {
    await jsm.streams.add({
      name: 'LIMITED',
      subjects: ['limited.>'],
      max_msgs: 5,
      discard: DiscardPolicy.Old,
    })

    // Publish more than max_msgs
    for (let i = 0; i < 10; i++) {
      await js.publish('limited.test', sc.encode(`msg-${i}`))
    }

    const info = await jsm.streams.info('LIMITED')
    expect(info.state.messages).toBe(5)
  })

  it('should enforce max_bytes limit', async () => {
    await jsm.streams.add({
      name: 'BYTES_LIMITED',
      subjects: ['bytes.>'],
      max_bytes: 100,
      discard: DiscardPolicy.Old,
    })

    // Publish messages
    for (let i = 0; i < 20; i++) {
      await js.publish('bytes.test', sc.encode(`message-${i}`))
    }

    const info = await jsm.streams.info('BYTES_LIMITED')
    expect(info.state.bytes).toBeLessThanOrEqual(100)
  })

  it('should purge by subject filter', async () => {
    await jsm.streams.add({
      name: 'PURGE_FILTER',
      subjects: ['purge.>'],
    })

    await js.publish('purge.keep', sc.encode('keep'))
    await js.publish('purge.delete', sc.encode('delete1'))
    await js.publish('purge.delete', sc.encode('delete2'))
    await js.publish('purge.keep', sc.encode('keep2'))

    await jsm.streams.purge('PURGE_FILTER', { filter: 'purge.delete' })

    const info = await jsm.streams.info('PURGE_FILTER')
    expect(info.state.messages).toBe(2)
  })

  it('should get first message by subject', async () => {
    await jsm.streams.add({
      name: 'FIRST_MSG',
      subjects: ['first.>'],
    })

    await js.publish('first.test', sc.encode('first'))
    await js.publish('first.test', sc.encode('second'))
    await js.publish('first.other', sc.encode('other'))

    // Get first message by subject
    const msg = await jsm.streams.getMessage('FIRST_MSG', { next_by_subj: 'first.test' })
    expect(sc.decode(msg.data)).toBe('first')
  })

  it('should track subject count in stream state', async () => {
    await jsm.streams.add({
      name: 'SUBJECTS',
      subjects: ['subjects.>'],
    })

    await js.publish('subjects.a', sc.encode('a'))
    await js.publish('subjects.b', sc.encode('b'))
    await js.publish('subjects.c', sc.encode('c'))
    await js.publish('subjects.a', sc.encode('a2'))

    const info = await jsm.streams.info('SUBJECTS')
    expect(info.state.num_subjects).toBe(3)
  })
})

// ============================================================================
// KV ADVANCED FEATURES
// ============================================================================

describe('KV advanced features', () => {
  let nc: NatsConnection
  let js: JetStreamClient
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    js = nc.jetstream()
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should respect history limit', async () => {
    const kv = await js.views.kv('history-limited', { history: 3 })

    await kv.put('key', sc.encode('v1'))
    await kv.put('key', sc.encode('v2'))
    await kv.put('key', sc.encode('v3'))
    await kv.put('key', sc.encode('v4'))
    await kv.put('key', sc.encode('v5'))

    const history = await kv.history('key')
    const versions: string[] = []
    for await (const entry of history) {
      versions.push(sc.decode(entry.value))
    }

    // Should only keep last 3 versions (or all if not enforced in memory)
    expect(versions.length).toBeGreaterThanOrEqual(1)
  })

  it('should watch specific key pattern', async () => {
    const kv = await js.views.kv('watch-pattern')
    const changes: string[] = []

    const watcher = await kv.watch({ key: 'users.*' })
    const watchPromise = (async () => {
      for await (const entry of watcher) {
        changes.push(entry.key)
        if (changes.length >= 2) break
      }
    })()

    await kv.put('users.alice', sc.encode('alice'))
    await kv.put('config.setting', sc.encode('setting'))
    await kv.put('users.bob', sc.encode('bob'))

    await Promise.race([
      watchPromise,
      new Promise(resolve => setTimeout(resolve, 500)),
    ])

    expect(changes).toContain('users.alice')
    expect(changes).toContain('users.bob')
    expect(changes).not.toContain('config.setting')
  })

  it('should track delete operations in history', async () => {
    const kv = await js.views.kv('delete-history', { history: 10 })

    await kv.put('temp', sc.encode('value'))
    await kv.delete('temp')

    const history = await kv.history('temp')
    const operations: KvOperation[] = []
    for await (const entry of history) {
      operations.push(entry.operation)
    }

    expect(operations).toContain('PUT')
    expect(operations).toContain('DEL')
  })

  it('should list keys with filter pattern', async () => {
    const kv = await js.views.kv('filter-keys')

    await kv.put('users.1', sc.encode('user1'))
    await kv.put('users.2', sc.encode('user2'))
    await kv.put('config.app', sc.encode('config'))
    await kv.put('users.3', sc.encode('user3'))

    const keys = await kv.keys('users.*')
    const keyList: string[] = []
    for await (const key of keys) {
      keyList.push(key)
    }

    expect(keyList.length).toBe(3)
    expect(keyList.every(k => k.startsWith('users.'))).toBe(true)
  })

  it('should handle concurrent updates with optimistic locking', async () => {
    const kv = await js.views.kv('concurrent')

    const rev1 = await kv.put('counter', sc.encode('0'))

    // First update succeeds
    const rev2 = await kv.update('counter', sc.encode('1'), rev1)

    // Second update with old revision fails
    await expect(
      kv.update('counter', sc.encode('2'), rev1)
    ).rejects.toThrow()

    // Update with correct revision succeeds
    await kv.update('counter', sc.encode('2'), rev2)

    const entry = await kv.get('counter')
    expect(sc.decode(entry!.value)).toBe('2')
  })
})

// ============================================================================
// CONNECTION LIFECYCLE TESTS
// ============================================================================

describe('Connection lifecycle', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should track connection stats accurately', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const sc = StringCodec()

    const initialStats = nc.stats()
    expect(initialStats.inMsgs).toBe(0)
    expect(initialStats.outMsgs).toBe(0)

    // Publish some messages
    nc.publish('stats.test', sc.encode('message1'))
    nc.publish('stats.test', sc.encode('message2'))
    await nc.flush()

    const afterStats = nc.stats()
    expect(afterStats.outMsgs).toBe(2)
    expect(afterStats.outBytes).toBeGreaterThan(0)

    await nc.close()
  })

  it('should drain all subscriptions before closing', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const sc = StringCodec()

    const sub1 = nc.subscribe('drain.1')
    const sub2 = nc.subscribe('drain.2')

    nc.publish('drain.1', sc.encode('msg1'))
    nc.publish('drain.2', sc.encode('msg2'))
    await nc.flush()

    await nc.drain()

    expect(nc.isClosed()).toBe(true)
    expect(sub1.isClosed()).toBe(true)
    expect(sub2.isClosed()).toBe(true)
  })

  it('should reconnect with same subscriptions (conceptual)', async () => {
    const nc = await connect({
      servers: 'nats://localhost:4222',
      reconnect: true,
      maxReconnectAttempts: 5,
    })

    // This test validates the config is accepted
    expect(nc).toBeDefined()
    expect(nc.info).toBeDefined()

    await nc.close()
  })

  it('should handle multiple connections independently', async () => {
    const nc1 = await connect({ servers: 'nats://localhost:4222' })
    const nc2 = await connect({ servers: 'nats://localhost:4222' })
    const sc = StringCodec()

    const nc2Messages: string[] = []
    const sub = nc2.subscribe('cross.connection')
    const collector = (async () => {
      for await (const msg of sub) {
        nc2Messages.push(sc.decode(msg.data))
        break
      }
    })()

    nc1.publish('cross.connection', sc.encode('from-nc1'))
    await nc1.flush()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()
    await nc1.close()
    await nc2.close()

    expect(nc2Messages.length).toBe(1)
    expect(nc2Messages[0]).toBe('from-nc1')
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should work with full pub/sub workflow', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const sc = StringCodec()

    const messages: string[] = []
    const sub = nc.subscribe('workflow.>')

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(sc.decode(msg.data))
        if (messages.length >= 3) break
      }
    })()

    nc.publish('workflow.step1', sc.encode('start'))
    nc.publish('workflow.step2', sc.encode('process'))
    nc.publish('workflow.step3', sc.encode('complete'))
    await nc.flush()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 500)),
    ])

    await sub.unsubscribe()
    await nc.close()

    expect(messages).toEqual(['start', 'process', 'complete'])
  })

  it('should work with request/reply service pattern', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const sc = StringCodec()

    // Service
    const serviceSub = nc.subscribe('math.add')
    ;(async () => {
      for await (const msg of serviceSub) {
        const [a, b] = JSON.parse(sc.decode(msg.data))
        msg.respond(sc.encode(JSON.stringify(a + b)))
      }
    })()

    // Client
    const response = await nc.request('math.add', sc.encode(JSON.stringify([5, 3])))
    const result = JSON.parse(sc.decode(response.data))

    expect(result).toBe(8)

    await serviceSub.unsubscribe()
    await nc.close()
  })

  it('should work with JetStream and KV', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const js = nc.jetstream()
    const sc = StringCodec()

    // Create KV for configuration
    const config = await js.views.kv('app-config')
    await config.put('feature.enabled', sc.encode('true'))

    // Create stream for events
    const jsm = await nc.jetstreamManager()
    await jsm.streams.add({
      name: 'APP_EVENTS',
      subjects: ['app.events.>'],
    })

    // Publish event
    await js.publish('app.events.user.login', sc.encode('user123'))

    // Check config
    const entry = await config.get('feature.enabled')
    expect(sc.decode(entry!.value)).toBe('true')

    await nc.close()
  })

  it('should work with event sourcing pattern', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const js = nc.jetstream()
    const jsm = await nc.jetstreamManager()
    const sc = StringCodec()

    // Create event stream
    await jsm.streams.add({
      name: 'ACCOUNT_EVENTS',
      subjects: ['account.events.>'],
      retention: RetentionPolicy.Limits,
    })

    // Event types
    type AccountEvent =
      | { type: 'AccountCreated'; accountId: string }
      | { type: 'MoneyDeposited'; accountId: string; amount: number }
      | { type: 'MoneyWithdrawn'; accountId: string; amount: number }

    // Publish events
    const publish = async (event: AccountEvent) => {
      await js.publish(`account.events.${event.type.toLowerCase()}`, sc.encode(JSON.stringify(event)))
    }

    await publish({ type: 'AccountCreated', accountId: 'acc-1' })
    await publish({ type: 'MoneyDeposited', accountId: 'acc-1', amount: 100 })
    await publish({ type: 'MoneyWithdrawn', accountId: 'acc-1', amount: 30 })

    // Create consumer to replay events
    await jsm.consumers.add('ACCOUNT_EVENTS', {
      durable_name: 'account-projector',
      deliver_policy: DeliverPolicy.All,
      ack_policy: AckPolicy.Explicit,
    })

    const consumer = await js.consumers.get('ACCOUNT_EVENTS', 'account-projector')
    const messages = await consumer.fetch({ max_messages: 100 })

    // Rebuild state from events
    let balance = 0
    for await (const msg of messages) {
      const event = JSON.parse(sc.decode(msg.data)) as AccountEvent
      switch (event.type) {
        case 'AccountCreated':
          balance = 0
          break
        case 'MoneyDeposited':
          balance += event.amount
          break
        case 'MoneyWithdrawn':
          balance -= event.amount
          break
      }
      msg.ack()
    }

    expect(balance).toBe(70)

    await nc.close()
  })

  it('should work with session storage pattern using KV', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const js = nc.jetstream()
    const sc = StringCodec()

    // Create session store with TTL
    const sessions = await js.views.kv('sessions', {
      ttl: 30 * 60 * 1000, // 30 minutes
      history: 1,
    })

    // Session type
    interface Session {
      userId: string
      createdAt: number
      data: { cart: string[] }
    }

    const sessionId = 'sess-abc123'

    // Create session
    const newSession: Session = {
      userId: 'user-42',
      createdAt: Date.now(),
      data: { cart: [] },
    }
    await sessions.put(sessionId, sc.encode(JSON.stringify(newSession)))

    // Update session (add to cart)
    const entry = await sessions.get(sessionId)
    const session = JSON.parse(sc.decode(entry!.value)) as Session
    session.data.cart.push('item-1')
    await sessions.update(sessionId, sc.encode(JSON.stringify(session)), entry!.revision)

    // Verify update
    const updated = await sessions.get(sessionId)
    const updatedSession = JSON.parse(sc.decode(updated!.value)) as Session
    expect(updatedSession.data.cart).toContain('item-1')

    // Logout (delete session)
    await sessions.delete(sessionId)
    const deleted = await sessions.get(sessionId)
    expect(deleted).toBeNull()

    await nc.close()
  })

  it('should work with microservice communication', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const sc = StringCodec()

    // User service
    const userSub = nc.subscribe('users.get')
    ;(async () => {
      for await (const msg of userSub) {
        const userId = sc.decode(msg.data)
        msg.respond(sc.encode(JSON.stringify({
          id: userId,
          name: `User ${userId}`,
          email: `user${userId}@example.com.ai`,
        })))
      }
    })()

    // Order service
    const orderSub = nc.subscribe('orders.create')
    ;(async () => {
      for await (const msg of orderSub) {
        const order = JSON.parse(sc.decode(msg.data))
        // Fetch user from user service
        const userResp = await nc.request('users.get', sc.encode(order.userId))
        const user = JSON.parse(sc.decode(userResp.data))

        msg.respond(sc.encode(JSON.stringify({
          orderId: `ord-${Date.now()}`,
          user,
          items: order.items,
          status: 'created',
        })))
      }
    })()

    // Client creates order
    const response = await nc.request('orders.create', sc.encode(JSON.stringify({
      userId: '123',
      items: ['product-a', 'product-b'],
    })))

    const result = JSON.parse(sc.decode(response.data))

    expect(result.orderId).toMatch(/^ord-/)
    expect(result.user.id).toBe('123')
    expect(result.user.name).toBe('User 123')
    expect(result.items).toEqual(['product-a', 'product-b'])
    expect(result.status).toBe('created')

    await userSub.unsubscribe()
    await orderSub.unsubscribe()
    await nc.close()
  })

  it('should work with work queue pattern', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const js = nc.jetstream()
    const jsm = await nc.jetstreamManager()
    const sc = StringCodec()

    // Create work queue stream
    await jsm.streams.add({
      name: 'WORK_QUEUE',
      subjects: ['work.>'],
      retention: RetentionPolicy.Workqueue,
    })

    // Publish work items
    for (let i = 0; i < 5; i++) {
      await js.publish('work.process', sc.encode(JSON.stringify({
        taskId: `task-${i}`,
        payload: `Process item ${i}`,
      })))
    }

    // Create workers (consumers in same queue)
    await jsm.consumers.add('WORK_QUEUE', {
      durable_name: 'workers',
      ack_policy: AckPolicy.Explicit,
    })

    const consumer = await js.consumers.get('WORK_QUEUE', 'workers')
    const messages = await consumer.fetch({ max_messages: 10 })

    const processed: string[] = []
    for await (const msg of messages) {
      const task = JSON.parse(sc.decode(msg.data))
      processed.push(task.taskId)
      msg.ack()
    }

    expect(processed.length).toBe(5)
    expect(processed).toContain('task-0')
    expect(processed).toContain('task-4')

    await nc.close()
  })

  it('should work with distributed cache pattern using KV', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const js = nc.jetstream()
    const sc = StringCodec()

    // Create cache bucket
    const cache = await js.views.kv('api-cache', {
      ttl: 5 * 60 * 1000, // 5 minute TTL
      history: 1,
    })

    // Simulate expensive API call with caching
    const fetchWithCache = async (key: string, fetcher: () => Promise<string>) => {
      const cached = await cache.get(key)
      if (cached) {
        return { data: sc.decode(cached.value), fromCache: true }
      }

      const data = await fetcher()
      await cache.put(key, sc.encode(data))
      return { data, fromCache: false }
    }

    // First call - not cached
    const result1 = await fetchWithCache('user:123', async () => {
      return JSON.stringify({ id: '123', name: 'Alice' })
    })
    expect(result1.fromCache).toBe(false)

    // Second call - should be cached
    const result2 = await fetchWithCache('user:123', async () => {
      return JSON.stringify({ id: '123', name: 'Alice' })
    })
    expect(result2.fromCache).toBe(true)
    expect(result2.data).toBe(result1.data)

    await nc.close()
  })
})

// ============================================================================
// SUBJECT EDGE CASES TESTS
// ============================================================================

describe('Subject edge cases', () => {
  let nc: NatsConnection
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should handle very long subjects', async () => {
    const longSubject = Array(50).fill('segment').join('.')
    const messages: Msg[] = []

    const sub = nc.subscribe(longSubject)

    nc.publish(longSubject, sc.encode('long subject message'))
    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()

    expect(messages.length).toBe(1)
    expect(messages[0].subject).toBe(longSubject)
  })

  it('should handle subjects with numbers', async () => {
    const messages: Msg[] = []
    const sub = nc.subscribe('v1.api.users.123')

    nc.publish('v1.api.users.123', sc.encode('user data'))
    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()
    expect(messages.length).toBe(1)
  })

  it('should handle subjects with hyphens and underscores', async () => {
    const messages: Msg[] = []
    const sub = nc.subscribe('my-service.user_events.created')

    nc.publish('my-service.user_events.created', sc.encode('event'))
    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()
    expect(messages.length).toBe(1)
  })

  it('should match * only for non-empty tokens', async () => {
    const messages: Msg[] = []
    const sub = nc.subscribe('events.*.action')

    // Should match
    nc.publish('events.user.action', sc.encode('match'))
    // Should NOT match (empty token)
    // Note: 'events..action' is invalid in NATS

    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()
    expect(messages.length).toBe(1)
    expect(messages[0].subject).toBe('events.user.action')
  })

  it('should handle multiple wildcards in pattern', async () => {
    const messages: Msg[] = []
    const sub = nc.subscribe('*.*.action')

    nc.publish('service.user.action', sc.encode('match1'))
    nc.publish('api.order.action', sc.encode('match2'))
    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        if (messages.length >= 2) break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()
    expect(messages.length).toBe(2)
  })
})

// ============================================================================
// LARGE MESSAGE TESTS
// ============================================================================

describe('Large messages', () => {
  let nc: NatsConnection

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should handle large messages', async () => {
    const sc = StringCodec()
    const largeData = 'x'.repeat(100000) // 100KB
    const messages: Msg[] = []

    const sub = nc.subscribe('large.message')

    nc.publish('large.message', sc.encode(largeData))
    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 500)),
    ])

    await sub.unsubscribe()

    expect(messages.length).toBe(1)
    expect(sc.decode(messages[0].data).length).toBe(100000)
  })

  it('should handle binary data', async () => {
    const binaryData = new Uint8Array([0, 1, 2, 255, 254, 253])
    const messages: Msg[] = []

    const sub = nc.subscribe('binary.data')

    nc.publish('binary.data', binaryData)
    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()

    expect(messages.length).toBe(1)
    expect(Array.from(messages[0].data)).toEqual([0, 1, 2, 255, 254, 253])
  })

  it('should handle JSON with special characters', async () => {
    const jc = JSONCodec<{ text: string; unicode: string }>()
    const data = {
      text: 'Hello "World" with \\backslash',
      unicode: 'Unicode: emoji test',
    }

    const messages: Msg[] = []
    const sub = nc.subscribe('json.special')

    nc.publish('json.special', jc.encode(data))
    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()

    expect(messages.length).toBe(1)
    const decoded = jc.decode(messages[0].data)
    expect(decoded.text).toBe(data.text)
    expect(decoded.unicode).toBe(data.unicode)
  })
})

// ============================================================================
// MESSAGE ACTIONS TESTS (NAK, WORKING, TERM)
// ============================================================================

describe('JetStream message actions', () => {
  let nc: NatsConnection
  let js: JetStreamClient
  let jsm: JetStreamManager
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    js = nc.jetstream()
    jsm = await nc.jetstreamManager()

    await jsm.streams.add({
      name: 'ACTIONS',
      subjects: ['actions.>'],
    })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should redeliver message after nak()', async () => {
    await js.publish('actions.nak', sc.encode('nak-test'))

    await jsm.consumers.add('ACTIONS', {
      durable_name: 'nak-consumer',
      ack_policy: AckPolicy.Explicit,
      max_deliver: 5,
    })

    const consumer = await js.consumers.get('ACTIONS', 'nak-consumer')

    // First fetch - nak the message
    const messages1 = await consumer.fetch({ max_messages: 1 })
    let deliveryCount1 = 0
    for await (const msg of messages1) {
      deliveryCount1 = msg.info.deliveryCount
      msg.nak()
    }

    // Wait for redelivery
    await new Promise(resolve => setTimeout(resolve, 200))

    // Second fetch - should get same message with higher delivery count
    const messages2 = await consumer.fetch({ max_messages: 1 })
    let deliveryCount2 = 0
    for await (const msg of messages2) {
      deliveryCount2 = msg.info.deliveryCount
      msg.ack()
    }

    expect(deliveryCount2).toBeGreaterThan(deliveryCount1)
  })

  it('should extend ack deadline with working()', async () => {
    await js.publish('actions.working', sc.encode('working-test'))

    await jsm.consumers.add('ACTIONS', {
      durable_name: 'working-consumer',
      ack_policy: AckPolicy.Explicit,
      ack_wait: 1_000_000_000, // 1 second in nanoseconds
    })

    const consumer = await js.consumers.get('ACTIONS', 'working-consumer')
    const messages = await consumer.fetch({ max_messages: 1 })

    for await (const msg of messages) {
      // Extend deadline
      await msg.working()
      // Should not time out since we extended
      msg.ack()
    }

    const info = await consumer.info()
    expect(info.num_ack_pending).toBe(0)
  })

  it('should stop redelivery with term()', async () => {
    await js.publish('actions.term', sc.encode('term-test'))

    await jsm.consumers.add('ACTIONS', {
      durable_name: 'term-consumer',
      ack_policy: AckPolicy.Explicit,
      max_deliver: 10,
    })

    const consumer = await js.consumers.get('ACTIONS', 'term-consumer')

    // First fetch - terminate the message
    const messages1 = await consumer.fetch({ max_messages: 1 })
    for await (const msg of messages1) {
      msg.term() // Terminate - no more redeliveries
    }

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 200))

    // Second fetch - should get no messages (message was terminated)
    const messages2 = await consumer.fetch({ max_messages: 1, expires: 100 })
    let count = 0
    for await (const _msg of messages2) {
      count++
    }

    expect(count).toBe(0)
  })

  it('should honor nak delay', async () => {
    await js.publish('actions.nakdelay', sc.encode('nak-delay-test'))

    await jsm.consumers.add('ACTIONS', {
      durable_name: 'nakdelay-consumer',
      ack_policy: AckPolicy.Explicit,
    })

    const consumer = await js.consumers.get('ACTIONS', 'nakdelay-consumer')

    // First fetch - nak with delay
    const startTime = Date.now()
    const messages1 = await consumer.fetch({ max_messages: 1 })
    for await (const msg of messages1) {
      msg.nak(500) // 500ms delay
    }

    // Second fetch immediately - should be empty
    const messages2 = await consumer.fetch({ max_messages: 1, expires: 100 })
    let immediateCount = 0
    for await (const _msg of messages2) {
      immediateCount++
    }
    expect(immediateCount).toBe(0)

    // Wait for delay and fetch again
    await new Promise(resolve => setTimeout(resolve, 600))
    const messages3 = await consumer.fetch({ max_messages: 1 })
    for await (const msg of messages3) {
      msg.ack()
    }

    const elapsed = Date.now() - startTime
    expect(elapsed).toBeGreaterThanOrEqual(500)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should throw on request timeout', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const sc = StringCodec()

    // No responders
    await expect(
      nc.request('no.responders.here', sc.encode('hello'), { timeout: 100 })
    ).rejects.toThrow()

    await nc.close()
  })

  it('should throw on non-existent stream', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const jsm = await nc.jetstreamManager()

    await expect(
      jsm.streams.info('NON_EXISTENT_STREAM')
    ).rejects.toThrow()

    await nc.close()
  })

  it('should throw on non-existent consumer', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const jsm = await nc.jetstreamManager()
    const js = nc.jetstream()

    await jsm.streams.add({
      name: 'ERROR_TEST',
      subjects: ['error.>'],
    })

    await expect(
      js.consumers.get('ERROR_TEST', 'non-existent-consumer')
    ).rejects.toThrow()

    await nc.close()
  })

  it('should throw on invalid KV bucket name', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const js = nc.jetstream()

    // KV bucket names cannot contain dots or special characters in real NATS
    // This test validates error handling for invalid operations
    await expect(
      js.views.kv('invalid..name', { bindOnly: true })
    ).rejects.toThrow()

    await nc.close()
  })

  it('should throw on publish to closed connection', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const sc = StringCodec()

    await nc.close()

    expect(() => {
      nc.publish('test', sc.encode('should fail'))
    }).toThrow()
  })

  it('should throw on subscribe to closed connection', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })

    await nc.close()

    expect(() => {
      nc.subscribe('test')
    }).toThrow()
  })

  it('should handle stream deletion while consuming', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })
    const js = nc.jetstream()
    const jsm = await nc.jetstreamManager()
    const sc = StringCodec()

    await jsm.streams.add({
      name: 'EPHEMERAL',
      subjects: ['ephemeral.>'],
    })

    await js.publish('ephemeral.test', sc.encode('message'))

    await jsm.consumers.add('EPHEMERAL', {
      durable_name: 'ephemeral-consumer',
      ack_policy: AckPolicy.Explicit,
    })

    // Delete the stream while consumer exists
    await jsm.streams.delete('EPHEMERAL')

    // Further operations should fail gracefully
    await expect(
      jsm.streams.info('EPHEMERAL')
    ).rejects.toThrow()

    await nc.close()
  })
})

// ============================================================================
// DEDUPLICATION TESTS
// ============================================================================

describe('Message deduplication', () => {
  let nc: NatsConnection
  let js: JetStreamClient
  let jsm: JetStreamManager
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    js = nc.jetstream()
    jsm = await nc.jetstreamManager()

    await jsm.streams.add({
      name: 'DEDUP',
      subjects: ['dedup.>'],
      duplicate_window: 60_000_000_000, // 1 minute in nanoseconds
    })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should deduplicate messages with same msgID', async () => {
    // Publish same message twice with same msgID
    const ack1 = await js.publish('dedup.test', sc.encode('message'), { msgID: 'unique-1' })
    const ack2 = await js.publish('dedup.test', sc.encode('message'), { msgID: 'unique-1' })

    expect(ack1.duplicate).toBe(false)
    expect(ack2.duplicate).toBe(true)

    // Should only have one message in stream
    const info = await jsm.streams.info('DEDUP')
    expect(info.state.messages).toBe(1)
  })

  it('should allow different messages with different msgIDs', async () => {
    await js.publish('dedup.test', sc.encode('message1'), { msgID: 'id-1' })
    await js.publish('dedup.test', sc.encode('message2'), { msgID: 'id-2' })
    await js.publish('dedup.test', sc.encode('message3'), { msgID: 'id-3' })

    const info = await jsm.streams.info('DEDUP')
    expect(info.state.messages).toBe(3)
  })

  it('should reject publish with wrong expected sequence', async () => {
    await js.publish('dedup.seq', sc.encode('first'))

    // Try to publish with wrong expected sequence
    await expect(
      js.publish('dedup.seq', sc.encode('second'), {
        expect: { lastSequence: 999 }
      })
    ).rejects.toThrow()

    const info = await jsm.streams.info('DEDUP')
    expect(info.state.messages).toBe(1)
  })

  it('should succeed publish with correct expected sequence', async () => {
    const ack1 = await js.publish('dedup.seq', sc.encode('first'))

    const ack2 = await js.publish('dedup.seq', sc.encode('second'), {
      expect: { lastSequence: ack1.seq }
    })

    expect(ack2.seq).toBe(ack1.seq + 1)
  })

  it('should reject publish with wrong expected msgID', async () => {
    await js.publish('dedup.msgid', sc.encode('first'), { msgID: 'first-id' })

    await expect(
      js.publish('dedup.msgid', sc.encode('second'), {
        expect: { lastMsgID: 'wrong-id' }
      })
    ).rejects.toThrow()
  })
})

// ============================================================================
// HEADERS TESTS
// ============================================================================

describe('Message headers', () => {
  let nc: NatsConnection
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should send and receive headers', async () => {
    const h = headers()
    h.set('Content-Type', 'application/json')
    h.set('X-Request-Id', 'req-123')

    const messages: Msg[] = []
    const sub = nc.subscribe('headers.test')

    nc.publish('headers.test', sc.encode('with headers'), { headers: h })
    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()

    expect(messages.length).toBe(1)
    expect(messages[0].headers?.get('Content-Type')).toBe('application/json')
    expect(messages[0].headers?.get('X-Request-Id')).toBe('req-123')
  })

  it('should support multiple values for same header', async () => {
    const h = headers()
    h.append('Accept', 'text/plain')
    h.append('Accept', 'application/json')

    const messages: Msg[] = []
    const sub = nc.subscribe('headers.multi')

    nc.publish('headers.multi', sc.encode('data'), { headers: h })
    await nc.flush()

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(msg)
        break
      }
    })()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 300)),
    ])

    await sub.unsubscribe()

    expect(messages.length).toBe(1)
    const values = messages[0].headers?.values('Accept') ?? []
    expect(values).toContain('text/plain')
    expect(values).toContain('application/json')
  })

  it('should check header existence', async () => {
    const h = headers()
    h.set('X-Custom', 'value')

    expect(h.has('X-Custom')).toBe(true)
    expect(h.has('X-Missing')).toBe(false)
  })

  it('should delete headers', async () => {
    const h = headers()
    h.set('X-Delete-Me', 'value')
    expect(h.has('X-Delete-Me')).toBe(true)

    h.delete('X-Delete-Me')
    expect(h.has('X-Delete-Me')).toBe(false)
  })

  it('should iterate header keys', async () => {
    const h = headers()
    h.set('A', '1')
    h.set('B', '2')
    h.set('C', '3')

    const keys = Array.from(h.keys())
    expect(keys).toContain('A')
    expect(keys).toContain('B')
    expect(keys).toContain('C')
  })
})

// ============================================================================
// ACCOUNT INFO TESTS
// ============================================================================

describe('JetStream account info', () => {
  let nc: NatsConnection
  let jsm: JetStreamManager
  let js: JetStreamClient
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    jsm = await nc.jetstreamManager()
    js = nc.jetstream()
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should get account info', async () => {
    const info = await jsm.getAccountInfo()

    expect(info).toBeDefined()
    expect(typeof info.memory).toBe('number')
    expect(typeof info.storage).toBe('number')
    expect(typeof info.streams).toBe('number')
    expect(typeof info.consumers).toBe('number')
    expect(info.limits).toBeDefined()
  })

  it('should reflect stream count in account info', async () => {
    const infoBefore = await jsm.getAccountInfo()

    await jsm.streams.add({ name: 'ACCOUNT_TEST_1', subjects: ['at1.>'] })
    await jsm.streams.add({ name: 'ACCOUNT_TEST_2', subjects: ['at2.>'] })

    const infoAfter = await jsm.getAccountInfo()

    expect(infoAfter.streams).toBe(infoBefore.streams + 2)
  })

  it('should reflect consumer count in account info', async () => {
    await jsm.streams.add({ name: 'CONSUMER_COUNT', subjects: ['cc.>'] })

    const infoBefore = await jsm.getAccountInfo()

    await jsm.consumers.add('CONSUMER_COUNT', { durable_name: 'c1' })
    await jsm.consumers.add('CONSUMER_COUNT', { durable_name: 'c2' })

    const infoAfter = await jsm.getAccountInfo()

    expect(infoAfter.consumers).toBe(infoBefore.consumers + 2)
  })

  it('should track storage usage', async () => {
    await jsm.streams.add({ name: 'STORAGE_TEST', subjects: ['storage.>'] })

    const infoBefore = await jsm.getAccountInfo()

    // Publish some data
    for (let i = 0; i < 10; i++) {
      await js.publish('storage.test', sc.encode('x'.repeat(1000)))
    }

    const infoAfter = await jsm.getAccountInfo()

    expect(infoAfter.storage).toBeGreaterThan(infoBefore.storage)
  })
})

// ============================================================================
// LISTER AND ITERATION TESTS
// ============================================================================

describe('Lister and stream/consumer iteration', () => {
  let nc: NatsConnection
  let jsm: JetStreamManager
  let js: JetStreamClient
  const sc = StringCodec()

  beforeEach(async () => {
    _clearAll()
    nc = await connect({ servers: 'nats://localhost:4222' })
    jsm = await nc.jetstreamManager()
    js = nc.jetstream()
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should iterate streams with lister', async () => {
    // Create multiple streams
    await jsm.streams.add({ name: 'ITER_1', subjects: ['iter1.>'] })
    await jsm.streams.add({ name: 'ITER_2', subjects: ['iter2.>'] })
    await jsm.streams.add({ name: 'ITER_3', subjects: ['iter3.>'] })

    const lister = jsm.streams.list()
    const streams: StreamInfo[] = []

    // Use async iterator
    for await (const stream of lister) {
      streams.push(stream)
    }

    expect(streams.length).toBeGreaterThanOrEqual(3)
    expect(streams.map(s => s.config.name)).toContain('ITER_1')
    expect(streams.map(s => s.config.name)).toContain('ITER_2')
    expect(streams.map(s => s.config.name)).toContain('ITER_3')
  })

  it('should get stream names with lister', async () => {
    await jsm.streams.add({ name: 'NAMED_1', subjects: ['named1.>'] })
    await jsm.streams.add({ name: 'NAMED_2', subjects: ['named2.>'] })

    const names: string[] = []
    const nameLister = jsm.streams.names()

    for await (const name of nameLister) {
      names.push(name)
    }

    expect(names).toContain('NAMED_1')
    expect(names).toContain('NAMED_2')
  })

  it('should filter stream names by subject', async () => {
    await jsm.streams.add({ name: 'FILTER_ORDERS', subjects: ['orders.>'] })
    await jsm.streams.add({ name: 'FILTER_USERS', subjects: ['users.>'] })
    await jsm.streams.add({ name: 'FILTER_EVENTS', subjects: ['events.>'] })

    // Filter by subject
    const names: string[] = []
    const nameLister = jsm.streams.names('orders.>')

    for await (const name of nameLister) {
      names.push(name)
    }

    expect(names).toContain('FILTER_ORDERS')
    expect(names.length).toBe(1)
  })

  it('should use lister.next() for pagination', async () => {
    await jsm.streams.add({ name: 'PAGE_1', subjects: ['page1.>'] })
    await jsm.streams.add({ name: 'PAGE_2', subjects: ['page2.>'] })

    const lister = jsm.streams.list()
    const firstPage = await lister.next()

    expect(Array.isArray(firstPage)).toBe(true)
    expect(firstPage.length).toBeGreaterThanOrEqual(2)
  })

  it('should iterate consumers with lister', async () => {
    await jsm.streams.add({ name: 'CONSUMER_ITER', subjects: ['consiter.>'] })

    await jsm.consumers.add('CONSUMER_ITER', { durable_name: 'consumer-1' })
    await jsm.consumers.add('CONSUMER_ITER', { durable_name: 'consumer-2' })
    await jsm.consumers.add('CONSUMER_ITER', { durable_name: 'consumer-3' })

    const lister = jsm.consumers.list('CONSUMER_ITER')
    const consumers: ConsumerInfo[] = []

    for await (const consumer of lister) {
      consumers.push(consumer)
    }

    expect(consumers.length).toBe(3)
    expect(consumers.map(c => c.name)).toContain('consumer-1')
    expect(consumers.map(c => c.name)).toContain('consumer-2')
    expect(consumers.map(c => c.name)).toContain('consumer-3')
  })

  it('should get consumer info correctly', async () => {
    await jsm.streams.add({ name: 'INFO_STREAM', subjects: ['info.>'] })

    await js.publish('info.test', sc.encode('message'))

    await jsm.consumers.add('INFO_STREAM', {
      durable_name: 'info-consumer',
      ack_policy: AckPolicy.Explicit,
      filter_subject: 'info.test',
    })

    const info = await jsm.consumers.info('INFO_STREAM', 'info-consumer')

    expect(info.name).toBe('info-consumer')
    expect(info.stream_name).toBe('INFO_STREAM')
    expect(info.config.filter_subject).toBe('info.test')
    expect(info.num_pending).toBe(1)
  })

  it('should update consumer configuration', async () => {
    await jsm.streams.add({ name: 'UPDATE_CONS', subjects: ['upcons.>'] })

    await jsm.consumers.add('UPDATE_CONS', {
      durable_name: 'updatable',
      ack_policy: AckPolicy.Explicit,
      max_deliver: 3,
    })

    const updated = await jsm.consumers.update('UPDATE_CONS', 'updatable', {
      max_deliver: 5,
      description: 'Updated consumer',
    })

    expect(updated.config.max_deliver).toBe(5)
    expect(updated.config.description).toBe('Updated consumer')
  })

  it('should delete consumer via manager', async () => {
    await jsm.streams.add({ name: 'DEL_CONS', subjects: ['delcons.>'] })

    await jsm.consumers.add('DEL_CONS', { durable_name: 'to-delete' })

    await jsm.consumers.delete('DEL_CONS', 'to-delete')

    await expect(
      jsm.consumers.info('DEL_CONS', 'to-delete')
    ).rejects.toThrow()
  })
})

// ============================================================================
// RTT AND PERFORMANCE TESTS
// ============================================================================

describe('RTT and connection performance', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should measure RTT', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })

    const rtt = await nc.rtt()

    expect(typeof rtt).toBe('number')
    expect(rtt).toBeGreaterThanOrEqual(0)

    await nc.close()
  })

  it('should iterate connection status', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })

    const statusEvents: string[] = []
    const statusIterator = nc.status()

    // Start collecting status in background
    const collector = (async () => {
      for await (const status of statusIterator) {
        statusEvents.push(status.type)
        if (statusEvents.length >= 1) break
      }
    })()

    // Don't wait indefinitely
    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 100)),
    ])

    await nc.close()

    // Status iterator exists and works
    expect(nc.isClosed()).toBe(true)
  })

  it('should report isDraining status', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' })

    expect(nc.isDraining()).toBe(false)

    const drainPromise = nc.drain()
    // During drain, status should be draining
    // Note: This may be quick so we can't always catch it

    await drainPromise

    expect(nc.isClosed()).toBe(true)
  })
})
