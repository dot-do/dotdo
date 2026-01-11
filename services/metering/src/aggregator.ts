/**
 * Usage Aggregator Module
 *
 * Background job to compact counters and write to Parquet for analytics.
 * Supports hourly and daily rollups with Iceberg integration.
 *
 * @module services/metering/aggregator
 */

import type {
  UsageRollup,
  AggregationConfig,
  AggregationResult,
  MeteringService,
  CounterStorage,
  BillingPeriod,
} from './types'
import { getPeriodStart, getPeriodEnd, serviceMetricKey } from './counter'

// ============================================================================
// Aggregation Sink Interface
// ============================================================================

/**
 * Interface for writing aggregated usage data
 */
export interface AggregationSink {
  /** Write rollup records */
  write(records: UsageRollup[]): Promise<void>
  /** Flush any buffered records */
  flush(): Promise<void>
}

// ============================================================================
// In-Memory Aggregation Sink (for testing)
// ============================================================================

/**
 * In-memory aggregation sink for development/testing
 */
export class InMemoryAggregationSink implements AggregationSink {
  private records: UsageRollup[] = []
  private flushedCount = 0

  /**
   * Write rollup records
   */
  async write(records: UsageRollup[]): Promise<void> {
    this.records.push(...records)
  }

  /**
   * Flush buffered records
   */
  async flush(): Promise<void> {
    this.flushedCount += this.records.length
  }

  /**
   * Get all stored records
   */
  getRecords(): UsageRollup[] {
    return [...this.records]
  }

  /**
   * Get count of flushed records
   */
  getFlushedCount(): number {
    return this.flushedCount
  }

  /**
   * Clear all records
   */
  clear(): void {
    this.records = []
    this.flushedCount = 0
  }

  /**
   * Query records with filters
   */
  query(filters: {
    agentId?: string
    service?: MeteringService
    periodType?: 'hourly' | 'daily'
    from?: Date
    to?: Date
  }): UsageRollup[] {
    let results = [...this.records]

    if (filters.agentId) {
      results = results.filter((r) => r.agentId === filters.agentId)
    }
    if (filters.service) {
      results = results.filter((r) => r.service === filters.service)
    }
    if (filters.periodType) {
      results = results.filter((r) => r.periodType === filters.periodType)
    }
    if (filters.from) {
      results = results.filter((r) => r.periodStart >= filters.from!)
    }
    if (filters.to) {
      results = results.filter((r) => r.periodEnd <= filters.to!)
    }

    return results
  }
}

// ============================================================================
// Parquet Aggregation Sink
// ============================================================================

/**
 * Parquet file writer for Iceberg integration
 */
export class ParquetAggregationSink implements AggregationSink {
  private buffer: UsageRollup[] = []
  private batchSize: number

  constructor(
    private r2Bucket: { put: (key: string, body: ArrayBuffer) => Promise<void> },
    private icebergPath: string,
    options: { batchSize?: number } = {}
  ) {
    this.batchSize = options.batchSize ?? 1000
  }

  /**
   * Write rollup records
   */
  async write(records: UsageRollup[]): Promise<void> {
    this.buffer.push(...records)

    // Auto-flush when buffer exceeds batch size
    if (this.buffer.length >= this.batchSize) {
      await this.flush()
    }
  }

  /**
   * Flush buffer to Parquet file in R2
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const records = [...this.buffer]
    this.buffer = []

    // Generate Parquet file path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `${this.icebergPath}/data/usage_${timestamp}.parquet`

    // Convert records to Parquet format
    // In production, use a proper Parquet library
    const parquetData = this.recordsToParquet(records)

    // Write to R2
    await this.r2Bucket.put(path, parquetData)
  }

  /**
   * Convert records to Parquet binary format
   * This is a simplified implementation - in production use parquet-wasm or similar
   */
  private recordsToParquet(records: UsageRollup[]): ArrayBuffer {
    // For now, use JSON as a placeholder
    // In production, implement proper Parquet serialization
    const json = JSON.stringify(records)
    const encoder = new TextEncoder()
    const encoded = encoder.encode(json)
    // Create a proper ArrayBuffer (not SharedArrayBuffer)
    const buffer = new ArrayBuffer(encoded.byteLength)
    new Uint8Array(buffer).set(encoded)
    return buffer
  }
}

// ============================================================================
// Usage Aggregator
// ============================================================================

/**
 * Default aggregation configuration
 */
const DEFAULT_CONFIG: AggregationConfig = {
  schedule: '0 * * * *', // Every hour
  batchSize: 1000,
  retentionDays: 90,
  icebergPath: 'iceberg/usage',
}

/**
 * Usage aggregator for compacting counters and writing to Iceberg
 */
export class UsageAggregator {
  private config: AggregationConfig

  constructor(
    private storage: CounterStorage,
    private sink: AggregationSink,
    config?: Partial<AggregationConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Run hourly aggregation
   */
  async aggregateHourly(agentId: string, hour: Date = new Date()): Promise<AggregationResult> {
    const startTime = performance.now()
    const errors: string[] = []

    const periodStart = getPeriodStart('hourly', hour)
    const periodEnd = getPeriodEnd('hourly', hour)

    // Get all counters for the agent
    const counters = await this.storage.getAll(agentId, 'hourly')

    const rollups: UsageRollup[] = []
    let countersProcessed = 0

    for (const [key, value] of counters) {
      const [service, metric] = key.split(':')

      try {
        const rollup: UsageRollup = {
          agentId,
          service: service as MeteringService,
          metric,
          periodType: 'hourly',
          periodStart,
          periodEnd,
          totalValue: value,
          eventCount: 1, // Will be enhanced with actual event tracking
          minValue: value,
          maxValue: value,
          avgValue: value,
          costUnits: this.calculateCost(service as MeteringService, metric, value),
        }

        rollups.push(rollup)
        countersProcessed++
      } catch (error) {
        errors.push(`Failed to aggregate ${key}: ${error}`)
      }
    }

    // Write to sink
    if (rollups.length > 0) {
      await this.sink.write(rollups)
      await this.sink.flush()
    }

    const durationMs = performance.now() - startTime

    return {
      countersProcessed,
      rowsWritten: rollups.length,
      parquetPath: `${this.config.icebergPath}/data/hourly_${periodStart.toISOString()}.parquet`,
      durationMs,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Run daily aggregation (aggregates hourly rollups)
   */
  async aggregateDaily(agentId: string, day: Date = new Date()): Promise<AggregationResult> {
    const startTime = performance.now()
    const errors: string[] = []

    const periodStart = getPeriodStart('daily', day)
    const periodEnd = getPeriodEnd('daily', day)

    // Get all counters for the agent
    const counters = await this.storage.getAll(agentId, 'daily')

    const rollups: UsageRollup[] = []
    let countersProcessed = 0

    for (const [key, value] of counters) {
      const [service, metric] = key.split(':')

      try {
        const rollup: UsageRollup = {
          agentId,
          service: service as MeteringService,
          metric,
          periodType: 'daily',
          periodStart,
          periodEnd,
          totalValue: value,
          eventCount: 1,
          minValue: value,
          maxValue: value,
          avgValue: value,
          costUnits: this.calculateCost(service as MeteringService, metric, value),
        }

        rollups.push(rollup)
        countersProcessed++
      } catch (error) {
        errors.push(`Failed to aggregate ${key}: ${error}`)
      }
    }

    // Write to sink
    if (rollups.length > 0) {
      await this.sink.write(rollups)
      await this.sink.flush()
    }

    const durationMs = performance.now() - startTime

    return {
      countersProcessed,
      rowsWritten: rollups.length,
      parquetPath: `${this.config.icebergPath}/data/daily_${periodStart.toISOString()}.parquet`,
      durationMs,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Calculate cost units for a usage metric
   */
  private calculateCost(service: MeteringService, metric: string, value: number): number {
    // Default cost calculation - override for specific pricing
    const costRates: Record<string, Record<string, number>> = {
      'llm.do': {
        tokens: 0.00001, // $0.01 per 1000 tokens
        requests: 0.001, // $0.001 per request
        input_tokens: 0.000003, // $0.003 per 1000 input tokens
        output_tokens: 0.000015, // $0.015 per 1000 output tokens
      },
      'calls.do': {
        minutes: 0.015, // $0.015 per minute
        calls: 0.01, // $0.01 per call
      },
      'texts.do': {
        sent: 0.0075, // $0.0075 per SMS segment
        received: 0.0075,
      },
      'emails.do': {
        sent: 0.0001, // $0.0001 per email
        opens: 0,
        clicks: 0,
        bounces: 0,
      },
      'payments.do': {
        transactions: 0.30, // $0.30 per transaction base
        volume: 0.029, // 2.9% of volume (stored in cents)
        refunds: 0,
      },
      'queue.do': {
        messages: 0.00001, // $0.01 per 1000 messages
        processed: 0,
        failed: 0,
      },
      'observe.do': {
        events: 0.000001, // $0.001 per 1000 events
        spans: 0.000005,
        logs: 0.0000001,
      },
      'vectors.do': {
        embeddings: 0.0001, // $0.0001 per embedding
        searches: 0.00001, // $0.00001 per search
        dimensions: 0,
      },
      'storage.do': {
        reads: 0.0000001, // $0.0001 per 1000 reads
        writes: 0.000001, // $0.001 per 1000 writes
        bytes: 0.000000000023, // $0.023 per GB
      },
    }

    const rate = costRates[service]?.[metric] ?? 0
    return Math.round(value * rate * 1000000) / 1000000 // Round to 6 decimal places
  }

  /**
   * Cleanup old data beyond retention period
   */
  async cleanup(): Promise<{ deletedCount: number }> {
    // Implementation would delete old rollups beyond retention period
    // For now, return empty result
    return { deletedCount: 0 }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create aggregator with in-memory sink (for testing)
 */
export function createDevAggregator(
  storage: CounterStorage,
  config?: Partial<AggregationConfig>
): { aggregator: UsageAggregator; sink: InMemoryAggregationSink } {
  const sink = new InMemoryAggregationSink()
  const aggregator = new UsageAggregator(storage, sink, config)
  return { aggregator, sink }
}

/**
 * Create aggregator with Parquet sink (for production)
 */
export function createProdAggregator(
  storage: CounterStorage,
  r2Bucket: { put: (key: string, body: ArrayBuffer) => Promise<void> },
  config?: Partial<AggregationConfig>
): UsageAggregator {
  const icebergPath = config?.icebergPath ?? DEFAULT_CONFIG.icebergPath
  const sink = new ParquetAggregationSink(r2Bucket, icebergPath, {
    batchSize: config?.batchSize ?? DEFAULT_CONFIG.batchSize,
  })
  return new UsageAggregator(storage, sink, config)
}
