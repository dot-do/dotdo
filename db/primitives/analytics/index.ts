/**
 * Analytics Primitives
 *
 * OLAP-style analytics operations for multi-dimensional analysis:
 * - CUBE: All dimension combinations (power set)
 * - ROLLUP: Hierarchical subtotals
 * - Grouping sets: Custom dimension combinations
 * - Unified Analytics API: Fluent builder for all primitives
 *
 * @module db/primitives/analytics
 */

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
