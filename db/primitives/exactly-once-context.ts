/**
 * ExactlyOnceContext - Transactional processing primitive with deduplication
 *
 * Provides exactly-once processing semantics for event-driven systems:
 * - Idempotent processing with event ID deduplication
 * - Atomic transactions with commit/rollback
 * - Outbox pattern for reliable event delivery
 * - Checkpoint coordination for distributed recovery
 */

/** Options for configuring the ExactlyOnceContext */
export interface ExactlyOnceContextOptions {
  /** TTL for processed event IDs (ms) */
  eventIdTtl?: number
  /** Maximum buffered events before auto-flush */
  maxBufferedEvents?: number
  /** Callback for delivering events */
  onDeliver?: (events: unknown[]) => Promise<void>
}

/** Checkpoint barrier for distributed coordination */
export interface CheckpointBarrier {
  /** Unique checkpoint ID */
  checkpointId: string
  /** Checkpoint epoch number */
  epoch: number
  /** Timestamp of the checkpoint */
  timestamp: number
}

/** State snapshot for recovery */
export interface CheckpointState {
  /** State data */
  state: Map<string, unknown>
  /** Processed event IDs (for dedup) */
  processedIds: Set<string>
  /** Pending outbox events */
  pendingEvents: unknown[]
  /** Epoch at checkpoint time */
  epoch: number
}

/** Transaction interface for atomic operations */
export interface Transaction {
  /** Get a value by key */
  get(key: string): Promise<unknown>
  /** Put a value by key */
  put(key: string, value: unknown): Promise<void>
  /** Delete a value by key */
  delete(key: string): Promise<void>
  /** Emit an event (buffered until commit) */
  emit(event: unknown): void
}

/** ExactlyOnceContext interface */
export interface ExactlyOnceContextInterface {
  /** Process event exactly once (idempotent) */
  processOnce<T>(eventId: string, fn: () => Promise<T>): Promise<T>

  /** Check if event was already processed */
  isProcessed(eventId: string): Promise<boolean>

  /** Execute atomic transaction */
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>

  /** Buffer an event for delivery */
  emit(event: unknown): void

  /** Flush buffered events to delivery */
  flush(): Promise<void>

  /** Handle checkpoint barrier */
  onBarrier(barrier: CheckpointBarrier): Promise<void>

  /** Get current checkpoint state */
  getCheckpointState(): Promise<CheckpointState>

  /** Restore from checkpoint state */
  restoreFromCheckpoint(state: CheckpointState): Promise<void>

  /** Get current epoch */
  getEpoch(): number

  /** Get count of buffered events */
  getBufferedEventCount(): number

  /** Clear all state (for testing) */
  clear(): Promise<void>
}

/** Processed event entry with timestamp and cached result */
interface ProcessedEntry {
  timestamp: number
  result: unknown
}

/**
 * ExactlyOnceContext implementation
 */
export class ExactlyOnceContext implements ExactlyOnceContextInterface {
  private options: ExactlyOnceContextOptions
  private state: Map<string, unknown> = new Map()
  private processedIds: Map<string, ProcessedEntry> = new Map()
  private pendingEvents: unknown[] = []
  private epoch: number = 0
  private processingLocks: Map<string, Promise<unknown>> = new Map()
  private transactionLock: Promise<unknown> | null = null

  constructor(options?: ExactlyOnceContextOptions) {
    this.options = options ?? {}
  }

  async processOnce<T>(eventId: string, fn: () => Promise<T>): Promise<T> {
    // Check if already being processed (concurrent call)
    const existingLock = this.processingLocks.get(eventId)
    if (existingLock) {
      return existingLock as Promise<T>
    }

    // Check if already processed and not expired
    const entry = this.processedIds.get(eventId)
    if (entry) {
      const ttl = this.options.eventIdTtl
      if (ttl === undefined || Date.now() - entry.timestamp < ttl) {
        return entry.result as T
      }
      // TTL expired, remove entry
      this.processedIds.delete(eventId)
    }

    // Create processing promise with lock
    const processingPromise = (async () => {
      try {
        const result = await fn()
        // Mark as processed only on success
        this.processedIds.set(eventId, {
          timestamp: Date.now(),
          result,
        })
        return result
      } finally {
        // Always release lock
        this.processingLocks.delete(eventId)
      }
    })()

    this.processingLocks.set(eventId, processingPromise)
    return processingPromise as Promise<T>
  }

  async isProcessed(eventId: string): Promise<boolean> {
    const entry = this.processedIds.get(eventId)
    if (!entry) return false

    const ttl = this.options.eventIdTtl
    if (ttl !== undefined && Date.now() - entry.timestamp >= ttl) {
      this.processedIds.delete(eventId)
      return false
    }
    return true
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    // Wait for any existing transaction
    while (this.transactionLock) {
      await this.transactionLock
    }

    // Create a snapshot for rollback
    const stateSnapshot = new Map(this.state)
    const eventsSnapshot = [...this.pendingEvents]

    // Transaction buffer for events
    const txEvents: unknown[] = []

    const tx: Transaction = {
      get: async (key: string): Promise<unknown> => {
        return this.state.get(key)
      },
      put: async (key: string, value: unknown): Promise<void> => {
        this.state.set(key, value)
      },
      delete: async (key: string): Promise<void> => {
        this.state.delete(key)
      },
      emit: (event: unknown): void => {
        txEvents.push(event)
      },
    }

    const txPromise = (async () => {
      try {
        const result = await fn(tx)
        // Commit: add transaction events to pending
        this.pendingEvents.push(...txEvents)
        return result
      } catch (error) {
        // Rollback: restore state
        this.state = stateSnapshot
        this.pendingEvents = eventsSnapshot
        throw error
      } finally {
        this.transactionLock = null
      }
    })()

    this.transactionLock = txPromise
    return txPromise
  }

  emit(event: unknown): void {
    this.pendingEvents.push(event)
  }

  async flush(): Promise<void> {
    if (this.pendingEvents.length === 0) return

    const eventsToDeliver = [...this.pendingEvents]

    if (this.options.onDeliver) {
      try {
        await this.options.onDeliver(eventsToDeliver)
        // Clear buffer only on success
        this.pendingEvents = []
      } catch (error) {
        // Preserve events for retry
        throw error
      }
    } else {
      // No delivery handler, just clear
      this.pendingEvents = []
    }
  }

  async onBarrier(barrier: CheckpointBarrier): Promise<void> {
    // Flush pending events
    await this.flush()
    // Increment epoch
    this.epoch = barrier.epoch + 1
  }

  async getCheckpointState(): Promise<CheckpointState> {
    // Convert processedIds Map to Set of just the IDs
    const processedIdsSet = new Set(this.processedIds.keys())

    return {
      state: new Map(this.state),
      processedIds: processedIdsSet,
      pendingEvents: [...this.pendingEvents],
      epoch: this.epoch,
    }
  }

  async restoreFromCheckpoint(checkpointState: CheckpointState): Promise<void> {
    // Validate epoch
    if (checkpointState.epoch < 0) {
      throw new Error('Invalid epoch: must be non-negative')
    }

    this.state = new Map(checkpointState.state)

    // Convert Set to Map with dummy entries (no cached result)
    this.processedIds = new Map()
    for (const id of checkpointState.processedIds) {
      this.processedIds.set(id, {
        timestamp: Date.now(),
        result: undefined, // No cached result on restore
      })
    }

    this.pendingEvents = [...checkpointState.pendingEvents]
    this.epoch = checkpointState.epoch
  }

  getEpoch(): number {
    return this.epoch
  }

  getBufferedEventCount(): number {
    return this.pendingEvents.length
  }

  async clear(): Promise<void> {
    this.state = new Map()
    this.processedIds = new Map()
    this.pendingEvents = []
    this.epoch = 0
    this.processingLocks = new Map()
    this.transactionLock = null
  }
}

/**
 * Factory function to create an ExactlyOnceContext
 */
export function createExactlyOnceContext(options?: ExactlyOnceContextOptions): ExactlyOnceContext {
  return new ExactlyOnceContext(options)
}
