/**
 * n8n Credential Management
 *
 * Secure storage and retrieval of credentials with encryption at rest.
 */

/**
 * Stored credential data
 */
interface StoredCredential {
  id: string
  type: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/**
 * Credential manager for secure credential storage.
 *
 * Features:
 * - Encryption at rest using AES-256-GCM
 * - Support for multiple credential types (API keys, OAuth, etc.)
 * - Secure retrieval with decryption
 */
export class CredentialManager {
  private credentials: Map<string, string> = new Map()
  private encryptionKey: CryptoKey | null = null

  constructor() {
    // Initialize encryption key (in real implementation, this would come from secure storage)
    this.initEncryption()
  }

  /**
   * Initialize encryption with a derived key
   */
  private async initEncryption(): Promise<void> {
    // In production, this would use a secure key from environment or KMS
    const keyMaterial = new TextEncoder().encode('dotdo-n8n-credential-encryption-key')
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial)

    this.encryptionKey = await crypto.subtle.importKey('raw', hashBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  }

  /**
   * Encrypt data for storage
   */
  private async encrypt(data: Record<string, unknown>): Promise<string> {
    if (!this.encryptionKey) {
      await this.initEncryption()
    }

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoded = new TextEncoder().encode(JSON.stringify(data))

    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.encryptionKey!, encoded)

    // Combine IV and ciphertext
    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)

    // Return as base64
    return btoa(String.fromCharCode(...combined))
  }

  /**
   * Decrypt stored data
   */
  private async decrypt(encrypted: string): Promise<Record<string, unknown>> {
    if (!this.encryptionKey) {
      await this.initEncryption()
    }

    // Decode base64
    const combined = new Uint8Array(
      atob(encrypted)
        .split('')
        .map((c) => c.charCodeAt(0))
    )

    // Extract IV and ciphertext
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.encryptionKey!, ciphertext)

    return JSON.parse(new TextDecoder().decode(decrypted))
  }

  /**
   * Store a credential
   *
   * @param id - Unique credential ID
   * @param type - Credential type (e.g., 'apiKey', 'oauth2')
   * @param data - Credential data to store
   */
  async store(id: string, type: string, data: Record<string, unknown>): Promise<void> {
    const credential: StoredCredential = {
      id,
      type,
      data,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const encrypted = await this.encrypt(credential as unknown as Record<string, unknown>)
    this.credentials.set(id, encrypted)
  }

  /**
   * Retrieve and decrypt a credential
   *
   * @param id - Credential ID to retrieve
   * @returns Decrypted credential or undefined if not found
   */
  async get(id: string): Promise<{ type: string; data: Record<string, unknown> } | undefined> {
    const encrypted = this.credentials.get(id)
    if (!encrypted) {
      return undefined
    }

    const credential = (await this.decrypt(encrypted)) as StoredCredential
    return {
      type: credential.type,
      data: credential.data,
    }
  }

  /**
   * Get encrypted credential data (for inspection/debugging)
   *
   * @param id - Credential ID
   * @returns Encrypted string or undefined
   */
  getEncrypted(id: string): string | undefined {
    return this.credentials.get(id)
  }

  /**
   * Delete a credential
   *
   * @param id - Credential ID to delete
   */
  async delete(id: string): Promise<void> {
    this.credentials.delete(id)
  }

  /**
   * List all credential IDs
   *
   * @returns Array of credential IDs
   */
  list(): string[] {
    return Array.from(this.credentials.keys())
  }

  /**
   * Check if a credential exists
   *
   * @param id - Credential ID
   * @returns True if credential exists
   */
  has(id: string): boolean {
    return this.credentials.has(id)
  }

  /**
   * Update credential data
   *
   * @param id - Credential ID
   * @param data - New credential data
   */
  async update(id: string, data: Record<string, unknown>): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new Error(`Credential ${id} not found`)
    }

    await this.store(id, existing.type, { ...existing.data, ...data })
  }
}
