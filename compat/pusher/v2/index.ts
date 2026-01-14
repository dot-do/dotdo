/**
 * Pusher v2 - Adapter-based implementation using Channel primitive
 *
 * Demonstrates how pub/sub compat layers become trivial with the Channel abstraction.
 * The Channel primitive provides 90% of Pusher functionality out of the box:
 * - subscribe/publish for events
 * - presence tracking with join/leave
 * - backpressure and persistence
 *
 * This implementation is ~230 LOC vs ~570 LOC in the original (60% reduction).
 *
 * @example
 * ```typescript
 * import Pusher from '@dotdo/pusher/v2'
 *
 * const pusher = new Pusher('app-key', { cluster: 'mt1' })
 * const channel = pusher.subscribe('my-channel')
 * channel.bind('my-event', (data) => console.log(data))
 * channel.trigger('client-event', { msg: 'hi' })
 * ```
 */

import { createChannel, type Channel as PrimitiveChannel, type Subscription, type Member } from '../../../primitives/channel'

// =============================================================================
// TYPES
// =============================================================================

export interface PusherOptions {
  cluster?: string
  forceTLS?: boolean
}

export interface PresenceMember {
  id: string
  info?: Record<string, unknown>
}

export interface Members {
  me: PresenceMember | null
  count: number
  each(callback: (member: PresenceMember) => void): void
  get(userId: string): PresenceMember | null
}

export interface Channel {
  name: string
  subscribed: boolean
  bind(event: string, callback: (data?: unknown) => void): Channel
  unbind(event?: string, callback?: (data?: unknown) => void): Channel
  trigger(event: string, data: unknown): boolean
}

export interface PresenceChannel extends Channel {
  members: Members
}

// =============================================================================
// CHANNEL ADAPTER - Maps Pusher API to Channel primitive
// =============================================================================

class PusherChannel implements Channel {
  readonly name: string
  subscribed = false

  protected _channel: PrimitiveChannel
  protected _subscriptions = new Map<string, Map<(data?: unknown) => void, Subscription>>()
  protected _pusher: Pusher

  constructor(name: string, pusher: Pusher) {
    this.name = name
    this._pusher = pusher

    // Determine channel type from name prefix
    const type = name.startsWith('presence-') ? 'presence'
               : name.startsWith('private-') ? 'private'
               : 'public'

    this._channel = createChannel(name, { type })
  }

  /**
   * bind() -> Channel.subscribe()
   * The Channel primitive's subscribe returns a Subscription with unsubscribe()
   */
  bind(event: string, callback: (data?: unknown) => void): this {
    const subscription = this._channel.subscribe(event, (data) => callback(data))

    // Track subscription for unbind
    if (!this._subscriptions.has(event)) {
      this._subscriptions.set(event, new Map())
    }
    this._subscriptions.get(event)!.set(callback, subscription)

    return this
  }

  /**
   * unbind() -> Subscription.unsubscribe()
   */
  unbind(event?: string, callback?: (data?: unknown) => void): this {
    if (!event) {
      // Unbind all
      for (const [, callbacks] of this._subscriptions) {
        for (const [, sub] of callbacks) {
          sub.unsubscribe()
        }
      }
      this._subscriptions.clear()
    } else if (!callback) {
      // Unbind all for event
      const callbacks = this._subscriptions.get(event)
      if (callbacks) {
        for (const [, sub] of callbacks) {
          sub.unsubscribe()
        }
        this._subscriptions.delete(event)
      }
    } else {
      // Unbind specific callback
      const callbacks = this._subscriptions.get(event)
      const sub = callbacks?.get(callback)
      if (sub) {
        sub.unsubscribe()
        callbacks!.delete(callback)
      }
    }
    return this
  }

  /**
   * trigger() -> Channel.publish()
   * Client events must start with 'client-' on private/presence channels
   */
  trigger(event: string, data: unknown): boolean {
    if (!this.name.startsWith('private-') && !this.name.startsWith('presence-')) {
      return false // Public channels cannot trigger
    }
    if (!event.startsWith('client-')) {
      return false // Must be client event
    }
    if (!this.subscribed) {
      return false
    }

    this._channel.publish(event, data)
    return true
  }

  /** Internal: activate subscription */
  _subscribe(): void {
    this.subscribed = true
    // Emit subscription success asynchronously
    queueMicrotask(() => {
      this._channel.publish('pusher:subscription_succeeded', undefined)
    })
  }

  /** Internal: deactivate subscription */
  _unsubscribe(): void {
    this.subscribed = false
    this.unbind()
  }

  /** Get underlying channel for cross-instance pub/sub */
  get primitiveChannel(): PrimitiveChannel {
    return this._channel
  }
}

// =============================================================================
// PRESENCE CHANNEL - Leverages Channel.presence
// =============================================================================

class PusherPresenceChannel extends PusherChannel implements PresenceChannel {
  members: MembersImpl

  constructor(name: string, pusher: Pusher) {
    super(name, pusher)
    this.members = new MembersImpl()
  }

  _subscribe(): void {
    this.subscribed = true

    // Generate member for this connection
    const me: PresenceMember = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      info: {},
    }
    this.members._setMe(me)

    // Use Channel.presence for member tracking
    const presence = this._channel.presence
    if (presence) {
      // Join presence
      presence.join({ id: me.id, info: me.info })

      // Wire up presence events to Pusher events
      presence.onJoin((member: Member) => {
        const m: PresenceMember = { id: member.id, info: member.info }
        this.members._add(m)
        this._channel.publish('pusher:member_added', m)
      })

      presence.onLeave((member: Member) => {
        this.members._remove(member.id)
        this._channel.publish('pusher:member_removed', { id: member.id, info: member.info })
      })
    }

    // Emit subscription success with members
    queueMicrotask(() => {
      this._channel.publish('pusher:subscription_succeeded', this.members)
    })
  }

  _unsubscribe(): void {
    this._channel.presence?.leave()
    this.members._clear()
    super._unsubscribe()
  }
}

// =============================================================================
// MEMBERS COLLECTION
// =============================================================================

class MembersImpl implements Members {
  me: PresenceMember | null = null
  private _members = new Map<string, PresenceMember>()

  get count(): number {
    return this._members.size
  }

  each(callback: (member: PresenceMember) => void): void {
    for (const member of this._members.values()) {
      callback(member)
    }
  }

  get(userId: string): PresenceMember | null {
    return this._members.get(userId) ?? null
  }

  _add(member: PresenceMember): void {
    this._members.set(member.id, member)
  }

  _remove(userId: string): void {
    this._members.delete(userId)
  }

  _setMe(member: PresenceMember): void {
    this.me = member
    this._add(member)
  }

  _clear(): void {
    this._members.clear()
    this.me = null
  }
}

// =============================================================================
// PUSHER CLIENT - Thin orchestration layer
// =============================================================================

export class Pusher {
  readonly key: string
  readonly config: PusherOptions

  private _channels = new Map<string, PusherChannel>()
  private _connected = false

  constructor(key: string, options: PusherOptions = {}) {
    this.key = key
    this.config = { cluster: 'mt1', forceTLS: true, ...options }
    // Auto-connect
    queueMicrotask(() => this.connect())
  }

  /**
   * subscribe() - Create channel adapter for the channel name
   */
  subscribe(channelName: string): Channel {
    let channel = this._channels.get(channelName)
    if (channel) {
      if (!channel.subscribed && this._connected) {
        channel._subscribe()
      }
      return channel
    }

    // Create appropriate channel type
    channel = channelName.startsWith('presence-')
      ? new PusherPresenceChannel(channelName, this)
      : new PusherChannel(channelName, this)

    this._channels.set(channelName, channel)

    if (this._connected) {
      channel._subscribe()
    }

    return channel
  }

  unsubscribe(channelName: string): void {
    const channel = this._channels.get(channelName)
    if (channel) {
      channel._unsubscribe()
      this._channels.delete(channelName)
    }
  }

  channel(name: string): Channel | null {
    return this._channels.get(name) ?? null
  }

  allChannels(): Channel[] {
    return Array.from(this._channels.values())
  }

  connect(): void {
    if (this._connected) return
    this._connected = true

    // Subscribe all pending channels
    for (const channel of this._channels.values()) {
      if (!channel.subscribed) {
        channel._subscribe()
      }
    }
  }

  disconnect(): void {
    for (const channel of this._channels.values()) {
      channel._unsubscribe()
    }
    this._channels.clear()
    this._connected = false
  }
}

export default Pusher
