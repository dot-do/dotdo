/**
 * Subscription feature for @dotdo/client
 *
 * Adds real-time event subscription support.
 */

import type { RPCMessage, RPCResponse, SubscriptionHandle, Subscription } from '../types'
import { generateId } from '../utils'

export interface SubscriptionManager {
  /** Subscribe to a channel */
  subscribe<T>(channel: string, callback: (data: T) => void): SubscriptionHandle
  /** Handle incoming event */
  handleEvent(response: RPCResponse): boolean
  /** Resubscribe all channels (after reconnection) */
  resubscribeAll(): RPCMessage[]
  /** Clear all subscriptions */
  clear(): void
}

/**
 * Create a subscription manager
 */
export function createSubscriptionManager(
  sendRaw: (message: RPCMessage) => void
): SubscriptionManager {
  const subscriptions = new Map<string, Subscription>()

  function subscribe<T>(channel: string, callback: (data: T) => void): SubscriptionHandle {
    let subscription = subscriptions.get(channel)

    if (!subscription) {
      subscription = { channel, callbacks: new Set() }
      subscriptions.set(channel, subscription)

      // Send subscribe message
      sendRaw({ type: 'subscribe', channel, id: generateId() })
    }

    subscription.callbacks.add(callback as (data: unknown) => void)

    return {
      unsubscribe: () => {
        const sub = subscriptions.get(channel)
        if (sub) {
          sub.callbacks.delete(callback as (data: unknown) => void)

          // If no more listeners, unsubscribe
          if (sub.callbacks.size === 0) {
            subscriptions.delete(channel)
            sendRaw({ type: 'unsubscribe', channel, id: generateId() })
          }
        }
      },
    }
  }

  function handleEvent(response: RPCResponse): boolean {
    if (response.type === 'event' && response.channel) {
      const subscription = subscriptions.get(response.channel)
      if (subscription) {
        for (const callback of subscription.callbacks) {
          callback(response.data)
        }
      }
      return true
    }
    return false
  }

  function resubscribeAll(): RPCMessage[] {
    const messages: RPCMessage[] = []
    for (const [channel, subscription] of subscriptions) {
      if (subscription.callbacks.size > 0) {
        messages.push({ type: 'subscribe', channel, id: generateId() })
      }
    }
    return messages
  }

  function clear(): void {
    subscriptions.clear()
  }

  return {
    subscribe,
    handleEvent,
    resubscribeAll,
    clear,
  }
}
