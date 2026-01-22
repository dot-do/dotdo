# chdb-wasm Build Profiles

This document describes the 6 core WASM build profiles for chdb-wasm. Each profile targets a specific use case with optimized binary size and feature set.

## Quick Reference

| Profile | Target Size | Gzipped | Primary Use Case |
|---------|-------------|---------|------------------|
| `parser` | ~300KB | ~100KB | SQL validation, IDE integration |
| `dashboard` | ~3MB | ~1MB | Simple dashboards, small data |
| `analytics` | ~8MB | ~2.5MB | ClickBench-style OLAP analytics |
| `etl` | ~12-15MB | ~4-5MB | Data transformation with Parquet/Arrow |
| `lakehouse` | ~18-20MB | ~6-7MB | Query S3/R2 data lakes directly |
| `full` | ~25MB+ | ~8MB+ | Maximum ClickHouse compatibility |

## Building Profiles

### Build All Profiles

```bash
./scripts/build-profiles.sh
```

### Build Specific Profile(s)

```bash
./scripts/build-profiles.sh dashboard
./scripts/build-profiles.sh parser analytics
```

### Build with Options

```bash
./scripts/build-profiles.sh --clean --all      # Clean build all profiles
./scripts/build-profiles.sh dashboard --verbose # Verbose build
./scripts/build-profiles.sh --list              # List available profiles
./scripts/build-profiles.sh --compare           # Show feature comparison
```

### Using CMake Directly

```bash
# Build dashboard profile
cmake -DCHDB_PROFILE=dashboard \
      -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
      -B build-dashboard

cmake --build build-dashboard --parallel
```

---

## Profile Details

### 1. Parser Profile (`chdb-parser.wasm`)

**Target Size:** ~300KB
**Use Case:** SQL validation, IDE integration, syntax checking

The parser profile builds only the SQL lexer and parser components without any execution engine. This is ideal for:

- SQL editor syntax highlighting
- IDE autocomplete integration
- SQL linting and validation tools
- Query formatting utilities

**Features:**
- SQL Lexer (tokenization)
- SQL Parser (AST generation)
- Syntax validation with error reporting
- SQL pretty-printing/formatting
- Query type detection (SELECT, INSERT, etc.)

**NOT Included:**
- Query execution engine
- Storage engines
- Data formats
- Functions (parsing only, no evaluation)

**Example Use:**
```javascript
import createParser from './chdb-parser.js';

const parser = await createParser();
const result = parser.parse('SELECT * FROM users WHERE id = 1');
console.log(result.isValid);  // true
console.log(result.ast);       // Abstract Syntax Tree
```

---

### 2. Dashboard Profile (`chdb-dashboard.wasm`)

**Target Size:** ~3MB
**Use Case:** Simple dashboards, small data visualizations

The dashboard profile provides a lightweight execution environment for basic analytics. Perfect for:

- Simple dashboards and reports
- Small data analytics (<100K rows)
- Basic data visualization
- Lightweight embedded analytics

**Features:**
- Memory storage engine (in-RAM tables)
- Basic aggregates: COUNT, SUM, AVG, MIN, MAX
- JSON, CSV, TSV formats
- Basic string and math functions
- Core SQL: SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT
- Basic JOINs (INNER, LEFT, RIGHT)
- Subqueries

**NOT Included:**
- MergeTree engine (no persistence)
- Parquet/Arrow formats
- Window functions
- Advanced aggregates
- Date/time functions (beyond basics)
- CTEs, UNION

**Example Use:**
```javascript
import createChDB from './chdb-dashboard.js';

const db = await createChDB();
const result = db.query(`
  SELECT department, COUNT(*) as count, AVG(salary) as avg_salary
  FROM employees
  GROUP BY department
  ORDER BY count DESC
`, 'JSON');
```

---

### 3. Analytics Profile (`chdb-analytics.wasm`)

**Target Size:** ~8MB
**Use Case:** ClickBench-style analytics, OLAP workloads

The analytics profile is designed for serious analytical queries with full aggregate support and MergeTree read capabilities. Ideal for:

- ClickBench-style benchmarks
- OLAP query workloads
- Time-series analytics
- Log analysis

**Features:**
- Memory + MergeTree (all variants) engines
- **All aggregate functions** (basic, conditional, statistical, quantile, approximate, histogram)
- Full date/time functions
- System tables for introspection
- JSON, CSV, TSV, Native formats
- CTEs (WITH clause), UNION, advanced JOINs
- PREWHERE optimization
- SAMPLE clause
- LZ4 and ZSTD compression

**NOT Included:**
- Parquet/Arrow formats (see ETL profile)
- Window functions
- S3/URL table functions
- Array/Map complex type functions

**Example Use:**
```javascript
import createChDB from './chdb-analytics.js';

const db = await createChDB();
const result = db.query(`
  WITH daily_stats AS (
    SELECT
      toDate(timestamp) as day,
      uniqExact(user_id) as unique_users,
      count() as total_events,
      quantile(0.95)(duration_ms) as p95_duration
    FROM events
    WHERE timestamp >= today() - 30
    GROUP BY day
  )
  SELECT * FROM daily_stats
  ORDER BY day DESC
`, 'JSON');
```

---

### 4. ETL Profile (`chdb-etl.wasm`)

**Target Size:** ~12-15MB
**Use Case:** Data transformation pipelines, Parquet processing

The ETL profile extends analytics with Parquet/Arrow support and window functions for data transformation. Perfect for:

- Parquet file transformation
- Data pipeline processing
- ETL workloads in browser/worker
- CSV to Parquet conversion
- Data cleaning and normalization

**Features:**
- Everything in analytics profile
- **Parquet reader/writer**
- **Arrow format support**
- Array and Map functions
- Window functions (ROW_NUMBER, RANK, LAG, LEAD, etc.)
- ARRAY JOIN, LATERAL

**NOT Included:**
- S3/URL table functions (see lakehouse profile)
- Geo functions
- ML functions

**Example Use:**
```javascript
import createChDB from './chdb-etl.js';

const db = await createChDB();

// Read Parquet, transform, write back
db.query(`
  INSERT INTO output FORMAT Parquet
  SELECT
    user_id,
    arrayJoin(events) as event,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp) as event_num
  FROM input FORMAT Parquet
`);
```

---

### 5. Lakehouse Profile (`chdb-lakehouse.wasm`)

**Target Size:** ~18-20MB
**Use Case:** Query data lakes directly (S3, R2, URLs)

The lakehouse profile adds S3/R2 and URL table functions to enable direct querying of data lakes from the browser. Ideal for:

- Query Parquet files from S3/R2 directly
- Join local data with remote data lakes
- Read CSV/JSON from URLs
- Data lake analytics in browser
- Cloudflare R2 integration

**Features:**
- Everything in ETL profile
- **S3 table function** (works with R2, MinIO, AWS S3)
- **URL table function**
- HTTP/HTTPS support via Emscripten fetch
- IP address functions (useful for log analysis)

**NOT Included:**
- Full AWS SDK (uses minimal S3 implementation)
- Geo functions
- ML functions

**Example Use:**
```javascript
import createChDB from './chdb-lakehouse.js';

const db = await createChDB();

// Query Parquet directly from R2
const result = db.query(`
  SELECT
    toDate(timestamp) as day,
    count() as events,
    uniqExact(user_id) as users
  FROM s3('https://bucket.r2.cloudflarestorage.com/events/*.parquet')
  WHERE timestamp >= '2024-01-01'
  GROUP BY day
  ORDER BY day
`, 'JSON');

// Query CSV from URL
const csv_result = db.query(`
  SELECT *
  FROM url('https://example.com/data.csv', CSV, 'id UInt32, name String')
  LIMIT 100
`, 'JSON');
```

---

### 6. Full Profile (`chdb-full.wasm`)

**Target Size:** ~25MB+
**Use Case:** Maximum ClickHouse compatibility

The full profile includes everything possible in WASM for maximum ClickHouse compatibility. Use when:

- You need maximum ClickHouse feature parity
- Complex analytics requiring all features
- Geo-spatial analytics
- Production deployments needing broad compatibility

**Features:**
- Everything in lakehouse profile
- **Geo functions** (H3, S2 geometry)
- All formats (Avro, Protobuf, MsgPack)
- All compression (LZ4, ZSTD, Brotli)
- All SQL features (FINAL, all JOINs)
- System introspection functions
- Log engine, Dictionary engine

**NOT Included (WASM Limitations):**
- External database connectors (MySQL, PostgreSQL)
- Message queues (Kafka, RabbitMQ)
- LLVM JIT compilation
- Full AWS/GCS/Azure SDKs

**Example Use:**
```javascript
import createChDB from './chdb-full.js';

const db = await createChDB();

// Geo-spatial query with H3
const result = db.query(`
  SELECT
    geoToH3(latitude, longitude, 7) as h3_cell,
    count() as count
  FROM locations
  GROUP BY h3_cell
`, 'JSON');
```

---

## Feature Comparison Matrix

| Feature | parser | dashboard | analytics | etl | lakehouse | full |
|---------|:------:|:---------:|:---------:|:---:|:---------:|:----:|
| SQL Parser/Lexer | Y | Y | Y | Y | Y | Y |
| Query Execution | - | Y | Y | Y | Y | Y |
| Memory Engine | - | Y | Y | Y | Y | Y |
| MergeTree Engine | - | - | Y | Y | Y | Y |
| System Tables | - | - | Y | Y | Y | Y |
| JSON/CSV/TSV | - | Y | Y | Y | Y | Y |
| Parquet/Arrow | - | - | - | Y | Y | Y |
| Avro/Protobuf | - | - | - | - | - | Y |
| Basic Functions | - | Y | Y | Y | Y | Y |
| DateTime Functions | - | - | Y | Y | Y | Y |
| Array/Map Functions | - | - | - | Y | Y | Y |
| Window Functions | - | - | - | Y | Y | Y |
| All Aggregates | - | basic | Y | Y | Y | Y |
| IP Functions | - | - | - | - | Y | Y |
| Geo Functions | - | - | - | - | - | Y |
| S3/URL Functions | - | - | - | - | Y | Y |
| CTEs (WITH) | - | - | Y | Y | Y | Y |
| UNION | - | - | Y | Y | Y | Y |
| ARRAY JOIN | - | - | - | Y | Y | Y |
| Advanced JOINs | - | - | Y | Y | Y | Y |

**Legend:** Y = Included, - = Not included, basic = Basic aggregates only (COUNT/SUM/AVG/MIN/MAX)

---

## Choosing the Right Profile

### Decision Tree

1. **Do you only need SQL validation/parsing?**
   - Yes: Use `parser` (~300KB)

2. **Do you need query execution?**
   - Basic aggregates on small data: Use `dashboard` (~3MB)
   - Full analytics without Parquet: Use `analytics` (~8MB)
   - Need Parquet/Arrow/Window: Use `etl` (~12-15MB)
   - Need S3/R2/URL access: Use `lakehouse` (~18-20MB)
   - Need everything: Use `full` (~25MB+)

### Use Case Recommendations

| Use Case | Recommended Profile |
|----------|---------------------|
| SQL syntax highlighting in editor | `parser` |
| IDE autocomplete | `parser` |
| Simple dashboard with charts | `dashboard` |
| Real-time metrics display | `dashboard` |
| ClickBench queries | `analytics` |
| Time-series analysis | `analytics` |
| Log file analysis | `analytics` |
| Parquet file processing | `etl` |
| Data pipeline in browser | `etl` |
| Query S3/R2 directly | `lakehouse` |
| Cloudflare Worker analytics | `lakehouse` |
| Geo-spatial analytics | `full` |
| Maximum compatibility | `full` |

---

## Output Files

After building, profiles are output to:

```
dist/
  parser/
    chdb-parser.wasm
    chdb-parser.js
  dashboard/
    chdb-dashboard.wasm
    chdb-dashboard.js
  analytics/
    chdb-analytics.wasm
    chdb-analytics.js
  etl/
    chdb-etl.wasm
    chdb-etl.js
  lakehouse/
    chdb-lakehouse.wasm
    chdb-lakehouse.js
  full/
    chdb-full.wasm
    chdb-full.js
```

---

## Cloudflare Workers Integration

To use a profile in Cloudflare Workers:

1. Build the desired profile
2. Copy the WASM file to your worker's `public/` directory
3. Reference in `wrangler.toml`

```toml
# wrangler.toml
[vars]
CHDB_PROFILE = "dashboard"  # or analytics, etl, lakehouse, full

[assets]
directory = "./public"

[[rules]]
type = "CompiledWasm"
globs = ["**/*.wasm"]
```

---

## Size Optimization Notes

All profiles use aggressive size optimization:

- **-Oz** compiler flag for minimum size
- **LTO** (Link-Time Optimization) for dead code elimination
- **wasm-opt** post-processing with:
  - Duplicate function elimination
  - Unused code removal
  - Symbol stripping
- **Emscripten emmalloc** (smallest allocator)
- **No exceptions/RTTI** to reduce runtime overhead

For even smaller builds:
- Parser profile uses fixed 4MB memory (no growth)
- Dashboard/Analytics profiles disable filesystem where possible
