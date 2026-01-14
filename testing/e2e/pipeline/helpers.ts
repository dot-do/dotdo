/**
 * ACID Test Suite - Phase 5: Pipeline Verification Helpers
 *
 * Helper functions for verifying events in the pipeline, measuring E2E latency,
 * and validating Iceberg partitions. Used by both smoke tests and full E2E tests.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import type { E2ETestContext, PipelineEvent, IcebergPartition, PartitionInfo } from '../context'
import { getE2EConfig } from '../config'

// ============================================================================
// VERIFICATION RESULT TYPES
// ============================================================================

/**
 * Result of verifying an event in the pipeline
 */
export interface EventVerificationResult {
  /** Whether the event was found */
  found: boolean
  /** The event data if found */
  event?: PipelineEvent
  /** Time taken to find the event (ms) */
  latencyMs: number
  /** Number of poll attempts made */
  attempts: number
  /** Error message if verification failed */
  error?: string
}

/**
 * Result of measuring E2E latency
 */
export interface E2ELatencyResult<T = unknown> {
  /** Operation result */
  result: T
  /** Start timestamp */
  startTime: number
  /** End timestamp */
  endTime: number
  /** Total latency in milliseconds */
  latencyMs: number
  /** Individual phase timings if applicable */
  phases?: {
    operation?: number
    pipelineDelivery?: number
    icebergSync?: number
  }
}

/**
 * Pipeline synchronization result
 */
export interface PipelineSyncResult {
  /** Whether sync completed successfully */
  success: boolean
  /** Number of events processed */
  eventsProcessed: number
  /** Time taken to sync (ms) */
  durationMs: number
  /** Final sequence number */
  finalSequence: number
  /** Error if sync failed */
  error?: string
}

/**
 * Pipeline statistics
 */
export interface PipelineStats {
  /** Total events in pipeline */
  totalEvents: number
  /** Events processed per minute */
  eventsPerMinute: number
  /** Timestamp of last event */
  lastEventAt: Date | null
  /** Current backlog size */
  backlog: number
  /** Health status */
  health: 'healthy' | 'degraded' | 'unhealthy'
  /** Latency percentiles */
  latency: {
    p50: number
    p95: number
    p99: number
  }
}

/**
 * Iceberg verification result
 */
export interface IcebergVerificationResult extends PartitionInfo {
  /** Whether verification passed */
  valid: boolean
  /** Partition path */
  path: string
  /** Schema validation result */
  schemaValid: boolean
  /** Error message if verification failed */
  error?: string
}

// ============================================================================
// EVENT VERIFICATION HELPERS
// ============================================================================

/**
 * Verify that an event exists in the pipeline
 *
 * @param ctx - E2E test context
 * @param event - Event to verify (id and optionally type)
 * @param options - Verification options
 * @returns Verification result with event if found
 *
 * @example
 * ```ts
 * const result = await verifyEventInPipeline(ctx, {
 *   id: 'evt-123',
 *   type: 'thing.created',
 * })
 * expect(result.found).toBe(true)
 * expect(result.latencyMs).toBeLessThan(5000)
 * ```
 */
export async function verifyEventInPipeline(
  ctx: E2ETestContext,
  event: { id: string; type?: string },
  options: {
    timeout?: number
    pollInterval?: number
    validateSchema?: boolean
  } = {}
): Promise<EventVerificationResult> {
  const config = getE2EConfig()
  const timeout = options.timeout || config.timeouts.pipelineDelivery
  const pollInterval = options.pollInterval || 1000
  const startTime = Date.now()
  let attempts = 0

  while (Date.now() - startTime < timeout) {
    attempts++
    try {
      const pipelineEvent = await ctx.get<PipelineEvent | null>(`/pipeline/events/${event.id}`)

      if (pipelineEvent) {
        // Verify type if specified
        if (event.type && pipelineEvent.type !== event.type) {
          continue // Keep polling - might be a different event with same ID
        }

        return {
          found: true,
          event: pipelineEvent,
          latencyMs: Date.now() - startTime,
          attempts,
        }
      }
    } catch {
      // Event not found yet, continue polling
    }

    await sleep(pollInterval)
  }

  return {
    found: false,
    latencyMs: Date.now() - startTime,
    attempts,
    error: `Event ${event.id} not found after ${timeout}ms`,
  }
}

/**
 * Wait for multiple events to appear in the pipeline
 *
 * @param ctx - E2E test context
 * @param filter - Event filter criteria
 * @param options - Wait options
 * @returns Array of found events
 */
export async function waitForEvents(
  ctx: E2ETestContext,
  filter: {
    type?: string
    source?: string
    correlationId?: string
    minCount?: number
  },
  options: {
    timeout?: number
    pollInterval?: number
  } = {}
): Promise<{
  events: PipelineEvent[]
  durationMs: number
  error?: string
}> {
  const config = getE2EConfig()
  const timeout = options.timeout || config.timeouts.pipelineDelivery
  const pollInterval = options.pollInterval || 1000
  const minCount = filter.minCount || 1
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const params = new URLSearchParams()
      if (filter.type) params.set('type', filter.type)
      if (filter.source) params.set('source', filter.source)
      if (filter.correlationId) params.set('correlationId', filter.correlationId)

      const events = await ctx.get<PipelineEvent[]>(`/pipeline/events?${params.toString()}`)

      if (events.length >= minCount) {
        return {
          events: events.slice(0, minCount),
          durationMs: Date.now() - startTime,
        }
      }
    } catch {
      // Continue polling
    }

    await sleep(pollInterval)
  }

  return {
    events: [],
    durationMs: Date.now() - startTime,
    error: `Timeout waiting for ${minCount} events after ${timeout}ms`,
  }
}

// ============================================================================
// LATENCY MEASUREMENT HELPERS
// ============================================================================

/**
 * Measure end-to-end latency for an operation
 *
 * @param ctx - E2E test context
 * @param operation - Operation to measure
 * @returns Latency result with timing breakdown
 *
 * @example
 * ```ts
 * const result = await measureE2ELatency(ctx, async () => {
 *   await ctx.post('/things', { name: 'Test' })
 *   return { eventId: 'evt-123' }
 * })
 * expect(result.latencyMs).toBeLessThan(SLA_TARGET)
 * ```
 */
export async function measureE2ELatency<T>(
  ctx: E2ETestContext,
  operation: () => Promise<T>
): Promise<E2ELatencyResult<T>> {
  const startTime = Date.now()
  const result = await operation()
  const endTime = Date.now()

  return {
    result,
    startTime,
    endTime,
    latencyMs: endTime - startTime,
  }
}

/**
 * Measure full pipeline latency from operation to Iceberg query
 *
 * @param ctx - E2E test context
 * @param operation - Operation that produces an event
 * @param options - Measurement options
 * @returns Detailed latency breakdown
 */
export async function measurePipelineLatency(
  ctx: E2ETestContext,
  operation: () => Promise<{ eventId: string; eventType?: string }>,
  options: {
    waitForIceberg?: boolean
    icebergQuery?: string
    timeout?: number
  } = {}
): Promise<{
  operationLatencyMs: number
  pipelineLatencyMs: number
  icebergLatencyMs?: number
  totalLatencyMs: number
  eventId: string
}> {
  const config = getE2EConfig()
  const timeout = options.timeout || config.timeouts.icebergFlush
  const startTime = Date.now()

  // Phase 1: Execute operation
  const opStart = Date.now()
  const { eventId, eventType } = await operation()
  const operationLatencyMs = Date.now() - opStart

  // Phase 2: Wait for pipeline delivery
  const pipelineStart = Date.now()
  await verifyEventInPipeline(ctx, { id: eventId, type: eventType }, { timeout })
  const pipelineLatencyMs = Date.now() - pipelineStart

  // Phase 3: Wait for Iceberg sync (optional)
  let icebergLatencyMs: number | undefined
  if (options.waitForIceberg) {
    const icebergStart = Date.now()
    const query = options.icebergQuery || `SELECT * FROM events WHERE id = '${eventId}'`

    // Poll until data appears in Iceberg
    const icebergTimeout = timeout - (Date.now() - startTime)
    await waitForIcebergQuery(ctx, query, icebergTimeout)
    icebergLatencyMs = Date.now() - icebergStart
  }

  return {
    operationLatencyMs,
    pipelineLatencyMs,
    icebergLatencyMs,
    totalLatencyMs: Date.now() - startTime,
    eventId,
  }
}

/**
 * Wait for a query to return results from Iceberg
 */
async function waitForIcebergQuery(
  ctx: E2ETestContext,
  query: string,
  timeout: number,
  pollInterval = 5000
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const results = await ctx.queryIceberg(query)
      if (results.length > 0) {
        return
      }
    } catch {
      // Query failed, continue polling
    }

    await sleep(pollInterval)
  }

  throw new Error(`Iceberg query did not return results within ${timeout}ms`)
}

// ============================================================================
// PIPELINE SYNC HELPERS
// ============================================================================

/**
 * Wait for pipeline to synchronize (all pending events processed)
 *
 * @param ctx - E2E test context
 * @param options - Sync options
 * @returns Sync result with statistics
 */
export async function waitForPipelineSync(
  ctx: E2ETestContext,
  options: {
    timeout?: number
    pollInterval?: number
    targetBacklog?: number
  } = {}
): Promise<PipelineSyncResult> {
  const config = getE2EConfig()
  const timeout = options.timeout || config.timeouts.pipelineDelivery
  const pollInterval = options.pollInterval || 2000
  const targetBacklog = options.targetBacklog || 0
  const startTime = Date.now()

  let lastSequence = 0
  let eventsProcessed = 0

  while (Date.now() - startTime < timeout) {
    try {
      const stats = await ctx.get<{
        backlog: number
        sequence: number
        processed: number
      }>('/pipeline/status')

      eventsProcessed = stats.processed - eventsProcessed
      lastSequence = stats.sequence

      if (stats.backlog <= targetBacklog) {
        return {
          success: true,
          eventsProcessed,
          durationMs: Date.now() - startTime,
          finalSequence: lastSequence,
        }
      }
    } catch {
      // Status not available, continue polling
    }

    await sleep(pollInterval)
  }

  return {
    success: false,
    eventsProcessed,
    durationMs: Date.now() - startTime,
    finalSequence: lastSequence,
    error: `Pipeline did not sync within ${timeout}ms (backlog still > ${targetBacklog})`,
  }
}

/**
 * Get current pipeline statistics
 *
 * @param ctx - E2E test context
 * @returns Pipeline statistics
 */
export async function getPipelineStats(ctx: E2ETestContext): Promise<PipelineStats> {
  try {
    const stats = await ctx.get<{
      totalEvents: number
      eventsPerMinute: number
      lastEventAt: string | null
      backlog: number
      latency: {
        p50: number
        p95: number
        p99: number
      }
    }>('/pipeline/stats')

    const config = getE2EConfig()
    const { p50Target, p95Target, p99Target } = config.pipelineSLA

    // Determine health based on latency and backlog
    let health: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'

    if (stats.latency.p95 > p95Target || stats.backlog > 1000) {
      health = 'degraded'
    }
    if (stats.latency.p99 > p99Target || stats.backlog > 10000) {
      health = 'unhealthy'
    }

    return {
      totalEvents: stats.totalEvents,
      eventsPerMinute: stats.eventsPerMinute,
      lastEventAt: stats.lastEventAt ? new Date(stats.lastEventAt) : null,
      backlog: stats.backlog,
      health,
      latency: stats.latency,
    }
  } catch (error) {
    return {
      totalEvents: 0,
      eventsPerMinute: 0,
      lastEventAt: null,
      backlog: 0,
      health: 'unhealthy',
      latency: { p50: 0, p95: 0, p99: 0 },
    }
  }
}

// ============================================================================
// ICEBERG VERIFICATION HELPERS
// ============================================================================

/**
 * Verify an Iceberg partition exists and is valid
 *
 * @param ctx - E2E test context
 * @param partition - Partition to verify
 * @param options - Verification options
 * @returns Verification result
 */
export async function verifyIcebergPartition(
  ctx: E2ETestContext,
  partition: IcebergPartition,
  options: {
    minRowCount?: number
    validateSchema?: boolean
  } = {}
): Promise<IcebergVerificationResult> {
  const { year, month, day, hour } = partition
  const path = hour !== undefined
    ? `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${String(hour).padStart(2, '0')}`
    : `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`

  try {
    const info = await ctx.verifyIcebergPartition(partition)

    // Validate minimum row count
    if (options.minRowCount && info.rowCount < options.minRowCount) {
      return {
        ...info,
        valid: false,
        path,
        schemaValid: true,
        error: `Partition has ${info.rowCount} rows, expected at least ${options.minRowCount}`,
      }
    }

    // Validate schema if requested
    let schemaValid = true
    if (options.validateSchema) {
      schemaValid = await validatePartitionSchema(ctx, partition)
    }

    return {
      ...info,
      valid: schemaValid && info.fileCount > 0,
      path,
      schemaValid,
    }
  } catch (error) {
    return {
      fileCount: 0,
      rowCount: 0,
      sizeBytes: 0,
      lastModified: new Date(0),
      valid: false,
      path,
      schemaValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Validate the schema of a partition
 */
async function validatePartitionSchema(
  ctx: E2ETestContext,
  partition: IcebergPartition
): Promise<boolean> {
  try {
    const { year, month, day, hour } = partition

    // Query first row and verify schema
    const query = `
      SELECT id, type, source, timestamp, payload
      FROM events
      WHERE year = ${year}
        AND month = ${month}
        AND day = ${day}
        ${hour !== undefined ? `AND hour = ${hour}` : ''}
      LIMIT 1
    `

    const results = await ctx.queryIceberg<{
      id: string
      type: string
      source: string
      timestamp: string
      payload: Record<string, unknown>
    }>(query)

    if (results.length === 0) {
      return true // No data to validate
    }

    const row = results[0]

    // Verify required fields exist
    return (
      typeof row.id === 'string' &&
      typeof row.type === 'string' &&
      typeof row.source === 'string' &&
      typeof row.timestamp === 'string' &&
      typeof row.payload === 'object'
    )
  } catch {
    return false
  }
}

/**
 * Get current partition based on timestamp
 */
export function getCurrentPartition(timestamp: Date = new Date()): IcebergPartition {
  return {
    year: timestamp.getUTCFullYear(),
    month: timestamp.getUTCMonth() + 1, // 1-indexed
    day: timestamp.getUTCDate(),
    hour: timestamp.getUTCHours(),
  }
}

/**
 * Wait for data to appear in an Iceberg partition
 */
export async function waitForPartitionData(
  ctx: E2ETestContext,
  partition: IcebergPartition,
  options: {
    minRowCount?: number
    timeout?: number
    pollInterval?: number
  } = {}
): Promise<IcebergVerificationResult> {
  const config = getE2EConfig()
  const timeout = options.timeout || config.timeouts.icebergFlush
  const pollInterval = options.pollInterval || 5000
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const result = await verifyIcebergPartition(ctx, partition, {
      minRowCount: options.minRowCount,
    })

    if (result.valid) {
      return result
    }

    await sleep(pollInterval)
  }

  return {
    fileCount: 0,
    rowCount: 0,
    sizeBytes: 0,
    lastModified: new Date(0),
    valid: false,
    path: formatPartitionPath(partition),
    schemaValid: false,
    error: `Partition did not receive data within ${timeout}ms`,
  }
}

/**
 * Format partition as path string
 */
function formatPartitionPath(partition: IcebergPartition): string {
  const { year, month, day, hour } = partition
  const base = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`
  return hour !== undefined ? `${base}/${String(hour).padStart(2, '0')}` : base
}

// ============================================================================
// SLA VERIFICATION HELPERS
// ============================================================================

/**
 * Verify pipeline meets SLA targets
 */
export async function verifySLACompliance(
  ctx: E2ETestContext
): Promise<{
  compliant: boolean
  p50: { value: number; target: number; pass: boolean }
  p95: { value: number; target: number; pass: boolean }
  p99: { value: number; target: number; pass: boolean }
  eventLossRate: { value: number; target: number; pass: boolean }
}> {
  const config = getE2EConfig()
  const stats = await getPipelineStats(ctx)

  const p50Pass = stats.latency.p50 <= config.pipelineSLA.p50Target
  const p95Pass = stats.latency.p95 <= config.pipelineSLA.p95Target
  const p99Pass = stats.latency.p99 <= config.pipelineSLA.p99Target

  // Calculate event loss rate (placeholder - would need actual implementation)
  const eventLossRate = 0 // Would calculate from dropped events / total events
  const lossPass = eventLossRate <= config.pipelineSLA.maxEventLossRate

  return {
    compliant: p50Pass && p95Pass && p99Pass && lossPass,
    p50: { value: stats.latency.p50, target: config.pipelineSLA.p50Target, pass: p50Pass },
    p95: { value: stats.latency.p95, target: config.pipelineSLA.p95Target, pass: p95Pass },
    p99: { value: stats.latency.p99, target: config.pipelineSLA.p99Target, pass: p99Pass },
    eventLossRate: { value: eventLossRate, target: config.pipelineSLA.maxEventLossRate, pass: lossPass },
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate a correlation ID for tracing
 */
export function generateCorrelationId(prefix = 'e2e'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${timestamp}-${random}`
}

/**
 * Create a timed operation wrapper for consistent measurement
 */
export function createTimedOperation<T>(
  name: string,
  operation: () => Promise<T>
): () => Promise<{ result: T; name: string; durationMs: number }> {
  return async () => {
    const startTime = Date.now()
    const result = await operation()
    return {
      result,
      name,
      durationMs: Date.now() - startTime,
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Event verification
  verifyEventInPipeline,
  waitForEvents,

  // Latency measurement
  measureE2ELatency,
  measurePipelineLatency,

  // Pipeline sync
  waitForPipelineSync,
  getPipelineStats,

  // Iceberg verification
  verifyIcebergPartition,
  getCurrentPartition,
  waitForPartitionData,

  // SLA verification
  verifySLACompliance,

  // Utilities
  generateCorrelationId,
  createTimedOperation,
}
