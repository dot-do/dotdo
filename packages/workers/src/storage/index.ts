/**
 * @dotdo/workers/storage - Unified storage utilities
 *
 * Cost-optimized storage with Pipeline-as-WAL:
 * - Fast in-memory reads/writes
 * - Durable via Pipeline (WAL)
 * - Batched SQLite checkpoints
 *
 * @module @dotdo/workers/storage
 */

export {
  createUnifiedStore,
  type ThingData,
  type StorageTier,
  type UnifiedStoreConfig,
  type UnifiedStoreStats,
} from './unified'
