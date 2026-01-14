/**
 * Redis Storage Backends
 *
 * This module provides different storage backends for the Redis compat layer:
 *
 * 1. PrimitiveStorage - Uses unified primitives (TemporalStore, KeyedRouter)
 *    - Time-travel queries via versioning
 *    - Distributed routing via consistent hashing
 *    - Snapshot/restore capabilities
 *
 * The default in-memory storage in redis.ts is suitable for single-node
 * deployments and testing. PrimitiveStorage provides additional features
 * for production distributed deployments.
 *
 * @module db/compat/cache/redis/storage
 */

export {
  PrimitiveStorage,
  createPrimitiveStorage,
  type PrimitiveStorageOptions,
  type RedisDataType,
  type ZSetEntry,
} from './primitive-storage'
