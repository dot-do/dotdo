/**
 * @dotdo/influxdb - InfluxDB v2 SDK compat
 *
 * Drop-in replacement for @influxdata/influxdb-client backed by unified primitives.
 *
 * Uses:
 * - TypedColumnStore with Gorilla compression for efficient float storage
 * - TagIndex (InvertedIndex) for fast tag-based series lookup
 * - WindowManager for continuous queries and downsampling
 * - TemporalStore for retention policies and time-based queries
 */

// Types
export type {
  Bucket,
  Point as PointData,
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

// ============================================================================
// Enhanced Primitives-Based Components
// ============================================================================

// Storage - Columnar storage with Gorilla compression
export { TimeSeriesStorage, type StoredPoint, type CompressionStats } from './storage'

// Tags - InvertedIndex-based tag lookup
export { SeriesTagIndex } from './tags'

// Downsampling - WindowManager-based continuous queries
export {
  ContinuousQuery,
  DownsampleManager,
  type AggregationFunction,
  type ContinuousQueryConfig,
  type DownsampleConfig,
} from './downsampling'

// Retention - TemporalStore-based retention policies
export {
  RetentionManager,
  ShardManager,
  type RetentionPolicyConfig,
  type NamedRetentionPolicy,
  type RetentionStats,
  type ShardInfo,
  type ShardStats,
  type BucketStats,
} from './retention'
