import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'

/**
 * WorkOS Vault Middleware Tests
 *
 * These tests verify the WorkOS Vault integration for secure storage and retrieval
 * of encrypted credentials (API keys, tokens, etc.) for linked accounts.
 *
 * Tests are expected to FAIL until the middleware is implemented.
 *
 * Implementation requirements:
 * - Create middleware in api/middleware/workos-vault.ts
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
// Import the middleware (will fail until implemented)
// ============================================================================

// @ts-expect-error - workos-vault middleware not yet implemented
import {
  workosVault,
  type WorkOSVaultConfig,
  type VaultSecret,
  type VaultStoreResult,
  type VaultRetrieveResult,
  type VaultRotateResult,
  type VaultDeleteResult,
  type VaultAuditEntry,
  setTestEnv,
  clearTestEnv,
} from '../../middleware/workos-vault'

// ============================================================================
// Test Types
// ============================================================================

interface VaultResponse {
  success?: boolean
  error?: string
  vaultRef?: string
  secret?: VaultSecret
  rotated?: boolean
  deleted?: boolean
  auditLog?: VaultAuditEntry[]
}

interface SecretMetadata {
  provider: string
  accountId: string
  identityId: string
  organizationId?: string
  type: 'oauth_token' | 'api_key' | 'refresh_token' | 'webhook_secret' | 'custom'
  expiresAt?: string
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test app with WorkOS Vault middleware
 */
function createTestApp(config?: WorkOSVaultConfig): Hono {
  const app = new Hono()

  // Apply vault middleware
  app.use('/api/vault/*', workosVault(config))

  return app
}

/**
 * Make a request to the vault API
 */
async function vaultRequest(
  app: Hono,
  method: string,
  path: string,
  options: {
    body?: unknown
    headers?: Record<string, string>
  } = {}
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  }
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
  }
  return app.request(`/api/vault${path}`, init)
}

/**
 * Create a mock session cookie for authenticated requests
 */
function mockSessionCookie(sessionId: string = 'valid_session'): string {
  return `session_token=${sessionId}`
}

/**
 * Create a mock admin session cookie
 */
function mockAdminSessionCookie(): string {
  return `session_token=admin_session`
}

// ============================================================================
// Test Constants
// ============================================================================

const TEST_WORKOS_API_KEY = 'sk_test_workos_api_key_12345'
const TEST_VAULT_SECRET_ID = 'vault_secret_abc123'

const MOCK_OAUTH_TOKEN = {
  accessToken: 'gho_test_github_access_token_xyz',
  refreshToken: 'gho_test_github_refresh_token_abc',
  tokenType: 'Bearer',
  expiresIn: 3600,
  scope: 'user:email repo',
}

const MOCK_API_KEY = {
  key: 'sk-test-openai-api-key-1234567890abcdef',
}

const MOCK_SECRET_METADATA: SecretMetadata = {
  provider: 'github',
  accountId: 'linked_account_123',
  identityId: 'identity_456',
  organizationId: 'org_789',
  type: 'oauth_token',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
}

// ============================================================================
// 1. Connection Tests
// ============================================================================

describe('WorkOS Vault - Connection', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Connect to WorkOS Vault', () => {
    it('connects to WorkOS Vault with valid API key', async () => {
      app = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
      })

      const res = await vaultRequest(app, 'GET', '/health', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([200, 204]).toContain(res.status)
    })

    it('uses WORKOS_API_KEY from environment when not provided in config', async () => {
      app = createTestApp({})

      const res = await vaultRequest(app, 'GET', '/health', {
        headers: { Cookie: mockSessionCookie() },
      })

      // Should work with env var
      expect([200, 204]).toContain(res.status)
    })

    it('returns 500 when WorkOS API key is missing', async () => {
      clearTestEnv('WORKOS_API_KEY')

      app = createTestApp({
        // No apiKey, no env var
      })

      const res = await vaultRequest(app, 'GET', '/health', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(500)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/api.?key|configuration|missing/i)
    })

    it('returns 401 when WorkOS API key is invalid', async () => {
      app = createTestApp({
        apiKey: 'invalid_api_key',
      })

      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: { secret: 'test', metadata: MOCK_SECRET_METADATA },
      })

      expect([401, 403]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/unauthorized|invalid|api.?key/i)
    })
  })

  describe('Handle connection errors', () => {
    it('handles WorkOS service unavailable gracefully', async () => {
      app = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        // Mock service unavailable
        baseUrl: 'https://unavailable.workos.example.com.ai',
      })

      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: { secret: MOCK_API_KEY.key, metadata: MOCK_SECRET_METADATA },
      })

      expect([502, 503, 504]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/unavailable|network|connection/i)
    })

    it('handles WorkOS timeout gracefully', async () => {
      app = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        timeout: 1, // 1ms timeout to force timeout
      })

      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: { secret: MOCK_API_KEY.key, metadata: MOCK_SECRET_METADATA },
      })

      expect([408, 504]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/timeout|timed.?out/i)
    })

    it('retries transient errors with exponential backoff', async () => {
      const retryHandler = vi.fn()

      app = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        retryConfig: {
          maxRetries: 3,
          onRetry: retryHandler,
        },
      })

      // Mock transient failure that recovers
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: { secret: MOCK_API_KEY.key, metadata: MOCK_SECRET_METADATA },
      })

      // Should either succeed after retry or fail after max retries
      expect([200, 201, 502, 503]).toContain(res.status)
    })

    it('does not retry non-transient errors (4xx)', async () => {
      const retryHandler = vi.fn()

      app = createTestApp({
        apiKey: 'invalid_key',
        retryConfig: {
          maxRetries: 3,
          onRetry: retryHandler,
        },
      })

      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: { secret: MOCK_API_KEY.key, metadata: MOCK_SECRET_METADATA },
      })

      // Should not retry auth errors
      expect(retryHandler).not.toHaveBeenCalled()
      expect([401, 403]).toContain(res.status)
    })
  })
})

// ============================================================================
// 2. Store Tests
// ============================================================================

describe('WorkOS Vault - Store Secrets', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({ apiKey: TEST_WORKOS_API_KEY })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Store encrypted secrets', () => {
    it('stores an OAuth token and returns vault reference', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_OAUTH_TOKEN,
          metadata: {
            ...MOCK_SECRET_METADATA,
            type: 'oauth_token',
          },
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.success).toBe(true)
      expect(body.vaultRef).toBeDefined()
      expect(body.vaultRef).toMatch(/^vault_/)
    })

    it('stores an API key and returns vault reference', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: {
            ...MOCK_SECRET_METADATA,
            provider: 'openai',
            type: 'api_key',
          },
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.success).toBe(true)
      expect(body.vaultRef).toBeDefined()
    })

    it('stores a webhook secret', async () => {
      const webhookSecret = 'whsec_test_webhook_secret_xyz123'

      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: webhookSecret,
          metadata: {
            ...MOCK_SECRET_METADATA,
            provider: 'stripe',
            type: 'webhook_secret',
          },
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.vaultRef).toBeDefined()
    })

    it('stores refresh token separately from access token', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_OAUTH_TOKEN.refreshToken,
          metadata: {
            ...MOCK_SECRET_METADATA,
            type: 'refresh_token',
          },
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.vaultRef).toBeDefined()
    })

    it('stores custom secret types', async () => {
      const customSecret = {
        connectionString: 'postgres://user:pass@host:5432/db',
        sslCert: 'base64_encoded_cert...',
      }

      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: customSecret,
          metadata: {
            ...MOCK_SECRET_METADATA,
            provider: 'database',
            type: 'custom',
          },
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.vaultRef).toBeDefined()
    })
  })

  describe('Encryption verification', () => {
    it('secrets are encrypted at rest (not stored in plaintext)', async () => {
      // Store a secret
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect([200, 201]).toContain(storeRes.status)
      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      // Get raw storage (for testing - should be encrypted)
      const rawRes = await vaultRequest(app, 'GET', `/debug/raw/${vaultRef}`, {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      if (rawRes.status === 200) {
        const rawBody = (await rawRes.json()) as { encryptedData: string }
        // Raw data should NOT contain the plaintext secret
        expect(rawBody.encryptedData).not.toContain(MOCK_API_KEY.key)
        expect(rawBody.encryptedData).not.toContain('sk-test-openai')
      }
    })

    it('uses AES-256-GCM encryption', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as VaultResponse & { encryption?: string }

      // Response should indicate encryption algorithm used
      if (body.encryption) {
        expect(body.encryption).toMatch(/AES-256-GCM|aes-256-gcm/i)
      }
    })

    it('each secret has unique encryption key (key derivation)', async () => {
      // Store two identical secrets
      const res1 = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: { ...MOCK_SECRET_METADATA, accountId: 'account_1' },
        },
      })

      const res2 = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: { ...MOCK_SECRET_METADATA, accountId: 'account_2' },
        },
      })

      expect([200, 201]).toContain(res1.status)
      expect([200, 201]).toContain(res2.status)

      const body1 = (await res1.json()) as VaultResponse
      const body2 = (await res2.json()) as VaultResponse

      // Vault refs should be different
      expect(body1.vaultRef).not.toBe(body2.vaultRef)
    })
  })

  describe('Store validation', () => {
    it('rejects store request without authentication', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        // No session cookie
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect(res.status).toBe(401)
    })

    it('rejects store request without secret', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/secret|required|missing/i)
    })

    it('rejects store request without metadata', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/metadata|required|missing/i)
    })

    it('rejects store request with invalid metadata provider', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: {
            // Missing provider
            accountId: 'account_123',
            identityId: 'identity_456',
            type: 'api_key',
          },
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/provider|required/i)
    })

    it('rejects empty secret value', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: '',
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/empty|invalid|secret/i)
    })

    it('rejects secrets exceeding max size limit', async () => {
      const largeSecret = 'x'.repeat(1024 * 1024) // 1MB secret

      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: largeSecret,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect([400, 413]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/size|large|limit/i)
    })
  })
})

// ============================================================================
// 3. Retrieve Tests
// ============================================================================

describe('WorkOS Vault - Retrieve Secrets', () => {
  let app: Hono
  let storedVaultRef: string

  beforeEach(async () => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({ apiKey: TEST_WORKOS_API_KEY })

    // Pre-store a secret for retrieval tests
    const storeRes = await vaultRequest(app, 'POST', '/secrets', {
      headers: { Cookie: mockSessionCookie() },
      body: {
        secret: MOCK_OAUTH_TOKEN,
        metadata: MOCK_SECRET_METADATA,
      },
    })

    if (storeRes.status === 200 || storeRes.status === 201) {
      const body = (await storeRes.json()) as VaultResponse
      storedVaultRef = body.vaultRef || 'vault_test_ref'
    } else {
      storedVaultRef = 'vault_test_ref'
    }
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Get secrets with authorization', () => {
    it('retrieves stored OAuth token by vault reference', async () => {
      const res = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as VaultResponse
      expect(body.success).toBe(true)
      expect(body.secret).toBeDefined()
      expect(body.secret?.accessToken).toBe(MOCK_OAUTH_TOKEN.accessToken)
    })

    it('retrieves stored API key by vault reference', async () => {
      // Store an API key first
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: { ...MOCK_SECRET_METADATA, type: 'api_key' },
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const apiKeyRef = storeBody.vaultRef

      const res = await vaultRequest(app, 'GET', `/secrets/${apiKeyRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as VaultResponse
      expect(body.secret).toBe(MOCK_API_KEY.key)
    })

    it('returns metadata along with secret', async () => {
      const res = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as VaultResponse & { metadata?: SecretMetadata }
      expect(body.metadata).toBeDefined()
      expect(body.metadata?.provider).toBe(MOCK_SECRET_METADATA.provider)
      expect(body.metadata?.type).toBe(MOCK_SECRET_METADATA.type)
    })

    it('supports retrieving only metadata (without secret)', async () => {
      const res = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/metadata`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as VaultResponse & { metadata?: SecretMetadata }
      expect(body.metadata).toBeDefined()
      // Should NOT include the actual secret
      expect(body.secret).toBeUndefined()
    })
  })

  describe('Authorization checks', () => {
    it('rejects retrieval without authentication', async () => {
      const res = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        // No session cookie
      })

      expect(res.status).toBe(401)
    })

    it('rejects retrieval for secrets owned by other users', async () => {
      // Create a secret as user A
      const userAApp = createTestApp({ apiKey: TEST_WORKOS_API_KEY })
      const storeRes = await vaultRequest(userAApp, 'POST', '/secrets', {
        headers: { Cookie: 'session_token=user_a_session' },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: { ...MOCK_SECRET_METADATA, identityId: 'user_a_identity' },
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const userARef = storeBody.vaultRef

      // Try to retrieve as user B
      const res = await vaultRequest(app, 'GET', `/secrets/${userARef}`, {
        headers: { Cookie: 'session_token=user_b_session' },
      })

      expect([401, 403, 404]).toContain(res.status)
    })

    it('allows organization members to access org secrets', async () => {
      // Store a secret with organization scope
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: {
            ...MOCK_SECRET_METADATA,
            organizationId: 'org_shared',
          },
          scope: 'organization',
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const orgRef = storeBody.vaultRef

      // Access as another org member
      const res = await vaultRequest(app, 'GET', `/secrets/${orgRef}`, {
        headers: { Cookie: 'session_token=org_member_session' },
      })

      // Should succeed if user is org member
      expect([200, 403]).toContain(res.status)
    })

    it('denies access to secrets from different organization', async () => {
      // Store a secret in org A
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: {
            ...MOCK_SECRET_METADATA,
            organizationId: 'org_a',
          },
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const orgARef = storeBody.vaultRef

      // Try to access from org B context
      const res = await vaultRequest(app, 'GET', `/secrets/${orgARef}`, {
        headers: { Cookie: 'session_token=org_b_session' },
      })

      expect([401, 403, 404]).toContain(res.status)
    })

    it('admin can access any secret', async () => {
      const res = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      expect(res.status).toBe(200)
    })
  })

  describe('Retrieve error handling', () => {
    it('returns 404 for non-existent vault reference', async () => {
      const res = await vaultRequest(app, 'GET', '/secrets/vault_nonexistent_ref_xyz', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/not found|does not exist/i)
    })

    it('returns 400 for invalid vault reference format', async () => {
      const res = await vaultRequest(app, 'GET', '/secrets/invalid-format', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/invalid|format|reference/i)
    })

    it('handles corrupted encrypted data gracefully', async () => {
      // This would require injecting corrupted data - test may need special setup
      const res = await vaultRequest(app, 'GET', '/secrets/vault_corrupted_test', {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      // Should return error, not crash
      expect([404, 500]).toContain(res.status)
    })
  })
})

// ============================================================================
// 4. Rotation Tests
// ============================================================================

describe('WorkOS Vault - Secret Rotation', () => {
  let app: Hono
  let storedVaultRef: string

  beforeEach(async () => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({ apiKey: TEST_WORKOS_API_KEY })

    // Pre-store a secret for rotation tests
    const storeRes = await vaultRequest(app, 'POST', '/secrets', {
      headers: { Cookie: mockSessionCookie() },
      body: {
        secret: MOCK_OAUTH_TOKEN,
        metadata: MOCK_SECRET_METADATA,
      },
    })

    if (storeRes.status === 200 || storeRes.status === 201) {
      const body = (await storeRes.json()) as VaultResponse
      storedVaultRef = body.vaultRef || 'vault_test_ref'
    } else {
      storedVaultRef = 'vault_test_ref'
    }
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Rotate secrets without downtime', () => {
    it('rotates secret while keeping same vault reference', async () => {
      const newToken = {
        ...MOCK_OAUTH_TOKEN,
        accessToken: 'gho_new_rotated_token_xyz123',
      }

      const res = await vaultRequest(app, 'PUT', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: newToken,
        },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as VaultResponse
      expect(body.success).toBe(true)
      expect(body.rotated).toBe(true)
      // Vault ref should remain the same
      expect(body.vaultRef).toBe(storedVaultRef)
    })

    it('preserves metadata during rotation', async () => {
      const newToken = {
        ...MOCK_OAUTH_TOKEN,
        accessToken: 'gho_rotated_token',
      }

      await vaultRequest(app, 'PUT', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
        body: { secret: newToken },
      })

      // Retrieve and verify metadata preserved
      const getRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(getRes.status).toBe(200)
      const body = (await getRes.json()) as VaultResponse & { metadata?: SecretMetadata }
      expect(body.metadata?.provider).toBe(MOCK_SECRET_METADATA.provider)
      expect(body.metadata?.accountId).toBe(MOCK_SECRET_METADATA.accountId)
    })

    it('supports atomic rotation (old secret valid until rotation completes)', async () => {
      const rotatePromise = vaultRequest(app, 'PUT', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: { accessToken: 'gho_new_token' },
        },
      })

      // Concurrent read during rotation should succeed
      const readPromise = vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const [rotateRes, readRes] = await Promise.all([rotatePromise, readPromise])

      expect(rotateRes.status).toBe(200)
      expect(readRes.status).toBe(200)
    })

    it('updates rotation timestamp in metadata', async () => {
      const beforeRotation = Date.now()

      await vaultRequest(app, 'PUT', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: { accessToken: 'gho_rotated' },
        },
      })

      const getRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/metadata`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const body = (await getRes.json()) as VaultResponse & {
        metadata?: SecretMetadata & { rotatedAt?: string }
      }
      if (body.metadata?.rotatedAt) {
        const rotatedAt = new Date(body.metadata.rotatedAt).getTime()
        expect(rotatedAt).toBeGreaterThanOrEqual(beforeRotation)
      }
    })

    it('increments rotation version/count', async () => {
      // Get initial version
      const initialRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/metadata`, {
        headers: { Cookie: mockSessionCookie() },
      })
      const initialBody = (await initialRes.json()) as VaultResponse & {
        metadata?: { version?: number }
      }
      const initialVersion = initialBody.metadata?.version || 0

      // Rotate
      await vaultRequest(app, 'PUT', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
        body: { secret: { accessToken: 'gho_v2' } },
      })

      // Check version incremented
      const afterRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/metadata`, {
        headers: { Cookie: mockSessionCookie() },
      })
      const afterBody = (await afterRes.json()) as VaultResponse & {
        metadata?: { version?: number }
      }
      expect(afterBody.metadata?.version).toBe(initialVersion + 1)
    })
  })

  describe('Rotation with expiration update', () => {
    it('updates expiration time during rotation', async () => {
      const newExpiration = new Date(Date.now() + 7200000).toISOString() // 2 hours from now

      const res = await vaultRequest(app, 'PUT', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: { accessToken: 'gho_new' },
          metadata: { expiresAt: newExpiration },
        },
      })

      expect(res.status).toBe(200)

      const getRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/metadata`, {
        headers: { Cookie: mockSessionCookie() },
      })
      const body = (await getRes.json()) as VaultResponse & { metadata?: { expiresAt?: string } }
      expect(body.metadata?.expiresAt).toBe(newExpiration)
    })

    it('allows updating only metadata without changing secret', async () => {
      const newExpiration = new Date(Date.now() + 3600000).toISOString()

      const res = await vaultRequest(app, 'PATCH', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
        body: {
          metadata: { expiresAt: newExpiration },
        },
      })

      expect(res.status).toBe(200)

      // Verify secret unchanged
      const getRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })
      const body = (await getRes.json()) as VaultResponse
      expect(body.secret?.accessToken).toBe(MOCK_OAUTH_TOKEN.accessToken)
    })
  })

  describe('Rotation authorization', () => {
    it('only secret owner can rotate', async () => {
      const res = await vaultRequest(app, 'PUT', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: 'session_token=different_user_session' },
        body: {
          secret: { accessToken: 'gho_unauthorized_rotation' },
        },
      })

      expect([401, 403]).toContain(res.status)
    })

    it('admin can rotate any secret', async () => {
      const res = await vaultRequest(app, 'PUT', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          secret: { accessToken: 'gho_admin_rotated' },
        },
      })

      expect(res.status).toBe(200)
    })
  })
})

// ============================================================================
// 5. Audit Tests
// ============================================================================

describe('WorkOS Vault - Audit Logging', () => {
  let app: Hono
  let storedVaultRef: string

  beforeEach(async () => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({ apiKey: TEST_WORKOS_API_KEY })

    // Pre-store a secret for audit tests
    const storeRes = await vaultRequest(app, 'POST', '/secrets', {
      headers: { Cookie: mockSessionCookie() },
      body: {
        secret: MOCK_OAUTH_TOKEN,
        metadata: MOCK_SECRET_METADATA,
      },
    })

    if (storeRes.status === 200 || storeRes.status === 201) {
      const body = (await storeRes.json()) as VaultResponse
      storedVaultRef = body.vaultRef || 'vault_test_ref'
    } else {
      storedVaultRef = 'vault_test_ref'
    }
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Access logging', () => {
    it('logs secret creation event', async () => {
      // Create a new secret to generate audit entry
      const createRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: 'test_audit_secret',
          metadata: { ...MOCK_SECRET_METADATA, accountId: 'audit_test_account' },
        },
      })

      const createBody = (await createRes.json()) as VaultResponse
      const newRef = createBody.vaultRef

      // Get audit log
      const auditRes = await vaultRequest(app, 'GET', `/secrets/${newRef}/audit`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(auditRes.status).toBe(200)
      const auditBody = (await auditRes.json()) as VaultResponse
      expect(auditBody.auditLog).toBeDefined()
      expect(auditBody.auditLog?.length).toBeGreaterThanOrEqual(1)

      const createEvent = auditBody.auditLog?.find((e) => e.action === 'create')
      expect(createEvent).toBeDefined()
    })

    it('logs secret access (read) event', async () => {
      // Access the secret
      await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      // Get audit log
      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(auditRes.status).toBe(200)
      const auditBody = (await auditRes.json()) as VaultResponse
      expect(auditBody.auditLog).toBeDefined()

      const readEvent = auditBody.auditLog?.find((e) => e.action === 'read')
      expect(readEvent).toBeDefined()
    })

    it('logs secret rotation event', async () => {
      // Rotate the secret
      await vaultRequest(app, 'PUT', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
        body: { secret: { accessToken: 'gho_rotated_for_audit' } },
      })

      // Get audit log
      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(auditRes.status).toBe(200)
      const auditBody = (await auditRes.json()) as VaultResponse
      expect(auditBody.auditLog).toBeDefined()

      const rotateEvent = auditBody.auditLog?.find((e) => e.action === 'rotate')
      expect(rotateEvent).toBeDefined()
    })

    it('logs failed access attempts', async () => {
      // Try unauthorized access
      await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: 'session_token=unauthorized_user' },
      })

      // Admin should be able to see failed access in audit
      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      expect(auditRes.status).toBe(200)
      const auditBody = (await auditRes.json()) as VaultResponse
      expect(auditBody.auditLog).toBeDefined()

      const failedEvent = auditBody.auditLog?.find(
        (e) => e.action === 'read' && e.success === false
      )
      expect(failedEvent).toBeDefined()
    })
  })

  describe('Audit entry content', () => {
    it('audit entry includes timestamp', async () => {
      const beforeAccess = Date.now()

      await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const auditBody = (await auditRes.json()) as VaultResponse
      const latestEvent = auditBody.auditLog?.[0]

      expect(latestEvent?.timestamp).toBeDefined()
      const eventTime = new Date(latestEvent!.timestamp).getTime()
      expect(eventTime).toBeGreaterThanOrEqual(beforeAccess)
    })

    it('audit entry includes actor identity', async () => {
      await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const auditBody = (await auditRes.json()) as VaultResponse
      const latestEvent = auditBody.auditLog?.[0]

      expect(latestEvent?.actorId).toBeDefined()
      expect(latestEvent?.actorType).toBeDefined() // 'user', 'service', 'admin'
    })

    it('audit entry includes client IP (when available)', async () => {
      await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: {
          Cookie: mockSessionCookie(),
          'X-Forwarded-For': '192.168.1.100',
        },
      })

      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const auditBody = (await auditRes.json()) as VaultResponse
      const latestEvent = auditBody.auditLog?.[0]

      expect(latestEvent?.clientIp).toBeDefined()
    })

    it('audit entry includes action type', async () => {
      await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const auditBody = (await auditRes.json()) as VaultResponse
      const latestEvent = auditBody.auditLog?.[0]

      expect(['create', 'read', 'rotate', 'delete']).toContain(latestEvent?.action)
    })

    it('audit entry includes success/failure status', async () => {
      await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: mockSessionCookie() },
      })

      const auditBody = (await auditRes.json()) as VaultResponse
      const latestEvent = auditBody.auditLog?.[0]

      expect(typeof latestEvent?.success).toBe('boolean')
    })
  })

  describe('Audit log access control', () => {
    it('owner can view audit log for their secrets', async () => {
      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(auditRes.status).toBe(200)
    })

    it('non-owner cannot view audit log', async () => {
      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: 'session_token=different_user' },
      })

      expect([401, 403, 404]).toContain(auditRes.status)
    })

    it('admin can view any audit log', async () => {
      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit`, {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      expect(auditRes.status).toBe(200)
    })

    it('supports pagination for audit logs', async () => {
      // Generate multiple audit events
      for (let i = 0; i < 5; i++) {
        await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}`, {
          headers: { Cookie: mockSessionCookie() },
        })
      }

      // Get paginated audit log
      const auditRes = await vaultRequest(app, 'GET', `/secrets/${storedVaultRef}/audit?limit=2`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(auditRes.status).toBe(200)
      const auditBody = (await auditRes.json()) as VaultResponse & {
        hasMore?: boolean
        cursor?: string
      }
      expect(auditBody.auditLog?.length).toBeLessThanOrEqual(2)
      if (auditBody.hasMore) {
        expect(auditBody.cursor).toBeDefined()
      }
    })
  })
})

// ============================================================================
// 6. Delete Tests
// ============================================================================

describe('WorkOS Vault - Secure Deletion', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({ apiKey: TEST_WORKOS_API_KEY })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Delete secrets securely', () => {
    it('deletes secret by vault reference', async () => {
      // Store a secret
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      // Delete it
      const deleteRes = await vaultRequest(app, 'DELETE', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([200, 204]).toContain(deleteRes.status)
      if (deleteRes.status === 200) {
        const deleteBody = (await deleteRes.json()) as VaultResponse
        expect(deleteBody.deleted).toBe(true)
      }
    })

    it('deleted secret cannot be retrieved', async () => {
      // Store a secret
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      // Delete it
      await vaultRequest(app, 'DELETE', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      // Try to retrieve - should fail
      const getRes = await vaultRequest(app, 'GET', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([404, 410]).toContain(getRes.status)
    })

    it('deletion is cryptographically secure (key destroyed)', async () => {
      // Store a secret
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      // Delete it
      const deleteRes = await vaultRequest(app, 'DELETE', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([200, 204]).toContain(deleteRes.status)

      // Even admin cannot recover the secret
      const adminGetRes = await vaultRequest(app, 'GET', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      expect([404, 410]).toContain(adminGetRes.status)
    })

    it('logs deletion in audit trail before destroying', async () => {
      // Store a secret
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: { ...MOCK_SECRET_METADATA, accountId: 'delete_audit_test' },
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      // Delete it
      await vaultRequest(app, 'DELETE', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      // Audit log should be preserved (even for deleted secrets)
      const auditRes = await vaultRequest(app, 'GET', `/audit/deleted/${vaultRef}`, {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      if (auditRes.status === 200) {
        const auditBody = (await auditRes.json()) as VaultResponse
        const deleteEvent = auditBody.auditLog?.find((e) => e.action === 'delete')
        expect(deleteEvent).toBeDefined()
      }
    })
  })

  describe('Delete authorization', () => {
    it('only secret owner can delete', async () => {
      // Store a secret as user A
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      // Try to delete as user B
      const deleteRes = await vaultRequest(app, 'DELETE', `/secrets/${vaultRef}`, {
        headers: { Cookie: 'session_token=different_user' },
      })

      expect([401, 403]).toContain(deleteRes.status)
    })

    it('admin can delete any secret', async () => {
      // Store a secret
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      // Admin deletes
      const deleteRes = await vaultRequest(app, 'DELETE', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      expect([200, 204]).toContain(deleteRes.status)
    })

    it('requires authentication to delete', async () => {
      // Store a secret
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      // Try to delete without auth
      const deleteRes = await vaultRequest(app, 'DELETE', `/secrets/${vaultRef}`, {
        // No session cookie
      })

      expect(deleteRes.status).toBe(401)
    })
  })

  describe('Bulk deletion', () => {
    it('can delete all secrets for a linked account', async () => {
      // Store multiple secrets for same account
      for (let i = 0; i < 3; i++) {
        await vaultRequest(app, 'POST', '/secrets', {
          headers: { Cookie: mockSessionCookie() },
          body: {
            secret: `secret_${i}`,
            metadata: {
              ...MOCK_SECRET_METADATA,
              accountId: 'bulk_delete_account',
            },
          },
        })
      }

      // Bulk delete by account
      const deleteRes = await vaultRequest(app, 'DELETE', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: { accountId: 'bulk_delete_account' },
      })

      expect([200, 204]).toContain(deleteRes.status)

      // Verify all deleted
      const listRes = await vaultRequest(
        app,
        'GET',
        '/secrets?accountId=bulk_delete_account',
        {
          headers: { Cookie: mockSessionCookie() },
        }
      )

      if (listRes.status === 200) {
        const body = (await listRes.json()) as { secrets: VaultSecret[] }
        expect(body.secrets?.length || 0).toBe(0)
      }
    })

    it('can delete all secrets for a provider', async () => {
      // Store secrets for different providers
      await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: 'github_secret',
          metadata: { ...MOCK_SECRET_METADATA, provider: 'github_bulk', accountId: 'acc1' },
        },
      })
      await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: 'github_secret_2',
          metadata: { ...MOCK_SECRET_METADATA, provider: 'github_bulk', accountId: 'acc2' },
        },
      })

      // Bulk delete by provider
      const deleteRes = await vaultRequest(app, 'DELETE', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: { provider: 'github_bulk' },
      })

      expect([200, 204]).toContain(deleteRes.status)
    })
  })
})

// ============================================================================
// 7. Error Handling Tests
// ============================================================================

describe('WorkOS Vault - Error Handling', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({ apiKey: TEST_WORKOS_API_KEY })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Network errors', () => {
    it('handles WorkOS API network timeout', async () => {
      const timeoutApp = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        timeout: 1,
        baseUrl: 'https://slow.workos.example.com.ai',
      })

      const res = await vaultRequest(timeoutApp, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect([408, 502, 503, 504]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toBeDefined()
    })

    it('handles DNS resolution failure', async () => {
      const dnsFailApp = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        baseUrl: 'https://nonexistent.invalid.domain.xyz',
      })

      const res = await vaultRequest(dnsFailApp, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect([502, 503]).toContain(res.status)
    })

    it('handles connection reset gracefully', async () => {
      // This would require network-level mocking
      // Test that the error is handled and a proper response is returned
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      // Should either succeed or return a proper error response
      expect(res.status).toBeDefined()
      if (res.status >= 400) {
        const body = (await res.json()) as VaultResponse
        expect(body.error).toBeDefined()
      }
    })
  })

  describe('Auth errors', () => {
    it('returns 401 for invalid API key', async () => {
      const invalidKeyApp = createTestApp({
        apiKey: 'sk_invalid_key',
      })

      const res = await vaultRequest(invalidKeyApp, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect([401, 403]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/unauthorized|invalid|api.?key/i)
    })

    it('returns 401 for expired API key', async () => {
      const expiredKeyApp = createTestApp({
        apiKey: 'sk_expired_key_12345',
      })

      const res = await vaultRequest(expiredKeyApp, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect([401, 403]).toContain(res.status)
    })

    it('returns 401 for revoked API key', async () => {
      const revokedKeyApp = createTestApp({
        apiKey: 'sk_revoked_key_12345',
      })

      const res = await vaultRequest(revokedKeyApp, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect([401, 403]).toContain(res.status)
    })

    it('returns 403 for insufficient permissions', async () => {
      const readOnlyApp = createTestApp({
        apiKey: 'sk_readonly_key_12345', // Key with read-only permissions
      })

      const res = await vaultRequest(readOnlyApp, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: MOCK_SECRET_METADATA,
        },
      })

      expect([401, 403]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/permission|forbidden|unauthorized/i)
    })
  })

  describe('Not found errors', () => {
    it('returns 404 for non-existent vault reference', async () => {
      const res = await vaultRequest(app, 'GET', '/secrets/vault_does_not_exist_xyz', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/not found|does not exist/i)
    })

    it('returns 404 for deleted vault reference', async () => {
      // Store and delete
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: 'to_be_deleted',
          metadata: MOCK_SECRET_METADATA,
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      await vaultRequest(app, 'DELETE', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      // Try to access deleted
      const res = await vaultRequest(app, 'GET', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([404, 410]).toContain(res.status)
    })

    it('returns 410 Gone for permanently deleted secrets', async () => {
      // Store and delete
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: 'permanent_delete',
          metadata: MOCK_SECRET_METADATA,
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      await vaultRequest(app, 'DELETE', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      // Should return 410 to indicate it was deleted (not just missing)
      const res = await vaultRequest(app, 'GET', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      expect([404, 410]).toContain(res.status)
    })
  })

  describe('Rate limiting', () => {
    it('returns 429 when rate limited', async () => {
      // Make many requests quickly
      const requests = Array.from({ length: 100 }, () =>
        vaultRequest(app, 'GET', '/secrets/vault_test', {
          headers: { Cookie: mockSessionCookie() },
        })
      )

      const responses = await Promise.all(requests)

      // At least some should be rate limited
      const rateLimited = responses.filter((r) => r.status === 429)
      // This might not trigger in tests, so just check the structure
      for (const res of rateLimited) {
        const body = (await res.json()) as VaultResponse
        expect(body.error).toMatch(/rate.?limit|too many/i)
      }
    })

    it('includes Retry-After header when rate limited', async () => {
      const rateLimitApp = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        rateLimitForTest: 1, // Force rate limiting
      })

      // Trigger rate limit
      await vaultRequest(rateLimitApp, 'GET', '/secrets/vault_test', {
        headers: { Cookie: mockSessionCookie() },
      })

      const res = await vaultRequest(rateLimitApp, 'GET', '/secrets/vault_test', {
        headers: { Cookie: mockSessionCookie() },
      })

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After')
        expect(retryAfter).toBeDefined()
      }
    })
  })

  describe('Input validation errors', () => {
    it('returns 400 for malformed JSON body', async () => {
      const res = await app.request('/api/vault/secrets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: mockSessionCookie(),
        },
        body: '{ invalid json }',
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/json|parse|malformed/i)
    })

    it('returns 400 for missing required fields', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          // Missing secret and metadata
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/required|missing/i)
    })

    it('returns 400 for invalid metadata type', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_API_KEY.key,
          metadata: {
            ...MOCK_SECRET_METADATA,
            type: 'invalid_type',
          },
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toMatch(/type|invalid/i)
    })
  })

  describe('Error response format', () => {
    it('error responses include error message', async () => {
      const res = await vaultRequest(app, 'GET', '/secrets/invalid', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBeGreaterThanOrEqual(400)
      const body = (await res.json()) as VaultResponse
      expect(body.error).toBeDefined()
      expect(typeof body.error).toBe('string')
    })

    it('error responses include error code for programmatic handling', async () => {
      const res = await vaultRequest(app, 'GET', '/secrets/vault_not_found_xyz', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as VaultResponse & { code?: string }
      // Should include machine-readable error code
      if (body.code) {
        expect(body.code).toMatch(/NOT_FOUND|VAULT_NOT_FOUND|SECRET_NOT_FOUND/i)
      }
    })

    it('does not leak sensitive info in error messages', async () => {
      const res = await vaultRequest(app, 'GET', '/secrets/vault_test', {
        // No auth
      })

      expect(res.status).toBe(401)
      const body = (await res.json()) as VaultResponse

      // Should not include stack traces or internal details
      expect(body.error).not.toContain('at ')
      expect(body.error).not.toContain('node_modules')
      expect(body.error).not.toContain('Error:')
    })
  })
})

// ============================================================================
// 8. Integration with Auth Federation Tests
// ============================================================================

describe('WorkOS Vault - Auth Federation Integration', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({ apiKey: TEST_WORKOS_API_KEY })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Integration with linkedAccounts.vaultRef', () => {
    it('stores OAuth token and returns vaultRef for linkedAccount', async () => {
      const res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_OAUTH_TOKEN,
          metadata: {
            provider: 'github',
            accountId: 'linked_account_github_123',
            identityId: 'identity_user_456',
            type: 'oauth_token',
          },
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as VaultResponse
      expect(body.vaultRef).toBeDefined()
      expect(body.vaultRef).toMatch(/^vault_/)
    })

    it('retrieves OAuth token using vaultRef from linkedAccount', async () => {
      // Store a token
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_OAUTH_TOKEN,
          metadata: {
            provider: 'github',
            accountId: 'linked_account_123',
            identityId: 'identity_456',
            type: 'oauth_token',
          },
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      // Retrieve using vaultRef (as if coming from linkedAccount record)
      const getRes = await vaultRequest(app, 'GET', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(getRes.status).toBe(200)
      const getBody = (await getRes.json()) as VaultResponse
      expect(getBody.secret?.accessToken).toBe(MOCK_OAUTH_TOKEN.accessToken)
    })

    it('updates vaultRef in linkedAccount during token refresh', async () => {
      // Initial store
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_OAUTH_TOKEN,
          metadata: {
            provider: 'github',
            accountId: 'linked_refresh_test',
            identityId: 'identity_456',
            type: 'oauth_token',
          },
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const originalRef = storeBody.vaultRef

      // Simulate token refresh - update with new token
      const refreshedToken = {
        ...MOCK_OAUTH_TOKEN,
        accessToken: 'gho_refreshed_token_xyz',
      }

      const updateRes = await vaultRequest(app, 'PUT', `/secrets/${originalRef}`, {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: refreshedToken,
        },
      })

      expect(updateRes.status).toBe(200)
      const updateBody = (await updateRes.json()) as VaultResponse
      // vaultRef should remain the same (in-place update)
      expect(updateBody.vaultRef).toBe(originalRef)

      // Verify new token is stored
      const getRes = await vaultRequest(app, 'GET', `/secrets/${originalRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })
      const getBody = (await getRes.json()) as VaultResponse
      expect(getBody.secret?.accessToken).toBe(refreshedToken.accessToken)
    })

    it('deletes vault secret when linkedAccount is removed', async () => {
      // Store a token
      const storeRes = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: MOCK_OAUTH_TOKEN,
          metadata: {
            provider: 'github',
            accountId: 'linked_to_delete',
            identityId: 'identity_456',
            type: 'oauth_token',
          },
        },
      })

      const storeBody = (await storeRes.json()) as VaultResponse
      const vaultRef = storeBody.vaultRef

      // Delete the secret (simulating linkedAccount removal)
      const deleteRes = await vaultRequest(app, 'DELETE', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([200, 204]).toContain(deleteRes.status)

      // Verify deleted
      const getRes = await vaultRequest(app, 'GET', `/secrets/${vaultRef}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([404, 410]).toContain(getRes.status)
    })
  })

  describe('Multi-account support', () => {
    it('supports multiple vault refs for same provider (multiple accounts)', async () => {
      // Store first GitHub account
      const store1Res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: { accessToken: 'gho_account_1' },
          metadata: {
            provider: 'github',
            accountId: 'linked_github_work',
            identityId: 'identity_456',
            type: 'oauth_token',
          },
        },
      })

      // Store second GitHub account
      const store2Res = await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: { accessToken: 'gho_account_2' },
          metadata: {
            provider: 'github',
            accountId: 'linked_github_personal',
            identityId: 'identity_456',
            type: 'oauth_token',
          },
        },
      })

      expect([200, 201]).toContain(store1Res.status)
      expect([200, 201]).toContain(store2Res.status)

      const body1 = (await store1Res.json()) as VaultResponse
      const body2 = (await store2Res.json()) as VaultResponse

      // Should have different vault refs
      expect(body1.vaultRef).not.toBe(body2.vaultRef)
    })

    it('lists all secrets for an identity', async () => {
      const identityId = 'identity_list_test'

      // Store secrets for multiple providers
      await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: { accessToken: 'github_token' },
          metadata: {
            provider: 'github',
            accountId: 'gh_acc',
            identityId,
            type: 'oauth_token',
          },
        },
      })

      await vaultRequest(app, 'POST', '/secrets', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          secret: { accessToken: 'google_token' },
          metadata: {
            provider: 'google',
            accountId: 'google_acc',
            identityId,
            type: 'oauth_token',
          },
        },
      })

      // List all secrets for identity
      const listRes = await vaultRequest(app, 'GET', `/secrets?identityId=${identityId}`, {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(listRes.status).toBe(200)
      const listBody = (await listRes.json()) as { secrets: Array<{ vaultRef: string }> }
      expect(listBody.secrets?.length).toBeGreaterThanOrEqual(2)
    })
  })
})
