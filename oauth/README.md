# @dotdo/oauth

OAuth 2.1 + PKCE client for dotdo, designed for Cloudflare Workers with zero Node.js dependencies.

## Overview

`@dotdo/oauth` provides a complete OAuth 2.1 implementation:

- PKCE (Proof Key for Code Exchange) per RFC 7636
- State token generation for CSRF protection
- Built-in providers (Google, GitHub, Microsoft)
- Session storage adapters (Memory, KV, D1)
- Hono middleware for authorization flows
- MCP (Model Context Protocol) OAuth 2.1 support per RFC 9728
- Web Crypto API based (runs in Workers, no Node.js)

## Installation

```bash
npm install @dotdo/oauth
```

## Quick Start

### Basic PKCE Flow

```typescript
import { generatePKCE, generateState, validatePKCE } from '@dotdo/oauth'

// 1. Generate PKCE pair and state for authorization request
const { verifier, challenge, method } = await generatePKCE()
const state = await generateState()

// Store verifier securely (e.g., session)
sessionStorage.setItem('pkce_verifier', verifier)
sessionStorage.setItem('oauth_state', state)

// 2. Build authorization URL
const authUrl = new URL('https://provider.com/authorize')
authUrl.searchParams.set('client_id', 'your-client-id')
authUrl.searchParams.set('redirect_uri', 'https://yourapp.com/callback')
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('code_challenge', challenge)
authUrl.searchParams.set('code_challenge_method', method)
authUrl.searchParams.set('state', state)

// 3. Redirect user to authUrl...

// 4. On callback, validate and exchange code
const isValid = await validatePKCE(storedVerifier, storedChallenge, 'S256')
```

### Using Providers

```typescript
import { createGoogleProvider, MemorySessionStore } from '@dotdo/oauth'

const google = createGoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: 'https://yourapp.com/callback',
  scopes: ['openid', 'email', 'profile'],
})

// Get authorization URL
const authUrl = google.getAuthorizationUrl(state, codeChallenge)

// Exchange code for tokens
const tokens = await google.exchangeCode(code, codeVerifier)

// Get user info
const user = await google.getUser(tokens.access_token)
```

### With Hono Middleware

```typescript
import { Hono } from 'hono'
import {
  oauthMiddleware,
  createAuthorizeHandler,
  createCallbackHandler,
  createGoogleProvider,
  MemorySessionStore,
} from '@dotdo/oauth'

const app = new Hono()
const sessionStore = new MemorySessionStore()

const google = createGoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: 'https://yourapp.com/oauth/callback',
})

// Protect routes with session validation
app.use('/api/*', oauthMiddleware({
  sessionStore,
  excludePaths: ['/api/public'],
}))

// Authorization endpoint
app.get('/oauth/authorize', createAuthorizeHandler({
  provider: google,
  sessionStore,
}))

// Callback endpoint
app.get('/oauth/callback', createCallbackHandler({
  provider: google,
  sessionStore,
  onSuccess: async (c, session) => {
    return c.redirect('/dashboard')
  },
}))

// Protected route
app.get('/api/profile', (c) => {
  const session = c.get('session')
  return c.json({ userId: session.userId })
})

export default app
```

## API Reference

### PKCE Functions

#### `generatePKCE(method?)`

Generate a complete PKCE pair (verifier + challenge).

```typescript
const { verifier, challenge, method } = await generatePKCE('S256')
```

**Parameters:**
- `method` - Challenge method: `'S256'` (default, recommended) or `'plain'`

**Returns:** `PKCEPair` with `verifier`, `challenge`, and `method`

#### `generateVerifier(byteLength?)`

Generate a cryptographically random code verifier.

```typescript
const verifier = await generateVerifier(32) // 43 characters
```

#### `createChallenge(verifier, method?)`

Create a code challenge from a verifier.

```typescript
const challenge = await createChallenge(verifier, 'S256')
```

#### `validatePKCE(verifier, challenge, method)`

Validate a PKCE code verifier against a stored challenge.

```typescript
const isValid = await validatePKCE(verifier, challenge, 'S256')
```

### State Functions

#### `generateState(byteLength?)`

Generate a cryptographically random state token.

```typescript
const state = await generateState()
```

#### `validateState(received, expected)`

Validate state token (timing-safe comparison).

```typescript
const isValid = validateState(receivedState, expectedState)
```

#### `createStateWithMetadata(metadata)`

Create state with embedded metadata (JSON encoded).

```typescript
const state = await createStateWithMetadata({
  returnTo: '/dashboard',
  provider: 'google',
})
```

#### `parseStateMetadata(state)`

Parse metadata from state token.

```typescript
const metadata = parseStateMetadata(state)
// { returnTo: '/dashboard', provider: 'google' }
```

### Providers

#### `createGoogleProvider(config)`

```typescript
const google = createGoogleProvider({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  redirectUri: 'https://yourapp.com/callback',
  scopes: ['openid', 'email', 'profile'],
  accessType: 'offline', // For refresh tokens
  prompt: 'consent',
  hostedDomain: 'example.com', // Restrict to domain
})
```

#### `createGitHubProvider(config)`

```typescript
const github = createGitHubProvider({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  redirectUri: 'https://yourapp.com/callback',
  scopes: ['user:email', 'read:user'],
})
```

#### `createMicrosoftProvider(config)`

```typescript
const microsoft = createMicrosoftProvider({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  redirectUri: 'https://yourapp.com/callback',
  tenant: 'common', // or specific tenant ID
  scopes: ['openid', 'email', 'profile'],
})
```

#### `createCustomProvider(config)`

For any OAuth 2.1 compliant provider:

```typescript
const custom = createCustomProvider({
  name: 'my-provider',
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  redirectUri: 'https://yourapp.com/callback',
  authorizationEndpoint: 'https://provider.com/authorize',
  tokenEndpoint: 'https://provider.com/token',
  userinfoEndpoint: 'https://provider.com/userinfo',
  scopes: ['openid', 'profile'],
})
```

### Session Storage

#### `MemorySessionStore`

In-memory storage (for testing/development):

```typescript
const store = new MemorySessionStore({
  ttl: 3600000, // 1 hour in milliseconds
})
```

#### `KVSessionStore`

Cloudflare KV storage:

```typescript
const store = new KVSessionStore({
  kv: env.SESSIONS,
  prefix: 'session:',
  ttl: 3600, // 1 hour in seconds
})
```

#### `D1SessionStore`

Cloudflare D1 storage:

```typescript
const store = new D1SessionStore({
  db: env.DB,
  tableName: 'sessions',
})

// Create table (run once)
await env.DB.exec(D1_SESSION_SCHEMA)
```

### Middleware

#### `oauthMiddleware(options)`

Session validation middleware for Hono.

```typescript
app.use('/*', oauthMiddleware({
  sessionStore,
  cookieName: 'session', // Default
  excludePaths: ['/public', '/health'],
  verifyToken: async (token) => {
    // Optional: Custom JWT verification
    return { sub: 'user-id', email: 'user@example.com' }
  },
}))
```

#### `createAuthorizeHandler(options)`

Creates the `/authorize` endpoint handler.

```typescript
app.get('/oauth/authorize', createAuthorizeHandler({
  provider: google,
  sessionStore,
}))
```

#### `createCallbackHandler(options)`

Creates the `/callback` endpoint handler.

```typescript
app.get('/oauth/callback', createCallbackHandler({
  provider: google,
  sessionStore,
  onSuccess: async (c, session) => {
    return c.redirect('/dashboard')
  },
  onError: async (c, error) => {
    return c.redirect('/login?error=' + error.message)
  },
}))
```

#### `createTokenEndpoint(options)`

Creates a token endpoint (for acting as an OAuth server).

```typescript
app.post('/oauth/token', createTokenEndpoint({
  sessionStore,
  issuer: 'https://yourapp.com',
  audience: 'api.yourapp.com',
}))
```

### MCP OAuth 2.1 Support

For Model Context Protocol servers per RFC 9728:

```typescript
import {
  createMCPServerMetadataHandler,
  createAuthServerMetadataHandler,
  createProtectedResourceMetadataHandler,
  createMCPAuthorizeHandler,
  createMCPCallbackHandler,
  createMCPTokenEndpoint,
} from '@dotdo/oauth'

const app = new Hono()

// Discovery endpoints
app.get('/.well-known/mcp-server', createMCPServerMetadataHandler({
  name: 'My MCP Server',
  version: '1.0.0',
  capabilities: ['tools', 'prompts'],
}))

app.get('/.well-known/oauth-authorization-server', createAuthServerMetadataHandler({
  issuer: 'https://yourapp.com',
  authorizationEndpoint: 'https://yourapp.com/oauth/authorize',
  tokenEndpoint: 'https://yourapp.com/oauth/token',
}))

// MCP-specific OAuth flow
app.get('/oauth/authorize', createMCPAuthorizeHandler({ /* ... */ }))
app.get('/oauth/callback', createMCPCallbackHandler({ /* ... */ }))
app.post('/oauth/token', createMCPTokenEndpoint({ /* ... */ }))
```

## Types

```typescript
import type {
  // PKCE
  PKCEMethod,
  PKCEPair,

  // OAuth
  AuthorizationRequest,
  TokenRequest,
  TokenResponse,
  OAuthError,

  // Provider
  OAuthProvider,
  OAuthProviderConfig,
  UserInfo,

  // Session
  SessionData,
  SessionStore,

  // Middleware
  OAuthMiddlewareOptions,
  CallbackHandlerOptions,

  // MCP
  MCPServerMetadata,
  AuthServerMetadata,
} from '@dotdo/oauth'
```

## Subpath Exports

Import specific modules for smaller bundles:

```typescript
import { generatePKCE } from '@dotdo/oauth/pkce'
import { generateState } from '@dotdo/oauth/state'
import { MemorySessionStore } from '@dotdo/oauth/storage'
import { createGoogleProvider } from '@dotdo/oauth/providers'
import { oauthMiddleware } from '@dotdo/oauth/middleware'
import { createMCPServerMetadataHandler } from '@dotdo/oauth/mcp'
```

## Related Packages

- [@dotdo/auth](/auth) - JWT/API key authentication middleware
- [@dotdo/api](/api) - Self-describing API framework
- [@dotdo/do](/do) - Durable Object base class

## License

MIT
