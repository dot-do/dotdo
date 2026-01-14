/**
 * Workflow Primitives - Signal Handling
 */

import type { SignalOptions } from './types'
import { parseDuration } from './timer'
import { SignalTimeoutError } from './types'

/**
 * Signal queue for a workflow
 */
export class SignalQueue {
  private signals = new Map<string, unknown[]>()
  private waiters = new Map<string, Array<(value: unknown) => void>>()

  /**
   * Queue a signal
   */
  send(name: string, payload: unknown): void {
    // Check if there's a waiter for this signal
    const waiters = this.waiters.get(name)
    if (waiters && waiters.length > 0) {
      const waiter = waiters.shift()!
      waiter(payload)
      if (waiters.length === 0) {
        this.waiters.delete(name)
      }
      return
    }

    // Otherwise queue the signal
    const queue = this.signals.get(name) || []
    queue.push(payload)
    this.signals.set(name, queue)
  }

  /**
   * Wait for a signal
   */
  async wait<T>(name: string, options?: SignalOptions<T>): Promise<T> {
    // Check if there's already a queued signal
    const queue = this.signals.get(name)
    if (queue && queue.length > 0) {
      return queue.shift() as T
    }

    // Set up a waiter
    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      const waiter = (value: unknown) => {
        if (timeoutId) clearTimeout(timeoutId)
        resolve(value as T)
      }

      const waiters = this.waiters.get(name) || []
      waiters.push(waiter)
      this.waiters.set(name, waiters)

      // Handle timeout
      if (options?.timeout) {
        const ms = parseDuration(options.timeout)
        timeoutId = setTimeout(() => {
          // Remove this waiter
          const currentWaiters = this.waiters.get(name) || []
          const index = currentWaiters.indexOf(waiter)
          if (index !== -1) {
            currentWaiters.splice(index, 1)
          }

          if (options.default !== undefined) {
            resolve(options.default)
          } else {
            reject(new SignalTimeoutError(name))
          }
        }, ms)
      }
    })
  }

  /**
   * Clear all signals (for cleanup)
   */
  clear(): void {
    this.signals.clear()
    this.waiters.clear()
  }
}
