/**
 * YDoc - Root document container for CRDT collaboration
 *
 * A YDoc contains multiple named CRDT types (YText, YArray, YMap).
 * It handles:
 * - Transaction grouping for undo/redo
 * - Operation broadcasting
 * - State synchronization
 * - Version tracking
 */

import { LamportClock, VectorClock } from './clock'
import { generateClientId } from './id'
import { YText } from './ytext'
import { YArray } from './yarray'
import { YMap } from './ymap'
import type { Operation, TextInsertOperation, TextDeleteOperation, ArrayInsertOperation, ArrayDeleteOperation, MapSetOperation, MapDeleteOperation, UndoStackEntry } from './operations'

// ============================================================================
// Types
// ============================================================================

export type CrdtType = YText | YArray | YMap

export interface YDocState {
  clientId: string
  clock: number
  vectorClock: Record<string, number>
  types: Record<string, { type: string; state: unknown }>
  version: number
  undoStack: UndoStackEntry[]
  redoStack: UndoStackEntry[]
}

export interface YDocOptions {
  clientId?: string
  gc?: boolean // Enable garbage collection of deleted items
}

export type TransactionCallback = (doc: YDoc) => void

// ============================================================================
// YDoc Class
// ============================================================================

export class YDoc {
  public readonly clientId: string
  public readonly clock: LamportClock
  public readonly vectorClock: VectorClock

  private types: Map<string, CrdtType> = new Map()
  private version: number = 0

  // Undo/redo
  private undoStack: UndoStackEntry[] = []
  private redoStack: UndoStackEntry[] = []
  private currentTransaction: Operation[] = []
  private isTransacting: boolean = false

  // Event handlers
  private updateHandlers: Set<(ops: Operation[], origin: string) => void> = new Set()
  private syncHandlers: Set<(state: Uint8Array) => void> = new Set()

  constructor(options: YDocOptions = {}) {
    this.clientId = options.clientId ?? generateClientId()
    this.clock = new LamportClock(this.clientId)
    this.vectorClock = new VectorClock()
  }

  /**
   * Get or create a YText
   */
  getText(name: string = 'default'): YText {
    let text = this.types.get(name)
    if (!text) {
      text = new YText()
      this.types.set(name, text)
    }
    if (!(text instanceof YText)) {
      throw new Error(`Type "${name}" is not a YText`)
    }
    return text
  }

  /**
   * Get or create a YArray
   */
  getArray<T = unknown>(name: string = 'default'): YArray<T> {
    let arr = this.types.get(name)
    if (!arr) {
      arr = new YArray<T>()
      this.types.set(name, arr)
    }
    if (!(arr instanceof YArray)) {
      throw new Error(`Type "${name}" is not a YArray`)
    }
    return arr as YArray<T>
  }

  /**
   * Get or create a YMap
   */
  getMap<T = unknown>(name: string = 'default'): YMap<T> {
    let map = this.types.get(name)
    if (!map) {
      map = new YMap<T>()
      this.types.set(name, map)
    }
    if (!(map instanceof YMap)) {
      throw new Error(`Type "${name}" is not a YMap`)
    }
    return map as YMap<T>
  }

  /**
   * Run a transaction - groups operations for undo/redo
   */
  transact(fn: TransactionCallback, origin: string = 'local'): void {
    if (this.isTransacting) {
      // Nested transaction - just execute
      fn(this)
      return
    }

    this.isTransacting = true
    this.currentTransaction = []

    try {
      fn(this)

      // Commit transaction
      if (this.currentTransaction.length > 0) {
        this.version++

        // Push to undo stack
        this.undoStack.push({
          operations: [...this.currentTransaction],
          inverseOperations: this.computeInverseOperations(this.currentTransaction),
          timestamp: Date.now(),
        })

        // Clear redo stack on new operation
        this.redoStack = []

        // Notify handlers
        for (const handler of this.updateHandlers) {
          handler(this.currentTransaction, origin)
        }
      }
    } finally {
      this.isTransacting = false
      this.currentTransaction = []
    }
  }

  /**
   * Apply remote operations
   */
  applyOperations(operations: Operation[], origin: string = 'remote'): void {
    for (const op of operations) {
      // Update vector clock
      this.clock.receive(op.id.clock)
      this.vectorClock.increment(op.id.clientId)

      // Route to appropriate handler
      this.applyOperation(op)
    }

    this.version++

    // Notify handlers
    for (const handler of this.updateHandlers) {
      handler(operations, origin)
    }
  }

  /**
   * Apply a single operation
   */
  private applyOperation(op: Operation): void {
    const typeName = op.targetPath[0] || 'default'

    switch (op.type) {
      case 'insert': {
        const text = this.getText(typeName)
        text.applyInsert(op as TextInsertOperation)
        break
      }
      case 'delete': {
        const text = this.getText(typeName)
        text.applyDelete(op as TextDeleteOperation)
        break
      }
      case 'arrayInsert': {
        const arr = this.getArray(typeName)
        arr.applyInsert(op as ArrayInsertOperation)
        break
      }
      case 'arrayDelete': {
        const arr = this.getArray(typeName)
        arr.applyDelete(op as ArrayDeleteOperation)
        break
      }
      case 'mapSet': {
        const map = this.getMap(typeName)
        map.applySet(op as MapSetOperation)
        break
      }
      case 'mapDelete': {
        const map = this.getMap(typeName)
        map.applyDelete(op as MapDeleteOperation)
        break
      }
    }
  }

  /**
   * Record an operation during a transaction
   */
  recordOperation(op: Operation): void {
    if (this.isTransacting) {
      this.currentTransaction.push(op)
    }
  }

  /**
   * Undo the last transaction
   */
  undo(): boolean {
    const entry = this.undoStack.pop()
    if (!entry) return false

    // Apply inverse operations
    for (const op of entry.inverseOperations) {
      this.applyOperation(op)
    }

    // Push to redo stack
    this.redoStack.push(entry)

    this.version++
    return true
  }

  /**
   * Redo the last undone transaction
   */
  redo(): boolean {
    const entry = this.redoStack.pop()
    if (!entry) return false

    // Apply original operations
    for (const op of entry.operations) {
      this.applyOperation(op)
    }

    // Push back to undo stack
    this.undoStack.push(entry)

    this.version++
    return true
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * Compute inverse operations for undo
   */
  private computeInverseOperations(operations: Operation[]): Operation[] {
    // For simplicity, we store the forward operations and apply reverse logic
    // A full implementation would compute proper inverse operations
    return operations.map((op) => {
      switch (op.type) {
        case 'insert':
          return {
            type: 'delete' as const,
            id: this.clock.createId(),
            targetPath: op.targetPath,
            targetId: op.id,
            length: (op as TextInsertOperation).content.length,
          }
        case 'delete':
          // Would need to store deleted content for proper inverse
          return op
        default:
          return op
      }
    })
  }

  /**
   * Subscribe to updates
   */
  onUpdate(handler: (ops: Operation[], origin: string) => void): () => void {
    this.updateHandlers.add(handler)
    return () => this.updateHandlers.delete(handler)
  }

  /**
   * Subscribe to sync state changes
   */
  onSync(handler: (state: Uint8Array) => void): () => void {
    this.syncHandlers.add(handler)
    return () => this.syncHandlers.delete(handler)
  }

  /**
   * Get current version
   */
  getVersion(): number {
    return this.version
  }

  /**
   * Encode state for synchronization
   */
  encodeState(): Uint8Array {
    const state = this.toJSON()
    const json = JSON.stringify(state)
    return new TextEncoder().encode(json)
  }

  /**
   * Apply state from another replica
   */
  applyState(encoded: Uint8Array): void {
    const json = new TextDecoder().decode(encoded)
    const state = JSON.parse(json) as YDocState
    this.mergeState(state)
  }

  /**
   * Merge state from another document
   */
  private mergeState(state: YDocState): void {
    // Merge vector clock
    this.vectorClock.merge(VectorClock.fromJSON(state.vectorClock))

    // Merge each type
    for (const [name, typeState] of Object.entries(state.types)) {
      switch (typeState.type) {
        case 'YText': {
          const local = this.getText(name)
          const remote = YText.fromJSON(typeState.state as ReturnType<YText['toJSON']>)
          // Merge items - in a real implementation, we'd merge the item sets
          // For simplicity, we take the longer text
          if (remote.length > local.length) {
            this.types.set(name, remote)
          }
          break
        }
        case 'YArray': {
          const local = this.getArray(name)
          const remote = YArray.fromJSON(typeState.state as ReturnType<YArray['toJSON']>)
          if (remote.length > local.length) {
            this.types.set(name, remote)
          }
          break
        }
        case 'YMap': {
          const remote = YMap.fromJSON(typeState.state as ReturnType<YMap['toJSON']>)
          this.types.set(name, remote)
          break
        }
      }
    }
  }

  /**
   * Serialize document state
   */
  toJSON(): YDocState {
    const types: Record<string, { type: string; state: unknown }> = {}

    for (const [name, crdt] of this.types) {
      if (crdt instanceof YText) {
        types[name] = { type: 'YText', state: crdt.toJSON() }
      } else if (crdt instanceof YArray) {
        types[name] = { type: 'YArray', state: crdt.toJSON() }
      } else if (crdt instanceof YMap) {
        types[name] = { type: 'YMap', state: crdt.toJSON() }
      }
    }

    return {
      clientId: this.clientId,
      clock: this.clock.getCounter(),
      vectorClock: this.vectorClock.toJSON(),
      types,
      version: this.version,
      undoStack: this.undoStack,
      redoStack: this.redoStack,
    }
  }

  /**
   * Restore document from serialized state
   */
  static fromJSON(state: YDocState): YDoc {
    const doc = new YDoc({ clientId: state.clientId })
    doc.clock.receive(state.clock)
    doc.vectorClock.merge(VectorClock.fromJSON(state.vectorClock))
    doc.version = state.version
    doc.undoStack = state.undoStack
    doc.redoStack = state.redoStack

    for (const [name, typeState] of Object.entries(state.types)) {
      switch (typeState.type) {
        case 'YText':
          doc.types.set(name, YText.fromJSON(typeState.state as ReturnType<YText['toJSON']>))
          break
        case 'YArray':
          doc.types.set(name, YArray.fromJSON(typeState.state as ReturnType<YArray['toJSON']>))
          break
        case 'YMap':
          doc.types.set(name, YMap.fromJSON(typeState.state as ReturnType<YMap['toJSON']>))
          break
      }
    }

    return doc
  }

  /**
   * Destroy document and clean up
   */
  destroy(): void {
    this.updateHandlers.clear()
    this.syncHandlers.clear()
    this.types.clear()
    this.undoStack = []
    this.redoStack = []
  }
}
