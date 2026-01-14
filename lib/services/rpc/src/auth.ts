/**
 * RPC.do Gateway Authentication
 *
 * Authentication middleware for the unified gateway, supporting:
 * - JWT tokens from id.org.ai
 * - API keys
 * - Session cookies
 *
 * @module services/rpc/auth
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import type { AuthContext, ApiKeyConfig, AuthConfig } from './types'
import * as jose from 'jose'

// ============================================================================
// Types
// ============================================================================

/**
 * JWT payload from id.org.ai
 */
interface JWTPayload {
  /** Subject (user ID) */
  sub: string
  /** Email */
  email?: string
  /** Organization ID */
  org?: string
  /** Tenant ID */
  tenant?: string
  /** Role */
  role?: 'admin' | 'user' | 'agent'
  /** Permissions/scopes */
  permissions?: string[]
  /** Agent ID (if token is for an agent) */
  agent_id?: string
  /** Issued at */
  iat?: number
  /** Expiration */
  exp?: number
}

/**
 * Authentication result
 */
interface AuthResult {
  success: boolean
  context?: AuthContext
  error?: {
    code: string
    message: string
  }
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: AuthConfig = {
  publicPaths: ['/health', '/ready', '/.well-known'],
  sessionCookieName: 'session',
}

// ============================================================================
// JWT Verification
// ============================================================================

let jwks: jose.JWTVerifyGetKey | null = null

/**
 * Verify a JWT token
 */
async function verifyJWT(token: string, config: AuthConfig): Promise<JWTPayload> {
  try {
    // Try JWKS first (id.org.ai)
    if (config.jwksUrl) {
      if (!jwks) {
        jwks = jose.createRemoteJWKSet(new URL(config.jwksUrl))
      }
      const { payload } = await jose.jwtVerify(token, jwks)
      return payload as JWTPayload
    }

    // Fall back to symmetric secret (for testing)
    if (config.jwtSecret) {
      const secret = new TextEncoder().encode(config.jwtSecret)
      const { payload } = await jose.jwtVerify(token, secret)
      return payload as JWTPayload
    }

    throw new Error('No JWT verification method configured')
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new AuthError('Token expired', 'TOKEN_EXPIRED')
    }
    if (error instanceof jose.errors.JWTInvalid) {
      throw new AuthError('Invalid token', 'INVALID_TOKEN')
    }
    throw new AuthError('Token verification failed', 'VERIFICATION_FAILED')
  }
}

// ============================================================================
// Token Extraction
// ============================================================================

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null
  return parts[1]
}

/**
 * Extract API key from header
 */
function extractApiKey(c: Context): string | null {
  return c.req.header('x-api-key') || c.req.header('authorization')?.replace('Api-Key ', '') || null
}

/**
 * Extract session cookie
 */
function extractSessionCookie(c: Context, cookieName: string): string | null {
  const cookie = c.req.header('cookie')
  if (!cookie) return null

  const cookies = cookie.split(';').reduce(
    (acc, curr) => {
      const [key, value] = curr.trim().split('=')
      acc[key] = value
      return acc
    },
    {} as Record<string, string>
  )

  return cookies[cookieName] || null
}

// ============================================================================
// API Key Validation
// ============================================================================

/**
 * API key store interface
 */
export interface ApiKeyStore {
  get(key: string): Promise<ApiKeyConfig | null>
  validate(key: string): Promise<ApiKeyConfig | null>
}

/**
 * In-memory API key store for development
 */
export class InMemoryApiKeyStore implements ApiKeyStore {
  private keys = new Map<string, ApiKeyConfig>()

  /**
   * Register an API key
   */
  register(key: string, config: ApiKeyConfig): void {
    this.keys.set(key, config)
  }

  /**
   * Get API key config
   */
  async get(key: string): Promise<ApiKeyConfig | null> {
    return this.keys.get(key) || null
  }

  /**
   * Validate API key
   */
  async validate(key: string): Promise<ApiKeyConfig | null> {
    const config = this.keys.get(key)
    if (!config) return null

    // Check if key is active
    if (!config.active) return null

    // Check expiration
    if (config.expiresAt && config.expiresAt < new Date()) return null

    // Update last used timestamp
    config.lastUsedAt = new Date()

    return config
  }
}

/**
 * KV-backed API key store for production
 */
export class KVApiKeyStore implements ApiKeyStore {
  constructor(private kv: KVNamespace) {}

  /**
   * Get API key config
   */
  async get(key: string): Promise<ApiKeyConfig | null> {
    const data = await this.kv.get(`api-key:${key}`, 'json')
    return data as ApiKeyConfig | null
  }

  /**
   * Validate API key
   */
  async validate(key: string): Promise<ApiKeyConfig | null> {
    const config = await this.get(key)
    if (!config) return null

    // Check if key is active
    if (!config.active) return null

    // Check expiration
    if (config.expiresAt && new Date(config.expiresAt) < new Date()) return null

    return config
  }
}

// ============================================================================
// Authentication Methods
// ============================================================================

/**
 * Authenticate via JWT
 */
async function authenticateJWT(token: string, config: AuthConfig): Promise<AuthContext> {
  const payload = await verifyJWT(token, config)

  return {
    userId: payload.sub,
    orgId: payload.org,
    tenantId: payload.tenant || payload.sub, // Fall back to user ID as tenant
    agentId: payload.agent_id,
    method: 'jwt',
    role: payload.role || 'user',
    permissions: payload.permissions || [],
    expiresAt: payload.exp ? new Date(payload.exp * 1000) : undefined,
  }
}

/**
 * Authenticate via API key
 */
async function authenticateApiKey(
  apiKey: string,
  store: ApiKeyStore
): Promise<AuthContext> {
  const config = await store.validate(apiKey)
  if (!config) {
    throw new AuthError('Invalid API key', 'INVALID_API_KEY')
  }

  return {
    userId: config.userId,
    tenantId: config.tenantId,
    method: 'api_key',
    role: 'user', // API keys are always user-level
    permissions: config.permissions,
    expiresAt: config.expiresAt,
  }
}

/**
 * Authenticate via session cookie
 */
async function authenticateSession(
  sessionToken: string,
  validateSession: SessionValidator
): Promise<AuthContext> {
  const session = await validateSession(sessionToken)
  if (!session) {
    throw new AuthError('Invalid session', 'INVALID_SESSION')
  }

  return {
    userId: session.userId,
    orgId: session.orgId,
    tenantId: session.tenantId || session.userId,
    method: 'session',
    role: session.role || 'user',
    permissions: session.permissions || [],
    expiresAt: session.expiresAt,
  }
}

/**
 * Session validator function type
 */
export type SessionValidator = (token: string) => Promise<{
  userId: string
  orgId?: string
  tenantId?: string
  role?: 'admin' | 'user' | 'agent'
  permissions?: string[]
  expiresAt?: Date
} | null>

// ============================================================================
// Middleware
// ============================================================================

/**
 * Gateway authentication middleware options
 */
export interface GatewayAuthOptions {
  /** Authentication configuration */
  config?: Partial<AuthConfig>
  /** API key store */
  apiKeyStore?: ApiKeyStore
  /** Session validator */
  sessionValidator?: SessionValidator
  /** Whether authentication is required (default: true) */
  required?: boolean
}

/**
 * Create gateway authentication middleware
 *
 * Supports multiple authentication methods in order:
 * 1. JWT Bearer token
 * 2. API key (X-API-Key header)
 * 3. Session cookie
 */
export function gatewayAuth(options: GatewayAuthOptions = {}): MiddlewareHandler {
  const config = { ...DEFAULT_CONFIG, ...options.config }
  const apiKeyStore = options.apiKeyStore ?? new InMemoryApiKeyStore()
  const required = options.required ?? true

  return async (c: Context, next: Next) => {
    const path = c.req.path

    // Skip auth for public paths
    if (config.publicPaths?.some((p) => path.startsWith(p))) {
      return next()
    }

    let authContext: AuthContext | null = null
    let authError: { code: string; message: string } | null = null

    // Try JWT Bearer token first
    const bearerToken = extractBearerToken(c.req.header('authorization'))
    if (bearerToken) {
      try {
        authContext = await authenticateJWT(bearerToken, config)
      } catch (error) {
        if (error instanceof AuthError) {
          authError = { code: error.code, message: error.message }
        }
      }
    }

    // Try API key if no JWT
    if (!authContext) {
      const apiKey = extractApiKey(c)
      if (apiKey) {
        try {
          authContext = await authenticateApiKey(apiKey, apiKeyStore)
        } catch (error) {
          if (error instanceof AuthError) {
            authError = { code: error.code, message: error.message }
          }
        }
      }
    }

    // Try session cookie if no API key
    if (!authContext && options.sessionValidator) {
      const sessionToken = extractSessionCookie(c, config.sessionCookieName!)
      if (sessionToken) {
        try {
          authContext = await authenticateSession(sessionToken, options.sessionValidator)
        } catch (error) {
          if (error instanceof AuthError) {
            authError = { code: error.code, message: error.message }
          }
        }
      }
    }

    // Check if authentication is required
    if (required && !authContext) {
      return c.json(
        {
          error: authError || { code: 'UNAUTHORIZED', message: 'Authentication required' },
        },
        401
      )
    }

    // Set auth context for downstream handlers
    if (authContext) {
      c.set('auth', authContext)
      c.set('tenantId', authContext.tenantId)
      c.set('userId', authContext.userId)
    }

    return next()
  }
}

/**
 * Require authentication middleware
 *
 * Use after gatewayAuth to ensure authentication is present
 */
export function requireAuth(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        401
      )
    }
    return next()
  }
}

/**
 * Require specific role middleware
 */
export function requireRole(role: 'admin' | 'user' | 'agent'): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        401
      )
    }

    // Admin can access everything
    if (auth.role === 'admin') {
      return next()
    }

    // Check role
    if (auth.role !== role) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: `Role '${role}' required` } },
        403
      )
    }

    return next()
  }
}

/**
 * Require specific permission middleware
 */
export function requirePermission(permission: string): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        401
      )
    }

    // Admin has all permissions
    if (auth.role === 'admin') {
      return next()
    }

    // Check permission
    if (!auth.permissions.includes(permission)) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: `Permission '${permission}' required` } },
        403
      )
    }

    return next()
  }
}

/**
 * Require tenant access middleware
 *
 * Ensures the authenticated user has access to the requested tenant
 */
export function requireTenantAccess(tenantIdParam: string = 'tenantId'): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        401
      )
    }

    // Get tenant ID from path or query
    const requestedTenant = c.req.param(tenantIdParam) || c.req.query(tenantIdParam)
    if (!requestedTenant) {
      return next() // No tenant specified, proceed
    }

    // Admin can access any tenant
    if (auth.role === 'admin') {
      return next()
    }

    // Check if user's tenant matches
    if (auth.tenantId !== requestedTenant) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Access to this tenant is denied' } },
        403
      )
    }

    return next()
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Authentication error
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a test JWT token (for development)
 */
export async function generateTestToken(
  payload: Partial<JWTPayload>,
  secret: string,
  expiresIn: string = '1h'
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)

  const jwt = await new jose.SignJWT({
    ...payload,
    sub: payload.sub || 'test-user',
  } as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey)

  return jwt
}

/**
 * Hash an API key for storage
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a new API key
 */
export function generateApiKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return 'sk_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
