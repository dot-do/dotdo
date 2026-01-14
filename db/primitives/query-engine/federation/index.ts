/**
 * Query Federation Module
 *
 * Provides query federation capabilities including predicate pushdown,
 * cross-source optimization, and distributed query execution.
 *
 * @see dotdo-43oni
 */

export {
  PredicatePushdown,
  type PushdownRule,
  type DataSourceCapabilities,
  type PredicateAnalysis,
  type SplitResult,
  type PushdownResult,
} from './pushdown'

export {
  // Types
  type SourceCapabilities,
  type PartialCapabilities,
  type CapabilityQuery,
  type ProbeableSource,
  type IsolationLevel,
  // Class
  CapabilityDetector,
  // Factory
  createCapabilities,
  // Preset capabilities
  DEFAULT_CAPABILITIES,
  SQLITE_CAPABILITIES,
  POSTGRES_CAPABILITIES,
  MONGODB_CAPABILITIES,
  ELASTICSEARCH_CAPABILITIES,
  REDIS_CAPABILITIES,
  // Helper functions
  canPushFilter,
  canPushProjection,
  canPushAggregation,
  canPushJoin,
  canExecuteQuery,
} from './capabilities'

export {
  // Types
  type ScanPartition,
  type PartitionStrategy,
  type TableMetadata,
  type ColumnStats,
  type PartitionOptions,
  type ScanPlan,
  type ScanPlanOptions,
  type PartitionResult,
  type MergeOptions,
  type MergedResult,
  type PartitionEstimate,
  type EstimateOptions,
  type PartitionFilter,
  type OrderSpec,
  type MergeStats,
  // Class
  ParallelScanCoordinator,
} from './parallel-scan'
