/**
 * @dotdo/redis
 * Redis-compatible in-memory data store with ioredis-compatible API
 */

export { Redis } from './client'
export type { RedisOptions } from './client'

export { MemoryBackend } from './backends/memory'

export { StringCommands } from './commands/strings'
export { HashCommands } from './commands/hashes'
export { ListCommands } from './commands/lists'
export { SetCommands } from './commands/sets'
export { KeyCommands } from './commands/keys'

export type {
  RedisType,
  RedisValueType,
  StorageEntry,
  RedisBackend,
  SetOptions,
  ExpireOptions,
} from './types'
