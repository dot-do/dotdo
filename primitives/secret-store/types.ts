/**
 * SecretStore Types
 *
 * Type definitions for the secret storage system.
 */

// =============================================================================
// Core Secret Types
// =============================================================================

/**
 * A stored secret with full metadata
 */
export interface Secret {
  /** Unique identifier */
  id: string
  /** Human-readable name */
  name: string
  /** The encrypted secret value */
  value: string
  /** Version number (increments on rotation) */
  version: number
  /** When the secret was created */
  createdAt: Date
  /** Optional expiration time */
  expiresAt?: Date
}

/**
 * Metadata about a secret (without the value)
 */
export interface SecretMetadata {
  /** Human-readable name */
  name: string
  /** Current version number */
  version: number
  /** When the secret was first created */
  createdAt: Date
  /** When the secret was last rotated */
  rotatedAt?: Date
  /** Tags for organization */
  tags: string[]
}

/**
 * A specific version of a secret
 */
export interface SecretVersion {
  /** Version number */
  version: number
  /** The encrypted value for this version */
  value: string
  /** When this version was created */
  createdAt: Date
  /** Whether this version is deprecated */
  deprecated: boolean
}

// =============================================================================
// Encryption Types
// =============================================================================

/**
 * Encryption algorithm options
 */
export type EncryptionAlgorithm = 'AES-GCM-256' | 'AES-CBC-256' | 'ChaCha20-Poly1305'

/**
 * Configuration for encryption
 */
export interface EncryptionConfig {
  /** The encryption algorithm to use */
  algorithm: EncryptionAlgorithm
  /** The key ID for envelope encryption */
  keyId: string
  /** Whether to use envelope encryption (encrypt key with master key) */
  envelope: boolean
}

// =============================================================================
// Policy Types
// =============================================================================

/**
 * Actions that can be performed on secrets
 */
export type SecretAction = 'read' | 'write' | 'delete' | 'rotate' | 'list' | 'create' | 'expire'

/**
 * Condition operators for policy evaluation
 */
export interface PolicyCondition {
  /** The attribute to check */
  attribute: string
  /** The operator for comparison */
  operator: 'equals' | 'notEquals' | 'contains' | 'startsWith' | 'endsWith'
  /** The value to compare against */
  value: string | string[]
}

/**
 * Access policy for a secret
 */
export interface AccessPolicy {
  /** List of principal identifiers allowed access */
  principals: string[]
  /** Actions permitted by this policy */
  actions: SecretAction[]
  /** Conditions that must be met */
  conditions: PolicyCondition[]
}

// =============================================================================
// Rotation Types
// =============================================================================

/**
 * Handler for rotation events
 */
export type RotationHandler = (secretName: string, newValue: string) => Promise<void>

/**
 * Notification channel for rotation events
 */
export interface RotationNotification {
  /** Type of notification */
  type: 'webhook' | 'email' | 'sns'
  /** Target endpoint/address */
  target: string
}

/**
 * Rotation policy for automatic secret rotation
 */
export interface RotationPolicy {
  /** Rotation interval in milliseconds */
  interval: number
  /** Handler to generate new secret value */
  handler: RotationHandler
  /** Notification settings */
  notification?: RotationNotification
}

// =============================================================================
// Audit Types
// =============================================================================

/**
 * Audit log entry for secret access
 */
export interface AuditLog {
  /** The action that was performed */
  action: SecretAction | 'create' | 'expire'
  /** The name of the secret */
  secretName: string
  /** The principal who performed the action */
  principal: string
  /** When the action occurred */
  timestamp: Date
  /** Optional metadata about the action */
  metadata?: Record<string, unknown>
}

// =============================================================================
// Store Options
// =============================================================================

/**
 * Options for creating a SecretStore
 */
export interface SecretStoreOptions {
  /** Encryption configuration */
  encryption?: Partial<EncryptionConfig>
  /** Default TTL for secrets in milliseconds */
  defaultTtl?: number
  /** Enable audit logging */
  auditEnabled?: boolean
  /** Cache TTL in milliseconds */
  cacheTtl?: number
}

/**
 * Options for storing a secret
 */
export interface SetSecretOptions {
  /** Tags for the secret */
  tags?: string[]
  /** Expiration time */
  expiresAt?: Date
  /** Custom encryption config for this secret */
  encryption?: Partial<EncryptionConfig>
}

/**
 * Options for retrieving a secret
 */
export interface GetSecretOptions {
  /** Specific version to retrieve */
  version?: number
  /** Whether to bypass cache */
  bypassCache?: boolean
}

/**
 * Context for policy evaluation
 */
export interface PolicyContext {
  /** The principal requesting access */
  principal: string
  /** Additional attributes for condition evaluation */
  attributes?: Record<string, string>
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error thrown when a secret is not found
 */
export class SecretNotFoundError extends Error {
  constructor(name: string) {
    super(`Secret not found: ${name}`)
    this.name = 'SecretNotFoundError'
  }
}

/**
 * Error thrown when a secret version is not found
 */
export class SecretVersionNotFoundError extends Error {
  constructor(name: string, version: number) {
    super(`Secret version not found: ${name}@${version}`)
    this.name = 'SecretVersionNotFoundError'
  }
}

/**
 * Error thrown when access is denied
 */
export class AccessDeniedError extends Error {
  constructor(action: string, secretName: string, principal: string) {
    super(`Access denied: ${principal} cannot ${action} ${secretName}`)
    this.name = 'AccessDeniedError'
  }
}

/**
 * Error thrown when a secret has expired
 */
export class SecretExpiredError extends Error {
  constructor(name: string) {
    super(`Secret has expired: ${name}`)
    this.name = 'SecretExpiredError'
  }
}

/**
 * Error thrown when encryption fails
 */
export class EncryptionError extends Error {
  constructor(message: string) {
    super(`Encryption error: ${message}`)
    this.name = 'EncryptionError'
  }
}

/**
 * Error thrown when decryption fails
 */
export class DecryptionError extends Error {
  constructor(message: string) {
    super(`Decryption error: ${message}`)
    this.name = 'DecryptionError'
  }
}
