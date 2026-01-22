# @dotdo/clickhouse

Full ClickHouse deployment with S3-backed scale-out architecture, plus unified client supporting WASM, Sandbox, and Container backends.

## Features

- **Scale-out Architecture**: S3-backed storage with no Keeper/ZooKeeper required
- **Multiple Backends**: WASM (Workers/DO), Sandbox (Containers), Full ClickHouse
- **Pre-configured Docker**: Ready-to-deploy container with optimal S3 settings
- **Local Disk Cache**: Fast local caching of remote S3 data
- **HTTP Proxy**: Query API and web admin UI
- **capnweb RPC**: Efficient client/server communication

## Installation

```bash
pnpm add @dotdo/clickhouse
```

## Quick Start

### Client Usage

```typescript
import { createClient } from '@dotdo/clickhouse'

// Auto-selects best available backend
const client = await createClient({
  // Prefer full ClickHouse if available
  backends: ['clickhouse', 'sandbox', 'wasm']
})

const result = await client.query(`
  SELECT * FROM system.tables
  WHERE database = 'default'
`)
```

### Connect to ClickHouse Server

```typescript
import { createClient } from '@dotdo/clickhouse'

const client = await createClient({
  backend: 'clickhouse',
  clickhouse: {
    host: 'http://localhost:8123',
    username: 'default',
    password: '',
    database: 'default'
  }
})
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    @dotdo/clickhouse Client                  │
└─────────────┬─────────────────┬─────────────────┬───────────┘
              │                 │                 │
              ▼                 ▼                 ▼
       ┌───────────┐     ┌───────────┐     ┌───────────────┐
       │   WASM    │     │  Sandbox  │     │  ClickHouse   │
       │ (chdb)    │     │  (chdb)   │     │  (Container)  │
       └───────────┘     └───────────┘     └───────┬───────┘
                                                   │
                                           ┌───────▼───────┐
                                           │  Local Cache  │
                                           └───────┬───────┘
                                                   │
                                           ┌───────▼───────┐
                                           │   S3 / R2     │
                                           │   Storage     │
                                           └───────────────┘
```

## Docker Container

### Quick Start

```bash
# Pull and run with default config
docker run -d \
  -p 8123:8123 \
  -p 9000:9000 \
  -e S3_ENDPOINT=https://your-bucket.r2.cloudflarestorage.com \
  -e S3_ACCESS_KEY=your-access-key \
  -e S3_SECRET_KEY=your-secret-key \
  ghcr.io/dot-do/clickhouse:latest
```

### Docker Compose

```yaml
version: '3.8'

services:
  clickhouse:
    image: ghcr.io/dot-do/clickhouse:latest
    ports:
      - "8123:8123"  # HTTP interface
      - "9000:9000"  # Native protocol
    environment:
      S3_ENDPOINT: ${S3_ENDPOINT}
      S3_ACCESS_KEY: ${S3_ACCESS_KEY}
      S3_SECRET_KEY: ${S3_SECRET_KEY}
      S3_BUCKET: ${S3_BUCKET:-clickhouse-data}
      CACHE_SIZE: ${CACHE_SIZE:-10G}
    volumes:
      - clickhouse-cache:/var/lib/clickhouse/disks/cache
    healthcheck:
      test: ["CMD", "clickhouse-client", "--query", "SELECT 1"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  clickhouse-cache:
```

## S3-Backed Scale-Out Configuration

The container is pre-configured for stateless, scale-out deployment:

### Storage Policy

```xml
<!-- Automatically configured via environment variables -->
<storage_configuration>
  <disks>
    <s3>
      <type>s3</type>
      <endpoint>${S3_ENDPOINT}/${S3_BUCKET}/</endpoint>
      <access_key_id>${S3_ACCESS_KEY}</access_key_id>
      <secret_access_key>${S3_SECRET_KEY}</secret_access_key>
    </s3>
    <cache>
      <type>cache</type>
      <disk>s3</disk>
      <path>/var/lib/clickhouse/disks/cache/</path>
      <max_size>${CACHE_SIZE}</max_size>
    </cache>
  </disks>
  <policies>
    <s3_main>
      <volumes>
        <main>
          <disk>cache</disk>
        </main>
      </volumes>
    </s3_main>
  </policies>
</storage_configuration>
```

### System Tables on S3

All system tables use S3 storage for true stateless operation:

```sql
-- System tables are automatically configured to use S3
-- No local state required - can scale horizontally
```

## HTTP Interface Proxy

The package includes an HTTP proxy for the ClickHouse interface:

```typescript
import { createHttpProxy } from '@dotdo/clickhouse/proxy'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const proxy = createHttpProxy({
      upstream: env.CLICKHOUSE_URL,
      auth: {
        username: env.CLICKHOUSE_USER,
        password: env.CLICKHOUSE_PASSWORD
      }
    })

    return proxy.handleRequest(request)
  }
}
```

### Supported Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET/POST | Query execution |
| `/ping` | GET | Health check |
| `/play` | GET | Web admin UI |
| `/query` | POST | Query with body |

## capnweb RPC Server

```typescript
import { createRpcServer } from '@dotdo/clickhouse/rpc'
import { createClient } from '@dotdo/clickhouse'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const client = await createClient({
      backend: 'clickhouse',
      clickhouse: { host: env.CLICKHOUSE_URL }
    })

    if (request.url.endsWith('/rpc')) {
      const server = createRpcServer(client)
      return server.handleRequest(request)
    }

    // ... handle other routes
  }
}
```

## capnweb RPC Client

```typescript
import { createRpcClient } from '@dotdo/clickhouse/rpc'

const client = await createRpcClient({
  url: 'https://clickhouse.example.com/rpc'
})

// Same API as direct client
const result = await client.query('SELECT * FROM system.tables')
```

## Query API

```typescript
// Basic query
const rows = await client.query<{ id: number }>('SELECT id FROM users')

// With parameters
const rows = await client.query(
  'SELECT * FROM users WHERE id = {id:UInt64}',
  { params: { id: 123 } }
)

// Raw format
const csv = await client.queryRaw('SELECT * FROM users', { format: 'CSV' })

// Streaming
for await (const batch of client.queryStream('SELECT * FROM large_table')) {
  processBatch(batch)
}

// Insert
await client.insert('users', [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' }
])
```

## Backend Selection

```typescript
const client = await createClient({
  // Priority order for backend selection
  backends: ['clickhouse', 'sandbox', 'wasm'],

  // Backend-specific configuration
  wasm: {
    profile: 'standard'
  },
  sandbox: {
    binary: '/usr/local/bin/chdb'
  },
  clickhouse: {
    host: 'http://localhost:8123'
  }
})

// Check which backend is active
console.log(client.backend) // 'clickhouse' | 'sandbox' | 'wasm'
```

## TypeScript Types

Full type definitions matching ClickHouse client SDK:

```typescript
import type {
  ClickHouseClient,
  QueryOptions,
  QueryResult,
  InsertOptions,
  ClickHouseConfig
} from '@dotdo/clickhouse'
```

## Cloudflare Container Deployment

```typescript
// wrangler.toml
// [containers]
// name = "clickhouse"
// image = "ghcr.io/dot-do/clickhouse:latest"

import { createClient } from '@dotdo/clickhouse'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const client = await createClient({
      backend: 'clickhouse',
      clickhouse: {
        // Container internal endpoint
        host: 'http://clickhouse:8123'
      }
    })

    const query = await request.text()
    const result = await client.query(query)

    return Response.json(result)
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_ENDPOINT` | - | S3/R2 endpoint URL |
| `S3_ACCESS_KEY` | - | S3 access key ID |
| `S3_SECRET_KEY` | - | S3 secret access key |
| `S3_BUCKET` | `clickhouse-data` | S3 bucket name |
| `CACHE_SIZE` | `10G` | Local disk cache size |
| `MAX_MEMORY` | `4G` | ClickHouse memory limit |
| `MAX_THREADS` | `4` | Query parallelism |

## License

Apache-2.0
