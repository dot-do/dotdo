# Supabase Auth. Without Supabase.

**Same API. Your servers. Zero vendor lock-in.**

```typescript
import { createClient } from '@dotdo/supabase'
import { DO } from 'dotdo'

export class AuthDO extends DO {
  private supabase = createClient(this.ctx)

  // Email/Password Authentication
  async signUp(email: string, password: string) {
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password
    })
    return { user: data.user, session: data.session, error }
  }

  // Social Login (Google, GitHub, etc.)
  async signInWithGoogle() {
    return this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://app.example.com/callback' }
    })
  }

  // Magic Link / Passwordless
  async sendMagicLink(email: string) {
    return this.supabase.auth.signInWithOtp({ email })
  }

  // Session Management
  async getSession(token: string) {
    return this.supabase.auth.getSession()
  }

  // Protected Route Middleware
  async requireAuth(token: string) {
    const { data: { user }, error } = await this.supabase.auth.getUser(token)
    if (error || !user) throw new Error('Unauthorized')
    return user
  }
}
```

## Why @dotdo/supabase?

| Supabase | @dotdo/supabase |
|----------|-----------------|
| Their servers | Your Durable Objects |
| Their database | Your SQLite at edge |
| Monthly bill grows | Flat compute pricing |
| Vendor lock-in | Drop-in portable |
| 99.9% SLA | 99.99% on edge |

## Installation

```bash
npm install dotdo @dotdo/supabase hono
npm install -D wrangler typescript @cloudflare/workers-types
```

## Features Demonstrated

### 1. Email/Password Signup

```typescript
// Client
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'secure-password-123',
})

// Server stores user in DO's SQLite
// Password hashed with Argon2id
// Session tokens signed with Ed25519
```

### 2. Social OAuth (Google, GitHub)

```typescript
// Initiate OAuth flow
const { data } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: 'https://app.example.com/auth/callback',
    scopes: 'email profile',
  },
})

// Handle callback
const { data: session } = await supabase.auth.exchangeCodeForSession(code)
```

### 3. Magic Link / OTP

```typescript
// Send magic link
await supabase.auth.signInWithOtp({
  email: 'user@example.com',
  options: {
    emailRedirectTo: 'https://app.example.com/welcome',
  },
})

// Or verify OTP code
await supabase.auth.verifyOtp({
  email: 'user@example.com',
  token: '123456',
  type: 'email',
})
```

### 4. Session Management

```typescript
// Get current session
const { data: { session } } = await supabase.auth.getSession()

// Refresh session
const { data: { session: newSession } } = await supabase.auth.refreshSession()

// Sign out
await supabase.auth.signOut()
```

### 5. JWT Verification

```typescript
// Verify JWT and get user
const { data: { user }, error } = await supabase.auth.getUser(jwt)

// Access custom claims
const role = user.app_metadata.role
const permissions = user.user_metadata.permissions
```

### 6. Protected Routes

```typescript
import { Hono } from 'hono'
import { createMiddleware } from '@dotdo/supabase/hono'

const app = new Hono()

// Auth middleware
const auth = createMiddleware({ supabase })

// Public route
app.get('/public', (c) => c.json({ message: 'Hello!' }))

// Protected route
app.get('/protected', auth, (c) => {
  const user = c.get('user')
  return c.json({ message: `Hello ${user.email}!` })
})

// Role-based access
app.get('/admin', auth, (c) => {
  const user = c.get('user')
  if (user.app_metadata.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return c.json({ message: 'Admin dashboard' })
})
```

## Configuration

Set your OAuth credentials in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "AUTH_JWT_SECRET": "your-jwt-secret",
    "AUTH_SITE_URL": "https://app.example.com"
  }
}
```

For OAuth providers, add secrets:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

## Multi-Factor Authentication (MFA)

```typescript
// Enroll TOTP
const { data } = await supabase.auth.mfa.enroll({
  factorType: 'totp',
  friendlyName: 'Authenticator App',
})
// Returns QR code and secret for user to scan

// Challenge MFA
const { data: challenge } = await supabase.auth.mfa.challenge({
  factorId: data.id,
})

// Verify MFA
const { data: session } = await supabase.auth.mfa.verify({
  factorId: data.id,
  challengeId: challenge.id,
  code: '123456',
})

// Get recovery codes
const { data: { codes } } = await supabase.auth.mfa.getRecoveryCodes()
// ['ABCD-EFGH-JKLM-NPQR', ...]
```

## Deployment

```bash
npm run deploy
```

Your auth server runs on 300+ edge locations with:
- 0ms cold starts
- Automatic TLS
- DDoS protection
- Global replication

## Architecture

```
User Request
     |
     v
Cloudflare Edge (300+ cities)
     |
     v
Worker (auth middleware)
     |
     v
AuthDO (Durable Object)
     |
     +---> SQLite (users, sessions)
     +---> KV (rate limiting)
     +---> R2 (profile images)
```

## License

MIT - Use however you want. No vendor lock-in, ever.

---

**Built with [dotdo](https://dotdo.dev)** - Build your 1-Person Unicorn
