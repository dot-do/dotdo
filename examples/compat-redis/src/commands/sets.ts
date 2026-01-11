/**
 * Redis Set Commands
 * SADD, SREM, SMEMBERS, SISMEMBER, SCARD, SPOP, SRANDMEMBER, SDIFF, SINTER, SUNION
 */

import type { RedisStorage } from '../storage'

export class SetCommands {
  constructor(private storage: RedisStorage) {}

  private async getSet(key: string): Promise<Set<string>> {
    const entry = await this.storage.get(key)
    if (!entry) return new Set()
    if (entry.type !== 'set') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }
    return new Set(entry.value as string[])
  }

  private async setSet(key: string, set: Set<string>, expiresAt?: number): Promise<void> {
    if (set.size === 0) {
      await this.storage.delete(key)
    } else {
      await this.storage.set(key, 'set', Array.from(set), expiresAt)
    }
  }

  /**
   * SADD key member [member ...]
   * Add one or more members to a set
   * Returns the number of elements that were added (not already present)
   */
  async sadd(key: string, members: string[]): Promise<number> {
    const entry = await this.storage.get(key)
    let set: Set<string>

    if (entry) {
      if (entry.type !== 'set') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
      }
      set = new Set(entry.value as string[])
    } else {
      set = new Set()
    }

    let added = 0
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member)
        added++
      }
    }

    await this.setSet(key, set, entry?.expires_at ?? undefined)
    return added
  }

  /**
   * SREM key member [member ...]
   * Remove one or more members from a set
   */
  async srem(key: string, members: string[]): Promise<number> {
    const entry = await this.storage.get(key)
    if (!entry) return 0

    if (entry.type !== 'set') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const set = new Set(entry.value as string[])
    let removed = 0

    for (const member of members) {
      if (set.delete(member)) {
        removed++
      }
    }

    await this.setSet(key, set, entry.expires_at ?? undefined)
    return removed
  }

  /**
   * SMEMBERS key
   * Get all members in a set
   */
  async smembers(key: string): Promise<string[]> {
    const set = await this.getSet(key)
    return Array.from(set)
  }

  /**
   * SISMEMBER key member
   * Determine if a given value is a member of a set
   */
  async sismember(key: string, member: string): Promise<number> {
    const set = await this.getSet(key)
    return set.has(member) ? 1 : 0
  }

  /**
   * SMISMEMBER key member [member ...]
   * Returns whether each member is a member of the set
   */
  async smismember(key: string, members: string[]): Promise<number[]> {
    const set = await this.getSet(key)
    return members.map((m) => (set.has(m) ? 1 : 0))
  }

  /**
   * SCARD key
   * Get the number of members in a set
   */
  async scard(key: string): Promise<number> {
    const set = await this.getSet(key)
    return set.size
  }

  /**
   * SPOP key [count]
   * Remove and return one or more random members from a set
   */
  async spop(key: string, count?: number): Promise<string | string[] | null> {
    const entry = await this.storage.get(key)
    if (!entry) return count !== undefined ? [] : null

    if (entry.type !== 'set') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const set = new Set(entry.value as string[])
    if (set.size === 0) return count !== undefined ? [] : null

    const members = Array.from(set)
    const numToPop = count ?? 1

    // Fisher-Yates shuffle for random selection
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[members[i], members[j]] = [members[j], members[i]]
    }

    const popped = members.slice(0, numToPop)
    for (const member of popped) {
      set.delete(member)
    }

    await this.setSet(key, set, entry.expires_at ?? undefined)

    if (count !== undefined) {
      return popped
    }
    return popped[0] ?? null
  }

  /**
   * SRANDMEMBER key [count]
   * Get one or more random members from a set (without removing)
   */
  async srandmember(key: string, count?: number): Promise<string | string[] | null> {
    const set = await this.getSet(key)
    if (set.size === 0) return count !== undefined ? [] : null

    const members = Array.from(set)

    if (count === undefined) {
      const idx = Math.floor(Math.random() * members.length)
      return members[idx]
    }

    const allowDuplicates = count < 0
    const absCount = Math.abs(count)

    if (allowDuplicates) {
      // Can return duplicates
      const result: string[] = []
      for (let i = 0; i < absCount; i++) {
        const idx = Math.floor(Math.random() * members.length)
        result.push(members[idx])
      }
      return result
    } else {
      // No duplicates, shuffle and take
      for (let i = members.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[members[i], members[j]] = [members[j], members[i]]
      }
      return members.slice(0, Math.min(absCount, members.length))
    }
  }

  /**
   * SDIFF key [key ...]
   * Subtract multiple sets
   */
  async sdiff(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return []

    const firstSet = await this.getSet(keys[0])
    const result = new Set(firstSet)

    for (let i = 1; i < keys.length; i++) {
      const otherSet = await this.getSet(keys[i])
      for (const member of otherSet) {
        result.delete(member)
      }
    }

    return Array.from(result)
  }

  /**
   * SDIFFSTORE destination key [key ...]
   * Subtract multiple sets and store the result
   */
  async sdiffstore(destination: string, keys: string[]): Promise<number> {
    const diff = await this.sdiff(keys)
    await this.setSet(destination, new Set(diff))
    return diff.length
  }

  /**
   * SINTER key [key ...]
   * Intersect multiple sets
   */
  async sinter(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return []

    const firstSet = await this.getSet(keys[0])
    if (firstSet.size === 0) return []

    const result = new Set(firstSet)

    for (let i = 1; i < keys.length; i++) {
      const otherSet = await this.getSet(keys[i])
      for (const member of result) {
        if (!otherSet.has(member)) {
          result.delete(member)
        }
      }
      if (result.size === 0) break
    }

    return Array.from(result)
  }

  /**
   * SINTERSTORE destination key [key ...]
   * Intersect multiple sets and store the result
   */
  async sinterstore(destination: string, keys: string[]): Promise<number> {
    const inter = await this.sinter(keys)
    await this.setSet(destination, new Set(inter))
    return inter.length
  }

  /**
   * SINTERCARD numkeys key [key ...] [LIMIT limit]
   * Cardinality of set intersection (without materializing)
   */
  async sintercard(keys: string[], limit?: number): Promise<number> {
    const inter = await this.sinter(keys)
    if (limit !== undefined && limit > 0) {
      return Math.min(inter.length, limit)
    }
    return inter.length
  }

  /**
   * SUNION key [key ...]
   * Add multiple sets
   */
  async sunion(keys: string[]): Promise<string[]> {
    const result = new Set<string>()

    for (const key of keys) {
      const set = await this.getSet(key)
      for (const member of set) {
        result.add(member)
      }
    }

    return Array.from(result)
  }

  /**
   * SUNIONSTORE destination key [key ...]
   * Add multiple sets and store the result
   */
  async sunionstore(destination: string, keys: string[]): Promise<number> {
    const union = await this.sunion(keys)
    await this.setSet(destination, new Set(union))
    return union.length
  }

  /**
   * SMOVE source destination member
   * Move a member from one set to another
   */
  async smove(source: string, destination: string, member: string): Promise<number> {
    const sourceEntry = await this.storage.get(source)
    if (!sourceEntry) return 0

    if (sourceEntry.type !== 'set') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const sourceSet = new Set(sourceEntry.value as string[])
    if (!sourceSet.has(member)) return 0

    sourceSet.delete(member)
    await this.setSet(source, sourceSet, sourceEntry.expires_at ?? undefined)

    // Add to destination
    await this.sadd(destination, [member])
    return 1
  }

  /**
   * SSCAN key cursor [MATCH pattern] [COUNT count]
   * Incrementally iterate set elements
   */
  async sscan(
    key: string,
    cursor: number,
    options?: { match?: string; count?: number }
  ): Promise<[number, string[]]> {
    const set = await this.getSet(key)
    const members = Array.from(set)
    const count = options?.count ?? 10
    const pattern = options?.match

    // Simple cursor-based pagination
    let filtered = members
    if (pattern) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
      filtered = members.filter((m) => regex.test(m))
    }

    const start = cursor
    const end = Math.min(start + count, filtered.length)
    const nextCursor = end >= filtered.length ? 0 : end

    return [nextCursor, filtered.slice(start, end)]
  }
}
