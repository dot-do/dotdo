# @dotdo/oauth

> OAuth 2.1 + PKCE for Cloudflare Workers

## OAuth Shouldn't Be This Hard

You need to add "Login with Google" to your app. Simple, right?

Then you read the OAuth spec. And PKCE. And state tokens. And CSRF protection. And session management. And suddenly you're three days deep in RFCs, debugging cryptic token exchange failures, and questioning your career choices.

**OAuth is notoriously complex:**

- PKCE requires SHA-256 hashing and base64url encoding
- State tokens need cryptographic randomness and timing-safe comparison
- Session storage must handle TTL, rotation, and cross-request persistence
- Each provider (Google, GitHub, Microsoft) has subtle differences
- One mistake and you have a security vulnerability

## Make OAuth Easy

```typescript
import { Hono } from 'hono'
import {
  oauthMiddleware,
  createAuthorizeHandler,
  createCallbackHandler,
  createGoogleProvider,
  KVSessionStore,
} from '@dotdo/oauth'

const app = new Hono()

const google = createGoogleProvider({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  redirectUri: 'https://yourapp.com/auth/callback',
})

const sessions = new KVSessionStore(env.SESSIONS)

// Login endpoint
app.get('/auth/login', createAuthorizeHandler({
  provider: google,
  storePKCE: async (pkce, c) => { /* store in session */ },
  storeState: async (state, c) => { /* store in session */ },
}))

// OAuth callback
app.get('/auth/callback', createCallbackHandler({
  provider: google,
  sessionStore: sessions,
  getStoredPKCE: async (c) => { /* retrieve from session */ },
  getStoredState: async (c) => { /* retrieve from session */ },
}))

// Protect your routes
app.use('/api/*', oauthMiddleware({ sessionStore: sessions }))

// That's it. Secure OAuth with session management.
```

## Features

- **OAuth 2.1 + PKCE** - Modern, secure by default. S256 challenge method, timing-safe comparisons
- **Multiple Providers** - Google, GitHub, Microsoft built-in, plus custom provider support
- **Session Storage** - Memory, KV, and D1 adapters with automatic TTL expiration
- **MCP Support** - Full Model Context Protocol OAuth 2.1 (RFC 9728) compliance
- **Workers Native** - Web Crypto API only, zero Node.js dependencies

## Quick Start

### Install

```bash
npm install @dotdo/oauth
```

### 1. Create a Provider

```typescript
import { createGoogleProvider } from '@dotdo/oauth'

const google = createGoogleProvider({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  redirectUri: 'https://yourapp.com/callback',
  scopes: ['openid', 'email', 'profile'],
})
```

### 2. Choose Session Storage

```typescript
// For development
import { MemorySessionStore } from '@dotdo/oauth'
const sessions = new MemorySessionStore()

// For production with Cloudflare KV
import { KVSessionStore } from '@dotdo/oauth'
const sessions = new KVSessionStore(env.SESSIONS)

// For production with Cloudflare D1
import { D1SessionStore, D1_SESSION_SCHEMA } from '@dotdo/oauth'
const sessions = new D1SessionStore(env.DB)
await env.DB.exec(D1_SESSION_SCHEMA) // Run once to create table
```

### 3. Set Up Routes

```typescript
import { Hono } from 'hono'
import {
  createAuthorizeHandler,
  createCallbackHandler,
  oauthMiddleware,
} from '@dotdo/oauth'

const app = new Hono()

// Start OAuth flow
app.get('/auth/login', createAuthorizeHandler({
  provider: google,
  storePKCE: async (pkce, c) => { /* store PKCE pair */ },
  storeState: async (state, c) => { /* store state token */ },
}))

// Handle OAuth callback
app.get('/auth/callback', createCallbackHandler({
  provider: google,
  sessionStore: sessions,
  getStoredPKCE: async (c) => { /* retrieve PKCE pair */ },
  getStoredState: async (c) => { /* retrieve state token */ },
}))

// Protect routes
app.use('/api/*', oauthMiddleware({
  sessionStore: sessions,
  excludePaths: ['/api/public'],
}))

// Access session in protected routes
app.get('/api/me', (c) => {
  const session = c.get('session')
  return c.json({ userId: session.userId })
})
```

## Providers

### Google

```typescript
import { createGoogleProvider } from '@dotdo/oauth'

const google = createGoogleProvider({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  redirectUri: 'https://yourapp.com/callback',
  scopes: ['openid', 'email', 'profile'],
  accessType: 'offline', // Get refresh tokens
  prompt: 'consent',     // Force consent screen
  hostedDomain: 'acme.com', // Restrict to domain
})
```

### GitHub

```typescript
import { createGitHubProvider } from '@dotdo/oauth'

const github = createGitHubProvider({
  clientId: env.GITHUB_CLIENT_ID,
  clientSecret: env.GITHUB_CLIENT_SECRET,
  redirectUri: 'https://yourapp.com/callback',
  scopes: ['read:user', 'user:email'],
  allowSignup: true,
})
```

### Microsoft

```typescript
import { createMicrosoftProvider } from '@dotdo/oauth'

const microsoft = createMicrosoftProvider({
  clientId: env.MICROSOFT_CLIENT_ID,
  clientSecret: env.MICROSOFT_CLIENT_SECRET,
  redirectUri: 'https://yourapp.com/callback',
  tenant: 'common', // or 'organizations', 'consumers', or tenant ID
  scopes: ['openid', 'email', 'profile'],
})
```

### Custom Provider

```typescript
import { createCustomProvider } from '@dotdo/oauth'

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

## Session Storage

### Memory (Development)

```typescript
import { MemorySessionStore } from '@dotdo/oauth'

const sessions = new MemorySessionStore({
  defaultTTL: 24 * 60 * 60 * 1000, // 24 hours in ms
})
```

### Cloudflare KV (Production)

Best for read-heavy workloads with global distribution.

```typescript
import { KVSessionStore } from '@dotdo/oauth'

const sessions = new KVSessionStore(env.SESSIONS, {
  prefix: 'session:',
  defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
})
```

### Cloudflare D1 (Production)

Best for strong consistency and complex queries.

```typescript
import { D1SessionStore, D1_SESSION_SCHEMA } from '@dotdo/oauth'

// Create table (run once during setup)
await env.DB.exec(D1_SESSION_SCHEMA)

const sessions = new D1SessionStore(env.DB, {
  tableName: 'sessions',
  defaultTTL: 24 * 60 * 60 * 1000,
})
```

## MCP OAuth 2.1

Full Model Context Protocol OAuth support per RFC 9728.

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
  resourceServer: 'https://api.yourapp.com',
  authorizationServers: ['https://yourapp.com'],
}))

app.get('/.well-known/oauth-authorization-server', createAuthServerMetadataHandler({
  issuer: 'https://yourapp.com',
  authorizationEndpoint: 'https://yourapp.com/oauth/authorize',
  tokenEndpoint: 'https://yourapp.com/oauth/token',
  responseTypesSupported: ['code'],
  codeChallengeMethodsSupported: ['S256'],
}))

app.get('/.well-known/oauth-protected-resource', createProtectedResourceMetadataHandler({
  resource: 'https://api.yourapp.com',
  authorizationServers: ['https://yourapp.com'],
  bearerMethodsSupported: ['header'],
}))

// MCP OAuth endpoints
app.get('/oauth/authorize', createMCPAuthorizeHandler({ /* ... */ }))
app.get('/oauth/callback', createMCPCallbackHandler({ /* ... */ }))
app.post('/oauth/token', createMCPTokenEndpoint({ /* ... */ }))
```

## Low-Level API

For custom implementations, use the core functions directly.

### PKCE

```typescript
import { generatePKCE, generateVerifier, createChallenge, validatePKCE } from '@dotdo/oauth'

// Generate complete PKCE pair
const { verifier, challenge, method } = await generatePKCE('S256')

// Or build manually
const verifier = await generateVerifier(32) // 43 characters
const challenge = await createChallenge(verifier, 'S256')

// Validate on callback (timing-safe)
const isValid = await validatePKCE(receivedVerifier, storedChallenge, 'S256')
```

### State Tokens

```typescript
import {
  generateState,
  validateState,
  createStateWithMetadata,
  parseStateMetadata,
  createStateWithExpiry,
  isStateExpired,
} from '@dotdo/oauth'

// Simple state
const state = await generateState()
const isValid = validateState(receivedState, storedState)

// State with metadata
const state = await createStateWithMetadata({
  returnTo: '/dashboard',
  provider: 'google',
})
const metadata = parseStateMetadata(state) // { returnTo: '/dashboard', provider: 'google' }

// State with expiry
const state = await createStateWithExpiry(5 * 60 * 1000) // 5 minutes
const expired = isStateExpired(state)
```

## Subpath Exports

Import specific modules for smaller bundles:

```typescript
import { generatePKCE } from '@dotdo/oauth/pkce'
import { generateState } from '@dotdo/oauth/state'
import { KVSessionStore } from '@dotdo/oauth/storage'
import { createGoogleProvider } from '@dotdo/oauth/providers'
import { oauthMiddleware } from '@dotdo/oauth/middleware'
import { createMCPServerMetadataHandler } from '@dotdo/oauth/mcp'
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
  GoogleProviderConfig,
  GitHubProviderConfig,
  MicrosoftProviderConfig,
  CustomProviderConfig,

  // Session
  SessionData,
  SessionStore,
  SessionStoreOptions,
  KVSessionStoreOptions,
  D1SessionStoreOptions,

  // Middleware
  OAuthMiddlewareOptions,
  JwtPayload,
  CallbackHandlerOptions,
  CookieOptions,
  AuthorizeHandlerOptions,
  TokenEndpointOptions,

  // MCP
  MCPServerMetadata,
  AuthServerMetadata,
  ProtectedResourceMetadata,
  BearerMethod,
  MCPOAuthProvider,
  MCPAuthorizeHandlerOptions,
  MCPCallbackHandlerOptions,
  MCPTokenEndpointOptions,
  MCPScopeValidationResult,
} from '@dotdo/oauth'
```

## Related Packages

- [@dotdo/auth](/auth) - JWT and API key authentication
- [@dotdo/api](/api) - Self-describing API framework
- [@dotdo/do](/do) - Durable Object base class

## License

MIT
