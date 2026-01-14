/**
 * SecretStore - Secure secret storage with encryption, versioning, and access control
 *
 * @example
 * ```typescript
 * import { SecretStore } from 'secret-store'
 *
 * const store = new SecretStore()
 * await store.set('api-key', 'sk_live_abc123')
 * const secret = await store.get('api-key')
 * ```
 *
 * @packageDocumentation
 */

// Re-export types
export * from './types'

import {
  SecretNotFoundError,
  SecretVersionNotFoundError,
  AccessDeniedError,
  SecretExpiredError,
  type SecretStoreOptions,
  type SetSecretOptions,
  type GetSecretOptions,
  type SecretMetadata,
  type SecretVersion,
  type AccessPolicy,
  type RotationPolicy,
  type EncryptionConfig,
  type AuditLog,
  type PolicyContext,
  type SecretAction,
} from './types'

// =============================================================================
// CacheLayer
// =============================================================================

export class CacheLayer {
  private cache: Map<string, { value: string; expiresAt: number }> = new Map()
  private stats = { hits: 0, misses: 0, bypasses: 0 }

  constructor(private ttl: number) {}

  get(key: string): string | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      this.stats.misses++
      return undefined
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.stats.misses++
      return undefined
    }
    this.stats.hits++
    return entry.value
  }

  set(key: string, value: string): void {
    if (this.ttl <= 0) return
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttl })
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  recordBypass(): void {
    this.stats.bypasses++
  }

  getStats(): { hits: number; misses: number; bypasses: number } {
    return { ...this.stats }
  }
}

// =============================================================================
// AuditLogger
// =============================================================================

export class AuditLogger {
  constructor(private handler: (log: AuditLog) => void) {}

  log(entry: Omit<AuditLog, 'timestamp'>): void {
    this.handler({
      ...entry,
      timestamp: new Date(),
    })
  }
}

// =============================================================================
// AccessPolicyEngine
// =============================================================================

export class AccessPolicyEngine {
  evaluate(
    policy: AccessPolicy,
    action: string,
    principal: string,
    attributes?: Record<string, string>
  ): boolean {
    // Check if principal matches
    const principalMatches = policy.principals.some((p) => {
      if (p === principal) return true
      if (p.endsWith(':*')) {
        const prefix = p.slice(0, -1) // Remove the '*'
        return principal.startsWith(prefix)
      }
      return false
    })

    if (!principalMatches) return false

    // Check if action is allowed
    if (!policy.actions.includes(action as SecretAction)) return false

    // Check conditions
    for (const condition of policy.conditions) {
      const attrValue = attributes?.[condition.attribute]
      if (attrValue === undefined) return false

      switch (condition.operator) {
        case 'equals':
          if (Array.isArray(condition.value)) {
            if (!condition.value.includes(attrValue)) return false
          } else {
            if (attrValue !== condition.value) return false
          }
          break
        case 'notEquals':
          if (Array.isArray(condition.value)) {
            if (condition.value.includes(attrValue)) return false
          } else {
            if (attrValue === condition.value) return false
          }
          break
        case 'contains':
          if (Array.isArray(condition.value)) {
            if (!condition.value.some((v) => attrValue.includes(v))) return false
          } else {
            if (!attrValue.includes(condition.value)) return false
          }
          break
        case 'startsWith':
          if (Array.isArray(condition.value)) {
            if (!condition.value.some((v) => attrValue.startsWith(v))) return false
          } else {
            if (!attrValue.startsWith(condition.value)) return false
          }
          break
        case 'endsWith':
          if (Array.isArray(condition.value)) {
            if (!condition.value.some((v) => attrValue.endsWith(v))) return false
          } else {
            if (!attrValue.endsWith(condition.value)) return false
          }
          break
      }
    }

    return true
  }
}

// =============================================================================
// VersionManager
// =============================================================================

interface VersionEntry {
  version: number
  value: string
  createdAt: Date
  deprecated: boolean
}

export class VersionManager {
  private versions: Map<string, VersionEntry[]> = new Map()

  addVersion(secretName: string, value: string): number {
    const entries = this.versions.get(secretName) || []
    const version = entries.length + 1
    entries.push({
      version,
      value,
      createdAt: new Date(),
      deprecated: false,
    })
    this.versions.set(secretName, entries)
    return version
  }

  getCurrentVersion(secretName: string): number {
    const entries = this.versions.get(secretName)
    if (!entries || entries.length === 0) return 0
    return entries[entries.length - 1].version
  }

  getVersion(secretName: string, version: number): VersionEntry | undefined {
    const entries = this.versions.get(secretName)
    if (!entries) return undefined
    return entries.find((e) => e.version === version)
  }

  getAllVersions(secretName: string): SecretVersion[] {
    const entries = this.versions.get(secretName)
    if (!entries) return []
    return entries.map((e) => ({
      version: e.version,
      value: e.value,
      createdAt: e.createdAt,
      deprecated: e.deprecated,
    }))
  }

  deprecateVersion(secretName: string, version: number): void {
    const entries = this.versions.get(secretName)
    if (!entries) return
    const entry = entries.find((e) => e.version === version)
    if (entry) entry.deprecated = true
  }

  deprecateAllVersions(secretName: string): void {
    const entries = this.versions.get(secretName)
    if (!entries) return
    for (const entry of entries) {
      entry.deprecated = true
    }
  }

  delete(secretName: string): void {
    this.versions.delete(secretName)
  }

  has(secretName: string): boolean {
    return this.versions.has(secretName) && this.versions.get(secretName)!.length > 0
  }
}

// =============================================================================
// EncryptionLayer
// =============================================================================

export class EncryptionLayer {
  private masterKey: CryptoKey | null = null
  private algorithm: string
  private keyId: string
  private envelope: boolean

  constructor(config: EncryptionConfig) {
    this.algorithm = config.algorithm
    this.keyId = config.keyId
    this.envelope = config.envelope
  }

  private async getMasterKey(): Promise<CryptoKey> {
    if (!this.masterKey) {
      // Generate a key from the keyId (in production, this would come from a KMS)
      const encoder = new TextEncoder()
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(this.keyId.padEnd(32, '0').slice(0, 32)),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
      )
      this.masterKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: encoder.encode('secret-store-salt'),
          iterations: 100000,
          hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
    }
    return this.masterKey
  }

  async encrypt(plaintext: string): Promise<string> {
    const key = await this.getMasterKey()
    const encoder = new TextEncoder()
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(plaintext)
    )

    // Combine IV and ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(ciphertext), iv.length)

    return btoa(String.fromCharCode.apply(null, Array.from(combined)))
  }

  async decrypt(ciphertext: string): Promise<string> {
    const key = await this.getMasterKey()
    const combined = new Uint8Array(
      atob(ciphertext)
        .split('')
        .map((c) => c.charCodeAt(0))
    )

    const iv = combined.slice(0, 12)
    const data = combined.slice(12)

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)

    return new TextDecoder().decode(decrypted)
  }

  async encryptWithEnvelope(
    plaintext: string
  ): Promise<{ encryptedData: string; encryptedDataKey: string }> {
    // Generate a data key
    const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ])

    // Encrypt the plaintext with the data key
    const encoder = new TextEncoder()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      dataKey,
      encoder.encode(plaintext)
    )

    const combined = new Uint8Array(iv.length + ciphertext.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(ciphertext), iv.length)
    const encryptedData = btoa(String.fromCharCode.apply(null, Array.from(combined)))

    // Export and encrypt the data key with the master key
    const exportedKey = await crypto.subtle.exportKey('raw', dataKey)
    const masterKey = await this.getMasterKey()
    const keyIv = crypto.getRandomValues(new Uint8Array(12))
    const encryptedKeyData = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: keyIv },
      masterKey,
      exportedKey
    )

    const keyCombined = new Uint8Array(keyIv.length + encryptedKeyData.byteLength)
    keyCombined.set(keyIv)
    keyCombined.set(new Uint8Array(encryptedKeyData), keyIv.length)
    const encryptedDataKey = btoa(String.fromCharCode.apply(null, Array.from(keyCombined)))

    return { encryptedData, encryptedDataKey }
  }

  async decryptWithEnvelope(encryptedData: string, encryptedDataKey: string): Promise<string> {
    // Decrypt the data key
    const masterKey = await this.getMasterKey()
    const keyCombined = new Uint8Array(
      atob(encryptedDataKey)
        .split('')
        .map((c) => c.charCodeAt(0))
    )
    const keyIv = keyCombined.slice(0, 12)
    const keyData = keyCombined.slice(12)

    const decryptedKeyData = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: keyIv },
      masterKey,
      keyData
    )

    const dataKey = await crypto.subtle.importKey(
      'raw',
      decryptedKeyData,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    )

    // Decrypt the data
    const combined = new Uint8Array(
      atob(encryptedData)
        .split('')
        .map((c) => c.charCodeAt(0))
    )
    const iv = combined.slice(0, 12)
    const data = combined.slice(12)

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dataKey, data)

    return new TextDecoder().decode(decrypted)
  }
}

// =============================================================================
// RotationScheduler
// =============================================================================

export class RotationScheduler {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map()
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  schedule(
    secretName: string,
    policy: RotationPolicy & { generateValue?: () => string },
    onRotate: (secretName: string, newValue: string) => Promise<void>
  ): void {
    // Clear any existing timer
    this.cancel(secretName)

    const timer = setInterval(async () => {
      const newValue = policy.generateValue?.() || crypto.randomUUID()
      try {
        await policy.handler(secretName, newValue)
        await onRotate(secretName, newValue)
      } catch {
        // Schedule retry after 5 seconds
        const retryTimer = setTimeout(async () => {
          try {
            await policy.handler(secretName, newValue)
            await onRotate(secretName, newValue)
          } catch {
            // Retry failed, will try again on next interval
          }
        }, 5000)
        this.retryTimers.set(secretName, retryTimer)
      }
    }, policy.interval)

    this.timers.set(secretName, timer)
  }

  cancel(secretName: string): void {
    const timer = this.timers.get(secretName)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(secretName)
    }
    const retryTimer = this.retryTimers.get(secretName)
    if (retryTimer) {
      clearTimeout(retryTimer)
      this.retryTimers.delete(secretName)
    }
  }
}

// =============================================================================
// Internal storage types
// =============================================================================

interface StoredSecret {
  value: string
  encryptedDataKey?: string
  tags: string[]
  createdAt: Date
  rotatedAt?: Date
  expiresAt?: Date
}

// =============================================================================
// SecretStore
// =============================================================================

export interface SecretStoreOptionsExtended extends SecretStoreOptions {
  onAuditLog?: (log: AuditLog) => void
}

export class SecretStore {
  private storage: Map<string, StoredSecret> = new Map()
  private policies: Map<string, AccessPolicy> = new Map()
  private rotationPolicies: Map<string, RotationPolicy & { generateValue?: () => string }> =
    new Map()

  private versionManager: VersionManager
  private encryptionLayer?: EncryptionLayer
  private rotationScheduler: RotationScheduler
  private policyEngine: AccessPolicyEngine
  private auditLogger?: AuditLogger
  private cache: CacheLayer

  private options: SecretStoreOptionsExtended

  constructor(options: SecretStoreOptionsExtended = {}) {
    this.options = options
    this.versionManager = new VersionManager()
    this.rotationScheduler = new RotationScheduler()
    this.policyEngine = new AccessPolicyEngine()
    this.cache = new CacheLayer(options.cacheTtl ?? 0)

    if (options.encryption) {
      this.encryptionLayer = new EncryptionLayer({
        algorithm: options.encryption.algorithm || 'AES-GCM-256',
        keyId: options.encryption.keyId || 'default-key',
        envelope: options.encryption.envelope ?? false,
      })
    }

    if (options.auditEnabled && options.onAuditLog) {
      this.auditLogger = new AuditLogger(options.onAuditLog)
    }
  }

  async set(
    name: string,
    value: string,
    options?: SetSecretOptions & { principal?: string }
  ): Promise<void> {
    const isUpdate = this.storage.has(name)
    const action: SecretAction = isUpdate ? 'write' : 'create'

    // Check policy if context provided
    if (options?.principal) {
      const policy = this.policies.get(name)
      if (policy && !this.policyEngine.evaluate(policy, 'write', options.principal)) {
        this.auditLogger?.log({
          action,
          secretName: name,
          principal: options.principal,
          metadata: { denied: true },
        })
        throw new AccessDeniedError('write', name, options.principal)
      }
    }

    // Encrypt the value
    let storedValue = value
    let encryptedDataKey: string | undefined

    if (this.encryptionLayer) {
      if (this.options.encryption?.envelope) {
        const result = await this.encryptionLayer.encryptWithEnvelope(value)
        storedValue = result.encryptedData
        encryptedDataKey = result.encryptedDataKey
      } else {
        storedValue = await this.encryptionLayer.encrypt(value)
      }
    }

    // Preserve tags from existing secret if not provided
    const existingSecret = this.storage.get(name)
    const tags = options?.tags ?? existingSecret?.tags ?? []

    // Calculate expiration
    let expiresAt = options?.expiresAt
    if (!expiresAt && this.options.defaultTtl) {
      expiresAt = new Date(Date.now() + this.options.defaultTtl)
    }

    // Store the secret
    this.storage.set(name, {
      value: storedValue,
      encryptedDataKey,
      tags,
      createdAt: existingSecret?.createdAt ?? new Date(),
      rotatedAt: existingSecret?.rotatedAt,
      expiresAt,
    })

    // Track version
    this.versionManager.addVersion(name, storedValue)

    // Invalidate cache
    this.cache.invalidate(name)

    // Audit log
    this.auditLogger?.log({
      action,
      secretName: name,
      principal: options?.principal || 'anonymous',
    })
  }

  async get(
    name: string,
    options?: GetSecretOptions & PolicyContext
  ): Promise<string> {
    // Check if secret exists
    if (!this.storage.has(name)) {
      throw new SecretNotFoundError(name)
    }

    const stored = this.storage.get(name)!

    // Check expiration
    if (stored.expiresAt && Date.now() > stored.expiresAt.getTime()) {
      this.auditLogger?.log({
        action: 'expire',
        secretName: name,
        principal: options?.principal || 'system',
      })
      throw new SecretExpiredError(name)
    }

    // Check policy if context provided
    if (options?.principal) {
      const policy = this.policies.get(name)
      if (policy && !this.policyEngine.evaluate(policy, 'read', options.principal, options.attributes)) {
        this.auditLogger?.log({
          action: 'read',
          secretName: name,
          principal: options.principal,
          metadata: { denied: true },
        })
        throw new AccessDeniedError('read', name, options.principal)
      }
    }

    // Get specific version if requested
    if (options?.version !== undefined) {
      const versionEntry = this.versionManager.getVersion(name, options.version)
      if (!versionEntry) {
        throw new SecretVersionNotFoundError(name, options.version)
      }
      // Decrypt the versioned value
      let value = versionEntry.value
      if (this.encryptionLayer) {
        // For simplicity, versions are stored encrypted the same way
        value = await this.encryptionLayer.decrypt(value)
      }
      return value
    }

    // Check cache (unless bypassed)
    if (!options?.bypassCache) {
      const cached = this.cache.get(name)
      if (cached !== undefined) {
        this.auditLogger?.log({
          action: 'read',
          secretName: name,
          principal: options?.principal || 'anonymous',
        })
        return cached
      }
    } else {
      this.cache.recordBypass()
    }

    // Decrypt the value
    let value = stored.value
    if (this.encryptionLayer) {
      if (stored.encryptedDataKey) {
        value = await this.encryptionLayer.decryptWithEnvelope(stored.value, stored.encryptedDataKey)
      } else {
        value = await this.encryptionLayer.decrypt(stored.value)
      }
    }

    // Cache the decrypted value
    this.cache.set(name, value)

    // Audit log
    this.auditLogger?.log({
      action: 'read',
      secretName: name,
      principal: options?.principal || 'anonymous',
    })

    return value
  }

  async getMetadata(name: string): Promise<SecretMetadata & { expiresAt?: Date }> {
    if (!this.storage.has(name)) {
      throw new SecretNotFoundError(name)
    }

    const stored = this.storage.get(name)!
    return {
      name,
      version: this.versionManager.getCurrentVersion(name),
      createdAt: stored.createdAt,
      rotatedAt: stored.rotatedAt,
      tags: stored.tags,
      expiresAt: stored.expiresAt,
    }
  }

  async delete(name: string, options?: PolicyContext): Promise<void> {
    if (!this.storage.has(name)) {
      throw new SecretNotFoundError(name)
    }

    // Check policy if context provided
    if (options?.principal) {
      const policy = this.policies.get(name)
      if (policy && !this.policyEngine.evaluate(policy, 'delete', options.principal, options.attributes)) {
        this.auditLogger?.log({
          action: 'delete',
          secretName: name,
          principal: options.principal,
          metadata: { denied: true },
        })
        throw new AccessDeniedError('delete', name, options.principal)
      }
    }

    this.storage.delete(name)
    this.versionManager.delete(name)
    this.policies.delete(name)
    this.rotationScheduler.cancel(name)
    this.cache.invalidate(name)

    // Audit log
    this.auditLogger?.log({
      action: 'delete',
      secretName: name,
      principal: options?.principal || 'anonymous',
    })
  }

  async rotate(
    name: string,
    newValue: string,
    options?: PolicyContext
  ): Promise<void> {
    if (!this.storage.has(name)) {
      throw new SecretNotFoundError(name)
    }

    // Check policy if context provided
    if (options?.principal) {
      const policy = this.policies.get(name)
      if (policy && !this.policyEngine.evaluate(policy, 'rotate', options.principal, options.attributes)) {
        this.auditLogger?.log({
          action: 'rotate',
          secretName: name,
          principal: options.principal,
          metadata: { denied: true },
        })
        throw new AccessDeniedError('rotate', name, options.principal)
      }
    }

    // Deprecate all old versions
    this.versionManager.deprecateAllVersions(name)

    // Store new value
    const stored = this.storage.get(name)!

    let storedValue = newValue
    let encryptedDataKey: string | undefined

    if (this.encryptionLayer) {
      if (this.options.encryption?.envelope) {
        const result = await this.encryptionLayer.encryptWithEnvelope(newValue)
        storedValue = result.encryptedData
        encryptedDataKey = result.encryptedDataKey
      } else {
        storedValue = await this.encryptionLayer.encrypt(newValue)
      }
    }

    this.storage.set(name, {
      ...stored,
      value: storedValue,
      encryptedDataKey,
      rotatedAt: new Date(),
    })

    // Add new version
    this.versionManager.addVersion(name, storedValue)

    // Invalidate cache
    this.cache.invalidate(name)

    // Audit log
    this.auditLogger?.log({
      action: 'rotate',
      secretName: name,
      principal: options?.principal || 'anonymous',
    })
  }

  async list(options?: { tag?: string; prefix?: string }): Promise<string[]> {
    const names = Array.from(this.storage.keys())

    return names.filter((name) => {
      const stored = this.storage.get(name)!

      if (options?.tag && !stored.tags.includes(options.tag)) {
        return false
      }

      if (options?.prefix && !name.startsWith(options.prefix)) {
        return false
      }

      return true
    })
  }

  async getVersions(name: string): Promise<SecretVersion[]> {
    if (!this.storage.has(name)) {
      throw new SecretNotFoundError(name)
    }

    return this.versionManager.getAllVersions(name)
  }

  async setPolicy(name: string, policy: AccessPolicy): Promise<void> {
    this.policies.set(name, policy)
  }

  async setRotationPolicy(
    name: string,
    policy: RotationPolicy & { generateValue?: () => string }
  ): Promise<void> {
    this.rotationPolicies.set(name, policy)
    this.rotationScheduler.schedule(name, policy, async (secretName, newValue) => {
      await this.rotate(secretName, newValue)
    })
  }

  async removeRotationPolicy(name: string): Promise<void> {
    this.rotationPolicies.delete(name)
    this.rotationScheduler.cancel(name)
  }

  async rollback(name: string, version: number): Promise<void> {
    if (!this.storage.has(name)) {
      throw new SecretNotFoundError(name)
    }

    const versionEntry = this.versionManager.getVersion(name, version)
    if (!versionEntry) {
      throw new SecretVersionNotFoundError(name, version)
    }

    // Get the value from the version
    let value = versionEntry.value
    // Note: The value is already encrypted in storage, so we can use it directly
    // for creating a new version

    const stored = this.storage.get(name)!
    this.storage.set(name, {
      ...stored,
      value,
      rotatedAt: new Date(),
    })

    // Add as a new version (not modifying history)
    this.versionManager.addVersion(name, value)

    // Invalidate cache
    this.cache.invalidate(name)
  }

  getRawStorage(): Map<string, { value: string; encryptedDataKey?: string }> {
    return new Map(
      Array.from(this.storage.entries()).map(([k, v]) => [
        k,
        { value: v.value, encryptedDataKey: v.encryptedDataKey },
      ])
    )
  }

  getCacheStats(): { hits: number; misses: number; bypasses: number } {
    return this.cache.getStats()
  }
}
