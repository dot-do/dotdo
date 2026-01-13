/**
 * YArray - CRDT for collaborative arrays
 *
 * Similar to YText but for arbitrary values instead of characters.
 * Each element has a unique ID and is linked to its neighbors.
 */

import type { ItemId } from './id'
import { compareIds, idsEqual, idToString } from './id'
import type { LamportClock } from './clock'
import type { ArrayInsertOperation, ArrayDeleteOperation } from './operations'
import { createArrayInsert, createArrayDelete } from './operations'

// ============================================================================
// Types
// ============================================================================

export interface ArrayItem<T = unknown> {
  id: ItemId
  content: T
  left: ItemId | null
  right: ItemId | null
  deleted: boolean
}

export interface YArrayState<T = unknown> {
  items: ArrayItem<T>[]
  length: number
}

// ============================================================================
// YArray Class
// ============================================================================

export class YArray<T = unknown> {
  private items: Map<string, ArrayItem<T>> = new Map()
  private head: ItemId | null = null
  private tail: ItemId | null = null
  private _length: number = 0

  /**
   * Get the length of the array (excluding deleted items)
   */
  get length(): number {
    return this._length
  }

  /**
   * Convert to plain array
   */
  toArray(): T[] {
    const result: T[] = []
    let current = this.head

    while (current) {
      const item = this.items.get(idToString(current))
      if (item && !item.deleted) {
        result.push(item.content)
      }
      current = item?.right ?? null
    }

    return result
  }

  /**
   * Get item at index
   */
  get(index: number): T | undefined {
    const items = this.getItemsInRange(index, 1)
    return items[0]?.content
  }

  /**
   * Insert item at index
   */
  insert(clock: LamportClock, index: number, content: T): ArrayInsertOperation {
    const { left, right } = this.findPosition(index)
    const id = clock.createId()

    const item: ArrayItem<T> = {
      id,
      content,
      left,
      right,
      deleted: false,
    }

    this.integrateItem(item)

    return createArrayInsert(id, [], content, left, right)
  }

  /**
   * Push item to end
   */
  push(clock: LamportClock, content: T): ArrayInsertOperation {
    return this.insert(clock, this._length, content)
  }

  /**
   * Unshift item to beginning
   */
  unshift(clock: LamportClock, content: T): ArrayInsertOperation {
    return this.insert(clock, 0, content)
  }

  /**
   * Delete item at index
   */
  delete(clock: LamportClock, index: number): ArrayDeleteOperation | null {
    const items = this.getItemsInRange(index, 1)
    if (items.length === 0) return null

    const item = items[0]
    const id = clock.createId()

    this.markDeleted(item.id)

    return createArrayDelete(id, [], item.id)
  }

  /**
   * Apply a remote insert operation
   */
  applyInsert(op: ArrayInsertOperation): void {
    if (this.items.has(idToString(op.id))) {
      return
    }

    const item: ArrayItem<T> = {
      id: op.id,
      content: op.content as T,
      left: op.left,
      right: op.right,
      deleted: false,
    }

    this.integrateItem(item)
  }

  /**
   * Apply a remote delete operation
   */
  applyDelete(op: ArrayDeleteOperation): void {
    this.markDeleted(op.targetId)
  }

  /**
   * Integrate a new item into the correct position
   */
  private integrateItem(item: ArrayItem<T>): void {
    const key = idToString(item.id)

    if (this.items.has(key)) {
      return
    }

    let left = item.left
    let right = item.right

    // YATA algorithm for concurrent insert resolution
    while (right) {
      const rightItem = this.items.get(idToString(right))
      if (!rightItem) break

      if (this.isBetween(rightItem, item.left, item.right)) {
        if (this.shouldInsertBefore(item, rightItem)) {
          break
        }
        left = right
        right = rightItem.right
      } else {
        break
      }
    }

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

    this.items.set(key, item)

    if (!item.deleted) {
      this._length++
    }
  }

  private isBetween(item: ArrayItem<T>, left: ItemId | null, right: ItemId | null): boolean {
    return idsEqual(item.left, left) || idsEqual(item.right, right)
  }

  private shouldInsertBefore(item: ArrayItem<T>, other: ArrayItem<T>): boolean {
    if (!idsEqual(item.left, other.left)) {
      if (!item.left) return true
      if (!other.left) return false
      return compareIds(item.left, other.left) > 0
    }
    return compareIds(item.id, other.id) < 0
  }

  private markDeleted(id: ItemId): void {
    const item = this.items.get(idToString(id))
    if (item && !item.deleted) {
      item.deleted = true
      this._length--
    }
  }

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

    return { left: this.tail, right: null }
  }

  private getItemsInRange(index: number, length: number): ArrayItem<T>[] {
    const result: ArrayItem<T>[] = []
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
   * Iterate over items
   */
  forEach(callback: (item: T, index: number) => void): void {
    let current = this.head
    let index = 0

    while (current) {
      const item = this.items.get(idToString(current))
      if (item && !item.deleted) {
        callback(item.content, index)
        index++
      }
      current = item?.right ?? null
    }
  }

  /**
   * Map over items
   */
  map<U>(callback: (item: T, index: number) => U): U[] {
    const result: U[] = []
    this.forEach((item, index) => {
      result.push(callback(item, index))
    })
    return result
  }

  /**
   * Filter items
   */
  filter(predicate: (item: T, index: number) => boolean): T[] {
    const result: T[] = []
    this.forEach((item, index) => {
      if (predicate(item, index)) {
        result.push(item)
      }
    })
    return result
  }

  /**
   * Find an item
   */
  find(predicate: (item: T, index: number) => boolean): T | undefined {
    let current = this.head
    let index = 0

    while (current) {
      const item = this.items.get(idToString(current))
      if (item && !item.deleted) {
        if (predicate(item.content, index)) {
          return item.content
        }
        index++
      }
      current = item?.right ?? null
    }

    return undefined
  }

  /**
   * Serialize state
   */
  toJSON(): YArrayState<T> {
    const items: ArrayItem<T>[] = []
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
  static fromJSON<T>(state: YArrayState<T>): YArray<T> {
    const yarray = new YArray<T>()

    for (const item of state.items) {
      yarray.items.set(idToString(item.id), item)
    }

    if (state.items.length > 0) {
      yarray.head = state.items[0].id
      yarray.tail = state.items[state.items.length - 1].id
    }

    yarray._length = state.length

    return yarray
  }

  /**
   * Clone this array
   */
  clone(): YArray<T> {
    return YArray.fromJSON(this.toJSON())
  }
}
