import { vi } from 'vitest'
import type { UsageEvent } from '../../api/usage/events'

/**
 * Mock usage pipeline interface
 */
export interface MockUsagePipeline {
  /** Captured events */
  events: UsageEvent[]
  /** Send events to the pipeline */
  send: ReturnType<typeof vi.fn>
  /** Clear captured events */
  clear: () => void
}

/**
 * Create a mock usage pipeline for testing.
 *
 * The mock pipeline captures all sent events and provides a vi.fn() spy
 * for verifying send calls.
 *
 * @returns Mock pipeline instance
 */
export function createUsagePipeline(): MockUsagePipeline {
  const pipeline: MockUsagePipeline = {
    events: [],
    send: vi.fn(async (events: UsageEvent[]) => {
      pipeline.events.push(...events)
    }),
    clear: () => {
      pipeline.events = []
      pipeline.send.mockClear()
    },
  }

  return pipeline
}
