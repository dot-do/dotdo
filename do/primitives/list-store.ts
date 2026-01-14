/**
 * ListStore - Redis-compatible list operations primitive
 *
 * Provides ordered sequence operations with O(1) head/tail operations:
 *
 * ## Features
 * - **lpush/rpush** - Head/tail insertion (O(1))
 * - **lpop/rpop** - Head/tail removal (O(1))
 * - **lrange** - Range queries with negative index support
 * - **llen** - List length (O(1))
 * - **lindex/lset** - Index-based access and modification
 * - **lrem/ltrim/linsert/lpos** - List manipulation
 * - **blpop/brpop** - Blocking operations via async iterators
 * - **Max length enforcement** - Automatic trimming (LTRIM behavior)
 * - **TTL support** - List-level expiration
 *
 * ## Performance Characteristics
 * | Operation | Time Complexity |
 * |-----------|-----------------|
 * | lpush/rpush | O(1) per element |
 * | lpop/rpop | O(1) |
 * | lindex | O(n) |
 * | lrange | O(s+n) where s=start offset, n=range size |
 * | llen | O(1) |
 *
 * ## Redis Command Mapping
 * - LPUSH, RPUSH, LPUSHX, RPUSHX
 * - LPOP, RPOP, BLPOP, BRPOP
 * - LRANGE, LLEN, LINDEX, LSET
 * - LREM, LTRIM, LINSERT, LPOS
 * - LMOVE, BLMOVE, LMPOP, BLMPOP
 *
 * @module db/primitives/list-store
 */

import { type MetricsCollector, noopMetrics } from './observability'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Position for insertion operations
 */
export type ListPosition = 'BEFORE' | 'AFTER'

/**
 * Direction for pop/move operations
 */
export type ListDirection = 'LEFT' | 'RIGHT'

/**
 * Options for LPOS command
 */
export interface LPosOptions {
  /** Find nth occurrence (negative for reverse) */
  rank?: number
  /** Return multiple positions (0 for all) */
  count?: number
  /** Max elements to scan */
  maxLen?: number
}

/**
 * Result from blocking pop operations
 */
export interface BlockingPopResult<T> {
  /** Key that was popped from */
  key: string
  /** Value that was popped */
  value: T
}

/**
 * Result from LMPOP operation
 */
export interface LMPopResult<T> {
  /** Key that was popped from */
  key: string
  /** Values that were popped */
  values: T[]
}

/**
 * Options for blocking operations
 */
export interface BlockingOptions {
  /** Timeout in milliseconds (0 for infinite) */
  timeout?: number
}

/**
 * Options for push operations with max length
 */
export interface PushOptions {
  /** Maximum list length (trim from opposite end) */
  maxLength?: number
  /** Use approximate trimming for performance */
  approximate?: boolean
}

/**
 * Configuration options for ListStore
 */
export interface ListStoreOptions {
  /**
   * Enable TTL-based expiration
   * @default false
   */
  enableTTL?: boolean

  /**
   * Default maximum list length (0 for unlimited)
   * @default 0
   */
  maxLength?: number

  /**
   * Use approximate trimming (like Redis ~)
   * @default false
   */
  approximate?: boolean

  /**
   * Metrics collector for observability
   * @default noopMetrics
   */
  metrics?: MetricsCollector
}

// =============================================================================
// LIST STORE INTERFACE
// =============================================================================

/**
 * Redis-compatible list store interface.
 *
 * @typeParam T - The type of values stored in lists
 *
 * @example
 * ```typescript
 * const store = createListStore<string>()
 *
 * // Basic queue operations
 * await store.rpush('queue', 'task1', 'task2')
 * const task = await store.lpop('queue')
 *
 * // Stack operations
 * await store.lpush('stack', 'item1', 'item2')
 * const top = await store.lpop('stack')
 *
 * // Blocking consumer
 * for await (const { value } of store.blpop('queue')) {
 *   process(value)
 * }
 * ```
 */
export interface ListStore<T> {
  // ===========================================================================
  // PUSH OPERATIONS
  // ===========================================================================

  /**
   * Push elements to the head (left) of a list.
   * Creates the list if it doesn't exist.
   *
   * @param key - List key
   * @param values - Values to push (pushed left-to-right, so last arg ends at head)
   * @param options - Optional push options (maxLength)
   * @returns New length of the list
   */
  lpush(key: string, ...values: T[]): Promise<number>
  lpush(key: string, ...args: [...T[], PushOptions]): Promise<number>

  /**
   * Push elements to the tail (right) of a list.
   * Creates the list if it doesn't exist.
   *
   * @param key - List key
   * @param values - Values to push
   * @param options - Optional push options (maxLength)
   * @returns New length of the list
   */
  rpush(key: string, ...values: T[]): Promise<number>
  rpush(key: string, ...args: [...T[], PushOptions]): Promise<number>

  /**
   * Push to head only if list exists.
   *
   * @param key - List key
   * @param values - Values to push
   * @returns New length (0 if list didn't exist)
   */
  lpushx(key: string, ...values: T[]): Promise<number>

  /**
   * Push to tail only if list exists.
   *
   * @param key - List key
   * @param values - Values to push
   * @returns New length (0 if list didn't exist)
   */
  rpushx(key: string, ...values: T[]): Promise<number>

  // ===========================================================================
  // POP OPERATIONS
  // ===========================================================================

  /**
   * Pop element from head (left).
   *
   * @param key - List key
   * @returns Popped value or null
   */
  lpop(key: string): Promise<T | null>

  /**
   * Pop multiple elements from head.
   *
   * @param key - List key
   * @param count - Number of elements to pop
   * @returns Array of popped values
   */
  lpop(key: string, count: number): Promise<T[]>

  /**
   * Pop element from tail (right).
   *
   * @param key - List key
   * @returns Popped value or null
   */
  rpop(key: string): Promise<T | null>

  /**
   * Pop multiple elements from tail.
   *
   * @param key - List key
   * @param count - Number of elements to pop
   * @returns Array of popped values (in order of removal)
   */
  rpop(key: string, count: number): Promise<T[]>

  // ===========================================================================
  // BLOCKING POP OPERATIONS
  // ===========================================================================

  /**
   * Blocking pop from head of one or more lists.
   * Returns an async iterator that yields values as they become available.
   *
   * @param keys - List keys to monitor (priority order)
   * @param options - Blocking options (timeout)
   * @returns Async iterator of { key, value } results
   */
  blpop(
    ...keys: string[]
  ): AsyncIterator<BlockingPopResult<T>, void, undefined>
  blpop(
    ...args: [...string[], BlockingOptions]
  ): AsyncIterator<BlockingPopResult<T>, void, undefined>

  /**
   * Blocking pop from tail of one or more lists.
   *
   * @param keys - List keys to monitor (priority order)
   * @param options - Blocking options (timeout)
   * @returns Async iterator of { key, value } results
   */
  brpop(
    ...keys: string[]
  ): AsyncIterator<BlockingPopResult<T>, void, undefined>
  brpop(
    ...args: [...string[], BlockingOptions]
  ): AsyncIterator<BlockingPopResult<T>, void, undefined>

  /**
   * Pop from the first non-empty list.
   *
   * @param keys - List keys to check (priority order)
   * @param direction - LEFT or RIGHT
   * @param count - Number of elements to pop (default 1)
   * @returns Result with key and values, or null
   */
  lmpop(
    keys: string[],
    direction: ListDirection,
    count?: number
  ): Promise<LMPopResult<T> | null>

  // ===========================================================================
  // MOVE OPERATIONS
  // ===========================================================================

  /**
   * Move element between lists atomically.
   *
   * @param source - Source list key
   * @param destination - Destination list key
   * @param whereFrom - LEFT or RIGHT of source
   * @param whereTo - LEFT or RIGHT of destination
   * @returns Moved value or null if source empty
   */
  lmove(
    source: string,
    destination: string,
    whereFrom: ListDirection,
    whereTo: ListDirection
  ): Promise<T | null>

  /**
   * Blocking move between lists.
   *
   * @param source - Source list key
   * @param destination - Destination list key
   * @param whereFrom - LEFT or RIGHT of source
   * @param whereTo - LEFT or RIGHT of destination
   * @param timeout - Timeout in milliseconds
   * @returns Moved value or null on timeout
   */
  blmove(
    source: string,
    destination: string,
    whereFrom: ListDirection,
    whereTo: ListDirection,
    timeout: number
  ): Promise<T | null>

  // ===========================================================================
  // QUERY OPERATIONS
  // ===========================================================================

  /**
   * Get range of elements.
   * Supports negative indices (-1 is last element).
   *
   * @param key - List key
   * @param start - Start index (inclusive)
   * @param stop - Stop index (inclusive)
   * @returns Array of elements
   */
  lrange(key: string, start: number, stop: number): Promise<T[]>

  /**
   * Get list length.
   *
   * @param key - List key
   * @returns Length (0 if key doesn't exist)
   */
  llen(key: string): Promise<number>

  /**
   * Get element by index.
   * Supports negative indices.
   *
   * @param key - List key
   * @param index - Element index
   * @returns Element or null if index out of range
   */
  lindex(key: string, index: number): Promise<T | null>

  /**
   * Set element at index.
   *
   * @param key - List key
   * @param index - Element index
   * @param value - New value
   * @throws Error if index out of range or key doesn't exist
   */
  lset(key: string, index: number, value: T): Promise<void>

  /**
   * Find position of element.
   *
   * @param key - List key
   * @param element - Element to find
   * @param options - Search options
   * @returns Position, array of positions (with count), or null
   */
  lpos(key: string, element: T, options?: LPosOptions): Promise<number | number[] | null>

  // ===========================================================================
  // MANIPULATION OPERATIONS
  // ===========================================================================

  /**
   * Remove elements by value.
   *
   * @param key - List key
   * @param count - Number to remove (0=all, >0=from head, <0=from tail)
   * @param element - Element value to remove
   * @returns Number of elements removed
   */
  lrem(key: string, count: number, element: T): Promise<number>

  /**
   * Trim list to specified range.
   *
   * @param key - List key
   * @param start - Start index (inclusive)
   * @param stop - Stop index (inclusive)
   */
  ltrim(key: string, start: number, stop: number): Promise<void>

  /**
   * Insert element relative to pivot.
   *
   * @param key - List key
   * @param position - BEFORE or AFTER pivot
   * @param pivot - Element to search for
   * @param element - Element to insert
   * @returns New length, -1 if pivot not found, 0 if key doesn't exist
   */
  linsert(
    key: string,
    position: ListPosition,
    pivot: T,
    element: T
  ): Promise<number>

  // ===========================================================================
  // KEY OPERATIONS
  // ===========================================================================

  /**
   * Check if key exists.
   *
   * @param key - List key
   * @returns true if exists
   */
  exists(key: string): Promise<boolean>

  /**
   * Delete a list.
   *
   * @param key - List key
   * @returns true if deleted
   */
  del(key: string): Promise<boolean>

  /**
   * Rename a list.
   *
   * @param key - Current key
   * @param newKey - New key
   * @throws Error if key doesn't exist
   */
  rename(key: string, newKey: string): Promise<void>

  /**
   * Copy a list.
   *
   * @param source - Source key
   * @param destination - Destination key
   * @param replace - Replace destination if exists
   * @returns true if copied
   */
  copy(source: string, destination: string, replace?: boolean): Promise<boolean>

  // ===========================================================================
  // TTL OPERATIONS
  // ===========================================================================

  /**
   * Set TTL on a list (milliseconds).
   *
   * @param key - List key
   * @param ttl - Time to live in milliseconds
   * @returns true if TTL was set
   */
  expire(key: string, ttl: number): Promise<boolean>

  /**
   * Set absolute expiration time.
   *
   * @param key - List key
   * @param timestamp - Unix timestamp in milliseconds
   * @returns true if expiration was set
   */
  expireAt(key: string, timestamp: number): Promise<boolean>

  /**
   * Get remaining TTL.
   *
   * @param key - List key
   * @returns TTL in ms, -1 if no TTL, -2 if key doesn't exist
   */
  ttl(key: string): Promise<number>

  /**
   * Remove TTL from a list.
   *
   * @param key - List key
   * @returns true if TTL was removed
   */
  persist(key: string): Promise<boolean>
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

/**
 * Internal list node for doubly-linked list implementation.
 * @internal
 */
interface ListNode<T> {
  value: T
  prev: ListNode<T> | null
  next: ListNode<T> | null
}

/**
 * Internal list structure with O(1) head/tail access.
 * @internal
 */
interface InternalList<T> {
  head: ListNode<T> | null
  tail: ListNode<T> | null
  length: number
  expiresAt?: number
}

/**
 * Waiter for blocking operations.
 * @internal
 */
interface BlockingWaiter<T> {
  keys: string[]
  direction: ListDirection
  resolve: (result: BlockingPopResult<T> | null) => void
  timeoutId?: NodeJS.Timeout
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * In-memory implementation of ListStore.
 * @internal
 */
class InMemoryListStore<T> implements ListStore<T> {
  private lists: Map<string, InternalList<T>> = new Map()
  private waiters: BlockingWaiter<T>[] = []
  private readonly enableTTL: boolean
  private readonly defaultMaxLength: number
  private readonly approximate: boolean
  private readonly metrics: MetricsCollector

  constructor(options?: ListStoreOptions) {
    this.enableTTL = options?.enableTTL ?? false
    this.defaultMaxLength = options?.maxLength ?? 0
    this.approximate = options?.approximate ?? false
    this.metrics = options?.metrics ?? noopMetrics
  }

  // ===========================================================================
  // PUSH OPERATIONS
  // ===========================================================================

  async lpush(key: string, ...args: (T | PushOptions)[]): Promise<number> {
    const start = performance.now()
    try {
      const { values, options } = this.extractPushArgs(args)
      let list = this.getOrCreateList(key)

      // Push values (left-to-right means last value ends at head)
      for (const value of values) {
        const node: ListNode<T> = { value, prev: null, next: list.head }
        if (list.head) {
          list.head.prev = node
        }
        list.head = node
        if (!list.tail) {
          list.tail = node
        }
        list.length++
      }

      // Enforce max length (trim from tail)
      this.enforceMaxLength(key, list, 'RIGHT', options?.maxLength)

      // Notify waiters (lpush adds to head, but waiters may be waiting for any data)
      this.notifyWaiters(key)

      this.metrics.incrementCounter('list_store.pushes')
      this.metrics.recordGauge('list_store.length', list.length, { key })

      return list.length
    } finally {
      this.metrics.recordLatency('list_store.lpush.latency', performance.now() - start)
    }
  }

  async rpush(key: string, ...args: (T | PushOptions)[]): Promise<number> {
    const start = performance.now()
    try {
      const { values, options } = this.extractPushArgs(args)
      let list = this.getOrCreateList(key)

      // Push values to tail
      for (const value of values) {
        const node: ListNode<T> = { value, prev: list.tail, next: null }
        if (list.tail) {
          list.tail.next = node
        }
        list.tail = node
        if (!list.head) {
          list.head = node
        }
        list.length++
      }

      // Enforce max length (trim from head)
      this.enforceMaxLength(key, list, 'LEFT', options?.maxLength)

      // Notify waiters
      this.notifyWaiters(key)

      this.metrics.incrementCounter('list_store.pushes')
      this.metrics.recordGauge('list_store.length', list.length, { key })

      return list.length
    } finally {
      this.metrics.recordLatency('list_store.rpush.latency', performance.now() - start)
    }
  }

  async lpushx(key: string, ...values: T[]): Promise<number> {
    if (!this.lists.has(key)) {
      return 0
    }
    return this.lpush(key, ...values)
  }

  async rpushx(key: string, ...values: T[]): Promise<number> {
    if (!this.lists.has(key)) {
      return 0
    }
    return this.rpush(key, ...values)
  }

  // ===========================================================================
  // POP OPERATIONS
  // ===========================================================================

  lpop(key: string): Promise<T | null>
  lpop(key: string, count: number): Promise<T[]>
  async lpop(key: string, count?: number): Promise<T | T[] | null> {
    const start = performance.now()
    try {
      const list = this.getList(key)
      if (!list || list.length === 0) {
        return count !== undefined ? [] : null
      }

      if (count !== undefined) {
        const results: T[] = []
        for (let i = 0; i < count && list.head; i++) {
          results.push(this.popHead(list))
        }
        this.cleanupEmptyList(key, list)
        return results
      }

      const value = this.popHead(list)
      this.cleanupEmptyList(key, list)
      return value
    } finally {
      this.metrics.recordLatency('list_store.lpop.latency', performance.now() - start)
    }
  }

  rpop(key: string): Promise<T | null>
  rpop(key: string, count: number): Promise<T[]>
  async rpop(key: string, count?: number): Promise<T | T[] | null> {
    const start = performance.now()
    try {
      const list = this.getList(key)
      if (!list || list.length === 0) {
        return count !== undefined ? [] : null
      }

      if (count !== undefined) {
        const results: T[] = []
        for (let i = 0; i < count && list.tail; i++) {
          results.push(this.popTail(list))
        }
        this.cleanupEmptyList(key, list)
        return results
      }

      const value = this.popTail(list)
      this.cleanupEmptyList(key, list)
      return value
    } finally {
      this.metrics.recordLatency('list_store.rpop.latency', performance.now() - start)
    }
  }

  // ===========================================================================
  // BLOCKING POP OPERATIONS
  // ===========================================================================

  blpop(...args: (string | BlockingOptions)[]): AsyncIterator<BlockingPopResult<T>, void, undefined> {
    const { keys, options } = this.extractBlockingArgs(args)
    return this.createBlockingIterator(keys, 'LEFT', options)
  }

  brpop(...args: (string | BlockingOptions)[]): AsyncIterator<BlockingPopResult<T>, void, undefined> {
    const { keys, options } = this.extractBlockingArgs(args)
    return this.createBlockingIterator(keys, 'RIGHT', options)
  }

  async lmpop(
    keys: string[],
    direction: ListDirection,
    count: number = 1
  ): Promise<LMPopResult<T> | null> {
    for (const key of keys) {
      const list = this.getList(key)
      if (list && list.length > 0) {
        const values: T[] = []
        const popFn = direction === 'LEFT' ? () => this.popHead(list) : () => this.popTail(list)

        for (let i = 0; i < count && list.length > 0; i++) {
          values.push(popFn())
        }

        this.cleanupEmptyList(key, list)
        return { key, values }
      }
    }
    return null
  }

  // ===========================================================================
  // MOVE OPERATIONS
  // ===========================================================================

  async lmove(
    source: string,
    destination: string,
    whereFrom: ListDirection,
    whereTo: ListDirection
  ): Promise<T | null> {
    const srcList = this.getList(source)
    if (!srcList || srcList.length === 0) {
      return null
    }

    // Pop from source
    const value = whereFrom === 'LEFT' ? this.popHead(srcList) : this.popTail(srcList)
    this.cleanupEmptyList(source, srcList)

    // Push to destination
    const dstList = this.getOrCreateList(destination)
    const node: ListNode<T> = { value, prev: null, next: null }

    if (whereTo === 'LEFT') {
      node.next = dstList.head
      if (dstList.head) dstList.head.prev = node
      dstList.head = node
      if (!dstList.tail) dstList.tail = node
    } else {
      node.prev = dstList.tail
      if (dstList.tail) dstList.tail.next = node
      dstList.tail = node
      if (!dstList.head) dstList.head = node
    }
    dstList.length++

    return value
  }

  async blmove(
    source: string,
    destination: string,
    whereFrom: ListDirection,
    whereTo: ListDirection,
    timeout: number
  ): Promise<T | null> {
    // Try immediate move
    const immediate = await this.lmove(source, destination, whereFrom, whereTo)
    if (immediate !== null) {
      return immediate
    }

    // Wait for data
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        const index = this.waiters.findIndex(
          (w) => w.resolve === resolveWrapper.resolve
        )
        if (index !== -1) {
          this.waiters.splice(index, 1)
        }
        resolve(null)
      }, timeout)

      const resolveWrapper = {
        resolve: async (result: BlockingPopResult<T> | null) => {
          clearTimeout(timeoutId)
          if (result) {
            // Got a value, push to destination
            const dstList = this.getOrCreateList(destination)
            const node: ListNode<T> = { value: result.value, prev: null, next: null }

            if (whereTo === 'LEFT') {
              node.next = dstList.head
              if (dstList.head) dstList.head.prev = node
              dstList.head = node
              if (!dstList.tail) dstList.tail = node
            } else {
              node.prev = dstList.tail
              if (dstList.tail) dstList.tail.next = node
              dstList.tail = node
              if (!dstList.head) dstList.head = node
            }
            dstList.length++

            resolve(result.value)
          } else {
            resolve(null)
          }
        },
      }

      this.waiters.push({
        keys: [source],
        direction: whereFrom,
        resolve: resolveWrapper.resolve,
        timeoutId,
      })
    })
  }

  // ===========================================================================
  // QUERY OPERATIONS
  // ===========================================================================

  async lrange(key: string, start: number, stop: number): Promise<T[]> {
    const start_ts = performance.now()
    try {
      const list = this.getList(key)
      if (!list || list.length === 0) {
        return []
      }

      // Normalize indices
      const len = list.length
      let normalizedStart = start < 0 ? Math.max(0, len + start) : Math.min(start, len)
      let normalizedStop = stop < 0 ? Math.max(-1, len + stop) : Math.min(stop, len - 1)

      if (normalizedStart > normalizedStop) {
        return []
      }

      // Collect elements
      const results: T[] = []
      let current = list.head
      let index = 0

      while (current && index <= normalizedStop) {
        if (index >= normalizedStart) {
          results.push(current.value)
        }
        current = current.next
        index++
      }

      return results
    } finally {
      this.metrics.recordLatency('list_store.lrange.latency', performance.now() - start_ts)
    }
  }

  async llen(key: string): Promise<number> {
    const list = this.getList(key)
    return list?.length ?? 0
  }

  async lindex(key: string, index: number): Promise<T | null> {
    const list = this.getList(key)
    if (!list) return null

    const normalizedIndex = index < 0 ? list.length + index : index
    if (normalizedIndex < 0 || normalizedIndex >= list.length) {
      return null
    }

    let current = list.head
    for (let i = 0; i < normalizedIndex && current; i++) {
      current = current.next
    }

    return current?.value ?? null
  }

  async lset(key: string, index: number, value: T): Promise<void> {
    const list = this.getList(key)
    if (!list) {
      throw new Error(`ERR no such key`)
    }

    const normalizedIndex = index < 0 ? list.length + index : index
    if (normalizedIndex < 0 || normalizedIndex >= list.length) {
      throw new Error(`ERR index out of range`)
    }

    let current = list.head
    for (let i = 0; i < normalizedIndex && current; i++) {
      current = current.next
    }

    if (current) {
      current.value = value
    }
  }

  async lpos(
    key: string,
    element: T,
    options?: LPosOptions
  ): Promise<number | number[] | null> {
    const list = this.getList(key)
    if (!list) {
      return options?.count !== undefined ? [] : null
    }

    const rank = options?.rank ?? 1
    const count = options?.count
    const maxLen = options?.maxLen ?? list.length

    const positions: number[] = []
    let matchCount = 0
    const wantedRank = Math.abs(rank)
    const reverse = rank < 0

    // Iterate through list
    if (reverse) {
      let current = list.tail
      let index = list.length - 1
      let scanned = 0

      while (current && scanned < maxLen) {
        if (this.deepEqual(current.value, element)) {
          matchCount++
          if (matchCount >= wantedRank) {
            if (count !== undefined) {
              positions.push(index)
              if (count !== 0 && positions.length >= count) break
            } else {
              return index
            }
          }
        }
        current = current.prev
        index--
        scanned++
      }
    } else {
      let current = list.head
      let index = 0
      let scanned = 0

      while (current && scanned < maxLen) {
        if (this.deepEqual(current.value, element)) {
          matchCount++
          if (matchCount >= wantedRank) {
            if (count !== undefined) {
              positions.push(index)
              if (count !== 0 && positions.length >= count) break
            } else {
              return index
            }
          }
        }
        current = current.next
        index++
        scanned++
      }
    }

    if (count !== undefined) {
      return positions
    }
    return null
  }

  // ===========================================================================
  // MANIPULATION OPERATIONS
  // ===========================================================================

  async lrem(key: string, count: number, element: T): Promise<number> {
    const list = this.getList(key)
    if (!list) return 0

    let removed = 0
    const maxRemove = count === 0 ? Infinity : Math.abs(count)
    const fromTail = count < 0

    if (fromTail) {
      let current = list.tail
      while (current && removed < maxRemove) {
        const prev = current.prev
        if (this.deepEqual(current.value, element)) {
          this.removeNode(list, current)
          removed++
        }
        current = prev
      }
    } else {
      let current = list.head
      while (current && removed < maxRemove) {
        const next = current.next
        if (this.deepEqual(current.value, element)) {
          this.removeNode(list, current)
          removed++
        }
        current = next
      }
    }

    this.cleanupEmptyList(key, list)
    return removed
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const list = this.getList(key)
    if (!list) return

    const len = list.length
    let normalizedStart = start < 0 ? Math.max(0, len + start) : Math.min(start, len)
    let normalizedStop = stop < 0 ? Math.max(-1, len + stop) : Math.min(stop, len - 1)

    if (normalizedStart > normalizedStop || normalizedStart >= len) {
      // Empty the list
      this.lists.delete(key)
      return
    }

    // Build new list with only elements in range
    const newList: InternalList<T> = {
      head: null,
      tail: null,
      length: 0,
      expiresAt: list.expiresAt,
    }

    let current = list.head
    let index = 0

    while (current) {
      if (index >= normalizedStart && index <= normalizedStop) {
        const node: ListNode<T> = { value: current.value, prev: newList.tail, next: null }
        if (newList.tail) {
          newList.tail.next = node
        }
        newList.tail = node
        if (!newList.head) {
          newList.head = node
        }
        newList.length++
      }
      current = current.next
      index++
    }

    if (newList.length === 0) {
      this.lists.delete(key)
    } else {
      this.lists.set(key, newList)
    }
  }

  async linsert(
    key: string,
    position: ListPosition,
    pivot: T,
    element: T
  ): Promise<number> {
    const list = this.getList(key)
    if (!list) return 0

    // Find pivot
    let current = list.head
    while (current) {
      if (this.deepEqual(current.value, pivot)) {
        const newNode: ListNode<T> = { value: element, prev: null, next: null }

        if (position === 'BEFORE') {
          newNode.next = current
          newNode.prev = current.prev
          if (current.prev) {
            current.prev.next = newNode
          } else {
            list.head = newNode
          }
          current.prev = newNode
        } else {
          newNode.prev = current
          newNode.next = current.next
          if (current.next) {
            current.next.prev = newNode
          } else {
            list.tail = newNode
          }
          current.next = newNode
        }

        list.length++
        return list.length
      }
      current = current.next
    }

    return -1
  }

  // ===========================================================================
  // KEY OPERATIONS
  // ===========================================================================

  async exists(key: string): Promise<boolean> {
    return this.lists.has(key) && this.getList(key) !== null
  }

  async del(key: string): Promise<boolean> {
    return this.lists.delete(key)
  }

  async rename(key: string, newKey: string): Promise<void> {
    const list = this.lists.get(key)
    if (!list) {
      throw new Error(`ERR no such key`)
    }
    this.lists.delete(key)
    this.lists.set(newKey, list)
  }

  async copy(source: string, destination: string, replace?: boolean): Promise<boolean> {
    const srcList = this.getList(source)
    if (!srcList) return false

    if (this.lists.has(destination) && !replace) {
      return false
    }

    // Deep copy the list
    const newList: InternalList<T> = {
      head: null,
      tail: null,
      length: 0,
      expiresAt: srcList.expiresAt,
    }

    let current = srcList.head
    while (current) {
      const node: ListNode<T> = { value: current.value, prev: newList.tail, next: null }
      if (newList.tail) {
        newList.tail.next = node
      }
      newList.tail = node
      if (!newList.head) {
        newList.head = node
      }
      newList.length++
      current = current.next
    }

    this.lists.set(destination, newList)
    return true
  }

  // ===========================================================================
  // TTL OPERATIONS
  // ===========================================================================

  async expire(key: string, ttl: number): Promise<boolean> {
    const list = this.lists.get(key)
    if (!list) return false

    list.expiresAt = Date.now() + ttl
    return true
  }

  async expireAt(key: string, timestamp: number): Promise<boolean> {
    const list = this.lists.get(key)
    if (!list) return false

    list.expiresAt = timestamp
    return true
  }

  async ttl(key: string): Promise<number> {
    const list = this.lists.get(key)
    if (!list) return -2

    if (list.expiresAt === undefined) return -1

    const remaining = list.expiresAt - Date.now()
    return Math.max(0, remaining)
  }

  async persist(key: string): Promise<boolean> {
    const list = this.lists.get(key)
    if (!list) return false

    delete list.expiresAt
    return true
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private getList(key: string): InternalList<T> | null {
    const list = this.lists.get(key)
    if (!list) return null

    // Check TTL expiration
    if (this.enableTTL && list.expiresAt !== undefined && Date.now() >= list.expiresAt) {
      this.lists.delete(key)
      return null
    }

    return list
  }

  private getOrCreateList(key: string): InternalList<T> {
    let list = this.getList(key)
    if (!list) {
      list = { head: null, tail: null, length: 0 }
      this.lists.set(key, list)
    }
    return list
  }

  private popHead(list: InternalList<T>): T {
    const node = list.head!
    const value = node.value

    list.head = node.next
    if (list.head) {
      list.head.prev = null
    } else {
      list.tail = null
    }
    list.length--

    return value
  }

  private popTail(list: InternalList<T>): T {
    const node = list.tail!
    const value = node.value

    list.tail = node.prev
    if (list.tail) {
      list.tail.next = null
    } else {
      list.head = null
    }
    list.length--

    return value
  }

  private removeNode(list: InternalList<T>, node: ListNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      list.head = node.next
    }

    if (node.next) {
      node.next.prev = node.prev
    } else {
      list.tail = node.prev
    }

    list.length--
  }

  private cleanupEmptyList(key: string, list: InternalList<T>): void {
    if (list.length === 0) {
      this.lists.delete(key)
    }
  }

  private enforceMaxLength(
    key: string,
    list: InternalList<T>,
    trimFrom: ListDirection,
    maxLength?: number
  ): void {
    const limit = maxLength ?? this.defaultMaxLength
    if (limit <= 0) return

    // Approximate trimming allows some overage for performance
    const threshold = this.approximate ? Math.ceil(limit * 1.1) : limit

    while (list.length > threshold) {
      if (trimFrom === 'LEFT') {
        this.popHead(list)
      } else {
        this.popTail(list)
      }
    }
  }

  private extractPushArgs(args: (T | PushOptions)[]): { values: T[]; options?: PushOptions } {
    if (args.length === 0) {
      return { values: [] }
    }

    const lastArg = args[args.length - 1]
    if (this.isPushOptions(lastArg)) {
      return {
        values: args.slice(0, -1) as T[],
        options: lastArg,
      }
    }

    return { values: args as T[] }
  }

  private isPushOptions(value: unknown): value is PushOptions {
    return (
      typeof value === 'object' &&
      value !== null &&
      ('maxLength' in value || 'approximate' in value)
    )
  }

  private extractBlockingArgs(
    args: (string | BlockingOptions)[]
  ): { keys: string[]; options?: BlockingOptions } {
    if (args.length === 0) {
      return { keys: [] }
    }

    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'object' && lastArg !== null) {
      return {
        keys: args.slice(0, -1) as string[],
        options: lastArg as BlockingOptions,
      }
    }

    return { keys: args as string[] }
  }

  private createBlockingIterator(
    keys: string[],
    direction: ListDirection,
    options?: BlockingOptions
  ): AsyncIterator<BlockingPopResult<T>, void, undefined> {
    const store = this
    let stopped = false

    return {
      async next(): Promise<IteratorResult<BlockingPopResult<T>, void>> {
        const start = performance.now()

        if (stopped) {
          return { done: true, value: undefined }
        }

        // Check if any list has elements
        for (const key of keys) {
          const list = store.getList(key)
          if (list && list.length > 0) {
            const value =
              direction === 'LEFT' ? store.popHead(list) : store.popTail(list)
            store.cleanupEmptyList(key, list)

            const opName = direction === 'LEFT' ? 'blpop' : 'brpop'
            store.metrics.recordLatency(
              `list_store.${opName}.latency`,
              performance.now() - start
            )

            return { done: false, value: { key, value } }
          }
        }

        // Wait for data
        return new Promise((resolve) => {
          const waiter: BlockingWaiter<T> = {
            keys,
            direction,
            resolve: (result) => {
              const index = store.waiters.indexOf(waiter)
              if (index !== -1) {
                store.waiters.splice(index, 1)
              }

              const opName = direction === 'LEFT' ? 'blpop' : 'brpop'
              store.metrics.recordLatency(
                `list_store.${opName}.latency`,
                performance.now() - start
              )

              if (result) {
                resolve({ done: false, value: result })
              } else {
                resolve({ done: true, value: undefined })
              }
            },
          }

          if (options?.timeout && options.timeout > 0) {
            waiter.timeoutId = setTimeout(() => {
              const index = store.waiters.indexOf(waiter)
              if (index !== -1) {
                store.waiters.splice(index, 1)
              }
              resolve({ done: true, value: undefined })
            }, options.timeout)
          }

          store.waiters.push(waiter)
        })
      },

      async return(): Promise<IteratorResult<BlockingPopResult<T>, void>> {
        stopped = true

        // Clean up any pending waiters for this iterator
        store.waiters = store.waiters.filter((w) => {
          if (w.keys === keys) {
            if (w.timeoutId) clearTimeout(w.timeoutId)
            return false
          }
          return true
        })

        return { done: true, value: undefined }
      },
    }
  }

  private notifyWaiters(key: string): void {
    // Find waiters interested in this key
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i]!
      if (waiter.keys.includes(key)) {
        const list = this.getList(key)
        if (list && list.length > 0) {
          const value =
            waiter.direction === 'LEFT' ? this.popHead(list) : this.popTail(list)
          this.cleanupEmptyList(key, list)

          if (waiter.timeoutId) {
            clearTimeout(waiter.timeoutId)
          }

          this.waiters.splice(i, 1)
          waiter.resolve({ key, value })
          break // Only notify one waiter per push
        }
      }
    }
  }

  private deepEqual(a: T, b: T): boolean {
    if (a === b) return true
    if (typeof a !== 'object' || typeof b !== 'object') return false
    if (a === null || b === null) return a === b

    return JSON.stringify(a) === JSON.stringify(b)
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new ListStore instance.
 *
 * @typeParam T - The type of values to store
 * @param options - Configuration options
 * @returns A new ListStore instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const store = createListStore<string>()
 *
 * // With max length enforcement
 * const boundedStore = createListStore<string>({ maxLength: 1000 })
 *
 * // With TTL support
 * const ttlStore = createListStore<Task>({ enableTTL: true })
 *
 * // With metrics
 * const instrumentedStore = createListStore<Event>({
 *   metrics: myMetricsCollector,
 * })
 * ```
 */
export function createListStore<T>(options?: ListStoreOptions): ListStore<T> {
  return new InMemoryListStore<T>(options)
}
