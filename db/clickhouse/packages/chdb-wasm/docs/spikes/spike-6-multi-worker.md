# Spike 6: Distribute ClickHouse Across Multiple Workers

## Executive Summary

This spike explores distributing ClickHouse functionality across multiple Cloudflare Workers using Service Bindings and RPC. The key insight is that **each Worker gets its own 128MB memory limit**, so distributing functionality across N workers effectively multiplies available memory to N x 128MB.

## Research Findings

### Cloudflare Service Bindings

Service Bindings allow Workers to call other Workers directly without going through the public internet. Key characteristics:

1. **Zero Network Latency**: Workers connected via Service Bindings typically run on the same thread of the same Cloudflare server. RPC calls have essentially zero network overhead.

2. **JavaScript-Native RPC**: Workers can expose methods via `WorkerEntrypoint` classes that are called as if they were local async functions.

3. **Deploy-Time Binding**: Service bindings are declared at deploy time in `wrangler.toml` and cannot be created dynamically at runtime.

### Configuration Example

**Provider Worker (chdb-math-worker):**
```toml
# wrangler.toml for math functions worker
name = "chdb-math-worker"
main = "./src/math-worker.ts"
```

```typescript
// math-worker.ts
import { WorkerEntrypoint } from "cloudflare:workers";

export class MathService extends WorkerEntrypoint {
  async computeAggregate(operation: string, values: number[]): Promise<number> {
    switch (operation) {
      case 'sum': return values.reduce((a, b) => a + b, 0);
      case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min': return Math.min(...values);
      case 'max': return Math.max(...values);
      default: throw new Error(`Unknown operation: ${operation}`);
    }
  }
}

export default MathService;
```

**Consumer Worker (chdb-coordinator):**
```toml
# wrangler.toml for coordinator worker
name = "chdb-wasm"
main = "./src/worker.ts"

[[services]]
binding = "MATH_SERVICE"
service = "chdb-math-worker"
entrypoint = "MathService"

[[services]]
binding = "AGGREGATE_SERVICE"
service = "chdb-aggregate-worker"
entrypoint = "AggregateService"

[[services]]
binding = "PARSER_SERVICE"
service = "chdb-parser-worker"
entrypoint = "ParserService"

[[services]]
binding = "STORAGE_SERVICE"
service = "chdb-storage-worker"
entrypoint = "StorageService"
```

```typescript
// coordinator-worker.ts
interface Env {
  MATH_SERVICE: Service<MathService>;
  AGGREGATE_SERVICE: Service<AggregateService>;
  PARSER_SERVICE: Service<ParserService>;
  STORAGE_SERVICE: Service<StorageService>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Call math service via RPC
    const result = await env.MATH_SERVICE.computeAggregate('sum', [1, 2, 3]);
    return new Response(String(result));
  }
};
```

### Durable Objects for State Coordination

The current architecture already uses Durable Objects for:
- `MemoryEngineDO` - In-memory tables with persistence
- `MergeTreeDO` - MergeTree table metadata and part management
- `DocumentDBDO` - Document database operations

Key limits for Durable Objects:
- **CPU per request**: 30 seconds (configurable to 5 minutes)
- **Storage per DO**: 10 GB (SQLite-backed)
- **Storage per account**: Unlimited (Workers Paid plan)
- **Requests per object**: ~1,000/second soft limit

## Current Worker Architecture

The main worker (`src/worker.ts`) currently handles:

1. **HTTP Endpoints**:
   - `/` - ClickHouse HTTP query interface
   - `/play` - Web UI for query editing
   - `/query` - SQL execution with extension auto-loading
   - `/extensions` - Extension management
   - `/mergetree` - MergeTree WASM endpoints
   - `/clickbench` - Benchmark endpoints
   - `/ping`, `/health` - Health checks
   - WASM file serving

2. **Core Components**:
   - `http-query-handler.ts` - Query parsing and execution
   - `bundled-executor.ts` - Minimal WASM SQL executor (~187KB)
   - `chdb-backend.ts` - Full chDB WASM backend (R2-loaded)
   - `extension-loader.ts` - Dynamic extension loading
   - `extension-auto-detect.ts` - SQL function detection

3. **Storage Layer**:
   - `storage/memory-do.ts` - Memory engine DO
   - `storage/mergetree-do.ts` - MergeTree DO
   - `storage/document-do.ts` - Document DB DO
   - `storage/r2-provider.ts` - R2 storage provider

## Proposed Multi-Worker Architecture

```
                                    +------------------+
                                    |   Client/User    |
                                    +--------+---------+
                                             |
                                             v
+------------------------------------------------------------------------------------+
|                              COORDINATOR WORKER (128MB)                            |
|                                                                                    |
|  +-------------+  +-------------+  +-------------+  +-------------+               |
|  | HTTP Router |  | Query Plan  |  | Result Agg  |  | Extensions  |               |
|  |             |  | Coordinator |  | & Formatter |  | Dispatcher  |               |
|  +-------------+  +------+------+  +------+------+  +------+------+               |
|                          |                |                |                       |
+--------------------------|----------------|----------------|----------------------+
                           |                |                |
          +----------------+----------------+----------------+----------------+
          |                |                |                |                |
          v                v                v                v                v
+----------------+ +----------------+ +----------------+ +----------------+ +----------------+
| PARSER WORKER  | | MATH WORKER    | | AGGREGATE      | | STORAGE WORKER | | EXTENSION      |
| (128MB)        | | (128MB)        | | WORKER (128MB) | | (128MB)        | | WORKERS (128MB)|
|                | |                | |                | |                | |                |
| - SQL Parsing  | | - sin/cos/tan  | | - sum/avg/min  | | - MergeTree    | | - ext-geo      |
| - AST Builder  | | - log/exp/pow  | | - max/count    | | - Memory Eng   | | - ext-json     |
| - Query Valid. | | - sqrt/cbrt    | | - uniq/quantile| | - R2 I/O       | | - ext-crypto   |
| - Plan Gen.    | | - random       | | - group by     | | - Part Mgmt    | | - ext-url      |
+----------------+ +----------------+ +----------------+ +----------------+ +----------------+
          |                                                     |
          |                                                     v
          |                                            +----------------+
          |                                            | DURABLE OBJECTS|
          |                                            |                |
          |                                            | - MemoryDO     |
          |                                            | - MergeTreeDO  |
          |                                            | - DocumentDO   |
          +--------------------------------------------> (10GB each)    |
                                                       +----------------+
```

### Worker Responsibilities

#### 1. Coordinator Worker (Main Entry Point)
- Receives all HTTP requests
- Routes queries to appropriate workers
- Aggregates results from multiple workers
- Manages session state
- Handles authentication

```typescript
// src/coordinator/worker.ts
import { WorkerEntrypoint } from "cloudflare:workers";

interface Env {
  PARSER: Service<ParserService>;
  MATH: Service<MathService>;
  AGGREGATE: Service<AggregateService>;
  STORAGE: Service<StorageService>;
  EXTENSIONS: Service<ExtensionDispatcher>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sql = url.searchParams.get('query');

    // 1. Parse query via Parser Worker
    const ast = await env.PARSER.parse(sql);

    // 2. Create execution plan
    const plan = await env.PARSER.createPlan(ast);

    // 3. Execute plan across workers
    const results = await executeDistributedPlan(plan, env);

    // 4. Aggregate and format results
    return formatResponse(results);
  }
};
```

#### 2. Parser Worker
- SQL parsing and validation
- AST generation
- Query plan creation
- Semantic analysis

```typescript
// src/parser/worker.ts
import { WorkerEntrypoint } from "cloudflare:workers";

export interface QueryPlan {
  type: 'select' | 'insert' | 'create' | 'drop';
  tables: string[];
  functions: FunctionCall[];
  aggregates: AggregateCall[];
  projections: Projection[];
  filters: Filter[];
  groups: GroupBy[];
  orders: OrderBy[];
  limit?: number;
}

export class ParserService extends WorkerEntrypoint {
  async parse(sql: string): Promise<AST> {
    // Load parser WASM (~5MB)
    // Parse SQL to AST
  }

  async createPlan(ast: AST): Promise<QueryPlan> {
    // Analyze AST and create execution plan
  }

  async validate(sql: string): Promise<ValidationResult> {
    // Validate SQL syntax and semantics
  }
}
```

#### 3. Math Functions Worker
- Mathematical computations
- Scientific functions
- Random number generation

```typescript
// src/math/worker.ts
import { WorkerEntrypoint } from "cloudflare:workers";

export class MathService extends WorkerEntrypoint {
  // Trigonometric
  async sin(x: number[]): Promise<number[]> { ... }
  async cos(x: number[]): Promise<number[]> { ... }
  async tan(x: number[]): Promise<number[]> { ... }

  // Logarithmic
  async log(x: number[]): Promise<number[]> { ... }
  async log10(x: number[]): Promise<number[]> { ... }
  async exp(x: number[]): Promise<number[]> { ... }

  // Power/Root
  async pow(base: number[], exp: number): Promise<number[]> { ... }
  async sqrt(x: number[]): Promise<number[]> { ... }

  // Vectorized operations
  async batchMath(ops: MathOp[]): Promise<number[][]> {
    // Execute multiple math operations in one RPC call
  }
}
```

#### 4. Aggregate Functions Worker
- GROUP BY aggregations
- Window functions
- Statistical computations

```typescript
// src/aggregate/worker.ts
import { WorkerEntrypoint } from "cloudflare:workers";

export class AggregateService extends WorkerEntrypoint {
  // Basic aggregates
  async sum(values: number[]): Promise<number> { ... }
  async avg(values: number[]): Promise<number> { ... }
  async min(values: number[]): Promise<number> { ... }
  async max(values: number[]): Promise<number> { ... }
  async count(values: unknown[]): Promise<number> { ... }

  // Advanced aggregates
  async quantile(values: number[], q: number): Promise<number> { ... }
  async median(values: number[]): Promise<number> { ... }
  async stddev(values: number[]): Promise<number> { ... }

  // Cardinality
  async uniq(values: unknown[]): Promise<number> { ... }
  async uniqExact(values: unknown[]): Promise<number> { ... }

  // Group operations
  async groupBy(
    data: Row[],
    groupCols: string[],
    aggregates: AggregateSpec[]
  ): Promise<Row[]> { ... }
}
```

#### 5. Storage Worker
- MergeTree engine operations
- Memory engine operations
- R2 I/O coordination

```typescript
// src/storage/worker.ts
import { WorkerEntrypoint } from "cloudflare:workers";

export class StorageService extends WorkerEntrypoint {
  // Table operations
  async createTable(schema: TableSchema): Promise<void> { ... }
  async dropTable(name: string): Promise<void> { ... }

  // Data operations
  async insert(table: string, rows: Row[]): Promise<InsertResult> { ... }
  async select(table: string, filter: Filter): Promise<Row[]> { ... }
  async scan(table: string, range: Range): Promise<Row[]> { ... }

  // MergeTree specific
  async merge(table: string, parts: string[]): Promise<void> { ... }
  async compact(table: string): Promise<void> { ... }

  // Streaming for large results
  async *scanStream(table: string): AsyncGenerator<Row[]> { ... }
}
```

#### 6. Extension Workers
Each extension in its own worker to isolate memory usage:

```typescript
// src/extensions/geo-worker.ts
export class GeoExtension extends WorkerEntrypoint {
  async h3ToGeo(h3Index: string): Promise<[number, number]> { ... }
  async geoToH3(lat: number, lng: number, res: number): Promise<string> { ... }
  async geoDistance(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number> { ... }
}

// src/extensions/json-worker.ts
export class JsonExtension extends WorkerEntrypoint {
  async jsonPath(json: string, path: string): Promise<unknown> { ... }
  async jsonExtract(json: string, key: string): Promise<string> { ... }
}

// src/extensions/crypto-worker.ts
export class CryptoExtension extends WorkerEntrypoint {
  async sha256(data: string): Promise<string> { ... }
  async md5(data: string): Promise<string> { ... }
  async encrypt(data: string, key: string): Promise<string> { ... }
}
```

## Query Flow Example

Consider the query:
```sql
SELECT
  date,
  sum(revenue) as total_revenue,
  avg(revenue) as avg_revenue,
  sin(avg_revenue) as sin_avg
FROM sales
WHERE date >= '2024-01-01'
GROUP BY date
ORDER BY total_revenue DESC
LIMIT 10
```

### Execution Flow:

```
1. Coordinator receives request
   |
   v
2. PARSER_SERVICE.parse(sql)
   |---> Returns AST with:
   |     - tables: ['sales']
   |     - functions: [sin]
   |     - aggregates: [sum, avg]
   |     - groups: [date]
   |
   v
3. PARSER_SERVICE.createPlan(ast)
   |---> Returns QueryPlan:
   |     {
   |       scan: { table: 'sales', filter: 'date >= 2024-01-01' },
   |       aggregate: { group: ['date'], ops: ['sum(revenue)', 'avg(revenue)'] },
   |       compute: { function: 'sin', input: 'avg_revenue' },
   |       sort: { by: 'total_revenue', order: 'DESC' },
   |       limit: 10
   |     }
   |
   v
4. STORAGE_SERVICE.scan('sales', { date: '>= 2024-01-01' })
   |---> Returns raw rows from storage
   |
   v
5. AGGREGATE_SERVICE.groupBy(rows, ['date'], [sum, avg])
   |---> Returns grouped results:
   |     [{ date: '2024-01-01', sum_revenue: 1000, avg_revenue: 100 }, ...]
   |
   v
6. MATH_SERVICE.sin(avg_revenue_values)
   |---> Returns sin values for each group
   |
   v
7. Coordinator sorts and limits results
   |
   v
8. Format and return response
```

## wrangler.toml Configuration

Complete configuration for the multi-worker architecture:

```toml
# Main coordinator worker
name = "chdb-wasm"
main = "src/coordinator/worker.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

# Service bindings to sub-workers
[[services]]
binding = "PARSER_SERVICE"
service = "chdb-parser-worker"
entrypoint = "ParserService"

[[services]]
binding = "MATH_SERVICE"
service = "chdb-math-worker"
entrypoint = "MathService"

[[services]]
binding = "AGGREGATE_SERVICE"
service = "chdb-aggregate-worker"
entrypoint = "AggregateService"

[[services]]
binding = "STORAGE_SERVICE"
service = "chdb-storage-worker"
entrypoint = "StorageService"

[[services]]
binding = "GEO_EXTENSION"
service = "chdb-ext-geo"
entrypoint = "GeoExtension"

[[services]]
binding = "JSON_EXTENSION"
service = "chdb-ext-json"
entrypoint = "JsonExtension"

[[services]]
binding = "CRYPTO_EXTENSION"
service = "chdb-ext-crypto"
entrypoint = "CryptoExtension"

# Durable Objects (remain in main worker for now)
[[durable_objects.bindings]]
name = "MEMORY_ENGINE_DO"
class_name = "MemoryEngineDO"

[[durable_objects.bindings]]
name = "MERGETREE_DO"
class_name = "MergeTreeDO"

[[durable_objects.bindings]]
name = "DOCUMENT_DB_DO"
class_name = "DocumentDBDO"

# R2 Storage
[[r2_buckets]]
binding = "DATA_BUCKET"
bucket_name = "chdb-document-data"

# Static Assets
[assets]
directory = "./public"
binding = "ASSETS"
```

## Memory Budget Analysis

With multi-worker architecture:

| Component | Memory Budget | Notes |
|-----------|---------------|-------|
| Coordinator | 128MB | Query routing, result aggregation |
| Parser Worker | 128MB | SQL parsing WASM (~5MB) |
| Math Worker | 128MB | Math functions, can handle large arrays |
| Aggregate Worker | 128MB | GROUP BY state, HyperLogLog |
| Storage Worker | 128MB | I/O buffers, part caching |
| Geo Extension | 128MB | H3 library (~10MB) |
| JSON Extension | 128MB | JSON parsing, path evaluation |
| Crypto Extension | 128MB | Crypto algorithms |
| **Total Available** | **1,024MB** | 8 workers x 128MB |

Compare to current: 128MB for everything.

## Pros and Cons

### Pros

1. **8x Memory Capacity**: 1GB+ total memory vs 128MB single worker
2. **Parallel Execution**: Independent workers can run concurrently
3. **Fault Isolation**: One worker crashing doesn't affect others
4. **Independent Scaling**: Heavy-use components can be optimized separately
5. **Cleaner Code Organization**: Clear separation of concerns
6. **Selective Deployment**: Only deploy changed workers
7. **Zero Network Latency**: RPC runs on same thread typically

### Cons

1. **Deployment Complexity**: 8+ workers to deploy and manage
2. **Debugging Difficulty**: Distributed tracing needed
3. **Serialization Overhead**: Data must be serialized for RPC (though minimal)
4. **Cold Start Multiplication**: Each worker has its own cold start
5. **Cost**: More workers = more billing (though proportional)
6. **Local Development**: Must run multiple wrangler instances
7. **Version Coordination**: All workers must be compatible

## Implementation Phases

### Phase 1: Parser Worker Extraction
- Extract SQL parsing to separate worker
- Minimal WASM bundle (~5MB)
- Enables syntax validation at edge

### Phase 2: Storage Worker Extraction
- Move Durable Object coordination to dedicated worker
- R2 I/O isolation
- Prepare for sharding

### Phase 3: Aggregate Worker
- GROUP BY and aggregation logic
- Window functions
- Statistical functions

### Phase 4: Math Functions Worker
- Scientific functions
- Vectorized operations
- Random number generation

### Phase 5: Extension Workers
- One worker per extension family
- Lazy loading based on query analysis
- Pay-per-use memory model

## Local Development

To run multiple workers locally:

```bash
# Terminal 1: Coordinator
npx wrangler dev -c wrangler.toml

# Terminal 2: Parser Worker
npx wrangler dev -c workers/parser/wrangler.toml

# Terminal 3: Aggregate Worker
npx wrangler dev -c workers/aggregate/wrangler.toml

# Or use multi-config mode (experimental)
npx wrangler dev \
  -c wrangler.toml \
  -c workers/parser/wrangler.toml \
  -c workers/aggregate/wrangler.toml
```

## Conclusion

The multi-worker architecture is a viable approach to overcome the 128MB memory limit. Key recommendations:

1. **Start with Parser Worker**: Lowest risk, immediate benefit for query validation
2. **Use Durable Objects for coordination**: They already handle distributed state well
3. **Batch RPC calls**: Minimize round-trips by batching operations
4. **Stream large results**: Use async generators for large data sets
5. **Monitor cold starts**: Consider worker prewarming strategies

The architecture multiplies available memory while maintaining the edge computing benefits of Cloudflare Workers. Implementation should be incremental, starting with the highest-value components (Parser, Storage) before moving to specialized workers (Extensions).

## References

- [Cloudflare Service Bindings Documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Cloudflare Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [JavaScript-Native RPC Announcement](https://blog.cloudflare.com/javascript-native-rpc/)
- [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
