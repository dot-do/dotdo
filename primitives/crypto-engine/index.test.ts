/**
 * CryptoEngine Tests
 * TDD Red-Green-Refactor implementation
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  CryptoEngine,
  AESCipher,
  HashGenerator,
  KeyDeriver,
  AsymmetricCrypto,
  RandomGenerator,
  constantTimeCompare,
} from './index'
import type {
  EncryptionAlgorithm,
  HashAlgorithm,
  KeyDerivation,
  EncryptedData,
  KeyPair,
  SignatureResult,
  DeriveConfig,
} from './types'
import { CryptoError } from './types'

describe('CryptoEngine', () => {
  let engine: CryptoEngine

  beforeEach(() => {
    engine = new CryptoEngine()
  })

  describe('Symmetric encryption/decryption', () => {
    it('should encrypt and decrypt text data with AES-256-GCM', async () => {
      const plaintext = 'Hello, World!'
      const key = await engine.generateKey(256)

      const encrypted = await engine.encrypt(plaintext, key, 'aes-256-gcm')
      expect(encrypted.ciphertext).toBeDefined()
      expect(encrypted.iv).toBeDefined()
      expect(encrypted.tag).toBeDefined()
      expect(encrypted.algorithm).toBe('aes-256-gcm')

      const decrypted = await engine.decrypt(encrypted, key)
      expect(decrypted).toBe(plaintext)
    })

    it('should encrypt and decrypt binary data', async () => {
      // Use valid UTF-8 encoded binary data for the high-level API
      const textData = 'Binary data test: \u0001\u0002\u0003'
      const key = await engine.generateKey(256)

      const encrypted = await engine.encrypt(textData, key, 'aes-256-gcm')
      const decrypted = await engine.decrypt(encrypted, key)

      expect(decrypted).toBe(textData)
    })

    it('should encrypt and decrypt raw binary data using AESCipher', async () => {
      const cipher = new AESCipher()
      const data = new Uint8Array([1, 2, 3, 4, 5, 255, 254, 253])
      const key = crypto.getRandomValues(new Uint8Array(32))

      const encrypted = await cipher.encrypt(data, key, 'aes-256-gcm')
      const decrypted = await cipher.decrypt(encrypted, key)

      expect(decrypted).toEqual(data)
    })

    it('should use different IVs for each encryption', async () => {
      const plaintext = 'Same message'
      const key = await engine.generateKey(256)

      const encrypted1 = await engine.encrypt(plaintext, key, 'aes-256-gcm')
      const encrypted2 = await engine.encrypt(plaintext, key, 'aes-256-gcm')

      expect(encrypted1.iv).not.toBe(encrypted2.iv)
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext)
    })

    it('should handle empty string', async () => {
      const key = await engine.generateKey(256)

      const encrypted = await engine.encrypt('', key, 'aes-256-gcm')
      const decrypted = await engine.decrypt(encrypted, key)

      expect(decrypted).toBe('')
    })

    it('should handle large data', async () => {
      const plaintext = 'x'.repeat(1000000) // 1MB of data
      const key = await engine.generateKey(256)

      const encrypted = await engine.encrypt(plaintext, key, 'aes-256-gcm')
      const decrypted = await engine.decrypt(encrypted, key)

      expect(decrypted).toBe(plaintext)
    })
  })

  describe('Multiple algorithms', () => {
    it('should encrypt/decrypt with AES-256-GCM', async () => {
      const plaintext = 'GCM mode test'
      const key = await engine.generateKey(256)

      const encrypted = await engine.encrypt(plaintext, key, 'aes-256-gcm')
      expect(encrypted.algorithm).toBe('aes-256-gcm')
      expect(encrypted.tag).toBeDefined() // GCM uses auth tag

      const decrypted = await engine.decrypt(encrypted, key)
      expect(decrypted).toBe(plaintext)
    })

    it('should encrypt/decrypt with AES-256-CBC', async () => {
      const plaintext = 'CBC mode test'
      const key = await engine.generateKey(256)

      const encrypted = await engine.encrypt(plaintext, key, 'aes-256-cbc')
      expect(encrypted.algorithm).toBe('aes-256-cbc')

      const decrypted = await engine.decrypt(encrypted, key)
      expect(decrypted).toBe(plaintext)
    })
  })

  describe('Hash generation', () => {
    it('should generate SHA-256 hash', async () => {
      const data = 'Hello, World!'
      const hash = await engine.hash(data, 'sha256')

      expect(hash).toHaveLength(64) // SHA-256 produces 32 bytes = 64 hex chars
      expect(hash).toMatch(/^[a-f0-9]+$/)
    })

    it('should generate SHA-384 hash', async () => {
      const data = 'Test data'
      const hash = await engine.hash(data, 'sha384')

      expect(hash).toHaveLength(96) // SHA-384 produces 48 bytes = 96 hex chars
    })

    it('should generate SHA-512 hash', async () => {
      const data = 'Test data'
      const hash = await engine.hash(data, 'sha512')

      expect(hash).toHaveLength(128) // SHA-512 produces 64 bytes = 128 hex chars
    })

    it('should produce consistent hashes', async () => {
      const data = 'Consistent data'

      const hash1 = await engine.hash(data, 'sha256')
      const hash2 = await engine.hash(data, 'sha256')

      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different data', async () => {
      const hash1 = await engine.hash('data1', 'sha256')
      const hash2 = await engine.hash('data2', 'sha256')

      expect(hash1).not.toBe(hash2)
    })

    it('should hash binary data', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const hash = await engine.hash(data, 'sha256')

      expect(hash).toHaveLength(64)
    })
  })

  describe('HMAC generation and verification', () => {
    it('should generate HMAC-SHA256', async () => {
      const data = 'Message to authenticate'
      const key = await engine.generateKey(256)

      const hmac = await engine.hmac(data, key, 'sha256')

      expect(hmac).toHaveLength(64) // 32 bytes = 64 hex chars
      expect(hmac).toMatch(/^[a-f0-9]+$/)
    })

    it('should generate consistent HMAC with same key', async () => {
      const data = 'Message'
      const key = await engine.generateKey(256)

      const hmac1 = await engine.hmac(data, key, 'sha256')
      const hmac2 = await engine.hmac(data, key, 'sha256')

      expect(hmac1).toBe(hmac2)
    })

    it('should generate different HMAC with different keys', async () => {
      const data = 'Message'
      const key1 = await engine.generateKey(256)
      const key2 = await engine.generateKey(256)

      const hmac1 = await engine.hmac(data, key1, 'sha256')
      const hmac2 = await engine.hmac(data, key2, 'sha256')

      expect(hmac1).not.toBe(hmac2)
    })

    it('should verify valid HMAC', async () => {
      const data = 'Message to verify'
      const key = await engine.generateKey(256)

      const hmac = await engine.hmac(data, key, 'sha256')
      const isValid = await engine.verifyHmac(data, key, hmac, 'sha256')

      expect(isValid).toBe(true)
    })

    it('should reject invalid HMAC', async () => {
      const data = 'Message'
      const key = await engine.generateKey(256)

      const isValid = await engine.verifyHmac(data, key, 'invalidhmac', 'sha256')

      expect(isValid).toBe(false)
    })
  })

  describe('Key derivation (PBKDF2)', () => {
    it('should derive key from password', async () => {
      const password = 'secure-password'
      const config: DeriveConfig = {
        salt: crypto.getRandomValues(new Uint8Array(16)),
        iterations: 100000,
        keyLength: 32,
        hash: 'sha256',
      }

      const derivedKey = await engine.deriveKey(password, config)

      expect(derivedKey).toBeInstanceOf(Uint8Array)
      expect(derivedKey.length).toBe(32)
    })

    it('should produce same key with same inputs', async () => {
      const password = 'test-password'
      const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
      const config: DeriveConfig = {
        salt,
        iterations: 10000,
        keyLength: 32,
      }

      const key1 = await engine.deriveKey(password, config)
      const key2 = await engine.deriveKey(password, config)

      expect(key1).toEqual(key2)
    })

    it('should produce different keys with different salts', async () => {
      const password = 'test-password'
      const config1: DeriveConfig = {
        salt: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
        iterations: 10000,
        keyLength: 32,
      }
      const config2: DeriveConfig = {
        salt: new Uint8Array([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
        iterations: 10000,
        keyLength: 32,
      }

      const key1 = await engine.deriveKey(password, config1)
      const key2 = await engine.deriveKey(password, config2)

      expect(key1).not.toEqual(key2)
    })

    it('should derive key of specified length', async () => {
      const password = 'test'
      const config16: DeriveConfig = {
        salt: new Uint8Array(16),
        iterations: 1000,
        keyLength: 16,
      }
      const config64: DeriveConfig = {
        salt: new Uint8Array(16),
        iterations: 1000,
        keyLength: 64,
      }

      const key16 = await engine.deriveKey(password, config16)
      const key64 = await engine.deriveKey(password, config64)

      expect(key16.length).toBe(16)
      expect(key64.length).toBe(64)
    })
  })

  describe('Random key generation', () => {
    it('should generate 128-bit key', async () => {
      const key = await engine.generateKey(128)

      expect(key).toBeInstanceOf(Uint8Array)
      expect(key.length).toBe(16) // 128 bits = 16 bytes
    })

    it('should generate 256-bit key', async () => {
      const key = await engine.generateKey(256)

      expect(key).toBeInstanceOf(Uint8Array)
      expect(key.length).toBe(32) // 256 bits = 32 bytes
    })

    it('should generate 512-bit key', async () => {
      const key = await engine.generateKey(512)

      expect(key).toBeInstanceOf(Uint8Array)
      expect(key.length).toBe(64) // 512 bits = 64 bytes
    })

    it('should generate unique keys', async () => {
      const key1 = await engine.generateKey(256)
      const key2 = await engine.generateKey(256)

      expect(key1).not.toEqual(key2)
    })
  })

  describe('Encrypt with derived key', () => {
    it('should encrypt/decrypt using password-derived key', async () => {
      const plaintext = 'Secret message'
      const password = 'my-secure-password'
      const salt = crypto.getRandomValues(new Uint8Array(16))

      const config: DeriveConfig = {
        salt,
        iterations: 100000,
        keyLength: 32,
      }

      const derivedKey = await engine.deriveKey(password, config)
      const encrypted = await engine.encrypt(plaintext, derivedKey, 'aes-256-gcm')
      const decrypted = await engine.decrypt(encrypted, derivedKey)

      expect(decrypted).toBe(plaintext)
    })
  })

  describe('Wrong key fails decryption', () => {
    it('should fail to decrypt with wrong key', async () => {
      const plaintext = 'Secret data'
      const correctKey = await engine.generateKey(256)
      const wrongKey = await engine.generateKey(256)

      const encrypted = await engine.encrypt(plaintext, correctKey, 'aes-256-gcm')

      await expect(engine.decrypt(encrypted, wrongKey)).rejects.toThrow(CryptoError)
    })

    it('should fail to decrypt with truncated key', async () => {
      const plaintext = 'Secret data'
      const key = await engine.generateKey(256)

      const encrypted = await engine.encrypt(plaintext, key, 'aes-256-gcm')
      const truncatedKey = key.slice(0, 16)

      await expect(engine.decrypt(encrypted, truncatedKey)).rejects.toThrow(CryptoError)
    })
  })

  describe('Tampered data detection', () => {
    it('should detect tampered ciphertext', async () => {
      const plaintext = 'Original message'
      const key = await engine.generateKey(256)

      const encrypted = await engine.encrypt(plaintext, key, 'aes-256-gcm')

      // Tamper with ciphertext
      const tamperedCiphertext = atob(encrypted.ciphertext)
      const tamperedBytes = new Uint8Array(tamperedCiphertext.length)
      for (let i = 0; i < tamperedCiphertext.length; i++) {
        tamperedBytes[i] = tamperedCiphertext.charCodeAt(i)
      }
      tamperedBytes[0] ^= 0xFF // Flip bits
      const tampered = { ...encrypted, ciphertext: btoa(String.fromCharCode(...tamperedBytes)) }

      await expect(engine.decrypt(tampered, key)).rejects.toThrow(CryptoError)
    })

    it('should detect tampered IV', async () => {
      const plaintext = 'Original message'
      const key = await engine.generateKey(256)

      const encrypted = await engine.encrypt(plaintext, key, 'aes-256-gcm')

      // Tamper with IV
      const tamperedIv = atob(encrypted.iv)
      const tamperedBytes = new Uint8Array(tamperedIv.length)
      for (let i = 0; i < tamperedIv.length; i++) {
        tamperedBytes[i] = tamperedIv.charCodeAt(i)
      }
      tamperedBytes[0] ^= 0xFF
      const tampered = { ...encrypted, iv: btoa(String.fromCharCode(...tamperedBytes)) }

      await expect(engine.decrypt(tampered, key)).rejects.toThrow(CryptoError)
    })

    it('should detect tampered auth tag', async () => {
      const plaintext = 'Original message'
      const key = await engine.generateKey(256)

      const encrypted = await engine.encrypt(plaintext, key, 'aes-256-gcm')

      // Tamper with auth tag
      const tamperedTag = atob(encrypted.tag!)
      const tamperedBytes = new Uint8Array(tamperedTag.length)
      for (let i = 0; i < tamperedTag.length; i++) {
        tamperedBytes[i] = tamperedTag.charCodeAt(i)
      }
      tamperedBytes[0] ^= 0xFF
      const tampered = { ...encrypted, tag: btoa(String.fromCharCode(...tamperedBytes)) }

      await expect(engine.decrypt(tampered, key)).rejects.toThrow(CryptoError)
    })
  })

  describe('Constant time comparison', () => {
    it('should return true for equal strings', () => {
      expect(constantTimeCompare('abc123', 'abc123')).toBe(true)
    })

    it('should return false for different strings', () => {
      expect(constantTimeCompare('abc123', 'abc124')).toBe(false)
    })

    it('should return false for different length strings', () => {
      expect(constantTimeCompare('abc', 'abcd')).toBe(false)
    })

    it('should return true for equal Uint8Arrays', () => {
      const a = new Uint8Array([1, 2, 3])
      const b = new Uint8Array([1, 2, 3])
      expect(constantTimeCompare(a, b)).toBe(true)
    })

    it('should return false for different Uint8Arrays', () => {
      const a = new Uint8Array([1, 2, 3])
      const b = new Uint8Array([1, 2, 4])
      expect(constantTimeCompare(a, b)).toBe(false)
    })

    it('should handle empty inputs', () => {
      expect(constantTimeCompare('', '')).toBe(true)
      expect(constantTimeCompare(new Uint8Array(0), new Uint8Array(0))).toBe(true)
    })
  })

  describe('Key pair generation', () => {
    it('should generate RSA key pair', async () => {
      const keyPair = await engine.generateKeyPair('RSA', 2048)

      expect(keyPair.publicKey).toBeDefined()
      expect(keyPair.privateKey).toBeDefined()
      expect(keyPair.algorithm).toBe('RSA')
    })

    it('should generate ECDSA key pair', async () => {
      const keyPair = await engine.generateKeyPair('ECDSA', 256)

      expect(keyPair.publicKey).toBeDefined()
      expect(keyPair.privateKey).toBeDefined()
      expect(keyPair.algorithm).toBe('ECDSA')
    })
  })

  describe('Sign and verify', () => {
    it('should sign and verify with RSA', async () => {
      const keyPair = await engine.generateKeyPair('RSA', 2048)
      const data = 'Data to sign'

      const signature = await engine.sign(data, keyPair.privateKey)
      expect(signature.signature).toBeDefined()
      expect(signature.algorithm).toBeDefined()

      const isValid = await engine.verify(data, signature, keyPair.publicKey)
      expect(isValid).toBe(true)
    })

    it('should sign and verify with ECDSA', async () => {
      const keyPair = await engine.generateKeyPair('ECDSA', 256)
      const data = 'Data to sign with ECDSA'

      const signature = await engine.sign(data, keyPair.privateKey)
      const isValid = await engine.verify(data, signature, keyPair.publicKey)

      expect(isValid).toBe(true)
    })

    it('should reject invalid signature', async () => {
      const keyPair = await engine.generateKeyPair('RSA', 2048)
      const data = 'Original data'

      const signature = await engine.sign(data, keyPair.privateKey)
      const isValid = await engine.verify('Modified data', signature, keyPair.publicKey)

      expect(isValid).toBe(false)
    })

    it('should reject signature with wrong public key', async () => {
      const keyPair1 = await engine.generateKeyPair('RSA', 2048)
      const keyPair2 = await engine.generateKeyPair('RSA', 2048)
      const data = 'Data'

      const signature = await engine.sign(data, keyPair1.privateKey)
      const isValid = await engine.verify(data, signature, keyPair2.publicKey)

      expect(isValid).toBe(false)
    })
  })
})

describe('AESCipher', () => {
  let cipher: AESCipher

  beforeEach(() => {
    cipher = new AESCipher()
  })

  it('should encrypt with GCM mode', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const plaintext = new TextEncoder().encode('Test data')

    const encrypted = await cipher.encrypt(plaintext, key, 'aes-256-gcm')

    expect(encrypted.ciphertext).toBeDefined()
    expect(encrypted.iv).toBeDefined()
    expect(encrypted.tag).toBeDefined()
  })

  it('should decrypt with GCM mode', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const plaintext = new TextEncoder().encode('Test data')

    const encrypted = await cipher.encrypt(plaintext, key, 'aes-256-gcm')
    const decrypted = await cipher.decrypt(encrypted, key)

    expect(decrypted).toEqual(plaintext)
  })

  it('should encrypt with CBC mode', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const plaintext = new TextEncoder().encode('Test data for CBC')

    const encrypted = await cipher.encrypt(plaintext, key, 'aes-256-cbc')
    const decrypted = await cipher.decrypt(encrypted, key)

    expect(decrypted).toEqual(plaintext)
  })
})

describe('HashGenerator', () => {
  let hasher: HashGenerator

  beforeEach(() => {
    hasher = new HashGenerator()
  })

  it('should hash with SHA-256', async () => {
    const data = new TextEncoder().encode('Test')
    const hash = await hasher.hash(data, 'sha256')

    expect(hash).toBeInstanceOf(Uint8Array)
    expect(hash.length).toBe(32)
  })

  it('should hash with SHA-512', async () => {
    const data = new TextEncoder().encode('Test')
    const hash = await hasher.hash(data, 'sha512')

    expect(hash).toBeInstanceOf(Uint8Array)
    expect(hash.length).toBe(64)
  })

  it('should compute HMAC', async () => {
    const data = new TextEncoder().encode('Message')
    const key = crypto.getRandomValues(new Uint8Array(32))

    const hmac = await hasher.hmac(data, key, 'sha256')

    expect(hmac).toBeInstanceOf(Uint8Array)
    expect(hmac.length).toBe(32)
  })
})

describe('KeyDeriver', () => {
  let deriver: KeyDeriver

  beforeEach(() => {
    deriver = new KeyDeriver()
  })

  it('should derive key with PBKDF2', async () => {
    const password = 'test-password'
    const salt = new Uint8Array(16)
    const config: DeriveConfig = {
      salt,
      iterations: 10000,
      keyLength: 32,
    }

    const key = await deriver.derive(password, config, 'pbkdf2')

    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.length).toBe(32)
  })

  it('should produce consistent results', async () => {
    const password = 'consistent'
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    const config: DeriveConfig = {
      salt,
      iterations: 1000,
      keyLength: 32,
    }

    const key1 = await deriver.derive(password, config, 'pbkdf2')
    const key2 = await deriver.derive(password, config, 'pbkdf2')

    expect(key1).toEqual(key2)
  })
})

describe('AsymmetricCrypto', () => {
  let crypto: AsymmetricCrypto

  beforeEach(() => {
    crypto = new AsymmetricCrypto()
  })

  it('should generate RSA key pair', async () => {
    const keyPair = await crypto.generateKeyPair('RSA', 2048)

    expect(keyPair.publicKey).toBeDefined()
    expect(keyPair.privateKey).toBeDefined()
  })

  it('should sign with RSA', async () => {
    const keyPair = await crypto.generateKeyPair('RSA', 2048)
    const data = new TextEncoder().encode('Data to sign')

    const signature = await crypto.sign(data, keyPair.privateKey)

    expect(signature).toBeInstanceOf(Uint8Array)
  })

  it('should verify RSA signature', async () => {
    const keyPair = await crypto.generateKeyPair('RSA', 2048)
    const data = new TextEncoder().encode('Data to sign')

    const signature = await crypto.sign(data, keyPair.privateKey)
    const isValid = await crypto.verify(data, signature, keyPair.publicKey)

    expect(isValid).toBe(true)
  })

  it('should generate ECDSA key pair', async () => {
    const keyPair = await crypto.generateKeyPair('ECDSA', 256)

    expect(keyPair.publicKey).toBeDefined()
    expect(keyPair.privateKey).toBeDefined()
  })
})

describe('RandomGenerator', () => {
  let generator: RandomGenerator

  beforeEach(() => {
    generator = new RandomGenerator()
  })

  it('should generate random bytes', () => {
    const bytes = generator.getRandomBytes(32)

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(32)
  })

  it('should generate unique values', () => {
    const bytes1 = generator.getRandomBytes(32)
    const bytes2 = generator.getRandomBytes(32)

    expect(bytes1).not.toEqual(bytes2)
  })

  it('should generate random UUID', () => {
    const uuid = generator.getRandomUUID()

    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('should generate random hex string', () => {
    const hex = generator.getRandomHex(16)

    expect(hex).toHaveLength(32) // 16 bytes = 32 hex chars
    expect(hex).toMatch(/^[0-9a-f]+$/)
  })
})
