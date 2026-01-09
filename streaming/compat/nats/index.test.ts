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
})
