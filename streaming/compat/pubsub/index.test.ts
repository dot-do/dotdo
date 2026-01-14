/**
 * @dotdo/pubsub - Google Cloud Pub/Sub SDK compat tests
 *
 * Tests for @google-cloud/pubsub API compatibility backed by in-memory storage:
 * - PubSub client creation
 * - Topic management (create, get, delete, list)
 * - Subscription management
 * - Publish messages
 * - Pull messages (sync)
 * - Streaming pull (async)
 * - Message ack/nack
 * - Message attributes and ordering
 *
 * @see https://cloud.google.com/pubsub/docs/reference/libraries
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  PubSub,
  Topic,
  Subscription,
  Message,
  _clearAll,
  TopicNotFoundError,
  SubscriptionNotFoundError,
  TopicExistsError,
  SubscriptionExistsError,
  InvalidMessageError,
  AckDeadlineError,
} from './index'

// ============================================================================
// PUBSUB CLIENT TESTS
// ============================================================================

describe('PubSub Client', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should create client with default config', () => {
    const pubsub = new PubSub()
    expect(pubsub).toBeDefined()
  })

  it('should create client with projectId', () => {
    const pubsub = new PubSub({ projectId: 'my-project' })
    expect(pubsub).toBeDefined()
    expect(pubsub.projectId).toBe('my-project')
  })

  it('should create client with credentials', () => {
    const pubsub = new PubSub({
      projectId: 'my-project',
      credentials: {
        client_email: 'test@test.iam.gserviceaccount.com',
        private_key: 'test-key',
      },
    })
    expect(pubsub).toBeDefined()
  })

  it('should create client with keyFilename', () => {
    const pubsub = new PubSub({
      projectId: 'my-project',
      keyFilename: '/path/to/keyfile.json',
    })
    expect(pubsub).toBeDefined()
  })

  it('should close client', async () => {
    const pubsub = new PubSub()
    await pubsub.close()
    // Should not throw
  })
})

// ============================================================================
// TOPIC MANAGEMENT TESTS
// ============================================================================

describe('Topic Management', () => {
  let pubsub: PubSub

  beforeEach(() => {
    _clearAll()
    pubsub = new PubSub({ projectId: 'test-project' })
  })

  describe('createTopic', () => {
    it('should create a topic', async () => {
      const [topic] = await pubsub.createTopic('my-topic')

      expect(topic).toBeDefined()
      expect(topic.name).toContain('my-topic')
    })

    it('should create topic with full resource name', async () => {
      const [topic] = await pubsub.createTopic('projects/test-project/topics/my-topic')

      expect(topic.name).toBe('projects/test-project/topics/my-topic')
    })

    it('should throw error for duplicate topic', async () => {
      await pubsub.createTopic('duplicate-topic')

      await expect(
        pubsub.createTopic('duplicate-topic')
      ).rejects.toThrow(TopicExistsError)
    })

    it('should create topic with labels', async () => {
      const [topic] = await pubsub.createTopic('labeled-topic', {
        labels: { env: 'test', team: 'platform' },
      })

      expect(topic).toBeDefined()
    })
  })

  describe('topic', () => {
    it('should get topic reference by name', () => {
      const topic = pubsub.topic('my-topic')

      expect(topic).toBeDefined()
      expect(topic.name).toContain('my-topic')
    })

    it('should get topic reference with options', () => {
      const topic = pubsub.topic('my-topic', {
        batching: { maxMessages: 100, maxMilliseconds: 100 },
      })

      expect(topic).toBeDefined()
    })
  })

  describe('getTopics', () => {
    beforeEach(async () => {
      await pubsub.createTopic('topic-1')
      await pubsub.createTopic('topic-2')
      await pubsub.createTopic('topic-3')
    })

    it('should list all topics', async () => {
      const [topics] = await pubsub.getTopics()

      expect(topics).toHaveLength(3)
    })

    it('should paginate topics', async () => {
      const [topics] = await pubsub.getTopics({ pageSize: 2 })

      expect(topics.length).toBeLessThanOrEqual(2)
    })

    it('should return empty array when no topics', async () => {
      _clearAll()
      const [topics] = await pubsub.getTopics()

      expect(topics).toEqual([])
    })
  })

  describe('Topic.exists', () => {
    it('should return true for existing topic', async () => {
      await pubsub.createTopic('existing-topic')
      const topic = pubsub.topic('existing-topic')

      const [exists] = await topic.exists()

      expect(exists).toBe(true)
    })

    it('should return false for non-existing topic', async () => {
      const topic = pubsub.topic('non-existing')

      const [exists] = await topic.exists()

      expect(exists).toBe(false)
    })
  })

  describe('Topic.get', () => {
    it('should get existing topic', async () => {
      await pubsub.createTopic('get-me')
      const topic = pubsub.topic('get-me')

      const [retrieved] = await topic.get()

      expect(retrieved).toBeDefined()
    })

    it('should create topic if autoCreate is true', async () => {
      const topic = pubsub.topic('auto-create')

      const [retrieved] = await topic.get({ autoCreate: true })

      expect(retrieved).toBeDefined()
    })

    it('should throw if topic does not exist', async () => {
      const topic = pubsub.topic('non-existing')

      await expect(topic.get()).rejects.toThrow(TopicNotFoundError)
    })
  })

  describe('Topic.getMetadata', () => {
    it('should get topic metadata', async () => {
      await pubsub.createTopic('metadata-topic')
      const topic = pubsub.topic('metadata-topic')

      const [metadata] = await topic.getMetadata()

      expect(metadata.name).toContain('metadata-topic')
    })
  })

  describe('Topic.delete', () => {
    it('should delete a topic', async () => {
      await pubsub.createTopic('delete-me')
      const topic = pubsub.topic('delete-me')

      await topic.delete()

      const [exists] = await topic.exists()
      expect(exists).toBe(false)
    })

    it('should throw error for non-existing topic', async () => {
      const topic = pubsub.topic('non-existing')

      await expect(topic.delete()).rejects.toThrow(TopicNotFoundError)
    })
  })
})

// ============================================================================
// SUBSCRIPTION MANAGEMENT TESTS
// ============================================================================

describe('Subscription Management', () => {
  let pubsub: PubSub
  let topic: Topic

  beforeEach(async () => {
    _clearAll()
    pubsub = new PubSub({ projectId: 'test-project' })
    const [t] = await pubsub.createTopic('test-topic')
    topic = t
  })

  describe('Topic.createSubscription', () => {
    it('should create a subscription', async () => {
      const [subscription] = await topic.createSubscription('my-sub')

      expect(subscription).toBeDefined()
      expect(subscription.name).toContain('my-sub')
    })

    it('should create subscription with ack deadline', async () => {
      const [subscription] = await topic.createSubscription('deadline-sub', {
        ackDeadlineSeconds: 60,
      })

      expect(subscription).toBeDefined()
    })

    it('should create subscription with push config', async () => {
      const [subscription] = await topic.createSubscription('push-sub', {
        pushConfig: {
          pushEndpoint: 'https://example.com.ai/push',
        },
      })

      expect(subscription).toBeDefined()
    })

    it('should create subscription with message retention', async () => {
      const [subscription] = await topic.createSubscription('retention-sub', {
        messageRetentionDuration: { seconds: 604800 }, // 7 days
      })

      expect(subscription).toBeDefined()
    })

    it('should create subscription with filter', async () => {
      const [subscription] = await topic.createSubscription('filter-sub', {
        filter: 'attributes.type = "important"',
      })

      expect(subscription).toBeDefined()
    })

    it('should throw error for duplicate subscription', async () => {
      await topic.createSubscription('duplicate-sub')

      await expect(
        topic.createSubscription('duplicate-sub')
      ).rejects.toThrow(SubscriptionExistsError)
    })

    it('should create subscription with dead letter policy', async () => {
      const [dlqTopic] = await pubsub.createTopic('dlq-topic')
      const [subscription] = await topic.createSubscription('dlq-sub', {
        deadLetterPolicy: {
          deadLetterTopic: dlqTopic.name,
          maxDeliveryAttempts: 5,
        },
      })

      expect(subscription).toBeDefined()
    })

    it('should create subscription with ordering enabled', async () => {
      const [subscription] = await topic.createSubscription('ordered-sub', {
        enableMessageOrdering: true,
      })

      expect(subscription).toBeDefined()
    })
  })

  describe('subscription', () => {
    it('should get subscription reference by name', () => {
      const subscription = pubsub.subscription('my-sub')

      expect(subscription).toBeDefined()
      expect(subscription.name).toContain('my-sub')
    })
  })

  describe('Topic.getSubscriptions', () => {
    beforeEach(async () => {
      await topic.createSubscription('sub-1')
      await topic.createSubscription('sub-2')
    })

    it('should list subscriptions for topic', async () => {
      const [subscriptions] = await topic.getSubscriptions()

      expect(subscriptions).toHaveLength(2)
    })
  })

  describe('getSubscriptions', () => {
    beforeEach(async () => {
      await topic.createSubscription('sub-1')
      await topic.createSubscription('sub-2')
    })

    it('should list all subscriptions', async () => {
      const [subscriptions] = await pubsub.getSubscriptions()

      expect(subscriptions.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Subscription.exists', () => {
    it('should return true for existing subscription', async () => {
      await topic.createSubscription('existing-sub')
      const subscription = pubsub.subscription('existing-sub')

      const [exists] = await subscription.exists()

      expect(exists).toBe(true)
    })

    it('should return false for non-existing subscription', async () => {
      const subscription = pubsub.subscription('non-existing')

      const [exists] = await subscription.exists()

      expect(exists).toBe(false)
    })
  })

  describe('Subscription.get', () => {
    it('should get existing subscription', async () => {
      await topic.createSubscription('get-me')
      const subscription = pubsub.subscription('get-me')

      const [retrieved] = await subscription.get()

      expect(retrieved).toBeDefined()
    })

    it('should throw if subscription does not exist', async () => {
      const subscription = pubsub.subscription('non-existing')

      await expect(subscription.get()).rejects.toThrow(SubscriptionNotFoundError)
    })
  })

  describe('Subscription.delete', () => {
    it('should delete a subscription', async () => {
      await topic.createSubscription('delete-me')
      const subscription = pubsub.subscription('delete-me')

      await subscription.delete()

      const [exists] = await subscription.exists()
      expect(exists).toBe(false)
    })

    it('should throw error for non-existing subscription', async () => {
      const subscription = pubsub.subscription('non-existing')

      await expect(subscription.delete()).rejects.toThrow(SubscriptionNotFoundError)
    })
  })

  describe('Subscription.modifyPushConfig', () => {
    it('should modify push config', async () => {
      await topic.createSubscription('push-sub')
      const subscription = pubsub.subscription('push-sub')

      await subscription.modifyPushConfig({
        pushEndpoint: 'https://example.com.ai/new-push',
      })

      // Should not throw
    })
  })
})

// ============================================================================
// PUBLISH MESSAGES TESTS
// ============================================================================

describe('Publish Messages', () => {
  let pubsub: PubSub
  let topic: Topic

  beforeEach(async () => {
    _clearAll()
    pubsub = new PubSub({ projectId: 'test-project' })
    const [t] = await pubsub.createTopic('publish-topic')
    topic = t
  })

  describe('Topic.publish', () => {
    it('should publish a Buffer message', async () => {
      const messageId = await topic.publish(Buffer.from('Hello World'))

      expect(messageId).toBeDefined()
      expect(typeof messageId).toBe('string')
    })

    it('should publish a string message', async () => {
      const messageId = await topic.publish(Buffer.from('Hello World'))

      expect(messageId).toBeDefined()
    })
  })

  describe('Topic.publishMessage', () => {
    it('should publish message with data', async () => {
      const messageId = await topic.publishMessage({
        data: Buffer.from('Hello'),
      })

      expect(messageId).toBeDefined()
    })

    it('should publish message with attributes', async () => {
      const messageId = await topic.publishMessage({
        data: Buffer.from('Hello'),
        attributes: { key: 'value', priority: 'high' },
      })

      expect(messageId).toBeDefined()
    })

    it('should publish message with ordering key', async () => {
      const messageId = await topic.publishMessage({
        data: Buffer.from('Hello'),
        orderingKey: 'order-1',
      })

      expect(messageId).toBeDefined()
    })

    it('should throw error for invalid message', async () => {
      await expect(
        topic.publishMessage({} as any)
      ).rejects.toThrow(InvalidMessageError)
    })
  })

  describe('Topic.publishJSON', () => {
    it('should publish JSON message', async () => {
      const messageId = await topic.publishJSON({ hello: 'world', count: 42 })

      expect(messageId).toBeDefined()
    })

    it('should publish JSON with attributes', async () => {
      const messageId = await topic.publishJSON(
        { hello: 'world' },
        { key: 'value' }
      )

      expect(messageId).toBeDefined()
    })
  })
})

// ============================================================================
// PULL MESSAGES TESTS (SYNC)
// ============================================================================

describe('Pull Messages (Sync)', () => {
  let pubsub: PubSub
  let topic: Topic
  let subscription: Subscription

  beforeEach(async () => {
    _clearAll()
    pubsub = new PubSub({ projectId: 'test-project' })
    const [t] = await pubsub.createTopic('pull-topic')
    topic = t
    const [s] = await topic.createSubscription('pull-sub')
    subscription = s
  })

  describe('Subscription.pull', () => {
    beforeEach(async () => {
      await topic.publishMessage({ data: Buffer.from('Message 1') })
      await topic.publishMessage({ data: Buffer.from('Message 2') })
    })

    it('should pull messages', async () => {
      const [messages] = await subscription.pull({ maxMessages: 10 })

      expect(messages.length).toBeGreaterThan(0)
      expect(messages[0].data).toBeDefined()
    })

    it('should limit pulled messages', async () => {
      const [messages] = await subscription.pull({ maxMessages: 1 })

      expect(messages).toHaveLength(1)
    })

    it('should return message attributes', async () => {
      await topic.publishMessage({
        data: Buffer.from('With attrs'),
        attributes: { type: 'test' },
      })

      const [messages] = await subscription.pull({ maxMessages: 10 })

      const msgWithAttrs = messages.find(m => m.attributes?.type === 'test')
      expect(msgWithAttrs?.attributes?.type).toBe('test')
    })

    it('should return empty array when no messages', async () => {
      _clearAll()
      pubsub = new PubSub({ projectId: 'test-project' })
      const [t] = await pubsub.createTopic('empty-topic')
      const [s] = await t.createSubscription('empty-sub')

      const [messages] = await s.pull({ maxMessages: 10 })

      expect(messages).toEqual([])
    })
  })
})

// ============================================================================
// MESSAGE ACK/NACK TESTS
// ============================================================================

describe('Message Ack/Nack', () => {
  let pubsub: PubSub
  let topic: Topic
  let subscription: Subscription

  beforeEach(async () => {
    _clearAll()
    pubsub = new PubSub({ projectId: 'test-project' })
    const [t] = await pubsub.createTopic('ack-topic')
    topic = t
    const [s] = await topic.createSubscription('ack-sub')
    subscription = s
  })

  describe('Message.ack', () => {
    it('should acknowledge a message', async () => {
      await topic.publishMessage({ data: Buffer.from('Ack me') })
      const [messages] = await subscription.pull({ maxMessages: 1 })

      messages[0].ack()

      // Message should not be returned again
      const [secondPull] = await subscription.pull({ maxMessages: 10 })
      expect(secondPull.find(m => m.id === messages[0].id)).toBeUndefined()
    })

    it('should handle multiple acks', async () => {
      await topic.publishMessage({ data: Buffer.from('Message 1') })
      await topic.publishMessage({ data: Buffer.from('Message 2') })
      const [messages] = await subscription.pull({ maxMessages: 10 })

      messages.forEach(msg => msg.ack())

      const [secondPull] = await subscription.pull({ maxMessages: 10 })
      expect(secondPull).toHaveLength(0)
    })
  })

  describe('Message.nack', () => {
    it('should nack a message for redelivery', async () => {
      await topic.publishMessage({ data: Buffer.from('Nack me') })
      const [messages] = await subscription.pull({ maxMessages: 1 })

      messages[0].nack()

      // Message should be available again
      const [secondPull] = await subscription.pull({ maxMessages: 10 })
      expect(secondPull.length).toBeGreaterThan(0)
    })
  })

  describe('Message.modifyAckDeadline', () => {
    it('should modify ack deadline', async () => {
      await topic.publishMessage({ data: Buffer.from('Extend me') })
      const [messages] = await subscription.pull({ maxMessages: 1 })

      messages[0].modifyAckDeadline(120)

      // Should not throw
    })

    it('should throw for invalid deadline', async () => {
      await topic.publishMessage({ data: Buffer.from('Invalid') })
      const [messages] = await subscription.pull({ maxMessages: 1 })

      expect(() => messages[0].modifyAckDeadline(-1)).toThrow(AckDeadlineError)
    })
  })

  describe('Subscription.ack', () => {
    it('should acknowledge by ack ID', async () => {
      await topic.publishMessage({ data: Buffer.from('Ack by ID') })
      const [messages] = await subscription.pull({ maxMessages: 1 })

      await subscription.ack(messages[0].ackId)

      const [secondPull] = await subscription.pull({ maxMessages: 10 })
      expect(secondPull).toHaveLength(0)
    })

    it('should acknowledge multiple ack IDs', async () => {
      await topic.publishMessage({ data: Buffer.from('Message 1') })
      await topic.publishMessage({ data: Buffer.from('Message 2') })
      const [messages] = await subscription.pull({ maxMessages: 10 })

      await subscription.ack(messages.map(m => m.ackId))

      const [secondPull] = await subscription.pull({ maxMessages: 10 })
      expect(secondPull).toHaveLength(0)
    })
  })
})

// ============================================================================
// STREAMING PULL TESTS (ASYNC)
// ============================================================================

describe('Streaming Pull (Async)', () => {
  let pubsub: PubSub
  let topic: Topic
  let subscription: Subscription

  beforeEach(async () => {
    _clearAll()
    pubsub = new PubSub({ projectId: 'test-project' })
    const [t] = await pubsub.createTopic('stream-topic')
    topic = t
    const [s] = await t.createSubscription('stream-sub')
    subscription = s
  })

  afterEach(() => {
    subscription.removeAllListeners()
  })

  it('should emit message events', async () => {
    const messages: Message[] = []

    subscription.on('message', (message: Message) => {
      messages.push(message)
      message.ack()
    })

    await topic.publishMessage({ data: Buffer.from('Event message') })

    // Wait for message processing
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(messages.length).toBeGreaterThanOrEqual(1)
  })

  it('should emit error events', async () => {
    const errors: Error[] = []

    subscription.on('error', (error: Error) => {
      errors.push(error)
    })

    // Trigger an error condition
    subscription.emit('error', new Error('Test error'))

    expect(errors).toHaveLength(1)
  })

  it('should emit close events', async () => {
    let closed = false

    subscription.on('close', () => {
      closed = true
    })

    await subscription.close()

    expect(closed).toBe(true)
  })

  it('should stop receiving after close', async () => {
    const messages: Message[] = []

    subscription.on('message', (message: Message) => {
      messages.push(message)
      message.ack()
    })

    await subscription.close()
    await topic.publishMessage({ data: Buffer.from('After close') })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(messages).toHaveLength(0)
  })

  it('should support once listener', async () => {
    const messages: Message[] = []

    subscription.once('message', (message: Message) => {
      messages.push(message)
      message.ack()
    })

    await topic.publishMessage({ data: Buffer.from('First') })
    await topic.publishMessage({ data: Buffer.from('Second') })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(messages).toHaveLength(1)
  })
})

// ============================================================================
// MESSAGE ATTRIBUTES AND ORDERING TESTS
// ============================================================================

describe('Message Attributes and Ordering', () => {
  let pubsub: PubSub
  let topic: Topic
  let subscription: Subscription

  beforeEach(async () => {
    _clearAll()
    pubsub = new PubSub({ projectId: 'test-project' })
    const [t] = await pubsub.createTopic('attr-topic')
    topic = t
    const [s] = await t.createSubscription('attr-sub', {
      enableMessageOrdering: true,
    })
    subscription = s
  })

  describe('Message Attributes', () => {
    it('should preserve all attributes', async () => {
      await topic.publishMessage({
        data: Buffer.from('With attributes'),
        attributes: {
          string: 'value',
          number: '42',
          bool: 'true',
        },
      })

      const [messages] = await subscription.pull({ maxMessages: 1 })

      expect(messages[0].attributes).toEqual({
        string: 'value',
        number: '42',
        bool: 'true',
      })
    })

    it('should handle empty attributes', async () => {
      await topic.publishMessage({
        data: Buffer.from('No attributes'),
      })

      const [messages] = await subscription.pull({ maxMessages: 1 })

      expect(messages[0].attributes).toEqual({})
    })

    it('should handle special characters in attributes', async () => {
      await topic.publishMessage({
        data: Buffer.from('Special'),
        attributes: {
          'key-with-dash': 'value with spaces',
          'key_with_underscore': 'value/with/slashes',
        },
      })

      const [messages] = await subscription.pull({ maxMessages: 1 })

      expect(messages[0].attributes?.['key-with-dash']).toBe('value with spaces')
    })
  })

  describe('Message Ordering', () => {
    it('should maintain order for same ordering key', async () => {
      await topic.publishMessage({
        data: Buffer.from('First'),
        orderingKey: 'order-1',
      })
      await topic.publishMessage({
        data: Buffer.from('Second'),
        orderingKey: 'order-1',
      })
      await topic.publishMessage({
        data: Buffer.from('Third'),
        orderingKey: 'order-1',
      })

      const [messages] = await subscription.pull({ maxMessages: 10 })

      const orderedMessages = messages.filter(m => m.orderingKey === 'order-1')
      expect(orderedMessages[0].data.toString()).toBe('First')
      expect(orderedMessages[1].data.toString()).toBe('Second')
      expect(orderedMessages[2].data.toString()).toBe('Third')
    })

    it('should allow interleaved ordering keys', async () => {
      await topic.publishMessage({
        data: Buffer.from('A1'),
        orderingKey: 'key-a',
      })
      await topic.publishMessage({
        data: Buffer.from('B1'),
        orderingKey: 'key-b',
      })
      await topic.publishMessage({
        data: Buffer.from('A2'),
        orderingKey: 'key-a',
      })

      const [messages] = await subscription.pull({ maxMessages: 10 })

      const keyAMessages = messages.filter(m => m.orderingKey === 'key-a')
      expect(keyAMessages[0].data.toString()).toBe('A1')
      expect(keyAMessages[1].data.toString()).toBe('A2')
    })
  })

  describe('Message Data', () => {
    it('should handle binary data', async () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE])

      await topic.publishMessage({
        data: binaryData,
      })

      const [messages] = await subscription.pull({ maxMessages: 1 })

      expect(Buffer.compare(messages[0].data, binaryData)).toBe(0)
    })

    it('should handle large messages', async () => {
      const largeData = Buffer.alloc(1024 * 1024, 'x') // 1MB

      await topic.publishMessage({
        data: largeData,
      })

      const [messages] = await subscription.pull({ maxMessages: 1 })

      expect(messages[0].data.length).toBe(largeData.length)
    })

    it('should handle empty data with attributes', async () => {
      await topic.publishMessage({
        data: Buffer.alloc(0),
        attributes: { type: 'empty' },
      })

      const [messages] = await subscription.pull({ maxMessages: 1 })

      expect(messages[0].data.length).toBe(0)
      expect(messages[0].attributes?.type).toBe('empty')
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  let pubsub: PubSub

  beforeEach(() => {
    _clearAll()
    pubsub = new PubSub({ projectId: 'test-project' })
  })

  it('should handle complete message lifecycle', async () => {
    // Create topic
    const [topic] = await pubsub.createTopic('lifecycle-topic')

    // Create subscription
    const [subscription] = await topic.createSubscription('lifecycle-sub')

    // Publish messages
    for (let i = 0; i < 5; i++) {
      await topic.publishMessage({
        data: Buffer.from(JSON.stringify({ index: i })),
        attributes: { index: i.toString() },
      })
    }

    // Pull and process messages
    const [messages] = await subscription.pull({ maxMessages: 10 })
    expect(messages.length).toBe(5)

    // Ack all messages
    messages.forEach(msg => msg.ack())

    // Verify no more messages
    const [remaining] = await subscription.pull({ maxMessages: 10 })
    expect(remaining).toHaveLength(0)

    // Delete subscription
    await subscription.delete()

    // Delete topic
    await topic.delete()

    // Verify cleanup
    const [topics] = await pubsub.getTopics()
    expect(topics.find(t => t.name.includes('lifecycle-topic'))).toBeUndefined()
  })

  it('should handle multiple subscriptions to same topic', async () => {
    const [topic] = await pubsub.createTopic('multi-sub-topic')
    const [sub1] = await topic.createSubscription('sub-1')
    const [sub2] = await topic.createSubscription('sub-2')

    // Publish message
    await topic.publishMessage({ data: Buffer.from('Shared message') })

    // Both subscriptions should receive the message
    const [messages1] = await sub1.pull({ maxMessages: 10 })
    const [messages2] = await sub2.pull({ maxMessages: 10 })

    expect(messages1).toHaveLength(1)
    expect(messages2).toHaveLength(1)

    // Acking in one subscription should not affect the other
    messages1[0].ack()

    const [remaining1] = await sub1.pull({ maxMessages: 10 })
    const [remaining2] = await sub2.pull({ maxMessages: 10 })

    expect(remaining1).toHaveLength(0)
    expect(remaining2).toHaveLength(1) // Still has the message
  })

  it('should handle high throughput publishing', async () => {
    const [topic] = await pubsub.createTopic('throughput-topic')
    const [subscription] = await topic.createSubscription('throughput-sub')

    // Publish many messages in parallel
    const publishPromises = []
    for (let i = 0; i < 100; i++) {
      publishPromises.push(
        topic.publishMessage({
          data: Buffer.from(`Message ${i}`),
        })
      )
    }

    const messageIds = await Promise.all(publishPromises)
    expect(messageIds).toHaveLength(100)

    // All message IDs should be unique
    const uniqueIds = new Set(messageIds)
    expect(uniqueIds.size).toBe(100)

    // Pull all messages
    let totalMessages = 0
    let attempts = 0
    while (totalMessages < 100 && attempts < 20) {
      const [messages] = await subscription.pull({ maxMessages: 10 })
      messages.forEach(msg => msg.ack())
      totalMessages += messages.length
      attempts++
    }

    expect(totalMessages).toBe(100)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  let pubsub: PubSub

  beforeEach(() => {
    _clearAll()
    pubsub = new PubSub({ projectId: 'test-project' })
  })

  it('should throw TopicNotFoundError for operations on non-existing topic', async () => {
    const topic = pubsub.topic('non-existing')

    await expect(topic.get()).rejects.toThrow(TopicNotFoundError)
    await expect(topic.delete()).rejects.toThrow(TopicNotFoundError)
    await expect(topic.getMetadata()).rejects.toThrow(TopicNotFoundError)
  })

  it('should throw SubscriptionNotFoundError for operations on non-existing subscription', async () => {
    const subscription = pubsub.subscription('non-existing')

    await expect(subscription.get()).rejects.toThrow(SubscriptionNotFoundError)
    await expect(subscription.delete()).rejects.toThrow(SubscriptionNotFoundError)
  })

  it('should throw TopicExistsError for duplicate topic creation', async () => {
    await pubsub.createTopic('existing')

    await expect(pubsub.createTopic('existing')).rejects.toThrow(TopicExistsError)
  })

  it('should throw InvalidMessageError for invalid messages', async () => {
    const [topic] = await pubsub.createTopic('error-topic')

    await expect(topic.publishMessage({} as any)).rejects.toThrow(InvalidMessageError)
    await expect(topic.publishMessage({ data: null as any })).rejects.toThrow(InvalidMessageError)
  })
})
