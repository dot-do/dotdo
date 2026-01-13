/**
 * @dotdo/redis - Redis SDK compat
 *
 * Drop-in replacement for ioredis/node-redis backed by DO storage.
 *
 * This module provides two storage backends:
 * 1. In-memory (default) - Fast, simple, suitable for single-node deployments
 * 2. PrimitiveStorage - Uses unified primitives (TemporalStore, KeyedRouter)
 *    - Time-travel queries via versioning
 *    - Distributed routing via consistent hashing
 *    - Snapshot/restore capabilities
 */

// Types
export type {
  Redis as RedisInterface,
  RedisOptions,
  ExtendedRedisOptions,
  ClientStatus,
  RedisEvents,
  Pipeline as PipelineInterface,
  Multi as MultiInterface,
  SetOptions,
  ZAddOptions,
  ZRangeOptions,
  RedisKey,
  RedisValue,
  ScanResult,
} from './types'

// Error classes
export { RedisError, ReplyError, TransactionError } from './types'

// Client
export { Redis, createClient } from './redis'

// Primitive-backed storage (enhanced features)
export {
  PrimitiveStorage,
  createPrimitiveStorage,
  type PrimitiveStorageOptions,
  type RedisDataType,
  type ZSetEntry,
} from './storage'
