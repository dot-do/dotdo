/**
 * @dotdo/redis - Redis SDK compat
 *
 * Drop-in replacement for ioredis/node-redis backed by DO storage.
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
