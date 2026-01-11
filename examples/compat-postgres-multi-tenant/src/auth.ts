/**
 * Authentication Module - Multi-Tenant Postgres Example
 *
 * JWT-based authentication with tenant-scoped access control.
 * Works with both @dotdo/postgres and @dotdo/supabase clients.
 *
 * Features:
 * - JWT token generation and validation
 * - Password hashing with bcrypt-compatible algorithm
 * - Session management
 * - Row-level security (RLS) patterns (optional - physical isolation preferred)
 * - Refresh token rotation
 */

import type { Context } from 'hono'

// ============================================================================
// TYPES
// ============================================================================

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'member' | 'viewer'
  tenant_id: string
  password_hash?: string
  created_at: string
  updated_at: string
}

export interface Session {
  id: string
  user_id: string
  tenant_id: string
  access_token: string
  refresh_token: string
  expires_at: number
  created_at: string
}

export interface AuthResult {
  user: User | null
  session: Session | null
  error: AuthError | null
}

export interface AuthError {
  message: string
  code: 'invalid_credentials' | 'expired_token' | 'invalid_token' | 'unauthorized' | 'user_not_found'
}

export interface JWTPayload {
  sub: string // user_id
  tenant: string // tenant_id
  role: string
  exp: number
  iat: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const JWT_SECRET_DEFAULT = 'dotdo-multi-tenant-secret-change-in-production'
const ACCESS_TOKEN_EXPIRY = 60 * 60 * 1000 // 1 hour
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000 // 7 days

// ============================================================================
// PASSWORD HASHING (Simple PBKDF2-based implementation for Workers)
// ============================================================================

/**
 * Hash a password using PBKDF2 (Web Crypto API compatible)
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))

  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    key,
    256
  )

  const hashArray = new Uint8Array(derivedBits)
  const combined = new Uint8Array(salt.length + hashArray.length)
  combined.set(salt)
  combined.set(hashArray, salt.length)

  return btoa(String.fromCharCode(...combined))
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const combined = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
    const salt = combined.slice(0, 16)
    const storedHash = combined.slice(16)

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      key,
      256
    )

    const newHash = new Uint8Array(derivedBits)

    // Timing-safe comparison
    if (storedHash.length !== newHash.length) return false
    let diff = 0
    for (let i = 0; i < storedHash.length; i++) {
      diff |= storedHash[i] ^ newHash[i]
    }
    return diff === 0
  } catch {
    return false
  }
}

// ============================================================================
// JWT HANDLING (Simple implementation for Workers)
// ============================================================================

/**
 * Generate a JWT token
 */
export async function generateJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, expiresIn: number = ACCESS_TOKEN_EXPIRY, secret: string = JWT_SECRET_DEFAULT): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Date.now()

  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  }

  const encoder = new TextEncoder()
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const payloadB64 = btoa(JSON.stringify(fullPayload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const data = `${headerB64}.${payloadB64}`

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${data}.${signatureB64}`
}

/**
 * Verify and decode a JWT token
 */
export async function verifyJWT(token: string, secret: string = JWT_SECRET_DEFAULT): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts

    // Verify signature
    const encoder = new TextEncoder()
    const data = `${headerB64}.${payloadB64}`

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    // Decode signature
    const signaturePadded = signatureB64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (signatureB64.length % 4)) % 4)
    const signature = Uint8Array.from(atob(signaturePadded), (c) => c.charCodeAt(0))

    const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data))
    if (!valid) return null

    // Decode payload
    const payloadPadded = payloadB64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (payloadB64.length % 4)) % 4)
    const payload = JSON.parse(atob(payloadPadded)) as JWTPayload

    // Check expiry
    if (payload.exp < Date.now()) return null

    return payload
  } catch {
    return null
  }
}

// ============================================================================
// AUTH SERVICE
// ============================================================================

/**
 * Authentication service for multi-tenant applications
 *
 * Usage:
 * ```typescript
 * const auth = new AuthService(ctx.storage, tenantId)
 *
 * // Sign up
 * const { user, session, error } = await auth.signUp({
 *   email: 'user@example.com',
 *   password: 'secure123',
 *   name: 'John Doe'
 * })
 *
 * // Sign in
 * const { user, session, error } = await auth.signIn({
 *   email: 'user@example.com',
 *   password: 'secure123'
 * })
 *
 * // Verify token
 * const payload = await auth.verifyToken(token)
 * ```
 */
export class AuthService {
  private storage: DurableObjectStorage
  private tenantId: string
  private jwtSecret: string

  constructor(storage: DurableObjectStorage, tenantId: string, jwtSecret: string = JWT_SECRET_DEFAULT) {
    this.storage = storage
    this.tenantId = tenantId
    this.jwtSecret = jwtSecret
  }

  /**
   * Sign up a new user
   */
  async signUp(credentials: { email: string; password: string; name: string }): Promise<AuthResult> {
    const { email, password, name } = credentials

    // Check if email already exists
    const users = ((await this.storage.get('table:users')) as User[] | undefined) ?? []
    const existingUser = users.find((u) => u.email === email)

    if (existingUser) {
      return {
        user: null,
        session: null,
        error: { message: 'Email already registered', code: 'invalid_credentials' },
      }
    }

    // Create user
    const passwordHash = await hashPassword(password)
    const now = new Date().toISOString()

    const user: User = {
      id: crypto.randomUUID(),
      email,
      name,
      role: users.length === 0 ? 'admin' : 'member', // First user is admin
      tenant_id: this.tenantId,
      password_hash: passwordHash,
      created_at: now,
      updated_at: now,
    }

    users.push(user)
    await this.storage.put('table:users', users)

    // Create session
    const session = await this.createSession(user)

    // Don't return password hash
    const { password_hash: _, ...safeUser } = user

    return { user: safeUser as User, session, error: null }
  }

  /**
   * Sign in with email and password
   */
  async signIn(credentials: { email: string; password: string }): Promise<AuthResult> {
    const { email, password } = credentials

    // Find user
    const users = ((await this.storage.get('table:users')) as User[] | undefined) ?? []
    const user = users.find((u) => u.email === email)

    if (!user || !user.password_hash) {
      return {
        user: null,
        session: null,
        error: { message: 'Invalid email or password', code: 'invalid_credentials' },
      }
    }

    // Verify password
    const valid = await verifyPassword(password, user.password_hash)
    if (!valid) {
      return {
        user: null,
        session: null,
        error: { message: 'Invalid email or password', code: 'invalid_credentials' },
      }
    }

    // Create session
    const session = await this.createSession(user)

    // Don't return password hash
    const { password_hash: _, ...safeUser } = user

    return { user: safeUser as User, session, error: null }
  }

  /**
   * Sign out (invalidate session)
   */
  async signOut(sessionId: string): Promise<void> {
    const sessions = ((await this.storage.get('table:sessions')) as Session[] | undefined) ?? []
    const filtered = sessions.filter((s) => s.id !== sessionId)
    await this.storage.put('table:sessions', filtered)
  }

  /**
   * Verify access token and return user
   */
  async verifyToken(token: string): Promise<AuthResult> {
    const payload = await verifyJWT(token, this.jwtSecret)

    if (!payload) {
      return {
        user: null,
        session: null,
        error: { message: 'Invalid or expired token', code: 'invalid_token' },
      }
    }

    // Check tenant
    if (payload.tenant !== this.tenantId) {
      return {
        user: null,
        session: null,
        error: { message: 'Token not valid for this tenant', code: 'unauthorized' },
      }
    }

    // Get user
    const users = ((await this.storage.get('table:users')) as User[] | undefined) ?? []
    const user = users.find((u) => u.id === payload.sub)

    if (!user) {
      return {
        user: null,
        session: null,
        error: { message: 'User not found', code: 'user_not_found' },
      }
    }

    // Don't return password hash
    const { password_hash: _, ...safeUser } = user

    return { user: safeUser as User, session: null, error: null }
  }

  /**
   * Refresh session with refresh token
   */
  async refreshSession(refreshToken: string): Promise<AuthResult> {
    const sessions = ((await this.storage.get('table:sessions')) as Session[] | undefined) ?? []
    const session = sessions.find((s) => s.refresh_token === refreshToken)

    if (!session || session.expires_at < Date.now()) {
      return {
        user: null,
        session: null,
        error: { message: 'Invalid or expired refresh token', code: 'expired_token' },
      }
    }

    // Get user
    const users = ((await this.storage.get('table:users')) as User[] | undefined) ?? []
    const user = users.find((u) => u.id === session.user_id)

    if (!user) {
      return {
        user: null,
        session: null,
        error: { message: 'User not found', code: 'user_not_found' },
      }
    }

    // Rotate refresh token (create new session, delete old)
    const filtered = sessions.filter((s) => s.id !== session.id)
    await this.storage.put('table:sessions', filtered)

    const newSession = await this.createSession(user)

    // Don't return password hash
    const { password_hash: _, ...safeUser } = user

    return { user: safeUser as User, session: newSession, error: null }
  }

  /**
   * Get current user from context (middleware helper)
   */
  async getUserFromContext(c: Context): Promise<User | null> {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return null

    const token = authHeader.slice(7)
    const { user } = await this.verifyToken(token)
    return user
  }

  /**
   * Create a new session for a user
   */
  private async createSession(user: User): Promise<Session> {
    const accessToken = await generateJWT(
      { sub: user.id, tenant: this.tenantId, role: user.role },
      ACCESS_TOKEN_EXPIRY,
      this.jwtSecret
    )

    const refreshToken = crypto.randomUUID()
    const now = new Date().toISOString()

    const session: Session = {
      id: crypto.randomUUID(),
      user_id: user.id,
      tenant_id: this.tenantId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Date.now() + REFRESH_TOKEN_EXPIRY,
      created_at: now,
    }

    const sessions = ((await this.storage.get('table:sessions')) as Session[] | undefined) ?? []
    sessions.push(session)
    await this.storage.put('table:sessions', sessions)

    return session
  }
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Authentication middleware for Hono
 *
 * Usage:
 * ```typescript
 * app.use('/api/*', authMiddleware)
 * ```
 */
export function createAuthMiddleware(getStorage: (tenantId: string) => DurableObjectStorage | Promise<DurableObjectStorage>) {
  return async (c: Context, next: () => Promise<void>) => {
    const authHeader = c.req.header('Authorization')

    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401)
    }

    const token = authHeader.slice(7)
    const payload = await verifyJWT(token)

    if (!payload) {
      return c.json({ error: 'Invalid or expired token' }, 401)
    }

    // Store user info in context
    c.set('userId', payload.sub)
    c.set('tenantId', payload.tenant)
    c.set('userRole', payload.role)

    await next()
  }
}

/**
 * Role-based access control middleware
 *
 * Usage:
 * ```typescript
 * app.post('/admin/*', requireRole('admin'))
 * ```
 */
export function requireRole(...roles: string[]) {
  return async (c: Context, next: () => Promise<void>) => {
    const userRole = c.get('userRole')

    if (!userRole || !roles.includes(userRole)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    await next()
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  AuthService,
  hashPassword,
  verifyPassword,
  generateJWT,
  verifyJWT,
  createAuthMiddleware,
  requireRole,
}
