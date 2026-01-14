/**
 * Analytics Primitives
 *
 * OLAP-style analytics operations for multi-dimensional analysis:
 * - CUBE: All dimension combinations (power set)
 * - ROLLUP: Hierarchical subtotals
 * - Grouping sets: Custom dimension combinations
 * - Unified Analytics API: Fluent builder for all primitives
 * - EventBatcher: Event batching with dead-letter queue and replay
 * - Funnel Analysis: Define steps, calculate conversion between steps
 * - Cohort Analysis: Group users by signup date/first action
 * - Retention Analysis: Track user return rates over time
 *
 * @module db/primitives/analytics
 */

// ============================================================================
// Event Batching with Dead Letter Queue and Replay
// ============================================================================

export {
  // Factory function
  createEventBatcher,

  // Classes
  EventBatcher,

  // Types
  type BatchConfig,
  type BatchEvent,
  type FlushResult,
  type BatchStats,
  type DeadLetterEntry,
  type ReplayOptions,
  type ReplayResult,
  type DeadLetterStats,
} from './event-batcher'

export {
  // Grouping set generators
  cube,
  rollup,
  groupingSets,

  // Main aggregation functions
  aggregate,
  cubeAggregate,
  rollupAggregate,

  // Grouping ID utilities
  calculateGroupingId,
  calculateGroupingIndicators,
  calculateGroupingLevel,

  // Result helpers
  isSubtotal,
  isGrandTotal,
  getActiveDimensions,
  filterByGroupingLevel,
  filterByGroupingId,
  getDetailRows,
  getGrandTotalRow,

  // Types
  type AggregateFunction,
  type AggregateSpec,
  type GroupingSet,
  type CubeResultRow,
  type CubeOptions,
} from './cube'

// ============================================================================
// Unified Analytics API
// ============================================================================

export {
  // Factory function
  createAnalytics,

  // Classes
  Analytics,
  AnalyticsBuilder,

  // Predicate helpers
  eq,
  neq,
  gt,
  lt,
  gte,
  lte,
  between,
  inList,

  // Aggregate helpers
  sum,
  count,
  avg,
  min,
  max,
  countDistinct,
  approxPercentile,
  approxTopK,

  // Order helpers
  asc,
  desc,

  // Window helpers
  tumbling,
  sliding,

  // Types
  type AnalyticsConfig,
  type WindowSpec,
  type Predicate,
  type AggregateSpec as UnifiedAggregateSpec,
  type OrderSpec,
  type QueryPlan,
  type PlanOperation,
  type MaterializedAnalyticsTable,
  type MaterializeOptions,
} from './unified-analytics'

// ============================================================================
// Query Planner with Partition Pruning
// ============================================================================

export {
  // Factory function
  createQueryPlanner,

  // Types
  type QueryPlanner,
  type AnalyticsQuery,
  type TableStats,
  type PartitionStats,
  type ColumnStats as QueryPlannerColumnStats,
  type QueryPlan as FullQueryPlan,
  type PlanNode,
  type CostEstimate,
  type ExplainOptions,
  type QueryPlannerConfig,
  type BloomFilter,

  // Predicate helpers (re-exported with planner-specific types)
  eq as plannerEq,
  neq as plannerNeq,
  gt as plannerGt,
  lt as plannerLt,
  gte as plannerGte,
  lte as plannerLte,
  between as plannerBetween,
  inList as plannerInList,
} from './query-planner'

// ============================================================================
// Funnel and Cohort Analysis
// ============================================================================

export {
  // Funnel Analysis
  funnel,
  createFunnelAnalyzer,
  FunnelAnalyzer,
  FunnelBuilder,

  // Cohort Analysis
  cohort,
  createCohortAnalyzer,
  CohortAnalyzer,
  CohortBuilder,

  // Retention Analysis
  retention,
  createRetentionAnalyzer,
  RetentionAnalyzer,
  RetentionBuilder,

  // Filter helpers (funnel/cohort specific)
  eq as funnelEq,
  neq as funnelNeq,
  gt as funnelGt,
  lt as funnelLt,
  gte as funnelGte,
  lte as funnelLte,
  inList as funnelInList,
  contains,
  exists,

  // Types - Funnel
  type FilterOp,
  type StepFilter,
  type FunnelStep,
  type FunnelConfig,
  type FunnelStepResult,
  type FunnelResult,

  // Types - Cohort
  type CohortGranularity,
  type CohortConfig,
  type CohortData,
  type CohortRetention,
  type CohortResult,

  // Types - Retention
  type RetentionConfig,
  type RetentionResult,
  type RetentionPeriodResult,

  // Types - Events
  type AnalyticsEvent,
} from './funnel-cohort'

// ============================================================================
// Process Mining
// ============================================================================

export {
  // Process Discovery
  ProcessDiscovery,
  createProcessDiscovery,

  // Bottleneck Analysis
  BottleneckAnalyzer,
  createBottleneckAnalyzer,

  // Compliance Checking
  ComplianceChecker,
  createComplianceChecker,

  // Performance Analysis
  PerformanceAnalyzer,
  createPerformanceAnalyzer,

  // Fluent Builder
  ProcessMiningBuilder,
  processMining,

  // Rule Builders
  sequenceRule,
  existenceRule,
  absenceRule,
  timingRule,
  resourceRule,

  // Types - Process Events
  type ProcessEvent,
  type ProcessCase,

  // Types - Process Model
  type ProcessTransition,
  type ProcessActivity,
  type ProcessModel,

  // Types - Variants
  type ProcessVariant,

  // Types - Bottleneck Analysis
  type BottleneckType,
  type Bottleneck,
  type BottleneckAnalysisResult,

  // Types - Compliance
  type ComplianceRule,
  type ComplianceRuleDefinition,
  type SequenceRule,
  type ExistenceRule,
  type AbsenceRule,
  type TimingRule,
  type ResourceRule,
  type ComplianceViolation,
  type ComplianceResult,

  // Types - Performance
  type ProcessPerformanceMetrics,
  type ActivityMetrics,
  type TimeSeriesMetrics,
} from './process-mining'
