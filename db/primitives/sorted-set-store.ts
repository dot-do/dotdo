/**
 * SortedSetStore - Redis ZADD/ZRANGE-like sorted set primitive
 *
 * Provides score-ordered set operations with O(log n) performance:
 * - zadd/zrem for member management with scores
 * - zrange/zrevrange for index-based queries
 * - zrangebyscore for score-based queries
 * - zrank/zrevrank for position lookup
 * - zincrby for score increment
 *
 * Implementation uses a skip list for O(log n) operations:
 * - Insert: O(log n)
 * - Delete: O(log n)
 * - Rank lookup: O(log n)
 * - Range query: O(log n + k) where k is result size
 *
 * Maps to Redis: ZADD, ZREM, ZRANGE, ZREVRANGE, ZSCORE, ZRANK, ZREVRANK,
 *                ZCARD, ZCOUNT, ZINCRBY, ZRANGEBYSCORE, ZPOPMIN, ZPOPMAX
 *
 * @module db/primitives/sorted-set-store
 */

import { type MetricsCollector, noopMetrics } from './observability'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * A member with its associated score
 */
export interface ScoredMember<M> {
  member: M
  score: number
}

/**
 * Options for ZADD operations
 */
export interface ZAddOptions {
  /** Only add new elements (don't update existing) */
  nx?: boolean
  /** Only update existing elements (don't add new) */
  xx?: boolean
  /** Only update if new score > current score */
  gt?: boolean
  /** Only update if new score < current score */
  lt?: boolean
  /** Return number of changed elements instead of added */
  ch?: boolean
}

/**
 * Options for range by score queries
 */
export interface ZRangeByScoreOptions {
  /** Exclude min from range */
  minExclusive?: boolean
  /** Exclude max from range */
  maxExclusive?: boolean
  /** Skip first N results */
  offset?: number
  /** Limit results to N */
  count?: number
}

/**
 * Options for range queries
 */
export interface ZRangeOptions {
  /** Include scores in results */
  withScores?: boolean
}

/**
 * Configuration options for SortedSetStore
 */
export interface SortedSetStoreOptions {
  /** Enable TTL support for sorted sets */
  enableTTL?: boolean
  /** Metrics collector for observability */
  metrics?: MetricsCollector
}

// =============================================================================
// SKIP LIST IMPLEMENTATION
// =============================================================================

const MAX_LEVEL = 32
const P = 0.25 // Probability factor for level generation

/**
 * Node in the skip list
 */
interface SkipListNode<M> {
  member: M
  score: number
  forward: Array<SkipListNode<M> | null>
  span: number[] // Span of each forward pointer (for rank calculation)
}

/**
 * Skip list data structure for O(log n) sorted set operations
 */
class SkipList<M> {
  private header: SkipListNode<M>
  private tail: SkipListNode<M> | null = null
  private level: number = 1
  private length: number = 0
  private memberMap: Map<M, SkipListNode<M>> = new Map()

  constructor(private readonly compare: (a: M, b: M) => number) {
    // Sentinel node
    this.header = {
      member: null as unknown as M,
      score: -Infinity,
      forward: new Array(MAX_LEVEL).fill(null),
      span: new Array(MAX_LEVEL).fill(0),
    }
  }

  /**
   * Generate random level for new node
   */
  private randomLevel(): number {
    let level = 1
    while (Math.random() < P && level < MAX_LEVEL) {
      level++
    }
    return level
  }

  /**
   * Compare two nodes by score, then by member lexicographically
   */
  private compareNodes(
    score1: number,
    member1: M,
    score2: number,
    member2: M
  ): number {
    if (score1 !== score2) {
      return score1 - score2
    }
    return this.compare(member1, member2)
  }

  /**
   * Insert a member with score
   * @returns true if new member added, false if updated
   */
  insert(member: M, score: number): boolean {
    const update: Array<SkipListNode<M>> = new Array(MAX_LEVEL)
    const rank: number[] = new Array(MAX_LEVEL).fill(0)

    let x = this.header
    for (let i = this.level - 1; i >= 0; i--) {
      rank[i] = i === this.level - 1 ? 0 : rank[i + 1]!

      while (
        x.forward[i] !== null &&
        this.compareNodes(x.forward[i]!.score, x.forward[i]!.member, score, member) < 0
      ) {
        rank[i] += x.span[i]!
        x = x.forward[i]!
      }
      update[i] = x
    }

    // Check if member already exists
    const existing = this.memberMap.get(member)
    if (existing) {
      // Remove old position first
      this.deleteNode(existing, update)
      this.length--
    }

    const newLevel = this.randomLevel()

    if (newLevel > this.level) {
      for (let i = this.level; i < newLevel; i++) {
        rank[i] = 0
        update[i] = this.header
        update[i]!.span[i] = this.length
      }
      this.level = newLevel
    }

    // Create new node
    const newNode: SkipListNode<M> = {
      member,
      score,
      forward: new Array(newLevel).fill(null),
      span: new Array(newLevel).fill(0),
    }

    // Insert node
    for (let i = 0; i < newLevel; i++) {
      newNode.forward[i] = update[i]!.forward[i]
      update[i]!.forward[i] = newNode

      newNode.span[i] = update[i]!.span[i]! - (rank[0]! - rank[i]!)
      update[i]!.span[i] = rank[0]! - rank[i]! + 1
    }

    // Update span for levels above newLevel
    for (let i = newLevel; i < this.level; i++) {
      update[i]!.span[i]!++
    }

    // Update tail
    if (newNode.forward[0] === null) {
      this.tail = newNode
    }

    this.length++
    this.memberMap.set(member, newNode)

    return !existing
  }

  /**
   * Delete a node given the update array
   */
  private deleteNode(node: SkipListNode<M>, update: Array<SkipListNode<M>>): void {
    for (let i = 0; i < this.level; i++) {
      if (update[i]!.forward[i] === node) {
        update[i]!.span[i]! += node.span[i]! - 1
        update[i]!.forward[i] = node.forward[i]
      } else {
        update[i]!.span[i]!--
      }
    }

    if (node.forward[0] !== null) {
      // Not tail
    } else {
      this.tail = update[0] === this.header ? null : update[0]!
    }

    while (this.level > 1 && this.header.forward[this.level - 1] === null) {
      this.level--
    }
  }

  /**
   * Delete a member
   * @returns true if deleted, false if not found
   */
  delete(member: M): boolean {
    const node = this.memberMap.get(member)
    if (!node) {
      return false
    }

    const update: Array<SkipListNode<M>> = new Array(MAX_LEVEL)
    let x = this.header

    for (let i = this.level - 1; i >= 0; i--) {
      while (
        x.forward[i] !== null &&
        this.compareNodes(x.forward[i]!.score, x.forward[i]!.member, node.score, member) < 0
      ) {
        x = x.forward[i]!
      }
      update[i] = x
    }

    this.deleteNode(node, update)
    this.memberMap.delete(member)
    this.length--
    return true
  }

  /**
   * Get score for a member
   */
  getScore(member: M): number | null {
    const node = this.memberMap.get(member)
    return node ? node.score : null
  }

  /**
   * Get the size of the set
   */
  size(): number {
    return this.length
  }

  /**
   * Check if member exists
   */
  has(member: M): boolean {
    return this.memberMap.has(member)
  }

  /**
   * Get rank of member (0-based, ascending order)
   */
  getRank(member: M): number | null {
    const node = this.memberMap.get(member)
    if (!node) {
      return null
    }

    let rank = 0
    let x = this.header

    for (let i = this.level - 1; i >= 0; i--) {
      while (
        x.forward[i] !== null &&
        this.compareNodes(x.forward[i]!.score, x.forward[i]!.member, node.score, member) <= 0
      ) {
        rank += x.span[i]!
        x = x.forward[i]!
      }
    }

    return rank - 1 // Convert to 0-based
  }

  /**
   * Get members by index range (0-based, inclusive)
   */
  getRange(start: number, stop: number, reverse: boolean = false): Array<ScoredMember<M>> {
    if (this.length === 0) {
      return []
    }

    // Handle negative indices
    if (start < 0) start = Math.max(0, this.length + start)
    if (stop < 0) stop = this.length + stop

    // Normalize indices
    if (start > stop || start >= this.length) {
      return []
    }
    stop = Math.min(stop, this.length - 1)

    const results: Array<ScoredMember<M>> = []

    if (!reverse) {
      // Find starting position
      let x = this.header
      let traversed = -1

      for (let i = this.level - 1; i >= 0; i--) {
        while (x.forward[i] !== null && traversed + x.span[i]! < start) {
          traversed += x.span[i]!
          x = x.forward[i]!
        }
      }

      // Move to first element in range
      x = x.forward[0]!
      traversed++

      // Collect elements
      while (x !== null && traversed <= stop) {
        results.push({ member: x.member, score: x.score })
        x = x.forward[0]!
        traversed++
      }
    } else {
      // Reverse range - collect forward then reverse
      const forward = this.getRange(this.length - 1 - stop, this.length - 1 - start, false)
      return forward.reverse()
    }

    return results
  }

  /**
   * Get members by score range
   */
  getRangeByScore(
    min: number,
    max: number,
    options: {
      minExclusive?: boolean
      maxExclusive?: boolean
      offset?: number
      count?: number
      reverse?: boolean
    } = {}
  ): Array<ScoredMember<M>> {
    const results: Array<ScoredMember<M>> = []
    const { minExclusive, maxExclusive, offset = 0, count, reverse } = options

    let x = this.header

    // Find first element >= min
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.forward[i] !== null) {
        const nodeScore = x.forward[i]!.score
        if (minExclusive ? nodeScore <= min : nodeScore < min) {
          x = x.forward[i]!
        } else {
          break
        }
      }
    }

    x = x.forward[0]!
    let skipped = 0
    let collected = 0

    while (x !== null) {
      const nodeScore = x.score

      // Check max bound
      if (maxExclusive ? nodeScore >= max : nodeScore > max) {
        break
      }

      // Handle offset
      if (skipped < offset) {
        skipped++
        x = x.forward[0]!
        continue
      }

      // Handle count
      if (count !== undefined && collected >= count) {
        break
      }

      results.push({ member: x.member, score: nodeScore })
      collected++
      x = x.forward[0]!
    }

    return reverse ? results.reverse() : results
  }

  /**
   * Count members in score range
   */
  countInRange(min: number, max: number): number {
    let count = 0
    let x = this.header

    // Find first element >= min
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.forward[i] !== null && x.forward[i]!.score < min) {
        x = x.forward[i]!
      }
    }

    x = x.forward[0]!

    while (x !== null && x.score <= max) {
      count++
      x = x.forward[0]!
    }

    return count
  }

  /**
   * Get and remove element with minimum score
   */
  popMin(): ScoredMember<M> | null {
    const first = this.header.forward[0]
    if (!first) {
      return null
    }

    const result = { member: first.member, score: first.score }
    this.delete(first.member)
    return result
  }

  /**
   * Get and remove element with maximum score
   */
  popMax(): ScoredMember<M> | null {
    if (!this.tail) {
      return null
    }

    const result = { member: this.tail.member, score: this.tail.score }
    this.delete(this.tail.member)
    return result
  }

  /**
   * Remove elements by rank range
   */
  removeRangeByRank(start: number, stop: number): number {
    const toRemove = this.getRange(start, stop)
    for (const item of toRemove) {
      this.delete(item.member)
    }
    return toRemove.length
  }

  /**
   * Remove elements by score range
   */
  removeRangeByScore(min: number, max: number): number {
    const toRemove = this.getRangeByScore(min, max)
    for (const item of toRemove) {
      this.delete(item.member)
    }
    return toRemove.length
  }

  /**
   * Clear the skip list
   */
  clear(): void {
    this.header.forward.fill(null)
    this.header.span.fill(0)
    this.tail = null
    this.level = 1
    this.length = 0
    this.memberMap.clear()
  }
}

// =============================================================================
// SORTED SET STORE INTERFACE
// =============================================================================

/**
 * SortedSetStore interface - Redis-compatible sorted set operations
 *
 * @typeParam M - The type of members (must be comparable for lex ordering)
 */
export interface SortedSetStore<M> {
  // Basic operations
  zadd(key: string, score: number, member: M, options?: ZAddOptions): Promise<number>
  zaddMulti(key: string, items: Array<ScoredMember<M>>, options?: ZAddOptions): Promise<number>
  zrem(key: string, member: M): Promise<number>
  zremMulti(key: string, members: M[]): Promise<number>
  zscore(key: string, member: M): Promise<number | null>
  zcard(key: string): Promise<number>

  // Index-based ranges
  zrange(key: string, start: number, stop: number): Promise<M[]>
  zrangeWithScores(key: string, start: number, stop: number): Promise<Array<ScoredMember<M>>>
  zrevrange(key: string, start: number, stop: number): Promise<M[]>
  zrevrangeWithScores(key: string, start: number, stop: number): Promise<Array<ScoredMember<M>>>

  // Score-based ranges
  zrangebyscore(
    key: string,
    min: number,
    max: number,
    options?: ZRangeByScoreOptions
  ): Promise<M[]>
  zrangebyscoreWithScores(
    key: string,
    min: number,
    max: number,
    options?: ZRangeByScoreOptions
  ): Promise<Array<ScoredMember<M>>>
  zrevrangebyscore(
    key: string,
    max: number,
    min: number,
    options?: ZRangeByScoreOptions
  ): Promise<M[]>

  // Rank operations
  zrank(key: string, member: M): Promise<number | null>
  zrevrank(key: string, member: M): Promise<number | null>

  // Increment
  zincrby(key: string, increment: number, member: M): Promise<number>

  // Count
  zcount(key: string, min: number, max: number): Promise<number>

  // Pop operations
  zpopmin(key: string): Promise<ScoredMember<M> | null>
  zpopminMulti(key: string, count: number): Promise<Array<ScoredMember<M>>>
  zpopmax(key: string): Promise<ScoredMember<M> | null>
  zpopmaxMulti(key: string, count: number): Promise<Array<ScoredMember<M>>>

  // Remove by range
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>
  zremrangebyscore(key: string, min: number, max: number): Promise<number>

  // TTL operations
  expire(key: string, ttlMs: number): Promise<boolean>
  ttl(key: string): Promise<number>
  persist(key: string): Promise<boolean>

  // Key operations
  del(key: string): Promise<boolean>
  keys(pattern?: string): Promise<string[]>
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * In-memory implementation of SortedSetStore using skip lists
 */
class InMemorySortedSetStore<M> implements SortedSetStore<M> {
  private sets: Map<string, SkipList<M>> = new Map()
  private ttls: Map<string, number> = new Map() // expireAt timestamps
  private readonly enableTTL: boolean
  private readonly metrics: MetricsCollector

  constructor(options?: SortedSetStoreOptions) {
    this.enableTTL = options?.enableTTL ?? false
    this.metrics = options?.metrics ?? noopMetrics
  }

  /**
   * Get or create a skip list for a key
   */
  private getOrCreateSet(key: string): SkipList<M> {
    // Check TTL expiration
    if (this.enableTTL && this.ttls.has(key)) {
      const expireAt = this.ttls.get(key)!
      if (Date.now() >= expireAt) {
        this.sets.delete(key)
        this.ttls.delete(key)
      }
    }

    let set = this.sets.get(key)
    if (!set) {
      set = new SkipList<M>((a, b) => {
        // Default string comparison for lexicographic ordering
        const strA = String(a)
        const strB = String(b)
        return strA.localeCompare(strB)
      })
      this.sets.set(key, set)
    }
    return set
  }

  /**
   * Get set if exists, null otherwise
   */
  private getSet(key: string): SkipList<M> | null {
    // Check TTL expiration
    if (this.enableTTL && this.ttls.has(key)) {
      const expireAt = this.ttls.get(key)!
      if (Date.now() >= expireAt) {
        this.sets.delete(key)
        this.ttls.delete(key)
        return null
      }
    }

    return this.sets.get(key) ?? null
  }

  async zadd(key: string, score: number, member: M, options?: ZAddOptions): Promise<number> {
    const start = performance.now()
    try {
      // Validate score
      if (Number.isNaN(score)) {
        throw new Error('Score cannot be NaN')
      }

      const set = this.getOrCreateSet(key)
      const exists = set.has(member)
      const currentScore = exists ? set.getScore(member) : null

      // Handle NX: only add if not exists
      if (options?.nx && exists) {
        return 0
      }

      // Handle XX: only update if exists
      if (options?.xx && !exists) {
        return 0
      }

      // Handle GT: only update if new score > current
      if (options?.gt && exists && currentScore !== null && score <= currentScore) {
        return options?.ch ? 0 : 0
      }

      // Handle LT: only update if new score < current
      if (options?.lt && exists && currentScore !== null && score >= currentScore) {
        return options?.ch ? 0 : 0
      }

      const isNew = set.insert(member, score)

      // Record metrics
      this.metrics.recordGauge('sorted_set_store.member_count', set.size(), { key })

      // CH option: return 1 if score changed (including new adds)
      if (options?.ch) {
        if (isNew) return 1
        return currentScore !== score ? 1 : 0
      }

      return isNew ? 1 : 0
    } finally {
      this.metrics.recordLatency('sorted_set_store.zadd.latency', performance.now() - start)
    }
  }

  async zaddMulti(
    key: string,
    items: Array<ScoredMember<M>>,
    options?: ZAddOptions
  ): Promise<number> {
    let count = 0
    for (const item of items) {
      count += await this.zadd(key, item.score, item.member, options)
    }
    return count
  }

  async zrem(key: string, member: M): Promise<number> {
    const start = performance.now()
    try {
      const set = this.getSet(key)
      if (!set) {
        return 0
      }

      const deleted = set.delete(member)

      // Record metrics
      this.metrics.recordGauge('sorted_set_store.member_count', set.size(), { key })

      return deleted ? 1 : 0
    } finally {
      this.metrics.recordLatency('sorted_set_store.zrem.latency', performance.now() - start)
    }
  }

  async zremMulti(key: string, members: M[]): Promise<number> {
    let count = 0
    for (const member of members) {
      count += await this.zrem(key, member)
    }
    return count
  }

  async zscore(key: string, member: M): Promise<number | null> {
    const set = this.getSet(key)
    if (!set) {
      return null
    }
    return set.getScore(member)
  }

  async zcard(key: string): Promise<number> {
    const set = this.getSet(key)
    return set ? set.size() : 0
  }

  async zrange(key: string, start: number, stop: number): Promise<M[]> {
    const start_ts = performance.now()
    try {
      const set = this.getSet(key)
      if (!set) {
        return []
      }

      const results = set.getRange(start, stop)
      return results.map((r) => r.member)
    } finally {
      this.metrics.recordLatency('sorted_set_store.zrange.latency', performance.now() - start_ts)
    }
  }

  async zrangeWithScores(
    key: string,
    start: number,
    stop: number
  ): Promise<Array<ScoredMember<M>>> {
    const set = this.getSet(key)
    if (!set) {
      return []
    }

    return set.getRange(start, stop)
  }

  async zrevrange(key: string, start: number, stop: number): Promise<M[]> {
    const set = this.getSet(key)
    if (!set) {
      return []
    }

    const results = set.getRange(start, stop, true)
    return results.map((r) => r.member)
  }

  async zrevrangeWithScores(
    key: string,
    start: number,
    stop: number
  ): Promise<Array<ScoredMember<M>>> {
    const set = this.getSet(key)
    if (!set) {
      return []
    }

    return set.getRange(start, stop, true)
  }

  async zrangebyscore(
    key: string,
    min: number,
    max: number,
    options?: ZRangeByScoreOptions
  ): Promise<M[]> {
    const set = this.getSet(key)
    if (!set) {
      return []
    }

    const results = set.getRangeByScore(min, max, {
      minExclusive: options?.minExclusive,
      maxExclusive: options?.maxExclusive,
      offset: options?.offset,
      count: options?.count,
    })

    return results.map((r) => r.member)
  }

  async zrangebyscoreWithScores(
    key: string,
    min: number,
    max: number,
    options?: ZRangeByScoreOptions
  ): Promise<Array<ScoredMember<M>>> {
    const set = this.getSet(key)
    if (!set) {
      return []
    }

    return set.getRangeByScore(min, max, {
      minExclusive: options?.minExclusive,
      maxExclusive: options?.maxExclusive,
      offset: options?.offset,
      count: options?.count,
    })
  }

  async zrevrangebyscore(
    key: string,
    max: number,
    min: number,
    options?: ZRangeByScoreOptions
  ): Promise<M[]> {
    const set = this.getSet(key)
    if (!set) {
      return []
    }

    const results = set.getRangeByScore(min, max, {
      minExclusive: options?.minExclusive,
      maxExclusive: options?.maxExclusive,
      offset: options?.offset,
      count: options?.count,
      reverse: true,
    })

    return results.map((r) => r.member)
  }

  async zrank(key: string, member: M): Promise<number | null> {
    const set = this.getSet(key)
    if (!set) {
      return null
    }

    return set.getRank(member)
  }

  async zrevrank(key: string, member: M): Promise<number | null> {
    const set = this.getSet(key)
    if (!set) {
      return null
    }

    const rank = set.getRank(member)
    if (rank === null) {
      return null
    }

    return set.size() - 1 - rank
  }

  async zincrby(key: string, increment: number, member: M): Promise<number> {
    const start = performance.now()
    try {
      const set = this.getOrCreateSet(key)
      const currentScore = set.getScore(member) ?? 0
      const newScore = currentScore + increment

      set.insert(member, newScore)

      // Record metrics
      this.metrics.recordGauge('sorted_set_store.member_count', set.size(), { key })

      return newScore
    } finally {
      this.metrics.recordLatency('sorted_set_store.zincrby.latency', performance.now() - start)
    }
  }

  async zcount(key: string, min: number, max: number): Promise<number> {
    const set = this.getSet(key)
    if (!set) {
      return 0
    }

    return set.countInRange(min, max)
  }

  async zpopmin(key: string): Promise<ScoredMember<M> | null> {
    const set = this.getSet(key)
    if (!set) {
      return null
    }

    return set.popMin()
  }

  async zpopminMulti(key: string, count: number): Promise<Array<ScoredMember<M>>> {
    const set = this.getSet(key)
    if (!set) {
      return []
    }

    const results: Array<ScoredMember<M>> = []
    for (let i = 0; i < count; i++) {
      const item = set.popMin()
      if (!item) break
      results.push(item)
    }

    return results
  }

  async zpopmax(key: string): Promise<ScoredMember<M> | null> {
    const set = this.getSet(key)
    if (!set) {
      return null
    }

    return set.popMax()
  }

  async zpopmaxMulti(key: string, count: number): Promise<Array<ScoredMember<M>>> {
    const set = this.getSet(key)
    if (!set) {
      return []
    }

    const results: Array<ScoredMember<M>> = []
    for (let i = 0; i < count; i++) {
      const item = set.popMax()
      if (!item) break
      results.push(item)
    }

    return results
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    const set = this.getSet(key)
    if (!set) {
      return 0
    }

    return set.removeRangeByRank(start, stop)
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    const set = this.getSet(key)
    if (!set) {
      return 0
    }

    return set.removeRangeByScore(min, max)
  }

  async expire(key: string, ttlMs: number): Promise<boolean> {
    if (!this.enableTTL) {
      return false
    }

    const set = this.getSet(key)
    if (!set) {
      return false
    }

    this.ttls.set(key, Date.now() + ttlMs)
    return true
  }

  async ttl(key: string): Promise<number> {
    if (!this.enableTTL) {
      return -1
    }

    const set = this.getSet(key)
    if (!set) {
      return -2 // Key doesn't exist
    }

    const expireAt = this.ttls.get(key)
    if (expireAt === undefined) {
      return -1 // No TTL set
    }

    const remaining = expireAt - Date.now()
    return remaining > 0 ? remaining : -2
  }

  async persist(key: string): Promise<boolean> {
    if (!this.enableTTL) {
      return false
    }

    const set = this.getSet(key)
    if (!set) {
      return false
    }

    const had = this.ttls.has(key)
    this.ttls.delete(key)
    return had
  }

  async del(key: string): Promise<boolean> {
    const had = this.sets.has(key)
    this.sets.delete(key)
    this.ttls.delete(key)
    return had
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.sets.keys())

    if (!pattern) {
      return allKeys
    }

    // Simple glob pattern matching (just * for now)
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    return allKeys.filter((key) => regex.test(key))
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new SortedSetStore instance
 *
 * @typeParam M - The type of members (must be comparable for lex ordering)
 * @param options - Configuration options
 * @returns A new SortedSetStore instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const store = createSortedSetStore<string>()
 *
 * // With TTL support
 * const store = createSortedSetStore<string>({ enableTTL: true })
 *
 * // With metrics
 * const store = createSortedSetStore<string>({ metrics: myMetricsCollector })
 * ```
 */
export function createSortedSetStore<M>(
  options?: SortedSetStoreOptions
): SortedSetStore<M> {
  return new InMemorySortedSetStore<M>(options)
}
