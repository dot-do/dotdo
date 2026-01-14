/**
 * AccessManager - Access policies for credential vault
 *
 * Provides access control with:
 * - Scoped access tokens
 * - Permission levels (read, write, admin)
 * - Hierarchical scopes with wildcard matching
 * - Access policies (IP whitelist, time-based, rate limiting)
 * - Token lifecycle management
 *
 * @module db/primitives/credentials/access
 */

import { SecureVault } from './vault'

// =============================================================================
// Types
// =============================================================================

export type Permission = 'read' | 'write' | 'admin'

export interface AccessConfig {
  vault: SecureVault
}

export interface AccessPolicy {
  allowedIPs?: string[]
  allowedHours?: { start: number; end: number }
  rateLimit?: { maxRequests: number; windowMs: number }
}

export interface AccessTokenOptions {
  credentials?: string[]
  scopes?: string[]
  permissions: Permission[]
  expiresIn: string
  policy?: AccessPolicy
}

export interface AccessToken {
  id: string
  token: string
  credentials: string[]
  scopes?: string[]
  permissions: Permission[]
  expiresAt: Date
  createdAt: Date
  revokedAt?: Date
  policy?: AccessPolicy
}

export interface AccessContext {
  ipAddress?: string
  userAgent?: string
  requestId?: string
}

export interface GetWithTokenOptions {
  context?: AccessContext
}

export interface ListTokensOptions {
  includeRevoked?: boolean
}

export interface CredentialStoreOptions {
  scope?: string
}

// =============================================================================
// Utilities
// =============================================================================

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function generateId(): string {
  return crypto.randomUUID()
}

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

function matchWildcard(pattern: string, value: string): boolean {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1)
    return value.startsWith(prefix)
  }
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    return regex.test(value)
  }
  return pattern === value
}

function isIPInRange(ip: string, range: string): boolean {
  if (range.includes('/')) {
    // CIDR notation - simplified check for common cases
    const [rangeIP, bits] = range.split('/')
    const rangeParts = rangeIP!.split('.').map(Number)
    const ipParts = ip.split('.').map(Number)
    const mask = parseInt(bits!, 10)

    if (mask === 24) {
      return rangeParts[0] === ipParts[0] && rangeParts[1] === ipParts[1] && rangeParts[2] === ipParts[2]
    }
    if (mask === 16) {
      return rangeParts[0] === ipParts[0] && rangeParts[1] === ipParts[1]
    }
    if (mask === 8) {
      return rangeParts[0] === ipParts[0]
    }
  }
  return ip === range
}

// =============================================================================
// AccessManager Implementation
// =============================================================================

interface CredentialMetadata {
  name: string
  scope?: string
}

interface RateLimitEntry {
  count: number
  windowStart: number
}

export class AccessManager {
  private vault: SecureVault
  private tokens: Map<string, AccessToken> = new Map()
  private credentialMetadata: Map<string, CredentialMetadata> = new Map()
  private rateLimits: Map<string, RateLimitEntry> = new Map()

  constructor(config: AccessConfig) {
    this.vault = config.vault
  }

  /**
   * Store a credential with optional metadata
   */
  async storeCredential(name: string, value: string, options?: CredentialStoreOptions): Promise<void> {
    await this.vault.storeSecret(name, value)
    this.credentialMetadata.set(name, {
      name,
      scope: options?.scope,
    })
  }

  /**
   * Create a scoped access token
   */
  async createAccessToken(options: AccessTokenOptions): Promise<AccessToken> {
    const token: AccessToken = {
      id: generateId(),
      token: generateToken(),
      credentials: options.credentials ?? [],
      scopes: options.scopes,
      permissions: options.permissions,
      expiresAt: new Date(Date.now() + parseDuration(options.expiresIn)),
      createdAt: new Date(),
      policy: options.policy,
    }

    this.tokens.set(token.token, token)

    return token
  }

  /**
   * Get credential value using an access token
   */
  async getWithToken(tokenStr: string, credentialName: string, options?: GetWithTokenOptions): Promise<string> {
    const token = this.tokens.get(tokenStr)

    // Validate token
    if (!token) {
      throw new Error('Invalid access token')
    }

    if (token.revokedAt) {
      throw new Error('Access token has been revoked')
    }

    if (token.expiresAt.getTime() < Date.now()) {
      throw new Error('Access token has expired')
    }

    // Check permissions
    if (!token.permissions.includes('read') && !token.permissions.includes('admin')) {
      throw new Error('Access denied: read permission required')
    }

    // Check credential scope
    await this.validateCredentialAccess(token, credentialName)

    // Apply policies
    await this.applyPolicies(token, options?.context)

    // Get credential value
    const secret = await this.vault.getSecret(credentialName)
    if (!secret) {
      throw new Error(`Credential '${credentialName}' not found`)
    }

    return secret.value
  }

  /**
   * Rotate credential using an access token
   */
  async rotateWithToken(tokenStr: string, credentialName: string, newValue: string): Promise<void> {
    const token = this.tokens.get(tokenStr)

    // Validate token
    if (!token) {
      throw new Error('Invalid access token')
    }

    if (token.revokedAt) {
      throw new Error('Access token has been revoked')
    }

    if (token.expiresAt.getTime() < Date.now()) {
      throw new Error('Access token has expired')
    }

    // Check permissions
    if (!token.permissions.includes('write') && !token.permissions.includes('admin')) {
      throw new Error('Access denied: write permission required')
    }

    // Check credential scope
    await this.validateCredentialAccess(token, credentialName)

    // Rotate credential
    await this.vault.storeSecret(credentialName, newValue)
  }

  /**
   * Delete credential using an access token
   */
  async deleteWithToken(tokenStr: string, credentialName: string): Promise<void> {
    const token = this.tokens.get(tokenStr)

    // Validate token
    if (!token) {
      throw new Error('Invalid access token')
    }

    if (token.revokedAt) {
      throw new Error('Access token has been revoked')
    }

    if (token.expiresAt.getTime() < Date.now()) {
      throw new Error('Access token has expired')
    }

    // Check permissions - only admin can delete
    if (!token.permissions.includes('admin')) {
      throw new Error('Access denied: admin permission required')
    }

    // Check credential scope
    await this.validateCredentialAccess(token, credentialName)

    // Delete credential
    await this.vault.deleteSecret(credentialName)
    this.credentialMetadata.delete(credentialName)
  }

  /**
   * Validate that the token has access to the credential
   */
  private async validateCredentialAccess(token: AccessToken, credentialName: string): Promise<void> {
    const metadata = this.credentialMetadata.get(credentialName)

    // Check explicit credential list
    if (token.credentials.length > 0) {
      if (!token.credentials.includes(credentialName)) {
        throw new Error('Access denied: credential not in token scope')
      }
      return
    }

    // Check scope-based access
    if (token.scopes && token.scopes.length > 0) {
      if (!metadata?.scope) {
        throw new Error('Access denied: credential has no scope')
      }

      const hasMatchingScope = token.scopes.some((s) => matchWildcard(s, metadata.scope!))
      if (!hasMatchingScope) {
        throw new Error('Access denied: scope mismatch')
      }
    }
  }

  /**
   * Apply access policies
   */
  private async applyPolicies(token: AccessToken, context?: AccessContext): Promise<void> {
    const policy = token.policy
    if (!policy) {
      return
    }

    // IP whitelist
    if (policy.allowedIPs && context?.ipAddress) {
      const isAllowed = policy.allowedIPs.some((range) => isIPInRange(context.ipAddress!, range))
      if (!isAllowed) {
        throw new Error('Access denied: IP not allowed')
      }
    }

    // Time-based access
    if (policy.allowedHours) {
      const now = new Date()
      const currentHour = now.getUTCHours()
      if (currentHour < policy.allowedHours.start || currentHour >= policy.allowedHours.end) {
        throw new Error('Access denied: outside allowed hours')
      }
    }

    // Rate limiting
    if (policy.rateLimit) {
      const key = token.id
      const now = Date.now()
      let entry = this.rateLimits.get(key)

      if (!entry || now - entry.windowStart >= policy.rateLimit.windowMs) {
        // New window
        entry = { count: 1, windowStart: now }
        this.rateLimits.set(key, entry)
      } else {
        entry.count++
        if (entry.count > policy.rateLimit.maxRequests) {
          throw new Error('Rate limit exceeded')
        }
      }
    }
  }

  /**
   * Revoke an access token
   */
  async revokeAccessToken(id: string): Promise<void> {
    for (const token of this.tokens.values()) {
      if (token.id === id) {
        token.revokedAt = new Date()
        return
      }
    }
    throw new Error('Access token not found')
  }

  /**
   * Revoke all tokens for a credential
   */
  async revokeTokensForCredential(credentialName: string): Promise<void> {
    for (const token of this.tokens.values()) {
      if (token.credentials.includes(credentialName)) {
        token.revokedAt = new Date()
      }
    }
  }

  /**
   * List all access tokens
   */
  async listAccessTokens(options?: ListTokensOptions): Promise<AccessToken[]> {
    const tokens: AccessToken[] = []

    for (const token of this.tokens.values()) {
      if (!options?.includeRevoked && token.revokedAt) {
        continue
      }
      tokens.push(token)
    }

    return tokens
  }
}

/**
 * Factory function to create an AccessManager instance
 */
export function createAccessManager(config: AccessConfig): AccessManager {
  return new AccessManager(config)
}
