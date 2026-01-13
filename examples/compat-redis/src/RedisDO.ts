/**
 * RedisDO - Redis-compatible Durable Object
 *
 * Implements Redis commands with SQLite storage and WebSocket pub/sub
 */

import { Hono } from 'hono'
import { RedisStorage } from './storage'
import {
  StringCommands,
  HashCommands,
  ListCommands,
  SetCommands,
  SortedSetCommands,
  KeyCommands,
  PubSubCommands,
  type ZSetMember,
} from './commands'
import { parseCommand, encodeRESP, encodeError, encodeOK, encodePong, encodeSimpleString } from './protocol'

export class RedisDO implements DurableObject {
  private storage: RedisStorage
  private strings: StringCommands
  private hashes: HashCommands
  private lists: ListCommands
  private sets: SetCommands
  private sortedSets: SortedSetCommands
  private keys: KeyCommands
  private pubsub: PubSubCommands
  private app: Hono

  constructor(private state: DurableObjectState, _env: unknown) {
    this.storage = new RedisStorage(state)
    this.strings = new StringCommands(this.storage)
    this.hashes = new HashCommands(this.storage)
    this.lists = new ListCommands(this.storage)
    this.sets = new SetCommands(this.storage)
    this.sortedSets = new SortedSetCommands(this.storage)
    this.keys = new KeyCommands(this.storage)
    this.pubsub = new PubSubCommands(this.storage)

    // Initialize storage
    state.blockConcurrencyWhile(async () => {
      await this.storage.init()
    })

    // Setup HTTP routes
    this.app = new Hono()
    this.setupRoutes()
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (c) => c.json({ status: 'ok' }))

    // Stats
    this.app.get('/stats', async (c) => {
      const stats = await this.storage.stats()
      return c.json(stats)
    })

    // Redis command endpoint (POST JSON)
    this.app.post('/command', async (c) => {
      const body = await c.req.json<{ command: string; args?: string[] }>()
      const result = await this.executeCommand(body.command.toUpperCase(), body.args ?? [])
      return c.json({ result })
    })

    // Redis protocol endpoint (POST raw RESP)
    this.app.post('/redis', async (c) => {
      const body = await c.req.text()
      const [command, ...args] = parseCommand(body)
      const result = await this.executeCommand(command.toUpperCase(), args)
      return new Response(encodeRESP(result), {
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    })

    // REST-style endpoints for each data type
    this.setupRestRoutes()
  }

  private setupRestRoutes(): void {
    // String operations
    this.app.get('/string/:key', async (c) => {
      const value = await this.strings.get(c.req.param('key'))
      if (value === null) return c.json({ value: null }, 404)
      return c.json({ value })
    })

    this.app.put('/string/:key', async (c) => {
      const body = await c.req.json<{ value: string; ex?: number; px?: number }>()
      await this.strings.set(c.req.param('key'), body.value, { ex: body.ex, px: body.px })
      return c.json({ ok: true })
    })

    // Hash operations
    this.app.get('/hash/:key', async (c) => {
      const value = await this.hashes.hgetall(c.req.param('key'))
      return c.json({ value })
    })

    this.app.get('/hash/:key/:field', async (c) => {
      const value = await this.hashes.hget(c.req.param('key'), c.req.param('field'))
      if (value === null) return c.json({ value: null }, 404)
      return c.json({ value })
    })

    this.app.put('/hash/:key/:field', async (c) => {
      const body = await c.req.json<{ value: string }>()
      await this.hashes.hset(c.req.param('key'), [[c.req.param('field'), body.value]])
      return c.json({ ok: true })
    })

    // List operations
    this.app.get('/list/:key', async (c) => {
      const start = parseInt(c.req.query('start') ?? '0', 10)
      const stop = parseInt(c.req.query('stop') ?? '-1', 10)
      const value = await this.lists.lrange(c.req.param('key'), start, stop)
      return c.json({ value })
    })

    this.app.post('/list/:key/lpush', async (c) => {
      const body = await c.req.json<{ values: string[] }>()
      const length = await this.lists.lpush(c.req.param('key'), body.values)
      return c.json({ length })
    })

    this.app.post('/list/:key/rpush', async (c) => {
      const body = await c.req.json<{ values: string[] }>()
      const length = await this.lists.rpush(c.req.param('key'), body.values)
      return c.json({ length })
    })

    // Set operations
    this.app.get('/set/:key', async (c) => {
      const value = await this.sets.smembers(c.req.param('key'))
      return c.json({ value })
    })

    this.app.post('/set/:key/add', async (c) => {
      const body = await c.req.json<{ members: string[] }>()
      const added = await this.sets.sadd(c.req.param('key'), body.members)
      return c.json({ added })
    })

    // Sorted set operations
    this.app.get('/zset/:key', async (c) => {
      const start = parseInt(c.req.query('start') ?? '0', 10)
      const stop = parseInt(c.req.query('stop') ?? '-1', 10)
      const withscores = c.req.query('withscores') === 'true'
      const value = await this.sortedSets.zrange(c.req.param('key'), start, stop, { withscores })
      return c.json({ value })
    })

    this.app.post('/zset/:key/add', async (c) => {
      const body = await c.req.json<{ members: Array<{ member: string; score: number }> }>()
      const added = await this.sortedSets.zadd(c.req.param('key'), body.members)
      return c.json({ added })
    })

    // Key operations
    this.app.delete('/key/:key', async (c) => {
      const deleted = await this.keys.del([c.req.param('key')])
      return c.json({ deleted })
    })

    this.app.get('/keys', async (c) => {
      const pattern = c.req.query('pattern') ?? '*'
      const keys = await this.keys.keys(pattern)
      return c.json({ keys })
    })
  }

  /**
   * Execute a Redis command
   */
  async executeCommand(command: string, args: string[]): Promise<unknown> {
    try {
      switch (command) {
        // Connection commands
        case 'PING':
          return args[0] ?? 'PONG'
        case 'ECHO':
          return args[0]
        case 'QUIT':
          return 'OK'

        // String commands
        case 'GET':
          return await this.strings.get(args[0])
        case 'SET':
          return await this.parseSetCommand(args)
        case 'MGET':
          return await this.strings.mget(args)
        case 'MSET':
          return await this.strings.mset(this.pairArgs(args))
        case 'INCR':
          return await this.strings.incr(args[0])
        case 'INCRBY':
          return await this.strings.incrby(args[0], parseInt(args[1], 10))
        case 'INCRBYFLOAT':
          return await this.strings.incrbyfloat(args[0], parseFloat(args[1]))
        case 'DECR':
          return await this.strings.decr(args[0])
        case 'DECRBY':
          return await this.strings.decrby(args[0], parseInt(args[1], 10))
        case 'APPEND':
          return await this.strings.append(args[0], args[1])
        case 'STRLEN':
          return await this.strings.strlen(args[0])
        case 'GETSET':
          return await this.strings.getset(args[0], args[1])
        case 'SETNX':
          return await this.strings.setnx(args[0], args[1])
        case 'SETEX':
          return await this.strings.setex(args[0], parseInt(args[1], 10), args[2])
        case 'PSETEX':
          return await this.strings.psetex(args[0], parseInt(args[1], 10), args[2])
        case 'GETRANGE':
          return await this.strings.getrange(args[0], parseInt(args[1], 10), parseInt(args[2], 10))
        case 'SETRANGE':
          return await this.strings.setrange(args[0], parseInt(args[1], 10), args[2])

        // Hash commands
        case 'HGET':
          return await this.hashes.hget(args[0], args[1])
        case 'HSET':
          return await this.hashes.hset(args[0], this.pairArgs(args.slice(1)))
        case 'HSETNX':
          return await this.hashes.hsetnx(args[0], args[1], args[2])
        case 'HMGET':
          return await this.hashes.hmget(args[0], args.slice(1))
        case 'HMSET':
          return await this.hashes.hmset(args[0], this.pairArgs(args.slice(1)))
        case 'HGETALL':
          const hash = await this.hashes.hgetall(args[0])
          return this.flattenHash(hash)
        case 'HDEL':
          return await this.hashes.hdel(args[0], args.slice(1))
        case 'HEXISTS':
          return await this.hashes.hexists(args[0], args[1])
        case 'HLEN':
          return await this.hashes.hlen(args[0])
        case 'HKEYS':
          return await this.hashes.hkeys(args[0])
        case 'HVALS':
          return await this.hashes.hvals(args[0])
        case 'HINCRBY':
          return await this.hashes.hincrby(args[0], args[1], parseInt(args[2], 10))
        case 'HINCRBYFLOAT':
          return await this.hashes.hincrbyfloat(args[0], args[1], parseFloat(args[2]))
        case 'HSTRLEN':
          return await this.hashes.hstrlen(args[0], args[1])

        // List commands
        case 'LPUSH':
          return await this.lists.lpush(args[0], args.slice(1))
        case 'LPUSHX':
          return await this.lists.lpushx(args[0], args.slice(1))
        case 'RPUSH':
          return await this.lists.rpush(args[0], args.slice(1))
        case 'RPUSHX':
          return await this.lists.rpushx(args[0], args.slice(1))
        case 'LPOP':
          return await this.lists.lpop(args[0], args[1] ? parseInt(args[1], 10) : undefined)
        case 'RPOP':
          return await this.lists.rpop(args[0], args[1] ? parseInt(args[1], 10) : undefined)
        case 'LRANGE':
          return await this.lists.lrange(args[0], parseInt(args[1], 10), parseInt(args[2], 10))
        case 'LLEN':
          return await this.lists.llen(args[0])
        case 'LINDEX':
          return await this.lists.lindex(args[0], parseInt(args[1], 10))
        case 'LSET':
          return await this.lists.lset(args[0], parseInt(args[1], 10), args[2])
        case 'LREM':
          return await this.lists.lrem(args[0], parseInt(args[1], 10), args[2])
        case 'LTRIM':
          return await this.lists.ltrim(args[0], parseInt(args[1], 10), parseInt(args[2], 10))
        case 'LINSERT':
          return await this.lists.linsert(args[0], args[1].toUpperCase() as 'BEFORE' | 'AFTER', args[2], args[3])

        // Set commands
        case 'SADD':
          return await this.sets.sadd(args[0], args.slice(1))
        case 'SREM':
          return await this.sets.srem(args[0], args.slice(1))
        case 'SMEMBERS':
          return await this.sets.smembers(args[0])
        case 'SISMEMBER':
          return await this.sets.sismember(args[0], args[1])
        case 'SMISMEMBER':
          return await this.sets.smismember(args[0], args.slice(1))
        case 'SCARD':
          return await this.sets.scard(args[0])
        case 'SPOP':
          return await this.sets.spop(args[0], args[1] ? parseInt(args[1], 10) : undefined)
        case 'SRANDMEMBER':
          return await this.sets.srandmember(args[0], args[1] ? parseInt(args[1], 10) : undefined)
        case 'SDIFF':
          return await this.sets.sdiff(args)
        case 'SDIFFSTORE':
          return await this.sets.sdiffstore(args[0], args.slice(1))
        case 'SINTER':
          return await this.sets.sinter(args)
        case 'SINTERSTORE':
          return await this.sets.sinterstore(args[0], args.slice(1))
        case 'SUNION':
          return await this.sets.sunion(args)
        case 'SUNIONSTORE':
          return await this.sets.sunionstore(args[0], args.slice(1))
        case 'SMOVE':
          return await this.sets.smove(args[0], args[1], args[2])
        case 'SSCAN':
          return await this.parseScanCommand(args, 'set')

        // Sorted set commands
        case 'ZADD':
          return await this.parseZaddCommand(args)
        case 'ZREM':
          return await this.sortedSets.zrem(args[0], args.slice(1))
        case 'ZRANGE':
          return await this.parseZrangeCommand(args)
        case 'ZREVRANGE':
          return await this.sortedSets.zrevrange(
            args[0],
            parseInt(args[1], 10),
            parseInt(args[2], 10),
            args.includes('WITHSCORES')
          )
        case 'ZRANGEBYSCORE':
          return await this.parseZrangebyscoreCommand(args)
        case 'ZREVRANGEBYSCORE':
          return await this.parseZrevrangebyscoreCommand(args)
        case 'ZRANK':
          return await this.sortedSets.zrank(args[0], args[1])
        case 'ZREVRANK':
          return await this.sortedSets.zrevrank(args[0], args[1])
        case 'ZSCORE':
          return await this.sortedSets.zscore(args[0], args[1])
        case 'ZMSCORE':
          return await this.sortedSets.zmscore(args[0], args.slice(1))
        case 'ZCARD':
          return await this.sortedSets.zcard(args[0])
        case 'ZCOUNT':
          return await this.sortedSets.zcount(args[0], args[1], args[2])
        case 'ZLEXCOUNT':
          return await this.sortedSets.zlexcount(args[0], args[1], args[2])
        case 'ZINCRBY':
          return await this.sortedSets.zincrby(args[0], parseFloat(args[1]), args[2])
        case 'ZPOPMIN':
          const zpopminResult = await this.sortedSets.zpopmin(args[0], args[1] ? parseInt(args[1], 10) : undefined)
          return this.flattenZSetResult(zpopminResult)
        case 'ZPOPMAX':
          const zpopmaxResult = await this.sortedSets.zpopmax(args[0], args[1] ? parseInt(args[1], 10) : undefined)
          return this.flattenZSetResult(zpopmaxResult)
        case 'ZREMRANGEBYRANK':
          return await this.sortedSets.zremrangebyrank(args[0], parseInt(args[1], 10), parseInt(args[2], 10))
        case 'ZREMRANGEBYSCORE':
          return await this.sortedSets.zremrangebyscore(args[0], args[1], args[2])
        case 'ZSCAN':
          return await this.parseScanCommand(args, 'zset')

        // Key commands
        case 'DEL':
          return await this.keys.del(args)
        case 'UNLINK':
          return await this.keys.unlink(args)
        case 'EXISTS':
          return await this.keys.exists(args)
        case 'EXPIRE':
          return await this.parseExpireCommand(args)
        case 'EXPIREAT':
          return await this.keys.expireat(args[0], parseInt(args[1], 10))
        case 'PEXPIRE':
          return await this.keys.pexpire(args[0], parseInt(args[1], 10))
        case 'PEXPIREAT':
          return await this.keys.pexpireat(args[0], parseInt(args[1], 10))
        case 'EXPIRETIME':
          return await this.keys.expiretime(args[0])
        case 'PEXPIRETIME':
          return await this.keys.pexpiretime(args[0])
        case 'TTL':
          return await this.keys.ttl(args[0])
        case 'PTTL':
          return await this.keys.pttl(args[0])
        case 'PERSIST':
          return await this.keys.persist(args[0])
        case 'KEYS':
          return await this.keys.keys(args[0] ?? '*')
        case 'SCAN':
          return await this.parseScanCommand(args, 'keys')
        case 'TYPE':
          return await this.keys.type(args[0])
        case 'RENAME':
          return await this.keys.rename(args[0], args[1])
        case 'RENAMENX':
          return await this.keys.renamenx(args[0], args[1])
        case 'COPY':
          return await this.keys.copy(args[0], args[1], args.includes('REPLACE'))
        case 'DUMP':
          return await this.keys.dump(args[0])
        case 'RESTORE':
          return await this.keys.restore(
            args[0],
            parseInt(args[1], 10),
            args[2],
            args.includes('REPLACE')
          )
        case 'TOUCH':
          return await this.keys.touch(args)
        case 'OBJECT':
          if (args[0].toUpperCase() === 'ENCODING') {
            return await this.keys.objectEncoding(args[1])
          }
          throw new Error('ERR Unknown OBJECT subcommand')
        case 'RANDOMKEY':
          return await this.keys.randomkey()
        case 'DBSIZE':
          return await this.keys.dbsize()
        case 'FLUSHDB':
          return await this.keys.flushdb()
        case 'FLUSHALL':
          return await this.keys.flushall()

        // Pub/Sub commands (only PUBLISH works via HTTP)
        case 'PUBLISH':
          return this.pubsub.publish(args[0], args[1])
        case 'PUBSUB':
          return this.parsePubsubCommand(args)

        // Server commands
        case 'INFO':
          return await this.getInfo()
        case 'TIME':
          const now = Date.now()
          return [Math.floor(now / 1000).toString(), ((now % 1000) * 1000).toString()]
        case 'COMMAND':
          return 'OK' // Simplified
        case 'CLIENT':
          return 'OK' // Simplified

        default:
          throw new Error(`ERR unknown command '${command}'`)
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('ERR internal error')
    }
  }

  /**
   * Parse SET command with options
   */
  private async parseSetCommand(args: string[]): Promise<string | null> {
    const [key, value, ...options] = args
    const opts: { ex?: number; px?: number; nx?: boolean; xx?: boolean; get?: boolean } = {}

    for (let i = 0; i < options.length; i++) {
      const opt = options[i].toUpperCase()
      switch (opt) {
        case 'EX':
          opts.ex = parseInt(options[++i], 10)
          break
        case 'PX':
          opts.px = parseInt(options[++i], 10)
          break
        case 'NX':
          opts.nx = true
          break
        case 'XX':
          opts.xx = true
          break
        case 'GET':
          opts.get = true
          break
        case 'EXAT':
          opts.ex = parseInt(options[++i], 10) - Math.floor(Date.now() / 1000)
          break
        case 'PXAT':
          opts.px = parseInt(options[++i], 10) - Date.now()
          break
      }
    }

    return await this.strings.set(key, value, opts)
  }

  /**
   * Parse ZADD command
   */
  private async parseZaddCommand(args: string[]): Promise<number> {
    const key = args[0]
    let idx = 1
    const opts: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean; ch?: boolean } = {}

    // Parse options
    while (idx < args.length) {
      const opt = args[idx].toUpperCase()
      if (opt === 'NX') {
        opts.nx = true
        idx++
      } else if (opt === 'XX') {
        opts.xx = true
        idx++
      } else if (opt === 'GT') {
        opts.gt = true
        idx++
      } else if (opt === 'LT') {
        opts.lt = true
        idx++
      } else if (opt === 'CH') {
        opts.ch = true
        idx++
      } else {
        break
      }
    }

    // Parse score-member pairs
    const members: ZSetMember[] = []
    while (idx < args.length - 1) {
      members.push({
        score: parseFloat(args[idx]),
        member: args[idx + 1],
      })
      idx += 2
    }

    return await this.sortedSets.zadd(key, members, opts)
  }

  /**
   * Parse ZRANGE command
   */
  private async parseZrangeCommand(args: string[]): Promise<unknown> {
    const key = args[0]
    const start = args[1]
    const stop = args[2]
    const opts: { byscore?: boolean; bylex?: boolean; rev?: boolean; withscores?: boolean; limit?: { offset: number; count: number } } = {}

    for (let i = 3; i < args.length; i++) {
      const opt = args[i].toUpperCase()
      if (opt === 'BYSCORE') opts.byscore = true
      else if (opt === 'BYLEX') opts.bylex = true
      else if (opt === 'REV') opts.rev = true
      else if (opt === 'WITHSCORES') opts.withscores = true
      else if (opt === 'LIMIT') {
        opts.limit = { offset: parseInt(args[++i], 10), count: parseInt(args[++i], 10) }
      }
    }

    const result = await this.sortedSets.zrange(key, start, stop, opts)
    if (opts.withscores && Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      return this.flattenZSetResult(result as Array<[string, number]>)
    }
    return result
  }

  /**
   * Parse ZRANGEBYSCORE command
   */
  private async parseZrangebyscoreCommand(args: string[]): Promise<unknown> {
    const key = args[0]
    const min = args[1]
    const max = args[2]
    const opts: { withscores?: boolean; limit?: { offset: number; count: number } } = {}

    for (let i = 3; i < args.length; i++) {
      const opt = args[i].toUpperCase()
      if (opt === 'WITHSCORES') opts.withscores = true
      else if (opt === 'LIMIT') {
        opts.limit = { offset: parseInt(args[++i], 10), count: parseInt(args[++i], 10) }
      }
    }

    const result = await this.sortedSets.zrangebyscore(key, min, max, opts)
    if (opts.withscores && Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      return this.flattenZSetResult(result as Array<[string, number]>)
    }
    return result
  }

  /**
   * Parse ZREVRANGEBYSCORE command
   */
  private async parseZrevrangebyscoreCommand(args: string[]): Promise<unknown> {
    const key = args[0]
    const max = args[1]
    const min = args[2]
    const opts: { withscores?: boolean; limit?: { offset: number; count: number } } = {}

    for (let i = 3; i < args.length; i++) {
      const opt = args[i].toUpperCase()
      if (opt === 'WITHSCORES') opts.withscores = true
      else if (opt === 'LIMIT') {
        opts.limit = { offset: parseInt(args[++i], 10), count: parseInt(args[++i], 10) }
      }
    }

    const result = await this.sortedSets.zrevrangebyscore(key, max, min, opts)
    if (opts.withscores && Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      return this.flattenZSetResult(result as Array<[string, number]>)
    }
    return result
  }

  /**
   * Parse EXPIRE command with options
   */
  private async parseExpireCommand(args: string[]): Promise<number> {
    const key = args[0]
    const seconds = parseInt(args[1], 10)
    const opts: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean } = {}

    for (let i = 2; i < args.length; i++) {
      const opt = args[i].toUpperCase()
      if (opt === 'NX') opts.nx = true
      else if (opt === 'XX') opts.xx = true
      else if (opt === 'GT') opts.gt = true
      else if (opt === 'LT') opts.lt = true
    }

    return await this.keys.expire(key, seconds, opts)
  }

  /**
   * Parse SCAN command
   */
  private async parseScanCommand(args: string[], type: 'keys' | 'set' | 'zset'): Promise<[number, unknown]> {
    let cursor: number
    let key: string | undefined
    let optStartIdx: number

    if (type === 'keys') {
      cursor = parseInt(args[0], 10)
      optStartIdx = 1
    } else {
      key = args[0]
      cursor = parseInt(args[1], 10)
      optStartIdx = 2
    }

    const opts: { match?: string; count?: number } = {}

    for (let i = optStartIdx; i < args.length; i++) {
      const opt = args[i].toUpperCase()
      if (opt === 'MATCH') opts.match = args[++i]
      else if (opt === 'COUNT') opts.count = parseInt(args[++i], 10)
    }

    if (type === 'keys') {
      return await this.keys.scan(cursor, opts)
    } else if (type === 'set') {
      return await this.sets.sscan(key!, cursor, opts)
    } else {
      const [nextCursor, elements] = await this.sortedSets.zscan(key!, cursor, opts)
      return [nextCursor, this.flattenZSetResult(elements)]
    }
  }

  /**
   * Parse PUBSUB subcommand
   */
  private parsePubsubCommand(args: string[]): unknown {
    const subcommand = args[0].toUpperCase()
    switch (subcommand) {
      case 'CHANNELS':
        return this.pubsub.pubsubChannels(args[1])
      case 'NUMSUB':
        const numsub = this.pubsub.pubsubNumsub(args.slice(1))
        return numsub.flat()
      case 'NUMPAT':
        return this.pubsub.pubsubNumpat()
      default:
        throw new Error(`ERR Unknown PUBSUB subcommand '${subcommand}'`)
    }
  }

  /**
   * Get server info
   */
  private async getInfo(): Promise<string> {
    const stats = await this.storage.stats()
    return [
      '# Server',
      'redis_version:7.0.0-dotdo',
      'redis_mode:standalone',
      '',
      '# Keyspace',
      `db0:keys=${stats.keys},expires=${stats.expiringKeys}`,
    ].join('\r\n')
  }

  /**
   * Helper to convert array to pairs
   */
  private pairArgs(args: string[]): [string, string][] {
    const pairs: [string, string][] = []
    for (let i = 0; i < args.length - 1; i += 2) {
      pairs.push([args[i], args[i + 1]])
    }
    return pairs
  }

  /**
   * Helper to flatten hash to Redis format [k1, v1, k2, v2, ...]
   */
  private flattenHash(hash: Record<string, string>): string[] {
    const result: string[] = []
    for (const [k, v] of Object.entries(hash)) {
      result.push(k, v)
    }
    return result
  }

  /**
   * Helper to flatten zset result to Redis format [m1, s1, m2, s2, ...]
   */
  private flattenZSetResult(result: Array<[string, number]>): (string | number)[] {
    const flat: (string | number)[] = []
    for (const [member, score] of result) {
      flat.push(member, score)
    }
    return flat
  }

  /**
   * Handle HTTP fetch
   */
  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrade for pub/sub
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request)
    }

    return this.app.fetch(request)
  }

  /**
   * Handle WebSocket connections for pub/sub
   */
  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.state.acceptWebSocket(server)
    this.pubsub.registerWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Handle WebSocket messages (hibernation API)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const [command, ...args] = parseCommand(message)
      const cmd = command.toUpperCase()

      // Only allow pub/sub commands on WebSocket
      switch (cmd) {
        case 'SUBSCRIBE':
          this.pubsub.subscribe(ws, args)
          break
        case 'PSUBSCRIBE':
          this.pubsub.psubscribe(ws, args)
          break
        case 'UNSUBSCRIBE':
          this.pubsub.unsubscribe(ws, args.length > 0 ? args : undefined)
          break
        case 'PUNSUBSCRIBE':
          this.pubsub.punsubscribe(ws, args.length > 0 ? args : undefined)
          break
        case 'PING':
          ws.send(encodePong())
          break
        case 'QUIT':
          ws.close(1000, 'Client quit')
          break
        default:
          // If in pub/sub mode, only pub/sub commands are allowed
          if (this.pubsub.isInPubSubMode(ws)) {
            ws.send(encodeError('only (P)SUBSCRIBE / (P)UNSUBSCRIBE / PING / QUIT allowed in this context'))
          } else {
            // Execute command and send result
            const result = await this.executeCommand(cmd, args)
            ws.send(encodeRESP(result as import('./protocol').RedisValue))
          }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ws.send(encodeError(message))
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    this.pubsub.unregisterWebSocket(ws)
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket): Promise<void> {
    this.pubsub.unregisterWebSocket(ws)
  }

  /**
   * Handle alarm for TTL expiration
   */
  async alarm(): Promise<void> {
    await this.storage.handleAlarm()
  }
}
