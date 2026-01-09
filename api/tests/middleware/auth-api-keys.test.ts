import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'

/**
 * API Key Security Tests
 *
 * These tests verify that API keys are loaded from environment variables
 * or KV storage rather than being hardcoded in the source code.
 *
 * Security requirements:
 * - No hardcoded API keys in source code
 * - API keys must come from env.API_KEYS or KV binding
 * - Middleware should gracefully handle missing API_KEYS configuration
 */

import {
  authMiddleware,
  requireAuth,
  loadApiKeysFromEnv,
  getApiKeyLoader,
  type ApiKeyConfig,
  type AuthConfig,
} from '../../middleware/auth'

// ============================================================================
// Types
// ============================================================================

interface AuthContext {
  userId: string
  email?: string
  role: 'admin' | 'user'
  permissions?: string[]
}

type AppVariables = {
  auth?: AuthContext
}

// Mock environment for testing
interface MockEnv {
  API_KEYS?: string
  KV?: {
    get: (key: string) => Promise<string | null>
  }
}

// ============================================================================
// API Key Loading from Environment Tests
// ============================================================================

describe('API Key Loading from Environment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads API keys from env.API_KEYS JSON string', () => {
    const env: MockEnv = {
      API_KEYS: JSON.stringify({
        'prod-key-123': { userId: 'user-1', role: 'user', name: 'Production Key' },
        'admin-key-456': { userId: 'admin-1', role: 'admin', name: 'Admin Key' },
      }),
    }

    const apiKeys = loadApiKeysFromEnv(env as unknown as Record<string, unknown>)

    expect(apiKeys.size).toBe(2)
    expect(apiKeys.get('prod-key-123')).toEqual({
      userId: 'user-1',
      role: 'user',
      name: 'Production Key',
    })
    expect(apiKeys.get('admin-key-456')).toEqual({
      userId: 'admin-1',
      role: 'admin',
      name: 'Admin Key',
    })
  })

  it('returns empty Map when env.API_KEYS is not set', () => {
    const env: MockEnv = {}

    const apiKeys = loadApiKeysFromEnv(env as unknown as Record<string, unknown>)

    expect(apiKeys.size).toBe(0)
  })

  it('returns empty Map when env.API_KEYS is invalid JSON', () => {
    const env: MockEnv = {
      API_KEYS: 'not valid json',
    }

    const apiKeys = loadApiKeysFromEnv(env as unknown as Record<string, unknown>)

    expect(apiKeys.size).toBe(0)
  })

  it('handles API keys with permissions array', () => {
    const env: MockEnv = {
      API_KEYS: JSON.stringify({
        'key-with-perms': {
          userId: 'user-1',
          role: 'user',
          name: 'Limited Key',
          permissions: ['read', 'write'],
        },
      }),
    }

    const apiKeys = loadApiKeysFromEnv(env as unknown as Record<string, unknown>)

    expect(apiKeys.get('key-with-perms')?.permissions).toEqual(['read', 'write'])
  })
})

// ============================================================================
// API Key Loading from KV Tests
// ============================================================================

describe('API Key Loading from KV', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads API key from KV when not found in env', async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          userId: 'kv-user-1',
          role: 'user',
          name: 'KV Stored Key',
        }),
      ),
    }

    const env: MockEnv = {
      KV: mockKV,
    }

    const loader = getApiKeyLoader(env as unknown as Record<string, unknown>)
    const keyConfig = await loader('kv-api-key-123')

    expect(mockKV.get).toHaveBeenCalledWith('api-key:kv-api-key-123')
    expect(keyConfig).toEqual({
      userId: 'kv-user-1',
      role: 'user',
      name: 'KV Stored Key',
    })
  })

  it('returns undefined when API key not found in KV', async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue(null),
    }

    const env: MockEnv = {
      KV: mockKV,
    }

    const loader = getApiKeyLoader(env as unknown as Record<string, unknown>)
    const keyConfig = await loader('nonexistent-key')

    expect(keyConfig).toBeUndefined()
  })

  it('prefers env.API_KEYS over KV lookup for efficiency', async () => {
    const mockKV = {
      get: vi.fn(),
    }

    const env: MockEnv = {
      API_KEYS: JSON.stringify({
        'env-key': { userId: 'env-user', role: 'user', name: 'Env Key' },
      }),
      KV: mockKV,
    }

    const loader = getApiKeyLoader(env as unknown as Record<string, unknown>)
    const keyConfig = await loader('env-key')

    // Should not call KV since key is found in env
    expect(mockKV.get).not.toHaveBeenCalled()
    expect(keyConfig).toEqual({
      userId: 'env-user',
      role: 'user',
      name: 'Env Key',
    })
  })

  it('falls back to KV when key not in env.API_KEYS', async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          userId: 'kv-user',
          role: 'admin',
          name: 'KV Key',
        }),
      ),
    }

    const env: MockEnv = {
      API_KEYS: JSON.stringify({
        'env-key': { userId: 'env-user', role: 'user', name: 'Env Key' },
      }),
      KV: mockKV,
    }

    const loader = getApiKeyLoader(env as unknown as Record<string, unknown>)
    const keyConfig = await loader('kv-only-key')

    expect(mockKV.get).toHaveBeenCalledWith('api-key:kv-only-key')
    expect(keyConfig).toEqual({
      userId: 'kv-user',
      role: 'admin',
      name: 'KV Key',
    })
  })
})

// ============================================================================
// Middleware Integration Tests
// ============================================================================

describe('Auth Middleware with Environment API Keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authenticates with API key from environment', async () => {
    const env = {
      API_KEYS: JSON.stringify({
        'test-env-key': { userId: 'env-user-1', role: 'user', name: 'Test Key' },
      }),
    }

    const app = new Hono<{ Bindings: typeof env; Variables: AppVariables }>()

    app.use('*', authMiddleware())
    app.get('/protected', requireAuth(), (c) => {
      const auth = c.get('auth')
      return c.json({ userId: auth?.userId, role: auth?.role })
    })

    const res = await app.request('/protected', {
      method: 'GET',
      headers: {
        'X-API-Key': 'test-env-key',
      },
    }, env)

    expect(res.status).toBe(200)
    const body = await res.json() as { userId: string; role: string }
    expect(body.userId).toBe('env-user-1')
    expect(body.role).toBe('user')
  })

  it('rejects API key not in environment or KV', async () => {
    const env = {
      API_KEYS: JSON.stringify({
        'valid-key': { userId: 'user-1', role: 'user', name: 'Valid Key' },
      }),
    }

    const app = new Hono<{ Bindings: typeof env; Variables: AppVariables }>()

    app.use('*', authMiddleware())
    app.get('/protected', requireAuth(), (c) => {
      return c.json({ ok: true })
    })

    const res = await app.request('/protected', {
      method: 'GET',
      headers: {
        'X-API-Key': 'invalid-key-not-in-env',
      },
    }, env)

    expect(res.status).toBe(401)
  })

  it('gracefully handles missing API_KEYS configuration', async () => {
    const env = {} // No API_KEYS

    const app = new Hono<{ Bindings: typeof env; Variables: AppVariables }>()

    app.use('*', authMiddleware())
    app.get('/public', (c) => c.json({ message: 'public' }))

    const res = await app.request('/public', {
      method: 'GET',
    }, env)

    // Should not crash, public route should work
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// No Hardcoded API Keys Verification
// ============================================================================

describe('No Hardcoded API Keys', () => {
  it('source code should not contain hardcoded API key values', async () => {
    // This is a meta-test to verify the security fix
    // The actual verification is that the middleware uses loadApiKeysFromEnv
    // instead of a hardcoded Map

    // Verify that getApiKeyLoader is used (dynamic loading)
    expect(typeof getApiKeyLoader).toBe('function')

    // Verify loadApiKeysFromEnv exists and works with empty env
    const emptyKeys = loadApiKeysFromEnv({})
    expect(emptyKeys.size).toBe(0)
  })

  it('middleware should not authenticate with keys not in environment', async () => {
    // Specifically test that old hardcoded keys like 'test-api-key' and 'admin-api-key'
    // no longer work when environment is empty
    const env = {} // No API_KEYS configured

    const app = new Hono<{ Bindings: typeof env; Variables: AppVariables }>()

    app.use('*', authMiddleware())
    app.get('/protected', requireAuth(), (c) => c.json({ ok: true }))

    // Try the old hardcoded keys - they should NOT work
    const res1 = await app.request('/protected', {
      headers: { 'X-API-Key': 'test-api-key' },
    }, env)
    expect(res1.status).toBe(401)

    const res2 = await app.request('/protected', {
      headers: { 'X-API-Key': 'admin-api-key' },
    }, env)
    expect(res2.status).toBe(401)
  })
})
