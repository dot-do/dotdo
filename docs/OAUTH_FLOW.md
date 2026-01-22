# oauth.do Authentication Flow

This document describes the complete OAuth authentication flow for dotdo, including both the CLI authentication via Device Authorization Grant and the server-side OAuth 2.1 + PKCE implementation.

## Overview

The dotdo authentication system consists of two main components:

1. **CLI Authentication** (`dotdo login/logout/whoami`) - Uses OAuth 2.0 Device Authorization Grant (RFC 8628)
2. **Server-side OAuth** (`@dotdo/oauth`) - OAuth 2.1 + PKCE for web applications

Both components integrate with `oauth.do` as the central OAuth provider.

## Architecture

```
                     CLI Flow (Device Auth)
                    +---------------------+
                    |                     |
    dotdo CLI  ---->|    oauth.do         |----> Identity Provider
       |            | /device/code        |      (WorkOS/id.org.ai)
       |            | /token              |
       |            | /userinfo           |
       v            +---------------------+
  ~/.dotdo/                  |
  credentials.json           |
                             v
                     Web Flow (PKCE)
                    +---------------------+
                    |                     |
    Browser   ----->|   @dotdo/oauth      |----> GitHub, Google, etc.
       |            | /auth/login         |
       |            | /auth/callback      |
       |            | /auth/token         |
       v            +---------------------+
  Session Cookie           |
  (HttpOnly)               v
                    @dotdo/auth
                    (JWT validation)
```

## CLI Authentication (Device Authorization Grant)

### Commands

| Command | Description |
|---------|-------------|
| `dotdo login` | Initiate OAuth login flow |
| `dotdo logout` | Clear stored credentials |
| `dotdo whoami` | Display current user info |

### Flow Diagram

```
User                CLI                 oauth.do              Browser
 |                   |                      |                     |
 |  dotdo login      |                      |                     |
 |------------------>|                      |                     |
 |                   |  POST /device/code   |                     |
 |                   |--------------------->|                     |
 |                   |  device_code,        |                     |
 |                   |  user_code,          |                     |
 |                   |  verification_uri    |                     |
 |                   |<---------------------|                     |
 |                   |                      |                     |
 |  "Enter code:     |                      |                     |
 |   ABCD-1234"      |                      |                     |
 |<------------------|                      |                     |
 |                   |  Opens browser       |                     |
 |                   |--------------------------------------------->|
 |                   |                      |                     |
 |                   |  Poll: POST /token   |                     |
 |                   |--------------------->|                     |
 |                   |  authorization_pending                     |
 |                   |<---------------------|                     |
 |                   |                      |                     |
 |                   |        ... user authenticates ...          |
 |                   |                      |                     |
 |                   |  Poll: POST /token   |                     |
 |                   |--------------------->|                     |
 |                   |  access_token,       |                     |
 |                   |  refresh_token       |                     |
 |                   |<---------------------|                     |
 |                   |                      |                     |
 |  "Login           |  Store in           |                     |
 |   successful!"    |  ~/.dotdo/          |                     |
 |<------------------|  credentials.json    |                     |
```

### Endpoints (oauth.do)

#### POST /device/code

Request a device code for CLI authentication.

**Request:**
```bash
curl -X POST https://oauth.do/device/code \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=dotdo-cli&scope=openid profile email"
```

**Response:**
```json
{
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
  "user_code": "ABCD-1234",
  "verification_uri": "https://oauth.do/device",
  "verification_uri_complete": "https://oauth.do/device?user_code=ABCD-1234",
  "expires_in": 1800,
  "interval": 5
}
```

#### POST /token

Exchange device code for tokens (Device Authorization Grant) or refresh tokens.

**Device Authorization Grant:**
```bash
curl -X POST https://oauth.do/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
  -d "device_code=GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS" \
  -d "client_id=dotdo-cli"
```

**Refresh Token Grant:**
```bash
curl -X POST https://oauth.do/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=your_refresh_token" \
  -d "client_id=dotdo-cli"
```

**Success Response:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "v1.MRjRk2Y7q5mLSa...",
  "scope": "openid profile email"
}
```

**Pending Response (user hasn't authenticated yet):**
```json
{
  "error": "authorization_pending",
  "error_description": "User has not yet completed authorization"
}
```

**Error Responses:**
| Error | Description |
|-------|-------------|
| `authorization_pending` | User hasn't completed authentication yet |
| `slow_down` | Polling too frequently, increase interval |
| `access_denied` | User denied authorization |
| `expired_token` | Device code has expired |

#### GET /userinfo

Fetch authenticated user information.

**Request:**
```bash
curl https://oauth.do/userinfo \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response:**
```json
{
  "id": "user_01H2X3Y4Z5",
  "email": "user@example.com",
  "name": "John Doe",
  "picture": "https://example.com/avatar.jpg"
}
```

### Token Storage

Tokens are stored locally in `~/.dotdo/credentials.json`:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "refresh_token": "v1.MRjRk2Y7q5mLSa...",
  "expires_at": 1705881600000,
  "scope": "openid profile email",
  "created_at": 1705878000000
}
```

**Security:**
- Directory created with mode `0o700` (owner only)
- Credentials file created with mode `0o600` (owner read/write only)

### CLI Usage Examples

```bash
# Interactive OAuth login (opens browser)
dotdo login

# Direct token login (for CI/CD)
dotdo login --token YOUR_ACCESS_TOKEN

# Login without opening browser
dotdo login --no-browser

# Check current user
dotdo whoami

# JSON output
dotdo whoami --json

# Verbose output
dotdo whoami --verbose

# Logout
dotdo logout
```

### CI/CD Integration

For CI/CD pipelines, use the `--token` flag or set the `DO_TOKEN` environment variable:

```bash
# Option 1: Direct token flag
dotdo login --token $DOTDO_API_TOKEN

# Option 2: Environment variable (used by deploy command)
export DO_TOKEN=your_access_token
dotdo deploy
```

## Server-Side OAuth (PKCE Flow)

The `@dotdo/oauth` package provides OAuth 2.1 + PKCE for web applications.

### Flow Diagram

```
User              Application           Provider          Session Store
 |                    |                    |                    |
 |  GET /auth/login   |                    |                    |
 |------------------>|                    |                    |
 |                    |  Generate PKCE    |                    |
 |                    |  (verifier +      |                    |
 |                    |   challenge)      |                    |
 |                    |                    |                    |
 |                    |  Store PKCE + State                    |
 |                    |---------------------------------------->|
 |                    |                    |                    |
 |  302 Redirect      |                    |                    |
 |<-------------------|                    |                    |
 |                    |                    |                    |
 |  Authorize at Provider                  |                    |
 |---------------------------------------->|                    |
 |                    |                    |                    |
 |  302 Callback      |                    |                    |
 |  ?code=...&state=  |                    |                    |
 |------------------>|                    |                    |
 |                    |  Validate state   |                    |
 |                    |<----------------------------------------|
 |                    |                    |                    |
 |                    |  Exchange code +   |                    |
 |                    |  verifier for     |                    |
 |                    |  tokens           |                    |
 |                    |------------------->|                    |
 |                    |  access_token +    |                    |
 |                    |  refresh_token    |                    |
 |                    |<-------------------|                    |
 |                    |                    |                    |
 |                    |  Get user info    |                    |
 |                    |------------------->|                    |
 |                    |  User profile     |                    |
 |                    |<-------------------|                    |
 |                    |                    |                    |
 |                    |  Create session                        |
 |                    |---------------------------------------->|
 |                    |                    |                    |
 |  Set-Cookie +      |                    |                    |
 |  302 Redirect      |                    |                    |
 |<-------------------|                    |                    |
```

### Package Structure

```
@dotdo/oauth/
├── core/
│   ├── pkce.ts      # PKCE generation and validation
│   ├── state.ts     # State token with metadata
│   └── types.ts     # TypeScript interfaces
├── providers/
│   ├── interface.ts # OAuthProvider interface
│   ├── registry.ts  # Multi-provider registry
│   ├── github.ts    # GitHub provider
│   ├── google.ts    # Google provider
│   ├── microsoft.ts # Microsoft provider
│   └── custom.ts    # Custom provider builder
├── storage/
│   ├── interface.ts # SessionStore interface
│   ├── memory.ts    # In-memory store
│   ├── kv.ts        # Cloudflare KV store
│   └── d1.ts        # Cloudflare D1 store
└── middleware/
    ├── authorize.ts       # Login initiation handler
    ├── callback.ts        # OAuth callback handler
    ├── token.ts           # Token refresh endpoint
    └── oauth-middleware.ts # Session validation middleware
```

### Code Examples

#### Basic Setup with Single Provider

```typescript
import { Hono } from 'hono'
import {
  createGitHubProvider,
  createAuthorizeHandler,
  createCallbackHandler,
  oauthMiddleware,
  MemorySessionStore,
} from '@dotdo/oauth'

const app = new Hono()

// Configure provider
const github = createGitHubProvider({
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  redirectUri: 'https://app.example.com/auth/callback',
  scopes: ['read:user', 'user:email'],
})

// Session storage
const sessionStore = new MemorySessionStore()

// In-memory PKCE/state storage (use KV in production)
const pkceStore = new Map()
const stateStore = new Map()

// Login endpoint
app.get('/auth/login', createAuthorizeHandler({
  provider: github,
  storePKCE: async (pkce, c) => {
    const sessionId = crypto.randomUUID()
    pkceStore.set(sessionId, pkce)
    // Set temporary cookie for callback
    c.header('Set-Cookie', `pkce_session=${sessionId}; HttpOnly; Path=/`)
  },
  storeState: async (state, c) => {
    const sessionId = c.req.header('Cookie')?.match(/pkce_session=([^;]+)/)?.[1]
    if (sessionId) stateStore.set(sessionId, state)
  },
}))

// Callback endpoint
app.get('/auth/callback', createCallbackHandler({
  provider: github,
  sessionStore,
  getStoredPKCE: async (c) => {
    const sessionId = c.req.header('Cookie')?.match(/pkce_session=([^;]+)/)?.[1]
    return pkceStore.get(sessionId)
  },
  getStoredState: async (c) => {
    const sessionId = c.req.header('Cookie')?.match(/pkce_session=([^;]+)/)?.[1]
    return stateStore.get(sessionId)
  },
  cookieOptions: {
    secure: true,
    sameSite: 'Lax',
  },
}))

// Protected routes
app.use('/api/*', oauthMiddleware({
  sessionStore,
  excludePaths: ['/api/public', '/api/health'],
}))

app.get('/api/me', (c) => {
  const session = c.get('session')
  return c.json({
    userId: session.userId,
    provider: session.provider,
    email: session.metadata?.email,
  })
})

export default app
```

#### Multi-Provider Setup

```typescript
import {
  ProviderRegistry,
  createGitHubProvider,
  createGoogleProvider,
  createAuthorizeHandler,
} from '@dotdo/oauth'

// Create registry
const registry = new ProviderRegistry()

// Register providers
registry.register(createGitHubProvider({
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  redirectUri: 'https://app.example.com/auth/callback',
}))

registry.register(createGoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://app.example.com/auth/callback',
}))

// Login with provider selection
app.get('/auth/login', createAuthorizeHandler({
  registry,
  defaultProvider: 'github',
  storePKCE: async (pkce, c) => { /* ... */ },
  storeState: async (state, c) => { /* ... */ },
}))

// Usage: /auth/login?provider=google
```

#### Cloudflare KV Session Storage

```typescript
import { KVSessionStore } from '@dotdo/oauth'

export default {
  async fetch(request: Request, env: Env) {
    const sessionStore = new KVSessionStore(env.SESSIONS, {
      defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
    })

    const app = new Hono()

    app.use('/api/*', oauthMiddleware({
      sessionStore,
    }))

    return app.fetch(request, env)
  },
}
```

#### Integration with @dotdo/auth JWT

```typescript
import { oauthMiddleware } from '@dotdo/oauth'
import { verifyToken } from '@dotdo/auth'

app.use('/api/*', oauthMiddleware({
  sessionStore,
  // Support both session cookies and JWT tokens
  verifyToken: async (token) => {
    try {
      const payload = await verifyToken(token, {
        issuer: 'https://oauth.do',
      })
      return { sub: payload.sub, email: payload.email }
    } catch {
      return null
    }
  },
}))
```

### PKCE Implementation

The package implements PKCE (Proof Key for Code Exchange) per RFC 7636:

```typescript
import { generatePKCE, validatePKCE } from '@dotdo/oauth'

// Generate verifier + challenge
const { verifier, challenge, method } = await generatePKCE()
// verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
// challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
// method: "S256"

// Store verifier securely, send challenge with auth request
const authUrl = new URL('https://provider.com/authorize')
authUrl.searchParams.set('code_challenge', challenge)
authUrl.searchParams.set('code_challenge_method', method)

// On callback, validate verifier
const isValid = await validatePKCE(verifier, storedChallenge, 'S256')
```

### State Token with Metadata

```typescript
import { createStateWithMetadata, parseStateMetadata } from '@dotdo/oauth'

// Create state with custom metadata
const state = await createStateWithMetadata({
  redirectUri: '/dashboard',
  provider: 'github',
  customData: { inviteCode: 'abc123' },
})

// Parse metadata from state
const metadata = parseStateMetadata(state)
// { redirectUri: '/dashboard', provider: 'github', customData: {...} }
```

## Security Considerations

### Token Security

1. **Access tokens** are short-lived (typically 1 hour)
2. **Refresh tokens** are stored securely and used to obtain new access tokens
3. **PKCE** prevents authorization code interception attacks
4. **State tokens** prevent CSRF attacks

### Storage Security

| Storage | Security Measures |
|---------|-------------------|
| CLI credentials | File permissions 0o600, directory 0o700 |
| Session cookies | HttpOnly, Secure, SameSite=Lax/Strict |
| KV/D1 storage | Encrypted at rest by Cloudflare |

### Best Practices

1. Always use HTTPS in production
2. Set appropriate cookie options (`Secure`, `SameSite`)
3. Implement token rotation on privilege changes
4. Use short session TTLs
5. Validate state parameter on every callback
6. Store PKCE verifier server-side, never in client

## Missing Implementation Items

The following items are noted as incomplete in the current implementation:

### oauth.do Server

The CLI commands point to `https://oauth.do` endpoints, but the actual oauth.do server implementation is in a separate repository/deployment. The current implementation:

- CLI login uses Device Authorization Grant (RFC 8628) - **fully implemented in CLI**
- Server endpoints (`/device/code`, `/token`, `/userinfo`) - **need to be deployed at oauth.do**

### deploy.ts Authentication

The `deploy.ts` command has a TODO for oauth.do integration:

```typescript
// deploy.ts line 74-75
// TODO: Replace with actual oauth.do/node when available
async function ensureLoggedIn(options) {
  // Currently returns mock token
}
```

This should be replaced with:

```typescript
import { getStoredToken, login } from './login'

async function ensureLoggedIn(options) {
  const token = await getStoredToken()

  if (token && !isTokenExpired(token)) {
    return { token: token.access_token, isNewLogin: false }
  }

  // Trigger login flow
  await login({ noBrowser: !options.openBrowser })
  const newToken = await getStoredToken()

  return { token: newToken.access_token, isNewLogin: true }
}
```

### Roadmap Items

From `@dotdo/auth` README:

- [ ] Full JWT validation (RS256, ES256)
- [ ] JWKS endpoint support
- [ ] Token refresh middleware
- [ ] Rate limiting per user/key
- [ ] Audit logging

## Related Documentation

- [RFC 7636 - PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 8628 - Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
- [OAuth 2.1 Draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10)
- [@dotdo/auth README](/auth/README.md)
- [@dotdo/oauth package](/oauth/)

## File References

| File | Description |
|------|-------------|
| `/Users/nathanclevenger/projects/dotdo/dotdo/commands/login.ts` | CLI login implementation |
| `/Users/nathanclevenger/projects/dotdo/dotdo/commands/logout.ts` | CLI logout implementation |
| `/Users/nathanclevenger/projects/dotdo/dotdo/commands/whoami.ts` | CLI whoami implementation |
| `/Users/nathanclevenger/projects/dotdo/dotdo/commands/deploy.ts` | Deploy command with auth TODO |
| `/Users/nathanclevenger/projects/dotdo/oauth/src/index.ts` | OAuth package exports |
| `/Users/nathanclevenger/projects/dotdo/oauth/src/core/pkce.ts` | PKCE implementation |
| `/Users/nathanclevenger/projects/dotdo/oauth/src/middleware/authorize.ts` | Login handler |
| `/Users/nathanclevenger/projects/dotdo/oauth/src/middleware/callback.ts` | Callback handler |
| `/Users/nathanclevenger/projects/dotdo/oauth/src/middleware/token.ts` | Token refresh endpoint |
| `/Users/nathanclevenger/projects/dotdo/auth/README.md` | Auth package documentation |
