/**
 * TimeSeriesStore
 *
 * Time-indexed storage with retention, compaction, and range queries.
 *
 * @see README.md for full API documentation
 * @module db/timeseries
 */

export { TimeSeriesStore } from './store'
export type {
  DataPoint,
  AggregateResult,
  TimeSeriesOptions,
  RangeQuery,
  AggregateQuery,
  RollupOptions,
  ArchiveOptions,
  CompactOptions,
  CDCEvent,
  RetentionConfig,
} from './types'

// Retention utilities
export {
  parseDuration,
  getRetentionMs,
  getTierForTimestamp,
  getCutoffTimestamp,
  isWithinRetention,
} from './retention'

// Rollup utilities
export {
  parseBucketSize,
  getBucketKey,
  calculateAggregates,
  percentile,
  groupByBucket,
  mergeAggregates,
} from './rollup'
