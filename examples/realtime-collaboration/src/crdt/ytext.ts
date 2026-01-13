/**
 * YText - CRDT for collaborative text editing
 *
 * Uses the YATA (Yet Another Transformation Approach) algorithm:
 * - Each character is an item with a unique ID
 * - Items form a linked list ordered by their insertion position
 * - Concurrent inserts are resolved by comparing IDs
 *
 * Supports:
 * - Character-level insertions and deletions
 * - Rich text formatting attributes
 * - Efficient delta-based updates
 */

import type { ItemId } from './id'
import { compareIds, idsEqual, idToString } from './id'
import type { LamportClock } from './clock'
import type { TextInsertOperation, TextDeleteOperation } from './operations'
import { createTextInsert, createTextDelete } from './operations'

// ============================================================================
// Types
// ============================================================================

/**
 * A single item in the text CRDT
 */
export interface TextItem {
  id: ItemId
  content: string
  left: ItemId | null
  right: ItemId | null
  deleted: boolean
  attributes?: Record<string, unknown>
}

/**
 * A delta representing a change in text
 */
export interface TextDelta {
  insert?: string
  delete?: number
  retain?: number
  attributes?: Record<string, unknown>
}

/**
 * Serialized state of a YText
 */
export interface YTextState {
  items: TextItem[]
  length: number
}

// ============================================================================
// YText Class
// ============================================================================

export class YText {
  private items: Map<string, TextItem> = new Map()
  private head: ItemId | null = null
  private tail: ItemId | null = null
  private _length: number = 0

  /**
   * Get the length of the text (excluding deleted items)
   */
  get length(): number {
    return this._length
  }

  /**
   * Convert to plain string
   */
  toString(): string {
    const chars: string[] = []
    let current = this.head

    while (current) {
      const item = this.items.get(idToString(current))
      if (item && !item.deleted) {
        chars.push(item.content)
      }
      current = item?.right ?? null
    }

    return chars.join('')
  }

  /**
   * Insert text at a given index
   */
  insert(clock: LamportClock, index: number, content: string, attributes?: Record<string, unknown>): TextInsertOperation[] {
    const operations: TextInsertOperation[] = []

    // Find left and right neighbors
    const { left, right } = this.findPosition(index)

    // Insert each character as a separate item (could optimize for runs)
    let prevId = left
    for (let i = 0; i < content.length; i++) {
      const id = clock.createId()
      const char = content[i]

      const item: TextItem = {
        id,
        content: char,
        left: prevId,
        right: i === content.length - 1 ? right : null, // Will be set by next iteration
        deleted: false,
        attributes,
      }

      this.integrateItem(item)
      operations.push(createTextInsert(id, [], char, prevId, right, attributes))

      prevId = id
    }

    return operations
  }

  /**
   * Delete text starting at index with given length
   */
  delete(clock: LamportClock, index: number, length: number): TextDeleteOperation[] {
    const operations: TextDeleteOperation[] = []

    // Find items to delete
    const items = this.getItemsInRange(index, length)

    for (const item of items) {
      if (!item.deleted) {
        const id = clock.createId()
        this.markDeleted(item.id)
        operations.push(createTextDelete(id, [], item.id, 1))
      }
    }

    return operations
  }

  /**
   * Apply a remote insert operation
   */
  applyInsert(op: TextInsertOperation): void {
    // Check if already applied
    if (this.items.has(idToString(op.id))) {
      return
    }

    const item: TextItem = {
      id: op.id,
      content: op.content,
      left: op.left,
      right: op.right,
      deleted: false,
      attributes: op.attributes,
    }

    this.integrateItem(item)
  }

  /**
   * Apply a remote delete operation
   */
  applyDelete(op: TextDeleteOperation): void {
    this.markDeleted(op.targetId)
  }

  /**
   * Integrate a new item into the correct position
   * Uses YATA algorithm for concurrent insert resolution
   */
  private integrateItem(item: TextItem): void {
    const key = idToString(item.id)

    // Already integrated
    if (this.items.has(key)) {
      return
    }

    // Find actual integration position among concurrent inserts
    let left = item.left
    let right = item.right

    // YATA: Scan right while we find concurrent items that should come before us
    while (right) {
      const rightItem = this.items.get(idToString(right))
      if (!rightItem) break

      // Check if right item was inserted between our left and right
      if (this.isBetween(rightItem, item.left, item.right)) {
        // Compare origins to decide order
        if (this.shouldInsertBefore(item, rightItem)) {
          break
        }
        // Move past this item
        left = right
        right = rightItem.right
      } else {
        break
      }
    }

    // Update links
    item.left = left
    item.right = right

    // Update neighbors
    if (left) {
      const leftItem = this.items.get(idToString(left))
      if (leftItem) {
        leftItem.right = item.id
      }
    } else {
      this.head = item.id
    }

    if (right) {
      const rightItem = this.items.get(idToString(right))
      if (rightItem) {
        rightItem.left = item.id
      }
    } else {
      this.tail = item.id
    }

    // Add to items map
    this.items.set(key, item)

    // Update length if not deleted
    if (!item.deleted) {
      this._length += item.content.length
    }
  }

  /**
   * Check if an item was originally between left and right
   */
  private isBetween(item: TextItem, left: ItemId | null, right: ItemId | null): boolean {
    // Item is between if its original left/right match our left/right
    return idsEqual(item.left, left) || idsEqual(item.right, right)
  }

  /**
   * YATA: Decide if item should be inserted before other
   * Uses ID comparison as tie-breaker
   */
  private shouldInsertBefore(item: TextItem, other: TextItem): boolean {
    // Compare by left origin first
    if (!idsEqual(item.left, other.left)) {
      // The item with the "later" left origin goes first
      if (!item.left) return true
      if (!other.left) return false
      return compareIds(item.left, other.left) > 0
    }

    // Same origin - use ID as tie-breaker (lower ID first)
    return compareIds(item.id, other.id) < 0
  }

  /**
   * Mark an item as deleted
   */
  private markDeleted(id: ItemId): void {
    const item = this.items.get(idToString(id))
    if (item && !item.deleted) {
      item.deleted = true
      this._length -= item.content.length
    }
  }

  /**
   * Find the left and right neighbors for a given index
   */
  private findPosition(index: number): { left: ItemId | null; right: ItemId | null } {
    if (index <= 0) {
      return { left: null, right: this.head }
    }

    let current = this.head
    let pos = 0

    while (current) {
      const item = this.items.get(idToString(current))
      if (!item) break

      if (!item.deleted) {
        pos++
        if (pos === index) {
          return { left: current, right: item.right }
        }
      }

      current = item.right
    }

    // Index at end
    return { left: this.tail, right: null }
  }

  /**
   * Get items in a given range
   */
  private getItemsInRange(index: number, length: number): TextItem[] {
    const result: TextItem[] = []
    let current = this.head
    let pos = 0
    let count = 0

    while (current && count < length) {
      const item = this.items.get(idToString(current))
      if (!item) break

      if (!item.deleted) {
        if (pos >= index) {
          result.push(item)
          count++
        }
        pos++
      }

      current = item.right
    }

    return result
  }

  /**
   * Get text at a specific index
   */
  charAt(index: number): string {
    const items = this.getItemsInRange(index, 1)
    return items[0]?.content ?? ''
  }

  /**
   * Get a substring
   */
  substring(start: number, end?: number): string {
    const len = end !== undefined ? end - start : this._length - start
    const items = this.getItemsInRange(start, len)
    return items.map((i) => i.content).join('')
  }

  /**
   * Convert to delta format (Quill-compatible)
   */
  toDelta(): TextDelta[] {
    const deltas: TextDelta[] = []
    let current = this.head
    let currentRun = ''
    let currentAttrs: Record<string, unknown> | undefined

    while (current) {
      const item = this.items.get(idToString(current))
      if (!item) break

      if (!item.deleted) {
        // Check if we can extend the current run
        const attrsMatch = JSON.stringify(currentAttrs) === JSON.stringify(item.attributes)

        if (attrsMatch) {
          currentRun += item.content
        } else {
          // Flush current run
          if (currentRun) {
            const delta: TextDelta = { insert: currentRun }
            if (currentAttrs) delta.attributes = currentAttrs
            deltas.push(delta)
          }
          // Start new run
          currentRun = item.content
          currentAttrs = item.attributes
        }
      }

      current = item.right
    }

    // Flush final run
    if (currentRun) {
      const delta: TextDelta = { insert: currentRun }
      if (currentAttrs) delta.attributes = currentAttrs
      deltas.push(delta)
    }

    return deltas
  }

  /**
   * Serialize state
   */
  toJSON(): YTextState {
    const items: TextItem[] = []
    let current = this.head

    while (current) {
      const item = this.items.get(idToString(current))
      if (item) {
        items.push(item)
      }
      current = item?.right ?? null
    }

    return {
      items,
      length: this._length,
    }
  }

  /**
   * Restore from serialized state
   */
  static fromJSON(state: YTextState): YText {
    const ytext = new YText()

    // Rebuild the linked list
    for (const item of state.items) {
      ytext.items.set(idToString(item.id), item)
    }

    // Find head and tail
    if (state.items.length > 0) {
      ytext.head = state.items[0].id
      ytext.tail = state.items[state.items.length - 1].id
    }

    ytext._length = state.length

    return ytext
  }

  /**
   * Clone this YText
   */
  clone(): YText {
    return YText.fromJSON(this.toJSON())
  }
}
