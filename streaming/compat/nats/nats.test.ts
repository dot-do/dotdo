/**
 * @dotdo/nats - NATS SDK compat tests (RED - Cloudflare DO Backend)
 *
 * FAILING tests for nats.js-compatible API backed by Cloudflare Durable Objects.
 * These tests validate the production NATS SDK that routes to Durable Objects
 * instead of in-memory storage.
 *
 * Import from non-existent module so tests fail until implementation exists.
 *
 * @see https://github.com/nats-io/nats.js
 * @see https://docs.nats.io/
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import from non-existent Cloudflare DO backend - WILL FAIL
import {
  connect,
  NatsDO,
  createNatsDO,
  StringCodec,
  JSONCodec,
  Empty,
  headers,
  // JetStream exports
  JetStreamDO,
  JetStreamClientDO,
  JetStreamManagerDO,
  // KV exports
  KvDO,
  KvBucketDO,
  // Error types
  NatsError,
  ErrorCode,
  // Policies
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  RetentionPolicy,
  StorageType,
  DiscardPolicy,
  // DO-specific exports
  NatsConnectionDO,
  StreamDO,
  ConsumerDO,
  SubscriptionDO,
} from './nats-do'

import type {
  ConnectionOptions,
  NatsConnection,
  Msg,
  MsgHdrs,
  Subscription,
  SubscriptionOptions,
  PublishOptions,
  RequestOptions,
  ServerInfo,
  Stats,
  Status,
  JetStreamClient,
  JetStreamManager,
  JetStreamOptions,
  JetStreamPublishOptions,
  PubAck,
  StreamConfig,
  StreamInfo,
  StreamState,
  StreamAPI,
  ConsumerAPI,
  ConsumerConfig,
  ConsumerInfo,
  Consumer,
  Consumers,
  ConsumerMessages,
  JsMsg,
  JsMsgInfo,
  FetchOptions,
  ConsumeOptions,
  Views,
  KV,
  KvEntry,
  KvOptions,
  KvStatus,
  KvOperation,
  Lister,
  PurgeOpts,
  PurgeResponse,
  MsgRequest,
  StoredMsg,
  AccountInfo,
  // DO-specific types
  DOBinding,
  NatsDOConfig,
  NatsEnv,
} from './nats-do'

// ============================================================================
// NATS DO CLIENT TESTS
// ============================================================================

describe('NatsDO client', () => {
  it('should create client with Cloudflare DO binding', () => {
    const nc = new NatsDO({
      // Cloudflare Durable Object binding
      natsdo: {} as DOBinding,
    })
    expect(nc).toBeDefined()
  })

  it('should create client with createNatsDO()', () => {
    const nc = createNatsDO({
      natsdo: {} as DOBinding,
    })
    expect(nc).toBeDefined()
  })

  it('should create client with env bindings', () => {
    const env: NatsEnv = {
      NATS_DO: {} as DOBinding,
      JETSTREAM_DO: {} as DOBinding,
      KV_DO: {} as DOBinding,
    }
    const nc = new NatsDO({ env })
    expect(nc).toBeDefined()
  })

  it('should create connection from client', async () => {
    const nc = await connect({
      servers: 'nats://localhost:4222',
      natsdo: {} as DOBinding,
    })
    expect(nc).toBeDefined()
    expect(nc).toBeInstanceOf(NatsConnectionDO)
  })

  it('should provide server info', async () => {
    const nc = await connect({
      servers: 'nats://localhost:4222',
      natsdo: {} as DOBinding,
    })
    expect(nc.info).toBeDefined()
    expect(nc.info?.server_id).toBeDefined()
    expect(nc.info?.jetstream).toBe(true)
    await nc.close()
  })

  it('should get connection stats', async () => {
    const nc = await connect({ natsdo: {} as DOBinding })
    const stats = nc.stats()
    expect(stats.inBytes).toBeDefined()
    expect(stats.outBytes).toBeDefined()
    expect(stats.inMsgs).toBeDefined()
    expect(stats.outMsgs).toBeDefined()
    await nc.close()
  })
})

// ============================================================================
// BASIC PUB/SUB TESTS (DO Backend)
// ============================================================================

describe('Pub/Sub with DO backend', () => {
  let nc: NatsConnection

  beforeEach(async () => {
    nc = await connect({ natsdo: {} as DOBinding })
  })

  afterEach(async () => {
    await nc.close()
  })

  describe('publish', () => {
    it('should publish message to DO', () => {
      const sc = StringCodec()
      nc.publish('updates', sc.encode('Hello NATS'))
      // Should persist to Durable Object
    })

    it('should publish with headers', () => {
      const sc = StringCodec()
      const h = headers()
      h.set('X-Trace-Id', 'abc-123')
      nc.publish('updates', sc.encode('traced message'), { headers: h })
    })

    it('should publish empty message', () => {
      nc.publish('ping', Empty)
    })

    it('should validate subject format', () => {
      expect(() => nc.publish('', Empty)).toThrow(NatsError)
      expect(() => nc.publish('invalid..subject', Empty)).toThrow(NatsError)
      expect(() => nc.publish('.invalid', Empty)).toThrow(NatsError)
    })
  })

  describe('subscribe', () => {
    it('should subscribe to subject', async () => {
      const sub = nc.subscribe('updates')
      expect(sub).toBeDefined()
      expect(sub.getSubject()).toBe('updates')
      await sub.unsubscribe()
    })

    it('should receive published messages', async () => {
      const sc = StringCodec()
      const messages: Msg[] = []

      const sub = nc.subscribe('updates')

      nc.publish('updates', sc.encode('Message 1'))
      nc.publish('updates', sc.encode('Message 2'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 2) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 1000)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(2)
      expect(sc.decode(messages[0].data)).toBe('Message 1')
      expect(sc.decode(messages[1].data)).toBe('Message 2')
    })

    it('should receive messages from DO storage', async () => {
      const sc = StringCodec()

      // Publish message
      nc.publish('durable.test', sc.encode('persisted'))
      await nc.flush()

      // Subscribe after publish - should get message from DO storage
      const sub = nc.subscribe('durable.test', { fromBeginning: true })

      let received: Msg | undefined
      for await (const msg of sub) {
        received = msg
        break
      }

      expect(received).toBeDefined()
      expect(sc.decode(received!.data)).toBe('persisted')

      await sub.unsubscribe()
    })

    it('should support queue groups', async () => {
      const sc = StringCodec()
      const group1Messages: Msg[] = []
      const group2Messages: Msg[] = []

      // Two subscribers in same queue group
      const sub1 = nc.subscribe('work', { queue: 'workers' })
      const sub2 = nc.subscribe('work', { queue: 'workers' })

      const collect1 = (async () => {
        for await (const msg of sub1) {
          group1Messages.push(msg)
        }
      })()

      const collect2 = (async () => {
        for await (const msg of sub2) {
          group2Messages.push(msg)
        }
      })()

      // Publish multiple messages
      for (let i = 0; i < 10; i++) {
        nc.publish('work', sc.encode(`task-${i}`))
      }
      await nc.flush()

      await new Promise(resolve => setTimeout(resolve, 500))

      await sub1.unsubscribe()
      await sub2.unsubscribe()

      // Messages should be distributed between subscribers
      expect(group1Messages.length + group2Messages.length).toBe(10)
      expect(group1Messages.length).toBeGreaterThan(0)
      expect(group2Messages.length).toBeGreaterThan(0)
    })

    it('should unsubscribe after max messages', async () => {
      const sub = nc.subscribe('limited', { max: 3 })

      for (let i = 0; i < 10; i++) {
        nc.publish('limited', Empty)
      }
      await nc.flush()

      const messages: Msg[] = []
      for await (const msg of sub) {
        messages.push(msg)
      }

      expect(messages.length).toBe(3)
      expect(sub.isClosed()).toBe(true)
    })

    it('should drain subscription gracefully', async () => {
      const sc = StringCodec()
      const sub = nc.subscribe('drain.test')

      nc.publish('drain.test', sc.encode('before drain'))
      await nc.flush()

      await sub.drain()

      expect(sub.isClosed()).toBe(true)
    })
  })
})

// ============================================================================
// SUBJECT WILDCARDS TESTS (DO Backend)
// ============================================================================

describe('Subject wildcards with DO backend', () => {
  let nc: NatsConnection
  const sc = StringCodec()

  beforeEach(async () => {
    nc = await connect({ natsdo: {} as DOBinding })
  })

  afterEach(async () => {
    await nc.close()
  })

  describe('Single token wildcard (*)', () => {
    it('should match single token', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('orders.*')

      nc.publish('orders.new', sc.encode('new order'))
      nc.publish('orders.complete', sc.encode('completed order'))
      nc.publish('orders.cancel', sc.encode('cancelled order'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 3) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 1000)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(3)
      expect(messages.map(m => m.subject)).toContain('orders.new')
      expect(messages.map(m => m.subject)).toContain('orders.complete')
      expect(messages.map(m => m.subject)).toContain('orders.cancel')
    })

    it('should not match multiple tokens', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('events.*')

      nc.publish('events.user.created', sc.encode('should not match'))
      nc.publish('events.user', sc.encode('should match'))
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
      expect(messages[0].subject).toBe('events.user')
    })

    it('should match wildcard in middle of subject', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('events.*.created')

      nc.publish('events.user.created', sc.encode('user'))
      nc.publish('events.order.created', sc.encode('order'))
      nc.publish('events.user.deleted', sc.encode('should not match'))
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
    it('should match one or more tokens', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('logs.>')

      nc.publish('logs.info', sc.encode('1'))
      nc.publish('logs.error', sc.encode('2'))
      nc.publish('logs.app.service.request', sc.encode('3'))
      nc.publish('logs.app.service.response.success', sc.encode('4'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 4) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 1000)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(4)
    })

    it('should not match zero tokens (> requires at least one)', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('updates.>')

      nc.publish('updates', sc.encode('no match'))
      nc.publish('updates.system', sc.encode('match'))
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
      expect(messages[0].subject).toBe('updates.system')
    })

    it('should match everything with just >', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('>')

      nc.publish('any.subject.here', sc.encode('1'))
      nc.publish('completely.different', sc.encode('2'))
      nc.publish('single', sc.encode('3'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 3) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 1000)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(3)
    })
  })

  describe('Combined wildcards', () => {
    it('should support * and > in same pattern', async () => {
      const messages: Msg[] = []
      const sub = nc.subscribe('events.*.>')

      nc.publish('events.user.created', sc.encode('1'))
      nc.publish('events.order.item.added', sc.encode('2'))
      nc.publish('events.payment.processed.success', sc.encode('3'))
      await nc.flush()

      const collector = (async () => {
        for await (const msg of sub) {
          messages.push(msg)
          if (messages.length >= 3) break
        }
      })()

      await Promise.race([
        collector,
        new Promise(resolve => setTimeout(resolve, 1000)),
      ])

      await sub.unsubscribe()

      expect(messages.length).toBe(3)
    })
  })
})

// ============================================================================
// REQUEST/REPLY TESTS (DO Backend)
// ============================================================================

describe('Request/Reply with DO backend', () => {
  let nc: NatsConnection
  const sc = StringCodec()

  beforeEach(async () => {
    nc = await connect({ natsdo: {} as DOBinding })
  })

  afterEach(async () => {
    await nc.close()
  })

  it('should send request and receive reply', async () => {
    // Set up responder service
    const serviceSub = nc.subscribe('math.add')
    ;(async () => {
      for await (const msg of serviceSub) {
        const [a, b] = JSON.parse(sc.decode(msg.data))
        msg.respond(sc.encode(JSON.stringify(a + b)))
      }
    })()

    // Send request
    const response = await nc.request('math.add', sc.encode(JSON.stringify([5, 3])))
    const result = JSON.parse(sc.decode(response.data))

    expect(result).toBe(8)

    await serviceSub.unsubscribe()
  })

  it('should timeout if no reply received', async () => {
    await expect(
      nc.request('no.responder', sc.encode('help'), { timeout: 100 })
    ).rejects.toThrow(NatsError)
  })

  it('should provide unique inbox for each request', async () => {
    const inboxes: string[] = []

    const sub = nc.subscribe('track.inbox')
    ;(async () => {
      for await (const msg of sub) {
        if (msg.reply) {
          inboxes.push(msg.reply)
        }
        msg.respond(sc.encode('ok'))
      }
    })()

    await Promise.all([
      nc.request('track.inbox', Empty),
      nc.request('track.inbox', Empty),
      nc.request('track.inbox', Empty),
    ])

    await sub.unsubscribe()

    // Each request should have unique inbox
    const uniqueInboxes = new Set(inboxes)
    expect(uniqueInboxes.size).toBe(3)
  })

  it('should preserve headers in request/reply', async () => {
    let receivedHeaders: MsgHdrs | undefined

    const sub = nc.subscribe('header.service')
    ;(async () => {
      for await (const msg of sub) {
        receivedHeaders = msg.headers
        const responseHeaders = headers()
        responseHeaders.set('X-Response-Id', 'resp-456')
        msg.respond(sc.encode('ok'), { headers: responseHeaders })
      }
    })()

    const h = headers()
    h.set('X-Request-Id', 'req-123')
    h.set('X-Correlation-Id', 'corr-789')

    const response = await nc.request('header.service', sc.encode('test'), { headers: h })

    await sub.unsubscribe()

    expect(receivedHeaders?.get('X-Request-Id')).toBe('req-123')
    expect(receivedHeaders?.get('X-Correlation-Id')).toBe('corr-789')
    expect(response.headers?.get('X-Response-Id')).toBe('resp-456')
  })

  it('should handle concurrent requests', async () => {
    const sub = nc.subscribe('echo')
    ;(async () => {
      for await (const msg of sub) {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50))
        msg.respond(msg.data)
      }
    })()

    const results = await Promise.all([
      nc.request('echo', sc.encode('one')),
      nc.request('echo', sc.encode('two')),
      nc.request('echo', sc.encode('three')),
      nc.request('echo', sc.encode('four')),
      nc.request('echo', sc.encode('five')),
    ])

    await sub.unsubscribe()

    expect(results.map(r => sc.decode(r.data))).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ])
  })

  it('should use message.respond() method', async () => {
    const sub = nc.subscribe('respond.test')
    ;(async () => {
      for await (const msg of sub) {
        const success = msg.respond(sc.encode('response using respond()'))
        expect(success).toBe(true)
      }
    })()

    const response = await nc.request('respond.test', Empty)
    expect(sc.decode(response.data)).toBe('response using respond()')

    await sub.unsubscribe()
  })

  it('should return false from respond() when no reply subject', async () => {
    const sub = nc.subscribe('no.reply')

    nc.publish('no.reply', Empty) // No reply subject

    for await (const msg of sub) {
      const success = msg.respond(sc.encode('no one listening'))
      expect(success).toBe(false)
      break
    }

    await sub.unsubscribe()
  })
})

// ============================================================================
// JETSTREAM PUBLISH/CONSUME TESTS (DO Backend)
// ============================================================================

describe('JetStream with DO backend', () => {
  let nc: NatsConnection
  let js: JetStreamClient
  let jsm: JetStreamManager
  const sc = StringCodec()

  beforeEach(async () => {
    nc = await connect({ natsdo: {} as DOBinding })
    js = nc.jetstream()
    jsm = await nc.jetstreamManager()

    // Create test stream
    await jsm.streams.add({
      name: 'ORDERS',
      subjects: ['orders.>'],
      retention: RetentionPolicy.Limits,
      storage: StorageType.Memory,
    })
  })

  afterEach(async () => {
    await nc.close()
  })

  describe('JetStream publish', () => {
    it('should publish to JetStream stream', async () => {
      const ack = await js.publish('orders.new', sc.encode('order-123'))

      expect(ack).toBeDefined()
      expect(ack.stream).toBe('ORDERS')
      expect(ack.seq).toBeGreaterThan(0)
      expect(ack.duplicate).toBe(false)
    })

    it('should publish with message ID for deduplication', async () => {
      const ack1 = await js.publish('orders.new', sc.encode('order-1'), {
        msgID: 'unique-order-1',
      })
      expect(ack1.duplicate).toBe(false)

      // Same message ID should be deduplicated
      const ack2 = await js.publish('orders.new', sc.encode('order-1'), {
        msgID: 'unique-order-1',
      })
      expect(ack2.duplicate).toBe(true)
    })

    it('should publish with headers', async () => {
      const h = headers()
      h.set('X-Priority', 'high')
      h.set('X-Source', 'web')

      const ack = await js.publish('orders.urgent', sc.encode('urgent-order'), {
        headers: h,
      })

      expect(ack.seq).toBeGreaterThan(0)
    })

    it('should publish with expect constraints', async () => {
      await js.publish('orders.first', sc.encode('first'))

      // Expect specific stream
      const ack = await js.publish('orders.second', sc.encode('second'), {
        expect: { streamName: 'ORDERS' },
      })

      expect(ack.stream).toBe('ORDERS')
    })

    it('should throw when publishing to non-existent stream subject', async () => {
      await expect(
        js.publish('nostream.test', sc.encode('fail'))
      ).rejects.toThrow(NatsError)
    })
  })

  describe('JetStream consumers', () => {
    beforeEach(async () => {
      // Add some messages to stream
      await js.publish('orders.new', sc.encode('order-1'))
      await js.publish('orders.new', sc.encode('order-2'))
      await js.publish('orders.complete', sc.encode('order-3'))
    })

    it('should create durable consumer', async () => {
      const info = await jsm.consumers.add('ORDERS', {
        durable_name: 'order-processor',
        ack_policy: AckPolicy.Explicit,
      })

      expect(info.name).toBe('order-processor')
      expect(info.stream_name).toBe('ORDERS')
    })

    it('should create ephemeral consumer', async () => {
      const info = await jsm.consumers.add('ORDERS', {
        ack_policy: AckPolicy.Explicit,
      })

      expect(info.name).toBeDefined()
      expect(info.config.durable_name).toBeUndefined()
    })

    it('should create consumer with filter subject', async () => {
      const info = await jsm.consumers.add('ORDERS', {
        durable_name: 'new-orders-only',
        filter_subject: 'orders.new',
        ack_policy: AckPolicy.Explicit,
      })

      expect(info.config.filter_subject).toBe('orders.new')
    })

    it('should fetch messages from consumer', async () => {
      await jsm.consumers.add('ORDERS', {
        durable_name: 'fetcher',
        ack_policy: AckPolicy.Explicit,
      })

      const consumer = await js.consumers.get('ORDERS', 'fetcher')
      const messages = await consumer.fetch({ max_messages: 10 })

      const received: string[] = []
      for await (const msg of messages) {
        received.push(sc.decode(msg.data))
        msg.ack()
      }

      expect(received.length).toBe(3)
    })

    it('should ack messages explicitly', async () => {
      await jsm.consumers.add('ORDERS', {
        durable_name: 'acker',
        ack_policy: AckPolicy.Explicit,
      })

      const consumer = await js.consumers.get('ORDERS', 'acker')
      const messages = await consumer.fetch({ max_messages: 1 })

      for await (const msg of messages) {
        msg.ack()
      }

      const info = await consumer.info()
      expect(info.ack_floor.stream_seq).toBeGreaterThan(0)
    })

    it('should nak messages for redelivery', async () => {
      await jsm.consumers.add('ORDERS', {
        durable_name: 'naker',
        ack_policy: AckPolicy.Explicit,
        max_deliver: 5,
      })

      const consumer = await js.consumers.get('ORDERS', 'naker')

      // First fetch - NAK
      const messages1 = await consumer.fetch({ max_messages: 1 })
      for await (const msg of messages1) {
        expect(msg.info.deliveryCount).toBe(1)
        msg.nak()
      }

      // Second fetch - should be redelivered
      const messages2 = await consumer.fetch({ max_messages: 1 })
      for await (const msg of messages2) {
        expect(msg.info.deliveryCount).toBe(2)
        msg.ack()
      }
    })

    it('should nak with delay for delayed redelivery', async () => {
      await jsm.consumers.add('ORDERS', {
        durable_name: 'delay-naker',
        ack_policy: AckPolicy.Explicit,
      })

      const consumer = await js.consumers.get('ORDERS', 'delay-naker')

      // First fetch - NAK with delay
      const messages1 = await consumer.fetch({ max_messages: 1 })
      const nakTime = Date.now()
      for await (const msg of messages1) {
        msg.nak(100) // 100ms delay
      }

      // Immediate fetch should not get message
      const messages2 = await consumer.fetch({ max_messages: 1 })
      let immediateCount = 0
      for await (const _msg of messages2) {
        immediateCount++
      }
      expect(immediateCount).toBe(0)

      // Wait for delay
      await new Promise(resolve => setTimeout(resolve, 150))

      // Now should get message
      const messages3 = await consumer.fetch({ max_messages: 1 })
      let delayedCount = 0
      for await (const msg of messages3) {
        delayedCount++
        msg.ack()
      }
      expect(delayedCount).toBe(1)
    })

    it('should terminate message (no redelivery)', async () => {
      await jsm.consumers.add('ORDERS', {
        durable_name: 'terminator',
        ack_policy: AckPolicy.Explicit,
        max_deliver: 10,
      })

      const consumer = await js.consumers.get('ORDERS', 'terminator')

      // First fetch - TERM
      const messages1 = await consumer.fetch({ max_messages: 1 })
      for await (const msg of messages1) {
        msg.term()
      }

      // Second fetch should NOT get the terminated message
      // (should get next message instead)
      const messages2 = await consumer.fetch({ max_messages: 1 })
      for await (const msg of messages2) {
        // This should be a different message
        expect(msg.info.streamSequence).toBeGreaterThan(1)
        msg.ack()
      }
    })

    it('should extend ack deadline with working()', async () => {
      await jsm.consumers.add('ORDERS', {
        durable_name: 'worker',
        ack_policy: AckPolicy.Explicit,
        ack_wait: 100000000, // 100ms in nanos
      })

      const consumer = await js.consumers.get('ORDERS', 'worker')
      const messages = await consumer.fetch({ max_messages: 1 })

      for await (const msg of messages) {
        // Extend deadline
        await msg.working()
        // Wait 80ms
        await new Promise(resolve => setTimeout(resolve, 80))
        // Extend again
        await msg.working()
        // Wait another 80ms (total 160ms, would timeout without working())
        await new Promise(resolve => setTimeout(resolve, 80))
        // Still ours
        msg.ack()
      }

      const info = await consumer.info()
      expect(info.num_ack_pending).toBe(0)
    })

    it('should stop redelivery after max_deliver', async () => {
      await jsm.consumers.add('ORDERS', {
        durable_name: 'max-deliver',
        ack_policy: AckPolicy.Explicit,
        max_deliver: 3,
      })

      const consumer = await js.consumers.get('ORDERS', 'max-deliver')
      let totalDeliveries = 0

      // Keep NAKing
      for (let i = 0; i < 5; i++) {
        const messages = await consumer.fetch({ max_messages: 1 })
        let gotMessage = false
        for await (const msg of messages) {
          gotMessage = true
          totalDeliveries++
          msg.nak()
        }
        if (!gotMessage) break
      }

      // Should only be delivered max_deliver times
      expect(totalDeliveries).toBe(3)
    })

    it('should get consumer info', async () => {
      await jsm.consumers.add('ORDERS', {
        durable_name: 'info-test',
        ack_policy: AckPolicy.Explicit,
      })

      const consumer = await js.consumers.get('ORDERS', 'info-test')
      const info = await consumer.info()

      expect(info.name).toBe('info-test')
      expect(info.stream_name).toBe('ORDERS')
      expect(info.config.ack_policy).toBe(AckPolicy.Explicit)
    })

    it('should delete consumer', async () => {
      await jsm.consumers.add('ORDERS', {
        durable_name: 'to-delete',
      })

      const consumer = await js.consumers.get('ORDERS', 'to-delete')
      await consumer.delete()

      await expect(
        js.consumers.get('ORDERS', 'to-delete')
      ).rejects.toThrow(NatsError)
    })
  })
})

// ============================================================================
// JETSTREAM STREAM MANAGEMENT TESTS (DO Backend)
// ============================================================================

describe('JetStream stream management with DO backend', () => {
  let nc: NatsConnection
  let jsm: JetStreamManager

  beforeEach(async () => {
    nc = await connect({ natsdo: {} as DOBinding })
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

    expect(info.config.name).toBe('TEST')
    expect(info.config.subjects).toContain('test.>')
  })

  it('should create stream with full configuration', async () => {
    const info = await jsm.streams.add({
      name: 'FULL_CONFIG',
      subjects: ['full.>'],
      retention: RetentionPolicy.Limits,
      storage: StorageType.Memory,
      max_msgs: 10000,
      max_bytes: 10 * 1024 * 1024, // 10MB
      max_age: 24 * 60 * 60 * 1000000000, // 24 hours in nanos
      max_msg_size: 1024 * 1024, // 1MB
      discard: DiscardPolicy.Old,
      num_replicas: 1,
      duplicate_window: 2 * 60 * 1000000000, // 2 minutes in nanos
    })

    expect(info.config.retention).toBe(RetentionPolicy.Limits)
    expect(info.config.storage).toBe(StorageType.Memory)
    expect(info.config.max_msgs).toBe(10000)
    expect(info.config.discard).toBe(DiscardPolicy.Old)
  })

  it('should get stream info', async () => {
    await jsm.streams.add({
      name: 'INFO_TEST',
      subjects: ['info.>'],
    })

    const info = await jsm.streams.info('INFO_TEST')

    expect(info.config.name).toBe('INFO_TEST')
    expect(info.state).toBeDefined()
    expect(info.state.messages).toBe(0)
  })

  it('should update stream configuration', async () => {
    await jsm.streams.add({
      name: 'UPDATE_TEST',
      subjects: ['update.>'],
    })

    const info = await jsm.streams.update('UPDATE_TEST', {
      subjects: ['update.>', 'update2.>'],
      max_msgs: 5000,
    })

    expect(info.config.subjects).toContain('update2.>')
    expect(info.config.max_msgs).toBe(5000)
  })

  it('should delete stream', async () => {
    await jsm.streams.add({
      name: 'DELETE_TEST',
      subjects: ['delete.>'],
    })

    await jsm.streams.delete('DELETE_TEST')

    await expect(jsm.streams.info('DELETE_TEST')).rejects.toThrow(NatsError)
  })

  it('should purge stream messages', async () => {
    await jsm.streams.add({
      name: 'PURGE_TEST',
      subjects: ['purge.>'],
    })

    const js = nc.jetstream()
    await js.publish('purge.test', StringCodec().encode('msg1'))
    await js.publish('purge.test', StringCodec().encode('msg2'))
    await js.publish('purge.test', StringCodec().encode('msg3'))

    const result = await jsm.streams.purge('PURGE_TEST')

    expect(result.success).toBe(true)
    expect(result.purged).toBe(3)

    const info = await jsm.streams.info('PURGE_TEST')
    expect(info.state.messages).toBe(0)
  })

  it('should list streams', async () => {
    await jsm.streams.add({ name: 'LIST1', subjects: ['list1.>'] })
    await jsm.streams.add({ name: 'LIST2', subjects: ['list2.>'] })

    const streams = await jsm.streams.list().next()

    expect(streams.length).toBeGreaterThanOrEqual(2)
    expect(streams.map(s => s.config.name)).toContain('LIST1')
    expect(streams.map(s => s.config.name)).toContain('LIST2')
  })

  it('should get stream names', async () => {
    await jsm.streams.add({ name: 'NAME1', subjects: ['name1.>'] })
    await jsm.streams.add({ name: 'NAME2', subjects: ['name2.>'] })

    const names = await jsm.streams.names().next()

    expect(names).toContain('NAME1')
    expect(names).toContain('NAME2')
  })

  it('should get message by sequence', async () => {
    await jsm.streams.add({ name: 'MSG_TEST', subjects: ['msg.>'] })

    const js = nc.jetstream()
    const ack = await js.publish('msg.test', StringCodec().encode('stored message'))

    const msg = await jsm.streams.getMessage('MSG_TEST', { seq: ack.seq })

    expect(msg.seq).toBe(ack.seq)
    expect(msg.subject).toBe('msg.test')
  })

  it('should get last message by subject', async () => {
    await jsm.streams.add({ name: 'LAST_MSG', subjects: ['last.>'] })

    const js = nc.jetstream()
    await js.publish('last.test', StringCodec().encode('first'))
    await js.publish('last.test', StringCodec().encode('second'))
    await js.publish('last.test', StringCodec().encode('third'))

    const msg = await jsm.streams.getMessage('LAST_MSG', { last_by_subj: 'last.test' })

    expect(StringCodec().decode(msg.data)).toBe('third')
  })

  it('should delete message by sequence', async () => {
    await jsm.streams.add({ name: 'DEL_MSG', subjects: ['del.>'] })

    const js = nc.jetstream()
    const ack = await js.publish('del.test', StringCodec().encode('to delete'))

    const deleted = await jsm.streams.deleteMessage('DEL_MSG', ack.seq)
    expect(deleted).toBe(true)

    await expect(
      jsm.streams.getMessage('DEL_MSG', { seq: ack.seq })
    ).rejects.toThrow()
  })

  it('should get account info', async () => {
    const info = await jsm.getAccountInfo()

    expect(info.memory).toBeDefined()
    expect(info.storage).toBeDefined()
    expect(info.streams).toBeDefined()
    expect(info.consumers).toBeDefined()
    expect(info.limits).toBeDefined()
  })
})

// ============================================================================
// KV STORE TESTS (DO Backend)
// ============================================================================

describe('KV Store with DO backend', () => {
  let nc: NatsConnection
  let js: JetStreamClient
  let kv: KV
  const sc = StringCodec()

  beforeEach(async () => {
    nc = await connect({ natsdo: {} as DOBinding })
    js = nc.jetstream()
    kv = await js.views.kv('test-bucket')
  })

  afterEach(async () => {
    await nc.close()
  })

  describe('Basic KV operations', () => {
    it('should create KV bucket', async () => {
      const bucket = await js.views.kv('new-bucket')
      expect(bucket).toBeDefined()
    })

    it('should create KV bucket with options', async () => {
      const bucket = await js.views.kv('options-bucket', {
        history: 10,
        ttl: 3600000, // 1 hour
        max_bucket_size: 10 * 1024 * 1024, // 10MB
        replicas: 1,
        description: 'Test bucket',
      })
      expect(bucket).toBeDefined()
    })

    it('should put value', async () => {
      const revision = await kv.put('key1', sc.encode('value1'))
      expect(revision).toBeGreaterThan(0)
    })

    it('should get value', async () => {
      await kv.put('key2', sc.encode('value2'))
      const entry = await kv.get('key2')

      expect(entry).toBeDefined()
      expect(entry!.key).toBe('key2')
      expect(sc.decode(entry!.value)).toBe('value2')
      expect(entry!.revision).toBeGreaterThan(0)
    })

    it('should return null for missing key', async () => {
      const entry = await kv.get('nonexistent')
      expect(entry).toBeNull()
    })

    it('should update value', async () => {
      const rev1 = await kv.put('update-key', sc.encode('v1'))
      const rev2 = await kv.put('update-key', sc.encode('v2'))

      expect(rev2).toBeGreaterThan(rev1)

      const entry = await kv.get('update-key')
      expect(sc.decode(entry!.value)).toBe('v2')
      expect(entry!.revision).toBe(rev2)
    })

    it('should delete key', async () => {
      await kv.put('to-delete', sc.encode('value'))
      await kv.delete('to-delete')

      const entry = await kv.get('to-delete')
      expect(entry).toBeNull()
    })

    it('should purge key and history', async () => {
      await kv.put('to-purge', sc.encode('v1'))
      await kv.put('to-purge', sc.encode('v2'))
      await kv.put('to-purge', sc.encode('v3'))

      await kv.purge('to-purge')

      const entry = await kv.get('to-purge')
      expect(entry).toBeNull()

      // History should also be gone
      const history = await kv.history('to-purge')
      const versions: KvEntry[] = []
      for await (const e of history) {
        versions.push(e)
      }
      expect(versions.length).toBe(0)
    })
  })

  describe('Conditional operations', () => {
    it('should create key only if not exists', async () => {
      const rev1 = await kv.create('create-key', sc.encode('initial'))
      expect(rev1).toBeGreaterThan(0)

      // Second create should fail/return 0
      const rev2 = await kv.create('create-key', sc.encode('should-fail'))
      expect(rev2).toBe(0)
    })

    it('should update with revision check (optimistic locking)', async () => {
      const rev1 = await kv.put('lock-key', sc.encode('v1'))

      // Update with correct revision
      const rev2 = await kv.update('lock-key', sc.encode('v2'), rev1)
      expect(rev2).toBeGreaterThan(rev1)

      // Update with wrong revision should fail
      await expect(
        kv.update('lock-key', sc.encode('v3'), rev1)
      ).rejects.toThrow(NatsError)
    })

    it('should delete with revision check', async () => {
      const rev = await kv.put('rev-delete', sc.encode('value'))

      // Delete with correct revision
      await kv.delete('rev-delete', { revision: rev })

      const entry = await kv.get('rev-delete')
      expect(entry).toBeNull()
    })
  })

  describe('Keys and iteration', () => {
    it('should list all keys', async () => {
      await kv.put('list-a', sc.encode('a'))
      await kv.put('list-b', sc.encode('b'))
      await kv.put('list-c', sc.encode('c'))

      const keys = await kv.keys()
      const keyList: string[] = []
      for await (const key of keys) {
        keyList.push(key)
      }

      expect(keyList).toContain('list-a')
      expect(keyList).toContain('list-b')
      expect(keyList).toContain('list-c')
    })

    it('should filter keys by pattern', async () => {
      await kv.put('user.1.name', sc.encode('Alice'))
      await kv.put('user.2.name', sc.encode('Bob'))
      await kv.put('config.setting', sc.encode('value'))

      const keys = await kv.keys('user.>')
      const keyList: string[] = []
      for await (const key of keys) {
        keyList.push(key)
      }

      expect(keyList.length).toBe(2)
      expect(keyList).toContain('user.1.name')
      expect(keyList).toContain('user.2.name')
      expect(keyList).not.toContain('config.setting')
    })
  })

  describe('History and watch', () => {
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
      expect(sc.decode(versions[0].value)).toBe('v1')
      expect(sc.decode(versions[1].value)).toBe('v2')
      expect(sc.decode(versions[2].value)).toBe('v3')
    })

    it('should watch for changes', async () => {
      const changes: KvEntry[] = []

      const watcher = await kv.watch()
      const watchPromise = (async () => {
        for await (const entry of watcher) {
          changes.push(entry)
          if (changes.length >= 3) break
        }
      })()

      // Make changes
      await kv.put('watch-key', sc.encode('change1'))
      await kv.put('watch-key', sc.encode('change2'))
      await kv.put('watch-key', sc.encode('change3'))

      await Promise.race([
        watchPromise,
        new Promise(resolve => setTimeout(resolve, 1000)),
      ])

      expect(changes.length).toBe(3)
      expect(changes[0].operation).toBe('PUT')
    })

    it('should watch specific key', async () => {
      const changes: KvEntry[] = []

      const watcher = await kv.watch({ key: 'specific-key' })
      const watchPromise = (async () => {
        for await (const entry of watcher) {
          changes.push(entry)
          if (changes.length >= 2) break
        }
      })()

      await kv.put('other-key', sc.encode('ignored'))
      await kv.put('specific-key', sc.encode('included'))
      await kv.put('another-key', sc.encode('also ignored'))
      await kv.put('specific-key', sc.encode('also included'))

      await Promise.race([
        watchPromise,
        new Promise(resolve => setTimeout(resolve, 1000)),
      ])

      expect(changes.length).toBe(2)
      expect(changes.every(c => c.key === 'specific-key')).toBe(true)
    })
  })

  describe('Bucket management', () => {
    it('should get bucket status', async () => {
      await kv.put('status-key-1', sc.encode('v1'))
      await kv.put('status-key-2', sc.encode('v2'))

      const status = await kv.status()

      expect(status.bucket).toBe('test-bucket')
      expect(status.values).toBeGreaterThanOrEqual(2)
      expect(status.backingStore).toBe('JetStream')
    })

    it('should destroy bucket', async () => {
      const tempKv = await js.views.kv('temp-destroy')
      await tempKv.put('key', sc.encode('value'))

      await tempKv.destroy()

      // Bucket should no longer exist
      await expect(
        js.views.kv('temp-destroy', { bindOnly: true })
      ).rejects.toThrow(NatsError)
    })

    it('should bind to existing bucket only', async () => {
      await expect(
        js.views.kv('nonexistent-bucket', { bindOnly: true })
      ).rejects.toThrow(NatsError)
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS (DO Backend)
// ============================================================================

describe('Error handling with DO backend', () => {
  it('should throw on connection to closed client', async () => {
    const nc = await connect({ natsdo: {} as DOBinding })
    await nc.close()

    expect(() => nc.publish('test', Empty)).toThrow(NatsError)
    expect(() => nc.subscribe('test')).toThrow(NatsError)
    await expect(nc.request('test', Empty)).rejects.toThrow(NatsError)
  })

  it('should throw on invalid subject', async () => {
    const nc = await connect({ natsdo: {} as DOBinding })

    expect(() => nc.publish('', Empty)).toThrow(NatsError)
    expect(() => nc.publish('bad..subject', Empty)).toThrow(NatsError)
    expect(() => nc.publish('.leading.dot', Empty)).toThrow(NatsError)
    expect(() => nc.publish('trailing.dot.', Empty)).toThrow(NatsError)

    await nc.close()
  })

  it('should timeout on request with no responders', async () => {
    const nc = await connect({ natsdo: {} as DOBinding })

    await expect(
      nc.request('no.one.listening', Empty, { timeout: 50 })
    ).rejects.toThrow(NatsError)

    await nc.close()
  })

  it('should provide error codes', () => {
    expect(ErrorCode.Timeout).toBe('TIMEOUT')
    expect(ErrorCode.ConnectionClosed).toBe('CONNECTION_CLOSED')
    expect(ErrorCode.NoResponders).toBe('NO_RESPONDERS')
    expect(ErrorCode.BadSubject).toBe('BAD_SUBJECT')
    expect(ErrorCode.JetStream404NoMessages).toBe('JETSTREAM_404_NO_MESSAGES')
    expect(ErrorCode.JetStream409).toBe('JETSTREAM_409')
  })

  it('should include chained error in NatsError', () => {
    const cause = new Error('underlying cause')
    const natsErr = new NatsError('wrapper', ErrorCode.Unknown, cause)

    expect(natsErr.chainedError).toBe(cause)
    expect(natsErr.code).toBe(ErrorCode.Unknown)
  })
})

// ============================================================================
// INTEGRATION TESTS (DO Backend)
// ============================================================================

describe('Integration tests with DO backend', () => {
  it('should work with complete pub/sub workflow', async () => {
    const nc = await connect({ natsdo: {} as DOBinding })
    const sc = StringCodec()

    const messages: string[] = []
    const sub = nc.subscribe('workflow.>')

    const collector = (async () => {
      for await (const msg of sub) {
        messages.push(sc.decode(msg.data))
        if (messages.length >= 3) break
      }
    })()

    nc.publish('workflow.start', sc.encode('starting'))
    nc.publish('workflow.process', sc.encode('processing'))
    nc.publish('workflow.complete', sc.encode('done'))
    await nc.flush()

    await Promise.race([
      collector,
      new Promise(resolve => setTimeout(resolve, 1000)),
    ])

    await sub.unsubscribe()
    await nc.close()

    expect(messages).toEqual(['starting', 'processing', 'done'])
  })

  it('should work with microservice pattern', async () => {
    const nc = await connect({ natsdo: {} as DOBinding })
    const sc = StringCodec()

    // User service
    const userSub = nc.subscribe('user.get')
    ;(async () => {
      for await (const msg of userSub) {
        const userId = sc.decode(msg.data)
        msg.respond(sc.encode(JSON.stringify({ id: userId, name: `User ${userId}` })))
      }
    })()

    // Order service
    const orderSub = nc.subscribe('order.create')
    ;(async () => {
      for await (const msg of orderSub) {
        const order = JSON.parse(sc.decode(msg.data))
        // Fetch user
        const userResp = await nc.request('user.get', sc.encode(order.userId))
        const user = JSON.parse(sc.decode(userResp.data))
        msg.respond(sc.encode(JSON.stringify({
          orderId: 'ord-123',
          user: user,
          items: order.items,
        })))
      }
    })()

    // Client request
    const response = await nc.request('order.create', sc.encode(JSON.stringify({
      userId: '42',
      items: ['item1', 'item2'],
    })))

    const result = JSON.parse(sc.decode(response.data))

    expect(result.orderId).toBe('ord-123')
    expect(result.user.id).toBe('42')
    expect(result.items).toEqual(['item1', 'item2'])

    await userSub.unsubscribe()
    await orderSub.unsubscribe()
    await nc.close()
  })

  it('should work with JetStream event sourcing pattern', async () => {
    const nc = await connect({ natsdo: {} as DOBinding })
    const js = nc.jetstream()
    const jsm = await nc.jetstreamManager()
    const sc = StringCodec()

    // Create events stream
    await jsm.streams.add({
      name: 'ACCOUNT_EVENTS',
      subjects: ['account.events.>'],
      retention: RetentionPolicy.Limits,
    })

    // Publish account events
    await js.publish('account.events.created', sc.encode(JSON.stringify({
      type: 'AccountCreated',
      accountId: 'acc-123',
      timestamp: Date.now(),
    })))

    await js.publish('account.events.deposited', sc.encode(JSON.stringify({
      type: 'MoneyDeposited',
      accountId: 'acc-123',
      amount: 100,
      timestamp: Date.now(),
    })))

    await js.publish('account.events.withdrawn', sc.encode(JSON.stringify({
      type: 'MoneyWithdrawn',
      accountId: 'acc-123',
      amount: 30,
      timestamp: Date.now(),
    })))

    // Replay events to rebuild state
    await jsm.consumers.add('ACCOUNT_EVENTS', {
      durable_name: 'account-projector',
      deliver_policy: DeliverPolicy.All,
      ack_policy: AckPolicy.Explicit,
    })

    const consumer = await js.consumers.get('ACCOUNT_EVENTS', 'account-projector')
    const messages = await consumer.fetch({ max_messages: 100 })

    let balance = 0
    for await (const msg of messages) {
      const event = JSON.parse(sc.decode(msg.data))
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

    expect(balance).toBe(70) // 100 - 30

    await nc.close()
  })

  it('should work with KV for session storage', async () => {
    const nc = await connect({ natsdo: {} as DOBinding })
    const js = nc.jetstream()
    const sc = StringCodec()

    const sessions = await js.views.kv('sessions', {
      ttl: 30 * 60 * 1000, // 30 minutes
      history: 1,
    })

    // Create session
    const sessionId = 'sess-abc123'
    await sessions.put(sessionId, sc.encode(JSON.stringify({
      userId: 'user-42',
      createdAt: Date.now(),
      data: { cart: [] },
    })))

    // Update session
    const entry = await sessions.get(sessionId)
    const session = JSON.parse(sc.decode(entry!.value))
    session.data.cart.push('item-1')

    await sessions.update(sessionId, sc.encode(JSON.stringify(session)), entry!.revision)

    // Read session
    const updated = await sessions.get(sessionId)
    const updatedSession = JSON.parse(sc.decode(updated!.value))

    expect(updatedSession.data.cart).toContain('item-1')

    // Delete session (logout)
    await sessions.delete(sessionId)

    const deleted = await sessions.get(sessionId)
    expect(deleted).toBeNull()

    await nc.close()
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

    it('should handle unicode', () => {
      const sc = StringCodec()
      const text = 'Hello World'
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

    it('should handle nested objects', () => {
      const jc = JSONCodec<{ user: { profile: { name: string } } }>()
      const obj = { user: { profile: { name: 'Alice' } } }
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
  })

  describe('Empty', () => {
    it('should be empty Uint8Array', () => {
      expect(Empty).toBeInstanceOf(Uint8Array)
      expect(Empty.length).toBe(0)
    })
  })
})

// ============================================================================
// HEADERS TESTS
// ============================================================================

describe('Headers', () => {
  it('should create headers', () => {
    const h = headers()
    expect(h).toBeDefined()
  })

  it('should set and get header', () => {
    const h = headers()
    h.set('Content-Type', 'application/json')
    expect(h.get('Content-Type')).toBe('application/json')
  })

  it('should be case-insensitive for get', () => {
    const h = headers()
    h.set('X-Custom-Header', 'value')
    expect(h.get('x-custom-header')).toBe('value')
    expect(h.get('X-CUSTOM-HEADER')).toBe('value')
  })

  it('should check if header exists', () => {
    const h = headers()
    h.set('X-Exists', 'yes')
    expect(h.has('X-Exists')).toBe(true)
    expect(h.has('X-Missing')).toBe(false)
  })

  it('should delete header', () => {
    const h = headers()
    h.set('X-Delete', 'value')
    h.delete('X-Delete')
    expect(h.has('X-Delete')).toBe(false)
  })

  it('should append values to header', () => {
    const h = headers()
    h.append('Accept', 'text/plain')
    h.append('Accept', 'application/json')

    const values = h.values('Accept')
    expect(values).toContain('text/plain')
    expect(values).toContain('application/json')
  })

  it('should iterate over header keys', () => {
    const h = headers()
    h.set('Key1', 'Value1')
    h.set('Key2', 'Value2')
    h.set('Key3', 'Value3')

    const keys = [...h.keys()]
    expect(keys.length).toBe(3)
  })
})
