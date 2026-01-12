/**
 * CryptoEngine Types
 * Comprehensive cryptography system for the dotdo platform
 */

/**
 * Supported symmetric encryption algorithms
 */
export type EncryptionAlgorithm = 'aes-256-gcm' | 'aes-256-cbc' | 'chacha20-poly1305'

/**
 * Supported cryptographic hash algorithms
 */
export type HashAlgorithm = 'sha256' | 'sha384' | 'sha512' | 'blake2b'

/**
 * Supported key derivation functions
 */
export type KeyDerivation = 'pbkdf2' | 'scrypt' | 'argon2'

/**
 * Result of a symmetric encryption operation
 */
export interface EncryptedData {
  /** Base64-encoded ciphertext */
  ciphertext: string
  /** Base64-encoded initialization vector */
  iv: string
  /** Base64-encoded authentication tag (for AEAD algorithms) */
  tag?: string
  /** Algorithm used for encryption */
  algorithm: EncryptionAlgorithm
}

/**
 * Asymmetric key pair
 */
export interface KeyPair {
  /** Public key (PEM or raw format) */
  publicKey: string
  /** Private key (PEM or raw format) */
  privateKey: string
  /** Key algorithm (RSA, ECDSA, Ed25519) */
  algorithm?: 'RSA' | 'ECDSA' | 'Ed25519'
  /** Key size in bits (for RSA) */
  keySize?: number
}

/**
 * Result of a digital signature operation
 */
export interface SignatureResult {
  /** Base64-encoded signature */
  signature: string
  /** Algorithm used for signing */
  algorithm: string
}

/**
 * Configuration for key derivation
 */
export interface DeriveConfig {
  /** Base64-encoded salt (or raw Uint8Array) */
  salt: string | Uint8Array
  /** Number of iterations (for PBKDF2) or cost parameter */
  iterations: number
  /** Desired key length in bytes */
  keyLength: number
  /** Hash algorithm for PBKDF2 */
  hash?: HashAlgorithm
  /** Memory cost for scrypt (in bytes) */
  memoryCost?: number
  /** Parallelism factor for scrypt/argon2 */
  parallelism?: number
}

/**
 * Options for HMAC generation
 */
export interface HmacOptions {
  /** Hash algorithm to use */
  algorithm?: HashAlgorithm
  /** Output encoding */
  encoding?: 'hex' | 'base64' | 'raw'
}

/**
 * Options for key generation
 */
export interface KeyGenerationOptions {
  /** Key size in bits */
  bits?: number
  /** For asymmetric keys: algorithm type */
  type?: 'symmetric' | 'rsa' | 'ecdsa' | 'ed25519'
  /** For RSA keys: public exponent */
  publicExponent?: number
  /** For ECDSA: curve name */
  curve?: 'P-256' | 'P-384' | 'P-521'
}

/**
 * Options for encryption operations
 */
export interface EncryptOptions {
  /** Additional authenticated data (for AEAD modes) */
  aad?: Uint8Array
  /** Custom IV (if not provided, random IV is generated) */
  iv?: Uint8Array
}

/**
 * Options for decryption operations
 */
export interface DecryptOptions {
  /** Additional authenticated data (must match encryption AAD) */
  aad?: Uint8Array
}

/**
 * Options for signing operations
 */
export interface SignOptions {
  /** Hash algorithm for RSA-PSS or ECDSA */
  hash?: HashAlgorithm
  /** Padding scheme for RSA */
  padding?: 'PKCS1v1.5' | 'PSS'
  /** Salt length for PSS */
  saltLength?: number
}

/**
 * Options for verification operations
 */
export interface VerifyOptions extends SignOptions {}

/**
 * Error thrown during cryptographic operations
 */
export class CryptoError extends Error {
  constructor(
    message: string,
    public readonly operation?: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'CryptoError'
  }
}
