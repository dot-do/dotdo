/**
 * Offline queue feature for @dotdo/client
 *
 * Queues calls when offline and flushes when connection is restored.
 */

import type { PendingCall, RPCError, QueueChangeCallback } from '../types'

export interface OfflineQueueManager {
  /** Add a call to the queue */
  enqueue(call: PendingCall): void
  /** Get and clear all queued calls */
  flush(): PendingCall[]
  /** Clear the queue (rejecting all calls) */
  clear(): void
  /** Get current queue count */
  readonly count: number
  /** Set queue change callback */
  onQueueChange(callback: QueueChangeCallback): void
}

/**
 * Create an offline queue manager
 */
export function createOfflineQueue(limit: number = 1000): OfflineQueueManager {
  let queue: PendingCall[] = []
  let queueChangeCallback: QueueChangeCallback | null = null

  function emitQueueChange(): void {
    queueChangeCallback?.(queue.length)
  }

  function enqueue(call: PendingCall): void {
    queue.push(call)
    enforceLimit()
    emitQueueChange()
  }

  function enforceLimit(): void {
    while (queue.length > limit) {
      const dropped = queue.shift()
      if (dropped) {
        dropped.reject({ code: 'QUEUE_OVERFLOW', message: 'Offline queue limit exceeded' })
      }
    }
  }

  function flush(): PendingCall[] {
    const items = [...queue]
    queue = []
    emitQueueChange()
    return items
  }

  function clear(): void {
    const error: RPCError = { code: 'QUEUE_CLEARED', message: 'Queue was cleared' }
    for (const call of queue) {
      call.reject(error)
    }
    queue = []
    emitQueueChange()
  }

  return {
    enqueue,
    flush,
    clear,
    get count() { return queue.length },
    onQueueChange(callback: QueueChangeCallback) {
      queueChangeCallback = callback
    },
  }
}
