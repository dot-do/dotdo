# sdk.do

> Type-safe SDK for dotdo backends

[![npm version](https://img.shields.io/npm/v/sdk.do.svg)](https://www.npmjs.com/package/sdk.do)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Your Backend is Ready. Now What?

You have built an amazing dotdo backend with Durable Objects, real-time events, and powerful workflows. Now you need to call it from your frontend, CLI, or another service. But...

- **RPC is complex** - Proxies, serialization, error handling across the wire
- **Auth flows are hard** - OAuth device flow, token refresh, secure storage
- **Type safety is lost at boundaries** - Your backend types do not flow to your frontend
- **Real-time is an afterthought** - WebSocket connections, reconnection, message queuing

You could spend weeks wiring all this together. Or you could use sdk.do.

## sdk.do Has You Covered

```typescript
import { createClient } from 'sdk.do'

// Create a typed client in one line
const $ = createClient<MyAPI>('https://api.example.do')

// Full type safety - your IDE knows exactly what's available
const users = await $.users.list()           // Autocomplete works
const user = await $.users.create({          // Type errors caught at compile time
  name: 'Alice',
  email: 'alice@example.com'
})

// Nested APIs just work
const order = await $.orders('ord_123').ship()
```

Your backend types flow to your frontend. No code generation. No sync issues. Just TypeScript.

## Features

### Full Type Safety

Your backend API types flow directly to your frontend via TypeScript generics. No code generation step, no sync issues, no runtime type mismatches.

```typescript
interface MyAPI {
  users: {
    list(): Promise<User[]>
    create(user: CreateUserInput): Promise<User>
    get(id: string): Promise<User>
  }
  orders: {
    (id: string): {
      ship(): Promise<ShipmentInfo>
      cancel(reason: string): Promise<void>
    }
  }
}

const $ = createClient<MyAPI>('https://api.example.do')

// TypeScript knows the exact return type
const users: User[] = await $.users.list()
```

### OAuth Built-in

Device flow, token refresh, secure storage - all handled. Works great for CLIs and desktop apps.

```typescript
import { TokenStore, DeviceFlow, ensureLoggedIn } from 'sdk.do'

const tokenStore = new TokenStore()
const deviceFlow = new DeviceFlow({
  clientId: 'my-app',
  oauthBaseUrl: 'https://oauth.do',
  scope: 'read write'
})

await ensureLoggedIn({
  tokenStore,
  deviceFlow,
  interactive: true,
  onDisplayCode: ({ userCode, verificationUri }) => {
    console.log(`Visit ${verificationUri}`)
    console.log(`Enter code: ${userCode}`)
  }
})
```

### WebSocket Support

Real-time events out of the box with automatic reconnection, message queuing, and backpressure handling.

```typescript
import { createClient, WebSocketTransport } from 'sdk.do'

const transport = new WebSocketTransport({
  url: 'wss://api.example.do/rpc',
  reconnect: true,
  maxReconnectAttempts: 10,
})

transport.addEventListener((event) => {
  if (event.type === 'disconnect') {
    console.log('Connection lost, reconnecting...')
  }
  if (event.type === 'backpressure') {
    console.log('Slow down! Queue is filling up.')
  }
})

await transport.connect()
const $ = createClient<MyAPI>('wss://api.example.do', { transport })
```

### Tree-shakeable

Only bundle what you use. The SDK is designed with separate entry points so bundlers can eliminate unused code.

```typescript
// Only imports the client - no auth code bundled
import { createClient } from 'sdk.do'

// Need OAuth? Import from the subpath
import { oauthMiddleware } from 'sdk.do/oauth'
```

## Quick Start

### Installation

```bash
# npm
npm install sdk.do

# pnpm
pnpm add sdk.do

# yarn
yarn add sdk.do
```

### Basic Usage

```typescript
import { createClient } from 'sdk.do'

// Define your API types (or import from shared package)
interface API {
  things: {
    create<T>(data: T): Promise<T & { $id: string }>
    get(id: string): Promise<unknown>
    list(query?: { $type?: string }): Promise<unknown[]>
  }
}

// Create the client
const $ = createClient<API>('https://api.dotdo.dev')

// Use it
const customer = await $.things.create({
  $type: 'Customer',
  name: 'Alice',
  email: 'alice@example.com'
})

console.log(customer.$id) // 'cus_abc123'
```

## Authentication

### Token Store

The SDK provides secure token storage that persists to `~/.do/tokens.json`:

```typescript
import { TokenStore } from 'sdk.do'

const tokenStore = new TokenStore()

// Check if logged in
const tokens = await tokenStore.get()
if (tokens) {
  console.log('Logged in, token expires:', tokens.expiresAt)
}

// Store tokens after login
await tokenStore.set({
  accessToken: 'eyJ...',
  refreshToken: 'dGhp...',
  expiresAt: Date.now() + 3600000
})

// Clear on logout
await tokenStore.clear()
```

### Authenticated Requests

Wrap any transport with `AuthTransport` to automatically include tokens:

```typescript
import { createClient, AuthTransport, FetchTransport, TokenStore } from 'sdk.do'

const tokenStore = new TokenStore()
const baseTransport = new FetchTransport({ url: 'https://api.dotdo.dev' })

const transport = new AuthTransport({
  transport: baseTransport,
  tokenStore,
  onTokenRefresh: async (refreshToken) => {
    // Implement token refresh logic
    const response = await fetch('https://oauth.do/token', {
      method: 'POST',
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken })
    })
    return response.json()
  }
})

const $ = createClient<API>('https://api.dotdo.dev', { transport })

// Requests now automatically include Authorization header
// Tokens are refreshed automatically when expired
const profile = await $.users.me()
```

### Device Flow (CLI/Desktop Apps)

For applications that cannot open a browser directly:

```typescript
import { DeviceFlow, TokenStore, ensureLoggedIn } from 'sdk.do'

const tokenStore = new TokenStore()
const deviceFlow = new DeviceFlow({
  clientId: 'my-cli-app',
  oauthBaseUrl: 'https://oauth.do',
  scope: 'read write offline_access'
})

// This handles the entire flow: check tokens, refresh if needed, or start device flow
const tokens = await ensureLoggedIn({
  tokenStore,
  deviceFlow,
  interactive: true,
  onDisplayCode: ({ userCode, verificationUri, verificationUriComplete }) => {
    console.log('\nTo sign in, visit:', verificationUri)
    console.log('And enter code:', userCode)
    console.log('\nOr open:', verificationUriComplete)
  },
  onPolling: () => {
    process.stdout.write('.')
  },
  onSuccess: () => {
    console.log('\nAuthenticated successfully!')
  }
})
```

## Real-time Events

### WebSocket Transport

For real-time bidirectional communication:

```typescript
import { createClient, WebSocketTransport } from 'sdk.do'

const transport = new WebSocketTransport({
  url: 'wss://api.example.do/rpc',
  reconnect: true,              // Auto-reconnect on disconnect
  reconnectInterval: 1000,      // Wait 1s between attempts
  maxReconnectAttempts: 10,     // Give up after 10 failures
  timeout: 30000,               // Request timeout
  maxQueueSize: 100,            // Queue messages while disconnected
})

// Listen for connection events
transport.addEventListener((event) => {
  switch (event.type) {
    case 'connect':
      console.log('Connected to server')
      break
    case 'disconnect':
      console.log('Disconnected from server')
      break
    case 'reconnect':
      console.log(`Reconnect attempt ${event.attempt}`)
      break
    case 'error':
      console.error('Transport error:', event.error)
      break
    case 'backpressure':
      console.warn(`Queue filling up: ${event.queueSize} messages`)
      break
    case 'resume':
      console.log('Queue pressure relieved')
      break
  }
})

await transport.connect()
const $ = createClient<API>('wss://api.example.do', { transport })

// Messages sent while disconnected are queued and sent on reconnect
const result = await $.things.create({ name: 'Test' })
```

### Connection State

Check the transport state for connection-aware UI:

```typescript
import { TransportState } from 'sdk.do'

const state = transport.getState()

switch (state) {
  case TransportState.CONNECTED:
    showOnlineIndicator()
    break
  case TransportState.CONNECTING:
    showConnectingSpinner()
    break
  case TransportState.DISCONNECTED:
    showOfflineWarning()
    break
  case TransportState.CLOSED:
    showConnectionClosed()
    break
}
```

## Server-Side OAuth

For Cloudflare Workers that need to validate incoming tokens:

```typescript
import { oauthMiddleware, KVSessionStore } from 'sdk.do/oauth'
import { Hono } from 'hono'

const app = new Hono<{ Bindings: { SESSIONS: KVNamespace } }>()

// Create KV-backed session store for production
const getSessionStore = (env: { SESSIONS: KVNamespace }) =>
  new KVSessionStore(env.SESSIONS)

app.use('/api/*', async (c, next) => {
  const sessionStore = getSessionStore(c.env)

  return oauthMiddleware({
    sessionStore,
    jwtSecret: c.env.JWT_SECRET,
    issuer: 'https://oauth.do',
    audience: 'https://api.example.do',
  })(c, next)
})

app.get('/api/me', (c) => {
  const user = c.get('user') // Set by middleware
  return c.json({ user })
})

export default app
```

## API Reference

### Client Exports

| Export | Description |
|--------|-------------|
| `createClient<T>` | Create a typed RPC proxy client |
| `createProxy` | Low-level proxy creation utility |
| `FetchTransport` | HTTP transport using fetch API |
| `WebSocketTransport` | Real-time bidirectional transport |
| `AuthTransport` | Transport wrapper with authentication |
| `RetryTransport` | Transport wrapper with retry logic |
| `AutoTransport` | Auto-selects best transport |
| `TokenStore` | Secure token storage (~/.do/tokens.json) |
| `DeviceFlow` | OAuth 2.0 device authorization flow |
| `ensureLoggedIn` | Helper to ensure user is authenticated |
| `createRefreshHandler` | Automatic token refresh handler |
| `createLogger` | Structured logging with correlation IDs |
| `RPCError` | Typed RPC error class |
| `TransportState` | Enum of transport connection states |

### OAuth Exports (sdk.do/oauth)

| Export | Description |
|--------|-------------|
| `oauthMiddleware` | Hono middleware for OAuth validation |
| `MemorySessionStore` | In-memory session storage (dev) |
| `KVSessionStore` | KV-backed session storage (prod) |
| `validateToken` | JWT token validation |
| `createAuthUrl` | Generate OAuth authorization URLs |

### Type Exports

```typescript
import type {
  // Client types
  Transport,
  TransportState,
  TransportEvent,
  TransportEventListener,
  RPCMessage,
  RPCResponse,
  RPCClientOptions,
  CreateClientOptions,

  // Transport options
  FetchTransportOptions,
  WebSocketTransportOptions,

  // Auth types
  ITokenStore,
  StoredTokens,
  DeviceFlowOptions,
  AuthTransportOptions,
  EnsureLoggedInOptions,
  RefreshHandlerOptions,

  // Error types
  SerializedError,
} from 'sdk.do'
```

## Package Structure

```
sdk.do/
  src/
    index.ts    # Re-exports rpc.do (client + auth)
    oauth.ts    # Re-exports @dotdo/oauth (server)
```

The package is intentionally thin - it unifies imports from underlying packages to provide a clean, consistent API surface.

## Related Packages

| Package | Description |
|---------|-------------|
| [rpc.do](https://github.com/dot-do/dotdo/tree/main/rpc.do) | The underlying RPC client implementation |
| [@dotdo/oauth](https://github.com/dot-do/dotdo/tree/main/oauth) | Server-side OAuth utilities |
| [platform.do](https://github.com/dot-do/dotdo/tree/main/platform.do) | Platform SDK built on sdk.do |
| [dotdo](https://github.com/dot-do/dotdo) | The complete dotdo framework |

## License

MIT
