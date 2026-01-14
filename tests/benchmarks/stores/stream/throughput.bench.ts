/**
 * Stream Throughput Benchmarks
 *
 * GREEN PHASE: Benchmarks for Kafka-inspired streaming operations.
 * Tests produce, consume, topic management, and consumer groups.
 *
 * @see do-z9k - Store Benchmark Implementation
 */

import { describe, bench, beforeAll, afterAll } from 'vitest'
import { CostTracker } from '../../framework/cost-tracker'
import {
  AdminClient,
  Producer,
  Consumer,
  _resetStorage,
} from '../../../../db/stream'

describe('Stream Throughput Benchmarks', () => {
  let admin: AdminClient
  let producer: Producer
  let consumer: Consumer
  let tracker: CostTracker

  beforeAll(async () => {
    _resetStorage()
    admin = new AdminClient()
    await admin.createTopic('benchmark-topic', { partitions: 4 })

    producer = new Producer()
    await producer.connect()

    consumer = new Consumer({ groupId: 'benchmark-group' })
    await consumer.connect()
    await consumer.subscribe({ topic: 'benchmark-topic' })

    tracker = new CostTracker()
  })

  afterAll(async () => {
    await producer.disconnect()
    await consumer.disconnect()
    _resetStorage()
  })

  // =========================================================================
  // ADMIN OPERATIONS
  // =========================================================================

  bench('create topic (1 partition)', async () => {
    await admin.createTopic(`topic_${Date.now()}`, { partitions: 1 })
  })

  bench('create topic (8 partitions)', async () => {
    await admin.createTopic(`topic_${Date.now()}`, { partitions: 8 })
  })

  bench('create topic (16 partitions)', async () => {
    await admin.createTopic(`topic_${Date.now()}`, { partitions: 16 })
  })

  bench('list topics', async () => {
    await admin.listTopics()
  })

  bench('describe topic', async () => {
    await admin.describeTopic('benchmark-topic')
  })

  // =========================================================================
  // SINGLE MESSAGE PRODUCE
  // =========================================================================

  bench('produce single message (no key)', async () => {
    await producer.send({
      topic: 'benchmark-topic',
      messages: [{ value: { data: 'hello', timestamp: Date.now() } }],
    })
  })

  bench('produce single message (with key)', async () => {
    await producer.send({
      topic: 'benchmark-topic',
      messages: [{ key: 'user_1', value: { data: 'hello', timestamp: Date.now() } }],
    })
  })

  bench('produce single message (with headers)', async () => {
    await producer.send({
      topic: 'benchmark-topic',
      messages: [{
        key: 'user_1',
        value: { data: 'hello' },
        headers: { 'content-type': 'application/json', 'trace-id': '123' },
      }],
    })
  })

  // =========================================================================
  // BATCH PRODUCE
  // =========================================================================

  bench('produce batch 10 messages', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      key: `key_${i}`,
      value: { data: `message_${i}`, timestamp: Date.now() },
    }))
    await producer.send({ topic: 'benchmark-topic', messages })
  })

  bench('produce batch 100 messages', async () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      key: `key_${i}`,
      value: { data: `message_${i}`, timestamp: Date.now() },
    }))
    await producer.send({ topic: 'benchmark-topic', messages })
  })

  bench('produce batch 1000 messages', async () => {
    const messages = Array.from({ length: 1000 }, (_, i) => ({
      key: `key_${i}`,
      value: { data: `message_${i}`, timestamp: Date.now() },
    }))
    await producer.send({ topic: 'benchmark-topic', messages })
  })

  // =========================================================================
  // CONSUME OPERATIONS
  // =========================================================================

  bench('poll messages (max 1)', async () => {
    await consumer.poll({ maxMessages: 1 })
  })

  bench('poll messages (max 10)', async () => {
    await consumer.poll({ maxMessages: 10 })
  })

  bench('poll messages (max 100)', async () => {
    await consumer.poll({ maxMessages: 100 })
  })

  bench('poll messages (max 1000)', async () => {
    await consumer.poll({ maxMessages: 1000 })
  })

  // =========================================================================
  // COMMIT OPERATIONS
  // =========================================================================

  bench('commit offset (auto)', async () => {
    await consumer.commitOffsets()
  })

  bench('commit offset (specific partition)', async () => {
    await consumer.commitOffsets([
      { topic: 'benchmark-topic', partition: 0, offset: 100 },
    ])
  })

  bench('commit offset (multiple partitions)', async () => {
    await consumer.commitOffsets([
      { topic: 'benchmark-topic', partition: 0, offset: 100 },
      { topic: 'benchmark-topic', partition: 1, offset: 100 },
      { topic: 'benchmark-topic', partition: 2, offset: 100 },
      { topic: 'benchmark-topic', partition: 3, offset: 100 },
    ])
  })

  // =========================================================================
  // IDEMPOTENT PRODUCE
  // =========================================================================

  bench('idempotent produce (new key)', async () => {
    await producer.sendIdempotent({
      topic: 'benchmark-topic',
      messages: [{
        key: `idempotent_${Date.now()}`,
        value: { data: 'idempotent' },
        idempotencyKey: `idem_${Date.now()}`,
      }],
    })
  })

  bench('idempotent produce (duplicate key - no-op)', async () => {
    const idemKey = 'duplicate_key'
    // First send
    await producer.sendIdempotent({
      topic: 'benchmark-topic',
      messages: [{ key: 'k', value: { data: 'first' }, idempotencyKey: idemKey }],
    })
    // Second send - should be no-op
    await producer.sendIdempotent({
      topic: 'benchmark-topic',
      messages: [{ key: 'k', value: { data: 'second' }, idempotencyKey: idemKey }],
    })
  })

  // =========================================================================
  // PARTITION ASSIGNMENT
  // =========================================================================

  bench('get partition assignment', async () => {
    consumer.assignment()
  })

  bench('seek to offset', async () => {
    await consumer.seek({ topic: 'benchmark-topic', partition: 0, offset: 0 })
  })

  bench('seek to beginning', async () => {
    await consumer.seekToBeginning([{ topic: 'benchmark-topic', partition: 0 }])
  })

  bench('seek to end', async () => {
    await consumer.seekToEnd([{ topic: 'benchmark-topic', partition: 0 }])
  })

  // =========================================================================
  // HIGH THROUGHPUT SIMULATION
  // =========================================================================

  bench('high throughput - 100 messages sequential', async () => {
    for (let i = 0; i < 100; i++) {
      await producer.send({
        topic: 'benchmark-topic',
        messages: [{ key: `seq_${i}`, value: { i, ts: Date.now() } }],
      })
    }
  })

  bench('produce-consume round trip', async () => {
    const testTopic = `roundtrip_${Date.now()}`
    await admin.createTopic(testTopic, { partitions: 1 })

    const testConsumer = new Consumer({ groupId: `roundtrip_group_${Date.now()}` })
    await testConsumer.connect()
    await testConsumer.subscribe({ topic: testTopic })

    // Produce
    await producer.send({
      topic: testTopic,
      messages: [{ key: 'roundtrip', value: { test: true } }],
    })

    // Consume
    await testConsumer.poll({ maxMessages: 1 })
    await testConsumer.disconnect()
  })

  // =========================================================================
  // PARTITION TARGETING
  // =========================================================================

  bench('produce to specific partition', async () => {
    await producer.send({
      topic: 'benchmark-topic',
      messages: [{ key: 'targeted', value: { data: 'targeted' }, partition: 0 }],
    })
  })

  bench('produce with key-based partitioning (4 keys)', async () => {
    const messages = ['a', 'b', 'c', 'd'].map((key) => ({
      key,
      value: { key, ts: Date.now() },
    }))
    await producer.send({ topic: 'benchmark-topic', messages })
  })

  // =========================================================================
  // CONSUMER GROUP OPERATIONS
  // =========================================================================

  bench('pause consumption', async () => {
    consumer.pause([{ topic: 'benchmark-topic', partition: 0 }])
  })

  bench('resume consumption', async () => {
    consumer.resume([{ topic: 'benchmark-topic', partition: 0 }])
  })

  bench('get paused partitions', async () => {
    consumer.paused()
  })

  // =========================================================================
  // OFFSET MANAGEMENT
  // =========================================================================

  bench('fetch committed offsets', async () => {
    await consumer.committed([{ topic: 'benchmark-topic', partition: 0 }])
  })

  bench('get position (current offset)', async () => {
    await consumer.position([{ topic: 'benchmark-topic', partition: 0 }])
  })

  // =========================================================================
  // MESSAGE SIZE VARIATIONS
  // =========================================================================

  bench('produce small message (< 1KB)', async () => {
    await producer.send({
      topic: 'benchmark-topic',
      messages: [{ key: 'small', value: { data: 'x'.repeat(100) } }],
    })
  })

  bench('produce medium message (1-10KB)', async () => {
    await producer.send({
      topic: 'benchmark-topic',
      messages: [{ key: 'medium', value: { data: 'x'.repeat(5000) } }],
    })
  })

  bench('produce large message (> 10KB)', async () => {
    await producer.send({
      topic: 'benchmark-topic',
      messages: [{ key: 'large', value: { data: 'x'.repeat(50000) } }],
    })
  })
})
