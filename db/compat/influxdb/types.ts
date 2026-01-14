/**
 * @dotdo/influxdb - InfluxDB v2 types
 *
 * Type definitions for InfluxDB v2 API compatibility layer.
 */

/**
 * Bucket configuration
 */
export interface Bucket {
  id: string
  name: string
  orgID: string
  retentionRules: RetentionRule[]
  createdAt: string
  updatedAt: string
}

export interface RetentionRule {
  type: 'expire'
  everySeconds: number
  shardGroupDurationSeconds?: number
}

/**
 * Organization
 */
export interface Organization {
  id: string
  name: string
}

/**
 * Point represents a single data point in InfluxDB
 */
export interface Point {
  measurement: string
  tags: Record<string, string>
  fields: Record<string, number | string | boolean>
  timestamp: number
}

/**
 * Line protocol parsing result
 */
export interface ParsedLine {
  measurement: string
  tags: Record<string, string>
  fields: Record<string, number | string | boolean>
  timestamp?: number
}

/**
 * Write options
 */
export interface WriteOptions {
  precision?: 'ns' | 'us' | 'ms' | 's'
  org?: string
  bucket: string
}

/**
 * Query options
 */
export interface QueryOptions {
  org?: string
}

/**
 * Flux query AST node (simplified)
 */
export interface FluxQuery {
  bucket: string
  range?: {
    start: string | number
    stop?: string | number
  }
  filters?: FluxFilter[]
  aggregations?: FluxAggregation[]
  window?: {
    every: string
  }
  limit?: number
}

export interface FluxFilter {
  column: string
  operator: '==' | '!=' | '>' | '<' | '>=' | '<='
  value: string | number | boolean
}

export interface FluxAggregation {
  fn: 'mean' | 'sum' | 'count' | 'min' | 'max' | 'first' | 'last' | 'median' | 'stddev'
  columns?: string[]
}

/**
 * Query result
 */
export interface QueryResult {
  tables: FluxTable[]
}

export interface FluxTable {
  records: FluxRecord[]
  columns: FluxColumn[]
}

export interface FluxColumn {
  label: string
  dataType: 'string' | 'long' | 'double' | 'boolean' | 'dateTime:RFC3339'
  group: boolean
  defaultValue?: string
}

export interface FluxRecord {
  values: Record<string, unknown>
  tableMeta: FluxTable
}

/**
 * Delete predicate
 */
export interface DeletePredicate {
  start: string
  stop: string
  predicate?: string
}

/**
 * Health check result
 */
export interface Health {
  name: string
  message?: string
  status: 'pass' | 'fail'
  version?: string
  commit?: string
}

/**
 * InfluxDB client options
 */
export interface InfluxDBClientOptions {
  url?: string
  token?: string
  org?: string
}

/**
 * Error types
 */
export class InfluxDBError extends Error {
  public statusCode: number
  public code: string

  constructor(message: string, statusCode: number = 500, code: string = 'internal error') {
    super(message)
    this.name = 'InfluxDBError'
    this.statusCode = statusCode
    this.code = code
  }
}

export class WriteError extends InfluxDBError {
  constructor(message: string) {
    super(message, 400, 'invalid')
    this.name = 'WriteError'
  }
}

export class QueryError extends InfluxDBError {
  constructor(message: string) {
    super(message, 400, 'invalid')
    this.name = 'QueryError'
  }
}
