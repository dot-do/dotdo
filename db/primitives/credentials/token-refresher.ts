/**
 * TokenRefresher - OAuth2 token refresh with DO alarm scheduling
 *
 * Provides automatic OAuth2 token refresh with:
 * - Proactive refresh 5 minutes before expiry
 * - DO alarm-based scheduling for refresh
 * - Refresh token rotation handling
 * - Exponential backoff retry on failures
 * - Event emission via $.on.Credential.refreshed
 *
 * @module db/primitives/credentials/token-refresher
 */

import { EventEmitter } from 'events'
import type { DOAlarmAdapter } from '../../../objects/primitives/alarm-adapter'

// =============================================================================
// Types
// =============================================================================

export interface OAuth2TokenData {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  tokenType?: string
  scope?: string
}

export interface TokenRefreshConfig {
  /** Token endpoint for refresh requests */
  refreshEndpoint: string
  /** OAuth2 client ID */
  clientId: string
  /** OAuth2 client secret */
  clientSecret: string
  /** Time before expiry to trigger refresh (default: 5 minutes) */
  refreshBeforeExpiry?: number
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number
  /** Base delay for exponential backoff in ms (default: 100) */
  baseRetryDelay?: number
  /** Additional scopes to request on refresh */
  scope?: string
}

export interface TokenRefresherOptions {
  /** Optional DO alarm adapter for scheduled refresh */
  alarmAdapter?: DOAlarmAdapter
  /** Optional storage interface for persisting tokens */
  storage?: TokenStorage
  /** Event emitter for $.on.Credential.refreshed events */
  eventEmitter?: TokenEventEmitter
}

export interface TokenStorage {
  get(key: string): Promise<OAuth2TokenData | null>
  set(key: string, token: OAuth2TokenData): Promise<void>
  delete(key: string): Promise<void>
}

export interface TokenEventEmitter {
  emit(event: string, payload: unknown): void
}

export interface RefreshResult {
  accessToken: string
  refreshToken?: string
  expiresAt: Date
  tokenType?: string
  scope?: string
  rotated: boolean
}

export interface TokenRefreshEvent {
  name: string
  previousExpiry?: Date
  newExpiry: Date
  rotated: boolean
}

export interface TokenRefreshFailedEvent {
  name: string
  error: Error
  attempts: number
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_REFRESH_BEFORE_EXPIRY = 5 * 60 * 1000 // 5 minutes
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_RETRY_DELAY = 100 // ms

// =============================================================================
// TokenRefresher Implementation
// =============================================================================

interface TrackedToken {
  name: string
  token: OAuth2TokenData
  config: TokenRefreshConfig
  nextRefreshAt?: Date
}

/**
 * TokenRefresher class for managing OAuth2 token lifecycle
 *
 * Features:
 * - Automatic refresh scheduling using DO alarms
 * - Concurrent refresh prevention via locking
 * - Exponential backoff retry on transient failures
 * - Event emission for monitoring and audit
 */
export class TokenRefresher extends EventEmitter {
  private tokens: Map<string, TrackedToken> = new Map()
  private refreshLocks: Map<string, Promise<RefreshResult>> = new Map()
  private alarmAdapter?: DOAlarmAdapter
  private storage?: TokenStorage
  private eventEmitter?: TokenEventEmitter

  constructor(options?: TokenRefresherOptions) {
    super()
    this.alarmAdapter = options?.alarmAdapter
    this.storage = options?.storage
    this.eventEmitter = options?.eventEmitter

    // Register alarm callback if adapter provided
    if (this.alarmAdapter) {
      this.alarmAdapter.onAlarm('token-refresh', () => this.handleAlarm())
    }
  }

  /**
   * Register a token for automatic refresh
   */
  async register(name: string, token: OAuth2TokenData, config: TokenRefreshConfig): Promise<void> {
    const refreshBeforeExpiry = config.refreshBeforeExpiry ?? DEFAULT_REFRESH_BEFORE_EXPIRY

    // Calculate next refresh time
    let nextRefreshAt: Date | undefined
    if (token.expiresAt) {
      const expiresAtMs = token.expiresAt instanceof Date ? token.expiresAt.getTime() : new Date(token.expiresAt).getTime()
      nextRefreshAt = new Date(expiresAtMs - refreshBeforeExpiry)
    }

    const tracked: TrackedToken = {
      name,
      token: {
        ...token,
        expiresAt: token.expiresAt instanceof Date ? token.expiresAt : token.expiresAt ? new Date(token.expiresAt) : undefined,
      },
      config,
      nextRefreshAt,
    }

    this.tokens.set(name, tracked)

    // Persist to storage if available
    if (this.storage) {
      await this.storage.set(name, tracked.token)
    }

    // Schedule alarm for refresh if adapter available and token has expiry
    if (this.alarmAdapter && nextRefreshAt) {
      await this.scheduleRefresh(name, nextRefreshAt)
    }
  }

  /**
   * Get a token, optionally triggering auto-refresh if needed
   */
  async getToken(name: string, options?: { autoRefresh?: boolean }): Promise<OAuth2TokenData | null> {
    const tracked = this.tokens.get(name)
    if (!tracked) {
      // Try loading from storage
      if (this.storage) {
        const stored = await this.storage.get(name)
        if (stored) {
          return stored
        }
      }
      return null
    }

    // Check if refresh is needed
    if (options?.autoRefresh && this.shouldRefresh(tracked)) {
      try {
        const result = await this.refresh(name)
        return {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt,
          tokenType: result.tokenType,
          scope: result.scope,
        }
      } catch {
        // Return existing token if refresh fails
        return tracked.token
      }
    }

    return tracked.token
  }

  /**
   * Manually trigger a token refresh
   */
  async refresh(name: string): Promise<RefreshResult> {
    const tracked = this.tokens.get(name)
    if (!tracked) {
      throw new Error(`Token '${name}' not registered`)
    }

    // Check for existing refresh in progress (lock)
    const existingLock = this.refreshLocks.get(name)
    if (existingLock) {
      return existingLock
    }

    // Create refresh promise and store as lock
    const refreshPromise = this.performRefresh(name, tracked)
    this.refreshLocks.set(name, refreshPromise)

    try {
      return await refreshPromise
    } finally {
      this.refreshLocks.delete(name)
    }
  }

  /**
   * Unregister a token
   */
  async unregister(name: string): Promise<void> {
    this.tokens.delete(name)
    if (this.storage) {
      await this.storage.delete(name)
    }
  }

  /**
   * Get token info without the actual token values
   */
  getTokenInfo(name: string): { expiresAt?: Date; nextRefreshAt?: Date } | null {
    const tracked = this.tokens.get(name)
    if (!tracked) return null
    return {
      expiresAt: tracked.token.expiresAt,
      nextRefreshAt: tracked.nextRefreshAt,
    }
  }

  /**
   * List all registered token names
   */
  listTokens(): string[] {
    return Array.from(this.tokens.keys())
  }

  /**
   * Check if a token needs refresh
   */
  private shouldRefresh(tracked: TrackedToken): boolean {
    if (!tracked.token.expiresAt) return false
    if (!tracked.token.refreshToken) return false

    const refreshBeforeExpiry = tracked.config.refreshBeforeExpiry ?? DEFAULT_REFRESH_BEFORE_EXPIRY
    const expiresAtMs = tracked.token.expiresAt.getTime()
    return expiresAtMs <= Date.now() + refreshBeforeExpiry
  }

  /**
   * Perform the actual OAuth2 token refresh with retries
   */
  private async performRefresh(name: string, tracked: TrackedToken): Promise<RefreshResult> {
    const config = tracked.config
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
    const baseDelay = config.baseRetryDelay ?? DEFAULT_BASE_RETRY_DELAY
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(config.refreshEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tracked.token.refreshToken!,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            ...(config.scope ? { scope: config.scope } : {}),
          }),
        })

        if (!response.ok) {
          throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`)
        }

        const data = (await response.json()) as {
          access_token: string
          refresh_token?: string
          expires_in?: number
          token_type?: string
          scope?: string
        }

        const previousExpiry = tracked.token.expiresAt
        const rotated = data.refresh_token !== undefined && data.refresh_token !== tracked.token.refreshToken

        // Update token
        const newToken: OAuth2TokenData = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? tracked.token.refreshToken,
          expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
          tokenType: data.token_type ?? tracked.token.tokenType,
          scope: data.scope ?? tracked.token.scope,
        }

        tracked.token = newToken

        // Calculate and update next refresh time
        const refreshBeforeExpiry = config.refreshBeforeExpiry ?? DEFAULT_REFRESH_BEFORE_EXPIRY
        tracked.nextRefreshAt = new Date(newToken.expiresAt!.getTime() - refreshBeforeExpiry)

        // Persist to storage
        if (this.storage) {
          await this.storage.set(name, newToken)
        }

        // Schedule next refresh
        if (this.alarmAdapter && tracked.nextRefreshAt) {
          await this.scheduleRefresh(name, tracked.nextRefreshAt)
        }

        // Emit events
        const refreshEvent: TokenRefreshEvent = {
          name,
          previousExpiry,
          newExpiry: newToken.expiresAt!,
          rotated,
        }

        this.emit('refreshed', refreshEvent)
        this.emit('credential:refreshed', refreshEvent)

        // Emit via external event emitter ($.on.Credential.refreshed pattern)
        if (this.eventEmitter) {
          this.eventEmitter.emit('Credential.refreshed', refreshEvent)
        }

        return {
          accessToken: newToken.accessToken,
          refreshToken: newToken.refreshToken,
          expiresAt: newToken.expiresAt!,
          tokenType: newToken.tokenType,
          scope: newToken.scope,
          rotated,
        }
      } catch (error) {
        lastError = error as Error

        // Wait before retry with exponential backoff
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }

    // All retries failed
    const failedEvent: TokenRefreshFailedEvent = {
      name,
      error: lastError!,
      attempts: maxRetries,
    }

    this.emit('refresh:failed', failedEvent)
    this.emit('credential:refresh_failed', failedEvent)

    if (this.eventEmitter) {
      this.eventEmitter.emit('Credential.refresh_failed', failedEvent)
    }

    throw lastError
  }

  /**
   * Schedule a refresh using DO alarm
   */
  private async scheduleRefresh(name: string, refreshAt: Date): Promise<void> {
    if (!this.alarmAdapter) return

    const timestamp = refreshAt.getTime()

    // Only schedule if in the future
    if (timestamp > Date.now()) {
      await this.alarmAdapter.scheduleAt(timestamp, {
        type: 'token-refresh',
        tokenName: name,
      })
    }
  }

  /**
   * Handle DO alarm trigger
   */
  async handleAlarm(): Promise<void> {
    const now = Date.now()

    // Find all tokens due for refresh
    const dueForRefresh: string[] = []
    for (const [name, tracked] of this.tokens) {
      if (tracked.nextRefreshAt && tracked.nextRefreshAt.getTime() <= now) {
        dueForRefresh.push(name)
      }
    }

    // Refresh all due tokens
    const refreshPromises = dueForRefresh.map(async (name) => {
      try {
        await this.refresh(name)
      } catch (error) {
        console.error(`[TokenRefresher] Failed to refresh token '${name}':`, error)
      }
    })

    await Promise.allSettled(refreshPromises)

    // Schedule next alarm for earliest remaining refresh
    let earliestNext: number | null = null
    for (const tracked of this.tokens.values()) {
      if (tracked.nextRefreshAt && tracked.nextRefreshAt.getTime() > now) {
        if (earliestNext === null || tracked.nextRefreshAt.getTime() < earliestNext) {
          earliestNext = tracked.nextRefreshAt.getTime()
        }
      }
    }

    if (earliestNext !== null && this.alarmAdapter) {
      await this.alarmAdapter.scheduleAt(earliestNext, { type: 'token-refresh' })
    }
  }
}

/**
 * Factory function to create a TokenRefresher instance
 */
export function createTokenRefresher(options?: TokenRefresherOptions): TokenRefresher {
  return new TokenRefresher(options)
}
