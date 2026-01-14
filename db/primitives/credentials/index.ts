/**
 * CredentialVault - Secure credential storage and rotation
 *
 * A comprehensive credential management primitive with:
 * - AES-256-GCM encryption at rest
 * - Secret versioning with rollback
 * - Automatic rotation with configurable schedules
 * - Access policies (who can read/write what)
 * - Audit logging with TemporalStore
 * - Secret references (never expose raw values)
 *
 * @example
 * ```typescript
 * import { CredentialVault, createCredentialVault } from './credentials'
 *
 * const vault = createCredentialVault({
 *   encryptionKey: process.env.VAULT_KEY, // Must be 32 bytes
 * })
 *
 * // Store an API key
 * await vault.store({
 *   name: 'stripe-api-key',
 *   type: 'api_key',
 *   value: 'sk_live_xxx',
 *   metadata: { environment: 'production' },
 * })
 *
 * // Retrieve (decrypted)
 * const cred = await vault.get('stripe-api-key')
 * console.log(cred?.value) // 'sk_live_xxx'
 *
 * // OAuth2 with auto-refresh
 * await vault.store({
 *   name: 'google-oauth',
 *   type: 'oauth2',
 *   value: { accessToken: 'ya29.xxx', refreshToken: '1//xxx', expiresAt: new Date() },
 *   rotation: {
 *     policy: 'auto',
 *     refreshEndpoint: 'https://oauth2.googleapis.com/token',
 *     clientId: '...',
 *     clientSecret: '...',
 *   },
 * })
 *
 * // Scoped access tokens
 * const { token } = await vault.createAccessToken({
 *   credentials: ['stripe-api-key'],
 *   permissions: ['read'],
 *   expiresIn: '1h',
 * })
 * ```
 *
 * @module db/primitives/credentials
 */

import { EventEmitter } from 'events'
import { SecureVault, createSecureVault, type VaultConfig } from './vault'
import { RotationManager, createRotationManager } from './rotation'
import { AccessManager, createAccessManager, type AccessTokenOptions, type AccessToken, type Permission, type AccessPolicy, type AccessContext } from './access'
import { AuditLogger, createAuditLogger, type AuditAction, type AuditLogEntry, type AuditContext } from './audit'

// Re-export module types
export * from './vault'
export * from './rotation'
export * from './access'
export * from './audit'
export * from './token-refresher'
export * from './multi-tenant'

// =============================================================================
// Unified Types
// =============================================================================

export type CredentialType = 'api_key' | 'oauth2' | 'password' | 'certificate' | 'secret'
export type RotationPolicyType = 'manual' | 'auto' | 'scheduled'

export interface OAuth2Token {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  tokenType?: string
  scope?: string
}

export interface Certificate {
  certificate: string
  privateKey: string
  chain?: string[]
}

export type CredentialValue = string | OAuth2Token | Certificate | Record<string, unknown>

export interface RotationPolicy {
  policy: RotationPolicyType
  schedule?: string
  nextRotation?: Date
  refreshEndpoint?: string
  clientId?: string
  clientSecret?: string
  refreshBeforeExpiry?: number
  maxRetries?: number
}

export interface CredentialMetadata {
  environment?: string
  service?: string
  team?: string
  scope?: string
  expiresAt?: Date
  [key: string]: unknown
}

export interface CredentialOptions {
  name: string
  type: CredentialType
  value: CredentialValue
  metadata?: CredentialMetadata
  rotation?: RotationPolicy
  scopes?: string[]
}

export interface Credential {
  id: string
  name: string
  type: CredentialType
  value?: CredentialValue
  metadata?: CredentialMetadata
  rotation?: RotationPolicy
  scopes?: string[]
  version: number
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
}

export interface GetOptions {
  version?: number
  autoRefresh?: boolean
  auditContext?: AuditContext
}

export interface RotationOptions {
  newValue: CredentialValue
  actor?: string
  reason?: string
}

export interface ListOptions {
  type?: CredentialType
  metadata?: Record<string, unknown>
  namePattern?: string
  scopes?: string[]
  limit?: number
  offset?: number
  source?: 'local' | 'provider' | 'all'
}

export interface DeleteOptions {
  actor?: string
  reason?: string
  hard?: boolean
}

export interface AuditLogOptions {
  action?: AuditAction
  limit?: number
  offset?: number
  since?: Date
  until?: Date
  includeDeleted?: boolean
}

export interface VaultProvider {
  name: string
  get(name: string): Promise<{ name: string; type: CredentialType; value: CredentialValue } | null>
  set(name: string, type: CredentialType, value: CredentialValue): Promise<void>
  delete(name: string): Promise<void>
  list(): Promise<{ name: string; type: CredentialType }[]>
}

export interface CredentialVaultConfig extends VaultConfig {
  providers?: VaultProvider[]
  enableAudit?: boolean
  retentionPeriod?: string
}

// =============================================================================
// CredentialVault - Unified Interface
// =============================================================================

interface RawCredential {
  id: string
  name: string
  type: CredentialType
  encryptedValue: string
  iv: string
  metadata?: CredentialMetadata
  rotation?: RotationPolicy
  scopes?: string[]
  version: number
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
}

interface CredentialVersion {
  version: number
  encryptedValue: string
  iv: string
  createdAt: Date
}

function generateId(): string {
  return crypto.randomUUID()
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) throw new Error(`Invalid duration format: ${duration}`)
  const value = parseInt(match[1]!, 10)
  const unit = match[2]!
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }
  return value * multipliers[unit]!
}

function matchPattern(value: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1))
  if (pattern.includes('*')) return new RegExp('^' + pattern.replace(/\*/g, '.*') + '$').test(value)
  return value === pattern
}

export class CredentialVault extends EventEmitter {
  private secureVault: SecureVault
  private rotationManager: RotationManager
  private accessManager: AccessManager
  private auditLogger: AuditLogger

  private credentials: Map<string, RawCredential> = new Map()
  private versions: Map<string, CredentialVersion[]> = new Map()
  private accessTokens: Map<string, AccessToken> = new Map()
  private providers: VaultProvider[]
  private versionRetention: number
  private refreshLocks: Map<string, Promise<void>> = new Map()
  private tampered: Set<string> = new Set()

  constructor(config: CredentialVaultConfig) {
    super()

    if (config.encryptionKey.length !== 32) {
      throw new Error('Encryption key must be 32 bytes for AES-256')
    }

    this.secureVault = createSecureVault(config)
    this.rotationManager = createRotationManager({ vault: this.secureVault })
    this.accessManager = createAccessManager({ vault: this.secureVault })
    this.auditLogger = createAuditLogger({
      vault: this.secureVault,
      enableTemporalStore: true,
      retentionPeriod: config.retentionPeriod,
    })

    this.providers = config.providers ?? []
    this.versionRetention = config.versionRetention ?? Infinity
  }

  /**
   * Encrypt a credential value
   */
  private async encrypt(value: CredentialValue): Promise<{ encryptedValue: string; iv: string }> {
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
    const { ciphertext, iv } = await this.secureVault.encrypt(valueStr)
    return { encryptedValue: ciphertext, iv }
  }

  /**
   * Decrypt a credential value
   */
  private async decrypt(encryptedValue: string, iv: string, type: CredentialType): Promise<CredentialValue> {
    const valueStr = await this.secureVault.decrypt(encryptedValue, iv)

    if (type === 'oauth2' || type === 'certificate' || type === 'secret') {
      try {
        const parsed = JSON.parse(valueStr)
        if (type === 'oauth2' && parsed.expiresAt) {
          parsed.expiresAt = new Date(parsed.expiresAt)
        }
        return parsed
      } catch {
        return valueStr
      }
    }

    return valueStr
  }

  /**
   * Validate credential type
   */
  private validateType(type: string): asserts type is CredentialType {
    const validTypes: CredentialType[] = ['api_key', 'oauth2', 'password', 'certificate', 'secret']
    if (!validTypes.includes(type as CredentialType)) {
      throw new Error(`Invalid credential type: ${type}. Must be one of: ${validTypes.join(', ')}`)
    }
  }

  /**
   * Enforce version retention
   */
  private enforceVersionRetention(name: string): void {
    if (this.versionRetention === Infinity) return
    const credVersions = this.versions.get(name)
    if (!credVersions) return
    while (credVersions.length > this.versionRetention) credVersions.shift()
  }

  /**
   * Store a new credential
   */
  async store(options: CredentialOptions): Promise<Credential> {
    if (!options.name || options.name.trim() === '') {
      throw new Error('Credential name is required and cannot be empty')
    }

    this.validateType(options.type)

    if (this.credentials.has(options.name)) {
      throw new Error(`Credential '${options.name}' already exists`)
    }

    const { encryptedValue, iv } = await this.encrypt(options.value)

    let rotation = options.rotation
    if (rotation?.policy === 'scheduled' && rotation.schedule && !rotation.nextRotation) {
      const ms = parseDuration(rotation.schedule)
      rotation = { ...rotation, nextRotation: new Date(Date.now() + ms) }
    }

    const now = new Date()
    const raw: RawCredential = {
      id: generateId(),
      name: options.name,
      type: options.type,
      encryptedValue,
      iv,
      metadata: options.metadata,
      rotation,
      scopes: options.scopes,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }

    this.credentials.set(options.name, raw)
    this.versions.set(options.name, [{ version: 1, encryptedValue, iv, createdAt: now }])

    await this.auditLogger.logCreate(options.name, { type: options.type })

    return {
      id: raw.id,
      name: raw.name,
      type: raw.type,
      metadata: raw.metadata,
      rotation: raw.rotation,
      scopes: raw.scopes,
      version: raw.version,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    }
  }

  /**
   * Get a credential by name
   */
  async get(name: string, options?: GetOptions): Promise<Credential | null> {
    let raw = this.credentials.get(name)

    if (raw?.deletedAt) raw = undefined

    if (!raw) {
      for (const provider of this.providers) {
        const result = await provider.get(name)
        if (result) {
          return {
            id: generateId(),
            name: result.name,
            type: result.type,
            value: result.value,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        }
      }
      return null
    }

    if (this.tampered.has(name)) {
      throw new Error('Credential integrity check failed: possible tampering detected')
    }

    if (options?.version) {
      const versionData = this.versions.get(name)?.find((v) => v.version === options.version)
      if (!versionData) return null
      const value = await this.decrypt(versionData.encryptedValue, versionData.iv, raw.type)
      await this.auditLogger.logRead(name, { context: options.auditContext })
      return {
        id: raw.id,
        name: raw.name,
        type: raw.type,
        value,
        metadata: raw.metadata,
        rotation: raw.rotation,
        scopes: raw.scopes,
        version: options.version,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      }
    }

    if (options?.autoRefresh && raw.type === 'oauth2' && raw.rotation?.policy === 'auto') {
      await this.maybeRefreshOAuth(name, raw)
      raw = this.credentials.get(name)!
    }

    const value = await this.decrypt(raw.encryptedValue, raw.iv, raw.type)
    await this.auditLogger.logRead(name, { context: options?.auditContext })

    return {
      id: raw.id,
      name: raw.name,
      type: raw.type,
      value,
      metadata: raw.metadata,
      rotation: raw.rotation,
      scopes: raw.scopes,
      version: raw.version,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    }
  }

  /**
   * Get raw credential (for testing)
   */
  async getRaw(name: string): Promise<RawCredential | null> {
    return this.credentials.get(name) ?? null
  }

  /**
   * Mark credential as tampered (for testing)
   */
  async tamperWith(name: string): Promise<void> {
    this.tampered.add(name)
  }

  /**
   * Get credential metadata only
   */
  async getMetadata(name: string): Promise<Credential | null> {
    const raw = this.credentials.get(name)
    if (!raw || raw.deletedAt) return null
    return {
      id: raw.id,
      name: raw.name,
      type: raw.type,
      metadata: raw.metadata,
      rotation: raw.rotation,
      scopes: raw.scopes,
      version: raw.version,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    }
  }

  /**
   * Maybe refresh OAuth token
   */
  private async maybeRefreshOAuth(name: string, raw: RawCredential): Promise<void> {
    const value = (await this.decrypt(raw.encryptedValue, raw.iv, raw.type)) as OAuth2Token
    if (!value.expiresAt) return

    const refreshBeforeExpiry = raw.rotation?.refreshBeforeExpiry ?? 300000
    const shouldRefresh = value.expiresAt.getTime() <= Date.now() + refreshBeforeExpiry
    if (!shouldRefresh) return

    let lockPromise = this.refreshLocks.get(name)
    if (lockPromise) {
      await lockPromise
      return
    }

    const refreshPromise = this.performOAuthRefresh(name, raw, value)
    this.refreshLocks.set(name, refreshPromise)

    try {
      await refreshPromise
    } finally {
      this.refreshLocks.delete(name)
    }
  }

  /**
   * Perform OAuth refresh
   */
  private async performOAuthRefresh(name: string, raw: RawCredential, token: OAuth2Token): Promise<void> {
    const rotation = raw.rotation!
    const maxRetries = rotation.maxRetries ?? 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(rotation.refreshEndpoint!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: token.refreshToken!,
            client_id: rotation.clientId!,
            client_secret: rotation.clientSecret!,
          }),
        })

        if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`)

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

        const { encryptedValue, iv } = await this.encrypt(newToken)
        raw.encryptedValue = encryptedValue
        raw.iv = iv
        raw.version++
        raw.updatedAt = new Date()

        const credVersions = this.versions.get(name)!
        credVersions.push({ version: raw.version, encryptedValue, iv, createdAt: raw.updatedAt })
        this.enforceVersionRetention(name)

        this.emit('credential:refreshed', { name, previousExpiry: token.expiresAt, newExpiry: newToken.expiresAt })
        await this.auditLogger.logRefresh(name, { previousExpiry: token.expiresAt!, newExpiry: newToken.expiresAt! })

        return
      } catch (error) {
        lastError = error as Error
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100))
        }
      }
    }

    this.emit('credential:refresh_failed', { name, error: lastError! })
    throw lastError
  }

  /**
   * Rotate a credential
   */
  async rotate(name: string, options: RotationOptions): Promise<void> {
    const raw = this.credentials.get(name)
    if (!raw || raw.deletedAt) {
      throw new Error(`Credential '${name}' not found`)
    }

    const previousVersion = raw.version
    const { encryptedValue, iv } = await this.encrypt(options.newValue)

    raw.encryptedValue = encryptedValue
    raw.iv = iv
    raw.version++
    raw.updatedAt = new Date()

    if (raw.rotation?.policy === 'scheduled' && raw.rotation.schedule) {
      const ms = parseDuration(raw.rotation.schedule)
      raw.rotation.nextRotation = new Date(Date.now() + ms)
    }

    const credVersions = this.versions.get(name)!
    credVersions.push({ version: raw.version, encryptedValue, iv, createdAt: raw.updatedAt })
    this.enforceVersionRetention(name)

    await this.auditLogger.logRotate(name, {
      actor: options.actor,
      reason: options.reason,
      previousVersion,
      newVersion: raw.version,
    })

    this.emit('credential:rotated', { name, version: raw.version })
  }

  /**
   * List versions of a credential
   */
  async listVersions(name: string): Promise<CredentialVersion[]> {
    return [...(this.versions.get(name) ?? [])]
  }

  /**
   * List credentials due for rotation
   */
  async listDueForRotation(): Promise<Credential[]> {
    const now = Date.now()
    const due: Credential[] = []

    for (const raw of this.credentials.values()) {
      if (raw.deletedAt) continue
      if (raw.rotation?.nextRotation && raw.rotation.nextRotation.getTime() <= now) {
        due.push({
          id: raw.id,
          name: raw.name,
          type: raw.type,
          metadata: raw.metadata,
          rotation: raw.rotation,
          scopes: raw.scopes,
          version: raw.version,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        })
      }
    }

    return due
  }

  /**
   * Create an access token
   */
  async createAccessToken(options: AccessTokenOptions): Promise<AccessToken> {
    return await this.accessManager.createAccessToken(options)
  }

  /**
   * Get credential using access token
   */
  async getWithToken(token: string, name: string): Promise<Credential | null> {
    // Validate through access manager
    await this.accessManager.getWithToken(token, name)
    return this.get(name)
  }

  /**
   * Rotate credential using access token
   */
  async rotateWithToken(token: string, name: string, options: RotationOptions): Promise<void> {
    await this.accessManager.rotateWithToken(token, name, options.newValue as string)
    return this.rotate(name, options)
  }

  /**
   * Revoke an access token
   */
  async revokeAccessToken(id: string): Promise<void> {
    return await this.accessManager.revokeAccessToken(id)
  }

  /**
   * List credentials
   */
  async list(options?: ListOptions): Promise<Credential[]> {
    const results: Credential[] = []
    const source = options?.source ?? 'all'

    if (source === 'local' || source === 'all') {
      for (const raw of this.credentials.values()) {
        if (raw.deletedAt) continue
        if (options?.type && raw.type !== options.type) continue
        if (options?.namePattern && !matchPattern(raw.name, options.namePattern)) continue
        if (options?.scopes) {
          const hasScope = options.scopes.some((s) => raw.scopes?.includes(s))
          if (!hasScope) continue
        }
        if (options?.metadata) {
          let matches = true
          for (const [key, value] of Object.entries(options.metadata)) {
            if (raw.metadata?.[key] !== value) {
              matches = false
              break
            }
          }
          if (!matches) continue
        }

        results.push({
          id: raw.id,
          name: raw.name,
          type: raw.type,
          metadata: raw.metadata,
          rotation: raw.rotation,
          scopes: raw.scopes,
          version: raw.version,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        })
      }
    }

    const offset = options?.offset ?? 0
    const limit = options?.limit ?? results.length

    return results.slice(offset, offset + limit)
  }

  /**
   * Get audit log
   */
  async getAuditLog(name: string, options?: AuditLogOptions): Promise<AuditLogEntry[]> {
    return await this.auditLogger.getAuditLog(name, options)
  }

  /**
   * Delete a credential
   */
  async delete(name: string, options?: DeleteOptions): Promise<void> {
    const raw = this.credentials.get(name)
    if (!raw) throw new Error(`Credential '${name}' not found`)

    if (options?.hard) {
      this.credentials.delete(name)
      this.versions.delete(name)
    } else {
      raw.deletedAt = new Date()
    }

    await this.auditLogger.logDelete(name, {
      actor: options?.actor,
      reason: options?.reason,
      hard: options?.hard,
    })
  }

  /**
   * Restore a soft-deleted credential
   */
  async restore(name: string): Promise<void> {
    const raw = this.credentials.get(name)
    if (!raw) throw new Error(`Credential '${name}' not found`)
    if (!raw.deletedAt) throw new Error(`Credential '${name}' is not deleted`)
    raw.deletedAt = undefined
    raw.updatedAt = new Date()
  }

  /**
   * Export a credential
   */
  async export(name: string): Promise<string> {
    const raw = this.credentials.get(name)
    if (!raw) throw new Error(`Credential '${name}' not found`)
    return JSON.stringify({
      name: raw.name,
      type: raw.type,
      encryptedValue: raw.encryptedValue,
      iv: raw.iv,
      metadata: raw.metadata,
      rotation: raw.rotation,
      scopes: raw.scopes,
    })
  }

  /**
   * Import a credential
   */
  async import(data: string): Promise<void> {
    const parsed = JSON.parse(data)
    if (this.credentials.has(parsed.name)) {
      throw new Error(`Credential '${parsed.name}' already exists`)
    }

    const now = new Date()
    const raw: RawCredential = {
      id: generateId(),
      name: parsed.name,
      type: parsed.type,
      encryptedValue: parsed.encryptedValue,
      iv: parsed.iv,
      metadata: parsed.metadata,
      rotation: parsed.rotation,
      scopes: parsed.scopes,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }

    this.credentials.set(parsed.name, raw)
    this.versions.set(parsed.name, [{ version: 1, encryptedValue: raw.encryptedValue, iv: raw.iv, createdAt: now }])
  }

  /**
   * Sync from provider
   */
  async syncFromProvider(providerName: string): Promise<void> {
    const provider = this.providers.find((p) => p.name === providerName)
    if (!provider) throw new Error(`Provider '${providerName}' not found`)

    const externalCreds = await provider.list()

    for (const cred of externalCreds) {
      if (this.credentials.has(cred.name)) continue
      const full = await provider.get(cred.name)
      if (full) {
        await this.store({ name: full.name, type: full.type, value: full.value })
      }
    }
  }
}

/**
 * Factory function to create a CredentialVault instance
 */
export function createCredentialVault(config: CredentialVaultConfig): CredentialVault {
  return new CredentialVault(config)
}
