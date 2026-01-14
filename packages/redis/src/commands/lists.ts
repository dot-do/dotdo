/**
 * Redis List Commands
 * LPUSH, RPUSH, LPOP, RPOP, LRANGE, LLEN, LINDEX, LSET
 */

import type { RedisBackend } from '../types'

export class ListCommands {
  constructor(private backend: RedisBackend) {}

  private async getList(key: string): Promise<string[]> {
    const entry = await this.backend.get(key)
    if (!entry) return []
    if (entry.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }
    return entry.value as string[]
  }

  private async setList(key: string, list: string[], expiresAt?: number): Promise<void> {
    if (list.length === 0) {
      await this.backend.delete(key)
    } else {
      await this.backend.set(key, 'list', list, expiresAt)
    }
  }

  /**
   * LPUSH key element [element ...]
   * Insert all specified values at the head of the list
   * Returns the length of the list after the push operation
   */
  async lpush(key: string, elements: string[]): Promise<number> {
    const entry = await this.backend.get(key)
    let list: string[] = []

    if (entry) {
      if (entry.type !== 'list') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
      }
      list = [...(entry.value as string[])]
    }

    // Elements are added left-to-right, but each goes to head
    // So reverse to maintain order: LPUSH key a b c -> [c, b, a, ...existing]
    list.unshift(...[...elements].reverse())
    await this.setList(key, list, entry?.expires_at ?? undefined)
    return list.length
  }

  /**
   * LPUSHX key element [element ...]
   * Insert element at head only if key exists
   */
  async lpushx(key: string, elements: string[]): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) return 0

    if (entry.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const list = [...(entry.value as string[])]
    list.unshift(...[...elements].reverse())
    await this.setList(key, list, entry.expires_at ?? undefined)
    return list.length
  }

  /**
   * RPUSH key element [element ...]
   * Insert all specified values at the tail of the list
   */
  async rpush(key: string, elements: string[]): Promise<number> {
    const entry = await this.backend.get(key)
    let list: string[] = []

    if (entry) {
      if (entry.type !== 'list') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
      }
      list = [...(entry.value as string[])]
    }

    list.push(...elements)
    await this.setList(key, list, entry?.expires_at ?? undefined)
    return list.length
  }

  /**
   * RPUSHX key element [element ...]
   * Insert element at tail only if key exists
   */
  async rpushx(key: string, elements: string[]): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) return 0

    if (entry.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const list = [...(entry.value as string[])]
    list.push(...elements)
    await this.setList(key, list, entry.expires_at ?? undefined)
    return list.length
  }

  /**
   * LPOP key [count]
   * Remove and get the first element(s) of the list
   */
  async lpop(key: string, count?: number): Promise<string | string[] | null> {
    const entry = await this.backend.get(key)
    if (!entry) return null

    if (entry.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const list = [...(entry.value as string[])]
    if (list.length === 0) return null

    if (count === undefined) {
      const value = list.shift()!
      await this.setList(key, list, entry.expires_at ?? undefined)
      return value
    }

    const popped = list.splice(0, count)
    await this.setList(key, list, entry.expires_at ?? undefined)
    return popped.length > 0 ? popped : null
  }

  /**
   * RPOP key [count]
   * Remove and get the last element(s) of the list
   */
  async rpop(key: string, count?: number): Promise<string | string[] | null> {
    const entry = await this.backend.get(key)
    if (!entry) return null

    if (entry.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const list = [...(entry.value as string[])]
    if (list.length === 0) return null

    if (count === undefined) {
      const value = list.pop()!
      await this.setList(key, list, entry.expires_at ?? undefined)
      return value
    }

    const popped = list.splice(-count).reverse()
    await this.setList(key, list, entry.expires_at ?? undefined)
    return popped.length > 0 ? popped : null
  }

  /**
   * LRANGE key start stop
   * Get a range of elements from a list
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = await this.getList(key)
    if (list.length === 0) return []

    // Handle negative indices
    const len = list.length
    let s = start < 0 ? Math.max(0, len + start) : start
    let e = stop < 0 ? len + stop : stop

    // Clamp to valid range
    s = Math.max(0, s)
    e = Math.min(len - 1, e)

    if (s > e || s >= len) return []
    return list.slice(s, e + 1)
  }

  /**
   * LLEN key
   * Get the length of a list
   */
  async llen(key: string): Promise<number> {
    const list = await this.getList(key)
    return list.length
  }

  /**
   * LINDEX key index
   * Get an element from a list by its index
   */
  async lindex(key: string, index: number): Promise<string | null> {
    const list = await this.getList(key)
    const len = list.length

    // Handle negative index
    const idx = index < 0 ? len + index : index

    if (idx < 0 || idx >= len) return null
    return list[idx]
  }

  /**
   * LSET key index element
   * Set the value of an element in a list by its index
   */
  async lset(key: string, index: number, element: string): Promise<string> {
    const entry = await this.backend.get(key)
    if (!entry) {
      throw new Error('ERR no such key')
    }

    if (entry.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const list = [...(entry.value as string[])]
    const len = list.length
    const idx = index < 0 ? len + index : index

    if (idx < 0 || idx >= len) {
      throw new Error('ERR index out of range')
    }

    list[idx] = element
    await this.setList(key, list, entry.expires_at ?? undefined)
    return 'OK'
  }

  /**
   * LREM key count element
   * Remove elements from a list
   */
  async lrem(key: string, count: number, element: string): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) return 0

    if (entry.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const list = [...(entry.value as string[])]
    let removed = 0

    if (count === 0) {
      // Remove all occurrences
      const newList = list.filter((item) => {
        if (item === element) {
          removed++
          return false
        }
        return true
      })
      await this.setList(key, newList, entry.expires_at ?? undefined)
    } else if (count > 0) {
      // Remove from head
      const newList: string[] = []
      for (const item of list) {
        if (item === element && removed < count) {
          removed++
        } else {
          newList.push(item)
        }
      }
      await this.setList(key, newList, entry.expires_at ?? undefined)
    } else {
      // Remove from tail
      const absCount = Math.abs(count)
      const reversed = [...list].reverse()
      const newList: string[] = []
      for (const item of reversed) {
        if (item === element && removed < absCount) {
          removed++
        } else {
          newList.push(item)
        }
      }
      await this.setList(key, newList.reverse(), entry.expires_at ?? undefined)
    }

    return removed
  }

  /**
   * LTRIM key start stop
   * Trim a list to the specified range
   */
  async ltrim(key: string, start: number, stop: number): Promise<string> {
    const entry = await this.backend.get(key)
    if (!entry) return 'OK'

    if (entry.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const list = entry.value as string[]
    const len = list.length

    let s = start < 0 ? Math.max(0, len + start) : start
    let e = stop < 0 ? len + stop : stop

    s = Math.max(0, s)
    e = Math.min(len - 1, e)

    if (s > e || s >= len) {
      await this.backend.delete(key)
    } else {
      await this.setList(key, list.slice(s, e + 1), entry.expires_at ?? undefined)
    }

    return 'OK'
  }
}
