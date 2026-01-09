/**
 * Tests for Mock Pipeline
 *
 * Verifies that the mock pipeline correctly captures events and can simulate
 * errors and delays for testing purposes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockPipeline, type MockPipeline } from './pipeline'

describe('MockPipeline', () => {
  let pipeline: MockPipeline

  beforeEach(() => {
    pipeline = createMockPipeline()
  })

  // ============================================================================
  // Basic Event Capture
  // ============================================================================

  describe('event capture', () => {
    it('captures sent events', async () => {
      const event = { type: 'test', data: 'hello' }

      await pipeline.send([event])

      expect(pipeline.events).toHaveLength(1)
      expect(pipeline.events[0]).toEqual(event)
    })

    it('captures multiple events in a single batch', async () => {
      const events = [
        { type: 'event1', data: 'first' },
        { type: 'event2', data: 'second' },
        { type: 'event3', data: 'third' },
      ]

      await pipeline.send(events)

      expect(pipeline.events).toHaveLength(3)
      expect(pipeline.events).toEqual(events)
    })

    it('accumulates events across multiple send calls', async () => {
      await pipeline.send([{ id: 1 }])
      await pipeline.send([{ id: 2 }])
      await pipeline.send([{ id: 3 }])

      expect(pipeline.events).toHaveLength(3)
      expect(pipeline.events.map((e) => e.id)).toEqual([1, 2, 3])
    })

    it('preserves event order', async () => {
      const events = Array.from({ length: 10 }, (_, i) => ({ order: i }))

      await pipeline.send(events)

      events.forEach((event, index) => {
        expect(pipeline.events[index]).toEqual(event)
      })
    })

    it('handles empty event array', async () => {
      await pipeline.send([])

      expect(pipeline.events).toHaveLength(0)
    })

    it('handles complex nested event objects', async () => {
      const event = {
        type: 'complex',
        nested: {
          deeply: {
            value: 42,
          },
        },
        array: [1, 2, 3],
        nullValue: null,
        timestamp: new Date().toISOString(),
      }

      await pipeline.send([event])

      expect(pipeline.events[0]).toEqual(event)
    })
  })

  // ============================================================================
  // Batch Sending
  // ============================================================================

  describe('batch sending', () => {
    it('supports batch sending of multiple events', async () => {
      const batch = [
        { event: 'a' },
        { event: 'b' },
        { event: 'c' },
      ]

      await pipeline.send(batch)

      expect(pipeline.events).toHaveLength(3)
    })

    it('flattens batches into single events array', async () => {
      await pipeline.send([{ batch: 1 }])
      await pipeline.send([{ batch: 2 }, { batch: 2.1 }])
      await pipeline.send([{ batch: 3 }, { batch: 3.1 }, { batch: 3.2 }])

      expect(pipeline.events).toHaveLength(6)
    })

    it('records each send call on the mock function', async () => {
      await pipeline.send([{ id: 1 }])
      await pipeline.send([{ id: 2 }, { id: 3 }])

      expect(pipeline.send).toHaveBeenCalledTimes(2)
      expect(pipeline.send).toHaveBeenNthCalledWith(1, [{ id: 1 }])
      expect(pipeline.send).toHaveBeenNthCalledWith(2, [{ id: 2 }, { id: 3 }])
    })
  })

  // ============================================================================
  // Clear Functionality
  // ============================================================================

  describe('clear', () => {
    it('clears all captured events', async () => {
      await pipeline.send([{ id: 1 }, { id: 2 }])

      pipeline.clear()

      expect(pipeline.events).toHaveLength(0)
    })

    it('clears mock call history', async () => {
      await pipeline.send([{ id: 1 }])
      await pipeline.send([{ id: 2 }])

      pipeline.clear()

      expect(pipeline.send).not.toHaveBeenCalled()
    })

    it('allows new events after clear', async () => {
      await pipeline.send([{ before: true }])
      pipeline.clear()
      await pipeline.send([{ after: true }])

      expect(pipeline.events).toHaveLength(1)
      expect(pipeline.events[0]).toEqual({ after: true })
    })
  })

  // ============================================================================
  // Error Simulation
  // ============================================================================

  describe('error simulation', () => {
    it('can simulate errors on send', async () => {
      const error = new Error('Pipeline write failed')
      pipeline.setError(error)

      await expect(pipeline.send([{ data: 'test' }])).rejects.toThrow('Pipeline write failed')
    })

    it('can configure error via constructor options', async () => {
      const errorPipeline = createMockPipeline({
        errorOnSend: new Error('Initial error'),
      })

      await expect(errorPipeline.send([{ data: 'test' }])).rejects.toThrow('Initial error')
    })

    it('does not capture events when error is thrown', async () => {
      pipeline.setError(new Error('Fail'))

      try {
        await pipeline.send([{ data: 'should not be captured' }])
      } catch {
        // Expected
      }

      expect(pipeline.events).toHaveLength(0)
    })

    it('can clear error by setting null', async () => {
      pipeline.setError(new Error('Temporary error'))
      pipeline.setError(null)

      await expect(pipeline.send([{ data: 'test' }])).resolves.toBeUndefined()
      expect(pipeline.events).toHaveLength(1)
    })

    it('preserves error type', async () => {
      class CustomPipelineError extends Error {
        constructor(public code: string) {
          super('Custom error')
          this.name = 'CustomPipelineError'
        }
      }

      const customError = new CustomPipelineError('PIPELINE_001')
      pipeline.setError(customError)

      await expect(pipeline.send([{}])).rejects.toThrow(customError)
    })
  })

  // ============================================================================
  // Slow Send Simulation
  // ============================================================================

  describe('slow send simulation', () => {
    it('can simulate slow sends', async () => {
      pipeline.setDelay(50)

      const start = Date.now()
      await pipeline.send([{ data: 'delayed' }])
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(45) // Allow 5ms tolerance
    })

    it('can configure delay via constructor options', async () => {
      const slowPipeline = createMockPipeline({ sendDelayMs: 50 })

      const start = Date.now()
      await slowPipeline.send([{ data: 'test' }])
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('still captures events after delay', async () => {
      pipeline.setDelay(20)

      await pipeline.send([{ delayed: true }])

      expect(pipeline.events).toHaveLength(1)
      expect(pipeline.events[0]).toEqual({ delayed: true })
    })

    it('can remove delay by setting to 0', async () => {
      pipeline.setDelay(100)
      pipeline.setDelay(0)

      const start = Date.now()
      await pipeline.send([{ data: 'fast' }])
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })

    it('applies delay before error if both configured', async () => {
      pipeline.setDelay(30)
      pipeline.setError(new Error('Delayed error'))

      const start = Date.now()
      await expect(pipeline.send([{}])).rejects.toThrow('Delayed error')
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(25)
    })

    it('supports multiple concurrent slow sends', async () => {
      pipeline.setDelay(30)

      const start = Date.now()
      await Promise.all([
        pipeline.send([{ id: 1 }]),
        pipeline.send([{ id: 2 }]),
        pipeline.send([{ id: 3 }]),
      ])
      const elapsed = Date.now() - start

      // Should run in parallel, so total time ~30ms, not ~90ms
      expect(elapsed).toBeLessThan(60)
      expect(pipeline.events).toHaveLength(3)
    })
  })

  // ============================================================================
  // Interface Compliance
  // ============================================================================

  describe('interface compliance', () => {
    it('implements Pipeline interface', () => {
      // TypeScript will catch this at compile time, but verify runtime behavior
      expect(typeof pipeline.send).toBe('function')
    })

    it('send returns a Promise', () => {
      const result = pipeline.send([])
      expect(result).toBeInstanceOf(Promise)
    })

    it('send resolves to undefined on success', async () => {
      const result = await pipeline.send([{ data: 'test' }])
      expect(result).toBeUndefined()
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles null values in events', async () => {
      await pipeline.send([null])

      expect(pipeline.events).toHaveLength(1)
      expect(pipeline.events[0]).toBeNull()
    })

    it('handles undefined values in events', async () => {
      await pipeline.send([undefined])

      expect(pipeline.events).toHaveLength(1)
      expect(pipeline.events[0]).toBeUndefined()
    })

    it('handles primitive values in events', async () => {
      await pipeline.send(['string', 42, true])

      expect(pipeline.events).toEqual(['string', 42, true])
    })

    it('handles very large batches', async () => {
      const largeBatch = Array.from({ length: 10000 }, (_, i) => ({ id: i }))

      await pipeline.send(largeBatch)

      expect(pipeline.events).toHaveLength(10000)
    })
  })
})
