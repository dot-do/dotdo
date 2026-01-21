// Authentication Patterns Durable Object
// Demonstrates: JWT auth, sessions, API keys, password hashing, 2FA, OAuth
// Key patterns: Middleware-based auth, secure token generation, rate limiting

import { Hono } from 'hono'
import { DO, type DOEnv, createContext, type WorkflowContext } from '../../do'
import type {
  User,
  Session,
  ApiKey,
  PasswordReset,
  OAuthConnection,
  SecurityEvent,
  RegisterRequest,
  LoginRequest,
  LoginResponse,
  ChangePasswordRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  JWTPayload,
} from './types'

// Constants
const ACCESS_TOKEN_EXPIRY = 15 * 60 // 15 minutes in seconds
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 // 7 days in seconds
const PASSWORD_RESET_EXPIRY = 60 * 60 // 1 hour
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutes

// In production, use proper crypto libraries
// These are simplified implementations for demonstration

function generateId(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, '0')).join('')

  const passwordWithSalt = encoder.encode(saltHex + password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', passwordWithSalt)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  return `${saltHex}:${hashHex}`
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [saltHex, storedHash] = hash.split(':')
  const encoder = new TextEncoder()

  const passwordWithSalt = encoder.encode(saltHex + password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', passwordWithSalt)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  return hashHex === storedHash
}

async function generateJWT(payload: JWTPayload, secret: string): Promise<string> {
  // Simplified JWT - in production use jose or similar library
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${header}.${body}`)
  )
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))

  return `${header}.${body}.${sigBase64}`
}

async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, body, signature] = parts

    // Verify signature
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0))
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      encoder.encode(`${header}.${body}`)
    )

    if (!valid) return null

    const payload = JSON.parse(atob(body)) as JWTPayload

    // Check expiration
    if (payload.exp < Date.now() / 1000) return null

    return payload
  } catch {
    return null
  }
}

interface AuthEnv extends DOEnv {
  JWT_SECRET?: string
}

export class AuthDO extends DO {
  protected declare override $: WorkflowContext
  private jwtSecret: string

  // In-memory rate limiting
  private loginAttempts: Map<string, { count: number; lastAttempt: number }> = new Map()

  constructor(state: DurableObjectState, env: AuthEnv) {
    super(state, env)

    this.$ = createContext(state, env)
    this.jwtSecret = env.JWT_SECRET || 'default-secret-change-in-production'

    // ========================================================================
    // Event Handlers
    // ========================================================================

    this.$.on.User.registered(async (event) => {
      const { userId, email } = (event as { type: string; payload: { userId: string; email: string } }).payload
      console.log(`[Event] User registered: ${email} (${userId})`)
    })

    this.$.on.User.loggedIn(async (event) => {
      const { userId, email } = (event as { type: string; payload: { userId: string; email: string } }).payload
      console.log(`[Event] User logged in: ${email} (${userId})`)
    })

    this.$.on.User.loggedOut(async (event) => {
      const { userId } = (event as { type: string; payload: { userId: string } }).payload
      console.log(`[Event] User logged out: ${userId}`)
    })

    this.$.on.Security.alert(async (event) => {
      const { type, details } = (event as { type: string; payload: { type: string; details: unknown } }).payload
      console.log(`[Security Alert] ${type}:`, details)
    })

    // ========================================================================
    // Scheduled Tasks
    // ========================================================================

    // Clean up expired sessions daily
    this.$.every.day.at3am(async () => {
      console.log('[Scheduled] Cleaning up expired sessions...')
      const sessions = await this.things.list({ type: 'Session' })
      const now = new Date().toISOString()

      for (const session of sessions) {
        if ((session as unknown as Session).expiresAt < now) {
          await this.things.delete(session.$id)
        }
      }
    })

    // Clean up expired password reset tokens hourly
    this.$.every.hour(async () => {
      console.log('[Scheduled] Cleaning up expired password reset tokens...')
      const resets = await this.things.list({ type: 'PasswordReset' })
      const now = new Date().toISOString()

      for (const reset of resets) {
        if ((reset as unknown as PasswordReset).expiresAt < now) {
          await this.things.delete(reset.$id)
        }
      }
    })
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Public Routes (No Auth Required)
    // ========================================================================

    // Register new user
    app.post('/auth/register', async (c) => {
      const body = await c.req.json<RegisterRequest>()

      // Validate input
      if (!body.email || !body.password || !body.name) {
        return c.json({ error: 'Email, password, and name are required' }, 400)
      }

      if (body.password.length < 8) {
        return c.json({ error: 'Password must be at least 8 characters' }, 400)
      }

      // Check if email already exists
      const existing = await this.things.list({ type: 'User' })
      if (existing.some((u) => (u as unknown as User).email === body.email.toLowerCase())) {
        return c.json({ error: 'Email already registered' }, 409)
      }

      // Hash password
      const passwordHash = await hashPassword(body.password)

      // Create user
      const user = await this.things.create({
        $type: 'User',
        email: body.email.toLowerCase(),
        passwordHash,
        name: body.name,
        role: 'user',
        emailVerified: false,
        twoFactorEnabled: false,
        createdAt: new Date().toISOString(),
      })

      // Log security event
      await this.logSecurityEvent('login', user.$id, c.req)

      // Fire event
      this.$.send({
        type: 'User.registered',
        payload: { userId: user.$id, email: user.email },
      })

      // Generate tokens
      const tokens = await this.createSession(user.$id, user.email, (user as unknown as User).role, c.req)

      return c.json({
        user: this.sanitizeUser(user as unknown as User & { $id: string }),
        ...tokens,
      }, 201)
    })

    // Login
    app.post('/auth/login', async (c) => {
      const body = await c.req.json<LoginRequest>()

      // Rate limiting check
      const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
      const attempts = this.loginAttempts.get(clientIp)

      if (attempts && attempts.count >= MAX_LOGIN_ATTEMPTS) {
        const timeSinceLastAttempt = Date.now() - attempts.lastAttempt
        if (timeSinceLastAttempt < LOGIN_LOCKOUT_DURATION) {
          return c.json({
            error: 'Too many login attempts. Please try again later.',
            retryAfter: Math.ceil((LOGIN_LOCKOUT_DURATION - timeSinceLastAttempt) / 1000),
          }, 429)
        } else {
          this.loginAttempts.delete(clientIp)
        }
      }

      // Find user
      const users = await this.things.list({ type: 'User' })
      const user = users.find(
        (u) => (u as unknown as User).email === body.email.toLowerCase()
      ) as (User & { $id: string }) | undefined

      if (!user) {
        this.recordLoginAttempt(clientIp)
        await this.logSecurityEvent('login_failed', undefined, c.req, { email: body.email })
        return c.json({ error: 'Invalid email or password' }, 401)
      }

      // Verify password
      const validPassword = await verifyPassword(body.password, user.passwordHash)
      if (!validPassword) {
        this.recordLoginAttempt(clientIp)
        await this.logSecurityEvent('login_failed', user.$id, c.req)
        return c.json({ error: 'Invalid email or password' }, 401)
      }

      // Check 2FA if enabled
      if (user.twoFactorEnabled) {
        if (!body.twoFactorCode) {
          return c.json({ error: '2FA code required', requires2FA: true }, 401)
        }

        // In production, verify TOTP code against user.twoFactorSecret
        // For demo, we'll accept any 6-digit code
        if (!/^\d{6}$/.test(body.twoFactorCode)) {
          return c.json({ error: 'Invalid 2FA code' }, 401)
        }
      }

      // Clear login attempts on success
      this.loginAttempts.delete(clientIp)

      // Update last login
      await this.things.update(user.$id, { lastLoginAt: new Date().toISOString() })

      // Log security event
      await this.logSecurityEvent('login', user.$id, c.req)

      // Fire event
      this.$.send({
        type: 'User.loggedIn',
        payload: { userId: user.$id, email: user.email },
      })

      // Create session and return tokens
      const tokens = await this.createSession(user.$id, user.email, user.role, c.req)

      return c.json({
        user: this.sanitizeUser(user),
        ...tokens,
      } as LoginResponse)
    })

    // Refresh token
    app.post('/auth/refresh', async (c) => {
      const body = await c.req.json<{ refreshToken: string }>()

      // Verify refresh token
      const payload = await verifyJWT(body.refreshToken, this.jwtSecret)
      if (!payload || payload.type !== 'refresh') {
        return c.json({ error: 'Invalid refresh token' }, 401)
      }

      // Find session
      const sessions = await this.things.list({ type: 'Session' })
      const session = sessions.find(
        (s) => (s as unknown as Session).refreshToken === body.refreshToken
      ) as (Session & { $id: string }) | undefined

      if (!session) {
        return c.json({ error: 'Session not found' }, 401)
      }

      // Get user
      const user = await this.things.get(session.userId)
      if (!user) {
        await this.things.delete(session.$id)
        return c.json({ error: 'User not found' }, 401)
      }

      const userData = user as unknown as User

      // Generate new access token
      const now = Math.floor(Date.now() / 1000)
      const accessToken = await generateJWT(
        {
          sub: session.userId,
          email: userData.email,
          role: userData.role,
          iat: now,
          exp: now + ACCESS_TOKEN_EXPIRY,
          type: 'access',
        },
        this.jwtSecret
      )

      // Update session activity
      await this.things.update(session.$id, { lastActiveAt: new Date().toISOString() })

      return c.json({
        accessToken,
        expiresIn: ACCESS_TOKEN_EXPIRY,
      })
    })

    // Forgot password
    app.post('/auth/forgot-password', async (c) => {
      const body = await c.req.json<{ email: string }>()

      // Always return success to prevent email enumeration
      const successResponse = {
        message: 'If an account exists with this email, a password reset link will be sent.',
      }

      const users = await this.things.list({ type: 'User' })
      const user = users.find(
        (u) => (u as unknown as User).email === body.email.toLowerCase()
      ) as (User & { $id: string }) | undefined

      if (!user) {
        return c.json(successResponse)
      }

      // Generate reset token
      const token = generateId()
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY * 1000).toISOString()

      await this.things.create({
        $type: 'PasswordReset',
        userId: user.$id,
        email: user.email,
        token,
        expiresAt,
        createdAt: new Date().toISOString(),
      })

      // In production: send email with reset link
      console.log(`[Email] Password reset link for ${user.email}: /reset-password?token=${token}`)

      return c.json(successResponse)
    })

    // Reset password
    app.post('/auth/reset-password', async (c) => {
      const body = await c.req.json<{ token: string; newPassword: string }>()

      if (body.newPassword.length < 8) {
        return c.json({ error: 'Password must be at least 8 characters' }, 400)
      }

      // Find valid reset token
      const resets = await this.things.list({ type: 'PasswordReset' })
      const reset = resets.find(
        (r) =>
          (r as unknown as PasswordReset).token === body.token &&
          !(r as unknown as PasswordReset).usedAt
      ) as (PasswordReset & { $id: string }) | undefined

      if (!reset || new Date(reset.expiresAt) < new Date()) {
        return c.json({ error: 'Invalid or expired reset token' }, 400)
      }

      // Update password
      const passwordHash = await hashPassword(body.newPassword)
      await this.things.update(reset.userId, {
        passwordHash,
        updatedAt: new Date().toISOString(),
      })

      // Mark token as used
      await this.things.update(reset.$id, { usedAt: new Date().toISOString() })

      // Invalidate all sessions for this user
      const sessions = await this.things.list({ type: 'Session' })
      for (const session of sessions) {
        if ((session as unknown as Session).userId === reset.userId) {
          await this.things.delete(session.$id)
        }
      }

      // Log security event
      await this.logSecurityEvent('password_change', reset.userId, c.req)

      return c.json({ message: 'Password reset successfully. Please log in with your new password.' })
    })

    // ========================================================================
    // Protected Routes (Auth Required)
    // ========================================================================

    // Middleware for protected routes
    const authMiddleware = async (c: any, next: () => Promise<void>) => {
      const authHeader = c.req.header('Authorization')

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Authorization header required' }, 401)
      }

      const token = authHeader.slice(7)
      const payload = await verifyJWT(token, this.jwtSecret)

      if (!payload || payload.type !== 'access') {
        return c.json({ error: 'Invalid or expired token' }, 401)
      }

      // Attach user info to context
      c.set('userId', payload.sub)
      c.set('userEmail', payload.email)
      c.set('userRole', payload.role)

      await next()
    }

    // Get current user
    app.get('/auth/me', authMiddleware, async (c) => {
      const userId = c.get('userId')
      const user = await this.things.get(userId)

      if (!user) {
        return c.json({ error: 'User not found' }, 404)
      }

      return c.json({
        user: this.sanitizeUser(user as unknown as User & { $id: string }),
      })
    })

    // Logout
    app.post('/auth/logout', authMiddleware, async (c) => {
      const userId = c.get('userId')

      // Find and delete current session
      const authHeader = c.req.header('Authorization')!
      const token = authHeader.slice(7)

      const sessions = await this.things.list({ type: 'Session' })
      const session = sessions.find(
        (s) => (s as unknown as Session).userId === userId
      )

      if (session) {
        await this.things.delete(session.$id)
      }

      // Log security event
      await this.logSecurityEvent('logout', userId, c.req)

      // Fire event
      this.$.send({
        type: 'User.loggedOut',
        payload: { userId },
      })

      return c.json({ message: 'Logged out successfully' })
    })

    // Logout from all devices
    app.post('/auth/logout-all', authMiddleware, async (c) => {
      const userId = c.get('userId')

      // Delete all sessions
      const sessions = await this.things.list({ type: 'Session' })
      for (const session of sessions) {
        if ((session as unknown as Session).userId === userId) {
          await this.things.delete(session.$id)
        }
      }

      return c.json({ message: 'Logged out from all devices' })
    })

    // Change password
    app.post('/auth/change-password', authMiddleware, async (c) => {
      const userId = c.get('userId')
      const body = await c.req.json<ChangePasswordRequest>()

      const user = await this.things.get(userId) as unknown as User & { $id: string }

      // Verify current password
      const validPassword = await verifyPassword(body.currentPassword, user.passwordHash)
      if (!validPassword) {
        return c.json({ error: 'Current password is incorrect' }, 400)
      }

      if (body.newPassword.length < 8) {
        return c.json({ error: 'New password must be at least 8 characters' }, 400)
      }

      // Update password
      const passwordHash = await hashPassword(body.newPassword)
      await this.things.update(userId, {
        passwordHash,
        updatedAt: new Date().toISOString(),
      })

      // Log security event
      await this.logSecurityEvent('password_change', userId, c.req)

      return c.json({ message: 'Password changed successfully' })
    })

    // ========================================================================
    // API Keys
    // ========================================================================

    // List API keys
    app.get('/auth/api-keys', authMiddleware, async (c) => {
      const userId = c.get('userId')

      const allKeys = await this.things.list({ type: 'ApiKey' })
      const userKeys = allKeys.filter(
        (k) => (k as unknown as ApiKey).userId === userId
      )

      // Don't return key hashes
      return c.json({
        data: userKeys.map((k) => ({
          id: k.$id,
          name: (k as unknown as ApiKey).name,
          keyPrefix: (k as unknown as ApiKey).keyPrefix,
          permissions: (k as unknown as ApiKey).permissions,
          expiresAt: (k as unknown as ApiKey).expiresAt,
          lastUsedAt: (k as unknown as ApiKey).lastUsedAt,
          usageCount: (k as unknown as ApiKey).usageCount,
          createdAt: (k as unknown as ApiKey).createdAt,
        })),
      })
    })

    // Create API key
    app.post('/auth/api-keys', authMiddleware, async (c) => {
      const userId = c.get('userId')
      const body = await c.req.json<CreateApiKeyRequest>()

      if (!body.name) {
        return c.json({ error: 'Name is required' }, 400)
      }

      // Generate key
      const key = `dk_${generateId()}`
      const keyHash = await hashPassword(key)

      const expiresAt = body.expiresIn
        ? new Date(Date.now() + body.expiresIn * 24 * 60 * 60 * 1000).toISOString()
        : undefined

      const apiKey = await this.things.create({
        $type: 'ApiKey',
        userId,
        name: body.name,
        keyHash,
        keyPrefix: key.slice(0, 10),
        permissions: body.permissions || ['*'],
        rateLimit: 1000, // requests per hour
        expiresAt,
        createdAt: new Date().toISOString(),
        usageCount: 0,
      })

      // Log security event
      await this.logSecurityEvent('api_key_created', userId, c.req, { keyName: body.name })

      return c.json({
        id: apiKey.$id,
        name: body.name,
        key, // Only returned once!
        permissions: body.permissions || ['*'],
        expiresAt,
      } as CreateApiKeyResponse, 201)
    })

    // Revoke API key
    app.delete('/auth/api-keys/:id', authMiddleware, async (c) => {
      const userId = c.get('userId')
      const keyId = c.req.param('id')

      const apiKey = await this.things.get(keyId)
      if (!apiKey || apiKey.$type !== 'ApiKey') {
        return c.json({ error: 'API key not found' }, 404)
      }

      if ((apiKey as unknown as ApiKey).userId !== userId) {
        return c.json({ error: 'Unauthorized' }, 403)
      }

      await this.things.delete(keyId)

      // Log security event
      await this.logSecurityEvent('api_key_revoked', userId, c.req, {
        keyName: (apiKey as unknown as ApiKey).name,
      })

      return c.body(null, 204)
    })

    // ========================================================================
    // API Key Authentication Endpoint
    // ========================================================================

    // Verify API key (for services to validate incoming requests)
    app.post('/auth/verify-api-key', async (c) => {
      const authHeader = c.req.header('X-API-Key')

      if (!authHeader) {
        return c.json({ error: 'X-API-Key header required' }, 401)
      }

      const allKeys = await this.things.list({ type: 'ApiKey' })

      for (const key of allKeys) {
        const apiKey = key as unknown as ApiKey & { $id: string }

        // Check if expired
        if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
          continue
        }

        // Verify key
        const valid = await verifyPassword(authHeader, apiKey.keyHash)
        if (valid) {
          // Update usage
          await this.things.update(apiKey.$id, {
            lastUsedAt: new Date().toISOString(),
            usageCount: apiKey.usageCount + 1,
          })

          return c.json({
            valid: true,
            userId: apiKey.userId,
            permissions: apiKey.permissions,
          })
        }
      }

      return c.json({ valid: false, error: 'Invalid API key' }, 401)
    })

    // ========================================================================
    // Sessions Management
    // ========================================================================

    // List active sessions
    app.get('/auth/sessions', authMiddleware, async (c) => {
      const userId = c.get('userId')

      const allSessions = await this.things.list({ type: 'Session' })
      const userSessions = allSessions.filter(
        (s) => (s as unknown as Session).userId === userId
      )

      return c.json({
        data: userSessions.map((s) => ({
          id: s.$id,
          userAgent: (s as unknown as Session).userAgent,
          ipAddress: (s as unknown as Session).ipAddress,
          createdAt: (s as unknown as Session).createdAt,
          lastActiveAt: (s as unknown as Session).lastActiveAt,
        })),
      })
    })

    // Revoke specific session
    app.delete('/auth/sessions/:id', authMiddleware, async (c) => {
      const userId = c.get('userId')
      const sessionId = c.req.param('id')

      const session = await this.things.get(sessionId)
      if (!session || session.$type !== 'Session') {
        return c.json({ error: 'Session not found' }, 404)
      }

      if ((session as unknown as Session).userId !== userId) {
        return c.json({ error: 'Unauthorized' }, 403)
      }

      await this.things.delete(sessionId)

      return c.body(null, 204)
    })

    // ========================================================================
    // 2FA Management
    // ========================================================================

    // Setup 2FA
    app.post('/auth/2fa/setup', authMiddleware, async (c) => {
      const userId = c.get('userId')
      const user = await this.things.get(userId) as unknown as User & { $id: string }

      if (user.twoFactorEnabled) {
        return c.json({ error: '2FA is already enabled' }, 400)
      }

      // Generate TOTP secret
      // In production, use a proper TOTP library
      const secret = generateId().slice(0, 16).toUpperCase()

      // Store secret (not yet enabled)
      await this.things.update(userId, { twoFactorSecret: secret })

      // Generate QR code URL (otpauth://)
      const qrCodeUrl = `otpauth://totp/dotdo:${user.email}?secret=${secret}&issuer=dotdo`

      // Generate backup codes
      const backupCodes = Array.from({ length: 10 }, () =>
        generateId().slice(0, 8).toUpperCase()
      )

      return c.json({
        secret,
        qrCodeUrl,
        backupCodes,
      })
    })

    // Enable 2FA (verify setup)
    app.post('/auth/2fa/enable', authMiddleware, async (c) => {
      const userId = c.get('userId')
      const body = await c.req.json<{ code: string }>()

      const user = await this.things.get(userId) as unknown as User & { $id: string }

      if (!user.twoFactorSecret) {
        return c.json({ error: 'Please setup 2FA first' }, 400)
      }

      // In production, verify TOTP code
      if (!/^\d{6}$/.test(body.code)) {
        return c.json({ error: 'Invalid verification code' }, 400)
      }

      await this.things.update(userId, { twoFactorEnabled: true })

      // Log security event
      await this.logSecurityEvent('2fa_enabled', userId, c.req)

      return c.json({ message: '2FA enabled successfully' })
    })

    // Disable 2FA
    app.post('/auth/2fa/disable', authMiddleware, async (c) => {
      const userId = c.get('userId')
      const body = await c.req.json<{ password: string }>()

      const user = await this.things.get(userId) as unknown as User & { $id: string }

      // Verify password
      const validPassword = await verifyPassword(body.password, user.passwordHash)
      if (!validPassword) {
        return c.json({ error: 'Invalid password' }, 400)
      }

      await this.things.update(userId, {
        twoFactorEnabled: false,
        twoFactorSecret: undefined,
      })

      // Log security event
      await this.logSecurityEvent('2fa_disabled', userId, c.req)

      return c.json({ message: '2FA disabled successfully' })
    })

    // ========================================================================
    // Security Events (Admin Only)
    // ========================================================================

    app.get('/auth/security-events', authMiddleware, async (c) => {
      const userRole = c.get('userRole')

      if (userRole !== 'admin') {
        return c.json({ error: 'Admin access required' }, 403)
      }

      const events = await this.things.list({ type: 'SecurityEvent' })

      // Sort by date descending
      const sorted = (events as unknown as (SecurityEvent & { $id: string })[]).sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )

      return c.json({ data: sorted.slice(0, 100) })
    })
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private async createSession(
    userId: string,
    email: string,
    role: User['role'],
    req: any
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const now = Math.floor(Date.now() / 1000)

    const accessToken = await generateJWT(
      {
        sub: userId,
        email,
        role,
        iat: now,
        exp: now + ACCESS_TOKEN_EXPIRY,
        type: 'access',
      },
      this.jwtSecret
    )

    const refreshToken = await generateJWT(
      {
        sub: userId,
        email,
        role,
        iat: now,
        exp: now + REFRESH_TOKEN_EXPIRY,
        type: 'refresh',
      },
      this.jwtSecret
    )

    // Store session
    await this.things.create({
      $type: 'Session',
      userId,
      token: accessToken,
      refreshToken,
      expiresAt: new Date((now + REFRESH_TOKEN_EXPIRY) * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      userAgent: req.header?.('User-Agent'),
      ipAddress: req.header?.('CF-Connecting-IP'),
      lastActiveAt: new Date().toISOString(),
    })

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRY,
    }
  }

  private recordLoginAttempt(ip: string): void {
    const current = this.loginAttempts.get(ip) || { count: 0, lastAttempt: 0 }
    this.loginAttempts.set(ip, {
      count: current.count + 1,
      lastAttempt: Date.now(),
    })
  }

  private async logSecurityEvent(
    eventType: SecurityEvent['eventType'],
    userId: string | undefined,
    req: any,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.things.create({
      $type: 'SecurityEvent',
      userId,
      eventType,
      ipAddress: req.header?.('CF-Connecting-IP'),
      userAgent: req.header?.('User-Agent'),
      metadata,
      createdAt: new Date().toISOString(),
    })
  }

  private sanitizeUser(user: User & { $id: string }): Omit<User, 'passwordHash' | 'twoFactorSecret'> & { $id: string } {
    const { passwordHash, twoFactorSecret, ...safe } = user
    return safe
  }
}

// Export for worker binding
export { AuthDO as DO }
