/**
 * L0: InMemoryStateManager
 *
 * Fast O(1) CRUD operations with dirty tracking and LRU eviction.
 * This is the hot layer of the storage stack.
 *
 * @module storage/in-memory-state-manager
 * @example
 * const manager = new InMemoryStateManager({
 *   maxEntries: 10000,
 *   maxBytes: 10 * 1024 * 1024,
 *   onEvict: (entries) => console.log(`Evicted ${entries.length} entries`)
 * })
 *
 * const thing = manager.create({ $type: 'Customer', name: 'Alice' })
 * manager.get(thing.$id) // O(1) read
 * manager.update(thing.$id, { name: 'Bob' }) // Increments $version
 * manager.delete(thing.$id)
 */

// Import canonical types from types/index.ts
import type { ThingData, CreateThingInput } from '../types'
import { assertValidCreateThingInput } from '../lib/validation/thing-validation'

// Re-export for backwards compatibility
export type { ThingData, CreateThingInput }

export interface TelemetryEmitter {
  emit: (event: TelemetryEvent) => void
}

export interface TelemetryEvent {
  type: string
  tier: string
  operation: string
  entityType: string
  entityId: string
  durationMs: number
  timestamp: number
}

export interface InMemoryStateManagerOptions {
  maxEntries?: number
  maxBytes?: number
  onEvict?: (entries: ThingData[]) => void
  onMemoryPressure?: (stats: { dirtyCount: number; entryCount: number }) => void
  telemetry?: TelemetryEmitter
}

export interface StateManagerStats {
  entryCount: number
  dirtyCount: number
  estimatedBytes: number
}

export interface TierMetadata {
  residency: string[]
  createdAt: number
  lastPromoted?: number
  lastAccess: number
  accessCount: number
}

export interface AccessStats {
  [id: string]: {
    accessCount: number
    lastAccess: number
    createdAt: number
  }
}

interface CacheEntry {
  data: ThingData
  size: number
  accessTime: number
  accessCount: number
  createdAt: number
}

/**
 * Generates a type-prefixed ID
 */
function generateId(type: string): string {
  const prefix = type.toLowerCase()
  const random = Math.random().toString(36).substring(2, 10)
  const timestamp = Date.now().toString(36)
  return `${prefix}_${timestamp}${random}`
}

/**
 * Estimates the byte size of an object
 */
function estimateSize(obj: unknown): number {
  return JSON.stringify(obj).length * 2 // Rough estimate: 2 bytes per char
}

export class InMemoryStateManager {
  private store: Map<string, CacheEntry> = new Map()
  private dirtySet: Set<string> = new Set()
  private accessOrder: string[] = [] // For LRU tracking
  private totalBytes: number = 0
  private options: Required<Omit<InMemoryStateManagerOptions, 'telemetry'>> & { telemetry?: TelemetryEmitter }

  constructor(options: InMemoryStateManagerOptions = {}) {
    this.options = {
      maxEntries: options.maxEntries ?? Infinity,
      maxBytes: options.maxBytes ?? Infinity,
      onEvict: options.onEvict ?? (() => {}),
      onMemoryPressure: options.onMemoryPressure ?? (() => {}),
      telemetry: options.telemetry,
    }
  }

  /**
   * Get access statistics for all entries
   */
  getAccessStats(): AccessStats {
    const stats: AccessStats = {}
    for (const [id, entry] of this.store) {
      stats[id] = {
        accessCount: entry.accessCount,
        lastAccess: entry.accessTime,
        createdAt: entry.createdAt,
      }
    }
    return stats
  }

  /**
   * Emit a telemetry event
   */
  private emitTelemetry(operation: string, entityType: string, entityId: string, startTime: number): void {
    if (this.options.telemetry) {
      this.options.telemetry.emit({
        type: `tier.L0.${operation}`,
        tier: 'L0',
        operation,
        entityType,
        entityId,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      })
    }
  }

  /**
   * Create a new thing with generated or provided $id.
   *
   * The created thing is automatically marked as dirty and added to tracking.
   * If eviction thresholds are exceeded, LRU clean entries will be evicted.
   *
   * @param input - Creation input with $type and optional $id
   * @returns The created thing with generated $id and $version=1
   * @throws ThingValidationException if input is invalid
   */
  create(input: CreateThingInput): ThingData {
    // Validate input - throws ThingValidationException if invalid
    assertValidCreateThingInput(input)

    const startTime = Date.now()
    const $id = input.$id ?? generateId(input.$type)
    const now = Date.now()

    // Add tier metadata to the thing
    const tierMetadata: TierMetadata = {
      residency: ['L0'],
      createdAt: now,
      lastAccess: now,
      accessCount: 0,
    }

    const thing: ThingData = {
      ...input,
      $id,
      $version: 1,
      _tier: tierMetadata,
    }

    const size = estimateSize(thing)
    this.store.set($id, { data: thing, size, accessTime: now, accessCount: 0, createdAt: now })
    this.totalBytes += size
    this.dirtySet.add($id)
    this.updateAccessOrder($id)

    // Check eviction thresholds
    this.maybeEvict()

    // Emit telemetry
    this.emitTelemetry('create', input.$type, $id, startTime)

    return { ...thing }
  }

  /**
   * Get a thing by $id in O(1) time.
   *
   * Updates access time for LRU tracking (read-only access does not mark as dirty).
   * Returns null if the thing does not exist.
   *
   * @param id - The $id to retrieve
   * @returns The thing or null if not found
   */
  get(id: string): ThingData | null {
    const entry = this.store.get(id)
    if (!entry) return null

    // Update access time and count for LRU
    entry.accessTime = Date.now()
    entry.accessCount++
    this.updateAccessOrder(id)

    // Update tier metadata access count
    if (entry.data._tier && typeof entry.data._tier === 'object') {
      const tier = entry.data._tier as TierMetadata
      tier.lastAccess = entry.accessTime
      tier.accessCount = entry.accessCount
    }

    return { ...entry.data }
  }

  /**
   * Update a thing and increment $version.
   *
   * Updates are merged with existing data. The $id and $type are always preserved.
   * The thing is marked as dirty and will be included in the next checkpoint.
   *
   * @param id - The $id of the thing to update
   * @param updates - Partial updates to merge
   * @returns The updated thing with incremented $version
   * @throws Error if the thing with the given $id does not exist
   */
  update(id: string, updates: Partial<ThingData>): ThingData {
    const entry = this.store.get(id)
    if (!entry) {
      throw new Error(`Storage error: Thing with id '${id}' not found for update operation`)
    }

    const oldSize = entry.size
    const updated: ThingData = {
      ...entry.data,
      ...updates,
      $id: entry.data.$id, // Preserve $id
      $type: entry.data.$type, // Preserve $type
      $version: (entry.data.$version ?? 0) + 1,
    }

    const newSize = estimateSize(updated)
    this.totalBytes = this.totalBytes - oldSize + newSize
    entry.data = updated
    entry.size = newSize
    entry.accessTime = Date.now()

    this.dirtySet.add(id)
    this.updateAccessOrder(id)

    return { ...updated }
  }

  /**
   * Delete a thing and return it
   */
  delete(id: string): ThingData | null {
    const entry = this.store.get(id)
    if (!entry) return null

    this.store.delete(id)
    this.totalBytes -= entry.size
    this.dirtySet.delete(id)
    this.removeFromAccessOrder(id)

    return { ...entry.data }
  }

  /**
   * Put a thing into storage (upsert operation)
   * Creates if not exists, updates if exists.
   * Part of the StorageTier interface for polymorphic access.
   *
   * @param id - The $id to store the thing under
   * @param data - The thing data to store
   */
  put(id: string, data: ThingData): void {
    const existing = this.store.get(id)
    if (existing) {
      // Update existing entry
      const oldSize = existing.size
      const newSize = estimateSize(data)
      this.totalBytes = this.totalBytes - oldSize + newSize
      existing.data = { ...data, $id: id }
      existing.size = newSize
      existing.accessTime = Date.now()
      this.dirtySet.add(id)
      this.updateAccessOrder(id)
    } else {
      // Create new entry
      const now = Date.now()
      const thingData: ThingData = {
        ...data,
        $id: id,
        $version: data.$version ?? 1,
      }
      const size = estimateSize(thingData)
      this.store.set(id, { data: thingData, size, accessTime: now, accessCount: 0, createdAt: now })
      this.totalBytes += size
      this.dirtySet.add(id)
      this.updateAccessOrder(id)
      this.maybeEvict()
    }
  }

  /**
   * Check if an ID is dirty (modified since last checkpoint)
   */
  isDirty(id: string): boolean {
    return this.dirtySet.has(id)
  }

  /**
   * Get count of dirty entries
   */
  getDirtyCount(): number {
    return this.dirtySet.size
  }

  /**
   * Get all dirty entry keys
   */
  getDirtyKeys(): string[] {
    return Array.from(this.dirtySet)
  }

  /**
   * Mark entries as clean (after checkpoint)
   */
  markClean(ids: string[]): void {
    for (const id of ids) {
      this.dirtySet.delete(id)
    }
  }

  /**
   * List things with optional prefix filtering and pagination
   */
  list(options: { prefix?: string; limit?: number; offset?: number } = {}): ThingData[] {
    const { prefix, limit = Infinity, offset = 0 } = options

    let results: ThingData[] = []

    for (const [id, entry] of this.store) {
      // Filter by prefix (matches either $id or lowercase $type)
      if (prefix) {
        const lowerPrefix = prefix.toLowerCase()
        const matchesId = id.toLowerCase().startsWith(lowerPrefix)
        const matchesType = entry.data.$type.toLowerCase().startsWith(lowerPrefix)
        if (!matchesId && !matchesType) continue
      }
      results.push({ ...entry.data })
    }

    // Apply pagination
    return results.slice(offset, offset + limit)
  }

  /**
   * Load bulk data without marking as dirty (for recovery)
   */
  loadBulk(things: ThingData[]): void {
    const now = Date.now()
    for (const thing of things) {
      const size = estimateSize(thing)
      this.store.set(thing.$id, {
        data: { ...thing },
        size,
        accessTime: now,
        accessCount: 0,
        createdAt: (thing._tier as TierMetadata)?.createdAt ?? now,
      })
      this.totalBytes += size
      this.updateAccessOrder(thing.$id)
      // NOT marking as dirty - this is recovered data
    }

    // Enforce limits after bulk load
    this.maybeEvict()
  }

  /**
   * Export all things
   */
  exportAll(): ThingData[] {
    return Array.from(this.store.values()).map((entry) => ({ ...entry.data }))
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.store.clear()
    this.dirtySet.clear()
    this.accessOrder = []
    this.totalBytes = 0
  }

  /**
   * Get current size (number of entries)
   */
  size(): number {
    return this.store.size
  }

  /**
   * Check if ID exists
   */
  has(id: string): boolean {
    return this.store.has(id)
  }

  /**
   * Get statistics
   */
  getStats(): StateManagerStats {
    return {
      entryCount: this.store.size,
      dirtyCount: this.dirtySet.size,
      estimatedBytes: this.totalBytes,
    }
  }

  /**
   * Update tier residency for entries (called after checkpoint)
   */
  updateTierResidency(ids: string[], tier: string): void {
    const now = Date.now()
    for (const id of ids) {
      const entry = this.store.get(id)
      if (entry && entry.data._tier && typeof entry.data._tier === 'object') {
        const tierMeta = entry.data._tier as TierMetadata
        if (!tierMeta.residency.includes(tier)) {
          tierMeta.residency.push(tier)
          tierMeta.lastPromoted = now
        }
      }
    }
  }

  /**
   * Get entry by id for internal access (does not increment access count)
   */
  getEntry(id: string): CacheEntry | undefined {
    return this.store.get(id)
  }

  /**
   * Get a thing by $id without incrementing access count.
   * Use this for internal operations like dirty tracking.
   */
  getRaw(id: string): ThingData | null {
    const entry = this.store.get(id)
    if (!entry) return null
    return { ...entry.data }
  }

  /**
   * Update LRU access order
   */
  private updateAccessOrder(id: string): void {
    this.removeFromAccessOrder(id)
    this.accessOrder.push(id)
  }

  /**
   * Remove from access order
   */
  private removeFromAccessOrder(id: string): void {
    const index = this.accessOrder.indexOf(id)
    if (index !== -1) {
      this.accessOrder.splice(index, 1)
    }
  }

  /**
   * Force eviction of dirty entries under memory pressure.
   *
   * This should be called after triggering a checkpoint. It will evict
   * dirty entries as a last resort when clean entries cannot be evicted.
   *
   * @param count - Number of entries to evict (default: evict until under limits)
   * @returns Array of evicted entries (may include dirty entries)
   */
  forceEvict(count?: number): ThingData[] {
    const toEvict: ThingData[] = []
    const targetCount = count ?? Math.max(0, this.store.size - this.options.maxEntries)

    // First try clean entries
    for (let i = 0; i < targetCount; i++) {
      const evicted = this.evictLRUClean()
      if (evicted) {
        toEvict.push(evicted)
      } else {
        break
      }
    }

    // If we still need to evict more, force evict dirty entries (LRU order)
    const remaining = targetCount - toEvict.length
    for (let i = 0; i < remaining; i++) {
      const evicted = this.evictLRUDirty()
      if (evicted) {
        toEvict.push(evicted)
      } else {
        break
      }
    }

    if (toEvict.length > 0) {
      this.options.onEvict(toEvict)
    }

    return toEvict
  }

  /**
   * Check and perform LRU eviction if thresholds exceeded
   */
  private maybeEvict(): void {
    const toEvict: ThingData[] = []
    let calledMemoryPressure = false

    // Check entry count threshold
    while (this.store.size > this.options.maxEntries) {
      const evicted = this.evictLRUClean()
      if (!evicted) {
        // No clean entries to evict - notify about memory pressure BEFORE evicting dirty
        if (!calledMemoryPressure) {
          calledMemoryPressure = true
          this.options.onMemoryPressure({
            dirtyCount: this.dirtySet.size,
            entryCount: this.store.size,
          })
        }
        // Try dirty entries as last resort
        const dirtyEvicted = this.evictLRUDirty()
        if (!dirtyEvicted) {
          break
        }
        toEvict.push(dirtyEvicted)
      } else {
        toEvict.push(evicted)
      }
    }

    // Check byte threshold
    while (this.totalBytes > this.options.maxBytes) {
      const evicted = this.evictLRUClean()
      if (!evicted) {
        // No clean entries to evict - notify about memory pressure BEFORE evicting dirty
        if (!calledMemoryPressure) {
          calledMemoryPressure = true
          this.options.onMemoryPressure({
            dirtyCount: this.dirtySet.size,
            entryCount: this.store.size,
          })
        }
        // Try dirty entries as last resort
        const dirtyEvicted = this.evictLRUDirty()
        if (!dirtyEvicted) {
          break
        }
        toEvict.push(dirtyEvicted)
      } else {
        toEvict.push(evicted)
      }
    }

    if (toEvict.length > 0) {
      this.options.onEvict(toEvict)
    }
  }

  /**
   * Evict the least recently used CLEAN entry
   */
  private evictLRUClean(): ThingData | null {
    // Find oldest clean entry
    for (const id of this.accessOrder) {
      if (!this.dirtySet.has(id)) {
        const entry = this.store.get(id)
        if (entry) {
          this.store.delete(id)
          this.totalBytes -= entry.size
          this.removeFromAccessOrder(id)
          return entry.data
        }
      }
    }
    return null
  }

  /**
   * Evict the least recently used DIRTY entry (last resort)
   */
  private evictLRUDirty(): ThingData | null {
    // Find oldest dirty entry
    for (const id of this.accessOrder) {
      if (this.dirtySet.has(id)) {
        const entry = this.store.get(id)
        if (entry) {
          this.store.delete(id)
          this.totalBytes -= entry.size
          this.dirtySet.delete(id)
          this.removeFromAccessOrder(id)
          return entry.data
        }
      }
    }
    return null
  }
}
