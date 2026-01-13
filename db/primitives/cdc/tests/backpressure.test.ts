/**
 * Backpressure Handling tests for CDC Streams
 *
 * RED phase: These tests define the expected behavior of backpressure handling.
 * All tests should FAIL until implementation is complete.
 *
 * Backpressure handling provides:
 * - FlowController with high/low watermarks for flow control
 * - AdaptiveBatcher with throughput metrics for adaptive batching
 * - BackpressureSignal for upstream coordination (pause/resume)
 * - Buffer overflow handling strategies
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  FlowController,
  createFlowController,
  AdaptiveBatcher,
  createAdaptiveBatcher,
  BackpressureSignal,
  createBackpressureSignal,
  FlowState,
  OverflowStrategy,
  type FlowControllerOptions,
  type AdaptiveBatcherOptions,
  type BackpressureSignalOptions,
  type FlowControllerStats,
  type AdaptiveBatcherStats,
  type BackpressureCallback,
} from '../backpressure'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface TestEvent {
  id: string
  data: string
  timestamp: number
}

function createTestEvent(id: string): TestEvent {
  return { id, data: `data-${id}`, timestamp: Date.now() }
}

// ============================================================================
// FLOW CONTROLLER
// ============================================================================

describe('FlowController', () => {
  describe('watermark-based flow control', () => {
    it('should create flow controller with high/low watermarks', () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 100,
        lowWatermark: 20,
      })

      expect(controller).toBeDefined()
      expect(controller.getHighWatermark()).toBe(100)
      expect(controller.getLowWatermark()).toBe(20)
    })

    it('should start in flowing state', () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 100,
        lowWatermark: 20,
      })

      expect(controller.getState()).toBe(FlowState.FLOWING)
      expect(controller.isFlowing()).toBe(true)
    })

    it('should transition to paused when buffer exceeds high watermark', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 5,
        lowWatermark: 2,
      })

      // Fill buffer beyond high watermark
      for (let i = 0; i < 6; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      expect(controller.getState()).toBe(FlowState.PAUSED)
      expect(controller.isFlowing()).toBe(false)
    })

    it('should transition back to flowing when buffer drains below low watermark', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 5,
        lowWatermark: 2,
      })

      // Fill buffer
      for (let i = 0; i < 6; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      expect(controller.getState()).toBe(FlowState.PAUSED)

      // Drain buffer below low watermark
      while (controller.getBufferSize() > 1) {
        await controller.pull()
      }

      expect(controller.getState()).toBe(FlowState.FLOWING)
    })

    it('should emit state change events', async () => {
      const stateChanges: FlowState[] = []
      const controller = createFlowController<TestEvent>({
        highWatermark: 3,
        lowWatermark: 1,
        onStateChange: (state) => {
          stateChanges.push(state)
        },
      })

      // Fill to high watermark
      for (let i = 0; i < 4; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      expect(stateChanges).toContain(FlowState.PAUSED)

      // Drain to low watermark
      while (controller.getBufferSize() > 0) {
        await controller.pull()
      }

      expect(stateChanges).toContain(FlowState.FLOWING)
    })

    it('should validate watermark configuration', () => {
      // Low watermark should be less than high watermark
      expect(() =>
        createFlowController<TestEvent>({
          highWatermark: 10,
          lowWatermark: 20,
        })
      ).toThrow()

      // Both watermarks should be positive
      expect(() =>
        createFlowController<TestEvent>({
          highWatermark: -5,
          lowWatermark: -10,
        })
      ).toThrow()
    })

    it('should report buffer utilization percentage', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 100,
        lowWatermark: 20,
      })

      expect(controller.getBufferUtilization()).toBe(0)

      for (let i = 0; i < 50; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      expect(controller.getBufferUtilization()).toBe(50)
    })
  })

  describe('buffer operations', () => {
    it('should push and pull events in FIFO order', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 100,
        lowWatermark: 20,
      })

      await controller.push(createTestEvent('1'))
      await controller.push(createTestEvent('2'))
      await controller.push(createTestEvent('3'))

      const event1 = await controller.pull()
      const event2 = await controller.pull()
      const event3 = await controller.pull()

      expect(event1?.id).toBe('1')
      expect(event2?.id).toBe('2')
      expect(event3?.id).toBe('3')
    })

    it('should return undefined when pulling from empty buffer', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 100,
        lowWatermark: 20,
      })

      const event = await controller.pull()
      expect(event).toBeUndefined()
    })

    it('should support peeking without removing', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 100,
        lowWatermark: 20,
      })

      await controller.push(createTestEvent('1'))

      const peeked = controller.peek()
      expect(peeked?.id).toBe('1')
      expect(controller.getBufferSize()).toBe(1)

      const pulled = await controller.pull()
      expect(pulled?.id).toBe('1')
      expect(controller.getBufferSize()).toBe(0)
    })

    it('should support batch pull', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 100,
        lowWatermark: 20,
      })

      for (let i = 0; i < 10; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      const batch = await controller.pullBatch(5)
      expect(batch).toHaveLength(5)
      expect(batch[0]?.id).toBe('0')
      expect(batch[4]?.id).toBe('4')
      expect(controller.getBufferSize()).toBe(5)
    })

    it('should clear buffer and reset state', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 5,
        lowWatermark: 2,
      })

      for (let i = 0; i < 6; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      expect(controller.getState()).toBe(FlowState.PAUSED)

      controller.clear()

      expect(controller.getBufferSize()).toBe(0)
      expect(controller.getState()).toBe(FlowState.FLOWING)
    })
  })

  describe('overflow strategies', () => {
    it('should block push when using BLOCK strategy and buffer is full', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 3,
        lowWatermark: 1,
        maxBufferSize: 5,
        overflowStrategy: OverflowStrategy.BLOCK,
      })

      // Fill to max
      for (let i = 0; i < 5; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      // Next push should block - use timeout to verify
      const pushPromise = controller.push(createTestEvent('blocked'))
      let resolved = false

      pushPromise.then(() => {
        resolved = true
      })

      await delay(50)
      expect(resolved).toBe(false)

      // Drain one to unblock
      await controller.pull()
      await delay(10)
      expect(resolved).toBe(true)
    })

    it('should drop oldest when using DROP_OLDEST strategy', async () => {
      const dropped: TestEvent[] = []
      const controller = createFlowController<TestEvent>({
        highWatermark: 3,
        lowWatermark: 1,
        maxBufferSize: 5,
        overflowStrategy: OverflowStrategy.DROP_OLDEST,
        onDrop: (event) => dropped.push(event),
      })

      // Fill beyond max
      for (let i = 0; i < 7; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      expect(controller.getBufferSize()).toBe(5)
      expect(dropped).toHaveLength(2)
      expect(dropped[0]?.id).toBe('0')
      expect(dropped[1]?.id).toBe('1')

      // Should have newest events
      const oldest = controller.peek()
      expect(oldest?.id).toBe('2')
    })

    it('should drop newest when using DROP_NEWEST strategy', async () => {
      const dropped: TestEvent[] = []
      const controller = createFlowController<TestEvent>({
        highWatermark: 3,
        lowWatermark: 1,
        maxBufferSize: 5,
        overflowStrategy: OverflowStrategy.DROP_NEWEST,
        onDrop: (event) => dropped.push(event),
      })

      // Fill beyond max
      for (let i = 0; i < 7; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      expect(controller.getBufferSize()).toBe(5)
      expect(dropped).toHaveLength(2)
      expect(dropped[0]?.id).toBe('5')
      expect(dropped[1]?.id).toBe('6')
    })

    it('should throw when using ERROR strategy and buffer overflows', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 3,
        lowWatermark: 1,
        maxBufferSize: 5,
        overflowStrategy: OverflowStrategy.ERROR,
      })

      // Fill to max
      for (let i = 0; i < 5; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      // Next push should throw
      await expect(controller.push(createTestEvent('overflow'))).rejects.toThrow(
        /buffer overflow/i
      )
    })
  })

  describe('statistics', () => {
    it('should track total events pushed and pulled', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 100,
        lowWatermark: 20,
      })

      for (let i = 0; i < 10; i++) {
        await controller.push(createTestEvent(`${i}`))
      }
      for (let i = 0; i < 5; i++) {
        await controller.pull()
      }

      const stats = controller.getStats()
      expect(stats.totalPushed).toBe(10)
      expect(stats.totalPulled).toBe(5)
    })

    it('should track pause/resume counts', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 3,
        lowWatermark: 1,
      })

      // Trigger pause
      for (let i = 0; i < 4; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      // Trigger resume
      while (controller.getBufferSize() > 0) {
        await controller.pull()
      }

      // Trigger pause again
      for (let i = 0; i < 4; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      const stats = controller.getStats()
      expect(stats.pauseCount).toBe(2)
      expect(stats.resumeCount).toBe(1)
    })

    it('should track dropped events count', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 3,
        lowWatermark: 1,
        maxBufferSize: 5,
        overflowStrategy: OverflowStrategy.DROP_OLDEST,
      })

      for (let i = 0; i < 10; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      const stats = controller.getStats()
      expect(stats.droppedCount).toBe(5)
    })

    it('should track max buffer size reached', async () => {
      const controller = createFlowController<TestEvent>({
        highWatermark: 100,
        lowWatermark: 20,
      })

      for (let i = 0; i < 50; i++) {
        await controller.push(createTestEvent(`${i}`))
      }
      for (let i = 0; i < 30; i++) {
        await controller.pull()
      }

      const stats = controller.getStats()
      expect(stats.maxBufferSizeReached).toBe(50)
    })
  })
})

// ============================================================================
// ADAPTIVE BATCHER
// ============================================================================

describe('AdaptiveBatcher', () => {
  describe('throughput-based batching', () => {
    it('should create adaptive batcher with initial batch size', () => {
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 10,
        minBatchSize: 1,
        maxBatchSize: 100,
      })

      expect(batcher).toBeDefined()
      expect(batcher.getCurrentBatchSize()).toBe(10)
    })

    it('should increase batch size when throughput is high', async () => {
      const batches: TestEvent[][] = []
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 10,
        minBatchSize: 1,
        maxBatchSize: 100,
        targetLatencyMs: 100,
        onBatch: async (batch) => {
          batches.push([...batch])
          // Simulate fast processing
          await delay(10)
        },
      })

      // Process many events quickly
      for (let i = 0; i < 100; i++) {
        await batcher.add(createTestEvent(`${i}`))
      }
      await batcher.flush()

      // Batch size should have increased
      expect(batcher.getCurrentBatchSize()).toBeGreaterThan(10)
    })

    it('should decrease batch size when throughput is low', async () => {
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 50,
        minBatchSize: 1,
        maxBatchSize: 100,
        targetLatencyMs: 50,
        onBatch: async (batch) => {
          // Simulate slow processing
          await delay(200)
        },
      })

      // Process events slowly
      for (let i = 0; i < 60; i++) {
        await batcher.add(createTestEvent(`${i}`))
      }
      await batcher.flush()

      // Batch size should have decreased
      expect(batcher.getCurrentBatchSize()).toBeLessThan(50)
    })

    it('should respect min/max batch size bounds', async () => {
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 10,
        minBatchSize: 5,
        maxBatchSize: 20,
        targetLatencyMs: 100,
        onBatch: async () => {
          await delay(1)
        },
      })

      // Try to push batch size beyond max
      for (let i = 0; i < 1000; i++) {
        await batcher.add(createTestEvent(`${i}`))
      }
      await batcher.flush()

      expect(batcher.getCurrentBatchSize()).toBeLessThanOrEqual(20)
      expect(batcher.getCurrentBatchSize()).toBeGreaterThanOrEqual(5)
    })
  })

  describe('batch triggering', () => {
    it('should trigger batch when size threshold is reached', async () => {
      let batchCount = 0
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 5,
        minBatchSize: 1,
        maxBatchSize: 100,
        onBatch: async (batch) => {
          batchCount++
        },
      })

      for (let i = 0; i < 15; i++) {
        await batcher.add(createTestEvent(`${i}`))
      }

      expect(batchCount).toBeGreaterThanOrEqual(3)
    })

    it('should trigger batch on timeout', async () => {
      let batchCount = 0
      let lastBatchSize = 0
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 100,
        minBatchSize: 1,
        maxBatchSize: 100,
        batchTimeoutMs: 50,
        onBatch: async (batch) => {
          batchCount++
          lastBatchSize = batch.length
        },
      })

      // Add fewer than batch size
      await batcher.add(createTestEvent('1'))
      await batcher.add(createTestEvent('2'))

      // Wait for timeout
      await delay(100)

      expect(batchCount).toBe(1)
      expect(lastBatchSize).toBe(2)
    })

    it('should support manual flush', async () => {
      const batches: TestEvent[][] = []
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 100,
        minBatchSize: 1,
        maxBatchSize: 100,
        onBatch: async (batch) => {
          batches.push([...batch])
        },
      })

      await batcher.add(createTestEvent('1'))
      await batcher.add(createTestEvent('2'))
      await batcher.flush()

      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(2)
    })
  })

  describe('throughput metrics', () => {
    it('should calculate events per second', async () => {
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 10,
        minBatchSize: 1,
        maxBatchSize: 100,
        onBatch: async () => {
          // Small delay to ensure time passes for events/second calculation
          await delay(5)
        },
      })

      for (let i = 0; i < 100; i++) {
        await batcher.add(createTestEvent(`${i}`))
      }
      await batcher.flush()

      const stats = batcher.getStats()
      // With processing delay, we should have a measurable events/second rate
      expect(stats.totalEventsProcessed).toBe(100)
      expect(stats.eventsPerSecond).toBeGreaterThan(0)
    })

    it('should calculate average batch processing time', async () => {
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 5,
        minBatchSize: 1,
        maxBatchSize: 100,
        onBatch: async () => {
          await delay(20)
        },
      })

      for (let i = 0; i < 20; i++) {
        await batcher.add(createTestEvent(`${i}`))
      }
      await batcher.flush()

      const stats = batcher.getStats()
      expect(stats.avgBatchProcessingTimeMs).toBeGreaterThanOrEqual(20)
    })

    it('should track batch size history for analysis', async () => {
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 10,
        minBatchSize: 1,
        maxBatchSize: 100,
        onBatch: async () => {},
      })

      for (let i = 0; i < 50; i++) {
        await batcher.add(createTestEvent(`${i}`))
      }
      await batcher.flush()

      const stats = batcher.getStats()
      expect(stats.batchSizeHistory).toBeDefined()
      expect(stats.batchSizeHistory.length).toBeGreaterThan(0)
    })
  })

  describe('adaptive algorithm', () => {
    it('should use exponential moving average for smoothing', async () => {
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 10,
        minBatchSize: 1,
        maxBatchSize: 100,
        smoothingFactor: 0.5,
        onBatch: async () => {},
      })

      // The batch size should change gradually, not abruptly
      const sizes: number[] = [batcher.getCurrentBatchSize()]

      for (let i = 0; i < 100; i++) {
        await batcher.add(createTestEvent(`${i}`))
        if (i % 10 === 0) {
          sizes.push(batcher.getCurrentBatchSize())
        }
      }
      await batcher.flush()

      // Check that changes are gradual
      for (let i = 1; i < sizes.length; i++) {
        const change = Math.abs(sizes[i]! - sizes[i - 1]!)
        expect(change).toBeLessThanOrEqual(sizes[i - 1]! * 0.5 + 1)
      }
    })

    it('should factor in memory pressure', async () => {
      const batcher = createAdaptiveBatcher<TestEvent>({
        initialBatchSize: 50,
        minBatchSize: 1,
        maxBatchSize: 100,
        memoryPressureThreshold: 0.8,
        onBatch: async () => {},
        getMemoryPressure: () => 0.9, // Simulate high memory pressure
      })

      for (let i = 0; i < 100; i++) {
        await batcher.add(createTestEvent(`${i}`))
      }
      await batcher.flush()

      // High memory pressure should reduce batch size
      expect(batcher.getCurrentBatchSize()).toBeLessThan(50)
    })
  })
})

// ============================================================================
// BACKPRESSURE SIGNAL
// ============================================================================

describe('BackpressureSignal', () => {
  describe('upstream coordination', () => {
    it('should create backpressure signal', () => {
      const signal = createBackpressureSignal()

      expect(signal).toBeDefined()
      expect(signal.isPaused()).toBe(false)
    })

    it('should pause upstream source', async () => {
      let pauseCalled = false
      const signal = createBackpressureSignal({
        onPause: async () => {
          pauseCalled = true
        },
      })

      await signal.pause()

      expect(signal.isPaused()).toBe(true)
      expect(pauseCalled).toBe(true)
    })

    it('should resume upstream source', async () => {
      let resumeCalled = false
      const signal = createBackpressureSignal({
        onResume: async () => {
          resumeCalled = true
        },
      })

      await signal.pause()
      await signal.resume()

      expect(signal.isPaused()).toBe(false)
      expect(resumeCalled).toBe(true)
    })

    it('should ignore duplicate pause calls', async () => {
      let pauseCount = 0
      const signal = createBackpressureSignal({
        onPause: async () => {
          pauseCount++
        },
      })

      await signal.pause()
      await signal.pause()
      await signal.pause()

      expect(pauseCount).toBe(1)
    })

    it('should ignore duplicate resume calls', async () => {
      let resumeCount = 0
      const signal = createBackpressureSignal({
        onResume: async () => {
          resumeCount++
        },
      })

      await signal.pause()
      await signal.resume()
      await signal.resume()
      await signal.resume()

      expect(resumeCount).toBe(1)
    })
  })

  describe('integration with FlowController', () => {
    it('should connect signal to flow controller', async () => {
      const signal = createBackpressureSignal()
      const controller = createFlowController<TestEvent>({
        highWatermark: 3,
        lowWatermark: 1,
        backpressureSignal: signal,
      })

      // Fill buffer to trigger pause
      for (let i = 0; i < 4; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      expect(signal.isPaused()).toBe(true)

      // Drain buffer to trigger resume
      while (controller.getBufferSize() > 0) {
        await controller.pull()
      }

      expect(signal.isPaused()).toBe(false)
    })

    it('should propagate pause to upstream producer', async () => {
      let producerPaused = false
      const signal = createBackpressureSignal({
        onPause: async () => {
          producerPaused = true
        },
        onResume: async () => {
          producerPaused = false
        },
      })

      const controller = createFlowController<TestEvent>({
        highWatermark: 3,
        lowWatermark: 1,
        backpressureSignal: signal,
      })

      // Simulate producer pushing events
      for (let i = 0; i < 4; i++) {
        await controller.push(createTestEvent(`${i}`))
      }

      expect(producerPaused).toBe(true)
    })
  })

  describe('credit-based flow control', () => {
    it('should support credit-based backpressure', async () => {
      const signal = createBackpressureSignal({
        mode: 'credit',
        initialCredits: 10,
      })

      expect(signal.getCredits()).toBe(10)
    })

    it('should consume credits on push', async () => {
      const signal = createBackpressureSignal({
        mode: 'credit',
        initialCredits: 10,
      })

      signal.consumeCredit(3)
      expect(signal.getCredits()).toBe(7)

      signal.consumeCredit(5)
      expect(signal.getCredits()).toBe(2)
    })

    it('should grant credits on acknowledgment', async () => {
      const signal = createBackpressureSignal({
        mode: 'credit',
        initialCredits: 10,
      })

      signal.consumeCredit(8)
      expect(signal.getCredits()).toBe(2)

      signal.grantCredits(5)
      expect(signal.getCredits()).toBe(7)
    })

    it('should pause when credits exhausted', async () => {
      let pauseCalled = false
      const signal = createBackpressureSignal({
        mode: 'credit',
        initialCredits: 5,
        onPause: async () => {
          pauseCalled = true
        },
      })

      signal.consumeCredit(5)

      expect(signal.getCredits()).toBe(0)
      expect(pauseCalled).toBe(true)
      expect(signal.isPaused()).toBe(true)
    })

    it('should resume when credits granted', async () => {
      let resumeCalled = false
      const signal = createBackpressureSignal({
        mode: 'credit',
        initialCredits: 5,
        onResume: async () => {
          resumeCalled = true
        },
      })

      signal.consumeCredit(5) // Exhaust credits
      signal.grantCredits(3) // Grant some back

      expect(resumeCalled).toBe(true)
      expect(signal.isPaused()).toBe(false)
    })
  })

  describe('rate limiting', () => {
    it('should support rate-limited backpressure', async () => {
      const signal = createBackpressureSignal({
        mode: 'rate',
        maxEventsPerSecond: 100,
      })

      expect(signal.getMaxEventsPerSecond()).toBe(100)
    })

    it('should throttle when rate exceeded', async () => {
      let throttled = false
      const signal = createBackpressureSignal({
        mode: 'rate',
        maxEventsPerSecond: 10,
        onThrottle: () => {
          throttled = true
        },
      })

      // Exceed rate
      for (let i = 0; i < 20; i++) {
        signal.recordEvent()
      }

      expect(throttled).toBe(true)
    })

    it('should provide wait time when throttled', async () => {
      const signal = createBackpressureSignal({
        mode: 'rate',
        maxEventsPerSecond: 10,
      })

      // Exceed rate
      for (let i = 0; i < 20; i++) {
        signal.recordEvent()
      }

      const waitTime = signal.getWaitTimeMs()
      expect(waitTime).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Backpressure Integration', () => {
  it('should handle slow consumer with fast producer', async () => {
    const consumed: TestEvent[] = []
    const dropped: TestEvent[] = []
    let producerDone = false

    const controller = createFlowController<TestEvent>({
      highWatermark: 10,
      lowWatermark: 5,
      maxBufferSize: 20,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      onDrop: (event) => dropped.push(event),
    })

    // Fast producer - produces 100 events quickly
    const producer = async () => {
      for (let i = 0; i < 100; i++) {
        await controller.push(createTestEvent(`${i}`))
        await delay(1) // Very fast
      }
      producerDone = true
    }

    // Slow consumer - consumes until producer is done and buffer is empty
    const consumer = async () => {
      // Consume until producer is done and buffer is drained
      while (!producerDone || controller.getBufferSize() > 0) {
        const event = await controller.pull()
        if (event) {
          consumed.push(event)
          await delay(5) // Slower than producer
        } else {
          await delay(2)
        }
        // Safety: don't loop forever
        if (consumed.length >= 50) break
      }
    }

    await Promise.all([producer(), consumer()])

    // Should have consumed some events
    expect(consumed.length).toBeGreaterThan(0)

    // Should have paused due to buffer filling up
    const stats = controller.getStats()
    expect(stats.pauseCount).toBeGreaterThan(0)
  })

  it('should adapt batch size under varying load', async () => {
    const processedBatches: number[] = []

    const batcher = createAdaptiveBatcher<TestEvent>({
      initialBatchSize: 10,
      minBatchSize: 5,
      maxBatchSize: 50,
      targetLatencyMs: 50,
      onBatch: async (batch) => {
        processedBatches.push(batch.length)
        // Variable processing time based on batch size
        // Small batches process fast (< 40ms = 80% of 50ms), should trigger increase
        // Large batches process slow (> 60ms = 120% of 50ms), should trigger decrease
        await delay(batch.length * 2)
      },
    })

    // Send burst of events - enough to trigger multiple batch size adjustments
    for (let i = 0; i < 300; i++) {
      await batcher.add(createTestEvent(`${i}`))
    }
    await batcher.flush()

    // Batch sizes should vary based on throughput adjustments
    // Filter out partial batches from the final flush
    const fullBatches = processedBatches.filter((size) => size >= 5)
    const uniqueSizes = new Set(fullBatches)

    // With adaptive algorithm, batch sizes should change over time
    expect(uniqueSizes.size).toBeGreaterThan(1)
  })

  it('should coordinate backpressure across pipeline stages', async () => {
    const stageSignals: boolean[] = []

    const signal1 = createBackpressureSignal({
      onPause: async () => stageSignals.push(true),
      onResume: async () => stageSignals.push(false),
    })

    const controller1 = createFlowController<TestEvent>({
      highWatermark: 5,
      lowWatermark: 2,
      backpressureSignal: signal1,
    })

    const signal2 = createBackpressureSignal({
      onPause: async () => signal1.pause(),
      onResume: async () => signal1.resume(),
    })

    const controller2 = createFlowController<TestEvent>({
      highWatermark: 3,
      lowWatermark: 1,
      backpressureSignal: signal2,
    })

    // Fill downstream controller to trigger cascade
    for (let i = 0; i < 4; i++) {
      await controller2.push(createTestEvent(`${i}`))
    }

    // Both signals should be paused
    expect(signal1.isPaused()).toBe(true)
    expect(signal2.isPaused()).toBe(true)

    // Drain downstream
    while (controller2.getBufferSize() > 0) {
      await controller2.pull()
    }

    // Both should resume
    expect(signal1.isPaused()).toBe(false)
    expect(signal2.isPaused()).toBe(false)
  })
})

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

describe('factory functions', () => {
  it('should create FlowController instance', () => {
    const controller = createFlowController<TestEvent>({
      highWatermark: 100,
      lowWatermark: 20,
    })
    expect(controller).toBeInstanceOf(FlowController)
  })

  it('should create AdaptiveBatcher instance', () => {
    const batcher = createAdaptiveBatcher<TestEvent>({
      initialBatchSize: 10,
      minBatchSize: 1,
      maxBatchSize: 100,
    })
    expect(batcher).toBeInstanceOf(AdaptiveBatcher)
  })

  it('should create BackpressureSignal instance', () => {
    const signal = createBackpressureSignal()
    expect(signal).toBeInstanceOf(BackpressureSignal)
  })
})
