/**
 * Sink tests
 *
 * RED phase: These tests define the expected behavior of sink destinations.
 * All tests should FAIL until implementation is complete.
 *
 * Sink provides destinations for CDC changes:
 * - In-memory sink for testing
 * - Webhook sink for HTTP delivery
 * - Queue sink for async processing
 * - Multi-sink for fan-out
 * - Sink with retry and error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createMemorySink,
  createWebhookSink,
  createQueueSink,
  createMultiSink,
  createFileSink,
  type Sink,
  type SinkOptions,
  type WebhookSinkOptions,
  type QueueSinkOptions,
  type MultiSinkOptions,
  type FileSinkOptions,
  type SinkResult,
} from '../sink'
import { ChangeType, type ChangeEvent, type CDCPosition } from '../stream'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface TestRecord {
  id: string
  name: string
  value: number
}

function createTestChange(data: Partial<ChangeEvent<TestRecord>> = {}): ChangeEvent<TestRecord> {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    type: ChangeType.INSERT,
    before: null,
    after: { id: '1', name: 'Test', value: 100 },
    timestamp: Date.now(),
    position: { sequence: 1, timestamp: Date.now() },
    isBackfill: false,
    ...data,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// MEMORY SINK
// ============================================================================

describe('MemorySink', () => {
  describe('basic operations', () => {
    it('should store changes in memory', async () => {
      const sink = createMemorySink<TestRecord>()

      await sink.write(createTestChange({ after: { id: '1', name: 'First', value: 1 } }))
      await sink.write(createTestChange({ after: { id: '2', name: 'Second', value: 2 } }))

      const stored = sink.getChanges()
      expect(stored).toHaveLength(2)
    })

    it('should return changes in order', async () => {
      const sink = createMemorySink<TestRecord>()

      await sink.write(createTestChange({ after: { id: '1', name: 'First', value: 1 } }))
      await sink.write(createTestChange({ after: { id: '2', name: 'Second', value: 2 } }))
      await sink.write(createTestChange({ after: { id: '3', name: 'Third', value: 3 } }))

      const stored = sink.getChanges()
      expect(stored[0]!.after!.id).toBe('1')
      expect(stored[1]!.after!.id).toBe('2')
      expect(stored[2]!.after!.id).toBe('3')
    })

    it('should clear stored changes', async () => {
      const sink = createMemorySink<TestRecord>()

      await sink.write(createTestChange())
      await sink.write(createTestChange())
      sink.clear()

      expect(sink.getChanges()).toHaveLength(0)
    })

    it('should limit stored changes', async () => {
      const sink = createMemorySink<TestRecord>({ maxSize: 2 })

      await sink.write(createTestChange({ after: { id: '1', name: 'First', value: 1 } }))
      await sink.write(createTestChange({ after: { id: '2', name: 'Second', value: 2 } }))
      await sink.write(createTestChange({ after: { id: '3', name: 'Third', value: 3 } }))

      const stored = sink.getChanges()
      expect(stored).toHaveLength(2)
      // Should keep most recent
      expect(stored[0]!.after!.id).toBe('2')
      expect(stored[1]!.after!.id).toBe('3')
    })
  })

  describe('querying', () => {
    it('should filter by change type', async () => {
      const sink = createMemorySink<TestRecord>()

      await sink.write(createTestChange({ type: ChangeType.INSERT }))
      await sink.write(createTestChange({ type: ChangeType.UPDATE, before: { id: '1', name: 'Old', value: 1 } }))
      await sink.write(createTestChange({ type: ChangeType.DELETE, after: null, before: { id: '1', name: 'Del', value: 1 } }))

      expect(sink.getChanges({ type: ChangeType.INSERT })).toHaveLength(1)
      expect(sink.getChanges({ type: ChangeType.UPDATE })).toHaveLength(1)
      expect(sink.getChanges({ type: ChangeType.DELETE })).toHaveLength(1)
    })

    it('should filter by key', async () => {
      const sink = createMemorySink<TestRecord>({
        keyExtractor: (event) => event.after?.id || event.before?.id || '',
      })

      await sink.write(createTestChange({ after: { id: '1', name: 'A', value: 1 } }))
      await sink.write(createTestChange({ after: { id: '2', name: 'B', value: 2 } }))
      await sink.write(createTestChange({ after: { id: '1', name: 'A Updated', value: 10 }, type: ChangeType.UPDATE }))

      const key1Changes = sink.getChangesByKey('1')
      expect(key1Changes).toHaveLength(2)
    })

    it('should filter by time range', async () => {
      const sink = createMemorySink<TestRecord>()
      const now = Date.now()

      await sink.write(createTestChange({ timestamp: now - 1000 }))
      await sink.write(createTestChange({ timestamp: now }))
      await sink.write(createTestChange({ timestamp: now + 1000 }))

      const filtered = sink.getChanges({ since: now - 500, until: now + 500 })
      expect(filtered).toHaveLength(1)
    })
  })
})

// ============================================================================
// WEBHOOK SINK
// ============================================================================

describe('WebhookSink', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    })
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('delivery', () => {
    it('should POST changes to webhook URL', async () => {
      const sink = createWebhookSink<TestRecord>({
        url: 'https://example.com/webhook',
      })

      const change = createTestChange()
      await sink.write(change)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        })
      )
    })

    it('should include custom headers', async () => {
      const sink = createWebhookSink<TestRecord>({
        url: 'https://example.com/webhook',
        headers: {
          'Authorization': 'Bearer token123',
          'X-Custom': 'value',
        },
      })

      await sink.write(createTestChange())

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer token123',
            'X-Custom': 'value',
          }),
        })
      )
    })

    it('should batch changes', async () => {
      const sink = createWebhookSink<TestRecord>({
        url: 'https://example.com/webhook',
        batchSize: 3,
      })

      await sink.write(createTestChange())
      await sink.write(createTestChange())
      await sink.write(createTestChange())

      // Should have sent one batched request
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.changes).toHaveLength(3)
    })

    it('should flush on timeout', async () => {
      const sink = createWebhookSink<TestRecord>({
        url: 'https://example.com/webhook',
        batchSize: 100,
        batchTimeoutMs: 50,
      })

      await sink.write(createTestChange())
      await delay(100)

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('retry', () => {
    it('should retry on failure', async () => {
      let attempts = 0
      mockFetch.mockImplementation(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Network error')
        }
        return { ok: true, status: 200 }
      })

      const sink = createWebhookSink<TestRecord>({
        url: 'https://example.com/webhook',
        retryAttempts: 3,
        retryDelayMs: 10,
      })

      await sink.write(createTestChange())
      await sink.flush()

      expect(attempts).toBe(3)
    })

    it('should handle non-retryable errors', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request' })

      const errors: Error[] = []
      const sink = createWebhookSink<TestRecord>({
        url: 'https://example.com/webhook',
        retryAttempts: 3,
        onError: async (error) => {
          errors.push(error)
        },
      })

      await sink.write(createTestChange())
      await sink.flush()

      // 400 should not be retried
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
    })

    it('should exponential backoff on retries', async () => {
      const timestamps: number[] = []
      mockFetch.mockImplementation(async () => {
        timestamps.push(Date.now())
        throw new Error('Server error')
      })

      const sink = createWebhookSink<TestRecord>({
        url: 'https://example.com/webhook',
        retryAttempts: 3,
        retryDelayMs: 50,
        exponentialBackoff: true,
      })

      try {
        await sink.write(createTestChange())
        await sink.flush()
      } catch {
        // Expected
      }

      // Verify increasing delays
      if (timestamps.length >= 3) {
        const delay1 = timestamps[1]! - timestamps[0]!
        const delay2 = timestamps[2]! - timestamps[1]!
        expect(delay2).toBeGreaterThan(delay1)
      }
    })
  })

  describe('circuit breaker', () => {
    it('should open circuit after consecutive failures', async () => {
      mockFetch.mockRejectedValue(new Error('Server down'))

      const sink = createWebhookSink<TestRecord>({
        url: 'https://example.com/webhook',
        circuitBreakerThreshold: 3,
        retryAttempts: 1,
      })

      // Trigger failures
      for (let i = 0; i < 5; i++) {
        try {
          await sink.write(createTestChange())
          await sink.flush()
        } catch {
          // Expected
        }
      }

      // Circuit should be open, no more calls
      const callCount = mockFetch.mock.calls.length
      expect(sink.isCircuitOpen()).toBe(true)

      // Attempt should fail fast
      await expect(sink.write(createTestChange())).rejects.toThrow(/circuit.*open/i)
      expect(mockFetch.mock.calls.length).toBe(callCount)
    })

    it('should close circuit after cooldown', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Server down'))
      mockFetch.mockRejectedValueOnce(new Error('Server down'))
      mockFetch.mockRejectedValueOnce(new Error('Server down'))
      mockFetch.mockResolvedValue({ ok: true, status: 200 })

      const sink = createWebhookSink<TestRecord>({
        url: 'https://example.com/webhook',
        circuitBreakerThreshold: 3,
        circuitBreakerCooldownMs: 50,
        retryAttempts: 1,
      })

      // Open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await sink.write(createTestChange())
          await sink.flush()
        } catch {
          // Expected
        }
      }

      expect(sink.isCircuitOpen()).toBe(true)

      // Wait for cooldown
      await delay(100)

      // Should allow retry
      await sink.write(createTestChange())
      await sink.flush()
      expect(sink.isCircuitOpen()).toBe(false)
    })
  })
})

// ============================================================================
// QUEUE SINK
// ============================================================================

describe('QueueSink', () => {
  describe('enqueue', () => {
    it('should enqueue changes', async () => {
      const queue: ChangeEvent<TestRecord>[] = []
      const sink = createQueueSink<TestRecord>({
        enqueue: async (changes) => {
          queue.push(...changes)
        },
      })

      await sink.write(createTestChange({ after: { id: '1', name: 'A', value: 1 } }))
      await sink.write(createTestChange({ after: { id: '2', name: 'B', value: 2 } }))
      await sink.flush()

      expect(queue).toHaveLength(2)
    })

    it('should partition by key', async () => {
      const partitions = new Map<string, ChangeEvent<TestRecord>[]>()
      const sink = createQueueSink<TestRecord>({
        partitionKey: (event) => event.after?.id || event.before?.id || 'default',
        enqueue: async (changes, partition) => {
          if (!partitions.has(partition!)) {
            partitions.set(partition!, [])
          }
          partitions.get(partition!)!.push(...changes)
        },
      })

      await sink.write(createTestChange({ after: { id: '1', name: 'A', value: 1 } }))
      await sink.write(createTestChange({ after: { id: '2', name: 'B', value: 2 } }))
      await sink.write(createTestChange({ after: { id: '1', name: 'A2', value: 10 } }))
      await sink.flush()

      expect(partitions.get('1')).toHaveLength(2)
      expect(partitions.get('2')).toHaveLength(1)
    })

    it('should maintain order within partition', async () => {
      const queue: ChangeEvent<TestRecord>[] = []
      const sink = createQueueSink<TestRecord>({
        enqueue: async (changes) => {
          queue.push(...changes)
        },
        preserveOrder: true,
      })

      const changes = [
        createTestChange({ after: { id: '1', name: 'A', value: 1 }, timestamp: 1 }),
        createTestChange({ after: { id: '1', name: 'B', value: 2 }, timestamp: 2 }),
        createTestChange({ after: { id: '1', name: 'C', value: 3 }, timestamp: 3 }),
      ]

      for (const c of changes) {
        await sink.write(c)
      }
      await sink.flush()

      expect(queue[0]!.timestamp).toBeLessThan(queue[1]!.timestamp)
      expect(queue[1]!.timestamp).toBeLessThan(queue[2]!.timestamp)
    })
  })

  describe('acknowledgment', () => {
    it('should track pending acknowledgments', async () => {
      const sink = createQueueSink<TestRecord>({
        enqueue: async () => {},
        requireAck: true,
      })

      await sink.write(createTestChange())
      await sink.flush()

      expect(sink.getPendingAckCount()).toBe(1)
    })

    it('should confirm on acknowledgment', async () => {
      const sink = createQueueSink<TestRecord>({
        enqueue: async () => {},
        requireAck: true,
      })

      const change = createTestChange()
      await sink.write(change)
      await sink.flush()

      await sink.acknowledge(change.eventId)
      expect(sink.getPendingAckCount()).toBe(0)
    })

    it('should retry unacknowledged after timeout', async () => {
      let enqueueCount = 0
      const sink = createQueueSink<TestRecord>({
        enqueue: async () => {
          enqueueCount++
        },
        requireAck: true,
        ackTimeoutMs: 50,
      })

      await sink.write(createTestChange())
      await sink.flush()
      expect(enqueueCount).toBe(1)

      // Wait for timeout
      await delay(100)

      // Should have retried
      expect(enqueueCount).toBe(2)
    })
  })
})

// ============================================================================
// MULTI SINK (Fan-out)
// ============================================================================

describe('MultiSink', () => {
  describe('fan-out', () => {
    it('should write to multiple sinks', async () => {
      const sink1 = createMemorySink<TestRecord>()
      const sink2 = createMemorySink<TestRecord>()
      const sink3 = createMemorySink<TestRecord>()

      const multi = createMultiSink<TestRecord>({
        sinks: [sink1, sink2, sink3],
      })

      await multi.write(createTestChange())

      expect(sink1.getChanges()).toHaveLength(1)
      expect(sink2.getChanges()).toHaveLength(1)
      expect(sink3.getChanges()).toHaveLength(1)
    })

    it('should write in parallel by default', async () => {
      const writeOrder: string[] = []
      const sink1: Sink<TestRecord> = {
        write: async () => {
          await delay(30)
          writeOrder.push('sink1')
        },
        flush: async () => {},
      }
      const sink2: Sink<TestRecord> = {
        write: async () => {
          await delay(10)
          writeOrder.push('sink2')
        },
        flush: async () => {},
      }

      const multi = createMultiSink<TestRecord>({
        sinks: [sink1, sink2],
        parallel: true,
      })

      await multi.write(createTestChange())

      // sink2 should finish first due to shorter delay
      expect(writeOrder).toEqual(['sink2', 'sink1'])
    })

    it('should write sequentially when configured', async () => {
      const writeOrder: string[] = []
      const sink1: Sink<TestRecord> = {
        write: async () => {
          await delay(30)
          writeOrder.push('sink1')
        },
        flush: async () => {},
      }
      const sink2: Sink<TestRecord> = {
        write: async () => {
          await delay(10)
          writeOrder.push('sink2')
        },
        flush: async () => {},
      }

      const multi = createMultiSink<TestRecord>({
        sinks: [sink1, sink2],
        parallel: false,
      })

      await multi.write(createTestChange())

      // Should be in order
      expect(writeOrder).toEqual(['sink1', 'sink2'])
    })
  })

  describe('error handling', () => {
    it('should continue on partial failure with continueOnError', async () => {
      const sink1 = createMemorySink<TestRecord>()
      const failingSink: Sink<TestRecord> = {
        write: async () => {
          throw new Error('Sink failed')
        },
        flush: async () => {},
      }
      const sink3 = createMemorySink<TestRecord>()

      const multi = createMultiSink<TestRecord>({
        sinks: [sink1, failingSink, sink3],
        continueOnError: true,
      })

      await multi.write(createTestChange())

      expect(sink1.getChanges()).toHaveLength(1)
      expect(sink3.getChanges()).toHaveLength(1)
    })

    it('should fail fast without continueOnError', async () => {
      const sink1 = createMemorySink<TestRecord>()
      const failingSink: Sink<TestRecord> = {
        write: async () => {
          throw new Error('Sink failed')
        },
        flush: async () => {},
      }
      const sink3 = createMemorySink<TestRecord>()

      const multi = createMultiSink<TestRecord>({
        sinks: [sink1, failingSink, sink3],
        continueOnError: false,
        parallel: false,
      })

      await expect(multi.write(createTestChange())).rejects.toThrow('Sink failed')
    })

    it('should collect errors from all sinks', async () => {
      const errors: Error[] = []
      const failing1: Sink<TestRecord> = {
        write: async () => {
          throw new Error('Sink 1 failed')
        },
        flush: async () => {},
      }
      const failing2: Sink<TestRecord> = {
        write: async () => {
          throw new Error('Sink 2 failed')
        },
        flush: async () => {},
      }

      const multi = createMultiSink<TestRecord>({
        sinks: [failing1, failing2],
        continueOnError: true,
        onError: async (error) => {
          errors.push(error)
        },
      })

      await multi.write(createTestChange())

      expect(errors).toHaveLength(2)
    })
  })

  describe('routing', () => {
    it('should route to specific sinks based on condition', async () => {
      const insertSink = createMemorySink<TestRecord>()
      const updateSink = createMemorySink<TestRecord>()
      const deleteSink = createMemorySink<TestRecord>()

      const multi = createMultiSink<TestRecord>({
        sinks: [],
        routes: [
          { condition: (e) => e.type === ChangeType.INSERT, sink: insertSink },
          { condition: (e) => e.type === ChangeType.UPDATE, sink: updateSink },
          { condition: (e) => e.type === ChangeType.DELETE, sink: deleteSink },
        ],
      })

      await multi.write(createTestChange({ type: ChangeType.INSERT }))
      await multi.write(createTestChange({ type: ChangeType.UPDATE, before: { id: '1', name: 'Old', value: 1 } }))
      await multi.write(createTestChange({ type: ChangeType.DELETE, after: null, before: { id: '1', name: 'Del', value: 1 } }))

      expect(insertSink.getChanges()).toHaveLength(1)
      expect(updateSink.getChanges()).toHaveLength(1)
      expect(deleteSink.getChanges()).toHaveLength(1)
    })
  })
})

// ============================================================================
// FILE SINK
// ============================================================================

describe('FileSink', () => {
  describe('writing', () => {
    it('should write changes to buffer', async () => {
      const sink = createFileSink<TestRecord>({
        format: 'jsonl',
      })

      await sink.write(createTestChange({ after: { id: '1', name: 'Test', value: 100 } }))
      await sink.flush()

      const content = sink.getBufferedContent()
      expect(content).toContain('"id":"1"')
    })

    it('should format as JSON Lines', async () => {
      const sink = createFileSink<TestRecord>({
        format: 'jsonl',
      })

      await sink.write(createTestChange({ after: { id: '1', name: 'A', value: 1 } }))
      await sink.write(createTestChange({ after: { id: '2', name: 'B', value: 2 } }))
      await sink.flush()

      const lines = sink.getBufferedContent().trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(() => JSON.parse(lines[0]!)).not.toThrow()
      expect(() => JSON.parse(lines[1]!)).not.toThrow()
    })

    it('should format as CSV', async () => {
      const sink = createFileSink<TestRecord>({
        format: 'csv',
        columns: ['id', 'name', 'value'],
      })

      await sink.write(createTestChange({ after: { id: '1', name: 'Test', value: 100 } }))
      await sink.flush()

      const content = sink.getBufferedContent()
      expect(content).toContain('id,name,value')
      expect(content).toContain('1,Test,100')
    })

    it('should format as Parquet metadata', async () => {
      const sink = createFileSink<TestRecord>({
        format: 'parquet',
      })

      await sink.write(createTestChange({ after: { id: '1', name: 'Test', value: 100 } }))
      await sink.flush()

      // Parquet format stores metadata about batches
      const metadata = sink.getParquetMetadata()
      expect(metadata.rowCount).toBe(1)
    })
  })

  describe('rotation', () => {
    it('should rotate on size limit', async () => {
      const rotations: string[] = []
      const sink = createFileSink<TestRecord>({
        format: 'jsonl',
        maxSizeBytes: 100,
        onRotate: async (content) => {
          rotations.push(content)
        },
      })

      // Write enough to trigger rotation
      for (let i = 0; i < 10; i++) {
        await sink.write(createTestChange({ after: { id: `${i}`, name: 'Test with longer name', value: i } }))
      }
      await sink.flush()

      expect(rotations.length).toBeGreaterThan(0)
    })

    it('should rotate on record count', async () => {
      const rotations: string[] = []
      const sink = createFileSink<TestRecord>({
        format: 'jsonl',
        maxRecords: 3,
        onRotate: async (content) => {
          rotations.push(content)
        },
      })

      for (let i = 0; i < 10; i++) {
        await sink.write(createTestChange({ after: { id: `${i}`, name: 'Test', value: i } }))
      }
      await sink.flush()

      expect(rotations.length).toBeGreaterThanOrEqual(3)
    })

    it('should rotate on time interval', async () => {
      const rotations: string[] = []
      const sink = createFileSink<TestRecord>({
        format: 'jsonl',
        rotateIntervalMs: 50,
        onRotate: async (content) => {
          rotations.push(content)
        },
      })

      await sink.write(createTestChange())
      await delay(100)
      await sink.write(createTestChange())
      await delay(100)
      await sink.flush()

      expect(rotations.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('compression', () => {
    it('should compress output', async () => {
      const sink = createFileSink<TestRecord>({
        format: 'jsonl',
        compression: 'gzip',
      })

      await sink.write(createTestChange({ after: { id: '1', name: 'Test', value: 100 } }))
      await sink.flush()

      const compressed = sink.getCompressedContent()
      expect(compressed).toBeDefined()
      // Compressed should be different from raw
      expect(compressed).not.toBe(sink.getBufferedContent())
    })
  })
})

// ============================================================================
// SINK COMPOSITION
// ============================================================================

describe('Sink composition', () => {
  it('should chain sinks with middleware', async () => {
    const logged: string[] = []
    const memory = createMemorySink<TestRecord>()

    const loggingSink: Sink<TestRecord> = {
      write: async (event) => {
        logged.push(`Writing: ${event.eventId}`)
        await memory.write(event)
      },
      flush: async () => {
        logged.push('Flushing')
        await memory.flush()
      },
    }

    await loggingSink.write(createTestChange())
    await loggingSink.flush()

    expect(logged).toContain('Flushing')
    expect(memory.getChanges()).toHaveLength(1)
  })

  it('should support metrics wrapper', async () => {
    const metrics = {
      writeCount: 0,
      flushCount: 0,
      errorCount: 0,
    }

    function withMetrics<T>(sink: Sink<T>): Sink<T> {
      return {
        write: async (event) => {
          metrics.writeCount++
          await sink.write(event)
        },
        flush: async () => {
          metrics.flushCount++
          await sink.flush()
        },
      }
    }

    const memory = createMemorySink<TestRecord>()
    const sink = withMetrics(memory)

    await sink.write(createTestChange())
    await sink.write(createTestChange())
    await sink.flush()

    expect(metrics.writeCount).toBe(2)
    expect(metrics.flushCount).toBe(1)
  })
})
