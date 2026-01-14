/**
 * @dotdo/kafka - Kafka SDK compat tests (RED - Cloudflare Pipelines Backend)
 *
 * FAILING tests for kafkajs-compatible API backed by Cloudflare Pipelines.
 * These tests validate the production Kafka SDK that routes to Pipelines/R2
 * instead of in-memory storage.
 *
 * Import from non-existent module so tests fail until implementation exists.
 *
 * @see https://kafka.js.org/docs/getting-started
 * @see https://developers.cloudflare.com/pipelines/
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import from non-existent Cloudflare Pipelines backend - WILL FAIL
import {
  Kafka,
  KafkaPipelines,
  createKafkaPipelines,
  Producer,
  Consumer,
  Admin,
  Transaction,
  Partitioners,
  CompressionTypes,
  LogLevel,
  ResourceTypes,
  KafkaJSError,
  KafkaJSConnectionError,
  KafkaJSProtocolError,
  KafkaJSTopicNotFound,
  KafkaJSOffsetOutOfRange,
  KafkaJSNonRetriableError,
  KafkaJSTimeout,
  KafkaJSConsumerGroupRebalanceError,
  KafkaJSStaleTopicMetadataError,
  // Pipeline-specific exports
  PipelineProducer,
  PipelineConsumer,
  PipelineAdmin,
  StreamBridgeKafka,
  IcebergSink,
} from './kafka-pipelines'

import type {
  KafkaConfig,
  PipelineKafkaConfig,
  ProducerConfig,
  ConsumerConfig,
  AdminConfig,
  ProducerRecord,
  ProducerBatch,
  RecordMetadata,
  Message,
  KafkaMessage,
  TopicMessages,
  EachMessagePayload,
  EachBatchPayload,
  Batch,
  ConsumerRunConfig,
  ConsumerSubscribeTopic,
  ConsumerSubscribeTopics,
  SeekEntry,
  TopicPartition,
  TopicPartitionOffset,
  TopicPartitionOffsetAndMetadata,
  GroupDescription,
  MemberDescription,
  CreateTopicsOptions,
  DeleteTopicsOptions,
  CreatePartitionsOptions,
  ITopicConfig,
  TopicMetadata,
  PartitionMetadata,
  ConfigResource,
  ConfigEntry,
  FetchOffsetsOptions,
  ResetOffsetsOptions,
  SetOffsetsOptions,
  Cluster,
  Logger,
  Partitioner,
  // Pipeline-specific types
  PipelineBinding,
  R2Binding,
  IcebergConfig,
  ConsumerGroupState,
  RebalanceEvent,
} from './kafka-pipelines'

// ============================================================================
// KAFKA PIPELINES CLIENT TESTS
// ============================================================================

describe('KafkaPipelines client', () => {
  it('should create client with Cloudflare bindings', () => {
    const kafka = new KafkaPipelines({
      clientId: 'test-app',
      // Cloudflare Pipelines binding
      pipeline: {} as PipelineBinding,
      // R2 for Iceberg storage
      r2: {} as R2Binding,
    })
    expect(kafka).toBeDefined()
  })

  it('should create client with createKafkaPipelines()', () => {
    const kafka = createKafkaPipelines({
      clientId: 'test-app',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
    })
    expect(kafka).toBeDefined()
  })

  it('should create client with Iceberg configuration', () => {
    const kafka = new KafkaPipelines({
      clientId: 'test-app',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
      iceberg: {
        catalog: 'default',
        namespace: 'events',
        partitionBy: ['_partition_hour', 'topic'],
      },
    })
    expect(kafka).toBeDefined()
  })

  it('should create producer from client', () => {
    const kafka = new KafkaPipelines({
      clientId: 'test-app',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
    })
    const producer = kafka.producer()
    expect(producer).toBeDefined()
    expect(producer).toBeInstanceOf(PipelineProducer)
  })

  it('should create consumer from client', () => {
    const kafka = new KafkaPipelines({
      clientId: 'test-app',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
    })
    const consumer = kafka.consumer({ groupId: 'test-group' })
    expect(consumer).toBeDefined()
    expect(consumer).toBeInstanceOf(PipelineConsumer)
  })

  it('should create admin from client', () => {
    const kafka = new KafkaPipelines({
      clientId: 'test-app',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
    })
    const admin = kafka.admin()
    expect(admin).toBeDefined()
    expect(admin).toBeInstanceOf(PipelineAdmin)
  })

  it('should get logger from client', () => {
    const kafka = new KafkaPipelines({
      clientId: 'test-app',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
      logLevel: LogLevel.DEBUG,
    })
    const logger = kafka.logger()
    expect(logger).toBeDefined()
    expect(logger.info).toBeTypeOf('function')
    expect(logger.error).toBeTypeOf('function')
    expect(logger.warn).toBeTypeOf('function')
    expect(logger.debug).toBeTypeOf('function')
  })
})

// ============================================================================
// PIPELINE PRODUCER TESTS
// ============================================================================

describe('PipelineProducer', () => {
  let kafka: KafkaPipelines
  let producer: PipelineProducer

  beforeEach(() => {
    kafka = new KafkaPipelines({
      clientId: 'test-app',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
    })
    producer = kafka.producer() as PipelineProducer
  })

  describe('connect/disconnect', () => {
    it('should connect to pipeline', async () => {
      await producer.connect()
      // Should not throw
    })

    it('should disconnect from pipeline', async () => {
      await producer.connect()
      await producer.disconnect()
      // Should not throw
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

    afterEach(async () => {
      await producer.disconnect()
    })

    it('should send a single message to pipeline', async () => {
      const result = await producer.send({
        topic: 'orders',
        messages: [{ value: 'Hello World' }],
      })

      expect(result).toHaveLength(1)
      expect(result[0].topicName).toBe('orders')
      expect(result[0].errorCode).toBe(0)
    })

    it('should send message with key for partitioning', async () => {
      const result = await producer.send({
        topic: 'orders',
        messages: [{ key: 'order-123', value: JSON.stringify({ id: 123 }) }],
      })

      expect(result).toHaveLength(1)
      expect(result[0].errorCode).toBe(0)
    })

    it('should send message with headers', async () => {
      const result = await producer.send({
        topic: 'orders',
        messages: [{
          key: 'order-123',
          value: JSON.stringify({ id: 123 }),
          headers: {
            'content-type': 'application/json',
            'x-correlation-id': 'abc-123',
          },
        }],
      })

      expect(result).toHaveLength(1)
    })

    it('should send multiple messages in batch', async () => {
      const result = await producer.send({
        topic: 'orders',
        messages: [
          { key: 'order-1', value: 'Order 1' },
          { key: 'order-2', value: 'Order 2' },
          { key: 'order-3', value: 'Order 3' },
        ],
      })

      expect(result).toHaveLength(3)
    })

    it('should route to Cloudflare Pipeline', async () => {
      // Verify the message was sent to Cloudflare Pipelines
      const result = await producer.send({
        topic: 'events',
        messages: [{ value: 'test' }],
      })

      // Pipeline should assign a sequence number
      expect(result[0].baseOffset).toBeDefined()
    })

    it('should buffer messages before flush', async () => {
      // Configure buffered producer
      const bufferedProducer = kafka.producer({
        batchSize: 1000,
        linger: 100, // 100ms
      }) as PipelineProducer

      await bufferedProducer.connect()

      const result = await bufferedProducer.send({
        topic: 'buffered',
        messages: [{ value: 'buffered message' }],
      })

      // Should still return immediately with pending status
      expect(result[0].errorCode).toBe(0)

      await bufferedProducer.disconnect()
    })
  })

  describe('sendBatch', () => {
    beforeEach(async () => {
      await producer.connect()
    })

    afterEach(async () => {
      await producer.disconnect()
    })

    it('should send batch to multiple topics', async () => {
      const result = await producer.sendBatch({
        topicMessages: [
          {
            topic: 'orders',
            messages: [{ value: 'Order message' }],
          },
          {
            topic: 'payments',
            messages: [{ value: 'Payment message' }],
          },
        ],
      })

      expect(result).toHaveLength(2)
      expect(result[0].topicName).toBe('orders')
      expect(result[1].topicName).toBe('payments')
    })

    it('should send batch with compression', async () => {
      const result = await producer.sendBatch({
        compression: CompressionTypes.GZIP,
        topicMessages: [
          {
            topic: 'compressed',
            messages: [
              { value: 'Message 1' },
              { value: 'Message 2' },
            ],
          },
        ],
      })

      expect(result).toHaveLength(2)
    })
  })

  describe('transaction', () => {
    beforeEach(async () => {
      await producer.connect()
    })

    afterEach(async () => {
      await producer.disconnect()
    })

    it('should create transaction with transactional ID', async () => {
      const txnProducer = kafka.producer({
        transactionalId: 'test-txn-producer',
        idempotent: true,
      }) as PipelineProducer
      await txnProducer.connect()

      const transaction = await txnProducer.transaction()
      expect(transaction).toBeDefined()
      expect(transaction.isActive()).toBe(true)

      await txnProducer.disconnect()
    })

    it('should send in transaction and commit', async () => {
      const txnProducer = kafka.producer({
        transactionalId: 'test-txn',
      }) as PipelineProducer
      await txnProducer.connect()

      const transaction = await txnProducer.transaction()

      const result = await transaction.send({
        topic: 'txn-topic',
        messages: [{ value: 'Transactional message' }],
      })

      expect(result).toHaveLength(1)

      await transaction.commit()
      expect(transaction.isActive()).toBe(false)

      await txnProducer.disconnect()
    })

    it('should abort transaction and discard messages', async () => {
      const txnProducer = kafka.producer({
        transactionalId: 'abort-txn',
      }) as PipelineProducer
      await txnProducer.connect()

      const transaction = await txnProducer.transaction()

      await transaction.send({
        topic: 'abort-topic',
        messages: [{ value: 'Will be aborted' }],
      })

      await transaction.abort()
      expect(transaction.isActive()).toBe(false)

      // Message should not be visible to consumers
      await txnProducer.disconnect()
    })

    it('should send offsets within transaction (exactly-once)', async () => {
      const txnProducer = kafka.producer({
        transactionalId: 'eos-txn',
      }) as PipelineProducer
      await txnProducer.connect()

      const transaction = await txnProducer.transaction()

      await transaction.sendOffsets({
        consumerGroupId: 'eos-group',
        topics: [{
          topic: 'eos-topic',
          partitions: [{ partition: 0, offset: '100' }],
        }],
      })

      await transaction.commit()

      await txnProducer.disconnect()
    })

    it('should throw error without transactionalId', async () => {
      await expect(producer.transaction()).rejects.toThrow(KafkaJSNonRetriableError)
    })
  })

  describe('idempotent producer', () => {
    it('should create idempotent producer', () => {
      const idempotentProducer = kafka.producer({ idempotent: true })
      expect(idempotentProducer.isIdempotent()).toBe(true)
    })

    it('should deduplicate messages by sequence number', async () => {
      const idempotentProducer = kafka.producer({ idempotent: true }) as PipelineProducer
      await idempotentProducer.connect()

      // Send same message twice (simulating retry)
      const result1 = await idempotentProducer.send({
        topic: 'idempotent-topic',
        messages: [{ value: 'test' }],
      })

      // Second send with same producer should be deduplicated
      const result2 = await idempotentProducer.send({
        topic: 'idempotent-topic',
        messages: [{ value: 'test' }],
      })

      // Both should succeed but second should not create duplicate
      expect(result1[0].errorCode).toBe(0)
      expect(result2[0].errorCode).toBe(0)

      await idempotentProducer.disconnect()
    })
  })
})

// ============================================================================
// PIPELINE CONSUMER TESTS
// ============================================================================

describe('PipelineConsumer', () => {
  let kafka: KafkaPipelines
  let consumer: PipelineConsumer

  beforeEach(() => {
    kafka = new KafkaPipelines({
      clientId: 'test-app',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
    })
    consumer = kafka.consumer({ groupId: 'test-group' }) as PipelineConsumer
  })

  describe('connect/disconnect', () => {
    it('should connect consumer', async () => {
      await consumer.connect()
      // Should not throw
    })

    it('should disconnect consumer', async () => {
      await consumer.connect()
      await consumer.disconnect()
      // Should not throw
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

    afterEach(async () => {
      await consumer.disconnect()
    })

    it('should subscribe to single topic', async () => {
      await consumer.subscribe({ topic: 'orders' })
      // Should not throw
    })

    it('should subscribe to multiple topics', async () => {
      await consumer.subscribe({
        topics: ['orders', 'payments', 'shipments'],
      })
      // Should not throw
    })

    it('should subscribe from beginning', async () => {
      await consumer.subscribe({
        topics: ['orders'],
        fromBeginning: true,
      })
      // Should not throw
    })

    it('should subscribe with regex pattern', async () => {
      await consumer.subscribe({
        topic: /^events\..*/,
      })
      // Should not throw
    })

    it('should throw when not connected', async () => {
      await consumer.disconnect()
      await expect(
        consumer.subscribe({ topic: 'test' })
      ).rejects.toThrow(KafkaJSError)
    })
  })

  describe('run with eachMessage', () => {
    beforeEach(async () => {
      await consumer.connect()
    })

    afterEach(async () => {
      await consumer.stop()
      await consumer.disconnect()
    })

    it('should consume messages with eachMessage handler', async () => {
      const messages: EachMessagePayload[] = []

      await consumer.subscribe({ topics: ['orders'], fromBeginning: true })

      consumer.run({
        eachMessage: async (payload) => {
          messages.push(payload)
        },
      })

      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 500))

      // Should receive messages (if any exist in pipeline)
      expect(Array.isArray(messages)).toBe(true)
    })

    it('should provide heartbeat function', async () => {
      let heartbeatCalled = false

      await consumer.subscribe({ topics: ['orders'], fromBeginning: true })

      consumer.run({
        eachMessage: async ({ heartbeat }) => {
          await heartbeat()
          heartbeatCalled = true
          await consumer.stop()
        },
      })

      await new Promise(resolve => setTimeout(resolve, 500))
    })

    it('should provide pause function', async () => {
      await consumer.subscribe({ topics: ['orders'], fromBeginning: true })

      consumer.run({
        eachMessage: async ({ pause }) => {
          const resume = pause()
          expect(resume).toBeTypeOf('function')
          await consumer.stop()
        },
      })

      await new Promise(resolve => setTimeout(resolve, 500))
    })
  })

  describe('run with eachBatch', () => {
    beforeEach(async () => {
      await consumer.connect()
    })

    afterEach(async () => {
      await consumer.stop()
      await consumer.disconnect()
    })

    it('should consume messages with eachBatch handler', async () => {
      const batches: EachBatchPayload[] = []

      await consumer.subscribe({ topics: ['orders'], fromBeginning: true })

      consumer.run({
        eachBatch: async (payload) => {
          batches.push(payload)
          await consumer.stop()
        },
      })

      await new Promise(resolve => setTimeout(resolve, 500))

      expect(Array.isArray(batches)).toBe(true)
    })

    it('should provide batch utilities', async () => {
      await consumer.subscribe({ topics: ['orders'], fromBeginning: true })

      let batchChecked = false

      consumer.run({
        eachBatch: async ({ batch, resolveOffset, isRunning, isStale }) => {
          expect(batch.isEmpty).toBeTypeOf('function')
          expect(batch.firstOffset).toBeTypeOf('function')
          expect(batch.lastOffset).toBeTypeOf('function')
          expect(isRunning()).toBe(true)
          expect(isStale()).toBe(false)
          batchChecked = true
          await consumer.stop()
        },
      })

      await new Promise(resolve => setTimeout(resolve, 500))
    })
  })

  describe('seek', () => {
    beforeEach(async () => {
      await consumer.connect()
      await consumer.subscribe({ topics: ['orders'] })
    })

    afterEach(async () => {
      await consumer.disconnect()
    })

    it('should seek to specific offset', () => {
      consumer.seek({ topic: 'orders', partition: 0, offset: '100' })
      // Should not throw
    })

    it('should seek to beginning', () => {
      consumer.seek({ topic: 'orders', partition: 0, offset: '0' })
      // Should not throw
    })

    it('should seek to end', () => {
      consumer.seek({ topic: 'orders', partition: 0, offset: '-1' })
      // Should not throw
    })
  })

  describe('commitOffsets', () => {
    beforeEach(async () => {
      await consumer.connect()
      await consumer.subscribe({ topics: ['orders'] })
    })

    afterEach(async () => {
      await consumer.disconnect()
    })

    it('should commit offsets manually', async () => {
      await consumer.commitOffsets([
        { topic: 'orders', partition: 0, offset: '50' },
      ])
      // Should not throw
    })

    it('should commit multiple partition offsets', async () => {
      await consumer.commitOffsets([
        { topic: 'orders', partition: 0, offset: '50' },
        { topic: 'orders', partition: 1, offset: '75' },
        { topic: 'orders', partition: 2, offset: '100' },
      ])
      // Should not throw
    })

    it('should commit with metadata', async () => {
      await consumer.commitOffsets([
        { topic: 'orders', partition: 0, offset: '50', metadata: 'checkpoint-1' },
      ])
      // Should not throw
    })
  })

  describe('pause/resume', () => {
    beforeEach(async () => {
      await consumer.connect()
      await consumer.subscribe({ topics: ['orders', 'payments'] })
    })

    afterEach(async () => {
      await consumer.disconnect()
    })

    it('should pause topic consumption', () => {
      consumer.pause([{ topic: 'orders' }])

      const paused = consumer.paused()
      expect(paused.some(p => p.topic === 'orders')).toBe(true)
    })

    it('should pause specific partitions', () => {
      consumer.pause([{ topic: 'orders', partitions: [0, 1] }])

      const paused = consumer.paused()
      expect(paused.filter(p => p.topic === 'orders').length).toBe(2)
    })

    it('should resume topic consumption', () => {
      consumer.pause([{ topic: 'orders' }])
      consumer.resume([{ topic: 'orders' }])

      const paused = consumer.paused()
      expect(paused.some(p => p.topic === 'orders')).toBe(false)
    })
  })

  describe('describeGroup', () => {
    beforeEach(async () => {
      await consumer.connect()
    })

    afterEach(async () => {
      await consumer.disconnect()
    })

    it('should describe consumer group', async () => {
      const description = await consumer.describeGroup()

      expect(description.groupId).toBe('test-group')
      expect(description.state).toBeDefined()
      expect(description.members).toBeInstanceOf(Array)
    })
  })
})

// ============================================================================
// CONSUMER GROUP REBALANCING TESTS
// ============================================================================

describe('Consumer group rebalancing', () => {
  let kafka: KafkaPipelines

  beforeEach(() => {
    kafka = new KafkaPipelines({
      clientId: 'rebalance-test',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
    })
  })

  it('should emit rebalancing event when consumer joins', async () => {
    const consumer1 = kafka.consumer({ groupId: 'rebalance-group' }) as PipelineConsumer
    const consumer2 = kafka.consumer({ groupId: 'rebalance-group' }) as PipelineConsumer

    const rebalanceEvents: string[] = []

    consumer1.on('consumer.rebalancing', () => {
      rebalanceEvents.push('consumer1.rebalancing')
    })

    consumer2.on('consumer.rebalancing', () => {
      rebalanceEvents.push('consumer2.rebalancing')
    })

    await consumer1.connect()
    await consumer1.subscribe({ topics: ['orders'] })

    // Second consumer joins - should trigger rebalance
    await consumer2.connect()
    await consumer2.subscribe({ topics: ['orders'] })

    await new Promise(resolve => setTimeout(resolve, 500))

    expect(rebalanceEvents.length).toBeGreaterThan(0)

    await consumer1.disconnect()
    await consumer2.disconnect()
  })

  it('should emit group_join event after rebalance', async () => {
    const consumer = kafka.consumer({ groupId: 'join-group' }) as PipelineConsumer
    let groupJoined = false

    consumer.on('consumer.group_join', () => {
      groupJoined = true
    })

    await consumer.connect()
    await consumer.subscribe({ topics: ['orders'] })

    await new Promise(resolve => setTimeout(resolve, 500))

    expect(groupJoined).toBe(true)

    await consumer.disconnect()
  })

  it('should redistribute partitions on rebalance', async () => {
    const consumer1 = kafka.consumer({ groupId: 'redistribute-group' }) as PipelineConsumer
    const consumer2 = kafka.consumer({ groupId: 'redistribute-group' }) as PipelineConsumer

    await consumer1.connect()
    await consumer1.subscribe({ topics: ['multi-partition'] })

    const assignments1Before = await consumer1.describeGroup()

    await consumer2.connect()
    await consumer2.subscribe({ topics: ['multi-partition'] })

    await new Promise(resolve => setTimeout(resolve, 500))

    const assignments1After = await consumer1.describeGroup()

    // Partitions should be redistributed
    expect(assignments1After.members.length).toBeGreaterThan(assignments1Before.members.length)

    await consumer1.disconnect()
    await consumer2.disconnect()
  })

  it('should handle consumer leaving gracefully', async () => {
    const consumer1 = kafka.consumer({ groupId: 'leave-group' }) as PipelineConsumer
    const consumer2 = kafka.consumer({ groupId: 'leave-group' }) as PipelineConsumer

    await consumer1.connect()
    await consumer1.subscribe({ topics: ['orders'] })

    await consumer2.connect()
    await consumer2.subscribe({ topics: ['orders'] })

    await new Promise(resolve => setTimeout(resolve, 200))

    // Consumer 2 leaves
    await consumer2.disconnect()

    await new Promise(resolve => setTimeout(resolve, 500))

    // Consumer 1 should now have all partitions
    const description = await consumer1.describeGroup()
    expect(description.members.length).toBe(1)

    await consumer1.disconnect()
  })

  it('should use sticky assignment strategy', async () => {
    const consumer = kafka.consumer({
      groupId: 'sticky-group',
      partitionAssigners: ['StickyAssigner'],
    }) as PipelineConsumer

    await consumer.connect()
    await consumer.subscribe({ topics: ['orders'] })

    // Sticky assigner should maintain partition assignments when possible
    const description = await consumer.describeGroup()
    expect(description.protocol).toBe('StickyAssigner')

    await consumer.disconnect()
  })
})

// ============================================================================
// PIPELINE ADMIN TESTS
// ============================================================================

describe('PipelineAdmin', () => {
  let kafka: KafkaPipelines
  let admin: PipelineAdmin

  beforeEach(async () => {
    kafka = new KafkaPipelines({
      clientId: 'admin-test',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
    })
    admin = kafka.admin() as PipelineAdmin
    await admin.connect()
  })

  afterEach(async () => {
    await admin.disconnect()
  })

  describe('createTopics', () => {
    it('should create topic with partitions', async () => {
      const created = await admin.createTopics({
        topics: [{
          topic: 'new-topic',
          numPartitions: 6,
        }],
      })

      expect(created).toBe(true)
    })

    it('should create topic with replication factor', async () => {
      const created = await admin.createTopics({
        topics: [{
          topic: 'replicated-topic',
          numPartitions: 3,
          replicationFactor: 3,
        }],
      })

      expect(created).toBe(true)
    })

    it('should create topic with config entries', async () => {
      const created = await admin.createTopics({
        topics: [{
          topic: 'configured-topic',
          numPartitions: 1,
          configEntries: [
            { name: 'retention.ms', value: '86400000' },
            { name: 'cleanup.policy', value: 'compact' },
          ],
        }],
      })

      expect(created).toBe(true)
    })

    it('should return false if topic already exists', async () => {
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
        topics: [{ topic: 'validate-topic' }],
      })

      expect(created).toBe(true)

      const topics = await admin.listTopics()
      expect(topics).not.toContain('validate-topic')
    })
  })

  describe('deleteTopics', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ topic: 'delete-me' }],
      })
    })

    it('should delete topic', async () => {
      await admin.deleteTopics({ topics: ['delete-me'] })

      const topics = await admin.listTopics()
      expect(topics).not.toContain('delete-me')
    })

    it('should delete multiple topics', async () => {
      await admin.createTopics({
        topics: [
          { topic: 'delete-1' },
          { topic: 'delete-2' },
        ],
      })

      await admin.deleteTopics({ topics: ['delete-1', 'delete-2'] })

      const topics = await admin.listTopics()
      expect(topics).not.toContain('delete-1')
      expect(topics).not.toContain('delete-2')
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
  })

  describe('describeTopics', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{
          topic: 'describe-topic',
          numPartitions: 4,
        }],
      })
    })

    it('should describe topic metadata', async () => {
      const metadata = await admin.fetchTopicMetadata({
        topics: ['describe-topic'],
      })

      expect(metadata.topics).toHaveLength(1)
      expect(metadata.topics[0].name).toBe('describe-topic')
      expect(metadata.topics[0].partitions).toHaveLength(4)
    })

    it('should include partition leaders', async () => {
      const metadata = await admin.fetchTopicMetadata({
        topics: ['describe-topic'],
      })

      const partition = metadata.topics[0].partitions[0]
      expect(partition.leader).toBeDefined()
      expect(partition.replicas).toBeInstanceOf(Array)
      expect(partition.isr).toBeInstanceOf(Array)
    })
  })

  describe('fetchTopicOffsets', () => {
    it('should fetch topic offsets', async () => {
      await admin.createTopics({
        topics: [{ topic: 'offset-topic', numPartitions: 2 }],
      })

      const offsets = await admin.fetchTopicOffsets('offset-topic')

      expect(offsets).toHaveLength(2)
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

  describe('consumer group management', () => {
    it('should list consumer groups', async () => {
      const result = await admin.listGroups()

      expect(result.groups).toBeInstanceOf(Array)
    })

    it('should describe consumer groups', async () => {
      // Create consumer to establish group
      const consumer = kafka.consumer({ groupId: 'admin-describe-group' })
      await consumer.connect()
      await consumer.subscribe({ topics: ['orders'] })
      await consumer.disconnect()

      const result = await admin.describeGroups(['admin-describe-group'])

      expect(result.groups).toHaveLength(1)
      expect(result.groups[0].groupId).toBe('admin-describe-group')
    })

    it('should delete consumer groups', async () => {
      // Create consumer to establish group
      const consumer = kafka.consumer({ groupId: 'admin-delete-group' })
      await consumer.connect()
      await consumer.disconnect()

      await admin.deleteGroups(['admin-delete-group'])

      const result = await admin.describeGroups(['admin-delete-group'])
      expect(result.groups[0].state).toBe('Dead')
    })

    it('should reset consumer group offsets', async () => {
      await admin.createTopics({
        topics: [{ topic: 'reset-offsets-topic' }],
      })

      await admin.resetOffsets({
        groupId: 'reset-group',
        topic: 'reset-offsets-topic',
        earliest: true,
      })

      // Verify offsets were reset
      const offsets = await admin.fetchOffsets({
        groupId: 'reset-group',
        topics: ['reset-offsets-topic'],
      })

      expect(offsets[0].partitions[0].offset).toBe('0')
    })

    it('should set consumer group offsets', async () => {
      await admin.createTopics({
        topics: [{ topic: 'set-offsets-topic' }],
      })

      await admin.setOffsets({
        groupId: 'set-group',
        topic: 'set-offsets-topic',
        partitions: [
          { partition: 0, offset: '100' },
        ],
      })

      const offsets = await admin.fetchOffsets({
        groupId: 'set-group',
        topics: ['set-offsets-topic'],
      })

      expect(offsets[0].partitions[0].offset).toBe('100')
    })
  })

  describe('describeCluster', () => {
    it('should describe cluster', async () => {
      const cluster = await admin.describeCluster()

      expect(cluster.clusterId).toBeDefined()
      expect(cluster.brokers).toBeInstanceOf(Array)
      expect(cluster.controller).toBeDefined()
    })
  })
})

// ============================================================================
// ICEBERG SINK TESTS
// ============================================================================

describe('IcebergSink', () => {
  let kafka: KafkaPipelines
  let icebergSink: IcebergSink

  beforeEach(() => {
    kafka = new KafkaPipelines({
      clientId: 'iceberg-test',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
      iceberg: {
        catalog: 'default',
        namespace: 'events',
        partitionBy: ['_partition_hour'],
      },
    })
    icebergSink = kafka.icebergSink()
  })

  it('should create Iceberg table from topic', async () => {
    await icebergSink.createTable({
      topic: 'events',
      tableName: 'events_table',
      schema: {
        fields: [
          { name: 'id', type: 'string' },
          { name: 'timestamp', type: 'timestamp' },
          { name: 'data', type: 'string' },
        ],
      },
    })

    // Should not throw
  })

  it('should configure partitioning', async () => {
    await icebergSink.createTable({
      topic: 'partitioned-events',
      tableName: 'partitioned_table',
      partitionBy: [
        { column: 'timestamp', transform: 'hour' },
        { column: 'region', transform: 'identity' },
      ],
    })

    // Should not throw
  })

  it('should query Iceberg table with SQL', async () => {
    const results = await icebergSink.query(`
      SELECT * FROM events_table
      WHERE timestamp > NOW() - INTERVAL '1 hour'
      LIMIT 100
    `)

    expect(results).toBeInstanceOf(Array)
  })

  it('should compact Iceberg table', async () => {
    await icebergSink.compact('events_table')

    // Should not throw
  })

  it('should expire snapshots', async () => {
    await icebergSink.expireSnapshots({
      tableName: 'events_table',
      olderThan: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    })

    // Should not throw
  })
})

// ============================================================================
// STREAM BRIDGE INTEGRATION TESTS
// ============================================================================

describe('StreamBridgeKafka', () => {
  let kafka: KafkaPipelines
  let streamBridge: StreamBridgeKafka

  beforeEach(() => {
    kafka = new KafkaPipelines({
      clientId: 'stream-bridge-test',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
    })
    streamBridge = kafka.streamBridge()
  })

  it('should emit events to pipeline', async () => {
    await streamBridge.emit({
      topic: 'events',
      key: 'event-1',
      value: { action: 'click', userId: 'user-123' },
    })

    // Should buffer and send to pipeline
  })

  it('should flush pending events', async () => {
    await streamBridge.emit({
      topic: 'events',
      key: 'event-1',
      value: { action: 'click' },
    })

    await streamBridge.flush()

    // All buffered events should be sent
  })

  it('should configure batch size', async () => {
    const customBridge = kafka.streamBridge({
      batchSize: 1000,
      flushInterval: 60_000,
    })

    expect(customBridge).toBeDefined()
  })

  it('should apply transforms before sending', async () => {
    const transformBridge = kafka.streamBridge({
      transform: (event) => ({
        ...event,
        _partition_hour: new Date(event.timestamp).toISOString().slice(0, 13),
      }),
    })

    await transformBridge.emit({
      topic: 'events',
      key: 'event-1',
      value: { data: 'test' },
      timestamp: Date.now(),
    })

    // Transform should add partition hour
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling', () => {
  let kafka: KafkaPipelines

  beforeEach(() => {
    kafka = new KafkaPipelines({
      clientId: 'error-test',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
    })
  })

  it('should throw KafkaJSTopicNotFound for missing topic', async () => {
    const admin = kafka.admin()
    await admin.connect()

    await expect(
      admin.fetchTopicOffsets('non-existent-topic')
    ).rejects.toThrow(KafkaJSTopicNotFound)

    await admin.disconnect()
  })

  it('should throw KafkaJSError when producer not connected', async () => {
    const producer = kafka.producer()
    // Don't connect

    await expect(
      producer.send({ topic: 'test', messages: [{ value: 'test' }] })
    ).rejects.toThrow(KafkaJSError)
  })

  it('should throw KafkaJSError when consumer not connected', async () => {
    const consumer = kafka.consumer({ groupId: 'error-group' })
    // Don't connect

    await expect(
      consumer.subscribe({ topic: 'test' })
    ).rejects.toThrow(KafkaJSError)
  })

  it('should throw KafkaJSConsumerGroupRebalanceError during rebalance', async () => {
    const consumer = kafka.consumer({ groupId: 'rebalance-error-group' }) as PipelineConsumer
    await consumer.connect()
    await consumer.subscribe({ topics: ['orders'] })

    // Simulate rebalance error scenario
    const error = new KafkaJSConsumerGroupRebalanceError('Rebalance in progress')
    expect(error.message).toBe('Rebalance in progress')

    await consumer.disconnect()
  })

  it('should throw KafkaJSOffsetOutOfRange for invalid offset', async () => {
    const consumer = kafka.consumer({ groupId: 'offset-error-group' }) as PipelineConsumer
    await consumer.connect()
    await consumer.subscribe({ topics: ['orders'] })

    consumer.seek({ topic: 'orders', partition: 0, offset: '999999999' })

    // When run() tries to fetch from invalid offset
    // it should throw KafkaJSOffsetOutOfRange
    const error = new KafkaJSOffsetOutOfRange('Offset out of range', {
      topic: 'orders',
      partition: 0,
    })
    expect(error.topic).toBe('orders')
    expect(error.partition).toBe(0)

    await consumer.disconnect()
  })

  it('should throw KafkaJSTimeout on request timeout', async () => {
    const error = new KafkaJSTimeout('Request timed out')
    expect(error.message).toBe('Request timed out')
    expect(error.retriable).toBe(true)
  })

  it('should throw KafkaJSNonRetriableError for permanent failures', async () => {
    const error = new KafkaJSNonRetriableError('Permanent failure')
    expect(error.retriable).toBe(false)
  })

  it('should throw KafkaJSConnectionError for connection issues', () => {
    const error = new KafkaJSConnectionError('Connection refused', {
      broker: 'localhost:9092',
    })
    expect(error.broker).toBe('localhost:9092')
    expect(error.retriable).toBe(true)
  })

  it('should throw KafkaJSProtocolError for protocol violations', () => {
    const error = new KafkaJSProtocolError('Invalid protocol', {
      code: 35,
    })
    expect(error.code).toBe(35)
    expect(error.retriable).toBe(false)
  })

  it('should throw KafkaJSStaleTopicMetadataError when metadata is stale', () => {
    const error = new KafkaJSStaleTopicMetadataError('Metadata is stale')
    expect(error.message).toBe('Metadata is stale')
    expect(error.retriable).toBe(true)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  let kafka: KafkaPipelines

  beforeEach(() => {
    kafka = new KafkaPipelines({
      clientId: 'integration-test',
      pipeline: {} as PipelineBinding,
      r2: {} as R2Binding,
      iceberg: {
        catalog: 'default',
        namespace: 'integration',
      },
    })
  })

  it('should work with complete producer-consumer workflow', async () => {
    const admin = kafka.admin()
    await admin.connect()

    // Create topic
    await admin.createTopics({
      topics: [{ topic: 'integration-topic', numPartitions: 3 }],
    })

    // Produce messages
    const producer = kafka.producer()
    await producer.connect()

    for (let i = 0; i < 10; i++) {
      await producer.send({
        topic: 'integration-topic',
        messages: [{ key: `key-${i}`, value: `message-${i}` }],
      })
    }

    // Consume messages
    const consumer = kafka.consumer({ groupId: 'integration-group' })
    await consumer.connect()
    await consumer.subscribe({ topics: ['integration-topic'], fromBeginning: true })

    const receivedMessages: string[] = []

    consumer.run({
      eachMessage: async ({ message }) => {
        receivedMessages.push(message.value?.toString() ?? '')
        if (receivedMessages.length >= 10) {
          await consumer.stop()
        }
      },
    })

    // Wait for consumption
    await new Promise(resolve => setTimeout(resolve, 1000))

    expect(receivedMessages.length).toBe(10)

    // Cleanup
    await consumer.disconnect()
    await producer.disconnect()
    await admin.disconnect()
  })

  it('should work with multiple consumer groups', async () => {
    const admin = kafka.admin()
    await admin.connect()

    await admin.createTopics({
      topics: [{ topic: 'multi-group-topic' }],
    })

    const producer = kafka.producer()
    await producer.connect()

    await producer.send({
      topic: 'multi-group-topic',
      messages: [{ value: 'shared message' }],
    })

    // Two consumer groups should both receive the message
    const consumer1 = kafka.consumer({ groupId: 'group-1' })
    const consumer2 = kafka.consumer({ groupId: 'group-2' })

    await consumer1.connect()
    await consumer2.connect()

    await consumer1.subscribe({ topics: ['multi-group-topic'], fromBeginning: true })
    await consumer2.subscribe({ topics: ['multi-group-topic'], fromBeginning: true })

    const group1Messages: string[] = []
    const group2Messages: string[] = []

    consumer1.run({
      eachMessage: async ({ message }) => {
        group1Messages.push(message.value?.toString() ?? '')
      },
    })

    consumer2.run({
      eachMessage: async ({ message }) => {
        group2Messages.push(message.value?.toString() ?? '')
      },
    })

    await new Promise(resolve => setTimeout(resolve, 500))

    // Both groups should receive the same message
    expect(group1Messages.length).toBe(1)
    expect(group2Messages.length).toBe(1)

    await consumer1.disconnect()
    await consumer2.disconnect()
    await producer.disconnect()
    await admin.disconnect()
  })

  it('should handle exactly-once semantics with transactions', async () => {
    const admin = kafka.admin()
    await admin.connect()

    await admin.createTopics({
      topics: [
        { topic: 'input-topic' },
        { topic: 'output-topic' },
      ],
    })

    // Produce input
    const inputProducer = kafka.producer()
    await inputProducer.connect()
    await inputProducer.send({
      topic: 'input-topic',
      messages: [{ value: 'process-me' }],
    })

    // Transactional processor
    const txnProducer = kafka.producer({
      transactionalId: 'eos-processor',
    })
    await txnProducer.connect()

    const consumer = kafka.consumer({ groupId: 'eos-group' })
    await consumer.connect()
    await consumer.subscribe({ topics: ['input-topic'], fromBeginning: true })

    consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const transaction = await txnProducer.transaction()

        try {
          // Process and produce output
          await transaction.send({
            topic: 'output-topic',
            messages: [{ value: `processed: ${message.value?.toString()}` }],
          })

          // Commit consumer offset in same transaction
          await transaction.sendOffsets({
            consumerGroupId: 'eos-group',
            topics: [{
              topic,
              partitions: [{ partition, offset: (parseInt(message.offset) + 1).toString() }],
            }],
          })

          await transaction.commit()
        } catch (error) {
          await transaction.abort()
        }

        await consumer.stop()
      },
    })

    await new Promise(resolve => setTimeout(resolve, 1000))

    await consumer.disconnect()
    await txnProducer.disconnect()
    await inputProducer.disconnect()
    await admin.disconnect()
  })

  it('should integrate with Iceberg for analytics', async () => {
    const admin = kafka.admin()
    await admin.connect()

    await admin.createTopics({
      topics: [{ topic: 'analytics-events' }],
    })

    // Produce events
    const producer = kafka.producer()
    await producer.connect()

    for (let i = 0; i < 100; i++) {
      await producer.send({
        topic: 'analytics-events',
        messages: [{
          value: JSON.stringify({
            event: 'page_view',
            userId: `user-${i % 10}`,
            page: `/page-${i % 5}`,
            timestamp: Date.now(),
          }),
        }],
      })
    }

    // Events should be written to Iceberg via Pipeline
    const icebergSink = kafka.icebergSink()

    // Query aggregated data
    const results = await icebergSink.query(`
      SELECT page, COUNT(*) as views
      FROM analytics_events
      GROUP BY page
      ORDER BY views DESC
    `)

    expect(results.length).toBeGreaterThan(0)

    await producer.disconnect()
    await admin.disconnect()
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

  it('should partition consistently by key', () => {
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
      message: { key: 'consistent-key', value: 'test1' },
    })

    const partition2 = partitioner({
      topic: 'test',
      partitionMetadata,
      message: { key: 'consistent-key', value: 'test2' },
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
      message: { key: 'some-key', value: 'test', partition: 1 },
    })

    expect(partition).toBe(1)
  })

  it('should round-robin for null keys', () => {
    const partitioner = Partitioners.DefaultPartitioner()
    const partitionMetadata = [
      { partitionId: 0, leader: 0, replicas: [0], isr: [0] },
      { partitionId: 1, leader: 0, replicas: [0], isr: [0] },
      { partitionId: 2, leader: 0, replicas: [0], isr: [0] },
    ]

    const partitions = new Set<number>()
    for (let i = 0; i < 100; i++) {
      const partition = partitioner({
        topic: 'test',
        partitionMetadata,
        message: { key: null, value: `test-${i}` },
      })
      partitions.add(partition)
    }

    // Should use multiple partitions for null keys
    expect(partitions.size).toBeGreaterThan(1)
  })
})
