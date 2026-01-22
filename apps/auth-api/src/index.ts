/**
 * Auth API Example
 *
 * A complete authentication API demonstrating:
 * - User registration and login
 * - JWT token generation and verification
 * - Protected routes with middleware
 * - Password hashing (using Web Crypto)
 * - Per-user Durable Objects
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import * as jose from 'jose'

// Re-export the Durable Object class
export { UserDO } from './UserDO'

// ============================================================================
// Types
// ============================================================================

interface Env {
  USER_DO: DurableObjectNamespace
  JWT_SECRET: string
}

interface AuthUser {
  id: string
  email: string
  name: string
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    token: string
  }
}

// ============================================================================
// JWT Utilities
// ============================================================================

async function createToken(user: AuthUser, secret: string): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)

  const token = await new jose.SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .setIssuer('auth-api')
    .sign(secretKey)

  return token
}

async function verifyToken(token: string, secret: string): Promise<jose.JWTPayload> {
  const secretKey = new TextEncoder().encode(secret)

  const { payload } = await jose.jwtVerify(token, secretKey, {
    issuer: 'auth-api',
  })

  return payload
}

// ============================================================================
// Auth Middleware
// ============================================================================

function authMiddleware(env: Env) {
  return async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header('Authorization')

    if (!authHeader) {
      throw new HTTPException(401, { message: 'Authorization header required' })
    }

    const [scheme, token] = authHeader.split(' ')

    if (scheme !== 'Bearer' || !token) {
      throw new HTTPException(401, { message: 'Bearer token required' })
    }

    try {
      const payload = await verifyToken(token, env.JWT_SECRET)

      const user: AuthUser = {
        id: payload.sub as string,
        email: payload.email as string,
        name: payload.name as string,
      }

      c.set('user', user)
      c.set('token', token)

      return next()
    } catch (error) {
      throw new HTTPException(401, { message: 'Invalid or expired token' })
    }
  }
}

// ============================================================================
// Main App
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Middleware
app.use('/*', cors())

// Error handling
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

// Health check and API discovery
app.get('/', (c) =>
  c.json({
    name: 'Auth API',
    version: '1.0.0',
    description: 'JWT authentication example using dotdo patterns',
    endpoints: {
      'POST /auth/register': 'Register a new user',
      'POST /auth/login': 'Login and get JWT token',
      'GET /auth/me': 'Get current user (requires auth)',
      'PATCH /auth/me': 'Update current user (requires auth)',
      'POST /auth/refresh': 'Refresh JWT token (requires auth)',
      'GET /users/:id': 'Get user by ID (requires auth)',
    },
  })
)

// ============================================================================
// Public Routes
// ============================================================================

// Register a new user
app.post('/auth/register', async (c) => {
  const body = await c.req.json<{
    email: string
    password: string
    name: string
  }>()

  // Validate input
  if (!body.email?.includes('@')) {
    return c.json({ error: 'Valid email is required' }, 400)
  }
  if (!body.password || body.password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }
  if (!body.name?.trim()) {
    return c.json({ error: 'Name is required' }, 400)
  }

  // Get or create UserDO by email (normalized)
  const email = body.email.toLowerCase().trim()
  const stub = c.env.USER_DO.get(c.env.USER_DO.idFromName(email))

  // Try to register
  const response = await stub.fetch(
    new Request('http://internal/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: body.password,
        name: body.name.trim(),
      }),
    })
  )

  if (!response.ok) {
    const error = await response.json<{ error: string }>()
    return c.json(error, response.status)
  }

  const user = await response.json<AuthUser>()

  // Generate token
  const token = await createToken(user, c.env.JWT_SECRET)

  return c.json(
    {
      user,
      token,
      expiresIn: '24h',
    },
    201
  )
})

// Login
app.post('/auth/login', async (c) => {
  const body = await c.req.json<{
    email: string
    password: string
  }>()

  if (!body.email || !body.password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const email = body.email.toLowerCase().trim()
  const stub = c.env.USER_DO.get(c.env.USER_DO.idFromName(email))

  // Try to login
  const response = await stub.fetch(
    new Request('http://internal/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: body.password }),
    })
  )

  if (!response.ok) {
    const error = await response.json<{ error: string }>()
    return c.json(error, response.status)
  }

  const user = await response.json<AuthUser>()

  // Generate token
  const token = await createToken(user, c.env.JWT_SECRET)

  return c.json({
    user,
    token,
    expiresIn: '24h',
  })
})

// ============================================================================
// Protected Routes
// ============================================================================

// Group protected routes
const protected_ = new Hono<{ Bindings: Env }>()

// Apply auth middleware to all protected routes
protected_.use('/*', async (c, next) => {
  return authMiddleware(c.env)(c, next)
})

// Get current user
protected_.get('/me', async (c) => {
  const user = c.get('user')
  const stub = c.env.USER_DO.get(c.env.USER_DO.idFromName(user.email))

  const response = await stub.fetch(new Request('http://internal/profile'))

  if (!response.ok) {
    return c.json({ error: 'User not found' }, 404)
  }

  return response
})

// Update current user
protected_.patch('/me', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ name?: string; password?: string }>()

  const stub = c.env.USER_DO.get(c.env.USER_DO.idFromName(user.email))

  const response = await stub.fetch(
    new Request('http://internal/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

  return response
})

// Refresh token
protected_.post('/refresh', async (c) => {
  const user = c.get('user')

  // Generate new token with fresh expiration
  const token = await createToken(user, c.env.JWT_SECRET)

  return c.json({
    token,
    expiresIn: '24h',
  })
})

// Get user by ID (admin or self only in real app)
protected_.get('/users/:id', async (c) => {
  const id = c.req.param('id')

  // In a real app, you'd have an index to look up users by ID
  // For this example, we return a simple response
  return c.json({
    message: 'User lookup by ID requires an index DO',
    requestedId: id,
  })
})

// Mount protected routes
app.route('/auth', protected_)

export default app
