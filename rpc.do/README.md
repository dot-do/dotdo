# rpc.do

Cap'n Web RPC client for Durable Objects with full TypeScript support, CLI tools, and OAuth authentication.

[![npm version](https://img.shields.io/npm/v/rpc.do.svg)](https://www.npmjs.com/package/rpc.do)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
# npm
npm install rpc.do

# pnpm
pnpm add rpc.do

# yarn
yarn add rpc.do
```

## Quick Start

Connect to an RPC endpoint and start calling methods immediately:

```typescript
import { createClient } from 'rpc.do'
import { FetchTransport } from 'rpc.do/transport/fetch'

// Create a typed client
const transport = new FetchTransport({ url: 'https://api.example.do' })
const $ = createClient({ transport })

// Call methods on the $ proxy
const customer = await $.things.create({ $type: 'Customer', name: 'Alice' })
const profile = await $.things.get(customer.$id)
```

## $ Proxy API

The `$` proxy provides a fluent API for interacting with Durable Objects.

### Basic Method Calls

```typescript
// Create entities
const customer = await $.things.create({
  $type: 'Customer',
  name: 'Alice',
  email: 'alice@example.com'
})

// Get by ID
const found = await $.things.get(customer.$id)

// Query entities
const customers = await $.things.query({ $type: 'Customer' })

// Update entities
await $.things.update(customer.$id, { name: 'Alice Smith' })

// Delete entities
await $.things.delete(customer.$id)
```

### Entity Binding

Bind to a specific entity ID to call methods on it directly:

```typescript
// Bind to a specific customer
const alice = $.Customer('cust-123')

// Call methods on the bound entity
const profile = await alice.getProfile()
const orders = await alice.listOrders()
await alice.updatePreferences({ theme: 'dark' })
```

### Event Handlers

Register handlers for events using the `$.on` namespace:

```typescript
// Handle customer signup events
$.on.Customer.signup(async (event) => {
  console.log('New customer:', event.name)
  await sendWelcomeEmail(event.email)
})

// Handle order events
$.on.Order.created(async (event) => {
  await notifyWarehouse(event.orderId)
})

$.on.Order.shipped(async (event) => {
  await sendShippingNotification(event.customerId, event.trackingNumber)
})
```

### Scheduling

Schedule recurring tasks using the fluent `$.every` DSL:

```typescript
// Run every Monday at 9am
$.every.Monday.at('9am')(async () => {
  await generateWeeklyReport()
})

// Run every day at 6pm
$.every.day.at('6pm')(async () => {
  await sendDailySummary()
})

// Run every hour
$.every.hour(async () => {
  await checkHealthStatus()
})
```

### Durability Levels

Control execution guarantees for actions:

```typescript
// Fire-and-forget (no delivery guarantee)
await $.send({ type: 'log', message: 'User clicked button' })

// Single attempt (may fail)
await $.try({ type: 'sendEmail', to: 'user@example.com' })

// Durable with retries (guaranteed delivery)
await $.do({ type: 'processPayment', amount: 99.99 })
```

### Reflection Methods

Introspect the API at runtime:

```typescript
// Get TypeScript type definitions
const types = await $._types()
// Returns: "interface $ { things: ThingsAPI; ... }"

// Get JSON schema
const schema = await $._schema()
// Returns: { entities: {...}, methods: {...}, events: {...} }

// Get markdown documentation
const docs = await $.md()
// Returns: "# API Documentation\n\n## Entities\n..."
```

## CLI Commands

The `rpc.do` CLI provides tools for development and debugging.

### Pull Types

Fetch TypeScript type definitions from an endpoint:

```bash
# Pull types to default location (.do/$.d.ts)
rpc.do pull https://api.example.do

# Specify output path
rpc.do pull https://api.example.do --out ./types/api.d.ts

# Use --from flag
rpc.do pull --from https://api.example.do
```

### Eval

Execute code against an endpoint:

```bash
# Evaluate simple expressions
rpc.do eval https://api.example.do "1 + 1"

# Call RPC methods
rpc.do eval https://api.example.do "await $.things.create({ name: 'Test' })"

# Pretty print output
rpc.do eval https://api.example.do "await $._schema()" --pretty

# With authentication
rpc.do eval https://api.example.do "await $.things.list()" --auth $TOKEN
```

### Run

Execute a script file against an endpoint:

```bash
# Run a script
rpc.do run https://api.example.do ./scripts/seed.ts

# Watch mode - re-run on file changes
rpc.do run https://api.example.do ./scripts/dev.ts --watch

# With timeout
rpc.do run https://api.example.do ./scripts/migrate.ts --timeout 60000
```

### REPL

Start an interactive REPL with autocomplete:

```bash
# Connect to an endpoint
rpc.do repl https://api.example.do

# With custom types file
rpc.do repl https://api.example.do --types ./.do/$.d.ts

# Custom history location
rpc.do repl https://api.example.do --history ~/.my-repl-history
```

REPL features:
- Tab completion powered by TypeScript
- Command history (persisted to `~/.do/repl_history`)
- Built-in commands: `.help`, `.exit`, `.clear`, `.types`, `.history`
- Multiline input support

## Authentication

rpc.do uses OAuth 2.0 Device Authorization Grant (RFC 8628) for CLI authentication.

### Device Flow

The device flow allows authentication in headless environments:

```typescript
import { DeviceFlow, TokenStore, ensureLoggedIn } from 'rpc.do/auth'

// Initialize components
const tokenStore = new TokenStore()
const deviceFlow = new DeviceFlow({
  clientId: 'my-cli',
  oauthBaseUrl: 'https://oauth.do',
  scope: 'read write'
})

// Ensure user is logged in
const loggedIn = await ensureLoggedIn({
  tokenStore,
  deviceFlow,
  interactive: true,
  onDisplayCode: ({ userCode, verificationUri }) => {
    console.log(`Go to ${verificationUri}`)
    console.log(`Enter code: ${userCode}`)
  }
})

if (!loggedIn) {
  console.error('Authentication required')
  process.exit(1)
}
```

### Token Storage

Tokens are stored securely in `~/.do/tokens.json`:

```typescript
import { TokenStore } from 'rpc.do/auth'

const store = new TokenStore()

// Get current tokens
const tokens = await store.getTokens()

// Check expiration
const expired = await store.isTokenExpired()

// Clear tokens (logout)
await store.clearTokens()
```

### Authenticated Transport

Use `AuthTransport` to automatically attach tokens to requests:

```typescript
import { FetchTransport } from 'rpc.do/transport/fetch'
import { AuthTransport, TokenStore } from 'rpc.do/auth'
import { createClient } from 'rpc.do'

const baseTransport = new FetchTransport({ url: 'https://api.example.do' })
const tokenStore = new TokenStore()

const transport = new AuthTransport({
  transport: baseTransport,
  tokenStore
})

const $ = createClient({ transport })
```

## TypeScript Support

rpc.do provides first-class TypeScript support with automatic type generation.

### Type Generation

Pull types from any endpoint to get full IntelliSense:

```bash
# Generate types
rpc.do pull https://api.example.do --out .do/$.d.ts
```

This generates a `.d.ts` file with complete type definitions:

```typescript
// .do/$.d.ts (auto-generated)
interface $ {
  things: {
    create(data: ThingInput): Promise<Thing>
    get(id: string): Promise<Thing | null>
    query(filter: ThingFilter): Promise<Thing[]>
    update(id: string, data: Partial<ThingInput>): Promise<Thing>
    delete(id: string): Promise<void>
  }
  Customer(id: string): CustomerEntity
  Order(id: string): OrderEntity
  _types(): Promise<string>
  _schema(): Promise<DOSchema>
  md(): Promise<string>
}
```

### Using Generated Types

Reference the generated types in your project:

```typescript
/// <reference path="./.do/$.d.ts" />

import { createClient } from 'rpc.do'

// $ is now fully typed
const $ = createClient<$>({ url: 'https://api.example.do' })

// Full autocomplete and type checking
const customer = await $.things.create({
  $type: 'Customer',
  name: 'Alice' // TypeScript knows the required fields
})
```

### LSP Integration

The REPL uses TypeScript's language service for intelligent autocomplete:

- Property and method suggestions
- Function signature help
- Hover information
- Syntax error highlighting

## API Reference

### createClient

Creates a typed proxy client for RPC communication.

```typescript
function createClient<T>(options: ClientOptions): T

interface ClientOptions {
  url?: string           // RPC endpoint URL
  transport?: Transport  // Custom transport
  timeout?: number       // Request timeout (ms)
  correlationId?: string // Request tracing ID
}
```

### Transport Interface

Implement custom transports for different communication backends:

```typescript
interface Transport {
  send(message: RPCMessage): Promise<RPCResponse>
  connect?(): Promise<void>
  disconnect?(): Promise<void>
  state: TransportState
}

type TransportState = 'disconnected' | 'connecting' | 'connected' | 'error'
```

### Built-in Transports

- **FetchTransport**: HTTP-based transport using fetch API
- **AuthTransport**: Wrapper that adds authentication headers

## License

MIT
