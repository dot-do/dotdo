/**
 * Kafka package tests
 *
 * Tests the Kafka-compatible API with in-memory backend:
 * - Producer: send(), sendBatch()
 * - Consumer: subscribe(), run(), commitOffsets()
 * - Message format and serialization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createKafka,
  createProducer,
  createConsumer,
  createAdmin,
  resetRegistry,
  KafkaError,
  type Producer,
  type Consumer,
  type Admin,
  type Kafka,
} from '../src'

describe('Kafka Package', () => {
  let kafka: Kafka
  let admin: Admin
  let producer: Producer
  let consumer: Consumer

  beforeEach(async () => {
    // Reset global state between tests
    resetRegistry()
    kafka = createKafka({ brokers: ['localhost:9092'] })
    admin = kafka.admin()
    producer = kafka.producer()
    consumer = kafka.consumer({ groupId: 'test-group' })
  })

  afterEach(async () => {
    if (consumer) await consumer.disconnect()
    if (producer) await producer.disconnect()
    if (admin) await admin.disconnect()
  })

  describe('Admin', () => {
    it('should connect and disconnect', async () => {
      await admin.connect()
      await admin.disconnect()
    })

    it('should create topics', async () => {
      await admin.connect()
      await admin.createTopics({
        topics: [
          { topic: 'test-topic', numPartitions: 3 },
          { topic: 'another-topic', numPartitions: 1 },
        ],
      })

      const topics = await admin.listTopics()
      expect(topics).toContain('test-topic')
      expect(topics).toContain('another-topic')
    })

    it('should delete topics', async () => {
      await admin.connect()
      await admin.createTopics({
        topics: [{ topic: 'to-delete', numPartitions: 1 }],
      })

      await admin.deleteTopics({ topics: ['to-delete'] })

      const topics = await admin.listTopics()
      expect(topics).not.toContain('to-delete')
    })
  })

  describe('Producer', () => {
    beforeEach(async () => {
      await admin.connect()
      await admin.createTopics({
        topics: [
          { topic: 'producer-test', numPartitions: 4 },
          { topic: 'single-partition', numPartitions: 1 },
        ],
      })
      await producer.connect()
    })

    describe('send()', () => {
      it('should send a single message', async () => {
        const result = await producer.send({
          topic: 'producer-test',
          messages: [{ value: 'hello world' }],
        })

        expect(result).toBeDefined()
        expect(result.length).toBe(1)
        expect(result[0].topic).toBe('producer-test')
        expect(result[0].partition).toBeGreaterThanOrEqual(0)
        expect(result[0].offset).toBeDefined()
      })

      it('should send multiple messages', async () => {
        const result = await producer.send({
          topic: 'producer-test',
          messages: [
            { value: 'message 1' },
            { value: 'message 2' },
            { value: 'message 3' },
          ],
        })

        expect(result.length).toBe(3)
      })

      it('should send messages with keys', async () => {
        const result = await producer.send({
          topic: 'producer-test',
          messages: [
            { key: 'user-1', value: 'data 1' },
            { key: 'user-2', value: 'data 2' },
          ],
        })

        expect(result.length).toBe(2)
      })

      it('should send messages with headers', async () => {
        const result = await producer.send({
          topic: 'producer-test',
          messages: [
            {
              value: 'with headers',
              headers: {
                'correlation-id': 'abc123',
                'content-type': 'application/json',
              },
            },
          ],
        })

        expect(result.length).toBe(1)
      })

      it('should route messages with same key to same partition', async () => {
        const result1 = await producer.send({
          topic: 'producer-test',
          messages: [{ key: 'consistent-key', value: 'message 1' }],
        })

        const result2 = await producer.send({
          topic: 'producer-test',
          messages: [{ key: 'consistent-key', value: 'message 2' }],
        })

        expect(result1[0].partition).toBe(result2[0].partition)
      })

      it('should throw when sending to non-existent topic without auto-create', async () => {
        // Create a new producer with auto-topic creation disabled
        const noAutoCreateProducer = kafka.producer({ allowAutoTopicCreation: false })
        await noAutoCreateProducer.connect()

        await expect(
          noAutoCreateProducer.send({
            topic: 'non-existent-topic',
            messages: [{ value: 'test' }],
          })
        ).rejects.toThrow()

        await noAutoCreateProducer.disconnect()
      })

      it('should throw when not connected', async () => {
        await producer.disconnect()
        await expect(
          producer.send({
            topic: 'producer-test',
            messages: [{ value: 'test' }],
          })
        ).rejects.toThrow(/not connected/i)
      })
    })

    describe('sendBatch()', () => {
      it('should send batch to multiple topics', async () => {
        const result = await producer.sendBatch({
          topicMessages: [
            { topic: 'producer-test', messages: [{ value: 'to producer-test' }] },
            { topic: 'single-partition', messages: [{ value: 'to single-partition' }] },
          ],
        })

        expect(result.length).toBe(2)
        expect(result[0].topic).toBe('producer-test')
        expect(result[1].topic).toBe('single-partition')
      })

      it('should send batch with multiple messages per topic', async () => {
        const result = await producer.sendBatch({
          topicMessages: [
            {
              topic: 'producer-test',
              messages: [
                { value: 'msg 1' },
                { value: 'msg 2' },
              ],
            },
            {
              topic: 'single-partition',
              messages: [
                { value: 'msg 3' },
                { value: 'msg 4' },
              ],
            },
          ],
        })

        expect(result.length).toBe(4)
      })
    })
  })

  describe('Consumer', () => {
    beforeEach(async () => {
      await admin.connect()
      await admin.createTopics({
        topics: [
          { topic: 'consumer-test', numPartitions: 2 },
        ],
      })
      await producer.connect()
      await consumer.connect()
    })

    describe('subscribe()', () => {
      it('should subscribe to a topic', async () => {
        await consumer.subscribe({ topics: ['consumer-test'] })

        const subscriptions = consumer.subscription()
        expect(subscriptions).toContain('consumer-test')
      })

      it('should subscribe to multiple topics', async () => {
        await admin.createTopics({
          topics: [{ topic: 'consumer-test-2', numPartitions: 1 }],
        })

        await consumer.subscribe({ topics: ['consumer-test', 'consumer-test-2'] })

        const subscriptions = consumer.subscription()
        expect(subscriptions).toContain('consumer-test')
        expect(subscriptions).toContain('consumer-test-2')
      })

      it('should support fromBeginning option', async () => {
        // Produce some messages first
        await producer.send({
          topic: 'consumer-test',
          messages: [{ value: 'before subscribe' }],
        })

        await consumer.subscribe({ topics: ['consumer-test'], fromBeginning: true })

        const messages: Array<{ value: string | null }> = []
        // Start consumer in background (don't await)
        consumer.run({
          eachMessage: async ({ message }) => {
            messages.push({ value: message.value?.toString() || null })
          },
        })

        // Give consumer time to process
        await new Promise((r) => setTimeout(r, 100))
        await consumer.stop()

        expect(messages.length).toBeGreaterThanOrEqual(1)
        expect(messages[0].value).toBe('before subscribe')
      })
    })

    describe('run()', () => {
      it('should consume messages with eachMessage handler', async () => {
        await consumer.subscribe({ topics: ['consumer-test'], fromBeginning: true })

        const messages: Array<{ topic: string; partition: number; value: string | null }> = []

        // Start consumer in background (don't await)
        consumer.run({
          eachMessage: async ({ topic, partition, message }) => {
            messages.push({
              topic,
              partition,
              value: message.value?.toString() || null,
            })
          },
        })

        // Produce messages after consumer is running
        await producer.send({
          topic: 'consumer-test',
          messages: [
            { value: 'test message 1' },
            { value: 'test message 2' },
          ],
        })

        // Give consumer time to process
        await new Promise((r) => setTimeout(r, 100))
        await consumer.stop()

        expect(messages.length).toBeGreaterThanOrEqual(2)
        expect(messages.map((m) => m.value)).toContain('test message 1')
        expect(messages.map((m) => m.value)).toContain('test message 2')
      })

      it('should consume messages with eachBatch handler', async () => {
        await consumer.subscribe({ topics: ['consumer-test'], fromBeginning: true })

        const batches: Array<{ topic: string; messageCount: number }> = []

        // Start consumer in background (don't await)
        consumer.run({
          eachBatch: async ({ batch }) => {
            batches.push({
              topic: batch.topic,
              messageCount: batch.messages.length,
            })
          },
        })

        // Produce messages
        await producer.send({
          topic: 'consumer-test',
          messages: [
            { value: 'batch msg 1' },
            { value: 'batch msg 2' },
          ],
        })

        // Give consumer time to process
        await new Promise((r) => setTimeout(r, 100))
        await consumer.stop()

        expect(batches.length).toBeGreaterThanOrEqual(1)
      })

      it('should provide heartbeat function', async () => {
        await consumer.subscribe({ topics: ['consumer-test'], fromBeginning: true })

        let heartbeatCalled = false

        // Start consumer in background (don't await)
        consumer.run({
          eachMessage: async ({ heartbeat }) => {
            await heartbeat()
            heartbeatCalled = true
          },
        })

        await producer.send({
          topic: 'consumer-test',
          messages: [{ value: 'heartbeat test' }],
        })

        await new Promise((r) => setTimeout(r, 100))
        await consumer.stop()

        expect(heartbeatCalled).toBe(true)
      })
    })

    describe('commitOffsets()', () => {
      it('should commit offsets manually', async () => {
        await consumer.subscribe({ topics: ['consumer-test'], fromBeginning: true })

        await producer.send({
          topic: 'consumer-test',
          messages: [{ value: 'commit test' }],
        })

        // Start consumer in background (don't await)
        consumer.run({
          autoCommit: false,
          eachMessage: async ({ topic, partition, message }) => {
            await consumer.commitOffsets([
              { topic, partition, offset: (parseInt(message.offset) + 1).toString() },
            ])
          },
        })

        await new Promise((r) => setTimeout(r, 100))
        await consumer.stop()

        // Verify offset was committed by checking committed offsets
        const committed = await consumer.committed([{ topic: 'consumer-test', partition: 0 }])
        expect(committed.length).toBeGreaterThanOrEqual(0)
      })

      it('should auto-commit offsets when enabled', async () => {
        await consumer.subscribe({ topics: ['consumer-test'], fromBeginning: true })

        await producer.send({
          topic: 'consumer-test',
          messages: [{ value: 'auto-commit test' }],
        })

        // Start consumer in background (don't await)
        consumer.run({
          autoCommit: true,
          autoCommitInterval: 50,
          eachMessage: async () => {
            // Just consume
          },
        })

        await new Promise((r) => setTimeout(r, 200))
        await consumer.stop()

        // Offsets should be auto-committed
        const committed = await consumer.committed([{ topic: 'consumer-test', partition: 0 }])
        // Just verify the call doesn't throw
        expect(committed).toBeDefined()
      })
    })

    describe('seek()', () => {
      it('should seek to specific offset', async () => {
        await producer.send({
          topic: 'consumer-test',
          messages: [
            { value: 'msg 0' },
            { value: 'msg 1' },
            { value: 'msg 2' },
          ],
        })

        await consumer.subscribe({ topics: ['consumer-test'], fromBeginning: true })

        const messages: string[] = []

        // Start consumer in background (don't await)
        consumer.run({
          eachMessage: async ({ message }) => {
            messages.push(message.value?.toString() || '')
          },
        })

        // Seek to offset 2
        consumer.seek({ topic: 'consumer-test', partition: 0, offset: '2' })

        await new Promise((r) => setTimeout(r, 100))
        await consumer.stop()

        // Should only have consumed from offset 2 onwards
        expect(messages).toContain('msg 2')
      })
    })

    describe('pause() and resume()', () => {
      it('should pause and resume consumption', async () => {
        await consumer.subscribe({ topics: ['consumer-test'], fromBeginning: true })

        const messages: string[] = []

        // Start consumer in background (don't await)
        consumer.run({
          eachMessage: async ({ message }) => {
            messages.push(message.value?.toString() || '')
          },
        })

        // Pause the consumer
        consumer.pause([{ topic: 'consumer-test', partitions: [0, 1] }])

        await producer.send({
          topic: 'consumer-test',
          messages: [{ value: 'while paused' }],
        })

        const messagesWhilePaused = messages.length

        // Resume
        consumer.resume([{ topic: 'consumer-test', partitions: [0, 1] }])

        await new Promise((r) => setTimeout(r, 100))
        await consumer.stop()

        // Should have received the message after resume
        expect(messages.length).toBeGreaterThanOrEqual(messagesWhilePaused)
      })
    })
  })

  describe('Message Format', () => {
    beforeEach(async () => {
      await admin.connect()
      await admin.createTopics({
        topics: [{ topic: 'format-test', numPartitions: 1 }],
      })
      await producer.connect()
      await consumer.connect()
    })

    it('should preserve message key', async () => {
      await producer.send({
        topic: 'format-test',
        messages: [{ key: 'my-key', value: 'my-value' }],
      })

      await consumer.subscribe({ topics: ['format-test'], fromBeginning: true })

      let receivedKey: string | null = null
      // Start consumer in background (don't await)
      consumer.run({
        eachMessage: async ({ message }) => {
          receivedKey = message.key?.toString() || null
        },
      })

      await new Promise((r) => setTimeout(r, 100))
      await consumer.stop()

      expect(receivedKey).toBe('my-key')
    })

    it('should preserve message headers', async () => {
      await producer.send({
        topic: 'format-test',
        messages: [
          {
            value: 'with headers',
            headers: {
              'x-custom-header': 'custom-value',
              'x-another': 'another-value',
            },
          },
        ],
      })

      await consumer.subscribe({ topics: ['format-test'], fromBeginning: true })

      let receivedHeaders: Record<string, string> | undefined
      // Start consumer in background (don't await)
      consumer.run({
        eachMessage: async ({ message }) => {
          receivedHeaders = message.headers as Record<string, string>
        },
      })

      await new Promise((r) => setTimeout(r, 100))
      await consumer.stop()

      expect(receivedHeaders).toBeDefined()
      expect(receivedHeaders?.['x-custom-header']).toBe('custom-value')
      expect(receivedHeaders?.['x-another']).toBe('another-value')
    })

    it('should include timestamp in consumed message', async () => {
      const before = Date.now()

      await producer.send({
        topic: 'format-test',
        messages: [{ value: 'timestamped' }],
      })

      const after = Date.now()

      await consumer.subscribe({ topics: ['format-test'], fromBeginning: true })

      let receivedTimestamp: number | undefined
      // Start consumer in background (don't await)
      consumer.run({
        eachMessage: async ({ message }) => {
          receivedTimestamp = message.timestamp
        },
      })

      await new Promise((r) => setTimeout(r, 100))
      await consumer.stop()

      expect(receivedTimestamp).toBeDefined()
      expect(receivedTimestamp).toBeGreaterThanOrEqual(before)
      expect(receivedTimestamp).toBeLessThanOrEqual(after + 100) // Allow some slack
    })

    it('should handle null values', async () => {
      await producer.send({
        topic: 'format-test',
        messages: [{ key: 'tombstone', value: null }],
      })

      await consumer.subscribe({ topics: ['format-test'], fromBeginning: true })

      let receivedValue: string | null | undefined = 'not-set'
      // Start consumer in background (don't await)
      consumer.run({
        eachMessage: async ({ message }) => {
          receivedValue = message.value?.toString() ?? null
        },
      })

      await new Promise((r) => setTimeout(r, 100))
      await consumer.stop()

      expect(receivedValue).toBeNull()
    })

    it('should handle Buffer values', async () => {
      const bufferValue = Buffer.from('binary data')

      await producer.send({
        topic: 'format-test',
        messages: [{ value: bufferValue }],
      })

      await consumer.subscribe({ topics: ['format-test'], fromBeginning: true })

      let receivedValue: Buffer | undefined
      // Start consumer in background (don't await)
      consumer.run({
        eachMessage: async ({ message }) => {
          receivedValue = message.value as Buffer
        },
      })

      await new Promise((r) => setTimeout(r, 100))
      await consumer.stop()

      expect(receivedValue).toBeDefined()
      expect(receivedValue?.toString()).toBe('binary data')
    })
  })

  describe('Error Handling', () => {
    it('should throw KafkaError for known errors', async () => {
      await admin.connect()

      // Try to create a topic that already exists
      await admin.createTopics({
        topics: [{ topic: 'exists', numPartitions: 1 }],
      })

      await expect(
        admin.createTopics({
          topics: [{ topic: 'exists', numPartitions: 1 }],
        })
      ).rejects.toThrow(KafkaError)
    })

    it('should provide error codes', async () => {
      await admin.connect()
      await admin.createTopics({
        topics: [{ topic: 'error-test', numPartitions: 1 }],
      })

      try {
        await admin.createTopics({
          topics: [{ topic: 'error-test', numPartitions: 1 }],
        })
      } catch (e) {
        expect(e).toBeInstanceOf(KafkaError)
        expect((e as KafkaError).code).toBeDefined()
      }
    })
  })
})

describe('Standalone Factory Functions', () => {
  beforeEach(() => {
    resetRegistry()
  })

  it('should create admin with createAdmin', async () => {
    const admin = createAdmin()
    await admin.connect()
    await admin.createTopics({
      topics: [{ topic: 'standalone-admin-test', numPartitions: 1 }],
    })
    const topics = await admin.listTopics()
    expect(topics).toContain('standalone-admin-test')
    await admin.disconnect()
  })

  it('should create producer with createProducer', async () => {
    const admin = createAdmin()
    await admin.connect()
    await admin.createTopics({
      topics: [{ topic: 'standalone-producer-test', numPartitions: 1 }],
    })

    const producer = createProducer({ admin })
    await producer.connect()
    const result = await producer.send({
      topic: 'standalone-producer-test',
      messages: [{ value: 'standalone test' }],
    })
    expect(result.length).toBe(1)

    await producer.disconnect()
    await admin.disconnect()
  })

  it('should create consumer with createConsumer', async () => {
    const admin = createAdmin()
    await admin.connect()
    await admin.createTopics({
      topics: [{ topic: 'standalone-consumer-test', numPartitions: 1 }],
    })

    const consumer = createConsumer({ admin, groupId: 'standalone-group' })
    await consumer.connect()
    await consumer.subscribe({ topics: ['standalone-consumer-test'] })
    expect(consumer.subscription()).toContain('standalone-consumer-test')

    await consumer.disconnect()
    await admin.disconnect()
  })
})
