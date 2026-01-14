/**
 * RotationManager - Automatic credential rotation with configurable schedules
 *
 * Provides credential rotation with:
 * - Manual rotation with version tracking
 * - Scheduled rotation with configurable intervals
 * - OAuth2 token auto-refresh
 * - Pre/post rotation hooks
 * - Concurrent refresh locking
 *
 * @module db/primitives/credentials/rotation
 */

import { EventEmitter } from 'events'
import { SecureVault } from './vault'

// =============================================================================
// Types
// =============================================================================

export type RotationPolicy = 'manual' | 'auto' | 'scheduled'

export interface RotationConfig {
  vault: SecureVault
  onPreRotate?: (info: PreRotateInfo) => Promise<void>
  onPostRotate?: (info: PostRotateInfo) => Promise<void>
}

export interface CredentialRotationOptions {
  policy: RotationPolicy
  schedule?: string // e.g., '30d', '7d', '1h'
  nextRotation?: Date
}

export interface OAuthCredentialOptions {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  refreshEndpoint: string
  clientId: string
  clientSecret: string
  refreshBeforeExpiry?: number // milliseconds
  maxRetries?: number
  tokenType?: string
  scope?: string
}

export interface OAuth2Token {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  tokenType?: string
  scope?: string
}

export interface CredentialInfo {
  name: string
  version: number
  policy: RotationPolicy
  nextRotation?: Date
  lastRotated?: Date
  createdAt: Date
}

export interface RotationHistoryEntry {
  timestamp: Date
  previousVersion: number
  newVersion: number
  actor?: string
  reason?: string
}

export interface PreRotateInfo {
  name: string
  previousValue: string
  newValue: string
  version: number
}

export interface PostRotateInfo {
  name: string
  version: number
  timestamp: Date
}

export interface GetOAuthOptions {
  autoRefresh?: boolean
}

// =============================================================================
// Duration Parser
// =============================================================================

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  return value * multipliers[unit]!
}

// =============================================================================
// RotationManager Implementation
// =============================================================================

interface InternalCredential {
  name: string
  policy: RotationPolicy
  schedule?: string
  nextRotation?: Date
  lastRotated?: Date
  createdAt: Date
  history: RotationHistoryEntry[]
  oauthConfig?: OAuthCredentialOptions
}

export class RotationManager extends EventEmitter {
  private vault: SecureVault
  private credentials: Map<string, InternalCredential> = new Map()
  private refreshLocks: Map<string, Promise<void>> = new Map()
  private onPreRotate?: (info: PreRotateInfo) => Promise<void>
  private onPostRotate?: (info: PostRotateInfo) => Promise<void>

  constructor(config: RotationConfig) {
    super()
    this.vault = config.vault
    this.onPreRotate = config.onPreRotate
    this.onPostRotate = config.onPostRotate
  }

  /**
   * Register a credential for rotation management
   */
  async registerCredential(name: string, initialValue: string, options: CredentialRotationOptions): Promise<void> {
    await this.vault.storeSecret(name, initialValue)

    const now = new Date()
    let nextRotation: Date | undefined

    if (options.nextRotation) {
      nextRotation = options.nextRotation
    } else if (options.policy === 'scheduled' && options.schedule) {
      const ms = parseDuration(options.schedule)
      nextRotation = new Date(Date.now() + ms)
    }

    this.credentials.set(name, {
      name,
      policy: options.policy,
      schedule: options.schedule,
      nextRotation,
      createdAt: now,
      history: [],
    })
  }

  /**
   * Register an OAuth2 credential
   */
  async registerOAuthCredential(name: string, options: OAuthCredentialOptions): Promise<void> {
    const token: OAuth2Token = {
      accessToken: options.accessToken,
      refreshToken: options.refreshToken,
      expiresAt: options.expiresAt,
      tokenType: options.tokenType,
      scope: options.scope,
    }

    await this.vault.storeSecret(name, JSON.stringify(token))

    this.credentials.set(name, {
      name,
      policy: 'auto',
      createdAt: new Date(),
      history: [],
      oauthConfig: options,
    })
  }

  /**
   * Rotate a credential with a new value
   */
  async rotate(name: string, newValue: string, options?: { actor?: string; reason?: string }): Promise<void> {
    const cred = this.credentials.get(name)
    if (!cred) {
      throw new Error(`Credential '${name}' not found`)
    }

    // Get current value and version
    const current = await this.vault.getSecret(name)
    if (!current) {
      throw new Error(`Credential '${name}' not found in vault`)
    }

    const previousVersion = current.version

    // Pre-rotate hook
    if (this.onPreRotate) {
      await this.onPreRotate({
        name,
        previousValue: current.value,
        newValue,
        version: previousVersion,
      })
    }

    // Store new version
    await this.vault.storeSecret(name, newValue)

    // Update credential metadata
    const now = new Date()
    cred.lastRotated = now

    // Update next rotation for scheduled credentials
    if (cred.policy === 'scheduled' && cred.schedule) {
      const ms = parseDuration(cred.schedule)
      cred.nextRotation = new Date(Date.now() + ms)
    }

    // Record in history
    cred.history.push({
      timestamp: now,
      previousVersion,
      newVersion: previousVersion + 1,
      actor: options?.actor,
      reason: options?.reason,
    })

    // Post-rotate hook
    if (this.onPostRotate) {
      await this.onPostRotate({
        name,
        version: previousVersion + 1,
        timestamp: now,
      })
    }

    this.emit('rotated', { name, version: previousVersion + 1 })
  }

  /**
   * Get the current value of a credential
   */
  async getCurrentValue(name: string): Promise<string | null> {
    const secret = await this.vault.getSecret(name)
    return secret?.value ?? null
  }

  /**
   * Get credential info
   */
  async getCredentialInfo(name: string): Promise<CredentialInfo | null> {
    const cred = this.credentials.get(name)
    if (!cred) {
      return null
    }

    const secret = await this.vault.getSecret(name)
    if (!secret) {
      return null
    }

    return {
      name: cred.name,
      version: secret.version,
      policy: cred.policy,
      nextRotation: cred.nextRotation,
      lastRotated: cred.lastRotated,
      createdAt: cred.createdAt,
    }
  }

  /**
   * Get rotation history
   */
  async getRotationHistory(name: string): Promise<RotationHistoryEntry[]> {
    const cred = this.credentials.get(name)
    if (!cred) {
      return []
    }
    return [...cred.history]
  }

  /**
   * List credentials due for rotation
   */
  async listDueForRotation(): Promise<CredentialInfo[]> {
    const now = Date.now()
    const due: CredentialInfo[] = []

    for (const cred of this.credentials.values()) {
      if (cred.nextRotation && cred.nextRotation.getTime() <= now) {
        const secret = await this.vault.getSecret(cred.name)
        if (secret) {
          due.push({
            name: cred.name,
            version: secret.version,
            policy: cred.policy,
            nextRotation: cred.nextRotation,
            lastRotated: cred.lastRotated,
            createdAt: cred.createdAt,
          })
        }
      }
    }

    return due
  }

  /**
   * Get OAuth token with optional auto-refresh
   */
  async getOAuthToken(name: string, options?: GetOAuthOptions): Promise<OAuth2Token | null> {
    const cred = this.credentials.get(name)
    if (!cred || !cred.oauthConfig) {
      throw new Error(`OAuth credential '${name}' not found`)
    }

    const secret = await this.vault.getSecret(name)
    if (!secret) {
      return null
    }

    const token: OAuth2Token = JSON.parse(secret.value)

    // Check if refresh is needed
    if (options?.autoRefresh && token.expiresAt) {
      const refreshBeforeExpiry = cred.oauthConfig.refreshBeforeExpiry ?? 300000 // 5 minutes
      const shouldRefresh = new Date(token.expiresAt).getTime() <= Date.now() + refreshBeforeExpiry

      if (shouldRefresh && token.refreshToken) {
        await this.refreshOAuthToken(name, cred, token)
        // Return updated token
        const refreshed = await this.vault.getSecret(name)
        return refreshed ? JSON.parse(refreshed.value) : null
      }
    }

    return token
  }

  /**
   * Refresh OAuth token with locking to prevent concurrent refreshes
   */
  private async refreshOAuthToken(name: string, cred: InternalCredential, token: OAuth2Token): Promise<void> {
    // Check for existing lock
    let lockPromise = this.refreshLocks.get(name)
    if (lockPromise) {
      await lockPromise
      return
    }

    // Create lock
    const refreshPromise = this.performOAuthRefresh(name, cred, token)
    this.refreshLocks.set(name, refreshPromise)

    try {
      await refreshPromise
    } finally {
      this.refreshLocks.delete(name)
    }
  }

  /**
   * Perform the actual OAuth refresh
   */
  private async performOAuthRefresh(name: string, cred: InternalCredential, token: OAuth2Token): Promise<void> {
    const config = cred.oauthConfig!
    const maxRetries = config.maxRetries ?? 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(config.refreshEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: token.refreshToken!,
            client_id: config.clientId,
            client_secret: config.clientSecret,
          }),
        })

        if (!response.ok) {
          throw new Error(`Token refresh failed: ${response.status}`)
        }

        const data = (await response.json()) as {
          access_token: string
          refresh_token?: string
          expires_in?: number
          token_type?: string
          scope?: string
        }

        const newToken: OAuth2Token = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? token.refreshToken,
          expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
          tokenType: data.token_type ?? token.tokenType,
          scope: data.scope ?? token.scope,
        }

        // Store updated token
        await this.vault.storeSecret(name, JSON.stringify(newToken))

        this.emit('refreshed', { name, previousExpiry: token.expiresAt, newExpiry: newToken.expiresAt })

        return
      } catch (error) {
        lastError = error as Error
        // Wait before retry (exponential backoff)
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100))
        }
      }
    }

    this.emit('refresh:failed', { name, error: lastError })
    throw lastError
  }
}

/**
 * Factory function to create a RotationManager instance
 */
export function createRotationManager(config: RotationConfig): RotationManager {
  return new RotationManager(config)
}
