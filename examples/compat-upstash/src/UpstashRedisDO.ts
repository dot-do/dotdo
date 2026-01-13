/**
 * UpstashRedisDO - Upstash Redis REST API compatible Durable Object
 *
 * Drop-in replacement for @upstash/redis that runs on Cloudflare Workers.
 * Implements the Upstash Redis REST API for full SDK compatibility.
 *
 * Features:
 * - All Redis commands via HTTP REST
 * - Pipeline support for batch operations
 * - Full @upstash/redis SDK compatibility
 * - JSON serialization support
 * - TTL and expiration support
 *
 * @see https://docs.upstash.com/redis/features/restapi
 */

import { DO } from 'dotdo'

// ============================================================================
// TYPES
// ============================================================================

export type RedisValue = string | number | boolean | null
export type RedisResult<T = RedisValue> = { result: T } | { error: string }

export interface CommandRequest {
  command: string[]
}

export interface PipelineRequest {
  commands: string[][]
}

export interface SetOptions {
  ex?: number // Expire time in seconds
  px?: number // Expire time in milliseconds
  exat?: number // Unix timestamp in seconds
  pxat?: number // Unix timestamp in milliseconds
  nx?: boolean // Only set if key doesn't exist
  xx?: boolean // Only set if key exists
  get?: boolean // Return old value
  keepttl?: boolean // Keep existing TTL
}

export interface ZAddOptions {
  nx?: boolean
  xx?: boolean
  gt?: boolean
  lt?: boolean
  ch?: boolean
  incr?: boolean
}

export interface ScanOptions {
  match?: string
  count?: number
  type?: string
}

// ============================================================================
// UPSTASH REDIS DO
// ============================================================================

/**
 * UpstashRedisDO - Redis REST API compatible Durable Object
 */
export class UpstashRedisDO extends DO {
  static readonly $type = 'UpstashRedisDO'

  private sql!: SqlStorage

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    this.sql = ctx.storage.sql
  }

  /**
   * Initialize database schema
   */
  async initialize() {
    // Main key-value store
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'string',
        expires_at INTEGER
      )
    `)

    // Hash fields
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS hash_fields (
        key TEXT NOT NULL,
        field TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (key, field)
      )
    `)

    // List items
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS list_items (
        key TEXT NOT NULL,
        idx INTEGER NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (key, idx)
      )
    `)

    // Set members
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS set_members (
        key TEXT NOT NULL,
        member TEXT NOT NULL,
        PRIMARY KEY (key, member)
      )
    `)

    // Sorted set members
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS zset_members (
        key TEXT NOT NULL,
        member TEXT NOT NULL,
        score REAL NOT NULL,
        PRIMARY KEY (key, member)
      )
    `)

    // Create indexes for expiration cleanup
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv(expires_at) WHERE expires_at IS NOT NULL
    `)
  }

  // ===========================================================================
  // HTTP HANDLER - Upstash REST API Compatible
  // ===========================================================================

  /**
   * Handle HTTP requests in Upstash REST API format
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // Clean up expired keys on each request
      await this.cleanupExpired()

      // POST / - Execute command(s)
      if (request.method === 'POST' && path === '/') {
        const body = await request.json() as CommandRequest | string[]

        // Handle array format (single command)
        if (Array.isArray(body)) {
          const result = await this.executeCommand(body)
          return Response.json(result)
        }

        // Handle object format
        if ('command' in body) {
          const result = await this.executeCommand(body.command)
          return Response.json(result)
        }

        return Response.json({ error: 'Invalid request format' }, { status: 400 })
      }

      // POST /pipeline - Execute pipeline
      if (request.method === 'POST' && path === '/pipeline') {
        const body = await request.json() as PipelineRequest | string[][]
        const commands = Array.isArray(body) ? body : body.commands
        const results = await this.executePipeline(commands)
        return Response.json(results)
      }

      // GET /:command/:arg1/:arg2/... - URL-based command
      if (request.method === 'GET' && path !== '/') {
        const parts = path.slice(1).split('/').map(decodeURIComponent)
        const result = await this.executeCommand(parts)
        return Response.json(result)
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Response.json({ error: message }, { status: 500 })
    }
  }

  // ===========================================================================
  // COMMAND EXECUTION
  // ===========================================================================

  /**
   * Execute a single Redis command
   */
  async executeCommand(args: string[]): Promise<RedisResult> {
    if (args.length === 0) {
      return { error: 'Empty command' }
    }

    const command = args[0].toUpperCase()
    const cmdArgs = args.slice(1)

    try {
      const result = await this.runCommand(command, cmdArgs)
      return { result }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { error: message }
    }
  }

  /**
   * Execute a pipeline of commands
   */
  async executePipeline(commands: string[][]): Promise<RedisResult[]> {
    const results: RedisResult[] = []

    for (const args of commands) {
      const result = await this.executeCommand(args)
      results.push(result)
    }

    return results
  }

  /**
   * Run a Redis command and return the result
   */
  private async runCommand(command: string, args: string[]): Promise<RedisValue | RedisValue[]> {
    switch (command) {
      // String commands
      case 'GET': return this.get(args[0])
      case 'SET': return this.set(args[0], args[1], this.parseSetOptions(args.slice(2)))
      case 'GETSET': return this.getset(args[0], args[1])
      case 'GETDEL': return this.getdel(args[0])
      case 'MGET': return this.mget(args)
      case 'MSET': return this.mset(args)
      case 'SETNX': return this.setnx(args[0], args[1])
      case 'SETEX': return this.setex(args[0], parseInt(args[1]), args[2])
      case 'PSETEX': return this.psetex(args[0], parseInt(args[1]), args[2])
      case 'INCR': return this.incr(args[0])
      case 'INCRBY': return this.incrby(args[0], parseInt(args[1]))
      case 'INCRBYFLOAT': return this.incrbyfloat(args[0], parseFloat(args[1]))
      case 'DECR': return this.decr(args[0])
      case 'DECRBY': return this.decrby(args[0], parseInt(args[1]))
      case 'APPEND': return this.append(args[0], args[1])
      case 'STRLEN': return this.strlen(args[0])
      case 'GETRANGE': return this.getrange(args[0], parseInt(args[1]), parseInt(args[2]))
      case 'SETRANGE': return this.setrange(args[0], parseInt(args[1]), args[2])

      // Key commands
      case 'DEL': return this.del(args)
      case 'EXISTS': return this.exists(args)
      case 'EXPIRE': return this.expire(args[0], parseInt(args[1]))
      case 'EXPIREAT': return this.expireat(args[0], parseInt(args[1]))
      case 'PEXPIRE': return this.pexpire(args[0], parseInt(args[1]))
      case 'PEXPIREAT': return this.pexpireat(args[0], parseInt(args[1]))
      case 'TTL': return this.ttl(args[0])
      case 'PTTL': return this.pttl(args[0])
      case 'PERSIST': return this.persist(args[0])
      case 'TYPE': return this.type(args[0])
      case 'KEYS': return this.keys(args[0] || '*')
      case 'SCAN': return this.scan(parseInt(args[0]), this.parseScanOptions(args.slice(1)))
      case 'RENAME': return this.rename(args[0], args[1])
      case 'RENAMENX': return this.renamenx(args[0], args[1])
      case 'UNLINK': return this.del(args) // Same as DEL in this implementation
      case 'RANDOMKEY': return this.randomkey()

      // Hash commands
      case 'HGET': return this.hget(args[0], args[1])
      case 'HSET': return this.hset(args[0], args.slice(1))
      case 'HSETNX': return this.hsetnx(args[0], args[1], args[2])
      case 'HMGET': return this.hmget(args[0], args.slice(1))
      case 'HMSET': return this.hmset(args[0], args.slice(1))
      case 'HGETALL': return this.hgetall(args[0])
      case 'HDEL': return this.hdel(args[0], args.slice(1))
      case 'HEXISTS': return this.hexists(args[0], args[1])
      case 'HKEYS': return this.hkeys(args[0])
      case 'HVALS': return this.hvals(args[0])
      case 'HLEN': return this.hlen(args[0])
      case 'HINCRBY': return this.hincrby(args[0], args[1], parseInt(args[2]))
      case 'HINCRBYFLOAT': return this.hincrbyfloat(args[0], args[1], parseFloat(args[2]))

      // List commands
      case 'LPUSH': return this.lpush(args[0], args.slice(1))
      case 'RPUSH': return this.rpush(args[0], args.slice(1))
      case 'LPOP': return this.lpop(args[0], args[1] ? parseInt(args[1]) : undefined)
      case 'RPOP': return this.rpop(args[0], args[1] ? parseInt(args[1]) : undefined)
      case 'LRANGE': return this.lrange(args[0], parseInt(args[1]), parseInt(args[2]))
      case 'LLEN': return this.llen(args[0])
      case 'LINDEX': return this.lindex(args[0], parseInt(args[1]))
      case 'LSET': return this.lset(args[0], parseInt(args[1]), args[2])
      case 'LREM': return this.lrem(args[0], parseInt(args[1]), args[2])
      case 'LTRIM': return this.ltrim(args[0], parseInt(args[1]), parseInt(args[2]))

      // Set commands
      case 'SADD': return this.sadd(args[0], args.slice(1))
      case 'SREM': return this.srem(args[0], args.slice(1))
      case 'SMEMBERS': return this.smembers(args[0])
      case 'SISMEMBER': return this.sismember(args[0], args[1])
      case 'SMISMEMBER': return this.smismember(args[0], args.slice(1))
      case 'SCARD': return this.scard(args[0])
      case 'SINTER': return this.sinter(args)
      case 'SUNION': return this.sunion(args)
      case 'SDIFF': return this.sdiff(args)
      case 'SRANDMEMBER': return this.srandmember(args[0], args[1] ? parseInt(args[1]) : undefined)
      case 'SPOP': return this.spop(args[0], args[1] ? parseInt(args[1]) : undefined)

      // Sorted set commands
      case 'ZADD': return this.zadd(args[0], args.slice(1))
      case 'ZREM': return this.zrem(args[0], args.slice(1))
      case 'ZSCORE': return this.zscore(args[0], args[1])
      case 'ZRANK': return this.zrank(args[0], args[1])
      case 'ZREVRANK': return this.zrevrank(args[0], args[1])
      case 'ZRANGE': return this.zrange(args[0], args.slice(1))
      case 'ZREVRANGE': return this.zrevrange(args[0], parseInt(args[1]), parseInt(args[2]), args[3]?.toUpperCase() === 'WITHSCORES')
      case 'ZRANGEBYSCORE': return this.zrangebyscore(args[0], args.slice(1))
      case 'ZCARD': return this.zcard(args[0])
      case 'ZCOUNT': return this.zcount(args[0], args[1], args[2])
      case 'ZINCRBY': return this.zincrby(args[0], parseFloat(args[1]), args[2])
      case 'ZPOPMIN': return this.zpopmin(args[0], args[1] ? parseInt(args[1]) : 1)
      case 'ZPOPMAX': return this.zpopmax(args[0], args[1] ? parseInt(args[1]) : 1)

      // Server commands
      case 'PING': return args[0] || 'PONG'
      case 'ECHO': return args[0]
      case 'DBSIZE': return this.dbsize()
      case 'FLUSHDB': return this.flushdb()
      case 'FLUSHALL': return this.flushdb() // Same as FLUSHDB for single-instance
      case 'INFO': return this.info(args[0])
      case 'TIME': return this.time()

      // JSON commands (Upstash JSON)
      case 'JSON.GET': return this.jsonGet(args[0], args.slice(1))
      case 'JSON.SET': return this.jsonSet(args[0], args[1], args[2])
      case 'JSON.DEL': return this.jsonDel(args[0], args[1])
      case 'JSON.MGET': return this.jsonMget(args)
      case 'JSON.TYPE': return this.jsonType(args[0], args[1])
      case 'JSON.STRLEN': return this.jsonStrlen(args[0], args[1])
      case 'JSON.ARRLEN': return this.jsonArrlen(args[0], args[1])
      case 'JSON.ARRAPPEND': return this.jsonArrappend(args[0], args[1], args.slice(2))
      case 'JSON.OBJKEYS': return this.jsonObjkeys(args[0], args[1])

      default:
        throw new Error(`Unknown command: ${command}`)
    }
  }

  // ===========================================================================
  // STRING COMMANDS
  // ===========================================================================

  private get(key: string): string | null {
    const row = this.sql.exec<{ value: string }>(
      'SELECT value FROM kv WHERE key = ? AND type = ?',
      key, 'string'
    ).toArray()[0]
    return row?.value ?? null
  }

  private set(key: string, value: string, options?: SetOptions): string | null {
    let oldValue: string | null = null

    if (options?.get) {
      oldValue = this.get(key)
    }

    // Check NX/XX conditions
    const exists = this.sql.exec('SELECT 1 FROM kv WHERE key = ?', key).toArray().length > 0

    if (options?.nx && exists) {
      return options.get ? oldValue : null
    }
    if (options?.xx && !exists) {
      return options.get ? null : null
    }

    // Calculate expiration
    let expiresAt: number | null = null

    if (options?.keepttl && exists) {
      const current = this.sql.exec<{ expires_at: number | null }>(
        'SELECT expires_at FROM kv WHERE key = ?', key
      ).toArray()[0]
      expiresAt = current?.expires_at ?? null
    } else if (options?.ex) {
      expiresAt = Date.now() + options.ex * 1000
    } else if (options?.px) {
      expiresAt = Date.now() + options.px
    } else if (options?.exat) {
      expiresAt = options.exat * 1000
    } else if (options?.pxat) {
      expiresAt = options.pxat
    }

    this.sql.exec(
      `INSERT OR REPLACE INTO kv (key, value, type, expires_at) VALUES (?, ?, 'string', ?)`,
      key, value, expiresAt
    )

    return options?.get ? oldValue : 'OK'
  }

  private getset(key: string, value: string): string | null {
    const old = this.get(key)
    this.set(key, value)
    return old
  }

  private getdel(key: string): string | null {
    const value = this.get(key)
    if (value !== null) {
      this.del([key])
    }
    return value
  }

  private mget(keys: string[]): (string | null)[] {
    return keys.map(key => this.get(key))
  }

  private mset(keyValues: string[]): string {
    for (let i = 0; i < keyValues.length; i += 2) {
      this.set(keyValues[i], keyValues[i + 1])
    }
    return 'OK'
  }

  private setnx(key: string, value: string): number {
    const result = this.set(key, value, { nx: true })
    return result === 'OK' ? 1 : 0
  }

  private setex(key: string, seconds: number, value: string): string {
    return this.set(key, value, { ex: seconds }) ?? 'OK'
  }

  private psetex(key: string, milliseconds: number, value: string): string {
    return this.set(key, value, { px: milliseconds }) ?? 'OK'
  }

  private incr(key: string): number {
    return this.incrby(key, 1)
  }

  private incrby(key: string, increment: number): number {
    const current = this.get(key)
    const value = current ? parseInt(current) : 0

    if (isNaN(value)) {
      throw new Error('Value is not an integer')
    }

    const newValue = value + increment
    this.set(key, newValue.toString())
    return newValue
  }

  private incrbyfloat(key: string, increment: number): string {
    const current = this.get(key)
    const value = current ? parseFloat(current) : 0

    if (isNaN(value)) {
      throw new Error('Value is not a number')
    }

    const newValue = value + increment
    this.set(key, newValue.toString())
    return newValue.toString()
  }

  private decr(key: string): number {
    return this.incrby(key, -1)
  }

  private decrby(key: string, decrement: number): number {
    return this.incrby(key, -decrement)
  }

  private append(key: string, value: string): number {
    const current = this.get(key) ?? ''
    const newValue = current + value
    this.set(key, newValue)
    return newValue.length
  }

  private strlen(key: string): number {
    const value = this.get(key)
    return value?.length ?? 0
  }

  private getrange(key: string, start: number, end: number): string {
    const value = this.get(key) ?? ''
    if (end < 0) end = value.length + end
    if (start < 0) start = Math.max(0, value.length + start)
    return value.slice(start, end + 1)
  }

  private setrange(key: string, offset: number, value: string): number {
    let current = this.get(key) ?? ''
    while (current.length < offset) {
      current += '\0'
    }
    const result = current.slice(0, offset) + value + current.slice(offset + value.length)
    this.set(key, result)
    return result.length
  }

  // ===========================================================================
  // KEY COMMANDS
  // ===========================================================================

  private del(keys: string[]): number {
    let deleted = 0
    for (const key of keys) {
      // Check all tables
      const types = ['kv', 'hash_fields', 'list_items', 'set_members', 'zset_members']
      for (const table of types) {
        const result = this.sql.exec(`DELETE FROM ${table} WHERE key = ?`, key)
        if (result.rowsWritten > 0) {
          deleted++
          break
        }
      }
    }
    return deleted
  }

  private exists(keys: string[]): number {
    let count = 0
    for (const key of keys) {
      const exists = this.sql.exec('SELECT 1 FROM kv WHERE key = ?', key).toArray().length > 0
        || this.sql.exec('SELECT 1 FROM hash_fields WHERE key = ? LIMIT 1', key).toArray().length > 0
        || this.sql.exec('SELECT 1 FROM list_items WHERE key = ? LIMIT 1', key).toArray().length > 0
        || this.sql.exec('SELECT 1 FROM set_members WHERE key = ? LIMIT 1', key).toArray().length > 0
        || this.sql.exec('SELECT 1 FROM zset_members WHERE key = ? LIMIT 1', key).toArray().length > 0
      if (exists) count++
    }
    return count
  }

  private expire(key: string, seconds: number): number {
    const expiresAt = Date.now() + seconds * 1000
    const result = this.sql.exec(
      'UPDATE kv SET expires_at = ? WHERE key = ?',
      expiresAt, key
    )
    return result.rowsWritten > 0 ? 1 : 0
  }

  private expireat(key: string, timestamp: number): number {
    const expiresAt = timestamp * 1000
    const result = this.sql.exec(
      'UPDATE kv SET expires_at = ? WHERE key = ?',
      expiresAt, key
    )
    return result.rowsWritten > 0 ? 1 : 0
  }

  private pexpire(key: string, milliseconds: number): number {
    const expiresAt = Date.now() + milliseconds
    const result = this.sql.exec(
      'UPDATE kv SET expires_at = ? WHERE key = ?',
      expiresAt, key
    )
    return result.rowsWritten > 0 ? 1 : 0
  }

  private pexpireat(key: string, timestamp: number): number {
    const result = this.sql.exec(
      'UPDATE kv SET expires_at = ? WHERE key = ?',
      timestamp, key
    )
    return result.rowsWritten > 0 ? 1 : 0
  }

  private ttl(key: string): number {
    const row = this.sql.exec<{ expires_at: number | null }>(
      'SELECT expires_at FROM kv WHERE key = ?', key
    ).toArray()[0]

    if (!row) return -2 // Key doesn't exist
    if (row.expires_at === null) return -1 // No expiration

    const ttl = Math.ceil((row.expires_at - Date.now()) / 1000)
    return ttl > 0 ? ttl : -2
  }

  private pttl(key: string): number {
    const row = this.sql.exec<{ expires_at: number | null }>(
      'SELECT expires_at FROM kv WHERE key = ?', key
    ).toArray()[0]

    if (!row) return -2
    if (row.expires_at === null) return -1

    const ttl = row.expires_at - Date.now()
    return ttl > 0 ? ttl : -2
  }

  private persist(key: string): number {
    const result = this.sql.exec(
      'UPDATE kv SET expires_at = NULL WHERE key = ?',
      key
    )
    return result.rowsWritten > 0 ? 1 : 0
  }

  private type(key: string): string {
    const row = this.sql.exec<{ type: string }>(
      'SELECT type FROM kv WHERE key = ?', key
    ).toArray()[0]

    if (row) return row.type

    // Check other tables
    if (this.sql.exec('SELECT 1 FROM hash_fields WHERE key = ? LIMIT 1', key).toArray().length > 0) {
      return 'hash'
    }
    if (this.sql.exec('SELECT 1 FROM list_items WHERE key = ? LIMIT 1', key).toArray().length > 0) {
      return 'list'
    }
    if (this.sql.exec('SELECT 1 FROM set_members WHERE key = ? LIMIT 1', key).toArray().length > 0) {
      return 'set'
    }
    if (this.sql.exec('SELECT 1 FROM zset_members WHERE key = ? LIMIT 1', key).toArray().length > 0) {
      return 'zset'
    }

    return 'none'
  }

  private keys(pattern: string): string[] {
    // Convert glob pattern to SQL LIKE
    const likePattern = pattern.replace(/\*/g, '%').replace(/\?/g, '_')

    const kvKeys = this.sql.exec<{ key: string }>(
      'SELECT DISTINCT key FROM kv WHERE key LIKE ?', likePattern
    ).toArray().map(r => r.key)

    const hashKeys = this.sql.exec<{ key: string }>(
      'SELECT DISTINCT key FROM hash_fields WHERE key LIKE ?', likePattern
    ).toArray().map(r => r.key)

    const listKeys = this.sql.exec<{ key: string }>(
      'SELECT DISTINCT key FROM list_items WHERE key LIKE ?', likePattern
    ).toArray().map(r => r.key)

    const setKeys = this.sql.exec<{ key: string }>(
      'SELECT DISTINCT key FROM set_members WHERE key LIKE ?', likePattern
    ).toArray().map(r => r.key)

    const zsetKeys = this.sql.exec<{ key: string }>(
      'SELECT DISTINCT key FROM zset_members WHERE key LIKE ?', likePattern
    ).toArray().map(r => r.key)

    return [...new Set([...kvKeys, ...hashKeys, ...listKeys, ...setKeys, ...zsetKeys])]
  }

  private scan(cursor: number, options: ScanOptions): [string, string[]] {
    const count = options.count ?? 10
    const matchPattern = options.match ?? '*'

    const allKeys = this.keys(matchPattern)
    const start = cursor
    const end = Math.min(start + count, allKeys.length)
    const keys = allKeys.slice(start, end)
    const nextCursor = end >= allKeys.length ? 0 : end

    return [nextCursor.toString(), keys]
  }

  private rename(key: string, newKey: string): string {
    const type = this.type(key)
    if (type === 'none') {
      throw new Error('No such key')
    }

    // Copy data to new key
    if (type === 'string') {
      const value = this.get(key)!
      this.set(newKey, value)
    }
    // Handle other types...

    this.del([key])
    return 'OK'
  }

  private renamenx(key: string, newKey: string): number {
    if (this.exists([newKey]) > 0) {
      return 0
    }
    this.rename(key, newKey)
    return 1
  }

  private randomkey(): string | null {
    const row = this.sql.exec<{ key: string }>(
      'SELECT key FROM kv ORDER BY RANDOM() LIMIT 1'
    ).toArray()[0]
    return row?.key ?? null
  }

  // ===========================================================================
  // HASH COMMANDS
  // ===========================================================================

  private hget(key: string, field: string): string | null {
    const row = this.sql.exec<{ value: string }>(
      'SELECT value FROM hash_fields WHERE key = ? AND field = ?',
      key, field
    ).toArray()[0]
    return row?.value ?? null
  }

  private hset(key: string, fieldValues: string[]): number {
    let created = 0
    for (let i = 0; i < fieldValues.length; i += 2) {
      const field = fieldValues[i]
      const value = fieldValues[i + 1]

      const exists = this.sql.exec(
        'SELECT 1 FROM hash_fields WHERE key = ? AND field = ?',
        key, field
      ).toArray().length > 0

      this.sql.exec(
        'INSERT OR REPLACE INTO hash_fields (key, field, value) VALUES (?, ?, ?)',
        key, field, value
      )

      if (!exists) created++
    }
    return created
  }

  private hsetnx(key: string, field: string, value: string): number {
    const exists = this.sql.exec(
      'SELECT 1 FROM hash_fields WHERE key = ? AND field = ?',
      key, field
    ).toArray().length > 0

    if (exists) return 0

    this.sql.exec(
      'INSERT INTO hash_fields (key, field, value) VALUES (?, ?, ?)',
      key, field, value
    )
    return 1
  }

  private hmget(key: string, fields: string[]): (string | null)[] {
    return fields.map(field => this.hget(key, field))
  }

  private hmset(key: string, fieldValues: string[]): string {
    this.hset(key, fieldValues)
    return 'OK'
  }

  private hgetall(key: string): string[] {
    const rows = this.sql.exec<{ field: string; value: string }>(
      'SELECT field, value FROM hash_fields WHERE key = ?', key
    ).toArray()

    const result: string[] = []
    for (const row of rows) {
      result.push(row.field, row.value)
    }
    return result
  }

  private hdel(key: string, fields: string[]): number {
    let deleted = 0
    for (const field of fields) {
      const result = this.sql.exec(
        'DELETE FROM hash_fields WHERE key = ? AND field = ?',
        key, field
      )
      if (result.rowsWritten > 0) deleted++
    }
    return deleted
  }

  private hexists(key: string, field: string): number {
    const exists = this.sql.exec(
      'SELECT 1 FROM hash_fields WHERE key = ? AND field = ?',
      key, field
    ).toArray().length > 0
    return exists ? 1 : 0
  }

  private hkeys(key: string): string[] {
    return this.sql.exec<{ field: string }>(
      'SELECT field FROM hash_fields WHERE key = ?', key
    ).toArray().map(r => r.field)
  }

  private hvals(key: string): string[] {
    return this.sql.exec<{ value: string }>(
      'SELECT value FROM hash_fields WHERE key = ?', key
    ).toArray().map(r => r.value)
  }

  private hlen(key: string): number {
    const row = this.sql.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM hash_fields WHERE key = ?', key
    ).toArray()[0]
    return row?.count ?? 0
  }

  private hincrby(key: string, field: string, increment: number): number {
    const current = this.hget(key, field)
    const value = current ? parseInt(current) : 0

    if (isNaN(value)) {
      throw new Error('Hash value is not an integer')
    }

    const newValue = value + increment
    this.hset(key, [field, newValue.toString()])
    return newValue
  }

  private hincrbyfloat(key: string, field: string, increment: number): string {
    const current = this.hget(key, field)
    const value = current ? parseFloat(current) : 0

    if (isNaN(value)) {
      throw new Error('Hash value is not a number')
    }

    const newValue = value + increment
    this.hset(key, [field, newValue.toString()])
    return newValue.toString()
  }

  // ===========================================================================
  // LIST COMMANDS
  // ===========================================================================

  private lpush(key: string, values: string[]): number {
    const currentLen = this.llen(key)

    // Shift existing items
    this.sql.exec(
      'UPDATE list_items SET idx = idx + ? WHERE key = ?',
      values.length, key
    )

    // Insert new items at beginning
    for (let i = 0; i < values.length; i++) {
      this.sql.exec(
        'INSERT INTO list_items (key, idx, value) VALUES (?, ?, ?)',
        key, values.length - 1 - i, values[i]
      )
    }

    return currentLen + values.length
  }

  private rpush(key: string, values: string[]): number {
    const currentLen = this.llen(key)

    for (let i = 0; i < values.length; i++) {
      this.sql.exec(
        'INSERT INTO list_items (key, idx, value) VALUES (?, ?, ?)',
        key, currentLen + i, values[i]
      )
    }

    return currentLen + values.length
  }

  private lpop(key: string, count?: number): string | string[] | null {
    const items = this.sql.exec<{ idx: number; value: string }>(
      'SELECT idx, value FROM list_items WHERE key = ? ORDER BY idx LIMIT ?',
      key, count ?? 1
    ).toArray()

    if (items.length === 0) return null

    // Delete popped items
    const maxIdx = items[items.length - 1].idx
    this.sql.exec('DELETE FROM list_items WHERE key = ? AND idx <= ?', key, maxIdx)

    // Reindex remaining items
    this.sql.exec(
      'UPDATE list_items SET idx = idx - ? WHERE key = ?',
      items.length, key
    )

    const values = items.map(i => i.value)
    return count ? values : values[0]
  }

  private rpop(key: string, count?: number): string | string[] | null {
    const items = this.sql.exec<{ idx: number; value: string }>(
      'SELECT idx, value FROM list_items WHERE key = ? ORDER BY idx DESC LIMIT ?',
      key, count ?? 1
    ).toArray()

    if (items.length === 0) return null

    // Delete popped items
    const minIdx = items[items.length - 1].idx
    this.sql.exec('DELETE FROM list_items WHERE key = ? AND idx >= ?', key, minIdx)

    const values = items.map(i => i.value)
    return count ? values : values[0]
  }

  private lrange(key: string, start: number, stop: number): string[] {
    const len = this.llen(key)
    if (start < 0) start = Math.max(0, len + start)
    if (stop < 0) stop = len + stop
    if (stop >= len) stop = len - 1

    if (start > stop || start >= len) return []

    return this.sql.exec<{ value: string }>(
      'SELECT value FROM list_items WHERE key = ? AND idx >= ? AND idx <= ? ORDER BY idx',
      key, start, stop
    ).toArray().map(r => r.value)
  }

  private llen(key: string): number {
    const row = this.sql.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM list_items WHERE key = ?', key
    ).toArray()[0]
    return row?.count ?? 0
  }

  private lindex(key: string, index: number): string | null {
    const len = this.llen(key)
    if (index < 0) index = len + index
    if (index < 0 || index >= len) return null

    const row = this.sql.exec<{ value: string }>(
      'SELECT value FROM list_items WHERE key = ? AND idx = ?',
      key, index
    ).toArray()[0]
    return row?.value ?? null
  }

  private lset(key: string, index: number, value: string): string {
    const len = this.llen(key)
    if (index < 0) index = len + index
    if (index < 0 || index >= len) {
      throw new Error('Index out of range')
    }

    this.sql.exec(
      'UPDATE list_items SET value = ? WHERE key = ? AND idx = ?',
      value, key, index
    )
    return 'OK'
  }

  private lrem(key: string, count: number, value: string): number {
    const direction = count >= 0 ? 'ASC' : 'DESC'
    const limit = count === 0 ? -1 : Math.abs(count)

    const toDelete = this.sql.exec<{ idx: number }>(
      `SELECT idx FROM list_items WHERE key = ? AND value = ? ORDER BY idx ${direction} ${limit > 0 ? `LIMIT ${limit}` : ''}`,
      key, value
    ).toArray().map(r => r.idx)

    for (const idx of toDelete) {
      this.sql.exec('DELETE FROM list_items WHERE key = ? AND idx = ?', key, idx)
    }

    // Reindex
    const items = this.sql.exec<{ idx: number; value: string }>(
      'SELECT idx, value FROM list_items WHERE key = ? ORDER BY idx',
      key
    ).toArray()

    for (let i = 0; i < items.length; i++) {
      if (items[i].idx !== i) {
        this.sql.exec(
          'UPDATE list_items SET idx = ? WHERE key = ? AND idx = ?',
          i, key, items[i].idx
        )
      }
    }

    return toDelete.length
  }

  private ltrim(key: string, start: number, stop: number): string {
    const len = this.llen(key)
    if (start < 0) start = Math.max(0, len + start)
    if (stop < 0) stop = len + stop

    this.sql.exec(
      'DELETE FROM list_items WHERE key = ? AND (idx < ? OR idx > ?)',
      key, start, stop
    )

    // Reindex starting from 0
    const items = this.sql.exec<{ idx: number; value: string }>(
      'SELECT idx, value FROM list_items WHERE key = ? ORDER BY idx',
      key
    ).toArray()

    for (let i = 0; i < items.length; i++) {
      const newIdx = i
      if (items[i].idx !== newIdx) {
        this.sql.exec(
          'UPDATE list_items SET idx = ? WHERE key = ? AND idx = ?',
          newIdx, key, items[i].idx
        )
      }
    }

    return 'OK'
  }

  // ===========================================================================
  // SET COMMANDS
  // ===========================================================================

  private sadd(key: string, members: string[]): number {
    let added = 0
    for (const member of members) {
      try {
        this.sql.exec(
          'INSERT INTO set_members (key, member) VALUES (?, ?)',
          key, member
        )
        added++
      } catch {
        // Member already exists
      }
    }
    return added
  }

  private srem(key: string, members: string[]): number {
    let removed = 0
    for (const member of members) {
      const result = this.sql.exec(
        'DELETE FROM set_members WHERE key = ? AND member = ?',
        key, member
      )
      if (result.rowsWritten > 0) removed++
    }
    return removed
  }

  private smembers(key: string): string[] {
    return this.sql.exec<{ member: string }>(
      'SELECT member FROM set_members WHERE key = ?', key
    ).toArray().map(r => r.member)
  }

  private sismember(key: string, member: string): number {
    const exists = this.sql.exec(
      'SELECT 1 FROM set_members WHERE key = ? AND member = ?',
      key, member
    ).toArray().length > 0
    return exists ? 1 : 0
  }

  private smismember(key: string, members: string[]): number[] {
    return members.map(m => this.sismember(key, m))
  }

  private scard(key: string): number {
    const row = this.sql.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM set_members WHERE key = ?', key
    ).toArray()[0]
    return row?.count ?? 0
  }

  private sinter(keys: string[]): string[] {
    if (keys.length === 0) return []
    if (keys.length === 1) return this.smembers(keys[0])

    const firstSet = new Set(this.smembers(keys[0]))

    for (let i = 1; i < keys.length; i++) {
      const otherSet = new Set(this.smembers(keys[i]))
      for (const member of firstSet) {
        if (!otherSet.has(member)) {
          firstSet.delete(member)
        }
      }
    }

    return [...firstSet]
  }

  private sunion(keys: string[]): string[] {
    const result = new Set<string>()
    for (const key of keys) {
      for (const member of this.smembers(key)) {
        result.add(member)
      }
    }
    return [...result]
  }

  private sdiff(keys: string[]): string[] {
    if (keys.length === 0) return []

    const result = new Set(this.smembers(keys[0]))

    for (let i = 1; i < keys.length; i++) {
      const otherSet = new Set(this.smembers(keys[i]))
      for (const member of otherSet) {
        result.delete(member)
      }
    }

    return [...result]
  }

  private srandmember(key: string, count?: number): string | string[] | null {
    const members = this.sql.exec<{ member: string }>(
      'SELECT member FROM set_members WHERE key = ? ORDER BY RANDOM() LIMIT ?',
      key, count ?? 1
    ).toArray().map(r => r.member)

    if (members.length === 0) return count ? [] : null
    return count ? members : members[0]
  }

  private spop(key: string, count?: number): string | string[] | null {
    const members = this.srandmember(key, count)
    if (!members) return null

    const toRemove = Array.isArray(members) ? members : [members]
    this.srem(key, toRemove)

    return members
  }

  // ===========================================================================
  // SORTED SET COMMANDS
  // ===========================================================================

  private zadd(key: string, args: string[]): number | string {
    let added = 0
    let changed = 0
    let options: ZAddOptions = {}
    let scoreIndex = 0

    // Parse options
    while (scoreIndex < args.length) {
      const opt = args[scoreIndex].toUpperCase()
      if (opt === 'NX') { options.nx = true; scoreIndex++ }
      else if (opt === 'XX') { options.xx = true; scoreIndex++ }
      else if (opt === 'GT') { options.gt = true; scoreIndex++ }
      else if (opt === 'LT') { options.lt = true; scoreIndex++ }
      else if (opt === 'CH') { options.ch = true; scoreIndex++ }
      else if (opt === 'INCR') { options.incr = true; scoreIndex++ }
      else break
    }

    // Process score-member pairs
    for (let i = scoreIndex; i < args.length; i += 2) {
      const score = parseFloat(args[i])
      const member = args[i + 1]

      const existing = this.sql.exec<{ score: number }>(
        'SELECT score FROM zset_members WHERE key = ? AND member = ?',
        key, member
      ).toArray()[0]

      if (options.incr) {
        const newScore = (existing?.score ?? 0) + score
        this.sql.exec(
          'INSERT OR REPLACE INTO zset_members (key, member, score) VALUES (?, ?, ?)',
          key, member, newScore
        )
        return newScore.toString()
      }

      if (options.nx && existing) continue
      if (options.xx && !existing) continue
      if (options.gt && existing && score <= existing.score) continue
      if (options.lt && existing && score >= existing.score) continue

      this.sql.exec(
        'INSERT OR REPLACE INTO zset_members (key, member, score) VALUES (?, ?, ?)',
        key, member, score
      )

      if (!existing) added++
      else if (existing.score !== score) changed++
    }

    return options.ch ? added + changed : added
  }

  private zrem(key: string, members: string[]): number {
    let removed = 0
    for (const member of members) {
      const result = this.sql.exec(
        'DELETE FROM zset_members WHERE key = ? AND member = ?',
        key, member
      )
      if (result.rowsWritten > 0) removed++
    }
    return removed
  }

  private zscore(key: string, member: string): string | null {
    const row = this.sql.exec<{ score: number }>(
      'SELECT score FROM zset_members WHERE key = ? AND member = ?',
      key, member
    ).toArray()[0]
    return row?.score.toString() ?? null
  }

  private zrank(key: string, member: string): number | null {
    const rows = this.sql.exec<{ member: string }>(
      'SELECT member FROM zset_members WHERE key = ? ORDER BY score, member',
      key
    ).toArray()

    const index = rows.findIndex(r => r.member === member)
    return index >= 0 ? index : null
  }

  private zrevrank(key: string, member: string): number | null {
    const rows = this.sql.exec<{ member: string }>(
      'SELECT member FROM zset_members WHERE key = ? ORDER BY score DESC, member DESC',
      key
    ).toArray()

    const index = rows.findIndex(r => r.member === member)
    return index >= 0 ? index : null
  }

  private zrange(key: string, args: string[]): string[] {
    const start = parseInt(args[0])
    const stop = parseInt(args[1])
    const withScores = args.some(a => a.toUpperCase() === 'WITHSCORES')
    const rev = args.some(a => a.toUpperCase() === 'REV')
    const byScore = args.some(a => a.toUpperCase() === 'BYSCORE')

    if (byScore) {
      return this.zrangebyscore(key, args)
    }

    const order = rev ? 'DESC' : 'ASC'
    const rows = this.sql.exec<{ member: string; score: number }>(
      `SELECT member, score FROM zset_members WHERE key = ? ORDER BY score ${order}, member ${order}`,
      key
    ).toArray()

    const len = rows.length
    let s = start < 0 ? Math.max(0, len + start) : start
    let e = stop < 0 ? len + stop : stop
    if (e >= len) e = len - 1

    const slice = rows.slice(s, e + 1)

    if (withScores) {
      const result: string[] = []
      for (const row of slice) {
        result.push(row.member, row.score.toString())
      }
      return result
    }

    return slice.map(r => r.member)
  }

  private zrevrange(key: string, start: number, stop: number, withScores: boolean): string[] {
    return this.zrange(key, [start.toString(), stop.toString(), 'REV', ...(withScores ? ['WITHSCORES'] : [])])
  }

  private zrangebyscore(key: string, args: string[]): string[] {
    let minArg = args[0]
    let maxArg = args[1]
    const withScores = args.some(a => a.toUpperCase() === 'WITHSCORES')

    // Parse min/max
    let min: number, max: number
    let minExclusive = false, maxExclusive = false

    if (minArg === '-inf') {
      min = -Infinity
    } else if (minArg.startsWith('(')) {
      min = parseFloat(minArg.slice(1))
      minExclusive = true
    } else {
      min = parseFloat(minArg)
    }

    if (maxArg === '+inf') {
      max = Infinity
    } else if (maxArg.startsWith('(')) {
      max = parseFloat(maxArg.slice(1))
      maxExclusive = true
    } else {
      max = parseFloat(maxArg)
    }

    const rows = this.sql.exec<{ member: string; score: number }>(
      'SELECT member, score FROM zset_members WHERE key = ? ORDER BY score, member',
      key
    ).toArray().filter(r => {
      if (minExclusive ? r.score <= min : r.score < min) return false
      if (maxExclusive ? r.score >= max : r.score > max) return false
      return true
    })

    if (withScores) {
      const result: string[] = []
      for (const row of rows) {
        result.push(row.member, row.score.toString())
      }
      return result
    }

    return rows.map(r => r.member)
  }

  private zcard(key: string): number {
    const row = this.sql.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM zset_members WHERE key = ?', key
    ).toArray()[0]
    return row?.count ?? 0
  }

  private zcount(key: string, min: string, max: string): number {
    const members = this.zrangebyscore(key, [min, max])
    return members.length
  }

  private zincrby(key: string, increment: number, member: string): string {
    const current = this.zscore(key, member)
    const newScore = (current ? parseFloat(current) : 0) + increment

    this.sql.exec(
      'INSERT OR REPLACE INTO zset_members (key, member, score) VALUES (?, ?, ?)',
      key, member, newScore
    )

    return newScore.toString()
  }

  private zpopmin(key: string, count: number): string[] {
    const rows = this.sql.exec<{ member: string; score: number }>(
      'SELECT member, score FROM zset_members WHERE key = ? ORDER BY score, member LIMIT ?',
      key, count
    ).toArray()

    for (const row of rows) {
      this.sql.exec(
        'DELETE FROM zset_members WHERE key = ? AND member = ?',
        key, row.member
      )
    }

    const result: string[] = []
    for (const row of rows) {
      result.push(row.member, row.score.toString())
    }
    return result
  }

  private zpopmax(key: string, count: number): string[] {
    const rows = this.sql.exec<{ member: string; score: number }>(
      'SELECT member, score FROM zset_members WHERE key = ? ORDER BY score DESC, member DESC LIMIT ?',
      key, count
    ).toArray()

    for (const row of rows) {
      this.sql.exec(
        'DELETE FROM zset_members WHERE key = ? AND member = ?',
        key, row.member
      )
    }

    const result: string[] = []
    for (const row of rows) {
      result.push(row.member, row.score.toString())
    }
    return result
  }

  // ===========================================================================
  // JSON COMMANDS
  // ===========================================================================

  private jsonGet(key: string, paths: string[]): string | null {
    const row = this.sql.exec<{ value: string }>(
      'SELECT value FROM kv WHERE key = ? AND type = ?',
      key, 'json'
    ).toArray()[0]

    if (!row) return null

    if (paths.length === 0 || (paths.length === 1 && paths[0] === '$')) {
      return row.value
    }

    try {
      const obj = JSON.parse(row.value)
      // Simple JSONPath implementation for common cases
      const path = paths[0]?.replace(/^\$\.?/, '') ?? ''
      if (!path) return row.value

      const parts = path.split('.')
      let current = obj
      for (const part of parts) {
        if (current === null || current === undefined) return null
        current = current[part]
      }
      return JSON.stringify(current)
    } catch {
      return null
    }
  }

  private jsonSet(key: string, path: string, value: string): string | null {
    if (path === '$') {
      this.sql.exec(
        `INSERT OR REPLACE INTO kv (key, value, type) VALUES (?, ?, 'json')`,
        key, value
      )
      return 'OK'
    }

    // Get existing value
    const existing = this.jsonGet(key, ['$'])
    let obj = existing ? JSON.parse(existing) : {}

    // Set nested path
    const parts = path.replace(/^\$\.?/, '').split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) {
        current[parts[i]] = {}
      }
      current = current[parts[i]]
    }

    current[parts[parts.length - 1]] = JSON.parse(value)

    this.sql.exec(
      `INSERT OR REPLACE INTO kv (key, value, type) VALUES (?, ?, 'json')`,
      key, JSON.stringify(obj)
    )

    return 'OK'
  }

  private jsonDel(key: string, path?: string): number {
    if (!path || path === '$') {
      const result = this.del([key])
      return result
    }

    // Delete nested path
    const existing = this.jsonGet(key, ['$'])
    if (!existing) return 0

    const obj = JSON.parse(existing)
    const parts = path.replace(/^\$\.?/, '').split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) return 0
      current = current[parts[i]]
    }

    if (!(parts[parts.length - 1] in current)) return 0
    delete current[parts[parts.length - 1]]

    this.sql.exec(
      `UPDATE kv SET value = ? WHERE key = ?`,
      JSON.stringify(obj), key
    )

    return 1
  }

  private jsonMget(args: string[]): (string | null)[] {
    const path = args[args.length - 1]
    const keys = args.slice(0, -1)
    return keys.map(key => this.jsonGet(key, [path]))
  }

  private jsonType(key: string, path?: string): string | null {
    const value = this.jsonGet(key, path ? [path] : ['$'])
    if (value === null) return null

    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return 'array'
      if (parsed === null) return 'null'
      return typeof parsed
    } catch {
      return 'string'
    }
  }

  private jsonStrlen(key: string, path?: string): number | null {
    const value = this.jsonGet(key, path ? [path] : ['$'])
    if (value === null) return null

    try {
      const parsed = JSON.parse(value)
      return typeof parsed === 'string' ? parsed.length : null
    } catch {
      return null
    }
  }

  private jsonArrlen(key: string, path?: string): number | null {
    const value = this.jsonGet(key, path ? [path] : ['$'])
    if (value === null) return null

    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.length : null
    } catch {
      return null
    }
  }

  private jsonArrappend(key: string, path: string, values: string[]): number | null {
    const existing = this.jsonGet(key, [path])
    if (existing === null) return null

    try {
      const arr = JSON.parse(existing)
      if (!Array.isArray(arr)) return null

      for (const v of values) {
        arr.push(JSON.parse(v))
      }

      this.jsonSet(key, path, JSON.stringify(arr))
      return arr.length
    } catch {
      return null
    }
  }

  private jsonObjkeys(key: string, path?: string): string[] | null {
    const value = this.jsonGet(key, path ? [path] : ['$'])
    if (value === null) return null

    try {
      const parsed = JSON.parse(value)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null
      }
      return Object.keys(parsed)
    } catch {
      return null
    }
  }

  // ===========================================================================
  // SERVER COMMANDS
  // ===========================================================================

  private dbsize(): number {
    const counts = [
      this.sql.exec<{ c: number }>('SELECT COUNT(*) as c FROM kv').toArray()[0]?.c ?? 0,
      this.sql.exec<{ c: number }>('SELECT COUNT(DISTINCT key) as c FROM hash_fields').toArray()[0]?.c ?? 0,
      this.sql.exec<{ c: number }>('SELECT COUNT(DISTINCT key) as c FROM list_items').toArray()[0]?.c ?? 0,
      this.sql.exec<{ c: number }>('SELECT COUNT(DISTINCT key) as c FROM set_members').toArray()[0]?.c ?? 0,
      this.sql.exec<{ c: number }>('SELECT COUNT(DISTINCT key) as c FROM zset_members').toArray()[0]?.c ?? 0,
    ]
    return counts.reduce((a, b) => a + b, 0)
  }

  private flushdb(): string {
    this.sql.exec('DELETE FROM kv')
    this.sql.exec('DELETE FROM hash_fields')
    this.sql.exec('DELETE FROM list_items')
    this.sql.exec('DELETE FROM set_members')
    this.sql.exec('DELETE FROM zset_members')
    return 'OK'
  }

  private info(section?: string): string {
    const dbSize = this.dbsize()
    return `# Server
redis_version:7.0.0 (dotdo-compat)
uptime_in_seconds:0

# Keyspace
db0:keys=${dbSize}
`
  }

  private time(): string[] {
    const now = Date.now()
    return [
      Math.floor(now / 1000).toString(),
      ((now % 1000) * 1000).toString()
    ]
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private parseSetOptions(args: string[]): SetOptions {
    const options: SetOptions = {}

    for (let i = 0; i < args.length; i++) {
      const opt = args[i]?.toUpperCase()
      switch (opt) {
        case 'EX': options.ex = parseInt(args[++i]); break
        case 'PX': options.px = parseInt(args[++i]); break
        case 'EXAT': options.exat = parseInt(args[++i]); break
        case 'PXAT': options.pxat = parseInt(args[++i]); break
        case 'NX': options.nx = true; break
        case 'XX': options.xx = true; break
        case 'GET': options.get = true; break
        case 'KEEPTTL': options.keepttl = true; break
      }
    }

    return options
  }

  private parseScanOptions(args: string[]): ScanOptions {
    const options: ScanOptions = {}

    for (let i = 0; i < args.length; i += 2) {
      const opt = args[i]?.toUpperCase()
      switch (opt) {
        case 'MATCH': options.match = args[i + 1]; break
        case 'COUNT': options.count = parseInt(args[i + 1]); break
        case 'TYPE': options.type = args[i + 1]; break
      }
    }

    return options
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now()
    this.sql.exec('DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?', now)
  }
}
