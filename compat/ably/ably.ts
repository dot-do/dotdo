/**
 * @dotdo/ably - Ably SDK compat
 *
 * Drop-in replacement for ably-js backed by DO with in-memory pub/sub.
 * This implementation matches the Ably Realtime API.
 * Production version routes to Cloudflare Durable Objects for real-time.
 *
 * @see https://ably.com/docs/api/realtime-sdk
 */
import type {
  Realtime as IRealtime,
  ClientOptions,
  Connection as IConnection,
  Channels as IChannels,
  RealtimeChannel as IRealtimeChannel,
  RealtimePresence as IRealtimePresence,
  Auth as IAuth,
  ConnectionState,
  ConnectionStateChange,
  ChannelState,
  ChannelStateChange,
  ChannelOptions,
  ChannelMode,
  ChannelProperties,
  Message,
  PresenceMessage,
  PresenceAction,
  MessageListener,
  PresenceListener,
  RealtimeHistoryParams,
  RealtimePresenceParams,
  PaginatedResult,
  TokenDetails,
  TokenParams,
  TokenRequest,
  AuthOptions,
  Stats,
  StatsParams,
  HttpPaginatedResponse,
  ErrorInfo,
} from './types'
import {
  AblyError,
  ConnectionError,
  ChannelError,
} from './types'

// Re-export types and classes from types.ts
export {
  AblyError,
  ConnectionError,
  ChannelError,
  isConnected,
  isAttached,
} from './types'

// ============================================================================
// IN-MEMORY PUB/SUB STORAGE
// ============================================================================

/**
 * Channel subscription data
 */
interface ChannelSubscription {
  name: string
  subscribers: Map<string, RealtimeChannelImpl> // connectionId -> channel instance
  presenceMembers: Map<string, PresenceMessage> // clientId -> presence data
  messages: Message[]
  presenceHistory: PresenceMessage[]
}

/**
 * Global in-memory storage for pub/sub
 */
const globalChannels = new Map<string, ChannelSubscription>()
const globalConnections = new Map<string, RealtimeImpl>() // connectionId -> Realtime instance

/**
 * Get or create a channel subscription
 */
function getOrCreateChannel(name: string): ChannelSubscription {
  let channel = globalChannels.get(name)
  if (!channel) {
    channel = {
      name,
      subscribers: new Map(),
      presenceMembers: new Map(),
      messages: [],
      presenceHistory: [],
    }
    globalChannels.set(name, channel)
  }
  return channel
}

/**
 * Publish message to all subscribers of a channel
 */
function publishToChannel(channelName: string, message: Message, excludeConnectionId?: string): void {
  const channel = globalChannels.get(channelName)
  if (!channel) return

  for (const [connectionId, channelImpl] of channel.subscribers) {
    if (connectionId === excludeConnectionId) continue
    channelImpl._deliverMessage(message)
  }
}

/**
 * Publish presence event to all subscribers of a channel
 */
function publishPresenceToChannel(channelName: string, presence: PresenceMessage, excludeConnectionId?: string): void {
  const channel = globalChannels.get(channelName)
  if (!channel) return

  for (const [connectionId, channelImpl] of channel.subscribers) {
    if (connectionId === excludeConnectionId) continue
    channelImpl._deliverPresence(presence)
  }
}

/**
 * Generate a unique connection ID
 */
function generateConnectionId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

// ============================================================================
// EVENT EMITTER BASE CLASS
// ============================================================================

type ListenerEntry<T> = {
  callback: (data: T) => void
  once: boolean
}

/**
 * Simple EventEmitter implementation for Ably-style on/once/off
 */
class EventEmitter<T> {
  protected _listeners: Map<string, Set<ListenerEntry<T>>> = new Map()

  on(event: string | string[], listener: (data: T) => void): void {
    const events = Array.isArray(event) ? event : [event]
    for (const e of events) {
      if (!this._listeners.has(e)) {
        this._listeners.set(e, new Set())
      }
      this._listeners.get(e)!.add({ callback: listener, once: false })
    }
  }

  once(event: string | string[], listener: (data: T) => void): void {
    const events = Array.isArray(event) ? event : [event]
    for (const e of events) {
      if (!this._listeners.has(e)) {
        this._listeners.set(e, new Set())
      }
      this._listeners.get(e)!.add({ callback: listener, once: true })
    }
  }

  off(event?: string | string[], listener?: (data: T) => void): void {
    if (event === undefined) {
      this._listeners.clear()
      return
    }

    const events = Array.isArray(event) ? event : [event]
    for (const e of events) {
      if (listener === undefined) {
        this._listeners.delete(e)
      } else {
        const listeners = this._listeners.get(e)
        if (listeners) {
          for (const entry of listeners) {
            if (entry.callback === listener) {
              listeners.delete(entry)
            }
          }
        }
      }
    }
  }

  protected _emit(event: string, data: T): void {
    const listeners = this._listeners.get(event)
    if (listeners) {
      for (const entry of listeners) {
        try {
          entry.callback(data)
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error)
        }
        if (entry.once) {
          listeners.delete(entry)
        }
      }
    }
  }
}

// ============================================================================
// CONNECTION IMPLEMENTATION
// ============================================================================

class ConnectionImpl extends EventEmitter<ConnectionStateChange> implements IConnection {
  state: ConnectionState = 'initialized'
  id: string | null = null
  key: string | null = null
  recoveryKey: string | null = null
  errorReason: ErrorInfo | null = null

  private _client: RealtimeImpl

  constructor(client: RealtimeImpl) {
    super()
    this._client = client
  }

  _setState(newState: ConnectionState, reason?: ErrorInfo): void {
    const previous = this.state
    this.state = newState

    if (reason) {
      this.errorReason = reason
    }

    const stateChange: ConnectionStateChange = {
      previous,
      current: newState,
      reason,
    }

    this._emit(newState, stateChange)
  }

  _setId(connectionId: string): void {
    this.id = connectionId
    this.key = `key-${connectionId}`
    this.recoveryKey = `recovery-${connectionId}`
  }

  connect(): void {
    this._client.connect()
  }

  close(): void {
    this._client.close()
  }

  async ping(): Promise<number> {
    const start = Date.now()
    // Simulate a ping delay
    await new Promise(r => setTimeout(r, 5))
    return Date.now() - start
  }
}

// ============================================================================
// PRESENCE IMPLEMENTATION
// ============================================================================

class RealtimePresenceImpl implements IRealtimePresence {
  syncComplete: boolean = false

  private _channel: RealtimeChannelImpl
  private _client: RealtimeImpl
  private _listeners: Map<string, Set<{ callback: PresenceListener; once: boolean }>> = new Map()
  private _allListeners: Set<{ callback: PresenceListener; once: boolean }> = new Set()

  constructor(channel: RealtimeChannelImpl, client: RealtimeImpl) {
    this._channel = channel
    this._client = client
  }

  async enter(data?: unknown): Promise<void> {
    await this._ensureAttached()

    const clientId = this._client.clientId
    if (!clientId) {
      throw new AblyError('clientId is required for presence', 40012)
    }

    const presence: PresenceMessage = {
      id: generateMessageId(),
      action: 'enter',
      clientId,
      connectionId: this._client.connection.id || undefined,
      data,
      timestamp: Date.now(),
    }

    const channelSub = getOrCreateChannel(this._channel.name)
    channelSub.presenceMembers.set(clientId, presence)
    channelSub.presenceHistory.push(presence)

    // Publish to all other subscribers
    publishPresenceToChannel(this._channel.name, presence, this._client.connection.id || undefined)

    this.syncComplete = true
  }

  async update(data?: unknown): Promise<void> {
    await this._ensureAttached()

    const clientId = this._client.clientId
    if (!clientId) {
      throw new AblyError('clientId is required for presence', 40012)
    }

    const presence: PresenceMessage = {
      id: generateMessageId(),
      action: 'update',
      clientId,
      connectionId: this._client.connection.id || undefined,
      data,
      timestamp: Date.now(),
    }

    const channelSub = getOrCreateChannel(this._channel.name)
    channelSub.presenceMembers.set(clientId, presence)
    channelSub.presenceHistory.push(presence)

    publishPresenceToChannel(this._channel.name, presence, this._client.connection.id || undefined)
  }

  async leave(data?: unknown): Promise<void> {
    await this._ensureAttached()

    const clientId = this._client.clientId
    if (!clientId) {
      throw new AblyError('clientId is required for presence', 40012)
    }

    const presence: PresenceMessage = {
      id: generateMessageId(),
      action: 'leave',
      clientId,
      connectionId: this._client.connection.id || undefined,
      data,
      timestamp: Date.now(),
    }

    const channelSub = getOrCreateChannel(this._channel.name)
    channelSub.presenceMembers.delete(clientId)
    channelSub.presenceHistory.push(presence)

    publishPresenceToChannel(this._channel.name, presence, this._client.connection.id || undefined)
  }

  async get(params?: RealtimePresenceParams): Promise<PresenceMessage[]> {
    await this._ensureAttached()

    const channelSub = globalChannels.get(this._channel.name)
    if (!channelSub) return []

    let members = Array.from(channelSub.presenceMembers.values())

    if (params?.clientId) {
      members = members.filter(m => m.clientId === params.clientId)
    }

    if (params?.connectionId) {
      members = members.filter(m => m.connectionId === params.connectionId)
    }

    if (params?.limit) {
      members = members.slice(0, params.limit)
    }

    return members
  }

  subscribe(listener: PresenceListener): Promise<void>
  subscribe(action: PresenceAction, listener: PresenceListener): Promise<void>
  subscribe(actions: PresenceAction[], listener: PresenceListener): Promise<void>
  async subscribe(
    listenerOrAction: PresenceListener | PresenceAction | PresenceAction[],
    maybeListener?: PresenceListener
  ): Promise<void> {
    await this._ensureAttached()

    if (typeof listenerOrAction === 'function') {
      this._allListeners.add({ callback: listenerOrAction, once: false })
    } else if (Array.isArray(listenerOrAction)) {
      for (const action of listenerOrAction) {
        this._addListener(action, maybeListener!, false)
      }
    } else {
      this._addListener(listenerOrAction, maybeListener!, false)
    }
  }

  unsubscribe(listener?: PresenceListener): void
  unsubscribe(action: PresenceAction, listener?: PresenceListener): void
  unsubscribe(actions: PresenceAction[], listener?: PresenceListener): void
  unsubscribe(
    listenerOrAction?: PresenceListener | PresenceAction | PresenceAction[],
    maybeListener?: PresenceListener
  ): void {
    if (listenerOrAction === undefined) {
      this._listeners.clear()
      this._allListeners.clear()
    } else if (typeof listenerOrAction === 'function') {
      for (const entry of this._allListeners) {
        if (entry.callback === listenerOrAction) {
          this._allListeners.delete(entry)
        }
      }
    } else if (Array.isArray(listenerOrAction)) {
      for (const action of listenerOrAction) {
        this._removeListener(action, maybeListener)
      }
    } else {
      this._removeListener(listenerOrAction, maybeListener)
    }
  }

  async history(params?: RealtimeHistoryParams): Promise<PaginatedResult<PresenceMessage>> {
    const channelSub = globalChannels.get(this._channel.name)
    let items = channelSub?.presenceHistory || []

    if (params?.direction === 'forwards') {
      items = [...items]
    } else {
      items = [...items].reverse()
    }

    if (params?.limit) {
      items = items.slice(0, params.limit)
    }

    return createPaginatedResult(items)
  }

  private _addListener(action: PresenceAction, listener: PresenceListener, once: boolean): void {
    if (!this._listeners.has(action)) {
      this._listeners.set(action, new Set())
    }
    this._listeners.get(action)!.add({ callback: listener, once })
  }

  private _removeListener(action: PresenceAction, listener?: PresenceListener): void {
    if (listener === undefined) {
      this._listeners.delete(action)
    } else {
      const listeners = this._listeners.get(action)
      if (listeners) {
        for (const entry of listeners) {
          if (entry.callback === listener) {
            listeners.delete(entry)
          }
        }
      }
    }
  }

  _deliverPresence(presence: PresenceMessage): void {
    // Call action-specific listeners
    const listeners = this._listeners.get(presence.action)
    if (listeners) {
      for (const entry of listeners) {
        try {
          entry.callback(presence)
        } catch (error) {
          console.error('Error in presence listener:', error)
        }
        if (entry.once) {
          listeners.delete(entry)
        }
      }
    }

    // Call all listeners
    for (const entry of this._allListeners) {
      try {
        entry.callback(presence)
      } catch (error) {
        console.error('Error in presence listener:', error)
      }
      if (entry.once) {
        this._allListeners.delete(entry)
      }
    }
  }

  private async _ensureAttached(): Promise<void> {
    if (this._channel.state !== 'attached') {
      await this._channel.attach()
    }
  }
}

// ============================================================================
// CHANNEL IMPLEMENTATION
// ============================================================================

class RealtimeChannelImpl extends EventEmitter<ChannelStateChange> implements IRealtimeChannel {
  name: string
  state: ChannelState = 'initialized'
  errorReason: ErrorInfo | null = null
  modes: ChannelMode[] = []
  params: Record<string, string> = {}
  properties: ChannelProperties = {}
  presence: RealtimePresenceImpl

  private _client: RealtimeImpl
  private _options: ChannelOptions
  private _messageListeners: Map<string, Set<{ callback: MessageListener; once: boolean }>> = new Map()
  private _allMessageListeners: Set<{ callback: MessageListener; once: boolean }> = new Set()

  constructor(name: string, client: RealtimeImpl, options?: ChannelOptions) {
    super()
    this.name = name
    this._client = client
    this._options = options || {}
    this.presence = new RealtimePresenceImpl(this, client)

    if (options?.modes) {
      this.modes = options.modes
    }
    if (options?.params) {
      this.params = { ...options.params }
    }
  }

  async attach(): Promise<void> {
    if (this.state === 'attached') return

    if (this._client.connection.state !== 'connected') {
      throw new ChannelError('Cannot attach when not connected', 90000)
    }

    const previous = this.state
    this.state = 'attaching'
    this._emit('attaching', { previous, current: 'attaching' })

    // Simulate attach delay
    await new Promise(r => setTimeout(r, 5))

    const channelSub = getOrCreateChannel(this.name)
    channelSub.subscribers.set(this._client.connection.id!, this)

    this.state = 'attached'
    this._emit('attached', { previous: 'attaching', current: 'attached' })
  }

  async detach(): Promise<void> {
    if (this.state === 'detached') return

    const previous = this.state
    this.state = 'detaching'
    this._emit('detaching', { previous, current: 'detaching' })

    const channelSub = globalChannels.get(this.name)
    if (channelSub && this._client.connection.id) {
      channelSub.subscribers.delete(this._client.connection.id)
    }

    this.state = 'detached'
    this._emit('detached', { previous: 'detaching', current: 'detached' })
  }

  subscribe(listener: MessageListener): Promise<void>
  subscribe(event: string, listener: MessageListener): Promise<void>
  subscribe(events: string[], listener: MessageListener): Promise<void>
  async subscribe(
    listenerOrEvent: MessageListener | string | string[],
    maybeListener?: MessageListener
  ): Promise<void> {
    await this._ensureAttached()

    if (typeof listenerOrEvent === 'function') {
      this._allMessageListeners.add({ callback: listenerOrEvent, once: false })
    } else if (Array.isArray(listenerOrEvent)) {
      for (const event of listenerOrEvent) {
        this._addMessageListener(event, maybeListener!, false)
      }
    } else {
      this._addMessageListener(listenerOrEvent, maybeListener!, false)
    }
  }

  unsubscribe(listener?: MessageListener): void
  unsubscribe(event: string, listener?: MessageListener): void
  unsubscribe(events: string[], listener?: MessageListener): void
  unsubscribe(
    listenerOrEvent?: MessageListener | string | string[],
    maybeListener?: MessageListener
  ): void {
    if (listenerOrEvent === undefined) {
      this._messageListeners.clear()
      this._allMessageListeners.clear()
    } else if (typeof listenerOrEvent === 'function') {
      for (const entry of this._allMessageListeners) {
        if (entry.callback === listenerOrEvent) {
          this._allMessageListeners.delete(entry)
        }
      }
    } else if (Array.isArray(listenerOrEvent)) {
      for (const event of listenerOrEvent) {
        this._removeMessageListener(event, maybeListener)
      }
    } else {
      this._removeMessageListener(listenerOrEvent, maybeListener)
    }
  }

  async publish(name: string, data?: unknown): Promise<void>
  async publish(message: Message): Promise<void>
  async publish(messages: Message[]): Promise<void>
  async publish(
    nameOrMessage: string | Message | Message[],
    maybeData?: unknown
  ): Promise<void> {
    await this._ensureAttached()

    const messages: Message[] = []

    if (typeof nameOrMessage === 'string') {
      messages.push({
        id: generateMessageId(),
        name: nameOrMessage,
        data: maybeData,
        clientId: this._client.clientId || undefined,
        connectionId: this._client.connection.id || undefined,
        timestamp: Date.now(),
      })
    } else if (Array.isArray(nameOrMessage)) {
      for (const msg of nameOrMessage) {
        messages.push({
          ...msg,
          id: msg.id || generateMessageId(),
          clientId: msg.clientId || this._client.clientId || undefined,
          connectionId: msg.connectionId || this._client.connection.id || undefined,
          timestamp: msg.timestamp || Date.now(),
        })
      }
    } else {
      messages.push({
        ...nameOrMessage,
        id: nameOrMessage.id || generateMessageId(),
        clientId: nameOrMessage.clientId || this._client.clientId || undefined,
        connectionId: nameOrMessage.connectionId || this._client.connection.id || undefined,
        timestamp: nameOrMessage.timestamp || Date.now(),
      })
    }

    const channelSub = getOrCreateChannel(this.name)

    for (const message of messages) {
      channelSub.messages.push(message)
      publishToChannel(this.name, message)
    }
  }

  async history(params?: RealtimeHistoryParams): Promise<PaginatedResult<Message>> {
    const channelSub = globalChannels.get(this.name)
    let items = channelSub?.messages || []

    if (params?.direction === 'forwards') {
      items = [...items]
    } else {
      items = [...items].reverse()
    }

    if (params?.limit) {
      items = items.slice(0, params.limit)
    }

    return createPaginatedResult(items)
  }

  async setOptions(options: ChannelOptions): Promise<void> {
    this._options = { ...this._options, ...options }
    if (options.params) {
      this.params = { ...this.params, ...options.params }
    }
    if (options.modes) {
      this.modes = options.modes
    }
  }

  private _addMessageListener(event: string, listener: MessageListener, once: boolean): void {
    if (!this._messageListeners.has(event)) {
      this._messageListeners.set(event, new Set())
    }
    this._messageListeners.get(event)!.add({ callback: listener, once })
  }

  private _removeMessageListener(event: string, listener?: MessageListener): void {
    if (listener === undefined) {
      this._messageListeners.delete(event)
    } else {
      const listeners = this._messageListeners.get(event)
      if (listeners) {
        for (const entry of listeners) {
          if (entry.callback === listener) {
            listeners.delete(entry)
          }
        }
      }
    }
  }

  _deliverMessage(message: Message): void {
    // Call event-specific listeners
    if (message.name) {
      const listeners = this._messageListeners.get(message.name)
      if (listeners) {
        for (const entry of listeners) {
          try {
            entry.callback(message)
          } catch (error) {
            console.error('Error in message listener:', error)
          }
          if (entry.once) {
            listeners.delete(entry)
          }
        }
      }
    }

    // Call all listeners
    for (const entry of this._allMessageListeners) {
      try {
        entry.callback(message)
      } catch (error) {
        console.error('Error in message listener:', error)
      }
      if (entry.once) {
        this._allMessageListeners.delete(entry)
      }
    }
  }

  _deliverPresence(presence: PresenceMessage): void {
    this.presence._deliverPresence(presence)
  }

  private async _ensureAttached(): Promise<void> {
    if (this.state !== 'attached') {
      await this.attach()
    }
  }

  _detachOnClose(): void {
    const channelSub = globalChannels.get(this.name)
    if (channelSub && this._client.connection.id) {
      channelSub.subscribers.delete(this._client.connection.id)
    }
    this.state = 'detached'
  }
}

// ============================================================================
// CHANNELS COLLECTION IMPLEMENTATION
// ============================================================================

class ChannelsImpl implements IChannels {
  private _client: RealtimeImpl
  private _channels: Map<string, RealtimeChannelImpl> = new Map()

  constructor(client: RealtimeImpl) {
    this._client = client
  }

  get(name: string, options?: ChannelOptions): RealtimeChannel {
    let channel = this._channels.get(name)
    if (!channel) {
      channel = new RealtimeChannelImpl(name, this._client, options)
      this._channels.set(name, channel)
    } else if (options) {
      // Update options on existing channel
      channel.setOptions(options)
    }
    return channel
  }

  exists(name: string): boolean {
    return this._channels.has(name)
  }

  release(name: string): void {
    const channel = this._channels.get(name)
    if (channel) {
      channel.detach()
      this._channels.delete(name)
    }
  }

  *iterate(): IterableIterator<RealtimeChannel> {
    for (const channel of this._channels.values()) {
      yield channel
    }
  }

  _releaseAll(): void {
    for (const channel of this._channels.values()) {
      channel._detachOnClose()
    }
    this._channels.clear()
  }
}

// ============================================================================
// AUTH IMPLEMENTATION
// ============================================================================

class AuthImpl implements IAuth {
  clientId: string | null = null

  private _client: RealtimeImpl

  constructor(client: RealtimeImpl) {
    this._client = client
    this.clientId = client.options.clientId || null
  }

  async authorize(tokenParams?: TokenParams, authOptions?: AuthOptions): Promise<TokenDetails> {
    // Simplified implementation
    return {
      token: `token-${Date.now()}`,
      expires: Date.now() + 3600000,
      issued: Date.now(),
      clientId: this.clientId || undefined,
    }
  }

  async createTokenRequest(tokenParams?: TokenParams, authOptions?: AuthOptions): Promise<TokenRequest> {
    return {
      keyName: 'key-name',
      clientId: tokenParams?.clientId,
      nonce: `nonce-${Date.now()}`,
      timestamp: Date.now(),
      capability: tokenParams?.capability,
      ttl: tokenParams?.ttl,
      mac: `mac-${Date.now()}`,
    }
  }

  async requestToken(tokenParams?: TokenParams, authOptions?: AuthOptions): Promise<TokenDetails> {
    return this.authorize(tokenParams, authOptions)
  }
}

// ============================================================================
// REALTIME CLIENT IMPLEMENTATION
// ============================================================================

class RealtimeImpl implements IRealtime {
  options: ClientOptions
  connection: ConnectionImpl
  channels: ChannelsImpl
  clientId: string | null
  auth: AuthImpl

  constructor(options: ClientOptions | string) {
    if (typeof options === 'string') {
      this.options = { key: options }
    } else {
      this.options = options
    }

    this.clientId = this.options.clientId || null
    this.connection = new ConnectionImpl(this)
    this.channels = new ChannelsImpl(this)
    this.auth = new AuthImpl(this)

    // Auto-connect unless disabled
    if (this.options.autoConnect !== false) {
      this.connect()
    }
  }

  connect(): void {
    if (this.connection.state === 'connected') return

    this.connection._setState('connecting')

    // Simulate connection delay
    setTimeout(() => {
      const connectionId = generateConnectionId()
      this.connection._setId(connectionId)
      globalConnections.set(connectionId, this)
      this.connection._setState('connected')
    }, 10)
  }

  async close(): Promise<void> {
    if (this.connection.state === 'closed') return

    this.connection._setState('closing')

    // Detach all channels
    this.channels._releaseAll()

    // Unregister connection
    if (this.connection.id) {
      globalConnections.delete(this.connection.id)
    }

    this.connection._setState('closed')
  }

  async time(): Promise<number> {
    return Date.now()
  }

  async stats(params?: StatsParams): Promise<PaginatedResult<Stats>> {
    // Return empty stats for now
    return createPaginatedResult<Stats>([])
  }

  async request(
    method: string,
    path: string,
    version: number,
    params?: Record<string, string>,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<HttpPaginatedResponse> {
    return {
      items: [],
      statusCode: 200,
      success: true,
      headers: {},
      hasNext: () => false,
      isLast: () => true,
      next: async () => this.request(method, path, version, params, body, headers),
      first: async () => this.request(method, path, version, params, body, headers),
      current: async () => this.request(method, path, version, params, body, headers),
    }
  }
}

// ============================================================================
// PAGINATED RESULT HELPER
// ============================================================================

function createPaginatedResult<T>(items: T[]): PaginatedResult<T> {
  return {
    items,
    hasNext: () => false,
    isLast: () => true,
    next: async () => createPaginatedResult<T>([]),
    first: async () => createPaginatedResult(items),
    current: async () => createPaginatedResult(items),
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Realtime class (Ably SDK compatible)
 */
export class Realtime implements IRealtime {
  private _impl: RealtimeImpl

  constructor(options: ClientOptions | string) {
    this._impl = new RealtimeImpl(options)
  }

  get options(): ClientOptions {
    return this._impl.options
  }

  get connection(): IConnection {
    return this._impl.connection
  }

  get channels(): IChannels {
    return this._impl.channels
  }

  get clientId(): string | null {
    return this._impl.clientId
  }

  get auth(): IAuth {
    return this._impl.auth
  }

  connect(): void {
    this._impl.connect()
  }

  async close(): Promise<void> {
    await this._impl.close()
  }

  async time(): Promise<number> {
    return this._impl.time()
  }

  async stats(params?: StatsParams): Promise<PaginatedResult<Stats>> {
    return this._impl.stats(params)
  }

  async request(
    method: string,
    path: string,
    version: number,
    params?: Record<string, string>,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<HttpPaginatedResponse> {
    return this._impl.request(method, path, version, params, body, headers)
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
export function _getConnections(): Map<string, RealtimeImpl> {
  return globalConnections
}

// Default export
export default Realtime
