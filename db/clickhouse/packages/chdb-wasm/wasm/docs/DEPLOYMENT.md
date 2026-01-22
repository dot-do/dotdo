# chdb WASM Deployment Guide

Comprehensive documentation for deploying chdb WASM across different environments.

## Overview

chdb WASM is a WebAssembly-compiled SQL engine optimized for edge computing environments. It provides a ClickHouse-compatible API powered by DuckDB-WASM, enabling high-performance SQL analytics in browsers, Cloudflare Workers, and Node.js applications.

**Key Capabilities:**

- Execute SQL queries entirely client-side or at the edge
- Support for multiple output formats (JSON, CSV, TSV, Parquet, Arrow)
- ClickHouse SQL syntax compatibility with automatic translation
- Memory-efficient design for constrained environments (~128MB limit)
- Streaming results for large datasets
- Zero-copy data transfer where possible

**Build Profiles:**

| Profile | Gzipped Size | Use Case |
|---------|--------------|----------|
| `minimal` | ~3MB | Basic queries, minimal footprint |
| `standard` | ~10MB | Balanced features (default) |
| `full` | ~20MB | All features enabled |

---

## Browser Deployment

### Loading the Module

Load chdb WASM in browser environments using ES modules:

```html
<!DOCTYPE html>
<html>
<head>
  <title>chdb WASM Demo</title>
</head>
<body>
  <script type="module">
    import { createChdb } from 'https://unpkg.com/@dotdo/chdb-wasm/dist/index.js';

    async function main() {
      const chdb = await createChdb();
      const result = await chdb.query('SELECT 1 + 1 as result', { format: 'JSON' });
      console.log(result);
    }

    main();
  </script>
</body>
</html>
```

### Memory Requirements

Browser environments have varying memory constraints:

| Browser | Typical Limit | Recommended Config |
|---------|---------------|-------------------|
| Chrome | 4GB+ | `memoryLimit: 128MB` |
| Firefox | 4GB+ | `memoryLimit: 128MB` |
| Safari | 2-4GB | `memoryLimit: 64MB` |
| Mobile | 1-2GB | `memoryLimit: 32MB` |

Configure memory limits based on your target environment:

```javascript
const chdb = await createChdb({
  memoryLimit: 64 * 1024 * 1024, // 64MB
});
```

### Sample HTML/JS Code

Complete browser example with query execution and result display:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>chdb WASM Browser Demo</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    textarea { width: 100%; height: 100px; font-family: monospace; }
    pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; }
    button { padding: 0.5rem 1rem; cursor: pointer; }
    #status { color: #666; margin: 1rem 0; }
    #results { margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>chdb WASM Demo</h1>

  <div>
    <label for="query">SQL Query:</label>
    <textarea id="query">SELECT
  number,
  number * 2 as doubled,
  number % 2 = 0 as is_even
FROM generate_series(1, 10) as t(number)</textarea>
  </div>

  <div>
    <label for="format">Output Format:</label>
    <select id="format">
      <option value="JSON">JSON</option>
      <option value="JSONEachRow">JSONEachRow</option>
      <option value="CSV">CSV</option>
      <option value="TSV">TSV</option>
    </select>
  </div>

  <button id="run">Run Query</button>
  <div id="status">Loading chdb WASM...</div>
  <pre id="results"></pre>

  <script type="module">
    import { createChdb } from 'https://unpkg.com/@dotdo/chdb-wasm/dist/index.js';

    let chdb = null;
    const queryEl = document.getElementById('query');
    const formatEl = document.getElementById('format');
    const runBtn = document.getElementById('run');
    const statusEl = document.getElementById('status');
    const resultsEl = document.getElementById('results');

    // Initialize chdb
    async function init() {
      try {
        chdb = await createChdb({
          memoryLimit: 64 * 1024 * 1024,
          logging: true,
        });
        statusEl.textContent = 'Ready';
        runBtn.disabled = false;
      } catch (error) {
        statusEl.textContent = 'Failed to load: ' + error.message;
        console.error(error);
      }
    }

    // Execute query
    async function runQuery() {
      if (!chdb) return;

      const sql = queryEl.value;
      const format = formatEl.value;

      statusEl.textContent = 'Executing...';
      runBtn.disabled = true;

      try {
        const start = performance.now();
        const result = await chdb.query(sql, { format });
        const elapsed = (performance.now() - start).toFixed(2);

        resultsEl.textContent = result;
        statusEl.textContent = `Completed in ${elapsed}ms`;
      } catch (error) {
        resultsEl.textContent = 'Error: ' + error.message;
        statusEl.textContent = 'Query failed';
      } finally {
        runBtn.disabled = false;
      }
    }

    // Event listeners
    runBtn.addEventListener('click', runQuery);
    queryEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runQuery();
      }
    });

    // Initialize on load
    runBtn.disabled = true;
    init();
  </script>
</body>
</html>
```

### Web Worker Usage

For heavy queries, offload processing to a Web Worker to avoid blocking the main thread:

**main.js:**
```javascript
// Create a worker for query execution
const worker = new Worker('chdb-worker.js', { type: 'module' });

// Handle results from worker
worker.onmessage = (event) => {
  const { id, result, error } = event.data;
  if (error) {
    console.error('Query failed:', error);
  } else {
    console.log('Query result:', result);
  }
};

// Send query to worker
function executeQuery(sql, format = 'JSON') {
  const id = Date.now();
  worker.postMessage({ id, sql, format });
  return id;
}

// Example usage
executeQuery('SELECT * FROM generate_series(1, 1000000) LIMIT 100');
```

**chdb-worker.js:**
```javascript
import { createChdb } from '@dotdo/chdb-wasm';

let chdb = null;
let initPromise = null;

// Initialize chdb once
async function ensureInitialized() {
  if (chdb) return chdb;
  if (initPromise) return initPromise;

  initPromise = createChdb({
    memoryLimit: 128 * 1024 * 1024,
    logging: false,
  });

  chdb = await initPromise;
  return chdb;
}

// Handle messages from main thread
self.onmessage = async (event) => {
  const { id, sql, format } = event.data;

  try {
    const instance = await ensureInitialized();
    const result = await instance.query(sql, { format });
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};

// Pre-initialize on worker start
ensureInitialized();
```

**SharedArrayBuffer for Zero-Copy (Advanced):**

For maximum performance with large datasets, use SharedArrayBuffer:

```javascript
// Requires COOP/COEP headers:
// Cross-Origin-Opener-Policy: same-origin
// Cross-Origin-Embedder-Policy: require-corp

const sharedBuffer = new SharedArrayBuffer(1024 * 1024 * 64); // 64MB
const view = new Uint8Array(sharedBuffer);

// Pass shared buffer to worker
worker.postMessage({ sharedBuffer }, []);
```

---

## Cloudflare Workers

### Workers Configuration

Basic `wrangler.toml` configuration:

```toml
name = "chdb-wasm-api"
main = "src/worker.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

# Account configuration
# account_id = "your-account-id"

# Environment variables
[vars]
DUCKDB_VERSION = "1.29.0"

# Static assets for WASM files
[assets]
directory = "./dist"
binding = "ASSETS"

# Development settings
[dev]
port = 8787
local_protocol = "http"

# Observability
[observability]
enabled = true
```

**Worker Implementation:**

```typescript
import { createChdb } from '@dotdo/chdb-wasm';

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/ping') {
      return new Response('Ok.');
    }

    // Parse query from URL or body
    let query: string;
    if (request.method === 'GET') {
      query = url.searchParams.get('query') || 'SELECT 1';
    } else {
      query = await request.text();
    }

    // Get format from header or parameter
    const format = request.headers.get('X-ClickHouse-Format')
      || url.searchParams.get('default_format')
      || 'JSON';

    try {
      const chdb = await createChdb({
        memoryLimit: 64 * 1024 * 1024,
        assets: env.ASSETS,
      });

      const result = await chdb.query(query, { format });

      // Determine content type
      const contentType = format.includes('JSON')
        ? 'application/json'
        : format === 'CSV' || format === 'CSVWithNames'
          ? 'text/csv'
          : 'text/plain';

      return new Response(result, {
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
```

### Limits and Considerations

**Cloudflare Workers Limits:**

| Resource | Free Plan | Paid Plan |
|----------|-----------|-----------|
| Memory | 128MB | 128MB |
| CPU Time | 10ms | 30s (Unbound) |
| Request Size | 100MB | 100MB |
| Subrequest Limit | 50 | 1000 |
| Script Size | 1MB | 10MB (with bundling) |

**Optimization Strategies:**

1. **Use the minimal profile** for fastest cold starts:
   ```typescript
   import { createChdb } from '@dotdo/chdb-wasm/minimal';
   ```

2. **Cache the chdb instance** within a request context:
   ```typescript
   let cachedChdb: ChdbInstance | null = null;

   async function getChdb(env: Env) {
     if (!cachedChdb) {
       cachedChdb = await createChdb({ assets: env.ASSETS });
     }
     return cachedChdb;
   }
   ```

3. **Stream large results** to avoid memory issues:
   ```typescript
   const stream = await chdb.queryStream(sql, { format: 'JSONEachRow' });
   return new Response(
     new ReadableStream({
       async pull(controller) {
         for await (const chunk of stream) {
           controller.enqueue(new TextEncoder().encode(chunk));
         }
         controller.close();
       },
     }),
     { headers: { 'Content-Type': 'application/x-ndjson' } }
   );
   ```

### R2 Integration

Query data stored in Cloudflare R2:

**wrangler.toml:**
```toml
[[r2_buckets]]
binding = "DATA_BUCKET"
bucket_name = "analytics-data"
```

**Worker with R2:**
```typescript
import { createChdb } from '@dotdo/chdb-wasm';

export interface Env {
  ASSETS: Fetcher;
  DATA_BUCKET: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const chdb = await createChdb({ assets: env.ASSETS });

    // Fetch parquet file from R2
    const object = await env.DATA_BUCKET.get('data/events.parquet');
    if (!object) {
      return new Response('Data not found', { status: 404 });
    }

    // Read the parquet data
    const data = await object.arrayBuffer();

    // Create a table from the parquet data
    // Note: This requires loading data into DuckDB first
    await chdb.query(`
      CREATE TABLE events AS
      SELECT * FROM read_parquet('data.parquet')
    `);

    // Query the data
    const result = await chdb.query(`
      SELECT
        date_trunc('hour', timestamp) as hour,
        count(*) as events
      FROM events
      GROUP BY 1
      ORDER BY 1
      FORMAT JSON
    `);

    return new Response(result, {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
```

**Using R2 Custom Domains (Public Access):**
```typescript
// Query parquet files directly via URL
const result = await chdb.query(`
  SELECT *
  FROM read_parquet('https://data.example.com/events.parquet')
  WHERE event_date >= '2024-01-01'
  LIMIT 1000
  FORMAT JSON
`);
```

### Durable Objects for State

Use Durable Objects to maintain persistent chdb instances:

**wrangler.toml:**
```toml
[[durable_objects.bindings]]
name = "ANALYTICS_DO"
class_name = "AnalyticsDO"

[[migrations]]
tag = "v1"
new_classes = ["AnalyticsDO"]
```

**Durable Object Implementation:**
```typescript
import { createChdb, type ChdbInstance } from '@dotdo/chdb-wasm';

export interface Env {
  ANALYTICS_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export class AnalyticsDO implements DurableObject {
  private chdb: ChdbInstance | null = null;
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    // Initialize chdb once - stays warm between requests
    if (!this.chdb) {
      this.chdb = await createChdb({
        memoryLimit: 64 * 1024 * 1024,
        assets: this.env.ASSETS,
        logging: false,
      });

      // Load persisted tables from Durable Object storage
      await this.loadPersistedTables();
    }

    const url = new URL(request.url);

    // Handle different operations
    switch (url.pathname) {
      case '/query':
        return this.handleQuery(request);
      case '/insert':
        return this.handleInsert(request);
      case '/stats':
        return this.handleStats();
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  private async handleQuery(request: Request): Promise<Response> {
    const sql = await request.text();

    try {
      const result = await this.chdb!.query(sql, { format: 'JSON' });
      return new Response(result, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  private async handleInsert(request: Request): Promise<Response> {
    const { table, data } = await request.json<{
      table: string;
      data: Record<string, unknown>[];
    }>();

    // Insert data and persist to storage
    for (const row of data) {
      const columns = Object.keys(row).join(', ');
      const values = Object.values(row)
        .map(v => typeof v === 'string' ? `'${v}'` : v)
        .join(', ');

      await this.chdb!.query(`INSERT INTO ${table} (${columns}) VALUES (${values})`);
    }

    // Persist table data to Durable Object storage
    await this.persistTable(table);

    return new Response(JSON.stringify({ inserted: data.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleStats(): Promise<Response> {
    const stats = this.chdb!.getMemoryStats();
    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async loadPersistedTables(): Promise<void> {
    const tables = await this.state.storage.get<string[]>('tables') || [];

    for (const table of tables) {
      const data = await this.state.storage.get<string>(`table:${table}`);
      if (data) {
        // Recreate table from persisted data
        await this.chdb!.query(data);
      }
    }
  }

  private async persistTable(table: string): Promise<void> {
    // Export table as SQL
    const result = await this.chdb!.query(
      `SELECT * FROM ${table} FORMAT JSONEachRow`
    );

    // Store in Durable Object storage
    await this.state.storage.put(`table:${table}`, result);

    // Track table names
    const tables = await this.state.storage.get<string[]>('tables') || [];
    if (!tables.includes(table)) {
      tables.push(table);
      await this.state.storage.put('tables', tables);
    }
  }
}

// Worker entry point
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route to Durable Object based on tenant ID
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenant') || 'default';

    const id = env.ANALYTICS_DO.idFromName(tenantId);
    const stub = env.ANALYTICS_DO.get(id);

    return stub.fetch(request);
  },
};
```

---

## Node.js

### Loading in Node

Install the package:

```bash
npm install @dotdo/chdb-wasm
# or
pnpm add @dotdo/chdb-wasm
```

**ESM Usage:**
```javascript
import { createChdb } from '@dotdo/chdb-wasm';

const chdb = await createChdb();
const result = await chdb.query('SELECT 1 + 1 as result', { format: 'JSON' });
console.log(result);
```

**CommonJS Usage:**
```javascript
const { createChdb } = require('@dotdo/chdb-wasm');

async function main() {
  const chdb = await createChdb();
  const result = await chdb.query('SELECT 1 + 1 as result', { format: 'JSON' });
  console.log(result);
}

main();
```

### Memory Configuration

Configure Node.js for optimal WASM performance:

```bash
# Increase V8 heap size for large queries
node --max-old-space-size=4096 your-script.js

# Enable WASM optimizations
node --wasm-opt your-script.js
```

**Programmatic Configuration:**
```javascript
import { createChdb } from '@dotdo/chdb-wasm';

const chdb = await createChdb({
  // Set memory limit (default: 64MB)
  memoryLimit: 256 * 1024 * 1024, // 256MB

  // Enable logging for debugging
  logging: true,

  // Custom settings
  settings: {
    max_threads: 4,
    max_block_size: 65536,
  },
});

// Monitor memory usage
const stats = chdb.getMemoryStats();
console.log(`Memory used: ${stats.used / 1024 / 1024}MB`);
console.log(`Peak usage: ${stats.peak / 1024 / 1024}MB`);
console.log(`Limit: ${stats.limit / 1024 / 1024}MB`);
```

### Performance Tips

1. **Reuse chdb instances:**
   ```javascript
   // Create once, reuse many times
   const chdb = await createChdb();

   async function handleRequest(sql) {
     return await chdb.query(sql);
   }
   ```

2. **Use streaming for large results:**
   ```javascript
   import { createWriteStream } from 'fs';
   import { pipeline } from 'stream/promises';

   const chdb = await createChdb();

   // Stream results to file
   const stream = chdb.queryStream(
     'SELECT * FROM large_table FORMAT JSONEachRow'
   );

   const output = createWriteStream('output.jsonl');
   for await (const chunk of stream) {
     output.write(chunk);
   }
   output.end();
   ```

3. **Clear cache periodically:**
   ```javascript
   // For long-running processes
   setInterval(() => {
     chdb.clearCache();
     console.log('Cache cleared');
   }, 60000); // Every minute
   ```

4. **Dispose when done:**
   ```javascript
   const chdb = await createChdb();

   try {
     // Use chdb...
     await chdb.query('SELECT 1');
   } finally {
     chdb.dispose();
   }
   ```

---

## API Reference

### query(sql, format)

Execute a SQL query and return the complete result.

**Signature:**
```typescript
query(sql: string, options?: QueryOptions): Promise<string>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sql` | `string` | The SQL query to execute |
| `options.format` | `OutputFormat` | Output format (default: `'JSON'`) |
| `options.params` | `Record<string, any>` | Query parameters |
| `options.timeout` | `number` | Timeout in milliseconds |

**Example:**
```javascript
const result = await chdb.query(
  'SELECT $1 as value',
  {
    format: 'JSON',
    params: { '1': 42 },
    timeout: 5000,
  }
);
```

### Supported Formats

| Format | Description | Content-Type |
|--------|-------------|--------------|
| `JSON` | Full JSON with metadata | `application/json` |
| `JSONCompact` | Compact JSON with arrays | `application/json` |
| `JSONEachRow` | Newline-delimited JSON (NDJSON) | `application/x-ndjson` |
| `JSONStringsEachRow` | NDJSON with string values | `application/x-ndjson` |
| `CSV` | Comma-separated values | `text/csv` |
| `CSVWithNames` | CSV with header row | `text/csv` |
| `TSV` | Tab-separated values | `text/tab-separated-values` |
| `TSVWithNames` | TSV with header row | `text/tab-separated-values` |
| `Parquet` | Apache Parquet binary | `application/octet-stream` |
| `Arrow` | Apache Arrow IPC | `application/octet-stream` |
| `Pretty` | Human-readable table | `text/plain` |
| `PrettyCompact` | Compact human-readable | `text/plain` |

**Format Examples:**

```javascript
// JSON - Full metadata
const json = await chdb.query('SELECT 1 as n', { format: 'JSON' });
// {"meta":[{"name":"n","type":"Int32"}],"data":[{"n":1}],"rows":1}

// JSONEachRow - One object per line
const ndjson = await chdb.query('SELECT 1 as n UNION ALL SELECT 2', { format: 'JSONEachRow' });
// {"n":1}
// {"n":2}

// CSV
const csv = await chdb.query('SELECT 1 as n, 2 as m', { format: 'CSVWithNames' });
// "n","m"
// 1,2
```

### Error Handling

chdb throws typed errors for different failure modes:

```typescript
import { createChdb, ChdbError, DisposedError } from '@dotdo/chdb-wasm';

const chdb = await createChdb();

try {
  await chdb.query('INVALID SQL');
} catch (error) {
  if (error instanceof ChdbError) {
    console.error('Query error:', error.message);
    console.error('Original query:', error.query);
    console.error('Error code:', error.code);
  } else if (error instanceof DisposedError) {
    console.error('Instance was disposed');
  } else {
    console.error('Unknown error:', error);
  }
}
```

**Error Types:**

| Error | Description |
|-------|-------------|
| `ChdbError` | Query execution failed |
| `DisposedError` | Instance has been disposed |

---

## Examples

### Basic SELECT

```javascript
import { createChdb } from '@dotdo/chdb-wasm';

const chdb = await createChdb();

// Simple arithmetic
const result1 = await chdb.query('SELECT 1 + 1 as sum');
console.log(result1);
// {"meta":[{"name":"sum","type":"Int32"}],"data":[{"sum":2}],"rows":1}

// Generate series
const result2 = await chdb.query(`
  SELECT number, number * number as squared
  FROM generate_series(1, 5) as t(number)
  FORMAT JSONEachRow
`);
console.log(result2);
// {"number":1,"squared":1}
// {"number":2,"squared":4}
// {"number":3,"squared":9}
// {"number":4,"squared":16}
// {"number":5,"squared":25}

// Date/time functions
const result3 = await chdb.query(`
  SELECT
    current_date as today,
    current_timestamp as now,
    extract(dow from current_date) as day_of_week
  FORMAT JSON
`);
console.log(result3);
```

### CREATE TABLE / INSERT / SELECT

```javascript
import { createChdb } from '@dotdo/chdb-wasm';

const chdb = await createChdb();

// Create a table
await chdb.query(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name VARCHAR,
    email VARCHAR,
    created_at TIMESTAMP DEFAULT current_timestamp
  )
`);

// Insert data
await chdb.query(`
  INSERT INTO users (id, name, email) VALUES
    (1, 'Alice', 'alice@example.com'),
    (2, 'Bob', 'bob@example.com'),
    (3, 'Charlie', 'charlie@example.com')
`);

// Query the data
const result = await chdb.query(`
  SELECT id, name, email
  FROM users
  WHERE name LIKE '%li%'
  ORDER BY name
  FORMAT JSON
`);
console.log(result);
// {"meta":[...],"data":[{"id":1,"name":"Alice","email":"alice@example.com"},{"id":3,"name":"Charlie","email":"charlie@example.com"}],"rows":2}

// Update data
await chdb.query(`
  UPDATE users
  SET email = 'alice.smith@example.com'
  WHERE id = 1
`);

// Delete data
await chdb.query(`DELETE FROM users WHERE id = 2`);

// Verify changes
const updated = await chdb.query('SELECT * FROM users FORMAT JSONEachRow');
console.log(updated);
```

### Aggregations

```javascript
import { createChdb } from '@dotdo/chdb-wasm';

const chdb = await createChdb();

// Create sample data
await chdb.query(`
  CREATE TABLE sales (
    id INTEGER,
    product VARCHAR,
    category VARCHAR,
    amount DECIMAL(10, 2),
    sale_date DATE
  )
`);

await chdb.query(`
  INSERT INTO sales VALUES
    (1, 'Widget A', 'Electronics', 99.99, '2024-01-15'),
    (2, 'Widget B', 'Electronics', 149.99, '2024-01-16'),
    (3, 'Gadget X', 'Electronics', 299.99, '2024-01-17'),
    (4, 'Tool 1', 'Hardware', 49.99, '2024-01-15'),
    (5, 'Tool 2', 'Hardware', 79.99, '2024-01-16'),
    (6, 'Widget A', 'Electronics', 99.99, '2024-01-18'),
    (7, 'Tool 1', 'Hardware', 49.99, '2024-01-18')
`);

// Basic aggregations
const totals = await chdb.query(`
  SELECT
    category,
    count(*) as num_sales,
    sum(amount) as total_revenue,
    avg(amount) as avg_sale,
    min(amount) as min_sale,
    max(amount) as max_sale
  FROM sales
  GROUP BY category
  ORDER BY total_revenue DESC
  FORMAT JSON
`);
console.log('Totals by category:', totals);

// Window functions
const rankings = await chdb.query(`
  SELECT
    product,
    category,
    amount,
    row_number() OVER (PARTITION BY category ORDER BY amount DESC) as rank_in_category,
    sum(amount) OVER (PARTITION BY category) as category_total
  FROM sales
  ORDER BY category, rank_in_category
  FORMAT JSONEachRow
`);
console.log('Product rankings:', rankings);

// Date-based aggregations
const daily = await chdb.query(`
  SELECT
    sale_date,
    count(*) as num_sales,
    sum(amount) as daily_total
  FROM sales
  GROUP BY sale_date
  ORDER BY sale_date
  FORMAT JSON
`);
console.log('Daily sales:', daily);

// Top products
const top = await chdb.query(`
  SELECT
    product,
    sum(amount) as total,
    count(*) as times_sold
  FROM sales
  GROUP BY product
  ORDER BY total DESC
  LIMIT 3
  FORMAT JSON
`);
console.log('Top 3 products:', top);
```

### Working with JSON

```javascript
import { createChdb } from '@dotdo/chdb-wasm';

const chdb = await createChdb();

// Create table with JSON column
await chdb.query(`
  CREATE TABLE events (
    id INTEGER,
    event_type VARCHAR,
    payload JSON,
    created_at TIMESTAMP
  )
`);

// Insert JSON data
await chdb.query(`
  INSERT INTO events VALUES
    (1, 'page_view', '{"url": "/home", "user_id": 123, "duration": 45}', '2024-01-15 10:00:00'),
    (2, 'click', '{"element": "button", "user_id": 123, "x": 100, "y": 200}', '2024-01-15 10:01:00'),
    (3, 'page_view', '{"url": "/products", "user_id": 456, "duration": 120}', '2024-01-15 10:02:00'),
    (4, 'purchase', '{"product_id": 789, "user_id": 123, "amount": 99.99}', '2024-01-15 10:05:00')
`);

// Extract JSON fields
const extracted = await chdb.query(`
  SELECT
    id,
    event_type,
    payload->>'user_id' as user_id,
    payload->>'url' as url,
    payload->>'amount' as amount
  FROM events
  FORMAT JSONEachRow
`);
console.log('Extracted fields:', extracted);

// Filter by JSON field
const userEvents = await chdb.query(`
  SELECT event_type, payload
  FROM events
  WHERE (payload->>'user_id')::int = 123
  FORMAT JSON
`);
console.log('User 123 events:', userEvents);

// Aggregate JSON data
const stats = await chdb.query(`
  SELECT
    event_type,
    count(*) as count,
    array_agg(DISTINCT payload->>'user_id') as unique_users
  FROM events
  GROUP BY event_type
  FORMAT JSON
`);
console.log('Event stats:', stats);

// Create JSON output
const jsonOutput = await chdb.query(`
  SELECT json_object(
    'event_count', count(*),
    'unique_users', count(DISTINCT payload->>'user_id'),
    'events_by_type', json_group_object(event_type, cnt)
  ) as summary
  FROM events, (
    SELECT event_type, count(*) as cnt
    FROM events
    GROUP BY event_type
  ) as type_counts
  FORMAT JSONEachRow
`);
console.log('JSON summary:', jsonOutput);
```

---

## Troubleshooting

### Common Issues

**1. WASM fails to load in browser:**
```
Error: Failed to compile WebAssembly module
```
- Ensure CORS headers are set: `Access-Control-Allow-Origin: *`
- Check that the WASM file is served with `Content-Type: application/wasm`
- Verify the WASM file is not corrupted during transfer

**2. Memory errors in Workers:**
```
Error: WebAssembly.Memory(): could not allocate memory
```
- Reduce `memoryLimit` to 64MB or less
- Use the `minimal` profile
- Stream results instead of loading all at once

**3. Query timeout in Workers:**
```
Error: Script exceeded CPU time limit
```
- Use Cloudflare Workers Paid plan for longer CPU limits
- Optimize queries with LIMIT clauses
- Pre-aggregate data when possible

**4. Module not found in Node.js:**
```
Error: Cannot find module '@dotdo/chdb-wasm'
```
- Ensure the package is installed: `npm install @dotdo/chdb-wasm`
- Check that you're using Node.js 18 or later
- Verify `"type": "module"` in package.json for ESM

### Debug Mode

Enable logging for troubleshooting:

```javascript
const chdb = await createChdb({
  logging: true,
});

// Monitor memory
setInterval(() => {
  const stats = chdb.getMemoryStats();
  console.log('Memory:', {
    used: `${(stats.used / 1024 / 1024).toFixed(2)}MB`,
    peak: `${(stats.peak / 1024 / 1024).toFixed(2)}MB`,
    limit: `${(stats.limit / 1024 / 1024).toFixed(2)}MB`,
  });
}, 5000);
```
