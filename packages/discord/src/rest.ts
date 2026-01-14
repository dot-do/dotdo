/**
 * @dotdo/discord - REST Client
 *
 * HTTP-based Discord REST API client with rate limiting support
 *
 * @example
 * ```typescript
 * import { REST, Routes } from '@dotdo/discord'
 *
 * const rest = new REST({ version: '10' }).setToken('bot-token')
 *
 * // Get user info
 * const user = await rest.get(Routes.user('123'))
 *
 * // Send message
 * await rest.post(Routes.channelMessages('456'), {
 *   body: { content: 'Hello!' }
 * })
 * ```
 */

import type { RESTOptions, RequestOptions } from './types'

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Discord API Error
 */
export class DiscordError extends Error {
  /** Discord error code */
  code: number
  /** HTTP status code */
  status?: number
  /** Additional error data */
  errors?: unknown
  /** Flag to identify DiscordError instances */
  readonly isDiscordError = true

  constructor(code: number, message: string, status?: number, errors?: unknown) {
    super(`Discord API Error: ${message}`)
    this.name = 'DiscordError'
    this.code = code
    this.status = status
    this.errors = errors
  }
}

// ============================================================================
// REST CLIENT
// ============================================================================

/**
 * Discord REST API Client
 */
export class REST {
  private _token?: string
  private baseUrl: string
  private version: string
  private timeout: number
  private retries: number
  private _customFetch?: typeof fetch

  constructor(options: RESTOptions = {}) {
    this.version = options.version ?? '10'
    this.baseUrl = options.api ?? 'https://discord.com/api'
    this.timeout = options.timeout ?? 30000
    this.retries = options.retries ?? 3
  }

  /**
   * Set the bot token
   */
  setToken(token: string): this {
    this._token = token
    return this
  }

  /**
   * Get the fetch function to use
   */
  private get _fetch(): typeof fetch {
    return this._customFetch ?? globalThis.fetch
  }

  /**
   * Make a GET request
   */
  async get<T = unknown>(route: string, options?: RequestOptions): Promise<T> {
    return this._request<T>('GET', route, options)
  }

  /**
   * Make a POST request
   */
  async post<T = unknown>(route: string, options?: RequestOptions): Promise<T> {
    return this._request<T>('POST', route, options)
  }

  /**
   * Make a PUT request
   */
  async put<T = unknown>(route: string, options?: RequestOptions): Promise<T> {
    return this._request<T>('PUT', route, options)
  }

  /**
   * Make a PATCH request
   */
  async patch<T = unknown>(route: string, options?: RequestOptions): Promise<T> {
    return this._request<T>('PATCH', route, options)
  }

  /**
   * Make a DELETE request
   */
  async delete<T = unknown>(route: string, options?: RequestOptions): Promise<T> {
    return this._request<T>('DELETE', route, options)
  }

  /**
   * Make an API request with retries and rate limit handling
   */
  private async _request<T>(
    method: string,
    route: string,
    options: RequestOptions = {}
  ): Promise<T> {
    let lastError: Error | undefined
    let attempts = 0

    while (attempts <= this.retries) {
      try {
        return await this._executeRequest<T>(method, route, options)
      } catch (error) {
        lastError = error as Error

        // Handle rate limiting
        if (
          error instanceof DiscordError &&
          error.status === 429 &&
          attempts < this.retries
        ) {
          const retryAfter = (error.errors as { retry_after?: number })?.retry_after ?? 1
          await this._sleep(retryAfter * 1000)
          attempts++
          continue
        }

        throw error
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  /**
   * Execute a single API request
   */
  private async _executeRequest<T>(
    method: string,
    route: string,
    options: RequestOptions
  ): Promise<T> {
    // Build URL
    let url = `${this.baseUrl}/v${this.version}${route}`

    // Add query parameters
    if (options.query) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value))
        }
      }
      const queryString = params.toString()
      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      ...options.headers,
    }

    // Add authorization if token is set and route doesn't include webhook token
    if (this._token && !route.includes('/webhooks/') || (this._token && route.includes('/webhooks/') && !route.match(/\/webhooks\/\d+\/[^/]+/))) {
      headers['Authorization'] = `Bot ${this._token}`
    }

    // Add audit log reason if provided
    if (options.reason) {
      headers['X-Audit-Log-Reason'] = encodeURIComponent(options.reason)
    }

    // Build body
    let body: string | undefined
    if (options.body !== undefined && method !== 'GET') {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }

    // Setup timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await this._fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      })

      // Handle empty responses
      if (response.status === 204) {
        return {} as T
      }

      const data = await response.json() as Record<string, unknown>

      // Check for errors
      if (!response.ok) {
        throw new DiscordError(
          (data.code as number) ?? 0,
          (data.message as string) ?? 'Unknown error',
          response.status,
          data
        )
      }

      return data as T
    } catch (error) {
      if (error instanceof DiscordError) {
        throw error
      }

      if ((error as Error).name === 'AbortError') {
        throw new Error(`Request timed out after ${this.timeout}ms`)
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Sleep helper
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * Discord API Routes builder
 */
export const Routes = {
  // Users
  user: (userId: string) => `/users/${userId}`,
  userMe: () => '/users/@me',

  // Channels
  channel: (channelId: string) => `/channels/${channelId}`,
  channelMessages: (channelId: string) => `/channels/${channelId}/messages`,
  channelMessage: (channelId: string, messageId: string) =>
    `/channels/${channelId}/messages/${messageId}`,
  channelBulkDelete: (channelId: string) =>
    `/channels/${channelId}/messages/bulk-delete`,
  channelPermission: (channelId: string, overwriteId: string) =>
    `/channels/${channelId}/permissions/${overwriteId}`,
  channelWebhooks: (channelId: string) => `/channels/${channelId}/webhooks`,

  // Reactions
  channelMessageReaction: (channelId: string, messageId: string, emoji: string) =>
    `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
  channelMessageReactions: (channelId: string, messageId: string, emoji: string) =>
    `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
  channelMessageAllReactions: (channelId: string, messageId: string) =>
    `/channels/${channelId}/messages/${messageId}/reactions`,

  // Threads
  threads: (channelId: string, messageId: string) =>
    `/channels/${channelId}/messages/${messageId}/threads`,
  threadMembers: (channelId: string, userId: string) =>
    `/channels/${channelId}/thread-members/${userId}`,

  // Guilds
  guild: (guildId: string) => `/guilds/${guildId}`,
  guildChannels: (guildId: string) => `/guilds/${guildId}/channels`,
  guildMembers: (guildId: string) => `/guilds/${guildId}/members`,
  guildMember: (guildId: string, userId: string) =>
    `/guilds/${guildId}/members/${userId}`,
  guildMemberRole: (guildId: string, userId: string, roleId: string) =>
    `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
  guildRoles: (guildId: string) => `/guilds/${guildId}/roles`,
  guildRole: (guildId: string, roleId: string) =>
    `/guilds/${guildId}/roles/${roleId}`,

  // Applications / Commands
  applicationCommands: (applicationId: string) =>
    `/applications/${applicationId}/commands`,
  applicationCommand: (applicationId: string, commandId: string) =>
    `/applications/${applicationId}/commands/${commandId}`,
  applicationGuildCommands: (applicationId: string, guildId: string) =>
    `/applications/${applicationId}/guilds/${guildId}/commands`,
  applicationGuildCommand: (applicationId: string, guildId: string, commandId: string) =>
    `/applications/${applicationId}/guilds/${guildId}/commands/${commandId}`,

  // Interactions
  interactionCallback: (interactionId: string, interactionToken: string) =>
    `/interactions/${interactionId}/${interactionToken}/callback`,

  // Webhooks
  webhook: (webhookId: string) => `/webhooks/${webhookId}`,
  webhookWithToken: (webhookId: string, webhookToken: string) =>
    `/webhooks/${webhookId}/${webhookToken}`,
  webhookMessage: (webhookId: string, webhookToken: string, messageId: string) =>
    `/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`,
}
