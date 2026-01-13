/**
 * Upstash-compatible SDK clients for Durable Objects
 *
 * Drop-in replacements for @upstash/redis, @upstash/qstash, and @upstash/ratelimit
 * that work with the DO-backed implementations.
 *
 * Usage:
 * ```typescript
 * import { Redis, QStash, Ratelimit } from './client'
 *
 * const redis = new Redis({ url: 'http://localhost:8787/redis' })
 * await redis.set('key', 'value')
 *
 * const qstash = new QStash({ url: 'http://localhost:8787/qstash' })
 * await qstash.publish({ url: 'https://example.com/webhook', body: { hello: 'world' } })
 *
 * const ratelimit = new Ratelimit({ url: 'http://localhost:8787/ratelimit' })
 * const { success } = await ratelimit.limit('user:123')
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

export interface RedisOptions {
  url: string
  token?: string
  automaticDeserialization?: boolean
}

export interface QStashOptions {
  url: string
  token?: string
}

export interface RatelimitOptions {
  url: string
  token?: string
  prefix?: string
  analytics?: boolean
}

export type RedisResult<T = unknown> = { result: T } | { error: string }

// ============================================================================
// REDIS CLIENT
// ============================================================================

/**
 * Redis - @upstash/redis compatible client
 *
 * Implements the Upstash Redis REST API client interface.
 */
export class Redis {
  private url: string
  private token?: string
  private autoDeserialize: boolean

  constructor(options: RedisOptions) {
    this.url = options.url.replace(/\/$/, '')
    this.token = options.token
    this.autoDeserialize = options.automaticDeserialization ?? true
  }

  private async request<T>(command: string[]): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify(command)
    })

    const data = await response.json() as RedisResult<T>

    if ('error' in data) {
      throw new Error(data.error)
    }

    return data.result
  }

  // Pipeline support
  pipeline(): Pipeline {
    return new Pipeline(this.url, this.token)
  }

  multi(): Pipeline {
    return this.pipeline()
  }

  // String commands
  async get<T = string>(key: string): Promise<T | null> {
    return this.request<T | null>(['GET', key])
  }

  async set(key: string, value: unknown, options?: {
    ex?: number
    px?: number
    exat?: number
    pxat?: number
    nx?: boolean
    xx?: boolean
    get?: boolean
    keepttl?: boolean
  }): Promise<string | null> {
    const args = ['SET', key, String(value)]

    if (options?.ex) args.push('EX', String(options.ex))
    if (options?.px) args.push('PX', String(options.px))
    if (options?.exat) args.push('EXAT', String(options.exat))
    if (options?.pxat) args.push('PXAT', String(options.pxat))
    if (options?.nx) args.push('NX')
    if (options?.xx) args.push('XX')
    if (options?.get) args.push('GET')
    if (options?.keepttl) args.push('KEEPTTL')

    return this.request<string | null>(args)
  }

  async setex(key: string, seconds: number, value: unknown): Promise<string> {
    return this.request<string>(['SETEX', key, String(seconds), String(value)])
  }

  async setnx(key: string, value: unknown): Promise<number> {
    return this.request<number>(['SETNX', key, String(value)])
  }

  async getset(key: string, value: unknown): Promise<string | null> {
    return this.request<string | null>(['GETSET', key, String(value)])
  }

  async getdel(key: string): Promise<string | null> {
    return this.request<string | null>(['GETDEL', key])
  }

  async mget<T = string>(...keys: string[]): Promise<(T | null)[]> {
    return this.request<(T | null)[]>(['MGET', ...keys])
  }

  async mset(keyValues: Record<string, unknown>): Promise<string> {
    const args = ['MSET']
    for (const [key, value] of Object.entries(keyValues)) {
      args.push(key, String(value))
    }
    return this.request<string>(args)
  }

  async incr(key: string): Promise<number> {
    return this.request<number>(['INCR', key])
  }

  async incrby(key: string, increment: number): Promise<number> {
    return this.request<number>(['INCRBY', key, String(increment)])
  }

  async incrbyfloat(key: string, increment: number): Promise<string> {
    return this.request<string>(['INCRBYFLOAT', key, String(increment)])
  }

  async decr(key: string): Promise<number> {
    return this.request<number>(['DECR', key])
  }

  async decrby(key: string, decrement: number): Promise<number> {
    return this.request<number>(['DECRBY', key, String(decrement)])
  }

  async append(key: string, value: string): Promise<number> {
    return this.request<number>(['APPEND', key, value])
  }

  async strlen(key: string): Promise<number> {
    return this.request<number>(['STRLEN', key])
  }

  async getrange(key: string, start: number, end: number): Promise<string> {
    return this.request<string>(['GETRANGE', key, String(start), String(end)])
  }

  async setrange(key: string, offset: number, value: string): Promise<number> {
    return this.request<number>(['SETRANGE', key, String(offset), value])
  }

  // Key commands
  async del(...keys: string[]): Promise<number> {
    return this.request<number>(['DEL', ...keys])
  }

  async exists(...keys: string[]): Promise<number> {
    return this.request<number>(['EXISTS', ...keys])
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.request<number>(['EXPIRE', key, String(seconds)])
  }

  async expireat(key: string, timestamp: number): Promise<number> {
    return this.request<number>(['EXPIREAT', key, String(timestamp)])
  }

  async pexpire(key: string, milliseconds: number): Promise<number> {
    return this.request<number>(['PEXPIRE', key, String(milliseconds)])
  }

  async pexpireat(key: string, timestamp: number): Promise<number> {
    return this.request<number>(['PEXPIREAT', key, String(timestamp)])
  }

  async ttl(key: string): Promise<number> {
    return this.request<number>(['TTL', key])
  }

  async pttl(key: string): Promise<number> {
    return this.request<number>(['PTTL', key])
  }

  async persist(key: string): Promise<number> {
    return this.request<number>(['PERSIST', key])
  }

  async type(key: string): Promise<string> {
    return this.request<string>(['TYPE', key])
  }

  async keys(pattern: string): Promise<string[]> {
    return this.request<string[]>(['KEYS', pattern])
  }

  async scan(cursor: number, options?: { match?: string; count?: number; type?: string }): Promise<[string, string[]]> {
    const args = ['SCAN', String(cursor)]
    if (options?.match) args.push('MATCH', options.match)
    if (options?.count) args.push('COUNT', String(options.count))
    if (options?.type) args.push('TYPE', options.type)
    return this.request<[string, string[]]>(args)
  }

  async rename(key: string, newKey: string): Promise<string> {
    return this.request<string>(['RENAME', key, newKey])
  }

  async renamenx(key: string, newKey: string): Promise<number> {
    return this.request<number>(['RENAMENX', key, newKey])
  }

  async randomkey(): Promise<string | null> {
    return this.request<string | null>(['RANDOMKEY'])
  }

  // Hash commands
  async hget<T = string>(key: string, field: string): Promise<T | null> {
    return this.request<T | null>(['HGET', key, field])
  }

  async hset(key: string, fieldOrValues: string | Record<string, unknown>, value?: unknown): Promise<number> {
    if (typeof fieldOrValues === 'object') {
      const args = ['HSET', key]
      for (const [f, v] of Object.entries(fieldOrValues)) {
        args.push(f, String(v))
      }
      return this.request<number>(args)
    }
    return this.request<number>(['HSET', key, fieldOrValues, String(value)])
  }

  async hsetnx(key: string, field: string, value: unknown): Promise<number> {
    return this.request<number>(['HSETNX', key, field, String(value)])
  }

  async hmget<T = string>(key: string, ...fields: string[]): Promise<(T | null)[]> {
    return this.request<(T | null)[]>(['HMGET', key, ...fields])
  }

  async hmset(key: string, fieldValues: Record<string, unknown>): Promise<string> {
    const args = ['HMSET', key]
    for (const [field, value] of Object.entries(fieldValues)) {
      args.push(field, String(value))
    }
    return this.request<string>(args)
  }

  async hgetall<T extends Record<string, string> = Record<string, string>>(key: string): Promise<T> {
    const result = await this.request<string[]>(['HGETALL', key])
    const obj: Record<string, string> = {}
    for (let i = 0; i < result.length; i += 2) {
      obj[result[i]] = result[i + 1]
    }
    return obj as T
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return this.request<number>(['HDEL', key, ...fields])
  }

  async hexists(key: string, field: string): Promise<number> {
    return this.request<number>(['HEXISTS', key, field])
  }

  async hkeys(key: string): Promise<string[]> {
    return this.request<string[]>(['HKEYS', key])
  }

  async hvals<T = string>(key: string): Promise<T[]> {
    return this.request<T[]>(['HVALS', key])
  }

  async hlen(key: string): Promise<number> {
    return this.request<number>(['HLEN', key])
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.request<number>(['HINCRBY', key, field, String(increment)])
  }

  async hincrbyfloat(key: string, field: string, increment: number): Promise<string> {
    return this.request<string>(['HINCRBYFLOAT', key, field, String(increment)])
  }

  // List commands
  async lpush(key: string, ...values: unknown[]): Promise<number> {
    return this.request<number>(['LPUSH', key, ...values.map(String)])
  }

  async rpush(key: string, ...values: unknown[]): Promise<number> {
    return this.request<number>(['RPUSH', key, ...values.map(String)])
  }

  async lpop<T = string>(key: string, count?: number): Promise<T | T[] | null> {
    const args = ['LPOP', key]
    if (count) args.push(String(count))
    return this.request<T | T[] | null>(args)
  }

  async rpop<T = string>(key: string, count?: number): Promise<T | T[] | null> {
    const args = ['RPOP', key]
    if (count) args.push(String(count))
    return this.request<T | T[] | null>(args)
  }

  async lrange<T = string>(key: string, start: number, stop: number): Promise<T[]> {
    return this.request<T[]>(['LRANGE', key, String(start), String(stop)])
  }

  async llen(key: string): Promise<number> {
    return this.request<number>(['LLEN', key])
  }

  async lindex<T = string>(key: string, index: number): Promise<T | null> {
    return this.request<T | null>(['LINDEX', key, String(index)])
  }

  async lset(key: string, index: number, value: unknown): Promise<string> {
    return this.request<string>(['LSET', key, String(index), String(value)])
  }

  async lrem(key: string, count: number, value: unknown): Promise<number> {
    return this.request<number>(['LREM', key, String(count), String(value)])
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    return this.request<string>(['LTRIM', key, String(start), String(stop)])
  }

  // Set commands
  async sadd(key: string, ...members: unknown[]): Promise<number> {
    return this.request<number>(['SADD', key, ...members.map(String)])
  }

  async srem(key: string, ...members: unknown[]): Promise<number> {
    return this.request<number>(['SREM', key, ...members.map(String)])
  }

  async smembers<T = string>(key: string): Promise<T[]> {
    return this.request<T[]>(['SMEMBERS', key])
  }

  async sismember(key: string, member: unknown): Promise<number> {
    return this.request<number>(['SISMEMBER', key, String(member)])
  }

  async smismember(key: string, ...members: unknown[]): Promise<number[]> {
    return this.request<number[]>(['SMISMEMBER', key, ...members.map(String)])
  }

  async scard(key: string): Promise<number> {
    return this.request<number>(['SCARD', key])
  }

  async sinter<T = string>(...keys: string[]): Promise<T[]> {
    return this.request<T[]>(['SINTER', ...keys])
  }

  async sunion<T = string>(...keys: string[]): Promise<T[]> {
    return this.request<T[]>(['SUNION', ...keys])
  }

  async sdiff<T = string>(...keys: string[]): Promise<T[]> {
    return this.request<T[]>(['SDIFF', ...keys])
  }

  async srandmember<T = string>(key: string, count?: number): Promise<T | T[] | null> {
    const args = ['SRANDMEMBER', key]
    if (count) args.push(String(count))
    return this.request<T | T[] | null>(args)
  }

  async spop<T = string>(key: string, count?: number): Promise<T | T[] | null> {
    const args = ['SPOP', key]
    if (count) args.push(String(count))
    return this.request<T | T[] | null>(args)
  }

  // Sorted set commands
  async zadd(key: string, scoreOrOptions: number | { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean; ch?: boolean; incr?: boolean }, memberOrScore?: unknown, member?: unknown): Promise<number | string> {
    if (typeof scoreOrOptions === 'number') {
      return this.request<number>(['ZADD', key, String(scoreOrOptions), String(memberOrScore)])
    }

    const args = ['ZADD', key]
    if (scoreOrOptions.nx) args.push('NX')
    if (scoreOrOptions.xx) args.push('XX')
    if (scoreOrOptions.gt) args.push('GT')
    if (scoreOrOptions.lt) args.push('LT')
    if (scoreOrOptions.ch) args.push('CH')
    if (scoreOrOptions.incr) args.push('INCR')
    args.push(String(memberOrScore), String(member))

    return this.request<number | string>(args)
  }

  async zrem(key: string, ...members: unknown[]): Promise<number> {
    return this.request<number>(['ZREM', key, ...members.map(String)])
  }

  async zscore(key: string, member: unknown): Promise<string | null> {
    return this.request<string | null>(['ZSCORE', key, String(member)])
  }

  async zrank(key: string, member: unknown): Promise<number | null> {
    return this.request<number | null>(['ZRANK', key, String(member)])
  }

  async zrevrank(key: string, member: unknown): Promise<number | null> {
    return this.request<number | null>(['ZREVRANK', key, String(member)])
  }

  async zrange<T = string>(key: string, start: number, stop: number, options?: { withScores?: boolean; rev?: boolean; byScore?: boolean }): Promise<T[]> {
    const args = ['ZRANGE', key, String(start), String(stop)]
    if (options?.rev) args.push('REV')
    if (options?.byScore) args.push('BYSCORE')
    if (options?.withScores) args.push('WITHSCORES')
    return this.request<T[]>(args)
  }

  async zrevrange<T = string>(key: string, start: number, stop: number, withScores?: boolean): Promise<T[]> {
    const args = ['ZREVRANGE', key, String(start), String(stop)]
    if (withScores) args.push('WITHSCORES')
    return this.request<T[]>(args)
  }

  async zrangebyscore<T = string>(key: string, min: number | string, max: number | string, options?: { withScores?: boolean; limit?: { offset: number; count: number } }): Promise<T[]> {
    const args = ['ZRANGEBYSCORE', key, String(min), String(max)]
    if (options?.withScores) args.push('WITHSCORES')
    if (options?.limit) args.push('LIMIT', String(options.limit.offset), String(options.limit.count))
    return this.request<T[]>(args)
  }

  async zcard(key: string): Promise<number> {
    return this.request<number>(['ZCARD', key])
  }

  async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    return this.request<number>(['ZCOUNT', key, String(min), String(max)])
  }

  async zincrby(key: string, increment: number, member: unknown): Promise<string> {
    return this.request<string>(['ZINCRBY', key, String(increment), String(member)])
  }

  async zpopmin<T = string>(key: string, count?: number): Promise<T[]> {
    const args = ['ZPOPMIN', key]
    if (count) args.push(String(count))
    return this.request<T[]>(args)
  }

  async zpopmax<T = string>(key: string, count?: number): Promise<T[]> {
    const args = ['ZPOPMAX', key]
    if (count) args.push(String(count))
    return this.request<T[]>(args)
  }

  // JSON commands
  async json = {
    get: async <T = unknown>(key: string, path?: string): Promise<T | null> => {
      const args = ['JSON.GET', key]
      if (path) args.push(path)
      const result = await this.request<string | null>(args)
      return result ? JSON.parse(result) : null
    },

    set: async (key: string, path: string, value: unknown): Promise<string | null> => {
      return this.request<string | null>(['JSON.SET', key, path, JSON.stringify(value)])
    },

    del: async (key: string, path?: string): Promise<number> => {
      const args = ['JSON.DEL', key]
      if (path) args.push(path)
      return this.request<number>(args)
    },

    mget: async <T = unknown>(keys: string[], path: string): Promise<(T | null)[]> => {
      const results = await this.request<(string | null)[]>(['JSON.MGET', ...keys, path])
      return results.map(r => r ? JSON.parse(r) : null)
    },

    type: async (key: string, path?: string): Promise<string | null> => {
      const args = ['JSON.TYPE', key]
      if (path) args.push(path)
      return this.request<string | null>(args)
    },

    strlen: async (key: string, path?: string): Promise<number | null> => {
      const args = ['JSON.STRLEN', key]
      if (path) args.push(path)
      return this.request<number | null>(args)
    },

    arrlen: async (key: string, path?: string): Promise<number | null> => {
      const args = ['JSON.ARRLEN', key]
      if (path) args.push(path)
      return this.request<number | null>(args)
    },

    arrappend: async (key: string, path: string, ...values: unknown[]): Promise<number | null> => {
      return this.request<number | null>(['JSON.ARRAPPEND', key, path, ...values.map(v => JSON.stringify(v))])
    },

    objkeys: async (key: string, path?: string): Promise<string[] | null> => {
      const args = ['JSON.OBJKEYS', key]
      if (path) args.push(path)
      return this.request<string[] | null>(args)
    }
  }

  // Server commands
  async ping(message?: string): Promise<string> {
    const args = ['PING']
    if (message) args.push(message)
    return this.request<string>(args)
  }

  async echo(message: string): Promise<string> {
    return this.request<string>(['ECHO', message])
  }

  async dbsize(): Promise<number> {
    return this.request<number>(['DBSIZE'])
  }

  async flushdb(): Promise<string> {
    return this.request<string>(['FLUSHDB'])
  }

  async flushall(): Promise<string> {
    return this.request<string>(['FLUSHALL'])
  }

  async info(section?: string): Promise<string> {
    const args = ['INFO']
    if (section) args.push(section)
    return this.request<string>(args)
  }

  async time(): Promise<[string, string]> {
    return this.request<[string, string]>(['TIME'])
  }
}

/**
 * Pipeline for batch commands
 */
class Pipeline {
  private commands: string[][] = []
  private url: string
  private token?: string

  constructor(url: string, token?: string) {
    this.url = url
    this.token = token
  }

  private add(command: string[]): this {
    this.commands.push(command)
    return this
  }

  // Add all Redis methods that return Pipeline for chaining
  get(key: string) { return this.add(['GET', key]) }
  set(key: string, value: unknown, options?: { ex?: number; px?: number; nx?: boolean; xx?: boolean }) {
    const args = ['SET', key, String(value)]
    if (options?.ex) args.push('EX', String(options.ex))
    if (options?.px) args.push('PX', String(options.px))
    if (options?.nx) args.push('NX')
    if (options?.xx) args.push('XX')
    return this.add(args)
  }
  del(...keys: string[]) { return this.add(['DEL', ...keys]) }
  incr(key: string) { return this.add(['INCR', key]) }
  decr(key: string) { return this.add(['DECR', key]) }
  hget(key: string, field: string) { return this.add(['HGET', key, field]) }
  hset(key: string, field: string, value: unknown) { return this.add(['HSET', key, field, String(value)]) }
  lpush(key: string, ...values: unknown[]) { return this.add(['LPUSH', key, ...values.map(String)]) }
  rpush(key: string, ...values: unknown[]) { return this.add(['RPUSH', key, ...values.map(String)]) }
  sadd(key: string, ...members: unknown[]) { return this.add(['SADD', key, ...members.map(String)]) }
  zadd(key: string, score: number, member: unknown) { return this.add(['ZADD', key, String(score), String(member)]) }

  async exec<T = unknown[]>(): Promise<T> {
    const response = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify(this.commands)
    })

    const results = await response.json() as RedisResult<unknown>[]
    return results.map(r => 'error' in r ? null : r.result) as T
  }
}

// ============================================================================
// QSTASH CLIENT
// ============================================================================

/**
 * QStash - @upstash/qstash compatible client
 */
export class QStash {
  private url: string
  private token?: string

  constructor(options: QStashOptions) {
    this.url = options.url.replace(/\/$/, '')
    this.token = options.token
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...options.headers
      }
    })

    if (!response.ok) {
      const error = await response.json() as { error: string }
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  }

  /**
   * Publish a message to a destination
   */
  async publish(options: {
    url?: string
    topic?: string
    body?: unknown
    headers?: Record<string, string>
    delay?: number
    retries?: number
    callback?: string
    failureCallback?: string
    deduplicationId?: string
    contentBasedDeduplication?: boolean
    method?: string
  }): Promise<{ messageId: string; deduplicated?: boolean }> {
    const destination = options.url ?? options.topic
    if (!destination) {
      throw new Error('url or topic is required')
    }

    const headers: Record<string, string> = { ...options.headers }

    if (options.delay) headers['Upstash-Delay'] = String(options.delay)
    if (options.retries) headers['Upstash-Retries'] = String(options.retries)
    if (options.callback) headers['Upstash-Callback'] = options.callback
    if (options.failureCallback) headers['Upstash-Failure-Callback'] = options.failureCallback
    if (options.deduplicationId) headers['Upstash-Deduplication-Id'] = options.deduplicationId
    if (options.contentBasedDeduplication) headers['Upstash-Content-Based-Deduplication'] = 'true'
    if (options.method) headers['Upstash-Method'] = options.method

    return this.request<{ messageId: string; deduplicated?: boolean }>(
      `/v2/publish/${encodeURIComponent(destination)}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(options.body)
      }
    )
  }

  /**
   * Publish JSON message
   */
  async publishJSON<T>(options: {
    url?: string
    topic?: string
    body: T
    headers?: Record<string, string>
    delay?: number
    retries?: number
    callback?: string
    failureCallback?: string
  }): Promise<{ messageId: string }> {
    return this.publish({
      ...options,
      headers: { ...options.headers, 'Content-Type': 'application/json' }
    })
  }

  /**
   * Create a schedule
   */
  async schedules = {
    create: async (options: {
      destination: string
      cron: string
      body?: unknown
      headers?: Record<string, string>
      retries?: number
    }) => {
      return this.request<{ scheduleId: string; nextRun: string }>('/v2/schedules', {
        method: 'POST',
        body: JSON.stringify(options)
      })
    },

    get: async (scheduleId: string) => {
      return this.request<any>(`/v2/schedules/${scheduleId}`)
    },

    list: async () => {
      return this.request<{ schedules: any[] }>('/v2/schedules')
    },

    delete: async (scheduleId: string) => {
      return this.request<{ success: boolean }>(`/v2/schedules/${scheduleId}`, {
        method: 'DELETE'
      })
    },

    pause: async (scheduleId: string) => {
      return this.request<{ success: boolean }>(`/v2/schedules/${scheduleId}/pause`, {
        method: 'POST'
      })
    },

    resume: async (scheduleId: string) => {
      return this.request<{ success: boolean; nextRun: string }>(`/v2/schedules/${scheduleId}/resume`, {
        method: 'POST'
      })
    }
  }

  /**
   * Topics management
   */
  async topics = {
    create: async (name: string, endpoints?: string[]) => {
      return this.request<{ name: string; endpoints: string[] }>('/v2/topics', {
        method: 'POST',
        body: JSON.stringify({ name, endpoints })
      })
    },

    get: async (name: string) => {
      return this.request<any>(`/v2/topics/${encodeURIComponent(name)}`)
    },

    list: async () => {
      return this.request<{ topics: any[] }>('/v2/topics')
    },

    delete: async (name: string) => {
      return this.request<{ success: boolean }>(`/v2/topics/${encodeURIComponent(name)}`, {
        method: 'DELETE'
      })
    },

    addEndpoint: async (name: string, endpoint: string) => {
      return this.request<{ success: boolean; endpoints: string[] }>(
        `/v2/topics/${encodeURIComponent(name)}/endpoints`,
        {
          method: 'POST',
          body: JSON.stringify({ endpoint })
        }
      )
    },

    removeEndpoint: async (name: string, endpoint: string) => {
      return this.request<{ success: boolean; endpoints: string[] }>(
        `/v2/topics/${encodeURIComponent(name)}/endpoints`,
        {
          method: 'DELETE',
          body: JSON.stringify({ endpoint })
        }
      )
    }
  }

  /**
   * Dead letter queue management
   */
  async dlq = {
    list: async (options?: { limit?: number; cursor?: string }) => {
      const params = new URLSearchParams()
      if (options?.limit) params.set('limit', String(options.limit))
      if (options?.cursor) params.set('cursor', options.cursor)
      return this.request<{ deadLetters: any[]; cursor?: string }>(`/v2/dlq?${params}`)
    },

    get: async (id: string) => {
      return this.request<any>(`/v2/dlq/${id}`)
    },

    retry: async (id: string) => {
      return this.request<{ messageId: string }>(`/v2/dlq/${id}/retry`, {
        method: 'POST'
      })
    },

    delete: async (id: string) => {
      return this.request<{ success: boolean }>(`/v2/dlq/${id}`, {
        method: 'DELETE'
      })
    },

    purge: async () => {
      return this.request<{ success: boolean }>('/v2/dlq', {
        method: 'DELETE'
      })
    }
  }

  /**
   * Message management
   */
  async messages = {
    get: async (messageId: string) => {
      return this.request<any>(`/v2/messages/${messageId}`)
    },

    list: async (options?: { limit?: number; cursor?: string; status?: string }) => {
      const params = new URLSearchParams()
      if (options?.limit) params.set('limit', String(options.limit))
      if (options?.cursor) params.set('cursor', options.cursor)
      if (options?.status) params.set('status', options.status)
      return this.request<{ messages: any[]; cursor?: string }>(`/v2/messages?${params}`)
    },

    cancel: async (messageId: string) => {
      return this.request<{ success: boolean }>(`/v2/messages/${messageId}`, {
        method: 'DELETE'
      })
    }
  }
}

// ============================================================================
// RATELIMIT CLIENT
// ============================================================================

export interface LimitResponse {
  success: boolean
  limit: number
  remaining: number
  reset: number
  retryAfter?: number
}

/**
 * Ratelimit - @upstash/ratelimit compatible client
 */
export class Ratelimit {
  private url: string
  private token?: string
  private prefix: string
  private analytics: boolean

  constructor(options: RatelimitOptions) {
    this.url = options.url.replace(/\/$/, '')
    this.token = options.token
    this.prefix = options.prefix ?? ''
    this.analytics = options.analytics ?? false
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...options.headers
      }
    })

    return response.json()
  }

  /**
   * Check rate limit for an identifier
   */
  async limit(identifier: string, options?: {
    cost?: number
    algorithm?: 'fixedWindow' | 'slidingWindow' | 'tokenBucket'
    limit?: number
    window?: number
    windowUnit?: 's' | 'ms' | 'm' | 'h' | 'd'
    maxTokens?: number
    refillRate?: number
    refillInterval?: number
  }): Promise<LimitResponse> {
    const id = this.prefix ? `${this.prefix}:${identifier}` : identifier

    return this.request<LimitResponse>('/limit', {
      method: 'POST',
      body: JSON.stringify({
        identifier: id,
        ...options
      })
    })
  }

  /**
   * Block an identifier for a duration
   */
  async blockUntil(identifier: string, duration: number): Promise<{ blockedUntil: number }> {
    const id = this.prefix ? `${this.prefix}:${identifier}` : identifier

    return this.request<{ blockedUntil: number }>('/limit/block', {
      method: 'POST',
      body: JSON.stringify({ identifier: id, duration })
    })
  }

  /**
   * Reset rate limit for an identifier
   */
  async reset(identifier: string): Promise<{ success: boolean }> {
    const id = this.prefix ? `${this.prefix}:${identifier}` : identifier

    return this.request<{ success: boolean }>(`/limit/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  }

  /**
   * Get current state for an identifier
   */
  async getRemaining(identifier: string, options?: {
    algorithm?: 'fixedWindow' | 'slidingWindow' | 'tokenBucket'
    limit?: number
    window?: number
    windowUnit?: 's' | 'ms' | 'm' | 'h' | 'd'
    maxTokens?: number
    refillRate?: number
    refillInterval?: number
  }): Promise<number> {
    const id = this.prefix ? `${this.prefix}:${identifier}` : identifier
    const params = new URLSearchParams()

    if (options?.algorithm) params.set('algorithm', options.algorithm)
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.window) params.set('window', String(options.window))
    if (options?.windowUnit) params.set('windowUnit', options.windowUnit)
    if (options?.maxTokens) params.set('maxTokens', String(options.maxTokens))
    if (options?.refillRate) params.set('refillRate', String(options.refillRate))
    if (options?.refillInterval) params.set('refillInterval', String(options.refillInterval))

    const state = await this.request<{ remaining: number }>(`/limit/${encodeURIComponent(id)}?${params}`)
    return state.remaining
  }

  /**
   * Create rate limit algorithms (static factory methods)
   */
  static fixedWindow(requests: number, window: string): RatelimitConfig {
    const { value, unit } = parseWindow(window)
    return {
      algorithm: 'fixedWindow',
      limit: requests,
      window: value,
      windowUnit: unit
    }
  }

  static slidingWindow(requests: number, window: string): RatelimitConfig {
    const { value, unit } = parseWindow(window)
    return {
      algorithm: 'slidingWindow',
      limit: requests,
      window: value,
      windowUnit: unit
    }
  }

  static tokenBucket(maxTokens: number, refillRate: number, interval: string): RatelimitConfig {
    const { value, unit } = parseWindow(interval)
    const intervalMs = value * (unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000)

    return {
      algorithm: 'tokenBucket',
      maxTokens,
      refillRate,
      refillInterval: intervalMs
    }
  }
}

interface RatelimitConfig {
  algorithm: 'fixedWindow' | 'slidingWindow' | 'tokenBucket'
  limit?: number
  window?: number
  windowUnit?: 's' | 'ms' | 'm' | 'h' | 'd'
  maxTokens?: number
  refillRate?: number
  refillInterval?: number
}

function parseWindow(window: string): { value: number; unit: 's' | 'ms' | 'm' | 'h' | 'd' } {
  const match = window.match(/^(\d+)\s*(ms|s|m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid window format: ${window}`)
  }
  return {
    value: parseInt(match[1]),
    unit: match[2] as 's' | 'ms' | 'm' | 'h' | 'd'
  }
}
