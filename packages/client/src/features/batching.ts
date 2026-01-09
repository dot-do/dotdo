/**
 * Request batching feature for @dotdo/client
 *
 * Batches multiple concurrent RPC calls into single requests.
 */

import type { PendingCall, RPCMessage, RPCResponse, QueueChangeCallback } from '../types'
import { generateId } from '../utils'

export interface BatchingConfig {
  /** Time window to collect calls before sending (ms) */
  batchWindow?: number
  /** Maximum calls per batch */
  maxBatchSize?: number
  /** Whether batching is enabled */
  enabled?: boolean
}

export interface BatchManager {
  /** Add a call to the batch queue */
  add(call: PendingCall): void
  /** Flush pending batches immediately */
  flush(): void
  /** Clear all pending calls */
  clear(): void
  /** Get current queue count */
  readonly count: number
  /** Set queue change callback */
  onQueueChange(callback: QueueChangeCallback): void
}

/**
 * Create a batch manager
 */
export function createBatchManager(
  config: BatchingConfig,
  sendCall: (call: PendingCall) => void
): BatchManager {
  const batchWindow = config.batchWindow ?? 0
  const maxBatchSize = config.maxBatchSize ?? 100
  const enabled = config.enabled !== false

  let batchQueue: PendingCall[] = []
  let batchTimeoutId: ReturnType<typeof setTimeout> | null = null
  let queueChangeCallback: QueueChangeCallback | null = null

  function emitQueueChange(): void {
    queueChangeCallback?.(batchQueue.length)
  }

  function add(call: PendingCall): void {
    if (!enabled) {
      sendCall(call)
      return
    }

    batchQueue.push(call)
    emitQueueChange()

    // If we hit max batch size, send immediately
    if (batchQueue.length >= maxBatchSize) {
      flush()
      return
    }

    // Schedule batch flush if not already scheduled
    if (!batchTimeoutId) {
      batchTimeoutId = setTimeout(() => {
        flush()
      }, batchWindow)
    }
  }

  function flush(): void {
    if (batchTimeoutId) {
      clearTimeout(batchTimeoutId)
      batchTimeoutId = null
    }

    const batch = [...batchQueue]
    batchQueue = []
    emitQueueChange()

    if (batch.length === 0) return

    if (batch.length === 1) {
      // Single call, send directly
      sendCall(batch[0])
      return
    }

    // Multiple calls, batch them
    const batchId = generateId()
    const batchMessage: RPCMessage = {
      id: batchId,
      batch: batch.map(c => c.message),
    }

    // Create a composite pending call that will distribute results
    const batchCall: PendingCall = {
      id: batchId,
      message: batchMessage,
      resolve: (results) => {
        const batchResults = results as RPCResponse[]
        for (let i = 0; i < batch.length; i++) {
          const call = batch[i]
          const result = batchResults[i]
          if (call.timeoutId) {
            clearTimeout(call.timeoutId)
          }
          if (result?.error) {
            call.reject(result.error)
          } else {
            call.resolve(result?.result)
          }
        }
      },
      reject: (error) => {
        for (const call of batch) {
          if (call.timeoutId) {
            clearTimeout(call.timeoutId)
          }
          call.reject(error)
        }
      },
    }

    sendCall(batchCall)
  }

  function clear(): void {
    if (batchTimeoutId) {
      clearTimeout(batchTimeoutId)
      batchTimeoutId = null
    }

    const error = { code: 'QUEUE_CLEARED', message: 'Queue was cleared' }
    for (const call of batchQueue) {
      call.reject(error)
    }
    batchQueue = []
    emitQueueChange()
  }

  return {
    add,
    flush,
    clear,
    get count() { return batchQueue.length },
    onQueueChange(callback: QueueChangeCallback) {
      queueChangeCallback = callback
    },
  }
}
