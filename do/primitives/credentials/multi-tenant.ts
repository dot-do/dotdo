/**
 * MultiTenantCredentialVault - Tenant-isolated credential storage
 *
 * Provides secure multi-tenant credential management with:
 * - Tenant-scoped encryption keys (derived from tenant ID + master key)
 * - Complete namespace isolation per tenant
 * - Cross-tenant access prevention with runtime guards
 * - Tenant key rotation without affecting other tenants
 * - Per-tenant audit trails for compliance
 *
 * @example
 * ```typescript
 * import { MultiTenantCredentialVault, createMultiTenantVault } from './multi-tenant'
 *
 * const vault = createMultiTenantVault({
 *   masterKey: process.env.VAULT_MASTER_KEY, // 32 bytes
 * })
 *
 * // Store credential for tenant
 * await vault.store('tenant-a', {
 *   name: 'stripe-api-key',
 *   type: 'api_key',
 *   value: 'sk_live_xxx',
 * })
 *
 * // Retrieve - only works for same tenant
 * const cred = await vault.get('tenant-a', 'stripe-api-key')
 *
 * // Cross-tenant access fails
 * try {
 *   await vault.get('tenant-b', 'stripe-api-key') // Throws CrossTenantAccessError
 * } catch (e) {
 *   console.log(e.message) // "Credential not found" - doesn't reveal existence
 * }
 *
 * // Tenant key rotation
 * await vault.rotateTenantKey('tenant-a')
 * ```
 *
 * @module db/primitives/credentials/multi-tenant
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
export type TenantAuditAction =
  | 'create'
  | 'read'
  | 'rotate'
  | 'delete'
  | 'access_denied'
  | 'refresh'
  | 'cross_tenant_attempt'
  | 'tenant_key_rotate'

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
 * Credential value type
 */
export type CredentialValue = string | OAuth2Token | Certificate | Record<string, unknown>

/**
 * Rotation policy configuration
 */
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
export interface TenantCredentialOptions {
  name: string
  type: CredentialType
  value: CredentialValue
  metadata?: CredentialMetadata
  rotation?: RotationPolicy
  scopes?: string[]
}

/**
 * Stored credential
 */
export interface TenantCredential {
  id: string
  tenantId: string
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
interface RawTenantCredential {
  id: string
  tenantId: string
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
interface CredentialVersion {
  version: number
  encryptedValue: string
  iv: string
  createdAt: Date
}

/**
 * Tenant state tracking
 */
interface TenantState {
  derivedKey: CryptoKey
  keyVersion: number
  createdAt: Date
  lastRotatedAt?: Date
}

/**
 * Audit log entry
 */
export interface TenantAuditLogEntry {
  id: string
  tenantId: string
  credentialName: string
  action: TenantAuditAction
  actor?: string
  reason?: string
  timestamp: Date
  context?: TenantAuditContext
  metadata?: Record<string, unknown>
}

/**
 * Audit context
 */
export interface TenantAuditContext {
  ipAddress?: string
  userAgent?: string
  requestId?: string
  sessionId?: string
  attemptedTenantId?: string
}

/**
 * Access token for tenant
 */
export interface TenantAccessToken {
  id: string
  tenantId: string
  token: string
  credentials: string[]
  scopes?: string[]
  permissions: Permission[]
  expiresAt: Date
  createdAt: Date
  revokedAt?: Date
}

/**
 * Access token options
 */
export interface TenantAccessTokenOptions {
  credentials?: string[]
  scopes?: string[]
  permissions: Permission[]
  expiresIn: string
}

/**
 * Vault configuration
 */
export interface MultiTenantVaultConfig {
  masterKey: string
  versionRetention?: number
  enableAudit?: boolean
  enableIntegrityChecks?: boolean
}

/**
 * Get options
 */
export interface TenantGetOptions {
  version?: number
  autoRefresh?: boolean
  auditContext?: TenantAuditContext
}

/**
 * Rotation options
 */
export interface TenantRotationOptions {
  newValue: CredentialValue
  actor?: string
  reason?: string
}

/**
 * List options
 */
export interface TenantListOptions {
  type?: CredentialType
  metadata?: Record<string, unknown>
  namePattern?: string
  scopes?: string[]
  limit?: number
  offset?: number
}

/**
 * Delete options
 */
export interface TenantDeleteOptions {
  actor?: string
  reason?: string
  hard?: boolean
}

/**
 * Audit log options
 */
export interface TenantAuditLogOptions {
  action?: TenantAuditAction
  limit?: number
  offset?: number
  since?: Date
  until?: Date
}

/**
 * Tenant statistics
 */
export interface TenantStats {
  tenantId: string
  credentialCount: number
  keyVersion: number
  createdAt: Date
  lastRotatedAt?: Date
  auditLogCount: number
}

/**
 * Vault events
 */
export interface MultiTenantVaultEvents {
  'credential:created': { tenantId: string; name: string }
  'credential:rotated': { tenantId: string; name: string; version: number }
  'credential:deleted': { tenantId: string; name: string }
  'tenant:key_rotated': { tenantId: string; keyVersion: number }
  'security:cross_tenant_attempt': { sourceTenantId: string; targetTenantId: string; credentialName: string }
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when cross-tenant access is attempted
 */
export class CrossTenantAccessError extends Error {
  constructor(
    public readonly sourceTenantId: string,
    public readonly targetTenantId: string,
    public readonly credentialName: string
  ) {
    // Intentionally vague message to not leak information
    super('Credential not found')
    this.name = 'CrossTenantAccessError'
  }
}

/**
 * Error thrown for tenant-related issues
 */
export class TenantError extends Error {
  constructor(
    public readonly tenantId: string,
    message: string
  ) {
    super(message)
    this.name = 'TenantError'
  }
}

// =============================================================================
// Crypto Utilities
// =============================================================================

function stringToBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer as ArrayBuffer
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

function generateId(): string {
  return crypto.randomUUID()
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return bufferToBase64(bytes.buffer)
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
// MultiTenantCredentialVault Implementation
// =============================================================================

/**
 * Multi-tenant credential vault with complete tenant isolation
 */
export class MultiTenantCredentialVault extends EventEmitter {
  private masterKey: CryptoKey | null = null
  private readonly rawMasterKey: string

  // Tenant-scoped storage: tenantId -> (credentialName -> credential)
  private tenantCredentials: Map<string, Map<string, RawTenantCredential>> = new Map()

  // Version history: tenantId:credentialName -> versions[]
  private versions: Map<string, CredentialVersion[]> = new Map()

  // Tenant state tracking
  private tenantStates: Map<string, TenantState> = new Map()

  // Per-tenant access tokens: tenantId -> (token -> AccessToken)
  private tenantAccessTokens: Map<string, Map<string, TenantAccessToken>> = new Map()

  // Per-tenant audit logs: tenantId -> entries[]
  private tenantAuditLogs: Map<string, TenantAuditLogEntry[]> = new Map()

  private readonly versionRetention: number
  private readonly enableAudit: boolean
  private readonly enableIntegrityChecks: boolean

  constructor(config: MultiTenantVaultConfig) {
    super()

    if (config.masterKey.length !== 32) {
      throw new Error('Master key must be 32 bytes for AES-256')
    }

    this.rawMasterKey = config.masterKey
    this.versionRetention = config.versionRetention ?? Infinity
    this.enableAudit = config.enableAudit ?? true
    this.enableIntegrityChecks = config.enableIntegrityChecks ?? true
  }

  // ===========================================================================
  // Key Derivation
  // ===========================================================================

  /**
   * Initialize the master key
   */
  private async initMasterKey(): Promise<CryptoKey> {
    if (this.masterKey) {
      return this.masterKey
    }

    const keyData = stringToBuffer(this.rawMasterKey)
    this.masterKey = await crypto.subtle.importKey('raw', keyData, { name: 'HKDF' }, false, ['deriveKey'])

    return this.masterKey
  }

  /**
   * Derive a tenant-specific encryption key using HKDF
   * This ensures complete cryptographic isolation between tenants
   */
  private async deriveTenantKey(tenantId: string, keyVersion: number = 1): Promise<CryptoKey> {
    const masterKey = await this.initMasterKey()

    // Create unique info string for this tenant and version
    const info = stringToBuffer(`tenant:${tenantId}:v${keyVersion}`)
    const salt = stringToBuffer(`dotdo-mt-vault-${tenantId}`)

    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(salt),
        info: new Uint8Array(info),
      },
      masterKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )

    return derivedKey
  }

  /**
   * Get or initialize tenant state
   */
  private async ensureTenantState(tenantId: string): Promise<TenantState> {
    let state = this.tenantStates.get(tenantId)
    if (!state) {
      const derivedKey = await this.deriveTenantKey(tenantId, 1)
      state = {
        derivedKey,
        keyVersion: 1,
        createdAt: new Date(),
      }
      this.tenantStates.set(tenantId, state)

      // Initialize storage maps for this tenant
      if (!this.tenantCredentials.has(tenantId)) {
        this.tenantCredentials.set(tenantId, new Map())
      }
      if (!this.tenantAccessTokens.has(tenantId)) {
        this.tenantAccessTokens.set(tenantId, new Map())
      }
      if (!this.tenantAuditLogs.has(tenantId)) {
        this.tenantAuditLogs.set(tenantId, [])
      }
    }
    return state
  }

  /**
   * Get the credential storage map for a tenant
   */
  private getTenantCredentials(tenantId: string): Map<string, RawTenantCredential> {
    let credentials = this.tenantCredentials.get(tenantId)
    if (!credentials) {
      credentials = new Map()
      this.tenantCredentials.set(tenantId, credentials)
    }
    return credentials
  }

  // ===========================================================================
  // Encryption/Decryption
  // ===========================================================================

  /**
   * Encrypt a value for a specific tenant
   */
  private async encryptForTenant(tenantId: string, value: CredentialValue): Promise<{ encryptedValue: string; iv: string }> {
    const state = await this.ensureTenantState(tenantId)
    const iv = generateIV()

    const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
    const data = stringToBuffer(valueStr)

    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.derivedKey, data)

    return {
      encryptedValue: bufferToBase64(encrypted),
      iv: bufferToBase64(iv.buffer as ArrayBuffer),
    }
  }

  /**
   * Decrypt a value for a specific tenant
   */
  private async decryptForTenant(tenantId: string, encryptedValue: string, iv: string, type: CredentialType): Promise<CredentialValue> {
    const state = await this.ensureTenantState(tenantId)
    const ivBuffer = new Uint8Array(base64ToBuffer(iv))
    const dataBuffer = base64ToBuffer(encryptedValue)

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuffer }, state.derivedKey, dataBuffer)

    const valueStr = new TextDecoder().decode(decrypted)

    // Parse JSON for complex types
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

  // ===========================================================================
  // Audit Logging
  // ===========================================================================

  /**
   * Log an audit event for a tenant
   */
  private logAudit(
    tenantId: string,
    credentialName: string,
    action: TenantAuditAction,
    options?: {
      actor?: string
      reason?: string
      context?: TenantAuditContext
      metadata?: Record<string, unknown>
    }
  ): void {
    if (!this.enableAudit) return

    const entry: TenantAuditLogEntry = {
      id: generateId(),
      tenantId,
      credentialName,
      action,
      timestamp: new Date(),
      ...options,
    }

    let logs = this.tenantAuditLogs.get(tenantId)
    if (!logs) {
      logs = []
      this.tenantAuditLogs.set(tenantId, logs)
    }
    logs.push(entry)
  }

  // ===========================================================================
  // Tenant Isolation Guards
  // ===========================================================================

  /**
   * Validate tenant ID format
   */
  private validateTenantId(tenantId: string): void {
    if (!tenantId || tenantId.trim() === '') {
      throw new TenantError(tenantId, 'Tenant ID is required and cannot be empty')
    }

    // Prevent path traversal and injection attacks
    if (tenantId.includes(':') || tenantId.includes('/') || tenantId.includes('\\') || tenantId.includes('\0')) {
      throw new TenantError(tenantId, 'Tenant ID contains invalid characters')
    }

    // Reasonable length limit
    if (tenantId.length > 128) {
      throw new TenantError(tenantId, 'Tenant ID exceeds maximum length of 128 characters')
    }
  }

  /**
   * Assert that a credential belongs to the specified tenant
   * This is the core isolation guard
   */
  private assertTenantOwnership(credential: RawTenantCredential | undefined, tenantId: string, credentialName: string): asserts credential is RawTenantCredential {
    if (!credential) {
      // Don't reveal whether credential exists in another tenant
      throw new CrossTenantAccessError(tenantId, 'unknown', credentialName)
    }

    if (credential.tenantId !== tenantId) {
      // Log the cross-tenant attempt
      this.logAudit(tenantId, credentialName, 'cross_tenant_attempt', {
        context: { attemptedTenantId: credential.tenantId },
        metadata: { actualTenantId: credential.tenantId },
      })

      this.emit('security:cross_tenant_attempt', {
        sourceTenantId: tenantId,
        targetTenantId: credential.tenantId,
        credentialName,
      })

      // Throw with intentionally vague message
      throw new CrossTenantAccessError(tenantId, credential.tenantId, credentialName)
    }
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
  private enforceVersionRetention(tenantId: string, name: string): void {
    if (this.versionRetention === Infinity) return

    const key = `${tenantId}:${name}`
    const credVersions = this.versions.get(key)
    if (!credVersions) return

    while (credVersions.length > this.versionRetention) {
      credVersions.shift()
    }
  }

  // ===========================================================================
  // Core Credential Operations
  // ===========================================================================

  /**
   * Store a new credential for a tenant
   */
  async store(tenantId: string, options: TenantCredentialOptions): Promise<TenantCredential> {
    this.validateTenantId(tenantId)

    if (!options.name || options.name.trim() === '') {
      throw new Error('Credential name is required and cannot be empty')
    }

    this.validateType(options.type)

    const tenantCreds = this.getTenantCredentials(tenantId)

    // Check for duplicates within this tenant's namespace
    if (tenantCreds.has(options.name)) {
      throw new Error(`Credential '${options.name}' already exists for tenant '${tenantId}'`)
    }

    // Encrypt with tenant-specific key
    const { encryptedValue, iv } = await this.encryptForTenant(tenantId, options.value)

    // Calculate next rotation if scheduled
    let rotation = options.rotation
    if (rotation?.policy === 'scheduled' && rotation.schedule && !rotation.nextRotation) {
      const ms = parseDuration(rotation.schedule)
      rotation = { ...rotation, nextRotation: new Date(Date.now() + ms) }
    }

    const now = new Date()
    const raw: RawTenantCredential = {
      id: generateId(),
      tenantId,
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

    // Store in tenant's namespace
    tenantCreds.set(options.name, raw)

    // Initialize version history
    const versionKey = `${tenantId}:${options.name}`
    this.versions.set(versionKey, [{ version: 1, encryptedValue, iv, createdAt: now }])

    // Audit log
    this.logAudit(tenantId, options.name, 'create', { metadata: { type: options.type } })

    this.emit('credential:created', { tenantId, name: options.name })

    return {
      id: raw.id,
      tenantId: raw.tenantId,
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
   * Get a credential by name for a tenant
   */
  async get(tenantId: string, name: string, options?: TenantGetOptions): Promise<TenantCredential | null> {
    this.validateTenantId(tenantId)

    const tenantCreds = this.getTenantCredentials(tenantId)
    let raw = tenantCreds.get(name)

    // Check if deleted
    if (raw?.deletedAt) {
      raw = undefined
    }

    if (!raw) {
      return null
    }

    // Verify tenant ownership (defense in depth)
    this.assertTenantOwnership(raw, tenantId, name)

    // Handle version request
    if (options?.version) {
      const versionKey = `${tenantId}:${name}`
      const credVersions = this.versions.get(versionKey)
      const versionData = credVersions?.find((v) => v.version === options.version)
      if (!versionData) {
        return null
      }

      const value = await this.decryptForTenant(tenantId, versionData.encryptedValue, versionData.iv, raw.type)

      this.logAudit(tenantId, name, 'read', { context: options.auditContext })

      return {
        id: raw.id,
        tenantId: raw.tenantId,
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

    // Decrypt the value with tenant's key
    const value = await this.decryptForTenant(tenantId, raw.encryptedValue, raw.iv, raw.type)

    // Audit log
    this.logAudit(tenantId, name, 'read', { context: options?.auditContext })

    return {
      id: raw.id,
      tenantId: raw.tenantId,
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
   * Rotate a credential for a tenant
   */
  async rotate(tenantId: string, name: string, options: TenantRotationOptions): Promise<void> {
    this.validateTenantId(tenantId)

    const tenantCreds = this.getTenantCredentials(tenantId)
    const raw = tenantCreds.get(name)

    if (!raw || raw.deletedAt) {
      throw new Error(`Credential '${name}' not found for tenant '${tenantId}'`)
    }

    // Verify tenant ownership
    this.assertTenantOwnership(raw, tenantId, name)

    const previousVersion = raw.version

    // Encrypt new value with tenant's key
    const { encryptedValue, iv } = await this.encryptForTenant(tenantId, options.newValue)

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
    const versionKey = `${tenantId}:${name}`
    const credVersions = this.versions.get(versionKey)!
    credVersions.push({ version: raw.version, encryptedValue, iv, createdAt: raw.updatedAt })
    this.enforceVersionRetention(tenantId, name)

    // Audit log
    this.logAudit(tenantId, name, 'rotate', {
      actor: options.actor,
      reason: options.reason,
      metadata: { previousVersion, newVersion: raw.version },
    })

    this.emit('credential:rotated', { tenantId, name, version: raw.version })
  }

  /**
   * Delete a credential for a tenant
   */
  async delete(tenantId: string, name: string, options?: TenantDeleteOptions): Promise<void> {
    this.validateTenantId(tenantId)

    const tenantCreds = this.getTenantCredentials(tenantId)
    const raw = tenantCreds.get(name)

    if (!raw) {
      throw new Error(`Credential '${name}' not found for tenant '${tenantId}'`)
    }

    // Verify tenant ownership
    this.assertTenantOwnership(raw, tenantId, name)

    if (options?.hard) {
      // Hard delete - remove completely
      tenantCreds.delete(name)
      this.versions.delete(`${tenantId}:${name}`)
    } else {
      // Soft delete
      raw.deletedAt = new Date()
    }

    // Audit log
    this.logAudit(tenantId, name, 'delete', {
      actor: options?.actor,
      reason: options?.reason,
      metadata: { hard: options?.hard },
    })

    this.emit('credential:deleted', { tenantId, name })
  }

  /**
   * List credentials for a tenant
   */
  async list(tenantId: string, options?: TenantListOptions): Promise<TenantCredential[]> {
    this.validateTenantId(tenantId)

    const tenantCreds = this.getTenantCredentials(tenantId)
    const results: TenantCredential[] = []

    for (const raw of tenantCreds.values()) {
      // Skip deleted
      if (raw.deletedAt) continue

      // Verify tenant ownership (should always match, but defense in depth)
      if (raw.tenantId !== tenantId) continue

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
        tenantId: raw.tenantId,
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

    // Pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? results.length

    return results.slice(offset, offset + limit)
  }

  /**
   * List versions of a credential for a tenant
   */
  async listVersions(tenantId: string, name: string): Promise<CredentialVersion[]> {
    this.validateTenantId(tenantId)

    // Verify the credential exists and belongs to tenant
    const tenantCreds = this.getTenantCredentials(tenantId)
    const raw = tenantCreds.get(name)
    if (raw) {
      this.assertTenantOwnership(raw, tenantId, name)
    }

    const versionKey = `${tenantId}:${name}`
    const credVersions = this.versions.get(versionKey)
    if (!credVersions) {
      return []
    }
    return [...credVersions]
  }

  // ===========================================================================
  // Tenant Key Management
  // ===========================================================================

  /**
   * Rotate the encryption key for a tenant
   * This re-encrypts all credentials with a new derived key
   */
  async rotateTenantKey(tenantId: string): Promise<void> {
    this.validateTenantId(tenantId)

    const state = await this.ensureTenantState(tenantId)
    const oldKey = state.derivedKey
    const oldKeyVersion = state.keyVersion

    // Derive new key
    const newKeyVersion = oldKeyVersion + 1
    const newKey = await this.deriveTenantKey(tenantId, newKeyVersion)

    // Re-encrypt all credentials
    const tenantCreds = this.getTenantCredentials(tenantId)
    for (const raw of tenantCreds.values()) {
      if (raw.deletedAt) continue

      // Decrypt with old key
      const ivBuffer = new Uint8Array(base64ToBuffer(raw.iv))
      const dataBuffer = base64ToBuffer(raw.encryptedValue)
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuffer }, oldKey, dataBuffer)

      // Re-encrypt with new key
      const newIv = generateIV()
      const reEncrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: newIv }, newKey, decrypted)

      raw.encryptedValue = bufferToBase64(reEncrypted)
      raw.iv = bufferToBase64(newIv.buffer as ArrayBuffer)
      raw.updatedAt = new Date()
    }

    // Update tenant state
    state.derivedKey = newKey
    state.keyVersion = newKeyVersion
    state.lastRotatedAt = new Date()

    // Audit log
    this.logAudit(tenantId, '*', 'tenant_key_rotate', {
      metadata: { oldKeyVersion, newKeyVersion },
    })

    this.emit('tenant:key_rotated', { tenantId, keyVersion: newKeyVersion })
  }

  // ===========================================================================
  // Access Tokens
  // ===========================================================================

  /**
   * Create an access token for a tenant
   */
  async createAccessToken(tenantId: string, options: TenantAccessTokenOptions): Promise<TenantAccessToken> {
    this.validateTenantId(tenantId)

    const token: TenantAccessToken = {
      id: generateId(),
      tenantId,
      token: generateToken(),
      credentials: options.credentials ?? [],
      scopes: options.scopes,
      permissions: options.permissions,
      expiresAt: new Date(Date.now() + parseDuration(options.expiresIn)),
      createdAt: new Date(),
    }

    let tenantTokens = this.tenantAccessTokens.get(tenantId)
    if (!tenantTokens) {
      tenantTokens = new Map()
      this.tenantAccessTokens.set(tenantId, tenantTokens)
    }
    tenantTokens.set(token.token, token)

    return token
  }

  /**
   * Get credential using access token
   */
  async getWithToken(tenantId: string, tokenStr: string, name: string): Promise<TenantCredential | null> {
    this.validateTenantId(tenantId)

    const tenantTokens = this.tenantAccessTokens.get(tenantId)
    const accessToken = tenantTokens?.get(tokenStr)

    // Validate token
    if (!accessToken) {
      throw new Error('Invalid access token')
    }

    // Verify token belongs to this tenant
    if (accessToken.tenantId !== tenantId) {
      this.logAudit(tenantId, name, 'cross_tenant_attempt', {
        context: { attemptedTenantId: accessToken.tenantId },
      })
      throw new Error('Access denied: token does not belong to this tenant')
    }

    if (accessToken.revokedAt) {
      throw new Error('Access token has been revoked')
    }

    if (accessToken.expiresAt.getTime() < Date.now()) {
      throw new Error('Access token has expired')
    }

    // Check permissions
    if (!accessToken.permissions.includes('read') && !accessToken.permissions.includes('admin')) {
      this.logAudit(tenantId, name, 'access_denied', {
        metadata: { reason: 'insufficient_permissions' },
      })
      throw new Error('Access denied: read permission required')
    }

    // Check if credential is in token scope
    if (accessToken.credentials.length > 0 && !accessToken.credentials.includes(name)) {
      this.logAudit(tenantId, name, 'access_denied', {
        metadata: { reason: 'credential_not_in_scope' },
      })
      throw new Error('Access denied: credential not in token scope')
    }

    return this.get(tenantId, name)
  }

  /**
   * Revoke an access token
   */
  async revokeAccessToken(tenantId: string, tokenId: string): Promise<void> {
    this.validateTenantId(tenantId)

    const tenantTokens = this.tenantAccessTokens.get(tenantId)
    if (!tenantTokens) {
      throw new Error('Access token not found')
    }

    for (const token of tenantTokens.values()) {
      if (token.id === tokenId) {
        // Verify token belongs to this tenant
        if (token.tenantId !== tenantId) {
          throw new Error('Access denied: cannot revoke token from another tenant')
        }
        token.revokedAt = new Date()
        return
      }
    }

    throw new Error('Access token not found')
  }

  // ===========================================================================
  // Audit Log Access
  // ===========================================================================

  /**
   * Get audit log entries for a tenant
   */
  async getAuditLog(tenantId: string, credentialName: string, options?: TenantAuditLogOptions): Promise<TenantAuditLogEntry[]> {
    this.validateTenantId(tenantId)

    const logs = this.tenantAuditLogs.get(tenantId) ?? []

    let entries = logs.filter((l) => l.credentialName === credentialName || credentialName === '*')

    // Apply filters
    if (options?.action) {
      entries = entries.filter((l) => l.action === options.action)
    }
    if (options?.since) {
      entries = entries.filter((l) => l.timestamp >= options.since!)
    }
    if (options?.until) {
      entries = entries.filter((l) => l.timestamp <= options.until!)
    }

    // Sort by timestamp descending
    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    // Pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? entries.length

    return entries.slice(offset, offset + limit)
  }

  // ===========================================================================
  // Tenant Statistics
  // ===========================================================================

  /**
   * Get statistics for a tenant
   */
  async getTenantStats(tenantId: string): Promise<TenantStats> {
    this.validateTenantId(tenantId)

    const tenantCreds = this.getTenantCredentials(tenantId)
    const logs = this.tenantAuditLogs.get(tenantId) ?? []
    const state = this.tenantStates.get(tenantId)

    let credentialCount = 0
    for (const cred of tenantCreds.values()) {
      if (!cred.deletedAt) {
        credentialCount++
      }
    }

    return {
      tenantId,
      credentialCount,
      keyVersion: state?.keyVersion ?? 1,
      createdAt: state?.createdAt ?? new Date(),
      lastRotatedAt: state?.lastRotatedAt,
      auditLogCount: logs.length,
    }
  }

  /**
   * List all tenants
   */
  async listTenants(): Promise<string[]> {
    return Array.from(this.tenantCredentials.keys())
  }

  /**
   * Check if a tenant exists
   */
  async tenantExists(tenantId: string): Promise<boolean> {
    return this.tenantCredentials.has(tenantId)
  }

  // ===========================================================================
  // Export/Import
  // ===========================================================================

  /**
   * Export all credentials for a tenant (encrypted)
   */
  async exportTenant(tenantId: string): Promise<string> {
    this.validateTenantId(tenantId)

    const tenantCreds = this.getTenantCredentials(tenantId)
    const state = this.tenantStates.get(tenantId)

    const credentials: Array<{
      name: string
      type: CredentialType
      encryptedValue: string
      iv: string
      metadata?: CredentialMetadata
      rotation?: RotationPolicy
      scopes?: string[]
    }> = []

    for (const raw of tenantCreds.values()) {
      if (raw.deletedAt) continue

      credentials.push({
        name: raw.name,
        type: raw.type,
        encryptedValue: raw.encryptedValue,
        iv: raw.iv,
        metadata: raw.metadata,
        rotation: raw.rotation,
        scopes: raw.scopes,
      })
    }

    return JSON.stringify({
      tenantId,
      keyVersion: state?.keyVersion ?? 1,
      credentials,
      exportedAt: new Date().toISOString(),
    })
  }

  /**
   * Import credentials for a tenant
   * Note: The tenant must have the same derived key as when exported
   */
  async importTenant(data: string): Promise<void> {
    const parsed = JSON.parse(data)
    const tenantId = parsed.tenantId

    this.validateTenantId(tenantId)

    // Ensure tenant state exists
    await this.ensureTenantState(tenantId)
    const tenantCreds = this.getTenantCredentials(tenantId)

    for (const cred of parsed.credentials) {
      if (tenantCreds.has(cred.name)) {
        throw new Error(`Credential '${cred.name}' already exists for tenant '${tenantId}'`)
      }

      const now = new Date()
      const raw: RawTenantCredential = {
        id: generateId(),
        tenantId,
        name: cred.name,
        type: cred.type,
        encryptedValue: cred.encryptedValue,
        iv: cred.iv,
        metadata: cred.metadata,
        rotation: cred.rotation,
        scopes: cred.scopes,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }

      tenantCreds.set(cred.name, raw)
      this.versions.set(`${tenantId}:${cred.name}`, [{ version: 1, encryptedValue: raw.encryptedValue, iv: raw.iv, createdAt: now }])
    }
  }
}

/**
 * Factory function to create a MultiTenantCredentialVault instance
 */
export function createMultiTenantVault(config: MultiTenantVaultConfig): MultiTenantCredentialVault {
  return new MultiTenantCredentialVault(config)
}
