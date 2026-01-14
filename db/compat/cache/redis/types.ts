/**
 * @dotdo/redis types
 *
 * ioredis/redis compatible type definitions
 * for the Redis SDK backed by Durable Objects
 *
 * @see https://github.com/redis/ioredis
 * @see https://github.com/redis/node-redis
 */

// ============================================================================
// VALUE TYPES
// ============================================================================

/**
 * Redis value types (strings in Redis protocol)
 */
export type RedisValue = string | number | Buffer

/**
 * Redis key type
 */
export type RedisKey = string | Buffer

/**
 * Command argument types
 */
export type CommandArg = RedisKey | RedisValue | null | undefined

/**
 * Multi-bulk reply (array of values)
 */
export type MultiBulkReply = (string | null)[] | null

/**
 * Result of SET with GET option
 */
export type SetResult = 'OK' | null

/**
 * Result of commands that return integers
 */
export type IntegerResult = number

/**
 * Scan result tuple [cursor, keys]
 */
export type ScanResult = [string, string[]]

// ============================================================================
// SET OPTIONS
// ============================================================================

/**
 * SET command options
 */
export interface SetOptions {
  /** Set expiry in seconds */
  EX?: number
  /** Set expiry in milliseconds */
  PX?: number
  /** Set expiry as Unix timestamp in seconds */
  EXAT?: number
  /** Set expiry as Unix timestamp in milliseconds */
  PXAT?: number
  /** Keep existing TTL */
  KEEPTTL?: boolean
  /** Only set if key doesn't exist */
  NX?: boolean
  /** Only set if key exists */
  XX?: boolean
  /** Return old value */
  GET?: boolean
}

/**
 * ZADD command options
 */
export interface ZAddOptions {
  /** Only update existing elements, don't add new ones */
  XX?: boolean
  /** Only add new elements, don't update existing ones */
  NX?: boolean
  /** Only update elements where new score > current score */
  GT?: boolean
  /** Only update elements where new score < current score */
  LT?: boolean
  /** Return number of elements changed (not just added) */
  CH?: boolean
  /** Return new score of the updated element */
  INCR?: boolean
}

/**
 * ZRANGE options
 */
export interface ZRangeOptions {
  /** Return scores with values */
  WITHSCORES?: boolean
  /** Range by score */
  BYSCORE?: boolean
  /** Range by lex */
  BYLEX?: boolean
  /** Reverse order */
  REV?: boolean
  /** Limit offset and count */
  LIMIT?: { offset: number; count: number }
}

// ============================================================================
// CLIENT OPTIONS
// ============================================================================

/**
 * Redis connection options (ioredis-compatible)
 */
export interface RedisOptions {
  /** Redis host */
  host?: string
  /** Redis port */
  port?: number
  /** Redis password */
  password?: string
  /** Database number */
  db?: number
  /** Redis username (ACL) */
  username?: string
  /** Connection name */
  name?: string
  /** Enable TLS */
  tls?: boolean | object
  /** Key prefix for all commands */
  keyPrefix?: string
  /** Connection timeout in ms */
  connectTimeout?: number
  /** Command timeout in ms */
  commandTimeout?: number
  /** Enable auto-reconnect */
  lazyConnect?: boolean
  /** Max reconnect retries */
  maxRetriesPerRequest?: number | null
  /** Enable offline queue */
  enableOfflineQueue?: boolean
  /** Enable ready check */
  enableReadyCheck?: boolean
  /** Retry strategy */
  retryStrategy?: (times: number) => number | void | null
  /** Connection string/URL */
  url?: string
}

/**
 * Extended options for DO-backed implementation
 */
export interface ExtendedRedisOptions extends RedisOptions {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Shard configuration */
  shard?: {
    /** Sharding algorithm */
    algorithm?: 'consistent' | 'range' | 'hash'
    /** Number of shards */
    count?: number
    /** Shard key pattern for routing */
    keyPattern?: string
  }
  /** Replica configuration */
  replica?: {
    /** Read preference */
    readPreference?: 'primary' | 'secondary' | 'nearest'
    /** Write-through to all replicas */
    writeThrough?: boolean
    /** Jurisdiction constraint */
    jurisdiction?: 'eu' | 'us' | 'fedramp'
  }
  /** Storage backend preference */
  storage?: {
    /** Use KV for simple types (string, counter) */
    preferKV?: boolean
    /** Use SQLite for complex types (hash, list, set, zset) */
    preferSQLite?: boolean
  }
}

// ============================================================================
// CLIENT STATUS
// ============================================================================

/**
 * Connection status
 */
export type ClientStatus =
  | 'connecting'
  | 'connect'
  | 'ready'
  | 'close'
  | 'reconnecting'
  | 'end'
  | 'wait'

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Redis client events
 */
export interface RedisEvents {
  connect: () => void
  ready: () => void
  error: (error: Error) => void
  close: () => void
  reconnecting: () => void
  end: () => void
  wait: () => void
  message: (channel: string, message: string) => void
  pmessage: (pattern: string, channel: string, message: string) => void
  messageBuffer: (channel: Buffer, message: Buffer) => void
  pmessageBuffer: (pattern: Buffer, channel: Buffer, message: Buffer) => void
  subscribe: (channel: string, count: number) => void
  unsubscribe: (channel: string, count: number) => void
  psubscribe: (pattern: string, count: number) => void
  punsubscribe: (pattern: string, count: number) => void
}

// ============================================================================
// PIPELINE INTERFACE
// ============================================================================

/**
 * Pipeline (batch commands without transaction)
 */
export interface Pipeline {
  // String commands
  get(key: RedisKey): Pipeline
  set(key: RedisKey, value: RedisValue, options?: SetOptions): Pipeline
  mget(...keys: RedisKey[]): Pipeline
  mset(...keyValues: (RedisKey | RedisValue)[]): Pipeline
  incr(key: RedisKey): Pipeline
  decr(key: RedisKey): Pipeline
  incrby(key: RedisKey, increment: number): Pipeline
  decrby(key: RedisKey, decrement: number): Pipeline
  incrbyfloat(key: RedisKey, increment: number): Pipeline
  append(key: RedisKey, value: RedisValue): Pipeline
  strlen(key: RedisKey): Pipeline
  getrange(key: RedisKey, start: number, end: number): Pipeline
  setrange(key: RedisKey, offset: number, value: RedisValue): Pipeline
  setnx(key: RedisKey, value: RedisValue): Pipeline
  setex(key: RedisKey, seconds: number, value: RedisValue): Pipeline
  psetex(key: RedisKey, milliseconds: number, value: RedisValue): Pipeline
  getset(key: RedisKey, value: RedisValue): Pipeline
  getdel(key: RedisKey): Pipeline

  // Hash commands
  hget(key: RedisKey, field: string): Pipeline
  hset(key: RedisKey, field: string, value: RedisValue): Pipeline
  hset(key: RedisKey, fieldValues: Record<string, RedisValue>): Pipeline
  hmget(key: RedisKey, ...fields: string[]): Pipeline
  hmset(key: RedisKey, fieldValues: Record<string, RedisValue>): Pipeline
  hgetall(key: RedisKey): Pipeline
  hdel(key: RedisKey, ...fields: string[]): Pipeline
  hexists(key: RedisKey, field: string): Pipeline
  hkeys(key: RedisKey): Pipeline
  hvals(key: RedisKey): Pipeline
  hlen(key: RedisKey): Pipeline
  hincrby(key: RedisKey, field: string, increment: number): Pipeline
  hincrbyfloat(key: RedisKey, field: string, increment: number): Pipeline
  hsetnx(key: RedisKey, field: string, value: RedisValue): Pipeline

  // List commands
  lpush(key: RedisKey, ...values: RedisValue[]): Pipeline
  rpush(key: RedisKey, ...values: RedisValue[]): Pipeline
  lpop(key: RedisKey, count?: number): Pipeline
  rpop(key: RedisKey, count?: number): Pipeline
  lrange(key: RedisKey, start: number, stop: number): Pipeline
  llen(key: RedisKey): Pipeline
  lindex(key: RedisKey, index: number): Pipeline
  lset(key: RedisKey, index: number, value: RedisValue): Pipeline
  lrem(key: RedisKey, count: number, value: RedisValue): Pipeline
  ltrim(key: RedisKey, start: number, stop: number): Pipeline
  linsert(key: RedisKey, position: 'BEFORE' | 'AFTER', pivot: RedisValue, value: RedisValue): Pipeline
  lpos(key: RedisKey, value: RedisValue): Pipeline

  // Set commands
  sadd(key: RedisKey, ...members: RedisValue[]): Pipeline
  srem(key: RedisKey, ...members: RedisValue[]): Pipeline
  smembers(key: RedisKey): Pipeline
  sismember(key: RedisKey, member: RedisValue): Pipeline
  smismember(key: RedisKey, ...members: RedisValue[]): Pipeline
  scard(key: RedisKey): Pipeline
  sinter(...keys: RedisKey[]): Pipeline
  sunion(...keys: RedisKey[]): Pipeline
  sdiff(...keys: RedisKey[]): Pipeline
  sinterstore(destination: RedisKey, ...keys: RedisKey[]): Pipeline
  sunionstore(destination: RedisKey, ...keys: RedisKey[]): Pipeline
  sdiffstore(destination: RedisKey, ...keys: RedisKey[]): Pipeline
  srandmember(key: RedisKey, count?: number): Pipeline
  spop(key: RedisKey, count?: number): Pipeline
  smove(source: RedisKey, destination: RedisKey, member: RedisValue): Pipeline

  // Sorted set commands
  zadd(key: RedisKey, ...scoreMembers: (number | RedisValue)[]): Pipeline
  zadd(key: RedisKey, options: ZAddOptions, ...scoreMembers: (number | RedisValue)[]): Pipeline
  zrem(key: RedisKey, ...members: RedisValue[]): Pipeline
  zrange(key: RedisKey, start: number | string, stop: number | string, options?: ZRangeOptions): Pipeline
  zrevrange(key: RedisKey, start: number, stop: number, withScores?: 'WITHSCORES'): Pipeline
  zscore(key: RedisKey, member: RedisValue): Pipeline
  zrank(key: RedisKey, member: RedisValue): Pipeline
  zrevrank(key: RedisKey, member: RedisValue): Pipeline
  zcard(key: RedisKey): Pipeline
  zcount(key: RedisKey, min: number | string, max: number | string): Pipeline
  zincrby(key: RedisKey, increment: number, member: RedisValue): Pipeline
  zrangebyscore(key: RedisKey, min: number | string, max: number | string, options?: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } }): Pipeline
  zrevrangebyscore(key: RedisKey, max: number | string, min: number | string, options?: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } }): Pipeline
  zlexcount(key: RedisKey, min: string, max: string): Pipeline
  zpopmin(key: RedisKey, count?: number): Pipeline
  zpopmax(key: RedisKey, count?: number): Pipeline

  // Key commands
  del(...keys: RedisKey[]): Pipeline
  exists(...keys: RedisKey[]): Pipeline
  expire(key: RedisKey, seconds: number): Pipeline
  expireat(key: RedisKey, timestamp: number): Pipeline
  pexpire(key: RedisKey, milliseconds: number): Pipeline
  pexpireat(key: RedisKey, timestamp: number): Pipeline
  ttl(key: RedisKey): Pipeline
  pttl(key: RedisKey): Pipeline
  persist(key: RedisKey): Pipeline
  keys(pattern: string): Pipeline
  type(key: RedisKey): Pipeline
  rename(key: RedisKey, newKey: RedisKey): Pipeline
  renamenx(key: RedisKey, newKey: RedisKey): Pipeline
  randomkey(): Pipeline
  scan(cursor: string | number, options?: { MATCH?: string; COUNT?: number; TYPE?: string }): Pipeline
  unlink(...keys: RedisKey[]): Pipeline
  copy(source: RedisKey, destination: RedisKey, options?: { REPLACE?: boolean }): Pipeline

  // Pub/Sub commands
  publish(channel: string, message: string): Pipeline

  // Server commands
  ping(message?: string): Pipeline
  echo(message: string): Pipeline
  dbsize(): Pipeline
  flushdb(mode?: 'ASYNC' | 'SYNC'): Pipeline
  flushall(mode?: 'ASYNC' | 'SYNC'): Pipeline
  time(): Pipeline
  info(section?: string): Pipeline

  // Execute pipeline
  exec(): Promise<[Error | null, unknown][] | null>
}

// ============================================================================
// MULTI (TRANSACTION) INTERFACE
// ============================================================================

/**
 * Multi (transaction with WATCH/MULTI/EXEC)
 */
export interface Multi extends Pipeline {
  /** Execute the transaction */
  exec(): Promise<[Error | null, unknown][] | null>
  /** Discard the transaction */
  discard(): Promise<'OK'>
}

// ============================================================================
// SUBSCRIBER INTERFACE
// ============================================================================

/**
 * Subscriber client (Pub/Sub mode)
 */
export interface Subscriber {
  /** Subscribe to channels */
  subscribe(...channels: string[]): Promise<void>
  /** Unsubscribe from channels */
  unsubscribe(...channels: string[]): Promise<void>
  /** Subscribe to patterns */
  psubscribe(...patterns: string[]): Promise<void>
  /** Unsubscribe from patterns */
  punsubscribe(...patterns: string[]): Promise<void>
  /** Event handler */
  on<E extends keyof RedisEvents>(event: E, listener: RedisEvents[E]): this
  /** Remove event handler */
  off<E extends keyof RedisEvents>(event: E, listener: RedisEvents[E]): this
  /** Disconnect subscriber */
  quit(): Promise<'OK'>
  /** Disconnect subscriber immediately */
  disconnect(): void
}

// ============================================================================
// REDIS CLIENT INTERFACE
// ============================================================================

/**
 * Redis client interface (ioredis-compatible)
 */
export interface Redis {
  // Connection status
  readonly status: ClientStatus
  readonly options: RedisOptions

  // ============================================================================
  // STRING COMMANDS
  // ============================================================================

  /**
   * Get the value of a key
   */
  get(key: RedisKey): Promise<string | null>

  /**
   * Set the value of a key
   */
  set(key: RedisKey, value: RedisValue, options?: SetOptions): Promise<string | null>
  set(key: RedisKey, value: RedisValue, secondsToken: 'EX', seconds: number): Promise<string | null>
  set(key: RedisKey, value: RedisValue, millisecondsToken: 'PX', milliseconds: number): Promise<string | null>
  set(key: RedisKey, value: RedisValue, nxToken: 'NX'): Promise<string | null>
  set(key: RedisKey, value: RedisValue, xxToken: 'XX'): Promise<string | null>

  /**
   * Get multiple keys
   */
  mget(...keys: RedisKey[]): Promise<(string | null)[]>

  /**
   * Set multiple keys
   */
  mset(...keyValues: (RedisKey | RedisValue)[]): Promise<'OK'>
  mset(obj: Record<string, RedisValue>): Promise<'OK'>

  /**
   * Increment a key
   */
  incr(key: RedisKey): Promise<number>

  /**
   * Decrement a key
   */
  decr(key: RedisKey): Promise<number>

  /**
   * Increment by amount
   */
  incrby(key: RedisKey, increment: number): Promise<number>

  /**
   * Decrement by amount
   */
  decrby(key: RedisKey, decrement: number): Promise<number>

  /**
   * Increment by float amount
   */
  incrbyfloat(key: RedisKey, increment: number): Promise<string>

  /**
   * Append to a string
   */
  append(key: RedisKey, value: RedisValue): Promise<number>

  /**
   * Get string length
   */
  strlen(key: RedisKey): Promise<number>

  /**
   * Get substring
   */
  getrange(key: RedisKey, start: number, end: number): Promise<string>

  /**
   * Set substring
   */
  setrange(key: RedisKey, offset: number, value: RedisValue): Promise<number>

  /**
   * Set if not exists
   */
  setnx(key: RedisKey, value: RedisValue): Promise<number>

  /**
   * Set with expiry (seconds)
   */
  setex(key: RedisKey, seconds: number, value: RedisValue): Promise<'OK'>

  /**
   * Set with expiry (milliseconds)
   */
  psetex(key: RedisKey, milliseconds: number, value: RedisValue): Promise<'OK'>

  /**
   * Set and return old value
   */
  getset(key: RedisKey, value: RedisValue): Promise<string | null>

  /**
   * Get and delete
   */
  getdel(key: RedisKey): Promise<string | null>

  // ============================================================================
  // HASH COMMANDS
  // ============================================================================

  /**
   * Get hash field value
   */
  hget(key: RedisKey, field: string): Promise<string | null>

  /**
   * Set hash field(s)
   */
  hset(key: RedisKey, field: string, value: RedisValue): Promise<number>
  hset(key: RedisKey, fieldValues: Record<string, RedisValue>): Promise<number>

  /**
   * Get multiple hash fields
   */
  hmget(key: RedisKey, ...fields: string[]): Promise<(string | null)[]>

  /**
   * Set multiple hash fields
   */
  hmset(key: RedisKey, fieldValues: Record<string, RedisValue>): Promise<'OK'>
  hmset(key: RedisKey, field: string, value: RedisValue, ...rest: (string | RedisValue)[]): Promise<'OK'>

  /**
   * Get all hash fields and values
   */
  hgetall(key: RedisKey): Promise<Record<string, string>>

  /**
   * Delete hash fields
   */
  hdel(key: RedisKey, ...fields: string[]): Promise<number>

  /**
   * Check if hash field exists
   */
  hexists(key: RedisKey, field: string): Promise<number>

  /**
   * Get all hash field names
   */
  hkeys(key: RedisKey): Promise<string[]>

  /**
   * Get all hash values
   */
  hvals(key: RedisKey): Promise<string[]>

  /**
   * Get hash length
   */
  hlen(key: RedisKey): Promise<number>

  /**
   * Increment hash field by integer
   */
  hincrby(key: RedisKey, field: string, increment: number): Promise<number>

  /**
   * Increment hash field by float
   */
  hincrbyfloat(key: RedisKey, field: string, increment: number): Promise<string>

  /**
   * Set hash field if not exists
   */
  hsetnx(key: RedisKey, field: string, value: RedisValue): Promise<number>

  // ============================================================================
  // LIST COMMANDS
  // ============================================================================

  /**
   * Push to head of list
   */
  lpush(key: RedisKey, ...values: RedisValue[]): Promise<number>

  /**
   * Push to tail of list
   */
  rpush(key: RedisKey, ...values: RedisValue[]): Promise<number>

  /**
   * Pop from head of list
   */
  lpop(key: RedisKey): Promise<string | null>
  lpop(key: RedisKey, count: number): Promise<string | string[] | null>

  /**
   * Pop from tail of list
   */
  rpop(key: RedisKey): Promise<string | null>
  rpop(key: RedisKey, count: number): Promise<string | string[] | null>

  /**
   * Get range of list elements
   */
  lrange(key: RedisKey, start: number, stop: number): Promise<string[]>

  /**
   * Get list length
   */
  llen(key: RedisKey): Promise<number>

  /**
   * Get element at index
   */
  lindex(key: RedisKey, index: number): Promise<string | null>

  /**
   * Set element at index
   */
  lset(key: RedisKey, index: number, value: RedisValue): Promise<'OK'>

  /**
   * Remove elements by value
   */
  lrem(key: RedisKey, count: number, value: RedisValue): Promise<number>

  /**
   * Trim list to range
   */
  ltrim(key: RedisKey, start: number, stop: number): Promise<'OK'>

  /**
   * Insert element before/after pivot
   */
  linsert(key: RedisKey, position: 'BEFORE' | 'AFTER', pivot: RedisValue, value: RedisValue): Promise<number>

  /**
   * Find index of element
   */
  lpos(key: RedisKey, value: RedisValue): Promise<number | null>

  // ============================================================================
  // SET COMMANDS
  // ============================================================================

  /**
   * Add members to set
   */
  sadd(key: RedisKey, ...members: RedisValue[]): Promise<number>

  /**
   * Remove members from set
   */
  srem(key: RedisKey, ...members: RedisValue[]): Promise<number>

  /**
   * Get all members
   */
  smembers(key: RedisKey): Promise<string[]>

  /**
   * Check if member exists
   */
  sismember(key: RedisKey, member: RedisValue): Promise<number>

  /**
   * Check if multiple members exist
   */
  smismember(key: RedisKey, ...members: RedisValue[]): Promise<number[]>

  /**
   * Get set size
   */
  scard(key: RedisKey): Promise<number>

  /**
   * Intersection of sets
   */
  sinter(...keys: RedisKey[]): Promise<string[]>

  /**
   * Union of sets
   */
  sunion(...keys: RedisKey[]): Promise<string[]>

  /**
   * Difference of sets
   */
  sdiff(...keys: RedisKey[]): Promise<string[]>

  /**
   * Store intersection
   */
  sinterstore(destination: RedisKey, ...keys: RedisKey[]): Promise<number>

  /**
   * Store union
   */
  sunionstore(destination: RedisKey, ...keys: RedisKey[]): Promise<number>

  /**
   * Store difference
   */
  sdiffstore(destination: RedisKey, ...keys: RedisKey[]): Promise<number>

  /**
   * Get random members
   */
  srandmember(key: RedisKey): Promise<string | null>
  srandmember(key: RedisKey, count: number): Promise<string | string[] | null>

  /**
   * Pop random members
   */
  spop(key: RedisKey): Promise<string | null>
  spop(key: RedisKey, count: number): Promise<string | string[] | null>

  /**
   * Move member between sets
   */
  smove(source: RedisKey, destination: RedisKey, member: RedisValue): Promise<number>

  // ============================================================================
  // SORTED SET COMMANDS
  // ============================================================================

  /**
   * Add members with scores
   */
  zadd(key: RedisKey, score: number, member: RedisValue): Promise<number | string>
  zadd(key: RedisKey, ...scoreMembers: (number | RedisValue)[]): Promise<number | string>
  zadd(key: RedisKey, options: ZAddOptions, score: number, member: RedisValue): Promise<number | string>

  /**
   * Remove members
   */
  zrem(key: RedisKey, ...members: RedisValue[]): Promise<number>

  /**
   * Get range by index
   */
  zrange(key: RedisKey, start: number, stop: number): Promise<string[]>
  zrange(key: RedisKey, start: number, stop: number, withScores: 'WITHSCORES'): Promise<string[]>
  zrange(key: RedisKey, start: number | string, stop: number | string, options: ZRangeOptions): Promise<string[]>

  /**
   * Get range by index (reversed)
   */
  zrevrange(key: RedisKey, start: number, stop: number): Promise<string[]>
  zrevrange(key: RedisKey, start: number, stop: number, withScores: 'WITHSCORES'): Promise<string[]>

  /**
   * Get score of member
   */
  zscore(key: RedisKey, member: RedisValue): Promise<string | null>

  /**
   * Get rank of member
   */
  zrank(key: RedisKey, member: RedisValue): Promise<number | null>

  /**
   * Get reverse rank of member
   */
  zrevrank(key: RedisKey, member: RedisValue): Promise<number | null>

  /**
   * Get sorted set size
   */
  zcard(key: RedisKey): Promise<number>

  /**
   * Count members in score range
   */
  zcount(key: RedisKey, min: number | string, max: number | string): Promise<number>

  /**
   * Increment score
   */
  zincrby(key: RedisKey, increment: number, member: RedisValue): Promise<string>

  /**
   * Get range by score
   */
  zrangebyscore(key: RedisKey, min: number | string, max: number | string): Promise<string[]>
  zrangebyscore(key: RedisKey, min: number | string, max: number | string, withScores: 'WITHSCORES'): Promise<string[]>
  zrangebyscore(key: RedisKey, min: number | string, max: number | string, limit: 'LIMIT', offset: number, count: number): Promise<string[]>

  /**
   * Get range by score (reversed)
   */
  zrevrangebyscore(key: RedisKey, max: number | string, min: number | string): Promise<string[]>
  zrevrangebyscore(key: RedisKey, max: number | string, min: number | string, withScores: 'WITHSCORES'): Promise<string[]>
  zrevrangebyscore(key: RedisKey, max: number | string, min: number | string, limit: 'LIMIT', offset: number, count: number): Promise<string[]>

  /**
   * Count members in lex range
   */
  zlexcount(key: RedisKey, min: string, max: string): Promise<number>

  /**
   * Pop minimum score members
   */
  zpopmin(key: RedisKey): Promise<string[]>
  zpopmin(key: RedisKey, count: number): Promise<string[]>

  /**
   * Pop maximum score members
   */
  zpopmax(key: RedisKey): Promise<string[]>
  zpopmax(key: RedisKey, count: number): Promise<string[]>

  // ============================================================================
  // KEY COMMANDS
  // ============================================================================

  /**
   * Delete keys
   */
  del(...keys: RedisKey[]): Promise<number>

  /**
   * Check if keys exist
   */
  exists(...keys: RedisKey[]): Promise<number>

  /**
   * Set expiry in seconds
   */
  expire(key: RedisKey, seconds: number): Promise<number>

  /**
   * Set expiry as Unix timestamp (seconds)
   */
  expireat(key: RedisKey, timestamp: number): Promise<number>

  /**
   * Set expiry in milliseconds
   */
  pexpire(key: RedisKey, milliseconds: number): Promise<number>

  /**
   * Set expiry as Unix timestamp (milliseconds)
   */
  pexpireat(key: RedisKey, timestamp: number): Promise<number>

  /**
   * Get TTL in seconds
   */
  ttl(key: RedisKey): Promise<number>

  /**
   * Get TTL in milliseconds
   */
  pttl(key: RedisKey): Promise<number>

  /**
   * Remove expiry
   */
  persist(key: RedisKey): Promise<number>

  /**
   * Find keys by pattern
   */
  keys(pattern: string): Promise<string[]>

  /**
   * Get key type
   */
  type(key: RedisKey): Promise<string>

  /**
   * Rename key
   */
  rename(key: RedisKey, newKey: RedisKey): Promise<'OK'>

  /**
   * Rename key if new key doesn't exist
   */
  renamenx(key: RedisKey, newKey: RedisKey): Promise<number>

  /**
   * Get random key
   */
  randomkey(): Promise<string | null>

  /**
   * Incrementally iterate keys
   */
  scan(cursor: string | number, options?: { MATCH?: string; COUNT?: number; TYPE?: string }): Promise<ScanResult>

  /**
   * Delete keys asynchronously
   */
  unlink(...keys: RedisKey[]): Promise<number>

  /**
   * Copy key
   */
  copy(source: RedisKey, destination: RedisKey, options?: { REPLACE?: boolean }): Promise<number>

  // ============================================================================
  // PUB/SUB COMMANDS
  // ============================================================================

  /**
   * Publish message to channel
   */
  publish(channel: string, message: string): Promise<number>

  /**
   * Subscribe to channels (returns subscriber)
   */
  subscribe(...channels: string[]): Promise<void>

  /**
   * Unsubscribe from channels
   */
  unsubscribe(...channels: string[]): Promise<void>

  /**
   * Subscribe to patterns
   */
  psubscribe(...patterns: string[]): Promise<void>

  /**
   * Unsubscribe from patterns
   */
  punsubscribe(...patterns: string[]): Promise<void>

  /**
   * Create dedicated subscriber
   */
  duplicate(): Redis

  // ============================================================================
  // STREAM COMMANDS
  // ============================================================================

  /**
   * Append entry to stream (XADD)
   */
  xadd(key: RedisKey, id: StreamEntryId | '*', ...fieldValues: RedisValue[]): Promise<StreamEntryId>
  xadd(key: RedisKey, options: XAddOptions, ...fieldValues: RedisValue[]): Promise<StreamEntryId | null>

  /**
   * Read entries from streams (XREAD)
   */
  xread(options: XReadOptions, ...streams: (RedisKey | StreamEntryId)[]): Promise<StreamReadResult | null>
  xread(...streams: (RedisKey | StreamEntryId)[]): Promise<StreamReadResult | null>

  /**
   * Get range of entries (XRANGE)
   */
  xrange(key: RedisKey, start: StreamEntryId | '-', end: StreamEntryId | '+'): Promise<StreamEntry[]>
  xrange(key: RedisKey, start: StreamEntryId | '-', end: StreamEntryId | '+', options: XRangeOptions): Promise<StreamEntry[]>
  xrange(key: RedisKey, start: StreamEntryId | '-', end: StreamEntryId | '+', count: 'COUNT', countValue: number): Promise<StreamEntry[]>

  /**
   * Get range of entries in reverse (XREVRANGE)
   */
  xrevrange(key: RedisKey, end: StreamEntryId | '+', start: StreamEntryId | '-'): Promise<StreamEntry[]>
  xrevrange(key: RedisKey, end: StreamEntryId | '+', start: StreamEntryId | '-', options: XRangeOptions): Promise<StreamEntry[]>
  xrevrange(key: RedisKey, end: StreamEntryId | '+', start: StreamEntryId | '-', count: 'COUNT', countValue: number): Promise<StreamEntry[]>

  /**
   * Get stream length (XLEN)
   */
  xlen(key: RedisKey): Promise<number>

  /**
   * Delete entries from stream (XDEL)
   */
  xdel(key: RedisKey, ...ids: StreamEntryId[]): Promise<number>

  /**
   * Trim stream (XTRIM)
   */
  xtrim(key: RedisKey, strategy: 'MAXLEN' | 'MINID', threshold: number | StreamEntryId): Promise<number>
  xtrim(key: RedisKey, strategy: 'MAXLEN' | 'MINID', approx: '~', threshold: number | StreamEntryId): Promise<number>

  /**
   * Get stream info (XINFO STREAM)
   */
  xinfo(subcommand: 'STREAM', key: RedisKey): Promise<StreamInfo>

  /**
   * Get consumer groups info (XINFO GROUPS)
   */
  xinfo(subcommand: 'GROUPS', key: RedisKey): Promise<StreamGroupInfo[]>

  /**
   * Get consumers info (XINFO CONSUMERS)
   */
  xinfo(subcommand: 'CONSUMERS', key: RedisKey, groupName: string): Promise<StreamConsumerInfo[]>

  /**
   * Create consumer group (XGROUP CREATE)
   */
  xgroup(subcommand: 'CREATE', key: RedisKey, groupName: string, id: StreamEntryId | '$' | '0'): Promise<'OK'>
  xgroup(subcommand: 'CREATE', key: RedisKey, groupName: string, id: StreamEntryId | '$' | '0', mkstream: 'MKSTREAM'): Promise<'OK'>

  /**
   * Delete consumer group (XGROUP DESTROY)
   */
  xgroup(subcommand: 'DESTROY', key: RedisKey, groupName: string): Promise<number>

  /**
   * Delete consumer from group (XGROUP DELCONSUMER)
   */
  xgroup(subcommand: 'DELCONSUMER', key: RedisKey, groupName: string, consumerName: string): Promise<number>

  /**
   * Set group ID (XGROUP SETID)
   */
  xgroup(subcommand: 'SETID', key: RedisKey, groupName: string, id: StreamEntryId | '$' | '0'): Promise<'OK'>

  /**
   * Read entries as consumer group (XREADGROUP)
   */
  xreadgroup(
    group: 'GROUP',
    groupName: string,
    consumerName: string,
    options: XReadGroupOptions,
    ...streams: (RedisKey | StreamEntryId)[]
  ): Promise<StreamReadResult | null>
  xreadgroup(
    group: 'GROUP',
    groupName: string,
    consumerName: string,
    ...streams: (RedisKey | StreamEntryId)[]
  ): Promise<StreamReadResult | null>

  /**
   * Acknowledge processed entries (XACK)
   */
  xack(key: RedisKey, groupName: string, ...ids: StreamEntryId[]): Promise<number>

  /**
   * Get pending entries summary (XPENDING)
   */
  xpending(key: RedisKey, groupName: string): Promise<[number, StreamEntryId | null, StreamEntryId | null, [string, number][] | null]>

  /**
   * Get pending entries details (XPENDING with range)
   */
  xpending(
    key: RedisKey,
    groupName: string,
    start: StreamEntryId | '-',
    end: StreamEntryId | '+',
    count: number,
    consumer?: string
  ): Promise<PendingEntry[]>

  /**
   * Claim pending entries (XCLAIM)
   */
  xclaim(
    key: RedisKey,
    groupName: string,
    consumerName: string,
    minIdleTime: number,
    ...ids: StreamEntryId[]
  ): Promise<StreamEntry[]>
  xclaim(
    key: RedisKey,
    groupName: string,
    consumerName: string,
    minIdleTime: number,
    ids: StreamEntryId[],
    options: XClaimOptions
  ): Promise<StreamEntry[] | StreamEntryId[]>

  /**
   * Auto-claim pending entries (XAUTOCLAIM)
   */
  xautoclaim(
    key: RedisKey,
    groupName: string,
    consumerName: string,
    minIdleTime: number,
    start: StreamEntryId | '0-0',
    options?: { COUNT?: number; JUSTID?: boolean }
  ): Promise<XAutoClaimResult>

  // ============================================================================
  // TRANSACTION COMMANDS
  // ============================================================================

  /**
   * Watch keys for optimistic locking
   */
  watch(...keys: RedisKey[]): Promise<'OK'>

  /**
   * Stop watching keys
   */
  unwatch(): Promise<'OK'>

  /**
   * Start transaction
   */
  multi(): Multi

  /**
   * Start pipeline (no transaction)
   */
  pipeline(): Pipeline

  // ============================================================================
  // SERVER COMMANDS
  // ============================================================================

  /**
   * Test connection
   */
  ping(message?: string): Promise<string>

  /**
   * Echo message
   */
  echo(message: string): Promise<string>

  /**
   * Get database size
   */
  dbsize(): Promise<number>

  /**
   * Delete all keys in current database
   */
  flushdb(mode?: 'ASYNC' | 'SYNC'): Promise<'OK'>

  /**
   * Delete all keys in all databases
   */
  flushall(mode?: 'ASYNC' | 'SYNC'): Promise<'OK'>

  /**
   * Get server time
   */
  time(): Promise<[string, string]>

  /**
   * Get server info
   */
  info(section?: string): Promise<string>

  /**
   * Select database
   */
  select(db: number): Promise<'OK'>

  // ============================================================================
  // CONNECTION COMMANDS
  // ============================================================================

  /**
   * Connect to server (if lazyConnect)
   */
  connect(): Promise<void>

  /**
   * Disconnect gracefully
   */
  quit(): Promise<'OK'>

  /**
   * Disconnect immediately
   */
  disconnect(): void

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  /**
   * Register event handler
   */
  on<E extends keyof RedisEvents>(event: E, listener: RedisEvents[E]): this

  /**
   * Register one-time event handler
   */
  once<E extends keyof RedisEvents>(event: E, listener: RedisEvents[E]): this

  /**
   * Remove event handler
   */
  off<E extends keyof RedisEvents>(event: E, listener: RedisEvents[E]): this

  /**
   * Remove all event handlers
   */
  removeAllListeners(event?: keyof RedisEvents): this
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create Redis client (ioredis style)
 */
export type CreateRedis = {
  new (options?: RedisOptions): Redis
  new (port: number, host?: string, options?: RedisOptions): Redis
  new (url: string, options?: RedisOptions): Redis
}

/**
 * Create Redis client (node-redis style)
 */
export interface CreateClientOptions extends RedisOptions {
  /** Socket options */
  socket?: {
    host?: string
    port?: number
    tls?: boolean
    connectTimeout?: number
  }
}

// ============================================================================
// STREAM TYPES
// ============================================================================

/**
 * Stream entry ID (timestamp-sequence format: "1526919030474-0")
 */
export type StreamEntryId = string

/**
 * Stream entry with ID and field-value pairs
 */
export type StreamEntry = [StreamEntryId, string[]]

/**
 * Stream read result: [streamKey, entries]
 */
export type StreamReadResult = [string, StreamEntry[]][]

/**
 * XADD options
 */
export interface XAddOptions {
  /** Entry ID (default: "*" for auto-generation) */
  id?: StreamEntryId | '*'
  /** NOMKSTREAM - don't create stream if it doesn't exist */
  NOMKSTREAM?: boolean
  /** MAXLEN - trim stream to specified length */
  MAXLEN?: number
  /** Use ~ for approximate trimming */
  MAXLEN_APPROX?: boolean
  /** MINID - trim entries older than this ID */
  MINID?: StreamEntryId
  /** Use ~ for approximate MINID trimming */
  MINID_APPROX?: boolean
}

/**
 * XREAD options
 */
export interface XReadOptions {
  /** COUNT - max entries to return per stream */
  COUNT?: number
  /** BLOCK - block for milliseconds (0 = forever) */
  BLOCK?: number
}

/**
 * XRANGE options
 */
export interface XRangeOptions {
  /** COUNT - max entries to return */
  COUNT?: number
}

/**
 * XREADGROUP options
 */
export interface XReadGroupOptions extends XReadOptions {
  /** NOACK - don't add to pending entries list */
  NOACK?: boolean
}

/**
 * Consumer group info
 */
export interface StreamGroupInfo {
  name: string
  consumers: number
  pending: number
  lastDeliveredId: StreamEntryId
}

/**
 * Consumer info within a group
 */
export interface StreamConsumerInfo {
  name: string
  pending: number
  idle: number
}

/**
 * Stream info
 */
export interface StreamInfo {
  length: number
  radixTreeKeys: number
  radixTreeNodes: number
  lastGeneratedId: StreamEntryId
  groups: number
  firstEntry: StreamEntry | null
  lastEntry: StreamEntry | null
}

/**
 * Pending entry info
 */
export interface PendingEntry {
  id: StreamEntryId
  consumer: string
  idleTime: number
  deliveryCount: number
}

/**
 * XCLAIM options
 */
export interface XClaimOptions {
  /** Minimum idle time for claiming */
  IDLE?: number
  /** Set specific idle time */
  TIME?: number
  /** Set retry count */
  RETRYCOUNT?: number
  /** Force claim even if not pending */
  FORCE?: boolean
  /** Return just IDs */
  JUSTID?: boolean
}

/**
 * XAUTOCLAIM result
 */
export type XAutoClaimResult = [StreamEntryId, StreamEntry[], StreamEntryId[]]

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Redis error
 */
export class RedisError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedisError'
  }
}

/**
 * Connection error
 */
export class ConnectionError extends RedisError {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/**
 * Command error (WRONGTYPE, etc.)
 */
export class ReplyError extends RedisError {
  command?: string
  args?: unknown[]

  constructor(message: string) {
    super(message)
    this.name = 'ReplyError'
  }
}

/**
 * Transaction error (WATCH failed, etc.)
 */
export class TransactionError extends RedisError {
  constructor(message: string) {
    super(message)
    this.name = 'TransactionError'
  }
}
