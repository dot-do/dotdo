/**
 * @dotdo/pusher - Pusher SDK compat
 *
 * Drop-in replacement for pusher-js backed by in-memory pub/sub.
 * This implementation matches the pusher-js API.
 *
 * @see https://pusher.com/docs/channels/using_channels/client-api-overview/
 */
import type {
  Pusher as IPusher,
  PusherOptions,
  ExtendedPusherOptions,
  Connection as IConnection,
  Channel as IChannel,
  PrivateChannel as IPrivateChannel,
  PresenceChannel as IPresenceChannel,
  Members as IMembers,
  UserData as IUserData,
  ConnectionState,
  ChannelState,
  StateChange,
  PresenceMember,
  EventHandler,
  GlobalEventHandler,
} from './types'

// ============================================================================
// IN-MEMORY PUB/SUB STORAGE
// ============================================================================

/**
 * Channel subscription data
 */
interface ChannelSubscription {
  name: string
  subscribers: Set<string> // socket IDs
  presenceMembers: Map<string, PresenceMember> // For presence channels
  messages: Array<{ event: string; data: unknown; timestamp: number }>
}

/**
 * Global in-memory storage for pub/sub
 */
const globalChannels = new Map<string, ChannelSubscription>()
const globalConnections = new Map<string, PusherImpl>() // socket_id -> Pusher instance

/**
 * Get or create a channel subscription
 */
function getOrCreateChannel(name: string): ChannelSubscription {
  let channel = globalChannels.get(name)
  if (!channel) {
    channel = {
      name,
      subscribers: new Set(),
      presenceMembers: new Map(),
      messages: [],
    }
    globalChannels.set(name, channel)
  }
  return channel
}

/**
 * Publish event to all subscribers of a channel
 */
function publishToChannel(channelName: string, event: string, data: unknown, excludeSocketId?: string): void {
  const channel = globalChannels.get(channelName)
  if (!channel) return

  for (const socketId of channel.subscribers) {
    if (socketId === excludeSocketId) continue

    const connection = globalConnections.get(socketId)
    if (connection) {
      connection._deliverEvent(channelName, event, data)
    }
  }
}

/**
 * Generate a unique socket ID
 */
function generateSocketId(): string {
  const random1 = Math.floor(Math.random() * 1000000000)
  const random2 = Math.floor(Math.random() * 1000000000)
  return `${random1}.${random2}`
}

// ============================================================================
// PUSHER-STYLE EVENT EMITTER
// ============================================================================

/**
 * Pusher-style EventEmitter with bind/unbind API
 */
class PusherEventEmitter {
  protected _listeners: Map<string, Set<EventHandler>> = new Map()
  protected _globalListeners: Set<GlobalEventHandler> = new Set()

  bind(event: string, callback: EventHandler): this {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event)!.add(callback)
    return this
  }

  unbind(event?: string, callback?: EventHandler): this {
    if (event === undefined) {
      // Unbind all
      this._listeners.clear()
    } else if (callback === undefined) {
      // Unbind all for event
      this._listeners.delete(event)
    } else {
      // Unbind specific callback
      const listeners = this._listeners.get(event)
      if (listeners) {
        listeners.delete(callback)
      }
    }
    return this
  }

  bind_global(callback: GlobalEventHandler): this {
    this._globalListeners.add(callback)
    return this
  }

  unbind_global(callback?: GlobalEventHandler): this {
    if (callback === undefined) {
      this._globalListeners.clear()
    } else {
      this._globalListeners.delete(callback)
    }
    return this
  }

  protected _emit(event: string, data?: unknown): void {
    // Call specific event listeners
    const listeners = this._listeners.get(event)
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data)
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error)
        }
      }
    }

    // Call global listeners
    for (const callback of this._globalListeners) {
      try {
        callback(event, data)
      } catch (error) {
        console.error(`Error in global event handler:`, error)
      }
    }
  }
}

// ============================================================================
// CONNECTION IMPLEMENTATION
// ============================================================================

class ConnectionImpl extends PusherEventEmitter implements IConnection {
  state: ConnectionState = 'initialized'
  socket_id: string | null = null

  private _pusher: PusherImpl

  constructor(pusher: PusherImpl) {
    super()
    this._pusher = pusher
  }

  _setState(newState: ConnectionState): void {
    const previous = this.state
    this.state = newState

    const stateChange: StateChange = { previous, current: newState }
    this._emit('state_change', stateChange)
    this._emit(newState)
  }

  _setSocketId(socketId: string): void {
    this.socket_id = socketId
  }

  bind(event: string, callback: EventHandler): this {
    super.bind(event, callback)
    return this
  }

  unbind(event?: string, callback?: EventHandler): this {
    super.unbind(event, callback)
    return this
  }

  bind_global(callback: GlobalEventHandler): this {
    super.bind_global(callback)
    return this
  }

  unbind_global(callback?: GlobalEventHandler): this {
    super.unbind_global(callback)
    return this
  }
}

// ============================================================================
// MEMBERS IMPLEMENTATION
// ============================================================================

class MembersImpl implements IMembers {
  me: PresenceMember | null = null
  private _members: Map<string, PresenceMember> = new Map()

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

  toArray(): PresenceMember[] {
    return Array.from(this._members.values())
  }

  _add(member: PresenceMember): void {
    this._members.set(member.id, member)
  }

  _remove(userId: string): PresenceMember | null {
    const member = this._members.get(userId)
    if (member) {
      this._members.delete(userId)
      return member
    }
    return null
  }

  _setMe(member: PresenceMember): void {
    this.me = member
    this._add(member)
  }

  _clear(): void {
    this._members.clear()
    this.me = null
  }

  _setFromArray(members: PresenceMember[]): void {
    this._members.clear()
    for (const member of members) {
      this._members.set(member.id, member)
    }
  }
}

// ============================================================================
// CHANNEL IMPLEMENTATION
// ============================================================================

class ChannelImpl extends PusherEventEmitter implements IChannel {
  name: string
  subscribed: boolean = false

  protected _pusher: PusherImpl
  protected _state: ChannelState = 'initialized'

  constructor(name: string, pusher: PusherImpl) {
    super()
    this.name = name
    this._pusher = pusher
  }

  bind(event: string, callback: EventHandler): this {
    super.bind(event, callback)
    return this
  }

  unbind(event?: string, callback?: EventHandler): this {
    super.unbind(event, callback)
    return this
  }

  bind_global(callback: GlobalEventHandler): this {
    super.bind_global(callback)
    return this
  }

  unbind_global(callback?: GlobalEventHandler): this {
    super.unbind_global(callback)
    return this
  }

  trigger(event: string, data: unknown): boolean {
    // Public channels cannot trigger client events
    if (!this.name.startsWith('private-') && !this.name.startsWith('presence-')) {
      console.warn('Cannot trigger client events on public channels')
      return false
    }

    // Client events must start with 'client-'
    if (!event.startsWith('client-')) {
      console.warn('Client events must start with "client-"')
      return false
    }

    if (!this.subscribed) {
      console.warn('Cannot trigger events on unsubscribed channel')
      return false
    }

    // Publish to all other subscribers
    publishToChannel(this.name, event, data, this._pusher.connection.socket_id ?? undefined)
    return true
  }

  unsubscribe(): void {
    this._pusher.unsubscribe(this.name)
  }

  _subscribe(): void {
    this._state = 'subscribing'

    const channelSub = getOrCreateChannel(this.name)
    const socketId = this._pusher.connection.socket_id

    if (socketId) {
      channelSub.subscribers.add(socketId)
    }

    // Simulate subscription success
    this._state = 'subscribed'
    this.subscribed = true
    // Defer event emission to allow handlers to be bound after subscribe() returns
    queueMicrotask(() => {
      this._emit('pusher:subscription_succeeded')
    })
  }

  _unsubscribe(): void {
    const channelSub = globalChannels.get(this.name)
    const socketId = this._pusher.connection.socket_id

    if (channelSub && socketId) {
      channelSub.subscribers.delete(socketId)
    }

    this._state = 'unsubscribed'
    this.subscribed = false
  }

  _deliverEvent(event: string, data: unknown): void {
    this._emit(event, data)
  }
}

// ============================================================================
// PRIVATE CHANNEL IMPLEMENTATION
// ============================================================================

class PrivateChannelImpl extends ChannelImpl implements IPrivateChannel {
  constructor(name: string, pusher: PusherImpl) {
    super(name, pusher)
  }

  _subscribe(): void {
    this._state = 'subscribing'

    // In a real implementation, this would call the auth endpoint
    // For now, we auto-authorize
    this._authorize()
  }

  private async _authorize(): Promise<void> {
    try {
      // Simulate auth success
      const channelSub = getOrCreateChannel(this.name)
      const socketId = this._pusher.connection.socket_id

      if (socketId) {
        channelSub.subscribers.add(socketId)
      }

      this._state = 'subscribed'
      this.subscribed = true
      // Defer event emission to allow handlers to be bound after subscribe() returns
      queueMicrotask(() => {
        this._emit('pusher:subscription_succeeded')
      })
    } catch (error) {
      this._state = 'subscription_error'
      // Defer error event emission as well
      queueMicrotask(() => {
        this._emit('pusher:subscription_error', {
          type: 'AuthError',
          error: error instanceof Error ? error.message : 'Authorization failed',
          status: 403,
        })
      })
    }
  }
}

// ============================================================================
// PRESENCE CHANNEL IMPLEMENTATION
// ============================================================================

class PresenceChannelImpl extends PrivateChannelImpl implements IPresenceChannel {
  members: MembersImpl

  constructor(name: string, pusher: PusherImpl) {
    super(name, pusher)
    this.members = new MembersImpl()
  }

  _subscribe(): void {
    this._state = 'subscribing'
    this._authorize()
  }

  private async _authorize(): Promise<void> {
    try {
      const channelSub = getOrCreateChannel(this.name)
      const socketId = this._pusher.connection.socket_id

      if (socketId) {
        channelSub.subscribers.add(socketId)
      }

      // Generate a user ID for this connection
      const userId = `user-${socketId}`
      const me: PresenceMember = {
        id: userId,
        info: {},
      }

      // Add to presence members
      channelSub.presenceMembers.set(userId, me)
      this.members._setMe(me)

      // Add existing members
      for (const member of channelSub.presenceMembers.values()) {
        if (member.id !== me.id) {
          this.members._add(member)
        }
      }

      this._state = 'subscribed'
      this.subscribed = true

      // Notify other subscribers that a member joined
      publishToChannel(this.name, 'pusher:member_added', me, socketId ?? undefined)

      // Defer event emission to allow handlers to be bound after subscribe() returns
      queueMicrotask(() => {
        // Emit subscription succeeded with members
        this._emit('pusher:subscription_succeeded', this.members)
      })
    } catch (error) {
      this._state = 'subscription_error'
      // Defer error event emission as well
      queueMicrotask(() => {
        this._emit('pusher:subscription_error', {
          type: 'AuthError',
          error: error instanceof Error ? error.message : 'Authorization failed',
          status: 403,
        })
      })
    }
  }

  _unsubscribe(): void {
    const channelSub = globalChannels.get(this.name)
    const socketId = this._pusher.connection.socket_id

    if (channelSub && socketId) {
      channelSub.subscribers.delete(socketId)

      // Remove from presence members
      const userId = `user-${socketId}`
      const member = channelSub.presenceMembers.get(userId)
      if (member) {
        channelSub.presenceMembers.delete(userId)
        // Notify other subscribers
        publishToChannel(this.name, 'pusher:member_removed', member, socketId)
      }
    }

    this.members._clear()
    this._state = 'unsubscribed'
    this.subscribed = false
  }

  _deliverEvent(event: string, data: unknown): void {
    // Handle presence-specific events
    if (event === 'pusher:member_added') {
      const member = data as PresenceMember
      this.members._add(member)
    } else if (event === 'pusher:member_removed') {
      const member = data as PresenceMember
      this.members._remove(member.id)
    }

    this._emit(event, data)
  }
}

// ============================================================================
// USER DATA IMPLEMENTATION
// ============================================================================

class UserDataImpl extends PusherEventEmitter implements IUserData {
  id?: string
  info?: Record<string, unknown>
  watchlist: {
    bind: (event: string, callback: EventHandler) => void
    unbind: (event?: string, callback?: EventHandler) => void
  }

  private _watchlistEmitter = new PusherEventEmitter()

  constructor() {
    super()
    this.watchlist = {
      bind: (event: string, callback: EventHandler) => {
        this._watchlistEmitter.bind(event, callback)
      },
      unbind: (event?: string, callback?: EventHandler) => {
        this._watchlistEmitter.unbind(event, callback)
      },
    }
  }

  bind(event: string, callback: EventHandler): void {
    super.bind(event, callback)
  }

  unbind(event?: string, callback?: EventHandler): void {
    super.unbind(event, callback)
  }
}

// ============================================================================
// PUSHER CLIENT IMPLEMENTATION
// ============================================================================

class PusherImpl extends PusherEventEmitter implements IPusher {
  connection: ConnectionImpl
  key: string
  config: ExtendedPusherOptions
  user: UserDataImpl

  private _channels: Map<string, ChannelImpl> = new Map()

  constructor(key: string, options: ExtendedPusherOptions = {}) {
    super()
    this.key = key
    this.config = {
      forceTLS: true,
      cluster: 'mt1',
      ...options,
    }
    this.connection = new ConnectionImpl(this)
    this.user = new UserDataImpl()

    // Auto-connect unless explicitly disabled
    if (options.disableStats !== true) {
      this.connect()
    }
  }

  allChannels(): IChannel[] {
    return Array.from(this._channels.values())
  }

  channel(name: string): IChannel | null {
    return this._channels.get(name) ?? null
  }

  subscribe(channelName: string): IChannel {
    // Return existing channel if already subscribed
    let channel = this._channels.get(channelName)
    if (channel) {
      if (!channel.subscribed && this.connection.state === 'connected') {
        channel._subscribe()
      }
      return channel
    }

    // Create appropriate channel type
    if (channelName.startsWith('presence-')) {
      channel = new PresenceChannelImpl(channelName, this)
    } else if (channelName.startsWith('private-')) {
      channel = new PrivateChannelImpl(channelName, this)
    } else {
      channel = new ChannelImpl(channelName, this)
    }

    this._channels.set(channelName, channel)

    // Subscribe if connected
    if (this.connection.state === 'connected') {
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

  unsubscribeAll(): void {
    for (const [name, channel] of this._channels) {
      channel._unsubscribe()
    }
    this._channels.clear()
  }

  bind(event: string, callback: EventHandler): this {
    super.bind(event, callback)
    return this
  }

  unbind(event?: string, callback?: EventHandler): this {
    super.unbind(event, callback)
    return this
  }

  bind_global(callback: GlobalEventHandler): this {
    super.bind_global(callback)
    return this
  }

  unbind_global(callback?: GlobalEventHandler): this {
    super.unbind_global(callback)
    return this
  }

  connect(): void {
    if (this.connection.state === 'connected') {
      return
    }

    this.connection._setState('connecting')

    // Simulate connection delay
    setTimeout(() => {
      const socketId = generateSocketId()
      this.connection._setSocketId(socketId)

      // Register this connection
      globalConnections.set(socketId, this)

      this.connection._setState('connected')
      this.connection._emit('connected', { socket_id: socketId })

      // Subscribe to all pending channels
      for (const channel of this._channels.values()) {
        if (!channel.subscribed) {
          channel._subscribe()
        }
      }
    }, 10)
  }

  disconnect(): void {
    if (this.connection.state === 'disconnected') {
      return
    }

    // Unsubscribe from all channels
    this.unsubscribeAll()

    // Unregister this connection
    if (this.connection.socket_id) {
      globalConnections.delete(this.connection.socket_id)
    }

    this.connection._setSocketId(null as unknown as string)
    this.connection._setState('disconnected')
  }

  send_event(name: string, data: unknown, channel?: string): boolean {
    if (this.connection.state !== 'connected') {
      return false
    }

    if (channel) {
      publishToChannel(channel, name, data)
    }

    return true
  }

  signin(): void {
    // User authentication - simplified implementation
    if (this.connection.state !== 'connected') {
      console.warn('Cannot sign in when not connected')
      return
    }

    this.user.id = `user-${this.connection.socket_id}`
    this.user.info = {}
    this.user._emit('pusher:signin_success', { user_id: this.user.id })
  }

  /**
   * Internal method to deliver events to this client
   */
  _deliverEvent(channelName: string, event: string, data: unknown): void {
    const channel = this._channels.get(channelName)
    if (channel) {
      channel._deliverEvent(event, data)
    }

    // Also emit to global listeners
    this._emit(event, { channel: channelName, data })
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Create a new Pusher client
 */
export function createPusher(key: string, options?: PusherOptions): IPusher {
  return new PusherImpl(key, options as ExtendedPusherOptions)
}

/**
 * Pusher class (for new Pusher() syntax)
 */
export class Pusher implements IPusher {
  private _impl: PusherImpl

  constructor(key: string, options?: PusherOptions) {
    this._impl = new PusherImpl(key, options as ExtendedPusherOptions)
  }

  get connection(): IConnection {
    return this._impl.connection
  }

  get key(): string {
    return this._impl.key
  }

  get config(): PusherOptions {
    return this._impl.config
  }

  get user(): IUserData {
    return this._impl.user
  }

  allChannels(): IChannel[] {
    return this._impl.allChannels()
  }

  channel(name: string): IChannel | null {
    return this._impl.channel(name)
  }

  subscribe(channelName: string): IChannel {
    return this._impl.subscribe(channelName)
  }

  unsubscribe(channelName: string): void {
    this._impl.unsubscribe(channelName)
  }

  unsubscribeAll(): void {
    this._impl.unsubscribeAll()
  }

  bind(event: string, callback: EventHandler): this {
    this._impl.bind(event, callback)
    return this
  }

  unbind(event?: string, callback?: EventHandler): this {
    this._impl.unbind(event, callback)
    return this
  }

  bind_global(callback: GlobalEventHandler): this {
    this._impl.bind_global(callback)
    return this
  }

  unbind_global(callback?: GlobalEventHandler): this {
    this._impl.unbind_global(callback)
    return this
  }

  connect(): void {
    this._impl.connect()
  }

  disconnect(): void {
    this._impl.disconnect()
  }

  send_event(name: string, data: unknown, channel?: string): boolean {
    return this._impl.send_event(name, data, channel)
  }

  signin(): void {
    this._impl.signin()
  }

  /**
   * Internal delivery - exposed for Pusher wrapper
   */
  _deliverEvent(channelName: string, event: string, data: unknown): void {
    this._impl._deliverEvent(channelName, event, data)
  }
}

/**
 * Clear all in-memory data (for testing)
 */
export function _clearAll(): void {
  globalChannels.clear()
  globalConnections.clear()
}

/**
 * Get global channels (for testing)
 */
export function _getChannels(): Map<string, ChannelSubscription> {
  return globalChannels
}

/**
 * Get global connections (for testing)
 */
export function _getConnections(): Map<string, PusherImpl> {
  return globalConnections
}

// Default export
export default Pusher
