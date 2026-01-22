/**
 * @dotdo/analytics
 *
 * Database-agnostic analytics abstraction layer with pluggable adapters
 * for different backends (ClickHouse, BigQuery, Postgres, etc.)
 */

// Core types
export type {
  // Event types
  AnalyticsEvent,
  AnalyticsEventInput,
  // Query types
  AnalyticsQuery,
  QueryCondition,
  QueryOperator,
  OrderByClause,
  QueryResult,
  QueryMetadata,
  ColumnInfo,
  // Metric types
  MetricValue,
  MetricOptions,
  MetricInterval,
  MetricAggregation,
  // Client and adapter interfaces
  AnalyticsClient,
  AnalyticsAdapter,
  // Configuration
  AnalyticsConfig,
} from './types'

// Error classes
export {
  AnalyticsError,
  AnalyticsQueryError,
  AnalyticsConnectionError,
  AnalyticsConfigError,
} from './types'
