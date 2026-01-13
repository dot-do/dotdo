/**
 * Analytics Primitives
 *
 * OLAP-style analytics operations for multi-dimensional analysis:
 * - CUBE: All dimension combinations (power set)
 * - ROLLUP: Hierarchical subtotals
 * - Grouping sets: Custom dimension combinations
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
