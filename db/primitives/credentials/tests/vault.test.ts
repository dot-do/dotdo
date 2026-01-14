/**
 * Vault tests - AES-256-GCM encrypted storage with versioning
 *
 * TDD: These tests define the expected behavior of the vault encryption layer.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { SecureVault, createSecureVault, type VaultConfig } from '../vault'

function createTestVault(config?: Partial<VaultConfig>): SecureVault {
  return createSecureVault({
    encryptionKey: 'test-encryption-key-32-bytes-ok!', // 32 bytes for AES-256
    ...config,
  })
}

describe('SecureVault - Encrypted Storage', () => {
  describe('AES-256-GCM Encryption', () => {
    it('should encrypt values at rest', async () => {
      const vault = createTestVault()

      const { ciphertext, iv } = await vault.encrypt('sk_live_supersecret123')

      // Ciphertext should be different from plaintext
      expect(ciphertext).not.toBe('sk_live_supersecret123')
      expect(ciphertext.length).toBeGreaterThan(0)
      expect(iv.length).toBeGreaterThan(0)
    })

    it('should decrypt values correctly', async () => {
      const vault = createTestVault()

      const { ciphertext, iv } = await vault.encrypt('my-secret-value')
      const decrypted = await vault.decrypt(ciphertext, iv)

      expect(decrypted).toBe('my-secret-value')
    })

    it('should use unique IV per encryption', async () => {
      const vault = createTestVault()

      const enc1 = await vault.encrypt('same-value')
      const enc2 = await vault.encrypt('same-value')

      // Even with same plaintext, IVs and ciphertexts should differ
      expect(enc1.iv).not.toBe(enc2.iv)
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext)
    })

    it('should detect tampering (authenticated encryption)', async () => {
      const vault = createTestVault()

      const { ciphertext, iv } = await vault.encrypt('original-value')

      // Tamper with the ciphertext
      const tampered = ciphertext.slice(0, -4) + 'xxxx'

      // Should throw on decryption due to auth tag mismatch
      await expect(vault.decrypt(tampered, iv)).rejects.toThrow()
    })

    it('should reject invalid encryption key length', () => {
      expect(() => createSecureVault({ encryptionKey: 'too-short' })).toThrow(/32.*bytes/i)
    })

    it('should encrypt complex objects', async () => {
      const vault = createTestVault()
      const obj = {
        accessToken: 'ya29.xxx',
        refreshToken: '1//xxx',
        expiresAt: new Date().toISOString(),
      }

      const { ciphertext, iv } = await vault.encrypt(JSON.stringify(obj))
      const decrypted = await vault.decrypt(ciphertext, iv)

      expect(JSON.parse(decrypted)).toEqual(obj)
    })
  })

  describe('Secret Versioning', () => {
    it('should store multiple versions of a secret', async () => {
      const vault = createTestVault()

      await vault.storeSecret('my-key', 'version-1')
      await vault.storeSecret('my-key', 'version-2')
      await vault.storeSecret('my-key', 'version-3')

      const versions = await vault.listVersions('my-key')
      expect(versions).toHaveLength(3)
    })

    it('should retrieve current version by default', async () => {
      const vault = createTestVault()

      await vault.storeSecret('my-key', 'v1')
      await vault.storeSecret('my-key', 'v2')

      const current = await vault.getSecret('my-key')
      expect(current?.value).toBe('v2')
      expect(current?.version).toBe(2)
    })

    it('should retrieve specific version', async () => {
      const vault = createTestVault()

      await vault.storeSecret('my-key', 'v1')
      await vault.storeSecret('my-key', 'v2')
      await vault.storeSecret('my-key', 'v3')

      const v1 = await vault.getSecret('my-key', { version: 1 })
      const v2 = await vault.getSecret('my-key', { version: 2 })

      expect(v1?.value).toBe('v1')
      expect(v2?.value).toBe('v2')
    })

    it('should support rollback to previous version', async () => {
      const vault = createTestVault()

      await vault.storeSecret('rollback-key', 'original')
      await vault.storeSecret('rollback-key', 'bad-value')

      await vault.rollback('rollback-key', 1)

      const current = await vault.getSecret('rollback-key')
      expect(current?.value).toBe('original')
    })

    it('should enforce version retention limit', async () => {
      const vault = createTestVault({ versionRetention: 2 })

      await vault.storeSecret('limited', 'v1')
      await vault.storeSecret('limited', 'v2')
      await vault.storeSecret('limited', 'v3')
      await vault.storeSecret('limited', 'v4')

      const versions = await vault.listVersions('limited')
      expect(versions).toHaveLength(2)
      // Should keep most recent versions
      expect(versions.map((v) => v.version)).toEqual([3, 4])
    })
  })

  describe('Secret References', () => {
    it('should return secret reference instead of raw value', async () => {
      const vault = createTestVault()

      await vault.storeSecret('api-key', 'sk_live_xxx')

      const ref = await vault.getSecretRef('api-key')

      expect(ref).toBeDefined()
      expect(ref?.id).toBeDefined()
      expect(ref?.name).toBe('api-key')
      // Reference should not expose raw value
      expect((ref as unknown as { value?: string }).value).toBeUndefined()
    })

    it('should resolve secret reference to value', async () => {
      const vault = createTestVault()

      await vault.storeSecret('resolvable', 'secret-value')
      const ref = await vault.getSecretRef('resolvable')

      const resolved = await vault.resolveRef(ref!)
      expect(resolved).toBe('secret-value')
    })

    it('should track reference usage in audit', async () => {
      const vault = createTestVault()

      await vault.storeSecret('tracked', 'value')
      const ref = await vault.getSecretRef('tracked')
      await vault.resolveRef(ref!)

      const usage = await vault.getRefUsage(ref!.id)
      expect(usage.accessCount).toBeGreaterThan(0)
    })
  })

  describe('Export/Import', () => {
    it('should export encrypted secret for backup', async () => {
      const vault = createTestVault()

      await vault.storeSecret('exportable', 'my-secret')

      const exported = await vault.exportSecret('exportable')

      expect(exported).toContain('encryptedValue')
      expect(exported).not.toContain('my-secret') // Should not expose plaintext
    })

    it('should import encrypted secret from backup', async () => {
      const vault1 = createTestVault({ encryptionKey: 'master-key-32-bytes-xxxxxxxx!!!!' })
      const vault2 = createTestVault({ encryptionKey: 'master-key-32-bytes-xxxxxxxx!!!!' })

      await vault1.storeSecret('shared', 'shared-value')
      const exported = await vault1.exportSecret('shared')

      await vault2.importSecret(exported)

      const retrieved = await vault2.getSecret('shared')
      expect(retrieved?.value).toBe('shared-value')
    })
  })
})
