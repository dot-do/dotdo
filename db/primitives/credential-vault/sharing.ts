/**
 * Credential Sharing - Cross-DO credential access
 *
 * Provides secure credential sharing between Durable Objects:
 * - Delegation tokens (short-lived, scoped)
 * - Cross-DO RPC for credential access
 * - Centralized CredentialVault DO per tenant
 * - Cap'n Web promise pipelining for efficient access
 * - Revocation propagation across DOs
 *
 * @example
 * ```typescript
 * import { CredentialSharingManager, createCredentialSharingManager } from './sharing'
 *
 * // In source DO
 * const manager = createCredentialSharingManager({
 *   vaultStub: env.CREDENTIAL_VAULT.get(tenantId),
 *   sourceDoId: ctx.id.toString(),
 * })
 *
 * // Create a delegation token for another DO
 * const delegationToken = await manager.createDelegationToken({
 *   targetDoId: 'workflow-do-123',
 *   credentials: ['stripe-api-key'],
 *   permissions: ['read'],
 *   expiresIn: '5m',
 *   purpose: 'Payment processing workflow',
 * })
 *
 * // In target DO - use the delegation token
 * const credential = await manager.getWithDelegation(delegationToken, 'stripe-api-key')
 * ```
 *
 * @module db/primitives/credential-vault/sharing
 */

import { EventEmitter } from 'events'

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Permission levels for delegation tokens
 */
export type DelegationPermission = 'read' | 'use' | 'rotate'

/**
 * Delegation token structure
 */
export interface DelegationToken {
  /** Unique token identifier */
  id: string
  /** The cryptographic token value */
  token: string
  /** Source DO that created this delegation */
  sourceDoId: string
  /** Target DO that can use this delegation */
  targetDoId: string
  /** Tenant ID for isolation */
  tenantId: string
  /** Credentials this token grants access to */
  credentials: string[]
  /** Scopes (wildcard patterns like 'payments:*') */
  scopes?: string[]
  /** Permission levels granted */
  permissions: DelegationPermission[]
  /** Purpose/reason for delegation (audit) */
  purpose?: string
  /** Token expiration time */
  expiresAt: Date
  /** Token creation time */
  createdAt: Date
  /** Time token was revoked (if revoked) */
  revokedAt?: Date
  /** Single-use flag - token invalidated after first use */
  singleUse?: boolean
  /** Whether token has been used */
  used?: boolean
  /** Maximum number of uses (optional) */
  maxUses?: number
  /** Current use count */
  useCount?: number
}

/**
 * Options for creating a delegation token
 */
export interface DelegationTokenOptions {
  /** Target DO that will use this token */
  targetDoId: string
  /** Specific credentials to grant access to */
  credentials?: string[]
  /** Scope patterns for access (e.g., 'payments:*') */
  scopes?: string[]
  /** Permissions to grant */
  permissions: DelegationPermission[]
  /** How long the token is valid (e.g., '5m', '1h') */
  expiresIn: string
  /** Purpose for audit logging */
  purpose?: string
  /** Single-use token */
  singleUse?: boolean
  /** Maximum uses before invalidation */
  maxUses?: number
}

/**
 * Credential access request from another DO
 */
export interface CredentialAccessRequest {
  /** Delegation token for authorization */
  delegationToken: string
  /** Name of credential to access */
  credentialName: string
  /** Requesting DO's ID */
  requestingDoId: string
  /** Request context for audit */
  context?: AccessRequestContext
}

/**
 * Context for credential access requests
 */
export interface AccessRequestContext {
  /** Workflow or action ID */
  workflowId?: string
  /** Step within workflow */
  stepId?: string
  /** Request trace ID */
  traceId?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Result of credential access
 */
export interface CredentialAccessResult {
  /** Whether access was granted */
  granted: boolean
  /** The credential value (if granted) */
  credential?: {
    name: string
    type: string
    value: unknown
    version: number
  }
  /** Error details (if denied) */
  error?: {
    code: string
    message: string
  }
  /** Access audit ID */
  auditId: string
}

/**
 * Revocation broadcast message
 */
export interface RevocationBroadcast {
  /** Type of revocation */
  type: 'token' | 'credential' | 'tenant'
  /** ID of revoked item */
  targetId: string
  /** Tenant affected */
  tenantId: string
  /** Timestamp of revocation */
  revokedAt: Date
  /** Reason for revocation */
  reason?: string
  /** DOs that should invalidate cached access */
  affectedDos?: string[]
}

/**
 * Vault stub interface for cross-DO communication
 */
export interface VaultStubInterface {
  /** Fetch credential by name */
  fetch(request: Request): Promise<Response>
}

/**
 * Configuration for CredentialSharingManager
 */
export interface CredentialSharingConfig {
  /** Tenant ID for isolation */
  tenantId: string
  /** This DO's ID */
  sourceDoId: string
  /** Encryption key for token signing */
  signingKey: string
  /** Default token expiration */
  defaultExpiresIn?: string
  /** Enable revocation broadcasting */
  enableRevocationBroadcast?: boolean
}

/**
 * Audit log entry for delegation
 */
export interface DelegationAuditEntry {
  id: string
  type: 'created' | 'used' | 'denied' | 'revoked' | 'expired'
  delegationTokenId: string
  sourceDoId: string
  targetDoId?: string
  credentialName?: string
  permissions?: DelegationPermission[]
  timestamp: Date
  context?: AccessRequestContext
  error?: { code: string; message: string }
}

/**
 * Events emitted by CredentialSharingManager
 */
export interface CredentialSharingEvents {
  'delegation:created': DelegationToken
  'delegation:used': { tokenId: string; credentialName: string; targetDoId: string }
  'delegation:denied': { tokenId: string; reason: string; targetDoId: string }
  'delegation:revoked': { tokenId: string; reason: string }
  'revocation:received': RevocationBroadcast
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Generate a secure token
 */
function generateSecureToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return bufferToBase64(bytes.buffer)
}

/**
 * Convert ArrayBuffer to base64 string
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/**
 * Parse duration string to milliseconds
 */
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

/**
 * Match wildcard pattern
 */
function matchScope(credentialScope: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1) // Remove trailing *
    return credentialScope.startsWith(prefix)
  }
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    return regex.test(credentialScope)
  }
  return credentialScope === pattern
}

/**
 * Hash a token for storage (we don't store raw tokens)
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return bufferToBase64(hashBuffer)
}

// =============================================================================
// CredentialSharingManager Implementation
// =============================================================================

/**
 * Manages credential sharing between Durable Objects
 */
export class CredentialSharingManager extends EventEmitter {
  private readonly tenantId: string
  private readonly sourceDoId: string
  private readonly signingKey: string
  private readonly defaultExpiresIn: string
  private readonly enableRevocationBroadcast: boolean

  /** Active delegation tokens (by token hash) */
  private delegationTokens: Map<string, DelegationToken> = new Map()

  /** Revocation list (hashed tokens that have been revoked) */
  private revokedTokenHashes: Set<string> = new Set()

  /** Audit log */
  private auditLog: DelegationAuditEntry[] = []

  /** Cached credential scopes (credentialName -> scope) */
  private credentialScopes: Map<string, string> = new Map()

  constructor(config: CredentialSharingConfig) {
    super()

    if (!config.tenantId) {
      throw new Error('tenantId is required')
    }
    if (!config.sourceDoId) {
      throw new Error('sourceDoId is required')
    }
    if (!config.signingKey || config.signingKey.length < 32) {
      throw new Error('signingKey must be at least 32 characters')
    }

    this.tenantId = config.tenantId
    this.sourceDoId = config.sourceDoId
    this.signingKey = config.signingKey
    this.defaultExpiresIn = config.defaultExpiresIn ?? '5m'
    this.enableRevocationBroadcast = config.enableRevocationBroadcast ?? true
  }

  // ===========================================================================
  // Delegation Token Management
  // ===========================================================================

  /**
   * Create a delegation token for another DO to access credentials
   */
  async createDelegationToken(options: DelegationTokenOptions): Promise<DelegationToken> {
    // Validate inputs
    if (!options.targetDoId) {
      throw new Error('targetDoId is required')
    }
    if (!options.permissions || options.permissions.length === 0) {
      throw new Error('At least one permission is required')
    }
    if (!options.credentials?.length && !options.scopes?.length) {
      throw new Error('Either credentials or scopes must be specified')
    }

    const token = generateSecureToken()
    const tokenHash = await hashToken(token)
    const expiresIn = options.expiresIn || this.defaultExpiresIn

    const delegationToken: DelegationToken = {
      id: generateId(),
      token,
      sourceDoId: this.sourceDoId,
      targetDoId: options.targetDoId,
      tenantId: this.tenantId,
      credentials: options.credentials ?? [],
      scopes: options.scopes,
      permissions: options.permissions,
      purpose: options.purpose,
      expiresAt: new Date(Date.now() + parseDuration(expiresIn)),
      createdAt: new Date(),
      singleUse: options.singleUse,
      maxUses: options.maxUses,
      useCount: 0,
    }

    // Store by hash (not raw token)
    this.delegationTokens.set(tokenHash, delegationToken)

    // Log creation
    this.logAudit({
      type: 'created',
      delegationTokenId: delegationToken.id,
      sourceDoId: this.sourceDoId,
      targetDoId: options.targetDoId,
      permissions: options.permissions,
    })

    this.emit('delegation:created', delegationToken)

    return delegationToken
  }

  /**
   * Validate a delegation token and return access result
   */
  async validateDelegation(
    token: string,
    credentialName: string,
    requestingDoId: string,
    context?: AccessRequestContext
  ): Promise<CredentialAccessResult> {
    const auditId = generateId()
    const tokenHash = await hashToken(token)

    // Check if token exists
    const delegation = this.delegationTokens.get(tokenHash)
    if (!delegation) {
      return this.denyAccess(auditId, 'INVALID_TOKEN', 'Delegation token not found or invalid', {
        tokenId: 'unknown',
        targetDoId: requestingDoId,
        context,
      })
    }

    // Check if token is revoked
    if (this.revokedTokenHashes.has(tokenHash) || delegation.revokedAt) {
      return this.denyAccess(auditId, 'TOKEN_REVOKED', 'Delegation token has been revoked', {
        tokenId: delegation.id,
        targetDoId: requestingDoId,
        context,
      })
    }

    // Check token expiration
    if (delegation.expiresAt.getTime() < Date.now()) {
      this.logAudit({
        type: 'expired',
        delegationTokenId: delegation.id,
        sourceDoId: delegation.sourceDoId,
        targetDoId: requestingDoId,
        credentialName,
        context,
      })
      return this.denyAccess(auditId, 'TOKEN_EXPIRED', 'Delegation token has expired', {
        tokenId: delegation.id,
        targetDoId: requestingDoId,
        context,
      })
    }

    // Check tenant isolation
    if (delegation.tenantId !== this.tenantId) {
      return this.denyAccess(auditId, 'TENANT_MISMATCH', 'Token does not belong to this tenant', {
        tokenId: delegation.id,
        targetDoId: requestingDoId,
        context,
      })
    }

    // Check target DO matches
    if (delegation.targetDoId !== requestingDoId) {
      return this.denyAccess(auditId, 'TARGET_MISMATCH', 'Token was not issued for this DO', {
        tokenId: delegation.id,
        targetDoId: requestingDoId,
        context,
      })
    }

    // Check credential access
    const hasCredentialAccess = this.checkCredentialAccess(delegation, credentialName)
    if (!hasCredentialAccess) {
      return this.denyAccess(auditId, 'CREDENTIAL_NOT_ALLOWED', 'Token does not grant access to this credential', {
        tokenId: delegation.id,
        targetDoId: requestingDoId,
        credentialName,
        context,
      })
    }

    // Check permissions (read is minimum for access)
    if (!delegation.permissions.includes('read') && !delegation.permissions.includes('use')) {
      return this.denyAccess(auditId, 'INSUFFICIENT_PERMISSIONS', 'Token does not have read permission', {
        tokenId: delegation.id,
        targetDoId: requestingDoId,
        credentialName,
        context,
      })
    }

    // Check single-use constraint
    if (delegation.singleUse && delegation.used) {
      return this.denyAccess(auditId, 'TOKEN_ALREADY_USED', 'Single-use token has already been used', {
        tokenId: delegation.id,
        targetDoId: requestingDoId,
        context,
      })
    }

    // Check max uses constraint
    if (delegation.maxUses && delegation.useCount && delegation.useCount >= delegation.maxUses) {
      return this.denyAccess(auditId, 'MAX_USES_EXCEEDED', 'Token has exceeded maximum uses', {
        tokenId: delegation.id,
        targetDoId: requestingDoId,
        context,
      })
    }

    // Update use tracking
    delegation.used = true
    delegation.useCount = (delegation.useCount ?? 0) + 1

    // Log successful access
    this.logAudit({
      type: 'used',
      delegationTokenId: delegation.id,
      sourceDoId: delegation.sourceDoId,
      targetDoId: requestingDoId,
      credentialName,
      permissions: delegation.permissions,
      context,
    })

    this.emit('delegation:used', {
      tokenId: delegation.id,
      credentialName,
      targetDoId: requestingDoId,
    })

    // Return success (caller fetches actual credential)
    return {
      granted: true,
      auditId,
    }
  }

  /**
   * Check if delegation grants access to a credential
   */
  private checkCredentialAccess(delegation: DelegationToken, credentialName: string): boolean {
    // Check explicit credentials list
    if (delegation.credentials.length > 0) {
      if (delegation.credentials.includes(credentialName)) {
        return true
      }
    }

    // Check scope patterns
    if (delegation.scopes && delegation.scopes.length > 0) {
      const credentialScope = this.credentialScopes.get(credentialName)
      if (credentialScope) {
        for (const scopePattern of delegation.scopes) {
          if (matchScope(credentialScope, scopePattern)) {
            return true
          }
        }
      }
    }

    // If no explicit credentials and no matching scopes, deny
    return delegation.credentials.length === 0 && (!delegation.scopes || delegation.scopes.length === 0)
  }

  /**
   * Helper to create denial result
   */
  private denyAccess(
    auditId: string,
    code: string,
    message: string,
    details: {
      tokenId: string
      targetDoId: string
      credentialName?: string
      context?: AccessRequestContext
    }
  ): CredentialAccessResult {
    this.logAudit({
      type: 'denied',
      delegationTokenId: details.tokenId,
      sourceDoId: this.sourceDoId,
      targetDoId: details.targetDoId,
      credentialName: details.credentialName,
      context: details.context,
      error: { code, message },
    })

    this.emit('delegation:denied', {
      tokenId: details.tokenId,
      reason: message,
      targetDoId: details.targetDoId,
    })

    return {
      granted: false,
      error: { code, message },
      auditId,
    }
  }

  // ===========================================================================
  // Revocation
  // ===========================================================================

  /**
   * Revoke a delegation token
   */
  async revokeDelegationToken(tokenId: string, reason?: string): Promise<void> {
    // Find and revoke by ID
    for (const [hash, token] of this.delegationTokens.entries()) {
      if (token.id === tokenId) {
        token.revokedAt = new Date()
        this.revokedTokenHashes.add(hash)

        this.logAudit({
          type: 'revoked',
          delegationTokenId: tokenId,
          sourceDoId: this.sourceDoId,
          targetDoId: token.targetDoId,
        })

        this.emit('delegation:revoked', { tokenId, reason: reason ?? 'Manual revocation' })

        // Broadcast revocation if enabled
        if (this.enableRevocationBroadcast) {
          this.emit('revocation:broadcast', {
            type: 'token',
            targetId: tokenId,
            tenantId: this.tenantId,
            revokedAt: new Date(),
            reason,
            affectedDos: [token.targetDoId],
          } as RevocationBroadcast)
        }

        return
      }
    }

    throw new Error(`Delegation token '${tokenId}' not found`)
  }

  /**
   * Revoke all tokens for a specific target DO
   */
  async revokeAllForTarget(targetDoId: string, reason?: string): Promise<number> {
    let revokedCount = 0

    for (const [hash, token] of this.delegationTokens.entries()) {
      if (token.targetDoId === targetDoId && !token.revokedAt) {
        token.revokedAt = new Date()
        this.revokedTokenHashes.add(hash)
        revokedCount++

        this.logAudit({
          type: 'revoked',
          delegationTokenId: token.id,
          sourceDoId: this.sourceDoId,
          targetDoId,
        })
      }
    }

    if (revokedCount > 0 && this.enableRevocationBroadcast) {
      this.emit('revocation:broadcast', {
        type: 'credential',
        targetId: targetDoId,
        tenantId: this.tenantId,
        revokedAt: new Date(),
        reason,
        affectedDos: [targetDoId],
      } as RevocationBroadcast)
    }

    return revokedCount
  }

  /**
   * Revoke all tokens for a specific credential
   */
  async revokeAllForCredential(credentialName: string, reason?: string): Promise<number> {
    let revokedCount = 0
    const affectedDos: string[] = []

    for (const [hash, token] of this.delegationTokens.entries()) {
      if (token.credentials.includes(credentialName) && !token.revokedAt) {
        token.revokedAt = new Date()
        this.revokedTokenHashes.add(hash)
        revokedCount++
        affectedDos.push(token.targetDoId)

        this.logAudit({
          type: 'revoked',
          delegationTokenId: token.id,
          sourceDoId: this.sourceDoId,
          targetDoId: token.targetDoId,
          credentialName,
        })
      }
    }

    if (revokedCount > 0 && this.enableRevocationBroadcast) {
      this.emit('revocation:broadcast', {
        type: 'credential',
        targetId: credentialName,
        tenantId: this.tenantId,
        revokedAt: new Date(),
        reason,
        affectedDos: [...new Set(affectedDos)],
      } as RevocationBroadcast)
    }

    return revokedCount
  }

  /**
   * Handle incoming revocation broadcast
   */
  handleRevocationBroadcast(broadcast: RevocationBroadcast): void {
    // Verify tenant
    if (broadcast.tenantId !== this.tenantId) {
      return
    }

    // Check if this DO is affected
    if (broadcast.affectedDos && !broadcast.affectedDos.includes(this.sourceDoId)) {
      return
    }

    this.emit('revocation:received', broadcast)

    // Invalidate cached tokens based on broadcast type
    switch (broadcast.type) {
      case 'token':
        // Find and mark token as revoked
        for (const token of this.delegationTokens.values()) {
          if (token.id === broadcast.targetId) {
            token.revokedAt = broadcast.revokedAt
          }
        }
        break

      case 'credential':
        // Revoke all tokens for this credential
        for (const token of this.delegationTokens.values()) {
          if (token.credentials.includes(broadcast.targetId)) {
            token.revokedAt = broadcast.revokedAt
          }
        }
        break

      case 'tenant':
        // Revoke all tokens for this tenant
        for (const token of this.delegationTokens.values()) {
          token.revokedAt = broadcast.revokedAt
        }
        break
    }
  }

  // ===========================================================================
  // Credential Scope Registration
  // ===========================================================================

  /**
   * Register credential scopes for scope-based access control
   */
  registerCredentialScope(credentialName: string, scope: string): void {
    this.credentialScopes.set(credentialName, scope)
  }

  /**
   * Register multiple credential scopes
   */
  registerCredentialScopes(scopes: Record<string, string>): void {
    for (const [name, scope] of Object.entries(scopes)) {
      this.credentialScopes.set(name, scope)
    }
  }

  // ===========================================================================
  // Audit and Monitoring
  // ===========================================================================

  /**
   * Log audit entry
   */
  private logAudit(entry: Omit<DelegationAuditEntry, 'id' | 'timestamp'>): void {
    this.auditLog.push({
      ...entry,
      id: generateId(),
      timestamp: new Date(),
    })
  }

  /**
   * Get audit log entries
   */
  getAuditLog(options?: {
    type?: DelegationAuditEntry['type']
    targetDoId?: string
    credentialName?: string
    since?: Date
    limit?: number
  }): DelegationAuditEntry[] {
    let entries = [...this.auditLog]

    if (options?.type) {
      entries = entries.filter((e) => e.type === options.type)
    }
    if (options?.targetDoId) {
      entries = entries.filter((e) => e.targetDoId === options.targetDoId)
    }
    if (options?.credentialName) {
      entries = entries.filter((e) => e.credentialName === options.credentialName)
    }
    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!)
    }

    // Sort by timestamp descending
    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    if (options?.limit) {
      entries = entries.slice(0, options.limit)
    }

    return entries
  }

  /**
   * Get active delegation tokens (without raw token values)
   */
  getActiveDelegations(): Array<Omit<DelegationToken, 'token'>> {
    const now = Date.now()
    return Array.from(this.delegationTokens.values())
      .filter((t) => !t.revokedAt && t.expiresAt.getTime() > now)
      .map(({ token: _token, ...rest }) => rest)
  }

  /**
   * Get delegation statistics
   */
  getStats(): {
    totalCreated: number
    active: number
    revoked: number
    expired: number
    used: number
  } {
    const now = Date.now()
    const tokens = Array.from(this.delegationTokens.values())

    return {
      totalCreated: tokens.length,
      active: tokens.filter((t) => !t.revokedAt && t.expiresAt.getTime() > now).length,
      revoked: tokens.filter((t) => t.revokedAt).length,
      expired: tokens.filter((t) => !t.revokedAt && t.expiresAt.getTime() <= now).length,
      used: tokens.filter((t) => t.used).length,
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clean up expired tokens
   */
  cleanupExpiredTokens(): number {
    const now = Date.now()
    let cleanedCount = 0

    for (const [hash, token] of this.delegationTokens.entries()) {
      // Remove if expired for more than 24 hours
      if (token.expiresAt.getTime() < now - 24 * 60 * 60 * 1000) {
        this.delegationTokens.delete(hash)
        cleanedCount++
      }
    }

    return cleanedCount
  }
}

// =============================================================================
// Cross-DO RPC Handler
// =============================================================================

/**
 * RPC handler for credential vault cross-DO communication
 */
export interface CredentialVaultRPC {
  /**
   * Request credential access with delegation token
   */
  requestCredential(request: CredentialAccessRequest): Promise<CredentialAccessResult>

  /**
   * Create delegation token for another DO
   */
  createDelegation(options: DelegationTokenOptions): Promise<DelegationToken>

  /**
   * Revoke a delegation token
   */
  revokeDelegation(tokenId: string, reason?: string): Promise<void>

  /**
   * Check if delegation is valid (without accessing credential)
   */
  validateDelegation(token: string, credentialName: string, requestingDoId: string): Promise<{ valid: boolean; error?: string }>

  /**
   * Handle revocation broadcast
   */
  handleRevocation(broadcast: RevocationBroadcast): Promise<void>
}

/**
 * Create RPC handler for Cap'n Web integration
 */
export function createCredentialVaultRPC(manager: CredentialSharingManager): CredentialVaultRPC {
  return {
    async requestCredential(request: CredentialAccessRequest): Promise<CredentialAccessResult> {
      return manager.validateDelegation(request.delegationToken, request.credentialName, request.requestingDoId, request.context)
    },

    async createDelegation(options: DelegationTokenOptions): Promise<DelegationToken> {
      return manager.createDelegationToken(options)
    },

    async revokeDelegation(tokenId: string, reason?: string): Promise<void> {
      return manager.revokeDelegationToken(tokenId, reason)
    },

    async validateDelegation(
      token: string,
      credentialName: string,
      requestingDoId: string
    ): Promise<{ valid: boolean; error?: string }> {
      const result = await manager.validateDelegation(token, credentialName, requestingDoId)
      return {
        valid: result.granted,
        error: result.error?.message,
      }
    },

    async handleRevocation(broadcast: RevocationBroadcast): Promise<void> {
      manager.handleRevocationBroadcast(broadcast)
    },
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a CredentialSharingManager instance
 */
export function createCredentialSharingManager(config: CredentialSharingConfig): CredentialSharingManager {
  return new CredentialSharingManager(config)
}
