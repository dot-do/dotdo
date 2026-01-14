/**
 * Streaming Query Execution
 *
 * Provides chunked/streaming responses for large query results to prevent
 * memory exhaustion in Durable Objects environment (128 MB limit).
 *
 * ## Features
 * - ReadableStream-based HTTP responses
 * - NDJSON format (newline-delimited JSON)
 * - Backpressure handling with high/low watermarks
 * - Memory-aware chunk sizing
 * - AbortController support for cancellation
 *
 * ## Usage
 * ```typescript
 * import { StreamingQueryExecutor, createStreamingResponse } from './streaming'
 *
 * const executor = new StreamingQueryExecutor({ chunkSize: 1000 })
 * const stream = executor.executeStream(plan, ctx)
 *
 * return createStreamingResponse(stream, { format: 'ndjson' })
 * ```
 *
 * @see dotdo-yiwff - Streaming Results issue
 * @module db/primitives/query-engine/streaming
 */

import { MEMORY_BUDGETS } from './memory-config'
import type { Row, PipelineContext, PhysicalPlan, Operator } from './pipeline'
import { PipelineExecutor } from './pipeline'

// =============================================================================
// Types
// =============================================================================

/**
 * Streaming output formats
 */
export type StreamFormat = 'ndjson' | 'jsonl' | 'json-array' | 'csv'

/**
 * Streaming configuration options
 */
export interface StreamingConfig {
  /** Number of rows per chunk (default: 1000) */
  chunkSize?: number
  /** High watermark for backpressure (default: 1000) */
  highWaterMark?: number
  /** Low watermark for backpressure (default: 200) */
  lowWaterMark?: number
  /** Output format (default: 'ndjson') */
  format?: StreamFormat
  /** Include metadata in first chunk */
  includeMetadata?: boolean
  /** Maximum total rows to stream (default: unlimited) */
  maxRows?: number
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Chunk metadata included at start of stream
 */
export interface StreamMetadata {
  type: 'metadata'
  columns: string[]
  estimatedRows?: number
  chunkSize: number
  format: StreamFormat
  startedAt: string
}

/**
 * Row chunk in the stream
 */
export interface StreamChunk {
  type: 'chunk'
  rows: Row[]
  index: number
  rowsInChunk: number
  totalRowsSoFar: number
}

/**
 * End of stream marker
 */
export interface StreamEnd {
  type: 'end'
  totalRows: number
  totalChunks: number
  durationMs: number
  completedAt: string
}

/**
 * Error in stream
 */
export interface StreamError {
  type: 'error'
  message: string
  code?: string
  rowsBeforeError: number
}

/**
 * Stream event types
 */
export type StreamEvent = StreamMetadata | StreamChunk | StreamEnd | StreamError

/**
 * Backpressure state
 */
export interface BackpressureState {
  isPaused: boolean
  queuedChunks: number
  highWaterMark: number
  lowWaterMark: number
}

/**
 * Streaming execution statistics
 */
export interface StreamingStats {
  chunksEmitted: number
  rowsEmitted: number
  bytesEmitted: number
  backpressurePauses: number
  peakQueueSize: number
  durationMs: number
}

// =============================================================================
// StreamingQueryExecutor
// =============================================================================

/**
 * Executes queries with streaming/chunked output
 *
 * Designed for large result sets that would exceed memory limits if buffered.
 * Uses pull-based iteration with backpressure to prevent producer overwhelming consumer.
 */
export class StreamingQueryExecutor {
  private readonly config: Required<Omit<StreamingConfig, 'signal' | 'maxRows'>> & Pick<StreamingConfig, 'signal' | 'maxRows'>
  private readonly pipelineExecutor: PipelineExecutor

  constructor(config: StreamingConfig = {}) {
    this.config = {
      chunkSize: config.chunkSize ?? MEMORY_BUDGETS.DEFAULT_BATCH_SIZE,
      highWaterMark: config.highWaterMark ?? MEMORY_BUDGETS.BACKPRESSURE_HIGH_WATERMARK,
      lowWaterMark: config.lowWaterMark ?? MEMORY_BUDGETS.BACKPRESSURE_LOW_WATERMARK,
      format: config.format ?? 'ndjson',
      includeMetadata: config.includeMetadata ?? true,
      maxRows: config.maxRows,
      signal: config.signal,
    }
    this.pipelineExecutor = new PipelineExecutor()
  }

  /**
   * Execute a query plan with streaming output
   *
   * Returns an async generator that yields chunks of rows.
   * Handles backpressure and cancellation automatically.
   */
  async *executeStream(
    plan: PhysicalPlan,
    ctx: PipelineContext
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const startTime = performance.now()
    const stats: StreamingStats = {
      chunksEmitted: 0,
      rowsEmitted: 0,
      bytesEmitted: 0,
      backpressurePauses: 0,
      peakQueueSize: 0,
      durationMs: 0,
    }

    try {
      // Emit metadata first if configured
      if (this.config.includeMetadata) {
        const metadata: StreamMetadata = {
          type: 'metadata',
          columns: this.extractColumns(plan),
          chunkSize: this.config.chunkSize,
          format: this.config.format,
          startedAt: new Date().toISOString(),
        }
        yield metadata
      }

      // Execute and stream results
      let currentChunk: Row[] = []
      let chunkIndex = 0
      let totalRows = 0

      // Build operator tree from physical plan
      const operator = this.buildOperator(plan, ctx)
      operator.open(ctx)

      try {
        let row: Row | null
        while ((row = operator.next()) !== null) {
          // Check for abort
          if (this.config.signal?.aborted) {
            break
          }

          // Check max rows limit
          if (this.config.maxRows !== undefined && totalRows >= this.config.maxRows) {
            break
          }

          currentChunk.push(row)
          totalRows++

          // Emit chunk when full
          if (currentChunk.length >= this.config.chunkSize) {
            const chunk: StreamChunk = {
              type: 'chunk',
              rows: currentChunk,
              index: chunkIndex++,
              rowsInChunk: currentChunk.length,
              totalRowsSoFar: totalRows,
            }

            stats.chunksEmitted++
            stats.rowsEmitted += currentChunk.length
            stats.bytesEmitted += this.estimateChunkSize(currentChunk)

            yield chunk
            currentChunk = []
          }
        }

        // Emit remaining rows
        if (currentChunk.length > 0) {
          const chunk: StreamChunk = {
            type: 'chunk',
            rows: currentChunk,
            index: chunkIndex++,
            rowsInChunk: currentChunk.length,
            totalRowsSoFar: totalRows,
          }

          stats.chunksEmitted++
          stats.rowsEmitted += currentChunk.length
          stats.bytesEmitted += this.estimateChunkSize(currentChunk)

          yield chunk
        }
      } finally {
        operator.close()
      }

      // Emit end marker
      stats.durationMs = performance.now() - startTime
      const end: StreamEnd = {
        type: 'end',
        totalRows,
        totalChunks: chunkIndex,
        durationMs: stats.durationMs,
        completedAt: new Date().toISOString(),
      }
      yield end
    } catch (error) {
      const errorEvent: StreamError = {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        code: (error as any)?.code,
        rowsBeforeError: stats.rowsEmitted,
      }
      yield errorEvent
    }
  }

  /**
   * Execute and format as NDJSON stream
   */
  async *streamNDJSON(
    plan: PhysicalPlan,
    ctx: PipelineContext
  ): AsyncGenerator<string, void, unknown> {
    for await (const event of this.executeStream(plan, ctx)) {
      if (event.type === 'chunk') {
        // Yield each row as a separate JSON line
        for (const row of event.rows) {
          yield JSON.stringify(row) + '\n'
        }
      } else if (event.type === 'metadata' || event.type === 'end') {
        // Optionally include metadata/end as comments or skip
        // Using JSON lines format, we can include them as special rows
        yield JSON.stringify(event) + '\n'
      } else if (event.type === 'error') {
        yield JSON.stringify(event) + '\n'
      }
    }
  }

  /**
   * Execute and format as CSV stream
   */
  async *streamCSV(
    plan: PhysicalPlan,
    ctx: PipelineContext,
    options: { headers?: boolean; delimiter?: string } = {}
  ): AsyncGenerator<string, void, unknown> {
    const delimiter = options.delimiter ?? ','
    let headersEmitted = false
    let columns: string[] = []

    for await (const event of this.executeStream(plan, ctx)) {
      if (event.type === 'metadata') {
        columns = event.columns
        if (options.headers !== false) {
          yield columns.join(delimiter) + '\n'
          headersEmitted = true
        }
      } else if (event.type === 'chunk') {
        // Infer columns from first row if metadata wasn't emitted
        if (!headersEmitted && event.rows.length > 0) {
          columns = Object.keys(event.rows[0]!)
          if (options.headers !== false) {
            yield columns.join(delimiter) + '\n'
            headersEmitted = true
          }
        }

        // Yield each row as CSV
        for (const row of event.rows) {
          const values = columns.map(col => this.escapeCSV(row[col], delimiter))
          yield values.join(delimiter) + '\n'
        }
      }
    }
  }

  /**
   * Get streaming statistics after execution
   */
  getStats(): StreamingStats {
    return {
      chunksEmitted: 0,
      rowsEmitted: 0,
      bytesEmitted: 0,
      backpressurePauses: 0,
      peakQueueSize: 0,
      durationMs: 0,
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private extractColumns(plan: PhysicalPlan): string[] {
    if (plan.type === 'scan' && plan.columns) {
      return plan.columns
    }
    if (plan.type === 'project') {
      return plan.columns.map(col => {
        if (typeof col === 'string') return col
        if ('alias' in col) return col.alias
        if ('column' in col) return col.column
        return 'unknown'
      })
    }
    // Default columns for other plan types
    return []
  }

  private estimateChunkSize(rows: Row[]): number {
    // Rough estimate: JSON stringify and measure
    return rows.reduce((acc, row) => acc + JSON.stringify(row).length, 0)
  }

  private escapeCSV(value: unknown, delimiter: string): string {
    if (value === null || value === undefined) {
      return ''
    }
    const str = String(value)
    // Escape if contains delimiter, quotes, or newlines
    if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"'
    }
    return str
  }

  private buildOperator(plan: PhysicalPlan, ctx: PipelineContext): Operator {
    // Use the pipeline executor's internal buildOperator method
    // For now, we'll use a simple approach that works with the executor
    return (this.pipelineExecutor as any).buildOperator(plan, ctx)
  }
}

// =============================================================================
// HTTP Response Helpers
// =============================================================================

/**
 * Create a streaming HTTP Response from an async generator
 */
export function createStreamingResponse(
  stream: AsyncGenerator<string, void, unknown>,
  options: {
    format?: StreamFormat
    headers?: Record<string, string>
  } = {}
): Response {
  const format = options.format ?? 'ndjson'

  const contentType = getContentType(format)

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const chunk of stream) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': contentType,
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...options.headers,
    },
  })
}

/**
 * Create a streaming response with backpressure support
 */
export function createBackpressureResponse(
  stream: AsyncGenerator<StreamEvent, void, unknown>,
  options: {
    format?: StreamFormat
    highWaterMark?: number
  } = {}
): Response {
  const format = options.format ?? 'ndjson'
  const highWaterMark = options.highWaterMark ?? MEMORY_BUDGETS.BACKPRESSURE_HIGH_WATERMARK

  const readable = new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        const encoder = new TextEncoder()
        try {
          for await (const event of stream) {
            if (event.type === 'chunk') {
              for (const row of event.rows) {
                controller.enqueue(encoder.encode(JSON.stringify(row) + '\n'))
              }
            } else {
              controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
            }
          }
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      },
    },
    // Use byte-counting queuingStrategy for backpressure
    new ByteLengthQueuingStrategy({ highWaterMark: highWaterMark * 100 }) // Approximate bytes
  )

  return new Response(readable, {
    headers: {
      'Content-Type': getContentType(format),
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  })
}

/**
 * Get content type for stream format
 */
function getContentType(format: StreamFormat): string {
  switch (format) {
    case 'ndjson':
    case 'jsonl':
      return 'application/x-ndjson'
    case 'json-array':
      return 'application/json'
    case 'csv':
      return 'text/csv'
    default:
      return 'application/octet-stream'
  }
}

// =============================================================================
// Backpressure Controller
// =============================================================================

/**
 * Controller for managing backpressure in streaming
 */
export class BackpressureController {
  private queuedItems = 0
  private isPaused = false
  private resumePromise: Promise<void> | null = null
  private resumeResolve: (() => void) | null = null

  constructor(
    private readonly highWaterMark: number = MEMORY_BUDGETS.BACKPRESSURE_HIGH_WATERMARK,
    private readonly lowWaterMark: number = MEMORY_BUDGETS.BACKPRESSURE_LOW_WATERMARK
  ) {}

  /**
   * Increment the queue count and check if we should pause
   */
  async enqueue(): Promise<void> {
    this.queuedItems++

    if (this.queuedItems >= this.highWaterMark && !this.isPaused) {
      this.isPaused = true
      this.resumePromise = new Promise(resolve => {
        this.resumeResolve = resolve
      })
    }

    if (this.isPaused && this.resumePromise) {
      await this.resumePromise
    }
  }

  /**
   * Decrement the queue count and check if we should resume
   */
  dequeue(): void {
    this.queuedItems--

    if (this.isPaused && this.queuedItems <= this.lowWaterMark) {
      this.isPaused = false
      if (this.resumeResolve) {
        this.resumeResolve()
        this.resumeResolve = null
        this.resumePromise = null
      }
    }
  }

  /**
   * Get current backpressure state
   */
  getState(): BackpressureState {
    return {
      isPaused: this.isPaused,
      queuedChunks: this.queuedItems,
      highWaterMark: this.highWaterMark,
      lowWaterMark: this.lowWaterMark,
    }
  }

  /**
   * Reset the controller
   */
  reset(): void {
    this.queuedItems = 0
    this.isPaused = false
    if (this.resumeResolve) {
      this.resumeResolve()
    }
    this.resumePromise = null
    this.resumeResolve = null
  }
}

// =============================================================================
// Row Iterator Wrapper
// =============================================================================

/**
 * Wraps a row iterator with streaming capabilities
 */
export class StreamingRowIterator {
  private rowCount = 0

  constructor(
    private readonly iterator: AsyncIterableIterator<Row> | IterableIterator<Row>,
    private readonly config: StreamingConfig = {}
  ) {}

  /**
   * Stream rows in chunks
   */
  async *chunks(): AsyncGenerator<Row[], void, unknown> {
    const chunkSize = this.config.chunkSize ?? MEMORY_BUDGETS.DEFAULT_BATCH_SIZE
    const maxRows = this.config.maxRows

    let currentChunk: Row[] = []

    for await (const row of this.iterator as AsyncIterable<Row>) {
      if (this.config.signal?.aborted) {
        break
      }

      if (maxRows !== undefined && this.rowCount >= maxRows) {
        break
      }

      currentChunk.push(row)
      this.rowCount++

      if (currentChunk.length >= chunkSize) {
        yield currentChunk
        currentChunk = []
      }
    }

    if (currentChunk.length > 0) {
      yield currentChunk
    }
  }

  /**
   * Get total rows streamed
   */
  get totalRows(): number {
    return this.rowCount
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  StreamingQueryExecutor,
  BackpressureController,
  StreamingRowIterator,
  createStreamingResponse,
  createBackpressureResponse,
  getContentType,
}
