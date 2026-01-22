/**
 * DO Storage Backend for Experiments
 *
 * Provides a tracking backend that stores experiment events
 * in Durable Object SQLite storage.
 */

import type { ExperimentStorage, ExperimentEvent } from './types'

/**
 * Tracking event from ai-experiments
 */
export interface TrackingEvent {
  type: string
  timestamp: Date
  data: Record<string, unknown>
}

/**
 * Tracking backend interface
 */
export interface TrackingBackend {
  track(event: TrackingEvent): void | Promise<void>
  flush?(): void | Promise<void>
}

/**
 * Create a DO-backed tracking backend
 *
 * Stores experiment events in DO storage for persistence
 * and analytics querying.
 *
 * @example
 * ```typescript
 * import { createDOBackend, configureTracking } from '@dotdo/experiments'
 *
 * // In your DO class
 * const backend = createDOBackend(this.state.storage)
 * configureTracking({ backend })
 *
 * // Events are now persisted to DO storage
 * ```
 */
export function createDOBackend(
  storage: ExperimentStorage,
  options?: {
    /** Key prefix for experiment events */
    prefix?: string
    /** Maximum events to keep (FIFO eviction) */
    maxEvents?: number
    /** Batch size before auto-flush */
    batchSize?: number
  }
): TrackingBackend & {
  /** Query events by experiment ID */
  getEvents: (experimentId?: string) => Promise<ExperimentEvent[]>
  /** Clear all events */
  clear: () => Promise<void>
} {
  const { prefix = 'exp:event:', maxEvents = 10000, batchSize = 100 } = options ?? {}
  const pendingEvents: TrackingEvent[] = []
  let eventCounter = 0

  const flushPendingEvents = async () => {
    if (pendingEvents.length === 0) return

    const eventsToFlush = [...pendingEvents]
    pendingEvents.length = 0

    const entries = new Map<string, ExperimentEvent>()

    for (const event of eventsToFlush) {
      const id = `${Date.now()}-${eventCounter++}`
      const data = event.data
      const experimentEvent: ExperimentEvent = {
        id,
        experimentId: String(data['experimentId'] ?? ''),
        variantId: String(data['variantId'] ?? ''),
        userId: String(data['userId'] ?? ''),
        type: mapEventType(event.type),
        metricName: data['metricName'] as string | undefined,
        value: data['metricValue'] as number | undefined,
        timestamp: event.timestamp.getTime(),
        properties: data,
      }
      entries.set(`${prefix}${id}`, experimentEvent)
    }

    await storage.put(entries)

    // Evict old events if over limit
    await evictOldEvents()
  }

  const evictOldEvents = async () => {
    const allEvents = await storage.list<ExperimentEvent>({ prefix })
    if (allEvents.size <= maxEvents) return

    // Sort by timestamp and remove oldest
    const sorted = [...allEvents.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toDelete = sorted.slice(0, sorted.length - maxEvents).map(([key]) => key)

    if (toDelete.length > 0) {
      await storage.delete(toDelete)
    }
  }

  return {
    track: (event: TrackingEvent) => {
      pendingEvents.push(event)

      if (pendingEvents.length >= batchSize) {
        // Fire and forget flush
        flushPendingEvents().catch(console.error)
      }
    },

    flush: async () => {
      await flushPendingEvents()
    },

    getEvents: async (experimentId?: string) => {
      const allEvents = await storage.list<ExperimentEvent>({ prefix })
      let events = [...allEvents.values()]

      if (experimentId) {
        events = events.filter((e) => e.experimentId === experimentId)
      }

      return events.sort((a, b) => b.timestamp - a.timestamp)
    },

    clear: async () => {
      const allEvents = await storage.list<ExperimentEvent>({ prefix })
      const keys = [...allEvents.keys()]
      if (keys.length > 0) {
        await storage.delete(keys)
      }
    },
  }
}

/**
 * Map ai-experiments event types to experiment event types
 */
function mapEventType(type: string): ExperimentEvent['type'] {
  switch (type) {
    case 'variant.start':
    case 'variant.complete':
      return 'exposure'
    case 'metric.computed':
      return 'metric'
    default:
      return 'exposure'
  }
}

/**
 * Variant result stored in DO storage
 */
export interface VariantResult {
  exposures: number
  conversions: number
  metricSum: number
  metricSumSquares: number
  metricCount: number
}

/**
 * Computed variant statistics
 */
export interface ComputedVariantStats extends VariantResult {
  conversionRate: number
  metricMean: number
  metricStdDev: number
}

/**
 * Create an experiment results store
 *
 * Provides methods for storing and querying experiment results
 * aggregated by variant.
 *
 * @example
 * ```typescript
 * import { createResultsStore } from '@dotdo/experiments'
 *
 * const store = createResultsStore(this.state.storage)
 *
 * // Record a conversion
 * await store.recordConversion('signup-test', 'treatment', userId)
 *
 * // Get variant stats
 * const stats = await store.getStats('signup-test')
 * console.log(stats.treatment.conversionRate)
 * ```
 */
export function createResultsStore(
  storage: ExperimentStorage,
  options?: {
    /** Key prefix */
    prefix?: string
  }
) {
  const { prefix = 'exp:results:' } = options ?? {}

  const getKey = (experimentId: string, variantId: string) => `${prefix}${experimentId}:${variantId}`

  return {
    /**
     * Record an exposure
     */
    recordExposure: async (experimentId: string, variantId: string) => {
      const key = getKey(experimentId, variantId)
      const current = (await storage.get<VariantResult>(key)) ?? {
        exposures: 0,
        conversions: 0,
        metricSum: 0,
        metricSumSquares: 0,
        metricCount: 0,
      }
      current.exposures++
      await storage.put(key, current)
    },

    /**
     * Record a conversion
     */
    recordConversion: async (experimentId: string, variantId: string, _userId?: string) => {
      const key = getKey(experimentId, variantId)
      const current = (await storage.get<VariantResult>(key)) ?? {
        exposures: 0,
        conversions: 0,
        metricSum: 0,
        metricSumSquares: 0,
        metricCount: 0,
      }
      current.conversions++
      await storage.put(key, current)
    },

    /**
     * Record a metric value
     */
    recordMetric: async (experimentId: string, variantId: string, value: number) => {
      const key = getKey(experimentId, variantId)
      const current = (await storage.get<VariantResult>(key)) ?? {
        exposures: 0,
        conversions: 0,
        metricSum: 0,
        metricSumSquares: 0,
        metricCount: 0,
      }
      current.metricSum += value
      current.metricSumSquares += value * value
      current.metricCount++
      await storage.put(key, current)
    },

    /**
     * Get stats for all variants in an experiment
     */
    getStats: async (experimentId: string): Promise<Record<string, ComputedVariantStats>> => {
      const allResults = await storage.list<VariantResult>({ prefix: `${prefix}${experimentId}:` })

      const stats: Record<string, ComputedVariantStats> = {}

      for (const [key, result] of allResults) {
        const variantId = key.replace(`${prefix}${experimentId}:`, '')
        const conversionRate = result.exposures > 0 ? result.conversions / result.exposures : 0
        const metricMean = result.metricCount > 0 ? result.metricSum / result.metricCount : 0
        const variance =
          result.metricCount > 1
            ? (result.metricSumSquares - (result.metricSum * result.metricSum) / result.metricCount) /
              (result.metricCount - 1)
            : 0
        const metricStdDev = Math.sqrt(Math.max(0, variance))

        stats[variantId] = {
          ...result,
          conversionRate,
          metricMean,
          metricStdDev,
        }
      }

      return stats
    },

    /**
     * Clear results for an experiment
     */
    clear: async (experimentId: string) => {
      const allResults = await storage.list<VariantResult>({ prefix: `${prefix}${experimentId}:` })
      const keys = [...allResults.keys()]
      if (keys.length > 0) {
        await storage.delete(keys)
      }
    },
  }
}
