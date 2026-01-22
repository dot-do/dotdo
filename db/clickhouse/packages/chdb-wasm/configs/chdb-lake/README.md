# chDB Lake - Real ClickHouse SQL over R2 Parquet Files

A Cloudflare Worker that provides SQL query capabilities over Parquet files stored in R2, powered by **real ClickHouse compiled to WebAssembly**.

## What This Is

This is **actual ClickHouse** - the C++ codebase from `vendor/chdb` compiled to WebAssembly via Emscripten - running on Cloudflare's edge network. All SQL parsing, query execution, and format handling is done by the real ClickHouse engine, not a JavaScript reimplementation.

## Overview

chDB Lake enables data lake-style analytics on Cloudflare's edge network by combining:

- **Real ClickHouse WASM** (~15-20MB) - Actual ClickHouse SQL parser and executor compiled from C++
- **S3/R2 Table Function** - Query files using familiar ClickHouse s3() syntax
- **Parquet Reader** - Real ClickHouse Parquet implementation
- **JSON/CSV Formats** - Real ClickHouse format handlers
- **Aggregates** - Real ClickHouse COUNT, SUM, AVG, MIN, MAX, GROUP BY

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Build Pipeline                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   vendor/chdb (ClickHouse C++ Source)                           │
│          │                                                       │
│          ▼                                                       │
│   Emscripten (emcc) - C++ to WASM Compiler                      │
│          │                                                       │
│          ▼                                                       │
│   chdb-lake.wasm (15-20MB WebAssembly Binary)                   │
│          │                                                       │
│          ▼                                                       │
│   Cloudflare Workers + R2                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Target Size

- **WASM Module**: 15-20MB (optimized for data lake queries)
- **Memory Limit**: 128MB (Workers Paid plan)
- **CPU Time**: 30 seconds max

## Example Queries

```sql
-- Query a single Parquet file
SELECT * FROM s3('r2://data/events.parquet', 'Parquet')
WHERE date = '2024-01-15'
LIMIT 100

-- Aggregate across multiple files using glob patterns
SELECT event_type, count(*)
FROM s3('r2://data/events/*.parquet', 'Parquet')
GROUP BY event_type

-- Query CSV files
SELECT * FROM s3('r2://data/logs.csv', 'CSV')
WHERE level = 'ERROR'
LIMIT 100

-- Column projection (only read needed columns)
SELECT user_id, event_type, timestamp
FROM s3('r2://data/events.parquet', 'Parquet')
```

## Features

### HTTP Range Requests
Efficient partial reads of Parquet files using HTTP range requests. Only downloads the data needed for the query.

### Predicate Pushdown
Skips row groups that cannot contain matching data based on column statistics (min/max values).

### Column Projection
Only reads columns that are actually used in the query, reducing data transfer significantly.

### Query Result Caching
Results are cached in KV with configurable TTL to speed up repeated queries.

## API Endpoints

### Query Endpoint

```
GET /?query=SELECT...&default_format=JSON
POST / (query in body)
```

**Parameters:**
- `query` - SQL query string
- `default_format` - Output format (JSON, JSONEachRow, CSV, TSV, Parquet)
- `query_id` - Optional query identifier

**Headers:**
- `X-ClickHouse-Format` - Alternative way to specify output format

### Status Endpoint

```
GET /status
```

Returns service status including WASM module availability and bucket access.

### Files Endpoint

```
GET /files?prefix=events/&limit=100
```

Lists files in the data bucket.

### Play UI

```
GET /play
```

Interactive web UI for running queries.

### Health Check

```
GET /ping
```

Returns "Ok." for health checks.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHDB_LAKE_VERSION` | Service version | `0.1.0` |
| `ENVIRONMENT` | Environment name | `production` |
| `MAX_QUERY_TIME_MS` | Query timeout | `30000` |
| `MAX_RESULT_SIZE` | Max result bytes | `10485760` |
| `ENABLE_CACHE` | Enable query caching | `true` |
| `CACHE_TTL` | Cache TTL seconds | `300` |

### R2 Buckets

| Binding | Description |
|---------|-------------|
| `DATA_BUCKET` | Data files (Parquet, CSV, JSON) |
| `WASM_BUCKET` | WASM modules |

### KV Namespaces

| Binding | Description |
|---------|-------------|
| `QUERY_CACHE` | Query result cache |

## Deployment

```bash
# From packages/chdb-wasm directory
wrangler deploy -c configs/chdb-lake/wrangler.toml

# Local development
wrangler dev -c configs/chdb-lake/wrangler.toml
```

## WASM Module Requirements

The `chdb-lake.wasm` module must be uploaded to the WASM_BUCKET. It contains the **real ClickHouse** implementation including:

- SQL parser (actual ClickHouse parser)
- Expression evaluator (actual ClickHouse implementation)
- Parquet file reader (actual ClickHouse Parquet support)
- CSV/JSON file readers (actual ClickHouse format handlers)
- Aggregate functions (actual ClickHouse aggregates)
- s3() table function (actual ClickHouse implementation)

## Output Formats

| Format | Content-Type | Description |
|--------|--------------|-------------|
| JSON | application/json | Full result with metadata |
| JSONCompact | application/json | Compact array format |
| JSONEachRow | application/x-ndjson | One JSON object per line |
| CSV | text/csv | Comma-separated values |
| CSVWithNames | text/csv | CSV with header row |
| TSV | text/tab-separated-values | Tab-separated values |
| Parquet | application/octet-stream | Binary Parquet output |

## Limitations

- Maximum result size: 10MB (configurable)
- Maximum query time: 30 seconds (configurable)
- Memory limit: 128MB (Workers limit)
- No persistent state between requests
- Glob patterns limited to simple wildcards (* and ?)

## Runtime Architecture

```
                                   +------------------+
                                   |   R2 Bucket      |
                                   |   (Data Files)   |
                                   +--------+---------+
                                            |
+---------------+    SQL Query    +---------v---------+
|    Client     |---------------->|   chDB Lake       |
|               |<----------------|   Worker          |
+---------------+    Results      +---------+---------+
                                            |
                                   +--------v---------+
                                   | Real ClickHouse  |
                                   |   WASM Module    |
                                   |   (15-20MB)      |
                                   +------------------+
                                            |
                                   +--------v---------+
                                   |   KV Cache       |
                                   |   (Results)      |
                                   +------------------+
```

## Future Enhancements

- [ ] Streaming results for large queries
- [ ] Durable Objects for query state
- [ ] Partitioned tables support
- [ ] Delta Lake format support
- [ ] Query planning optimization
- [ ] Materialized views
