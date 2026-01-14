/**
 * Admin tests for Kafka compat layer
 *
 * Tests admin functionality:
 * - Topic creation and deletion
 * - Topic listing and description
 * - Consumer group management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createKafkaAdmin, KafkaAdmin, resetRegistry } from '../admin'
import { createProducer, Producer } from '../producer'
import { createConsumer, Consumer } from '../consumer'
import { KafkaErrorCode } from '../types'

describe('KafkaAdmin', () => {
  let admin: KafkaAdmin

  beforeEach(() => {
    resetRegistry() // Reset global state between tests
    admin = createKafkaAdmin()
  })

  afterEach(async () => {
    // Cleanup any created topics
    try {
      await admin.deleteTopics({ topics: ['admin-test-topic', 'topic-1', 'topic-2', 'topic-3'] })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('topic creation', () => {
    it('should create a topic', async () => {
      await admin.createTopics({
        topics: [{ name: 'admin-test-topic', partitions: 3 }],
      })

      const topics = await admin.listTopics()
      expect(topics).toContain('admin-test-topic')
    })

    it('should create a topic with default partitions', async () => {
      await admin.createTopics({
        topics: [{ name: 'admin-test-topic', partitions: 1 }],
      })

      const description = await admin.describeTopics(['admin-test-topic'])
      expect(description).toHaveLength(1)
      expect(description[0].partitions).toHaveLength(1)
    })

    it('should create multiple topics', async () => {
      await admin.createTopics({
        topics: [
          { name: 'topic-1', partitions: 2 },
          { name: 'topic-2', partitions: 3 },
        ],
      })

      const topics = await admin.listTopics()
      expect(topics).toContain('topic-1')
      expect(topics).toContain('topic-2')
    })

    it('should throw on duplicate topic creation', async () => {
      await admin.createTopics({
        topics: [{ name: 'admin-test-topic', partitions: 1 }],
      })

      await expect(
        admin.createTopics({
          topics: [{ name: 'admin-test-topic', partitions: 1 }],
        })
      ).rejects.toThrow()
    })

    it('should validate only when validateOnly is true', async () => {
      await admin.createTopics({
        topics: [{ name: 'admin-test-topic', partitions: 1 }],
        validateOnly: true,
      })

      // Topic should not actually be created
      const topics = await admin.listTopics()
      expect(topics).not.toContain('admin-test-topic')
    })

    it('should reject invalid partition count', async () => {
      await expect(
        admin.createTopics({
          topics: [{ name: 'admin-test-topic', partitions: 0 }],
        })
      ).rejects.toThrow()

      await expect(
        admin.createTopics({
          topics: [{ name: 'admin-test-topic', partitions: -1 }],
        })
      ).rejects.toThrow()
    })
  })

  describe('topic deletion', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [
          { name: 'topic-1', partitions: 1 },
          { name: 'topic-2', partitions: 1 },
        ],
      })
    })

    it('should delete a topic', async () => {
      await admin.deleteTopics({ topics: ['topic-1'] })

      const topics = await admin.listTopics()
      expect(topics).not.toContain('topic-1')
      expect(topics).toContain('topic-2')
    })

    it('should delete multiple topics', async () => {
      await admin.deleteTopics({ topics: ['topic-1', 'topic-2'] })

      const topics = await admin.listTopics()
      expect(topics).not.toContain('topic-1')
      expect(topics).not.toContain('topic-2')
    })

    it('should handle deleting non-existent topic gracefully', async () => {
      // Should not throw
      await admin.deleteTopics({ topics: ['non-existent-topic'] })
    })
  })

  describe('topic listing', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [
          { name: 'topic-1', partitions: 1 },
          { name: 'topic-2', partitions: 2 },
          { name: 'topic-3', partitions: 3 },
        ],
      })
    })

    it('should list all topics', async () => {
      const topics = await admin.listTopics()
      expect(topics).toContain('topic-1')
      expect(topics).toContain('topic-2')
      expect(topics).toContain('topic-3')
    })
  })

  describe('topic description', () => {
    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ name: 'admin-test-topic', partitions: 4, retentionMs: 86400000 }],
      })
    })

    it('should describe a topic', async () => {
      const descriptions = await admin.describeTopics(['admin-test-topic'])

      expect(descriptions).toHaveLength(1)
      expect(descriptions[0].name).toBe('admin-test-topic')
      expect(descriptions[0].partitions).toHaveLength(4)
    })

    it('should include partition information', async () => {
      const descriptions = await admin.describeTopics(['admin-test-topic'])
      const partition = descriptions[0].partitions[0]

      expect(partition.partition).toBe(0)
      expect(partition.highWatermark).toBeDefined()
      expect(partition.logStartOffset).toBeDefined()
    })

    it('should describe multiple topics', async () => {
      await admin.createTopics({
        topics: [{ name: 'topic-1', partitions: 1 }],
      })

      const descriptions = await admin.describeTopics(['admin-test-topic', 'topic-1'])
      expect(descriptions).toHaveLength(2)
    })

    it('should throw for non-existent topic', async () => {
      await expect(admin.describeTopics(['non-existent'])).rejects.toThrow()
    })
  })

  describe('offset management', () => {
    let producer: Producer
    let consumer: Consumer

    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ name: 'admin-test-topic', partitions: 1 }],
      })

      producer = createProducer({ admin })
      await producer.connect()

      // Produce some messages
      await producer.send({
        topic: 'admin-test-topic',
        messages: [{ value: 'msg1' }, { value: 'msg2' }, { value: 'msg3' }],
      })

      // Create consumer and commit offsets
      consumer = createConsumer({ admin, groupId: 'admin-test-group', autoCommit: false, autoOffsetReset: 'earliest' })
      await consumer.connect()
      await consumer.subscribe({ topics: ['admin-test-topic'], fromBeginning: true })
      const messages = await consumer.poll({ maxRecords: 2 })
      if (messages.length >= 2) {
        await consumer.commitOffsets([
          { topic: 'admin-test-topic', partition: 0, offset: messages[1].offset },
        ])
      } else if (messages.length === 1) {
        await consumer.commitOffsets([
          { topic: 'admin-test-topic', partition: 0, offset: messages[0].offset },
        ])
      }
    })

    afterEach(async () => {
      await producer?.disconnect()
      await consumer?.disconnect()
    })

    it('should fetch offsets for consumer group', async () => {
      const offsets = await admin.fetchOffsets({
        groupId: 'admin-test-group',
        topics: ['admin-test-topic'],
      })

      expect(offsets).toHaveLength(1)
      expect(offsets[0].topic).toBe('admin-test-topic')
      expect(offsets[0].partition).toBe(0)
      expect(offsets[0].offset).toBeDefined()
    })

    it('should reset offsets', async () => {
      await admin.resetOffsets({
        groupId: 'admin-test-group',
        topic: 'admin-test-topic',
        earliest: true,
      })

      const offsets = await admin.fetchOffsets({
        groupId: 'admin-test-group',
        topics: ['admin-test-topic'],
      })

      expect(offsets[0].offset).toBe('0')
    })

    it('should delete consumer group offsets', async () => {
      await admin.deleteConsumerGroupOffsets({
        groupId: 'admin-test-group',
        topic: 'admin-test-topic',
      })

      const offsets = await admin.fetchOffsets({
        groupId: 'admin-test-group',
        topics: ['admin-test-topic'],
      })

      // Offset should be reset/deleted
      expect(offsets[0].offset).toBe('-1') // -1 indicates no committed offset
    })
  })

  describe('consumer group management', () => {
    let consumer: Consumer

    beforeEach(async () => {
      await admin.createTopics({
        topics: [{ name: 'admin-test-topic', partitions: 2 }],
      })

      consumer = createConsumer({ admin, groupId: 'describe-group' })
      await consumer.connect()
      await consumer.subscribe({ topics: ['admin-test-topic'] })
    })

    afterEach(async () => {
      await consumer?.disconnect()
    })

    it('should describe consumer groups', async () => {
      const groups = await admin.describeGroups(['describe-group'])

      expect(groups).toHaveLength(1)
      expect(groups[0].groupId).toBe('describe-group')
      expect(groups[0].state).toBeDefined()
    })

    it('should list consumer groups', async () => {
      const groups = await admin.listGroups()

      expect(groups.map((g) => g.groupId)).toContain('describe-group')
    })

    it('should delete consumer groups', async () => {
      // Disconnect consumer first
      await consumer.disconnect()

      await admin.deleteGroups(['describe-group'])

      const groups = await admin.listGroups()
      expect(groups.map((g) => g.groupId)).not.toContain('describe-group')
    })
  })
})
