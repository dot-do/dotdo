/**
 * SPIKE: Cloudflare Pipelines API for Dynamic Stream/Pipeline Creation
 *
 * Goal: Prove we can dynamically create Pipelines streams/sinks/pipelines
 *       via REST API for CREATE TABLE support
 *
 * Key findings from research:
 * - REST API at /accounts/{account_id}/pipelines/v1/
 * - 20 streams/sinks/pipelines limit per account
 * - Schema immutable after creation
 * - Expected latency: 500ms-1.5s for full CREATE TABLE flow
 *
 * Run: npx vitest run pipelines-api.test.ts
 */

interface PipelinesConfig {
  accountId: string
  apiToken: string
  baseUrl?: string
}

interface StreamSchema {
  [column: string]: {
    type: 'string' | 'int64' | 'float64' | 'boolean' | 'timestamp'
    required?: boolean
  }
}

interface CreateStreamRequest {
  name: string
  schema?: StreamSchema  // Optional for unstructured streams
}

interface Stream {
  id: string
  name: string
  endpoint: string
  schema?: StreamSchema
  created_at: string
}

interface CreateSinkRequest {
  name: string
  destination_conf: {
    bucket: string
    dataset: string
    path_prefix?: string
    format?: 'parquet' | 'json' | 'iceberg'
  }
}

interface Sink {
  id: string
  name: string
  destination_conf: CreateSinkRequest['destination_conf']
  created_at: string
}

interface CreatePipelineRequest {
  name: string
  source_conf: {
    source_id: string
    source_type: 'stream'
  }
  sink_conf: {
    sink_id: string
  }
  sql?: string  // Optional SQL transformation
}

interface Pipeline {
  id: string
  name: string
  source_conf: CreatePipelineRequest['source_conf']
  sink_conf: CreatePipelineRequest['sink_conf']
  created_at: string
}

interface ApiResponse<T> {
  success: boolean
  result: T
  errors: Array<{ code: number; message: string }>
  messages: string[]
}

/**
 * Cloudflare Pipelines API client
 * Works in both Node.js and Cloudflare Workers environments
 */
export class PipelinesClient {
  private accountId: string
  private apiToken: string
  private baseUrl: string

  constructor(config: PipelinesConfig) {
    this.accountId = config.accountId
    this.apiToken = config.apiToken
    this.baseUrl = config.baseUrl || 'https://api.cloudflare.com/client/v4'
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/pipelines/v1${path}`

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new PipelinesApiError(
        `API request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorText
      )
    }

    return response.json() as Promise<ApiResponse<T>>
  }

  // ============================================================================
  // Stream Operations
  // ============================================================================

  async createStream(request: CreateStreamRequest): Promise<Stream> {
    const response = await this.request<Stream>('POST', '/streams', request)
    if (!response.success) {
      throw new PipelinesApiError(
        `Failed to create stream: ${response.errors.map(e => e.message).join(', ')}`,
        400
      )
    }
    return response.result
  }

  async listStreams(): Promise<Stream[]> {
    const response = await this.request<Stream[]>('GET', '/streams')
    return response.result
  }

  async getStream(streamId: string): Promise<Stream> {
    const response = await this.request<Stream>('GET', `/streams/${streamId}`)
    return response.result
  }

  async deleteStream(streamId: string): Promise<void> {
    await this.request<void>('DELETE', `/streams/${streamId}`)
  }

  // ============================================================================
  // Sink Operations
  // ============================================================================

  async createSink(request: CreateSinkRequest): Promise<Sink> {
    const response = await this.request<Sink>('POST', '/sinks', request)
    if (!response.success) {
      throw new PipelinesApiError(
        `Failed to create sink: ${response.errors.map(e => e.message).join(', ')}`,
        400
      )
    }
    return response.result
  }

  async listSinks(): Promise<Sink[]> {
    const response = await this.request<Sink[]>('GET', '/sinks')
    return response.result
  }

  async deleteSink(sinkId: string): Promise<void> {
    await this.request<void>('DELETE', `/sinks/${sinkId}`)
  }

  // ============================================================================
  // Pipeline Operations
  // ============================================================================

  async createPipeline(request: CreatePipelineRequest): Promise<Pipeline> {
    const response = await this.request<Pipeline>('POST', '/pipelines', request)
    if (!response.success) {
      throw new PipelinesApiError(
        `Failed to create pipeline: ${response.errors.map(e => e.message).join(', ')}`,
        400
      )
    }
    return response.result
  }

  async listPipelines(): Promise<Pipeline[]> {
    const response = await this.request<Pipeline[]>('GET', '/pipelines')
    return response.result
  }

  async deletePipeline(pipelineId: string): Promise<void> {
    await this.request<void>('DELETE', `/pipelines/${pipelineId}`)
  }

  // ============================================================================
  // High-Level Operations
  // ============================================================================

  /**
   * Create a complete table pipeline (stream + sink + pipeline)
   * This is what would be called on CREATE TABLE with Pipelines engine
   */
  async createTablePipeline(options: {
    tableName: string
    schema: StreamSchema
    r2Bucket: string
    pathPrefix?: string
    format?: 'parquet' | 'json' | 'iceberg'
  }): Promise<{
    stream: Stream
    sink: Sink
    pipeline: Pipeline
    writeUrl: string
  }> {
    const { tableName, schema, r2Bucket, pathPrefix, format } = options

    // 1. Create Stream
    const stream = await this.createStream({
      name: `${tableName}_stream`,
      schema,
    })

    // 2. Create Sink
    const sink = await this.createSink({
      name: `${tableName}_sink`,
      destination_conf: {
        bucket: r2Bucket,
        dataset: tableName,
        path_prefix: pathPrefix || `warehouse/${tableName}/`,
        format: format || 'parquet',
      },
    })

    // 3. Create Pipeline
    const pipeline = await this.createPipeline({
      name: `${tableName}_pipeline`,
      source_conf: {
        source_id: stream.id,
        source_type: 'stream',
      },
      sink_conf: {
        sink_id: sink.id,
      },
    })

    return {
      stream,
      sink,
      pipeline,
      writeUrl: stream.endpoint,
    }
  }

  /**
   * Delete a complete table pipeline (cleanup on DROP TABLE)
   */
  async deleteTablePipeline(tableName: string): Promise<void> {
    // Delete in reverse order: pipeline -> sink -> stream
    const pipelines = await this.listPipelines()
    const sinks = await this.listSinks()
    const streams = await this.listStreams()

    const pipeline = pipelines.find(p => p.name === `${tableName}_pipeline`)
    const sink = sinks.find(s => s.name === `${tableName}_sink`)
    const stream = streams.find(s => s.name === `${tableName}_stream`)

    if (pipeline) await this.deletePipeline(pipeline.id)
    if (sink) await this.deleteSink(sink.id)
    if (stream) await this.deleteStream(stream.id)
  }
}

/**
 * Custom error class for Pipelines API errors
 */
export class PipelinesApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string
  ) {
    super(message)
    this.name = 'PipelinesApiError'
  }
}

// ============================================================================
// Stream Pool for Fast CREATE TABLE
// ============================================================================

interface PooledStream {
  stream: Stream
  inUse: boolean
  tableName?: string
  allocatedAt?: Date
}

/**
 * Pre-provisioned stream pool for fast CREATE TABLE
 * Eliminates 500ms+ latency for stream creation
 */
export class StreamPool {
  private client: PipelinesClient
  private pool: Map<string, PooledStream> = new Map()
  private poolSize: number
  private poolPrefix: string

  constructor(client: PipelinesClient, options?: {
    poolSize?: number
    poolPrefix?: string
  }) {
    this.client = client
    this.poolSize = options?.poolSize || 10
    this.poolPrefix = options?.poolPrefix || 'pool_'
  }

  /**
   * Initialize the pool with pre-created streams
   * Call this at Worker startup
   */
  async initialize(): Promise<void> {
    const existing = await this.client.listStreams()
    const poolStreams = existing.filter(s => s.name.startsWith(this.poolPrefix))

    // Mark existing pool streams
    for (const stream of poolStreams) {
      this.pool.set(stream.id, {
        stream,
        inUse: false,
      })
    }

    // Create additional streams if needed
    const needed = this.poolSize - poolStreams.length
    for (let i = 0; i < needed; i++) {
      const stream = await this.client.createStream({
        name: `${this.poolPrefix}${Date.now()}_${i}`,
      })
      this.pool.set(stream.id, {
        stream,
        inUse: false,
      })
    }
  }

  /**
   * Allocate a stream from the pool for a table
   * Returns immediately if pool has available streams
   */
  allocate(tableName: string): Stream | null {
    for (const [id, pooled] of this.pool) {
      if (!pooled.inUse) {
        pooled.inUse = true
        pooled.tableName = tableName
        pooled.allocatedAt = new Date()
        return pooled.stream
      }
    }
    return null  // Pool exhausted
  }

  /**
   * Release a stream back to the pool
   */
  release(streamId: string): void {
    const pooled = this.pool.get(streamId)
    if (pooled) {
      pooled.inUse = false
      pooled.tableName = undefined
      pooled.allocatedAt = undefined
    }
  }

  /**
   * Get pool statistics
   */
  stats(): { total: number; available: number; inUse: number } {
    let available = 0
    let inUse = 0
    for (const pooled of this.pool.values()) {
      if (pooled.inUse) inUse++
      else available++
    }
    return { total: this.pool.size, available, inUse }
  }
}

// ============================================================================
// ClickHouse SQL Type Mapping
// ============================================================================

/**
 * Convert ClickHouse column types to Pipelines schema types
 */
export function clickHouseToStreamSchema(columns: Array<{
  name: string
  type: string
  nullable?: boolean
}>): StreamSchema {
  const schema: StreamSchema = {}

  for (const col of columns) {
    let type: StreamSchema[string]['type']

    // Map ClickHouse types to Pipelines types
    const chType = col.type.replace(/Nullable\(([^)]+)\)/, '$1').toLowerCase()

    if (chType.includes('int') || chType === 'uint8' || chType === 'uint16' ||
        chType === 'uint32' || chType === 'uint64') {
      type = 'int64'
    } else if (chType.includes('float') || chType.includes('decimal')) {
      type = 'float64'
    } else if (chType === 'bool' || chType === 'boolean') {
      type = 'boolean'
    } else if (chType.includes('date') || chType.includes('datetime')) {
      type = 'timestamp'
    } else {
      type = 'string'  // Default for String, FixedString, Enum, etc.
    }

    schema[col.name] = {
      type,
      required: !col.nullable && !col.type.startsWith('Nullable'),
    }
  }

  return schema
}

/**
 * Parse ClickHouse CREATE TABLE to extract column definitions
 */
export function parseCreateTableColumns(sql: string): Array<{
  name: string
  type: string
  nullable: boolean
}> {
  // Extract content between first ( and matching )
  // Must handle nested parentheses for types like Map(String, String)
  const startIdx = sql.indexOf('(')
  if (startIdx === -1) return []

  let depth = 0
  let endIdx = startIdx
  for (let i = startIdx; i < sql.length; i++) {
    if (sql[i] === '(') depth++
    else if (sql[i] === ')') {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }

  const columnDefs = sql.slice(startIdx + 1, endIdx)
  const columns: Array<{ name: string; type: string; nullable: boolean }> = []

  // Split by comma, but respect parentheses
  const parts: string[] = []
  depth = 0
  let current = ''
  for (const char of columnDefs) {
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())

  for (const part of parts) {
    const colMatch = part.match(/^\s*(\w+)\s+(.+?)\s*$/i)
    if (colMatch) {
      const name = colMatch[1]
      const type = colMatch[2].trim()
      columns.push({
        name,
        type,
        nullable: type.toLowerCase().includes('nullable'),
      })
    }
  }

  return columns
}
