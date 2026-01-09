/**
 * Database core exports
 *
 * Shared infrastructure for DO-backed database adapters:
 * - Types: Config types for sharding, replication, tiering, vectors
 * - ShardRouter: DO-level sharding to handle 10GB limit
 * - ReplicaManager: Geo-distribution and replication
 * - TierManager: Hot/warm/cold data tiering
 * - VectorRouter: Tiered vector search routing
 *
 * Note: Stream infrastructure has been moved to streaming/core
 */

// Types
export type {
  // Placement
  Jurisdiction,
  Region,
  City,
  // Shard config
  ShardConfig,
  ShardAlgorithm,
  // Replica config
  ReplicaConfig,
  ReadPreference,
  // Tier config
  TierConfig,
  StorageTier,
  // Vector config
  VectorConfig,
  VectorEngineType,
  VectorTierConfig,
  VectorRoutingStrategy,
  VectorRoutingConfig,
  ClickHouseIndex,
  // Combined
  ExtendedConfig,
} from './types'

// Type validators
export {
  isValidJurisdiction,
  isValidRegion,
  isValidCity,
  isValidShardConfig,
  isValidReplicaConfig,
  isValidTierConfig,
  isValidVectorConfig,
} from './types'

// Constants
export {
  REGION_TO_COLO,
  JURISDICTION_REGIONS,
  DEFAULT_SHARD_CONFIG,
  DEFAULT_REPLICA_CONFIG,
  DEFAULT_TIER_CONFIG,
  DEFAULT_VECTOR_CONFIG,
} from './types'

// Shard router
export {
  ShardRouter,
  consistentHash,
  rangeHash,
  simpleHash,
  extractShardKey,
} from './shard'
export type { ShardQueryResult } from './shard'

// Replica manager
export {
  ReplicaManager,
  resolveColoFromRegion,
  getJurisdictionForRegion,
  isRegionInJurisdiction,
  createPlacementOptions,
} from './replica'
export type { PlacementOptions, WriteResult, ColoBindings } from './replica'

// Tier manager
export {
  TierManager,
  parseSize,
  parseDuration,
  formatSize,
  formatDuration,
} from './tier'
export type { HotStorage, ColdStorage, TierBindings } from './tier'

// Vector router
export {
  VectorRouter,
  createVectorEngine,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeVector,
} from './vector'
export type { VectorHit, SearchOptions, VectorEngine, VectorEntry } from './vector'
