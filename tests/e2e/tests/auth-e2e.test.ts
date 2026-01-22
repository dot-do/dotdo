/**
 * E2E Authentication Tests - Complete Auth Lifecycle
 *
 * Tests comprehensive authentication flows with REAL DO instances:
 * 1. JWT token authentication (login with valid/invalid tokens)
 * 2. API Key authentication
 * 3. Token refresh flow
 * 4. Logout and session invalidation
 * 5. Protected resource access patterns
 * 6. Multi-tenant auth isolation
 *
 * NO MOCKS - uses real Miniflare instances to test true integration.
 *
 * @module e2e/tests/auth-e2e.test
 * @see do-oojf
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string
}

interface User {
  $id: string
  email: string
  name: string
  role: 'admin' | 'user' | 'guest'
  createdAt: number
}

interface Session {
  id: string
  userId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  createdAt: number
}

interface AuthResult {
  success: boolean
  tokens?: AuthTokens
  user?: User
  error?: string
  code?: string
}

// ============================================================================
// AUTH DO SCRIPT - Complete Authentication System
// ============================================================================

const AUTH_DO_SCRIPT = `
// ============================================================================
// UTILITIES
// ============================================================================

function generateId(prefix = 'id') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
}

function generateToken() {
  return Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)
}

// Simple base64url encoding for JWT-like tokens
function base64url(str) {
  return btoa(str).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
}

function decodeBase64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  return atob(str)
}

// Create JWT-like token with expiry
function createToken(payload, expiresInSeconds = 3600) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  }))
  const signature = base64url('signature-' + Date.now())
  return header + '.' + body + '.' + signature
}

// Validate JWT-like token
function validateToken(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payload = JSON.parse(decodeBase64url(parts[1]))

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, expired: true, payload }
    }

    return { valid: true, expired: false, payload }
  } catch {
    return null
  }
}

// ============================================================================
// AUTH DO CLASS
// ============================================================================

export class AuthDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // Health check
    if (path === '/health') {
      return Response.json({ status: 'ok', id: this.state.id.toString() })
    }

    // ========================================================================
    // AUTH ENDPOINTS
    // ========================================================================

    // Login with email/password
    if (path === '/auth/login' && method === 'POST') {
      return this.handleLogin(request)
    }

    // Login with API key
    if (path === '/auth/apikey' && method === 'POST') {
      return this.handleApiKeyLogin(request)
    }

    // Refresh token
    if (path === '/auth/refresh' && method === 'POST') {
      return this.handleTokenRefresh(request)
    }

    // Logout
    if (path === '/auth/logout' && method === 'POST') {
      return this.handleLogout(request)
    }

    // Validate token
    if (path === '/auth/validate' && method === 'GET') {
      return this.handleValidateToken(request)
    }

    // Register user
    if (path === '/auth/register' && method === 'POST') {
      return this.handleRegister(request)
    }

    // Create API key
    if (path === '/auth/apikey/create' && method === 'POST') {
      return this.handleCreateApiKey(request)
    }

    // Revoke API key
    if (path === '/auth/apikey/revoke' && method === 'POST') {
      return this.handleRevokeApiKey(request)
    }

    // List sessions (requires auth)
    if (path === '/auth/sessions' && method === 'GET') {
      return this.handleListSessions(request)
    }

    // ========================================================================
    // PROTECTED ENDPOINTS (require authentication)
    // ========================================================================

    // Middleware: Check authentication for protected paths
    const protectedPaths = ['/protected', '/user', '/admin']
    const isProtected = protectedPaths.some(p => path.startsWith(p))

    if (isProtected) {
      const authResult = await this.authenticateRequest(request)
      if (!authResult.authenticated) {
        return Response.json({
          error: 'Unauthorized',
          code: authResult.code || 'AUTH_REQUIRED',
          message: authResult.message || 'Authentication required'
        }, { status: 401 })
      }

      // Check admin role for admin endpoints
      if (path.startsWith('/admin') && authResult.user?.role !== 'admin') {
        return Response.json({
          error: 'Forbidden',
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Admin access required'
        }, { status: 403 })
      }

      // Attach user to request context
      request.user = authResult.user
    }

    // Protected resource
    if (path === '/protected') {
      return Response.json({
        message: 'Access granted to protected resource',
        user: request.user
      })
    }

    // User profile
    if (path === '/user/profile' && method === 'GET') {
      return this.handleGetProfile(request)
    }

    // Admin endpoint
    if (path === '/admin/users' && method === 'GET') {
      return this.handleAdminListUsers(request)
    }

    // RPC endpoint
    if (path === '/rpc' && method === 'POST') {
      return this.handleRPC(request)
    }

    return Response.json({ error: 'Not Found', path }, { status: 404 })
  }

  // ========================================================================
  // AUTH HANDLERS
  // ========================================================================

  async authenticateRequest(request) {
    // Check Authorization header (Bearer token)
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const validation = validateToken(token)

      if (!validation) {
        return { authenticated: false, code: 'INVALID_TOKEN', message: 'Invalid token format' }
      }

      if (!validation.valid) {
        if (validation.expired) {
          return { authenticated: false, code: 'TOKEN_EXPIRED', message: 'Token has expired' }
        }
        return { authenticated: false, code: 'INVALID_TOKEN', message: 'Invalid token' }
      }

      // Verify session exists
      const session = await this.storage.get('session:' + validation.payload.sessionId)
      if (!session) {
        return { authenticated: false, code: 'SESSION_INVALID', message: 'Session not found or revoked' }
      }

      // Get user
      const user = await this.storage.get('user:' + validation.payload.sub)
      if (!user) {
        return { authenticated: false, code: 'USER_NOT_FOUND', message: 'User not found' }
      }

      return { authenticated: true, user, session }
    }

    // Check X-API-Key header
    const apiKey = request.headers.get('X-API-Key')
    if (apiKey) {
      const keyData = await this.storage.get('apikey:' + apiKey)
      if (!keyData) {
        return { authenticated: false, code: 'INVALID_API_KEY', message: 'Invalid API key' }
      }

      if (keyData.revoked) {
        return { authenticated: false, code: 'API_KEY_REVOKED', message: 'API key has been revoked' }
      }

      if (keyData.expiresAt && keyData.expiresAt < Date.now()) {
        return { authenticated: false, code: 'API_KEY_EXPIRED', message: 'API key has expired' }
      }

      // Get user
      const user = await this.storage.get('user:' + keyData.userId)
      if (!user) {
        return { authenticated: false, code: 'USER_NOT_FOUND', message: 'User not found' }
      }

      // Update last used
      keyData.lastUsedAt = Date.now()
      await this.storage.put('apikey:' + apiKey, keyData)

      return { authenticated: true, user, apiKey: keyData }
    }

    return { authenticated: false, code: 'AUTH_REQUIRED', message: 'No authentication provided' }
  }

  async handleLogin(request) {
    try {
      const { email, password } = await request.json()

      if (!email || !password) {
        return Response.json({
          success: false,
          error: 'Email and password required',
          code: 'INVALID_REQUEST'
        }, { status: 400 })
      }

      // Find user by email
      const userIndex = await this.storage.get('user-index') || {}
      const userId = userIndex[email]

      if (!userId) {
        return Response.json({
          success: false,
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS'
        }, { status: 401 })
      }

      const user = await this.storage.get('user:' + userId)
      if (!user || user.password !== password) {
        return Response.json({
          success: false,
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS'
        }, { status: 401 })
      }

      // Create session
      const sessionId = generateId('session')
      const accessToken = createToken({
        sub: userId,
        email: user.email,
        role: user.role,
        sessionId,
        type: 'access'
      }, 3600) // 1 hour

      const refreshToken = createToken({
        sub: userId,
        sessionId,
        type: 'refresh'
      }, 86400 * 7) // 7 days

      const session = {
        id: sessionId,
        userId,
        accessToken,
        refreshToken,
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400 * 7 * 1000
      }

      await this.storage.put('session:' + sessionId, session)

      // Update session index
      const userSessions = await this.storage.get('user-sessions:' + userId) || []
      userSessions.push(sessionId)
      await this.storage.put('user-sessions:' + userId, userSessions)

      return Response.json({
        success: true,
        tokens: {
          accessToken,
          refreshToken,
          expiresAt: Date.now() + 3600 * 1000
        },
        user: {
          $id: user.$id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      })
    } catch (error) {
      return Response.json({
        success: false,
        error: 'Login failed',
        code: 'LOGIN_ERROR'
      }, { status: 500 })
    }
  }

  async handleApiKeyLogin(request) {
    const apiKey = request.headers.get('X-API-Key')

    if (!apiKey) {
      return Response.json({
        success: false,
        error: 'API key required',
        code: 'API_KEY_REQUIRED'
      }, { status: 400 })
    }

    const keyData = await this.storage.get('apikey:' + apiKey)

    if (!keyData) {
      return Response.json({
        success: false,
        error: 'Invalid API key',
        code: 'INVALID_API_KEY'
      }, { status: 401 })
    }

    if (keyData.revoked) {
      return Response.json({
        success: false,
        error: 'API key has been revoked',
        code: 'API_KEY_REVOKED'
      }, { status: 401 })
    }

    const user = await this.storage.get('user:' + keyData.userId)

    if (!user) {
      return Response.json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      }, { status: 401 })
    }

    // API key login doesn't create a session but returns user info
    return Response.json({
      success: true,
      user: {
        $id: user.$id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      keyName: keyData.name
    })
  }

  async handleTokenRefresh(request) {
    try {
      const { refreshToken } = await request.json()

      if (!refreshToken) {
        return Response.json({
          success: false,
          error: 'Refresh token required',
          code: 'REFRESH_TOKEN_REQUIRED'
        }, { status: 400 })
      }

      const validation = validateToken(refreshToken)

      if (!validation || !validation.valid) {
        return Response.json({
          success: false,
          error: 'Invalid refresh token',
          code: validation?.expired ? 'REFRESH_TOKEN_EXPIRED' : 'INVALID_REFRESH_TOKEN'
        }, { status: 401 })
      }

      if (validation.payload.type !== 'refresh') {
        return Response.json({
          success: false,
          error: 'Invalid token type',
          code: 'INVALID_TOKEN_TYPE'
        }, { status: 401 })
      }

      // Verify session
      const session = await this.storage.get('session:' + validation.payload.sessionId)
      if (!session) {
        return Response.json({
          success: false,
          error: 'Session not found or revoked',
          code: 'SESSION_INVALID'
        }, { status: 401 })
      }

      // Get user
      const user = await this.storage.get('user:' + validation.payload.sub)
      if (!user) {
        return Response.json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        }, { status: 401 })
      }

      // Create new access token
      const newAccessToken = createToken({
        sub: user.$id,
        email: user.email,
        role: user.role,
        sessionId: session.id,
        type: 'access'
      }, 3600)

      // Update session with new access token
      session.accessToken = newAccessToken
      await this.storage.put('session:' + session.id, session)

      return Response.json({
        success: true,
        tokens: {
          accessToken: newAccessToken,
          refreshToken, // Return same refresh token
          expiresAt: Date.now() + 3600 * 1000
        }
      })
    } catch (error) {
      return Response.json({
        success: false,
        error: 'Token refresh failed',
        code: 'REFRESH_ERROR'
      }, { status: 500 })
    }
  }

  async handleLogout(request) {
    const authHeader = request.headers.get('Authorization')

    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({
        success: false,
        error: 'Token required for logout',
        code: 'TOKEN_REQUIRED'
      }, { status: 400 })
    }

    const token = authHeader.slice(7)
    const validation = validateToken(token)

    if (!validation || !validation.payload.sessionId) {
      return Response.json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      }, { status: 401 })
    }

    // Delete session
    await this.storage.delete('session:' + validation.payload.sessionId)

    // Remove from user sessions
    const userSessions = await this.storage.get('user-sessions:' + validation.payload.sub) || []
    const updatedSessions = userSessions.filter(s => s !== validation.payload.sessionId)
    await this.storage.put('user-sessions:' + validation.payload.sub, updatedSessions)

    return Response.json({
      success: true,
      message: 'Logged out successfully'
    })
  }

  async handleValidateToken(request) {
    const authHeader = request.headers.get('Authorization')

    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({
        valid: false,
        error: 'No token provided'
      }, { status: 400 })
    }

    const token = authHeader.slice(7)
    const validation = validateToken(token)

    if (!validation) {
      return Response.json({
        valid: false,
        error: 'Invalid token format'
      })
    }

    if (!validation.valid) {
      return Response.json({
        valid: false,
        expired: validation.expired,
        error: validation.expired ? 'Token expired' : 'Invalid token'
      })
    }

    // Verify session exists
    const session = await this.storage.get('session:' + validation.payload.sessionId)
    if (!session) {
      return Response.json({
        valid: false,
        error: 'Session revoked'
      })
    }

    return Response.json({
      valid: true,
      payload: {
        sub: validation.payload.sub,
        email: validation.payload.email,
        role: validation.payload.role,
        exp: validation.payload.exp
      }
    })
  }

  async handleRegister(request) {
    try {
      const { email, password, name, role = 'user' } = await request.json()

      if (!email || !password) {
        return Response.json({
          success: false,
          error: 'Email and password required',
          code: 'INVALID_REQUEST'
        }, { status: 400 })
      }

      // Check if user already exists
      const userIndex = await this.storage.get('user-index') || {}
      if (userIndex[email]) {
        return Response.json({
          success: false,
          error: 'User already exists',
          code: 'USER_EXISTS'
        }, { status: 409 })
      }

      // Create user
      const userId = generateId('user')
      const user = {
        $id: userId,
        email,
        password, // In production, hash this!
        name: name || email.split('@')[0],
        role: role === 'admin' ? 'admin' : 'user',
        createdAt: Date.now()
      }

      await this.storage.put('user:' + userId, user)

      // Update index
      userIndex[email] = userId
      await this.storage.put('user-index', userIndex)

      return Response.json({
        success: true,
        user: {
          $id: user.$id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      }, { status: 201 })
    } catch (error) {
      return Response.json({
        success: false,
        error: 'Registration failed',
        code: 'REGISTRATION_ERROR'
      }, { status: 500 })
    }
  }

  async handleCreateApiKey(request) {
    const authResult = await this.authenticateRequest(request)
    if (!authResult.authenticated) {
      return Response.json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      }, { status: 401 })
    }

    try {
      const { name, expiresInDays } = await request.json()

      const apiKey = generateToken()
      const keyData = {
        key: apiKey,
        name: name || 'API Key',
        userId: authResult.user.$id,
        createdAt: Date.now(),
        expiresAt: expiresInDays ? Date.now() + expiresInDays * 86400 * 1000 : null,
        revoked: false
      }

      await this.storage.put('apikey:' + apiKey, keyData)

      // Add to user's API key index
      const userApiKeys = await this.storage.get('user-apikeys:' + authResult.user.$id) || []
      userApiKeys.push(apiKey)
      await this.storage.put('user-apikeys:' + authResult.user.$id, userApiKeys)

      return Response.json({
        success: true,
        apiKey,
        name: keyData.name,
        expiresAt: keyData.expiresAt
      }, { status: 201 })
    } catch (error) {
      return Response.json({
        success: false,
        error: 'Failed to create API key',
        code: 'API_KEY_CREATE_ERROR'
      }, { status: 500 })
    }
  }

  async handleRevokeApiKey(request) {
    const authResult = await this.authenticateRequest(request)
    if (!authResult.authenticated) {
      return Response.json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      }, { status: 401 })
    }

    try {
      const { apiKey } = await request.json()

      const keyData = await this.storage.get('apikey:' + apiKey)
      if (!keyData) {
        return Response.json({
          success: false,
          error: 'API key not found',
          code: 'API_KEY_NOT_FOUND'
        }, { status: 404 })
      }

      // Only owner or admin can revoke
      if (keyData.userId !== authResult.user.$id && authResult.user.role !== 'admin') {
        return Response.json({
          success: false,
          error: 'Not authorized to revoke this key',
          code: 'FORBIDDEN'
        }, { status: 403 })
      }

      keyData.revoked = true
      keyData.revokedAt = Date.now()
      await this.storage.put('apikey:' + apiKey, keyData)

      return Response.json({
        success: true,
        message: 'API key revoked'
      })
    } catch (error) {
      return Response.json({
        success: false,
        error: 'Failed to revoke API key',
        code: 'API_KEY_REVOKE_ERROR'
      }, { status: 500 })
    }
  }

  async handleListSessions(request) {
    const authResult = await this.authenticateRequest(request)
    if (!authResult.authenticated) {
      return Response.json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      }, { status: 401 })
    }

    const sessionIds = await this.storage.get('user-sessions:' + authResult.user.$id) || []
    const sessions = []

    for (const id of sessionIds) {
      const session = await this.storage.get('session:' + id)
      if (session) {
        sessions.push({
          id: session.id,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt
        })
      }
    }

    return Response.json({ sessions })
  }

  async handleGetProfile(request) {
    return Response.json({
      user: {
        $id: request.user.$id,
        email: request.user.email,
        name: request.user.name,
        role: request.user.role
      }
    })
  }

  async handleAdminListUsers(request) {
    const userIndex = await this.storage.get('user-index') || {}
    const users = []

    for (const userId of Object.values(userIndex)) {
      const user = await this.storage.get('user:' + userId)
      if (user) {
        users.push({
          $id: user.$id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt
        })
      }
    }

    return Response.json({ users })
  }

  async handleRPC(request) {
    try {
      const { method, args } = await request.json()
      const fn = this[method]

      if (typeof fn !== 'function') {
        return Response.json({ error: 'Method not found: ' + method }, { status: 404 })
      }

      const result = await fn.apply(this, args || [])
      return Response.json(result)
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
  }

  // RPC methods
  async getUserCount() {
    const userIndex = await this.storage.get('user-index') || {}
    return Object.keys(userIndex).length
  }
}

// ============================================================================
// WORKER
// ============================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    let namespace = 'default'

    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader) {
      namespace = tenantHeader
    }

    const id = env.AUTH_DO.idFromName(namespace)
    const stub = env.AUTH_DO.get(id)

    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

function createAuthClient(mf: Miniflare, tenantId: string = 'default') {
  return {
    async request<T = unknown>(path: string, options: RequestInit & { token?: string; apiKey?: string } = {}): Promise<{ status: number; data: T; headers: Headers }> {
      const headers = new Headers(options.headers)
      headers.set('Content-Type', 'application/json')
      headers.set('X-Tenant-ID', tenantId)

      if (options.token) {
        headers.set('Authorization', `Bearer ${options.token}`)
      }

      if (options.apiKey) {
        headers.set('X-API-Key', options.apiKey)
      }

      const response = await mf.dispatchFetch(`http://localhost${path}`, {
        ...options,
        headers,
      })

      const data = await response.json() as T
      return { status: response.status, data, headers: response.headers }
    },

    async register(email: string, password: string, options?: { name?: string; role?: string }) {
      return this.request<AuthResult>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, ...options }),
      })
    },

    async login(email: string, password: string) {
      return this.request<AuthResult>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
    },

    async apiKeyLogin(apiKey: string) {
      return this.request<AuthResult>('/auth/apikey', {
        method: 'POST',
        apiKey,
      })
    },

    async refresh(refreshToken: string) {
      return this.request<AuthResult>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      })
    },

    async logout(token: string) {
      return this.request<{ success: boolean; message?: string }>('/auth/logout', {
        method: 'POST',
        token,
      })
    },

    async validate(token: string) {
      return this.request<{ valid: boolean; error?: string; expired?: boolean; payload?: Record<string, unknown> }>('/auth/validate', {
        method: 'GET',
        token,
      })
    },

    async createApiKey(token: string, name?: string, expiresInDays?: number) {
      return this.request<{ success: boolean; apiKey?: string; name?: string }>('/auth/apikey/create', {
        method: 'POST',
        token,
        body: JSON.stringify({ name, expiresInDays }),
      })
    },

    async revokeApiKey(token: string, apiKey: string) {
      return this.request<{ success: boolean; message?: string }>('/auth/apikey/revoke', {
        method: 'POST',
        token,
        body: JSON.stringify({ apiKey }),
      })
    },

    async getSessions(token: string) {
      return this.request<{ sessions: Session[] }>('/auth/sessions', {
        method: 'GET',
        token,
      })
    },

    async getProfile(token: string) {
      return this.request<{ user: User }>('/user/profile', {
        method: 'GET',
        token,
      })
    },

    async getProtected(options: { token?: string; apiKey?: string }) {
      return this.request<{ message: string; user?: User }>('/protected', {
        method: 'GET',
        ...options,
      })
    },

    async adminListUsers(token: string) {
      return this.request<{ users: User[] }>('/admin/users', {
        method: 'GET',
        token,
      })
    },

    async health() {
      return this.request<{ status: string }>('/health')
    },
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('E2E Authentication Tests', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: AUTH_DO_SCRIPT,
      durableObjects: {
        AUTH_DO: 'AuthDO',
      },
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  // ==========================================================================
  // 1. USER REGISTRATION AND LOGIN
  // ==========================================================================

  describe('User Registration and Login', () => {
    it('should register a new user', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `register-${testId}`)

      const result = await client.register(
        `test-${testId}@example.com`,
        'securepassword123',
        { name: 'Test User' }
      )

      expect(result.status).toBe(201)
      expect(result.data.success).toBe(true)
      expect(result.data.user?.$id).toBeDefined()
      expect(result.data.user?.email).toBe(`test-${testId}@example.com`)
      expect(result.data.user?.name).toBe('Test User')
      expect(result.data.user?.role).toBe('user')
    })

    it('should reject duplicate email registration', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `duplicate-${testId}`)
      const email = `dup-${testId}@example.com`

      // First registration
      await client.register(email, 'password123')

      // Second registration with same email
      const result = await client.register(email, 'differentpassword')

      expect(result.status).toBe(409)
      expect(result.data.success).toBe(false)
      expect(result.data.code).toBe('USER_EXISTS')
    })

    it('should login with valid credentials', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `login-${testId}`)
      const email = `login-${testId}@example.com`

      await client.register(email, 'password123')
      const result = await client.login(email, 'password123')

      expect(result.status).toBe(200)
      expect(result.data.success).toBe(true)
      expect(result.data.tokens?.accessToken).toBeDefined()
      expect(result.data.tokens?.refreshToken).toBeDefined()
      expect(result.data.tokens?.expiresAt).toBeGreaterThan(Date.now())
      expect(result.data.user?.email).toBe(email)
    })

    it('should reject login with wrong password', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `wrongpass-${testId}`)
      const email = `wrongpass-${testId}@example.com`

      await client.register(email, 'correctpassword')
      const result = await client.login(email, 'wrongpassword')

      expect(result.status).toBe(401)
      expect(result.data.success).toBe(false)
      expect(result.data.code).toBe('INVALID_CREDENTIALS')
    })

    it('should reject login with non-existent email', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `nouser-${testId}`)

      const result = await client.login('nonexistent@example.com', 'password')

      expect(result.status).toBe(401)
      expect(result.data.success).toBe(false)
      expect(result.data.code).toBe('INVALID_CREDENTIALS')
    })
  })

  // ==========================================================================
  // 2. TOKEN VALIDATION AND PROTECTED RESOURCES
  // ==========================================================================

  describe('Token Validation and Protected Resources', () => {
    it('should validate a valid token', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `validate-${testId}`)
      const email = `validate-${testId}@example.com`

      await client.register(email, 'password123')
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      const result = await client.validate(token)

      expect(result.status).toBe(200)
      expect(result.data.valid).toBe(true)
      expect(result.data.payload?.email).toBe(email)
    })

    it('should access protected resource with valid token', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `protected-${testId}`)
      const email = `protected-${testId}@example.com`

      await client.register(email, 'password123')
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      const result = await client.getProtected({ token })

      expect(result.status).toBe(200)
      expect(result.data.message).toContain('Access granted')
      expect(result.data.user?.email).toBe(email)
    })

    it('should reject access to protected resource without token', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `notoken-${testId}`)

      const result = await client.getProtected({})

      expect(result.status).toBe(401)
      expect(result.data.code).toBe('AUTH_REQUIRED')
    })

    it('should reject access with invalid token', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `invalidtoken-${testId}`)

      const result = await client.getProtected({ token: 'invalid.token.here' })

      expect(result.status).toBe(401)
      expect(result.data.code).toBe('INVALID_TOKEN')
    })

    it('should get user profile with valid token', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `profile-${testId}`)
      const email = `profile-${testId}@example.com`

      await client.register(email, 'password123', { name: 'Profile User' })
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      const result = await client.getProfile(token)

      expect(result.status).toBe(200)
      expect(result.data.user.email).toBe(email)
      expect(result.data.user.name).toBe('Profile User')
    })
  })

  // ==========================================================================
  // 3. TOKEN REFRESH FLOW
  // ==========================================================================

  describe('Token Refresh Flow', () => {
    it('should refresh token with valid refresh token', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `refresh-${testId}`)
      const email = `refresh-${testId}@example.com`

      await client.register(email, 'password123')
      const loginResult = await client.login(email, 'password123')
      const refreshToken = loginResult.data.tokens!.refreshToken
      const originalAccessToken = loginResult.data.tokens!.accessToken

      const result = await client.refresh(refreshToken)

      expect(result.status).toBe(200)
      expect(result.data.success).toBe(true)
      expect(result.data.tokens?.accessToken).toBeDefined()
      expect(result.data.tokens?.accessToken).not.toBe(originalAccessToken)
      expect(result.data.tokens?.refreshToken).toBe(refreshToken)
    })

    it('should reject refresh with invalid refresh token', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `badrefresh-${testId}`)

      const result = await client.refresh('invalid.refresh.token')

      expect(result.status).toBe(401)
      expect(result.data.success).toBe(false)
    })

    it('should use new access token after refresh', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `userefresh-${testId}`)
      const email = `userefresh-${testId}@example.com`

      await client.register(email, 'password123')
      const loginResult = await client.login(email, 'password123')
      const refreshToken = loginResult.data.tokens!.refreshToken

      // Refresh to get new token
      const refreshResult = await client.refresh(refreshToken)
      const newToken = refreshResult.data.tokens!.accessToken

      // Use new token to access protected resource
      const protectedResult = await client.getProtected({ token: newToken })

      expect(protectedResult.status).toBe(200)
      expect(protectedResult.data.user?.email).toBe(email)
    })
  })

  // ==========================================================================
  // 4. LOGOUT AND SESSION INVALIDATION
  // ==========================================================================

  describe('Logout and Session Invalidation', () => {
    it('should logout successfully', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `logout-${testId}`)
      const email = `logout-${testId}@example.com`

      await client.register(email, 'password123')
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      const result = await client.logout(token)

      expect(result.status).toBe(200)
      expect(result.data.success).toBe(true)
    })

    it('should invalidate token after logout', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `invalidate-${testId}`)
      const email = `invalidate-${testId}@example.com`

      await client.register(email, 'password123')
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      // Logout
      await client.logout(token)

      // Try to access protected resource
      const result = await client.getProtected({ token })

      expect(result.status).toBe(401)
      expect(result.data.code).toBe('SESSION_INVALID')
    })

    it('should track active sessions', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `sessions-${testId}`)
      const email = `sessions-${testId}@example.com`

      await client.register(email, 'password123')

      // Login twice to create two sessions
      const login1 = await client.login(email, 'password123')
      const login2 = await client.login(email, 'password123')

      const token = login2.data.tokens!.accessToken
      const result = await client.getSessions(token)

      expect(result.status).toBe(200)
      expect(result.data.sessions.length).toBe(2)
    })
  })

  // ==========================================================================
  // 5. API KEY AUTHENTICATION
  // ==========================================================================

  describe('API Key Authentication', () => {
    it('should create API key for authenticated user', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `apikey-${testId}`)
      const email = `apikey-${testId}@example.com`

      await client.register(email, 'password123')
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      const result = await client.createApiKey(token, 'Test API Key')

      expect(result.status).toBe(201)
      expect(result.data.success).toBe(true)
      expect(result.data.apiKey).toBeDefined()
      expect(result.data.name).toBe('Test API Key')
    })

    it('should access protected resource with API key', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `apikey-access-${testId}`)
      const email = `apikey-access-${testId}@example.com`

      await client.register(email, 'password123')
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      // Create API key
      const keyResult = await client.createApiKey(token, 'Access Key')
      const apiKey = keyResult.data.apiKey!

      // Access protected resource with API key
      const result = await client.getProtected({ apiKey })

      expect(result.status).toBe(200)
      expect(result.data.message).toContain('Access granted')
    })

    it('should revoke API key', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `apikey-revoke-${testId}`)
      const email = `apikey-revoke-${testId}@example.com`

      await client.register(email, 'password123')
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      // Create API key
      const keyResult = await client.createApiKey(token, 'Revoke Key')
      const apiKey = keyResult.data.apiKey!

      // Revoke API key
      const revokeResult = await client.revokeApiKey(token, apiKey)
      expect(revokeResult.status).toBe(200)
      expect(revokeResult.data.success).toBe(true)

      // Try to access with revoked key
      const accessResult = await client.getProtected({ apiKey })
      expect(accessResult.status).toBe(401)
      expect(accessResult.data.code).toBe('API_KEY_REVOKED')
    })

    it('should reject invalid API key', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `apikey-invalid-${testId}`)

      const result = await client.getProtected({ apiKey: 'invalid-key' })

      expect(result.status).toBe(401)
      expect(result.data.code).toBe('INVALID_API_KEY')
    })

    it('should login with API key and get user info', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `apikey-login-${testId}`)
      const email = `apikey-login-${testId}@example.com`

      await client.register(email, 'password123', { name: 'API User' })
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      const keyResult = await client.createApiKey(token, 'Login Key')
      const apiKey = keyResult.data.apiKey!

      const result = await client.apiKeyLogin(apiKey)

      expect(result.status).toBe(200)
      expect(result.data.success).toBe(true)
      expect(result.data.user?.email).toBe(email)
      expect(result.data.keyName).toBe('Login Key')
    })
  })

  // ==========================================================================
  // 6. ROLE-BASED ACCESS CONTROL
  // ==========================================================================

  describe('Role-Based Access Control', () => {
    it('should allow admin to access admin endpoints', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `admin-${testId}`)
      const email = `admin-${testId}@example.com`

      await client.register(email, 'password123', { role: 'admin' })
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      const result = await client.adminListUsers(token)

      expect(result.status).toBe(200)
      expect(result.data.users).toBeDefined()
    })

    it('should deny regular user access to admin endpoints', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `noadmin-${testId}`)
      const email = `noadmin-${testId}@example.com`

      await client.register(email, 'password123', { role: 'user' })
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      const result = await client.adminListUsers(token)

      expect(result.status).toBe(403)
      expect(result.data.code).toBe('INSUFFICIENT_PERMISSIONS')
    })
  })

  // ==========================================================================
  // 7. MULTI-TENANT ISOLATION
  // ==========================================================================

  describe('Multi-Tenant Auth Isolation', () => {
    it('should isolate users between tenants', async () => {
      const testId = Date.now().toString(36)
      const tenantA = createAuthClient(mf, `tenant-a-${testId}`)
      const tenantB = createAuthClient(mf, `tenant-b-${testId}`)
      const email = `shared-${testId}@example.com`

      // Register same email in both tenants
      const regA = await tenantA.register(email, 'passwordA')
      const regB = await tenantB.register(email, 'passwordB')

      expect(regA.status).toBe(201)
      expect(regB.status).toBe(201)

      // Login should use tenant-specific credentials
      const loginA = await tenantA.login(email, 'passwordA')
      const loginB = await tenantB.login(email, 'passwordB')

      expect(loginA.status).toBe(200)
      expect(loginB.status).toBe(200)

      // Different user IDs
      expect(loginA.data.user?.$id).not.toBe(loginB.data.user?.$id)
    })

    it('should not allow cross-tenant token usage', async () => {
      const testId = Date.now().toString(36)
      const tenantA = createAuthClient(mf, `cross-a-${testId}`)
      const tenantB = createAuthClient(mf, `cross-b-${testId}`)

      // Register and login in tenant A
      await tenantA.register(`user-${testId}@example.com`, 'password123')
      const loginA = await tenantA.login(`user-${testId}@example.com`, 'password123')
      const tokenA = loginA.data.tokens!.accessToken

      // Try to use token A in tenant B
      const result = await tenantB.getProtected({ token: tokenA })

      // Should fail because session doesn't exist in tenant B
      expect(result.status).toBe(401)
    })
  })

  // ==========================================================================
  // 8. CONCURRENT AUTHENTICATION
  // ==========================================================================

  describe('Concurrent Authentication', () => {
    it('should handle multiple simultaneous logins', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `concurrent-${testId}`)
      const email = `concurrent-${testId}@example.com`

      await client.register(email, 'password123')

      // Multiple concurrent logins
      const loginPromises = Array.from({ length: 5 }, () =>
        client.login(email, 'password123')
      )

      const results = await Promise.all(loginPromises)

      // All should succeed
      expect(results.every(r => r.status === 200)).toBe(true)
      expect(results.every(r => r.data.success)).toBe(true)

      // All should have unique access tokens
      const tokens = results.map(r => r.data.tokens?.accessToken)
      const uniqueTokens = new Set(tokens)
      expect(uniqueTokens.size).toBe(5)
    })

    it('should handle concurrent token validations', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `validate-concurrent-${testId}`)
      const email = `validate-concurrent-${testId}@example.com`

      await client.register(email, 'password123')
      const loginResult = await client.login(email, 'password123')
      const token = loginResult.data.tokens!.accessToken

      // Multiple concurrent validations
      const validatePromises = Array.from({ length: 10 }, () =>
        client.validate(token)
      )

      const results = await Promise.all(validatePromises)

      // All should succeed
      expect(results.every(r => r.status === 200)).toBe(true)
      expect(results.every(r => r.data.valid)).toBe(true)
    })
  })

  // ==========================================================================
  // 9. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle malformed login request', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `malformed-${testId}`)

      const result = await client.login('', '')

      expect(result.status).toBe(400)
      expect(result.data.code).toBe('INVALID_REQUEST')
    })

    it('should handle missing refresh token', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `missing-refresh-${testId}`)

      const result = await client.request<AuthResult>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      expect(result.status).toBe(400)
      expect(result.data.code).toBe('REFRESH_TOKEN_REQUIRED')
    })

    it('should handle API key creation without auth', async () => {
      const testId = Date.now().toString(36)
      const client = createAuthClient(mf, `noauth-apikey-${testId}`)

      const result = await client.createApiKey('', 'Test Key')

      expect(result.status).toBe(401)
      expect(result.data.code).toBe('AUTH_REQUIRED')
    })
  })
})
