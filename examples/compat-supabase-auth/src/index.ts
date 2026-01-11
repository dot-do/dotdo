/**
 * Supabase Auth Compatible Worker
 *
 * Full Supabase Auth API compatibility on Cloudflare Workers + Durable Objects.
 * Drop-in replacement for @supabase/auth-js with your own infrastructure.
 *
 * Endpoints:
 * - POST /auth/v1/signup - Sign up with email/password
 * - POST /auth/v1/token?grant_type=password - Sign in with password
 * - POST /auth/v1/token?grant_type=refresh_token - Refresh session
 * - POST /auth/v1/otp - Request magic link / OTP
 * - POST /auth/v1/verify - Verify OTP
 * - GET  /auth/v1/user - Get current user
 * - PUT  /auth/v1/user - Update user
 * - POST /auth/v1/logout - Sign out
 * - POST /auth/v1/recover - Password recovery
 * - GET  /auth/v1/authorize - OAuth initiation
 * - GET  /auth/v1/callback - OAuth callback
 *
 * @see https://supabase.com/docs/reference/javascript/auth-api
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AuthDO, type Env as AuthEnv } from './objects/AuthDO'
import { SessionDO } from './objects/SessionDO'

// Re-export the Durable Objects for Cloudflare
export { AuthDO } from './objects/AuthDO'
export { SessionDO } from './objects/SessionDO'

// ============================================================================
// TYPES
// ============================================================================

interface Env extends AuthEnv {
  AUTH_DO: DurableObjectNamespace
  SESSION_DO: DurableObjectNamespace
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the Auth DO stub for a namespace (e.g., tenant ID or 'default')
 */
function getAuthDO(env: Env, namespace: string = 'default'): DurableObjectStub {
  const id = env.AUTH_DO.idFromName(namespace)
  return env.AUTH_DO.get(id)
}

/**
 * Get the Session DO stub for a session ID
 */
function getSessionDO(env: Env, sessionId: string): DurableObjectStub {
  const id = env.SESSION_DO.idFromName(sessionId)
  return env.SESSION_DO.get(id)
}

/**
 * Extract access token from request
 */
function getAccessToken(c: { req: { header: (name: string) => string | undefined } }): string | undefined {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  return undefined
}

/**
 * Call RPC method on Durable Object
 */
async function callRPC(stub: DurableObjectStub, method: string, ...params: unknown[]): Promise<unknown> {
  const response = await stub.fetch('http://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  })

  const result = (await response.json()) as { result?: unknown; error?: { message: string } }
  if (result.error) {
    throw new Error(result.error.message)
  }
  return result.result
}

// ============================================================================
// HONO APP
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// CORS middleware
app.use(
  '/auth/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'apikey', 'X-Client-Info'],
    exposeHeaders: ['Content-Length', 'X-Request-Id'],
    maxAge: 86400,
    credentials: true,
  })
)

// ============================================================================
// SUPABASE AUTH API ENDPOINTS
// ============================================================================

/**
 * POST /auth/v1/signup
 * Sign up with email/password
 */
app.post('/auth/v1/signup', async (c) => {
  const body = await c.req.json()
  const authDO = getAuthDO(c.env)

  const result = await callRPC(authDO, 'signUp', {
    email: body.email,
    phone: body.phone,
    password: body.password,
    options: body.options,
  })

  return c.json(result)
})

/**
 * POST /auth/v1/token
 * Sign in with password or refresh token
 */
app.post('/auth/v1/token', async (c) => {
  const grantType = c.req.query('grant_type')
  const body = await c.req.json()
  const authDO = getAuthDO(c.env)

  if (grantType === 'password') {
    const result = await callRPC(authDO, 'signInWithPassword', {
      email: body.email,
      phone: body.phone,
      password: body.password,
    })
    return c.json(result)
  }

  if (grantType === 'refresh_token') {
    const result = await callRPC(authDO, 'refreshSession', body.refresh_token)
    return c.json(result)
  }

  return c.json({ error: { message: 'Invalid grant_type' } }, 400)
})

/**
 * POST /auth/v1/otp
 * Request magic link or OTP
 */
app.post('/auth/v1/otp', async (c) => {
  const body = await c.req.json()
  const authDO = getAuthDO(c.env)

  const result = await callRPC(authDO, 'signInWithOtp', {
    email: body.email,
    phone: body.phone,
    options: body.options,
  })

  return c.json(result)
})

/**
 * POST /auth/v1/verify
 * Verify OTP / magic link
 */
app.post('/auth/v1/verify', async (c) => {
  const body = await c.req.json()
  const authDO = getAuthDO(c.env)

  const result = await callRPC(authDO, 'verifyOtp', {
    email: body.email,
    phone: body.phone,
    token: body.token,
    type: body.type,
    options: body.options,
  })

  return c.json(result)
})

/**
 * GET /auth/v1/user
 * Get current user
 */
app.get('/auth/v1/user', async (c) => {
  const accessToken = getAccessToken(c)
  if (!accessToken) {
    return c.json({ data: { user: null }, error: { message: 'No access token' } }, 401)
  }

  const authDO = getAuthDO(c.env)
  const result = await callRPC(authDO, 'getUser', accessToken)

  return c.json(result)
})

/**
 * PUT /auth/v1/user
 * Update user attributes
 */
app.put('/auth/v1/user', async (c) => {
  const accessToken = getAccessToken(c)
  if (!accessToken) {
    return c.json({ data: { user: null }, error: { message: 'No access token' } }, 401)
  }

  const body = await c.req.json()
  const authDO = getAuthDO(c.env)
  const result = await callRPC(authDO, 'updateUser', accessToken, body)

  return c.json(result)
})

/**
 * POST /auth/v1/logout
 * Sign out
 */
app.post('/auth/v1/logout', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const authDO = getAuthDO(c.env)
  const result = await callRPC(authDO, 'signOut', body.refresh_token, body)

  return c.json(result)
})

/**
 * POST /auth/v1/recover
 * Password recovery
 */
app.post('/auth/v1/recover', async (c) => {
  const body = await c.req.json()
  const authDO = getAuthDO(c.env)
  const result = await callRPC(authDO, 'resetPasswordForEmail', body.email, body.options)

  return c.json(result)
})

/**
 * GET /auth/v1/authorize
 * Initiate OAuth flow
 */
app.get('/auth/v1/authorize', async (c) => {
  const provider = c.req.query('provider')
  const redirectTo = c.req.query('redirect_to')
  const scopes = c.req.query('scopes')

  if (!provider) {
    return c.json({ error: { message: 'Provider is required' } }, 400)
  }

  const authDO = getAuthDO(c.env)
  const result = (await callRPC(authDO, 'signInWithOAuth', {
    provider,
    options: {
      redirectTo,
      scopes,
    },
  })) as { data?: { url?: string }; error?: { message: string } }

  if (result.error) {
    return c.json(result, 400)
  }

  // Redirect to OAuth provider
  if (result.data?.url) {
    return c.redirect(result.data.url)
  }

  return c.json(result)
})

/**
 * GET /auth/v1/callback
 * OAuth callback handler
 */
app.get('/auth/v1/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')
  const errorDescription = c.req.query('error_description')

  // Handle OAuth error
  if (error) {
    const redirectUrl = c.env.AUTH_SITE_URL ?? 'http://localhost:3000'
    return c.redirect(`${redirectUrl}/auth/error?error=${error}&error_description=${encodeURIComponent(errorDescription ?? '')}`)
  }

  if (!code) {
    return c.json({ error: { message: 'Missing code parameter' } }, 400)
  }

  const authDO = getAuthDO(c.env)
  const result = (await callRPC(authDO, 'exchangeCodeForSession', code, state)) as {
    data?: { session?: { access_token?: string; refresh_token?: string } }
    error?: { message: string }
  }

  if (result.error) {
    const redirectUrl = c.env.AUTH_SITE_URL ?? 'http://localhost:3000'
    return c.redirect(`${redirectUrl}/auth/error?error=${encodeURIComponent(result.error.message)}`)
  }

  // Redirect to app with tokens
  const redirectUrl = c.env.AUTH_REDIRECT_URL ?? c.env.AUTH_SITE_URL ?? 'http://localhost:3000'
  const session = result.data?.session
  if (session) {
    const params = new URLSearchParams({
      access_token: session.access_token ?? '',
      refresh_token: session.refresh_token ?? '',
      token_type: 'bearer',
    })
    return c.redirect(`${redirectUrl}#${params.toString()}`)
  }

  return c.redirect(redirectUrl)
})

// ============================================================================
// MFA ENDPOINTS
// ============================================================================

/**
 * POST /auth/v1/factors
 * Enroll MFA factor
 */
app.post('/auth/v1/factors', async (c) => {
  const accessToken = getAccessToken(c)
  if (!accessToken) {
    return c.json({ data: null, error: { message: 'No access token' } }, 401)
  }

  const body = await c.req.json()
  const authDO = getAuthDO(c.env)
  const result = await callRPC(authDO, 'mfaEnroll', accessToken, body)

  return c.json(result)
})

/**
 * POST /auth/v1/factors/:factorId/challenge
 * Challenge MFA factor
 */
app.post('/auth/v1/factors/:factorId/challenge', async (c) => {
  const accessToken = getAccessToken(c)
  if (!accessToken) {
    return c.json({ data: null, error: { message: 'No access token' } }, 401)
  }

  const factorId = c.req.param('factorId')
  const authDO = getAuthDO(c.env)
  const result = await callRPC(authDO, 'mfaChallenge', accessToken, { factorId })

  return c.json(result)
})

/**
 * POST /auth/v1/factors/:factorId/verify
 * Verify MFA factor
 */
app.post('/auth/v1/factors/:factorId/verify', async (c) => {
  const accessToken = getAccessToken(c)
  if (!accessToken) {
    return c.json({ data: null, error: { message: 'No access token' } }, 401)
  }

  const factorId = c.req.param('factorId')
  const body = await c.req.json()
  const authDO = getAuthDO(c.env)
  const result = await callRPC(authDO, 'mfaVerify', accessToken, {
    factorId,
    challengeId: body.challenge_id,
    code: body.code,
  })

  return c.json(result)
})

// ============================================================================
// SESSION MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /auth/v1/session
 * Get current session
 */
app.get('/auth/v1/session', async (c) => {
  const accessToken = getAccessToken(c)
  if (!accessToken) {
    return c.json({ data: { session: null }, error: null })
  }

  const authDO = getAuthDO(c.env)
  const result = await callRPC(authDO, 'getSession', accessToken)

  return c.json(result)
})

// ============================================================================
// ADMIN ENDPOINTS (for testing)
// ============================================================================

/**
 * GET /admin/users
 * List all users (admin only, for testing)
 */
app.get('/admin/users', async (c) => {
  // In production, add proper admin authentication
  const authDO = getAuthDO(c.env)

  // Access internal storage directly via RPC (for demo purposes)
  const response = await authDO.fetch('http://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSession',
      params: [],
    }),
  })

  return c.json({
    message: 'Admin endpoint - implement proper auth for production',
  })
})

// ============================================================================
// HEALTH & INFO
// ============================================================================

/**
 * GET /health
 * Health check
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'compat-supabase-auth',
    environment: c.env.ENVIRONMENT ?? 'unknown',
    timestamp: new Date().toISOString(),
  })
})

/**
 * GET /
 * Landing page
 */
app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Supabase Auth - dotdo</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #22c55e; --muted: #71717a; --code-bg: #1f1f1f; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.7; max-width: 900px; margin: 0 auto; }
    h1 { color: var(--accent); margin-bottom: 0.25rem; font-size: 2.5rem; }
    .tagline { font-size: 1.5rem; color: var(--fg); margin-bottom: 2rem; font-weight: 300; }
    .highlight { color: var(--accent); }
    code { background: var(--code-bg); padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; overflow-x: auto; line-height: 1.5; }
    pre code { background: none; padding: 0; }
    .section { margin: 3rem 0; }
    .section h2 { color: var(--accent); border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
    .card { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .card h3 { margin: 0 0 0.5rem 0; color: var(--fg); }
    .card p { margin: 0; color: var(--muted); font-size: 0.95rem; }
    .endpoints { display: grid; gap: 0.5rem; margin: 1rem 0; }
    .endpoint { background: var(--code-bg); padding: 0.75rem 1rem; border-radius: 6px; display: flex; gap: 1rem; align-items: center; }
    .endpoint-method { color: var(--accent); font-weight: bold; min-width: 50px; font-size: 0.85rem; }
    .endpoint-path { color: var(--fg); font-family: monospace; font-size: 0.9rem; }
    a { color: var(--accent); }
    footer { margin-top: 4rem; padding-top: 2rem; border-top: 1px solid #333; color: var(--muted); }
  </style>
</head>
<body>
  <h1>@dotdo/supabase-auth</h1>
  <p class="tagline">Supabase Auth. <span class="highlight">Your infrastructure.</span></p>

  <div class="section">
    <p>
      Drop-in replacement for <code>@supabase/auth-js</code> running on Cloudflare Workers + Durable Objects.
      Same API, your servers, zero vendor lock-in.
    </p>
  </div>

  <div class="section">
    <h2>Features</h2>
    <div class="grid">
      <div class="card">
        <h3>Email/Password</h3>
        <p>Secure authentication with PBKDF2 password hashing</p>
      </div>
      <div class="card">
        <h3>Magic Links</h3>
        <p>Passwordless login via email OTP</p>
      </div>
      <div class="card">
        <h3>OAuth Providers</h3>
        <p>Google, GitHub, and more social logins</p>
      </div>
      <div class="card">
        <h3>JWT Tokens</h3>
        <p>HS256 signed access and refresh tokens</p>
      </div>
      <div class="card">
        <h3>Session Management</h3>
        <p>Refresh token rotation and multi-device support</p>
      </div>
      <div class="card">
        <h3>MFA/TOTP</h3>
        <p>Two-factor authentication with authenticator apps</p>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>API Endpoints</h2>
    <div class="endpoints">
      <div class="endpoint">
        <span class="endpoint-method">POST</span>
        <span class="endpoint-path">/auth/v1/signup</span>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">POST</span>
        <span class="endpoint-path">/auth/v1/token?grant_type=password</span>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">POST</span>
        <span class="endpoint-path">/auth/v1/token?grant_type=refresh_token</span>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">POST</span>
        <span class="endpoint-path">/auth/v1/otp</span>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">POST</span>
        <span class="endpoint-path">/auth/v1/verify</span>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">GET</span>
        <span class="endpoint-path">/auth/v1/user</span>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">PUT</span>
        <span class="endpoint-path">/auth/v1/user</span>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">POST</span>
        <span class="endpoint-path">/auth/v1/logout</span>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">GET</span>
        <span class="endpoint-path">/auth/v1/authorize</span>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">GET</span>
        <span class="endpoint-path">/auth/v1/callback</span>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Quick Start</h2>
    <pre><code>// Same API as @supabase/supabase-js
import { createClient } from '@dotdo/supabase'

const supabase = createClient(ctx, tenantId)

// Sign up
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'secure-password'
})

// Sign in
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'secure-password'
})

// Get user
const { data: { user } } = await supabase.auth.getUser()
</code></pre>
  </div>

  <div class="section">
    <h2>Test the API</h2>
    <pre><code># Sign up
curl -X POST ${new URL(c.req.url).origin}/auth/v1/signup \\
  -H "Content-Type: application/json" \\
  -d '{"email": "test@example.com", "password": "password123"}'

# Sign in
curl -X POST "${new URL(c.req.url).origin}/auth/v1/token?grant_type=password" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "test@example.com", "password": "password123"}'

# Get user
curl ${new URL(c.req.url).origin}/auth/v1/user \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
</code></pre>
  </div>

  <footer>
    <p>Part of <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
    <p><a href="/health">Health Check</a> | <a href="https://github.com/drivly/dotdo">GitHub</a></p>
  </footer>
</body>
</html>
  `)
})

export default app
