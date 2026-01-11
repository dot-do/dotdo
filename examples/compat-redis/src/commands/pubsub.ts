/**
 * Redis Pub/Sub Commands
 * PUBLISH, SUBSCRIBE, PSUBSCRIBE, UNSUBSCRIBE, PUNSUBSCRIBE, PUBSUB
 *
 * Uses WebSocket hibernation API for efficient subscription management
 */

import type { RedisStorage } from '../storage'
import { encodeRESP } from '../protocol'

export interface Subscriber {
  ws: WebSocket
  channels: Set<string>
  patterns: Set<string>
}

export class PubSubCommands {
  private subscribers: Map<string, Set<WebSocket>> = new Map()
  private patternSubscribers: Map<string, Set<WebSocket>> = new Map()
  private wsToSubscriber: Map<WebSocket, Subscriber> = new Map()

  constructor(private storage: RedisStorage) {}

  /**
   * Register a WebSocket connection for pub/sub
   */
  registerWebSocket(ws: WebSocket): void {
    this.wsToSubscriber.set(ws, {
      ws,
      channels: new Set(),
      patterns: new Set(),
    })
  }

  /**
   * Unregister a WebSocket connection
   */
  unregisterWebSocket(ws: WebSocket): void {
    const subscriber = this.wsToSubscriber.get(ws)
    if (!subscriber) return

    // Remove from all channel subscriptions
    for (const channel of subscriber.channels) {
      const subs = this.subscribers.get(channel)
      if (subs) {
        subs.delete(ws)
        if (subs.size === 0) {
          this.subscribers.delete(channel)
        }
      }
    }

    // Remove from all pattern subscriptions
    for (const pattern of subscriber.patterns) {
      const subs = this.patternSubscribers.get(pattern)
      if (subs) {
        subs.delete(ws)
        if (subs.size === 0) {
          this.patternSubscribers.delete(pattern)
        }
      }
    }

    this.wsToSubscriber.delete(ws)
  }

  /**
   * SUBSCRIBE channel [channel ...]
   * Subscribe to the given channels
   */
  subscribe(ws: WebSocket, channels: string[]): void {
    const subscriber = this.wsToSubscriber.get(ws)
    if (!subscriber) return

    for (const channel of channels) {
      // Add to channel subscriptions
      if (!this.subscribers.has(channel)) {
        this.subscribers.set(channel, new Set())
      }
      this.subscribers.get(channel)!.add(ws)
      subscriber.channels.add(channel)

      // Send subscription confirmation
      const count = subscriber.channels.size + subscriber.patterns.size
      const message = encodeRESP(['subscribe', channel, count])
      ws.send(message)
    }
  }

  /**
   * PSUBSCRIBE pattern [pattern ...]
   * Subscribe to channels matching the given patterns
   */
  psubscribe(ws: WebSocket, patterns: string[]): void {
    const subscriber = this.wsToSubscriber.get(ws)
    if (!subscriber) return

    for (const pattern of patterns) {
      // Add to pattern subscriptions
      if (!this.patternSubscribers.has(pattern)) {
        this.patternSubscribers.set(pattern, new Set())
      }
      this.patternSubscribers.get(pattern)!.add(ws)
      subscriber.patterns.add(pattern)

      // Send subscription confirmation
      const count = subscriber.channels.size + subscriber.patterns.size
      const message = encodeRESP(['psubscribe', pattern, count])
      ws.send(message)
    }
  }

  /**
   * UNSUBSCRIBE [channel [channel ...]]
   * Unsubscribe from the given channels
   */
  unsubscribe(ws: WebSocket, channels?: string[]): void {
    const subscriber = this.wsToSubscriber.get(ws)
    if (!subscriber) return

    const toUnsubscribe = channels ?? Array.from(subscriber.channels)

    for (const channel of toUnsubscribe) {
      // Remove from channel subscriptions
      const subs = this.subscribers.get(channel)
      if (subs) {
        subs.delete(ws)
        if (subs.size === 0) {
          this.subscribers.delete(channel)
        }
      }
      subscriber.channels.delete(channel)

      // Send unsubscribe confirmation
      const count = subscriber.channels.size + subscriber.patterns.size
      const message = encodeRESP(['unsubscribe', channel, count])
      ws.send(message)
    }
  }

  /**
   * PUNSUBSCRIBE [pattern [pattern ...]]
   * Unsubscribe from channels matching the given patterns
   */
  punsubscribe(ws: WebSocket, patterns?: string[]): void {
    const subscriber = this.wsToSubscriber.get(ws)
    if (!subscriber) return

    const toUnsubscribe = patterns ?? Array.from(subscriber.patterns)

    for (const pattern of toUnsubscribe) {
      // Remove from pattern subscriptions
      const subs = this.patternSubscribers.get(pattern)
      if (subs) {
        subs.delete(ws)
        if (subs.size === 0) {
          this.patternSubscribers.delete(pattern)
        }
      }
      subscriber.patterns.delete(pattern)

      // Send unsubscribe confirmation
      const count = subscriber.channels.size + subscriber.patterns.size
      const message = encodeRESP(['punsubscribe', pattern, count])
      ws.send(message)
    }
  }

  /**
   * PUBLISH channel message
   * Post a message to a channel
   * Returns the number of clients that received the message
   */
  publish(channel: string, message: string): number {
    let receivers = 0

    // Send to exact channel subscribers
    const channelSubs = this.subscribers.get(channel)
    if (channelSubs) {
      const payload = encodeRESP(['message', channel, message])
      for (const ws of channelSubs) {
        try {
          ws.send(payload)
          receivers++
        } catch {
          // WebSocket closed, will be cleaned up
        }
      }
    }

    // Send to pattern subscribers
    for (const [pattern, subs] of this.patternSubscribers) {
      if (matchPattern(pattern, channel)) {
        const payload = encodeRESP(['pmessage', pattern, channel, message])
        for (const ws of subs) {
          try {
            ws.send(payload)
            receivers++
          } catch {
            // WebSocket closed
          }
        }
      }
    }

    return receivers
  }

  /**
   * PUBSUB CHANNELS [pattern]
   * List active channels (with at least one subscriber)
   */
  pubsubChannels(pattern?: string): string[] {
    const channels = Array.from(this.subscribers.keys())
    if (!pattern || pattern === '*') {
      return channels
    }
    return channels.filter((ch) => matchPattern(pattern, ch))
  }

  /**
   * PUBSUB NUMSUB [channel [channel ...]]
   * Returns the number of subscribers for the specified channels
   */
  pubsubNumsub(channels: string[]): Array<[string, number]> {
    return channels.map((channel) => {
      const subs = this.subscribers.get(channel)
      return [channel, subs ? subs.size : 0]
    })
  }

  /**
   * PUBSUB NUMPAT
   * Returns the number of unique patterns that are subscribed to
   */
  pubsubNumpat(): number {
    return this.patternSubscribers.size
  }

  /**
   * PUBSUB SHARDCHANNELS [pattern]
   * Same as CHANNELS in single-shard context
   */
  pubsubShardchannels(pattern?: string): string[] {
    return this.pubsubChannels(pattern)
  }

  /**
   * PUBSUB SHARDNUMSUB [channel [channel ...]]
   * Same as NUMSUB in single-shard context
   */
  pubsubShardnumsub(channels: string[]): Array<[string, number]> {
    return this.pubsubNumsub(channels)
  }

  /**
   * Get subscription counts for a WebSocket
   */
  getSubscriptionCount(ws: WebSocket): number {
    const subscriber = this.wsToSubscriber.get(ws)
    if (!subscriber) return 0
    return subscriber.channels.size + subscriber.patterns.size
  }

  /**
   * Check if a WebSocket is in pub/sub mode
   */
  isInPubSubMode(ws: WebSocket): boolean {
    return this.getSubscriptionCount(ws) > 0
  }
}

/**
 * Match a Redis glob pattern against a channel name
 */
function matchPattern(pattern: string, channel: string): boolean {
  // Convert Redis glob to regex
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$'
  )
  return regex.test(channel)
}
