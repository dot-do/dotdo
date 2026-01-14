/**
 * ConflictResolver - Multi-master replication conflict resolution
 *
 * Provides strategies for resolving conflicts when concurrent writes
 * occur to the same entity across different nodes.
 *
 * Strategies:
 * - LastWriteWins (LWW): Higher timestamp wins
 * - VersionVector: Use vector clocks for causality tracking
 * - FieldMerge: Merge non-conflicting fields
 * - CRDTMerge: Use CRDT semantics (counters, sets, registers)
 * - Custom: User-provided resolver function
 */

// ============================================================================
// TYPES
// ============================================================================

export interface VectorClock {
  entries: Record<string, number>
}

export interface ConflictEntry<T> {
  value: T
  timestamp: number
  nodeId: string
  vectorClock?: VectorClock
  version?: number
}

export interface ResolvedEntry<T> {
  value: T
  timestamp: number
  nodeId: string
  vectorClock?: VectorClock
  resolution: 'local' | 'remote' | 'merged' | 'custom'
  conflicts?: ConflictEntry<T>[]
}

export interface ConflictStrategy<T = unknown> {
  resolve(local: ConflictEntry<T>, remote: ConflictEntry<T>): ResolvedEntry<T>
  resolveAsync?(local: ConflictEntry<T>, remote: ConflictEntry<T>): Promise<ResolvedEntry<T>>
}

// ============================================================================
// CONFLICT RESOLVER
// ============================================================================

export class ConflictResolver<T = unknown> {
  private strategy: ConflictStrategy<T>

  constructor(strategy: ConflictStrategy<T>) {
    if (!strategy) {
      throw new Error('Strategy is required')
    }
    this.strategy = strategy
  }

  resolve(local: ConflictEntry<T>, remote: ConflictEntry<T>): ResolvedEntry<T> {
    const result = this.strategy.resolve(local, remote)
    this.validateResult(result)
    return result
  }

  async resolveAsync(local: ConflictEntry<T>, remote: ConflictEntry<T>): Promise<ResolvedEntry<T>> {
    if (this.strategy.resolveAsync) {
      const result = await this.strategy.resolveAsync(local, remote)
      this.validateResult(result)
      return result
    }
    return this.resolve(local, remote)
  }

  resolveMultiple(entries: ConflictEntry<T>[]): ResolvedEntry<T> {
    if (entries.length === 0) {
      throw new Error('Cannot resolve empty entries array')
    }

    if (entries.length === 1) {
      const entry = entries[0]
      return {
        value: entry.value,
        timestamp: entry.timestamp,
        nodeId: entry.nodeId,
        vectorClock: entry.vectorClock,
        resolution: 'local',
      }
    }

    // Reduce all entries by resolving pairwise
    let result: ResolvedEntry<T> = {
      value: entries[0].value,
      timestamp: entries[0].timestamp,
      nodeId: entries[0].nodeId,
      vectorClock: entries[0].vectorClock,
      resolution: 'local',
    }

    for (let i = 1; i < entries.length; i++) {
      const current: ConflictEntry<T> = {
        value: result.value,
        timestamp: result.timestamp,
        nodeId: result.nodeId,
        vectorClock: result.vectorClock,
      }
      result = this.resolve(current, entries[i])
    }

    return result
  }

  setStrategy(strategy: ConflictStrategy<T>): void {
    if (!strategy) {
      throw new Error('Strategy is required')
    }
    this.strategy = strategy
  }

  private validateResult(result: ResolvedEntry<T>): void {
    if (
      result.timestamp === undefined ||
      result.nodeId === undefined ||
      result.resolution === undefined
    ) {
      throw new Error('Invalid resolver result: missing required fields')
    }
  }
}

// ============================================================================
// LAST WRITE WINS STRATEGY
// ============================================================================

export class LastWriteWinsStrategy<T = unknown> implements ConflictStrategy<T> {
  resolve(local: ConflictEntry<T>, remote: ConflictEntry<T>): ResolvedEntry<T> {
    const localTs = local.timestamp ?? 0
    const remoteTs = remote.timestamp ?? 0

    if (remoteTs > localTs) {
      return {
        value: remote.value,
        timestamp: remote.timestamp,
        nodeId: remote.nodeId,
        vectorClock: remote.vectorClock,
        resolution: 'remote',
      }
    }

    if (localTs > remoteTs) {
      return {
        value: local.value,
        timestamp: local.timestamp,
        nodeId: local.nodeId,
        vectorClock: local.vectorClock,
        resolution: 'local',
      }
    }

    // Timestamps equal - use node ID as tiebreaker
    if (remote.nodeId > local.nodeId) {
      return {
        value: remote.value,
        timestamp: remote.timestamp,
        nodeId: remote.nodeId,
        vectorClock: remote.vectorClock,
        resolution: 'remote',
      }
    }

    return {
      value: local.value,
      timestamp: local.timestamp,
      nodeId: local.nodeId,
      vectorClock: local.vectorClock,
      resolution: 'local',
    }
  }
}

// ============================================================================
// VERSION VECTOR STRATEGY
// ============================================================================

export class VersionVectorStrategy<T = unknown> implements ConflictStrategy<T> {
  resolve(local: ConflictEntry<T>, remote: ConflictEntry<T>): ResolvedEntry<T> {
    const localVC = local.vectorClock?.entries ?? {}
    const remoteVC = remote.vectorClock?.entries ?? {}

    const comparison = this.compareVectorClocks(localVC, remoteVC)

    if (comparison === 'remote-dominates') {
      return {
        value: remote.value,
        timestamp: remote.timestamp,
        nodeId: remote.nodeId,
        vectorClock: this.mergeVectorClocks(localVC, remoteVC),
        resolution: 'remote',
      }
    }

    if (comparison === 'local-dominates') {
      return {
        value: local.value,
        timestamp: local.timestamp,
        nodeId: local.nodeId,
        vectorClock: this.mergeVectorClocks(localVC, remoteVC),
        resolution: 'local',
      }
    }

    // Concurrent - fall back to LWW with merged VC
    const mergedVC = this.mergeVectorClocks(localVC, remoteVC)

    if ((remote.timestamp ?? 0) >= (local.timestamp ?? 0)) {
      return {
        value: remote.value,
        timestamp: remote.timestamp,
        nodeId: remote.nodeId,
        vectorClock: mergedVC,
        resolution: 'merged',
        conflicts: [local, remote],
      }
    }

    return {
      value: local.value,
      timestamp: local.timestamp,
      nodeId: local.nodeId,
      vectorClock: mergedVC,
      resolution: 'merged',
      conflicts: [local, remote],
    }
  }

  private compareVectorClocks(
    local: Record<string, number>,
    remote: Record<string, number>
  ): 'local-dominates' | 'remote-dominates' | 'concurrent' {
    const allNodes = new Set([...Object.keys(local), ...Object.keys(remote)])

    let localDominates = true
    let remoteDominates = true

    for (const node of allNodes) {
      const localVal = local[node] ?? 0
      const remoteVal = remote[node] ?? 0

      if (localVal < remoteVal) {
        localDominates = false
      }
      if (remoteVal < localVal) {
        remoteDominates = false
      }
    }

    if (localDominates && !remoteDominates) {
      return 'local-dominates'
    }
    if (remoteDominates && !localDominates) {
      return 'remote-dominates'
    }

    // If both dominate (identical) or neither dominates (concurrent)
    // For identical clocks, we treat as concurrent which will fall back to LWW
    return 'concurrent'
  }

  private mergeVectorClocks(
    local: Record<string, number>,
    remote: Record<string, number>
  ): VectorClock {
    const allNodes = new Set([...Object.keys(local), ...Object.keys(remote)])
    const merged: Record<string, number> = {}

    for (const node of allNodes) {
      merged[node] = Math.max(local[node] ?? 0, remote[node] ?? 0)
    }

    return { entries: merged }
  }
}

// ============================================================================
// FIELD MERGE STRATEGY
// ============================================================================

export class FieldMergeStrategy<T = unknown> implements ConflictStrategy<T> {
  private seenObjects = new WeakSet<object>()

  resolve(local: ConflictEntry<T>, remote: ConflictEntry<T>): ResolvedEntry<T> {
    // Reset seen objects for each resolve call
    this.seenObjects = new WeakSet<object>()

    const merged = this.mergeValues(local.value, remote.value, local.timestamp, remote.timestamp)

    return {
      value: merged,
      timestamp: Math.max(local.timestamp ?? 0, remote.timestamp ?? 0),
      nodeId: (remote.timestamp ?? 0) >= (local.timestamp ?? 0) ? remote.nodeId : local.nodeId,
      resolution: 'merged',
    }
  }

  private mergeValues(local: T, remote: T, localTs: number, remoteTs: number): T {
    // Handle null/undefined
    if (local === null || local === undefined) {
      return remote
    }
    if (remote === null || remote === undefined) {
      return local
    }

    // Handle non-objects (primitives, arrays, etc.)
    if (typeof local !== 'object' || typeof remote !== 'object') {
      // LWW for primitives
      return remoteTs >= localTs ? remote : local
    }

    // Handle arrays (treat as atomic)
    if (Array.isArray(local) || Array.isArray(remote)) {
      return remoteTs >= localTs ? remote : local
    }

    // Handle Date, Map, Set (treat as atomic)
    if (local instanceof Date || remote instanceof Date) {
      return remoteTs >= localTs ? remote : local
    }
    if (local instanceof Map || remote instanceof Map) {
      return remoteTs >= localTs ? remote : local
    }
    if (local instanceof Set || remote instanceof Set) {
      return remoteTs >= localTs ? remote : local
    }

    // Check for circular references
    if (this.seenObjects.has(local as object)) {
      return remoteTs >= localTs ? remote : local
    }
    this.seenObjects.add(local as object)

    // Deep merge objects
    const result = { ...local } as Record<string, unknown>
    const remoteObj = remote as Record<string, unknown>
    const localObj = local as Record<string, unknown>

    // Get all keys from both objects (including symbols)
    const allKeys = new Set([
      ...Object.keys(localObj),
      ...Object.keys(remoteObj),
    ])

    for (const key of allKeys) {
      const localHas = key in localObj
      const remoteHas = key in remoteObj

      if (!localHas && remoteHas) {
        // Only in remote - take remote
        result[key] = remoteObj[key]
      } else if (localHas && !remoteHas) {
        // Only in local - keep local
        result[key] = localObj[key]
      } else if (localHas && remoteHas) {
        // In both - compare/merge
        const localVal = localObj[key]
        const remoteVal = remoteObj[key]

        if (localVal === remoteVal) {
          // Same value
          result[key] = localVal
        } else if (
          typeof localVal === 'object' &&
          localVal !== null &&
          typeof remoteVal === 'object' &&
          remoteVal !== null &&
          !Array.isArray(localVal) &&
          !Array.isArray(remoteVal) &&
          !(localVal instanceof Date) &&
          !(remoteVal instanceof Date) &&
          !(localVal instanceof Map) &&
          !(remoteVal instanceof Map) &&
          !(localVal instanceof Set) &&
          !(remoteVal instanceof Set)
        ) {
          // Both are plain objects - recurse
          result[key] = this.mergeValues(
            localVal as T,
            remoteVal as T,
            localTs,
            remoteTs
          )
        } else {
          // LWW for conflicting values
          result[key] = remoteTs >= localTs ? remoteVal : localVal
        }
      }
    }

    return result as T
  }
}

// ============================================================================
// CRDT TYPES
// ============================================================================

/**
 * GCounter - Grow-only Counter
 * Values can only increase. Merges via max per node.
 */
export class GCounter {
  private counts: Record<string, number> = {}
  private nodeId: string

  constructor(nodeId: string) {
    this.nodeId = nodeId
    this.counts = {}
  }

  increment(amount: number = 1): void {
    if (amount < 0) {
      throw new Error('GCounter cannot be decremented')
    }
    this.counts[this.nodeId] = (this.counts[this.nodeId] ?? 0) + amount
  }

  value(): number {
    return Object.values(this.counts).reduce((sum, val) => sum + val, 0)
  }

  merge(other: GCounter): void {
    for (const [nodeId, count] of Object.entries(other.counts)) {
      this.counts[nodeId] = Math.max(this.counts[nodeId] ?? 0, count)
    }
  }

  toJSON(): Record<string, number> {
    return { ...this.counts }
  }

  static fromJSON(json: Record<string, number>): GCounter {
    const nodeId = Object.keys(json)[0] ?? 'default'
    const counter = new GCounter(nodeId)
    counter.counts = { ...json }
    return counter
  }
}

/**
 * PNCounter - Positive-Negative Counter
 * Values can increase and decrease using two GCounters.
 */
export class PNCounter {
  private positive: Record<string, number> = {}
  private negative: Record<string, number> = {}
  private nodeId: string

  constructor(nodeId: string) {
    this.nodeId = nodeId
  }

  increment(amount: number = 1): void {
    if (amount < 0) {
      throw new Error('Use decrement for negative amounts')
    }
    this.positive[this.nodeId] = (this.positive[this.nodeId] ?? 0) + amount
  }

  decrement(amount: number = 1): void {
    if (amount < 0) {
      throw new Error('Use increment for negative amounts')
    }
    this.negative[this.nodeId] = (this.negative[this.nodeId] ?? 0) + amount
  }

  value(): number {
    const pos = Object.values(this.positive).reduce((sum, val) => sum + val, 0)
    const neg = Object.values(this.negative).reduce((sum, val) => sum + val, 0)
    return pos - neg
  }

  merge(other: PNCounter): void {
    for (const [nodeId, count] of Object.entries(other.positive)) {
      this.positive[nodeId] = Math.max(this.positive[nodeId] ?? 0, count)
    }
    for (const [nodeId, count] of Object.entries(other.negative)) {
      this.negative[nodeId] = Math.max(this.negative[nodeId] ?? 0, count)
    }
  }

  toJSON(): { positive: Record<string, number>; negative: Record<string, number> } {
    return {
      positive: { ...this.positive },
      negative: { ...this.negative },
    }
  }

  static fromJSON(json: { positive: Record<string, number>; negative: Record<string, number> }): PNCounter {
    const nodeId = Object.keys(json.positive)[0] ?? Object.keys(json.negative)[0] ?? 'default'
    const counter = new PNCounter(nodeId)
    counter.positive = { ...json.positive }
    counter.negative = { ...json.negative }
    return counter
  }
}

/**
 * GSet - Grow-only Set
 * Elements can only be added, never removed. Merges via union.
 */
export class GSet<T> {
  private items: Set<string> = new Set()
  private valueMap: Map<string, T> = new Map()

  add(item: T): void {
    const key = this.serialize(item)
    this.items.add(key)
    this.valueMap.set(key, item)
  }

  has(item: T): boolean {
    return this.items.has(this.serialize(item))
  }

  size(): number {
    return this.items.size
  }

  elements(): T[] {
    return Array.from(this.valueMap.values())
  }

  merge(other: GSet<T>): void {
    for (const key of other.items) {
      this.items.add(key)
      const val = other.valueMap.get(key)
      if (val !== undefined) {
        this.valueMap.set(key, val)
      }
    }
  }

  private serialize(item: T): string {
    if (typeof item === 'object' && item !== null) {
      return JSON.stringify(item)
    }
    return String(item)
  }

  toJSON(): T[] {
    return this.elements()
  }

  static fromJSON<T>(json: T[]): GSet<T> {
    const set = new GSet<T>()
    for (const item of json) {
      set.add(item)
    }
    return set
  }
}

/**
 * LWWRegister - Last-Writer-Wins Register
 * Stores a single value. Higher timestamp wins on merge.
 */
export class LWWRegister<T> {
  private _value: T | undefined
  private _timestamp: number = 0
  private _nodeId: string

  constructor(nodeId: string) {
    this._nodeId = nodeId
  }

  set(value: T, timestamp?: number): void {
    const ts = timestamp ?? Date.now()
    if (ts >= this._timestamp) {
      this._value = value
      this._timestamp = ts
    }
  }

  get(): T | undefined {
    return this._value
  }

  timestamp(): number {
    return this._timestamp
  }

  nodeId(): string {
    return this._nodeId
  }

  merge(other: LWWRegister<T>): void {
    if (other._timestamp > this._timestamp) {
      this._value = other._value
      this._timestamp = other._timestamp
      this._nodeId = other._nodeId
    } else if (other._timestamp === this._timestamp && other._nodeId > this._nodeId) {
      this._value = other._value
      this._nodeId = other._nodeId
    }
  }

  toJSON(): { value: T | undefined; timestamp: number; nodeId: string } {
    return {
      value: this._value,
      timestamp: this._timestamp,
      nodeId: this._nodeId,
    }
  }

  static fromJSON<T>(json: { value: T | undefined; timestamp: number; nodeId: string }): LWWRegister<T> {
    const register = new LWWRegister<T>(json.nodeId)
    register._value = json.value
    register._timestamp = json.timestamp
    return register
  }
}

// ============================================================================
// CRDT MERGE STRATEGY
// ============================================================================

export class CRDTMergeStrategy<T = unknown> implements ConflictStrategy<T> {
  resolve(local: ConflictEntry<T>, remote: ConflictEntry<T>): ResolvedEntry<T> {
    const merged = this.mergeCRDTValues(local.value, remote.value)

    return {
      value: merged,
      timestamp: Math.max(local.timestamp ?? 0, remote.timestamp ?? 0),
      nodeId: (remote.timestamp ?? 0) >= (local.timestamp ?? 0) ? remote.nodeId : local.nodeId,
      resolution: 'merged',
    }
  }

  private mergeCRDTValues(local: T, remote: T): T {
    if (typeof local !== 'object' || local === null) {
      return remote
    }
    if (typeof remote !== 'object' || remote === null) {
      return local
    }

    const result = { ...local } as Record<string, unknown>
    const remoteObj = remote as Record<string, unknown>
    const localObj = local as Record<string, unknown>

    for (const key of Object.keys(remoteObj)) {
      const localVal = localObj[key]
      const remoteVal = remoteObj[key]

      if (localVal instanceof GCounter && remoteVal instanceof GCounter) {
        localVal.merge(remoteVal)
        result[key] = localVal
      } else if (localVal instanceof PNCounter && remoteVal instanceof PNCounter) {
        localVal.merge(remoteVal)
        result[key] = localVal
      } else if (localVal instanceof GSet && remoteVal instanceof GSet) {
        localVal.merge(remoteVal)
        result[key] = localVal
      } else if (localVal instanceof LWWRegister && remoteVal instanceof LWWRegister) {
        localVal.merge(remoteVal)
        result[key] = localVal
      } else {
        // Non-CRDT field - take remote (LWW behavior)
        result[key] = remoteVal
      }
    }

    return result as T
  }
}

// ============================================================================
// CUSTOM RESOLVER STRATEGY
// ============================================================================

type ResolverFn<T> = (
  local: ConflictEntry<T>,
  remote: ConflictEntry<T>
) => ResolvedEntry<T> | Promise<ResolvedEntry<T>>

export class CustomResolverStrategy<T = unknown> implements ConflictStrategy<T> {
  private resolverFn: ResolverFn<T>

  constructor(resolverFn: ResolverFn<T>) {
    this.resolverFn = resolverFn
  }

  resolve(local: ConflictEntry<T>, remote: ConflictEntry<T>): ResolvedEntry<T> {
    const result = this.resolverFn(local, remote)
    if (result instanceof Promise) {
      throw new Error('Use resolveAsync for async resolver functions')
    }
    return result
  }

  async resolveAsync(local: ConflictEntry<T>, remote: ConflictEntry<T>): Promise<ResolvedEntry<T>> {
    return this.resolverFn(local, remote)
  }
}
