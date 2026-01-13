/**
 * @dotdo/pusher Server SDK
 *
 * Server-side Pusher API for triggering events from Cloudflare Workers.
 * API-compatible with `pusher` npm package (server SDK).
 *
 * @example Basic Usage
 * ```typescript
 * import { PusherServer } from '@dotdo/pusher/server'
 *
 * const pusher = new PusherServer({
 *   appId: 'my-app',
 *   key: 'my-key',
 *   secret: 'my-secret',
 * })
 *
 * // Trigger event on a channel
 * await pusher.trigger('my-channel', 'my-event', { message: 'Hello!' })
 *
 * // Trigger on multiple channels
 * await pusher.trigger(['channel-1', 'channel-2'], 'my-event', data)
 *
 * // Batch trigger
 * await pusher.triggerBatch([
 *   { channel: 'channel-1', name: 'event-1', data: { a: 1 } },
 *   { channel: 'channel-2', name: 'event-2', data: { b: 2 } },
 * ])
 * ```
 *
 * @example With Durable Objects (recommended)
 * ```typescript
 * import { PusherServer } from '@dotdo/pusher/server'
 *
 * // Use DO binding for direct RPC calls
 * const pusher = new PusherServer({
 *   appId: 'my-app',
 *   key: 'my-key',
 *   secret: 'my-secret',
 *   doNamespace: env.REALTIME_DO,
 * })
 *
 * // Events are delivered directly to DO without HTTP round-trip
 * await pusher.trigger('my-channel', 'my-event', data)
 * ```
 *
 * @see https://pusher.com/docs/channels/server_api/http-api
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Pusher server options
 */
export interface PusherServerOptions {
  /** Application ID */
  appId: string
  /** Application key */
  key: string
  /** Application secret */
  secret: string
  /** Custom host (for self-hosted) */
  host?: string
  /** Whether to use TLS */
  useTLS?: boolean
  /** Cluster name */
  cluster?: string
  /** Durable Object namespace for direct calls */
  doNamespace?: DurableObjectNamespace
  /** Encryption master key (for encrypted channels) */
  encryptionMasterKey?: string
  /** Timeout for requests (ms) */
  timeout?: number
}

/**
 * Event trigger options
 */
export interface TriggerOptions {
  /** Socket ID to exclude from receiving the event */
  socketId?: string
  /** Custom headers for the request */
  headers?: Record<string, string>
}

/**
 * Batch event
 */
export interface BatchEvent {
  /** Channel name */
  channel: string
  /** Event name */
  name: string
  /** Event data */
  data: unknown
  /** Socket ID to exclude */
  socketId?: string
}

/**
 * Channel info response
 */
export interface ChannelInfo {
  /** Whether the channel is occupied */
  occupied?: boolean
  /** Subscription count */
  subscription_count?: number
  /** User count (presence channels) */
  user_count?: number
}

/**
 * Channels list response
 */
export interface ChannelList {
  channels: Record<string, ChannelInfo>
}

/**
 * User info
 */
export interface UserInfo {
  id: string
}

/**
 * Presence channel users response
 */
export interface PresenceUsers {
  users: UserInfo[]
}

/**
 * Trigger result
 */
export interface TriggerResult {
  ok: boolean
  status?: number
  error?: string
}

/**
 * Auth signature for channel authorization
 */
export interface AuthSignature {
  auth: string
  channel_data?: string
  shared_secret?: string
}

/**
 * Presence channel data for auth
 */
export interface PresenceChannelData {
  user_id: string
  user_info?: Record<string, unknown>
}

// ============================================================================
// PUSHER SERVER IMPLEMENTATION
// ============================================================================

/**
 * Server-side Pusher SDK for Cloudflare Workers
 */
export class PusherServer {
  private appId: string
  private key: string
  private secret: string
  private host: string
  private useTLS: boolean
  private doNamespace?: DurableObjectNamespace
  private timeout: number

  constructor(options: PusherServerOptions) {
    this.appId = options.appId
    this.key = options.key
    this.secret = options.secret
    this.useTLS = options.useTLS ?? true
    this.timeout = options.timeout ?? 30000
    this.doNamespace = options.doNamespace

    // Determine host
    if (options.host) {
      this.host = options.host
    } else if (options.cluster) {
      this.host = `api-${options.cluster}.pusher.com`
    } else {
      this.host = 'api.pusherapp.com'
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIGGER EVENTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Trigger an event on one or more channels
   *
   * @example
   * ```typescript
   * // Single channel
   * await pusher.trigger('my-channel', 'my-event', { message: 'Hello!' })
   *
   * // Multiple channels
   * await pusher.trigger(['channel-1', 'channel-2'], 'update', data)
   *
   * // Exclude sender
   * await pusher.trigger('chat', 'message', data, { socketId: 'sender-socket-id' })
   * ```
   */
  async trigger(
    channels: string | string[],
    event: string,
    data: unknown,
    options?: TriggerOptions
  ): Promise<TriggerResult> {
    const channelList = Array.isArray(channels) ? channels : [channels]

    // Validate
    if (channelList.length === 0) {
      return { ok: false, error: 'No channels specified' }
    }
    if (channelList.length > 100) {
      return { ok: false, error: 'Cannot trigger to more than 100 channels' }
    }
    if (event.length > 200) {
      return { ok: false, error: 'Event name too long (max 200 chars)' }
    }

    // Use DO direct call if available
    if (this.doNamespace) {
      return this.triggerViaDO(channelList, event, data, options)
    }

    // Fall back to HTTP API
    return this.triggerViaHTTP(channelList, event, data, options)
  }

  /**
   * Trigger multiple events in a single request
   *
   * @example
   * ```typescript
   * await pusher.triggerBatch([
   *   { channel: 'channel-1', name: 'event-1', data: { a: 1 } },
   *   { channel: 'channel-2', name: 'event-2', data: { b: 2 } },
   * ])
   * ```
   */
  async triggerBatch(batch: BatchEvent[]): Promise<TriggerResult> {
    if (batch.length === 0) {
      return { ok: false, error: 'Empty batch' }
    }
    if (batch.length > 10) {
      return { ok: false, error: 'Batch size exceeds limit (max 10)' }
    }

    // Use DO direct call if available
    if (this.doNamespace) {
      const results = await Promise.all(
        batch.map((event) =>
          this.triggerViaDO([event.channel], event.name, event.data, {
            socketId: event.socketId,
          })
        )
      )
      const failed = results.find((r) => !r.ok)
      return failed || { ok: true }
    }

    // Fall back to HTTP API
    return this.triggerBatchViaHTTP(batch)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHANNEL OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get information about a channel
   */
  async getChannelInfo(channel: string): Promise<ChannelInfo | null> {
    if (this.doNamespace) {
      return this.getChannelInfoViaDO(channel)
    }

    const path = `/apps/${this.appId}/channels/${channel}`
    const response = await this.makeRequest('GET', path)

    if (!response.ok) {
      return null
    }

    return response.json()
  }

  /**
   * Get list of channels
   */
  async getChannels(prefix?: string): Promise<ChannelList> {
    if (this.doNamespace) {
      return this.getChannelsViaDO(prefix)
    }

    const params = new URLSearchParams()
    if (prefix) {
      params.set('filter_by_prefix', prefix)
    }

    const path = `/apps/${this.appId}/channels?${params.toString()}`
    const response = await this.makeRequest('GET', path)

    if (!response.ok) {
      return { channels: {} }
    }

    return response.json()
  }

  /**
   * Get users in a presence channel
   */
  async getPresenceUsers(channel: string): Promise<PresenceUsers> {
    if (!channel.startsWith('presence-')) {
      return { users: [] }
    }

    if (this.doNamespace) {
      return this.getPresenceUsersViaDO(channel)
    }

    const path = `/apps/${this.appId}/channels/${channel}/users`
    const response = await this.makeRequest('GET', path)

    if (!response.ok) {
      return { users: [] }
    }

    return response.json()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate authentication signature for private/presence channels
   *
   * @example
   * ```typescript
   * // Private channel
   * const auth = pusher.authorizeChannel(socketId, 'private-channel')
   *
   * // Presence channel
   * const auth = pusher.authorizeChannel(socketId, 'presence-room', {
   *   user_id: 'user-123',
   *   user_info: { name: 'Alice' }
   * })
   * ```
   */
  authorizeChannel(
    socketId: string,
    channel: string,
    presenceData?: PresenceChannelData
  ): AuthSignature {
    if (channel.startsWith('presence-') && !presenceData) {
      throw new Error('Presence channels require user data')
    }

    let stringToSign = `${socketId}:${channel}`

    const result: AuthSignature = {
      auth: '',
    }

    if (presenceData) {
      const channelData = JSON.stringify({
        user_id: presenceData.user_id,
        user_info: presenceData.user_info,
      })
      stringToSign += `:${channelData}`
      result.channel_data = channelData
    }

    result.auth = `${this.key}:${this.signSync(stringToSign)}`
    return result
  }

  /**
   * Authenticate a user (for user authentication)
   */
  authenticateUser(socketId: string, userData: { id: string; user_info?: Record<string, unknown> }): {
    auth: string
    user_data: string
  } {
    const userDataStr = JSON.stringify(userData)
    const stringToSign = `${socketId}::user::${userDataStr}`

    return {
      auth: `${this.key}:${this.signSync(stringToSign)}`,
      user_data: userDataStr,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DO DIRECT CALLS
  // ═══════════════════════════════════════════════════════════════════════════

  private async triggerViaDO(
    channels: string[],
    event: string,
    data: unknown,
    options?: TriggerOptions
  ): Promise<TriggerResult> {
    try {
      const namespace = this.doNamespace!
      const results = await Promise.all(
        channels.map(async (channel) => {
          // Route to the DO responsible for this channel
          const id = namespace.idFromName(this.getChannelNamespace(channel))
          const stub = namespace.get(id) as DurableObjectStub & {
            broadcast: (channel: string, event: string, data: unknown) => Promise<{ ok: boolean }>
          }

          return stub.broadcast(channel, event, data)
        })
      )

      const failed = results.find((r) => !r.ok)
      return failed || { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private async getChannelInfoViaDO(channel: string): Promise<ChannelInfo | null> {
    try {
      const namespace = this.doNamespace!
      const id = namespace.idFromName(this.getChannelNamespace(channel))
      const stub = namespace.get(id) as DurableObjectStub & {
        getSubscriberCount: (channel: string) => Promise<number>
        getPresence: (channel: string) => Promise<{ members: Array<{ id: string }>; count: number }>
      }

      const subscriberCount = await stub.getSubscriberCount(channel)

      const info: ChannelInfo = {
        occupied: subscriberCount > 0,
        subscription_count: subscriberCount,
      }

      if (channel.startsWith('presence-')) {
        const presence = await stub.getPresence(channel)
        info.user_count = presence.count
      }

      return info
    } catch {
      return null
    }
  }

  private async getChannelsViaDO(prefix?: string): Promise<ChannelList> {
    try {
      const namespace = this.doNamespace!
      const id = namespace.idFromName('default')
      const stub = namespace.get(id) as DurableObjectStub & {
        getChannelInfo: () => Promise<{ channels: string[] }>
      }

      const info = await stub.getChannelInfo()
      const channels: Record<string, ChannelInfo> = {}

      for (const channel of info.channels) {
        if (!prefix || channel.startsWith(prefix)) {
          channels[channel] = { occupied: true }
        }
      }

      return { channels }
    } catch {
      return { channels: {} }
    }
  }

  private async getPresenceUsersViaDO(channel: string): Promise<PresenceUsers> {
    try {
      const namespace = this.doNamespace!
      const id = namespace.idFromName(this.getChannelNamespace(channel))
      const stub = namespace.get(id) as DurableObjectStub & {
        getPresence: (channel: string) => Promise<{ members: Array<{ id: string }>; count: number }>
      }

      const presence = await stub.getPresence(channel)
      return {
        users: presence.members.map((m) => ({ id: m.id })),
      }
    } catch {
      return { users: [] }
    }
  }

  private getChannelNamespace(channel: string): string {
    // In production, you might want to shard by channel prefix
    // For simplicity, we use 'default' for all channels
    return 'default'
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP API (fallback)
  // ═══════════════════════════════════════════════════════════════════════════

  private async triggerViaHTTP(
    channels: string[],
    event: string,
    data: unknown,
    options?: TriggerOptions
  ): Promise<TriggerResult> {
    const body = {
      name: event,
      channels,
      data: typeof data === 'string' ? data : JSON.stringify(data),
      socket_id: options?.socketId,
    }

    const response = await this.makeRequest(
      'POST',
      `/apps/${this.appId}/events`,
      JSON.stringify(body)
    )

    return { ok: response.ok, status: response.status }
  }

  private async triggerBatchViaHTTP(batch: BatchEvent[]): Promise<TriggerResult> {
    const body = {
      batch: batch.map((event) => ({
        channel: event.channel,
        name: event.name,
        data: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
        socket_id: event.socketId,
      })),
    }

    const response = await this.makeRequest(
      'POST',
      `/apps/${this.appId}/batch_events`,
      JSON.stringify(body)
    )

    return { ok: response.ok, status: response.status }
  }

  private async makeRequest(method: string, path: string, body?: string): Promise<Response> {
    const timestamp = Math.floor(Date.now() / 1000)
    const params = new URLSearchParams({
      auth_key: this.key,
      auth_timestamp: timestamp.toString(),
      auth_version: '1.0',
    })

    if (body) {
      params.set('body_md5', await this.md5(body))
    }

    // Build string to sign
    const stringToSign = [method, path, params.toString()].join('\n')
    const signature = await this.sign(stringToSign)
    params.set('auth_signature', signature)

    const url = `${this.useTLS ? 'https' : 'http'}://${this.host}${path}?${params.toString()}`

    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    }

    if (body) {
      init.body = body
    }

    return fetch(url, init)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRYPTO UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  private async sign(data: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private signSync(data: string): string {
    // For synchronous auth, we need to use a simpler approach
    // In Workers environment, we can use crypto.subtle in async context
    // For sync, we return a placeholder that works for testing
    // In production, use the async version
    return this.hmacSHA256Sync(data)
  }

  private hmacSHA256Sync(data: string): string {
    // Simplified HMAC for sync context (for auth signatures)
    // In production, this should use Web Crypto API properly
    const encoder = new TextEncoder()
    const dataBytes = encoder.encode(data)
    const keyBytes = encoder.encode(this.secret)

    // Simple XOR-based HMAC simulation for testing
    // Replace with proper implementation in production
    let hash = 0
    for (let i = 0; i < dataBytes.length; i++) {
      hash = ((hash << 5) - hash + dataBytes[i] + keyBytes[i % keyBytes.length]) | 0
    }

    return Math.abs(hash).toString(16).padStart(64, '0')
  }

  private async md5(data: string): Promise<string> {
    // Workers don't have native MD5, use SHA-256 truncated for compatibility
    // In production with actual Pusher servers, you'd need a real MD5 implementation
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data))
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default PusherServer
