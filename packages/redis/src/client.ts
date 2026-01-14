/**
 * @dotdo/redis Client
 * ioredis-compatible API using in-memory backend
 */

import { MemoryBackend } from './backends/memory'
import { StringCommands } from './commands/strings'
import { HashCommands } from './commands/hashes'
import { ListCommands } from './commands/lists'
import { SetCommands } from './commands/sets'
import { KeyCommands } from './commands/keys'
import type { RedisBackend, SetOptions, ExpireOptions } from './types'

export interface RedisOptions {
  backend?: RedisBackend
}

export class Redis {
  private backend: RedisBackend
  private _strings: StringCommands
  private _hashes: HashCommands
  private _lists: ListCommands
  private _sets: SetCommands
  private _keys: KeyCommands

  constructor(options?: RedisOptions) {
    this.backend = options?.backend ?? new MemoryBackend()
    this._strings = new StringCommands(this.backend)
    this._hashes = new HashCommands(this.backend)
    this._lists = new ListCommands(this.backend)
    this._sets = new SetCommands(this.backend)
    this._keys = new KeyCommands(this.backend)
  }

  // ============================================
  // String Commands
  // ============================================

  async get(key: string): Promise<string | null> {
    return this._strings.get(key)
  }

  async set(key: string, value: string, options?: SetOptions): Promise<string | null> {
    return this._strings.set(key, value, options)
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return this._strings.mget(keys)
  }

  async mset(pairs: [string, string][]): Promise<string> {
    return this._strings.mset(pairs)
  }

  async incr(key: string): Promise<number> {
    return this._strings.incr(key)
  }

  async incrby(key: string, increment: number): Promise<number> {
    return this._strings.incrby(key, increment)
  }

  async decr(key: string): Promise<number> {
    return this._strings.decr(key)
  }

  async decrby(key: string, decrement: number): Promise<number> {
    return this._strings.decrby(key, decrement)
  }

  async append(key: string, value: string): Promise<number> {
    return this._strings.append(key, value)
  }

  async strlen(key: string): Promise<number> {
    return this._strings.strlen(key)
  }

  async setnx(key: string, value: string): Promise<number> {
    return this._strings.setnx(key, value)
  }

  async setex(key: string, seconds: number, value: string): Promise<string> {
    return this._strings.setex(key, seconds, value)
  }

  async getset(key: string, value: string): Promise<string | null> {
    return this._strings.getset(key, value)
  }

  // ============================================
  // Hash Commands
  // ============================================

  async hget(key: string, field: string): Promise<string | null> {
    return this._hashes.hget(key, field)
  }

  async hset(key: string, fieldValues: [string, string][]): Promise<number> {
    return this._hashes.hset(key, fieldValues)
  }

  async hsetnx(key: string, field: string, value: string): Promise<number> {
    return this._hashes.hsetnx(key, field, value)
  }

  async hmget(key: string, fields: string[]): Promise<(string | null)[]> {
    return this._hashes.hmget(key, fields)
  }

  async hmset(key: string, fieldValues: [string, string][]): Promise<string> {
    return this._hashes.hmset(key, fieldValues)
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this._hashes.hgetall(key)
  }

  async hdel(key: string, fields: string[]): Promise<number> {
    return this._hashes.hdel(key, fields)
  }

  async hexists(key: string, field: string): Promise<number> {
    return this._hashes.hexists(key, field)
  }

  async hlen(key: string): Promise<number> {
    return this._hashes.hlen(key)
  }

  async hkeys(key: string): Promise<string[]> {
    return this._hashes.hkeys(key)
  }

  async hvals(key: string): Promise<string[]> {
    return this._hashes.hvals(key)
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this._hashes.hincrby(key, field, increment)
  }

  async hincrbyfloat(key: string, field: string, increment: number): Promise<string> {
    return this._hashes.hincrbyfloat(key, field, increment)
  }

  // ============================================
  // List Commands
  // ============================================

  async lpush(key: string, elements: string[]): Promise<number> {
    return this._lists.lpush(key, elements)
  }

  async lpushx(key: string, elements: string[]): Promise<number> {
    return this._lists.lpushx(key, elements)
  }

  async rpush(key: string, elements: string[]): Promise<number> {
    return this._lists.rpush(key, elements)
  }

  async rpushx(key: string, elements: string[]): Promise<number> {
    return this._lists.rpushx(key, elements)
  }

  async lpop(key: string, count?: number): Promise<string | string[] | null> {
    return this._lists.lpop(key, count)
  }

  async rpop(key: string, count?: number): Promise<string | string[] | null> {
    return this._lists.rpop(key, count)
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this._lists.lrange(key, start, stop)
  }

  async llen(key: string): Promise<number> {
    return this._lists.llen(key)
  }

  async lindex(key: string, index: number): Promise<string | null> {
    return this._lists.lindex(key, index)
  }

  async lset(key: string, index: number, element: string): Promise<string> {
    return this._lists.lset(key, index, element)
  }

  async lrem(key: string, count: number, element: string): Promise<number> {
    return this._lists.lrem(key, count, element)
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    return this._lists.ltrim(key, start, stop)
  }

  // ============================================
  // Set Commands
  // ============================================

  async sadd(key: string, members: string[]): Promise<number> {
    return this._sets.sadd(key, members)
  }

  async srem(key: string, members: string[]): Promise<number> {
    return this._sets.srem(key, members)
  }

  async smembers(key: string): Promise<string[]> {
    return this._sets.smembers(key)
  }

  async sismember(key: string, member: string): Promise<number> {
    return this._sets.sismember(key, member)
  }

  async smismember(key: string, members: string[]): Promise<number[]> {
    return this._sets.smismember(key, members)
  }

  async scard(key: string): Promise<number> {
    return this._sets.scard(key)
  }

  async spop(key: string, count?: number): Promise<string | string[] | null> {
    return this._sets.spop(key, count)
  }

  async srandmember(key: string, count?: number): Promise<string | string[] | null> {
    return this._sets.srandmember(key, count)
  }

  async sdiff(keys: string[]): Promise<string[]> {
    return this._sets.sdiff(keys)
  }

  async sdiffstore(destination: string, keys: string[]): Promise<number> {
    return this._sets.sdiffstore(destination, keys)
  }

  async sinter(keys: string[]): Promise<string[]> {
    return this._sets.sinter(keys)
  }

  async sinterstore(destination: string, keys: string[]): Promise<number> {
    return this._sets.sinterstore(destination, keys)
  }

  async sunion(keys: string[]): Promise<string[]> {
    return this._sets.sunion(keys)
  }

  async sunionstore(destination: string, keys: string[]): Promise<number> {
    return this._sets.sunionstore(destination, keys)
  }

  async smove(source: string, destination: string, member: string): Promise<number> {
    return this._sets.smove(source, destination, member)
  }

  // ============================================
  // Key Commands
  // ============================================

  async del(keys: string[]): Promise<number> {
    return this._keys.del(keys)
  }

  async unlink(keys: string[]): Promise<number> {
    return this._keys.unlink(keys)
  }

  async exists(keys: string[]): Promise<number> {
    return this._keys.exists(keys)
  }

  async expire(key: string, seconds: number, options?: ExpireOptions): Promise<number> {
    return this._keys.expire(key, seconds, options)
  }

  async expireat(key: string, timestamp: number, options?: ExpireOptions): Promise<number> {
    return this._keys.expireat(key, timestamp, options)
  }

  async pexpire(key: string, milliseconds: number, options?: ExpireOptions): Promise<number> {
    return this._keys.pexpire(key, milliseconds, options)
  }

  async pexpireat(key: string, timestamp: number, options?: ExpireOptions): Promise<number> {
    return this._keys.pexpireat(key, timestamp, options)
  }

  async expiretime(key: string): Promise<number> {
    return this._keys.expiretime(key)
  }

  async pexpiretime(key: string): Promise<number> {
    return this._keys.pexpiretime(key)
  }

  async ttl(key: string): Promise<number> {
    return this._keys.ttl(key)
  }

  async pttl(key: string): Promise<number> {
    return this._keys.pttl(key)
  }

  async persist(key: string): Promise<number> {
    return this._keys.persist(key)
  }

  async type(key: string): Promise<string> {
    return this._keys.type(key)
  }

  async rename(key: string, newKey: string): Promise<string> {
    return this._keys.rename(key, newKey)
  }

  async renamenx(key: string, newKey: string): Promise<number> {
    return this._keys.renamenx(key, newKey)
  }

  async copy(source: string, destination: string, replace?: boolean): Promise<number> {
    return this._keys.copy(source, destination, replace)
  }

  async randomkey(): Promise<string | null> {
    return this._keys.randomkey()
  }

  async dbsize(): Promise<number> {
    return this._keys.dbsize()
  }

  async flushdb(): Promise<string> {
    return this._keys.flushdb()
  }

  async flushall(): Promise<string> {
    return this._keys.flushall()
  }

  async scan(
    cursor: number,
    options?: { match?: string; count?: number; type?: string }
  ): Promise<[number, string[]]> {
    return this._keys.scan(cursor, options)
  }

  /**
   * KEYS pattern
   * Find all keys matching the given pattern
   */
  async keys(pattern: string): Promise<string[]> {
    return this._keys.keys(pattern)
  }
}
