/**
 * CRDT Operations
 *
 * Operations are the messages sent between replicas to synchronize state.
 * Each operation is idempotent - applying the same operation multiple times
 * has the same effect as applying it once.
 */

import type { ItemId } from './id'

// ============================================================================
// Base Operation Types
// ============================================================================

export type OperationType =
  | 'insert'
  | 'delete'
  | 'set'
  | 'arrayInsert'
  | 'arrayDelete'
  | 'mapSet'
  | 'mapDelete'

export interface BaseOperation {
  type: OperationType
  id: ItemId
  targetPath: string[] // Path to the target CRDT (e.g., ['doc', 'content'])
}

// ============================================================================
// Text Operations (YText)
// ============================================================================

export interface TextInsertOperation extends BaseOperation {
  type: 'insert'
  content: string
  left: ItemId | null // ID of the item to the left (null = start of text)
  right: ItemId | null // ID of the item to the right (null = end of text)
  attributes?: Record<string, unknown> // Formatting attributes
}

export interface TextDeleteOperation extends BaseOperation {
  type: 'delete'
  targetId: ItemId // ID of the item to delete
  length: number // Number of characters to delete (for batch deletes)
}

// ============================================================================
// Array Operations (YArray)
// ============================================================================

export interface ArrayInsertOperation extends BaseOperation {
  type: 'arrayInsert'
  content: unknown // The item to insert
  left: ItemId | null
  right: ItemId | null
}

export interface ArrayDeleteOperation extends BaseOperation {
  type: 'arrayDelete'
  targetId: ItemId
}

// ============================================================================
// Map Operations (YMap)
// ============================================================================

export interface MapSetOperation extends BaseOperation {
  type: 'mapSet'
  key: string
  value: unknown
}

export interface MapDeleteOperation extends BaseOperation {
  type: 'mapDelete'
  key: string
}

// ============================================================================
// Union Types
// ============================================================================

export type TextOperation = TextInsertOperation | TextDeleteOperation

export type ArrayOperation = ArrayInsertOperation | ArrayDeleteOperation

export type MapOperation = MapSetOperation | MapDeleteOperation

export type Operation = TextOperation | ArrayOperation | MapOperation

// ============================================================================
// Operation Utilities
// ============================================================================

/**
 * Create a text insert operation
 */
export function createTextInsert(
  id: ItemId,
  targetPath: string[],
  content: string,
  left: ItemId | null,
  right: ItemId | null,
  attributes?: Record<string, unknown>
): TextInsertOperation {
  return {
    type: 'insert',
    id,
    targetPath,
    content,
    left,
    right,
    attributes,
  }
}

/**
 * Create a text delete operation
 */
export function createTextDelete(id: ItemId, targetPath: string[], targetId: ItemId, length: number = 1): TextDeleteOperation {
  return {
    type: 'delete',
    id,
    targetPath,
    targetId,
    length,
  }
}

/**
 * Create a map set operation
 */
export function createMapSet(id: ItemId, targetPath: string[], key: string, value: unknown): MapSetOperation {
  return {
    type: 'mapSet',
    id,
    targetPath,
    key,
    value,
  }
}

/**
 * Create a map delete operation
 */
export function createMapDelete(id: ItemId, targetPath: string[], key: string): MapDeleteOperation {
  return {
    type: 'mapDelete',
    id,
    targetPath,
    key,
  }
}

/**
 * Create an array insert operation
 */
export function createArrayInsert(id: ItemId, targetPath: string[], content: unknown, left: ItemId | null, right: ItemId | null): ArrayInsertOperation {
  return {
    type: 'arrayInsert',
    id,
    targetPath,
    content,
    left,
    right,
  }
}

/**
 * Create an array delete operation
 */
export function createArrayDelete(id: ItemId, targetPath: string[], targetId: ItemId): ArrayDeleteOperation {
  return {
    type: 'arrayDelete',
    id,
    targetPath,
    targetId,
  }
}

// ============================================================================
// Operation History
// ============================================================================

/**
 * Operation history entry with metadata
 */
export interface HistoryEntry {
  operation: Operation
  timestamp: number
  version: number
}

/**
 * Undo stack entry (groups operations that should be undone together)
 */
export interface UndoStackEntry {
  operations: Operation[]
  inverseOperations: Operation[]
  timestamp: number
}
