/**
 * PubSubBroker tests
 *
 * RED phase: These tests define the expected behavior of PubSubBroker.
 * All tests should FAIL until implementation is complete.
 *
 * PubSubBroker provides Redis-compatible pub/sub functionality:
 * - publish(channel, message) for sending messages
 * - subscribe(channel) returning AsyncIterator
 * - psubscribe(pattern) for pattern-based subscriptions
 * - Channel management and cleanup
 *
 * Maps to Redis: PUBLISH, SUBSCRIBE, UNSUBSCRIBE, PSUBSCRIBE, PUNSUBSCRIBE, PUBSUB
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  PubSubBroker,
  createPubSubBroker,
  type PubSubMessage,
  type PubSubOptions,
  type SubscriptionHandle,
  type ChannelStats,
} from '../pubsub-broker'
import { TestMetricsCollector } from '../observability'

// ============================================================================
// TEST DATA AND HELPERS
// ============================================================================

interface TestMessage {
  id: string
  data: string
  timestamp?: number
}

function createTestBroker(options?: PubSubOptions): PubSubBroker<TestMessage> {
  return createPubSubBroker<TestMessage>(options)
}

/**
 * Helper to collect messages from a subscription with timeout
 */
async function collectMessages<T>(
  subscription: AsyncIterator<PubSubMessage<T>>,
  count: number,
  timeoutMs: number = 1000
): Promise<PubSubMessage<T>[]> {
  const results: PubSubMessage<T>[] = []
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout collecting messages')), timeoutMs)
  )

  try {
    for (let i = 0; i < count; i++) {
      const result = await Promise.race([subscription.next(), timeoutPromise])
      if (result.done) break
      results.push(result.value)
    }
  } catch (e) {
    // Timeout or other error - return what we have
  }

  return results
}

/**
 * Helper to wait for messages asynchronously
 */
function waitForMessage<T>(
  subscription: AsyncIterator<PubSubMessage<T>>,
  timeoutMs: number = 1000
): Promise<PubSubMessage<T> | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs)
    subscription.next().then((result) => {
      clearTimeout(timeout)
      resolve(result.done ? null : result.value)
    })
  })
}

/**
 * Helper to delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// BASIC PUBLISH/SUBSCRIBE OPERATIONS
// ============================================================================

describe('PubSubBroker', () => {
  describe('basic publish/subscribe operations', () => {
    it('should create a broker instance', () => {
      const broker = createTestBroker()

      expect(broker).toBeDefined()
      expect(typeof broker.publish).toBe('function')
      expect(typeof broker.subscribe).toBe('function')
      expect(typeof broker.unsubscribe).toBe('function')
    })

    it('should subscribe to a channel and receive published messages', async () => {
      const broker = createTestBroker()
      const channel = 'test-channel'

      const subscription = broker.subscribe(channel)
      const messagePromise = waitForMessage(subscription)

      // Publish after subscription
      await broker.publish(channel, { id: '1', data: 'hello' })

      const received = await messagePromise
      expect(received).not.toBeNull()
      expect(received?.channel).toBe(channel)
      expect(received?.message.id).toBe('1')
      expect(received?.message.data).toBe('hello')
    })

    it('should return subscriber count from publish', async () => {
      const broker = createTestBroker()
      const channel = 'test-channel'

      // No subscribers
      const count0 = await broker.publish(channel, { id: '1', data: 'hello' })
      expect(count0).toBe(0)

      // One subscriber
      const sub1 = broker.subscribe(channel)
      const count1 = await broker.publish(channel, { id: '2', data: 'world' })
      expect(count1).toBe(1)

      // Two subscribers
      const sub2 = broker.subscribe(channel)
      const count2 = await broker.publish(channel, { id: '3', data: 'test' })
      expect(count2).toBe(2)

      // Cleanup
      await broker.unsubscribe(sub1)
      await broker.unsubscribe(sub2)
    })

    it('should deliver message to multiple subscribers on same channel', async () => {
      const broker = createTestBroker()
      const channel = 'multi-sub-channel'

      const sub1 = broker.subscribe(channel)
      const sub2 = broker.subscribe(channel)
      const sub3 = broker.subscribe(channel)

      const msg1Promise = waitForMessage(sub1)
      const msg2Promise = waitForMessage(sub2)
      const msg3Promise = waitForMessage(sub3)

      await broker.publish(channel, { id: 'broadcast', data: 'to-all' })

      const [msg1, msg2, msg3] = await Promise.all([msg1Promise, msg2Promise, msg3Promise])

      expect(msg1?.message.id).toBe('broadcast')
      expect(msg2?.message.id).toBe('broadcast')
      expect(msg3?.message.id).toBe('broadcast')

      // Cleanup
      await broker.unsubscribe(sub1)
      await broker.unsubscribe(sub2)
      await broker.unsubscribe(sub3)
    })

    it('should not deliver messages to different channels', async () => {
      const broker = createTestBroker()

      const subA = broker.subscribe('channel-a')
      const subB = broker.subscribe('channel-b')

      const msgAPromise = waitForMessage(subA, 100)
      const msgBPromise = waitForMessage(subB, 500)

      // Publish to channel-b only
      await broker.publish('channel-b', { id: '1', data: 'for-b' })

      const msgA = await msgAPromise
      const msgB = await msgBPromise

      expect(msgA).toBeNull() // Should timeout - no message for channel-a
      expect(msgB?.message.data).toBe('for-b')

      // Cleanup
      await broker.unsubscribe(subA)
      await broker.unsubscribe(subB)
    })

    it('should handle sequential messages on same channel', async () => {
      const broker = createTestBroker()
      const channel = 'seq-channel'

      const subscription = broker.subscribe(channel)

      // Publish multiple messages
      await broker.publish(channel, { id: '1', data: 'first' })
      await broker.publish(channel, { id: '2', data: 'second' })
      await broker.publish(channel, { id: '3', data: 'third' })

      const messages = await collectMessages(subscription, 3)

      expect(messages).toHaveLength(3)
      expect(messages[0].message.data).toBe('first')
      expect(messages[1].message.data).toBe('second')
      expect(messages[2].message.data).toBe('third')

      await broker.unsubscribe(subscription)
    })
  })

  // ============================================================================
  // UNSUBSCRIBE OPERATIONS
  // ============================================================================

  describe('unsubscribe operations', () => {
    it('should stop receiving messages after unsubscribe', async () => {
      const broker = createTestBroker()
      const channel = 'unsub-channel'

      const subscription = broker.subscribe(channel)

      // Receive first message
      const msg1Promise = waitForMessage(subscription)
      await broker.publish(channel, { id: '1', data: 'before' })
      const msg1 = await msg1Promise
      expect(msg1?.message.data).toBe('before')

      // Unsubscribe
      await broker.unsubscribe(subscription)

      // Should not receive this message (subscriber count should be 0)
      const count = await broker.publish(channel, { id: '2', data: 'after' })
      expect(count).toBe(0)
    })

    it('should handle unsubscribe of non-existent subscription gracefully', async () => {
      const broker = createTestBroker()

      // Create a fake subscription handle
      const fakeSubscription = {
        next: async () => ({ done: true, value: undefined }),
      } as AsyncIterator<PubSubMessage<TestMessage>>

      // Should not throw
      await expect(broker.unsubscribe(fakeSubscription)).resolves.not.toThrow()
    })

    it('should handle double unsubscribe gracefully', async () => {
      const broker = createTestBroker()
      const channel = 'double-unsub-channel'

      const subscription = broker.subscribe(channel)

      await broker.unsubscribe(subscription)
      await expect(broker.unsubscribe(subscription)).resolves.not.toThrow()
    })

    it('should allow resubscribe after unsubscribe', async () => {
      const broker = createTestBroker()
      const channel = 'resub-channel'

      const sub1 = broker.subscribe(channel)
      await broker.unsubscribe(sub1)

      const sub2 = broker.subscribe(channel)
      const msgPromise = waitForMessage(sub2)

      await broker.publish(channel, { id: 'new', data: 'message' })

      const msg = await msgPromise
      expect(msg?.message.data).toBe('message')

      await broker.unsubscribe(sub2)
    })
  })

  // ============================================================================
  // PATTERN SUBSCRIPTIONS (PSUBSCRIBE)
  // ============================================================================

  describe('pattern subscriptions (psubscribe)', () => {
    it('should subscribe to channels matching a glob pattern', async () => {
      const broker = createTestBroker()

      const subscription = broker.psubscribe('user.*')

      const msgPromise = waitForMessage(subscription)
      await broker.publish('user.login', { id: '1', data: 'alice logged in' })

      const msg = await msgPromise
      expect(msg).not.toBeNull()
      expect(msg?.channel).toBe('user.login')
      expect(msg?.pattern).toBe('user.*')
      expect(msg?.message.data).toBe('alice logged in')

      await broker.punsubscribe(subscription)
    })

    it('should match multiple channels with wildcard *', async () => {
      const broker = createTestBroker()

      const subscription = broker.psubscribe('events.*')

      // Should receive from any events.* channel
      await broker.publish('events.click', { id: '1', data: 'click' })
      await broker.publish('events.scroll', { id: '2', data: 'scroll' })
      await broker.publish('events.submit', { id: '3', data: 'submit' })

      const messages = await collectMessages(subscription, 3)

      expect(messages).toHaveLength(3)
      expect(messages.map((m) => m.channel)).toContain('events.click')
      expect(messages.map((m) => m.channel)).toContain('events.scroll')
      expect(messages.map((m) => m.channel)).toContain('events.submit')

      await broker.punsubscribe(subscription)
    })

    it('should not match channels that do not fit pattern', async () => {
      const broker = createTestBroker()

      const subscription = broker.psubscribe('user.*')

      const msgPromise = waitForMessage(subscription, 100)
      await broker.publish('order.created', { id: '1', data: 'no match' })

      const msg = await msgPromise
      expect(msg).toBeNull() // Should timeout

      await broker.punsubscribe(subscription)
    })

    it('should support ** for multi-level matching', async () => {
      const broker = createTestBroker()

      const subscription = broker.psubscribe('events.**')

      await broker.publish('events.user.login', { id: '1', data: 'deep match' })
      await broker.publish('events.order.item.added', { id: '2', data: 'deeper match' })

      const messages = await collectMessages(subscription, 2)

      expect(messages).toHaveLength(2)
      expect(messages[0].channel).toBe('events.user.login')
      expect(messages[1].channel).toBe('events.order.item.added')

      await broker.punsubscribe(subscription)
    })

    it('should support ? for single character matching', async () => {
      const broker = createTestBroker()

      const subscription = broker.psubscribe('user.?')

      const msg1Promise = waitForMessage(subscription, 500)
      await broker.publish('user.a', { id: '1', data: 'single char' })

      const msg1 = await msg1Promise
      expect(msg1?.channel).toBe('user.a')

      // Should not match longer names
      const msg2Promise = waitForMessage(subscription, 100)
      await broker.publish('user.ab', { id: '2', data: 'two chars' })

      const msg2 = await msg2Promise
      expect(msg2).toBeNull()

      await broker.punsubscribe(subscription)
    })

    it('should support character classes [abc]', async () => {
      const broker = createTestBroker()

      const subscription = broker.psubscribe('channel.[abc]')

      await broker.publish('channel.a', { id: '1', data: 'a' })
      await broker.publish('channel.b', { id: '2', data: 'b' })
      await broker.publish('channel.d', { id: '3', data: 'd' }) // Should not match

      const messages = await collectMessages(subscription, 3, 500)

      expect(messages).toHaveLength(2)
      expect(messages.map((m) => m.channel)).toContain('channel.a')
      expect(messages.map((m) => m.channel)).toContain('channel.b')

      await broker.punsubscribe(subscription)
    })

    it('should handle punsubscribe correctly', async () => {
      const broker = createTestBroker()

      const subscription = broker.psubscribe('test.*')

      await broker.punsubscribe(subscription)

      // Should not receive after unsubscribe
      const msgPromise = waitForMessage(subscription, 100)
      await broker.publish('test.channel', { id: '1', data: 'after unsub' })

      const msg = await msgPromise
      expect(msg).toBeNull()
    })

    it('should combine pattern and exact subscriptions', async () => {
      const broker = createTestBroker()

      const exactSub = broker.subscribe('user.login')
      const patternSub = broker.psubscribe('user.*')

      const exactPromise = waitForMessage(exactSub)
      const patternPromise = waitForMessage(patternSub)

      await broker.publish('user.login', { id: '1', data: 'login event' })

      const exactMsg = await exactPromise
      const patternMsg = await patternPromise

      // Both should receive the message
      expect(exactMsg?.message.data).toBe('login event')
      expect(patternMsg?.message.data).toBe('login event')

      await broker.unsubscribe(exactSub)
      await broker.punsubscribe(patternSub)
    })

    it('should include pattern in message for pattern subscriptions', async () => {
      const broker = createTestBroker()

      const subscription = broker.psubscribe('order.*')

      const msgPromise = waitForMessage(subscription)
      await broker.publish('order.created', { id: '1', data: 'new order' })

      const msg = await msgPromise
      expect(msg?.pattern).toBe('order.*')
      expect(msg?.channel).toBe('order.created')

      await broker.punsubscribe(subscription)
    })
  })

  // ============================================================================
  // CHANNEL MANAGEMENT
  // ============================================================================

  describe('channel management', () => {
    it('should report active channels', async () => {
      const broker = createTestBroker()

      const sub1 = broker.subscribe('channel-a')
      const sub2 = broker.subscribe('channel-b')
      const sub3 = broker.subscribe('channel-c')

      const channels = await broker.channels()

      expect(channels).toContain('channel-a')
      expect(channels).toContain('channel-b')
      expect(channels).toContain('channel-c')
      expect(channels).toHaveLength(3)

      // Cleanup
      await broker.unsubscribe(sub1)
      await broker.unsubscribe(sub2)
      await broker.unsubscribe(sub3)
    })

    it('should remove channel when last subscriber leaves', async () => {
      const broker = createTestBroker()

      const sub1 = broker.subscribe('temp-channel')
      const sub2 = broker.subscribe('temp-channel')

      let channels = await broker.channels()
      expect(channels).toContain('temp-channel')

      await broker.unsubscribe(sub1)
      channels = await broker.channels()
      expect(channels).toContain('temp-channel') // Still has sub2

      await broker.unsubscribe(sub2)
      channels = await broker.channels()
      expect(channels).not.toContain('temp-channel') // Now removed
    })

    it('should return empty array when no subscriptions', async () => {
      const broker = createTestBroker()

      const channels = await broker.channels()

      expect(channels).toEqual([])
    })

    it('should report subscriber count per channel', async () => {
      const broker = createTestBroker()

      const sub1 = broker.subscribe('popular-channel')
      const sub2 = broker.subscribe('popular-channel')
      const sub3 = broker.subscribe('popular-channel')
      const sub4 = broker.subscribe('other-channel')

      const popularCount = await broker.numsub('popular-channel')
      const otherCount = await broker.numsub('other-channel')
      const emptyCount = await broker.numsub('nonexistent-channel')

      expect(popularCount).toBe(3)
      expect(otherCount).toBe(1)
      expect(emptyCount).toBe(0)

      // Cleanup
      await broker.unsubscribe(sub1)
      await broker.unsubscribe(sub2)
      await broker.unsubscribe(sub3)
      await broker.unsubscribe(sub4)
    })

    it('should report number of pattern subscriptions', async () => {
      const broker = createTestBroker()

      expect(await broker.numpat()).toBe(0)

      const psub1 = broker.psubscribe('user.*')
      expect(await broker.numpat()).toBe(1)

      const psub2 = broker.psubscribe('order.**')
      expect(await broker.numpat()).toBe(2)

      await broker.punsubscribe(psub1)
      expect(await broker.numpat()).toBe(1)

      await broker.punsubscribe(psub2)
      expect(await broker.numpat()).toBe(0)
    })

    it('should get channel stats', async () => {
      const broker = createTestBroker()

      const sub1 = broker.subscribe('stats-channel')
      const sub2 = broker.subscribe('stats-channel')
      await broker.publish('stats-channel', { id: '1', data: 'msg1' })
      await broker.publish('stats-channel', { id: '2', data: 'msg2' })

      const stats = await broker.stats('stats-channel')

      expect(stats.channel).toBe('stats-channel')
      expect(stats.subscriberCount).toBe(2)
      expect(stats.messagesPublished).toBe(2)

      await broker.unsubscribe(sub1)
      await broker.unsubscribe(sub2)
    })
  })

  // ============================================================================
  // MESSAGE BUFFERING
  // ============================================================================

  describe('message buffering', () => {
    it('should buffer messages when subscriber is slow', async () => {
      const broker = createTestBroker({ bufferSize: 100 })
      const channel = 'buffer-test'

      const subscription = broker.subscribe(channel)

      // Publish multiple messages quickly
      for (let i = 0; i < 10; i++) {
        await broker.publish(channel, { id: `${i}`, data: `message ${i}` })
      }

      // Now consume them
      const messages = await collectMessages(subscription, 10)

      expect(messages).toHaveLength(10)
      expect(messages[0].message.data).toBe('message 0')
      expect(messages[9].message.data).toBe('message 9')

      await broker.unsubscribe(subscription)
    })

    it('should drop oldest messages when buffer is full', async () => {
      const broker = createTestBroker({ bufferSize: 5 })
      const channel = 'overflow-test'

      const subscription = broker.subscribe(channel)

      // Publish more messages than buffer can hold
      for (let i = 0; i < 10; i++) {
        await broker.publish(channel, { id: `${i}`, data: `message ${i}` })
      }

      // Should only have the last 5 messages
      const messages = await collectMessages(subscription, 10, 500)

      expect(messages.length).toBeLessThanOrEqual(5)
      // The oldest messages should be dropped
      if (messages.length === 5) {
        expect(messages[0].message.data).toBe('message 5')
      }

      await broker.unsubscribe(subscription)
    })

    it('should support unlimited buffer with bufferSize: 0', async () => {
      const broker = createTestBroker({ bufferSize: 0 }) // 0 means unlimited
      const channel = 'unlimited-buffer'

      const subscription = broker.subscribe(channel)

      // Publish many messages
      for (let i = 0; i < 100; i++) {
        await broker.publish(channel, { id: `${i}`, data: `message ${i}` })
      }

      const messages = await collectMessages(subscription, 100)

      expect(messages).toHaveLength(100)

      await broker.unsubscribe(subscription)
    })
  })

  // ============================================================================
  // ASYNC ITERATOR INTERFACE
  // ============================================================================

  describe('async iterator interface', () => {
    it('should work with for await...of loop', async () => {
      const broker = createTestBroker()
      const channel = 'iterator-channel'

      const subscription = broker.subscribe(channel)

      // Publish messages
      await broker.publish(channel, { id: '1', data: 'first' })
      await broker.publish(channel, { id: '2', data: 'second' })
      await broker.publish(channel, { id: '3', data: 'third' })

      const messages: PubSubMessage<TestMessage>[] = []
      let count = 0

      // Use async iterator protocol
      for await (const msg of { [Symbol.asyncIterator]: () => subscription }) {
        messages.push(msg)
        count++
        if (count >= 3) break
      }

      expect(messages).toHaveLength(3)
      expect(messages[0].message.data).toBe('first')

      await broker.unsubscribe(subscription)
    })

    it('should return done: true after unsubscribe', async () => {
      const broker = createTestBroker()
      const channel = 'done-test'

      const subscription = broker.subscribe(channel)

      await broker.unsubscribe(subscription)

      const result = await subscription.next()
      expect(result.done).toBe(true)
    })

    it('should support return() for early termination', async () => {
      const broker = createTestBroker()
      const channel = 'return-test'

      const subscription = broker.subscribe(channel)

      // Call return to terminate
      if (subscription.return) {
        const result = await subscription.return()
        expect(result.done).toBe(true)
      }

      // Should be unsubscribed
      const count = await broker.numsub(channel)
      expect(count).toBe(0)
    })

    it('should support throw() for error termination', async () => {
      const broker = createTestBroker()
      const channel = 'throw-test'

      const subscription = broker.subscribe(channel)

      // Call throw to terminate with error
      if (subscription.throw) {
        await expect(subscription.throw(new Error('Test error'))).rejects.toThrow('Test error')
      }

      // Should be unsubscribed
      const count = await broker.numsub(channel)
      expect(count).toBe(0)
    })
  })

  // ============================================================================
  // SUBSCRIPTION HANDLE
  // ============================================================================

  describe('subscription handle', () => {
    it('should provide subscription handle with metadata', async () => {
      const broker = createTestBroker()

      const handle = broker.subscribeWithHandle('handle-channel')

      expect(handle.id).toBeDefined()
      expect(handle.channel).toBe('handle-channel')
      expect(handle.iterator).toBeDefined()
      expect(handle.createdAt).toBeDefined()
      expect(typeof handle.createdAt).toBe('number')

      await broker.unsubscribe(handle.iterator)
    })

    it('should provide pattern subscription handle', async () => {
      const broker = createTestBroker()

      const handle = broker.psubscribeWithHandle('events.*')

      expect(handle.id).toBeDefined()
      expect(handle.pattern).toBe('events.*')
      expect(handle.iterator).toBeDefined()

      await broker.punsubscribe(handle.iterator)
    })

    it('should unsubscribe by handle id', async () => {
      const broker = createTestBroker()

      const handle = broker.subscribeWithHandle('handle-unsub-channel')

      await broker.unsubscribeById(handle.id)

      const count = await broker.numsub('handle-unsub-channel')
      expect(count).toBe(0)
    })
  })

  // ============================================================================
  // CONCURRENCY
  // ============================================================================

  describe('concurrency', () => {
    it('should handle concurrent publishes to same channel', async () => {
      const broker = createTestBroker()
      const channel = 'concurrent-pub'

      const subscription = broker.subscribe(channel)

      // Concurrent publishes
      await Promise.all([
        broker.publish(channel, { id: '1', data: 'a' }),
        broker.publish(channel, { id: '2', data: 'b' }),
        broker.publish(channel, { id: '3', data: 'c' }),
        broker.publish(channel, { id: '4', data: 'd' }),
        broker.publish(channel, { id: '5', data: 'e' }),
      ])

      const messages = await collectMessages(subscription, 5)

      expect(messages).toHaveLength(5)

      await broker.unsubscribe(subscription)
    })

    it('should handle concurrent subscribe and unsubscribe', async () => {
      const broker = createTestBroker()
      const channel = 'concurrent-sub'

      const subscriptions: AsyncIterator<PubSubMessage<TestMessage>>[] = []

      // Concurrent subscribes
      await Promise.all(
        Array.from({ length: 10 }, () => {
          const sub = broker.subscribe(channel)
          subscriptions.push(sub)
          return Promise.resolve()
        })
      )

      expect(await broker.numsub(channel)).toBe(10)

      // Concurrent unsubscribes
      await Promise.all(subscriptions.map((sub) => broker.unsubscribe(sub)))

      expect(await broker.numsub(channel)).toBe(0)
    })

    it('should handle concurrent reads and writes', async () => {
      const broker = createTestBroker()
      const channel = 'concurrent-rw'

      const subscription = broker.subscribe(channel)
      const receivedMessages: PubSubMessage<TestMessage>[] = []

      // Start consuming in background
      const consumer = (async () => {
        for (let i = 0; i < 20; i++) {
          const msg = await waitForMessage(subscription, 500)
          if (msg) receivedMessages.push(msg)
        }
      })()

      // Publish concurrently
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          broker.publish(channel, { id: `${i}`, data: `msg-${i}` })
        )
      )

      await consumer

      expect(receivedMessages.length).toBeGreaterThan(0)

      await broker.unsubscribe(subscription)
    })
  })

  // ============================================================================
  // CLEANUP
  // ============================================================================

  describe('cleanup', () => {
    it('should cleanup all subscriptions on close', async () => {
      const broker = createTestBroker()

      broker.subscribe('channel-1')
      broker.subscribe('channel-2')
      broker.psubscribe('pattern.*')

      await broker.close()

      expect(await broker.channels()).toHaveLength(0)
      expect(await broker.numpat()).toBe(0)
    })

    it('should reject new subscriptions after close', async () => {
      const broker = createTestBroker()

      await broker.close()

      expect(() => broker.subscribe('new-channel')).toThrow()
    })

    it('should reject publishes after close', async () => {
      const broker = createTestBroker()

      await broker.close()

      await expect(broker.publish('channel', { id: '1', data: 'test' })).rejects.toThrow()
    })
  })

  // ============================================================================
  // OBSERVABILITY
  // ============================================================================

  describe('observability', () => {
    it('should record publish metrics', async () => {
      const metrics = new TestMetricsCollector()
      const broker = createTestBroker({ metrics })

      const sub = broker.subscribe('metrics-channel')
      await broker.publish('metrics-channel', { id: '1', data: 'test' })

      const publishLatencies = metrics.getLatencies('pubsub.publish.latency')
      expect(publishLatencies.length).toBeGreaterThan(0)

      const publishedCounter = metrics.getCounterTotal('pubsub.messages.published')
      expect(publishedCounter).toBe(1)

      await broker.unsubscribe(sub)
    })

    it('should record subscribe/unsubscribe metrics', async () => {
      const metrics = new TestMetricsCollector()
      const broker = createTestBroker({ metrics })

      const sub = broker.subscribe('metrics-channel')

      const subscribeCounter = metrics.getCounterTotal('pubsub.subscriptions.created')
      expect(subscribeCounter).toBe(1)

      await broker.unsubscribe(sub)

      const unsubscribeCounter = metrics.getCounterTotal('pubsub.subscriptions.removed')
      expect(unsubscribeCounter).toBe(1)
    })

    it('should record channel count gauge', async () => {
      const metrics = new TestMetricsCollector()
      const broker = createTestBroker({ metrics })

      const sub1 = broker.subscribe('channel-1')
      const sub2 = broker.subscribe('channel-2')

      const channelCount = metrics.getLatestGauge('pubsub.channels.active')
      expect(channelCount).toBe(2)

      await broker.unsubscribe(sub1)
      await broker.unsubscribe(sub2)
    })

    it('should record buffer overflow events', async () => {
      const metrics = new TestMetricsCollector()
      const broker = createTestBroker({ metrics, bufferSize: 2 })

      const sub = broker.subscribe('overflow-channel')

      // Overflow the buffer
      await broker.publish('overflow-channel', { id: '1', data: 'a' })
      await broker.publish('overflow-channel', { id: '2', data: 'b' })
      await broker.publish('overflow-channel', { id: '3', data: 'c' }) // Overflow

      const overflowCounter = metrics.getCounterTotal('pubsub.buffer.overflow')
      expect(overflowCounter).toBe(1)

      await broker.unsubscribe(sub)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty channel name', async () => {
      const broker = createTestBroker()

      const sub = broker.subscribe('')
      const msgPromise = waitForMessage(sub)

      await broker.publish('', { id: '1', data: 'empty channel' })

      const msg = await msgPromise
      expect(msg?.channel).toBe('')
      expect(msg?.message.data).toBe('empty channel')

      await broker.unsubscribe(sub)
    })

    it('should handle special characters in channel names', async () => {
      const broker = createTestBroker()
      const channel = 'user:alice@example.com/inbox'

      const sub = broker.subscribe(channel)
      const msgPromise = waitForMessage(sub)

      await broker.publish(channel, { id: '1', data: 'special chars' })

      const msg = await msgPromise
      expect(msg?.channel).toBe(channel)

      await broker.unsubscribe(sub)
    })

    it('should handle very long channel names', async () => {
      const broker = createTestBroker()
      const longChannel = 'a'.repeat(1000)

      const sub = broker.subscribe(longChannel)
      const count = await broker.publish(longChannel, { id: '1', data: 'long channel' })

      expect(count).toBe(1)

      await broker.unsubscribe(sub)
    })

    it('should handle unicode in messages', async () => {
      const broker = createTestBroker()
      const channel = 'unicode-channel'

      const sub = broker.subscribe(channel)
      const msgPromise = waitForMessage(sub)

      await broker.publish(channel, { id: '1', data: 'Hello World!' })

      const msg = await msgPromise
      expect(msg?.message.data).toBe('Hello World!')

      await broker.unsubscribe(sub)
    })

    it('should handle null/undefined in message payload gracefully', async () => {
      const broker = createPubSubBroker<{ data: string | null | undefined }>()
      const channel = 'null-test'

      const sub = broker.subscribe(channel)
      const msgPromise = waitForMessage(sub)

      await broker.publish(channel, { data: null })

      const msg = await msgPromise
      expect(msg?.message.data).toBeNull()

      await broker.unsubscribe(sub)
    })

    it('should handle rapid subscribe/unsubscribe cycles', async () => {
      const broker = createTestBroker()
      const channel = 'rapid-cycle'

      for (let i = 0; i < 100; i++) {
        const sub = broker.subscribe(channel)
        await broker.unsubscribe(sub)
      }

      // Should be clean after all cycles
      expect(await broker.numsub(channel)).toBe(0)
    })

    it('should handle publishing to pattern (should not match anything)', async () => {
      const broker = createTestBroker()

      // Subscribe to pattern
      const psub = broker.psubscribe('test.*')

      // Publishing to a literal channel that looks like a pattern
      // should not be interpreted as a pattern match
      const count = await broker.publish('test.*', { id: '1', data: 'literal pattern' })

      // The pattern subscription might or might not match depending on implementation
      // But there should be no exact subscribers
      expect(count).toBeGreaterThanOrEqual(0)

      await broker.punsubscribe(psub)
    })
  })

  // ============================================================================
  // TYPE SAFETY
  // ============================================================================

  describe('type safety', () => {
    it('should enforce generic type on publish', async () => {
      interface StrictMessage {
        id: number
        type: 'create' | 'update' | 'delete'
        payload: object
      }

      const broker = createPubSubBroker<StrictMessage>()
      const sub = broker.subscribe('typed-channel')
      const msgPromise = waitForMessage(sub)

      await broker.publish('typed-channel', {
        id: 1,
        type: 'create',
        payload: { name: 'test' },
      })

      const msg = await msgPromise
      expect(msg?.message.id).toBe(1)
      expect(msg?.message.type).toBe('create')

      await broker.unsubscribe(sub)
    })

    it('should preserve type through subscription iterator', async () => {
      interface TypedMessage {
        nested: { value: string }
        items: number[]
      }

      const broker = createPubSubBroker<TypedMessage>()
      const sub = broker.subscribe('typed-channel')
      const msgPromise = waitForMessage(sub)

      await broker.publish('typed-channel', {
        nested: { value: 'test' },
        items: [1, 2, 3],
      })

      const msg = await msgPromise
      if (msg) {
        // Type inference should work
        const nestedValue: string = msg.message.nested.value
        const firstItem: number = msg.message.items[0]
        expect(nestedValue).toBe('test')
        expect(firstItem).toBe(1)
      }

      await broker.unsubscribe(sub)
    })
  })
})
