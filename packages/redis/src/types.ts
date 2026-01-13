/**
 * @dotdo/redis Types
 */

export type RedisType = 'string' | 'hash' | 'list' | 'set' | 'zset'

export type RedisValueType =
  | string
  | string[]
  | Record<string, string>
  | Array<{ member: string; score: number }>

export interface StorageEntry {
  key: string
  type: RedisType
  value: RedisValueType
  expires_at: number | null
  created_at: number
  updated_at: number
}

export interface RedisBackend {
  get(key: string): Promise<StorageEntry | null>
  set(key: string, type: RedisType, value: RedisValueType, expiresAt?: number): Promise<void>
  delete(key: string): Promise<boolean>
  setExpiry(key: string, expiresAt: number | undefined): Promise<boolean>
  keys(): Promise<string[]>
  clear(): Promise<void>
}

export interface SetOptions {
  ex?: number    // Expire time in seconds
  px?: number    // Expire time in milliseconds
  nx?: boolean   // Only set if not exists
  xx?: boolean   // Only set if exists
  get?: boolean  // Return old value
}

export interface ExpireOptions {
  nx?: boolean   // Set expiry only when key has no expiry
  xx?: boolean   // Set expiry only when key has an existing expiry
  gt?: boolean   // Set expiry only when new expiry > current expiry
  lt?: boolean   // Set expiry only when new expiry < current expiry
}
