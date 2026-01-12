/**
 * CryptoEngine
 * Comprehensive cryptography system for the dotdo platform
 *
 * Features:
 * - Symmetric encryption (AES-256-GCM, AES-256-CBC)
 * - Cryptographic hashing (SHA-256, SHA-384, SHA-512)
 * - HMAC generation and verification
 * - Key derivation (PBKDF2)
 * - Digital signatures (RSA-PSS, ECDSA)
 * - Secure random generation
 * - Constant-time comparison for timing attack prevention
 *
 * @example
 * ```typescript
 * const engine = new CryptoEngine()
 *
 * // Symmetric encryption
 * const key = await engine.generateKey(256)
 * const encrypted = await engine.encrypt('secret', key, 'aes-256-gcm')
 * const decrypted = await engine.decrypt(encrypted, key)
 *
 * // Hashing
 * const hash = await engine.hash('data', 'sha256')
 *
 * // Digital signatures
 * const keyPair = await engine.generateKeyPair('RSA', 2048)
 * const signature = await engine.sign('message', keyPair.privateKey)
 * const isValid = await engine.verify('message', signature, keyPair.publicKey)
 * ```
 */
import {
  EncryptionAlgorithm,
  HashAlgorithm,
  KeyDerivation,
  EncryptedData,
  KeyPair,
  SignatureResult,
  DeriveConfig,
  CryptoError,
} from './types'

// Re-export types
export * from './types'

/**
 * Helper to convert Uint8Array to base64
 * Uses chunked approach to avoid stack overflow with large data
 */
function toBase64(data: Uint8Array): string {
  const chunkSize = 0x8000 // 32KB chunks to avoid stack overflow
  const chunks: string[] = []

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, Math.min(i + chunkSize, data.length))
    chunks.push(String.fromCharCode.apply(null, chunk as unknown as number[]))
  }

  return btoa(chunks.join(''))
}

/**
 * Helper to convert base64 to Uint8Array
 */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Helper to convert Uint8Array to hex string
 */
function toHex(data: Uint8Array): string {
  return Array.from(data)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Helper to convert hex string to Uint8Array
 */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

/**
 * Constant-time comparison to prevent timing attacks
 * This function compares two values in a way that takes the same amount of time
 * regardless of how many bytes match, preventing timing-based side-channel attacks.
 *
 * @example
 * ```typescript
 * // Compare two HMACs safely
 * const isValid = constantTimeCompare(computedHmac, providedHmac)
 * ```
 */
export function constantTimeCompare(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const aBytes = typeof a === 'string' ? new TextEncoder().encode(a) : a
  const bBytes = typeof b === 'string' ? new TextEncoder().encode(b) : b

  if (aBytes.length !== bBytes.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i]
  }

  return result === 0
}

/**
 * ConstantTimeCompare class wrapper for static method access
 * Provides timing-safe comparison operations
 */
export class ConstantTimeCompare {
  /**
   * Compare two values in constant time
   */
  static compare(a: string | Uint8Array, b: string | Uint8Array): boolean {
    return constantTimeCompare(a, b)
  }

  /**
   * Instance method for comparison
   */
  compare(a: string | Uint8Array, b: string | Uint8Array): boolean {
    return constantTimeCompare(a, b)
  }
}

/**
 * AESCipher - AES encryption/decryption
 */
export class AESCipher {
  /**
   * Encrypt data with AES
   */
  async encrypt(
    data: Uint8Array,
    key: Uint8Array,
    algorithm: EncryptionAlgorithm
  ): Promise<EncryptedData> {
    const iv = crypto.getRandomValues(new Uint8Array(algorithm === 'aes-256-gcm' ? 12 : 16))

    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: algorithm === 'aes-256-cbc' ? 'AES-CBC' : 'AES-GCM' },
        false,
        ['encrypt']
      )

      if (algorithm === 'aes-256-gcm') {
        const encrypted = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          cryptoKey,
          data
        )

        const encryptedBytes = new Uint8Array(encrypted)
        // GCM appends the auth tag (16 bytes) to the ciphertext
        const ciphertext = encryptedBytes.slice(0, -16)
        const tag = encryptedBytes.slice(-16)

        return {
          ciphertext: toBase64(ciphertext),
          iv: toBase64(iv),
          tag: toBase64(tag),
          algorithm,
        }
      } else {
        // AES-CBC needs PKCS7 padding
        const paddedData = this.pkcs7Pad(data, 16)

        const encrypted = await crypto.subtle.encrypt(
          { name: 'AES-CBC', iv },
          cryptoKey,
          paddedData
        )

        return {
          ciphertext: toBase64(new Uint8Array(encrypted)),
          iv: toBase64(iv),
          algorithm,
        }
      }
    } catch (e) {
      throw new CryptoError(
        `Encryption failed: ${e instanceof Error ? e.message : String(e)}`,
        'encrypt',
        e instanceof Error ? e : undefined
      )
    }
  }

  /**
   * Decrypt data with AES
   */
  async decrypt(encrypted: EncryptedData, key: Uint8Array): Promise<Uint8Array> {
    const ciphertext = fromBase64(encrypted.ciphertext)
    const iv = fromBase64(encrypted.iv)

    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: encrypted.algorithm === 'aes-256-cbc' ? 'AES-CBC' : 'AES-GCM' },
        false,
        ['decrypt']
      )

      if (encrypted.algorithm === 'aes-256-gcm') {
        // Reconstruct ciphertext with auth tag
        const tag = fromBase64(encrypted.tag!)
        const combined = new Uint8Array(ciphertext.length + tag.length)
        combined.set(ciphertext)
        combined.set(tag, ciphertext.length)

        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          cryptoKey,
          combined
        )

        return new Uint8Array(decrypted)
      } else {
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-CBC', iv },
          cryptoKey,
          ciphertext
        )

        // Remove PKCS7 padding
        return this.pkcs7Unpad(new Uint8Array(decrypted))
      }
    } catch (e) {
      throw new CryptoError(
        `Decryption failed: ${e instanceof Error ? e.message : String(e)}`,
        'decrypt',
        e instanceof Error ? e : undefined
      )
    }
  }

  /**
   * PKCS7 padding
   */
  private pkcs7Pad(data: Uint8Array, blockSize: number): Uint8Array {
    const padding = blockSize - (data.length % blockSize)
    const padded = new Uint8Array(data.length + padding)
    padded.set(data)
    for (let i = data.length; i < padded.length; i++) {
      padded[i] = padding
    }
    return padded
  }

  /**
   * PKCS7 unpadding
   */
  private pkcs7Unpad(data: Uint8Array): Uint8Array {
    const padding = data[data.length - 1]
    return data.slice(0, data.length - padding)
  }
}

/**
 * HashGenerator - Multiple hash algorithms
 */
export class HashGenerator {
  /**
   * Hash data with specified algorithm
   */
  async hash(data: Uint8Array, algorithm: HashAlgorithm): Promise<Uint8Array> {
    const algoName = this.mapAlgorithm(algorithm)

    try {
      const hashBuffer = await crypto.subtle.digest(algoName, data)
      return new Uint8Array(hashBuffer)
    } catch (e) {
      throw new CryptoError(
        `Hash failed: ${e instanceof Error ? e.message : String(e)}`,
        'hash',
        e instanceof Error ? e : undefined
      )
    }
  }

  /**
   * Compute HMAC
   */
  async hmac(data: Uint8Array, key: Uint8Array, algorithm: HashAlgorithm): Promise<Uint8Array> {
    const algoName = this.mapAlgorithm(algorithm)

    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: algoName },
        false,
        ['sign']
      )

      const signature = await crypto.subtle.sign('HMAC', cryptoKey, data)
      return new Uint8Array(signature)
    } catch (e) {
      throw new CryptoError(
        `HMAC failed: ${e instanceof Error ? e.message : String(e)}`,
        'hmac',
        e instanceof Error ? e : undefined
      )
    }
  }

  /**
   * Verify HMAC
   */
  async verifyHmac(
    data: Uint8Array,
    key: Uint8Array,
    hmac: Uint8Array,
    algorithm: HashAlgorithm
  ): Promise<boolean> {
    const computed = await this.hmac(data, key, algorithm)
    return constantTimeCompare(computed, hmac)
  }

  /**
   * Map algorithm name to Web Crypto API name
   */
  private mapAlgorithm(algorithm: HashAlgorithm): string {
    switch (algorithm) {
      case 'sha256': return 'SHA-256'
      case 'sha384': return 'SHA-384'
      case 'sha512': return 'SHA-512'
      case 'blake2b': return 'SHA-512' // Fallback - blake2b not in Web Crypto
      default: return 'SHA-256'
    }
  }
}

/**
 * KeyDeriver - PBKDF2/scrypt key derivation
 */
export class KeyDeriver {
  /**
   * Derive key from password
   */
  async derive(
    password: string,
    config: DeriveConfig,
    method: KeyDerivation = 'pbkdf2'
  ): Promise<Uint8Array> {
    const salt = typeof config.salt === 'string'
      ? fromBase64(config.salt)
      : config.salt

    const hash = this.mapHash(config.hash || 'sha256')

    try {
      const passwordKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
      )

      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt,
          iterations: config.iterations,
          hash,
        },
        passwordKey,
        config.keyLength * 8
      )

      return new Uint8Array(derivedBits)
    } catch (e) {
      throw new CryptoError(
        `Key derivation failed: ${e instanceof Error ? e.message : String(e)}`,
        'derive',
        e instanceof Error ? e : undefined
      )
    }
  }

  /**
   * Map hash algorithm name
   */
  private mapHash(algorithm: HashAlgorithm): string {
    switch (algorithm) {
      case 'sha256': return 'SHA-256'
      case 'sha384': return 'SHA-384'
      case 'sha512': return 'SHA-512'
      default: return 'SHA-256'
    }
  }
}

/**
 * AsymmetricCrypto - RSA/ECDSA operations
 */
export class AsymmetricCrypto {
  private keyCache = new Map<string, CryptoKey>()

  /**
   * Generate asymmetric key pair
   */
  async generateKeyPair(
    algorithm: 'RSA' | 'ECDSA' | 'Ed25519',
    keySize: number
  ): Promise<KeyPair> {
    try {
      let keyPair: CryptoKeyPair

      if (algorithm === 'RSA') {
        keyPair = await crypto.subtle.generateKey(
          {
            name: 'RSA-PSS',
            modulusLength: keySize,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
          },
          true,
          ['sign', 'verify']
        )
      } else if (algorithm === 'ECDSA') {
        const namedCurve = keySize <= 256 ? 'P-256' : keySize <= 384 ? 'P-384' : 'P-521'
        keyPair = await crypto.subtle.generateKey(
          {
            name: 'ECDSA',
            namedCurve,
          },
          true,
          ['sign', 'verify']
        )
      } else {
        throw new CryptoError('Ed25519 not supported in Web Crypto API', 'generateKeyPair')
      }

      // Export keys to portable format
      const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey)
      const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

      const publicKey = toBase64(new Uint8Array(publicKeyBuffer))
      const privateKey = toBase64(new Uint8Array(privateKeyBuffer))

      // Cache the keys for later use
      this.keyCache.set(`pub:${publicKey}`, keyPair.publicKey)
      this.keyCache.set(`priv:${privateKey}`, keyPair.privateKey)

      return {
        publicKey,
        privateKey,
        algorithm,
        keySize,
      }
    } catch (e) {
      throw new CryptoError(
        `Key pair generation failed: ${e instanceof Error ? e.message : String(e)}`,
        'generateKeyPair',
        e instanceof Error ? e : undefined
      )
    }
  }

  /**
   * Sign data with private key
   */
  async sign(data: Uint8Array, privateKey: string): Promise<Uint8Array> {
    try {
      let cryptoKey = this.keyCache.get(`priv:${privateKey}`)

      if (!cryptoKey) {
        // Try to import as RSA key first
        try {
          cryptoKey = await crypto.subtle.importKey(
            'pkcs8',
            fromBase64(privateKey),
            { name: 'RSA-PSS', hash: 'SHA-256' },
            false,
            ['sign']
          )
        } catch {
          // Try ECDSA
          cryptoKey = await crypto.subtle.importKey(
            'pkcs8',
            fromBase64(privateKey),
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['sign']
          )
        }
      }

      let signature: ArrayBuffer

      if (cryptoKey.algorithm.name === 'RSA-PSS') {
        signature = await crypto.subtle.sign(
          { name: 'RSA-PSS', saltLength: 32 },
          cryptoKey,
          data
        )
      } else {
        signature = await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          cryptoKey,
          data
        )
      }

      return new Uint8Array(signature)
    } catch (e) {
      throw new CryptoError(
        `Signing failed: ${e instanceof Error ? e.message : String(e)}`,
        'sign',
        e instanceof Error ? e : undefined
      )
    }
  }

  /**
   * Verify signature with public key
   */
  async verify(data: Uint8Array, signature: Uint8Array, publicKey: string): Promise<boolean> {
    try {
      let cryptoKey = this.keyCache.get(`pub:${publicKey}`)

      if (!cryptoKey) {
        // Try to import as RSA key first
        try {
          cryptoKey = await crypto.subtle.importKey(
            'spki',
            fromBase64(publicKey),
            { name: 'RSA-PSS', hash: 'SHA-256' },
            false,
            ['verify']
          )
        } catch {
          // Try ECDSA
          cryptoKey = await crypto.subtle.importKey(
            'spki',
            fromBase64(publicKey),
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
          )
        }
      }

      if (cryptoKey.algorithm.name === 'RSA-PSS') {
        return await crypto.subtle.verify(
          { name: 'RSA-PSS', saltLength: 32 },
          cryptoKey,
          signature,
          data
        )
      } else {
        return await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          cryptoKey,
          signature,
          data
        )
      }
    } catch (e) {
      // Verification failure is not an error, just return false
      return false
    }
  }
}

/**
 * RandomGenerator - Secure random generation
 */
export class RandomGenerator {
  /**
   * Generate random bytes
   */
  getRandomBytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length))
  }

  /**
   * Generate random UUID (v4)
   */
  getRandomUUID(): string {
    return crypto.randomUUID()
  }

  /**
   * Generate random hex string
   */
  getRandomHex(byteLength: number): string {
    return toHex(this.getRandomBytes(byteLength))
  }
}

/**
 * Main CryptoEngine class
 */
export class CryptoEngine {
  private aesCipher: AESCipher
  private hashGenerator: HashGenerator
  private keyDeriver: KeyDeriver
  private asymmetricCrypto: AsymmetricCrypto
  private randomGenerator: RandomGenerator

  constructor() {
    this.aesCipher = new AESCipher()
    this.hashGenerator = new HashGenerator()
    this.keyDeriver = new KeyDeriver()
    this.asymmetricCrypto = new AsymmetricCrypto()
    this.randomGenerator = new RandomGenerator()
  }

  /**
   * Symmetric encryption
   */
  async encrypt(
    data: string | Uint8Array,
    key: Uint8Array,
    algorithm: EncryptionAlgorithm
  ): Promise<EncryptedData> {
    const dataBytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data

    return this.aesCipher.encrypt(dataBytes, key, algorithm)
  }

  /**
   * Symmetric decryption (returns string)
   */
  async decrypt(encrypted: EncryptedData, key: Uint8Array): Promise<string> {
    const decrypted = await this.aesCipher.decrypt(encrypted, key)
    return new TextDecoder().decode(decrypted)
  }

  /**
   * Symmetric decryption (returns raw bytes)
   * Use this for binary data that may not be valid UTF-8
   */
  async decryptRaw(encrypted: EncryptedData, key: Uint8Array): Promise<Uint8Array> {
    return this.aesCipher.decrypt(encrypted, key)
  }

  /**
   * Cryptographic hashing
   */
  async hash(data: string | Uint8Array, algorithm: HashAlgorithm): Promise<string> {
    const dataBytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data

    const hashBytes = await this.hashGenerator.hash(dataBytes, algorithm)
    return toHex(hashBytes)
  }

  /**
   * HMAC generation
   */
  async hmac(
    data: string | Uint8Array,
    key: Uint8Array,
    algorithm: HashAlgorithm
  ): Promise<string> {
    const dataBytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data

    const hmacBytes = await this.hashGenerator.hmac(dataBytes, key, algorithm)
    return toHex(hmacBytes)
  }

  /**
   * HMAC verification
   */
  async verifyHmac(
    data: string | Uint8Array,
    key: Uint8Array,
    hmac: string,
    algorithm: HashAlgorithm
  ): Promise<boolean> {
    const computed = await this.hmac(data, key, algorithm)
    return constantTimeCompare(computed, hmac)
  }

  /**
   * Digital signature
   */
  async sign(data: string | Uint8Array, privateKey: string): Promise<SignatureResult> {
    const dataBytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data

    const signature = await this.asymmetricCrypto.sign(dataBytes, privateKey)
    return {
      signature: toBase64(signature),
      algorithm: 'RSA-PSS/SHA-256',
    }
  }

  /**
   * Signature verification
   */
  async verify(
    data: string | Uint8Array,
    signature: SignatureResult,
    publicKey: string
  ): Promise<boolean> {
    const dataBytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data

    return this.asymmetricCrypto.verify(
      dataBytes,
      fromBase64(signature.signature),
      publicKey
    )
  }

  /**
   * Random key generation
   */
  async generateKey(bits: number): Promise<Uint8Array> {
    return this.randomGenerator.getRandomBytes(bits / 8)
  }

  /**
   * Key derivation
   */
  async deriveKey(password: string, config: DeriveConfig): Promise<Uint8Array> {
    return this.keyDeriver.derive(password, config, 'pbkdf2')
  }

  /**
   * Key pair generation
   */
  async generateKeyPair(
    algorithm: 'RSA' | 'ECDSA' | 'Ed25519',
    keySize: number
  ): Promise<KeyPair> {
    return this.asymmetricCrypto.generateKeyPair(algorithm, keySize)
  }
}
