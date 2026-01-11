/**
 * @dotdo/influxdb - InfluxDB v2 SDK compat
 *
 * Drop-in replacement for @influxdata/influxdb-client backed by unified primitives.
 */

// Types
export type {
  Bucket,
  Point,
  ParsedLine,
  WriteOptions,
  QueryOptions,
  FluxQuery,
  FluxFilter,
  FluxAggregation,
  QueryResult,
  FluxTable,
  FluxColumn,
  FluxRecord,
  DeletePredicate,
  Health,
  InfluxDBClientOptions,
  RetentionRule,
} from './types'

// Error classes
export { InfluxDBError, WriteError, QueryError } from './types'

// Client and APIs
export {
  InfluxDB,
  WriteApi,
  QueryApi,
  BucketsApi,
  DeleteApi,
  PointBuilder,
  createClient,
  Point,
  parseLineProtocol,
  toLineProtocol,
  parseFluxQuery,
  resolveRelativeTime,
} from './influxdb'
