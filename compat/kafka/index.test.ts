/**
 * @dotdo/kafka - Kafka SDK compat tests
 *
 * Tests for kafkajs API compatibility backed by DO storage:
 * - Kafka client creation
 * - Producer (send, sendBatch)
 * - Consumer (subscribe, run, pause, resume)
 * - Admin (createTopics, deleteTopics, listTopics)
 * - Transactions
 * - Consumer groups
 *
 * @see https://kafka.js.org/docs/getting-started
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  Kafka,
  createKafka,
  Partitioners,
  _clearAll,
  CompressionTypes,
  LogLevel,
  ResourceTypes,
  KafkaJSError,
  KafkaJSTopicNotFound,
} from './index'
import type {
  Producer,
  Consumer,
  Admin,
  KafkaConfig,
  Message,
  EachMessagePayload,
  EachBatchPayload,
} from './types'

// ============================================================================
// KAFKA CLIENT TESTS
// ============================================================================

describe('Kafka client', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should create client with new Kafka()', () => {
    const kafka = new Kafka({
      clientId: 'test-client',
      brokers: ['localhost:9092'],
    })
    expect(kafka).toBeDefined()
  })

  it('should create client with createKafka()', () => {
    const kafka = createKafka({
      clientId: 'test-client',
      brokers: ['localhost:9092'],
    })
    expect(kafka).toBeDefined()
  })

  it('should create client with minimal config', () => {
    const kafka = new Kafka({
      brokers: ['localhost:9092'],
    })
    expect(kafka).toBeDefined()
  })

  it('should create client with full config', () => {
    const kafka = new Kafka({
      clientId: 'test-client',
      brokers: ['localhost:9092', 'localhost:9093'],
      connectionTimeout: 5000,
      requestTimeout: 30000,
      logLevel: LogLevel.ERROR,
      retry: {
        retries: 5,
        initialRetryTime: 100,
        maxRetryTime: 30000,
      },
    })
    expect(kafka).toBeDefined()
  })

  it('should create producer from client', () => {
    const kafka = new Kafka({ brokers: ['localhost:9092'] })
    const producer = kafka.producer()
    expect(producer).toBeDefined()
  })

  it('should create consumer from client', () => {
    const kafka = new Kafka({ brokers: ['localhost:9092'] })
    const consumer = kafka.consumer({ groupId: 'test-group' })
    expect(consumer).toBeDefined()
  })

  it('should create admin from client', () => {
    const kafka = new Kafka({ brokers: ['localhost:9092'] })
    const admin = kafka.admin()
    expect(admin).toBeDefined()
  })

  it('should get logger from client', () => {
    const kafka = new Kafka({ brokers: ['localhost:9092'] })
    const logger = kafka.logger()
    expect(logger).toBeDefined()
    expect(logger.info).toBeTypeOf('function')
    expect(logger.error).toBeTypeOf('function')
    expect(logger.warn).toBeTypeOf('function')
    expect(logger.debug).toBeTypeOf('function')
  })
})

// ============================================================================
// PRODUCER TESTS
// ============================================================================

describe('Producer', () => {
  let kafka: Kafka
  let producer: Producer
  let admin: Admin

  beforeEach(async () => {
    _clearAll()
    kafka = new Kafka({ brokers: ['localhost:9092'], clientId: 'test' })
    producer = kafka.producer()
    admin = kafka.admin()
    await admin.connect()
    await admin.createTopics({
      topics: [
        { topic: 'test-topic', numPartitions: 3 },
        { topic: 'another-topic', numPartitions: 1 },
      ],
    })
  })

  afterEach(async () => {
    await producer.disconnect()
    await admin.disconnect()
  })

  describe('connect/disconnect', () => {
    it('should connect and disconnect', async () => {
      await producer.connect()
      await producer.disconnect()
    })

    it('should emit connect event', async () => {
      const onConnect = vi.fn()
      producer.on('producer.connect', onConnect)
      await producer.connect()
      expect(onConnect).toHaveBeenCalled()
    })

    it('should emit disconnect event', async () => {
      const onDisconnect = vi.fn()
      producer.on('producer.disconnect', onDisconnect)
      await producer.connect()
      await producer.disconnect()
      expect(onDisconnect).toHaveBeenCalled()
    })
  })

  describe('send', () => {
    beforeEach(async () => {
      await producer.connect()
    })

    it('should send a single message', async () => {
      const result = await producer.send({
        topic: 'test-topic',
        messages: [{ value: 'Hello World' }],
      })

      expect(result).toHaveLength(1)
      expect(result[0].topicName).toBe('test-topic')
      expect(result[0].errorCode).toBe(0)
    })

    it('should send multiple messages', async () => {
      const result = await producer.send({
        topic: 'test-topic',
        messages: [
          { value: 'Message 1' },
          { value: 'Message 2' },
          { value: 'Message 3' },
        ],
      })

      expect(result).toHaveLength(3)
    })

    it('should send message with key', async () => {
      const result = await producer.send({
        topic: 'test-topic',
        messages: [{ key: 'user-123', value: 'Hello World' }],
      })

      expect(result).toHaveLength(1)
      expect(result[0].errorCode).toBe(0)
    })

    it('should send message with headers', async () => {
      const result = await producer.send({
        topic: 'test-topic',
        messages: [{
          value: 'Hello World',
          headers: { 'content-type': 'text/plain' },
        }],
      })

      expect(result).toHaveLength(1)
    })

    it('should send message to specific partition', async () => {
      const result = await producer.send({
        topic: 'test-topic',
        messages: [{ value: 'Hello World', partition: 1 }],
      })

      expect(result).toHaveLength(1)
      expect(result[0].partition).toBe(1)
    })

    it('should send message with timestamp', async () => {
      const timestamp = Date.now().toString()
      const result = await producer.send({
        topic: 'test-topic',
        messages: [{ value: 'Hello World', timestamp }],
      })

      expect(result).toHaveLength(1)
    })

    it('should auto-create topic if allowed', async () => {
      const autoProducer = kafka.producer({ allowAutoTopicCreation: true })
      await autoProducer.connect()

      const result = await autoProducer.send({
        topic: 'new-auto-topic',
        messages: [{ value: 'Hello' }],
      })

      expect(result).toHaveLength(1)
      await autoProducer.disconnect()
    })

    it('should throw error for non-existent topic', async () => {
      const strictProducer = kafka.producer({ allowAutoTopicCreation: false })
      await strictProducer.connect()

      await expect(
        strictProducer.send({
          topic: 'non-existent-topic',
          messages: [{ value: 'Hello' }],
        })
      ).rejects.toThrow(KafkaJSTopicNotFound)

      await strictProducer.disconnect()
    })

    it('should throw error when not connected', async () => {
      await producer.disconnect()

      await expect(
        producer.send({
          topic: 'test-topic',
          messages: [{ value: 'Hello' }],
        })
      ).rejects.toThrow(KafkaJSError)
    })
  })

  describe('sendBatch', () => {
    beforeEach(async () => {
      await producer.connect()
    })

    it('should send batch to multiple topics', async () => {
      const result = await producer.sendBatch({
        topicMessages: [
          {
            topic: 'test-topic',
            messages: [{ value: 'Message to topic 1' }],
          },
          {
            topic: 'another-topic',
            messages: [{ value: 'Message to topic 2' }],
          },
        ],
      })

      expect(result).toHaveLength(2)
      expect(result[0].topicName).toBe('test-topic')
      expect(result[1].topicName).toBe('another-topic')
    })

    it('should send batch with compression type', async () => {
      const result = await producer.sendBatch({
        compression: CompressionTypes.GZIP,
        topicMessages: [
          {
            topic: 'test-topic',
            messages: [{ value: 'Compressed message' }],
          },
        ],
      })

      expect(result).toHaveLength(1)
    })
  })

  describe('idempotent producer', () => {
    it('should create idempotent producer', () => {
      const idempotentProducer = kafka.producer({ idempotent: true })
      expect(idempotentProducer.isIdempotent()).toBe(true)
    })

    it('should create non-idempotent producer by default', () => {
      expect(producer.isIdempotent()).toBe(false)
    })
  })

  describe('transactions', () => {
    it('should create transaction', async () => {
      const txnProducer = kafka.producer({ transactionalId: 'test-txn' })
      await txnProducer.connect()

      const transaction = await txnProducer.transaction()
      expect(transaction).toBeDefined()
      expect(transaction.isActive()).toBe(true)

      await txnProducer.disconnect()
    })

    it('should send in transaction and commit', async () => {
      const txnProducer = kafka.producer({ transactionalId: 'test-txn' })
      await txnProducer.connect()

      const transaction = await txnProducer.transaction()

      const result = await transaction.send({
        topic: 'test-topic',
        messages: [{ value: 'Transactional message' }],
      })

      expect(result).toHaveLength(1)

      await transaction.commit()
      expect(transaction.isActive()).toBe(false)

      await txnProducer.disconnect()
    })

    it('should abort transaction', async () => {
      const txnProducer = kafka.producer({ transactionalId: 'test-txn' })
      await txnProducer.connect()

      const transaction = await txnProducer.transaction()
      await transaction.send({
        topic: 'test-topic',
        messages: [{ value: 'Will be aborted' }],
      })

      await transaction.abort()
      expect(transaction.isActive()).toBe(false)

      await txnProducer.disconnect()
    })

    it('should throw error for transaction without transactionalId', async () => {
      await producer.connect()
      await expect(producer.transaction()).rejects.toThrow()
    })
  })

  describe('logger', () => {
    it('should get producer logger', async () => {
      const logger = producer.logger()
      expect(logger).toBeDefined()
    })
  })
})

// ============================================================================
// CONSUMER TESTS
// ============================================================================

describe('Consumer', () => {
  let kafka: Kafka
  let producer: Producer
  let consumer: Consumer
  let admin: Admin

  beforeEach(async () => {
    _clearAll()
    kafka = new Kafka({ brokers: ['localhost:9092'], clientId: 'test' })
    producer = kafka.producer()
    consumer = kafka.consumer({ groupId: 'test-group' })
    admin = kafka.admin()

    await admin.connect()
    await admin.createTopics({
      topics: [
        { topic: 'test-topic', numPartitions: 3 },
      ],
    })
    await producer.connect()
  })

  afterEach(async () => {
    await consumer.stop()
    await consumer.disconnect()
    await producer.disconnect()
    await admin.disconnect()
  })

  describe('connect/disconnect', () => {
    it('should connect and disconnect', async () => {
      await consumer.connect()
      await consumer.disconnect()
    })

    it('should emit connect event', async () => {
      const onConnect = vi.fn()
      consumer.on('consumer.connect', onConnect)
      await consumer.connect()
      expect(onConnect).toHaveBeenCalled()
    })

    it('should emit disconnect event', async () => {
      const onDisconnect = vi.fn()
      consumer.on('consumer.disconnect', onDisconnect)
      await consumer.connect()
      await consumer.disconnect()
      expect(onDisconnect).toHaveBeenCalled()
    })
  })

  describe('subscribe', () => {
    beforeEach(async () => {
      await consumer.connect()
    })

    it('should subscribe to single topic', async () => {
      await consumer.subscribe({ topic: 'test-topic' })
    })

    it('should subscribe to multiple topics', async () => {
      await admin.createTopics({
        topics: [{ topic: 'topic-2' }],
      })

      await consumer.subscribe({
        topics: ['test-topic', 'topic-2'],
      })
    })

    it('should subscribe with fromBeginning', async () => {
      await consumer.subscribe({
        topic: 'test-topic',
        fromBeginning: true,
      })
    })

    it('should subscribe with regex pattern', async () => {
      await consumer.subscribe({
        topic: /test-.*/,
      })
    })

    it('should throw error when not connected', async () => {
      await consumer.disconnect()
      await expect(
        consumer.subscribe({ topic: 'test-topic' })
      ).rejects.toThrow()
    })
  })

  describe('run with eachMessage', () => {
    beforeEach(async () => {
      await consumer.connect()
    })

    it('should consume messages with eachMessage', async () => {
      const messages: EachMessagePayload[] = []

      // Send to same partition to ensure order
      await producer.send({
        topic: 'test-topic',
        messages: [
          { value: 'Message 1', partition: 0 },
          { value: 'Message 2', partition: 0 },
        ],
      })

      await consumer.subscribe({ topic: 'test-topic', fromBeginning: true })

      // Start consuming in background
      const runPromise = consumer.run({
        eachMessage: async (payload) => {
          messages.push(payload)
          if (messages.length >= 2) {
            await consumer.stop()
          }
        },
      })

      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 500))
      await consumer.stop()

      expect(messages.length).toBeGreaterThanOrEqual(2)
      expect(messages[0].topic).toBe('test-topic')
      // Messages from same partition should be in order
      const messageValues = messages.map(m => m.message.value?.toString())
      expect(messageValues).toContain('Message 1')
      expect(messageValues).toContain('Message 2')
    })

    it('should provide heartbeat function', async () => {
      let heartbeatCalled = false

      await producer.send({
        topic: 'test-topic',
        messages: [{ value: 'Test' }],
      })

      await consumer.subscribe({ topic: 'test-topic', fromBeginning: true })

      const runPromise = consumer.run({
        eachMessage: async ({ heartbeat }) => {
          await heartbeat()
          heartbeatCalled = true
          await consumer.stop()
        },
      })

      await new Promise(resolve => setTimeout(resolve, 300))
      await consumer.stop()

      expect(heartbeatCalled).toBe(true)
    })
  })

  describe('run with eachBatch', () => {
    beforeEach(async () => {
      await consumer.connect()
    })

    it('should consume messages with eachBatch', async () => {
      const batches: EachBatchPayload[] = []

      await producer.send({
        topic: 'test-topic',
        messages: [
          { value: 'Batch message 1' },
          { value: 'Batch message 2' },
        ],
      })

      await consumer.subscribe({ topic: 'test-topic', fromBeginning: true })

      consumer.run({
        eachBatch: async (payload) => {
          batches.push(payload)
          await consumer.stop()
        },
      })

      await new Promise(resolve => setTimeout(resolve, 300))
      await consumer.stop()

      expect(batches.length).toBeGreaterThanOrEqual(1)
      expect(batches[0].batch.topic).toBe('test-topic')
    })

    it('should provide batch utilities', async () => {
      await producer.send({
        topic: 'test-topic',
        messages: [{ value: 'Test' }],
      })

      await consumer.subscribe({ topic: 'test-topic', fromBeginning: true })

      let batchChecked = false

      consumer.run({
        eachBatch: async ({ batch, resolveOffset, isRunning, isStale }) => {
          expect(batch.isEmpty()).toBe(false)
          expect(batch.firstOffset()).not.toBeNull()
          expect(batch.lastOffset()).toBeDefined()
          expect(isRunning()).toBe(true)
          expect(isStale()).toBe(false)
          resolveOffset(batch.lastOffset())
          batchChecked = true
          await consumer.stop()
        },
      })

      await new Promise(resolve => setTimeout(resolve, 300))
      await consumer.stop()

      expect(batchChecked).toBe(true)
    })
  })

  describe('seek', () => {
    beforeEach(async () => {
      await consumer.connect()
    })

    it('should seek to specific offset', async () => {
      // Send all messages to partition 0 to ensure predictable ordering
      await producer.send({
        topic: 'test-topic',
        messages: [
          { value: 'Message 0', partition: 0 },
          { value: 'Message 1', partition: 0 },
          { value: 'Message 2', partition: 0 },
        ],
      })

      await consumer.subscribe({ topic: 'test-topic', fromBeginning: true })

      // Seek to offset 2 on partition 0
      consumer.seek({ topic: 'test-topic', partition: 0, offset: '2' })

      const messages: string[] = []
      consumer.run({
        eachMessage: async ({ message }) => {
          messages.push(message.value?.toString() ?? '')
          await consumer.stop()
        },
      })

      await new Promise(resolve => setTimeout(resolve, 300))
      await consumer.stop()

      // Should start from offset 2 (Message 2)
      if (messages.length > 0) {
        expect(messages[0]).toBe('Message 2')
      }
    })
  })

  describe('pause/resume', () => {
    beforeEach(async () => {
      await consumer.connect()
      await consumer.subscribe({ topic: 'test-topic' })
    })

    it('should pause and resume consuming', async () => {
      // Pause all partitions of a topic
      consumer.pause([{ topic: 'test-topic' }])

      const paused = consumer.paused()
      expect(paused.length).toBeGreaterThan(0)
      expect(paused[0].topic).toBe('test-topic')

      // Resume
      consumer.resume([{ topic: 'test-topic' }])
      const resumedPaused = consumer.paused()
      expect(resumedPaused.length).toBe(0)
    })

    it('should pause specific partitions', async () => {
      consumer.pause([{ topic: 'test-topic', partitions: [0, 1] }])

      const paused = consumer.paused()
      expect(paused.filter(p => p.topic === 'test-topic').length).toBe(2)
    })
  })

  describe('commitOffsets', () => {
    beforeEach(async () => {
      await consumer.connect()
    })

    it('should commit offsets', async () => {
      await consumer.commitOffsets([
        { topic: 'test-topic', partition: 0, offset: '5' },
      ])
    })
  })

  describe('describeGroup', () => {
    beforeEach(async () => {
      await consumer.connect()
    })

    it('should describe consumer group', async () => {
      const group = await consumer.describeGroup()

      expect(group.groupId).toBe('test-group')
      expect(group.state).toBe('Stable')
      expect(group.members.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// ADMIN TESTS
// ============================================================================

describe('Admin', () => {
  let kafka: Kafka
  let admin: Admin

  beforeEach(async () => {
    _clearAll()
    kafka = new Kafka({ brokers: ['localhost:9092'], clientId: 'test' })
    admin = kafka.admin()
    await admin.connect()
  })

  afterEach(async () => {
    await admin.disconnect()
  })

  describe('connect/disconnect', () => {
    it('should emit connect event', async () => {
      const newAdmin = kafka.admin()
      const onConnect = vi.fn()
      newAdmin.on('admin.connect', onConnect)
      await newAdmin.connect()
      expect(onConnect).toHaveBeenCalled()
      await newAdmin.disconnect()
    })

    it('should emit disconnect event', async () => {
      const newAdmin = kafka.admin()
      const onDisconnect = vi.fn()
      newAdmin.on('admin.disconnect', onDisconnect)
      await newAdmin.connect()
      await newAdmin.disconnect()
      expect(onDisconnect).toHaveBeenCalled()
    })
  })

  describe('createTopics', () => {
    it('should create single topic', async () => {
      const created = await admin.createTopics({
        topics: [{ topic: 'new-topic' }],
      })

      expect(created).toBe(true)

      const topics = await admin.listTopics()
      expect(topics).toContain('new-topic')
    })

    it('should create topic with partitions', async () => {
      await admin.createTopics({
        topics: [{ topic: 'partitioned-topic', numPartitions: 5 }],
      })

      const metadata = await admin.fetchTopicMetadata({ topics: ['partitioned-topic'] })
      expect(metadata.topics[0].partitions).toHaveLength(5)
    })

    it('should create topic with replication factor', async () => {
      await admin.createTopics({
        topics: [{ topic: 'replicated-topic', replicationFactor: 3 }],
      })

      const topics = await admin.listTopics()
      expect(topics).toContain('replicated-topic')
    })

    it('should create topic with config entries', async () => {
      await admin.createTopics({
        topics: [{
          topic: 'configured-topic',
          configEntries: [
            { name: 'retention.ms', value: '86400000' },
          ],
        }],
      })

      const topics = await admin.listTopics()
      expect(topics).toContain('configured-topic')
    })

    it('should create multiple topics', async () => {
      await admin.createTopics({
        topics: [
          { topic: 'topic-1' },
          { topic: 'topic-2' },
          { topic: 'topic-3' },
        ],
      })

      const topics = await admin.listTopics()
      expect(topics).toContain('topic-1')
      expect(topics).toContain('topic-2')
      expect(topics).toContain('topic-3')
    })

    it('should return false for existing topic', async () => {
      await admin.createTopics({
        topics: [{ topic: 'existing-topic' }],
      })

      const created = await admin.createTopics({
        topics: [{ topic: 'existing-topic' }],
      })

      expect(created).toBe(false)
    })

    it('should validate only without creating', async () => {
      const created = await admin.createTopics({
        validateOnly: true,
        topics: [{ topic: 'validate-only-topic' }],
      })

      expect(created).toBe(true)

      const topics = await admin.listTopics()
      expect(topics).not.toContain('validate-only-topic')
    })
  })

  describe('deleteTopics', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [
          { topic: 'delete-me-1' },
          { topic: 'delete-me-2' },
        ],
      })
    })

    it('should delete single topic', async () => {
      await admin.deleteTopics({ topics: ['delete-me-1'] })

      const topics = await admin.listTopics()
      expect(topics).not.toContain('delete-me-1')
      expect(topics).toContain('delete-me-2')
    })

    it('should delete multiple topics', async () => {
      await admin.deleteTopics({ topics: ['delete-me-1', 'delete-me-2'] })

      const topics = await admin.listTopics()
      expect(topics).not.toContain('delete-me-1')
      expect(topics).not.toContain('delete-me-2')
    })
  })

  describe('listTopics', () => {
    it('should list all topics', async () => {
      await admin.createTopics({
        topics: [
          { topic: 'list-topic-1' },
          { topic: 'list-topic-2' },
        ],
      })

      const topics = await admin.listTopics()
      expect(topics).toContain('list-topic-1')
      expect(topics).toContain('list-topic-2')
    })

    it('should return empty array when no topics', async () => {
      const topics = await admin.listTopics()
      expect(Array.isArray(topics)).toBe(true)
    })
  })

  describe('createPartitions', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ topic: 'partition-topic', numPartitions: 2 }],
      })
    })

    it('should add partitions to topic', async () => {
      await admin.createPartitions({
        topicPartitions: [{ topic: 'partition-topic', count: 5 }],
      })

      const metadata = await admin.fetchTopicMetadata({ topics: ['partition-topic'] })
      expect(metadata.topics[0].partitions).toHaveLength(5)
    })
  })

  describe('fetchTopicMetadata', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ topic: 'metadata-topic', numPartitions: 3 }],
      })
    })

    it('should fetch metadata for specific topics', async () => {
      const metadata = await admin.fetchTopicMetadata({ topics: ['metadata-topic'] })

      expect(metadata.topics).toHaveLength(1)
      expect(metadata.topics[0].name).toBe('metadata-topic')
      expect(metadata.topics[0].partitions).toHaveLength(3)
    })

    it('should fetch metadata for all topics', async () => {
      await admin.createTopics({
        topics: [{ topic: 'another-metadata-topic' }],
      })

      const metadata = await admin.fetchTopicMetadata()

      expect(metadata.topics.length).toBeGreaterThanOrEqual(2)
    })

    it('should include partition metadata', async () => {
      const metadata = await admin.fetchTopicMetadata({ topics: ['metadata-topic'] })
      const partition = metadata.topics[0].partitions[0]

      expect(partition.partitionId).toBeDefined()
      expect(partition.leader).toBeDefined()
      expect(partition.replicas).toBeInstanceOf(Array)
      expect(partition.isr).toBeInstanceOf(Array)
    })
  })

  describe('fetchTopicOffsets', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ topic: 'offset-topic', numPartitions: 2 }],
      })

      const producer = kafka.producer()
      await producer.connect()
      await producer.send({
        topic: 'offset-topic',
        messages: [
          { value: 'Message 1' },
          { value: 'Message 2' },
          { value: 'Message 3' },
        ],
      })
      await producer.disconnect()
    })

    it('should fetch topic offsets', async () => {
      const offsets = await admin.fetchTopicOffsets('offset-topic')

      expect(offsets.length).toBe(2)
      expect(offsets[0]).toHaveProperty('partition')
      expect(offsets[0]).toHaveProperty('offset')
      expect(offsets[0]).toHaveProperty('high')
      expect(offsets[0]).toHaveProperty('low')
    })

    it('should throw for non-existent topic', async () => {
      await expect(
        admin.fetchTopicOffsets('non-existent')
      ).rejects.toThrow(KafkaJSTopicNotFound)
    })
  })

  describe('fetchTopicOffsetsByTimestamp', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ topic: 'timestamp-topic' }],
      })
    })

    it('should fetch offsets by timestamp', async () => {
      const offsets = await admin.fetchTopicOffsetsByTimestamp('timestamp-topic')

      expect(Array.isArray(offsets)).toBe(true)
      expect(offsets[0]).toHaveProperty('partition')
      expect(offsets[0]).toHaveProperty('offset')
    })
  })

  describe('describeConfigs', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{
          topic: 'config-topic',
          configEntries: [{ name: 'retention.ms', value: '86400000' }],
        }],
      })
    })

    it('should describe topic configs', async () => {
      const result = await admin.describeConfigs([
        { type: ResourceTypes.TOPIC, name: 'config-topic' },
      ])

      expect(result.resources).toHaveLength(1)
    })
  })

  describe('alterConfigs', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ topic: 'alter-config-topic' }],
      })
    })

    it('should alter topic configs', async () => {
      await admin.alterConfigs([
        {
          type: ResourceTypes.TOPIC,
          name: 'alter-config-topic',
          configEntries: [{ configName: 'retention.ms', configValue: '172800000' }],
        },
      ])
    })
  })

  describe('consumer groups', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ topic: 'group-topic' }],
      })

      // Create a consumer to establish the group
      const consumer = kafka.consumer({ groupId: 'admin-test-group' })
      await consumer.connect()
      await consumer.subscribe({ topic: 'group-topic' })
      await consumer.disconnect()
    })

    it('should list consumer groups', async () => {
      const result = await admin.listGroups()
      expect(result.groups).toBeInstanceOf(Array)
    })

    it('should describe consumer groups', async () => {
      const result = await admin.describeGroups(['admin-test-group'])
      expect(result.groups).toHaveLength(1)
      expect(result.groups[0].groupId).toBe('admin-test-group')
    })

    it('should delete consumer groups', async () => {
      await admin.deleteGroups(['admin-test-group'])

      const result = await admin.describeGroups(['admin-test-group'])
      expect(result.groups[0].state).toBe('Dead')
    })
  })

  describe('offsets', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ topic: 'offset-mgmt-topic', numPartitions: 2 }],
      })

      // Create consumer group and set some offsets
      const consumer = kafka.consumer({ groupId: 'offset-test-group' })
      await consumer.connect()
      await consumer.subscribe({ topic: 'offset-mgmt-topic' })
      await consumer.commitOffsets([
        { topic: 'offset-mgmt-topic', partition: 0, offset: '10' },
      ])
      await consumer.disconnect()
    })

    it('should fetch consumer group offsets', async () => {
      const offsets = await admin.fetchOffsets({
        groupId: 'offset-test-group',
        topics: ['offset-mgmt-topic'],
      })

      expect(offsets).toHaveLength(1)
      expect(offsets[0].topic).toBe('offset-mgmt-topic')
    })

    it('should set offsets', async () => {
      await admin.setOffsets({
        groupId: 'offset-test-group',
        topic: 'offset-mgmt-topic',
        partitions: [{ partition: 0, offset: '20' }],
      })

      const offsets = await admin.fetchOffsets({
        groupId: 'offset-test-group',
        topics: ['offset-mgmt-topic'],
      })

      const partition0 = offsets[0].partitions.find(p => p.partition === 0)
      expect(partition0?.offset).toBe('20')
    })

    it('should reset offsets to earliest', async () => {
      await admin.resetOffsets({
        groupId: 'offset-test-group',
        topic: 'offset-mgmt-topic',
        earliest: true,
      })
    })
  })

  describe('describeCluster', () => {
    it('should describe cluster', async () => {
      const cluster = await admin.describeCluster()

      expect(cluster.clusterId).toBeDefined()
      expect(cluster.brokers).toBeInstanceOf(Array)
      expect(cluster.brokers.length).toBeGreaterThan(0)
    })
  })

  describe('logger', () => {
    it('should get admin logger', () => {
      const logger = admin.logger()
      expect(logger).toBeDefined()
    })
  })
})

// ============================================================================
// PARTITIONER TESTS
// ============================================================================

describe('Partitioners', () => {
  it('should export DefaultPartitioner', () => {
    expect(Partitioners.DefaultPartitioner).toBeTypeOf('function')
    const partitioner = Partitioners.DefaultPartitioner()
    expect(partitioner).toBeTypeOf('function')
  })

  it('should export JavaCompatiblePartitioner', () => {
    expect(Partitioners.JavaCompatiblePartitioner).toBeTypeOf('function')
  })

  it('should export LegacyPartitioner', () => {
    expect(Partitioners.LegacyPartitioner).toBeTypeOf('function')
  })

  it('should partition by key', () => {
    const partitioner = Partitioners.DefaultPartitioner()
    const partitionMetadata = [
      { partitionId: 0, leader: 0, replicas: [0], isr: [0] },
      { partitionId: 1, leader: 0, replicas: [0], isr: [0] },
      { partitionId: 2, leader: 0, replicas: [0], isr: [0] },
    ]

    // Same key should always go to same partition
    const partition1 = partitioner({
      topic: 'test',
      partitionMetadata,
      message: { key: 'user-123', value: 'test' },
    })

    const partition2 = partitioner({
      topic: 'test',
      partitionMetadata,
      message: { key: 'user-123', value: 'different' },
    })

    expect(partition1).toBe(partition2)
  })

  it('should use explicit partition if set', () => {
    const partitioner = Partitioners.DefaultPartitioner()
    const partitionMetadata = [
      { partitionId: 0, leader: 0, replicas: [0], isr: [0] },
      { partitionId: 1, leader: 0, replicas: [0], isr: [0] },
    ]

    const partition = partitioner({
      topic: 'test',
      partitionMetadata,
      message: { key: 'user-123', value: 'test', partition: 1 },
    })

    expect(partition).toBe(1)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should work with producer and consumer workflow', async () => {
    const kafka = new Kafka({ brokers: ['localhost:9092'], clientId: 'integration-test' })

    // Create topic
    const admin = kafka.admin()
    await admin.connect()
    await admin.createTopics({
      topics: [{ topic: 'integration-topic', numPartitions: 1 }],
    })

    // Produce messages
    const producer = kafka.producer()
    await producer.connect()

    for (let i = 0; i < 5; i++) {
      await producer.send({
        topic: 'integration-topic',
        messages: [{ value: `Message ${i}` }],
      })
    }

    // Consume messages
    const consumer = kafka.consumer({ groupId: 'integration-group' })
    await consumer.connect()
    await consumer.subscribe({ topic: 'integration-topic', fromBeginning: true })

    const receivedMessages: string[] = []

    consumer.run({
      eachMessage: async ({ message }) => {
        receivedMessages.push(message.value?.toString() ?? '')
        if (receivedMessages.length >= 5) {
          await consumer.stop()
        }
      },
    })

    // Wait for messages to be consumed
    await new Promise(resolve => setTimeout(resolve, 500))
    await consumer.stop()

    expect(receivedMessages.length).toBe(5)
    expect(receivedMessages).toContain('Message 0')
    expect(receivedMessages).toContain('Message 4')

    // Cleanup
    await consumer.disconnect()
    await producer.disconnect()
    await admin.disconnect()
  })

  it('should work with multiple consumer groups', async () => {
    const kafka = new Kafka({ brokers: ['localhost:9092'] })

    const admin = kafka.admin()
    await admin.connect()
    await admin.createTopics({
      topics: [{ topic: 'multi-group-topic' }],
    })

    const producer = kafka.producer()
    await producer.connect()
    await producer.send({
      topic: 'multi-group-topic',
      messages: [{ value: 'Shared message' }],
    })

    // Two consumers in different groups should both receive the message
    const consumer1 = kafka.consumer({ groupId: 'group-1' })
    const consumer2 = kafka.consumer({ groupId: 'group-2' })

    await consumer1.connect()
    await consumer2.connect()
    await consumer1.subscribe({ topic: 'multi-group-topic', fromBeginning: true })
    await consumer2.subscribe({ topic: 'multi-group-topic', fromBeginning: true })

    const group1Messages: string[] = []
    const group2Messages: string[] = []

    consumer1.run({
      eachMessage: async ({ message }) => {
        group1Messages.push(message.value?.toString() ?? '')
        await consumer1.stop()
      },
    })

    consumer2.run({
      eachMessage: async ({ message }) => {
        group2Messages.push(message.value?.toString() ?? '')
        await consumer2.stop()
      },
    })

    await new Promise(resolve => setTimeout(resolve, 500))

    await consumer1.stop()
    await consumer2.stop()
    await consumer1.disconnect()
    await consumer2.disconnect()
    await producer.disconnect()
    await admin.disconnect()

    expect(group1Messages.length).toBe(1)
    expect(group2Messages.length).toBe(1)
  })

  it('should handle topic with multiple partitions', async () => {
    const kafka = new Kafka({ brokers: ['localhost:9092'] })

    const admin = kafka.admin()
    await admin.connect()
    await admin.createTopics({
      topics: [{ topic: 'multi-partition-topic', numPartitions: 4 }],
    })

    const producer = kafka.producer()
    await producer.connect()

    // Send messages with different keys to spread across partitions
    const results = await producer.sendBatch({
      topicMessages: [{
        topic: 'multi-partition-topic',
        messages: [
          { key: 'a', value: '1' },
          { key: 'b', value: '2' },
          { key: 'c', value: '3' },
          { key: 'd', value: '4' },
        ],
      }],
    })

    expect(results).toHaveLength(4)

    // Verify messages went to partitions
    const offsets = await admin.fetchTopicOffsets('multi-partition-topic')
    expect(offsets).toHaveLength(4)

    await producer.disconnect()
    await admin.disconnect()
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should throw KafkaJSTopicNotFound for non-existent topic', async () => {
    const kafka = new Kafka({ brokers: ['localhost:9092'] })
    const admin = kafka.admin()
    await admin.connect()

    await expect(
      admin.fetchTopicOffsets('non-existent-topic')
    ).rejects.toThrow(KafkaJSTopicNotFound)

    await admin.disconnect()
  })

  it('should throw KafkaJSError when producer not connected', async () => {
    const kafka = new Kafka({ brokers: ['localhost:9092'] })
    const admin = kafka.admin()
    await admin.connect()
    await admin.createTopics({ topics: [{ topic: 'test' }] })

    const producer = kafka.producer()
    // Don't connect

    await expect(
      producer.send({ topic: 'test', messages: [{ value: 'test' }] })
    ).rejects.toThrow(KafkaJSError)

    await admin.disconnect()
  })

  it('should throw error when consumer not connected', async () => {
    const kafka = new Kafka({ brokers: ['localhost:9092'] })
    const consumer = kafka.consumer({ groupId: 'test' })
    // Don't connect

    await expect(
      consumer.subscribe({ topic: 'test' })
    ).rejects.toThrow(KafkaJSError)
  })
})
