// @dotdo/db Analytics Module - ClickHouse Integration
// Provides time-series analytics backed by ClickHouse
// See do-etru.5 - Integrate ClickHouse analytics backend

import type { JsonValue, StorableData } from './types'
import type { Event, EventQueryOptions } from './events'

/**
 * ClickHouse client interface - matches @dotdo/chdb patterns
 * Can be satisfied by any ClickHouse-compatible client
 */
export interface ClickHouseClient {
  query<T = unknown>(sql: string, options?: ClickHouseQueryOptions): Promise<ClickHouseQueryResult<T>>
  queryRaw(sql: string, options?: ClickHouseQueryOptions): Promise<string | ArrayBuffer>
  close(): Promise<void>
}

/**
 * Query options for ClickHouse
 */
export interface ClickHouseQueryOptions {
  format?: 'JSON' | 'JSONEachRow' | 'JSONCompact' | 'CSV' | 'TSV' | 'Arrow' | string
  params?: Record<string, unknown>
  settings?: Record<string, string | number | boolean>
}

/**
 * Query result from ClickHouse
 */
export interface ClickHouseQueryResult<T = unknown> {
  data: T[]
  rowsRead: number
  bytesRead: number
  elapsed: number
  raw?: ArrayBuffer | string
}

/**
 * Analytics event structure for ingestion
 * Optimized for ClickHouse's columnar storage
 */
export interface AnalyticsEvent<P extends JsonValue = JsonValue> {
  /** Event ID - should be globally unique */
  event_id: string
  /** Event type/name (e.g., 'page_view', 'click', 'purchase') */
  event_type: string
  /** Timestamp in milliseconds since epoch */
  timestamp: number
  /** Tenant/organization ID for multi-tenancy */
  tenant_id?: string
  /** User ID if available */
  user_id?: string
  /** Session ID for grouping related events */
  session_id?: string
  /** Event payload - JSON-serializable data */
  payload: P
  /** Additional dimensions for filtering */
  dimensions?: Record<string, string | number | boolean>
  /** Numeric metrics for aggregation */
  metrics?: Record<string, number>
}

/**
 * Time granularity for aggregations
 */
export type TimeGranularity = 'minute' | 'hour' | 'day' | 'week' | 'month'

/**
 * Aggregation function types
 */
export type AggregationFunction = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'uniq' | 'quantile'

/**
 * Query options for analytics
 */
export interface AnalyticsQueryOptions {
  /** Filter by event types */
  eventTypes?: string[]
  /** Filter by tenant ID */
  tenantId?: string
  /** Filter by user ID */
  userId?: string
  /** Filter by session ID */
  sessionId?: string
  /** Start time (inclusive, ms since epoch) */
  startTime?: number
  /** End time (exclusive, ms since epoch) */
  endTime?: number
  /** Time granularity for grouping */
  granularity?: TimeGranularity
  /** Custom dimension filters */
  dimensionFilters?: Record<string, string | number | boolean | string[]>
  /** Limit results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

/**
 * Aggregation query configuration
 */
export interface AggregationQuery {
  /** Metrics to aggregate */
  metrics: Array<{
    field: string
    function: AggregationFunction
    alias?: string
  }>
  /** Dimensions to group by */
  groupBy?: string[]
  /** Additional filters */
  filters?: AnalyticsQueryOptions
  /** Order by clause */
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>
}

/**
 * Time-series data point
 */
export interface TimeSeriesPoint {
  timestamp: number
  value: number
  dimensions?: Record<string, string | number>
}

/**
 * Aggregation result row
 */
export interface AggregationResult {
  [key: string]: unknown
}

/**
 * Analytics query result
 */
export interface AnalyticsResult<T = AnalyticsEvent> {
  data: T[]
  metadata: {
    totalRows: number
    rowsRead: number
    bytesRead: number
    elapsed: number
  }
}

/**
 * Table configuration for analytics storage
 */
export interface AnalyticsTableConfig {
  /** Table name (default: 'analytics_events') */
  tableName?: string
  /** Database name (default: 'default') */
  database?: string
  /** Engine type (default: 'MergeTree') */
  engine?: 'MergeTree' | 'ReplacingMergeTree' | 'SummingMergeTree' | 'AggregatingMergeTree'
  /** Partition by expression (default: 'toYYYYMM(timestamp)') */
  partitionBy?: string
  /** Order by columns (default: ['tenant_id', 'timestamp', 'event_type']) */
  orderBy?: string[]
  /** TTL expression for data retention */
  ttl?: string
}

/**
 * ClickHouse Analytics Store Interface
 */
export interface AnalyticsStore {
  /**
   * Ingest a single analytics event
   */
  ingest(event: AnalyticsEvent): Promise<void>

  /**
   * Batch ingest multiple events
   */
  ingestBatch(events: AnalyticsEvent[]): Promise<{ inserted: number }>

  /**
   * Query raw events
   */
  query<T extends AnalyticsEvent = AnalyticsEvent>(
    options: AnalyticsQueryOptions
  ): Promise<AnalyticsResult<T>>

  /**
   * Run aggregation query
   */
  aggregate(query: AggregationQuery): Promise<AnalyticsResult<AggregationResult>>

  /**
   * Get time-series data for a metric
   */
  timeSeries(
    metric: string,
    aggregation: AggregationFunction,
    options: AnalyticsQueryOptions
  ): Promise<TimeSeriesPoint[]>

  /**
   * Count events matching criteria
   */
  count(options?: AnalyticsQueryOptions): Promise<number>

  /**
   * Count unique values for a dimension
   */
  countUnique(dimension: string, options?: AnalyticsQueryOptions): Promise<number>

  /**
   * Get top N values for a dimension
   */
  topN(
    dimension: string,
    n: number,
    options?: AnalyticsQueryOptions
  ): Promise<Array<{ value: string; count: number }>>

  /**
   * Create the analytics table if it doesn't exist
   */
  createTable(): Promise<void>

  /**
   * Close the store and release resources
   */
  close(): Promise<void>
}

/**
 * Configuration for ClickHouse Analytics Store
 */
export interface ClickHouseAnalyticsConfig {
  /** ClickHouse client instance */
  client: ClickHouseClient
  /** Table configuration */
  table?: AnalyticsTableConfig
  /** Batch size for inserts (default: 1000) */
  batchSize?: number
  /** Flush interval in ms (default: 5000) */
  flushInterval?: number
}

/**
 * Map time granularity to ClickHouse date function
 */
function granularityToDateFunc(granularity: TimeGranularity): string {
  switch (granularity) {
    case 'minute':
      return 'toStartOfMinute'
    case 'hour':
      return 'toStartOfHour'
    case 'day':
      return 'toStartOfDay'
    case 'week':
      return 'toStartOfWeek'
    case 'month':
      return 'toStartOfMonth'
    default:
      return 'toStartOfDay'
  }
}

/**
 * Escape a string value for ClickHouse SQL
 */
function escapeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'number') {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0'
  }
  if (typeof value === 'string') {
    // Escape single quotes by doubling them
    return `'${value.replace(/'/g, "''")}'`
  }
  if (Array.isArray(value)) {
    return `[${value.map(escapeValue).join(', ')}]`
  }
  if (typeof value === 'object') {
    return escapeValue(JSON.stringify(value))
  }
  return escapeValue(String(value))
}

/**
 * Escape identifier (table/column name)
 */
function escapeIdentifier(name: string): string {
  // Use backticks for identifiers that may contain special characters
  return `\`${name.replace(/`/g, '``')}\``
}

/**
 * Build WHERE clause from options
 */
function buildWhereClause(options: AnalyticsQueryOptions): string {
  const conditions: string[] = []

  if (options.eventTypes && options.eventTypes.length > 0) {
    const types = options.eventTypes.map(t => escapeValue(t)).join(', ')
    conditions.push(`event_type IN (${types})`)
  }

  if (options.tenantId) {
    conditions.push(`tenant_id = ${escapeValue(options.tenantId)}`)
  }

  if (options.userId) {
    conditions.push(`user_id = ${escapeValue(options.userId)}`)
  }

  if (options.sessionId) {
    conditions.push(`session_id = ${escapeValue(options.sessionId)}`)
  }

  if (options.startTime !== undefined) {
    conditions.push(`timestamp >= ${options.startTime}`)
  }

  if (options.endTime !== undefined) {
    conditions.push(`timestamp < ${options.endTime}`)
  }

  if (options.dimensionFilters) {
    for (const [key, value] of Object.entries(options.dimensionFilters)) {
      if (Array.isArray(value)) {
        const values = value.map(v => escapeValue(v)).join(', ')
        conditions.push(`JSONExtractString(dimensions, ${escapeValue(key)}) IN (${values})`)
      } else {
        conditions.push(`JSONExtractString(dimensions, ${escapeValue(key)}) = ${escapeValue(value)}`)
      }
    }
  }

  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
}

/**
 * Create a ClickHouse Analytics Store
 */
export function createClickHouseAnalyticsStore(config: ClickHouseAnalyticsConfig): AnalyticsStore {
  const {
    client,
    table: tableConfig = {},
    batchSize = 1000,
    flushInterval = 5000
  } = config

  const {
    tableName = 'analytics_events',
    database = 'default',
    engine = 'MergeTree',
    partitionBy = 'toYYYYMM(toDateTime(timestamp / 1000))',
    orderBy = ['tenant_id', 'timestamp', 'event_type'],
    ttl
  } = tableConfig

  const fullTableName = `${escapeIdentifier(database)}.${escapeIdentifier(tableName)}`

  // Batch buffer for efficient inserts
  let eventBuffer: AnalyticsEvent[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Flush buffered events to ClickHouse
   */
  async function flushBuffer(): Promise<number> {
    if (eventBuffer.length === 0) {
      return 0
    }

    const events = eventBuffer
    eventBuffer = []

    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }

    // Build INSERT statement with values
    const columns = [
      'event_id',
      'event_type',
      'timestamp',
      'tenant_id',
      'user_id',
      'session_id',
      'payload',
      'dimensions',
      'metrics'
    ]

    const values = events.map(event => {
      return `(${[
        escapeValue(event.event_id),
        escapeValue(event.event_type),
        event.timestamp,
        escapeValue(event.tenant_id || ''),
        escapeValue(event.user_id || ''),
        escapeValue(event.session_id || ''),
        escapeValue(JSON.stringify(event.payload)),
        escapeValue(JSON.stringify(event.dimensions || {})),
        escapeValue(JSON.stringify(event.metrics || {}))
      ].join(', ')})`
    })

    const sql = `INSERT INTO ${fullTableName} (${columns.join(', ')}) VALUES ${values.join(', ')}`
    await client.query(sql)

    return events.length
  }

  /**
   * Schedule a buffer flush
   */
  function scheduleFlush(): void {
    if (flushTimer === null && flushInterval > 0) {
      flushTimer = setTimeout(() => {
        flushBuffer().catch(console.error)
      }, flushInterval)
    }
  }

  return {
    async ingest(event: AnalyticsEvent): Promise<void> {
      eventBuffer.push(event)

      if (eventBuffer.length >= batchSize) {
        await flushBuffer()
      } else {
        scheduleFlush()
      }
    },

    async ingestBatch(events: AnalyticsEvent[]): Promise<{ inserted: number }> {
      // Add all events to buffer
      eventBuffer.push(...events)

      // Flush in batches
      let totalInserted = 0
      while (eventBuffer.length >= batchSize) {
        const toFlush = eventBuffer.splice(0, batchSize)
        eventBuffer = toFlush.concat(eventBuffer)
        totalInserted += await flushBuffer()
      }

      // Flush remaining if any
      if (eventBuffer.length > 0) {
        totalInserted += await flushBuffer()
      }

      return { inserted: totalInserted }
    },

    async query<T extends AnalyticsEvent = AnalyticsEvent>(
      options: AnalyticsQueryOptions
    ): Promise<AnalyticsResult<T>> {
      const whereClause = buildWhereClause(options)
      const limit = options.limit ?? 1000
      const offset = options.offset ?? 0

      const sql = `
        SELECT
          event_id,
          event_type,
          timestamp,
          tenant_id,
          user_id,
          session_id,
          payload,
          dimensions,
          metrics
        FROM ${fullTableName}
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `

      const result = await client.query<T>(sql)

      return {
        data: result.data,
        metadata: {
          totalRows: result.data.length,
          rowsRead: result.rowsRead,
          bytesRead: result.bytesRead,
          elapsed: result.elapsed
        }
      }
    },

    async aggregate(query: AggregationQuery): Promise<AnalyticsResult<AggregationResult>> {
      const whereClause = query.filters ? buildWhereClause(query.filters) : ''

      // Build SELECT clause with aggregations
      const selectParts: string[] = []

      // Add group by columns to select
      if (query.groupBy && query.groupBy.length > 0) {
        for (const col of query.groupBy) {
          selectParts.push(escapeIdentifier(col))
        }
      }

      // Add metric aggregations
      for (const metric of query.metrics) {
        const alias = metric.alias || `${metric.function}_${metric.field}`
        let aggExpr: string

        if (metric.field === '*' || metric.field === '1') {
          // Count all
          aggExpr = `${metric.function}()`
        } else if (metric.field.startsWith('metrics.')) {
          // Extract from metrics JSON
          const key = metric.field.replace('metrics.', '')
          aggExpr = `${metric.function}(JSONExtractFloat(metrics, ${escapeValue(key)}))`
        } else {
          aggExpr = `${metric.function}(${escapeIdentifier(metric.field)})`
        }

        selectParts.push(`${aggExpr} AS ${escapeIdentifier(alias)}`)
      }

      // Build GROUP BY clause
      const groupByClause = query.groupBy && query.groupBy.length > 0
        ? `GROUP BY ${query.groupBy.map(escapeIdentifier).join(', ')}`
        : ''

      // Build ORDER BY clause
      let orderByClause = ''
      if (query.orderBy && query.orderBy.length > 0) {
        const orderParts = query.orderBy.map(
          o => `${escapeIdentifier(o.field)} ${o.direction.toUpperCase()}`
        )
        orderByClause = `ORDER BY ${orderParts.join(', ')}`
      }

      const limit = query.filters?.limit ?? 1000
      const offset = query.filters?.offset ?? 0

      const sql = `
        SELECT ${selectParts.join(', ')}
        FROM ${fullTableName}
        ${whereClause}
        ${groupByClause}
        ${orderByClause}
        LIMIT ${limit}
        OFFSET ${offset}
      `

      const result = await client.query<AggregationResult>(sql)

      return {
        data: result.data,
        metadata: {
          totalRows: result.data.length,
          rowsRead: result.rowsRead,
          bytesRead: result.bytesRead,
          elapsed: result.elapsed
        }
      }
    },

    async timeSeries(
      metric: string,
      aggregation: AggregationFunction,
      options: AnalyticsQueryOptions
    ): Promise<TimeSeriesPoint[]> {
      const whereClause = buildWhereClause(options)
      const granularity = options.granularity || 'hour'
      const dateFunc = granularityToDateFunc(granularity)

      let aggExpr: string
      if (metric === '*' || metric === 'count') {
        aggExpr = 'count()'
      } else if (metric.startsWith('metrics.')) {
        const key = metric.replace('metrics.', '')
        aggExpr = `${aggregation}(JSONExtractFloat(metrics, ${escapeValue(key)}))`
      } else {
        aggExpr = `${aggregation}(${escapeIdentifier(metric)})`
      }

      const sql = `
        SELECT
          toUnixTimestamp(${dateFunc}(toDateTime(timestamp / 1000))) * 1000 AS ts,
          ${aggExpr} AS value
        FROM ${fullTableName}
        ${whereClause}
        GROUP BY ts
        ORDER BY ts ASC
        LIMIT ${options.limit ?? 10000}
      `

      const result = await client.query<{ ts: number; value: number }>(sql)

      return result.data.map(row => ({
        timestamp: row.ts,
        value: row.value
      }))
    },

    async count(options: AnalyticsQueryOptions = {}): Promise<number> {
      const whereClause = buildWhereClause(options)

      const sql = `
        SELECT count() AS cnt
        FROM ${fullTableName}
        ${whereClause}
      `

      const result = await client.query<{ cnt: number }>(sql)
      return result.data[0]?.cnt ?? 0
    },

    async countUnique(dimension: string, options: AnalyticsQueryOptions = {}): Promise<number> {
      const whereClause = buildWhereClause(options)

      let columnExpr: string
      if (dimension.startsWith('dimensions.')) {
        const key = dimension.replace('dimensions.', '')
        columnExpr = `JSONExtractString(dimensions, ${escapeValue(key)})`
      } else {
        columnExpr = escapeIdentifier(dimension)
      }

      const sql = `
        SELECT uniq(${columnExpr}) AS cnt
        FROM ${fullTableName}
        ${whereClause}
      `

      const result = await client.query<{ cnt: number }>(sql)
      return result.data[0]?.cnt ?? 0
    },

    async topN(
      dimension: string,
      n: number,
      options: AnalyticsQueryOptions = {}
    ): Promise<Array<{ value: string; count: number }>> {
      const whereClause = buildWhereClause(options)

      let columnExpr: string
      if (dimension.startsWith('dimensions.')) {
        const key = dimension.replace('dimensions.', '')
        columnExpr = `JSONExtractString(dimensions, ${escapeValue(key)})`
      } else {
        columnExpr = escapeIdentifier(dimension)
      }

      const sql = `
        SELECT
          ${columnExpr} AS value,
          count() AS count
        FROM ${fullTableName}
        ${whereClause}
        GROUP BY value
        ORDER BY count DESC
        LIMIT ${n}
      `

      const result = await client.query<{ value: string; count: number }>(sql)
      return result.data
    },

    async createTable(): Promise<void> {
      const orderByExpr = orderBy.map(escapeIdentifier).join(', ')
      const ttlExpr = ttl ? `TTL ${ttl}` : ''

      const sql = `
        CREATE TABLE IF NOT EXISTS ${fullTableName} (
          event_id String,
          event_type String,
          timestamp UInt64,
          tenant_id String DEFAULT '',
          user_id String DEFAULT '',
          session_id String DEFAULT '',
          payload String DEFAULT '{}',
          dimensions String DEFAULT '{}',
          metrics String DEFAULT '{}'
        )
        ENGINE = ${engine}
        PARTITION BY ${partitionBy}
        ORDER BY (${orderByExpr})
        ${ttlExpr}
      `

      await client.query(sql)
    },

    async close(): Promise<void> {
      // Flush any remaining events
      await flushBuffer()

      // Close the underlying client
      await client.close()
    }
  }
}

/**
 * Convert dotdo Event to AnalyticsEvent format
 */
export function eventToAnalyticsEvent<P extends JsonValue = JsonValue>(
  event: Event<P>,
  tenantId?: string
): AnalyticsEvent<P> {
  return {
    event_id: event.$id,
    event_type: event.type,
    timestamp: event.$timestamp,
    tenant_id: tenantId,
    user_id: typeof event.source === 'string' ? event.source : undefined,
    session_id: typeof event.correlationId === 'string' ? event.correlationId : undefined,
    payload: event.payload
  }
}

/**
 * Mock ClickHouse client for testing
 * Stores data in memory and supports basic SQL parsing
 */
export function createMockClickHouseClient(): ClickHouseClient & {
  getEvents(): AnalyticsEvent[]
  clear(): void
} {
  const events: AnalyticsEvent[] = []

  return {
    getEvents() {
      return [...events]
    },

    clear() {
      events.length = 0
    },

    async query<T = unknown>(sql: string): Promise<ClickHouseQueryResult<T>> {
      const startTime = Date.now()
      let data: T[] = []

      // Parse INSERT statements
      if (sql.trim().toUpperCase().startsWith('INSERT')) {
        // Extract values from INSERT statement
        const valuesMatch = sql.match(/VALUES\s*(.+)/is)
        if (valuesMatch) {
          const valuesStr = valuesMatch[1]
          // Parse each row (simplified parsing)
          const rowMatches = valuesStr.matchAll(/\(([^)]+)\)/g)
          for (const match of rowMatches) {
            const values = match[1].split(',').map(v => v.trim())
            // Create event from values
            const event: AnalyticsEvent = {
              event_id: values[0]?.replace(/'/g, '') || '',
              event_type: values[1]?.replace(/'/g, '') || '',
              timestamp: parseInt(values[2] || '0', 10),
              tenant_id: values[3]?.replace(/'/g, '') || undefined,
              user_id: values[4]?.replace(/'/g, '') || undefined,
              session_id: values[5]?.replace(/'/g, '') || undefined,
              payload: JSON.parse(values[6]?.replace(/'/g, '').replace(/''/g, "'") || '{}'),
              dimensions: JSON.parse(values[7]?.replace(/'/g, '').replace(/''/g, "'") || '{}'),
              metrics: JSON.parse(values[8]?.replace(/'/g, '').replace(/''/g, "'") || '{}')
            }
            events.push(event)
          }
        }
        return {
          data: [] as T[],
          rowsRead: 0,
          bytesRead: 0,
          elapsed: (Date.now() - startTime) / 1000
        }
      }

      // Parse SELECT statements (simplified)
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        // Check for count query
        if (sql.includes('count()')) {
          // Apply basic WHERE filters if present
          let filteredEvents = [...events]

          // Extract and apply basic filters
          const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+GROUP|\s+ORDER|\s+LIMIT|$)/is)
          if (whereMatch) {
            const whereClause = whereMatch[1]

            // Check for event_type filter
            const typeMatch = whereClause.match(/event_type\s+IN\s*\(([^)]+)\)/i)
            if (typeMatch) {
              const types = typeMatch[1].split(',').map(t => t.trim().replace(/'/g, ''))
              filteredEvents = filteredEvents.filter(e => types.includes(e.event_type))
            }

            // Check for tenant_id filter
            const tenantMatch = whereClause.match(/tenant_id\s*=\s*'([^']+)'/i)
            if (tenantMatch) {
              filteredEvents = filteredEvents.filter(e => e.tenant_id === tenantMatch[1])
            }

            // Check for timestamp filters
            const startMatch = whereClause.match(/timestamp\s*>=\s*(\d+)/i)
            if (startMatch) {
              const start = parseInt(startMatch[1], 10)
              filteredEvents = filteredEvents.filter(e => e.timestamp >= start)
            }

            const endMatch = whereClause.match(/timestamp\s*<\s*(\d+)/i)
            if (endMatch) {
              const end = parseInt(endMatch[1], 10)
              filteredEvents = filteredEvents.filter(e => e.timestamp < end)
            }
          }

          // Check for GROUP BY (time series)
          if (sql.includes('GROUP BY ts')) {
            // Time series query - group by timestamp
            const buckets = new Map<number, number>()
            for (const event of filteredEvents) {
              // Round to hour for simplicity
              const ts = Math.floor(event.timestamp / 3600000) * 3600000
              buckets.set(ts, (buckets.get(ts) || 0) + 1)
            }
            data = Array.from(buckets.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([ts, value]) => ({ ts, value } as unknown as T))
          } else if (sql.includes('GROUP BY value')) {
            // Top N query
            const counts = new Map<string, number>()
            // Determine which dimension to group by
            const dimMatch = sql.match(/JSONExtractString\(dimensions,\s*'([^']+)'\)/i)
            if (dimMatch) {
              const dim = dimMatch[1]
              for (const event of filteredEvents) {
                const value = (event.dimensions as Record<string, string>)?.[dim] || ''
                counts.set(value, (counts.get(value) || 0) + 1)
              }
            } else {
              // Group by a direct column
              const colMatch = sql.match(/`(\w+)`\s+AS\s+value/i)
              if (colMatch) {
                const col = colMatch[1] as keyof AnalyticsEvent
                for (const event of filteredEvents) {
                  const value = String(event[col] || '')
                  counts.set(value, (counts.get(value) || 0) + 1)
                }
              }
            }
            // Sort by count descending and apply limit
            const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
            const limit = limitMatch ? parseInt(limitMatch[1], 10) : 10
            data = Array.from(counts.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, limit)
              .map(([value, count]) => ({ value, count } as unknown as T))
          } else {
            // Simple count - extract alias if present
            const aliasMatch = sql.match(/count\(\)\s+AS\s+`?(\w+)`?/i)
            const alias = aliasMatch ? aliasMatch[1] : 'cnt'
            const result: Record<string, number> = {}
            result[alias] = filteredEvents.length
            data = [result as unknown as T]
          }
        } else if (sql.includes('uniq(')) {
          // Unique count query
          const uniqueValues = new Set<string>()
          const dimMatch = sql.match(/JSONExtractString\(dimensions,\s*'([^']+)'\)/i)
          if (dimMatch) {
            const dim = dimMatch[1]
            for (const event of events) {
              const value = (event.dimensions as Record<string, string>)?.[dim]
              if (value) uniqueValues.add(value)
            }
          } else {
            // Direct column
            const colMatch = sql.match(/uniq\(`(\w+)`\)/i)
            if (colMatch) {
              const col = colMatch[1] as keyof AnalyticsEvent
              for (const event of events) {
                const value = event[col]
                if (value !== undefined && value !== null) {
                  uniqueValues.add(String(value))
                }
              }
            }
          }
          data = [{ cnt: uniqueValues.size } as unknown as T]
        } else {
          // Return events directly
          let filteredEvents = [...events]

          // Apply basic filters
          const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/is)
          if (whereMatch) {
            const whereClause = whereMatch[1]

            const tenantMatch = whereClause.match(/tenant_id\s*=\s*'([^']+)'/i)
            if (tenantMatch) {
              filteredEvents = filteredEvents.filter(e => e.tenant_id === tenantMatch[1])
            }

            const typeMatch = whereClause.match(/event_type\s+IN\s*\(([^)]+)\)/i)
            if (typeMatch) {
              const types = typeMatch[1].split(',').map(t => t.trim().replace(/'/g, ''))
              filteredEvents = filteredEvents.filter(e => types.includes(e.event_type))
            }
          }

          // Sort by timestamp descending
          filteredEvents.sort((a, b) => b.timestamp - a.timestamp)

          // Apply limit
          const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
          const limit = limitMatch ? parseInt(limitMatch[1], 10) : 1000
          const offsetMatch = sql.match(/OFFSET\s+(\d+)/i)
          const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 0

          data = filteredEvents.slice(offset, offset + limit) as unknown as T[]
        }
      }

      // Handle CREATE TABLE
      if (sql.trim().toUpperCase().startsWith('CREATE')) {
        return {
          data: [] as T[],
          rowsRead: 0,
          bytesRead: 0,
          elapsed: (Date.now() - startTime) / 1000
        }
      }

      return {
        data,
        rowsRead: data.length,
        bytesRead: JSON.stringify(data).length,
        elapsed: (Date.now() - startTime) / 1000
      }
    },

    async queryRaw(sql: string): Promise<string> {
      const result = await this.query(sql)
      return JSON.stringify(result.data)
    },

    async close(): Promise<void> {
      // No-op for mock
    }
  }
}
