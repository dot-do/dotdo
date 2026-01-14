import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  // CDC Event Types and Interfaces
  CDCEvent,
  CDCEventType,
  CDCEventSource,
  CDCEventPayload,

  // Pipeline Core
  CDCPipeline,
  CDCPipelineConfig,
  CDCPipelineState,

  // Event Capture
  CDCEventCapture,
  GitOperationListener,

  // Parquet Transformation
  ParquetTransformer,
  ParquetSchema,
  ParquetRow,
  ParquetBatch,

  // Batching and Processing
  CDCBatcher,
  BatchConfig,
  BatchResult,

  // Error Handling
  CDCError,
  CDCErrorType,
  CDCRetryPolicy,

  // Utilities
  createCDCEvent,
  serializeEvent,
  deserializeEvent,
  validateCDCEvent,

  // Pipeline Operations
  startPipeline,
  stopPipeline,
  flushPipeline,
  getPipelineMetrics
} from '../../src/tiered/cdc-pipeline'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()

function createMockGitOperation(type: string, sha: string): CDCEventPayload {
  return {
    operation: type,
    sha,
    timestamp: Date.now(),
    data: encoder.encode(`mock-${type}-${sha}`),
    metadata: {
      size: 100,
      type: 'blob'
    }
  }
}

function createMockCDCEvent(
  eventType: CDCEventType = 'OBJECT_CREATED',
  source: CDCEventSource = 'push'
): CDCEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: eventType,
    source,
    timestamp: Date.now(),
    payload: createMockGitOperation('put', 'a'.repeat(40)),
    sequence: 1,
    version: 1
  }
}

function createMockPipelineConfig(): CDCPipelineConfig {
  return {
    batchSize: 100,
    flushIntervalMs: 5000,
    maxRetries: 3,
    parquetCompression: 'snappy',
    outputPath: '/tmp/cdc-output',
    schemaVersion: 1
  }
}

// ============================================================================
// CDC Event Types Tests
// ============================================================================

describe('CDC Event Types', () => {
  describe('CDCEventType', () => {
    it('should define OBJECT_CREATED event type', () => {
      const eventType: CDCEventType = 'OBJECT_CREATED'
      expect(eventType).toBe('OBJECT_CREATED')
    })

    it('should define OBJECT_DELETED event type', () => {
      const eventType: CDCEventType = 'OBJECT_DELETED'
      expect(eventType).toBe('OBJECT_DELETED')
    })

    it('should define REF_UPDATED event type', () => {
      const eventType: CDCEventType = 'REF_UPDATED'
      expect(eventType).toBe('REF_UPDATED')
    })

    it('should define PACK_RECEIVED event type', () => {
      const eventType: CDCEventType = 'PACK_RECEIVED'
      expect(eventType).toBe('PACK_RECEIVED')
    })

    it('should define COMMIT_CREATED event type', () => {
      const eventType: CDCEventType = 'COMMIT_CREATED'
      expect(eventType).toBe('COMMIT_CREATED')
    })

    it('should define TREE_MODIFIED event type', () => {
      const eventType: CDCEventType = 'TREE_MODIFIED'
      expect(eventType).toBe('TREE_MODIFIED')
    })

    it('should define BRANCH_CREATED event type', () => {
      const eventType: CDCEventType = 'BRANCH_CREATED'
      expect(eventType).toBe('BRANCH_CREATED')
    })

    it('should define BRANCH_DELETED event type', () => {
      const eventType: CDCEventType = 'BRANCH_DELETED'
      expect(eventType).toBe('BRANCH_DELETED')
    })

    it('should define TAG_CREATED event type', () => {
      const eventType: CDCEventType = 'TAG_CREATED'
      expect(eventType).toBe('TAG_CREATED')
    })

    it('should define MERGE_COMPLETED event type', () => {
      const eventType: CDCEventType = 'MERGE_COMPLETED'
      expect(eventType).toBe('MERGE_COMPLETED')
    })
  })

  describe('CDCEventSource', () => {
    it('should define push source', () => {
      const source: CDCEventSource = 'push'
      expect(source).toBe('push')
    })

    it('should define fetch source', () => {
      const source: CDCEventSource = 'fetch'
      expect(source).toBe('fetch')
    })

    it('should define internal source', () => {
      const source: CDCEventSource = 'internal'
      expect(source).toBe('internal')
    })

    it('should define replication source', () => {
      const source: CDCEventSource = 'replication'
      expect(source).toBe('replication')
    })

    it('should define gc source', () => {
      const source: CDCEventSource = 'gc'
      expect(source).toBe('gc')
    })
  })

  describe('CDCEvent structure', () => {
    it('should have required id field', () => {
      const event = createMockCDCEvent()
      expect(event.id).toBeDefined()
      expect(typeof event.id).toBe('string')
      expect(event.id.length).toBeGreaterThan(0)
    })

    it('should have required type field', () => {
      const event = createMockCDCEvent('OBJECT_CREATED')
      expect(event.type).toBe('OBJECT_CREATED')
    })

    it('should have required source field', () => {
      const event = createMockCDCEvent('OBJECT_CREATED', 'push')
      expect(event.source).toBe('push')
    })

    it('should have required timestamp field', () => {
      const event = createMockCDCEvent()
      expect(event.timestamp).toBeDefined()
      expect(typeof event.timestamp).toBe('number')
      expect(event.timestamp).toBeGreaterThan(0)
    })

    it('should have required payload field', () => {
      const event = createMockCDCEvent()
      expect(event.payload).toBeDefined()
      expect(event.payload.operation).toBeDefined()
    })

    it('should have sequence number for ordering', () => {
      const event = createMockCDCEvent()
      expect(event.sequence).toBeDefined()
      expect(typeof event.sequence).toBe('number')
    })

    it('should have version for schema evolution', () => {
      const event = createMockCDCEvent()
      expect(event.version).toBeDefined()
      expect(typeof event.version).toBe('number')
    })
  })
})

// ============================================================================
// CDC Event Capture Tests
// ============================================================================

describe('CDC Event Capture', () => {
  describe('CDCEventCapture', () => {
    let capture: CDCEventCapture

    beforeEach(() => {
      capture = new CDCEventCapture()
    })

    describe('capturing git operations', () => {
      it('should capture object store PUT operation', async () => {
        const sha = 'a'.repeat(40)
        const data = encoder.encode('blob content')

        await capture.onObjectPut(sha, 'blob', data)

        const events = capture.getEvents()
        expect(events.length).toBe(1)
        expect(events[0].type).toBe('OBJECT_CREATED')
        expect(events[0].payload.sha).toBe(sha)
      })

      it('should capture object store DELETE operation', async () => {
        const sha = 'b'.repeat(40)

        await capture.onObjectDelete(sha)

        const events = capture.getEvents()
        expect(events.length).toBe(1)
        expect(events[0].type).toBe('OBJECT_DELETED')
      })

      it('should capture ref update operation', async () => {
        const refName = 'refs/heads/main'
        const oldSha = 'c'.repeat(40)
        const newSha = 'd'.repeat(40)

        await capture.onRefUpdate(refName, oldSha, newSha)

        const events = capture.getEvents()
        expect(events.length).toBe(1)
        expect(events[0].type).toBe('REF_UPDATED')
        expect(events[0].payload.refName).toBe(refName)
      })

      it('should capture commit creation', async () => {
        const commitSha = 'e'.repeat(40)
        const treeSha = 'f'.repeat(40)
        const parentShas = ['0'.repeat(40)]

        await capture.onCommitCreated(commitSha, treeSha, parentShas)

        const events = capture.getEvents()
        expect(events.length).toBe(1)
        expect(events[0].type).toBe('COMMIT_CREATED')
      })

      it('should capture pack file received', async () => {
        const packData = encoder.encode('PACK...')
        const objectCount = 10

        await capture.onPackReceived(packData, objectCount)

        const events = capture.getEvents()
        expect(events.length).toBe(1)
        expect(events[0].type).toBe('PACK_RECEIVED')
        expect(events[0].payload.objectCount).toBe(objectCount)
      })

      it('should capture branch creation', async () => {
        const branchName = 'feature/new-branch'
        const sha = 'a'.repeat(40)

        await capture.onBranchCreated(branchName, sha)

        const events = capture.getEvents()
        expect(events.length).toBe(1)
        expect(events[0].type).toBe('BRANCH_CREATED')
      })

      it('should capture branch deletion', async () => {
        const branchName = 'feature/old-branch'

        await capture.onBranchDeleted(branchName)

        const events = capture.getEvents()
        expect(events.length).toBe(1)
        expect(events[0].type).toBe('BRANCH_DELETED')
      })

      it('should capture tag creation', async () => {
        const tagName = 'v1.0.0'
        const sha = 'a'.repeat(40)

        await capture.onTagCreated(tagName, sha)

        const events = capture.getEvents()
        expect(events.length).toBe(1)
        expect(events[0].type).toBe('TAG_CREATED')
      })

      it('should capture merge completion', async () => {
        const mergeSha = 'a'.repeat(40)
        const baseSha = 'b'.repeat(40)
        const headSha = 'c'.repeat(40)

        await capture.onMergeCompleted(mergeSha, baseSha, headSha)

        const events = capture.getEvents()
        expect(events.length).toBe(1)
        expect(events[0].type).toBe('MERGE_COMPLETED')
      })
    })

    describe('event sequencing', () => {
      it('should assign monotonically increasing sequence numbers', async () => {
        await capture.onObjectPut('a'.repeat(40), 'blob', new Uint8Array())
        await capture.onObjectPut('b'.repeat(40), 'blob', new Uint8Array())
        await capture.onObjectPut('c'.repeat(40), 'blob', new Uint8Array())

        const events = capture.getEvents()
        expect(events[0].sequence).toBeLessThan(events[1].sequence)
        expect(events[1].sequence).toBeLessThan(events[2].sequence)
      })

      it('should maintain sequence across different event types', async () => {
        await capture.onObjectPut('a'.repeat(40), 'blob', new Uint8Array())
        await capture.onRefUpdate('refs/heads/main', '0'.repeat(40), 'a'.repeat(40))
        await capture.onCommitCreated('b'.repeat(40), 'c'.repeat(40), [])

        const events = capture.getEvents()
        expect(events[2].sequence).toBeGreaterThan(events[0].sequence)
      })

      it('should handle concurrent captures with unique sequences', async () => {
        const promises = Array.from({ length: 100 }, (_, i) =>
          capture.onObjectPut(`${i}`.padStart(40, '0'), 'blob', new Uint8Array())
        )

        await Promise.all(promises)

        const events = capture.getEvents()
        const sequences = events.map(e => e.sequence)
        const uniqueSequences = new Set(sequences)
        expect(uniqueSequences.size).toBe(100)
      })
    })

    describe('event buffering', () => {
      it('should buffer events until flush', async () => {
        await capture.onObjectPut('a'.repeat(40), 'blob', new Uint8Array())
        await capture.onObjectPut('b'.repeat(40), 'blob', new Uint8Array())

        expect(capture.getBufferSize()).toBe(2)
        expect(capture.getEvents().length).toBe(2)
      })

      it('should clear buffer after flush', async () => {
        await capture.onObjectPut('a'.repeat(40), 'blob', new Uint8Array())

        const flushedEvents = await capture.flush()

        expect(flushedEvents.length).toBe(1)
        expect(capture.getBufferSize()).toBe(0)
      })

      it('should respect max buffer size', async () => {
        const captureWithLimit = new CDCEventCapture({ maxBufferSize: 5 })

        for (let i = 0; i < 10; i++) {
          await captureWithLimit.onObjectPut(`${i}`.padStart(40, '0'), 'blob', new Uint8Array())
        }

        // Should auto-flush or reject when buffer is full
        expect(captureWithLimit.getBufferSize()).toBeLessThanOrEqual(5)
      })
    })

    describe('listener registration', () => {
      it('should support registering external listeners', async () => {
        const listener = vi.fn()
        capture.addListener(listener)

        await capture.onObjectPut('a'.repeat(40), 'blob', new Uint8Array())

        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
          type: 'OBJECT_CREATED'
        }))
      })

      it('should support removing listeners', async () => {
        const listener = vi.fn()
        capture.addListener(listener)
        capture.removeListener(listener)

        await capture.onObjectPut('a'.repeat(40), 'blob', new Uint8Array())

        expect(listener).not.toHaveBeenCalled()
      })

      it('should notify all registered listeners', async () => {
        const listener1 = vi.fn()
        const listener2 = vi.fn()
        capture.addListener(listener1)
        capture.addListener(listener2)

        await capture.onObjectPut('a'.repeat(40), 'blob', new Uint8Array())

        expect(listener1).toHaveBeenCalledTimes(1)
        expect(listener2).toHaveBeenCalledTimes(1)
      })
    })
  })
})

// ============================================================================
// Parquet Transformation Tests
// ============================================================================

describe('Parquet Transformation', () => {
  describe('ParquetSchema', () => {
    it('should define schema for CDC events', () => {
      const schema = ParquetSchema.forCDCEvents()

      expect(schema.fields).toBeDefined()
      expect(schema.fields.length).toBeGreaterThan(0)
    })

    it('should include event_id field', () => {
      const schema = ParquetSchema.forCDCEvents()
      const eventIdField = schema.fields.find(f => f.name === 'event_id')

      expect(eventIdField).toBeDefined()
      expect(eventIdField!.type).toBe('STRING')
      expect(eventIdField!.nullable).toBe(false)
    })

    it('should include event_type field', () => {
      const schema = ParquetSchema.forCDCEvents()
      const field = schema.fields.find(f => f.name === 'event_type')

      expect(field).toBeDefined()
      expect(field!.type).toBe('STRING')
    })

    it('should include timestamp field', () => {
      const schema = ParquetSchema.forCDCEvents()
      const field = schema.fields.find(f => f.name === 'timestamp')

      expect(field).toBeDefined()
      expect(field!.type).toBe('TIMESTAMP')
    })

    it('should include sequence field', () => {
      const schema = ParquetSchema.forCDCEvents()
      const field = schema.fields.find(f => f.name === 'sequence')

      expect(field).toBeDefined()
      expect(field!.type).toBe('INT64')
    })

    it('should include payload_json field', () => {
      const schema = ParquetSchema.forCDCEvents()
      const field = schema.fields.find(f => f.name === 'payload_json')

      expect(field).toBeDefined()
      expect(field!.type).toBe('STRING')
    })

    it('should include sha field', () => {
      const schema = ParquetSchema.forCDCEvents()
      const field = schema.fields.find(f => f.name === 'sha')

      expect(field).toBeDefined()
      expect(field!.type).toBe('STRING')
    })

    it('should support custom schema extensions', () => {
      const customFields = [
        { name: 'custom_field', type: 'STRING', nullable: true }
      ]
      const schema = ParquetSchema.forCDCEvents(customFields)

      const field = schema.fields.find(f => f.name === 'custom_field')
      expect(field).toBeDefined()
    })
  })

  describe('ParquetTransformer', () => {
    let transformer: ParquetTransformer

    beforeEach(() => {
      transformer = new ParquetTransformer()
    })

    describe('event to row transformation', () => {
      it('should transform CDC event to Parquet row', () => {
        const event = createMockCDCEvent()

        const row = transformer.eventToRow(event)

        expect(row).toBeDefined()
        expect(row.event_id).toBe(event.id)
        expect(row.event_type).toBe(event.type)
        expect(row.timestamp).toBe(event.timestamp)
      })

      it('should serialize payload as JSON', () => {
        const event = createMockCDCEvent()

        const row = transformer.eventToRow(event)

        expect(row.payload_json).toBeDefined()
        expect(typeof row.payload_json).toBe('string')
        const parsed = JSON.parse(row.payload_json as string)
        expect(parsed.operation).toBe(event.payload.operation)
      })

      it('should extract SHA from payload', () => {
        const event = createMockCDCEvent()

        const row = transformer.eventToRow(event)

        expect(row.sha).toBe(event.payload.sha)
      })

      it('should handle missing optional fields', () => {
        const event: CDCEvent = {
          id: 'test-id',
          type: 'OBJECT_CREATED',
          source: 'push',
          timestamp: Date.now(),
          payload: { operation: 'put' } as CDCEventPayload,
          sequence: 1,
          version: 1
        }

        const row = transformer.eventToRow(event)

        expect(row.sha).toBeNull()
      })

      it('should preserve all required fields', () => {
        const event = createMockCDCEvent()

        const row = transformer.eventToRow(event)

        expect(row.event_id).toBeDefined()
        expect(row.event_type).toBeDefined()
        expect(row.source).toBeDefined()
        expect(row.timestamp).toBeDefined()
        expect(row.sequence).toBeDefined()
        expect(row.version).toBeDefined()
      })
    })

    describe('batch transformation', () => {
      it('should transform multiple events to Parquet batch', () => {
        const events = [
          createMockCDCEvent('OBJECT_CREATED'),
          createMockCDCEvent('REF_UPDATED'),
          createMockCDCEvent('COMMIT_CREATED')
        ]

        const batch = transformer.eventsToBatch(events)

        expect(batch.rows.length).toBe(3)
        expect(batch.rowCount).toBe(3)
      })

      it('should include batch metadata', () => {
        const events = [createMockCDCEvent()]

        const batch = transformer.eventsToBatch(events)

        expect(batch.createdAt).toBeDefined()
        expect(batch.schema).toBeDefined()
        expect(batch.compression).toBeDefined()
      })

      it('should handle empty event array', () => {
        const batch = transformer.eventsToBatch([])

        expect(batch.rows.length).toBe(0)
        expect(batch.rowCount).toBe(0)
      })

      it('should maintain event order in batch', () => {
        const events = [
          { ...createMockCDCEvent(), sequence: 1 },
          { ...createMockCDCEvent(), sequence: 2 },
          { ...createMockCDCEvent(), sequence: 3 }
        ]

        const batch = transformer.eventsToBatch(events)

        expect(batch.rows[0].sequence).toBe(1)
        expect(batch.rows[1].sequence).toBe(2)
        expect(batch.rows[2].sequence).toBe(3)
      })
    })

    describe('Parquet file generation', () => {
      it('should generate valid Parquet buffer from batch', async () => {
        const events = [createMockCDCEvent(), createMockCDCEvent()]
        const batch = transformer.eventsToBatch(events)

        const parquetBuffer = await transformer.toParquetBuffer(batch)

        expect(parquetBuffer).toBeInstanceOf(Uint8Array)
        expect(parquetBuffer.length).toBeGreaterThan(0)
      })

      it('should include Parquet magic bytes', async () => {
        const batch = transformer.eventsToBatch([createMockCDCEvent()])

        const buffer = await transformer.toParquetBuffer(batch)

        // PAR1 magic bytes at start and end
        const magic = new TextDecoder().decode(buffer.slice(0, 4))
        expect(magic).toBe('PAR1')
      })

      it('should support snappy compression', async () => {
        const transformerWithSnappy = new ParquetTransformer({ compression: 'snappy' })
        const batch = transformerWithSnappy.eventsToBatch([createMockCDCEvent()])

        const buffer = await transformerWithSnappy.toParquetBuffer(batch)

        expect(buffer.length).toBeGreaterThan(0)
      })

      it('should support gzip compression', async () => {
        const transformerWithGzip = new ParquetTransformer({ compression: 'gzip' })
        const batch = transformerWithGzip.eventsToBatch([createMockCDCEvent()])

        const buffer = await transformerWithGzip.toParquetBuffer(batch)

        expect(buffer.length).toBeGreaterThan(0)
      })

      it('should support uncompressed output', async () => {
        const transformerUncompressed = new ParquetTransformer({ compression: 'none' })
        const batch = transformerUncompressed.eventsToBatch([createMockCDCEvent()])

        const buffer = await transformerUncompressed.toParquetBuffer(batch)

        expect(buffer.length).toBeGreaterThan(0)
      })

      it('should handle large batches efficiently', async () => {
        const events = Array.from({ length: 10000 }, () => createMockCDCEvent())
        const batch = transformer.eventsToBatch(events)

        const buffer = await transformer.toParquetBuffer(batch)

        expect(buffer.length).toBeGreaterThan(0)
      })
    })
  })
})

// ============================================================================
// Pipeline Processing and Batching Tests
// ============================================================================

describe('Pipeline Processing and Batching', () => {
  describe('CDCBatcher', () => {
    let batcher: CDCBatcher

    beforeEach(() => {
      batcher = new CDCBatcher({ batchSize: 100, flushIntervalMs: 1000 })
    })

    afterEach(async () => {
      await batcher.stop()
    })

    describe('batch accumulation', () => {
      it('should accumulate events until batch size reached', async () => {
        const onBatch = vi.fn()
        batcher.onBatch(onBatch)

        for (let i = 0; i < 50; i++) {
          await batcher.add(createMockCDCEvent())
        }

        expect(onBatch).not.toHaveBeenCalled()
        expect(batcher.getPendingCount()).toBe(50)
      })

      it('should flush when batch size is reached', async () => {
        const batcherSmall = new CDCBatcher({ batchSize: 10, flushIntervalMs: 60000 })
        const onBatch = vi.fn()
        batcherSmall.onBatch(onBatch)

        for (let i = 0; i < 10; i++) {
          await batcherSmall.add(createMockCDCEvent())
        }

        expect(onBatch).toHaveBeenCalledTimes(1)
        expect(onBatch).toHaveBeenCalledWith(expect.objectContaining({
          events: expect.arrayContaining([expect.any(Object)])
        }))

        await batcherSmall.stop()
      })

      it('should flush multiple batches for large event counts', async () => {
        const batcherSmall = new CDCBatcher({ batchSize: 10, flushIntervalMs: 60000 })
        const onBatch = vi.fn()
        batcherSmall.onBatch(onBatch)

        for (let i = 0; i < 25; i++) {
          await batcherSmall.add(createMockCDCEvent())
        }

        expect(onBatch).toHaveBeenCalledTimes(2)
        expect(batcherSmall.getPendingCount()).toBe(5)

        await batcherSmall.stop()
      })
    })

    describe('time-based flushing', () => {
      it('should flush after interval even if batch not full', async () => {
        vi.useFakeTimers()
        const batcherWithInterval = new CDCBatcher({ batchSize: 100, flushIntervalMs: 1000 })
        const onBatch = vi.fn()
        batcherWithInterval.onBatch(onBatch)

        await batcherWithInterval.add(createMockCDCEvent())

        vi.advanceTimersByTime(1000)
        await vi.runAllTimersAsync()

        expect(onBatch).toHaveBeenCalledTimes(1)

        await batcherWithInterval.stop()
        vi.useRealTimers()
      })

      it('should reset timer after batch flush', async () => {
        vi.useFakeTimers()
        const batcherWithInterval = new CDCBatcher({ batchSize: 2, flushIntervalMs: 1000 })
        const onBatch = vi.fn()
        batcherWithInterval.onBatch(onBatch)

        await batcherWithInterval.add(createMockCDCEvent())
        await batcherWithInterval.add(createMockCDCEvent())

        expect(onBatch).toHaveBeenCalledTimes(1)

        await batcherWithInterval.add(createMockCDCEvent())
        vi.advanceTimersByTime(500) // Half interval

        expect(onBatch).toHaveBeenCalledTimes(1) // Still only 1

        await batcherWithInterval.stop()
        vi.useRealTimers()
      })
    })

    describe('manual flush', () => {
      it('should flush pending events on demand', async () => {
        const onBatch = vi.fn()
        batcher.onBatch(onBatch)

        await batcher.add(createMockCDCEvent())
        await batcher.add(createMockCDCEvent())

        await batcher.flush()

        expect(onBatch).toHaveBeenCalledTimes(1)
        expect(batcher.getPendingCount()).toBe(0)
      })

      it('should return batch result on flush', async () => {
        await batcher.add(createMockCDCEvent())

        const result = await batcher.flush()

        expect(result.eventCount).toBe(1)
        expect(result.success).toBe(true)
      })

      it('should handle flush with no pending events', async () => {
        const result = await batcher.flush()

        expect(result.eventCount).toBe(0)
        expect(result.success).toBe(true)
      })
    })

    describe('batch metadata', () => {
      it('should include sequence range in batch', async () => {
        const batcherSmall = new CDCBatcher({ batchSize: 3, flushIntervalMs: 60000 })
        const batches: BatchResult[] = []
        batcherSmall.onBatch((batch) => batches.push(batch))

        const events = [
          { ...createMockCDCEvent(), sequence: 10 },
          { ...createMockCDCEvent(), sequence: 11 },
          { ...createMockCDCEvent(), sequence: 12 }
        ]

        for (const event of events) {
          await batcherSmall.add(event)
        }

        expect(batches[0].minSequence).toBe(10)
        expect(batches[0].maxSequence).toBe(12)

        await batcherSmall.stop()
      })

      it('should include timestamp range in batch', async () => {
        const batcherSmall = new CDCBatcher({ batchSize: 2, flushIntervalMs: 60000 })
        const batches: BatchResult[] = []
        batcherSmall.onBatch((batch) => batches.push(batch))

        const now = Date.now()
        const events = [
          { ...createMockCDCEvent(), timestamp: now },
          { ...createMockCDCEvent(), timestamp: now + 1000 }
        ]

        for (const event of events) {
          await batcherSmall.add(event)
        }

        expect(batches[0].minTimestamp).toBe(now)
        expect(batches[0].maxTimestamp).toBe(now + 1000)

        await batcherSmall.stop()
      })
    })
  })

  describe('CDCPipeline', () => {
    let pipeline: CDCPipeline
    let config: CDCPipelineConfig

    beforeEach(() => {
      config = createMockPipelineConfig()
      pipeline = new CDCPipeline(config)
    })

    afterEach(async () => {
      await pipeline.stop()
    })

    describe('pipeline lifecycle', () => {
      it('should start in stopped state', () => {
        expect(pipeline.getState()).toBe('stopped')
      })

      it('should transition to running on start', async () => {
        await pipeline.start()
        expect(pipeline.getState()).toBe('running')
      })

      it('should transition to stopped on stop', async () => {
        await pipeline.start()
        await pipeline.stop()
        expect(pipeline.getState()).toBe('stopped')
      })

      it('should handle multiple start calls idempotently', async () => {
        await pipeline.start()
        await pipeline.start()
        expect(pipeline.getState()).toBe('running')
      })

      it('should handle multiple stop calls idempotently', async () => {
        await pipeline.start()
        await pipeline.stop()
        await pipeline.stop()
        expect(pipeline.getState()).toBe('stopped')
      })

      it('should flush pending events on stop', async () => {
        await pipeline.start()
        await pipeline.process(createMockCDCEvent())

        const result = await pipeline.stop()

        expect(result.flushedCount).toBeGreaterThanOrEqual(0)
      })
    })

    describe('event processing', () => {
      it('should process single event', async () => {
        await pipeline.start()
        const event = createMockCDCEvent()

        const result = await pipeline.process(event)

        expect(result.success).toBe(true)
        expect(result.eventId).toBe(event.id)
      })

      it('should process multiple events', async () => {
        await pipeline.start()
        const events = [
          createMockCDCEvent(),
          createMockCDCEvent(),
          createMockCDCEvent()
        ]

        const results = await pipeline.processMany(events)

        expect(results.length).toBe(3)
        expect(results.every(r => r.success)).toBe(true)
      })

      it('should reject events when pipeline is stopped', async () => {
        const event = createMockCDCEvent()

        await expect(pipeline.process(event)).rejects.toThrow(/not running/)
      })

      it('should track processed event count', async () => {
        await pipeline.start()

        for (let i = 0; i < 5; i++) {
          await pipeline.process(createMockCDCEvent())
        }

        const metrics = pipeline.getMetrics()
        expect(metrics.eventsProcessed).toBe(5)
      })
    })

    describe('output generation', () => {
      it('should generate Parquet files periodically', async () => {
        vi.useFakeTimers()
        const outputHandler = vi.fn()
        pipeline.onOutput(outputHandler)

        await pipeline.start()

        for (let i = 0; i < 50; i++) {
          await pipeline.process(createMockCDCEvent())
        }

        vi.advanceTimersByTime(config.flushIntervalMs)
        await vi.runAllTimersAsync()

        expect(outputHandler).toHaveBeenCalled()

        await pipeline.stop()
        vi.useRealTimers()
      })

      it('should generate output on batch size threshold', async () => {
        const smallBatchPipeline = new CDCPipeline({
          ...config,
          batchSize: 10
        })
        const outputHandler = vi.fn()
        smallBatchPipeline.onOutput(outputHandler)

        await smallBatchPipeline.start()

        for (let i = 0; i < 10; i++) {
          await smallBatchPipeline.process(createMockCDCEvent())
        }

        expect(outputHandler).toHaveBeenCalled()

        await smallBatchPipeline.stop()
      })

      it('should include Parquet buffer in output', async () => {
        const smallBatchPipeline = new CDCPipeline({
          ...config,
          batchSize: 5
        })
        let outputBuffer: Uint8Array | null = null
        smallBatchPipeline.onOutput((output) => {
          outputBuffer = output.parquetBuffer
        })

        await smallBatchPipeline.start()

        for (let i = 0; i < 5; i++) {
          await smallBatchPipeline.process(createMockCDCEvent())
        }

        expect(outputBuffer).toBeInstanceOf(Uint8Array)
        expect(outputBuffer!.length).toBeGreaterThan(0)

        await smallBatchPipeline.stop()
      })
    })

    describe('pipeline metrics', () => {
      it('should track events processed', async () => {
        await pipeline.start()

        await pipeline.process(createMockCDCEvent())
        await pipeline.process(createMockCDCEvent())

        const metrics = pipeline.getMetrics()
        expect(metrics.eventsProcessed).toBe(2)
      })

      it('should track batches generated', async () => {
        const smallBatchPipeline = new CDCPipeline({
          ...config,
          batchSize: 5
        })
        await smallBatchPipeline.start()

        for (let i = 0; i < 15; i++) {
          await smallBatchPipeline.process(createMockCDCEvent())
        }

        const metrics = smallBatchPipeline.getMetrics()
        expect(metrics.batchesGenerated).toBe(3)

        await smallBatchPipeline.stop()
      })

      it('should track bytes written', async () => {
        const smallBatchPipeline = new CDCPipeline({
          ...config,
          batchSize: 5
        })
        await smallBatchPipeline.start()

        for (let i = 0; i < 5; i++) {
          await smallBatchPipeline.process(createMockCDCEvent())
        }

        const metrics = smallBatchPipeline.getMetrics()
        expect(metrics.bytesWritten).toBeGreaterThan(0)

        await smallBatchPipeline.stop()
      })

      it('should track error count', async () => {
        await pipeline.start()

        // Process invalid event that causes internal error
        try {
          await pipeline.process({} as CDCEvent)
        } catch {
          // Expected error
        }

        const metrics = pipeline.getMetrics()
        expect(metrics.errors).toBeGreaterThanOrEqual(0)
      })

      it('should track average processing latency', async () => {
        await pipeline.start()

        for (let i = 0; i < 10; i++) {
          await pipeline.process(createMockCDCEvent())
        }

        const metrics = pipeline.getMetrics()
        expect(metrics.avgProcessingLatencyMs).toBeGreaterThanOrEqual(0)
      })
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  describe('CDCError', () => {
    it('should create error with type and message', () => {
      const error = new CDCError('VALIDATION_ERROR', 'Invalid event format')

      expect(error.type).toBe('VALIDATION_ERROR')
      expect(error.message).toBe('Invalid event format')
    })

    it('should include original error when provided', () => {
      const originalError = new Error('Original error')
      const error = new CDCError('PROCESSING_ERROR', 'Processing failed', originalError)

      expect(error.cause).toBe(originalError)
    })

    it('should be instanceof Error', () => {
      const error = new CDCError('UNKNOWN_ERROR', 'Something went wrong')
      expect(error).toBeInstanceOf(Error)
    })
  })

  describe('CDCErrorType', () => {
    it('should define VALIDATION_ERROR type', () => {
      const errorType: CDCErrorType = 'VALIDATION_ERROR'
      expect(errorType).toBe('VALIDATION_ERROR')
    })

    it('should define PROCESSING_ERROR type', () => {
      const errorType: CDCErrorType = 'PROCESSING_ERROR'
      expect(errorType).toBe('PROCESSING_ERROR')
    })

    it('should define SERIALIZATION_ERROR type', () => {
      const errorType: CDCErrorType = 'SERIALIZATION_ERROR'
      expect(errorType).toBe('SERIALIZATION_ERROR')
    })

    it('should define STORAGE_ERROR type', () => {
      const errorType: CDCErrorType = 'STORAGE_ERROR'
      expect(errorType).toBe('STORAGE_ERROR')
    })

    it('should define TIMEOUT_ERROR type', () => {
      const errorType: CDCErrorType = 'TIMEOUT_ERROR'
      expect(errorType).toBe('TIMEOUT_ERROR')
    })

    it('should define BUFFER_OVERFLOW_ERROR type', () => {
      const errorType: CDCErrorType = 'BUFFER_OVERFLOW_ERROR'
      expect(errorType).toBe('BUFFER_OVERFLOW_ERROR')
    })
  })

  describe('Event Validation Errors', () => {
    it('should reject event with missing id', () => {
      const invalidEvent = {
        type: 'OBJECT_CREATED',
        source: 'push',
        timestamp: Date.now(),
        payload: {},
        sequence: 1,
        version: 1
      } as CDCEvent

      expect(() => validateCDCEvent(invalidEvent)).toThrow(CDCError)
    })

    it('should reject event with invalid type', () => {
      const invalidEvent = {
        id: 'test-id',
        type: 'INVALID_TYPE' as CDCEventType,
        source: 'push',
        timestamp: Date.now(),
        payload: {},
        sequence: 1,
        version: 1
      }

      expect(() => validateCDCEvent(invalidEvent as CDCEvent)).toThrow(CDCError)
    })

    it('should reject event with invalid timestamp', () => {
      const invalidEvent = {
        id: 'test-id',
        type: 'OBJECT_CREATED',
        source: 'push',
        timestamp: -1,
        payload: {},
        sequence: 1,
        version: 1
      } as CDCEvent

      expect(() => validateCDCEvent(invalidEvent)).toThrow(CDCError)
    })

    it('should reject event with invalid sequence', () => {
      const invalidEvent = {
        id: 'test-id',
        type: 'OBJECT_CREATED',
        source: 'push',
        timestamp: Date.now(),
        payload: {},
        sequence: -1,
        version: 1
      } as CDCEvent

      expect(() => validateCDCEvent(invalidEvent)).toThrow(CDCError)
    })
  })

  describe('CDCRetryPolicy', () => {
    let retryPolicy: CDCRetryPolicy

    beforeEach(() => {
      retryPolicy = new CDCRetryPolicy({
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2
      })
    })

    it('should allow retry when under max retries', () => {
      expect(retryPolicy.shouldRetry(0)).toBe(true)
      expect(retryPolicy.shouldRetry(1)).toBe(true)
      expect(retryPolicy.shouldRetry(2)).toBe(true)
    })

    it('should not allow retry when at max retries', () => {
      expect(retryPolicy.shouldRetry(3)).toBe(false)
    })

    it('should calculate exponential backoff delay', () => {
      const delay0 = retryPolicy.getDelay(0)
      const delay1 = retryPolicy.getDelay(1)
      const delay2 = retryPolicy.getDelay(2)

      expect(delay1).toBeGreaterThan(delay0)
      expect(delay2).toBeGreaterThan(delay1)
    })

    it('should cap delay at max delay', () => {
      const delay = retryPolicy.getDelay(10)
      expect(delay).toBeLessThanOrEqual(1000)
    })

    it('should add jitter to delay when configured', () => {
      const retryPolicyWithJitter = new CDCRetryPolicy({
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitter: true
      })

      const delays = Array.from({ length: 10 }, () => retryPolicyWithJitter.getDelay(1))
      const uniqueDelays = new Set(delays)

      // With jitter, delays should vary
      expect(uniqueDelays.size).toBeGreaterThan(1)
    })
  })

  describe('Pipeline Error Recovery', () => {
    it('should retry failed batch processing', async () => {
      const config = createMockPipelineConfig()
      config.maxRetries = 3
      const pipeline = new CDCPipeline(config)

      let failCount = 0
      const failingHandler = vi.fn().mockImplementation(() => {
        if (failCount < 2) {
          failCount++
          throw new Error('Temporary failure')
        }
      })
      pipeline.onOutput(failingHandler)

      await pipeline.start()

      for (let i = 0; i < config.batchSize; i++) {
        await pipeline.process(createMockCDCEvent())
      }

      // Should eventually succeed after retries
      expect(failingHandler).toHaveBeenCalled()

      await pipeline.stop()
    })

    it('should move to dead letter queue after max retries', async () => {
      const config = createMockPipelineConfig()
      config.maxRetries = 2
      const pipeline = new CDCPipeline(config)

      const dlqHandler = vi.fn()
      pipeline.onDeadLetter(dlqHandler)

      const alwaysFailHandler = vi.fn().mockImplementation(() => {
        throw new Error('Permanent failure')
      })
      pipeline.onOutput(alwaysFailHandler)

      await pipeline.start()

      for (let i = 0; i < config.batchSize; i++) {
        await pipeline.process(createMockCDCEvent())
      }

      // Allow retries to exhaust
      await new Promise(resolve => setTimeout(resolve, 500))

      expect(dlqHandler).toHaveBeenCalled()

      await pipeline.stop()
    })

    it('should continue processing after error', async () => {
      const config = createMockPipelineConfig()
      const pipeline = new CDCPipeline(config)
      await pipeline.start()

      // Process some events, cause an error, then continue
      await pipeline.process(createMockCDCEvent())

      try {
        await pipeline.process({} as CDCEvent)
      } catch {
        // Expected
      }

      // Should still be able to process valid events
      const result = await pipeline.process(createMockCDCEvent())
      expect(result.success).toBe(true)

      await pipeline.stop()
    })
  })
})

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('Utility Functions', () => {
  describe('createCDCEvent', () => {
    it('should create event with auto-generated id', () => {
      const event = createCDCEvent('OBJECT_CREATED', 'push', {
        operation: 'put',
        sha: 'a'.repeat(40)
      } as CDCEventPayload)

      expect(event.id).toBeDefined()
      expect(event.id.length).toBeGreaterThan(0)
    })

    it('should create event with current timestamp', () => {
      const before = Date.now()
      const event = createCDCEvent('OBJECT_CREATED', 'push', {} as CDCEventPayload)
      const after = Date.now()

      expect(event.timestamp).toBeGreaterThanOrEqual(before)
      expect(event.timestamp).toBeLessThanOrEqual(after)
    })

    it('should set default version', () => {
      const event = createCDCEvent('OBJECT_CREATED', 'push', {} as CDCEventPayload)
      expect(event.version).toBe(1)
    })

    it('should allow custom sequence', () => {
      const event = createCDCEvent('OBJECT_CREATED', 'push', {} as CDCEventPayload, { sequence: 42 })
      expect(event.sequence).toBe(42)
    })
  })

  describe('serializeEvent', () => {
    it('should serialize event to JSON bytes', () => {
      const event = createMockCDCEvent()

      const bytes = serializeEvent(event)

      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBeGreaterThan(0)
    })

    it('should produce valid JSON', () => {
      const event = createMockCDCEvent()

      const bytes = serializeEvent(event)
      const json = new TextDecoder().decode(bytes)
      const parsed = JSON.parse(json)

      expect(parsed.id).toBe(event.id)
      expect(parsed.type).toBe(event.type)
    })
  })

  describe('deserializeEvent', () => {
    it('should deserialize bytes to event', () => {
      const originalEvent = createMockCDCEvent()
      const bytes = serializeEvent(originalEvent)

      const event = deserializeEvent(bytes)

      expect(event.id).toBe(originalEvent.id)
      expect(event.type).toBe(originalEvent.type)
      expect(event.sequence).toBe(originalEvent.sequence)
    })

    it('should throw on invalid bytes', () => {
      const invalidBytes = new Uint8Array([0, 1, 2, 3])

      expect(() => deserializeEvent(invalidBytes)).toThrow()
    })

    it('should round-trip serialize/deserialize', () => {
      const originalEvent = createMockCDCEvent()

      const bytes = serializeEvent(originalEvent)
      const event = deserializeEvent(bytes)

      expect(event.id).toBe(originalEvent.id)
      expect(event.type).toBe(originalEvent.type)
      expect(event.source).toBe(originalEvent.source)
      expect(event.timestamp).toBe(originalEvent.timestamp)
      expect(event.sequence).toBe(originalEvent.sequence)
    })
  })

  describe('validateCDCEvent', () => {
    it('should pass for valid event', () => {
      const event = createMockCDCEvent()

      expect(() => validateCDCEvent(event)).not.toThrow()
    })

    it('should fail for null event', () => {
      expect(() => validateCDCEvent(null as unknown as CDCEvent)).toThrow()
    })

    it('should fail for undefined event', () => {
      expect(() => validateCDCEvent(undefined as unknown as CDCEvent)).toThrow()
    })

    it('should return validated event on success', () => {
      const event = createMockCDCEvent()

      const validated = validateCDCEvent(event)

      expect(validated).toBe(event)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('CDC Pipeline Integration', () => {
  describe('End-to-end flow', () => {
    it('should capture git operation and produce Parquet output', async () => {
      const capture = new CDCEventCapture()
      const transformer = new ParquetTransformer()
      const config = createMockPipelineConfig()
      config.batchSize = 5
      const pipeline = new CDCPipeline(config)

      let outputReceived = false
      let parquetBuffer: Uint8Array | null = null

      pipeline.onOutput((output) => {
        outputReceived = true
        parquetBuffer = output.parquetBuffer
      })

      await pipeline.start()

      // Simulate git operations
      for (let i = 0; i < 5; i++) {
        await capture.onObjectPut(`${i}`.padStart(40, '0'), 'blob', new Uint8Array())
      }

      const events = await capture.flush()

      for (const event of events) {
        await pipeline.process(event)
      }

      expect(outputReceived).toBe(true)
      expect(parquetBuffer).not.toBeNull()

      await pipeline.stop()
    })

    it('should maintain event ordering across pipeline', async () => {
      const config = createMockPipelineConfig()
      config.batchSize = 10
      const pipeline = new CDCPipeline(config)

      const capturedSequences: number[] = []
      pipeline.onOutput((output) => {
        for (const event of output.events) {
          capturedSequences.push(event.sequence)
        }
      })

      await pipeline.start()

      for (let i = 0; i < 10; i++) {
        await pipeline.process({
          ...createMockCDCEvent(),
          sequence: i
        })
      }

      // Sequences should be in order
      for (let i = 1; i < capturedSequences.length; i++) {
        expect(capturedSequences[i]).toBeGreaterThan(capturedSequences[i - 1])
      }

      await pipeline.stop()
    })

    it('should handle high throughput', async () => {
      const config = createMockPipelineConfig()
      config.batchSize = 1000
      const pipeline = new CDCPipeline(config)

      let totalEventsOutput = 0
      pipeline.onOutput((output) => {
        totalEventsOutput += output.events.length
      })

      await pipeline.start()

      const eventCount = 10000
      const events = Array.from({ length: eventCount }, (_, i) => ({
        ...createMockCDCEvent(),
        sequence: i
      }))

      await pipeline.processMany(events)
      await pipeline.flush()

      expect(totalEventsOutput).toBe(eventCount)

      await pipeline.stop()
    })
  })
})
