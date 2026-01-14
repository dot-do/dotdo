/**
 * SPIKE: Cap'n Web RPC Latency for Distributed Query Execution
 *
 * Goal: Prove we can achieve sub-1ms RPC between Coordinator and Executor Workers
 *       using Cap'n Web's promise pipelining and efficient serialization.
 *
 * Key findings from research:
 * - Cap'n Web uses JSON-based serialization with type encoding for special types
 * - Promise pipelining enables multiple dependent calls in single round-trip
 * - Workers RPC (same-thread) has near-zero latency
 * - Cross-Worker RPC targets sub-1ms for small payloads
 *
 * Latency Targets:
 * - Empty RPC: < 0.5ms
 * - 1KB payload: < 1ms
 * - 100KB payload: < 5ms
 * - 1MB streaming: < 20ms
 *
 * Run: npx vitest run rpc-protocol.test.ts
 */

// ============================================================================
// QUERY PLAN TYPES
// ============================================================================

/**
 * Operation types for query execution.
 * These match ClickHouse's query plan operations.
 */
export type QueryOperation =
  | 'scan'       // Full table scan
  | 'filter'     // WHERE clause
  | 'project'    // SELECT columns
  | 'aggregate'  // GROUP BY + aggregations
  | 'sort'       // ORDER BY
  | 'limit'      // LIMIT/OFFSET
  | 'join'       // JOIN operations
  | 'union'      // UNION ALL

/**
 * Query plan node that can be serialized and sent via RPC.
 * Plans are trees where children execute first and feed into parent.
 */
export interface QueryPlan {
  /** Unique identifier for this plan node */
  id: string

  /** Operation to perform */
  operation: QueryOperation

  /** Child plans (leaf nodes have no children) */
  children?: QueryPlan[]

  /** Operation-specific parameters */
  params: QueryPlanParams
}

/**
 * Operation-specific parameters.
 * Using discriminated union for type safety.
 */
export type QueryPlanParams =
  | ScanParams
  | FilterParams
  | ProjectParams
  | AggregateParams
  | SortParams
  | LimitParams
  | JoinParams
  | UnionParams

export interface ScanParams {
  type: 'scan'
  table: string
  columns: string[]
  partitions?: string[]
}

export interface FilterParams {
  type: 'filter'
  /** SQL-like expression or parsed AST */
  expression: string
  /** Pre-parsed conditions for common patterns */
  conditions?: FilterCondition[]
}

export interface FilterCondition {
  column: string
  operator: '=' | '!=' | '<' | '>' | '<=' | '>=' | 'IN' | 'NOT IN' | 'LIKE' | 'IS NULL' | 'IS NOT NULL'
  value: unknown
}

export interface ProjectParams {
  type: 'project'
  columns: ProjectColumn[]
}

export interface ProjectColumn {
  name: string
  expression?: string  // For computed columns
  alias?: string
}

export interface AggregateParams {
  type: 'aggregate'
  groupBy: string[]
  aggregations: Aggregation[]
}

export interface Aggregation {
  function: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct' | 'any' | 'argMax' | 'argMin'
  column?: string  // Optional for count(*)
  alias: string
}

export interface SortParams {
  type: 'sort'
  orderBy: SortColumn[]
}

export interface SortColumn {
  column: string
  direction: 'asc' | 'desc'
  nullsFirst?: boolean
}

export interface LimitParams {
  type: 'limit'
  limit: number
  offset?: number
}

export interface JoinParams {
  type: 'join'
  joinType: 'inner' | 'left' | 'right' | 'full' | 'cross'
  on?: JoinCondition[]
  using?: string[]
}

export interface JoinCondition {
  left: string
  right: string
  operator: '=' | '!=' | '<' | '>' | '<=' | '>='
}

export interface UnionParams {
  type: 'union'
  all: boolean
}

// ============================================================================
// CHUNK TYPES (Query Results)
// ============================================================================

/**
 * Column data types for efficient storage.
 */
export type ColumnType =
  | 'int8' | 'int16' | 'int32' | 'int64'
  | 'uint8' | 'uint16' | 'uint32' | 'uint64'
  | 'float32' | 'float64'
  | 'boolean'
  | 'string'
  | 'datetime' | 'date'
  | 'uuid'
  | 'json'
  | 'bytes'

/**
 * Column metadata for type-aware processing.
 */
export interface ColumnMeta {
  name: string
  type: ColumnType
  nullable: boolean
}

/**
 * Chunk of query results for streaming.
 * Uses columnar format for efficient processing.
 */
export interface Chunk {
  /** Query identifier for correlation */
  queryId: string

  /** Sequence number for ordering chunks */
  sequence: number

  /** Column metadata (included in first chunk only) */
  columns?: ColumnMeta[]

  /** Columnar data - each entry is column name -> values array */
  data: Record<string, unknown[]>

  /** Number of rows in this chunk */
  rowCount: number

  /** Whether this is the last chunk */
  isLast: boolean

  /** Optional statistics for query optimization */
  stats?: ChunkStats
}

export interface ChunkStats {
  bytesScanned: number
  rowsScanned: number
  executionTimeMs: number
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Efficient serialization format for RPC.
 * Uses a hybrid approach:
 * - JSON for structure (Cap'n Web compatible)
 * - Binary encoding for large numeric arrays (optional optimization)
 */
export class QuerySerializer {
  private textEncoder = new TextEncoder()
  private textDecoder = new TextDecoder()

  // -------------------------------------------------------------------------
  // QueryPlan Serialization
  // -------------------------------------------------------------------------

  /**
   * Serialize a QueryPlan to bytes.
   * Uses JSON for simplicity and Cap'n Web compatibility.
   */
  serializePlan(plan: QueryPlan): Uint8Array {
    const json = JSON.stringify(plan)
    return this.textEncoder.encode(json)
  }

  /**
   * Deserialize a QueryPlan from bytes.
   */
  deserializePlan(data: Uint8Array): QueryPlan {
    const json = this.textDecoder.decode(data)
    return JSON.parse(json) as QueryPlan
  }

  /**
   * Get the serialized size of a plan.
   */
  getPlanSize(plan: QueryPlan): number {
    return JSON.stringify(plan).length
  }

  // -------------------------------------------------------------------------
  // Chunk Serialization
  // -------------------------------------------------------------------------

  /**
   * Serialize a Chunk to bytes.
   *
   * Format:
   * - 4 bytes: header length (big-endian)
   * - N bytes: header JSON (metadata without data)
   * - 4 bytes: data length (big-endian)
   * - M bytes: data JSON (columnar values)
   *
   * This separation allows streaming the header before data is ready.
   */
  serializeChunk(chunk: Chunk): Uint8Array {
    // Separate header (metadata) from data for streaming
    const header = {
      queryId: chunk.queryId,
      sequence: chunk.sequence,
      columns: chunk.columns,
      rowCount: chunk.rowCount,
      isLast: chunk.isLast,
      stats: chunk.stats,
    }

    const headerJson = JSON.stringify(header)
    const headerBytes = this.textEncoder.encode(headerJson)

    const dataJson = JSON.stringify(chunk.data)
    const dataBytes = this.textEncoder.encode(dataJson)

    // Allocate buffer: 4 + header + 4 + data
    const buffer = new Uint8Array(4 + headerBytes.length + 4 + dataBytes.length)
    const view = new DataView(buffer.buffer)

    // Write header length and data
    view.setUint32(0, headerBytes.length)
    buffer.set(headerBytes, 4)

    // Write data length and data
    view.setUint32(4 + headerBytes.length, dataBytes.length)
    buffer.set(dataBytes, 8 + headerBytes.length)

    return buffer
  }

  /**
   * Deserialize a Chunk from bytes.
   */
  deserializeChunk(data: Uint8Array): Chunk {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

    // Read header
    const headerLength = view.getUint32(0)
    const headerBytes = data.slice(4, 4 + headerLength)
    const header = JSON.parse(this.textDecoder.decode(headerBytes))

    // Read data
    const dataLength = view.getUint32(4 + headerLength)
    const dataBytes = data.slice(8 + headerLength, 8 + headerLength + dataLength)
    const chunkData = JSON.parse(this.textDecoder.decode(dataBytes))

    return {
      queryId: header.queryId,
      sequence: header.sequence,
      columns: header.columns,
      rowCount: header.rowCount,
      isLast: header.isLast,
      stats: header.stats,
      data: chunkData,
    }
  }

  /**
   * Get the serialized size of a chunk.
   */
  getChunkSize(chunk: Chunk): number {
    return this.serializeChunk(chunk).length
  }

  // -------------------------------------------------------------------------
  // Streaming Header Serialization (for early metadata)
  // -------------------------------------------------------------------------

  /**
   * Serialize just the chunk header (for streaming).
   */
  serializeChunkHeader(chunk: Omit<Chunk, 'data'>): Uint8Array {
    const json = JSON.stringify(chunk)
    return this.textEncoder.encode(json)
  }

  /**
   * Deserialize a chunk header.
   */
  deserializeChunkHeader(data: Uint8Array): Omit<Chunk, 'data'> {
    const json = this.textDecoder.decode(data)
    return JSON.parse(json)
  }
}

// ============================================================================
// RPC PROTOCOL
// ============================================================================

/**
 * Query execution request sent to Executor Workers.
 */
export interface ExecuteRequest {
  /** Query plan to execute */
  plan: QueryPlan

  /** Partitions to scan (for distributed execution) */
  partitions: string[]

  /** Optional query context */
  context?: QueryContext
}

export interface QueryContext {
  /** Request timeout in milliseconds */
  timeoutMs?: number

  /** Maximum rows to return */
  maxRows?: number

  /** Chunk size for streaming */
  chunkSize?: number

  /** Enable query profiling */
  profile?: boolean

  /** Session settings */
  settings?: Record<string, unknown>
}

/**
 * Query execution response.
 */
export interface ExecuteResponse {
  /** Query identifier */
  queryId: string

  /** Total row count (if known) */
  totalRows?: number

  /** Error if execution failed */
  error?: QueryError
}

export interface QueryError {
  code: string
  message: string
  details?: unknown
}

/**
 * RPC interface for query execution.
 * This is what executors expose to coordinators.
 */
export interface QueryExecutorRPC {
  /**
   * Execute a query plan and stream results.
   *
   * @param plan - The query plan to execute
   * @param partitions - Partitions to scan
   * @param context - Optional execution context
   * @returns AsyncIterable of chunks
   */
  execute(
    plan: QueryPlan,
    partitions: string[],
    context?: QueryContext
  ): Promise<AsyncIterable<Chunk>>

  /**
   * Cancel a running query.
   *
   * @param queryId - The query to cancel
   */
  cancel(queryId: string): Promise<void>

  /**
   * Get query status.
   *
   * @param queryId - The query to check
   */
  status(queryId: string): Promise<QueryStatus>

  /**
   * Health check for the executor.
   */
  health(): Promise<ExecutorHealth>
}

export interface QueryStatus {
  queryId: string
  state: 'running' | 'completed' | 'cancelled' | 'failed'
  progress?: {
    rowsProcessed: number
    bytesProcessed: number
    percentage: number
  }
  error?: QueryError
}

export interface ExecutorHealth {
  healthy: boolean
  activeQueries: number
  memoryUsedBytes: number
  cpuUsagePercent: number
}

// ============================================================================
// QUERY RPC CLASS
// ============================================================================

/**
 * Mock executor for testing the RPC protocol.
 * In production, this would be a Cloudflare Worker.
 */
export class MockQueryExecutor implements QueryExecutorRPC {
  private serializer = new QuerySerializer()
  private runningQueries = new Map<string, { cancelled: boolean }>()
  private queryIdCounter = 0

  /**
   * Execute a query plan.
   * For the spike, this generates mock data.
   */
  async execute(
    plan: QueryPlan,
    partitions: string[],
    context?: QueryContext
  ): Promise<AsyncIterable<Chunk>> {
    const queryId = `query-${++this.queryIdCounter}`
    this.runningQueries.set(queryId, { cancelled: false })

    const chunkSize = context?.chunkSize || 1000
    const maxRows = context?.maxRows || 10000

    // Calculate how many rows per partition
    const rowsPerPartition = Math.ceil(maxRows / partitions.length)

    // Create async generator
    const executor = this
    const columns = this.getColumnsFromPlan(plan)

    async function* generateChunks(): AsyncGenerator<Chunk> {
      let sequence = 0
      let totalRows = 0

      for (const partition of partitions) {
        // Check for cancellation
        if (executor.runningQueries.get(queryId)?.cancelled) {
          return
        }

        let partitionRows = 0
        while (partitionRows < rowsPerPartition && totalRows < maxRows) {
          const rowsThisChunk = Math.min(
            chunkSize,
            rowsPerPartition - partitionRows,
            maxRows - totalRows
          )

          const chunk: Chunk = {
            queryId,
            sequence: sequence++,
            columns: sequence === 1 ? columns : undefined,  // Only first chunk has metadata
            data: executor.generateMockData(columns, rowsThisChunk),
            rowCount: rowsThisChunk,
            isLast: false,
            stats: {
              bytesScanned: rowsThisChunk * 100,  // Mock estimate
              rowsScanned: rowsThisChunk,
              executionTimeMs: 0.1,  // Mock sub-ms execution
            },
          }

          partitionRows += rowsThisChunk
          totalRows += rowsThisChunk

          yield chunk
        }
      }

      // Send final empty chunk with isLast = true
      yield {
        queryId,
        sequence: sequence++,
        data: {},
        rowCount: 0,
        isLast: true,
        stats: {
          bytesScanned: totalRows * 100,
          rowsScanned: totalRows,
          executionTimeMs: 1,
        },
      }

      // Cleanup
      executor.runningQueries.delete(queryId)
    }

    return generateChunks()
  }

  /**
   * Cancel a running query.
   */
  async cancel(queryId: string): Promise<void> {
    const query = this.runningQueries.get(queryId)
    if (query) {
      query.cancelled = true
    }
  }

  /**
   * Get query status.
   */
  async status(queryId: string): Promise<QueryStatus> {
    const query = this.runningQueries.get(queryId)

    if (!query) {
      return {
        queryId,
        state: 'completed',
      }
    }

    return {
      queryId,
      state: query.cancelled ? 'cancelled' : 'running',
      progress: {
        rowsProcessed: 0,
        bytesProcessed: 0,
        percentage: 0,
      },
    }
  }

  /**
   * Health check.
   */
  async health(): Promise<ExecutorHealth> {
    return {
      healthy: true,
      activeQueries: this.runningQueries.size,
      memoryUsedBytes: 1024 * 1024 * 50,  // Mock 50MB
      cpuUsagePercent: 10,
    }
  }

  /**
   * Extract columns from query plan.
   */
  private getColumnsFromPlan(plan: QueryPlan): ColumnMeta[] {
    // For simplicity, look at the top-level operation
    if (plan.params.type === 'scan') {
      return plan.params.columns.map(name => ({
        name,
        type: 'string' as ColumnType,  // Default to string
        nullable: true,
      }))
    }

    if (plan.params.type === 'project') {
      return plan.params.columns.map(col => ({
        name: col.alias || col.name,
        type: 'string' as ColumnType,
        nullable: true,
      }))
    }

    if (plan.params.type === 'aggregate') {
      const columns: ColumnMeta[] = plan.params.groupBy.map(name => ({
        name,
        type: 'string' as ColumnType,
        nullable: true,
      }))

      for (const agg of plan.params.aggregations) {
        columns.push({
          name: agg.alias,
          type: agg.function === 'count' || agg.function === 'count_distinct'
            ? 'int64' as ColumnType
            : 'float64' as ColumnType,
          nullable: false,
        })
      }

      return columns
    }

    // Default columns for testing
    return [
      { name: 'id', type: 'int64', nullable: false },
      { name: 'name', type: 'string', nullable: true },
      { name: 'value', type: 'float64', nullable: true },
    ]
  }

  /**
   * Generate mock data for columns.
   */
  private generateMockData(
    columns: ColumnMeta[],
    rowCount: number
  ): Record<string, unknown[]> {
    const data: Record<string, unknown[]> = {}

    for (const col of columns) {
      const values: unknown[] = []

      for (let i = 0; i < rowCount; i++) {
        switch (col.type) {
          case 'int8':
          case 'int16':
          case 'int32':
          case 'int64':
          case 'uint8':
          case 'uint16':
          case 'uint32':
          case 'uint64':
            values.push(Math.floor(Math.random() * 1000000))
            break
          case 'float32':
          case 'float64':
            values.push(Math.random() * 1000)
            break
          case 'boolean':
            values.push(Math.random() > 0.5)
            break
          case 'string':
            values.push(`value-${i}`)
            break
          case 'datetime':
          case 'date':
            values.push(new Date().toISOString())
            break
          case 'uuid':
            values.push(crypto.randomUUID())
            break
          default:
            values.push(null)
        }
      }

      data[col.name] = values
    }

    return data
  }
}

// ============================================================================
// QUERY RPC CLIENT (Coordinator -> Executor)
// ============================================================================

/**
 * RPC client for coordinators to communicate with executors.
 * Handles serialization and streaming.
 */
export class QueryRPC {
  private serializer = new QuerySerializer()

  /**
   * Create a new QueryRPC instance.
   *
   * @param executor - The executor to communicate with
   */
  constructor(private executor: QueryExecutorRPC) {}

  /**
   * Execute a query plan on partitions.
   *
   * @param plan - Query plan to execute
   * @param partitions - Partitions to scan
   * @param context - Optional execution context
   * @returns AsyncIterable of chunks
   */
  async execute(
    plan: QueryPlan,
    partitions: string[],
    context?: QueryContext
  ): Promise<AsyncIterable<Chunk>> {
    // In production, this would serialize and send via RPC
    // For the spike, we call the executor directly
    return this.executor.execute(plan, partitions, context)
  }

  /**
   * Serialize a query plan for transmission.
   */
  serializePlan(plan: QueryPlan): Uint8Array {
    return this.serializer.serializePlan(plan)
  }

  /**
   * Deserialize a query plan.
   */
  deserializePlan(data: Uint8Array): QueryPlan {
    return this.serializer.deserializePlan(data)
  }

  /**
   * Serialize a chunk for transmission.
   */
  serializeChunk(chunk: Chunk): Uint8Array {
    return this.serializer.serializeChunk(chunk)
  }

  /**
   * Deserialize a chunk.
   */
  deserializeChunk(data: Uint8Array): Chunk {
    return this.serializer.deserializeChunk(data)
  }

  /**
   * Get health status of the executor.
   */
  async health(): Promise<ExecutorHealth> {
    return this.executor.health()
  }

  /**
   * Cancel a running query.
   */
  async cancel(queryId: string): Promise<void> {
    return this.executor.cancel(queryId)
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a simple scan plan for testing.
 */
export function createScanPlan(
  table: string,
  columns: string[],
  partitions?: string[]
): QueryPlan {
  return {
    id: crypto.randomUUID(),
    operation: 'scan',
    params: {
      type: 'scan',
      table,
      columns,
      partitions,
    },
  }
}

/**
 * Create a filtered scan plan.
 */
export function createFilteredScanPlan(
  table: string,
  columns: string[],
  conditions: FilterCondition[]
): QueryPlan {
  return {
    id: crypto.randomUUID(),
    operation: 'filter',
    children: [createScanPlan(table, columns)],
    params: {
      type: 'filter',
      expression: conditions.map(c =>
        `${c.column} ${c.operator} ${JSON.stringify(c.value)}`
      ).join(' AND '),
      conditions,
    },
  }
}

/**
 * Create an aggregation plan.
 */
export function createAggregatePlan(
  table: string,
  groupBy: string[],
  aggregations: Aggregation[]
): QueryPlan {
  const columns = [...groupBy, ...aggregations.map(a => a.column).filter(Boolean) as string[]]

  return {
    id: crypto.randomUUID(),
    operation: 'aggregate',
    children: [createScanPlan(table, columns)],
    params: {
      type: 'aggregate',
      groupBy,
      aggregations,
    },
  }
}

/**
 * Generate random data of specified size for benchmarking.
 * Handles sizes larger than crypto.getRandomValues limit (65536 bytes).
 */
export function generateTestData(sizeBytes: number): Uint8Array {
  const data = new Uint8Array(sizeBytes)
  const maxChunkSize = 65536

  // Fill in chunks to avoid crypto.getRandomValues limit
  for (let offset = 0; offset < sizeBytes; offset += maxChunkSize) {
    const chunkSize = Math.min(maxChunkSize, sizeBytes - offset)
    const chunk = new Uint8Array(chunkSize)
    crypto.getRandomValues(chunk)
    data.set(chunk, offset)
  }

  return data
}

/**
 * Calculate the size of a chunk in bytes.
 */
export function getChunkSizeBytes(chunk: Chunk): number {
  const serializer = new QuerySerializer()
  return serializer.getChunkSize(chunk)
}
