/**
 * Batch Message Execution
 *
 * This module provides client-side batching (RpcBatcher) and broker-side
 * parallel execution (executeBatch) for RPC messages.
 *
 * Key capabilities:
 * - Client collects multiple calls into a batch before sending
 * - Auto-flush after configurable timeout for latency optimization
 * - Broker executes batch calls in parallel using Promise.all
 * - Groups calls by target for efficiency
 * - Returns partial results on failures (isolated error handling)
 *
 * @see do-tpv6 - Batch Message Execution task
 */

import {
  CallMessage,
  ReturnMessage,
  ErrorMessage,
  BatchMessage,
  BatchReturnMessage,
  generateBrokerMessageId,
} from './broker-protocol'

// =============================================================================
// Types
// =============================================================================

/**
 * Interface for RPC-capable target that can execute method calls
 */
export interface RpcTarget {
  /**
   * Execute an RPC method call
   * @param method - Method name to invoke
   * @param args - Arguments to pass to the method
   * @param capability - Optional capability token for authorization
   */
  rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown>
}

/**
 * Options for RpcBatcher configuration
 */
export interface RpcBatcherOptions {
  /**
   * Auto-flush timeout in milliseconds.
   * After this delay, pending calls are automatically sent.
   * Default: 10ms
   */
  autoFlushMs?: number
}

// =============================================================================
// RpcBatcher - Client-side batching
// =============================================================================

/**
 * Client-side batcher that collects RPC calls and flushes them as a batch.
 *
 * Usage:
 * ```typescript
 * const batcher = new RpcBatcher(sendBatch)
 *
 * // Add calls - they're collected but not sent yet
 * const p1 = batcher.add('target', 'getUser', ['user_123'])
 * const p2 = batcher.add('target', 'getOrders', ['user_123'])
 *
 * // Manual flush sends all pending calls
 * await batcher.flush()
 *
 * // Or calls auto-flush after timeout
 * const result = await p1
 * ```
 */
export class RpcBatcher {
  private pending: Array<{
    call: CallMessage
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }> = []
  private flushTimeoutId: ReturnType<typeof setTimeout> | null = null
  private autoFlushMs: number

  /**
   * Create a new RpcBatcher
   * @param send - Function to send batch messages and receive responses
   * @param options - Configuration options
   */
  constructor(
    private send: (batch: BatchMessage) => Promise<BatchReturnMessage>,
    options?: RpcBatcherOptions
  ) {
    this.autoFlushMs = options?.autoFlushMs ?? 10
  }

  /**
   * Add a call to the batch
   *
   * @param target - Target worker/shard ID
   * @param method - Method name to invoke
   * @param args - Arguments to pass to the method
   * @param capability - Optional capability token for authorization
   * @returns Promise that resolves with the method result
   */
  add(target: string, method: string, args: unknown[], capability?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const call: CallMessage = {
        id: generateBrokerMessageId(),
        type: 'call',
        target,
        method,
        args,
        capability,
      }
      this.pending.push({ call, resolve, reject })
      this.scheduleAutoFlush()
    })
  }

  /**
   * Manually flush all pending calls
   *
   * Sends all accumulated calls as a batch and resolves/rejects
   * individual call promises based on the response.
   */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return
    this.cancelAutoFlush()

    const batch: BatchMessage = {
      id: generateBrokerMessageId(),
      type: 'batch',
      calls: this.pending.map((p) => p.call),
    }
    const pendingCopy = [...this.pending]
    this.pending = []

    try {
      const response = await this.send(batch)

      // Match results to pending promises by index (results are in order)
      for (let i = 0; i < pendingCopy.length; i++) {
        const result = response.results[i]
        if (result.type === 'error') {
          pendingCopy[i].reject(new Error((result as ErrorMessage).error))
        } else {
          pendingCopy[i].resolve((result as ReturnMessage).value)
        }
      }
    } catch (err) {
      // Reject all pending on network error
      for (const p of pendingCopy) {
        p.reject(err as Error)
      }
    }
  }

  /**
   * Schedule auto-flush after configured timeout
   */
  private scheduleAutoFlush(): void {
    if (this.flushTimeoutId) return
    this.flushTimeoutId = setTimeout(() => {
      this.flushTimeoutId = null
      this.flush()
    }, this.autoFlushMs)
  }

  /**
   * Cancel pending auto-flush timer
   */
  private cancelAutoFlush(): void {
    if (this.flushTimeoutId) {
      clearTimeout(this.flushTimeoutId)
      this.flushTimeoutId = null
    }
  }
}

// =============================================================================
// executeBatch - Broker-side parallel execution
// =============================================================================

/**
 * Execute a batch of RPC calls in parallel
 *
 * Groups calls by target for efficiency, executes each group's calls
 * in parallel, and returns results in the same order as the input calls.
 *
 * Key behaviors:
 * - Calls are executed in parallel using Promise.all
 * - Calls to the same target are grouped together
 * - Failures in one call don't affect others (isolated error handling)
 * - Results maintain the same order as input calls
 *
 * @param calls - Array of call messages to execute
 * @param resolveTarget - Function to resolve target ID to RpcTarget instance
 * @returns Array of results (ReturnMessage or ErrorMessage) in order
 */
export async function executeBatch(
  calls: CallMessage[],
  resolveTarget: (target: string) => RpcTarget | null
): Promise<(ReturnMessage | ErrorMessage)[]> {
  if (calls.length === 0) {
    return []
  }

  // Group by target for efficiency
  const byTarget = new Map<string, { index: number; call: CallMessage }[]>()
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i]
    const group = byTarget.get(call.target) ?? []
    group.push({ index: i, call })
    byTarget.set(call.target, group)
  }

  // Pre-allocate results array
  const results: (ReturnMessage | ErrorMessage)[] = new Array(calls.length)

  // Execute each target group in parallel
  await Promise.all(
    Array.from(byTarget.entries()).map(async ([target, group]) => {
      const targetStub = resolveTarget(target)

      // Execute all calls for this target in parallel
      await Promise.all(
        group.map(async ({ index, call }) => {
          try {
            if (!targetStub) {
              results[index] = {
                id: call.id,
                type: 'error',
                error: `Target not found: ${target}`,
                code: 'TARGET_NOT_FOUND',
              }
              return
            }

            const value = await targetStub.rpcCall(call.method, call.args, call.capability)
            results[index] = { id: call.id, type: 'return', value }
          } catch (err) {
            results[index] = {
              id: call.id,
              type: 'error',
              error: err instanceof Error ? err.message : String(err),
            }
          }
        })
      )
    })
  )

  return results
}
