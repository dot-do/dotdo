/**
 * Consumer tests for Kafka compat layer
 *
 * Tests consumer functionality:
 * - Subscription and polling
 * - Consumer groups with offset tracking
 * - Seek to offset/timestamp
 * - Batch and message handlers
 * - Pause/resume partitions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createProducer, Producer } from '../producer'
import { createConsumer, Consumer } from '../consumer'
import { createKafkaAdmin, KafkaAdmin, resetRegistry } from '../admin'
import type { ConsumedMessage, EachMessagePayload, EachBatchPayload } from '../types'

describe('Consumer', () => {
  let admin: KafkaAdmin
  let producer: Producer
  let consumer: Consumer

  beforeEach(async () => {
    resetRegistry() // Reset global state between tests
    admin = createKafkaAdmin()
    await admin.createTopics({
      topics: [
        { name: 'consumer-test', partitions: 3 },
        { name: 'single-partition-test', partitions: 1 },
      ],
    })

    producer = createProducer({ admin })
    await producer.connect()

    // Pre-populate with some messages
    await producer.send({
      topic: 'consumer-test',
      messages: [
        { key: 'k1', value: 'message 1' },
        { key: 'k2', value: 'message 2' },
        { key: 'k3', value: 'message 3' },
      ],
    })

    await producer.send({
      topic: 'single-partition-test',
      messages: [{ value: 'msg 1' }, { value: 'msg 2' }, { value: 'msg 3' }],
    })
  })

  afterEach(async () => {
    if (consumer) {
      await consumer.disconnect()
    }
    await producer.disconnect()
    await admin.deleteTopics({ topics: ['consumer-test', 'single-partition-test'] })
  })

  describe('connection', () => {
    it('should connect and disconnect', async () => {
      consumer = createConsumer({ admin, groupId: 'test-group' })
      expect(consumer.isConnected()).toBe(false)

      await consumer.connect()
      expect(consumer.isConnected()).toBe(true)

      await consumer.disconnect()
      expect(consumer.isConnected()).toBe(false)
    })

    it('should require groupId', () => {
      expect(() => createConsumer({ admin, groupId: '' })).toThrow()
    })
  })

  describe('subscription', () => {
    beforeEach(async () => {
      consumer = createConsumer({ admin, groupId: 'test-group' })
      await consumer.connect()
    })

    it('should subscribe to topics', async () => {
      await consumer.subscribe({ topics: ['consumer-test'] })
      expect(consumer.subscription()).toContain('consumer-test')
    })

    it('should subscribe to multiple topics', async () => {
      await consumer.subscribe({ topics: ['consumer-test', 'single-partition-test'] })
      expect(consumer.subscription()).toContain('consumer-test')
      expect(consumer.subscription()).toContain('single-partition-test')
    })

    it('should get partition assignment after subscribe', async () => {
      await consumer.subscribe({ topics: ['consumer-test'] })
      const assignments = consumer.assignment()
      expect(assignments.length).toBeGreaterThan(0)
    })
  })

  describe('polling', () => {
    beforeEach(async () => {
      consumer = createConsumer({ admin, groupId: 'poll-group', autoOffsetReset: 'earliest' })
      await consumer.connect()
      await consumer.subscribe({ topics: ['single-partition-test'], fromBeginning: true })
    })

    it('should poll messages', async () => {
      const messages = await consumer.poll({ maxRecords: 10 })
      expect(messages.length).toBeGreaterThan(0)
    })

    it('should return messages with correct structure', async () => {
      const messages = await consumer.poll({ maxRecords: 1 })
      expect(messages.length).toBe(1)

      const msg = messages[0]
      expect(msg.topic).toBe('single-partition-test')
      expect(msg.partition).toBe(0)
      expect(msg.offset).toBeDefined()
      expect(msg.value).toBeDefined()
      expect(msg.timestamp).toBeGreaterThan(0)
    })

    it('should respect maxRecords limit', async () => {
      const messages = await consumer.poll({ maxRecords: 2 })
      expect(messages.length).toBeLessThanOrEqual(2)
    })

    it('should not return same messages on subsequent polls without new messages', async () => {
      const messages1 = await consumer.poll({ maxRecords: 10 })
      const messages2 = await consumer.poll({ maxRecords: 10 })

      // Second poll should return empty or different messages (based on offset progress)
      if (messages2.length > 0) {
        expect(messages2[0].offset).not.toBe(messages1[0].offset)
      }
    })
  })

  describe('offset management', () => {
    beforeEach(async () => {
      consumer = createConsumer({
        admin,
        groupId: 'offset-group',
        autoCommit: false,
        autoOffsetReset: 'earliest',
      })
      await consumer.connect()
      await consumer.subscribe({ topics: ['single-partition-test'], fromBeginning: true })
    })

    it('should commit offsets manually', async () => {
      const messages = await consumer.poll({ maxRecords: 2 })
      expect(messages.length).toBe(2)

      // Commit the offset
      await consumer.commitOffsets([
        {
          topic: 'single-partition-test',
          partition: 0,
          offset: messages[1].offset,
        },
      ])

      // Create new consumer in same group - should start after committed offset
      const consumer2 = createConsumer({
        admin,
        groupId: 'offset-group',
        autoCommit: false,
        autoOffsetReset: 'earliest',
      })
      await consumer2.connect()
      await consumer2.subscribe({ topics: ['single-partition-test'] })

      const newMessages = await consumer2.poll({ maxRecords: 10 })
      // Should only get messages after the committed offset
      if (newMessages.length > 0) {
        expect(BigInt(newMessages[0].offset)).toBeGreaterThan(BigInt(messages[1].offset))
      }

      await consumer2.disconnect()
    })

    it('should get committed offsets', async () => {
      const messages = await consumer.poll({ maxRecords: 1 })
      await consumer.commitOffsets([
        { topic: 'single-partition-test', partition: 0, offset: messages[0].offset },
      ])

      const committed = await consumer.committed([{ topic: 'single-partition-test', partition: 0 }])
      expect(committed).toHaveLength(1)
      expect(committed[0].offset).toBe(messages[0].offset)
    })
  })

  describe('seek', () => {
    beforeEach(async () => {
      consumer = createConsumer({
        admin,
        groupId: 'seek-group',
        autoOffsetReset: 'earliest',
      })
      await consumer.connect()
      await consumer.subscribe({ topics: ['single-partition-test'], fromBeginning: true })
    })

    it('should seek to specific offset', async () => {
      // Consume some messages first
      await consumer.poll({ maxRecords: 10 })

      // Seek back to beginning
      consumer.seek({ topic: 'single-partition-test', partition: 0, offset: '0' })

      // Should get messages from beginning again
      const messages = await consumer.poll({ maxRecords: 1 })
      expect(messages[0].offset).toBe('0')
    })

    it('should seek to beginning', async () => {
      // Consume some messages first
      await consumer.poll({ maxRecords: 10 })

      // Seek to beginning
      await consumer.seekToBeginning([{ topic: 'single-partition-test', partition: 0 }])

      const messages = await consumer.poll({ maxRecords: 1 })
      expect(messages[0].offset).toBe('0')
    })

    it('should seek to end', async () => {
      // Seek to end
      await consumer.seekToEnd([{ topic: 'single-partition-test', partition: 0 }])

      // Should get no messages (at end)
      const messages = await consumer.poll({ maxRecords: 10 })
      expect(messages.length).toBe(0)

      // Produce new message
      await producer.send({
        topic: 'single-partition-test',
        messages: [{ value: 'new message' }],
      })

      // Now should get the new message
      const newMessages = await consumer.poll({ maxRecords: 10 })
      expect(newMessages.length).toBe(1)
      expect(newMessages[0].value).toBe('new message')
    })
  })

  describe('pause/resume', () => {
    beforeEach(async () => {
      consumer = createConsumer({
        admin,
        groupId: 'pause-group',
        autoOffsetReset: 'earliest',
      })
      await consumer.connect()
      await consumer.subscribe({ topics: ['consumer-test'], fromBeginning: true })
    })

    it('should pause partitions', async () => {
      consumer.pause([{ topic: 'consumer-test', partitions: [0] }])
      expect(consumer.paused()).toContainEqual({ topic: 'consumer-test', partitions: [0] })
    })

    it('should resume partitions', async () => {
      consumer.pause([{ topic: 'consumer-test', partitions: [0] }])
      consumer.resume([{ topic: 'consumer-test', partitions: [0] }])
      expect(consumer.paused()).toHaveLength(0)
    })

    it('should not poll from paused partitions', async () => {
      // Get assignment
      const assignment = consumer.assignment()
      const partition0 = assignment.find((a) => a.topic === 'consumer-test')?.partitions.includes(0)

      if (partition0) {
        consumer.pause([{ topic: 'consumer-test', partitions: [0] }])

        const messages = await consumer.poll({ maxRecords: 100 })
        // No messages from partition 0
        const fromPartition0 = messages.filter((m) => m.partition === 0)
        expect(fromPartition0.length).toBe(0)
      }
    })
  })

  describe('run with handlers', () => {
    beforeEach(async () => {
      consumer = createConsumer({
        admin,
        groupId: 'handler-group',
        autoOffsetReset: 'earliest',
      })
      await consumer.connect()
      await consumer.subscribe({ topics: ['single-partition-test'], fromBeginning: true })
    })

    it('should call eachMessage handler', async () => {
      const messages: ConsumedMessage[] = []
      const handler = vi.fn(async ({ message }: EachMessagePayload) => {
        messages.push(message)
      })

      // Run consumer in background, stop after timeout
      const runPromise = consumer.run({
        eachMessage: handler,
      })

      // Wait a bit for processing
      await new Promise((r) => setTimeout(r, 100))
      await consumer.stop()
      await runPromise

      expect(handler).toHaveBeenCalled()
      expect(messages.length).toBeGreaterThan(0)
    })

    it('should call eachBatch handler', async () => {
      const batches: ConsumedMessage[][] = []
      const handler = vi.fn(async ({ batch }: EachBatchPayload) => {
        batches.push([...batch.messages])
      })

      const runPromise = consumer.run({
        eachBatch: handler,
      })

      await new Promise((r) => setTimeout(r, 100))
      await consumer.stop()
      await runPromise

      expect(handler).toHaveBeenCalled()
      expect(batches.length).toBeGreaterThan(0)
    })

    it('should provide heartbeat function', async () => {
      let heartbeatCalled = false

      const runPromise = consumer.run({
        eachMessage: async ({ heartbeat }) => {
          await heartbeat()
          heartbeatCalled = true
        },
      })

      await new Promise((r) => setTimeout(r, 100))
      await consumer.stop()
      await runPromise

      expect(heartbeatCalled).toBe(true)
    })
  })

  describe('consumer groups', () => {
    it('should distribute partitions across group members', async () => {
      // Create two consumers in same group
      const consumer1 = createConsumer({
        admin,
        groupId: 'shared-group',
        autoOffsetReset: 'earliest',
      })
      const consumer2 = createConsumer({
        admin,
        groupId: 'shared-group',
        autoOffsetReset: 'earliest',
      })

      await consumer1.connect()
      await consumer2.connect()

      await consumer1.subscribe({ topics: ['consumer-test'] })
      await consumer2.subscribe({ topics: ['consumer-test'] })

      const assignment1 = consumer1.assignment()
      const assignment2 = consumer2.assignment()

      // Together they should cover all partitions
      const allPartitions = new Set<number>()
      for (const a of assignment1) {
        if (a.topic === 'consumer-test') {
          a.partitions.forEach((p) => allPartitions.add(p))
        }
      }
      for (const a of assignment2) {
        if (a.topic === 'consumer-test') {
          a.partitions.forEach((p) => allPartitions.add(p))
        }
      }

      expect(allPartitions.size).toBe(3) // All 3 partitions covered

      await consumer1.disconnect()
      await consumer2.disconnect()
    })
  })
})
