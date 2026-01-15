/**
 * L0: InMemoryStateManager
 *
 * Fast O(1) CRUD operations with dirty tracking and LRU eviction.
 * This is the hot layer of the storage stack.
 */

export interface ThingData {
  $id: string
  $type: string
  $version?: number
  name?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

export interface CreateThingInput {
  $id?: string
  $type: string
  name?: string
  [key: string]: unknown
}

export interface InMemoryStateManagerOptions {
  maxEntries?: number
  maxBytes?: number
  onEvict?: (entries: ThingData[]) => void
}

export interface StateManagerStats {
  entryCount: number
  dirtyCount: number
  estimatedBytes: number
}

interface CacheEntry {
  data: ThingData
  size: number
  accessTime: number
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
  private options: Required<InMemoryStateManagerOptions>

  constructor(options: InMemoryStateManagerOptions = {}) {
    this.options = {
      maxEntries: options.maxEntries ?? Infinity,
      maxBytes: options.maxBytes ?? Infinity,
      onEvict: options.onEvict ?? (() => {}),
    }
  }

  /**
   * Create a new thing with generated or provided $id
   */
  create(input: CreateThingInput): ThingData {
    const $id = input.$id ?? generateId(input.$type)
    const thing: ThingData = {
      ...input,
      $id,
      $version: 1,
    }

    const size = estimateSize(thing)
    this.store.set($id, { data: thing, size, accessTime: Date.now() })
    this.totalBytes += size
    this.dirtySet.add($id)
    this.updateAccessOrder($id)

    // Check eviction thresholds
    this.maybeEvict()

    return { ...thing }
  }

  /**
   * Get a thing by $id in O(1) time
   */
  get(id: string): ThingData | null {
    const entry = this.store.get(id)
    if (!entry) return null

    // Update access time for LRU
    entry.accessTime = Date.now()
    this.updateAccessOrder(id)

    return { ...entry.data }
  }

  /**
   * Update a thing and increment $version
   */
  update(id: string, updates: Partial<ThingData>): ThingData {
    const entry = this.store.get(id)
    if (!entry) {
      throw new Error(`Thing with id ${id} not found`)
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
    for (const thing of things) {
      const size = estimateSize(thing)
      this.store.set(thing.$id, {
        data: { ...thing },
        size,
        accessTime: Date.now(),
      })
      this.totalBytes += size
      this.updateAccessOrder(thing.$id)
      // NOT marking as dirty - this is recovered data
    }
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
   * Check and perform LRU eviction if thresholds exceeded
   */
  private maybeEvict(): void {
    const toEvict: ThingData[] = []

    // Check entry count threshold
    while (this.store.size > this.options.maxEntries) {
      const evicted = this.evictLRUClean()
      if (!evicted) break // No more clean entries to evict
      toEvict.push(evicted)
    }

    // Check byte threshold
    while (this.totalBytes > this.options.maxBytes) {
      const evicted = this.evictLRUClean()
      if (!evicted) break // No more clean entries to evict
      toEvict.push(evicted)
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
}
