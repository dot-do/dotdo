---
title: "SQL Parser Options"
description: Documentation for docs
---

# SQL Parser Options

> Parsing SQL across different dialects for compat layers

## Overview

SQL parsing is essential for dotdo's compatibility layers (`@dotdo/postgres`, `@dotdo/mysql`, `@dotdo/turso`). When translating SDK calls to Durable Object-backed storage, the compat layer must:

1. **Validate queries** before execution
2. **Transform ASTs** for DO-backed storage operations
3. **Generate SQL** from modified ASTs
4. **Extract metadata** (table names, columns, WHERE clauses) for routing

The challenge: parsing SQL accurately across PostgreSQL, MySQL, and SQLite dialects while keeping bundle sizes small for Cloudflare Workers.

## Available Parsers

| Parser | Bundle Size | Cold Start | Warm Parse | Dialects |
|--------|-------------|------------|------------|----------|
| node-sql-parser | ~298 KB | 7.7 ms | 80 us | MySQL, PostgreSQL, MariaDB, BigQuery, SQLite, Transact-SQL |
| pgsql-parser | ~1.2 MB | 8.5 ms* | 16 us | PostgreSQL only (actual PG C parser via WASM) |

*Plus WASM compilation overhead on first isolate

**Key tradeoff**: node-sql-parser is 4x smaller but pgsql-parser is 5x faster for warm parsing.

## Benchmark Results

Performance measured on Cloudflare Workers-equivalent environment:

### Simple SELECT
```sql
SELECT * FROM users WHERE id = $1
```

| Parser | Time |
|--------|------|
| node-sql-parser | 80.8 us |
| pgsql-parser | 15.7 us |

**pgsql-parser is 5.1x faster**

### Complex JOIN
```sql
SELECT u.*, COUNT(e.id) as event_count
FROM users u
JOIN events e ON u.id = e.user_id
GROUP BY u.id
```

| Parser | Time |
|--------|------|
| node-sql-parser | 153.3 us |
| pgsql-parser | 26.7 us |

**pgsql-parser is 5.7x faster**

### CTE Query
```sql
WITH active_users AS (
  SELECT id, name FROM users WHERE status = 'active'
)
SELECT au.name, COUNT(e.id) as events
FROM active_users au
LEFT JOIN events e ON au.id = e.user_id
GROUP BY au.id, au.name
ORDER BY events DESC
LIMIT 10
```

| Parser | Time |
|--------|------|
| node-sql-parser | 376.9 us |
| pgsql-parser | 29.9 us |

**pgsql-parser is 12.6x faster**

### Summary

- **Bundle size**: node-sql-parser is 4x smaller
- **Warm parsing**: pgsql-parser is 5-13x faster (more complex = bigger gap)
- **Cold start**: Similar (~8ms), but pgsql-parser has additional WASM compilation cost

## Architecture Options

### Option 1: In-Process (Default)

Best for simple queries and when bundle size is critical.

```typescript
import { createSQLParser } from 'dotdo/sql'

const parser = createSQLParser({
  adapter: 'node-sql-parser',
  dialect: 'postgresql'
})

// Synchronous parsing
const ast = parser.parse('SELECT * FROM users WHERE id = $1')

// Convert back to SQL
const sql = parser.stringify(ast)

// Validate without parsing
const result = parser.validate('SELECT * FORM users') // typo
// { valid: false, error: 'Syntax error near FORM' }
```

### Option 2: External Worker via RPC

Best for high-throughput SQL operations or when 100% PostgreSQL compatibility is required.

```typescript
import { createSQLParser } from 'dotdo/sql'

const parser = createSQLParser({
  adapter: 'pgsql-parser',
  worker: env.SQL_PARSER_WORKER  // Service binding to dedicated worker
})

// Transparently calls external worker
const ast = await parser.parse(complexQuery)

// Batch parsing for efficiency
const asts = await parser.parseBatch([query1, query2, query3])
```

The RPC approach:
- Keeps main worker bundle under 1MB
- Amortizes WASM compilation across many requests
- Adds ~0.1ms latency per call (Service Binding RPC)

## When to Use Each

### Use node-sql-parser when:

- **Bundle size is critical** - Staying under 1MB compressed for fast cold starts
- **Parsing simple queries** - Basic CRUD operations where 80us is acceptable
- **Need multi-dialect support** - MySQL, PostgreSQL, SQLite in same worker
- **Main worker bundle** - Default choice for compat layers

```typescript
// Good for: simple validation and routing
const parser = createSQLParser({
  adapter: 'node-sql-parser',
  dialect: 'postgresql'
})

// Parse incoming query to extract table name for routing
const ast = parser.parse(query)
const table = extractTableName(ast)
const stub = await shardRouter.getStub(table)
```

### Use pgsql-parser when:

- **Parsing complex queries frequently** - CTEs, window functions, subqueries
- **Need 100% PostgreSQL compatibility** - Uses actual PG parser from C code
- **Can use separate worker** - Deploy as RPC service
- **High throughput SQL operations** - Thousands of parses per second

```typescript
// Good for: query transformation pipelines
const parser = createSQLParser({
  adapter: 'pgsql-parser',
  worker: env.SQL_PARSER_WORKER
})

// Parse, transform, regenerate
const ast = await parser.parse(userQuery)
const transformed = addTenantFilter(ast, tenantId)
const finalQuery = await parser.stringify(transformed)
```

## Worker Setup for pgsql-parser

Deploy pgsql-parser as a dedicated worker to isolate the WASM bundle.

### Worker Implementation

```typescript
// workers/sql-parser/index.ts
import { parse, parseSync, deparse, loadModule } from 'pgsql-parser'

export interface Env {
  // No bindings needed
}

// Pre-load WASM module
let moduleLoaded = false

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Ensure WASM is loaded (cached after first call)
    if (!moduleLoaded) {
      await loadModule()
      moduleLoaded = true
    }

    const { action, sql, asts } = await request.json<{
      action: 'parse' | 'stringify' | 'validate' | 'batch'
      sql?: string
      asts?: unknown[]
    }>()

    try {
      switch (action) {
        case 'parse':
          return Response.json({
            success: true,
            ast: parseSync(sql!)
          })

        case 'stringify':
          return Response.json({
            success: true,
            sql: deparse(asts![0])
          })

        case 'validate':
          try {
            parseSync(sql!)
            return Response.json({ valid: true })
          } catch (e) {
            return Response.json({
              valid: false,
              error: (e as Error).message
            })
          }

        case 'batch':
          const results = (sql as unknown as string[]).map(s => {
            try {
              return { success: true, ast: parseSync(s) }
            } catch (e) {
              return { success: false, error: (e as Error).message }
            }
          })
          return Response.json({ results })

        default:
          return Response.json({ error: 'Unknown action' }, { status: 400 })
      }
    } catch (e) {
      return Response.json({
        success: false,
        error: (e as Error).message
      }, { status: 500 })
    }
  }
}
```

### Wrangler Configuration

```toml
# workers/sql-parser/wrangler.toml
name = "sql-parser"
main = "index.ts"
compatibility_date = "2024-01-01"

# WASM support
[build]
command = ""

# No size limit concerns - dedicated worker
[vars]
ENVIRONMENT = "production"
```

### Binding in Main Worker

```toml
# wrangler.toml (main app)
[[services]]
binding = "SQL_PARSER_WORKER"
service = "sql-parser"
```

## Unified Interface

Both adapters implement the same interface:

```typescript
interface SQLParser {
  /**
   * Parse SQL into an AST
   * @throws SyntaxError if SQL is invalid
   */
  parse(sql: string, options?: ParseOptions): AST | Promise<AST>

  /**
   * Convert AST back to SQL string
   */
  stringify(ast: AST): string | Promise<string>

  /**
   * Validate SQL syntax without returning AST
   */
  validate(sql: string): ValidationResult | Promise<ValidationResult>

  /**
   * Parse multiple queries efficiently
   */
  parseBatch?(queries: string[]): Promise<AST[]>
}

interface ParseOptions {
  /** Database dialect (node-sql-parser only) */
  dialect?: 'postgresql' | 'mysql' | 'sqlite' | 'mariadb' | 'bigquery'

  /** Parameter style: $1 or ? */
  paramStyle?: 'numbered' | 'positional'
}

interface ValidationResult {
  valid: boolean
  error?: string
  position?: { line: number; column: number }
}

type AST = {
  type: 'select' | 'insert' | 'update' | 'delete' | 'create' | 'drop' | ...
  // Parser-specific structure
  [key: string]: unknown
}
```

## Integration with Compat Layers

The SQL parser integrates with compat layers at several points:

### Query Validation

```typescript
// compat/postgres/client.ts
class DotdoPostgresClient {
  private parser = createSQLParser({ adapter: 'node-sql-parser', dialect: 'postgresql' })

  async query(sql: string, params?: unknown[]) {
    // Validate before execution
    const validation = this.parser.validate(sql)
    if (!validation.valid) {
      throw new Error(`SQL syntax error: ${validation.error}`)
    }

    // Route to appropriate DO
    const ast = this.parser.parse(sql)
    const table = this.extractTable(ast)
    const stub = await this.shardRouter.getStub(table)

    return stub.fetch('/query', { sql, params })
  }
}
```

### AST Transformation for DO Storage

```typescript
// compat/core/query/translator.ts
export function addTenantFilter(ast: AST, tenantId: string): AST {
  // Inject tenant_id = ? into WHERE clause
  if (ast.type === 'select' || ast.type === 'update' || ast.type === 'delete') {
    ast.where = {
      type: 'binary_expr',
      operator: 'AND',
      left: ast.where || { type: 'boolean', value: true },
      right: {
        type: 'binary_expr',
        operator: '=',
        left: { type: 'column_ref', table: null, column: 'tenant_id' },
        right: { type: 'string', value: tenantId }
      }
    }
  }
  return ast
}

export function extractShardKey(ast: AST, keyColumn: string): string | null {
  // Find key = 'value' in WHERE clause
  if (!ast.where) return null
  return findEqualityCondition(ast.where, keyColumn)
}
```

### SQL Generation from AST

```typescript
// compat/postgres/generator.ts
export function generateSQL(ast: AST, parser: SQLParser): string {
  // Transform AST for DO-backed storage
  const transformed = {
    ...ast,
    // Add dotdo internal columns
    columns: [...ast.columns, { type: 'column_ref', column: '__do_id' }]
  }

  return parser.stringify(transformed)
}
```

### Compat Layer Pipeline

```
User Query (PostgreSQL wire protocol)
         |
         v
    +----------+
    | Validate |  <- parser.validate()
    +----------+
         |
         v
    +--------+
    | Parse  |  <- parser.parse()
    +--------+
         |
         v
    +-----------+
    | Transform |  <- addTenantFilter(), extractShardKey()
    +-----------+
         |
         v
    +----------+
    | Generate |  <- parser.stringify()
    +----------+
         |
         v
    +---------+
    | Execute |  <- DO.fetch() or sqlite.execute()
    +---------+
         |
         v
    Result Set
```

## Performance Considerations

### Caching Parsed Queries

For frequently-executed queries, cache the AST:

```typescript
import { LRUCache } from 'lru-cache'

const astCache = new LRUCache<string, AST>({ max: 1000 })

async function parseWithCache(sql: string): Promise<AST> {
  const cached = astCache.get(sql)
  if (cached) return cached

  const ast = await parser.parse(sql)
  astCache.set(sql, ast)
  return ast
}
```

### Prepared Statements

For parameterized queries, parse once and reuse:

```typescript
class PreparedStatement {
  private ast: AST

  constructor(sql: string, parser: SQLParser) {
    this.ast = parser.parse(sql)
  }

  execute(params: unknown[]) {
    // AST already parsed, just bind params and execute
    return this.stub.fetch('/execute', {
      ast: this.ast,
      params
    })
  }
}
```

### Batch Operations

When parsing multiple queries, use batch APIs:

```typescript
// With pgsql-parser worker
const queries = ['SELECT ...', 'INSERT ...', 'UPDATE ...']
const asts = await parser.parseBatch(queries)  // Single RPC call

// Process all ASTs
for (const ast of asts) {
  // ...
}
```

## Cloudflare Workers Compatibility

### node-sql-parser

- Pure JavaScript, no native dependencies
- Works directly in Workers runtime
- Tree-shakeable: import only needed dialects

```typescript
// Full package (all dialects)
import { Parser } from 'node-sql-parser'

// PostgreSQL only (smaller bundle)
import { Parser } from 'node-sql-parser/build/postgresql'
```

### pgsql-parser

- Uses WebAssembly (libpg-query compiled from C)
- Workers WASM limits: 128 modules, ~4MB per module
- WASM size: 1.1 MB (within limits)
- Requires async `loadModule()` before `parseSync()`

```typescript
import { loadModule, parseSync } from 'pgsql-parser'

// In worker initialization
await loadModule()

// Then use sync API
const ast = parseSync('SELECT * FROM users')
```

### Recommendation

| Scenario | Parser | Deployment |
|----------|--------|------------|
| Simple compat layer | node-sql-parser | In-process |
| PostgreSQL-only, high throughput | pgsql-parser | Separate RPC worker |
| Multi-dialect support | node-sql-parser | In-process |
| Query transformation pipeline | pgsql-parser | Separate RPC worker |

## Related Documentation

- [Compat Layer Design](/docs/plans/2026-01-09-compat-layer-design.md) - Overall compat layer architecture
- [Architecture](/docs/architecture.md) - dotdo system architecture
