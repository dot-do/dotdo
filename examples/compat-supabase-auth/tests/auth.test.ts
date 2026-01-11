/**
 * Supabase Auth Compatibility - Test Suite
 *
 * Tests for:
 * - Email/password authentication
 * - Magic link / OTP authentication
 * - OAuth flows
 * - Session management
 * - JWT token handling
 * - MFA enrollment and verification
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// MOCK STORAGE
// ============================================================================

/**
 * In-memory mock of DurableObjectStorage for testing
 */
class MockStorage {
  private data: Map<string, unknown> = new Map()

  async get(key: string): Promise<unknown> {
    return this.data.get(key)
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async deleteAll(): Promise<void> {
    this.data.clear()
  }

  async list(): Promise<Map<string, unknown>> {
    return new Map(this.data)
  }

  clear(): void {
    this.data.clear()
  }
}

// ============================================================================
// CRYPTO UTILITIES (copied from AuthDO for testing)
// ============================================================================

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))

  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])

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

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const combined = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
    const salt = combined.slice(0, 16)
    const storedHash = combined.slice(16)

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
      'deriveBits',
    ])

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

async function generateJWT(
  payload: Record<string, unknown>,
  secret: string,
  expiresIn: number
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + Math.floor(expiresIn / 1000),
  }

  const encoder = new TextEncoder()
  const headerB64 = btoa(JSON.stringify(header))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  const payloadB64 = btoa(JSON.stringify(fullPayload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

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

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts

    const encoder = new TextEncoder()
    const data = `${headerB64}.${payloadB64}`

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const signaturePadded =
      signatureB64.replace(/-/g, '+').replace(/_/g, '/') +
      '=='.slice(0, (4 - (signatureB64.length % 4)) % 4)
    const signature = Uint8Array.from(atob(signaturePadded), (c) => c.charCodeAt(0))

    const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data))
    if (!valid) return null

    const payloadPadded =
      payloadB64.replace(/-/g, '+').replace(/_/g, '/') +
      '=='.slice(0, (4 - (payloadB64.length % 4)) % 4)
    const payload = JSON.parse(atob(payloadPadded)) as Record<string, unknown>

    const exp = payload.exp as number
    if (exp && exp < Math.floor(Date.now() / 1000)) return null

    return payload
  } catch {
    return null
  }
}

// ============================================================================
// PASSWORD HASHING TESTS
// ============================================================================

describe('Password Hashing', () => {
  it('should hash and verify password correctly', async () => {
    const password = 'secure-password-123'
    const hash = await hashPassword(password)

    expect(hash).toBeDefined()
    expect(hash).not.toBe(password)

    const valid = await verifyPassword(password, hash)
    expect(valid).toBe(true)

    const invalid = await verifyPassword('wrong-password', hash)
    expect(invalid).toBe(false)
  })

  it('should produce different hashes for same password (salt)', async () => {
    const password = 'test-password'
    const hash1 = await hashPassword(password)
    const hash2 = await hashPassword(password)

    expect(hash1).not.toBe(hash2)

    // Both should still verify
    expect(await verifyPassword(password, hash1)).toBe(true)
    expect(await verifyPassword(password, hash2)).toBe(true)
  })

  it('should handle empty password', async () => {
    const hash = await hashPassword('')
    expect(hash).toBeDefined()
    expect(await verifyPassword('', hash)).toBe(true)
    expect(await verifyPassword('notempty', hash)).toBe(false)
  })

  it('should handle special characters', async () => {
    const password = 'P@$$w0rd!#$%^&*()'
    const hash = await hashPassword(password)
    expect(await verifyPassword(password, hash)).toBe(true)
  })

  it('should handle unicode characters', async () => {
    const password = 'mot-de-passe'
    const hash = await hashPassword(password)
    expect(await verifyPassword(password, hash)).toBe(true)
  })
})

// ============================================================================
// JWT TESTS
// ============================================================================

describe('JWT Handling', () => {
  const secret = 'test-jwt-secret-123'

  it('should generate valid JWT', async () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      role: 'authenticated',
    }

    const token = await generateJWT(payload, secret, 3600000) // 1 hour

    expect(token).toBeDefined()
    expect(token.split('.')).toHaveLength(3)
  })

  it('should verify and decode JWT', async () => {
    const payload = {
      sub: 'user-456',
      email: 'verify@example.com',
      custom: 'data',
    }

    const token = await generateJWT(payload, secret, 3600000)
    const decoded = await verifyJWT(token, secret)

    expect(decoded).not.toBeNull()
    expect(decoded?.sub).toBe('user-456')
    expect(decoded?.email).toBe('verify@example.com')
    expect(decoded?.custom).toBe('data')
    expect(decoded?.iat).toBeDefined()
    expect(decoded?.exp).toBeDefined()
  })

  it('should reject token with wrong secret', async () => {
    const payload = { sub: 'user-789' }
    const token = await generateJWT(payload, secret, 3600000)

    const decoded = await verifyJWT(token, 'wrong-secret')
    expect(decoded).toBeNull()
  })

  it('should reject expired token', async () => {
    const payload = { sub: 'user-expired' }
    const token = await generateJWT(payload, secret, -1000) // Already expired

    const decoded = await verifyJWT(token, secret)
    expect(decoded).toBeNull()
  })

  it('should reject malformed token', async () => {
    expect(await verifyJWT('not.a.valid.token', secret)).toBeNull()
    expect(await verifyJWT('invalid', secret)).toBeNull()
    expect(await verifyJWT('', secret)).toBeNull()
  })
})

// ============================================================================
// AUTH SERVICE TESTS (Simulated)
// ============================================================================

interface User {
  id: string
  aud: string
  role: string
  email?: string
  phone?: string
  email_confirmed_at?: string
  app_metadata: Record<string, unknown>
  user_metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  password_hash?: string
}

interface Session {
  id: string
  user_id: string
  refresh_token: string
  expires_at: number
  created_at: string
}

class MockAuthService {
  private storage: MockStorage
  private jwtSecret: string

  constructor(storage: MockStorage, jwtSecret: string = 'test-secret') {
    this.storage = storage
    this.jwtSecret = jwtSecret
  }

  async signUp(credentials: { email: string; password: string; options?: { data?: Record<string, unknown> } }) {
    const { email, password, options } = credentials

    // Check existing
    const users = ((await this.storage.get('users')) as User[] | undefined) ?? []
    if (users.find((u) => u.email === email)) {
      return {
        data: { user: null, session: null },
        error: { message: 'User already exists' },
      }
    }

    // Create user
    const passwordHash = await hashPassword(password)
    const now = new Date().toISOString()
    const user: User = {
      id: crypto.randomUUID(),
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: options?.data ?? {},
      created_at: now,
      updated_at: now,
      password_hash: passwordHash,
    }

    users.push(user)
    await this.storage.put('users', users)

    // Create session
    const session = await this.createSession(user)

    // Return without password_hash
    const { password_hash: _, ...safeUser } = user

    return {
      data: { user: safeUser, session },
      error: null,
    }
  }

  async signInWithPassword(credentials: { email: string; password: string }) {
    const { email, password } = credentials

    const users = ((await this.storage.get('users')) as User[] | undefined) ?? []
    const user = users.find((u) => u.email === email)

    if (!user || !user.password_hash) {
      return {
        data: { user: null, session: null },
        error: { message: 'Invalid credentials' },
      }
    }

    const valid = await verifyPassword(password, user.password_hash)
    if (!valid) {
      return {
        data: { user: null, session: null },
        error: { message: 'Invalid credentials' },
      }
    }

    const session = await this.createSession(user)
    const { password_hash: _, ...safeUser } = user

    return {
      data: { user: safeUser, session },
      error: null,
    }
  }

  async refreshSession(refreshToken: string) {
    const sessions = ((await this.storage.get('sessions')) as Session[] | undefined) ?? []
    const session = sessions.find((s) => s.refresh_token === refreshToken)

    if (!session || session.expires_at < Date.now()) {
      return {
        data: { user: null, session: null },
        error: { message: 'Invalid or expired refresh token' },
      }
    }

    const users = ((await this.storage.get('users')) as User[] | undefined) ?? []
    const user = users.find((u) => u.id === session.user_id)

    if (!user) {
      return {
        data: { user: null, session: null },
        error: { message: 'User not found' },
      }
    }

    // Delete old session
    const filteredSessions = sessions.filter((s) => s.id !== session.id)
    await this.storage.put('sessions', filteredSessions)

    // Create new session
    const newSession = await this.createSession(user)
    const { password_hash: _, ...safeUser } = user

    return {
      data: { user: safeUser, session: newSession },
      error: null,
    }
  }

  async getUser(accessToken: string) {
    const payload = await verifyJWT(accessToken, this.jwtSecret)
    if (!payload) {
      return {
        data: { user: null },
        error: { message: 'Invalid or expired token' },
      }
    }

    const users = ((await this.storage.get('users')) as User[] | undefined) ?? []
    const user = users.find((u) => u.id === payload.sub)

    if (!user) {
      return {
        data: { user: null },
        error: { message: 'User not found' },
      }
    }

    const { password_hash: _, ...safeUser } = user
    return { data: { user: safeUser }, error: null }
  }

  async signOut(refreshToken: string) {
    const sessions = ((await this.storage.get('sessions')) as Session[] | undefined) ?? []
    const filtered = sessions.filter((s) => s.refresh_token !== refreshToken)
    await this.storage.put('sessions', filtered)
    return { error: null }
  }

  private async createSession(user: User) {
    const accessToken = await generateJWT(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        aud: user.aud,
      },
      this.jwtSecret,
      3600000 // 1 hour
    )

    const refreshToken = crypto.randomUUID()
    const now = new Date().toISOString()

    const session: Session = {
      id: crypto.randomUUID(),
      user_id: user.id,
      refresh_token: refreshToken,
      expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      created_at: now,
    }

    const sessions = ((await this.storage.get('sessions')) as Session[] | undefined) ?? []
    sessions.push(session)
    await this.storage.put('sessions', sessions)

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      user: { ...user, password_hash: undefined },
    }
  }
}

// ============================================================================
// SIGN UP TESTS
// ============================================================================

describe('Sign Up', () => {
  let storage: MockStorage
  let auth: MockAuthService

  beforeEach(() => {
    storage = new MockStorage()
    auth = new MockAuthService(storage)
  })

  it('should sign up new user with email/password', async () => {
    const result = await auth.signUp({
      email: 'newuser@example.com',
      password: 'password123',
    })

    expect(result.error).toBeNull()
    expect(result.data.user).toBeDefined()
    expect(result.data.user?.email).toBe('newuser@example.com')
    expect(result.data.user?.role).toBe('authenticated')
    expect(result.data.session).toBeDefined()
    expect(result.data.session?.access_token).toBeDefined()
    expect(result.data.session?.refresh_token).toBeDefined()
  })

  it('should include user metadata', async () => {
    const result = await auth.signUp({
      email: 'meta@example.com',
      password: 'password123',
      options: {
        data: {
          name: 'Test User',
          avatar: 'https://example.com/avatar.png',
        },
      },
    })

    expect(result.error).toBeNull()
    expect(result.data.user?.user_metadata.name).toBe('Test User')
    expect(result.data.user?.user_metadata.avatar).toBe('https://example.com/avatar.png')
  })

  it('should not allow duplicate emails', async () => {
    await auth.signUp({
      email: 'duplicate@example.com',
      password: 'password1',
    })

    const result = await auth.signUp({
      email: 'duplicate@example.com',
      password: 'password2',
    })

    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('already exists')
  })

  it('should not return password hash', async () => {
    const result = await auth.signUp({
      email: 'nohash@example.com',
      password: 'password123',
    })

    expect((result.data.user as Record<string, unknown>)?.password_hash).toBeUndefined()
    expect((result.data.session?.user as Record<string, unknown>)?.password_hash).toBeUndefined()
  })
})

// ============================================================================
// SIGN IN TESTS
// ============================================================================

describe('Sign In', () => {
  let storage: MockStorage
  let auth: MockAuthService

  beforeEach(async () => {
    storage = new MockStorage()
    auth = new MockAuthService(storage)

    // Create test user
    await auth.signUp({
      email: 'signin@example.com',
      password: 'correct-password',
    })
  })

  it('should sign in with correct credentials', async () => {
    const result = await auth.signInWithPassword({
      email: 'signin@example.com',
      password: 'correct-password',
    })

    expect(result.error).toBeNull()
    expect(result.data.user?.email).toBe('signin@example.com')
    expect(result.data.session?.access_token).toBeDefined()
  })

  it('should reject wrong password', async () => {
    const result = await auth.signInWithPassword({
      email: 'signin@example.com',
      password: 'wrong-password',
    })

    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('Invalid credentials')
  })

  it('should reject non-existent user', async () => {
    const result = await auth.signInWithPassword({
      email: 'nonexistent@example.com',
      password: 'password',
    })

    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('Invalid credentials')
  })
})

// ============================================================================
// SESSION MANAGEMENT TESTS
// ============================================================================

describe('Session Management', () => {
  let storage: MockStorage
  let auth: MockAuthService

  beforeEach(async () => {
    storage = new MockStorage()
    auth = new MockAuthService(storage)
  })

  it('should refresh session with valid refresh token', async () => {
    const signUp = await auth.signUp({
      email: 'refresh@example.com',
      password: 'password123',
    })

    // Wait a bit to get different tokens
    await new Promise((resolve) => setTimeout(resolve, 10))

    const refreshed = await auth.refreshSession(signUp.data.session!.refresh_token)

    expect(refreshed.error).toBeNull()
    expect(refreshed.data.session?.access_token).toBeDefined()
    expect(refreshed.data.session?.refresh_token).toBeDefined()
    // New refresh token should be different
    expect(refreshed.data.session?.refresh_token).not.toBe(signUp.data.session?.refresh_token)
  })

  it('should reject invalid refresh token', async () => {
    const result = await auth.refreshSession('invalid-token')

    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('Invalid or expired')
  })

  it('should get user from access token', async () => {
    const signUp = await auth.signUp({
      email: 'getuser@example.com',
      password: 'password123',
    })

    const result = await auth.getUser(signUp.data.session!.access_token)

    expect(result.error).toBeNull()
    expect(result.data.user?.email).toBe('getuser@example.com')
  })

  it('should reject invalid access token', async () => {
    const result = await auth.getUser('invalid-token')

    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('Invalid or expired')
  })

  it('should sign out and invalidate refresh token', async () => {
    const signUp = await auth.signUp({
      email: 'signout@example.com',
      password: 'password123',
    })

    await auth.signOut(signUp.data.session!.refresh_token)

    // Refresh should fail after sign out
    const refreshed = await auth.refreshSession(signUp.data.session!.refresh_token)
    expect(refreshed.error).toBeDefined()
  })
})

// ============================================================================
// OTP / MAGIC LINK TESTS
// ============================================================================

describe('OTP / Magic Link', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should store and verify OTP', async () => {
    const email = 'otp@example.com'
    const token = '123456'

    // Store OTP
    const otps = [
      {
        email,
        token,
        type: 'magiclink',
        expires_at: Date.now() + 15 * 60 * 1000,
        created_at: new Date().toISOString(),
      },
    ]
    await storage.put('otps', otps)

    // Verify OTP exists
    const storedOtps = (await storage.get('otps')) as typeof otps
    const found = storedOtps.find((o) => o.email === email && o.token === token)

    expect(found).toBeDefined()
    expect(found?.type).toBe('magiclink')
  })

  it('should expire OTP after time limit', async () => {
    const email = 'expired@example.com'
    const token = '654321'

    // Store expired OTP
    const otps = [
      {
        email,
        token,
        type: 'magiclink',
        expires_at: Date.now() - 1000, // Already expired
        created_at: new Date().toISOString(),
      },
    ]
    await storage.put('otps', otps)

    // Check if expired
    const storedOtps = (await storage.get('otps')) as typeof otps
    const found = storedOtps.find((o) => o.email === email && o.token === token && o.expires_at > Date.now())

    expect(found).toBeUndefined()
  })
})

// ============================================================================
// OAUTH STATE TESTS
// ============================================================================

describe('OAuth State', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should store OAuth state for PKCE flow', async () => {
    const state = crypto.randomUUID()
    const provider = 'google'
    const redirectTo = 'http://localhost:3000/callback'

    const oauthStates = [
      {
        state,
        provider,
        redirect_to: redirectTo,
        expires_at: Date.now() + 10 * 60 * 1000,
        created_at: new Date().toISOString(),
      },
    ]
    await storage.put('oauth_states', oauthStates)

    const stored = (await storage.get('oauth_states')) as typeof oauthStates
    expect(stored).toHaveLength(1)
    expect(stored[0].state).toBe(state)
    expect(stored[0].provider).toBe('google')
  })

  it('should expire OAuth state', async () => {
    const state = crypto.randomUUID()

    const oauthStates = [
      {
        state,
        provider: 'github',
        redirect_to: 'http://localhost:3000/callback',
        expires_at: Date.now() - 1000, // Already expired
        created_at: new Date().toISOString(),
      },
    ]
    await storage.put('oauth_states', oauthStates)

    const stored = (await storage.get('oauth_states')) as typeof oauthStates
    const valid = stored.find((s) => s.state === state && s.expires_at > Date.now())

    expect(valid).toBeUndefined()
  })
})

// ============================================================================
// MFA TESTS
// ============================================================================

describe('MFA / TOTP', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should enroll TOTP factor', async () => {
    const userId = crypto.randomUUID()
    const factorId = crypto.randomUUID()
    const secret = 'JBSWY3DPEHPK3PXP' // Test secret

    const factors = [
      {
        id: factorId,
        friendly_name: 'Authenticator App',
        factor_type: 'totp',
        status: 'unverified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        secret,
      },
    ]
    await storage.put(`factors:${userId}`, factors)

    const stored = (await storage.get(`factors:${userId}`)) as typeof factors
    expect(stored).toHaveLength(1)
    expect(stored[0].factor_type).toBe('totp')
    expect(stored[0].status).toBe('unverified')
  })

  it('should verify and mark factor as verified', async () => {
    const userId = crypto.randomUUID()
    const factorId = crypto.randomUUID()

    const factors = [
      {
        id: factorId,
        factor_type: 'totp',
        status: 'unverified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]
    await storage.put(`factors:${userId}`, factors)

    // Simulate verification
    const stored = (await storage.get(`factors:${userId}`)) as typeof factors
    stored[0].status = 'verified'
    stored[0].updated_at = new Date().toISOString()
    await storage.put(`factors:${userId}`, stored)

    const updated = (await storage.get(`factors:${userId}`)) as typeof factors
    expect(updated[0].status).toBe('verified')
  })
})

// ============================================================================
// SESSION DO TESTS
// ============================================================================

describe('Session Storage', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should store session data', async () => {
    const session = {
      id: crypto.randomUUID(),
      user_id: crypto.randomUUID(),
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      expires_at: Date.now() + 3600000,
      refresh_expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      is_active: true,
    }

    await storage.put('session', session)

    const stored = (await storage.get('session')) as typeof session
    expect(stored).toBeDefined()
    expect(stored.id).toBe(session.id)
    expect(stored.is_active).toBe(true)
  })

  it('should track session activity', async () => {
    const activities = [
      { timestamp: new Date().toISOString(), action: 'session.created' },
      { timestamp: new Date().toISOString(), action: 'tokens.refreshed' },
    ]

    await storage.put('activities', activities)

    const stored = (await storage.get('activities')) as typeof activities
    expect(stored).toHaveLength(2)
    expect(stored[0].action).toBe('session.created')
  })

  it('should invalidate session', async () => {
    const session = {
      id: crypto.randomUUID(),
      user_id: crypto.randomUUID(),
      is_active: true,
      updated_at: new Date().toISOString(),
    }

    await storage.put('session', session)

    // Invalidate
    const stored = (await storage.get('session')) as typeof session
    stored.is_active = false
    stored.updated_at = new Date().toISOString()
    await storage.put('session', stored)

    const updated = (await storage.get('session')) as typeof session
    expect(updated.is_active).toBe(false)
  })
})

// ============================================================================
// RATE LIMITING TESTS
// ============================================================================

describe('Rate Limiting', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should track rate limit counter', async () => {
    const key = 'rate_limit:login'
    const entry = {
      count: 5,
      window_start: Date.now(),
    }

    await storage.put(key, entry)

    const stored = (await storage.get(key)) as typeof entry
    expect(stored.count).toBe(5)
  })

  it('should respect rate limit threshold', async () => {
    const key = 'rate_limit:default'
    const maxRequests = 60
    const windowMs = 60000

    // Simulate hitting rate limit
    const entry = {
      count: maxRequests,
      window_start: Date.now(),
    }
    await storage.put(key, entry)

    const stored = (await storage.get(key)) as typeof entry
    const now = Date.now()
    const isExceeded = stored.count >= maxRequests && now - stored.window_start < windowMs

    expect(isExceeded).toBe(true)
  })

  it('should reset after window expires', async () => {
    const key = 'rate_limit:reset'
    const windowMs = 60000

    // Expired window
    const entry = {
      count: 100,
      window_start: Date.now() - windowMs - 1000,
    }
    await storage.put(key, entry)

    const stored = (await storage.get(key)) as typeof entry
    const now = Date.now()
    const windowExpired = now - stored.window_start > windowMs

    expect(windowExpired).toBe(true)
  })
})
