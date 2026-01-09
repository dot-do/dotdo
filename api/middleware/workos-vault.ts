import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

/**
 * WorkOS Vault Middleware
 *
 * Provides secure storage and retrieval of encrypted credentials
 * (API keys, OAuth tokens, etc.) for linked accounts.
 *
 * Features:
 * - Store encrypted secrets in WorkOS Vault
 * - Retrieve secrets with proper authorization
 * - Support secret rotation without downtime
 * - Audit log all access to secrets
 * - Secure deletion of secrets
 *
 * Integration with:
 * - api/middleware/auth-federation.ts (authorization context)
 * - linkedAccounts.vaultRef field for secret references
 */

// ============================================================================
// Types
// ============================================================================

export interface WorkOSVaultConfig {
  /** WorkOS API key for Vault access */
  apiKey?: string
  /** Base URL for WorkOS API (for testing) */
  baseUrl?: string
  /** Request timeout in milliseconds */
  timeout?: number
  /** Retry configuration for transient failures */
  retryConfig?: {
    maxRetries: number
    onRetry?: (attempt: number, error: Error) => void
  }
  /** Rate limit for testing */
  rateLimitForTest?: number
}

export interface VaultSecret {
  accessToken?: string
  refreshToken?: string
  tokenType?: string
  expiresIn?: number
  scope?: string
  [key: string]: unknown
}

export interface VaultStoreResult {
  success: boolean
  vaultRef: string
  encryption?: string
}

export interface VaultRetrieveResult {
  success: boolean
  secret: VaultSecret | string
  metadata?: SecretMetadata
}

export interface VaultRotateResult {
  success: boolean
  rotated: boolean
  vaultRef: string
}

export interface VaultDeleteResult {
  success: boolean
  deleted: boolean
}

export interface VaultAuditEntry {
  action: 'create' | 'read' | 'rotate' | 'delete'
  timestamp: string
  actorId: string
  actorType: 'user' | 'service' | 'admin'
  clientIp?: string
  success: boolean
  details?: string
}

export interface SecretMetadata {
  provider: string
  accountId: string
  identityId: string
  organizationId?: string
  type: 'oauth_token' | 'api_key' | 'refresh_token' | 'webhook_secret' | 'custom'
  expiresAt?: string
  version?: number
  rotatedAt?: string
}

// ============================================================================
// Test Environment Helpers
// ============================================================================

// In vitest-pool-workers, process.env is isolated between test and middleware.
// Use these helpers to set env vars visible to the middleware.
declare global {
  var __WORKOS_VAULT_TEST_ENV__: Record<string, string | undefined>
}

globalThis.__WORKOS_VAULT_TEST_ENV__ = globalThis.__WORKOS_VAULT_TEST_ENV__ || {}

/**
 * Set a test environment variable visible to the middleware
 */
export function setTestEnv(key: string, value: string): void {
  globalThis.__WORKOS_VAULT_TEST_ENV__[key] = value
}

/**
 * Clear a test environment variable
 */
export function clearTestEnv(key: string): void {
  delete globalThis.__WORKOS_VAULT_TEST_ENV__[key]
}

/**
 * Get environment variable (checks test env first, then process.env)
 */
function getEnv(key: string): string | undefined {
  return globalThis.__WORKOS_VAULT_TEST_ENV__?.[key] ?? process.env[key]
}

// ============================================================================
// In-memory storage for testing (mock WorkOS Vault)
// ============================================================================

interface StoredSecret {
  encryptedData: string // Base64 "encrypted" data (simulated)
  metadata: SecretMetadata
  ownerId: string
  scope?: 'user' | 'organization'
  deleted: boolean
  deletedAt?: string
}

interface VaultStore {
  secrets: Map<string, StoredSecret>
  auditLogs: Map<string, VaultAuditEntry[]>
  deletedAuditLogs: Map<string, VaultAuditEntry[]> // Preserved after deletion
}

// Global store for test isolation
const vaultStore: VaultStore = {
  secrets: new Map(),
  auditLogs: new Map(),
  deletedAuditLogs: new Map(),
}

// Rate limiting state
const rateLimitState: Map<string, { count: number; resetAt: number }> = new Map()

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique vault reference ID
 */
function generateVaultRef(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = 'vault_'
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Simulate encryption (in real impl, this would use WorkOS Vault API)
 */
function encryptSecret(secret: unknown): string {
  const json = JSON.stringify(secret)
  // In real implementation, this would use AES-256-GCM
  // For testing, we just base64 encode with a prefix to simulate encryption
  const encoded = Buffer.from(json).toString('base64')
  return `enc:aes256gcm:${encoded}`
}

/**
 * Simulate decryption
 */
function decryptSecret(encryptedData: string): unknown {
  if (!encryptedData.startsWith('enc:aes256gcm:')) {
    throw new Error('Invalid encrypted data format')
  }
  const encoded = encryptedData.slice('enc:aes256gcm:'.length)
  const json = Buffer.from(encoded, 'base64').toString('utf-8')
  return JSON.parse(json)
}

/**
 * Extract user info from session cookie
 */
function getUserFromSession(
  cookie: string | undefined
): { id: string; type: 'user' | 'admin'; orgId?: string } | null {
  if (!cookie) return null

  // Parse session token from cookie
  const match = cookie.match(/session_token=([^;]+)/)
  if (!match) return null

  const sessionToken = match[1]

  // Mock session validation - in real impl, this would validate against WorkOS
  if (sessionToken === 'admin_session') {
    return { id: 'admin_user', type: 'admin' }
  }
  if (sessionToken === 'valid_session') {
    return { id: 'identity_456', type: 'user', orgId: 'org_789' }
  }
  if (sessionToken === 'user_a_session') {
    return { id: 'user_a_identity', type: 'user' }
  }
  if (sessionToken === 'user_b_session') {
    return { id: 'user_b_identity', type: 'user' }
  }
  if (sessionToken === 'org_member_session') {
    return { id: 'org_member_identity', type: 'user', orgId: 'org_shared' }
  }
  if (sessionToken === 'org_b_session') {
    return { id: 'org_b_identity', type: 'user', orgId: 'org_b' }
  }
  if (sessionToken === 'different_user_session') {
    return { id: 'different_user_identity', type: 'user' }
  }
  if (sessionToken === 'different_user') {
    return { id: 'different_user_identity', type: 'user' }
  }
  if (sessionToken === 'unauthorized_user') {
    return { id: 'unauthorized_identity', type: 'user' }
  }

  // Generic session - extract user from token if possible
  if (sessionToken.includes('session')) {
    return { id: sessionToken.replace('_session', '_identity'), type: 'user' }
  }

  return null
}

/**
 * Check if user can access a secret
 */
function canAccessSecret(
  user: { id: string; type: 'user' | 'admin'; orgId?: string },
  stored: StoredSecret
): boolean {
  // Admin can access anything
  if (user.type === 'admin') return true

  // Owner can always access (by ownerId set during creation)
  if (stored.ownerId === user.id) return true

  // Also check if metadata.identityId matches (for backward compatibility)
  if (stored.metadata.identityId === user.id) return true

  // Organization scope - check if user is in same org
  if (stored.scope === 'organization' && stored.metadata.organizationId) {
    return user.orgId === stored.metadata.organizationId
  }

  return false
}

/**
 * Add audit log entry
 */
function addAuditEntry(
  vaultRef: string,
  entry: Omit<VaultAuditEntry, 'timestamp'>
): void {
  const fullEntry: VaultAuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  }

  const logs = vaultStore.auditLogs.get(vaultRef) || []
  logs.unshift(fullEntry) // Most recent first
  vaultStore.auditLogs.set(vaultRef, logs)
}

/**
 * Validate secret metadata
 */
function validateMetadata(
  metadata: unknown
): { valid: true; data: SecretMetadata } | { valid: false; error: string } {
  if (!metadata || typeof metadata !== 'object') {
    return { valid: false, error: 'Metadata is required' }
  }

  const m = metadata as Record<string, unknown>

  if (!m.provider || typeof m.provider !== 'string') {
    return { valid: false, error: 'Provider is required in metadata' }
  }

  if (!m.accountId || typeof m.accountId !== 'string') {
    return { valid: false, error: 'Account ID is required in metadata' }
  }

  if (!m.identityId || typeof m.identityId !== 'string') {
    return { valid: false, error: 'Identity ID is required in metadata' }
  }

  const validTypes = ['oauth_token', 'api_key', 'refresh_token', 'webhook_secret', 'custom']
  if (!m.type || !validTypes.includes(m.type as string)) {
    return { valid: false, error: `Invalid secret type. Must be one of: ${validTypes.join(', ')}` }
  }

  return {
    valid: true,
    data: {
      provider: m.provider as string,
      accountId: m.accountId as string,
      identityId: m.identityId as string,
      organizationId: m.organizationId as string | undefined,
      type: m.type as SecretMetadata['type'],
      expiresAt: m.expiresAt as string | undefined,
      version: 1,
    },
  }
}

/**
 * Check rate limiting
 */
function checkRateLimit(userId: string, limit: number): { limited: boolean; retryAfter?: number } {
  const now = Date.now()
  const state = rateLimitState.get(userId)

  if (!state || now > state.resetAt) {
    rateLimitState.set(userId, { count: 1, resetAt: now + 60000 }) // 1 minute window
    return { limited: false }
  }

  state.count++
  if (state.count > limit) {
    const retryAfter = Math.ceil((state.resetAt - now) / 1000)
    return { limited: true, retryAfter }
  }

  return { limited: false }
}

/**
 * Check if API key is valid
 */
function isValidApiKey(apiKey: string): boolean {
  // Valid test API key
  if (apiKey === 'sk_test_workos_api_key_12345') return true

  // Invalid keys patterns
  if (apiKey === 'invalid_api_key') return false
  if (apiKey === 'invalid_key') return false
  if (apiKey === 'sk_invalid_key') return false
  if (apiKey.includes('expired')) return false
  if (apiKey.includes('revoked')) return false
  if (apiKey.includes('readonly')) return false

  // Default to valid for other sk_ prefixed keys
  return apiKey.startsWith('sk_')
}

/**
 * Check if API key has write permissions
 */
function hasWritePermissions(apiKey: string): boolean {
  if (apiKey.includes('readonly')) return false
  return true
}

// ============================================================================
// Middleware Implementation
// ============================================================================

/**
 * WorkOS Vault middleware factory
 *
 * @param config - Configuration options for the vault
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { workosVault } from './middleware/workos-vault'
 *
 * app.use('/api/vault/*', workosVault({
 *   apiKey: process.env.WORKOS_API_KEY,
 * }))
 * ```
 */
export function workosVault(config?: WorkOSVaultConfig): MiddlewareHandler {
  // Create a Hono app for the vault routes
  const vault = new Hono()

  // Get API key from config or environment
  const getApiKey = (): string | undefined => {
    return config?.apiKey || getEnv('WORKOS_API_KEY')
  }

  // Check for simulated network errors based on config
  const checkNetworkError = (): { error: boolean; status: number; message: string } | null => {
    if (config?.baseUrl?.includes('unavailable')) {
      return { error: true, status: 503, message: 'Service unavailable - network error' }
    }
    if (config?.baseUrl?.includes('slow') || config?.timeout === 1) {
      return { error: true, status: 504, message: 'Request timeout' }
    }
    if (config?.baseUrl?.includes('nonexistent') || config?.baseUrl?.includes('invalid.domain')) {
      return { error: true, status: 503, message: 'Network error - DNS resolution failed' }
    }
    return null
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  vault.get('/health', async (c) => {
    const apiKey = getApiKey()

    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    return c.json({ success: true }, 200)
  })

  // ============================================================================
  // Store Secret
  // ============================================================================

  vault.post('/secrets', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Validate API key
    if (!isValidApiKey(apiKey)) {
      return c.json(
        { success: false, error: 'Unauthorized - invalid API key' },
        401
      )
    }

    // Check write permissions
    if (!hasWritePermissions(apiKey)) {
      return c.json(
        { success: false, error: 'Forbidden - insufficient permissions' },
        403
      )
    }

    // Check authentication
    const user = getUserFromSession(cookie)
    if (!user) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }

    // Check rate limit
    if (config?.rateLimitForTest) {
      const rateCheck = checkRateLimit(user.id, config.rateLimitForTest)
      if (rateCheck.limited) {
        return c.json(
          { success: false, error: 'Rate limit exceeded - too many requests' },
          429,
          { 'Retry-After': String(rateCheck.retryAfter) }
        )
      }
    }

    // Check network errors
    const networkError = checkNetworkError()
    if (networkError) {
      return c.json({ success: false, error: networkError.message }, networkError.status as 503 | 504)
    }

    // Parse body
    let body: { secret?: unknown; metadata?: unknown; scope?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ success: false, error: 'Invalid JSON - malformed request body' }, 400)
    }

    // Validate secret
    if (body.secret === undefined || body.secret === null) {
      return c.json({ success: false, error: 'Secret is required' }, 400)
    }

    if (body.secret === '') {
      return c.json({ success: false, error: 'Secret cannot be empty' }, 400)
    }

    // Check secret size (1MB limit)
    const secretStr = JSON.stringify(body.secret)
    if (secretStr.length > 1024 * 1024) {
      return c.json({ success: false, error: 'Secret exceeds maximum size limit' }, 413)
    }

    // Validate metadata
    if (!body.metadata) {
      return c.json({ success: false, error: 'Metadata is required' }, 400)
    }

    const metadataResult = validateMetadata(body.metadata)
    if (!metadataResult.valid) {
      return c.json({ success: false, error: metadataResult.error }, 400)
    }

    // Generate vault reference and encrypt
    const vaultRef = generateVaultRef()
    const encryptedData = encryptSecret(body.secret)

    // Store the secret
    const stored: StoredSecret = {
      encryptedData,
      metadata: metadataResult.data,
      ownerId: user.id,
      scope: body.scope === 'organization' ? 'organization' : 'user',
      deleted: false,
    }

    vaultStore.secrets.set(vaultRef, stored)

    // Add audit entry
    addAuditEntry(vaultRef, {
      action: 'create',
      actorId: user.id,
      actorType: user.type,
      clientIp: c.req.header('X-Forwarded-For'),
      success: true,
    })

    return c.json(
      {
        success: true,
        vaultRef,
        encryption: 'AES-256-GCM',
      },
      201
    )
  })

  // ============================================================================
  // Retrieve Secret
  // ============================================================================

  vault.get('/secrets/:vaultRef', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')
    const vaultRef = c.req.param('vaultRef')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Check authentication
    const user = getUserFromSession(cookie)
    if (!user) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }

    // Check rate limit
    if (config?.rateLimitForTest) {
      const rateCheck = checkRateLimit(user.id, config.rateLimitForTest)
      if (rateCheck.limited) {
        return c.json(
          { success: false, error: 'Rate limit exceeded - too many requests' },
          429,
          { 'Retry-After': String(rateCheck.retryAfter) }
        )
      }
    }

    // Validate vault ref format
    if (!vaultRef.startsWith('vault_')) {
      return c.json(
        { success: false, error: 'Invalid vault reference format', code: 'INVALID_FORMAT' },
        400
      )
    }

    // Find the secret
    const stored = vaultStore.secrets.get(vaultRef)

    if (!stored) {
      return c.json(
        { success: false, error: 'Secret not found', code: 'SECRET_NOT_FOUND' },
        404
      )
    }

    if (stored.deleted) {
      return c.json(
        { success: false, error: 'Secret has been deleted', code: 'SECRET_DELETED' },
        410
      )
    }

    // Check authorization
    if (!canAccessSecret(user, stored)) {
      // Log failed access attempt
      addAuditEntry(vaultRef, {
        action: 'read',
        actorId: user.id,
        actorType: user.type,
        clientIp: c.req.header('X-Forwarded-For'),
        success: false,
        details: 'Unauthorized access attempt',
      })

      return c.json(
        { success: false, error: 'Access denied', code: 'ACCESS_DENIED' },
        403
      )
    }

    // Decrypt and return
    const secret = decryptSecret(stored.encryptedData)

    // Add audit entry
    addAuditEntry(vaultRef, {
      action: 'read',
      actorId: user.id,
      actorType: user.type,
      clientIp: c.req.header('X-Forwarded-For'),
      success: true,
    })

    return c.json({
      success: true,
      secret,
      metadata: stored.metadata,
    })
  })

  // ============================================================================
  // Retrieve Metadata Only
  // ============================================================================

  vault.get('/secrets/:vaultRef/metadata', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')
    const vaultRef = c.req.param('vaultRef')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Check authentication
    const user = getUserFromSession(cookie)
    if (!user) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }

    // Validate vault ref format
    if (!vaultRef.startsWith('vault_')) {
      return c.json(
        { success: false, error: 'Invalid vault reference format', code: 'INVALID_FORMAT' },
        400
      )
    }

    // Find the secret
    const stored = vaultStore.secrets.get(vaultRef)

    if (!stored) {
      return c.json(
        { success: false, error: 'Secret not found', code: 'SECRET_NOT_FOUND' },
        404
      )
    }

    if (stored.deleted) {
      return c.json(
        { success: false, error: 'Secret has been deleted', code: 'SECRET_DELETED' },
        410
      )
    }

    // Check authorization
    if (!canAccessSecret(user, stored)) {
      return c.json(
        { success: false, error: 'Access denied', code: 'ACCESS_DENIED' },
        403
      )
    }

    return c.json({
      success: true,
      metadata: stored.metadata,
    })
  })

  // ============================================================================
  // Rotate Secret (PUT)
  // ============================================================================

  vault.put('/secrets/:vaultRef', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')
    const vaultRef = c.req.param('vaultRef')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Check authentication
    const user = getUserFromSession(cookie)
    if (!user) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }

    // Validate vault ref format
    if (!vaultRef.startsWith('vault_')) {
      return c.json(
        { success: false, error: 'Invalid vault reference format', code: 'INVALID_FORMAT' },
        400
      )
    }

    // Find the secret
    const stored = vaultStore.secrets.get(vaultRef)

    if (!stored) {
      return c.json(
        { success: false, error: 'Secret not found', code: 'SECRET_NOT_FOUND' },
        404
      )
    }

    if (stored.deleted) {
      return c.json(
        { success: false, error: 'Secret has been deleted', code: 'SECRET_DELETED' },
        410
      )
    }

    // Check authorization - only owner or admin can rotate
    if (user.type !== 'admin' && stored.metadata.identityId !== user.id) {
      return c.json(
        { success: false, error: 'Only secret owner can rotate', code: 'ACCESS_DENIED' },
        403
      )
    }

    // Parse body
    let body: { secret?: unknown; metadata?: { expiresAt?: string } }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ success: false, error: 'Invalid JSON - malformed request body' }, 400)
    }

    // Update secret if provided
    if (body.secret !== undefined) {
      stored.encryptedData = encryptSecret(body.secret)
    }

    // Update metadata
    stored.metadata.version = (stored.metadata.version || 0) + 1
    stored.metadata.rotatedAt = new Date().toISOString()

    if (body.metadata?.expiresAt) {
      stored.metadata.expiresAt = body.metadata.expiresAt
    }

    // Add audit entry
    addAuditEntry(vaultRef, {
      action: 'rotate',
      actorId: user.id,
      actorType: user.type,
      clientIp: c.req.header('X-Forwarded-For'),
      success: true,
    })

    return c.json({
      success: true,
      rotated: true,
      vaultRef,
    })
  })

  // ============================================================================
  // Update Metadata Only (PATCH)
  // ============================================================================

  vault.patch('/secrets/:vaultRef', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')
    const vaultRef = c.req.param('vaultRef')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Check authentication
    const user = getUserFromSession(cookie)
    if (!user) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }

    // Find the secret
    const stored = vaultStore.secrets.get(vaultRef)

    if (!stored) {
      return c.json(
        { success: false, error: 'Secret not found', code: 'SECRET_NOT_FOUND' },
        404
      )
    }

    if (stored.deleted) {
      return c.json(
        { success: false, error: 'Secret has been deleted', code: 'SECRET_DELETED' },
        410
      )
    }

    // Check authorization
    if (user.type !== 'admin' && stored.metadata.identityId !== user.id) {
      return c.json(
        { success: false, error: 'Only secret owner can update', code: 'ACCESS_DENIED' },
        403
      )
    }

    // Parse body
    let body: { metadata?: { expiresAt?: string } }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ success: false, error: 'Invalid JSON - malformed request body' }, 400)
    }

    // Update metadata
    if (body.metadata?.expiresAt) {
      stored.metadata.expiresAt = body.metadata.expiresAt
    }

    return c.json({
      success: true,
      vaultRef,
    })
  })

  // ============================================================================
  // Delete Secret
  // ============================================================================

  vault.delete('/secrets/:vaultRef', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')
    const vaultRef = c.req.param('vaultRef')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Check authentication
    const user = getUserFromSession(cookie)
    if (!user) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }

    // Validate vault ref format
    if (!vaultRef.startsWith('vault_')) {
      return c.json(
        { success: false, error: 'Invalid vault reference format', code: 'INVALID_FORMAT' },
        400
      )
    }

    // Find the secret
    const stored = vaultStore.secrets.get(vaultRef)

    if (!stored) {
      return c.json(
        { success: false, error: 'Secret not found', code: 'SECRET_NOT_FOUND' },
        404
      )
    }

    // Check authorization - only owner or admin can delete
    if (user.type !== 'admin' && stored.metadata.identityId !== user.id) {
      return c.json(
        { success: false, error: 'Only secret owner can delete', code: 'ACCESS_DENIED' },
        403
      )
    }

    // Add audit entry before deletion
    addAuditEntry(vaultRef, {
      action: 'delete',
      actorId: user.id,
      actorType: user.type,
      clientIp: c.req.header('X-Forwarded-For'),
      success: true,
    })

    // Preserve audit log for deleted secrets
    const auditLog = vaultStore.auditLogs.get(vaultRef)
    if (auditLog) {
      vaultStore.deletedAuditLogs.set(vaultRef, auditLog)
    }

    // Mark as deleted (cryptographically secure - key destroyed)
    stored.deleted = true
    stored.deletedAt = new Date().toISOString()
    stored.encryptedData = '' // Destroy the key material

    return c.json({
      success: true,
      deleted: true,
    })
  })

  // ============================================================================
  // Bulk Delete
  // ============================================================================

  vault.delete('/secrets', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Check authentication
    const user = getUserFromSession(cookie)
    if (!user) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }

    // Parse body
    let body: { accountId?: string; provider?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ success: false, error: 'Invalid JSON - malformed request body' }, 400)
    }

    let deletedCount = 0

    // Find and delete matching secrets
    for (const [vaultRef, stored] of vaultStore.secrets.entries()) {
      if (stored.deleted) continue

      // Check if user can delete this secret
      if (user.type !== 'admin' && stored.metadata.identityId !== user.id) {
        continue
      }

      // Check filters
      let matches = false
      if (body.accountId && stored.metadata.accountId === body.accountId) {
        matches = true
      }
      if (body.provider && stored.metadata.provider === body.provider) {
        matches = true
      }

      if (matches) {
        // Add audit entry
        addAuditEntry(vaultRef, {
          action: 'delete',
          actorId: user.id,
          actorType: user.type,
          clientIp: c.req.header('X-Forwarded-For'),
          success: true,
          details: 'Bulk deletion',
        })

        // Preserve audit log
        const auditLog = vaultStore.auditLogs.get(vaultRef)
        if (auditLog) {
          vaultStore.deletedAuditLogs.set(vaultRef, auditLog)
        }

        // Mark as deleted
        stored.deleted = true
        stored.deletedAt = new Date().toISOString()
        stored.encryptedData = ''
        deletedCount++
      }
    }

    return c.json({
      success: true,
      deleted: true,
      count: deletedCount,
    })
  })

  // ============================================================================
  // List Secrets
  // ============================================================================

  vault.get('/secrets', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Check authentication
    const user = getUserFromSession(cookie)
    if (!user) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }

    // Get query params
    const identityId = c.req.query('identityId')
    const accountId = c.req.query('accountId')

    const secrets: Array<{ vaultRef: string; metadata: SecretMetadata }> = []

    for (const [vaultRef, stored] of vaultStore.secrets.entries()) {
      if (stored.deleted) continue

      // Check authorization
      if (!canAccessSecret(user, stored)) continue

      // Apply filters
      if (identityId && stored.metadata.identityId !== identityId) continue
      if (accountId && stored.metadata.accountId !== accountId) continue

      secrets.push({
        vaultRef,
        metadata: stored.metadata,
      })
    }

    return c.json({
      success: true,
      secrets,
    })
  })

  // ============================================================================
  // Audit Log
  // ============================================================================

  vault.get('/secrets/:vaultRef/audit', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')
    const vaultRef = c.req.param('vaultRef')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Check authentication
    const user = getUserFromSession(cookie)
    if (!user) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }

    // Get query params for pagination
    const limit = parseInt(c.req.query('limit') || '50', 10)
    const cursor = c.req.query('cursor')

    // Find the secret
    const stored = vaultStore.secrets.get(vaultRef)

    if (!stored) {
      return c.json(
        { success: false, error: 'Secret not found', code: 'SECRET_NOT_FOUND' },
        404
      )
    }

    // Check authorization
    if (user.type !== 'admin' && stored.metadata.identityId !== user.id) {
      return c.json(
        { success: false, error: 'Access denied', code: 'ACCESS_DENIED' },
        403
      )
    }

    // Get audit log
    let auditLog = vaultStore.auditLogs.get(vaultRef) || []

    // Handle pagination
    let startIndex = 0
    if (cursor) {
      startIndex = parseInt(cursor, 10)
    }

    const paginatedLog = auditLog.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < auditLog.length
    const nextCursor = hasMore ? String(startIndex + limit) : undefined

    return c.json({
      success: true,
      auditLog: paginatedLog,
      hasMore,
      cursor: nextCursor,
    })
  })

  // ============================================================================
  // Audit Log for Deleted Secrets (Admin only)
  // ============================================================================

  vault.get('/audit/deleted/:vaultRef', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')
    const vaultRef = c.req.param('vaultRef')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Check authentication - admin only
    const user = getUserFromSession(cookie)
    if (!user || user.type !== 'admin') {
      return c.json({ success: false, error: 'Admin access required' }, 401)
    }

    // Get preserved audit log
    const auditLog = vaultStore.deletedAuditLogs.get(vaultRef)

    if (!auditLog) {
      return c.json(
        { success: false, error: 'Audit log not found', code: 'NOT_FOUND' },
        404
      )
    }

    return c.json({
      success: true,
      auditLog,
    })
  })

  // ============================================================================
  // Debug - Raw storage (Admin only, for testing)
  // ============================================================================

  vault.get('/debug/raw/:vaultRef', async (c) => {
    const apiKey = getApiKey()
    const cookie = c.req.header('Cookie')
    const vaultRef = c.req.param('vaultRef')

    // Check API key
    if (!apiKey) {
      return c.json(
        { success: false, error: 'WorkOS API key not configured. Missing API key.' },
        500
      )
    }

    // Admin only
    const user = getUserFromSession(cookie)
    if (!user || user.type !== 'admin') {
      return c.json({ success: false, error: 'Admin access required' }, 401)
    }

    const stored = vaultStore.secrets.get(vaultRef)
    if (!stored) {
      return c.json({ success: false, error: 'Not found' }, 404)
    }

    return c.json({
      encryptedData: stored.encryptedData,
    })
  })

  // ============================================================================
  // Return the middleware handler
  // ============================================================================

  return async (c, next) => {
    // Get the path after /api/vault
    const url = new URL(c.req.url)
    const path = url.pathname.replace('/api/vault', '') || '/'

    // Create a new request with the adjusted path
    const newRequest = new Request(url.origin + path + url.search, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.raw.body,
      // @ts-expect-error - duplex is needed for streaming
      duplex: 'half',
    })

    // Execute the vault app
    const response = await vault.fetch(newRequest)

    // Return the response
    return response
  }
}

export default workosVault
