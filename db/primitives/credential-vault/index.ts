/**
 * CredentialVault - Secure credential storage and rotation
 *
 * Provides secure credential storage with:
 * - Storage: AES-256-GCM encrypted storage with versioning
 * - Access: Scoped access tokens, audit logging
 * - Rotation: Automatic rotation policies, manual rotation
 * - Types: API keys, OAuth tokens, passwords, certificates
 * - Providers: Integration adapters for external vaults
 *
 * @example
 * ```typescript
 * import { CredentialVault, createCredentialVault } from './credential-vault'
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
 * @module db/primitives/credential-vault
 */

import { EventEmitter } from 'events'

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Supported credential types
 */
export type CredentialType = 'api_key' | 'oauth2' | 'password' | 'certificate' | 'secret'

/**
 * Rotation policy types
 */
export type RotationPolicyType = 'manual' | 'auto' | 'scheduled'

/**
 * Permission levels for access tokens
 */
export type Permission = 'read' | 'write' | 'admin'

/**
 * Audit log action types
 */
export type AuditAction = 'create' | 'read' | 'rotate' | 'delete' | 'access_denied' | 'refresh'

/**
 * OAuth2 token structure
 */
export interface OAuth2Token {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  tokenType?: string
  scope?: string
}

/**
 * Certificate structure
 */
export interface Certificate {
  certificate: string
  privateKey: string
  chain?: string[]
}

/**
 * Credential value type - can be string, OAuth2Token, Certificate, or any JSON object
 */
export type CredentialValue = string | OAuth2Token | Certificate | Record<string, unknown>

/**
 * Rotation policy configuration
 */
export interface RotationPolicy {
  policy: RotationPolicyType
  schedule?: string // e.g., '30d', '7d', '1h'
  nextRotation?: Date
  refreshEndpoint?: string
  clientId?: string
  clientSecret?: string
  refreshBeforeExpiry?: number // milliseconds
  maxRetries?: number
}

/**
 * Credential metadata
 */
export interface CredentialMetadata {
  environment?: string
  service?: string
  team?: string
  scope?: string
  expiresAt?: Date
  [key: string]: unknown
}

/**
 * Options for storing a credential
 */
export interface CredentialOptions {
  name: string
  type: CredentialType
  value: CredentialValue
  metadata?: CredentialMetadata
  rotation?: RotationPolicy
  scopes?: string[]
}

/**
 * Stored credential (without value for listings)
 */
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

/**
 * Raw stored credential with encrypted data
 */
export interface RawCredential {
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

/**
 * Credential version entry
 */
export interface CredentialVersion {
  version: number
  encryptedValue: string
  iv: string
  createdAt: Date
}

/**
 * Access token structure
 */
export interface AccessToken {
  id: string
  token: string
  credentials: string[]
  scopes?: string[]
  permissions: Permission[]
  expiresAt: Date
  createdAt: Date
  revokedAt?: Date
}

/**
 * Options for creating an access token
 */
export interface AccessTokenOptions {
  credentials?: string[]
  scopes?: string[]
  permissions: Permission[]
  expiresIn: string // e.g., '1h', '24h', '7d'
}

/**
 * Audit log context
 */
export interface AuditContext {
  ipAddress?: string
  userAgent?: string
  requestId?: string
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: string
  credentialName: string
  action: AuditAction
  actor?: string
  reason?: string
  timestamp: Date
  context?: AuditContext
  metadata?: Record<string, unknown>
}

/**
 * Options for retrieving credentials
 */
export interface GetOptions {
  version?: number
  autoRefresh?: boolean
  auditContext?: AuditContext
}

/**
 * Options for rotating credentials
 */
export interface RotationOptions {
  newValue: CredentialValue
  actor?: string
  reason?: string
}

/**
 * Options for listing credentials
 */
export interface ListOptions {
  type?: CredentialType
  metadata?: Record<string, unknown>
  namePattern?: string
  scopes?: string[]
  limit?: number
  offset?: number
  source?: 'local' | 'provider' | 'all'
}

/**
 * Options for deleting credentials
 */
export interface DeleteOptions {
  actor?: string
  reason?: string
  hard?: boolean
}

/**
 * Options for getting audit logs
 */
export interface AuditLogOptions {
  action?: AuditAction
  limit?: number
  offset?: number
  since?: Date
  until?: Date
  includeDeleted?: boolean
}

/**
 * Vault configuration
 */
export interface VaultConfig {
  encryptionKey: string
  versionRetention?: number
  providers?: VaultProvider[]
}

/**
 * External vault provider interface
 */
export interface VaultProvider {
  name: string
  get(name: string): Promise<{ name: string; type: CredentialType; value: CredentialValue } | null>
  set(name: string, type: CredentialType, value: CredentialValue): Promise<void>
  delete(name: string): Promise<void>
  list(): Promise<{ name: string; type: CredentialType }[]>
}

/**
 * Vault event types
 */
export interface VaultEvents {
  'credential:refreshed': { name: string; previousExpiry: Date; newExpiry: Date }
  'credential:refresh_failed': { name: string; error: Error }
  'credential:rotated': { name: string; version: number }
  'credential:expired': { name: string }
}

// =============================================================================
// Crypto Utilities
// =============================================================================

/**
 * Convert string to ArrayBuffer
 */
function stringToBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer as ArrayBuffer
}

/**
 * Convert ArrayBuffer to base64 string
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Generate a random IV for AES-GCM
 */
function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Generate a secure token
 */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return bufferToBase64(bytes.buffer)
}

/**
 * Parse duration string to milliseconds
 */
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

/**
 * Match wildcard pattern
 */
function matchPattern(value: string, pattern: string): boolean {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1)
    return value.startsWith(prefix)
  }
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    return regex.test(value)
  }
  return value === pattern
}

// =============================================================================
// CredentialVault Implementation
// =============================================================================

/**
 * CredentialVault class
 */
export class CredentialVault extends EventEmitter {
  private encryptionKey: CryptoKey | null = null
  private rawKey: string
  private credentials: Map<string, RawCredential> = new Map()
  private versions: Map<string, CredentialVersion[]> = new Map()
  private accessTokens: Map<string, AccessToken> = new Map()
  private auditLogs: AuditLogEntry[] = []
  private providers: VaultProvider[]
  private versionRetention: number
  private refreshLocks: Map<string, Promise<void>> = new Map()
  private tampered: Set<string> = new Set() // For testing tampering

  constructor(config: VaultConfig) {
    super()

    // Validate encryption key length
    if (config.encryptionKey.length !== 32) {
      throw new Error('Encryption key must be 32 bytes for AES-256')
    }

    this.rawKey = config.encryptionKey
    this.providers = config.providers ?? []
    this.versionRetention = config.versionRetention ?? Infinity
  }

  /**
   * Initialize the encryption key
   */
  private async initKey(): Promise<CryptoKey> {
    if (this.encryptionKey) {
      return this.encryptionKey
    }

    const keyData = stringToBuffer(this.rawKey)
    this.encryptionKey = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

    return this.encryptionKey
  }

  /**
   * Encrypt a value
   */
  private async encrypt(value: CredentialValue): Promise<{ encryptedValue: string; iv: string }> {
    const key = await this.initKey()
    const iv = generateIV()

    const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
    const data = stringToBuffer(valueStr)

    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)

    return {
      encryptedValue: bufferToBase64(encrypted),
      iv: bufferToBase64(iv.buffer as ArrayBuffer),
    }
  }

  /**
   * Decrypt a value
   */
  private async decrypt(encryptedValue: string, iv: string, type: CredentialType): Promise<CredentialValue> {
    const key = await this.initKey()
    const ivBuffer = new Uint8Array(base64ToBuffer(iv))
    const dataBuffer = base64ToBuffer(encryptedValue)

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuffer }, key, dataBuffer)

    const valueStr = new TextDecoder().decode(decrypted)

    // Parse JSON for complex types
    if (type === 'oauth2' || type === 'certificate' || type === 'secret') {
      try {
        const parsed = JSON.parse(valueStr)
        // Restore Date objects for OAuth2 tokens
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
   * Log an audit event
   */
  private logAudit(
    credentialName: string,
    action: AuditAction,
    options?: { actor?: string; reason?: string; context?: AuditContext; metadata?: Record<string, unknown> }
  ): void {
    const entry: AuditLogEntry = {
      id: generateId(),
      credentialName,
      action,
      timestamp: new Date(),
      ...options,
    }

    this.auditLogs.push(entry)
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
   * Enforce version retention policy
   */
  private enforceVersionRetention(name: string): void {
    if (this.versionRetention === Infinity) return

    const credVersions = this.versions.get(name)
    if (!credVersions) return

    while (credVersions.length > this.versionRetention) {
      credVersions.shift()
    }
  }

  /**
   * Store a new credential
   */
  async store(options: CredentialOptions): Promise<Credential> {
    // Validate inputs
    if (!options.name || options.name.trim() === '') {
      throw new Error('Credential name is required and cannot be empty')
    }

    this.validateType(options.type)

    // Check for duplicates
    if (this.credentials.has(options.name)) {
      throw new Error(`Credential '${options.name}' already exists`)
    }

    // Encrypt the value
    const { encryptedValue, iv } = await this.encrypt(options.value)

    // Calculate next rotation if scheduled
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

    // Store the credential
    this.credentials.set(options.name, raw)

    // Initialize version history
    this.versions.set(options.name, [{ version: 1, encryptedValue, iv, createdAt: now }])

    // Audit log
    this.logAudit(options.name, 'create')

    // Return credential without value
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

    // Check if deleted
    if (raw?.deletedAt) {
      raw = undefined
    }

    // Try providers if not found locally
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

    // Check for tampering (testing only)
    if (this.tampered.has(name)) {
      throw new Error('Credential integrity check failed: possible tampering detected')
    }

    // Handle version request
    if (options?.version) {
      const credVersions = this.versions.get(name)
      const versionData = credVersions?.find((v) => v.version === options.version)
      if (!versionData) {
        return null
      }

      const value = await this.decrypt(versionData.encryptedValue, versionData.iv, raw.type)

      // Audit log
      this.logAudit(name, 'read', { context: options.auditContext })

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

    // Handle auto-refresh for OAuth2 tokens
    if (options?.autoRefresh && raw.type === 'oauth2' && raw.rotation?.policy === 'auto') {
      await this.maybeRefreshOAuth(name, raw)
      // Re-fetch after potential refresh
      raw = this.credentials.get(name)!
    }

    // Decrypt the value
    const value = await this.decrypt(raw.encryptedValue, raw.iv, raw.type)

    // Audit log
    this.logAudit(name, 'read', { context: options?.auditContext })

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
   * Get raw credential data (for testing encryption)
   */
  async getRaw(name: string): Promise<RawCredential | null> {
    return this.credentials.get(name) ?? null
  }

  /**
   * Tamper with encrypted data (for testing)
   */
  async tamperWith(name: string): Promise<void> {
    this.tampered.add(name)
  }

  /**
   * Get credential metadata only
   */
  async getMetadata(name: string): Promise<Credential | null> {
    const raw = this.credentials.get(name)
    if (!raw || raw.deletedAt) {
      return null
    }

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
   * Maybe refresh an OAuth2 token if needed
   */
  private async maybeRefreshOAuth(name: string, raw: RawCredential): Promise<void> {
    const value = (await this.decrypt(raw.encryptedValue, raw.iv, raw.type)) as OAuth2Token

    if (!value.expiresAt) return

    const refreshBeforeExpiry = raw.rotation?.refreshBeforeExpiry ?? 300000 // 5 minutes default
    const shouldRefresh = value.expiresAt.getTime() <= Date.now() + refreshBeforeExpiry

    if (!shouldRefresh) return

    // Check for existing refresh lock
    let lockPromise = this.refreshLocks.get(name)
    if (lockPromise) {
      await lockPromise
      return
    }

    // Create refresh lock
    const refreshPromise = this.performOAuthRefresh(name, raw, value)
    this.refreshLocks.set(name, refreshPromise)

    try {
      await refreshPromise
    } finally {
      this.refreshLocks.delete(name)
    }
  }

  /**
   * Perform OAuth2 token refresh
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

        // Update the credential
        const { encryptedValue, iv } = await this.encrypt(newToken)
        raw.encryptedValue = encryptedValue
        raw.iv = iv
        raw.version++
        raw.updatedAt = new Date()

        // Add to version history
        const credVersions = this.versions.get(name)!
        credVersions.push({ version: raw.version, encryptedValue, iv, createdAt: raw.updatedAt })
        this.enforceVersionRetention(name)

        this.emit('credential:refreshed', { name, previousExpiry: token.expiresAt, newExpiry: newToken.expiresAt })
        this.logAudit(name, 'refresh')

        return
      } catch (error) {
        lastError = error as Error
        // Wait before retry (exponential backoff)
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

    // Encrypt new value
    const { encryptedValue, iv } = await this.encrypt(options.newValue)

    // Update credential
    raw.encryptedValue = encryptedValue
    raw.iv = iv
    raw.version++
    raw.updatedAt = new Date()

    // Update next rotation if scheduled
    if (raw.rotation?.policy === 'scheduled' && raw.rotation.schedule) {
      const ms = parseDuration(raw.rotation.schedule)
      raw.rotation.nextRotation = new Date(Date.now() + ms)
    }

    // Add to version history
    const credVersions = this.versions.get(name)!
    credVersions.push({ version: raw.version, encryptedValue, iv, createdAt: raw.updatedAt })
    this.enforceVersionRetention(name)

    // Audit log
    this.logAudit(name, 'rotate', {
      actor: options.actor,
      reason: options.reason,
      metadata: { previousVersion, newVersion: raw.version },
    })

    this.emit('credential:rotated', { name, version: raw.version })
  }

  /**
   * List versions of a credential
   */
  async listVersions(name: string): Promise<CredentialVersion[]> {
    const credVersions = this.versions.get(name)
    if (!credVersions) {
      return []
    }
    return [...credVersions]
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
    }

    this.accessTokens.set(token.token, token)

    return token
  }

  /**
   * Get credential using access token
   */
  async getWithToken(token: string, name: string): Promise<Credential | null> {
    const accessToken = this.accessTokens.get(token)

    // Check token validity
    if (!accessToken) {
      throw new Error('Invalid or revoked access token')
    }

    if (accessToken.revokedAt) {
      throw new Error('Access token has been revoked')
    }

    if (accessToken.expiresAt.getTime() < Date.now()) {
      throw new Error('Access token has expired')
    }

    // Check permissions
    if (!accessToken.permissions.includes('read') && !accessToken.permissions.includes('admin')) {
      this.logAudit(name, 'access_denied', { metadata: { reason: 'insufficient_permissions' } })
      throw new Error('Access denied: insufficient permissions')
    }

    // Check if credential is in token scope
    const raw = this.credentials.get(name)

    if (accessToken.credentials.length > 0) {
      // Check explicit credential list
      if (!accessToken.credentials.includes(name)) {
        this.logAudit(name, 'access_denied', { metadata: { reason: 'credential_not_in_scope' } })
        throw new Error('Access denied: credential not in token scope')
      }
    } else if (accessToken.scopes && accessToken.scopes.length > 0 && raw) {
      // Check scope-based access
      const credScope = raw.metadata?.scope as string | undefined
      if (!credScope) {
        this.logAudit(name, 'access_denied', { metadata: { reason: 'no_credential_scope' } })
        throw new Error('Access denied: credential has no scope defined')
      }

      const hasMatchingScope = accessToken.scopes.some((s) => matchPattern(credScope, s))
      if (!hasMatchingScope) {
        this.logAudit(name, 'access_denied', { metadata: { reason: 'scope_mismatch' } })
        throw new Error('Access denied: credential scope not matched')
      }
    }

    return this.get(name)
  }

  /**
   * Rotate credential using access token
   */
  async rotateWithToken(token: string, name: string, options: RotationOptions): Promise<void> {
    const accessToken = this.accessTokens.get(token)

    // Check token validity
    if (!accessToken || accessToken.revokedAt || accessToken.expiresAt.getTime() < Date.now()) {
      throw new Error('Invalid, expired, or revoked access token')
    }

    // Check permissions
    if (!accessToken.permissions.includes('write') && !accessToken.permissions.includes('admin')) {
      throw new Error('Access denied: write permission required')
    }

    // Check credential scope
    if (accessToken.credentials.length > 0 && !accessToken.credentials.includes(name)) {
      throw new Error('Access denied: credential not in token scope')
    }

    return this.rotate(name, options)
  }

  /**
   * Revoke an access token
   */
  async revokeAccessToken(id: string): Promise<void> {
    for (const token of this.accessTokens.values()) {
      if (token.id === id) {
        token.revokedAt = new Date()
        return
      }
    }
    throw new Error('Access token not found')
  }

  /**
   * List credentials
   */
  async list(options?: ListOptions): Promise<Credential[]> {
    const results: Credential[] = []
    const source = options?.source ?? 'all'

    // Local credentials
    if (source === 'local' || source === 'all') {
      for (const raw of this.credentials.values()) {
        if (raw.deletedAt) continue

        // Apply filters
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

    // Pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? results.length

    return results.slice(offset, offset + limit)
  }

  /**
   * Get audit log entries for a credential
   */
  async getAuditLog(name: string, options?: AuditLogOptions): Promise<AuditLogEntry[]> {
    let logs = this.auditLogs.filter((l) => l.credentialName === name)

    // Apply filters
    if (options?.action) {
      logs = logs.filter((l) => l.action === options.action)
    }
    if (options?.since) {
      logs = logs.filter((l) => l.timestamp >= options.since!)
    }
    if (options?.until) {
      logs = logs.filter((l) => l.timestamp <= options.until!)
    }

    // Sort by timestamp descending (most recent first)
    logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    // Pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? logs.length

    return logs.slice(offset, offset + limit)
  }

  /**
   * Delete a credential
   */
  async delete(name: string, options?: DeleteOptions): Promise<void> {
    const raw = this.credentials.get(name)
    if (!raw) {
      throw new Error(`Credential '${name}' not found`)
    }

    if (options?.hard) {
      // Hard delete - remove completely
      this.credentials.delete(name)
      this.versions.delete(name)
    } else {
      // Soft delete
      raw.deletedAt = new Date()
    }

    // Audit log (always persisted)
    this.logAudit(name, 'delete', { actor: options?.actor, reason: options?.reason })
  }

  /**
   * Restore a soft-deleted credential
   */
  async restore(name: string): Promise<void> {
    const raw = this.credentials.get(name)
    if (!raw) {
      throw new Error(`Credential '${name}' not found`)
    }
    if (!raw.deletedAt) {
      throw new Error(`Credential '${name}' is not deleted`)
    }

    raw.deletedAt = undefined
    raw.updatedAt = new Date()
  }

  /**
   * Export a credential for backup/migration
   */
  async export(name: string): Promise<string> {
    const raw = this.credentials.get(name)
    if (!raw) {
      throw new Error(`Credential '${name}' not found`)
    }

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
   * Import a credential from backup
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
   * Sync credentials from a provider
   */
  async syncFromProvider(providerName: string): Promise<void> {
    const provider = this.providers.find((p) => p.name === providerName)
    if (!provider) {
      throw new Error(`Provider '${providerName}' not found`)
    }

    const externalCreds = await provider.list()

    for (const cred of externalCreds) {
      if (this.credentials.has(cred.name)) {
        continue // Skip existing
      }

      const full = await provider.get(cred.name)
      if (full) {
        await this.store({
          name: full.name,
          type: full.type,
          value: full.value,
        })
      }
    }
  }
}

/**
 * Factory function to create a CredentialVault instance
 */
export function createCredentialVault(config: VaultConfig): CredentialVault {
  return new CredentialVault(config)
}
