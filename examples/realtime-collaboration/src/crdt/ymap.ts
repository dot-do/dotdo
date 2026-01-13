/**
 * YMap - CRDT for collaborative key-value maps
 *
 * Uses Last-Writer-Wins (LWW) semantics with Lamport timestamps.
 * Concurrent writes to the same key are resolved by comparing timestamps,
 * with client ID as tie-breaker.
 */

import type { ItemId } from './id'
import { compareIds, idToString } from './id'
import type { LamportClock } from './clock'
import type { MapSetOperation, MapDeleteOperation } from './operations'
import { createMapSet, createMapDelete } from './operations'

// ============================================================================
// Types
// ============================================================================

export interface MapEntry<T = unknown> {
  id: ItemId
  key: string
  value: T
  deleted: boolean
}

export interface YMapState<T = unknown> {
  entries: MapEntry<T>[]
}

// ============================================================================
// YMap Class
// ============================================================================

export class YMap<T = unknown> {
  // Map from key to the entry with the latest timestamp
  private entries: Map<string, MapEntry<T>> = new Map()

  // Map from entry ID to entry (for conflict resolution)
  private entriesById: Map<string, MapEntry<T>> = new Map()

  /**
   * Get the number of keys
   */
  get size(): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (!entry.deleted) count++
    }
    return count
  }

  /**
   * Get value for a key
   */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (entry && !entry.deleted) {
      return entry.value
    }
    return undefined
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    const entry = this.entries.get(key)
    return entry !== undefined && !entry.deleted
  }

  /**
   * Set a value
   */
  set(clock: LamportClock, key: string, value: T): MapSetOperation {
    const id = clock.createId()

    const entry: MapEntry<T> = {
      id,
      key,
      value,
      deleted: false,
    }

    this.integrateEntry(entry)

    return createMapSet(id, [], key, value)
  }

  /**
   * Delete a key
   */
  delete(clock: LamportClock, key: string): MapDeleteOperation | null {
    const existing = this.entries.get(key)
    if (!existing || existing.deleted) {
      return null
    }

    const id = clock.createId()

    // Create a tombstone entry
    const entry: MapEntry<T> = {
      id,
      key,
      value: undefined as T,
      deleted: true,
    }

    this.integrateEntry(entry)

    return createMapDelete(id, [], key)
  }

  /**
   * Apply a remote set operation
   */
  applySet(op: MapSetOperation): void {
    const entry: MapEntry<T> = {
      id: op.id,
      key: op.key,
      value: op.value as T,
      deleted: false,
    }

    this.integrateEntry(entry)
  }

  /**
   * Apply a remote delete operation
   */
  applyDelete(op: MapDeleteOperation): void {
    const entry: MapEntry<T> = {
      id: op.id,
      key: op.key,
      value: undefined as T,
      deleted: true,
    }

    this.integrateEntry(entry)
  }

  /**
   * Integrate an entry, resolving conflicts using LWW
   */
  private integrateEntry(entry: MapEntry<T>): void {
    const entryId = idToString(entry.id)

    // Check if we've already seen this exact entry
    if (this.entriesById.has(entryId)) {
      return
    }

    // Store by ID for deduplication
    this.entriesById.set(entryId, entry)

    // Get current entry for this key
    const existing = this.entries.get(entry.key)

    // LWW: later timestamp wins, tie-break by client ID
    if (!existing || compareIds(entry.id, existing.id) > 0) {
      this.entries.set(entry.key, entry)
    }
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    const result: string[] = []
    for (const [key, entry] of this.entries) {
      if (!entry.deleted) {
        result.push(key)
      }
    }
    return result
  }

  /**
   * Get all values
   */
  values(): T[] {
    const result: T[] = []
    for (const entry of this.entries.values()) {
      if (!entry.deleted) {
        result.push(entry.value)
      }
    }
    return result
  }

  /**
   * Get all entries
   */
  entries_(): [string, T][] {
    const result: [string, T][] = []
    for (const [key, entry] of this.entries) {
      if (!entry.deleted) {
        result.push([key, entry.value])
      }
    }
    return result
  }

  /**
   * Iterate over entries
   */
  forEach(callback: (value: T, key: string) => void): void {
    for (const [key, entry] of this.entries) {
      if (!entry.deleted) {
        callback(entry.value, key)
      }
    }
  }

  /**
   * Convert to plain object
   */
  toObject(): Record<string, T> {
    const result: Record<string, T> = {}
    for (const [key, entry] of this.entries) {
      if (!entry.deleted) {
        result[key] = entry.value
      }
    }
    return result
  }

  /**
   * Serialize state
   */
  toJSON(): YMapState<T> {
    return {
      entries: Array.from(this.entriesById.values()),
    }
  }

  /**
   * Restore from serialized state
   */
  static fromJSON<T>(state: YMapState<T>): YMap<T> {
    const ymap = new YMap<T>()

    for (const entry of state.entries) {
      ymap.integrateEntry(entry)
    }

    return ymap
  }

  /**
   * Clone this map
   */
  clone(): YMap<T> {
    return YMap.fromJSON(this.toJSON())
  }

  /**
   * Clear all entries
   */
  clear(clock: LamportClock): MapDeleteOperation[] {
    const operations: MapDeleteOperation[] = []
    for (const key of this.keys()) {
      const op = this.delete(clock, key)
      if (op) operations.push(op)
    }
    return operations
  }
}
