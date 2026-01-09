/**
 * Mock Pipeline for testing
 *
 * Implements a mock of Cloudflare Pipelines for use in test suites.
 * Provides inspection capabilities and error/delay simulation.
 *
 * @see https://developers.cloudflare.com/pipelines/
 */
import { vi, type Mock } from 'vitest'

/**
 * Cloudflare Pipeline interface
 * @see https://developers.cloudflare.com/pipelines/
 */
export interface Pipeline {
  send(events: any[]): Promise<void>
}

/**
 * Configuration options for mock pipeline behavior
 */
export interface MockPipelineOptions {
  /** If set, send() will reject with this error */
  errorOnSend?: Error
  /** If set, send() will delay by this many milliseconds */
  sendDelayMs?: number
}

/**
 * Mock Pipeline with inspection and simulation capabilities
 */
export interface MockPipeline extends Pipeline {
  /** All events that have been sent */
  events: any[]
  /** The underlying vi.fn() mock for send */
  send: Mock<(events: any[]) => Promise<void>>
  /** Clear all captured events */
  clear(): void
  /** Configure error simulation */
  setError(error: Error | null): void
  /** Configure send delay simulation */
  setDelay(ms: number): void
}

/**
 * Creates a mock Pipeline for testing
 *
 * @param options - Optional configuration for error/delay simulation
 * @returns A MockPipeline instance with inspection capabilities
 *
 * @example
 * ```typescript
 * const pipeline = createMockPipeline()
 * await pipeline.send([{ type: 'event', data: 'test' }])
 * expect(pipeline.events).toHaveLength(1)
 * ```
 *
 * @example Error simulation
 * ```typescript
 * const pipeline = createMockPipeline()
 * pipeline.setError(new Error('Network failure'))
 * await expect(pipeline.send([{ data: 'test' }])).rejects.toThrow('Network failure')
 * ```
 *
 * @example Delay simulation
 * ```typescript
 * const pipeline = createMockPipeline()
 * pipeline.setDelay(100) // 100ms delay
 * const start = Date.now()
 * await pipeline.send([{ data: 'test' }])
 * expect(Date.now() - start).toBeGreaterThanOrEqual(100)
 * ```
 */
export function createMockPipeline(options: MockPipelineOptions = {}): MockPipeline {
  const events: any[] = []
  let errorOnSend: Error | null = options.errorOnSend ?? null
  let sendDelayMs: number = options.sendDelayMs ?? 0

  const send = vi.fn(async (batch: any[]) => {
    // Simulate delay if configured
    if (sendDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sendDelayMs))
    }

    // Simulate error if configured
    if (errorOnSend) {
      throw errorOnSend
    }

    // Capture events
    events.push(...batch)
  })

  return {
    events,
    send,
    clear: () => {
      events.length = 0
      send.mockClear()
    },
    setError: (error: Error | null) => {
      errorOnSend = error
    },
    setDelay: (ms: number) => {
      sendDelayMs = ms
    },
  }
}
