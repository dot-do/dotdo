/**
 * SPIKE: Cloudflare Pipelines Write Path POC
 *
 * Demonstrates writing DO state changes to Cloudflare Pipelines
 * which automatically manages Iceberg tables in R2 Data Catalog.
 *
 * Architecture:
 *   DO State Change → Pipeline Stream → SQL Transform → R2 Data Catalog (Iceberg)
 *
 * Benefits over current parquet-wasm approach:
 * - No manual Parquet generation
 * - No manual Iceberg manifest management
 * - Automatic compaction (128MB target)
 * - Automatic snapshot management
 * - Zero egress with R2 SQL queries
 *
 * Run tests: npx vitest run db/spikes/pipelines-write-poc.test.ts
 */

// ============================================================================
// Types for Cloudflare Pipelines
// ============================================================================

/**
 * Pipeline binding interface (from Cloudflare Workers types)
 * Added to wrangler.toml as:
 * [[pipelines]]
 * pipeline = "do-state-stream"
 * binding = "PIPELINE"
 */
export interface Pipeline {
  /**
   * Send records to the pipeline stream.
   * Records are buffered and batched before delivery to sinks.
   *
   * @param records - Array of JSON-serializable objects
   * @returns Promise that resolves when records are confirmed as ingested
   */
  send(records: unknown[]): Promise<void>
}

/**
 * State change event from Durable Object
 * This is what gets sent to the Pipeline stream
 */
export interface StateChangeEvent {
  /** Durable Object ID */
  do_id: string
  /** Namespace (e.g., "tenant.api", "payments.do") */
  ns: string
  /** Entity type (e.g., "User", "Order", "Invoice") */
  type: string
  /** State key within the entity */
  key: string
  /** JSON-encoded value (null for deletes) */
  value: string | null
  /** Operation type */
  op: 'PUT' | 'DELETE'
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Sequence number within this DO session */
  seq: number
}

/**
 * Pipelines schema definition for structured streams
 */
export interface StreamSchema {
  [column: string]: {
    type: 'string' | 'int64' | 'float64' | 'boolean' | 'timestamp'
    required?: boolean
  }
}

/**
 * Configuration for PipelineWriter
 */
export interface PipelineWriterConfig {
  /** Maximum events to batch before sending */
  batchSize?: number
  /** Maximum time (ms) to wait before flushing batch */
  flushInterval?: number
  /** Namespace prefix for filtering */
  namespaceFilter?: string
  /** Event types to exclude */
  excludeTypes?: string[]
}

// ============================================================================
// Pipeline Writer
// ============================================================================

/**
 * PipelineWriter batches and sends DO state changes to Cloudflare Pipelines.
 *
 * Designed to be used within a Durable Object to stream state changes
 * to the cold storage layer (Iceberg on R2).
 *
 * @example
 * ```typescript
 * export class MyDurableObject extends DurableObject {
 *   private writer: PipelineWriter
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *     this.writer = new PipelineWriter(env.PIPELINE, {
 *       batchSize: 100,
 *       flushInterval: 5000,
 *     })
 *   }
 *
 *   async put(key: string, value: unknown) {
 *     await this.state.storage.put(key, value)
 *     await this.writer.recordPut(this.state.id.toString(), 'default', 'Data', key, value)
 *   }
 *
 *   async cleanup() {
 *     await this.writer.flush()
 *   }
 * }
 * ```
 */
export class PipelineWriter {
  private pipeline: Pipeline
  private config: Required<PipelineWriterConfig>
  private buffer: StateChangeEvent[] = []
  private seq: number = 0
  private lastFlush: number = Date.now()
  private flushTimeout: ReturnType<typeof setTimeout> | null = null

  // Metrics
  private metrics = {
    eventsQueued: 0,
    eventsWritten: 0,
    flushCount: 0,
    errors: 0,
  }

  constructor(pipeline: Pipeline, config: PipelineWriterConfig = {}) {
    this.pipeline = pipeline
    this.config = {
      batchSize: config.batchSize ?? 100,
      flushInterval: config.flushInterval ?? 5000,
      namespaceFilter: config.namespaceFilter ?? '',
      excludeTypes: config.excludeTypes ?? ['_internal', '_tombstone'],
    }
  }

  /**
   * Record a PUT operation
   */
  async recordPut(
    doId: string,
    ns: string,
    type: string,
    key: string,
    value: unknown
  ): Promise<void> {
    await this.addEvent({
      do_id: doId,
      ns,
      type,
      key,
      value: JSON.stringify(value),
      op: 'PUT',
      timestamp: Date.now(),
      seq: this.seq++,
    })
  }

  /**
   * Record a DELETE operation
   */
  async recordDelete(
    doId: string,
    ns: string,
    type: string,
    key: string
  ): Promise<void> {
    await this.addEvent({
      do_id: doId,
      ns,
      type,
      key,
      value: null,
      op: 'DELETE',
      timestamp: Date.now(),
      seq: this.seq++,
    })
  }

  /**
   * Add an event to the buffer
   */
  private async addEvent(event: StateChangeEvent): Promise<void> {
    // Apply filters
    if (this.config.excludeTypes.includes(event.type)) {
      return
    }
    if (this.config.namespaceFilter && !event.ns.startsWith(this.config.namespaceFilter)) {
      return
    }

    this.buffer.push(event)
    this.metrics.eventsQueued++

    // Check if we should flush
    if (this.buffer.length >= this.config.batchSize) {
      await this.flush()
    } else {
      this.scheduleFlush()
    }
  }

  /**
   * Schedule a flush after the flush interval
   */
  private scheduleFlush(): void {
    if (this.flushTimeout) {
      return // Already scheduled
    }

    this.flushTimeout = setTimeout(async () => {
      this.flushTimeout = null
      await this.flush()
    }, this.config.flushInterval)
  }

  /**
   * Flush all buffered events to the pipeline
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return
    }

    // Clear timeout if scheduled
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = null
    }

    const events = this.buffer
    this.buffer = []

    try {
      await this.pipeline.send(events)
      this.metrics.eventsWritten += events.length
      this.metrics.flushCount++
      this.lastFlush = Date.now()
    } catch (error) {
      // Put events back in buffer for retry
      this.buffer = [...events, ...this.buffer]
      this.metrics.errors++
      throw error
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): typeof this.metrics & { bufferSize: number; lastFlush: number } {
    return {
      ...this.metrics,
      bufferSize: this.buffer.length,
      lastFlush: this.lastFlush,
    }
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      eventsQueued: 0,
      eventsWritten: 0,
      flushCount: 0,
      errors: 0,
    }
  }
}

// ============================================================================
// Pipeline Setup Helpers
// ============================================================================

/**
 * Generate Pipelines stream schema for DO state changes
 */
export function generateStateChangeSchema(): StreamSchema {
  return {
    do_id: { type: 'string', required: true },
    ns: { type: 'string', required: true },
    type: { type: 'string', required: true },
    key: { type: 'string', required: true },
    value: { type: 'string', required: false },  // null for deletes
    op: { type: 'string', required: true },
    timestamp: { type: 'timestamp', required: true },
    seq: { type: 'int64', required: true },
  }
}

/**
 * Generate SQL transform for Pipeline
 * Filters and enriches state changes before writing to Iceberg
 */
export function generatePipelineSql(options: {
  streamName: string
  sinkName: string
  excludeOps?: string[]
}): string {
  const { streamName, sinkName, excludeOps = [] } = options

  const whereClause = excludeOps.length > 0
    ? `WHERE op NOT IN (${excludeOps.map(o => `'${o}'`).join(', ')})`
    : ''

  return `
INSERT INTO ${sinkName}
SELECT
  do_id,
  ns,
  type,
  key,
  value,
  op,
  timestamp,
  seq
FROM ${streamName}
${whereClause}
`.trim()
}

/**
 * Generate wrangler CLI commands for setting up the pipeline
 */
export function generateSetupCommands(config: {
  streamName: string
  sinkName: string
  pipelineName: string
  bucketName: string
  namespace: string
  tableName: string
  rollInterval?: number
}): string[] {
  const {
    streamName,
    sinkName,
    pipelineName,
    bucketName,
    namespace,
    tableName,
    rollInterval = 60,
  } = config

  return [
    `# 1. Enable R2 Data Catalog on bucket`,
    `npx wrangler r2 bucket catalog enable ${bucketName}`,
    ``,
    `# 2. Create the stream with schema`,
    `npx wrangler pipelines streams create ${streamName} --schema '${JSON.stringify(generateStateChangeSchema())}'`,
    ``,
    `# 3. Create the R2 Data Catalog sink`,
    `npx wrangler pipelines sinks create ${sinkName} \\`,
    `  --type "r2-data-catalog" \\`,
    `  --bucket "${bucketName}" \\`,
    `  --namespace "${namespace}" \\`,
    `  --table "${tableName}" \\`,
    `  --roll-interval ${rollInterval} \\`,
    `  --compression zstd \\`,
    `  --catalog-token $R2_CATALOG_TOKEN`,
    ``,
    `# 4. Create the pipeline connecting stream to sink`,
    `npx wrangler pipelines create ${pipelineName} \\`,
    `  --sql "${generatePipelineSql({ streamName, sinkName })}"`,
    ``,
    `# 5. Add binding to wrangler.toml`,
    `echo '`,
    `[[pipelines]]`,
    `pipeline = "${streamName}"`,
    `binding = "PIPELINE"`,
    `' >> wrangler.toml`,
  ]
}

// ============================================================================
// Durable Object Integration Pattern
// ============================================================================

/**
 * Example Durable Object base class with Pipeline integration
 *
 * This demonstrates the recommended pattern for integrating
 * Pipelines with Durable Objects for cold storage writes.
 */
export abstract class PipelineEnabledDO {
  protected state: DurableObjectState
  protected env: { PIPELINE: Pipeline }
  protected writer: PipelineWriter

  constructor(state: DurableObjectState, env: { PIPELINE: Pipeline }) {
    this.state = state
    this.env = env
    this.writer = new PipelineWriter(env.PIPELINE, {
      batchSize: 100,
      flushInterval: 5000,
    })

    // Flush on alarm for cleanup
    state.blockConcurrencyWhile(async () => {
      // Set up periodic flush alarm
      const alarm = await state.storage.getAlarm()
      if (!alarm) {
        await state.storage.setAlarm(Date.now() + 60000) // 1 minute
      }
    })
  }

  /**
   * Get namespace for this DO (override in subclass)
   */
  protected abstract getNamespace(): string

  /**
   * Get type for events (override in subclass)
   */
  protected abstract getType(): string

  /**
   * Put a value with Pipeline streaming
   */
  async put(key: string, value: unknown): Promise<void> {
    await this.state.storage.put(key, value)
    await this.writer.recordPut(
      this.state.id.toString(),
      this.getNamespace(),
      this.getType(),
      key,
      value
    )
  }

  /**
   * Delete a value with Pipeline streaming
   */
  async delete(key: string): Promise<void> {
    await this.state.storage.delete(key)
    await this.writer.recordDelete(
      this.state.id.toString(),
      this.getNamespace(),
      this.getType(),
      key
    )
  }

  /**
   * Handle alarm for periodic flush
   */
  async alarm(): Promise<void> {
    await this.writer.flush()
    // Schedule next alarm
    await this.state.storage.setAlarm(Date.now() + 60000)
  }
}

// ============================================================================
// Type stubs for Cloudflare Workers
// ============================================================================

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
}

interface DurableObjectId {
  toString(): string
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  getAlarm(): Promise<number | null>
  setAlarm(scheduledTime: number): Promise<void>
}

// ============================================================================
// Mock Pipeline for Testing
// ============================================================================

/**
 * Mock Pipeline for testing without actual Cloudflare infrastructure
 */
export class MockPipeline implements Pipeline {
  public sentRecords: unknown[][] = []
  public sendDelay: number = 0
  public shouldFail: boolean = false
  public failCount: number = 0

  async send(records: unknown[]): Promise<void> {
    if (this.sendDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.sendDelay))
    }

    if (this.shouldFail) {
      this.failCount++
      throw new Error('Mock pipeline failure')
    }

    this.sentRecords.push([...records])
  }

  /**
   * Get total number of records sent
   */
  getTotalRecordCount(): number {
    return this.sentRecords.reduce((sum, batch) => sum + batch.length, 0)
  }

  /**
   * Get all sent records flattened
   */
  getAllRecords(): unknown[] {
    return this.sentRecords.flat()
  }

  /**
   * Reset the mock
   */
  reset(): void {
    this.sentRecords = []
    this.sendDelay = 0
    this.shouldFail = false
    this.failCount = 0
  }
}

// ============================================================================
// Comparison with Current Approach
// ============================================================================

/**
 * Current approach using parquet-wasm
 * (For comparison - shows what Pipelines replaces)
 */
export async function currentApproachWriteToIceberg(
  changes: StateChangeEvent[],
  r2: R2Bucket,
  manifestPath: string
): Promise<{ parquetBytes: number; manifestUpdated: boolean }> {
  // This is what we currently do:
  // 1. Import parquet-wasm (1.2MB bundle)
  // 2. Convert changes to Arrow table
  // 3. Write to Parquet with ZSTD compression
  // 4. Upload to R2
  // 5. Read current Iceberg manifest
  // 6. Update manifest with new file
  // 7. Write updated manifest to R2

  // Simplified simulation
  const parquetBytes = changes.length * 100 // Estimate

  // Would need to:
  // - Handle manifest locking
  // - Track file statistics
  // - Update partition metadata
  // - Handle failures and rollback

  return { parquetBytes, manifestUpdated: true }
}

/**
 * New approach using Pipelines
 * (Simple - just send to stream)
 */
export async function pipelinesApproachWriteToIceberg(
  changes: StateChangeEvent[],
  pipeline: Pipeline
): Promise<{ eventsSent: number }> {
  // This is what Pipelines does:
  // 1. Send events to stream (< 1ms)
  // 2. Pipeline buffers and batches
  // 3. Transforms with SQL
  // 4. Writes to R2 Data Catalog as Iceberg
  // 5. Auto-manages manifest
  // 6. Auto-compacts files
  // 7. Auto-expires snapshots

  await pipeline.send(changes)
  return { eventsSent: changes.length }
}

// Stub for R2Bucket
interface R2Bucket {
  put(key: string, value: ArrayBuffer | string): Promise<void>
  get(key: string): Promise<{ text(): Promise<string> } | null>
}
