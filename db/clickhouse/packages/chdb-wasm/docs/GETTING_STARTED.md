# Getting Started with chdb-wasm

Run real ClickHouse queries on Cloudflare Workers in minutes.

## Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- Cloudflare account (for deployment)
- Emscripten SDK (for building from source)

## Quick Start (Pre-built WASM)

### 1. Install the Package

```bash
pnpm add @dotdo/chdb-wasm
```

### 2. Create a Worker

```typescript
// src/worker.ts
import { createChdb } from '@dotdo/chdb-wasm';

export interface Env {
  ASSETS: Fetcher;  // Static Assets binding
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/ping') {
      return new Response('Ok.\n');
    }

    // Execute query
    const query = url.searchParams.get('query') || await request.text();

    if (!query) {
      return new Response('No query provided', { status: 400 });
    }

    const chdb = await createChdb({ assets: env.ASSETS });

    try {
      const result = await chdb.query(query, {
        format: url.searchParams.get('default_format') || 'JSON'
      });

      return new Response(result, {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(String(error), { status: 400 });
    }
  }
};
```

### 3. Configure Wrangler

```toml
# wrangler.toml
name = "my-chdb-worker"
main = "src/worker.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./public"
binding = "ASSETS"
```

### 4. Add WASM Files

Copy the WASM files to your public directory:

```bash
mkdir -p public/wasm
cp node_modules/@dotdo/chdb-wasm/dist/dashboard/* public/wasm/
```

### 5. Deploy

```bash
npx wrangler deploy
```

### 6. Query Your Worker

```bash
# Simple query
curl "https://my-chdb-worker.your-subdomain.workers.dev/?query=SELECT+1"

# Aggregation
curl "https://my-chdb-worker.your-subdomain.workers.dev/?query=SELECT+count(),+avg(number)+FROM+numbers(1000)"
```

## Building from Source

### 1. Clone the Repository

```bash
git clone --recursive https://github.com/your-org/clickhouse.git
cd clickhouse/packages/chdb-wasm
```

The `--recursive` flag is important to include the `vendor/chdb` submodule.

### 2. Install Emscripten

```bash
# Install emsdk
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

### 3. Build a Profile

```bash
# Build the dashboard profile (~3MB)
./scripts/build-profiles.sh dashboard

# Build all profiles
./scripts/build-profiles.sh --all

# List available profiles
./scripts/build-profiles.sh --list
```

### 4. Find Your Output

```bash
ls dist/dashboard/
# chdb-dashboard.wasm
# chdb-dashboard.js
```

## Development Workflow

### Local Development

```bash
# Start local worker
pnpm dev

# Query locally
curl "http://localhost:8787/?query=SELECT+1"
```

### Run Tests

```bash
# Unit tests (Node.js)
pnpm test:unit

# Workers runtime tests (workerd)
pnpm test:workers

# E2E tests (local worker)
pnpm test:e2e

# All tests
pnpm test:all
```

### Test Against Deployed Worker

```bash
# Set your deployed worker URL
export WORKER_URL=https://my-chdb-worker.your-subdomain.workers.dev

# Run E2E tests
pnpm test:e2e:deployed
```

## Using Different Build Profiles

### Parser Only (300KB)

For SQL validation without execution:

```typescript
import { createParser } from '@dotdo/chdb-wasm/parser';

const parser = await createParser();
const result = parser.validate('SELECT * FROM users');
console.log(result.isValid); // true
```

### Dashboard (3MB)

For simple queries and small datasets:

```typescript
import { createChdb } from '@dotdo/chdb-wasm/dashboard';

const chdb = await createChdb({ assets: env.ASSETS });
const result = await chdb.query('SELECT count() FROM numbers(1000)');
```

### Analytics (8MB)

For full analytics with all aggregates:

```typescript
import { createChdb } from '@dotdo/chdb-wasm/analytics';

const chdb = await createChdb({ assets: env.ASSETS });
const result = await chdb.query(`
  WITH daily AS (
    SELECT toDate(timestamp) as day, user_id
    FROM events
  )
  SELECT day, uniqExact(user_id) as dau
  FROM daily
  GROUP BY day
`);
```

### Lakehouse (18-20MB)

For querying external data sources:

```typescript
import { createChdb } from '@dotdo/chdb-wasm/lakehouse';

const chdb = await createChdb({ assets: env.ASSETS });

// Query Parquet from R2
const result = await chdb.query(`
  SELECT * FROM s3('https://bucket.r2.dev/data.parquet')
  LIMIT 100
`);

// Query CSV from URL
const csv = await chdb.query(`
  SELECT * FROM url('https://example.com/data.csv', CSV)
`);
```

## Adding Storage

### Durable Objects (Persistent State)

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "MEMORY_DO"
class_name = "MemoryEngineDO"

[[migrations]]
tag = "v1"
new_classes = ["MemoryEngineDO"]
```

```typescript
// src/worker.ts
export { MemoryEngineDO } from '@dotdo/chdb-wasm/storage';

export default {
  async fetch(request: Request, env: Env) {
    const chdb = await createChdb({
      assets: env.ASSETS,
      memoryDO: env.MEMORY_DO
    });

    // Tables now persist across requests
    await chdb.query('CREATE TABLE IF NOT EXISTS users (id UInt32, name String)');
    await chdb.query("INSERT INTO users VALUES (1, 'Alice')");
  }
};
```

### R2 (Large Datasets)

```toml
# wrangler.toml
[[r2_buckets]]
binding = "DATA_BUCKET"
bucket_name = "my-data-bucket"
```

```typescript
const chdb = await createChdb({
  assets: env.ASSETS,
  r2: env.DATA_BUCKET
});

// Query Parquet files from R2
const result = await chdb.query(`
  SELECT * FROM r2('events/2024/*.parquet')
  WHERE date >= '2024-01-01'
`);
```

## Query Examples

### Basic Queries

```sql
-- Simple arithmetic
SELECT 2 + 2

-- Generate numbers
SELECT * FROM numbers(10)

-- Aggregation
SELECT count(), sum(number), avg(number) FROM numbers(1000)
```

### Working with Data

```sql
-- Create a table
CREATE TABLE events (
  timestamp DateTime,
  user_id UInt32,
  event String
) ENGINE = Memory

-- Insert data
INSERT INTO events VALUES
  (now(), 1, 'click'),
  (now(), 2, 'view'),
  (now(), 1, 'purchase')

-- Query with aggregation
SELECT
  user_id,
  count() as events,
  countIf(event = 'purchase') as purchases
FROM events
GROUP BY user_id
ORDER BY events DESC
```

### Analytics Queries

```sql
-- Daily active users
SELECT
  toDate(timestamp) as day,
  uniqExact(user_id) as dau
FROM events
WHERE timestamp >= today() - 30
GROUP BY day
ORDER BY day

-- Funnel analysis
SELECT
  countIf(event = 'view') as views,
  countIf(event = 'click') as clicks,
  countIf(event = 'purchase') as purchases,
  clicks / views as ctr,
  purchases / clicks as conversion
FROM events

-- Window functions (requires analytics profile)
SELECT
  user_id,
  event,
  row_number() OVER (PARTITION BY user_id ORDER BY timestamp) as event_num
FROM events
```

## Troubleshooting

### WASM Loading Fails

Check that WASM files are in the correct location:

```bash
ls public/wasm/*.wasm
```

Verify wrangler.toml has the assets configuration:

```toml
[assets]
directory = "./public"
binding = "ASSETS"
```

### Out of Memory

The Workers memory limit is 128MB. Solutions:

1. Use a smaller build profile
2. Reduce result set size with LIMIT
3. Process data in chunks
4. Use R2 for large datasets

### Query Timeout

Workers have CPU time limits. Solutions:

1. Simplify complex queries
2. Add WHERE clauses to reduce data
3. Use LIMIT to cap results
4. Consider caching results

### Build Errors

Ensure Emscripten is properly installed:

```bash
emcc --version
# Should show emcc version
```

Check the vendor submodule:

```bash
git submodule update --init --recursive
ls vendor/chdb/src
# Should show ClickHouse source
```

## Next Steps

- [Architecture](./ARCHITECTURE.md) - Understand the system design
- [Build Profiles](./BUILD_PROFILES.md) - Choose the right profile
- [Testing](./TESTING.md) - Run the test suite
