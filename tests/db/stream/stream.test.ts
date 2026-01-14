/**
 * Stream Primitives Tests
 *
 * RED tests for Kafka-inspired streaming with topics, partitions, and consumer groups.
 * These tests define the API contract - they should FAIL until implementation exists.
 *
 * @see /db/stream/README.md for API specification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Topic, Producer, Consumer, ConsumerGroup, AdminClient, ExactlyOnceContext } from '../../../db/stream'

// Type definitions for test data
interface OrderEvent {
  customerId: string
  total: number
  items?: Array<{ sku: string; qty: number }>
}

interface UserProfile {
  name: string
  email?: string
  preferences?: Record<string, unknown>
}

interface LoginEvent {
  action: string
  timestamp: number
  ip?: string
}

describe('Stream Primitives', () => {
  // =============================================================================
  // TOPIC CRUD
  // =============================================================================
  describe('Topic CRUD', () => {
    describe('AdminClient.createTopic', () => {
      it('should create a topic with default partitions', async () => {
        const admin = new AdminClient()

        await admin.createTopic('events')

        const topics = await admin.listTopics()
        expect(topics).toContainEqual(expect.objectContaining({ name: 'events' }))
      })

      it('should create a topic with specified partition count', async () => {
        const admin = new AdminClient()

        await admin.createTopic('orders', { partitions: 8 })

        const info = await admin.describeTopic('orders')
        expect(info.partitions).toBe(8)
      })

      it('should create a topic with retention config', async () => {
        const admin = new AdminClient()

        await admin.createTopic('logs', {
          partitions: 4,
          config: {
            'retention.ms': 7 * 24 * 60 * 60 * 1000, // 7 days
            'cleanup.policy': 'delete',
          },
        })

        const info = await admin.describeTopic('logs')
        expect(info.config['retention.ms']).toBe(7 * 24 * 60 * 60 * 1000)
        expect(info.config['cleanup.policy']).toBe('delete')
      })

      it('should create a compacted topic', async () => {
        const admin = new AdminClient()

        await admin.createTopic('user-state', {
          partitions: 4,
          config: {
            'cleanup.policy': 'compact',
          },
        })

        const info = await admin.describeTopic('user-state')
        expect(info.config['cleanup.policy']).toBe('compact')
      })

      it('should throw when creating topic that already exists', async () => {
        const admin = new AdminClient()
        await admin.createTopic('existing')

        await expect(admin.createTopic('existing')).rejects.toThrow(/already exists/)
      })

      it('should validate partition count is positive integer', async () => {
        const admin = new AdminClient()

        await expect(admin.createTopic('bad', { partitions: 0 })).rejects.toThrow()
        await expect(admin.createTopic('bad', { partitions: -1 })).rejects.toThrow()
        await expect(admin.createTopic('bad', { partitions: 1.5 })).rejects.toThrow()
      })
    })

    describe('AdminClient.listTopics', () => {
      it('should return empty array when no topics exist', async () => {
        const admin = new AdminClient()

        const topics = await admin.listTopics()

        expect(topics).toEqual([])
      })

      it('should list all created topics', async () => {
        const admin = new AdminClient()
        await admin.createTopic('topic-a')
        await admin.createTopic('topic-b')
        await admin.createTopic('topic-c')

        const topics = await admin.listTopics()

        expect(topics.map((t) => t.name).sort()).toEqual(['topic-a', 'topic-b', 'topic-c'])
      })

      it('should include partition count in listing', async () => {
        const admin = new AdminClient()
        await admin.createTopic('partitioned', { partitions: 6 })

        const topics = await admin.listTopics()
        const topic = topics.find((t) => t.name === 'partitioned')

        expect(topic?.partitions).toBe(6)
      })
    })

    describe('AdminClient.describeTopic', () => {
      it('should return topic metadata', async () => {
        const admin = new AdminClient()
        await admin.createTopic('describe-me', {
          partitions: 4,
          config: { 'retention.ms': 86400000 },
        })

        const info = await admin.describeTopic('describe-me')

        expect(info).toMatchObject({
          name: 'describe-me',
          partitions: 4,
          config: expect.objectContaining({ 'retention.ms': 86400000 }),
        })
      })

      it('should include partition offsets', async () => {
        const admin = new AdminClient()
        await admin.createTopic('with-offsets', { partitions: 2 })

        const info = await admin.describeTopic('with-offsets')

        expect(info.partitionOffsets).toBeDefined()
        expect(info.partitionOffsets).toHaveLength(2)
        expect(info.partitionOffsets[0]).toMatchObject({
          partition: 0,
          earliestOffset: expect.any(Number),
          latestOffset: expect.any(Number),
        })
      })

      it('should throw for non-existent topic', async () => {
        const admin = new AdminClient()

        await expect(admin.describeTopic('does-not-exist')).rejects.toThrow(/not found/)
      })
    })

    describe('AdminClient.deleteTopic', () => {
      it('should delete an existing topic', async () => {
        const admin = new AdminClient()
        await admin.createTopic('to-delete')

        await admin.deleteTopic('to-delete')

        const topics = await admin.listTopics()
        expect(topics.find((t) => t.name === 'to-delete')).toBeUndefined()
      })

      it('should throw when deleting non-existent topic', async () => {
        const admin = new AdminClient()

        await expect(admin.deleteTopic('ghost')).rejects.toThrow(/not found/)
      })

      it('should remove all messages when topic is deleted', async () => {
        const admin = new AdminClient()
        await admin.createTopic('with-data')

        const producer = new Producer()
        await producer.send('with-data', { key: 'k1', value: { data: 'test' } })

        await admin.deleteTopic('with-data')
        await admin.createTopic('with-data')

        const info = await admin.describeTopic('with-data')
        expect(info.partitionOffsets.every((p) => p.latestOffset === 0)).toBe(true)
      })
    })

    describe('Topic class', () => {
      it('should create topic via Topic constructor', async () => {
        const orders = new Topic<OrderEvent>('orders-topic', {
          partitions: 8,
          retention: '7d',
          compaction: false,
        })

        expect(orders.name).toBe('orders-topic')
        expect(orders.partitions).toBe(8)
      })

      it('should support typed topic', () => {
        const topic = new Topic<OrderEvent>('typed-orders')

        // Type checking - these should compile
        const _event: Parameters<typeof topic.produce>[0]['value'] = {
          customerId: 'c1',
          total: 99.99,
        }
        expect(_event).toBeDefined()
      })
    })
  })

  // =============================================================================
  // PRODUCER WITH PARTITIONING
  // =============================================================================
  describe('Producer with Partitioning', () => {
    describe('Producer.send', () => {
      it('should produce a message to a topic', async () => {
        const admin = new AdminClient()
        await admin.createTopic('produce-test', { partitions: 4 })

        const producer = new Producer()

        const result = await producer.send('produce-test', {
          key: 'order_123',
          value: { customerId: 'cust_1', total: 99.99 },
        })

        expect(result).toMatchObject({
          topic: 'produce-test',
          partition: expect.any(Number),
          offset: expect.any(Number),
        })
      })

      it('should include headers in message', async () => {
        const admin = new AdminClient()
        await admin.createTopic('headers-test')

        const producer = new Producer()

        const result = await producer.send('headers-test', {
          key: 'msg_1',
          value: { data: 'test' },
          headers: { source: 'checkout', trace_id: 'abc123' },
        })

        expect(result.offset).toBeGreaterThanOrEqual(0)
      })

      it('should route same key to same partition', async () => {
        const admin = new AdminClient()
        await admin.createTopic('partition-test', { partitions: 8 })

        const producer = new Producer()

        const result1 = await producer.send('partition-test', {
          key: 'user_456',
          value: { action: 'login' },
        })

        const result2 = await producer.send('partition-test', {
          key: 'user_456',
          value: { action: 'logout' },
        })

        expect(result1.partition).toBe(result2.partition)
      })

      it('should distribute different keys across partitions', async () => {
        const admin = new AdminClient()
        await admin.createTopic('distribute-test', { partitions: 8 })

        const producer = new Producer()
        const partitions = new Set<number>()

        // Send messages with different keys
        for (let i = 0; i < 100; i++) {
          const result = await producer.send('distribute-test', {
            key: `key_${i}`,
            value: { n: i },
          })
          partitions.add(result.partition)
        }

        // Should use multiple partitions
        expect(partitions.size).toBeGreaterThan(1)
      })

      it('should use murmur2 partitioner for Kafka compatibility', async () => {
        const admin = new AdminClient()
        await admin.createTopic('murmur-test', { partitions: 8 })

        const producer = new Producer({ partitioner: 'murmur2' })

        // Known murmur2 hash behavior - same key always same partition
        const result1 = await producer.send('murmur-test', {
          key: 'deterministic-key',
          value: {},
        })

        const result2 = await producer.send('murmur-test', {
          key: 'deterministic-key',
          value: {},
        })

        expect(result1.partition).toBe(result2.partition)
      })

      it('should assign round-robin when key is null', async () => {
        const admin = new AdminClient()
        await admin.createTopic('null-key-test', { partitions: 4 })

        const producer = new Producer()
        const partitions: number[] = []

        for (let i = 0; i < 8; i++) {
          const result = await producer.send('null-key-test', {
            key: null,
            value: { n: i },
          })
          partitions.push(result.partition)
        }

        // Should have some distribution (not all same partition)
        const unique = new Set(partitions)
        expect(unique.size).toBeGreaterThan(1)
      })

      it('should throw for non-existent topic', async () => {
        const producer = new Producer()

        await expect(
          producer.send('non-existent', { key: 'k', value: {} })
        ).rejects.toThrow(/not found|does not exist/)
      })

      it('should support compression', async () => {
        const admin = new AdminClient()
        await admin.createTopic('compressed')

        const producer = new Producer({ compression: 'gzip' })

        const result = await producer.send('compressed', {
          key: 'large',
          value: { data: 'x'.repeat(10000) },
        })

        expect(result.offset).toBeGreaterThanOrEqual(0)
      })
    })

    describe('Producer.sendBatch', () => {
      it('should produce multiple messages atomically', async () => {
        const admin = new AdminClient()
        await admin.createTopic('batch-test', { partitions: 4 })

        const producer = new Producer()

        const results = await producer.sendBatch('batch-test', [
          { key: 'order_1', value: { total: 10 } },
          { key: 'order_2', value: { total: 20 } },
          { key: 'order_3', value: { total: 30 } },
        ])

        expect(results).toHaveLength(3)
        expect(results.every((r) => r.offset >= 0)).toBe(true)
      })

      it('should maintain order within partition for batch', async () => {
        const admin = new AdminClient()
        await admin.createTopic('batch-order', { partitions: 1 })

        const producer = new Producer()

        const results = await producer.sendBatch('batch-order', [
          { key: 'same', value: { seq: 1 } },
          { key: 'same', value: { seq: 2 } },
          { key: 'same', value: { seq: 3 } },
        ])

        // All same partition, offsets should be sequential
        expect(results[0].offset).toBeLessThan(results[1].offset)
        expect(results[1].offset).toBeLessThan(results[2].offset)
      })

      it('should respect batch size config', async () => {
        const admin = new AdminClient()
        await admin.createTopic('batch-config')

        const producer = new Producer({
          batchSize: 10,
          lingerMs: 100,
        })

        // This should work - tests the config is accepted
        const results = await producer.sendBatch('batch-config', [
          { key: 'k1', value: {} },
          { key: 'k2', value: {} },
        ])

        expect(results).toHaveLength(2)
      })
    })

    describe('Topic.produce', () => {
      it('should produce via topic instance', async () => {
        const orders = new Topic<OrderEvent>('direct-produce', { partitions: 4 })

        const result = await orders.produce({
          key: 'order_123',
          value: { customerId: 'cust_1', total: 99.99 },
          headers: { source: 'checkout' },
        })

        expect(result.topic).toBe('direct-produce')
        expect(result.offset).toBeGreaterThanOrEqual(0)
      })

      it('should produce batch via topic instance', async () => {
        const orders = new Topic<OrderEvent>('batch-produce', { partitions: 4 })

        const results = await orders.produceBatch([
          { key: 'order_124', value: { customerId: 'c1', total: 50 } },
          { key: 'order_125', value: { customerId: 'c2', total: 75 } },
        ])

        expect(results).toHaveLength(2)
      })
    })
  })

  // =============================================================================
  // CONSUMER WITH OFFSET MANAGEMENT
  // =============================================================================
  describe('Consumer with Offset Management', () => {
    describe('Consumer subscription', () => {
      it('should subscribe to a topic', async () => {
        const admin = new AdminClient()
        await admin.createTopic('subscribe-test')

        const consumer = new Consumer('subscribe-test', {
          groupId: 'test-group',
        })

        await consumer.subscribe('subscribe-test')

        expect(consumer.subscriptions).toContain('subscribe-test')
      })

      it('should subscribe to multiple topics', async () => {
        const admin = new AdminClient()
        await admin.createTopic('multi-a')
        await admin.createTopic('multi-b')

        const consumer = new Consumer('multi-consumer', {
          groupId: 'multi-group',
        })

        await consumer.subscribe(['multi-a', 'multi-b'])

        expect(consumer.subscriptions).toEqual(['multi-a', 'multi-b'])
      })

      it('should unsubscribe from topic', async () => {
        const admin = new AdminClient()
        await admin.createTopic('unsub-test')

        const consumer = new Consumer('unsub-test', { groupId: 'unsub-group' })
        await consumer.subscribe('unsub-test')

        await consumer.unsubscribe('unsub-test')

        expect(consumer.subscriptions).not.toContain('unsub-test')
      })
    })

    describe('Consumer.poll', () => {
      it('should poll messages from topic', async () => {
        const admin = new AdminClient()
        await admin.createTopic('poll-test')

        const producer = new Producer()
        await producer.send('poll-test', { key: 'k1', value: { data: 'hello' } })

        const consumer = new Consumer('poll-test', { groupId: 'poll-group' })
        await consumer.subscribe('poll-test')

        const message = await consumer.poll()

        expect(message).toMatchObject({
          topic: 'poll-test',
          partition: expect.any(Number),
          offset: expect.any(Number),
          key: 'k1',
          value: { data: 'hello' },
        })
      })

      it('should return null when no messages available', async () => {
        const admin = new AdminClient()
        await admin.createTopic('empty-topic')

        const consumer = new Consumer('empty-topic', { groupId: 'empty-group' })
        await consumer.subscribe('empty-topic')

        const message = await consumer.poll({ timeout: 100 })

        expect(message).toBeNull()
      })

      it('should include message timestamp', async () => {
        const admin = new AdminClient()
        await admin.createTopic('timestamp-test')

        const producer = new Producer()
        const beforeProduce = Date.now()
        await producer.send('timestamp-test', { key: 'k', value: {} })

        const consumer = new Consumer('timestamp-test', { groupId: 'ts-group' })
        await consumer.subscribe('timestamp-test')
        const message = await consumer.poll()

        expect(message?.timestamp).toBeGreaterThanOrEqual(beforeProduce)
      })

      it('should include headers in consumed message', async () => {
        const admin = new AdminClient()
        await admin.createTopic('headers-consume')

        const producer = new Producer()
        await producer.send('headers-consume', {
          key: 'k',
          value: {},
          headers: { trace: 'xyz', source: 'test' },
        })

        const consumer = new Consumer('headers-consume', { groupId: 'hdr-group' })
        await consumer.subscribe('headers-consume')
        const message = await consumer.poll()

        expect(message?.headers).toEqual({ trace: 'xyz', source: 'test' })
      })
    })

    describe('Consumer iteration', () => {
      it('should support async iteration', async () => {
        const admin = new AdminClient()
        await admin.createTopic('iterate-test')

        const producer = new Producer()
        await producer.sendBatch('iterate-test', [
          { key: 'k1', value: { n: 1 } },
          { key: 'k2', value: { n: 2 } },
          { key: 'k3', value: { n: 3 } },
        ])

        const consumer = new Consumer('iterate-test', { groupId: 'iter-group' })
        await consumer.subscribe('iterate-test')

        const messages: unknown[] = []
        let count = 0

        for await (const message of consumer) {
          messages.push(message.value)
          count++
          if (count >= 3) break
        }

        expect(messages).toHaveLength(3)
      })
    })

    describe('Offset management', () => {
      it('should auto-commit offsets', async () => {
        const admin = new AdminClient()
        await admin.createTopic('auto-commit-test')

        const producer = new Producer()
        await producer.send('auto-commit-test', { key: 'k1', value: {} })

        const consumer = new Consumer('auto-commit-test', {
          groupId: 'auto-commit-group',
          autoCommit: true,
          autoCommitInterval: 100,
        })
        await consumer.subscribe('auto-commit-test')

        await consumer.poll()
        await new Promise((r) => setTimeout(r, 150)) // Wait for auto-commit

        const committed = await consumer.committed()
        expect(committed[0]?.offset).toBeGreaterThan(0)
      })

      it('should manually commit offset', async () => {
        const admin = new AdminClient()
        await admin.createTopic('manual-commit')

        const producer = new Producer()
        await producer.send('manual-commit', { key: 'k1', value: {} })

        const consumer = new Consumer('manual-commit', {
          groupId: 'manual-group',
          autoCommit: false,
        })
        await consumer.subscribe('manual-commit')

        const message = await consumer.poll()
        await consumer.commit(message!.offset)

        const committed = await consumer.committed()
        expect(committed[0]?.offset).toBe(message!.offset)
      })

      it('should commit specific partition offset', async () => {
        const admin = new AdminClient()
        await admin.createTopic('partition-commit', { partitions: 4 })

        const producer = new Producer()
        await producer.send('partition-commit', { key: 'k1', value: {} })

        const consumer = new Consumer('partition-commit', {
          groupId: 'partition-group',
          autoCommit: false,
        })
        await consumer.subscribe('partition-commit')

        const message = await consumer.poll()
        await consumer.commit({
          topic: 'partition-commit',
          partition: message!.partition,
          offset: message!.offset,
        })

        const committed = await consumer.committed()
        const partitionCommit = committed.find((c) => c.partition === message!.partition)
        expect(partitionCommit?.offset).toBe(message!.offset)
      })

      it('should resume from committed offset', async () => {
        const admin = new AdminClient()
        await admin.createTopic('resume-test')

        const producer = new Producer()
        await producer.sendBatch('resume-test', [
          { key: 'k1', value: { n: 1 } },
          { key: 'k2', value: { n: 2 } },
          { key: 'k3', value: { n: 3 } },
        ])

        // First consumer reads and commits
        const consumer1 = new Consumer('resume-test', {
          groupId: 'resume-group',
          autoCommit: false,
        })
        await consumer1.subscribe('resume-test')
        const msg1 = await consumer1.poll()
        await consumer1.commit(msg1!.offset)
        await consumer1.close()

        // Second consumer with same group should resume
        const consumer2 = new Consumer('resume-test', {
          groupId: 'resume-group',
          autoCommit: false,
        })
        await consumer2.subscribe('resume-test')
        const msg2 = await consumer2.poll()

        expect(msg2!.value).toEqual({ n: 2 }) // Should get second message
      })
    })

    describe('Seek operations', () => {
      it('should seek to beginning', async () => {
        const admin = new AdminClient()
        await admin.createTopic('seek-begin')

        const producer = new Producer()
        await producer.sendBatch('seek-begin', [
          { key: 'k1', value: { n: 1 } },
          { key: 'k2', value: { n: 2 } },
        ])

        const consumer = new Consumer('seek-begin', { groupId: 'seek-group' })
        await consumer.subscribe('seek-begin')

        // Read first message
        await consumer.poll()

        // Seek back to beginning
        await consumer.seekToBeginning()

        const message = await consumer.poll()
        expect(message!.value).toEqual({ n: 1 })
      })

      it('should seek to end', async () => {
        const admin = new AdminClient()
        await admin.createTopic('seek-end')

        const producer = new Producer()
        await producer.sendBatch('seek-end', [
          { key: 'k1', value: { n: 1 } },
          { key: 'k2', value: { n: 2 } },
        ])

        const consumer = new Consumer('seek-end', { groupId: 'seek-end-group' })
        await consumer.subscribe('seek-end')
        await consumer.seekToEnd()

        const message = await consumer.poll({ timeout: 100 })
        expect(message).toBeNull() // No new messages after end
      })

      it('should seek to specific offset', async () => {
        const admin = new AdminClient()
        await admin.createTopic('seek-offset', { partitions: 1 })

        const producer = new Producer()
        await producer.sendBatch('seek-offset', [
          { key: 'k1', value: { n: 1 } },
          { key: 'k2', value: { n: 2 } },
          { key: 'k3', value: { n: 3 } },
        ])

        const consumer = new Consumer('seek-offset', { groupId: 'offset-group' })
        await consumer.subscribe('seek-offset')

        // Seek to offset 2 (third message, 0-indexed)
        await consumer.seek({ partition: 0, offset: 2 })

        const message = await consumer.poll()
        expect(message!.value).toEqual({ n: 3 })
      })

      it('should seek to timestamp', async () => {
        const admin = new AdminClient()
        await admin.createTopic('seek-timestamp')

        const producer = new Producer()
        await producer.send('seek-timestamp', { key: 'k1', value: { n: 1 } })

        const midpoint = Date.now()
        await new Promise((r) => setTimeout(r, 10))

        await producer.send('seek-timestamp', { key: 'k2', value: { n: 2 } })

        const consumer = new Consumer('seek-timestamp', { groupId: 'ts-seek-group' })
        await consumer.subscribe('seek-timestamp')
        await consumer.seekToTimestamp(midpoint)

        const message = await consumer.poll()
        expect(message!.value).toEqual({ n: 2 })
      })
    })

    describe('Consumer lifecycle', () => {
      it('should close consumer gracefully', async () => {
        const admin = new AdminClient()
        await admin.createTopic('close-test')

        const consumer = new Consumer('close-test', { groupId: 'close-group' })
        await consumer.subscribe('close-test')

        await consumer.close()

        expect(consumer.closed).toBe(true)
      })

      it('should throw when polling closed consumer', async () => {
        const consumer = new Consumer('any', { groupId: 'any' })
        await consumer.close()

        await expect(consumer.poll()).rejects.toThrow(/closed/)
      })

      it('should pause and resume consumption', async () => {
        const admin = new AdminClient()
        await admin.createTopic('pause-test')

        const producer = new Producer()
        await producer.send('pause-test', { key: 'k1', value: {} })

        const consumer = new Consumer('pause-test', { groupId: 'pause-group' })
        await consumer.subscribe('pause-test')

        consumer.pause()
        const msgWhilePaused = await consumer.poll({ timeout: 100 })
        expect(msgWhilePaused).toBeNull()

        consumer.resume()
        const msgAfterResume = await consumer.poll()
        expect(msgAfterResume).not.toBeNull()
      })
    })
  })

  // =============================================================================
  // CONSUMER GROUPS WITH REBALANCING
  // =============================================================================
  describe('Consumer Groups with Rebalancing', () => {
    describe('ConsumerGroup creation', () => {
      it('should create a consumer group', async () => {
        const group = new ConsumerGroup('order-processor', {
          topics: ['orders'],
          rebalanceStrategy: 'range',
        })

        expect(group.groupId).toBe('order-processor')
        expect(group.topics).toContain('orders')
      })

      it('should support round-robin rebalance strategy', async () => {
        const group = new ConsumerGroup('rr-group', {
          topics: ['events'],
          rebalanceStrategy: 'roundRobin',
        })

        expect(group.rebalanceStrategy).toBe('roundRobin')
      })

      it('should support range rebalance strategy', async () => {
        const group = new ConsumerGroup('range-group', {
          topics: ['events'],
          rebalanceStrategy: 'range',
        })

        expect(group.rebalanceStrategy).toBe('range')
      })
    })

    describe('Consumer group membership', () => {
      it('should assign partitions to group members', async () => {
        const admin = new AdminClient()
        await admin.createTopic('group-assign', { partitions: 4 })

        const group = new ConsumerGroup('assign-group', {
          topics: ['group-assign'],
        })

        const consumer1 = await group.join('member-1')
        const consumer2 = await group.join('member-2')

        // Each consumer should get some partitions
        expect(consumer1.assignment.length).toBeGreaterThan(0)
        expect(consumer2.assignment.length).toBeGreaterThan(0)

        // Total assignments should equal partition count
        const totalPartitions = consumer1.assignment.length + consumer2.assignment.length
        expect(totalPartitions).toBe(4)
      })

      it('should emit rebalance event on join', async () => {
        const admin = new AdminClient()
        await admin.createTopic('rebalance-join', { partitions: 4 })

        const group = new ConsumerGroup('join-group', {
          topics: ['rebalance-join'],
        })

        const rebalanceHandler = vi.fn()
        group.on('rebalance', rebalanceHandler)

        await group.join('member-1')

        expect(rebalanceHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'assigned',
            partitions: expect.any(Array),
          })
        )
      })

      it('should rebalance when member leaves', async () => {
        const admin = new AdminClient()
        await admin.createTopic('rebalance-leave', { partitions: 4 })

        const group = new ConsumerGroup('leave-group', {
          topics: ['rebalance-leave'],
        })

        const consumer1 = await group.join('member-1')
        const consumer2 = await group.join('member-2')

        const initialAssignment1 = [...consumer1.assignment]

        await group.leave('member-2')

        // Member 1 should now have all partitions
        expect(consumer1.assignment.length).toBe(4)
        expect(consumer1.assignment.length).toBeGreaterThan(initialAssignment1.length)
      })

      it('should handle member failure with heartbeat timeout', async () => {
        const admin = new AdminClient()
        await admin.createTopic('heartbeat-test', { partitions: 4 })

        const group = new ConsumerGroup('heartbeat-group', {
          topics: ['heartbeat-test'],
          sessionTimeout: 100,
          heartbeatInterval: 30,
        })

        const consumer1 = await group.join('member-1')
        await group.join('member-2')

        // Simulate member-2 failure (stop heartbeats)
        // After timeout, partitions should be reassigned

        const rebalancePromise = new Promise<void>((resolve) => {
          group.on('rebalance', () => resolve())
        })

        await rebalancePromise

        expect(consumer1.assignment.length).toBe(4)
      })
    })

    describe('Partition assignment strategies', () => {
      it('should assign with range strategy evenly', async () => {
        const admin = new AdminClient()
        await admin.createTopic('range-test', { partitions: 8 })

        const group = new ConsumerGroup('range-strategy', {
          topics: ['range-test'],
          rebalanceStrategy: 'range',
        })

        const c1 = await group.join('m1')
        const c2 = await group.join('m2')

        // Range: m1 gets 0-3, m2 gets 4-7
        expect(c1.assignment.sort()).toEqual([0, 1, 2, 3])
        expect(c2.assignment.sort()).toEqual([4, 5, 6, 7])
      })

      it('should assign with round-robin strategy', async () => {
        const admin = new AdminClient()
        await admin.createTopic('rr-test', { partitions: 8 })

        const group = new ConsumerGroup('rr-strategy', {
          topics: ['rr-test'],
          rebalanceStrategy: 'roundRobin',
        })

        const c1 = await group.join('m1')
        const c2 = await group.join('m2')

        // Round-robin: alternating assignment
        expect(c1.assignment.sort()).toEqual([0, 2, 4, 6])
        expect(c2.assignment.sort()).toEqual([1, 3, 5, 7])
      })

      it('should handle uneven partition distribution', async () => {
        const admin = new AdminClient()
        await admin.createTopic('uneven-test', { partitions: 5 })

        const group = new ConsumerGroup('uneven-group', {
          topics: ['uneven-test'],
          rebalanceStrategy: 'range',
        })

        const c1 = await group.join('m1')
        const c2 = await group.join('m2')

        // 5 partitions / 2 consumers = one gets 3, one gets 2
        const total = c1.assignment.length + c2.assignment.length
        expect(total).toBe(5)
        expect(Math.abs(c1.assignment.length - c2.assignment.length)).toBeLessThanOrEqual(1)
      })
    })

    describe('Group generation', () => {
      it('should increment generation on rebalance', async () => {
        const admin = new AdminClient()
        await admin.createTopic('generation-test', { partitions: 4 })

        const group = new ConsumerGroup('gen-group', {
          topics: ['generation-test'],
        })

        expect(group.generation).toBe(0)

        await group.join('m1')
        expect(group.generation).toBe(1)

        await group.join('m2')
        expect(group.generation).toBe(2)

        await group.leave('m1')
        expect(group.generation).toBe(3)
      })

      it('should reject commits from old generation', async () => {
        const admin = new AdminClient()
        await admin.createTopic('old-gen', { partitions: 4 })

        const group = new ConsumerGroup('old-gen-group', {
          topics: ['old-gen'],
        })

        const consumer1 = await group.join('m1')
        const oldGeneration = group.generation

        // Trigger rebalance
        await group.join('m2')

        // Attempt commit with old generation
        await expect(
          consumer1.commitWithGeneration(0, oldGeneration)
        ).rejects.toThrow(/stale|generation/)
      })
    })

    describe('Group metadata', () => {
      it('should track group leader', async () => {
        const admin = new AdminClient()
        await admin.createTopic('leader-test', { partitions: 4 })

        const group = new ConsumerGroup('leader-group', {
          topics: ['leader-test'],
        })

        await group.join('first-member')

        expect(group.leader).toBe('first-member')
      })

      it('should elect new leader when leader leaves', async () => {
        const admin = new AdminClient()
        await admin.createTopic('leader-leave', { partitions: 4 })

        const group = new ConsumerGroup('leader-leave-group', {
          topics: ['leader-leave'],
        })

        await group.join('m1')
        await group.join('m2')

        expect(group.leader).toBe('m1')

        await group.leave('m1')

        expect(group.leader).toBe('m2')
      })

      it('should list group members', async () => {
        const admin = new AdminClient()
        await admin.createTopic('members-test', { partitions: 4 })

        const group = new ConsumerGroup('members-group', {
          topics: ['members-test'],
        })

        await group.join('m1')
        await group.join('m2')
        await group.join('m3')

        const members = group.members()

        expect(members).toHaveLength(3)
        expect(members.map((m) => m.id).sort()).toEqual(['m1', 'm2', 'm3'])
      })
    })
  })

  // =============================================================================
  // EXACTLY-ONCE SEMANTICS
  // =============================================================================
  describe('Exactly-Once Semantics', () => {
    describe('ExactlyOnceContext', () => {
      it('should create exactly-once context', async () => {
        const ctx = new ExactlyOnceContext()

        expect(ctx).toBeDefined()
      })

      it('should execute transactional produce and commit', async () => {
        const admin = new AdminClient()
        await admin.createTopic('eo-input')
        await admin.createTopic('eo-output')

        const producer = new Producer()
        await producer.send('eo-input', { key: 'k1', value: { data: 'test' } })

        const inputConsumer = new Consumer('eo-input', {
          groupId: 'eo-group',
          autoCommit: false,
        })
        await inputConsumer.subscribe('eo-input')

        const ctx = new ExactlyOnceContext()

        await ctx.transaction(async (tx) => {
          const message = await inputConsumer.poll()

          const result = { processed: message!.value }

          await tx.produce('eo-output', { key: message!.key, value: result })
          await tx.commit(message!.offset)
        })

        // Verify output message exists
        const outputConsumer = new Consumer('eo-output', { groupId: 'verify-group' })
        await outputConsumer.subscribe('eo-output')
        const outputMsg = await outputConsumer.poll()

        expect(outputMsg!.value).toEqual({ processed: { data: 'test' } })
      })

      it('should rollback on transaction failure', async () => {
        const admin = new AdminClient()
        await admin.createTopic('rollback-input')
        await admin.createTopic('rollback-output')

        const producer = new Producer()
        await producer.send('rollback-input', { key: 'k1', value: { data: 'test' } })

        const inputConsumer = new Consumer('rollback-input', {
          groupId: 'rollback-group',
          autoCommit: false,
        })
        await inputConsumer.subscribe('rollback-input')

        const ctx = new ExactlyOnceContext()

        await expect(
          ctx.transaction(async (tx) => {
            const message = await inputConsumer.poll()

            await tx.produce('rollback-output', { key: message!.key, value: {} })

            throw new Error('Processing failed')
          })
        ).rejects.toThrow('Processing failed')

        // Output should NOT have message (rolled back)
        const outputConsumer = new Consumer('rollback-output', { groupId: 'verify-rollback' })
        await outputConsumer.subscribe('rollback-output')
        const outputMsg = await outputConsumer.poll({ timeout: 100 })

        expect(outputMsg).toBeNull()

        // Input message should NOT be committed (can be reprocessed)
        const inputConsumer2 = new Consumer('rollback-input', { groupId: 'rollback-group' })
        await inputConsumer2.subscribe('rollback-input')
        const retryMsg = await inputConsumer2.poll()

        expect(retryMsg!.value).toEqual({ data: 'test' })
      })

      it('should handle idempotent retries', async () => {
        const admin = new AdminClient()
        await admin.createTopic('idempotent-test')

        const ctx = new ExactlyOnceContext()
        const producer = new Producer({ idempotent: true })

        // Produce same message multiple times (simulating retry)
        const messageId = 'unique-msg-id'

        await ctx.withIdempotency(messageId, async () => {
          await producer.send('idempotent-test', {
            key: 'k1',
            value: { data: 'only-once' },
          })
        })

        // Second attempt with same ID should be no-op
        await ctx.withIdempotency(messageId, async () => {
          await producer.send('idempotent-test', {
            key: 'k1',
            value: { data: 'only-once' },
          })
        })

        // Should only have one message
        const consumer = new Consumer('idempotent-test', { groupId: 'idempotent-verify' })
        await consumer.subscribe('idempotent-test')

        const msg1 = await consumer.poll()
        const msg2 = await consumer.poll({ timeout: 100 })

        expect(msg1).not.toBeNull()
        expect(msg2).toBeNull() // No second message
      })

      it('should support transactional produce to multiple topics', async () => {
        const admin = new AdminClient()
        await admin.createTopic('multi-out-1')
        await admin.createTopic('multi-out-2')

        const ctx = new ExactlyOnceContext()

        await ctx.transaction(async (tx) => {
          await tx.produce('multi-out-1', { key: 'k1', value: { topic: 1 } })
          await tx.produce('multi-out-2', { key: 'k2', value: { topic: 2 } })
        })

        const consumer1 = new Consumer('multi-out-1', { groupId: 'multi-verify-1' })
        await consumer1.subscribe('multi-out-1')
        const msg1 = await consumer1.poll()

        const consumer2 = new Consumer('multi-out-2', { groupId: 'multi-verify-2' })
        await consumer2.subscribe('multi-out-2')
        const msg2 = await consumer2.poll()

        expect(msg1!.value).toEqual({ topic: 1 })
        expect(msg2!.value).toEqual({ topic: 2 })
      })
    })

    describe('Checkpoint recovery', () => {
      it('should recover from checkpoint after crash', async () => {
        const admin = new AdminClient()
        await admin.createTopic('checkpoint-input')
        await admin.createTopic('checkpoint-output')

        const producer = new Producer()
        await producer.sendBatch('checkpoint-input', [
          { key: 'k1', value: { n: 1 } },
          { key: 'k2', value: { n: 2 } },
          { key: 'k3', value: { n: 3 } },
        ])

        const ctx = new ExactlyOnceContext()

        // Process first message successfully
        const consumer1 = new Consumer('checkpoint-input', {
          groupId: 'checkpoint-group',
          autoCommit: false,
        })
        await consumer1.subscribe('checkpoint-input')

        await ctx.transaction(async (tx) => {
          const msg = await consumer1.poll()
          await tx.produce('checkpoint-output', { key: msg!.key, value: msg!.value })
          await tx.commit(msg!.offset)
        })

        await consumer1.close()

        // Simulate crash and recovery with new consumer
        const consumer2 = new Consumer('checkpoint-input', {
          groupId: 'checkpoint-group',
          autoCommit: false,
        })
        await consumer2.subscribe('checkpoint-input')

        const nextMsg = await consumer2.poll()

        // Should resume from message 2, not 1
        expect(nextMsg!.value).toEqual({ n: 2 })
      })
    })
  })

  // =============================================================================
  // COMPACTED TOPICS
  // =============================================================================
  describe('Compacted Topics', () => {
    describe('Compaction behavior', () => {
      it('should create compacted topic', async () => {
        const userProfiles = new Topic<UserProfile>('user-profiles', {
          compaction: true,
        })

        expect(userProfiles.compaction).toBe(true)
      })

      it('should keep only latest value per key after compaction', async () => {
        const admin = new AdminClient()
        await admin.createTopic('compact-test', {
          config: { 'cleanup.policy': 'compact' },
        })

        const topic = new Topic<UserProfile>('compact-test', { compaction: true })

        // Multiple updates to same key
        await topic.produce({ key: 'user_1', value: { name: 'Alice' } })
        await topic.produce({ key: 'user_1', value: { name: 'Alice Smith' } })
        await topic.produce({ key: 'user_1', value: { name: 'Alice Johnson' } })

        // Trigger compaction
        await admin.compactTopic('compact-test')

        // Read from beginning - should only get latest
        const consumer = new Consumer('compact-test', { groupId: 'compact-verify' })
        await consumer.subscribe('compact-test')
        await consumer.seekToBeginning()

        const messages: UserProfile[] = []
        let msg
        while ((msg = await consumer.poll({ timeout: 100 }))) {
          messages.push(msg.value)
        }

        const user1Messages = messages.filter(
          (m) => m.name.startsWith('Alice')
        )
        expect(user1Messages).toHaveLength(1)
        expect(user1Messages[0].name).toBe('Alice Johnson')
      })

      it('should preserve messages for different keys', async () => {
        const admin = new AdminClient()
        await admin.createTopic('multi-key-compact', {
          config: { 'cleanup.policy': 'compact' },
        })

        const topic = new Topic<UserProfile>('multi-key-compact', { compaction: true })

        await topic.produce({ key: 'user_1', value: { name: 'Alice' } })
        await topic.produce({ key: 'user_2', value: { name: 'Bob' } })
        await topic.produce({ key: 'user_1', value: { name: 'Alice Updated' } })
        await topic.produce({ key: 'user_3', value: { name: 'Charlie' } })

        await admin.compactTopic('multi-key-compact')

        const consumer = new Consumer('multi-key-compact', { groupId: 'multi-verify' })
        await consumer.subscribe('multi-key-compact')
        await consumer.seekToBeginning()

        const messages: Array<{ key: string; value: UserProfile }> = []
        let msg
        while ((msg = await consumer.poll({ timeout: 100 }))) {
          messages.push({ key: msg.key, value: msg.value })
        }

        expect(messages).toHaveLength(3)
        expect(messages.find((m) => m.key === 'user_1')?.value.name).toBe('Alice Updated')
        expect(messages.find((m) => m.key === 'user_2')?.value.name).toBe('Bob')
        expect(messages.find((m) => m.key === 'user_3')?.value.name).toBe('Charlie')
      })

      it('should handle tombstone (null value) for deletion', async () => {
        const admin = new AdminClient()
        await admin.createTopic('tombstone-test', {
          config: { 'cleanup.policy': 'compact' },
        })

        const topic = new Topic<UserProfile | null>('tombstone-test', { compaction: true })

        await topic.produce({ key: 'user_1', value: { name: 'Alice' } })
        await topic.produce({ key: 'user_2', value: { name: 'Bob' } })
        // Tombstone - marks user_1 for deletion
        await topic.produce({ key: 'user_1', value: null })

        await admin.compactTopic('tombstone-test')

        const consumer = new Consumer('tombstone-test', { groupId: 'tombstone-verify' })
        await consumer.subscribe('tombstone-test')
        await consumer.seekToBeginning()

        const messages: Array<{ key: string; value: UserProfile | null }> = []
        let msg
        while ((msg = await consumer.poll({ timeout: 100 }))) {
          messages.push({ key: msg.key, value: msg.value })
        }

        // user_1 should be deleted (tombstone removed after compaction)
        // Only user_2 should remain
        expect(messages).toHaveLength(1)
        expect(messages[0].key).toBe('user_2')
      })

      it('should respect minCleanableDirtyRatio', async () => {
        const topic = new Topic<UserProfile>('ratio-test', {
          compaction: true,
          minCleanableDirtyRatio: 0.5,
        })

        expect(topic.minCleanableDirtyRatio).toBe(0.5)
      })
    })

    describe('Compaction with retention', () => {
      it('should support delete+compact cleanup policy', async () => {
        const admin = new AdminClient()
        await admin.createTopic('delete-compact', {
          config: {
            'cleanup.policy': 'delete,compact',
            'retention.ms': 86400000, // 1 day
          },
        })

        const info = await admin.describeTopic('delete-compact')
        expect(info.config['cleanup.policy']).toBe('delete,compact')
      })

      it('should compact within active segment', async () => {
        const admin = new AdminClient()
        await admin.createTopic('active-segment', {
          config: { 'cleanup.policy': 'compact' },
        })

        const topic = new Topic<{ count: number }>('active-segment', { compaction: true })

        // Rapid updates - all within active segment
        for (let i = 0; i < 100; i++) {
          await topic.produce({ key: 'counter', value: { count: i } })
        }

        await admin.compactTopic('active-segment')

        const consumer = new Consumer('active-segment', { groupId: 'active-verify' })
        await consumer.subscribe('active-segment')
        await consumer.seekToBeginning()

        const messages: Array<{ count: number }> = []
        let msg
        while ((msg = await consumer.poll({ timeout: 100 }))) {
          messages.push(msg.value)
        }

        // Should have compacted to just the latest
        expect(messages).toHaveLength(1)
        expect(messages[0].count).toBe(99)
      })
    })

    describe('Compacted topic read patterns', () => {
      it('should support reading full state from compacted topic', async () => {
        const admin = new AdminClient()
        await admin.createTopic('state-read', {
          config: { 'cleanup.policy': 'compact' },
        })

        const topic = new Topic<{ status: string }>('state-read', { compaction: true })

        // Set up some state
        await topic.produce({ key: 'order_1', value: { status: 'pending' } })
        await topic.produce({ key: 'order_2', value: { status: 'shipped' } })
        await topic.produce({ key: 'order_3', value: { status: 'delivered' } })
        await topic.produce({ key: 'order_1', value: { status: 'cancelled' } })

        await admin.compactTopic('state-read')

        // Read full current state
        const state = await topic.readCurrentState()

        expect(state).toEqual({
          order_1: { status: 'cancelled' },
          order_2: { status: 'shipped' },
          order_3: { status: 'delivered' },
        })
      })

      it('should support key lookup on compacted topic', async () => {
        const admin = new AdminClient()
        await admin.createTopic('key-lookup', {
          config: { 'cleanup.policy': 'compact' },
        })

        const topic = new Topic<UserProfile>('key-lookup', { compaction: true })

        await topic.produce({ key: 'user_1', value: { name: 'Alice', email: 'alice@test.com' } })
        await topic.produce({ key: 'user_2', value: { name: 'Bob', email: 'bob@test.com' } })

        await admin.compactTopic('key-lookup')

        const user = await topic.get('user_1')

        expect(user).toEqual({ name: 'Alice', email: 'alice@test.com' })
      })

      it('should return null for non-existent key', async () => {
        const admin = new AdminClient()
        await admin.createTopic('missing-key', {
          config: { 'cleanup.policy': 'compact' },
        })

        const topic = new Topic<UserProfile>('missing-key', { compaction: true })

        const user = await topic.get('non_existent')

        expect(user).toBeNull()
      })
    })
  })

  // =============================================================================
  // INTEGRATION / EDGE CASES
  // =============================================================================
  describe('Integration and Edge Cases', () => {
    describe('Message ordering', () => {
      it('should preserve order within partition', async () => {
        const admin = new AdminClient()
        await admin.createTopic('order-test', { partitions: 1 })

        const producer = new Producer()
        for (let i = 0; i < 10; i++) {
          await producer.send('order-test', { key: 'same', value: { seq: i } })
        }

        const consumer = new Consumer('order-test', { groupId: 'order-group' })
        await consumer.subscribe('order-test')

        const values: number[] = []
        for (let i = 0; i < 10; i++) {
          const msg = await consumer.poll()
          values.push(msg!.value.seq)
        }

        expect(values).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      })
    })

    describe('Backpressure', () => {
      it('should handle slow consumer with backpressure', async () => {
        const admin = new AdminClient()
        await admin.createTopic('backpressure', { partitions: 1 })

        const producer = new Producer()
        const consumer = new Consumer('backpressure', {
          groupId: 'slow-group',
          maxPollRecords: 10, // Limit batch size
        })
        await consumer.subscribe('backpressure')

        // Produce many messages
        for (let i = 0; i < 100; i++) {
          await producer.send('backpressure', { key: null, value: { n: i } })
        }

        // Consumer should be able to poll in batches without overwhelming
        const batch = await consumer.pollBatch()
        expect(batch.length).toBeLessThanOrEqual(10)
      })
    })

    describe('Large messages', () => {
      it('should handle large message values', async () => {
        const admin = new AdminClient()
        await admin.createTopic('large-msg')

        const producer = new Producer()
        const largeData = 'x'.repeat(100_000) // 100KB

        const result = await producer.send('large-msg', {
          key: 'large',
          value: { data: largeData },
        })

        expect(result.offset).toBeGreaterThanOrEqual(0)

        const consumer = new Consumer('large-msg', { groupId: 'large-group' })
        await consumer.subscribe('large-msg')
        const msg = await consumer.poll()

        expect(msg!.value.data.length).toBe(100_000)
      })

      it('should reject messages exceeding max size', async () => {
        const admin = new AdminClient()
        await admin.createTopic('max-size', {
          config: { 'max.message.bytes': 1000 },
        })

        const producer = new Producer()

        await expect(
          producer.send('max-size', {
            key: 'too-big',
            value: { data: 'x'.repeat(10_000) },
          })
        ).rejects.toThrow(/size|too large/)
      })
    })

    describe('Concurrent operations', () => {
      it('should handle concurrent producers', async () => {
        const admin = new AdminClient()
        await admin.createTopic('concurrent', { partitions: 4 })

        const producers = [new Producer(), new Producer(), new Producer()]

        const results = await Promise.all(
          producers.flatMap((p, i) =>
            Array.from({ length: 10 }, (_, j) =>
              p.send('concurrent', { key: `p${i}-${j}`, value: { producer: i, msg: j } })
            )
          )
        )

        expect(results).toHaveLength(30)
        expect(results.every((r) => r.offset >= 0)).toBe(true)
      })

      it('should handle concurrent consumers in same group', async () => {
        const admin = new AdminClient()
        await admin.createTopic('concurrent-consume', { partitions: 4 })

        const producer = new Producer()
        for (let i = 0; i < 20; i++) {
          await producer.send('concurrent-consume', { key: `k${i}`, value: { n: i } })
        }

        const group = new ConsumerGroup('concurrent-group', {
          topics: ['concurrent-consume'],
        })

        const c1 = await group.join('c1')
        const c2 = await group.join('c2')

        // Both consumers should be able to poll from their assigned partitions
        const [msg1, msg2] = await Promise.all([c1.consumer.poll(), c2.consumer.poll()])

        expect(msg1).not.toBeNull()
        expect(msg2).not.toBeNull()
        // Different partitions
        expect(msg1!.partition).not.toBe(msg2!.partition)
      })
    })

    describe('Error handling', () => {
      it('should handle network errors gracefully', async () => {
        const consumer = new Consumer('any-topic', {
          groupId: 'error-group',
          retryAttempts: 3,
          retryDelay: 100,
        })

        // Should not throw, but return null after retries
        const msg = await consumer.poll({ timeout: 500 })
        expect(msg).toBeNull()
      })

      it('should provide meaningful error for invalid config', async () => {
        const admin = new AdminClient()

        await expect(
          admin.createTopic('bad-config', {
            config: {
              'invalid.setting': 'value',
            },
          })
        ).rejects.toThrow(/invalid|unknown/)
      })
    })
  })
})
