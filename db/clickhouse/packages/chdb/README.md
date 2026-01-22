# @dotdo/chdb

Unified chdb client supporting both WASM and native [Cloudflare Sandbox](https://github.com/cloudflare/sandbox-sdk) execution with a consistent TypeScript API.

## Features

- **Unified API**: Same interface regardless of backend
- **Auto-detection**: Automatically selects optimal backend based on environment
- **capnweb RPC**: Efficient client/server communication
- **Type-safe**: Full TypeScript support matching official chdb types
- **Flexible deployment**: Works in Workers, Durable Objects, and Containers

## Installation

```bash
pnpm add @dotdo/chdb
```

## Usage

### Auto-detect Backend

```typescript
import { createClient } from '@dotdo/chdb'

// Automatically uses WASM in Workers, Sandbox in Containers
const client = await createClient()

const result = await client.query('SELECT 1 + 1 as sum')
console.log(result) // [{ sum: 2 }]
```

### Explicit Backend Selection

```typescript
import { createClient } from '@dotdo/chdb'

// Force WASM backend
const wasmClient = await createClient({ backend: 'wasm' })

// Force Sandbox backend (requires container environment)
const sandboxClient = await createClient({ backend: 'sandbox' })
```

### RPC Client (Remote chdb Server)

```typescript
import { createRpcClient } from '@dotdo/chdb/rpc'

// Connect to remote chdb server via capnweb
const client = await createRpcClient({
  url: 'https://chdb.example.com/rpc',
  // Optional authentication
  auth: { token: 'your-token' }
})

const result = await client.query('SELECT * FROM system.tables')
```

### RPC Server

```typescript
import { createRpcServer } from '@dotdo/chdb/rpc'
import { createClient } from '@dotdo/chdb'

export default {
  async fetch(request: Request): Promise<Response> {
    const chdb = await createClient()

    // Handle RPC requests
    if (request.url.endsWith('/rpc')) {
      const server = createRpcServer(chdb)
      return server.handleRequest(request)
    }

    return new Response('Not Found', { status: 404 })
  }
}
```

## Backend Comparison

| Feature | WASM | Sandbox |
|---------|------|---------|
| **Environment** | Workers, DO | Containers |
| **Memory** | ~128MB | 1-8GB |
| **CPU** | Limited | Full |
| **Cold Start** | Faster | Slower |
| **All Engines** | Subset | Full |
| **Cost** | Pay-per-request | Container time |

## Configuration

```typescript
const client = await createClient({
  // Backend selection
  backend: 'auto' | 'wasm' | 'sandbox',

  // WASM-specific options
  wasm: {
    profile: 'minimal' | 'standard' | 'full',
    memoryLimit: 64 * 1024 * 1024
  },

  // Sandbox-specific options
  sandbox: {
    binary: '/path/to/chdb',
    timeout: 30000
  },

  // Common settings
  settings: {
    max_threads: 4,
    max_memory_usage: '1G'
  }
})
```

## Query API

### Basic Query

```typescript
// Returns parsed JSON
const rows = await client.query<{ id: number; name: string }>(`
  SELECT id, name FROM users LIMIT 10
`)

// Returns raw string in specified format
const csv = await client.queryRaw('SELECT * FROM users', { format: 'CSV' })
```

### Parameterized Queries

```typescript
const rows = await client.query(
  'SELECT * FROM users WHERE id = {id:UInt64}',
  { params: { id: 123 } }
)
```

### Streaming

```typescript
const stream = await client.queryStream('SELECT * FROM large_table')

for await (const batch of stream) {
  processBatch(batch)
}
```

### Local Session

```typescript
// Create tables and insert data in a session
const session = await client.createSession()

await session.query('CREATE TABLE temp (x UInt32) ENGINE = Memory')
await session.query('INSERT INTO temp VALUES (1), (2), (3)')
const result = await session.query('SELECT sum(x) FROM temp')

session.close()
```

## Sandbox SDK Integration

When running in a Cloudflare Container, the Sandbox backend provides full chdb capabilities:

```typescript
import { createClient } from '@dotdo/chdb'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Sandbox is auto-detected in container environment
    const client = await createClient({
      sandbox: {
        // Path to chdb binary in container
        binary: '/usr/local/bin/chdb'
      }
    })

    const query = await request.text()
    const result = await client.query(query)

    return Response.json(result)
  }
}
```

## capnweb RPC Schema

The RPC interface uses [capnweb](https://github.com/cloudflare/capnweb) for efficient binary communication:

```capnp
interface Chdb {
  query @0 (sql :Text, options :QueryOptions) -> (result :QueryResult);
  queryStream @1 (sql :Text, options :QueryOptions) -> (stream :Stream(Data));
  createSession @2 () -> (session :Session);
}

interface Session {
  query @0 (sql :Text, options :QueryOptions) -> (result :QueryResult);
  close @1 () -> ();
}

struct QueryOptions {
  format @0 :Text = "JSON";
  params @1 :Map(Text, Text);
  settings @2 :Map(Text, Text);
}

struct QueryResult {
  data @0 :Data;
  rowsRead @1 :UInt64;
  bytesRead @2 :UInt64;
  elapsed @3 :Float64;
}
```

## TypeScript Types

Full type definitions matching the official chdb SDK:

```typescript
import type {
  ChdbClient,
  QueryOptions,
  QueryResult,
  Session,
  ChdbConfig
} from '@dotdo/chdb'
```

## Error Handling

```typescript
import { ChdbError, QueryError, ConnectionError } from '@dotdo/chdb'

try {
  await client.query('INVALID SQL')
} catch (error) {
  if (error instanceof QueryError) {
    console.error('Query failed:', error.message)
    console.error('Position:', error.position)
  } else if (error instanceof ConnectionError) {
    console.error('Connection failed:', error.message)
  }
}
```

## License

Apache-2.0
