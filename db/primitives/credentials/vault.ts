/**
 * SecureVault - AES-256-GCM encrypted storage with versioning
 *
 * Provides secure credential storage with:
 * - AES-256-GCM encryption at rest
 * - Secret versioning with rollback support
 * - Secret references (never expose raw values)
 * - Export/import for backup and migration
 *
 * @module db/primitives/credentials/vault
 */

// =============================================================================
// Types
// =============================================================================

export interface VaultConfig {
  /** Encryption key - must be 32 bytes for AES-256 */
  encryptionKey: string
  /** Maximum versions to retain per secret (default: unlimited) */
  versionRetention?: number
}

export interface EncryptedData {
  ciphertext: string
  iv: string
}

export interface SecretVersion {
  version: number
  encryptedValue: string
  iv: string
  createdAt: Date
}

export interface StoredSecret {
  id: string
  name: string
  value: string
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface SecretRef {
  id: string
  name: string
  version: number
}

export interface RefUsage {
  refId: string
  accessCount: number
  lastAccessed?: Date
}

export interface GetSecretOptions {
  version?: number
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

// =============================================================================
// SecureVault Implementation
// =============================================================================

interface InternalSecret {
  id: string
  name: string
  encryptedValue: string
  iv: string
  versions: SecretVersion[]
  createdAt: Date
  updatedAt: Date
}

export class SecureVault {
  private encryptionKey: CryptoKey | null = null
  private readonly rawKey: string
  private readonly versionRetention: number
  private secrets: Map<string, InternalSecret> = new Map()
  private refUsage: Map<string, RefUsage> = new Map()

  constructor(config: VaultConfig) {
    if (config.encryptionKey.length !== 32) {
      throw new Error('Encryption key must be 32 bytes for AES-256')
    }

    this.rawKey = config.encryptionKey
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
   * Encrypt a value using AES-256-GCM
   */
  async encrypt(value: string): Promise<EncryptedData> {
    const key = await this.initKey()
    const iv = generateIV()
    const data = stringToBuffer(value)

    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)

    return {
      ciphertext: bufferToBase64(encrypted),
      iv: bufferToBase64(iv.buffer as ArrayBuffer),
    }
  }

  /**
   * Decrypt a value using AES-256-GCM
   */
  async decrypt(ciphertext: string, iv: string): Promise<string> {
    const key = await this.initKey()
    const ivBuffer = new Uint8Array(base64ToBuffer(iv))
    const dataBuffer = base64ToBuffer(ciphertext)

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuffer }, key, dataBuffer)

    return new TextDecoder().decode(decrypted)
  }

  /**
   * Store a new secret or add a new version
   */
  async storeSecret(name: string, value: string): Promise<void> {
    const { ciphertext, iv } = await this.encrypt(value)
    const now = new Date()

    let secret = this.secrets.get(name)

    if (secret) {
      // Calculate version based on highest existing version
      const currentMaxVersion = secret.versions.reduce((max, v) => Math.max(max, v.version), 0)
      const newVersion = currentMaxVersion + 1
      secret.versions.push({
        version: newVersion,
        encryptedValue: ciphertext,
        iv,
        createdAt: now,
      })

      // Update current
      secret.encryptedValue = ciphertext
      secret.iv = iv
      secret.updatedAt = now

      // Enforce version retention
      this.enforceRetention(name)
    } else {
      // Create new secret
      secret = {
        id: generateId(),
        name,
        encryptedValue: ciphertext,
        iv,
        versions: [
          {
            version: 1,
            encryptedValue: ciphertext,
            iv,
            createdAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      }
      this.secrets.set(name, secret)
    }
  }

  /**
   * Get a secret by name
   */
  async getSecret(name: string, options?: GetSecretOptions): Promise<StoredSecret | null> {
    const secret = this.secrets.get(name)
    if (!secret) {
      return null
    }

    let encryptedValue: string
    let iv: string
    let version: number

    if (options?.version !== undefined) {
      const versionData = secret.versions.find((v) => v.version === options.version)
      if (!versionData) {
        return null
      }
      encryptedValue = versionData.encryptedValue
      iv = versionData.iv
      version = versionData.version
    } else {
      encryptedValue = secret.encryptedValue
      iv = secret.iv
      version = secret.versions.length
    }

    const value = await this.decrypt(encryptedValue, iv)

    return {
      id: secret.id,
      name: secret.name,
      value,
      version,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
    }
  }

  /**
   * Rollback to a previous version
   */
  async rollback(name: string, targetVersion: number): Promise<void> {
    const secret = this.secrets.get(name)
    if (!secret) {
      throw new Error(`Secret '${name}' not found`)
    }

    const versionData = secret.versions.find((v) => v.version === targetVersion)
    if (!versionData) {
      throw new Error(`Version ${targetVersion} not found for secret '${name}'`)
    }

    // Add the rollback as a new version
    const newVersion = secret.versions.length + 1
    secret.versions.push({
      version: newVersion,
      encryptedValue: versionData.encryptedValue,
      iv: versionData.iv,
      createdAt: new Date(),
    })

    secret.encryptedValue = versionData.encryptedValue
    secret.iv = versionData.iv
    secret.updatedAt = new Date()

    this.enforceRetention(name)
  }

  /**
   * List all versions of a secret
   */
  async listVersions(name: string): Promise<SecretVersion[]> {
    const secret = this.secrets.get(name)
    if (!secret) {
      return []
    }
    return [...secret.versions]
  }

  /**
   * Get a secret reference (does not expose value)
   */
  async getSecretRef(name: string): Promise<SecretRef | null> {
    const secret = this.secrets.get(name)
    if (!secret) {
      return null
    }

    return {
      id: secret.id,
      name: secret.name,
      version: secret.versions.length,
    }
  }

  /**
   * Resolve a secret reference to its value
   */
  async resolveRef(ref: SecretRef): Promise<string | null> {
    const secret = await this.getSecret(ref.name, { version: ref.version })
    if (!secret) {
      return null
    }

    // Track usage
    let usage = this.refUsage.get(ref.id)
    if (!usage) {
      usage = { refId: ref.id, accessCount: 0 }
      this.refUsage.set(ref.id, usage)
    }
    usage.accessCount++
    usage.lastAccessed = new Date()

    return secret.value
  }

  /**
   * Get reference usage statistics
   */
  async getRefUsage(refId: string): Promise<RefUsage> {
    return this.refUsage.get(refId) ?? { refId, accessCount: 0 }
  }

  /**
   * Export a secret for backup (encrypted)
   */
  async exportSecret(name: string): Promise<string> {
    const secret = this.secrets.get(name)
    if (!secret) {
      throw new Error(`Secret '${name}' not found`)
    }

    return JSON.stringify({
      name: secret.name,
      encryptedValue: secret.encryptedValue,
      iv: secret.iv,
      versions: secret.versions,
    })
  }

  /**
   * Import a secret from backup
   */
  async importSecret(data: string): Promise<void> {
    const parsed = JSON.parse(data)

    if (this.secrets.has(parsed.name)) {
      throw new Error(`Secret '${parsed.name}' already exists`)
    }

    const now = new Date()
    const secret: InternalSecret = {
      id: generateId(),
      name: parsed.name,
      encryptedValue: parsed.encryptedValue,
      iv: parsed.iv,
      versions: parsed.versions.map((v: SecretVersion) => ({
        ...v,
        createdAt: new Date(v.createdAt),
      })),
      createdAt: now,
      updatedAt: now,
    }

    this.secrets.set(parsed.name, secret)
  }

  /**
   * Delete a secret
   */
  async deleteSecret(name: string): Promise<void> {
    if (!this.secrets.has(name)) {
      throw new Error(`Secret '${name}' not found`)
    }
    this.secrets.delete(name)
  }

  /**
   * List all secret names
   */
  async listSecrets(): Promise<string[]> {
    return Array.from(this.secrets.keys())
  }

  /**
   * Enforce version retention limit
   */
  private enforceRetention(name: string): void {
    if (this.versionRetention === Infinity) {
      return
    }

    const secret = this.secrets.get(name)
    if (!secret) {
      return
    }

    while (secret.versions.length > this.versionRetention) {
      secret.versions.shift()
    }
  }
}

/**
 * Factory function to create a SecureVault instance
 */
export function createSecureVault(config: VaultConfig): SecureVault {
  return new SecureVault(config)
}
