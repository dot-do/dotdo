/**
 * InMemoryStateManager
 *
 * Core in-memory storage component for the Unified Storage architecture.
 * Provides O(1) reads/writes, dirty tracking, and LRU eviction.
 *
 * Architecture context:
 * - All reads: O(1) memory lookup via Map
 * - All writes: Update memory + mark dirty
 * - Dirty entries are checkpointed to SQLite lazily
 * - LRU eviction when memory limits exceeded (prefers clean entries, falls back to dirty)
 *
 * @module unified-storage/in-memory-state-manager
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Thing data structure - the core entity type
 */
export interface ThingData {
  $id: string
  $type: string
  $version?: number
  name?: string
  data?: Record<string, unknown>
  createdAt?: Date
  updatedAt?: Date
  [key: string]: unknown
}

/**
 * Input for creating a thing (without required $id)
 */
export interface CreateThingInput {
  $id?: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Options for InMemoryStateManager
 */
export interface InMemoryStateManagerOptions {
  /** Maximum number of entries before eviction (default: unlimited) */
  maxEntries?: number
  /** Maximum bytes before eviction (default: unlimited) */
  maxBytes?: number
  /** Callback when entries are evicted */
  onEvict?: (entries: ThingData[]) => void
}

/**
 * Statistics about the state manager
 */
export interface StateManagerStats {
  entryCount: number
  dirtyCount: number
  estimatedBytes: number
  memoryUsageRatio: number
}

// ============================================================================
// LRU Tracking
// ============================================================================

/**
 * Simple doubly-linked list node for LRU tracking
 */
interface LRUNode {
  $id: string
  prev: LRUNode | null
  next: LRUNode | null
}

/**
 * LRU tracker using a doubly-linked list
 */
class LRUTracker {
  private head: LRUNode | null = null
  private tail: LRUNode | null = null
  private nodeMap: Map<string, LRUNode> = new Map()

  /**
   * Touch an item (move to most recently used position)
   */
  touch(id: string): void {
    let node = this.nodeMap.get(id)

    if (node) {
      // Already exists - move to end
      this.remove(node)
    } else {
      // Create new node
      node = { $id: id, prev: null, next: null }
      this.nodeMap.set(id, node)
    }

    // Add to end (most recently used)
    this.addToTail(node)
  }

  /**
   * Remove an item from tracking
   */
  delete(id: string): void {
    const node = this.nodeMap.get(id)
    if (node) {
      this.remove(node)
      this.nodeMap.delete(id)
    }
  }

  /**
   * Get the least recently used ID (excluding dirty entries)
   * Returns null if all entries are dirty - dirty entries must be checkpointed before eviction
   */
  getLRU(dirtySet: Set<string>): string | null {
    // Only look for clean entries - dirty entries cannot be evicted
    let current = this.head
    while (current) {
      if (!dirtySet.has(current.$id)) {
        return current.$id
      }
      current = current.next
    }
    // No clean entries found - cannot evict dirty entries
    return null
  }

  /**
   * Clear all tracking
   */
  clear(): void {
    this.head = null
    this.tail = null
    this.nodeMap.clear()
  }

  private remove(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      this.head = node.next
    }

    if (node.next) {
      node.next.prev = node.prev
    } else {
      this.tail = node.prev
    }

    node.prev = null
    node.next = null
  }

  private addToTail(node: LRUNode): void {
    if (this.tail) {
      this.tail.next = node
      node.prev = this.tail
      node.next = null
      this.tail = node
    } else {
      this.head = node
      this.tail = node
    }
  }
}

// ============================================================================
// InMemoryStateManager
// ============================================================================

/**
 * In-memory state manager for Durable Object storage
 *
 * Provides O(1) CRUD operations with dirty tracking and LRU eviction.
 *
 * @example
 * ```typescript
 * const manager = new InMemoryStateManager({ maxEntries: 1000 })
 *
 * // Create a thing
 * const customer = manager.create({ $type: 'Customer', name: 'Alice' })
 *
 * // Read
 * const retrieved = manager.get(customer.$id)
 *
 * // Update
 * manager.update(customer.$id, { name: 'Alice Updated' })
 *
 * // Get dirty entries for checkpoint
 * const dirty = manager.getDirtyEntries()
 * // ... persist to SQLite ...
 * manager.markClean(Array.from(dirty.keys()))
 * ```
 */
export class InMemoryStateManager {
  private store: Map<string, ThingData> = new Map()
  private dirtySet: Set<string> = new Set()
  private lruTracker: LRUTracker = new LRUTracker()
  private totalBytes = 0

  private maxEntries: number
  private maxBytes: number
  private onEvict?: (entries: ThingData[]) => void

  constructor(options: InMemoryStateManagerOptions = {}) {
    this.maxEntries = options.maxEntries ?? Infinity
    this.maxBytes = options.maxBytes ?? Infinity
    this.onEvict = options.onEvict
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Create a new thing
   */
  create(input: CreateThingInput): ThingData {
    // Validate $type is provided
    if (!input.$type) {
      throw new Error('$type is required')
    }

    // Generate ID if not provided
    const $id = input.$id ?? this.generateId(input.$type)

    // Create thing with version 1
    const thing: ThingData = {
      ...input,
      $id,
      $type: input.$type,
      $version: 1,
    }

    // Store and track
    const size = this.calculateSize(thing)
    this.store.set($id, thing)
    this.totalBytes += size
    this.dirtySet.add($id)
    this.lruTracker.touch($id)

    // Check eviction AFTER adding new item
    this.evictIfNeeded()

    return thing
  }

  /**
   * Get a thing by ID (O(1) lookup)
   */
  get($id: string): ThingData | null {
    const thing = this.store.get($id)
    if (!thing) {
      return null
    }

    // Update LRU order (read access)
    this.lruTracker.touch($id)

    return thing
  }

  /**
   * Update a thing (merge by default)
   */
  update($id: string, updates: Partial<ThingData>): ThingData {
    const existing = this.store.get($id)
    if (!existing) {
      throw new Error(`Thing not found: ${$id}`)
    }

    // Calculate old size
    const oldSize = this.calculateSize(existing)

    // Merge updates, preserving $id and $type, incrementing $version
    const updated: ThingData = {
      ...existing,
      ...updates,
      $id: existing.$id, // Cannot change $id
      $type: existing.$type, // Cannot change $type
      $version: (existing.$version ?? 0) + 1,
    }

    // Update store
    this.store.set($id, updated)
    this.totalBytes = this.totalBytes - oldSize + this.calculateSize(updated)

    // Mark dirty and update LRU
    this.dirtySet.add($id)
    this.lruTracker.touch($id)

    return updated
  }

  /**
   * Delete a thing
   */
  delete($id: string): ThingData | null {
    const thing = this.store.get($id)
    if (!thing) {
      return null
    }

    // Remove from all tracking
    this.totalBytes -= this.calculateSize(thing)
    this.store.delete($id)
    this.dirtySet.delete($id)
    this.lruTracker.delete($id)

    return thing
  }

  // ==========================================================================
  // Dirty Tracking
  // ==========================================================================

  /**
   * Check if a thing is dirty (modified since last checkpoint)
   */
  isDirty($id: string): boolean {
    return this.dirtySet.has($id)
  }

  /**
   * Get the count of dirty entries
   */
  getDirtyCount(): number {
    return this.dirtySet.size
  }

  /**
   * Get all dirty entry IDs
   */
  getDirtyEntries(): Set<string> {
    return new Set(this.dirtySet)
  }

  /**
   * Mark entries as clean (after checkpoint to SQLite)
   */
  markClean(ids: string[]): void {
    for (const id of ids) {
      this.dirtySet.delete(id)
    }
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  /**
   * Load multiple things from array (e.g., from SQLite cold start)
   * Does NOT mark as dirty since they're already persisted
   */
  loadBulk(things: ThingData[]): void {
    for (const thing of things) {
      const size = this.calculateSize(thing)
      this.store.set(thing.$id, thing)
      this.totalBytes += size
      this.lruTracker.touch(thing.$id)
      // NOT marked dirty - already persisted
    }
  }

  /**
   * Export all things as array
   */
  exportAll(): ThingData[] {
    return Array.from(this.store.values())
  }

  /**
   * Export things filtered by type
   */
  exportByType($type: string): ThingData[] {
    return Array.from(this.store.values()).filter((t) => t.$type === $type)
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.store.clear()
    this.dirtySet.clear()
    this.lruTracker.clear()
    this.totalBytes = 0
  }

  // ==========================================================================
  // Size and Statistics
  // ==========================================================================

  /**
   * Get the number of things stored
   */
  size(): number {
    return this.store.size
  }

  /**
   * Check if an ID exists
   */
  has($id: string): boolean {
    return this.store.has($id)
  }

  /**
   * Get all stored IDs
   */
  getAllIds(): string[] {
    return Array.from(this.store.keys())
  }

  /**
   * Get statistics about the state manager
   */
  getStats(): StateManagerStats {
    return {
      entryCount: this.store.size,
      dirtyCount: this.dirtySet.size,
      estimatedBytes: this.totalBytes,
      memoryUsageRatio: this.maxBytes === Infinity ? 0 : this.totalBytes / this.maxBytes,
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Generate a unique ID for a thing
   */
  private generateId($type: string): string {
    return `${$type.toLowerCase()}_${crypto.randomUUID()}`
  }

  /**
   * Calculate the approximate size of a thing in bytes
   */
  private calculateSize(thing: ThingData): number {
    try {
      return JSON.stringify(thing).length * 2 // UTF-16 approximation
    } catch {
      return 256 // Default estimate
    }
  }

  /**
   * Evict LRU entries if limits exceeded
   * Prefers clean entries over dirty ones, but will evict dirty if no clean entries exist
   */
  private evictIfNeeded(): void {
    const evictedEntries: ThingData[] = []

    // Evict by count (prefer clean entries, but evict dirty if necessary)
    while (this.store.size > this.maxEntries) {
      // First try to find a clean entry
      let lruId = this.lruTracker.getLRU(this.dirtySet)

      if (!lruId) {
        break
      }

      const thing = this.store.get(lruId)
      if (thing) {
        evictedEntries.push(thing)
        this.totalBytes -= this.calculateSize(thing)
        this.store.delete(lruId)
        this.dirtySet.delete(lruId)
        this.lruTracker.delete(lruId)
      }
    }

    // Evict by bytes (prefer clean entries, but evict dirty if necessary)
    while (this.totalBytes > this.maxBytes) {
      const lruId = this.lruTracker.getLRU(this.dirtySet)

      if (!lruId) {
        break
      }

      const thing = this.store.get(lruId)
      if (thing) {
        evictedEntries.push(thing)
        this.totalBytes -= this.calculateSize(thing)
        this.store.delete(lruId)
        this.dirtySet.delete(lruId)
        this.lruTracker.delete(lruId)
      }
    }

    // Call onEvict callback if entries were evicted
    if (evictedEntries.length > 0 && this.onEvict) {
      this.onEvict(evictedEntries)
    }
  }
}
