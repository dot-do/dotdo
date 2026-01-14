/**
 * Materialized View Primitives
 *
 * This module provides materialized view capabilities including:
 * - Temporal materialized views with AS OF queries
 * - Point-in-time state recovery
 * - Retention policies and compaction
 *
 * @module db/primitives/materialized-view
 */

// Temporal Materialized View
export {
  createTemporalMaterializedView,
  type TemporalMaterializedView,
  type TemporalMaterializedViewConfig,
  type ViewSnapshot,
  type ViewSnapshotInfo,
  type RetentionPolicy,
  type TemporalViewStats,
  type CompactStats,
  type TimestampInput,
} from './temporal-materialized-view'
