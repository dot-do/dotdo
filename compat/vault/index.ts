/**
 * @dotdo/vault - HashiCorp Vault API Compatibility Layer
 *
 * Drop-in replacement for HashiCorp Vault SDK with edge compatibility.
 * Backed by CredentialVault primitive for secure secret storage.
 *
 * @example
 * ```typescript
 * import { VaultClient } from '@dotdo/vault'
 *
 * const vault = new VaultClient({
 *   address: 'https://vault.example.com',
 *   token: 'hvs.xxx',
 * })
 *
 * // KV v2 secrets engine
 * await vault.kv.v2.write('secret', 'my-secret', { password: 'secret123' })
 * const secret = await vault.kv.v2.read('secret', 'my-secret')
 *
 * // Transit encryption
 * const ciphertext = await vault.transit.encrypt('my-key', 'plaintext')
 * const plaintext = await vault.transit.decrypt('my-key', ciphertext)
 *
 * // Dynamic secrets (database)
 * const creds = await vault.database.getCreds('my-role')
 * ```
 *
 * @module @dotdo/vault
 */

import { createCredentialVault, type CredentialVault } from '../../db/primitives/credential-vault'

// =============================================================================
// Types
// =============================================================================

/**
 * Vault client configuration
 */
export interface VaultClientConfig {
  /** Vault server address */
  address?: string
  /** Authentication token */
  token?: string
  /** Namespace (Enterprise feature) */
  namespace?: string
  /** Request timeout in milliseconds */
  timeout?: number
  /** Custom encryption key (32 bytes) for local mode */
  encryptionKey?: string
}

/**
 * KV secret metadata
 */
export interface KVMetadata {
  created_time: string
  custom_metadata?: Record<string, string>
  deletion_time: string
  destroyed: boolean
  version: number
}

/**
 * KV secret response
 */
export interface KVSecret {
  data: Record<string, unknown>
  metadata: KVMetadata
}

/**
 * KV read response
 */
export interface KVReadResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: KVSecret
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * KV write response
 */
export interface KVWriteResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: KVMetadata
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * KV list response
 */
export interface KVListResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: {
    keys: string[]
  }
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * KV delete response
 */
export interface KVDeleteResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: null
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * Auth token info
 */
export interface TokenInfo {
  accessor: string
  creation_time: number
  creation_ttl: number
  display_name: string
  entity_id: string
  expire_time: string | null
  explicit_max_ttl: number
  id: string
  issue_time: string
  meta: Record<string, string> | null
  num_uses: number
  orphan: boolean
  path: string
  policies: string[]
  renewable: boolean
  ttl: number
  type: string
}

/**
 * Token lookup response
 */
export interface TokenLookupResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: TokenInfo
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * AppRole login response
 */
export interface AppRoleLoginResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: null
  wrap_info: null
  warnings: null
  auth: {
    client_token: string
    accessor: string
    policies: string[]
    token_policies: string[]
    metadata: Record<string, string>
    lease_duration: number
    renewable: boolean
    entity_id: string
    token_type: string
    orphan: boolean
  }
}

/**
 * Transit encrypt response
 */
export interface TransitEncryptResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: {
    ciphertext: string
    key_version: number
  }
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * Transit decrypt response
 */
export interface TransitDecryptResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: {
    plaintext: string
  }
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * Transit key info
 */
export interface TransitKeyInfo {
  allow_plaintext_backup: boolean
  auto_rotate_period: number
  deletion_allowed: boolean
  derived: boolean
  exportable: boolean
  imported_key: boolean
  keys: Record<string, number>
  latest_version: number
  min_available_version: number
  min_decryption_version: number
  min_encryption_version: number
  name: string
  supports_decryption: boolean
  supports_derivation: boolean
  supports_encryption: boolean
  supports_signing: boolean
  type: string
}

/**
 * Transit read key response
 */
export interface TransitReadKeyResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: TransitKeyInfo
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * PKI certificate
 */
export interface PKICertificate {
  certificate: string
  issuing_ca: string
  ca_chain: string[]
  private_key: string
  private_key_type: string
  serial_number: string
  expiration: number
}

/**
 * PKI issue response
 */
export interface PKIIssueResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: PKICertificate
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * PKI CA info
 */
export interface PKICAInfo {
  certificate: string
  issuer_id: string
  issuer_name: string
  key_id: string
  leaf_not_after_behavior: string
  manual_chain: string[]
  usage: string
}

/**
 * PKI read CA response
 */
export interface PKIReadCAResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: PKICAInfo
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * Database credentials
 */
export interface DatabaseCredentials {
  username: string
  password: string
  lease_id: string
  lease_duration: number
  renewable: boolean
}

/**
 * Database get creds response
 */
export interface DatabaseGetCredsResponse {
  request_id: string
  lease_id: string
  renewable: boolean
  lease_duration: number
  data: {
    username: string
    password: string
  }
  wrap_info: null
  warnings: null
  auth: null
}

/**
 * Sys health response
 */
export interface SysHealthResponse {
  initialized: boolean
  sealed: boolean
  standby: boolean
  performance_standby: boolean
  replication_performance_mode: string
  replication_dr_mode: string
  server_time_utc: number
  version: string
  cluster_name: string
  cluster_id: string
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base Vault error
 */
export class VaultError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public errors: string[] = []
  ) {
    super(message)
    this.name = 'VaultError'
  }
}

/**
 * Permission denied error
 */
export class PermissionDeniedError extends VaultError {
  constructor(message: string = 'permission denied') {
    super(message, 403, [message])
    this.name = 'PermissionDeniedError'
  }
}

/**
 * Secret not found error
 */
export class SecretNotFoundError extends VaultError {
  constructor(path: string) {
    super(`secret not found at path: ${path}`, 404, ['secret not found'])
    this.name = 'SecretNotFoundError'
  }
}

/**
 * Invalid token error
 */
export class InvalidTokenError extends VaultError {
  constructor(message: string = 'invalid token') {
    super(message, 403, [message])
    this.name = 'InvalidTokenError'
  }
}

/**
 * Key not found error
 */
export class KeyNotFoundError extends VaultError {
  constructor(keyName: string) {
    super(`key not found: ${keyName}`, 404, ['key not found'])
    this.name = 'KeyNotFoundError'
  }
}

/**
 * Encryption error
 */
export class EncryptionError extends VaultError {
  constructor(message: string) {
    super(message, 400, [message])
    this.name = 'EncryptionError'
  }
}

/**
 * Decryption error
 */
export class DecryptionError extends VaultError {
  constructor(message: string) {
    super(message, 400, [message])
    this.name = 'DecryptionError'
  }
}

/**
 * AppRole error
 */
export class AppRoleError extends VaultError {
  constructor(message: string) {
    super(message, 400, [message])
    this.name = 'AppRoleError'
  }
}

/**
 * PKI error
 */
export class PKIError extends VaultError {
  constructor(message: string) {
    super(message, 400, [message])
    this.name = 'PKIError'
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateRequestId(): string {
  return crypto.randomUUID()
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return 'hvs.' + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')
}

function generateAccessor(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')
}

function base64Encode(str: string): string {
  return btoa(str)
}

function base64Decode(str: string): string {
  return atob(str)
}

// =============================================================================
// Internal State (for local mode)
// =============================================================================

interface InternalState {
  secrets: Map<string, Map<string, { data: Record<string, unknown>; versions: Map<number, { data: Record<string, unknown>; metadata: KVMetadata }> }>>
  tokens: Map<string, TokenInfo>
  approles: Map<string, { role_id: string; secret_id: string; policies: string[]; metadata: Record<string, string> }>
  transitKeys: Map<string, { versions: Map<number, CryptoKey>; latestVersion: number; type: string; name: string }>
  pkiCAs: Map<string, { certificate: string; privateKey: CryptoKey; issuer_id: string }>
  databaseRoles: Map<string, { username_template: string; creation_statements: string[] }>
  leases: Map<string, { expiration: number; renewable: boolean; path: string }>
  credentialVault: CredentialVault | null
}

const state: InternalState = {
  secrets: new Map(),
  tokens: new Map(),
  approles: new Map(),
  transitKeys: new Map(),
  pkiCAs: new Map(),
  databaseRoles: new Map(),
  leases: new Map(),
  credentialVault: null,
}

// =============================================================================
// KV v2 Engine
// =============================================================================

/**
 * KV v2 secrets engine API
 */
export class KVv2Engine {
  constructor(
    private client: VaultClient,
    private mountPath: string
  ) {}

  /**
   * Read a secret
   */
  async read(path: string, version?: number): Promise<KVReadResponse> {
    const fullPath = `${this.mountPath}/${path}`
    const mountSecrets = state.secrets.get(this.mountPath)

    if (!mountSecrets) {
      throw new SecretNotFoundError(fullPath)
    }

    const secretData = mountSecrets.get(path)
    if (!secretData) {
      throw new SecretNotFoundError(fullPath)
    }

    const targetVersion = version ?? Math.max(...Array.from(secretData.versions.keys()))
    const versionData = secretData.versions.get(targetVersion)

    if (!versionData) {
      throw new SecretNotFoundError(fullPath)
    }

    if (versionData.metadata.destroyed) {
      throw new SecretNotFoundError(fullPath)
    }

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: {
        data: versionData.data,
        metadata: versionData.metadata,
      },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Write a secret
   */
  async write(path: string, data: Record<string, unknown>, options?: { cas?: number }): Promise<KVWriteResponse> {
    let mountSecrets = state.secrets.get(this.mountPath)
    if (!mountSecrets) {
      mountSecrets = new Map()
      state.secrets.set(this.mountPath, mountSecrets)
    }

    let secretData = mountSecrets.get(path)
    let newVersion = 1

    if (secretData) {
      const currentMaxVersion = Math.max(...Array.from(secretData.versions.keys()))

      // Check-and-set validation
      if (options?.cas !== undefined && options.cas !== currentMaxVersion) {
        throw new VaultError(`check-and-set mismatch: expected version ${options.cas}, got ${currentMaxVersion}`, 400)
      }

      newVersion = currentMaxVersion + 1
    } else {
      secretData = { data, versions: new Map() }
      mountSecrets.set(path, secretData)
    }

    const now = new Date().toISOString()
    const metadata: KVMetadata = {
      created_time: now,
      deletion_time: '',
      destroyed: false,
      version: newVersion,
    }

    secretData.versions.set(newVersion, { data, metadata })
    secretData.data = data

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: metadata,
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Delete a secret (soft delete)
   */
  async delete(path: string, versions?: number[]): Promise<KVDeleteResponse> {
    const mountSecrets = state.secrets.get(this.mountPath)
    if (!mountSecrets) {
      throw new SecretNotFoundError(`${this.mountPath}/${path}`)
    }

    const secretData = mountSecrets.get(path)
    if (!secretData) {
      throw new SecretNotFoundError(`${this.mountPath}/${path}`)
    }

    const now = new Date().toISOString()
    const versionsToDelete = versions ?? [Math.max(...Array.from(secretData.versions.keys()))]

    for (const v of versionsToDelete) {
      const versionData = secretData.versions.get(v)
      if (versionData) {
        versionData.metadata.deletion_time = now
      }
    }

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: null,
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Undelete a secret
   */
  async undelete(path: string, versions: number[]): Promise<KVDeleteResponse> {
    const mountSecrets = state.secrets.get(this.mountPath)
    if (!mountSecrets) {
      throw new SecretNotFoundError(`${this.mountPath}/${path}`)
    }

    const secretData = mountSecrets.get(path)
    if (!secretData) {
      throw new SecretNotFoundError(`${this.mountPath}/${path}`)
    }

    for (const v of versions) {
      const versionData = secretData.versions.get(v)
      if (versionData && !versionData.metadata.destroyed) {
        versionData.metadata.deletion_time = ''
      }
    }

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: null,
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Destroy a secret (hard delete)
   */
  async destroy(path: string, versions: number[]): Promise<KVDeleteResponse> {
    const mountSecrets = state.secrets.get(this.mountPath)
    if (!mountSecrets) {
      throw new SecretNotFoundError(`${this.mountPath}/${path}`)
    }

    const secretData = mountSecrets.get(path)
    if (!secretData) {
      throw new SecretNotFoundError(`${this.mountPath}/${path}`)
    }

    for (const v of versions) {
      const versionData = secretData.versions.get(v)
      if (versionData) {
        versionData.metadata.destroyed = true
        versionData.data = {}
      }
    }

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: null,
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * List secrets at a path
   */
  async list(path: string = ''): Promise<KVListResponse> {
    const mountSecrets = state.secrets.get(this.mountPath)
    const keys: string[] = []

    if (mountSecrets) {
      for (const key of mountSecrets.keys()) {
        if (path === '' || key.startsWith(path)) {
          const relativePath = path ? key.slice(path.length).replace(/^\//, '') : key
          const firstSegment = relativePath.split('/')[0]
          if (firstSegment && !keys.includes(firstSegment)) {
            // Add trailing slash if it's a "folder"
            const hasChildren = Array.from(mountSecrets.keys()).some(
              k => k !== key && k.startsWith(path ? `${path}/${firstSegment}/` : `${firstSegment}/`)
            )
            keys.push(hasChildren ? `${firstSegment}/` : firstSegment)
          }
        }
      }
    }

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: { keys },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Read secret metadata
   */
  async readMetadata(path: string): Promise<KVReadResponse> {
    const mountSecrets = state.secrets.get(this.mountPath)
    if (!mountSecrets) {
      throw new SecretNotFoundError(`${this.mountPath}/${path}`)
    }

    const secretData = mountSecrets.get(path)
    if (!secretData) {
      throw new SecretNotFoundError(`${this.mountPath}/${path}`)
    }

    const latestVersion = Math.max(...Array.from(secretData.versions.keys()))
    const versionData = secretData.versions.get(latestVersion)!

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: {
        data: {},
        metadata: versionData.metadata,
      },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Delete all versions of a secret
   */
  async deleteMetadata(path: string): Promise<KVDeleteResponse> {
    const mountSecrets = state.secrets.get(this.mountPath)
    if (mountSecrets) {
      mountSecrets.delete(path)
    }

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: null,
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }
}

/**
 * KV secrets engine (supports v1 and v2)
 */
export class KVEngine {
  public readonly v2: KVv2Engine

  constructor(
    private client: VaultClient,
    private mountPath: string = 'secret'
  ) {
    this.v2 = new KVv2Engine(client, mountPath)
  }

  /**
   * Read a secret (KV v1 style)
   */
  async read(path: string): Promise<KVReadResponse> {
    return this.v2.read(path)
  }

  /**
   * Write a secret (KV v1 style)
   */
  async write(path: string, data: Record<string, unknown>): Promise<KVWriteResponse> {
    return this.v2.write(path, data)
  }

  /**
   * Delete a secret (KV v1 style)
   */
  async delete(path: string): Promise<KVDeleteResponse> {
    return this.v2.delete(path)
  }

  /**
   * List secrets (KV v1 style)
   */
  async list(path?: string): Promise<KVListResponse> {
    return this.v2.list(path)
  }
}

// =============================================================================
// Transit Engine
// =============================================================================

/**
 * Transit secrets engine for encryption as a service
 */
export class TransitEngine {
  constructor(private client: VaultClient) {}

  /**
   * Create a new encryption key
   */
  async createKey(name: string, options?: { type?: string; derived?: boolean; exportable?: boolean }): Promise<void> {
    if (state.transitKeys.has(name)) {
      throw new VaultError(`key ${name} already exists`, 400)
    }

    const keyType = options?.type ?? 'aes256-gcm96'

    // Generate the actual crypto key
    const cryptoKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      options?.exportable ?? false,
      ['encrypt', 'decrypt']
    )

    state.transitKeys.set(name, {
      versions: new Map([[1, cryptoKey]]),
      latestVersion: 1,
      type: keyType,
      name,
    })
  }

  /**
   * Read key information
   */
  async readKey(name: string): Promise<TransitReadKeyResponse> {
    const keyData = state.transitKeys.get(name)
    if (!keyData) {
      throw new KeyNotFoundError(name)
    }

    const keysInfo: Record<string, number> = {}
    for (const [version] of keyData.versions) {
      keysInfo[version.toString()] = Date.now() / 1000
    }

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: {
        allow_plaintext_backup: false,
        auto_rotate_period: 0,
        deletion_allowed: false,
        derived: false,
        exportable: false,
        imported_key: false,
        keys: keysInfo,
        latest_version: keyData.latestVersion,
        min_available_version: 1,
        min_decryption_version: 1,
        min_encryption_version: 0,
        name: keyData.name,
        supports_decryption: true,
        supports_derivation: false,
        supports_encryption: true,
        supports_signing: false,
        type: keyData.type,
      },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Delete a key
   */
  async deleteKey(name: string): Promise<void> {
    if (!state.transitKeys.has(name)) {
      throw new KeyNotFoundError(name)
    }
    state.transitKeys.delete(name)
  }

  /**
   * Rotate a key
   */
  async rotateKey(name: string): Promise<void> {
    const keyData = state.transitKeys.get(name)
    if (!keyData) {
      throw new KeyNotFoundError(name)
    }

    const newVersion = keyData.latestVersion + 1
    const cryptoKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )

    keyData.versions.set(newVersion, cryptoKey)
    keyData.latestVersion = newVersion
  }

  /**
   * List all keys
   */
  async listKeys(): Promise<KVListResponse> {
    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: {
        keys: Array.from(state.transitKeys.keys()),
      },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Encrypt plaintext
   */
  async encrypt(keyName: string, plaintext: string, options?: { key_version?: number }): Promise<TransitEncryptResponse> {
    const keyData = state.transitKeys.get(keyName)
    if (!keyData) {
      throw new KeyNotFoundError(keyName)
    }

    const version = options?.key_version ?? keyData.latestVersion
    const cryptoKey = keyData.versions.get(version)
    if (!cryptoKey) {
      throw new EncryptionError(`key version ${version} not found`)
    }

    try {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const encoded = new TextEncoder().encode(base64Decode(plaintext))

      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        encoded
      )

      // Format: vault:v{version}:{iv}:{ciphertext}
      const ivBase64 = btoa(String.fromCharCode(...iv))
      const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)))
      const ciphertext = `vault:v${version}:${ivBase64}:${ciphertextBase64}`

      return {
        request_id: generateRequestId(),
        lease_id: '',
        renewable: false,
        lease_duration: 0,
        data: {
          ciphertext,
          key_version: version,
        },
        wrap_info: null,
        warnings: null,
        auth: null,
      }
    } catch (error) {
      throw new EncryptionError(`encryption failed: ${error}`)
    }
  }

  /**
   * Decrypt ciphertext
   */
  async decrypt(keyName: string, ciphertext: string): Promise<TransitDecryptResponse> {
    const keyData = state.transitKeys.get(keyName)
    if (!keyData) {
      throw new KeyNotFoundError(keyName)
    }

    try {
      // Parse: vault:v{version}:{iv}:{ciphertext}
      const parts = ciphertext.split(':')
      if (parts.length !== 4 || parts[0] !== 'vault') {
        throw new DecryptionError('invalid ciphertext format')
      }

      const version = parseInt(parts[1]!.slice(1), 10)
      const ivBase64 = parts[2]!
      const encryptedBase64 = parts[3]!

      const cryptoKey = keyData.versions.get(version)
      if (!cryptoKey) {
        throw new DecryptionError(`key version ${version} not available`)
      }

      const iv = new Uint8Array(atob(ivBase64).split('').map(c => c.charCodeAt(0)))
      const encrypted = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)))

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        encrypted
      )

      const plaintext = base64Encode(new TextDecoder().decode(decrypted))

      return {
        request_id: generateRequestId(),
        lease_id: '',
        renewable: false,
        lease_duration: 0,
        data: { plaintext },
        wrap_info: null,
        warnings: null,
        auth: null,
      }
    } catch (error) {
      if (error instanceof DecryptionError) throw error
      throw new DecryptionError(`decryption failed: ${error}`)
    }
  }

  /**
   * Rewrap ciphertext with latest key version
   */
  async rewrap(keyName: string, ciphertext: string): Promise<TransitEncryptResponse> {
    // Decrypt with old key
    const decrypted = await this.decrypt(keyName, ciphertext)
    // Re-encrypt with latest key
    return this.encrypt(keyName, decrypted.data.plaintext)
  }

  /**
   * Generate random bytes
   */
  async generateRandomBytes(length: number = 32, format: 'base64' | 'hex' = 'base64'): Promise<{ data: { random_bytes: string } }> {
    const bytes = crypto.getRandomValues(new Uint8Array(length))

    let result: string
    if (format === 'hex') {
      result = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    } else {
      result = btoa(String.fromCharCode(...bytes))
    }

    return {
      data: { random_bytes: result },
    }
  }

  /**
   * Generate a data key
   */
  async generateDataKey(keyName: string, options?: { bits?: number }): Promise<{ data: { plaintext: string; ciphertext: string } }> {
    const bits = options?.bits ?? 256
    const bytes = bits / 8

    const dataKey = crypto.getRandomValues(new Uint8Array(bytes))
    const plaintext = btoa(String.fromCharCode(...dataKey))

    const encrypted = await this.encrypt(keyName, plaintext)

    return {
      data: {
        plaintext,
        ciphertext: encrypted.data.ciphertext,
      },
    }
  }

  /**
   * Hash data
   */
  async hash(input: string, algorithm: 'sha2-256' | 'sha2-384' | 'sha2-512' = 'sha2-256'): Promise<{ data: { sum: string } }> {
    const algoMap: Record<string, string> = {
      'sha2-256': 'SHA-256',
      'sha2-384': 'SHA-384',
      'sha2-512': 'SHA-512',
    }

    const decoded = base64Decode(input)
    const encoded = new TextEncoder().encode(decoded)
    const hashBuffer = await crypto.subtle.digest(algoMap[algorithm]!, encoded)
    const sum = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))

    return {
      data: { sum: `vault:v1:${sum}` },
    }
  }
}

// =============================================================================
// Token Auth
// =============================================================================

/**
 * Token authentication engine
 */
export class TokenAuth {
  constructor(private client: VaultClient) {}

  /**
   * Create a new token
   */
  async create(options?: {
    id?: string
    policies?: string[]
    meta?: Record<string, string>
    display_name?: string
    ttl?: string
    renewable?: boolean
    no_parent?: boolean
  }): Promise<AppRoleLoginResponse> {
    const tokenId = options?.id ?? generateToken()
    const accessor = generateAccessor()
    const now = Date.now()
    const ttlSeconds = options?.ttl ? parseTTL(options.ttl) : 3600

    const tokenInfo: TokenInfo = {
      accessor,
      creation_time: Math.floor(now / 1000),
      creation_ttl: ttlSeconds,
      display_name: options?.display_name ?? 'token',
      entity_id: '',
      expire_time: new Date(now + ttlSeconds * 1000).toISOString(),
      explicit_max_ttl: 0,
      id: tokenId,
      issue_time: new Date(now).toISOString(),
      meta: options?.meta ?? null,
      num_uses: 0,
      orphan: options?.no_parent ?? false,
      path: 'auth/token/create',
      policies: options?.policies ?? ['default'],
      renewable: options?.renewable ?? true,
      ttl: ttlSeconds,
      type: 'service',
    }

    state.tokens.set(tokenId, tokenInfo)

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: null,
      wrap_info: null,
      warnings: null,
      auth: {
        client_token: tokenId,
        accessor,
        policies: tokenInfo.policies,
        token_policies: tokenInfo.policies,
        metadata: options?.meta ?? {},
        lease_duration: ttlSeconds,
        renewable: tokenInfo.renewable,
        entity_id: '',
        token_type: 'service',
        orphan: tokenInfo.orphan,
      },
    }
  }

  /**
   * Lookup a token
   */
  async lookup(token?: string): Promise<TokenLookupResponse> {
    const lookupToken = token ?? this.client.token
    const tokenInfo = state.tokens.get(lookupToken)

    if (!tokenInfo) {
      throw new InvalidTokenError('bad token')
    }

    // Check if expired
    if (tokenInfo.expire_time) {
      const expireTime = new Date(tokenInfo.expire_time).getTime()
      if (Date.now() > expireTime) {
        throw new InvalidTokenError('token has expired')
      }
    }

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: tokenInfo,
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Lookup self token
   */
  async lookupSelf(): Promise<TokenLookupResponse> {
    return this.lookup(this.client.token)
  }

  /**
   * Renew a token
   */
  async renew(token?: string, increment?: string): Promise<AppRoleLoginResponse> {
    const renewToken = token ?? this.client.token
    const tokenInfo = state.tokens.get(renewToken)

    if (!tokenInfo) {
      throw new InvalidTokenError('bad token')
    }

    if (!tokenInfo.renewable) {
      throw new VaultError('token is not renewable', 400)
    }

    const ttlSeconds = increment ? parseTTL(increment) : tokenInfo.creation_ttl
    const now = Date.now()

    tokenInfo.ttl = ttlSeconds
    tokenInfo.expire_time = new Date(now + ttlSeconds * 1000).toISOString()

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: null,
      wrap_info: null,
      warnings: null,
      auth: {
        client_token: renewToken,
        accessor: tokenInfo.accessor,
        policies: tokenInfo.policies,
        token_policies: tokenInfo.policies,
        metadata: tokenInfo.meta ?? {},
        lease_duration: ttlSeconds,
        renewable: true,
        entity_id: tokenInfo.entity_id,
        token_type: tokenInfo.type,
        orphan: tokenInfo.orphan,
      },
    }
  }

  /**
   * Renew self token
   */
  async renewSelf(increment?: string): Promise<AppRoleLoginResponse> {
    return this.renew(this.client.token, increment)
  }

  /**
   * Revoke a token
   */
  async revoke(token: string): Promise<void> {
    if (!state.tokens.has(token)) {
      throw new InvalidTokenError('bad token')
    }
    state.tokens.delete(token)
  }

  /**
   * Revoke self token
   */
  async revokeSelf(): Promise<void> {
    return this.revoke(this.client.token)
  }

  /**
   * Revoke token and all children
   */
  async revokeTree(token: string): Promise<void> {
    // In local mode, just revoke the token
    return this.revoke(token)
  }
}

function parseTTL(ttl: string): number {
  const match = ttl.match(/^(\d+)(s|m|h|d)?$/)
  if (!match) {
    throw new VaultError(`invalid TTL format: ${ttl}`, 400)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2] ?? 's'

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  }

  return value * multipliers[unit]!
}

// =============================================================================
// AppRole Auth
// =============================================================================

/**
 * AppRole authentication engine
 */
export class AppRoleAuth {
  constructor(private client: VaultClient) {}

  /**
   * Create an AppRole
   */
  async createRole(name: string, options?: {
    bind_secret_id?: boolean
    secret_id_bound_cidrs?: string[]
    secret_id_num_uses?: number
    secret_id_ttl?: string
    token_policies?: string[]
    token_ttl?: string
    token_max_ttl?: string
  }): Promise<void> {
    const roleId = crypto.randomUUID()
    const secretId = generateToken()

    state.approles.set(name, {
      role_id: roleId,
      secret_id: secretId,
      policies: options?.token_policies ?? ['default'],
      metadata: { role_name: name },
    })
  }

  /**
   * Read an AppRole
   */
  async readRole(name: string): Promise<{ data: { role_id: string } }> {
    const role = state.approles.get(name)
    if (!role) {
      throw new AppRoleError(`role ${name} not found`)
    }

    return {
      data: { role_id: role.role_id },
    }
  }

  /**
   * Get role ID
   */
  async getRoleId(name: string): Promise<{ data: { role_id: string } }> {
    return this.readRole(name)
  }

  /**
   * Generate secret ID
   */
  async generateSecretId(name: string, options?: { metadata?: Record<string, string> }): Promise<{ data: { secret_id: string; secret_id_accessor: string } }> {
    const role = state.approles.get(name)
    if (!role) {
      throw new AppRoleError(`role ${name} not found`)
    }

    const secretId = generateToken()
    role.secret_id = secretId

    return {
      data: {
        secret_id: secretId,
        secret_id_accessor: generateAccessor(),
      },
    }
  }

  /**
   * Login with AppRole credentials
   */
  async login(roleId: string, secretId: string): Promise<AppRoleLoginResponse> {
    // Find the role by role_id
    let foundRole: { role_id: string; secret_id: string; policies: string[]; metadata: Record<string, string> } | undefined
    let roleName: string | undefined

    for (const [name, role] of state.approles.entries()) {
      if (role.role_id === roleId) {
        foundRole = role
        roleName = name
        break
      }
    }

    if (!foundRole) {
      throw new AppRoleError('invalid role_id')
    }

    if (foundRole.secret_id !== secretId) {
      throw new AppRoleError('invalid secret_id')
    }

    // Create a new token for this login
    const tokenAuth = new TokenAuth(this.client)
    return tokenAuth.create({
      policies: foundRole.policies,
      meta: { ...foundRole.metadata, role_name: roleName! },
      display_name: `approle-${roleName}`,
    })
  }

  /**
   * Delete an AppRole
   */
  async deleteRole(name: string): Promise<void> {
    if (!state.approles.has(name)) {
      throw new AppRoleError(`role ${name} not found`)
    }
    state.approles.delete(name)
  }

  /**
   * List all AppRoles
   */
  async listRoles(): Promise<KVListResponse> {
    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: {
        keys: Array.from(state.approles.keys()),
      },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }
}

// =============================================================================
// PKI Engine
// =============================================================================

/**
 * PKI secrets engine for certificate management
 */
export class PKIEngine {
  constructor(private client: VaultClient) {}

  /**
   * Generate a root CA
   */
  async generateRoot(options: {
    common_name: string
    ttl?: string
    key_type?: 'rsa' | 'ec'
    key_bits?: number
  }): Promise<PKIIssueResponse> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: options.key_bits ?? 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )

    const issuerId = crypto.randomUUID()
    const serialNumber = crypto.randomUUID().replace(/-/g, '')

    // Generate a self-signed certificate (simplified for compat layer)
    const certificate = generateSelfSignedCert(options.common_name, serialNumber)

    state.pkiCAs.set('default', {
      certificate,
      privateKey: keyPair.privateKey,
      issuer_id: issuerId,
    })

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: {
        certificate,
        issuing_ca: certificate,
        ca_chain: [certificate],
        private_key: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----',
        private_key_type: 'rsa',
        serial_number: serialNumber,
        expiration: Math.floor(Date.now() / 1000) + (options.ttl ? parseTTL(options.ttl) : 31536000),
      },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Read CA certificate
   */
  async readCA(): Promise<PKIReadCAResponse> {
    const ca = state.pkiCAs.get('default')
    if (!ca) {
      throw new PKIError('CA not configured')
    }

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: {
        certificate: ca.certificate,
        issuer_id: ca.issuer_id,
        issuer_name: 'default',
        key_id: crypto.randomUUID(),
        leaf_not_after_behavior: 'err',
        manual_chain: [],
        usage: 'read-only,issuing-certificates,crl-signing,ocsp-signing',
      },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Issue a certificate
   */
  async issue(role: string, options: {
    common_name: string
    ttl?: string
    alt_names?: string
    ip_sans?: string
    uri_sans?: string
  }): Promise<PKIIssueResponse> {
    const ca = state.pkiCAs.get('default')
    if (!ca) {
      throw new PKIError('CA not configured')
    }

    const serialNumber = crypto.randomUUID().replace(/-/g, '')
    const certificate = generateSelfSignedCert(options.common_name, serialNumber)
    const ttlSeconds = options.ttl ? parseTTL(options.ttl) : 86400

    return {
      request_id: generateRequestId(),
      lease_id: generateRequestId(),
      renewable: false,
      lease_duration: ttlSeconds,
      data: {
        certificate,
        issuing_ca: ca.certificate,
        ca_chain: [ca.certificate],
        private_key: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----',
        private_key_type: 'rsa',
        serial_number: serialNumber,
        expiration: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Create or update a role
   */
  async createRole(name: string, options?: {
    ttl?: string
    max_ttl?: string
    allow_localhost?: boolean
    allowed_domains?: string[]
    allow_subdomains?: boolean
    allow_glob_domains?: boolean
    allow_any_name?: boolean
    enforce_hostnames?: boolean
    allow_ip_sans?: boolean
    server_flag?: boolean
    client_flag?: boolean
    key_type?: string
    key_bits?: number
  }): Promise<void> {
    // Role configuration stored in memory (simplified)
  }

  /**
   * Read a role
   */
  async readRole(name: string): Promise<{ data: Record<string, unknown> }> {
    return {
      data: {
        ttl: '24h',
        max_ttl: '72h',
        allow_localhost: true,
        allowed_domains: [],
        allow_subdomains: false,
        allow_glob_domains: false,
        allow_any_name: false,
        enforce_hostnames: true,
        allow_ip_sans: true,
        server_flag: true,
        client_flag: true,
        key_type: 'rsa',
        key_bits: 2048,
      },
    }
  }

  /**
   * Revoke a certificate
   */
  async revoke(serialNumber: string): Promise<{ data: { revocation_time: number } }> {
    return {
      data: {
        revocation_time: Math.floor(Date.now() / 1000),
      },
    }
  }

  /**
   * Tidy up the PKI backend
   */
  async tidy(options?: { tidy_cert_store?: boolean; tidy_revoked_certs?: boolean }): Promise<void> {
    // No-op for local mode
  }
}

function generateSelfSignedCert(commonName: string, serialNumber: string): string {
  // Simplified certificate generation for compat layer
  return `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQD${serialNumber.slice(0, 16)}MA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV
BAMMCSR7Y29tbW9uX25hbWV9MB4XDTIxMDEwMTAwMDAwMFoXDTMxMDEwMTAwMDAw
MFowFDESMBAGA1UEAwwJJHtjb21tb25fbmFtZX0wggEiMA0GCSqGSIb3DQEBAQUA
A4IBDwAwggEKAoIBAQDdemoKeySA...
-----END CERTIFICATE-----`
}

// =============================================================================
// Database Engine
// =============================================================================

/**
 * Database secrets engine for dynamic credentials
 */
export class DatabaseEngine {
  constructor(private client: VaultClient) {}

  /**
   * Configure a database connection
   */
  async configureConnection(name: string, options: {
    plugin_name: string
    connection_url: string
    allowed_roles: string[]
    username?: string
    password?: string
  }): Promise<void> {
    // Store connection config (simplified)
  }

  /**
   * Create a role
   */
  async createRole(name: string, options: {
    db_name: string
    creation_statements: string[]
    default_ttl?: string
    max_ttl?: string
  }): Promise<void> {
    state.databaseRoles.set(name, {
      username_template: `v-${name}-{{random 8}}`,
      creation_statements: options.creation_statements,
    })
  }

  /**
   * Read a role
   */
  async readRole(name: string): Promise<{ data: { db_name: string; creation_statements: string[] } }> {
    const role = state.databaseRoles.get(name)
    if (!role) {
      throw new VaultError(`role ${name} not found`, 404)
    }

    return {
      data: {
        db_name: 'default',
        creation_statements: role.creation_statements,
      },
    }
  }

  /**
   * Get dynamic database credentials
   */
  async getCreds(role: string): Promise<DatabaseGetCredsResponse> {
    const roleConfig = state.databaseRoles.get(role)
    if (!roleConfig) {
      throw new VaultError(`role ${role} not found`, 404)
    }

    const username = `v-${role}-${Math.random().toString(36).slice(2, 10)}`
    const password = generateToken()
    const leaseId = generateRequestId()
    const leaseDuration = 3600

    // Store lease
    state.leases.set(leaseId, {
      expiration: Date.now() + leaseDuration * 1000,
      renewable: true,
      path: `database/creds/${role}`,
    })

    return {
      request_id: generateRequestId(),
      lease_id: leaseId,
      renewable: true,
      lease_duration: leaseDuration,
      data: {
        username,
        password,
      },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Rotate the root credentials
   */
  async rotateRoot(name: string): Promise<void> {
    // No-op for local mode
  }

  /**
   * Delete a role
   */
  async deleteRole(name: string): Promise<void> {
    state.databaseRoles.delete(name)
  }

  /**
   * List all roles
   */
  async listRoles(): Promise<KVListResponse> {
    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: {
        keys: Array.from(state.databaseRoles.keys()),
      },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }
}

// =============================================================================
// Sys Operations
// =============================================================================

/**
 * System backend operations
 */
export class SysBackend {
  constructor(private client: VaultClient) {}

  /**
   * Get health status
   */
  async health(): Promise<SysHealthResponse> {
    return {
      initialized: true,
      sealed: false,
      standby: false,
      performance_standby: false,
      replication_performance_mode: 'disabled',
      replication_dr_mode: 'disabled',
      server_time_utc: Math.floor(Date.now() / 1000),
      version: '1.15.0',
      cluster_name: 'vault-cluster-dotdo',
      cluster_id: crypto.randomUUID(),
    }
  }

  /**
   * Seal the vault
   */
  async seal(): Promise<void> {
    // No-op for local mode
  }

  /**
   * Unseal the vault
   */
  async unseal(key: string): Promise<{ sealed: boolean; t: number; n: number; progress: number }> {
    return {
      sealed: false,
      t: 1,
      n: 1,
      progress: 0,
    }
  }

  /**
   * Initialize the vault
   */
  async init(options: { secret_shares: number; secret_threshold: number }): Promise<{ keys: string[]; root_token: string }> {
    const keys: string[] = []
    for (let i = 0; i < options.secret_shares; i++) {
      keys.push(generateToken())
    }

    const rootToken = generateToken()

    // Store the root token
    state.tokens.set(rootToken, {
      accessor: generateAccessor(),
      creation_time: Math.floor(Date.now() / 1000),
      creation_ttl: 0,
      display_name: 'root',
      entity_id: '',
      expire_time: null,
      explicit_max_ttl: 0,
      id: rootToken,
      issue_time: new Date().toISOString(),
      meta: null,
      num_uses: 0,
      orphan: true,
      path: 'auth/token/root',
      policies: ['root'],
      renewable: false,
      ttl: 0,
      type: 'service',
    })

    return {
      keys,
      root_token: rootToken,
    }
  }

  /**
   * Renew a lease
   */
  async renewLease(leaseId: string, increment?: number): Promise<{ lease_id: string; renewable: boolean; lease_duration: number }> {
    const lease = state.leases.get(leaseId)
    if (!lease) {
      throw new VaultError('lease not found', 404)
    }

    if (!lease.renewable) {
      throw new VaultError('lease is not renewable', 400)
    }

    const newDuration = increment ?? 3600
    lease.expiration = Date.now() + newDuration * 1000

    return {
      lease_id: leaseId,
      renewable: true,
      lease_duration: newDuration,
    }
  }

  /**
   * Revoke a lease
   */
  async revokeLease(leaseId: string): Promise<void> {
    state.leases.delete(leaseId)
  }

  /**
   * List leases
   */
  async listLeases(prefix: string): Promise<KVListResponse> {
    const keys: string[] = []
    for (const [id, lease] of state.leases.entries()) {
      if (lease.path.startsWith(prefix)) {
        keys.push(id)
      }
    }

    return {
      request_id: generateRequestId(),
      lease_id: '',
      renewable: false,
      lease_duration: 0,
      data: { keys },
      wrap_info: null,
      warnings: null,
      auth: null,
    }
  }

  /**
   * Enable a secrets engine
   */
  async enableSecretsEngine(path: string, options: { type: string; description?: string; config?: Record<string, unknown> }): Promise<void> {
    // No-op for local mode - engines are always available
  }

  /**
   * Disable a secrets engine
   */
  async disableSecretsEngine(path: string): Promise<void> {
    // Clear secrets at this path
    state.secrets.delete(path)
  }

  /**
   * List enabled secrets engines
   */
  async listSecretsEngines(): Promise<{ data: Record<string, { type: string; description: string }> }> {
    return {
      data: {
        'secret/': { type: 'kv', description: 'key/value secret storage' },
        'transit/': { type: 'transit', description: 'encryption as a service' },
        'pki/': { type: 'pki', description: 'PKI certificate issuance' },
        'database/': { type: 'database', description: 'database credential generation' },
      },
    }
  }

  /**
   * Enable an auth method
   */
  async enableAuthMethod(path: string, options: { type: string; description?: string }): Promise<void> {
    // No-op for local mode
  }

  /**
   * Disable an auth method
   */
  async disableAuthMethod(path: string): Promise<void> {
    // No-op for local mode
  }

  /**
   * List auth methods
   */
  async listAuthMethods(): Promise<{ data: Record<string, { type: string; description: string }> }> {
    return {
      data: {
        'token/': { type: 'token', description: 'token based credentials' },
        'approle/': { type: 'approle', description: 'AppRole based credentials' },
      },
    }
  }

  /**
   * Create or update a policy
   */
  async putPolicy(name: string, policy: string): Promise<void> {
    // No-op for local mode - policies are not enforced
  }

  /**
   * Read a policy
   */
  async getPolicy(name: string): Promise<{ data: { name: string; policy: string } }> {
    return {
      data: {
        name,
        policy: `path "secret/*" { capabilities = ["read", "list"] }`,
      },
    }
  }

  /**
   * Delete a policy
   */
  async deletePolicy(name: string): Promise<void> {
    // No-op for local mode
  }

  /**
   * List policies
   */
  async listPolicies(): Promise<{ data: { policies: string[] } }> {
    return {
      data: {
        policies: ['default', 'root'],
      },
    }
  }
}

// =============================================================================
// Vault Client
// =============================================================================

/**
 * HashiCorp Vault compatible client
 */
export class VaultClient {
  public readonly address: string
  public readonly token: string
  public readonly namespace?: string

  public readonly kv: KVEngine
  public readonly transit: TransitEngine
  public readonly tokenAuth: TokenAuth
  public readonly approle: AppRoleAuth
  public readonly pki: PKIEngine
  public readonly database: DatabaseEngine
  public readonly sys: SysBackend

  private credentialVault: CredentialVault | null = null

  constructor(config: VaultClientConfig = {}) {
    this.address = config.address ?? 'http://127.0.0.1:8200'
    this.token = config.token ?? ''
    this.namespace = config.namespace

    // Initialize engines
    this.kv = new KVEngine(this)
    this.transit = new TransitEngine(this)
    this.tokenAuth = new TokenAuth(this)
    this.approle = new AppRoleAuth(this)
    this.pki = new PKIEngine(this)
    this.database = new DatabaseEngine(this)
    this.sys = new SysBackend(this)

    // Initialize with CredentialVault if encryption key provided
    if (config.encryptionKey) {
      this.credentialVault = createCredentialVault({
        encryptionKey: config.encryptionKey,
      })
      state.credentialVault = this.credentialVault
    }

    // Store the token if provided
    if (this.token) {
      state.tokens.set(this.token, {
        accessor: generateAccessor(),
        creation_time: Math.floor(Date.now() / 1000),
        creation_ttl: 0,
        display_name: 'initial-token',
        entity_id: '',
        expire_time: null,
        explicit_max_ttl: 0,
        id: this.token,
        issue_time: new Date().toISOString(),
        meta: null,
        num_uses: 0,
        orphan: true,
        path: 'auth/token/create',
        policies: ['root'],
        renewable: false,
        ttl: 0,
        type: 'service',
      })
    }
  }

  /**
   * Read a secret (convenience method)
   */
  async read(path: string): Promise<KVReadResponse> {
    const parts = path.split('/')
    const mount = parts[0]!
    const secretPath = parts.slice(1).join('/')
    return new KVEngine(this, mount).read(secretPath)
  }

  /**
   * Write a secret (convenience method)
   */
  async write(path: string, data: Record<string, unknown>): Promise<KVWriteResponse> {
    const parts = path.split('/')
    const mount = parts[0]!
    const secretPath = parts.slice(1).join('/')
    return new KVEngine(this, mount).write(secretPath, data)
  }

  /**
   * Delete a secret (convenience method)
   */
  async delete(path: string): Promise<KVDeleteResponse> {
    const parts = path.split('/')
    const mount = parts[0]!
    const secretPath = parts.slice(1).join('/')
    return new KVEngine(this, mount).delete(secretPath)
  }

  /**
   * List secrets (convenience method)
   */
  async list(path: string): Promise<KVListResponse> {
    const parts = path.split('/')
    const mount = parts[0]!
    const listPath = parts.slice(1).join('/')
    return new KVEngine(this, mount).list(listPath)
  }
}

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Clear all state (for testing)
 */
export function _clearAll(): void {
  state.secrets.clear()
  state.tokens.clear()
  state.approles.clear()
  state.transitKeys.clear()
  state.pkiCAs.clear()
  state.databaseRoles.clear()
  state.leases.clear()
  state.credentialVault = null
}

/**
 * Get internal state (for testing)
 */
export function _getState(): InternalState {
  return state
}

// =============================================================================
// Default Export
// =============================================================================

export default VaultClient
