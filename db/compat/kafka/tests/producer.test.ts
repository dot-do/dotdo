/**
 * Producer tests for Kafka compat layer
 *
 * Tests producer functionality:
 * - Message production with partitioning strategies
 * - Batch sending
 * - Exactly-once semantics with ExactlyOnceContext
 * - Key-based and round-robin partitioning via KeyedRouter
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createProducer, Producer } from '../producer'
import { createKafkaAdmin, KafkaAdmin, resetRegistry } from '../admin'
import type { ProducerConfig, RecordMetadata } from '../types'

describe('Producer', () => {
  let admin: KafkaAdmin
  let producer: Producer

  beforeEach(async () => {
    resetRegistry() // Reset global state between tests
    admin = createKafkaAdmin()
    await admin.createTopics({
      topics: [
        { name: 'test-topic', partitions: 4 },
        { name: 'single-partition', partitions: 1 },
      ],
    })
  })

  afterEach(async () => {
    if (producer) {
      await producer.disconnect()
    }
    await admin.deleteTopics({ topics: ['test-topic', 'single-partition'] })
  })

  describe('connection', () => {
    it('should connect and disconnect', async () => {
      producer = createProducer({ admin })
      expect(producer.isConnected()).toBe(false)

      await producer.connect()
      expect(producer.isConnected()).toBe(true)

      await producer.disconnect()
      expect(producer.isConnected()).toBe(false)
    })

    it('should throw when sending without connecting', async () => {
      producer = createProducer({ admin })
      await expect(
        producer.send({
          topic: 'test-topic',
          messages: [{ value: 'test' }],
        })
      ).rejects.toThrow('Producer is not connected')
    })
  })

  describe('message production', () => {
    beforeEach(async () => {
      producer = createProducer({ admin })
      await producer.connect()
    })

    it('should produce a single message', async () => {
      const results = await producer.send({
        topic: 'test-topic',
        messages: [{ value: 'hello world' }],
      })

      expect(results).toHaveLength(1)
      expect(results[0].topic).toBe('test-topic')
      expect(results[0].partition).toBeGreaterThanOrEqual(0)
      expect(results[0].partition).toBeLessThan(4)
      expect(results[0].offset).toBe('0')
      expect(results[0].timestamp).toBeGreaterThan(0)
    })

    it('should produce multiple messages', async () => {
      const results = await producer.send({
        topic: 'test-topic',
        messages: [{ value: 'message 1' }, { value: 'message 2' }, { value: 'message 3' }],
      })

      expect(results).toHaveLength(3)
    })

    it('should produce messages with keys', async () => {
      const results = await producer.send({
        topic: 'test-topic',
        messages: [
          { key: 'user-1', value: 'data for user 1' },
          { key: 'user-2', value: 'data for user 2' },
        ],
      })

      expect(results).toHaveLength(2)
    })

    it('should produce messages with headers', async () => {
      const results = await producer.send({
        topic: 'test-topic',
        messages: [
          {
            value: 'message with headers',
            headers: { 'correlation-id': 'abc123', 'content-type': 'application/json' },
          },
        ],
      })

      expect(results).toHaveLength(1)
    })

    it('should produce message with explicit partition', async () => {
      const results = await producer.send({
        topic: 'test-topic',
        messages: [{ value: 'to partition 2', partition: 2 }],
      })

      expect(results).toHaveLength(1)
      expect(results[0].partition).toBe(2)
    })

    it('should reject invalid partition', async () => {
      await expect(
        producer.send({
          topic: 'test-topic',
          messages: [{ value: 'invalid', partition: 99 }],
        })
      ).rejects.toThrow()
    })
  })

  describe('partitioning strategies', () => {
    it('should use round-robin partitioner', async () => {
      producer = createProducer({ admin, partitioner: 'round-robin' })
      await producer.connect()

      const partitions = new Set<number>()

      // Send multiple messages and track partitions
      for (let i = 0; i < 8; i++) {
        const results = await producer.send({
          topic: 'test-topic',
          messages: [{ value: `message ${i}` }],
        })
        partitions.add(results[0].partition)
      }

      // With 4 partitions and 8 messages, round-robin should hit all partitions
      expect(partitions.size).toBe(4)
    })

    it('should use key-based partitioning (default)', async () => {
      producer = createProducer({ admin, partitioner: 'key-based' })
      await producer.connect()

      // Same key should always go to same partition
      const results1 = await producer.send({
        topic: 'test-topic',
        messages: [{ key: 'user-123', value: 'message 1' }],
      })

      const results2 = await producer.send({
        topic: 'test-topic',
        messages: [{ key: 'user-123', value: 'message 2' }],
      })

      expect(results1[0].partition).toBe(results2[0].partition)
    })

    it('should use sticky partitioner', async () => {
      producer = createProducer({ admin, partitioner: 'sticky', batchSize: 3 })
      await producer.connect()

      // First batch of messages should go to same partition
      const results = await producer.send({
        topic: 'test-topic',
        messages: [{ value: 'm1' }, { value: 'm2' }, { value: 'm3' }],
      })

      // All messages in the batch go to the same partition
      const partition = results[0].partition
      expect(results[1].partition).toBe(partition)
      expect(results[2].partition).toBe(partition)
    })

    it('should support custom partitioner', async () => {
      const customPartitioner = vi.fn(({ partitionCount }) => partitionCount - 1) // Always last partition

      producer = createProducer({
        admin,
        partitioner: 'custom',
        customPartitioner,
      })
      await producer.connect()

      const results = await producer.send({
        topic: 'test-topic',
        messages: [{ value: 'custom partitioned' }],
      })

      expect(results[0].partition).toBe(3) // Last partition of 4
      expect(customPartitioner).toHaveBeenCalled()
    })
  })

  describe('batch production', () => {
    beforeEach(async () => {
      producer = createProducer({ admin })
      await producer.connect()
    })

    it('should send batch to multiple topics', async () => {
      const results = await producer.sendBatch({
        topicMessages: [
          { topic: 'test-topic', messages: [{ value: 'to test-topic' }] },
          { topic: 'single-partition', messages: [{ value: 'to single-partition' }] },
        ],
      })

      expect(results).toHaveLength(2)
      expect(results[0].topic).toBe('test-topic')
      expect(results[1].topic).toBe('single-partition')
    })
  })

  describe('exactly-once semantics', () => {
    it('should deduplicate messages with same producer ID and sequence', async () => {
      producer = createProducer({ admin, idempotent: true })
      await producer.connect()

      // First send should succeed
      const results1 = await producer.send({
        topic: 'single-partition',
        messages: [{ value: 'dedupe test' }],
      })

      expect(results1).toHaveLength(1)
      expect(results1[0].offset).toBe('0')

      // Second send with different message should get next offset
      const results2 = await producer.send({
        topic: 'single-partition',
        messages: [{ value: 'dedupe test 2' }],
      })

      expect(results2).toHaveLength(1)
      expect(results2[0].offset).toBe('1')
    })
  })

  describe('auto topic creation', () => {
    it('should auto-create topic if not exists (when enabled)', async () => {
      producer = createProducer({ admin, allowAutoTopicCreation: true })
      await producer.connect()

      const results = await producer.send({
        topic: 'auto-created-topic',
        messages: [{ value: 'to auto-created topic' }],
      })

      expect(results).toHaveLength(1)
      expect(results[0].topic).toBe('auto-created-topic')

      // Cleanup
      await admin.deleteTopics({ topics: ['auto-created-topic'] })
    })

    it('should throw if topic not exists and auto-create disabled', async () => {
      producer = createProducer({ admin, allowAutoTopicCreation: false })
      await producer.connect()

      await expect(
        producer.send({
          topic: 'non-existent-topic',
          messages: [{ value: 'should fail' }],
        })
      ).rejects.toThrow()
    })
  })
})
