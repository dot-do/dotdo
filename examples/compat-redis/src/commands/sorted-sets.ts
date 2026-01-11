/**
 * Redis Sorted Set Commands
 * ZADD, ZREM, ZRANGE, ZRANK, ZSCORE, ZCARD, ZCOUNT, ZINCRBY, ZRANGEBYSCORE
 */

import type { RedisStorage } from '../storage'

export interface ZSetMember {
  member: string
  score: number
}

export class SortedSetCommands {
  constructor(private storage: RedisStorage) {}

  private async getZSet(key: string): Promise<ZSetMember[]> {
    const entry = await this.storage.get(key)
    if (!entry) return []
    if (entry.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }
    return entry.value as ZSetMember[]
  }

  private async setZSet(key: string, zset: ZSetMember[], expiresAt?: number): Promise<void> {
    if (zset.length === 0) {
      await this.storage.delete(key)
    } else {
      // Keep sorted by score, then by member for ties
      zset.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score
        return a.member.localeCompare(b.member)
      })
      await this.storage.set(key, 'zset', zset, expiresAt)
    }
  }

  /**
   * ZADD key [NX|XX] [GT|LT] [CH] score member [score member ...]
   * Add one or more members to a sorted set, or update its score if it already exists
   */
  async zadd(
    key: string,
    members: ZSetMember[],
    options?: {
      nx?: boolean // Only add new elements
      xx?: boolean // Only update existing elements
      gt?: boolean // Only update if new score > current
      lt?: boolean // Only update if new score < current
      ch?: boolean // Return number of changed elements (added + updated)
    }
  ): Promise<number> {
    const entry = await this.storage.get(key)
    let zset: ZSetMember[] = []

    if (entry) {
      if (entry.type !== 'zset') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
      }
      zset = entry.value as ZSetMember[]
    }

    // Create a map for O(1) lookup
    const memberMap = new Map<string, number>()
    for (let i = 0; i < zset.length; i++) {
      memberMap.set(zset[i].member, i)
    }

    let added = 0
    let changed = 0

    for (const { member, score } of members) {
      const existingIdx = memberMap.get(member)

      if (existingIdx !== undefined) {
        // Member exists
        if (options?.nx) continue // NX = skip existing

        const currentScore = zset[existingIdx].score
        let shouldUpdate = true

        if (options?.gt && score <= currentScore) shouldUpdate = false
        if (options?.lt && score >= currentScore) shouldUpdate = false

        if (shouldUpdate && currentScore !== score) {
          zset[existingIdx].score = score
          changed++
        }
      } else {
        // New member
        if (options?.xx) continue // XX = skip new

        zset.push({ member, score })
        memberMap.set(member, zset.length - 1)
        added++
        changed++
      }
    }

    await this.setZSet(key, zset, entry?.expires_at ?? undefined)
    return options?.ch ? changed : added
  }

  /**
   * ZREM key member [member ...]
   * Remove one or more members from a sorted set
   */
  async zrem(key: string, members: string[]): Promise<number> {
    const entry = await this.storage.get(key)
    if (!entry) return 0

    if (entry.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const zset = entry.value as ZSetMember[]
    const toRemove = new Set(members)
    const originalLength = zset.length

    const filtered = zset.filter((item) => !toRemove.has(item.member))
    await this.setZSet(key, filtered, entry.expires_at ?? undefined)

    return originalLength - filtered.length
  }

  /**
   * ZRANGE key start stop [BYSCORE | BYLEX] [REV] [LIMIT offset count] [WITHSCORES]
   * Return a range of members in a sorted set
   */
  async zrange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: {
      byscore?: boolean
      bylex?: boolean
      rev?: boolean
      limit?: { offset: number; count: number }
      withscores?: boolean
    }
  ): Promise<string[] | Array<[string, number]>> {
    const zset = await this.getZSet(key)
    if (zset.length === 0) return []

    let result: ZSetMember[]

    if (options?.byscore) {
      // Range by score
      const min = parseScoreBound(start as string)
      const max = parseScoreBound(stop as string)

      result = zset.filter((item) => {
        if (min.exclusive) {
          if (item.score <= min.value) return false
        } else {
          if (item.score < min.value) return false
        }
        if (max.exclusive) {
          if (item.score >= max.value) return false
        } else {
          if (item.score > max.value) return false
        }
        return true
      })
    } else if (options?.bylex) {
      // Range by lexicographical order (all scores must be the same)
      const min = parseLexBound(start as string)
      const max = parseLexBound(stop as string)

      result = zset.filter((item) => {
        if (min.inclusive) {
          if (item.member < min.value) return false
        } else {
          if (item.member <= min.value) return false
        }
        if (max.inclusive) {
          if (item.member > max.value) return false
        } else {
          if (item.member >= max.value) return false
        }
        return true
      })
    } else {
      // Range by index
      const len = zset.length
      let s = typeof start === 'number' ? start : parseInt(start as string, 10)
      let e = typeof stop === 'number' ? stop : parseInt(stop as string, 10)

      s = s < 0 ? Math.max(0, len + s) : s
      e = e < 0 ? len + e : e

      s = Math.max(0, s)
      e = Math.min(len - 1, e)

      if (s > e) return []
      result = zset.slice(s, e + 1)
    }

    if (options?.rev) {
      result = result.reverse()
    }

    if (options?.limit) {
      result = result.slice(options.limit.offset, options.limit.offset + options.limit.count)
    }

    if (options?.withscores) {
      return result.map((item) => [item.member, item.score])
    }

    return result.map((item) => item.member)
  }

  /**
   * ZREVRANGE key start stop [WITHSCORES]
   * Return a range of members in reverse order
   */
  async zrevrange(
    key: string,
    start: number,
    stop: number,
    withscores?: boolean
  ): Promise<string[] | Array<[string, number]>> {
    return this.zrange(key, start, stop, { rev: true, withscores })
  }

  /**
   * ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count]
   * Return members with scores within the given range
   */
  async zrangebyscore(
    key: string,
    min: string,
    max: string,
    options?: {
      withscores?: boolean
      limit?: { offset: number; count: number }
    }
  ): Promise<string[] | Array<[string, number]>> {
    return this.zrange(key, min, max, {
      byscore: true,
      withscores: options?.withscores,
      limit: options?.limit,
    })
  }

  /**
   * ZREVRANGEBYSCORE key max min [WITHSCORES] [LIMIT offset count]
   * Return members with scores within the given range (reverse order)
   */
  async zrevrangebyscore(
    key: string,
    max: string,
    min: string,
    options?: {
      withscores?: boolean
      limit?: { offset: number; count: number }
    }
  ): Promise<string[] | Array<[string, number]>> {
    return this.zrange(key, min, max, {
      byscore: true,
      rev: true,
      withscores: options?.withscores,
      limit: options?.limit,
    })
  }

  /**
   * ZRANK key member
   * Determine the index of a member in a sorted set
   */
  async zrank(key: string, member: string): Promise<number | null> {
    const zset = await this.getZSet(key)
    const index = zset.findIndex((item) => item.member === member)
    return index === -1 ? null : index
  }

  /**
   * ZREVRANK key member
   * Determine the index of a member in reverse order
   */
  async zrevrank(key: string, member: string): Promise<number | null> {
    const zset = await this.getZSet(key)
    const index = zset.findIndex((item) => item.member === member)
    return index === -1 ? null : zset.length - 1 - index
  }

  /**
   * ZSCORE key member
   * Get the score of a member
   */
  async zscore(key: string, member: string): Promise<number | null> {
    const zset = await this.getZSet(key)
    const found = zset.find((item) => item.member === member)
    return found ? found.score : null
  }

  /**
   * ZMSCORE key member [member ...]
   * Get the scores of multiple members
   */
  async zmscore(key: string, members: string[]): Promise<(number | null)[]> {
    const zset = await this.getZSet(key)
    const scoreMap = new Map<string, number>()
    for (const item of zset) {
      scoreMap.set(item.member, item.score)
    }
    return members.map((m) => scoreMap.get(m) ?? null)
  }

  /**
   * ZCARD key
   * Get the number of members in a sorted set
   */
  async zcard(key: string): Promise<number> {
    const zset = await this.getZSet(key)
    return zset.length
  }

  /**
   * ZCOUNT key min max
   * Count members with scores within the given range
   */
  async zcount(key: string, min: string, max: string): Promise<number> {
    const result = await this.zrange(key, min, max, { byscore: true })
    return result.length
  }

  /**
   * ZLEXCOUNT key min max
   * Count members between the given lexicographical range
   */
  async zlexcount(key: string, min: string, max: string): Promise<number> {
    const result = await this.zrange(key, min, max, { bylex: true })
    return result.length
  }

  /**
   * ZINCRBY key increment member
   * Increment the score of a member
   */
  async zincrby(key: string, increment: number, member: string): Promise<number> {
    const entry = await this.storage.get(key)
    let zset: ZSetMember[] = []

    if (entry) {
      if (entry.type !== 'zset') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
      }
      zset = entry.value as ZSetMember[]
    }

    const existing = zset.find((item) => item.member === member)
    let newScore: number

    if (existing) {
      newScore = existing.score + increment
      existing.score = newScore
    } else {
      newScore = increment
      zset.push({ member, score: newScore })
    }

    await this.setZSet(key, zset, entry?.expires_at ?? undefined)
    return newScore
  }

  /**
   * ZPOPMIN key [count]
   * Remove and return members with the lowest scores
   */
  async zpopmin(key: string, count?: number): Promise<Array<[string, number]>> {
    const entry = await this.storage.get(key)
    if (!entry) return []

    if (entry.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const zset = entry.value as ZSetMember[]
    if (zset.length === 0) return []

    const numToPop = count ?? 1
    const popped = zset.splice(0, numToPop)
    await this.setZSet(key, zset, entry.expires_at ?? undefined)

    return popped.map((item) => [item.member, item.score])
  }

  /**
   * ZPOPMAX key [count]
   * Remove and return members with the highest scores
   */
  async zpopmax(key: string, count?: number): Promise<Array<[string, number]>> {
    const entry = await this.storage.get(key)
    if (!entry) return []

    if (entry.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const zset = entry.value as ZSetMember[]
    if (zset.length === 0) return []

    const numToPop = count ?? 1
    const popped = zset.splice(-numToPop).reverse()
    await this.setZSet(key, zset, entry.expires_at ?? undefined)

    return popped.map((item) => [item.member, item.score])
  }

  /**
   * ZREMRANGEBYRANK key start stop
   * Remove all members in a sorted set within the given indexes
   */
  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    const entry = await this.storage.get(key)
    if (!entry) return 0

    if (entry.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const zset = entry.value as ZSetMember[]
    const len = zset.length

    let s = start < 0 ? Math.max(0, len + start) : start
    let e = stop < 0 ? len + stop : stop

    s = Math.max(0, s)
    e = Math.min(len - 1, e)

    if (s > e) return 0

    const removed = e - s + 1
    zset.splice(s, removed)
    await this.setZSet(key, zset, entry.expires_at ?? undefined)

    return removed
  }

  /**
   * ZREMRANGEBYSCORE key min max
   * Remove all members with scores within the given range
   */
  async zremrangebyscore(key: string, min: string, max: string): Promise<number> {
    const entry = await this.storage.get(key)
    if (!entry) return 0

    if (entry.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const zset = entry.value as ZSetMember[]
    const minBound = parseScoreBound(min)
    const maxBound = parseScoreBound(max)

    const originalLength = zset.length
    const filtered = zset.filter((item) => {
      if (minBound.exclusive) {
        if (item.score <= minBound.value) return true
      } else {
        if (item.score < minBound.value) return true
      }
      if (maxBound.exclusive) {
        if (item.score >= maxBound.value) return true
      } else {
        if (item.score > maxBound.value) return true
      }
      return false
    })

    await this.setZSet(key, filtered, entry.expires_at ?? undefined)
    return originalLength - filtered.length
  }

  /**
   * ZSCAN key cursor [MATCH pattern] [COUNT count]
   * Incrementally iterate sorted set elements
   */
  async zscan(
    key: string,
    cursor: number,
    options?: { match?: string; count?: number }
  ): Promise<[number, Array<[string, number]>]> {
    const zset = await this.getZSet(key)
    const count = options?.count ?? 10
    const pattern = options?.match

    let filtered = zset
    if (pattern) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
      filtered = zset.filter((item) => regex.test(item.member))
    }

    const start = cursor
    const end = Math.min(start + count, filtered.length)
    const nextCursor = end >= filtered.length ? 0 : end

    const elements = filtered.slice(start, end).map((item) => [item.member, item.score] as [string, number])
    return [nextCursor, elements]
  }
}

// Helper functions for parsing score bounds
function parseScoreBound(value: string): { value: number; exclusive: boolean } {
  if (value === '-inf') return { value: -Infinity, exclusive: false }
  if (value === '+inf' || value === 'inf') return { value: Infinity, exclusive: false }
  if (value.startsWith('(')) {
    return { value: parseFloat(value.slice(1)), exclusive: true }
  }
  return { value: parseFloat(value), exclusive: false }
}

// Helper functions for parsing lexicographical bounds
function parseLexBound(value: string): { value: string; inclusive: boolean } {
  if (value === '-') return { value: '', inclusive: true }
  if (value === '+') return { value: '\uffff', inclusive: true }
  if (value.startsWith('[')) {
    return { value: value.slice(1), inclusive: true }
  }
  if (value.startsWith('(')) {
    return { value: value.slice(1), inclusive: false }
  }
  return { value, inclusive: true }
}
